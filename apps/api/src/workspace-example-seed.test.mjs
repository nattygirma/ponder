import { afterEach, describe, expect, test } from "bun:test";
import { Database } from "bun:sqlite";
import { globSync, readFileSync } from "node:fs";
import { createSelfHostedStorageAdapter } from "./self-hosted-storage-adapter.ts";
import { ensureUserWorkspace } from "./workspace-provisioning.ts";
import { DatabaseSchemaSchema, DatabaseViewConfigSchema } from "@ponder/shared";
import { ensureWorkspaceExampleSeed } from "./workspace-example-seed.ts";

const MIGRATION = "0079_workspace_example_seeds.sql";
const migrationFiles = globSync("migrations/*.sql").sort();
const opened = [];
afterEach(() => opened.splice(0).forEach((sqlite) => sqlite.close()));

const migrate = (sqlite, filter = () => true) => {
  for (const file of migrationFiles.filter(filter)) sqlite.exec(readFileSync(file, "utf8"));
};

const openDatabase = () => {
  const sqlite = new Database(":memory:");
  opened.push(sqlite);
  const { db } = createSelfHostedStorageAdapter(sqlite, "/tmp/ponder-example-seed-unused");
  const env = {
    storage: {
      db,
      resources: {
        put: async () => undefined,
      },
    },
  };
  return { sqlite, env };
};

const freshInstallation = () => {
  const database = openDatabase();
  migrate(database.sqlite);
  return database;
};

const upgradedInstallation = (prepare) => {
  const database = openDatabase();
  migrate(database.sqlite, (file) => file < `migrations/${MIGRATION}`);
  prepare(database.sqlite);
  migrate(database.sqlite, (file) => file >= `migrations/${MIGRATION}`);
  return database;
};

const addUser = (sqlite, id, username = id) => sqlite
  .query("INSERT INTO users (id, username, password_hash, display_name) VALUES (?, ?, 'unused', ?)")
  .run(id, username, username);

const pending = (sqlite) => sqlite
  .query("SELECT workspace_id FROM workspace_example_seeds ORDER BY workspace_id")
  .all()
  .map((row) => row.workspace_id);

const STARTER_TITLES = ["Getting Started", "Reading List", "Task List", "Journal", "Quick Note", "Personal Home"];

const rootPages = (sqlite, workspaceId = "ws_default") => sqlite.query(
  `SELECT title FROM memos
   WHERE workspace_id = ? AND is_deleted = 0 AND parent_memo_id IS NULL
   ORDER BY page_position`,
).all(workspaceId).map((row) => row.title);

const notebookSlugs = (sqlite, workspaceId = "ws_default") => sqlite.query(
  "SELECT slug FROM notebooks WHERE workspace_id = ? ORDER BY slug",
).all(workspaceId).map((row) => row.slug);

describe("workspace example seed", () => {
  test("gives a fresh installation six starter pages and one notebook", async () => {
    const { sqlite, env } = freshInstallation();
    expect(pending(sqlite)).toEqual(["ws_default"]);

    await ensureWorkspaceExampleSeed(env, "ws_default");

    expect(pending(sqlite)).toEqual([]);
    expect(rootPages(sqlite)).toEqual(STARTER_TITLES);
    expect(notebookSlugs(sqlite)).toEqual(["inbox"]);
    expect(sqlite.query("SELECT COUNT(*) AS count FROM memo_templates WHERE workspace_id = 'ws_default'").get()).toEqual({ count: 0 });
    expect(sqlite.query("SELECT title FROM memos WHERE id = 'memo_welcome'").get()).toEqual({ title: "Getting Started" });
    expect(sqlite.query("SELECT content_markdown FROM memo_contents WHERE memo_id = 'memo_welcome'").get().content_markdown)
      .toContain("Try these first");

    const memoCount = sqlite.query("SELECT COUNT(*) AS count FROM memos").get().count;
    await ensureWorkspaceExampleSeed(env, "ws_default");
    expect(sqlite.query("SELECT COUNT(*) AS count FROM memos").get().count).toBe(memoCount);
  });

  test("makes Reading List, Task List and Journal working databases", async () => {
    const { sqlite, env } = freshInstallation();
    await ensureWorkspaceExampleSeed(env, "ws_default");

    const databases = sqlite.query(
      `SELECT m.title, d.id FROM databases d INNER JOIN memos m ON m.id = d.page_memo_id ORDER BY m.page_position`,
    ).all();
    expect(databases.map((row) => row.title)).toEqual(["Reading List", "Task List", "Journal"]);
    for (const database of databases) {
      const stored = sqlite.query("SELECT schema_json FROM databases WHERE id = ?").get(database.id);
      expect(DatabaseSchemaSchema.safeParse(JSON.parse(stored.schema_json)).success).toBe(true);
      for (const view of sqlite.query("SELECT config_json FROM database_views WHERE database_id = ?").all(database.id)) {
        expect(DatabaseViewConfigSchema.safeParse(JSON.parse(view.config_json)).success).toBe(true);
      }
    }
    const task = databases[1];
    expect(sqlite.query("SELECT type, config_json FROM database_views WHERE database_id = ? ORDER BY position").all(task.id)[0])
      .toEqual({ type: "board", config_json: JSON.stringify({ groupByPropertyId: "status" }) });
    const rows = sqlite.query("SELECT title, properties_json, parent_memo_id FROM memos WHERE database_id = ? ORDER BY page_position").all(task.id);
    expect(rows.length).toBe(3);
    expect(JSON.parse(rows[0].properties_json)).toEqual({ status: "todo" });
  });

  test("links Personal Home to the other starter pages", async () => {
    const { sqlite, env } = freshInstallation();
    await ensureWorkspaceExampleSeed(env, "ws_default");

    const count = sqlite.query(
      "SELECT COUNT(*) AS count FROM memo_links WHERE source_memo_id = 'ws_default_starter_personal_home'",
    ).get().count;
    expect(count).toBe(4);
  });

  test("still seeds a welcome note that was only localized", async () => {
    const { sqlite, env } = freshInstallation();
    addUser(sqlite, "usr_owner", "admin");
    await ensureUserWorkspace(env.storage.db, "usr_owner", "admin", "pl");

    await ensureWorkspaceExampleSeed(env, "ws_default");

    expect(rootPages(sqlite)).toEqual(STARTER_TITLES);
  });

  test("does not touch an installation that already has another note", async () => {
    const { sqlite, env } = upgradedInstallation((existing) => {
      existing.query(
        `INSERT INTO memos (id, notebook_id, title, created_by, updated_by)
         VALUES ('memo_user', 'nb_inbox', 'My own note', 'usr_owner', 'usr_owner')`,
      ).run();
    });
    const before = notebookSlugs(sqlite);

    expect(pending(sqlite)).toEqual([]);
    await ensureWorkspaceExampleSeed(env, "ws_default");
    expect(rootPages(sqlite)).not.toContain("Task List");
    expect(notebookSlugs(sqlite)).toEqual(before);
  });

  test("does not touch a welcome note the user has edited", async () => {
    const { sqlite, env } = upgradedInstallation((existing) => {
      existing.query("UPDATE memos SET updated_by = 'usr_owner' WHERE id = 'memo_welcome'").run();
    });

    expect(pending(sqlite)).toEqual([]);
    await ensureWorkspaceExampleSeed(env, "ws_default");
    expect(rootPages(sqlite)).not.toContain("Task List");
  });

  test("drops a pending seed when the welcome body no longer matches a system translation", async () => {
    const { sqlite, env } = freshInstallation();
    sqlite.query("UPDATE memo_contents SET content_hash = 'edited' WHERE memo_id = 'memo_welcome'").run();
    const before = notebookSlugs(sqlite);

    await ensureWorkspaceExampleSeed(env, "ws_default");

    expect(pending(sqlite)).toEqual([]);
    expect(rootPages(sqlite)).not.toContain("Task List");
    expect(notebookSlugs(sqlite)).toEqual(before);
  });

  test("signing in again does not bring the folders, templates or welcome note back", async () => {
    const { sqlite, env } = freshInstallation();
    addUser(sqlite, "usr_owner", "admin");
    await ensureUserWorkspace(env.storage.db, "usr_owner", "admin", "en-US");
    await ensureWorkspaceExampleSeed(env, "ws_default");

    await ensureUserWorkspace(env.storage.db, "usr_owner", "admin", "en-US");
    await ensureWorkspaceExampleSeed(env, "ws_default");

    expect(notebookSlugs(sqlite)).toEqual(["inbox"]);
    expect(rootPages(sqlite)).toEqual(STARTER_TITLES);
    expect(sqlite.query("SELECT COUNT(*) AS count FROM memo_templates WHERE workspace_id = 'ws_default'").get()).toEqual({ count: 0 });
  });

  test("keeps a template someone made", async () => {
    const { sqlite, env } = freshInstallation();
    sqlite.query(
      `INSERT INTO memo_templates (id, workspace_id, name, content_json) VALUES ('tmpl_mine', 'ws_default', 'Mine', '{}')`,
    ).run();

    await ensureWorkspaceExampleSeed(env, "ws_default");

    expect(sqlite.query("SELECT id FROM memo_templates WHERE workspace_id = 'ws_default'").all()).toEqual([{ id: "tmpl_mine" }]);
  });

  test("keeps a default folder that someone has put a sub-folder in", async () => {
    const { sqlite, env } = freshInstallation();
    sqlite.query(
      `INSERT INTO notebooks (id, workspace_id, parent_id, name, slug, sort_order)
       SELECT 'nb_child', workspace_id, id, 'Mine', 'mine', 1 FROM notebooks WHERE slug = 'work-projects' AND workspace_id = 'ws_default'`,
    ).run();

    await ensureWorkspaceExampleSeed(env, "ws_default");

    expect(notebookSlugs(sqlite)).toEqual(["inbox", "mine", "work-projects"]);
  });

  test("gives a newly created workspace its own pages with distinct ids", async () => {
    const { sqlite, env } = freshInstallation();
    addUser(sqlite, "usr_owner", "admin");
    addUser(sqlite, "usr_writer", "writer");
    await ensureUserWorkspace(env.storage.db, "usr_owner", "admin", "en-US");
    const workspace = await ensureUserWorkspace(env.storage.db, "usr_writer", "writer", "ja");
    expect(pending(sqlite)).toContain(workspace.workspaceId);

    await ensureWorkspaceExampleSeed(env, "ws_default");
    await ensureWorkspaceExampleSeed(env, workspace.workspaceId);

    expect(pending(sqlite)).not.toContain(workspace.workspaceId);
    expect(rootPages(sqlite, workspace.workspaceId)).toEqual(STARTER_TITLES);
    expect(rootPages(sqlite)).toEqual(STARTER_TITLES);
  });

  test("seeds without needing object storage", async () => {
    const { sqlite, env } = freshInstallation();
    env.storage.resources = {};

    await ensureWorkspaceExampleSeed(env, "ws_default");

    expect(pending(sqlite)).toEqual([]);
    expect(rootPages(sqlite)).toEqual(STARTER_TITLES);
  });

  test("leaves the catalog to demo mode", async () => {
    const { sqlite, env } = freshInstallation();
    env.PONDER_DEMO_MODE = "true";

    await ensureWorkspaceExampleSeed(env, "ws_default");

    expect(pending(sqlite)).toEqual([]);
    expect(rootPages(sqlite)).not.toContain("Task List");
    expect(sqlite.query("SELECT COUNT(*) AS count FROM memos").get()).toEqual({ count: 1 });
  });
});
