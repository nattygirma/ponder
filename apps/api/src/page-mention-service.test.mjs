import { afterEach, describe, expect, test } from "bun:test";
import { Database } from "bun:sqlite";
import { globSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { listNotifications } from "./comment-service.ts";
import { createMemoRecord, updateMemoRecord } from "./memo-service.ts";
import { nextReminderAt, runDueReminders } from "./page-mention-service.ts";
import { createSelfHostedStorageAdapter } from "./self-hosted-storage-adapter.ts";

// Mentions in page content: Inbox notices for people and reminders for dates, against the real migrations.
const WORKSPACE_ID = "ws_default";
const cleanups = [];
afterEach(() => cleanups.splice(0).forEach((cleanup) => cleanup()));

const setup = async () => {
  const sqlite = new Database(":memory:");
  for (const file of globSync("migrations/*.sql").sort()) sqlite.exec(readFileSync(file, "utf8"));
  const directory = mkdtempSync(join(tmpdir(), "ponder-page-mentions-"));
  cleanups.push(() => {
    sqlite.close();
    rmSync(directory, { recursive: true, force: true });
  });
  for (const [id, name] of [["usr_ana", "Ana"], ["usr_ben", "Ben"]]) {
    sqlite.run("INSERT INTO users (id, username, password_hash, display_name) VALUES (?, ?, 'unused', ?)", [id, id, name]);
    sqlite.run("INSERT INTO workspace_members (workspace_id, user_id, role) VALUES (?, ?, 'member')", [WORKSPACE_ID, id]);
  }
  // Someone outside the workspace.
  sqlite.run("INSERT INTO users (id, username, password_hash, display_name) VALUES ('usr_out', 'usr_out', 'unused', 'Out')");
  const db = createSelfHostedStorageAdapter(sqlite, directory).db;
  const page = await createMemoRecord(db, WORKSPACE_ID, { notebookId: "nb_inbox", title: "Roadmap" }, { actorType: "user", actorId: "usr_ana" }, "user:usr_ana");
  return { db, page, sqlite };
};

const mention = (attrs) => ({ type: "ponderMention", attrs });
const doc = (...inline) => ({ type: "doc", content: [{ type: "paragraph", content: inline }] });
const text = (value) => ({ type: "text", text: value });
const save = (db, page, contentJson, actorId = "usr_ana") =>
  updateMemoRecord(db, WORKSPACE_ID, page.id, { contentJson }, { actorType: "user", actorId }, "Label");
const inbox = async (db, userId) => (await listNotifications(db, userId, WORKSPACE_ID)).notifications.map((item) => [item.kind, item.actorName, item.excerpt]);
const reminder = (at, id = "rmd_1", by = "usr_ben") => mention({ kind: "date", date: "2030-01-02", remind: "onDayOfEvent", remindAt: at, reminderId: id, remindedBy: by });

describe("person mentions", () => {
  test("tell a newly mentioned member once, with the line they're in", async () => {
    const { db, page } = await setup();
    const ben = mention({ kind: "person", id: "usr_ben", label: "Ben" });
    await save(db, page, doc(text("Ask "), ben, text(" about it")));
    expect(await inbox(db, "usr_ben")).toEqual([["mention", "Ana", "Ask @Ben about it"]]);
    // Saving again, or editing around the mention, doesn't repeat it.
    await save(db, page, doc(text("Please ask "), ben, text(" about it")));
    expect(await inbox(db, "usr_ben")).toHaveLength(1);
  });

  test("never tell the person who wrote it, or anyone outside the workspace", async () => {
    const { db, page } = await setup();
    await save(db, page, doc(mention({ kind: "person", id: "usr_ana", label: "Ana" }), mention({ kind: "person", id: "usr_out", label: "Out" })));
    expect(await inbox(db, "usr_ana")).toEqual([]);
    expect(await inbox(db, "usr_out")).toEqual([]);
  });

  test("arrive from Markdown written by AI or MCP tools", async () => {
    const { db, page } = await setup();
    await updateMemoRecord(db, WORKSPACE_ID, page.id, { contentMarkdown: "Hi [@Ben](ponder:person/usr_ben)" }, { actorType: "user", actorId: "usr_ana" }, "Ana");
    expect((await inbox(db, "usr_ben")).map((item) => item[0])).toEqual(["mention"]);
  });
});

describe("date reminders", () => {
  test("wait in page_reminders, then go to the setter's Inbox when due, once", async () => {
    const { db, page, sqlite } = await setup();
    const at = new Date(Date.now() + 3_600_000).toISOString();
    const result = await save(db, page, doc(text("Launch "), reminder(at)));
    expect(result.remindersChanged).toBe(true);
    expect(await nextReminderAt(db)).toBe(at);
    expect((await runDueReminders(db, new Date())).sent).toBe(0);
    expect((await runDueReminders(db, new Date(Date.parse(at) + 1000))).sent).toBe(1);
    expect(await inbox(db, "usr_ben")).toEqual([["reminder", "", "Launch @January 2, 2030"]]);
    expect((await runDueReminders(db, new Date(Date.parse(at) + 2000))).sent).toBe(0);
    expect(await nextReminderAt(db)).toBeNull();
    expect(sqlite.query("SELECT COUNT(*) AS n FROM page_reminders").get().n).toBe(1);
  });

  test("follow the page: moved reminders fire again, removed ones stop", async () => {
    const { db, page } = await setup();
    const first = new Date(Date.now() + 3_600_000).toISOString();
    const later = new Date(Date.now() + 7_200_000).toISOString();
    await save(db, page, doc(reminder(first)));
    const unchanged = await save(db, page, doc(text("x"), reminder(first)));
    expect(unchanged.remindersChanged).toBe(false);
    await save(db, page, doc(reminder(later)));
    expect(await nextReminderAt(db)).toBe(later);
    await save(db, page, doc(text("gone")));
    expect(await nextReminderAt(db)).toBeNull();
  });

  test("go to the saver when the setter isn't a member, and skip times long past", async () => {
    const { db, page } = await setup();
    const at = new Date(Date.now() + 60_000).toISOString();
    await save(db, page, doc(reminder(at, "rmd_a", "usr_out"), reminder(new Date(Date.now() - 3_600_000).toISOString(), "rmd_b")));
    await runDueReminders(db, new Date(Date.now() + 120_000));
    expect((await inbox(db, "usr_ana")).map((item) => item[0])).toEqual(["reminder"]);
    expect(await inbox(db, "usr_ben")).toEqual([]);
  });

  test("in a deleted page are dropped without a notice", async () => {
    const { db, page, sqlite } = await setup();
    const at = new Date(Date.now() + 60_000).toISOString();
    await save(db, page, doc(reminder(at)));
    sqlite.run("UPDATE memos SET is_deleted = 1 WHERE id = ?", [page.id]);
    expect((await runDueReminders(db, new Date(Date.now() + 120_000))).due).toBe(1);
    expect(await inbox(db, "usr_ben")).toEqual([]);
    expect(await nextReminderAt(db)).toBeNull();
  });
});
