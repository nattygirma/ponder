import { afterEach, describe, expect, test } from "bun:test";
import { Database } from "bun:sqlite";
import { globSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createMemoComment, listNotifications } from "./comment-service.ts";
import { createMemoRecord } from "./memo-service.ts";
import {
  getPageAnalytics, getPageSubscription, notifyPageEdit, recordPageView, setPageSubscription,
} from "./page-activity-service.ts";
import { createSelfHostedStorageAdapter } from "./self-hosted-storage-adapter.ts";

// Notify me and page analytics, against the real migrations.
const WORKSPACE_ID = "ws_default";
const userAuth = (id, name) => ({
  kind: "user", actorType: "user", actorId: id, username: id, displayName: name, scopes: [], workspaceId: WORKSPACE_ID, role: "owner",
});
const cleanups = [];
afterEach(() => cleanups.splice(0).forEach((cleanup) => cleanup()));

const setup = async () => {
  const sqlite = new Database(":memory:");
  for (const file of globSync("migrations/*.sql").sort()) sqlite.exec(readFileSync(file, "utf8"));
  const directory = mkdtempSync(join(tmpdir(), "ponder-page-activity-"));
  cleanups.push(() => {
    sqlite.close();
    rmSync(directory, { recursive: true, force: true });
  });
  for (const [id, name] of [["usr_ana", "Ana"], ["usr_ben", "Ben"], ["usr_cy", "Cy"]]) {
    sqlite.run("INSERT INTO users (id, username, password_hash, display_name) VALUES (?, ?, 'unused', ?)", [id, id, name]);
    sqlite.run("INSERT INTO workspace_members (workspace_id, user_id, role) VALUES (?, ?, 'member')", [WORKSPACE_ID, id]);
  }
  const db = createSelfHostedStorageAdapter(sqlite, directory).db;
  const page = await createMemoRecord(db, WORKSPACE_ID, { notebookId: "nb_inbox", title: "Roadmap" }, { actorType: "user", actorId: "usr_ana" }, "user:usr_ana");
  return { db, page };
};

const kinds = async (db, userId) => (await listNotifications(db, userId, WORKSPACE_ID)).notifications.map((item) => [item.kind, item.actorName]);

describe("Notify me", () => {
  test("is replies and mentions by default, and can be changed and reset", async () => {
    const { db, page } = await setup();
    expect(await getPageSubscription(db, WORKSPACE_ID, page.id, "usr_ben")).toBe("default");
    await setPageSubscription(db, WORKSPACE_ID, page.id, "usr_ben", "all");
    expect(await getPageSubscription(db, WORKSPACE_ID, page.id, "usr_ben")).toBe("all");
    await setPageSubscription(db, WORKSPACE_ID, page.id, "usr_ben", "comments");
    expect(await getPageSubscription(db, WORKSPACE_ID, page.id, "usr_ben")).toBe("comments");
    await setPageSubscription(db, WORKSPACE_ID, page.id, "usr_ben", "default");
    expect(await getPageSubscription(db, WORKSPACE_ID, page.id, "usr_ben")).toBe("default");
  });

  test("followers of comments hear about every comment, but not their own", async () => {
    const { db, page } = await setup();
    await setPageSubscription(db, WORKSPACE_ID, page.id, "usr_ben", "comments");
    await setPageSubscription(db, WORKSPACE_ID, page.id, "usr_ana", "all");
    await createMemoComment(db, WORKSPACE_ID, page.id, { body: "Ship it" }, userAuth("usr_ana", "Ana"));
    expect(await kinds(db, "usr_ben")).toEqual([["comment", "Ana"]]);
    expect(await kinds(db, "usr_ana")).toEqual([]);
    expect(await kinds(db, "usr_cy")).toEqual([]);
  });

  test("a mention to a follower stays a mention", async () => {
    const { db, page } = await setup();
    await setPageSubscription(db, WORKSPACE_ID, page.id, "usr_ben", "comments");
    await createMemoComment(db, WORKSPACE_ID, page.id, { body: "@Ben look", mentions: ["usr_ben"] }, userAuth("usr_ana", "Ana"));
    expect(await kinds(db, "usr_ben")).toEqual([["mention", "Ana"]]);
  });

  test("edits reach only people following all updates, once until they read it", async () => {
    const { db, page } = await setup();
    await setPageSubscription(db, WORKSPACE_ID, page.id, "usr_ben", "all");
    await setPageSubscription(db, WORKSPACE_ID, page.id, "usr_cy", "comments");
    await notifyPageEdit(db, WORKSPACE_ID, page.id, "usr_ana", "Ana");
    await notifyPageEdit(db, WORKSPACE_ID, page.id, "usr_ana", "Ana");
    await notifyPageEdit(db, WORKSPACE_ID, page.id, "usr_ben", "Ben");
    expect(await kinds(db, "usr_ben")).toEqual([["edit", "Ana"]]);
    expect(await kinds(db, "usr_cy")).toEqual([]);

    await db.prepare("UPDATE notifications SET read_at = ? WHERE recipient_id = ?").bind(new Date().toISOString(), "usr_ben").run();
    await notifyPageEdit(db, WORKSPACE_ID, page.id, "usr_ana", "Ana");
    expect((await kinds(db, "usr_ben")).length).toBe(2);
  });

  test("a page in another workspace or in Trash can't be followed", async () => {
    const { db, page } = await setup();
    await expect(setPageSubscription(db, "ws_other", page.id, "usr_ben", "all")).rejects.toThrow("Page not found");
    await db.prepare("UPDATE memos SET is_deleted = 1 WHERE id = ?").bind(page.id).run();
    await expect(setPageSubscription(db, WORKSPACE_ID, page.id, "usr_ben", "all")).rejects.toThrow("Page not found");
  });
});

describe("page analytics", () => {
  test("counts views per day and distinct viewers, newest viewer first", async () => {
    const { db, page } = await setup();
    await recordPageView(db, WORKSPACE_ID, page.id, "usr_ben");
    await recordPageView(db, WORKSPACE_ID, page.id, "usr_ben");
    await recordPageView(db, WORKSPACE_ID, page.id, "usr_cy");
    // An old view outside the 28-day window doesn't count.
    await db.prepare("INSERT INTO page_views (workspace_id, memo_id, user_id, day, views, last_viewed_at) VALUES (?, ?, ?, '2000-01-01', 9, '2000-01-01T00:00:00.000Z')")
      .bind(WORKSPACE_ID, page.id, "usr_ana").run();

    const analytics = await getPageAnalytics(db, WORKSPACE_ID, page.id);
    expect(analytics.totalViews).toBe(3);
    expect(analytics.uniqueViewers).toBe(2);
    expect(analytics.daily).toHaveLength(28);
    expect(analytics.daily.at(-1)).toMatchObject({ views: 3, viewers: 2 });
    expect(analytics.viewers.map((viewer) => [viewer.name, viewer.views])).toEqual([["Cy", 1], ["Ben", 2]]);
    expect(await db.prepare("SELECT COUNT(*) AS n FROM page_views WHERE memo_id = ? AND user_id = 'usr_ben'").bind(page.id).first()).toEqual({ n: 1 });
  });

  test("lists saved versions with who made them", async () => {
    const { db, page } = await setup();
    // A save snapshots the version it replaces, labelled with whoever saved (getActorLabel's "user:<id>").
    for (const [revision, by] of [[1, "system"], [2, "user:usr_ben"]]) {
      await db.prepare(
        `INSERT INTO memo_revisions (id, memo_id, revision, title, content_json, content_hash, created_by, created_at)
         VALUES (?, ?, ?, 'Roadmap', '{}', 'h', ?, ?)`,
      ).bind(`rev_${revision}`, page.id, revision, by, new Date(Date.UTC(2026, 0, revision)).toISOString()).run();
    }
    const analytics = await getPageAnalytics(db, WORKSPACE_ID, page.id);
    expect(analytics.updates.map((update) => [update.name, update.system])).toEqual([["Ben", false], [null, true]]);
    expect(analytics.createdAt).toBe(page.createdAt);
  });

  test("another workspace's page has no analytics", async () => {
    const { db, page } = await setup();
    await expect(getPageAnalytics(db, "ws_other", page.id)).rejects.toThrow("Page not found");
    await expect(recordPageView(db, "ws_other", page.id, "usr_ben")).rejects.toThrow("Page not found");
  });
});
