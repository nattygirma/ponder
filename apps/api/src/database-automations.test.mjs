import { afterEach, describe, expect, test } from "bun:test";
import { Database } from "bun:sqlite";
import { globSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { AUTOMATION_RUNS_PER_MINUTE } from "@ponder/shared";
import {
  createAutomation,
  emailUsage,
  handleRowChange,
  listAutomationRuns,
  refreshWake,
  runButton,
  runScheduledAutomations,
  updateAutomation,
} from "./automation-service.ts";
import {
  createDatabase,
  createDatabaseRow,
  createDatabaseTemplate,
  getDatabaseRow,
  listDatabaseRows,
  updateDatabaseRow,
  updateDatabaseTemplate,
} from "./database-service.ts";
import { createSelfHostedStorageAdapter } from "./self-hosted-storage-adapter.ts";

const WS = "ws_default";
const ada = { actorType: "user", actorId: "usr_ada" };
const cleanups = [];
afterEach(() => cleanups.splice(0).forEach((cleanup) => cleanup()));

const SCHEMA = {
  properties: [
    { id: "title", name: "Name", type: "title" },
    { id: "status", name: "Status", type: "status", options: [
      { id: "todo", name: "To-do", color: "gray", group: "todo" },
      { id: "doing", name: "In progress", color: "blue", group: "in_progress" },
      { id: "done", name: "Done", color: "green", group: "done" },
    ] },
    { id: "due", name: "Due", type: "date" },
    { id: "owner", name: "Owner", type: "person" },
    { id: "mail", name: "Email", type: "email" },
    { id: "note", name: "Note", type: "text" },
  ],
};

/** A fresh Ponder with two people, a Tasks database and an engine whose clock, mail and AppKeep calls are recorded. */
const setup = async ({ now = "2026-11-11T12:00:00.000Z", appkeep = true } = {}) => {
  const sqlite = new Database(":memory:");
  for (const file of globSync("migrations/*.sql").sort()) sqlite.exec(readFileSync(file, "utf8"));
  const directory = mkdtempSync(join(tmpdir(), "ponder-automations-"));
  cleanups.push(() => {
    sqlite.close();
    rmSync(directory, { recursive: true, force: true });
  });
  for (const [id, name, email] of [["usr_ada", "Ada", "ada@example.com"], ["usr_grace", "Grace", "grace@example.com"]]) {
    sqlite.run("INSERT INTO users (id, username, password_hash, display_name, email) VALUES (?, ?, 'unused', ?, ?)", [id, id, name, email]);
    sqlite.run("INSERT INTO workspace_members (workspace_id, user_id, role) VALUES (?, ?, 'member')", [WS, id]);
  }
  const db = createSelfHostedStorageAdapter(sqlite, directory).db;
  const clock = { now: new Date(now) };
  const sent = [];
  const events = [];
  const wakes = [];
  const env = {
    db,
    sendEmail: async (message) => { sent.push(message); },
    emitEvent: async (name, data) => { events.push({ name, data }); },
    wakeAt: async (when) => { wakes.push(when); },
    emailDailyLimit: appkeep ? 200 : null,
    now: () => clock.now,
  };
  const tasks = await createDatabase(db, WS, { notebookId: "nb_inbox", title: "Tasks", schema: SCHEMA }, ada, "user:usr_ada");
  // Writes as a person: the change is handed to the engine, as the routes do after the response.
  const pending = [];
  const listener = { onRowChange: (change) => pending.push(change) };
  const settle = async () => {
    while (pending.length) await handleRowChange(env, pending.shift());
  };
  const addRow = async (input, databaseId = tasks.id) => {
    const row = await createDatabaseRow(db, WS, databaseId, input, ada, "user:usr_ada", listener);
    await settle();
    return getDatabaseRow(db, WS, databaseId, row.id);
  };
  const editRow = async (rowId, input) => {
    await updateDatabaseRow(db, WS, tasks.id, rowId, input, ada, "user:usr_ada", listener);
    await settle();
    return getDatabaseRow(db, WS, tasks.id, rowId);
  };
  const automate = (trigger, actions, extra = {}) => createAutomation(env, WS, tasks.id, { name: "Test", trigger, actions, ...extra }, "usr_ada");
  const runs = (automationId) => listAutomationRuns(db, WS, tasks.id, automationId ?? null);
  return { sqlite, db, env, clock, sent, events, wakes, tasks, addRow, editRow, automate, runs, listener, settle };
};

const markDone = { type: "edit_property", values: { status: "done" } };

describe("triggers", () => {
  test("page added runs for a new row", async () => {
    const t = await setup();
    const automation = await t.automate({ type: "page_added" }, [markDone]);
    const row = await t.addRow({ title: "Write post" });
    expect(row.properties.status).toBe("done");
    expect((await t.runs(automation.id)).map((run) => run.status)).toEqual(["success"]);
  });

  test("property edited runs on any change, and \"is set to\" only for that value", async () => {
    const t = await setup();
    const any = await t.automate({ type: "property_edited", propertyId: "note" }, [{ type: "add_comment", body: "Note changed" }]);
    const toDone = await t.automate({ type: "property_edited", propertyId: "status", to: "done" }, [{ type: "edit_property", values: { note: "Finished" } }]);
    const row = await t.addRow({ title: "Task" });
    await t.editRow(row.id, { properties: { status: "doing" } });
    expect((await t.runs(toDone.id)).length).toBe(0);
    const edited = await t.editRow(row.id, { properties: { status: "done" } });
    expect(edited.properties.note).toBe("Finished");
    expect((await t.runs(toDone.id)).length).toBe(1);
    // The automation's own edit to Note didn't set off the Note automation: the loop guard.
    expect((await t.runs(any.id)).length).toBe(0);
    await t.editRow(row.id, { properties: { note: "By hand" } });
    expect((await t.runs(any.id)).length).toBe(1);
    const comments = t.sqlite.query("SELECT body FROM memo_comments WHERE memo_id = ?").all(row.id);
    expect(comments.map((comment) => comment.body)).toEqual(["Note changed"]);
  });

  test("date reached fires through the cron at the trigger's time, once", async () => {
    const t = await setup({ now: "2026-11-11T12:00:00.000Z" });
    const automation = await t.automate(
      { type: "date_reached", propertyId: "due", offsetDays: 0, time: "09:00", timezone: "America/New_York" },
      [markDone],
    );
    const row = await t.addRow({ title: "Pay invoice", properties: { due: { start: "2026-11-12" } } });
    const stored = t.sqlite.query("SELECT next_run_at FROM database_automations WHERE id = ?").get(automation.id);
    expect(stored.next_run_at).toBe("2026-11-12T14:00:00.000Z");
    t.clock.now = new Date("2026-11-12T13:59:00.000Z");
    await runScheduledAutomations(t.env);
    expect((await getDatabaseRow(t.db, WS, t.tasks.id, row.id)).properties.status).toBeUndefined();
    t.clock.now = new Date("2026-11-12T14:05:00.000Z");
    await runScheduledAutomations(t.env);
    expect((await getDatabaseRow(t.db, WS, t.tasks.id, row.id)).properties.status).toBe("done");
    t.clock.now = new Date("2026-11-12T14:10:00.000Z");
    await runScheduledAutomations(t.env);
    expect((await t.runs(automation.id)).length).toBe(1);
  });

  test("a date moved sooner brings the next run forward", async () => {
    const t = await setup();
    const automation = await t.automate({ type: "date_reached", propertyId: "due", offsetDays: -1, time: "08:00", timezone: "UTC" }, [markDone]);
    const row = await t.addRow({ title: "Later", properties: { due: { start: "2026-12-20" } } });
    await t.editRow(row.id, { properties: { due: { start: "2026-11-20" } } });
    const stored = t.sqlite.query("SELECT next_run_at FROM database_automations WHERE id = ?").get(automation.id);
    expect(stored.next_run_at).toBe("2026-11-19T08:00:00.000Z");
  });

  test("every week runs on schedule with no page", async () => {
    const t = await setup({ now: "2026-11-11T12:00:00.000Z" }); // a Wednesday
    const automation = await t.automate(
      { type: "recurring", schedule: { unit: "week", interval: 1, weekdays: [1], time: "09:00", timezone: "UTC", startDate: "2026-11-11", end: { kind: "never" } } },
      [{ type: "add_page", databaseId: t.tasks.id, title: "Weekly review", values: { status: "todo" } }],
    );
    expect(automation.nextRunAt).toBe("2026-11-16T09:00:00.000Z");
    t.clock.now = new Date("2026-11-16T09:01:00.000Z");
    await runScheduledAutomations(t.env);
    const { rows } = await listDatabaseRows(t.db, WS, t.tasks.id, {});
    expect(rows.map((row) => row.title)).toEqual(["Weekly review"]);
    const next = t.sqlite.query("SELECT next_run_at FROM database_automations WHERE id = ?").get(automation.id);
    expect(next.next_run_at).toBe("2026-11-23T09:00:00.000Z");
  });

  test("\"Every…\" can't edit a page, because there is none", async () => {
    const t = await setup();
    const schedule = { unit: "day", interval: 1, time: "09:00", timezone: "UTC", startDate: "2026-11-12", end: { kind: "never" } };
    await expect(t.automate({ type: "recurring", schedule }, [markDone])).rejects.toThrow("needs a page");
  });

  test("a paused automation doesn't run", async () => {
    const t = await setup();
    const automation = await t.automate({ type: "page_added" }, [markDone]);
    await updateAutomation(t.env, WS, t.tasks.id, automation.id, { enabled: false });
    const row = await t.addRow({ title: "Quiet" });
    expect(row.properties.status).toBeUndefined();
  });
});

describe("actions", () => {
  test("edit property fills in today and placeholders", async () => {
    const t = await setup();
    await t.automate({ type: "page_added" }, [{ type: "edit_property", values: { due: { start: "@today" }, note: "Made" } }]);
    const row = await t.addRow({ title: "Dated" });
    expect(row.properties.due).toEqual({ start: "2026-11-11" });
  });

  test("\"today\" is the day where the person who made the change is", async () => {
    // 10 PM on Nov 11 in New York is already Nov 12 in UTC.
    const t = await setup({ now: "2026-11-12T03:00:00.000Z" });
    await t.automate({ type: "page_added" }, [{ type: "edit_property", values: { due: { start: "@today" } } }]);
    const pending = [];
    const row = await createDatabaseRow(t.db, WS, t.tasks.id, { title: "Evening" }, ada, "user:usr_ada", { onRowChange: (change) => pending.push(change) });
    await handleRowChange(t.env, pending.shift(), "America/New_York");
    expect((await getDatabaseRow(t.db, WS, t.tasks.id, row.id)).properties.due).toEqual({ start: "2026-11-11" });
  });

  test("add page to another database, with the trigger's values", async () => {
    const t = await setup();
    const log = await createDatabase(t.db, WS, { notebookId: "nb_inbox", title: "Log", schema: { properties: [{ id: "title", name: "Name", type: "title" }] } }, ada, "user:usr_ada");
    await t.automate({ type: "page_added" }, [{ type: "add_page", databaseId: log.id, title: "New task: {{Name}}", values: {} }]);
    await t.addRow({ title: "Ship it" });
    const { rows } = await listDatabaseRows(t.db, WS, log.id, {});
    expect(rows.map((row) => row.title)).toEqual(["New task: Ship it"]);
  });

  test("add comment writes on the page as the automation", async () => {
    const t = await setup();
    await t.automate({ type: "page_added" }, [{ type: "add_comment", body: "Welcome, {{Name}}" }], { name: "Greeter" });
    const row = await t.addRow({ title: "Hello" });
    const comment = t.sqlite.query("SELECT body, author_name FROM memo_comments WHERE memo_id = ?").get(row.id);
    expect(comment.body).toBe("Welcome, Hello");
    expect(comment.author_name).toBe("Greeter");
  });

  test("send notification reaches people, and the person in a property", async () => {
    const t = await setup();
    await t.automate({ type: "page_added" }, [
      { type: "send_notification", recipients: { kind: "people", userIds: ["usr_grace"] }, message: "{{Name}} was added" },
      { type: "send_notification", recipients: { kind: "property", propertyId: "owner" }, message: "" },
    ]);
    const row = await t.addRow({ title: "Review", properties: { owner: ["usr_ada"] } });
    const notes = t.sqlite.query("SELECT recipient_id, kind, memo_id, excerpt FROM notifications ORDER BY recipient_id").all();
    expect(notes).toEqual([
      { recipient_id: "usr_ada", kind: "automation", memo_id: row.id, excerpt: "About Review" },
      { recipient_id: "usr_grace", kind: "automation", memo_id: row.id, excerpt: "Review was added" },
    ]);
  });

  test("send mail goes to addresses, people and an email property, and is counted", async () => {
    const t = await setup();
    await t.automate({ type: "page_added" }, [
      { type: "send_mail", to: { kind: "emails", emails: ["ops@example.com"] }, subject: "New: {{Name}}", body: "Due {{Due}}" },
      { type: "send_mail", to: { kind: "property", propertyId: "owner" }, subject: "Yours", body: "" },
      { type: "send_mail", to: { kind: "property", propertyId: "mail" }, subject: "Client", body: "" },
    ]);
    await t.addRow({ title: "Order", properties: { owner: ["usr_grace"], mail: "client@example.com", due: { start: "2026-11-20" } } });
    expect(t.sent.map((mail) => [mail.to, mail.subject, mail.text])).toEqual([
      ["ops@example.com", "New: Order", "Due 2026-11-20"],
      ["grace@example.com", "Yours", "Yours"],
      ["client@example.com", "Client", "Client"],
    ]);
    expect(await emailUsage(t.env)).toEqual({ sent: 3, limit: 200, available: true });
  });

  test("send mail to people Ponder has no address for fails the run instead of sending nothing quietly", async () => {
    const t = await setup();
    t.sqlite.run("UPDATE users SET email = NULL WHERE id = 'usr_grace'");
    const automation = await t.automate({ type: "page_added" }, [{ type: "send_mail", to: { kind: "property", propertyId: "owner" }, subject: "Yours", body: "" }]);
    await t.addRow({ title: "Orphan", properties: { owner: ["usr_grace"] } });
    expect(t.sent).toEqual([]);
    // An empty person property still sends nothing, without an error.
    await t.addRow({ title: "Nobody" });
    const runs = Object.fromEntries((await t.runs(automation.id)).map((run) => [run.rowTitle, run]));
    expect(runs.Orphan.status).toBe("error");
    expect(runs.Orphan.error).toContain("no email address");
    expect(runs.Nobody.status).toBe("success");
  });

  test("the 200-a-day mail limit stops sending with a clear error in the run log", async () => {
    const t = await setup();
    t.sqlite.run("INSERT INTO automation_email_days (day, sent) VALUES ('2026-11-11', 200)");
    const automation = await t.automate({ type: "page_added" }, [{ type: "send_mail", to: { kind: "emails", emails: ["ops@example.com"] }, subject: "Hi", body: "" }]);
    await t.addRow({ title: "Over" });
    expect(t.sent).toEqual([]);
    const [run] = await t.runs(automation.id);
    expect(run.status).toBe("error");
    expect(run.error).toContain("at most 200 emails a day");
    // A new day starts again.
    t.clock.now = new Date("2026-11-12T00:30:00.000Z");
    await t.addRow({ title: "Next day" });
    expect(t.sent.length).toBe(1);
  });

  test("an error from AppKeep's mail is logged on the run", async () => {
    const t = await setup();
    t.env.sendEmail = async () => { throw new Error("This app has sent 200 emails in the last 24 hours, the most allowed."); };
    const automation = await t.automate({ type: "page_added" }, [{ type: "send_mail", to: { kind: "emails", emails: ["a@example.com"] }, subject: "Hi", body: "" }]);
    await t.addRow({ title: "Refused" });
    const [run] = await t.runs(automation.id);
    expect(run.error).toBe("The mail to a@example.com wasn't sent: This app has sent 200 emails in the last 24 hours, the most allowed.");
  });

  test("send webhook emits an \"automation\" event with the page's values as words", async () => {
    const t = await setup();
    await t.automate({ type: "page_added" }, [{ type: "send_webhook" }], { name: "To Slack" });
    await t.addRow({ title: "Deal", properties: { status: "doing", owner: ["usr_ada"] } });
    expect(t.events.length).toBe(1);
    expect(t.events[0].name).toBe("automation");
    expect(t.events[0].data.automation.name).toBe("To Slack");
    expect(t.events[0].data.properties).toMatchObject({ Name: "Deal", Status: "In progress", Owner: "Ada" });
    expect(JSON.stringify(t.events[0].data).length).toBeLessThan(16_000);
  });

  test("webhooks need AppKeep, and say so", async () => {
    const t = await setup();
    t.env.emitEvent = undefined;
    const automation = await t.automate({ type: "page_added" }, [{ type: "send_webhook" }]);
    await t.addRow({ title: "Local" });
    expect((await t.runs(automation.id))[0].error).toContain("AppKeep");
  });

  test("a failed action stops the ones after it", async () => {
    const t = await setup();
    t.env.emitEvent = undefined;
    await t.automate({ type: "page_added" }, [{ type: "send_webhook" }, markDone]);
    const row = await t.addRow({ title: "Stops" });
    expect(row.properties.status).toBeUndefined();
  });
});

describe("guards", () => {
  test("automations never trigger automations, even in a cycle", async () => {
    const t = await setup();
    const a = await t.automate({ type: "property_edited", propertyId: "status" }, [{ type: "edit_property", values: { note: "ping" } }]);
    const b = await t.automate({ type: "property_edited", propertyId: "note" }, [{ type: "edit_property", values: { status: "todo" } }]);
    const row = await t.addRow({ title: "Cycle" });
    await t.editRow(row.id, { properties: { status: "doing" } });
    expect((await t.runs(a.id)).length).toBe(1);
    expect((await t.runs(b.id)).length).toBe(0);
  });

  test(`an automation runs at most ${AUTOMATION_RUNS_PER_MINUTE} times a minute; the rest are logged as skipped`, async () => {
    const t = await setup();
    const automation = await t.automate({ type: "page_added" }, [{ type: "edit_property", values: { note: "seen" } }]);
    const insert = t.sqlite.query("INSERT INTO automation_runs (id, workspace_id, automation_id, row_id, status, error, started_at) VALUES (?, ?, ?, NULL, 'success', NULL, ?)");
    for (let i = 0; i < AUTOMATION_RUNS_PER_MINUTE; i += 1) insert.run(`run_${i}`, WS, automation.id, "2026-11-11T11:59:30.000Z");
    const row = await t.addRow({ title: "One too many" });
    expect(row.properties.note).toBeUndefined();
    const [latest] = await t.runs(automation.id);
    expect(latest.status).toBe("skipped");
    t.clock.now = new Date("2026-11-11T12:01:00.000Z");
    expect((await t.addRow({ title: "Later" })).properties.note).toBe("seen");
  });

  test("runs older than 30 days are cleared", async () => {
    const t = await setup();
    const automation = await t.automate({ type: "page_added" }, [markDone]);
    t.sqlite.run("INSERT INTO automation_runs (id, workspace_id, automation_id, status, started_at) VALUES ('old', ?, ?, 'success', '2026-10-01T00:00:00.000Z')", [WS, automation.id]);
    await runScheduledAutomations(t.env);
    expect(t.sqlite.query("SELECT COUNT(*) AS n FROM automation_runs WHERE id = 'old'").get().n).toBe(0);
  });
});

describe("waking", () => {
  test("an idle copy tells AppKeep it has nothing scheduled", async () => {
    const t = await setup();
    await runScheduledAutomations(t.env);
    expect(t.wakes).toEqual([null]);
  });

  test("it asks to wake at the earliest automation or repeating template", async () => {
    const t = await setup({ now: "2026-11-11T12:00:00.000Z" });
    const schedule = { unit: "day", interval: 1, time: "18:00", timezone: "UTC", startDate: "2026-11-11", end: { kind: "never" } };
    await t.automate({ type: "recurring", schedule }, [{ type: "add_page", databaseId: t.tasks.id, title: "Daily", values: {} }]);
    expect(t.wakes.at(-1)?.toISOString()).toBe("2026-11-11T18:00:00.000Z");
    const template = await createDatabaseTemplate(t.db, WS, t.tasks.id, { name: "Standup" });
    await updateDatabaseTemplate(t.db, WS, t.tasks.id, template.id, { repeat: { ...schedule, time: "15:00" } }, t.clock.now);
    await refreshWake(t.env);
    expect(t.wakes.at(-1)?.toISOString()).toBe("2026-11-11T15:00:00.000Z");
  });

  test("a deleted automation's wake is dropped", async () => {
    const t = await setup();
    const schedule = { unit: "day", interval: 1, time: "18:00", timezone: "UTC", startDate: "2026-11-11", end: { kind: "never" } };
    const automation = await t.automate({ type: "recurring", schedule }, [{ type: "add_page", databaseId: t.tasks.id, title: "Daily", values: {} }]);
    await updateAutomation(t.env, WS, t.tasks.id, automation.id, { enabled: false });
    expect(t.wakes.at(-1)).toBeNull();
  });
});

describe("repeating templates", () => {
  test("a weekly template makes a page on schedule, which counts as a page added", async () => {
    const t = await setup({ now: "2026-11-11T12:00:00.000Z" });
    const template = await createDatabaseTemplate(t.db, WS, t.tasks.id, { name: "Standup", title: "Standup notes", properties: { status: "todo" } });
    const repeat = { unit: "week", interval: 1, weekdays: [1, 4], time: null, timezone: "UTC", startDate: "2026-11-12", end: { kind: "runs", count: 2 } };
    const saved = await updateDatabaseTemplate(t.db, WS, t.tasks.id, template.id, { repeat }, t.clock.now);
    expect(saved.repeat).toEqual(repeat);
    expect(saved.repeatNextAt).toBe("2026-11-12T00:00:00.000Z");
    const welcome = await t.automate({ type: "page_added" }, [{ type: "edit_property", values: { note: "auto" } }]);
    t.clock.now = new Date("2026-11-12T00:05:00.000Z");
    await runScheduledAutomations(t.env);
    let { rows } = await listDatabaseRows(t.db, WS, t.tasks.id, {});
    expect(rows.map((row) => [row.title, row.properties.status, row.properties.note])).toEqual([["Standup notes", "todo", "auto"]]);
    expect((await t.runs(welcome.id)).length).toBe(1);
    expect(t.sqlite.query("SELECT repeat_next_at FROM database_templates WHERE id = ?").get(template.id).repeat_next_at).toBe("2026-11-16T00:00:00.000Z");
    t.clock.now = new Date("2026-11-16T00:05:00.000Z");
    await runScheduledAutomations(t.env);
    ({ rows } = await listDatabaseRows(t.db, WS, t.tasks.id, {}));
    expect(rows.length).toBe(2);
    // Two runs was the end.
    expect(t.sqlite.query("SELECT repeat_next_at FROM database_templates WHERE id = ?").get(template.id).repeat_next_at).toBeNull();
    expect(t.wakes.at(-1)).toBeNull();
  });

  test("cancelling the repeat clears its schedule", async () => {
    const t = await setup();
    const template = await createDatabaseTemplate(t.db, WS, t.tasks.id, { name: "Daily" });
    await updateDatabaseTemplate(t.db, WS, t.tasks.id, template.id, { repeat: { unit: "day", interval: 1, time: "09:00", timezone: "UTC", startDate: "2026-11-12", end: { kind: "never" } } }, t.clock.now);
    const cleared = await updateDatabaseTemplate(t.db, WS, t.tasks.id, template.id, { repeat: null });
    expect([cleared.repeat, cleared.repeatNextAt]).toEqual([null, null]);
  });
});

describe("buttons", () => {
  test("a click runs as the person, and its edits do set off automations", async () => {
    const t = await setup();
    const automation = await t.automate({ type: "property_edited", propertyId: "status", to: "done" }, [{ type: "add_comment", body: "Closed" }]);
    const row = await t.addRow({ title: "Clicky" });
    const database = (await import("./database-service.ts")).getDatabase;
    const outcome = await runButton(t.env, {
      workspaceId: WS,
      actions: [{ type: "show_confirmation", message: "Sure?" }, markDone, { type: "add_page", databaseId: t.tasks.id, title: "Follow-up", values: {} }],
      database: await database(t.db, WS, t.tasks.id),
      row,
      pageId: row.id,
      actor: ada,
      actorLabel: "user:usr_ada",
      authorName: "Ada",
      timeZone: "UTC",
      writeOptions: t.listener,
    });
    await t.settle();
    expect(outcome).toMatchObject({ createdPages: 1, editedPages: 1 });
    expect((await getDatabaseRow(t.db, WS, t.tasks.id, row.id)).updatedBy).toBe("usr_ada");
    expect((await t.runs(automation.id)).length).toBe(1);
  });

  test("an invalid button says what's wrong", async () => {
    const t = await setup();
    await expect(runButton(t.env, {
      workspaceId: WS, actions: [{ type: "send_notification", recipients: { kind: "people", userIds: [] }, message: "" }],
      database: null, row: null, pageId: null, actor: ada, actorLabel: "user:usr_ada", authorName: "Ada", timeZone: "UTC", writeOptions: {},
    })).rejects.toThrow("Choose who to notify.");
  });
});

describe("page backup", () => {
  test("keeps automations and template repeats, and a restore schedules them again", async () => {
    const { readPageBackup, restorePageBackup } = await import("./page-backup.ts");
    const t = await setup();
    const schedule = { unit: "day", interval: 1, time: "18:00", timezone: "UTC", startDate: "2026-11-11", end: { kind: "never" } };
    const automation = await t.automate({ type: "recurring", schedule }, [{ type: "add_page", databaseId: t.tasks.id, title: "Daily", values: {} }], { name: "Daily page" });
    const template = await createDatabaseTemplate(t.db, WS, t.tasks.id, { name: "Standup" });
    await updateDatabaseTemplate(t.db, WS, t.tasks.id, template.id, { repeat: schedule }, t.clock.now);
    const backup = await readPageBackup(t.db, WS);
    expect(backup.automations).toMatchObject([{ id: automation.id, name: "Daily page", enabled: true, trigger: { type: "recurring" } }]);
    expect(backup.templates.find((item) => item.id === template.id).repeat).toEqual(schedule);
    // Restoring over the same workspace is a no-op apart from the schedule starting again.
    t.sqlite.run("UPDATE database_automations SET next_run_at = NULL");
    await restorePageBackup(t.db, WS, { pages: [], databases: [], views: [], comments: [], templates: backup.templates, automations: backup.automations });
    expect(t.sqlite.query("SELECT next_run_at FROM database_automations WHERE id = ?").get(automation.id).next_run_at).not.toBeNull();
    // A damaged automation in a backup is skipped, not restored.
    await restorePageBackup(t.db, WS, { pages: [], databases: [], views: [], comments: [], templates: [], automations: [{ ...backup.automations[0], id: "dba_bad", trigger: { type: "nope" } }] });
    expect(t.sqlite.query("SELECT COUNT(*) AS n FROM database_automations WHERE id = 'dba_bad'").get().n).toBe(0);
  });
});
