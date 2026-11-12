import { afterEach, describe, expect, test } from "bun:test";
import { Database } from "bun:sqlite";
import { globSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Hono } from "hono";
import { keepPagesFor } from "@ponder/shared/backup-archive";
import { AppError } from "./app-error.ts";
import { registerBackupRoutes } from "./backup-routes.ts";
import { restoreJsonMemos, restoreJsonNotebooks } from "./backup-service.ts";
import { createMemoComment } from "./comment-service.ts";
import { getOrCreateForm, updateForm } from "./database-form-service.ts";
import { createDatabase, createDatabaseRow, createDatabaseTemplate, createDatabaseView, getDatabase } from "./database-service.ts";
import { sha256Bytes } from "./hash-utils.ts";
import { apiError } from "./http-errors.ts";
import { createMemoRecord, getMemoDetail, mapMemoDetail } from "./memo-service.ts";
import { setPagePlacement, updatePageMeta } from "./page-service.ts";
import { createSelfHostedStorageAdapter } from "./self-hosted-storage-adapter.ts";

// A backup made in Settings is restored into another installation: notebooks, notes,
// then pages.json. The page tree, databases and comments have to come back with it.
const WORKSPACE_ID = "ws_default";
const auth = {
  kind: "user", actorType: "user", actorId: "usr_owner", username: "admin", displayName: "Admin",
  scopes: [], workspaceId: WORKSPACE_ID, role: "owner",
};
const actor = { actorType: "user", actorId: "usr_owner" };
const cleanups = [];
afterEach(() => cleanups.splice(0).forEach((cleanup) => cleanup()));

const installation = () => {
  const sqlite = new Database(":memory:");
  for (const file of globSync("migrations/*.sql").sort()) sqlite.exec(readFileSync(file, "utf8"));
  const directory = mkdtempSync(join(tmpdir(), "ponder-page-backup-"));
  cleanups.push(() => {
    sqlite.close();
    rmSync(directory, { recursive: true, force: true });
  });
  const storage = createSelfHostedStorageAdapter(sqlite, directory);
  const app = new Hono();
  app.use("/api/v1/*", async (context, next) => {
    context.set("auth", auth);
    await next();
  });
  app.onError((error, context) => {
    if (error instanceof AppError) return apiError(context, error.code, error.message, error.status);
    throw error;
  });
  registerBackupRoutes(app, {
    clampNumber: (value, min, max) => Math.min(Math.max(Number.isFinite(value) ? value : min, min), max),
    getMemoDetail, mapMemoDetail, restoreJsonMemos, restoreJsonNotebooks, sha256Bytes,
    initiateResourceRestoreUpload: async () => { throw new Error("not used"); },
  });
  const request = async (path, init = {}) => {
    const response = await app.request(path, init, { storage });
    const text = await response.text();
    return { status: response.status, body: text ? JSON.parse(text) : null };
  };
  const postJson = (path, body) => request(path, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
  return { sqlite, storage, request, postJson };
};

const linkTo = (id, text) => ({
  type: "doc",
  content: [{ type: "paragraph", content: [{ type: "text", text, marks: [{ type: "link", attrs: { href: `#memo=${id}` } }] }] }],
});

/** A workspace with nested pages, a styled page, a database with views and row values, a page link and comments. */
const buildWorkspace = async (source) => {
  const db = source.storage.db;
  const parent = await createMemoRecord(db, WORKSPACE_ID, { notebookId: "nb_inbox", title: "Projects" }, actor, "Admin");
  await setPagePlacement(db, WORKSPACE_ID, parent.id, { parentId: null, position: 5000, icon: "📁" });
  await updatePageMeta(db, WORKSPACE_ID, parent.id, { cover: "https://example.test/cover.png", style: { font: "serif", wide: true } });
  const child = await createMemoRecord(db, WORKSPACE_ID, { notebookId: "nb_inbox", title: "Plan", contentJson: linkTo(parent.id, "back to projects") }, actor, "Admin");
  await setPagePlacement(db, WORKSPACE_ID, child.id, { parentId: parent.id, position: 1024 });
  const database = await createDatabase(db, WORKSPACE_ID, { parentId: parent.id, title: "Tasks" }, actor, "Admin");
  const status = database.schema.properties.find((property) => property.type === "status" || property.type === "select");
  const row = await createDatabaseRow(db, WORKSPACE_ID, database.id, {
    title: "Write the plan", properties: status ? { [status.id]: status.options[1].id } : {},
  }, actor, "Admin");
  const view = await createDatabaseView(db, WORKSPACE_ID, database.id, { name: "Board", type: "board", config: status ? { groupByPropertyId: status.id } : {} });
  const template = await createDatabaseTemplate(db, WORKSPACE_ID, database.id, { name: "Bug", icon: "🐞", content: "## Steps", isDefault: true });
  const { comment } = await createMemoComment(db, WORKSPACE_ID, child.id, { body: "Looks good", quote: "back to projects" }, auth);
  await createMemoComment(db, WORKSPACE_ID, child.id, { body: "Agreed", threadId: comment.threadId }, auth);
  return { parent, child, database, row, view, status, template };
};

const exportAll = async (source) => {
  const memos = [];
  let offset = 0;
  for (;;) {
    const page = await source.request(`/api/v1/backups/json?limit=50&offset=${offset}`);
    expect(page.status).toBe(200);
    for (const memo of page.body.memos) {
      memos.push({ memo, revisions: page.body.revisions.filter((item) => item.memoId === memo.id), resources: [] });
    }
    if (page.body.nextOffset === null) break;
    offset = page.body.nextOffset;
  }
  const notebooks = source.sqlite.query(
    `SELECT id, parent_id, name, slug, icon, color, sort_order, created_at, updated_at FROM notebooks WHERE workspace_id = ? AND is_deleted = 0 ORDER BY parent_id IS NOT NULL, sort_order, id`,
  ).all(WORKSPACE_ID).map((row) => ({
    id: row.id, parentId: row.parent_id, name: row.name, slug: row.slug, icon: row.icon, color: row.color, textColor: null, colorTarget: "icon",
    isBold: false, iconInverted: false, rowInverted: false, sortOrder: row.sort_order, createdAt: row.created_at, updatedAt: row.updated_at,
  }));
  const pages = await source.request("/api/v1/backups/pages");
  expect(pages.status).toBe(200);
  return { notebooks, memos, pages: keepPagesFor(pages.body, new Set(memos.map((item) => item.memo.id))) };
};

// The target is a fresh installation: drop what migrations seeded so IDs don't collide.
const emptyWorkspace = (target) => {
  target.sqlite.exec("DELETE FROM memo_comments; DELETE FROM database_templates; DELETE FROM database_views; DELETE FROM databases; DELETE FROM memo_links; DELETE FROM memo_revisions; DELETE FROM memo_contents; DELETE FROM memos;");
};

const restoreAll = async (target, backup) => {
  const existing = new Set(target.sqlite.query("SELECT id FROM notebooks WHERE workspace_id = ?").all(WORKSPACE_ID).map((row) => row.id));
  const notebooks = backup.notebooks.filter((notebook) => !existing.has(notebook.id));
  if (notebooks.length) expect((await target.postJson("/api/v1/restores/json/notebooks", { notebooks })).status).toBe(200);
  for (let index = 0; index < backup.memos.length; index += 10) {
    const response = await target.postJson("/api/v1/restores/json/memos", { memos: backup.memos.slice(index, index + 10) });
    expect(response.status).toBe(200);
  }
  for (const key of ["databases", "views", "templates", "forms", "pages", "comments"]) {
    const response = await target.postJson("/api/v1/restores/json/pages", { [key]: backup.pages[key] });
    expect(response.status).toBe(200);
  }
};

describe("page backup", () => {
  test("the page tree, databases, views, row values and comments survive a backup and restore", async () => {
    const source = installation();
    const made = await buildWorkspace(source);
    const backup = await exportAll(source);

    expect(backup.pages.pages.find((page) => page.memoId === made.child.id)?.parentId).toBe(made.parent.id);
    expect(backup.pages.comments).toHaveLength(2);

    const target = installation();
    emptyWorkspace(target);
    await restoreAll(target, backup);

    const restored = (await target.request("/api/v1/backups/pages")).body;
    const byId = (list, key = "memoId") => Object.fromEntries(list.map((item) => [item[key], item]));
    const sourcePages = byId(backup.pages.pages);
    for (const page of restored.pages) expect(page).toEqual(sourcePages[page.memoId]);
    expect(restored.pages).toHaveLength(backup.pages.pages.length);
    expect(byId(restored.databases, "id")).toEqual(byId(backup.pages.databases, "id"));
    expect(byId(restored.views, "id")).toEqual(byId(backup.pages.views, "id"));
    expect(byId(restored.comments, "id")).toEqual(byId(backup.pages.comments, "id"));
    expect(byId(restored.templates, "id")).toEqual(byId(backup.pages.templates, "id"));
    expect(restored.templates[0]).toMatchObject({ name: "Bug", icon: "🐞", content: "## Steps", isDefault: true });

    const parent = byId(restored.pages)[made.parent.id];
    expect(parent).toMatchObject({ icon: "📁", cover: "https://example.test/cover.png", style: { font: "serif", wide: true }, position: 5000 });
    const row = byId(restored.pages)[made.row.id];
    expect(row.databaseId).toBe(made.database.id);
    expect(row.rowNumber).toBe(1);
    // New rows count on from the restored ones instead of reusing their numbers.
    const next = await createDatabaseRow(target.storage.db, WORKSPACE_ID, made.database.id, { title: "After restore" }, actor, "Admin");
    expect(next.number).toBe(2);
    if (made.status) expect(row.properties[made.status.id]).toBe(made.status.options[1].id);

    // The database opens with its schema and views, and the page link is a backlink again.
    const database = await getDatabase(target.storage.db, WORKSPACE_ID, made.database.id);
    expect(database.views.map((view) => view.type)).toContain("board");
    const links = target.sqlite.query("SELECT source_memo_id, target_memo_id FROM memo_links").all();
    expect(links).toContainEqual({ source_memo_id: made.child.id, target_memo_id: made.parent.id });
  });

  test("a form view's questions, settings and link survive a backup; a password-protected one comes back closed", async () => {
    const source = installation();
    const made = await buildWorkspace(source);
    const db = source.storage.db;
    const formView = await createDatabaseView(db, WORKSPACE_ID, made.database.id, { name: "Sign-up", type: "form" });
    const title = made.database.schema.properties.find((property) => property.type === "title");
    await getOrCreateForm(db, WORKSPACE_ID, made.database.id, formView.id, "user:usr_owner");
    const open = await updateForm(db, WORKSPACE_ID, made.database.id, formView.id, {
      title: "Join us", access: "public", notify: true, questions: [{ propertyId: title.id, required: true, description: "Your name" }],
    }, "user:usr_owner");
    const lockedView = await createDatabaseView(db, WORKSPACE_ID, made.database.id, { name: "Private", type: "form" });
    await updateForm(db, WORKSPACE_ID, made.database.id, lockedView.id, { access: "public", passwordProtected: true }, "user:usr_owner");
    const backup = await exportAll(source);
    expect(backup.pages.forms).toHaveLength(2);
    expect(JSON.stringify(backup.pages.forms)).not.toContain("password_hash");

    const target = installation();
    emptyWorkspace(target);
    await restoreAll(target, backup);
    const restored = (await target.request("/api/v1/backups/pages")).body.forms;
    const joinUs = restored.find((form) => form.viewId === formView.id);
    expect(joinUs).toMatchObject({ token: open.token, title: "Join us", access: "public", notify: true, questions: [{ propertyId: title.id, required: true, description: "Your name" }] });
    expect(restored.find((form) => form.viewId === lockedView.id)).toMatchObject({ access: "closed", passwordProtected: false });
  });

  test("restoring the same page data twice changes nothing", async () => {
    const source = installation();
    await buildWorkspace(source);
    const backup = await exportAll(source);
    const target = installation();
    emptyWorkspace(target);
    await restoreAll(target, backup);
    const first = (await target.request("/api/v1/backups/pages")).body;
    for (const key of ["databases", "views", "pages", "comments"]) {
      expect((await target.postJson("/api/v1/restores/json/pages", { [key]: backup.pages[key] })).status).toBe(200);
    }
    expect((await target.request("/api/v1/backups/pages")).body).toEqual(first);
  });

  test("page data pointing at a note that wasn't restored is refused", async () => {
    const target = installation();
    const response = await target.postJson("/api/v1/restores/json/pages", {
      pages: [{ memoId: "memo_missing", parentId: null, position: 0, icon: null, cover: null, style: null, databaseId: null, properties: {} }],
    });
    expect(response.status).toBe(400);
    expect(response.body.error.code).toBe("invalid_backup");
  });

  test("a page can't be restored inside itself", async () => {
    const source = installation();
    const made = await buildWorkspace(source);
    const backup = await exportAll(source);
    const target = installation();
    emptyWorkspace(target);
    await restoreAll(target, backup);
    const response = await target.postJson("/api/v1/restores/json/pages", {
      pages: [
        { memoId: made.parent.id, parentId: made.child.id, position: 0, icon: null, cover: null, style: null, databaseId: null, properties: {} },
        { memoId: made.child.id, parentId: made.parent.id, position: 0, icon: null, cover: null, style: null, databaseId: null, properties: {} },
      ],
    });
    expect(response.status).toBe(400);
  });

  test("an archive keeps only page data for the notes it holds", () => {
    const kept = keepPagesFor({
      pages: [
        { memoId: "a", parentId: "gone", position: 0, icon: null, cover: null, style: null, databaseId: "db_gone", properties: {} },
        { memoId: "gone", parentId: null, position: 0, icon: null, cover: null, style: null, databaseId: null, properties: {} },
      ],
      databases: [{ id: "db_gone", pageMemoId: "gone", schema: {}, createdAt: "x", updatedAt: "x" }],
      views: [{ id: "v", databaseId: "db_gone", name: "Table", type: "table", config: {}, position: 0, createdAt: "x", updatedAt: "x" }],
      comments: [{ id: "c", memoId: "gone", threadId: "c", quote: null, quoteOccurrence: 0, body: "hi", mentions: [], authorId: null, authorName: "A", resolvedAt: null, createdAt: "x", updatedAt: "x" }],
      templates: [{ id: "t", databaseId: "db_gone", name: "T", icon: null, title: "", properties: {}, content: "", isDefault: false, position: 0, createdAt: "x", updatedAt: "x" }],
    }, new Set(["a"]));
    expect(kept).toEqual({
      pages: [{ memoId: "a", parentId: null, position: 0, icon: null, cover: null, style: null, databaseId: null, properties: {} }],
      databases: [], views: [], comments: [], templates: [], automations: [], forms: [],
    });
  });
});
