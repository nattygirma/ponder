import { afterEach, describe, expect, test } from "bun:test";
import { Database } from "bun:sqlite";
import { globSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Hono } from "hono";
import { AppError } from "./app-error.ts";
import { createAutomation } from "./automation-service.ts";
import { buildFormRow, reserveFormSubmission, FORM_SUBMIT_LIMIT } from "./database-form-service.ts";
import { registerDatabaseFormRoutes, registerPublicDatabaseFormRoutes } from "./database-form-routes.ts";
import { createDatabase, createDatabaseView, deleteDatabaseView, getDatabaseRow, listDatabaseRows } from "./database-service.ts";
import { apiError } from "./http-errors.ts";
import { createSelfHostedStorageAdapter } from "./self-hosted-storage-adapter.ts";

// Database forms: members build the form on a Form view; anyone with the link (when it's public)
// answers it without signing in, and each answer becomes a row through the normal row path.
const WS = "ws_default";
const ownerAuth = {
  kind: "user", actorType: "user", actorId: "usr_ada", username: "ada", displayName: "Ada",
  scopes: [], workspaceId: WS, role: "owner",
};
const ada = { actorType: "user", actorId: "usr_ada" };
const cleanups = [];
afterEach(() => cleanups.splice(0).forEach((cleanup) => cleanup()));

const SCHEMA = {
  properties: [
    { id: "title", name: "Name", type: "title" },
    { id: "email", name: "Email", type: "email" },
    { id: "size", name: "T-shirt", type: "select", options: [
      { id: "s", name: "Small", color: "gray" }, { id: "l", name: "Large", color: "blue" },
    ] },
    { id: "diet", name: "Diet", type: "multi_select", options: [
      { id: "veg", name: "Vegetarian", color: "green" }, { id: "gf", name: "Gluten-free", color: "red" },
    ] },
    { id: "guests", name: "Guests", type: "number" },
    { id: "day", name: "Day", type: "date" },
    { id: "agree", name: "Agree", type: "checkbox" },
    { id: "cv", name: "CV", type: "files" },
    { id: "site", name: "Website", type: "url" },
    { id: "secret", name: "Internal notes", type: "text" },
    { id: "owner", name: "Owner", type: "person" },
    { id: "status", name: "Status", type: "status", options: [{ id: "new", name: "New", color: "gray", group: "todo" }] },
    { id: "made_by", name: "Created by", type: "created_by" },
  ],
};

const setup = async ({ limiter } = {}) => {
  const sqlite = new Database(":memory:");
  for (const file of globSync("migrations/*.sql").sort()) sqlite.exec(readFileSync(file, "utf8"));
  const directory = mkdtempSync(join(tmpdir(), "ponder-database-forms-"));
  cleanups.push(() => {
    sqlite.close();
    rmSync(directory, { recursive: true, force: true });
  });
  sqlite.run("INSERT INTO users (id, username, password_hash, display_name, email) VALUES ('usr_ada', 'ada', 'unused', 'Ada', 'ada@example.com')");
  sqlite.run("INSERT INTO workspace_members (workspace_id, user_id, role) VALUES (?, 'usr_ada', 'owner')", [WS]);
  const storage = createSelfHostedStorageAdapter(sqlite, directory);
  const db = storage.db;
  const app = new Hono();
  // As in index.ts: the public routes come before the /api/v1 sign-in middleware.
  registerPublicDatabaseFormRoutes(app);
  app.use("/api/v1/*", async (context, next) => {
    context.set("auth", ownerAuth);
    await next();
  });
  app.onError((error, context) => {
    if (error instanceof AppError) return apiError(context, error.code, error.message, error.status);
    throw error;
  });
  registerDatabaseFormRoutes(app);
  const env = { storage, ...(limiter ? { FORM_LIMIT: limiter } : {}) };
  const request = async (path, init = {}) => {
    const response = await app.request(path, init, env);
    const text = await response.text();
    return { status: response.status, headers: response.headers, body: text ? JSON.parse(text) : null };
  };
  const json = (method, path, body, headers = {}) => request(path, { method, headers: { "Content-Type": "application/json", ...headers }, body: JSON.stringify(body) });
  const database = await createDatabase(db, WS, { notebookId: "nb_inbox", title: "Event sign-up", schema: SCHEMA }, ada, "user:usr_ada");
  const view = await createDatabaseView(db, WS, database.id, { name: "Form", type: "form" });
  const base = `/api/v1/databases/${database.id}/forms/${view.id}`;
  const configure = async (patch) => {
    const response = await json("PATCH", base, patch);
    expect(response.status).toBe(200);
    return response.body.form;
  };
  const publicForm = async (patch = {}) => {
    const questions = [
      { propertyId: "title", required: true },
      { propertyId: "email" },
      { propertyId: "size" },
      { propertyId: "diet" },
      { propertyId: "guests" },
      { propertyId: "day" },
      { propertyId: "agree" },
      { propertyId: "cv" },
      { propertyId: "site" },
    ];
    return configure({ access: "public", title: "Sign up", questions, ...patch });
  };
  const respond = (token, answers, extra = {}, headers = {}) => json("POST", `/api/public/database-forms/${token}/responses`, { answers, ...extra }, headers);
  const upload = (token, file) => {
    const body = new FormData();
    body.set("file", file);
    return request(`/api/public/database-forms/${token}/files`, { method: "POST", body });
  };
  const rows = async () => (await listDatabaseRows(db, WS, database.id, {})).rows;
  return { sqlite, db, request, json, database, view, base, configure, publicForm, respond, upload, rows };
};

describe("building a form", () => {
  test("a new form view starts with the title question and is closed to the public", async () => {
    const t = await setup();
    const response = await t.request(t.base);
    expect(response.status).toBe(200);
    expect(response.body.form.questions).toEqual([{ propertyId: "title", syncName: true, required: false }]);
    expect(response.body.form.access).toBe("workspace");
    expect(response.body.form.token).toMatch(/^[A-Za-z0-9_-]{43}$/);
    // Opening it again finds the same form.
    expect((await t.request(t.base)).body.form.token).toBe(response.body.form.token);
  });

  test("questions about missing, repeated or unanswerable properties are dropped", async () => {
    const t = await setup();
    const form = await t.configure({
      questions: [
        { propertyId: "title" }, { propertyId: "email", required: true, description: "Work address" },
        { propertyId: "email" }, { propertyId: "gone" }, { propertyId: "owner" }, { propertyId: "made_by" },
      ],
    });
    expect(form.questions.map((question) => question.propertyId)).toEqual(["title", "email"]);
    expect(form.questions[1]).toMatchObject({ required: true, description: "Work address" });
  });

  test("a password is made once and only its hash is kept", async () => {
    const t = await setup();
    const form = await t.configure({ access: "public", passwordProtected: true });
    expect(form.password).toMatch(/^[A-Za-z0-9]{8}$/);
    expect((await t.request(t.base)).body.form.password).toBeUndefined();
    expect(t.sqlite.query("SELECT password_hash FROM database_forms").get().password_hash).not.toContain(form.password);
  });

  test("only form views have a form", async () => {
    const t = await setup();
    const table = t.database.views[0];
    expect((await t.request(`/api/v1/databases/${t.database.id}/forms/${table.id}`)).status).toBe(404);
  });
});

describe("the public form", () => {
  test("a visitor sees only the form's questions, never other properties or rows", async () => {
    const t = await setup();
    const form = await t.publicForm({ questions: [{ propertyId: "title", required: true }, { propertyId: "size", syncName: false, label: "Your size", description: "Pick one" }] });
    const response = await t.request(`/api/public/database-forms/${form.token}`);
    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBe("private, no-store");
    expect(response.body.form).toMatchObject({ passwordRequired: false, title: "Sign up", respondent: null });
    expect(response.body.form.questions).toEqual([
      { id: "title", label: "Name", description: "", required: true, type: "title", longAnswer: false },
      { id: "size", label: "Your size", description: "Pick one", required: false, type: "select", longAnswer: false,
        options: [{ id: "s", name: "Small", color: "gray" }, { id: "l", name: "Large", color: "blue" }] },
    ]);
    expect(JSON.stringify(response.body)).not.toContain("Internal notes");
  });

  test("members-only and closed forms turn signed-out visitors away", async () => {
    const t = await setup();
    const form = await t.configure({});
    expect((await t.request(`/api/public/database-forms/${form.token}`)).body.error.code).toBe("form_members_only");
    expect((await t.respond(form.token, { title: "Sneaky" })).status).toBe(403);
    await t.configure({ access: "closed" });
    const closed = await t.request(`/api/public/database-forms/${form.token}`);
    expect(closed.status).toBe(403);
    expect(closed.body.error.code).toBe("form_closed");
    expect(await t.rows()).toHaveLength(0);
  });

  test("an unknown or malformed link is not found", async () => {
    const t = await setup();
    expect((await t.request("/api/public/database-forms/nope")).status).toBe(404);
    expect((await t.request(`/api/public/database-forms/${"a".repeat(43)}`)).status).toBe(404);
  });

  test("deleting the form view stops its link", async () => {
    const t = await setup();
    const form = await t.publicForm();
    await deleteDatabaseView(t.db, WS, t.database.id, t.view.id);
    expect((await t.request(`/api/public/database-forms/${form.token}`)).status).toBe(404);
    expect(t.sqlite.query("SELECT COUNT(*) AS n FROM database_forms").get().n).toBe(0);
  });

  test("a password-protected form opens with the right password", async () => {
    const t = await setup();
    const form = await t.publicForm({ passwordProtected: true });
    const locked = await t.request(`/api/public/database-forms/${form.token}`);
    expect(locked.body.form).toMatchObject({ passwordRequired: true, questions: [] });
    expect((await t.respond(form.token, { title: "No password" })).body.error.code).toBe("form_password_required");
    expect((await t.json("POST", `/api/public/database-forms/${form.token}/unlock`, { password: "wrong-one" })).status).toBe(403);
    const unlocked = await t.json("POST", `/api/public/database-forms/${form.token}/unlock`, { password: form.password });
    expect(unlocked.status).toBe(200);
    const cookie = unlocked.headers.get("set-cookie").split(";")[0];
    const open = await t.request(`/api/public/database-forms/${form.token}`, { headers: { cookie } });
    expect(open.body.form.passwordRequired).toBe(false);
    expect((await t.respond(form.token, { title: "With password" }, {}, { cookie })).status).toBe(201);
  });
});

describe("answering", () => {
  test("an answer becomes a row made by the form, with every type stored the way the database stores it", async () => {
    const t = await setup();
    const form = await t.publicForm();
    const response = await t.respond(form.token, {
      title: "  Grace Hopper ", email: "grace@example.com", size: "Large", diet: ["veg", "gf"], guests: "2",
      day: "2026-12-01", agree: true, site: "https://example.com", secret: "not on the form",
    });
    expect(response.status).toBe(201);
    const [row] = await t.rows();
    expect(row.title).toBe("Grace Hopper");
    expect(row.properties).toEqual({
      email: "grace@example.com", size: "l", diet: ["veg", "gf"], guests: 2, day: { start: "2026-12-01" }, agree: true, site: "https://example.com",
    });
    expect(row.createdBy).toBeNull();
    expect(row.createdVia).toBe("form");
    expect(t.sqlite.query("SELECT response_count FROM database_forms").get().response_count).toBe(1);
  });

  test("required questions and bad answers are refused with the question's name", async () => {
    const t = await setup();
    const form = await t.publicForm({ questions: [
      { propertyId: "title", required: true }, { propertyId: "email" }, { propertyId: "size" }, { propertyId: "agree", required: true }, { propertyId: "site" }, { propertyId: "day" },
    ] });
    for (const [answers, code, text] of [
      [{ title: "", agree: true }, "form_required", "Name"],
      [{ title: "A", agree: false }, "form_required", "Agree"],
      [{ title: "A", agree: true, email: "not-an-email" }, "form_invalid", "Email"],
      [{ title: "A", agree: true, size: "Medium" }, "form_invalid", "T-shirt"],
      [{ title: "A", agree: true, site: "javascript:alert(1)" }, "form_invalid", "Website"],
      [{ title: "A", agree: true, day: "12/01/2026" }, "form_invalid", "Day"],
    ]) {
      const response = await t.respond(form.token, answers);
      expect(response.status).toBe(400);
      expect(response.body.error.code).toBe(code);
      expect(response.body.error.message).toContain(text);
    }
    expect(await t.rows()).toHaveLength(0);
  });

  test("the hidden honeypot field gets a success reply and saves nothing", async () => {
    const t = await setup();
    const form = await t.publicForm();
    const response = await t.respond(form.token, { title: "Bot" }, { website: "http://spam.example" });
    expect(response.status).toBe(201);
    expect(await t.rows()).toHaveLength(0);
  });

  test("a file answer moves the upload to the new row's page", async () => {
    const t = await setup();
    const form = await t.publicForm();
    const uploaded = await t.upload(form.token, new File(["%PDF cv"], "cv.pdf", { type: "application/pdf" }));
    expect(uploaded.status).toBe(201);
    const file = uploaded.body.file;
    expect(file).toMatchObject({ name: "cv.pdf", size: 7 });
    expect((await t.respond(form.token, { title: "With CV", cv: [file.id] })).status).toBe(201);
    const [row] = await t.rows();
    expect(row.properties.cv).toEqual([{ id: file.id, name: "cv.pdf", mimeType: "application/pdf", size: 7 }]);
    const stored = t.sqlite.query("SELECT memo_id, json_extract(metadata_json, '$.pending') AS pending FROM resources WHERE id = ?").get(file.id);
    expect(stored).toEqual({ memo_id: row.id, pending: 0 });
    // The same upload can't be sent twice.
    expect((await t.respond(form.token, { title: "Again", cv: [file.id] })).body.error.code).toBe("form_invalid");
  });

  test("files over 20 MB, and files for forms without a file question, are refused", async () => {
    const t = await setup();
    const form = await t.publicForm();
    const big = await t.upload(form.token, new File([new Uint8Array(20 * 1024 * 1024 + 1)], "big.bin"));
    expect(big.status).toBe(413);
    const noFiles = await t.publicForm({ questions: [{ propertyId: "title" }] });
    expect((await t.upload(noFiles.token, new File(["x"], "x.txt"))).status).toBe(400);
  });

  test("AppKeep's FORM_LIMIT refuses the 21st response in a minute from one visitor", async () => {
    const counts = new Map();
    const limiter = { limit: async ({ key }) => { counts.set(key, (counts.get(key) ?? 0) + 1); return { success: counts.get(key) <= 20 }; } };
    const t = await setup({ limiter });
    const form = await t.publicForm();
    const headers = { "cf-connecting-ip": "203.0.113.9" };
    for (let index = 1; index <= 20; index += 1) expect((await t.respond(form.token, { title: `Row ${index}` }, {}, headers)).status).toBe(201);
    const refused = await t.respond(form.token, { title: "Row 21" }, {}, headers);
    expect(refused.status).toBe(429);
    expect(refused.body.error.code).toBe("form_rate_limited");
    // Another visitor isn't held up.
    expect((await t.respond(form.token, { title: "Other visitor" }, {}, { "cf-connecting-ip": "198.51.100.4" })).status).toBe(201);
    expect([...counts.keys()].every((key) => key.startsWith(`${form.token}:`))).toBe(true);
  });

  test("the whole form's ten-minute window is a backstop on hosts without FORM_LIMIT", async () => {
    const t = await setup();
    const form = await t.publicForm();
    t.sqlite.query("UPDATE database_forms SET submit_count = ?, submit_window_started_at = ?").run(FORM_SUBMIT_LIMIT, new Date().toISOString());
    expect((await t.respond(form.token, { title: "Late" })).status).toBe(429);
    t.sqlite.query("UPDATE database_forms SET submit_window_started_at = ?").run(new Date(Date.now() - 11 * 60 * 1000).toISOString());
    expect((await t.respond(form.token, { title: "Next window" })).status).toBe(201);
  });

  test("a response sets off the database's \"Page added\" automations", async () => {
    const t = await setup();
    await createAutomation({ db: t.db, now: () => new Date(), emailDailyLimit: null }, WS, t.database.id, {
      name: "Triage", trigger: { type: "page_added" }, actions: [{ type: "edit_property", values: { status: "new" } }],
    }, "usr_ada");
    const form = await t.publicForm();
    expect((await t.respond(form.token, { title: "Automated" })).status).toBe(201);
    const [row] = await t.rows();
    // Automations run after the response, in the background.
    for (let attempt = 0; attempt < 50; attempt += 1) {
      if ((await getDatabaseRow(t.db, WS, t.database.id, row.id)).properties.status === "new") break;
      await new Promise((resolve) => setTimeout(resolve, 10));
    }
    expect((await getDatabaseRow(t.db, WS, t.database.id, row.id)).properties.status).toBe("new");
  });

  test("\"Notify me about responses\" sends the form's maker a notification", async () => {
    const t = await setup();
    await t.request(t.base);
    const form = await t.publicForm({ notify: true });
    await t.respond(form.token, { title: "Grace" });
    const notification = t.sqlite.query("SELECT recipient_id, kind, actor_name, excerpt FROM notifications").get();
    expect(notification).toEqual({ recipient_id: "usr_ada", kind: "form", actor_name: "Someone", excerpt: "Sign up: Grace" });
  });
});

describe("buildFormRow", () => {
  const questions = SCHEMA.properties.map((property) => ({ propertyId: property.id }));
  test("leaves out empty answers, keeps unchecked checkboxes, and caps the title", () => {
    const built = buildFormRow(SCHEMA, questions, { title: "x".repeat(300), guests: "", agree: false }, new Map());
    expect(built.title).toHaveLength(160);
    expect(built.properties).toEqual({ agree: false });
  });
  test("refuses files that weren't uploaded to this form", () => {
    expect(() => buildFormRow(SCHEMA, questions, { cv: ["res_elsewhere"] }, new Map())).toThrow("upload the file again");
  });
});

test("reserveFormSubmission won't let two racing responses take the last place", async () => {
  const t = await setup();
  const form = await t.publicForm();
  const startedAt = new Date().toISOString();
  t.sqlite.query("UPDATE database_forms SET submit_count = ?, submit_window_started_at = ?").run(FORM_SUBMIT_LIMIT - 1, startedAt);
  const record = t.sqlite.query("SELECT * FROM database_forms WHERE token = ?").get(form.token);
  const results = await Promise.allSettled([reserveFormSubmission(t.db, record), reserveFormSubmission(t.db, record)]);
  expect(results.filter((result) => result.status === "fulfilled")).toHaveLength(1);
});
