import { afterEach, describe, expect, test } from "bun:test";
import { Database } from "bun:sqlite";
import { globSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Hono } from "hono";
import * as Y from "yjs";
import { AppError } from "./app-error.ts";
import { callWorkspaceTool } from "./mcp-workspace-tools.ts";
import { readPageBackup, restorePageBackup } from "./page-backup.ts";
import { createSelfHostedStorageAdapter } from "./self-hosted-storage-adapter.ts";
import { renderPublicMemoSharePage } from "./share-page.ts";
import {
  applySyncedMarkdownEdits,
  expandSyncedForReader,
  resolveSyncedForPublicPage,
} from "./synced-block-service.ts";
import { registerSyncedBlockRoutes } from "./synced-block-routes.ts";
import { teamGuard } from "./team-guard.ts";

// Synced blocks (Notion blocks plan, Phase F): the permission rule, live merging, AI edits,
// backups and public links, against a real database.
const WORKSPACE_ID = "ws_default";
const owner = {
  kind: "user", actorType: "user", actorId: "usr_owner", username: "admin", displayName: "Admin",
  scopes: [], workspaceId: WORKSPACE_ID, role: "owner", teamRole: "owner",
};
const member = { ...owner, actorId: "usr_member", username: "member", displayName: "Member", role: "member", teamRole: "member" };
const viewer = { ...owner, actorId: "usr_viewer", username: "viewer", displayName: "Viewer", role: "member", teamRole: "viewer" };
const cleanups = [];
afterEach(() => cleanups.splice(0).forEach((cleanup) => cleanup()));

const encode = (bytes) => Buffer.from(bytes).toString("base64");
const decode = (text) => new Uint8Array(Buffer.from(text, "base64"));
const paragraphDoc = (text) => ({ type: "doc", content: [{ type: "paragraph", content: [{ type: "text", text }] }] });

const installation = () => {
  const sqlite = new Database(":memory:");
  for (const file of globSync("migrations/*.sql").sort()) sqlite.exec(readFileSync(file, "utf8"));
  const directory = mkdtempSync(join(tmpdir(), "ponder-synced-"));
  cleanups.push(() => {
    sqlite.close();
    rmSync(directory, { recursive: true, force: true });
  });
  for (const [id, name, role] of [["usr_owner", "admin", "owner"], ["usr_member", "member", "member"], ["usr_viewer", "viewer", "member"]]) {
    sqlite.run("INSERT INTO users (id, username, password_hash, display_name) VALUES (?, ?, 'unused', ?)", [id, name, name]);
    sqlite.run("INSERT INTO workspace_members (workspace_id, user_id, role) VALUES (?, ?, ?)", [WORKSPACE_ID, id, role]);
  }
  const storage = createSelfHostedStorageAdapter(sqlite, directory);
  let auth = owner;
  const app = new Hono();
  app.use("*", async (c, next) => {
    c.set("auth", auth);
    await next();
  });
  app.use("/api/v1/*", teamGuard);
  registerSyncedBlockRoutes(app);
  app.post("/call/:name", async (c) => {
    try {
      return c.json({ ok: true, result: await callWorkspaceTool(c, auth, c.req.param("name"), await c.req.json()) });
    } catch (error) {
      if (error instanceof AppError) return c.json({ ok: false, code: error.code, status: error.status, message: error.message });
      throw error;
    }
  });
  const env = { storage, ALTSTACK_APP_URL: "https://ponder.test" };
  const api = async (method, path, body) => {
    const response = await app.request(path, { method, headers: { "content-type": "application/json" }, ...(body ? { body: JSON.stringify(body) } : {}) }, env);
    return { status: response.status, body: await response.json() };
  };
  const ok = async (name, args) => {
    const response = await app.request(`/call/${name}`, { method: "POST", body: JSON.stringify(args) }, env);
    const body = await response.json();
    if (!body.ok) throw new Error(`${name} failed: ${body.message}`);
    return body.result;
  };
  const page = async (title, content = "") => (await ok("create_pages", { pages: [{ title, content }] })).pages[0].id;
  return { sqlite, db: storage.db, api, ok, page, as: (next) => { auth = next; } };
};

/** A synced block on `source` holding `text`, and a copy of it on `host`. */
const sharedBlock = async (setup, text) => {
  const { api, page, ok } = setup;
  const source = await page("Original");
  const host = await page("Copy");
  const created = await api("POST", "/api/v1/synced-blocks", { memoId: source, content: paragraphDoc(text) });
  expect(created.status).toBe(201);
  const id = created.body.id;
  const ref = `<ponder-synced id="${id}"></ponder-synced>`;
  await ok("update_page", { page_id: source, command: "replace_content", new_str: `Top\n\n${ref}` });
  await ok("update_page", { page_id: host, command: "replace_content", new_str: `Host page\n\n${ref}` });
  return { id, source, host, ref };
};

describe("synced block permission rule", () => {
  test("someone who can see the copy's page but not the original gets nothing of the content", async () => {
    const setup = installation();
    const { api, ok, sqlite, db, as } = setup;
    const { id, source, host } = await sharedBlock(setup, "Salary bands for 2027");
    sqlite.run("UPDATE memos SET is_restricted = 1 WHERE id = ?", [source]);

    as(member);
    const opened = await api("GET", `/api/v1/synced-blocks/${id}?memoId=${host}`);
    expect(opened.status).toBe(200);
    expect(opened.body.block).toMatchObject({ canRead: false, canEdit: false, state: null, pages: [], pageCount: 0, sourceMemoId: "" });
    expect(JSON.stringify(opened.body)).not.toContain("Salary");
    expect((await api("POST", `/api/v1/synced-blocks/${id}/sync`, { memoId: host, generation: 1, version: 0 })).status).toBe(404);
    // Without naming a page, the original decides, and the member can't see it.
    expect((await api("POST", `/api/v1/synced-blocks/${id}/sync`, { generation: 1, version: 0 })).status).toBe(404);

    // AI and exports see the reference, empty.
    const fetched = await ok("fetch", { id: host });
    expect(fetched.content).toContain(`<ponder-synced id="${id}"></ponder-synced>`);
    expect(fetched.content).not.toContain("Salary");
    const expanded = await api("POST", "/api/v1/synced-blocks/expand", { markdown: fetched.content });
    expect(expanded.body.markdown).not.toContain("Salary");

    // An AI edit that writes content into the tag is ignored, and the block keeps its content.
    const edit = await applySyncedMarkdownEdits(db, member, host, `<ponder-synced id="${id}">\n\nLeaked over\n\n</ponder-synced>`);
    expect(edit).toMatchObject({ applied: [], ignored: [id] });
    expect(edit.markdown).toBe(`<ponder-synced id="${id}"></ponder-synced>`);
    await ok("update_page", { page_id: host, command: "replace_content", new_str: `Host page\n\n<ponder-synced id="${id}">\n\nOverwritten\n\n</ponder-synced>` });
    as(owner);
    expect(await expandSyncedForReader(db, owner, `<ponder-synced id="${id}"></ponder-synced>`)).toContain("Salary bands for 2027");

    // Shared with the member for viewing: now they read it, still can't edit it.
    sqlite.run("INSERT INTO page_shares (workspace_id, memo_id, user_id, level, created_at) VALUES (?, ?, 'usr_member', 'view', '2026-11-11')", [WORKSPACE_ID, source]);
    as(member);
    const readable = await api("GET", `/api/v1/synced-blocks/${id}?memoId=${host}`);
    expect(readable.body.block).toMatchObject({ canRead: true, canEdit: false, sourceMemoId: source, pageCount: 2 });
    expect(readable.body.block.state).toBeTruthy();
  });

  test("a page the person can't see can't be used to reach a block, and a trashed original hides it", async () => {
    const setup = installation();
    const { api, sqlite, as, ok } = setup;
    const { id, source, host } = await sharedBlock(setup, "Roadmap");
    sqlite.run("UPDATE memos SET is_restricted = 1 WHERE id = ?", [host]);
    as(member);
    expect((await api("GET", `/api/v1/synced-blocks/${id}?memoId=${host}`)).status).toBe(404);
    // Seen through the original (which they can see), they read it, and the hidden page isn't listed.
    const viaSource = await api("GET", `/api/v1/synced-blocks/${id}?memoId=${source}`);
    expect(viaSource.body.block.canRead).toBe(true);
    expect(viaSource.body.block.pages.map((p) => p.memoId)).toEqual([source]);
    expect(viaSource.body.block.pageCount).toBe(2);

    as(owner);
    sqlite.run("UPDATE memos SET is_restricted = 0 WHERE id = ?", [host]);
    sqlite.run("UPDATE memos SET is_deleted = 1 WHERE id = ?", [source]);
    as(member);
    expect((await api("GET", `/api/v1/synced-blocks/${id}?memoId=${host}`)).body.block.canRead).toBe(false);
  });

  test("editing needs edit access to the original and to the copy's page", async () => {
    const setup = installation();
    const { api, as } = setup;
    const { id, host } = await sharedBlock(setup, "Agenda");
    const before = (await api("GET", `/api/v1/synced-blocks/${id}?memoId=${host}`)).body.block;

    as(viewer);
    const seen = (await api("GET", `/api/v1/synced-blocks/${id}?memoId=${host}`)).body.block;
    expect(seen).toMatchObject({ canRead: true, canEdit: false });
    const doc = new Y.Doc();
    Y.applyUpdate(doc, decode(seen.state));
    doc.getXmlFragment("default").insert(0, [new Y.XmlElement("paragraph")]);
    const attempt = await api("POST", `/api/v1/synced-blocks/${id}/sync`, { memoId: host, generation: seen.generation, version: seen.version, update: encode(Y.encodeStateAsUpdate(doc)) });
    expect(attempt.status).toBe(200);
    expect(attempt.body.canEdit).toBe(false);
    expect(attempt.body.version).toBe(before.version);
    expect((await api("POST", "/api/v1/synced-blocks", { memoId: host })).status).toBe(403);
    expect((await api("POST", `/api/v1/synced-blocks/${id}/unsync-all`)).status).toBe(403);
  });
});

describe("synced block editing", () => {
  test("two copies editing at once both land, and each sees the other's change", async () => {
    const setup = installation();
    const { api } = setup;
    const { id, source, host } = await sharedBlock(setup, "Start");
    const start = (await api("GET", `/api/v1/synced-blocks/${id}?memoId=${source}`)).body.block;
    const clientA = new Y.Doc();
    const clientB = new Y.Doc();
    Y.applyUpdate(clientA, decode(start.state));
    Y.applyUpdate(clientB, decode(start.state));
    const write = (doc, text) => {
      const before = Y.encodeStateVector(doc);
      const paragraph = new Y.XmlElement("paragraph");
      paragraph.insert(0, [new Y.XmlText(text)]);
      doc.getXmlFragment("default").push([paragraph]);
      return encode(Y.encodeStateAsUpdate(doc, before));
    };
    const a = await api("POST", `/api/v1/synced-blocks/${id}/sync`, { memoId: source, generation: start.generation, version: start.version, update: write(clientA, "From A"), stateVector: encode(Y.encodeStateVector(clientA)) });
    const b = await api("POST", `/api/v1/synced-blocks/${id}/sync`, { memoId: host, generation: start.generation, version: start.version, update: write(clientB, "From B"), stateVector: encode(Y.encodeStateVector(clientB)) });
    expect(a.body.version).toBe(start.version + 1);
    expect(b.body.version).toBe(start.version + 2);
    Y.applyUpdate(clientB, decode(b.body.update));
    const markdown = await expandSyncedForReader(setup.db, owner, `<ponder-synced id="${id}"></ponder-synced>`);
    expect(markdown).toContain("From A");
    expect(markdown).toContain("From B");
    expect(clientB.getXmlFragment("default").toString()).toContain("From A");
    // Nothing new: an empty answer.
    const idle = await api("POST", `/api/v1/synced-blocks/${id}/sync`, { memoId: host, generation: b.body.generation, version: b.body.version });
    expect(idle.body.update).toBeNull();
  });

  test("an AI edit of a copy (update_page with content in the tag) changes every copy and resets live editors", async () => {
    const setup = installation();
    const { api, ok } = setup;
    const { id, source, host } = await sharedBlock(setup, "Old text");
    const start = (await api("GET", `/api/v1/synced-blocks/${id}?memoId=${host}`)).body.block;

    const fetched = await ok("fetch", { id: host });
    expect(fetched.content).toContain("Old text");
    await ok("update_page", { page_id: host, command: "update_content", content_updates: [{ old_str: "Old text", new_str: "New text from AI" }] });

    expect((await ok("fetch", { id: source })).content).toContain("New text from AI");
    const stored = setup.sqlite.query("SELECT content_markdown FROM memo_contents WHERE memo_id = ?").get(host);
    expect(stored.content_markdown).not.toContain("New text from AI");
    expect(stored.content_markdown).toContain(`<ponder-synced id="${id}"></ponder-synced>`);
    // A copy that was open starts over from the new content.
    const reset = await api("POST", `/api/v1/synced-blocks/${id}/sync`, { memoId: source, generation: start.generation, version: start.version });
    expect(reset.body.reset).toBe(true);
    expect(reset.body.generation).toBe(start.generation + 1);
  });

  test("Unsync all turns the copies into ordinary blocks and keeps the original synced", async () => {
    const setup = installation();
    const { api, ok } = setup;
    const { id, source, host } = await sharedBlock(setup, "Shared notes");
    expect((await api("GET", `/api/v1/synced-blocks/${id}?memoId=${source}`)).body.block.pages.map((p) => [p.title, p.isOriginal])).toEqual([["Original", true], ["Copy", false]]);
    const result = await api("POST", `/api/v1/synced-blocks/${id}/unsync-all`);
    expect(result.body).toEqual({ unsynced: 1, skipped: 0 });
    const copy = await ok("fetch", { id: host });
    expect(copy.content).toContain("Shared notes");
    expect(copy.content).not.toContain("ponder-synced");
    expect((await api("GET", `/api/v1/synced-blocks/${id}?memoId=${source}`)).body.block.pageCount).toBe(1);
  });
});

describe("synced blocks in backups and public links", () => {
  test("a backup carries the block once, and restoring it brings the copies back", async () => {
    const setup = installation();
    const { id, source, host } = await sharedBlock(setup, "Backed up");
    const backup = await readPageBackup(setup.db, WORKSPACE_ID);
    expect(backup.syncedBlocks).toHaveLength(1);
    expect(backup.syncedBlocks[0]).toMatchObject({ id, sourceMemoId: source, markdown: "Backed up" });
    setup.sqlite.run("DELETE FROM synced_blocks");
    setup.sqlite.run("DELETE FROM synced_block_refs");
    const restored = await restorePageBackup(setup.db, WORKSPACE_ID, backup);
    expect(restored.syncedBlocks).toBe(1);
    expect(await expandSyncedForReader(setup.db, owner, `<ponder-synced id="${id}"></ponder-synced>`)).toContain("Backed up");
    expect(setup.sqlite.query("SELECT memo_id FROM synced_block_refs WHERE synced_id = ? ORDER BY memo_id").all(id).map((row) => row.memo_id).sort()).toEqual([source, host].sort());
  });

  test("a public link shows only the blocks whose original is the shared page", async () => {
    const setup = installation();
    const { id: own, source } = await sharedBlock(setup, "Public part");
    const other = (await setup.api("POST", "/api/v1/synced-blocks", { memoId: await setup.page("Private"), content: paragraphDoc("Private part") })).body.id;
    const doc = { type: "doc", content: [{ type: "ponderSynced", attrs: { syncedId: own } }, { type: "ponderSynced", attrs: { syncedId: other } }] };
    const markdown = `<ponder-synced id="${own}"></ponder-synced>\n\n<ponder-synced id="${other}"></ponder-synced>`;
    const resolved = await resolveSyncedForPublicPage(setup.db, WORKSPACE_ID, source, doc, markdown);
    expect(JSON.stringify(resolved.doc)).toContain("Public part");
    expect(JSON.stringify(resolved.doc)).not.toContain("Private part");
    expect(JSON.stringify(resolved.doc)).not.toContain("ponderSynced");
    expect(resolved.markdown).toContain("Public part");
    expect(resolved.markdown).not.toContain("Private part");
    expect(resolved.markdown).not.toContain(other);
  });

  test("the public .md file inlines the page's own block and drops another page's", async () => {
    const setup = installation();
    const { id: own, source } = await sharedBlock(setup, "Public part");
    const other = (await setup.api("POST", "/api/v1/synced-blocks", { memoId: await setup.page("Private"), content: paragraphDoc("Private part") })).body.id;
    await setup.ok("update_page", { page_id: source, command: "replace_content", new_str: `Intro\n\n<ponder-synced id="${own}"></ponder-synced>\n\n<ponder-synced id="${other}"></ponder-synced>\n\n\`\`\`html\n<ponder-synced id="${other}"></ponder-synced>\n\`\`\`` });
    const token = "t".repeat(43);
    setup.sqlite.run("INSERT INTO memo_shares (id, memo_id, workspace_id, token) VALUES ('share_1', ?, ?, ?)", [source, WORKSPACE_ID, token]);
    const response = await renderPublicMemoSharePage(new Request(`https://note.example/share/${token}.md`), setup.db, async () => new Response(""));
    const text = await response.text();
    expect(text).toContain("Public part");
    expect(text).not.toContain("Private part");
    // A tag shown as code stays as written.
    expect(text).toContain(`\`\`\`html\n<ponder-synced id="${other}"></ponder-synced>`);
  });
});
