import { afterEach, describe, expect, test } from "bun:test";
import { Database } from "bun:sqlite";
import { globSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DATABASE_TEMPLATE_LIMIT } from "@ponder/shared";
import {
  createDatabase,
  createDatabaseRow,
  createDatabaseTemplate,
  deleteDatabaseTemplate,
  getDatabase,
  listDatabaseRows,
  updateDatabase,
  updateDatabaseRow,
  updateDatabaseTemplate,
} from "./database-service.ts";
import { getMemoDetail } from "./memo-service.ts";
import { createSelfHostedStorageAdapter } from "./self-hosted-storage-adapter.ts";

const WORKSPACE_ID = "ws_default";
const ada = { actorType: "user", actorId: "usr_ada" };
const grace = { actorType: "user", actorId: "usr_grace" };
const cleanups = [];
afterEach(() => cleanups.splice(0).forEach((cleanup) => cleanup()));

const installation = (migrations = globSync("migrations/*.sql").sort()) => {
  const sqlite = new Database(":memory:");
  for (const file of migrations) sqlite.exec(readFileSync(file, "utf8"));
  const directory = mkdtempSync(join(tmpdir(), "ponder-db-phase1-"));
  cleanups.push(() => {
    sqlite.close();
    rmSync(directory, { recursive: true, force: true });
  });
  return { sqlite, db: createSelfHostedStorageAdapter(sqlite, directory).db };
};

const newDatabase = (db) => createDatabase(db, WORKSPACE_ID, { notebookId: "nb_inbox", title: "Tasks" }, ada, "user:usr_ada");

describe("row numbers", () => {
  test("count up per database and are never handed out twice, even after a delete", async () => {
    const { db, sqlite } = installation();
    const tasks = await newDatabase(db);
    const other = await newDatabase(db);
    const first = await createDatabaseRow(db, WORKSPACE_ID, tasks.id, { title: "One" }, ada, "user:usr_ada");
    const second = await createDatabaseRow(db, WORKSPACE_ID, tasks.id, { title: "Two" }, ada, "user:usr_ada");
    const elsewhere = await createDatabaseRow(db, WORKSPACE_ID, other.id, { title: "Other" }, ada, "user:usr_ada");
    expect([first.number, second.number, elsewhere.number]).toEqual([1, 2, 1]);
    sqlite.query("UPDATE memos SET is_deleted = 1 WHERE id = ?").run(second.id);
    const third = await createDatabaseRow(db, WORKSPACE_ID, tasks.id, { title: "Three" }, ada, "user:usr_ada");
    expect(third.number).toBe(3);
  });

  test("the migration numbers rows that already exist, in the order they were made", () => {
    const all = globSync("migrations/*.sql").sort();
    // Everything up to 0096: later migrations (0098 onward) build on what 0097 adds.
    const before = all.filter((file) => /\/0(0[0-8]\d|09[0-6])_/.test(file));
    const { sqlite } = installation(before);
    const insert = sqlite.query(
      `INSERT INTO memos (id, workspace_id, notebook_id, title, excerpt, tags_json, created_by, updated_by, created_at, updated_at, database_id)
       VALUES (?, ?, 'nb_inbox', ?, '', '[]', 'user', 'user', ?, ?, ?)`,
    );
    sqlite.query(`INSERT INTO databases (id, workspace_id, page_memo_id, schema_json, created_at, updated_at) VALUES ('db_a', ?, 'page_a', '{}', 'x', 'x')`).run(WORKSPACE_ID);
    insert.run("m_late", WORKSPACE_ID, "Late", "2026-02-01T00:00:00Z", "2026-02-01T00:00:00Z", "db_a");
    insert.run("m_early", WORKSPACE_ID, "Early", "2026-01-01T00:00:00Z", "2026-01-01T00:00:00Z", "db_a");
    insert.run("m_page", WORKSPACE_ID, "Plain page", "2026-01-01T00:00:00Z", "2026-01-01T00:00:00Z", null);
    sqlite.exec(readFileSync(all.find((file) => file.includes("0097_")), "utf8"));
    const numbers = Object.fromEntries(sqlite.query("SELECT id, row_number FROM memos WHERE id IN ('m_early', 'm_late', 'm_page')").all().map((row) => [row.id, row.row_number]));
    expect(numbers).toEqual({ m_early: 1, m_late: 2, m_page: null });
    expect(sqlite.query("SELECT next_row_number FROM databases WHERE id = 'db_a'").get().next_row_number).toBe(3);
  });
});

describe("who made and changed a row", () => {
  test("comes from the person behind each write", async () => {
    const { db } = installation();
    const tasks = await newDatabase(db);
    const row = await createDatabaseRow(db, WORKSPACE_ID, tasks.id, { title: "One" }, ada, "user:usr_ada");
    expect([row.createdBy, row.updatedBy]).toEqual(["usr_ada", "usr_ada"]);
    const status = tasks.schema.properties.find((property) => property.type === "status");
    const edited = await updateDatabaseRow(db, WORKSPACE_ID, tasks.id, row.id, { properties: { [status.id]: status.options[1].id } }, grace, "user:usr_grace");
    expect([edited.createdBy, edited.updatedBy]).toEqual(["usr_ada", "usr_grace"]);
    const viaToken = await createDatabaseRow(db, WORKSPACE_ID, tasks.id, { title: "Two" }, { actorType: "agent", actorId: "agt_1" }, "agent:agt_1");
    expect(viaToken.createdBy).toBeNull();
  });

  test("computed values sent by a client are not stored", async () => {
    const { db } = installation();
    const tasks = await newDatabase(db);
    const schema = { properties: [...tasks.schema.properties, { id: "cb", name: "Created by", type: "created_by" }, { id: "num", name: "ID", type: "unique_id" }] };
    await updateDatabase(db, WORKSPACE_ID, tasks.id, { schema }, ada, "user:usr_ada");
    const row = await createDatabaseRow(db, WORKSPACE_ID, tasks.id, { properties: { cb: ["usr_grace"], num: 99 } }, ada, "user:usr_ada");
    expect(row.properties).toEqual({});
  });
});

describe("templates", () => {
  test("a row made from a template gets its title, icon, values and page body", async () => {
    const { db } = installation();
    const tasks = await newDatabase(db);
    const status = tasks.schema.properties.find((property) => property.type === "status");
    const template = await createDatabaseTemplate(db, WORKSPACE_ID, tasks.id, {
      name: "Bug report",
      icon: "🐞",
      title: "Bug: ",
      properties: { [status.id]: status.options[1].id, unknown_property: "dropped" },
      content: "## Steps to reproduce\n\n1. ",
    });
    expect(template.properties).toEqual({ [status.id]: status.options[1].id });

    const row = await createDatabaseRow(db, WORKSPACE_ID, tasks.id, { templateId: template.id }, ada, "user:usr_ada");
    expect(row.title).toBe("Bug:");
    expect(row.icon).toBe("🐞");
    expect(row.properties[status.id]).toBe(status.options[1].id);
    const page = await getMemoDetail(db, WORKSPACE_ID, row.id);
    expect(page.contentMarkdown).toContain("Steps to reproduce");

    // What the caller gives wins over the template.
    const custom = await createDatabaseRow(db, WORKSPACE_ID, tasks.id, { templateId: template.id, title: "Crash on save", properties: { [status.id]: status.options[2].id } }, ada, "user:usr_ada");
    expect(custom.title).toBe("Crash on save");
    expect(custom.properties[status.id]).toBe(status.options[2].id);
  });

  test("only one template is the default", async () => {
    const { db } = installation();
    const tasks = await newDatabase(db);
    const first = await createDatabaseTemplate(db, WORKSPACE_ID, tasks.id, { name: "First", isDefault: true });
    const second = await createDatabaseTemplate(db, WORKSPACE_ID, tasks.id, { name: "Second", isDefault: true });
    let templates = (await getDatabase(db, WORKSPACE_ID, tasks.id)).templates;
    expect(templates.map((item) => [item.id, item.isDefault])).toEqual([[first.id, false], [second.id, true]]);
    await updateDatabaseTemplate(db, WORKSPACE_ID, tasks.id, first.id, { isDefault: true });
    templates = (await getDatabase(db, WORKSPACE_ID, tasks.id)).templates;
    expect(templates.map((item) => item.isDefault)).toEqual([true, false]);
    await deleteDatabaseTemplate(db, WORKSPACE_ID, tasks.id, first.id);
    expect((await getDatabase(db, WORKSPACE_ID, tasks.id)).templates.map((item) => item.id)).toEqual([second.id]);
  });

  test("a template from another database or workspace can't be used or changed", async () => {
    const { db } = installation();
    const tasks = await newDatabase(db);
    const notes = await newDatabase(db);
    const template = await createDatabaseTemplate(db, WORKSPACE_ID, notes.id, { name: "Note" });
    await expect(createDatabaseRow(db, WORKSPACE_ID, tasks.id, { templateId: template.id }, ada, "user:usr_ada")).rejects.toMatchObject({ status: 404 });
    await expect(updateDatabaseTemplate(db, WORKSPACE_ID, tasks.id, template.id, { name: "Hijacked" })).rejects.toMatchObject({ status: 404 });
    await expect(deleteDatabaseTemplate(db, "ws_other", notes.id, template.id)).rejects.toMatchObject({ status: 404 });
  });

  test("a database holds a limited number of templates", async () => {
    const { db } = installation();
    const tasks = await newDatabase(db);
    for (let index = 0; index < DATABASE_TEMPLATE_LIMIT; index += 1) {
      await createDatabaseTemplate(db, WORKSPACE_ID, tasks.id, { name: `T${index}` });
    }
    await expect(createDatabaseTemplate(db, WORKSPACE_ID, tasks.id, { name: "One too many" })).rejects.toMatchObject({ status: 409 });
  });
});

describe("sub-items", () => {
  const withSubItems = (database, targetId = database.id) => ({
    properties: [
      ...database.schema.properties,
      { id: "parent", name: "Parent item", type: "relation", relation: { databaseId: targetId, syncedPropertyId: "child" } },
      { id: "child", name: "Sub-item", type: "relation", relation: { databaseId: targetId, syncedPropertyId: "parent" } },
    ],
    subItems: { parentPropertyId: "parent", childPropertyId: "child" },
  });

  test("setting a row's parent lists it among the parent's sub-items", async () => {
    const { db } = installation();
    const tasks = await newDatabase(db);
    await updateDatabase(db, WORKSPACE_ID, tasks.id, { schema: withSubItems(tasks) }, ada, "user:usr_ada");
    const parent = await createDatabaseRow(db, WORKSPACE_ID, tasks.id, { title: "Launch" }, ada, "user:usr_ada");
    const child = await createDatabaseRow(db, WORKSPACE_ID, tasks.id, { title: "Write post", properties: { parent: [parent.id] } }, ada, "user:usr_ada");
    const rows = (await listDatabaseRows(db, WORKSPACE_ID, tasks.id, {})).rows;
    expect(rows.find((row) => row.id === parent.id).properties.child).toEqual([child.id]);
    expect((await getDatabase(db, WORKSPACE_ID, tasks.id)).schema.subItems).toEqual({ parentPropertyId: "parent", childPropertyId: "child" });
  });

  test("must relate the database to itself", async () => {
    const { db } = installation();
    const tasks = await newDatabase(db);
    const other = await newDatabase(db);
    await expect(updateDatabase(db, WORKSPACE_ID, tasks.id, { schema: withSubItems(tasks, other.id) }, ada, "user:usr_ada"))
      .rejects.toMatchObject({ status: 400 });
  });
});
