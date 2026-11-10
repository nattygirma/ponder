import { afterEach, describe, expect, test } from "bun:test";
import { Database } from "bun:sqlite";
import { globSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Hono } from "hono";
import { AppError } from "./app-error.ts";
import { MCP_TOOLS } from "./mcp-tools.ts";
import { callWorkspaceTool, WORKSPACE_TOOL_DEFINITIONS } from "./mcp-workspace-tools.ts";
import { createSelfHostedStorageAdapter } from "./self-hosted-storage-adapter.ts";

// The Notion-style MCP tools, called the way an agent calls them, against a real database.
const WORKSPACE_ID = "ws_default";
const owner = {
  kind: "user", actorType: "user", actorId: "usr_owner", username: "admin", displayName: "Admin",
  scopes: [], workspaceId: WORKSPACE_ID, role: "owner",
};
const cleanups = [];
afterEach(() => cleanups.splice(0).forEach((cleanup) => cleanup()));

const installation = () => {
  const sqlite = new Database(":memory:");
  for (const file of globSync("migrations/*.sql").sort()) sqlite.exec(readFileSync(file, "utf8"));
  const directory = mkdtempSync(join(tmpdir(), "ponder-mcp-workspace-"));
  cleanups.push(() => {
    sqlite.close();
    rmSync(directory, { recursive: true, force: true });
  });
  sqlite.run("INSERT INTO users (id, username, password_hash, display_name) VALUES ('usr_owner', 'admin', 'unused', 'Admin')");
  sqlite.run("INSERT INTO workspace_members (workspace_id, user_id, role) VALUES (?, 'usr_owner', 'owner')", [WORKSPACE_ID]);
  const storage = createSelfHostedStorageAdapter(sqlite, directory);
  let auth = owner;
  const app = new Hono();
  app.post("/call/:name", async (c) => {
    c.set("auth", auth);
    try {
      return c.json({ ok: true, result: await callWorkspaceTool(c, auth, c.req.param("name"), await c.req.json()) });
    } catch (error) {
      if (error instanceof AppError) return c.json({ ok: false, code: error.code, status: error.status, message: error.message });
      throw error;
    }
  });
  const call = async (name, args = {}) => {
    const response = await app.request(`/call/${name}`, { method: "POST", body: JSON.stringify(args) }, { storage, ALTSTACK_APP_URL: "https://ponder.test" });
    return response.json();
  };
  const ok = async (name, args) => {
    const body = await call(name, args);
    if (!body.ok) throw new Error(`${name} failed: ${body.message}`);
    return body.result;
  };
  return { sqlite, storage, call, ok, as: (next) => { auth = next; } };
};

describe("Notion-style MCP tools", () => {
  test("are listed once each, with annotations, next to the note tools", () => {
    const names = MCP_TOOLS.map((tool) => tool.name);
    expect(new Set(names).size).toBe(names.length);
    for (const definition of WORKSPACE_TOOL_DEFINITIONS) {
      const tool = MCP_TOOLS.find((item) => item.name === definition.name);
      expect(tool?.inputSchema.type).toBe("object");
      expect(typeof tool?.annotations.readOnlyHint).toBe("boolean");
    }
    expect(MCP_TOOLS.find((tool) => tool.name === "fetch").annotations.readOnlyHint).toBe(true);
    expect(MCP_TOOLS.find((tool) => tool.name === "delete_pages").annotations.destructiveHint).toBe(true);
    expect(MCP_TOOLS.find((tool) => tool.name === "create_pages").annotations.destructiveHint).toBe(false);
  });

  test("create, fetch, edit, move, duplicate, search, delete and restore pages", async () => {
    const { ok, call } = installation();
    const [parent] = (await ok("create_pages", { pages: [{ title: "Projects", content: "# Projects\n\nAll of them.", icon: "📁" }] })).pages;
    expect(parent.url).toBe(`https://ponder.test/?p=${parent.id}`);
    const { pages } = await ok("create_pages", { parent: { page_id: parent.url }, pages: [{ title: "Plan", content: "Ship in May. Then rest." }, { title: "Notes" }] });
    expect(pages).toHaveLength(2);

    const fetched = await ok("fetch", { id: parent.id });
    expect(fetched).toMatchObject({ type: "page", title: "Projects", icon: "📁" });
    expect(fetched.content).toContain("All of them.");
    expect(fetched.children.map((child) => child.title)).toEqual(["Plan", "Notes"]);

    const edited = await ok("update_page", { page_id: pages[0].id, command: "update_content", content_updates: [{ old_str: "May", new_str: "June" }, { old_str: "missing", new_str: "x" }] });
    expect(edited.warnings).toEqual([expect.objectContaining({ index: 1, code: "no_match" })]);
    expect((await ok("fetch", { id: pages[0].id })).content).toContain("Ship in June.");
    const ambiguous = await call("update_page", { page_id: pages[0].id, command: "replace_content", new_str: "a a a" })
      .then(() => call("update_page", { page_id: pages[0].id, command: "update_content", content_updates: [{ old_str: "a", new_str: "b" }] }));
    expect(ambiguous).toMatchObject({ ok: false, status: 400 });
    await ok("update_page", { page_id: pages[0].id, command: "update_content", content_updates: [{ old_str: "a", new_str: "b", replace_all_matches: true }] });
    expect((await ok("fetch", { id: pages[0].id })).content.trim()).toBe("b b b");
    await ok("update_page", { page_id: pages[0].id, command: "update_properties", properties: { title: "Roadmap" }, icon: "🗺️" });
    expect(await ok("fetch", { id: pages[0].id })).toMatchObject({ title: "Roadmap", icon: "🗺️" });

    await ok("move_pages", { page_or_database_ids: [pages[1].id], new_parent: { workspace: true } });
    expect((await ok("fetch", { id: parent.id })).children.map((child) => child.title)).toEqual(["Roadmap"]);
    const copy = await ok("duplicate_page", { page_id: pages[0].id });
    expect((await ok("fetch", { id: parent.id })).children.map((child) => child.id)).toEqual([pages[0].id, copy.id]);

    const found = await ok("search", { query: "Roadmap" });
    expect(found.results.map((result) => result.id)).toContain(pages[0].id);
    const inside = await ok("search", { query: "Projects", page_url: parent.url });
    expect(inside.results.map((result) => result.id)).not.toContain(parent.id);

    const unconfirmed = await ok("delete_pages", { page_ids: [pages[1].id] });
    expect(unconfirmed).toMatchObject({ moved: false, pages: [expect.objectContaining({ title: "Notes" })] });
    expect((await ok("fetch", { id: pages[1].id })).title).toBe("Notes");
    expect((await ok("delete_pages", { page_ids: [pages[1].id], user_confirmed: true })).moved).toBe(true);
    expect((await call("fetch", { id: pages[1].id })).ok).toBe(false);
    await ok("restore_pages", { page_ids: [pages[1].id] });
    expect((await ok("fetch", { id: pages[1].id })).title).toBe("Notes");

    await ok("update_page", { page_id: parent.id, command: "update_properties", properties: {} });
    expect((await ok("list_private_pages", {})).results.map((page) => page.title)).toEqual(expect.arrayContaining(["Projects", "Notes"]));
  });

  test("databases: create, change columns, add rows by name, query, views", async () => {
    const { ok, call } = installation();
    const database = await ok("create_database", {
      title: "Tasks",
      properties: [{ name: "Stage", type: "select", options: ["Todo", "Doing"] }, { name: "Points", type: "number" }, { name: "Due", type: "date" }],
    });
    expect(database.properties.map((property) => property.name)).toEqual(["Name", "Stage", "Points", "Due"]);
    expect(database.views).toHaveLength(1);

    const rows = (await ok("create_pages", { parent: { database_id: database.id }, pages: [
      { properties: { Name: "Write spec", Stage: "Doing", Points: 3, "date:Due:start": "2026-12-01" } },
      { properties: { Name: "Review", Stage: "Done", Points: 1 }, content: "Check every page." },
      { properties: { Name: "Plan", Stage: "Todo", Points: 5 } },
    ] })).pages;
    expect(rows[0].properties).toMatchObject({ Name: "Write spec", Stage: "Doing", Points: "3" });
    // A select option that didn't exist is added to the column.
    expect((await ok("fetch", { id: database.id })).properties.find((property) => property.name === "Stage").options).toEqual(["Todo", "Doing", "Done"]);
    expect((await ok("fetch", { id: rows[1].id })).content).toContain("Check every page.");

    const query = await ok("query_data_sources", { database_id: database.id, filter: [{ property: "Points", operator: "gte", value: 3 }], sort: [{ property: "Points", direction: "descending" }] });
    expect(query.results.map((row) => row.title)).toEqual(["Plan", "Write spec"]);
    expect(query.has_more).toBe(false);
    const paged = await ok("query_data_sources", { database_id: database.id, limit: 2 });
    expect(paged).toMatchObject({ has_more: true, next_cursor: "2" });
    expect((await ok("query_data_sources", { database_id: database.id, cursor: "2" })).results).toHaveLength(1);
    expect((await call("query_data_sources", { database_id: database.id, filter: [{ property: "Nope", operator: "is", value: 1 }] })).message).toContain("No property");

    await ok("update_page", { page_id: rows[2].id, command: "update_properties", properties: { Stage: "Doing", Points: 8 } });
    expect((await ok("fetch", { id: rows[2].id })).properties).toMatchObject({ Stage: "Doing", Points: "8" });

    const updated = await ok("update_data_source", { database_id: database.id, title: "Work", properties: { Points: null, Owner: { type: "text" }, Stage: { options: ["Todo", "Doing"] } } });
    expect(updated.title).toBe("Work");
    expect(updated.properties.map((property) => property.name)).toEqual(["Name", "Stage", "Due", "Owner"]);
    expect(updated.properties.find((property) => property.name === "Stage").options).toEqual(["Todo", "Doing"]);

    const view = await ok("create_view", { database_id: database.id, name: "Doing", type: "board", group_by: "Stage", filters: [{ property: "Stage", operator: "is", value: "Doing" }] });
    expect(view.url).toBe(`view://${view.id}`);
    const viewed = await ok("fetch", { id: view.url });
    expect(viewed.rows.map((row) => row.title).sort()).toEqual(["Plan", "Write spec"]);
    expect((await ok("query_data_sources", { view_id: view.id })).results).toHaveLength(2);
    const changed = await ok("update_view", { view_id: view.id, name: "Everything", clear_filters: true });
    expect(changed.name).toBe("Everything");
    expect((await ok("query_data_sources", { view_id: view.id })).results).toHaveLength(3);

    const search = await ok("search", { query: "Write spec" });
    expect(search.results.find((result) => result.id === rows[0].id)).toMatchObject({ type: "database_row", parent_database_id: database.id });

    expect((await ok("delete_databases", { database_ids: [database.id] })).moved).toBe(false);
    expect((await ok("delete_databases", { database_ids: [database.id], user_confirmed: true })).moved).toBe(true);
    expect((await call("fetch", { id: rows[0].id })).ok).toBe(false);
  });

  test("comments, discussions and versions", async () => {
    const { ok, call, sqlite } = installation();
    const [page] = (await ok("create_pages", { pages: [{ title: "Draft", content: "First words here." }] })).pages;
    const comment = await ok("create_comment", { page_id: page.id, markdown: "Is this right?", selection_with_ellipsis: "First words..." });
    await ok("create_comment", { page_id: page.id, markdown: "Yes.", discussion_id: comment.discussion_url });
    let { discussions } = await ok("get_comments", { page_id: page.id });
    expect(discussions).toHaveLength(1);
    expect(discussions[0].comments.map((item) => item.markdown)).toEqual(["Is this right?", "Yes."]);
    expect(discussions[0].quote).toBe("First words");
    await ok("update_comment", { comment_id: discussions[0].comments[1].id, markdown: "Yes, it is." });
    await ok("set_discussion_resolved", { discussion_id: comment.discussion_id, resolved: true });
    expect((await ok("get_comments", { page_id: page.id })).discussions).toHaveLength(0);
    ({ discussions } = await ok("get_comments", { page_id: page.id, include_resolved: true }));
    expect(discussions[0]).toMatchObject({ resolved: true });
    expect(discussions[0].comments[1].markdown).toBe("Yes, it is.");
    await ok("delete_comment", { comment_id: discussions[0].comments[1].id });
    expect((await ok("get_comments", { page_id: page.id, include_resolved: true })).discussions[0].comments).toHaveLength(1);

    // Make the page older, and its one edit (which saved the first version) happen in June.
    await ok("update_page", { page_id: page.id, command: "replace_content", new_str: "Second words." });
    sqlite.run(`UPDATE memos SET created_at = '2026-01-01T00:00:00.000Z' WHERE id = ?`, [page.id]);
    sqlite.run(`UPDATE memo_revisions SET created_at = '2026-06-01T00:00:00.000Z' WHERE memo_id = ?`, [page.id]);
    const old = await ok("view_version", { page_id: page.id, time: "2026-02-01T00:00:00Z" });
    expect(old).toMatchObject({ is_current: false, changed_at: "2026-06-01T00:00:00.000Z" });
    expect(old.content).toContain("First words here.");
    expect((await ok("view_version", { page_id: page.id, time: "2026-07-01T00:00:00Z" })).content).toContain("Second words.");
    expect(await call("view_version", { page_id: page.id, time: "2025-06-01T00:00:00Z" })).toMatchObject({ ok: false, status: 404 });
    const changes = await ok("get_version_changes", { page_id: page.id, start_time: "2026-05-01T00:00:00Z", end_time: "2026-07-01T00:00:00Z" });
    expect(changes.changes).toEqual([expect.objectContaining({ time: "2026-06-01T00:00:00.000Z", title_before: "Draft" })]);
    expect((await ok("restore_version", { page_id: page.id, time: "2026-07-01T00:00:00Z" })).restored).toBe(false);
    expect((await ok("restore_version", { page_id: page.id, time: "2026-02-01T00:00:00Z" })).restored).toBe(false);
    expect((await ok("fetch", { id: page.id })).content).toContain("Second words.");
    expect((await ok("restore_version", { page_id: page.id, time: "2026-02-01T00:00:00Z", user_confirmed: true })).restored).toBe(true);
    expect((await ok("fetch", { id: page.id })).content).toContain("First words here.");
  });

  test("lists, people, backlinks and tool access", async () => {
    const { ok, sqlite } = installation();
    const [target, linker] = (await ok("create_pages", { pages: [{ title: "Target" }, { title: "Linker" }] })).pages;
    await ok("update_page", { page_id: linker.id, command: "replace_content", new_str: `See [Target](#memo=${target.id}).` });
    const backlinks = await ok("list_page_backlinks", { page_id: target.id });
    expect(backlinks.results.map((link) => link.id)).toEqual([linker.id]);

    sqlite.run(`UPDATE memos SET is_pinned = 1 WHERE id = ?`, [target.id]);
    expect((await ok("list_favorite_pages", {})).results.map((page) => page.id)).toEqual([target.id]);
    // page_views comes with page analytics (migration 0096); without it there's nothing recent.
    if (!sqlite.query("SELECT 1 FROM sqlite_master WHERE name = 'page_views'").get()) {
      expect((await ok("list_recent_pages", {})).results).toEqual([]);
      sqlite.run(`CREATE TABLE page_views (workspace_id TEXT NOT NULL, memo_id TEXT NOT NULL, user_id TEXT NOT NULL, day TEXT NOT NULL,
        views INTEGER NOT NULL DEFAULT 1, last_viewed_at TEXT NOT NULL, PRIMARY KEY (workspace_id, memo_id, day, user_id))`);
    }
    sqlite.run(`INSERT INTO page_views (workspace_id, memo_id, user_id, day, views, last_viewed_at) VALUES (?, ?, 'usr_owner', '2026-11-09', 1, '2026-11-09T10:00:00Z'), (?, ?, 'usr_owner', '2026-11-10', 1, '2026-11-10T10:00:00Z')`, [WORKSPACE_ID, target.id, WORKSPACE_ID, linker.id]);
    expect((await ok("list_recent_pages", {})).results.map((page) => page.id)).toEqual([linker.id, target.id]);
    const first = await ok("list_private_pages", { limit: 1 });
    expect(first.results).toHaveLength(1);
    expect(first.nextCursor).toBe("1");

    expect((await ok("get_self", {})).user).toMatchObject({ id: "usr_owner", username: "admin" });
    expect((await ok("get_users", { query: "adm" })).results).toEqual([expect.objectContaining({ id: "usr_owner", name: "Admin" })]);
    expect(await ok("get_users", { user_id: "self" })).toMatchObject({ id: "usr_owner" });
    expect((await ok("search", { query: "admin", query_type: "user" })).results).toHaveLength(1);
    expect((await ok("get_tool_access", { tool_names: ["notion-fetch", "notion-delete-pages"] })).tools).toEqual({ fetch: { available: true }, delete_pages: { available: true } });
  });

  test("tokens and teammates only reach what they're allowed to", async () => {
    const { ok, call, as, sqlite } = installation();
    const [secret] = (await ok("create_pages", { pages: [{ title: "Secret", content: "salary numbers" }] })).pages;
    const [open] = (await ok("create_pages", { pages: [{ title: "Open", content: "salary bands" }] })).pages;
    sqlite.run(`UPDATE memos SET is_restricted = 1 WHERE id = ?`, [secret.id]);

    as({ ...owner, kind: "agent", actorType: "agent", actorId: "tok_1", scopes: ["read:memos"] });
    expect((await ok("fetch", { id: open.id })).title).toBe("Open");
    expect(await call("create_pages", { pages: [{ title: "Nope" }] })).toMatchObject({ ok: false, status: 403 });
    expect((await ok("get_tool_access", { tool_names: ["fetch", "create_pages"] })).tools).toEqual({ fetch: { available: true }, create_pages: { available: false } });

    as({ ...owner, actorId: "usr_member", username: "member", role: "member", teamRole: "member" });
    expect(await call("fetch", { id: secret.id })).toMatchObject({ ok: false, status: 404 });
    expect((await ok("search", { query: "salary" })).results.map((result) => result.id)).toEqual([open.id]);
    expect(await call("update_page", { page_id: secret.id, command: "replace_content", new_str: "x" })).toMatchObject({ ok: false, status: 404 });
    expect(await call("create_comment", { page_id: secret.id, markdown: "hi" })).toMatchObject({ ok: false, status: 404 });

    as({ ...owner, actorId: "usr_viewer", username: "viewer", role: "member", teamRole: "viewer" });
    expect(await call("update_page", { page_id: open.id, command: "replace_content", new_str: "x" })).toMatchObject({ ok: false, status: 403 });
  });
});
