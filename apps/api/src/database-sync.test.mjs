import { afterEach, describe, expect, test } from "bun:test";
import { Database } from "bun:sqlite";
import { globSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSyncCreateSchema } from "@ponder/shared";
import { createAutomation, refreshWake } from "./automation-service.ts";
import { createDatabaseRow, getDatabase, listDatabaseRows, updateDatabase, updateDatabaseRow } from "./database-service.ts";
import { createGitHubSync, deleteSync, getSync, listSyncs, optionIdFor, runDueSyncs, runSync, toSyncedItem, updateSync } from "./database-sync-service.ts";
import { createSelfHostedStorageAdapter } from "./self-hosted-storage-adapter.ts";

const WS = "ws_default";
const ada = { actorType: "user", actorId: "usr_ada" };
const cleanups = [];
afterEach(() => cleanups.splice(0).forEach((cleanup) => cleanup()));

/**
 * A stand-in for api.github.com: issue and pull request listings with GitHub's paging (Link), `since`,
 * ETags (304 for an unchanged first page) and its errors. Issues listings include pull requests, as GitHub's do.
 */
const fakeGitHub = () => {
  const repos = new Map();
  const calls = [];
  const state = { status: null, rateLimited: false, revokedConnection: null };
  const repo = (name) => {
    if (!repos.has(name)) repos.set(name, { issues: [], pulls: [] });
    return repos.get(name);
  };
  const etagOf = (body) => `"${Bun.hash(JSON.stringify(body)).toString(16)}"`;
  const fetch = async (url, init) => {
    const headers = new Headers(init?.headers);
    const parsed = new URL(url);
    calls.push({ url: parsed, headers });
    if (state.revokedConnection && headers.get("x-altstack-connection") === state.revokedConnection) {
      return Response.json({ message: "Bad credentials" }, { status: 401 });
    }
    if (state.rateLimited) {
      return Response.json({ message: "API rate limit exceeded" }, { status: 403, headers: { "x-ratelimit-remaining": "0", "x-ratelimit-reset": "1794500000" } });
    }
    if (state.status) return Response.json({ message: "Server error" }, { status: state.status });
    const match = /^\/repos\/([^/]+)\/([^/]+)\/(issues|pulls)$/.exec(parsed.pathname);
    if (!match) return Response.json({ message: "Not Found" }, { status: 404 });
    const name = `${decodeURIComponent(match[1])}/${decodeURIComponent(match[2])}`;
    if (!repos.has(name)) return Response.json({ message: "Not Found" }, { status: 404 });
    const data = repos.get(name);
    let list = match[3] === "pulls"
      ? data.pulls
      : [...data.issues, ...data.pulls.map((pull) => ({ ...pull, pull_request: { merged_at: pull.merged_at } }))];
    const since = parsed.searchParams.get("since");
    if (since && match[3] === "issues") list = list.filter((item) => item.updated_at >= since);
    list = [...list].sort((a, b) => b.updated_at.localeCompare(a.updated_at));
    const perPage = Number(parsed.searchParams.get("per_page") ?? 30);
    const page = Number(parsed.searchParams.get("page") ?? 1);
    const body = list.slice((page - 1) * perPage, page * perPage);
    const etag = etagOf(body);
    if (headers.get("if-none-match") === etag) return new Response(null, { status: 304, headers: { etag } });
    const more = page * perPage < list.length;
    const next = new URL(parsed);
    next.searchParams.set("page", String(page + 1));
    return Response.json(body, { headers: { etag, ...(more ? { link: `<${next}>; rel="next"` } : {}) } });
  };
  return { repo, fetch, calls, state };
};

const issue = (number, fields = {}) => ({
  number,
  title: `Issue ${number}`,
  state: "open",
  user: { login: "octocat" },
  assignees: [],
  labels: [],
  created_at: "2026-11-01T10:00:00Z",
  updated_at: "2026-11-01T10:00:00Z",
  closed_at: null,
  html_url: `https://github.com/acme/app/issues/${number}`,
  body: "Steps to reproduce",
  ...fields,
});

const pull = (number, fields = {}) => ({
  ...issue(number, { html_url: `https://github.com/acme/app/pull/${number}`, title: `Pull ${number}` }),
  draft: false,
  merged_at: null,
  base: { ref: "main" },
  head: { ref: `feature-${number}` },
  ...fields,
});

const setup = async ({ now = "2026-11-11T12:00:00.000Z", accounts } = {}) => {
  const sqlite = new Database(":memory:");
  for (const file of globSync("migrations/*.sql").sort()) sqlite.exec(readFileSync(file, "utf8"));
  const directory = mkdtempSync(join(tmpdir(), "ponder-sync-"));
  cleanups.push(() => {
    sqlite.close();
    rmSync(directory, { recursive: true, force: true });
  });
  sqlite.run("INSERT INTO users (id, username, password_hash, display_name, email) VALUES ('usr_ada', 'usr_ada', 'unused', 'Ada', 'ada@example.com')");
  sqlite.run("INSERT INTO workspace_members (workspace_id, user_id, role) VALUES (?, 'usr_ada', 'owner')", [WS]);
  const db = createSelfHostedStorageAdapter(sqlite, directory).db;
  const clock = { now: new Date(now) };
  const github = fakeGitHub();
  const wakes = [];
  const env = {
    db,
    wakeAt: async (when) => { wakes.push(when); },
    emailDailyLimit: null,
    now: () => clock.now,
    fetch: github.fetch,
    listConnections: async () => accounts ?? [],
  };
  const create = (input) => createGitHubSync(env, WS, DatabaseSyncCreateSchema.parse({ connectionId: "conn_gh", notebookId: "nb_inbox", ...input }),
    { id: "conn_gh", name: "octocat" }, ada, "user:usr_ada");
  const rows = async (databaseId) => (await listDatabaseRows(db, WS, databaseId, {})).rows;
  const byNumber = async (databaseId, number) => (await rows(databaseId)).find((row) => row.properties.gh_number === number);
  const advance = (minutes) => { clock.now = new Date(clock.now.getTime() + minutes * 60_000); };
  return { sqlite, db, env, clock, github, wakes, create, rows, byNumber, advance };
};

describe("making a sync", () => {
  test("a sync makes a database with Notion's GitHub properties, all marked synced", async () => {
    const t = await setup();
    const database = await t.create({ repositories: ["acme/app"], include: ["pull_requests", "issues"] });
    expect(database.title).toBe("acme/app");
    expect(database.schema.properties.map((property) => property.name)).toEqual([
      "Title", "Number", "State", "Type", "Repository", "Author (GitHub)", "Assignees", "Labels",
      "Base Branch", "Head Branch", "Created At", "Updated At", "Closed At", "Merged At", "GitHub URL", "Description",
    ]);
    expect(database.schema.properties.every((property) => property.synced?.provider === "github")).toBe(true);
    expect(database.sync).toMatchObject({ provider: "github", accountName: "octocat", repositories: ["acme/app"], state: "importing", paused: false });
    expect(t.wakes.at(-1)?.toISOString()).toBe("2026-11-11T12:00:00.000Z");
  });

  test("the request is checked: a repository is owner/name and something must be included", () => {
    expect(DatabaseSyncCreateSchema.safeParse({ connectionId: "c", repositories: ["not a repo"], include: ["issues"] }).success).toBe(false);
    expect(DatabaseSyncCreateSchema.safeParse({ connectionId: "c", repositories: ["acme/app"], include: [] }).success).toBe(false);
    expect(DatabaseSyncCreateSchema.parse({ connectionId: "c", repositories: ["acme/app"], include: ["issues"] }).history).toBe("all");
  });
});

describe("importing and updating", () => {
  test("issues and pull requests come in with their values, and pull requests aren't doubled from the issues listing", async () => {
    const t = await setup();
    const repo = t.github.repo("acme/app");
    repo.issues.push(issue(1, { labels: [{ name: "bug" }], assignees: [{ login: "ada" }] }), issue(2, { state: "closed", closed_at: "2026-11-02T00:00:00Z" }));
    repo.pulls.push(
      pull(3, { draft: true }),
      pull(4, { state: "closed", merged_at: "2026-11-03T00:00:00Z", closed_at: "2026-11-03T00:00:00Z" }),
      pull(5, { state: "closed", closed_at: "2026-11-04T00:00:00Z" }),
    );
    const database = await t.create({ repositories: ["acme/app"], include: ["pull_requests", "issues"] });
    const outcome = await runSync(t.env, database.id);
    expect(outcome).toMatchObject({ ok: true, created: 5, pending: false });
    const rows = await t.rows(database.id);
    expect(rows.length).toBe(5);
    const states = Object.fromEntries(rows.map((row) => [row.properties.gh_number, row.properties.gh_state]));
    expect(states).toEqual({ 1: "open", 2: "closed", 3: "draft", 4: "merged", 5: "closed" });
    const first = await t.byNumber(database.id, 1);
    expect(first.title).toBe("Issue 1");
    expect(first.properties.gh_kind).toBe("issue");
    expect(first.properties.gh_labels).toEqual([optionIdFor("labels", "bug")]);
    expect(first.properties.gh_assignees).toEqual([optionIdFor("assignees", "ada")]);
    expect(first.properties.gh_author).toBe("octocat");
    expect(first.properties.gh_description).toBe("Steps to reproduce");
    expect(first.properties.gh_url).toBe("https://github.com/acme/app/issues/1");
    const merged = await t.byNumber(database.id, 4);
    expect(merged.properties).toMatchObject({ gh_kind: "pull_request", gh_base_branch: "main", gh_head_branch: "feature-4", gh_merged_at: { start: "2026-11-03T00:00:00Z" } });
    const detail = await getDatabase(t.db, WS, database.id);
    expect(detail.schema.properties.find((property) => property.id === "gh_labels").options.map((option) => option.name)).toEqual(["bug"]);
    expect(detail.sync).toMatchObject({ state: "synced", itemCount: 5, lastError: null, lastSyncedAt: "2026-11-11T12:00:00.000Z", nextRunAt: "2026-11-11T12:15:00.000Z" });
  });

  test("a closed issue changes state within one sync, and an unchanged repository costs one 304 per listing", async () => {
    const t = await setup();
    const repo = t.github.repo("acme/app");
    repo.issues.push(issue(1), issue(2));
    const database = await t.create({ repositories: ["acme/app"], include: ["issues"] });
    await runSync(t.env, database.id);
    const before = await t.byNumber(database.id, 1);

    // The next pass asks only for what changed since the newest one; from then on the ETag answers.
    t.advance(15);
    expect(await runSync(t.env, database.id)).toMatchObject({ ok: true, created: 0, updated: 0 });
    t.advance(15);
    t.github.calls.length = 0;
    expect(await runSync(t.env, database.id)).toMatchObject({ ok: true, created: 0, updated: 0 });
    expect(t.github.calls.length).toBe(1);
    expect(t.github.calls[0].headers.get("if-none-match")).toBeTruthy();

    repo.issues[0] = { ...repo.issues[0], state: "closed", closed_at: "2026-11-11T12:10:00Z", updated_at: "2026-11-11T12:10:00Z", title: "Issue 1, renamed" };
    t.advance(15);
    expect(await runSync(t.env, database.id)).toMatchObject({ ok: true, created: 0, updated: 1 });
    const after = await t.byNumber(database.id, 1);
    expect(after.id).toBe(before.id);
    expect(after.properties.gh_state).toBe("closed");
    expect(after.properties.gh_closed_at).toEqual({ start: "2026-11-11T12:10:00Z" });
    expect(after.title).toBe("Issue 1, renamed");
    // The issues listing was asked for only what changed since the last pass.
    expect(t.github.calls.at(-1).url.searchParams.get("since")).toBe("2026-11-01T10:00:00Z");
  });

  test("a big first import is spread over cron ticks and carries on where it stopped", async () => {
    const t = await setup();
    const repo = t.github.repo("acme/app");
    for (let number = 1; number <= 260; number++) {
      repo.issues.push(issue(number, { updated_at: new Date(Date.UTC(2026, 9, 1) + number * 60_000).toISOString() }));
    }
    const database = await t.create({ repositories: ["acme/app"], include: ["issues"] });
    const first = await runSync(t.env, database.id);
    expect(first.pending).toBe(true);
    expect(first.created).toBe(200);
    expect((await getSync(t.db, WS, database.id))).toMatchObject({ state: "importing", nextRunAt: "2026-11-11T12:00:00.000Z" });
    t.advance(5);
    expect(await runDueSyncs(t.env)).toBe(1);
    expect((await t.rows(database.id)).length).toBe(260);
    expect((await getSync(t.db, WS, database.id)).state).toBe("synced");
    expect(new Set((await t.rows(database.id)).map((row) => row.properties.gh_number)).size).toBe(260);
  });

  test("the cron only runs syncs that are due, and the wake time covers them", async () => {
    const t = await setup();
    t.github.repo("acme/app").issues.push(issue(1));
    const database = await t.create({ repositories: ["acme/app"], include: ["issues"] });
    expect(await runDueSyncs(t.env)).toBe(1);
    expect(await runDueSyncs(t.env)).toBe(0);
    await refreshWake(t.env);
    expect(t.wakes.at(-1)?.toISOString()).toBe("2026-11-11T12:15:00.000Z");
    await updateSync(t.env, WS, database.id, { paused: true });
    expect(t.wakes.at(-1)).toBe(null);
    expect((await getSync(t.db, WS, database.id))).toMatchObject({ state: "paused", nextRunAt: null });
    t.advance(60);
    expect(await runDueSyncs(t.env)).toBe(0);
  });

  test("rows the sync adds set off the database's automations", async () => {
    const t = await setup();
    t.github.repo("acme/app").issues.push(issue(1));
    const database = await t.create({ repositories: ["acme/app"], include: ["issues"] });
    await updateDatabase(t.db, WS, database.id, { schema: { properties: [...database.schema.properties, { id: "triage", name: "Triage", type: "text" }] } }, ada, "user:usr_ada");
    await createAutomation(t.env, WS, database.id, { name: "Triage", trigger: { type: "page_added" }, actions: [{ type: "edit_property", values: { triage: "New" } }] }, "usr_ada");
    await runSync(t.env, database.id);
    expect((await t.byNumber(database.id, 1)).properties.triage).toBe("New");
  });
});

describe("read only, like Notion's synced properties", () => {
  const synced = async () => {
    const t = await setup();
    t.github.repo("acme/app").issues.push(issue(1));
    const database = await t.create({ repositories: ["acme/app"], include: ["issues"] });
    await runSync(t.env, database.id);
    return { t, database, row: await t.byNumber(database.id, 1) };
  };

  test("GitHub's values and titles can't be edited, and rows can't be added", async () => {
    const { t, database, row } = await synced();
    await expect(updateDatabaseRow(t.db, WS, database.id, row.id, { properties: { gh_state: "closed" } }, ada, "user:usr_ada")).rejects.toMatchObject({ code: "synced_property" });
    await expect(updateDatabaseRow(t.db, WS, database.id, row.id, { title: "Mine" }, ada, "user:usr_ada")).rejects.toMatchObject({ code: "synced_property" });
    await expect(createDatabaseRow(t.db, WS, database.id, { title: "New" }, ada, "user:usr_ada")).rejects.toMatchObject({ code: "synced_database", status: 409 });
  });

  test("people add their own properties beside the synced ones, and those stay editable through syncs", async () => {
    const { t, database, row } = await synced();
    const withOwn = await updateDatabase(t.db, WS, database.id, {
      schema: { properties: [...database.schema.properties, { id: "release", name: "Release", type: "text", synced: { provider: "github", field: "title" } }] },
    }, ada, "user:usr_ada");
    // A property people add can't pretend to be synced.
    expect(withOwn.schema.properties.find((property) => property.id === "release").synced).toBeUndefined();
    await updateDatabaseRow(t.db, WS, database.id, row.id, { properties: { release: "2.21" } }, ada, "user:usr_ada");
    t.github.repo("acme/app").issues[0].updated_at = "2026-11-11T13:00:00Z";
    t.advance(15);
    await runSync(t.env, database.id);
    expect((await t.byNumber(database.id, 1)).properties.release).toBe("2.21");
  });

  test("synced properties can be renamed but not deleted or changed", async () => {
    const { t, database } = await synced();
    const renamed = database.schema.properties.map((property) => (property.id === "gh_state" ? { ...property, name: "Status", type: "text", options: [] } : property));
    const updated = await updateDatabase(t.db, WS, database.id, { schema: { properties: renamed } }, ada, "user:usr_ada");
    const state = updated.schema.properties.find((property) => property.id === "gh_state");
    expect(state).toMatchObject({ name: "Status", type: "select", synced: { provider: "github", field: "state" } });
    expect(state.options.length).toBe(4);
    await expect(updateDatabase(t.db, WS, database.id, { schema: { properties: database.schema.properties.filter((property) => property.id !== "gh_url") } }, ada, "user:usr_ada"))
      .rejects.toMatchObject({ code: "synced_property" });
  });

  test("stopping the sync keeps the rows and makes everything editable", async () => {
    const { t, database, row } = await synced();
    await deleteSync(t.env, WS, database.id);
    const detail = await getDatabase(t.db, WS, database.id);
    expect(detail.sync).toBe(null);
    expect(detail.schema.properties.some((property) => property.synced)).toBe(false);
    await updateDatabaseRow(t.db, WS, database.id, row.id, { properties: { gh_state: "closed" } }, ada, "user:usr_ada");
    expect((await t.rows(database.id)).length).toBe(1);
  });
});

describe("errors are shown, never silent", () => {
  test("a revoked login says to log in again, and is retried hourly", async () => {
    const t = await setup();
    t.github.repo("acme/app").issues.push(issue(1));
    const database = await t.create({ repositories: ["acme/app"], include: ["issues"] });
    t.github.state.revokedConnection = "conn_gh";
    const outcome = await runSync(t.env, database.id);
    expect(outcome.ok).toBe(false);
    const sync = await getSync(t.db, WS, database.id);
    expect(sync.state).toBe("error");
    expect(sync.lastError.code).toBe("connection_lost");
    expect(sync.lastError.message).toContain("Log in to GitHub again");
    expect(sync.nextRunAt).toBe("2026-11-11T13:00:00.000Z");
    expect((await listSyncs(t.db, WS))[0].lastError.code).toBe("connection_lost");
  });

  test("logging in again as the same GitHub account picks the sync back up", async () => {
    const t = await setup({ accounts: [{ id: "conn_gh2", provider: "github", name: "octocat", status: "active" }] });
    t.github.repo("acme/app").issues.push(issue(1));
    const database = await t.create({ repositories: ["acme/app"], include: ["issues"] });
    t.github.state.revokedConnection = "conn_gh";
    expect(await runSync(t.env, database.id)).toMatchObject({ ok: true, created: 1 });
    expect((await getSync(t.db, WS, database.id))).toMatchObject({ connectionId: "conn_gh2", lastError: null });
  });

  test("a repository that went away, rate limits and outages each say what happened", async () => {
    const t = await setup();
    const database = await t.create({ repositories: ["acme/gone"], include: ["issues"] });
    await runSync(t.env, database.id);
    let sync = await getSync(t.db, WS, database.id);
    expect(sync.lastError.code).toBe("repository_unavailable");
    expect(sync.lastError.message).toContain("acme/gone");

    t.github.repo("acme/gone");
    t.github.state.rateLimited = true;
    t.advance(20);
    await runSync(t.env, database.id);
    sync = await getSync(t.db, WS, database.id);
    expect(sync.lastError.code).toBe("rate_limited");
    expect(sync.nextRunAt).toBe(new Date(1794500000 * 1000).toISOString());

    t.github.state.rateLimited = false;
    t.github.state.status = 502;
    await runSync(t.env, database.id);
    sync = await getSync(t.db, WS, database.id);
    expect(sync.lastError.code).toBe("unavailable");

    t.github.state.status = null;
    await runSync(t.env, database.id);
    expect((await getSync(t.db, WS, database.id))).toMatchObject({ lastError: null, state: "synced" });
  });

  test("two runs at once don't both write", async () => {
    const t = await setup();
    t.github.repo("acme/app").issues.push(issue(1));
    const database = await t.create({ repositories: ["acme/app"], include: ["issues"] });
    const [left, right] = await Promise.all([runSync(t.env, database.id), runSync(t.env, database.id)]);
    expect([left.created, right.created].sort()).toEqual([0, 1]);
    expect((await t.rows(database.id)).length).toBe(1);
  });
});

describe("changing what a sync reads", () => {
  test("removing a repository removes its rows; adding one imports it", async () => {
    const t = await setup();
    t.github.repo("acme/app").issues.push(issue(1));
    t.github.repo("acme/web").issues.push(issue(7));
    const database = await t.create({ repositories: ["acme/app", "acme/web"], include: ["issues"] });
    await runSync(t.env, database.id);
    expect((await t.rows(database.id)).length).toBe(2);
    await updateSync(t.env, WS, database.id, { repositories: ["acme/app"] });
    expect((await t.rows(database.id)).map((row) => row.properties.gh_number)).toEqual([1]);
    await updateSync(t.env, WS, database.id, { repositories: ["acme/app", "acme/web"] });
    await runSync(t.env, database.id);
    expect((await t.rows(database.id)).length).toBe(2);
    const repositories = (await getDatabase(t.db, WS, database.id)).schema.properties.find((property) => property.id === "gh_repository").options.map((option) => option.name);
    expect(repositories).toEqual(["acme/app", "acme/web"]);
  });

  test("a history window leaves out, and later removes, items not updated within it", async () => {
    const t = await setup();
    const repo = t.github.repo("acme/app");
    repo.pulls.push(pull(1, { updated_at: "2026-11-10T00:00:00Z" }), pull(2, { updated_at: "2026-07-01T00:00:00Z" }));
    const database = await t.create({ repositories: ["acme/app"], include: ["pull_requests"], history: "30" });
    await runSync(t.env, database.id);
    expect((await t.rows(database.id)).map((row) => row.properties.gh_number)).toEqual([1]);
    t.advance(31 * 24 * 60);
    await runSync(t.env, database.id);
    expect((await t.rows(database.id)).length).toBe(0);
  });
});

test("toSyncedItem ignores things that aren't pull requests or issues", () => {
  expect(toSyncedItem({ number: "x" }, "issue", "acme/app")).toBe(null);
  expect(toSyncedItem({ number: 3, updated_at: "2026-11-01T00:00:00Z", title: "" }, "issue", "acme/app").title).toBe("#3");
});
