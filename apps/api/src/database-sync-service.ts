import {
  DATABASE_OPTION_COLORS,
  DATABASE_ROW_LIMIT,
  GITHUB_KIND_OPTIONS,
  GITHUB_STATE_OPTIONS,
  GITHUB_SYNC_INTERVAL_MINUTES,
  GITHUB_SYNC_PROPERTIES,
  type DatabaseDetail,
  type DatabaseOption,
  type DatabaseProperty,
  type DatabasePropertyValue,
  type DatabaseSchema,
  type DatabaseSyncCreateInput,
  type DatabaseSyncErrorCode,
  type DatabaseSyncInfo,
  type DatabaseSyncUpdateInput,
  type GitHubSyncField,
  type GitHubSyncKind,
} from "@ponder/shared";
import type { AuditActor, Bindings } from "./api-context";
import { AppError } from "./app-error";
import { automationEnvFrom, handleRowChange, refreshWake, type AutomationEnv } from "./automation-service";
import { createDatabase, createDatabaseRow, getDatabase, updateDatabase, updateDatabaseRow, type RowChange } from "./database-service";
import { mapSync, parseSource, SYNC_COLUMNS, type SyncRecord, type SyncSource } from "./database-sync-store";
import { isoNow } from "./entity-utils";
import { deleteMemoSearchDocumentsStatement } from "./memo-search-index";
import { deleteMemosRecord } from "./memo-service";
import type { DatabaseAdapter } from "./storage-contract";

/**
 * GitHub synced databases, like Notion's GitHub "Database sync": pull requests and issues from chosen
 * repositories are copied one way into a database. GitHub's values are read only in Ponder; people add
 * their own properties beside them.
 *
 * How a run reads GitHub, per repository and kind:
 * - Listings are read newest-updated first (Notion: "starting with the most recently updated records"),
 *   100 at a time. Issues are asked for with `since`; pull requests have no `since`, so their listing
 *   stops at the first one older than what was already read.
 * - The first page is asked for with the last ETag, so an unchanged repository costs one request that
 *   GitHub doesn't count against its rate limit (304).
 * - A run reads at most MAX_REQUESTS_PER_RUN pages and writes at most MAX_ITEMS_PER_RUN rows. A big first
 *   import carries on at the next cron tick from the page it reached.
 * - Rows are matched by repository and number (database_sync_items), and only rewritten when GitHub's
 *   Updated At moved.
 *
 * The provider's token never reaches Ponder: requests name the connection and the host adds the token.
 */

const CONNECTION_HEADER = "x-altstack-connection";
const GITHUB_API = "https://api.github.com";
const GITHUB_HEADERS = { accept: "application/vnd.github+json", "user-agent": "Ponder", "x-github-api-version": "2022-11-28" };
const PAGE_SIZE = 100;
const MAX_REQUESTS_PER_RUN = 25;
const MAX_ITEMS_PER_RUN = 150;
const MAX_SYNCS_PER_TICK = 5;
const LEASE_MINUTES = 10;
const REMOVE_BATCH = 100;
const OPTION_LIMIT = 500;
const TEXT_LIMIT = 20_000;
const TITLE_LIMIT = 160;
/** A lost login is retried hourly, not every 15 minutes, so a broken sync doesn't keep waking the app. */
const LOST_RETRY_MINUTES = 60;
/** A database in Trash keeps its sync but is only looked at daily, in case it comes back. */
const TRASHED_RETRY_MINUTES = 24 * 60;

export const SYNC_ACTOR: AuditActor = { actorType: "agent", actorId: null };
const SYNC_LABEL = "sync:github";

export type SyncEnv = AutomationEnv & {
  /** Calls GitHub through the host, which adds the connection's token. */
  fetch: (url: string, init: RequestInit) => Promise<Response>;
  listConnections?: Bindings["listConnections"];
  /** Moves rows that left the sync (a removed repository, a shorter history) to Trash. */
  trashRows?: (workspaceId: string, rowIds: string[]) => Promise<void>;
};

export const syncEnvFrom = (env: Bindings): SyncEnv => ({
  ...automationEnvFrom(env),
  fetch: (url, init) => fetch(url, init),
  listConnections: env.listConnections,
  trashRows: async (workspaceId, rowIds) => {
    // Rows someone already moved to Trash are left as they are.
    const live = await env.storage.db
      .prepare(`SELECT id FROM memos WHERE workspace_id = ? AND is_deleted = 0 AND id IN (${rowIds.map(() => "?").join(", ")})`)
      .bind(workspaceId, ...rowIds)
      .all<{ id: string }>();
    if (live.results.length) await deleteMemosRecord(env, workspaceId, live.results.map((row) => row.id), false, SYNC_ACTOR);
  },
});

type Json = Record<string, any>;

class SyncError extends Error {
  constructor(readonly code: DatabaseSyncErrorCode, message: string, readonly retryAt: Date | null = null) {
    super(message);
  }
}

type StreamState = { cursor?: string; page?: number; maxSeen?: string; since?: string };
type Progress = Record<string, StreamState>;
type ETags = Record<string, { url: string; etag: string }>;

const minutesFrom = (date: Date, minutes: number) => new Date(date.getTime() + minutes * 60_000).toISOString();

const parseJsonObject = <T>(json: string | null): T => {
  if (!json) return {} as T;
  try {
    const parsed = JSON.parse(json) as unknown;
    return (parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed : {}) as T;
  } catch {
    return {} as T;
  }
};

const streamKey = (repository: string, kind: GitHubSyncKind) => `${repository.toLowerCase()}|${kind}`;
const itemKey = (repository: string, number: number) => `${repository.toLowerCase()}#${number}`;

// ---------------------------------------------------------------------------
// The synced schema
// ---------------------------------------------------------------------------

/** A stable option id for a name GitHub gives (a label, a login, a repository). */
export const optionIdFor = (field: string, name: string) => {
  let hash = 0x811c9dc5;
  for (const char of `${field}:${name.toLowerCase()}`) {
    hash ^= char.codePointAt(0)!;
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return `${field.slice(0, 1)}${hash.toString(16).padStart(8, "0")}`;
};

const colorFor = (id: string) => DATABASE_OPTION_COLORS[parseInt(id.slice(-4), 16) % DATABASE_OPTION_COLORS.length]!;

export const createSyncedSchema = (repositories: string[]): DatabaseSchema => ({
  properties: GITHUB_SYNC_PROPERTIES.map((spec): DatabaseProperty => {
    const property: DatabaseProperty = { id: spec.id, name: spec.name, type: spec.type, synced: { provider: "github", field: spec.field } };
    if (spec.field === "state") property.options = GITHUB_STATE_OPTIONS.map((option) => ({ ...option }));
    if (spec.field === "kind") property.options = GITHUB_KIND_OPTIONS.map((option) => ({ ...option }));
    if (spec.field === "repository") property.options = repositories.map((name) => ({ id: optionIdFor("repository", name), name, color: "gray" as const }));
    if (spec.type === "multi_select") property.options = [];
    return property;
  }),
});

/** A pull request or issue, as the values of a row. Names for select options are resolved to ids later. */
type SyncedItem = {
  key: string;
  kind: "pull_request" | "issue";
  repository: string;
  updatedAt: string;
  title: string;
  values: Partial<Record<GitHubSyncField, DatabasePropertyValue>>;
  /** Option names per select field, before they have ids. */
  names: { repository: string; assignees: string[]; labels: string[] };
};

const date = (value: unknown) => (typeof value === "string" && value ? { start: value } : null);
const text = (value: unknown, limit = TEXT_LIMIT) => (typeof value === "string" && value ? value.slice(0, limit) : null);
const logins = (people: unknown) => (Array.isArray(people) ? people.map((person: Json) => String(person?.login ?? "")).filter(Boolean) : []);
const labelNames = (labels: unknown) =>
  (Array.isArray(labels) ? labels.map((label: Json | string) => String(typeof label === "string" ? label : label?.name ?? "")).filter(Boolean) : []);

/** Notion's states: Open, Draft, Merged or Closed. */
const stateOf = (item: Json, kind: "pull_request" | "issue") => {
  const merged = kind === "pull_request" && Boolean(item.merged_at ?? item.pull_request?.merged_at);
  if (merged) return "merged";
  if (item.state === "closed") return "closed";
  return kind === "pull_request" && item.draft === true ? "draft" : "open";
};

export const toSyncedItem = (item: Json, kind: "pull_request" | "issue", repository: string): SyncedItem | null => {
  const number = Number(item.number);
  if (!Number.isInteger(number) || number <= 0 || typeof item.updated_at !== "string") return null;
  const assignees = logins(item.assignees);
  const labels = labelNames(item.labels);
  return {
    key: itemKey(repository, number),
    kind,
    repository,
    updatedAt: item.updated_at,
    title: String(item.title ?? "").slice(0, TITLE_LIMIT) || `#${number}`,
    values: {
      number,
      state: stateOf(item, kind),
      kind: kind,
      author: text(item.user?.login, 200),
      base_branch: kind === "pull_request" ? text(item.base?.ref, 300) : null,
      head_branch: kind === "pull_request" ? text(item.head?.ref, 300) : null,
      created_at: date(item.created_at),
      updated_at: date(item.updated_at),
      closed_at: date(item.closed_at),
      merged_at: kind === "pull_request" ? date(item.merged_at ?? item.pull_request?.merged_at) : null,
      url: text(item.html_url, 2000),
      // Copied exactly as written, not rendered as Markdown, like Notion's Description.
      description: text(item.body),
    },
    names: { repository, assignees, labels },
  };
};

/**
 * Adds options for labels, people and repositories the database hasn't seen, and turns each item's names
 * into option ids. Returns the new schema when it changed.
 */
const resolveOptions = (schema: DatabaseSchema, items: SyncedItem[]) => {
  let changed = false;
  const properties = schema.properties.map((property) => ({ ...property, options: property.options ? [...property.options] : property.options }));
  const byField = (field: GitHubSyncField) => properties.find((property) => property.synced?.field === field);
  const idsFor = (field: "repository" | "assignees" | "labels", names: string[]) => {
    const property = byField(field);
    if (!property) return [];
    const options = property.options ?? (property.options = []);
    const ids: string[] = [];
    for (const name of names) {
      const id = optionIdFor(field, name);
      if (!options.some((option) => option.id === id)) {
        if (options.length >= OPTION_LIMIT) continue;
        const option: DatabaseOption = { id, name: name.slice(0, 120), color: field === "repository" ? "gray" : colorFor(id) };
        options.push(option);
        changed = true;
      }
      ids.push(id);
    }
    return ids;
  };
  const rows = items.map((item) => {
    const values: Record<string, DatabasePropertyValue> = {};
    for (const spec of GITHUB_SYNC_PROPERTIES) {
      if (spec.field === "title") continue;
      const property = properties.find((candidate) => candidate.synced?.field === spec.field);
      if (!property) continue;
      if (spec.field === "repository") values[property.id] = idsFor("repository", [item.names.repository])[0] ?? null;
      else if (spec.field === "assignees") values[property.id] = idsFor("assignees", item.names.assignees);
      else if (spec.field === "labels") values[property.id] = idsFor("labels", item.names.labels);
      else values[property.id] = item.values[spec.field] ?? null;
    }
    return { item, values };
  });
  return { rows, schema: changed ? { ...schema, properties } : null };
};

// ---------------------------------------------------------------------------
// Calling GitHub
// ---------------------------------------------------------------------------

const readBody = async (response: Response): Promise<unknown> => {
  try {
    return await response.json();
  } catch {
    return null;
  }
};

const failure = async (response: Response, repository: string, accountName: string, now: Date): Promise<SyncError> => {
  const body = await readBody(response) as Json | null;
  const message = typeof body?.message === "string" ? body.message : typeof body?.error?.message === "string" ? body.error.message : "";
  // The host answers 401 itself (code connection_unavailable) when the login is gone or can't be renewed;
  // GitHub answers 401 "Bad credentials" when the person revoked Ponder's access.
  if (response.status === 401) {
    return new SyncError("connection_lost", `Ponder can't reach GitHub with ${accountName ? `the login for ${accountName}` : "this login"}. Log in to GitHub again to keep this database up to date.`);
  }
  const remaining = response.headers.get("x-ratelimit-remaining");
  if (response.status === 429 || (response.status === 403 && (remaining === "0" || /rate limit/i.test(message)))) {
    const reset = Number(response.headers.get("x-ratelimit-reset"));
    const retryAfter = Number(response.headers.get("retry-after"));
    const retryAt = Number.isFinite(reset) && reset > 0
      ? new Date(reset * 1000)
      : new Date(now.getTime() + (Number.isFinite(retryAfter) && retryAfter > 0 ? retryAfter * 1000 : 15 * 60_000));
    return new SyncError("rate_limited", "GitHub asked Ponder to slow down. The sync carries on by itself once GitHub allows it.", retryAt);
  }
  if (response.status === 403 || response.status === 404 || response.status === 410 || response.status === 451) {
    return new SyncError("repository_unavailable", `${repository} can't be read any more. It may have been renamed, moved or deleted, or this GitHub login lost access to it. Check the repository on GitHub, then sync again.`);
  }
  return new SyncError("unavailable", `GitHub didn't answer as expected (${response.status}${message ? `: ${message.slice(0, 200)}` : ""}). Ponder tries again in ${GITHUB_SYNC_INTERVAL_MINUTES} minutes.`);
};

const callGitHub = async (env: SyncEnv, connectionId: string, url: string, etag: string | undefined) => {
  const headers: Record<string, string> = { ...GITHUB_HEADERS, [CONNECTION_HEADER]: connectionId };
  if (etag) headers["if-none-match"] = etag;
  try {
    return await env.fetch(url, { headers });
  } catch {
    throw new SyncError("unavailable", `GitHub couldn't be reached. Ponder tries again in ${GITHUB_SYNC_INTERVAL_MINUTES} minutes.`);
  }
};

const hasNextPage = (response: Response) => /rel="next"/.test(response.headers.get("link") ?? "");

// ---------------------------------------------------------------------------
// Storage
// ---------------------------------------------------------------------------

const loadRecord = (db: DatabaseAdapter, databaseId: string) =>
  db.prepare(`SELECT ${SYNC_COLUMNS} FROM database_syncs s WHERE s.database_id = ?`).bind(databaseId).first<SyncRecord>();

const requireRecord = async (db: DatabaseAdapter, workspaceId: string, databaseId: string) => {
  const record = await loadRecord(db, databaseId);
  if (!record || record.workspace_id !== workspaceId) throw new AppError("not_found", "This database isn't synced from GitHub.", 404);
  return record;
};

export const getSync = async (db: DatabaseAdapter, workspaceId: string, databaseId: string): Promise<DatabaseSyncInfo> => {
  const record = await requireRecord(db, workspaceId, databaseId);
  const [database, count] = await Promise.all([
    getDatabase(db, workspaceId, databaseId).catch(() => null),
    db.prepare(`SELECT COUNT(*) AS total FROM database_sync_items WHERE database_id = ?`).bind(databaseId).first<{ total: number }>(),
  ]);
  return mapSync(record, database?.title ?? "", count?.total ?? 0);
};

/** The workspace's syncs, for Settings: Connections → GitHub → Your syncs. Syncs of databases in Trash are left out. */
export const listSyncs = async (db: DatabaseAdapter, workspaceId: string): Promise<DatabaseSyncInfo[]> => {
  const result = await db
    .prepare(
      `SELECT ${SYNC_COLUMNS}, m.title AS page_title,
         (SELECT COUNT(*) FROM database_sync_items i WHERE i.database_id = s.database_id) AS item_count
       FROM database_syncs s
       INNER JOIN databases d ON d.id = s.database_id
       INNER JOIN memos m ON m.id = d.page_memo_id
       WHERE s.workspace_id = ? AND m.is_deleted = 0
       ORDER BY s.created_at ASC`
    )
    .bind(workspaceId)
    .all<SyncRecord & { page_title: string | null; item_count: number }>();
  return result.results.map((record) => mapSync(record, record.page_title ?? "", record.item_count));
};

// ---------------------------------------------------------------------------
// Creating and changing a sync
// ---------------------------------------------------------------------------

/**
 * Makes the synced database and its sync. The first import starts right away (the route runs it after
 * answering) and carries on through the cron until every page has been read.
 */
export const createGitHubSync = async (
  env: SyncEnv,
  workspaceId: string,
  input: DatabaseSyncCreateInput & { notebookId: string },
  account: { id: string; name: string },
  actor: AuditActor,
  actorLabel: string,
): Promise<DatabaseDetail> => {
  const repositories = [...new Set(input.repositories.map((name) => name.trim()))];
  const source: SyncSource = { repositories, include: [...new Set(input.include)], history: input.history ?? "all" };
  const title = input.name?.trim() || (repositories.length === 1 ? repositories[0]! : "GitHub");
  const database = await createDatabase(env.db, workspaceId, { notebookId: input.notebookId, title, schema: createSyncedSchema(repositories) }, actor, actorLabel);
  const now = env.now();
  await env.db
    .prepare(
      `INSERT INTO database_syncs (database_id, workspace_id, provider, connection_id, account_name, source_json, status, next_run_at, created_by, created_at, updated_at)
       VALUES (?, ?, 'github', ?, ?, ?, 'active', ?, ?, ?, ?)`
    )
    .bind(database.id, workspaceId, account.id, account.name, JSON.stringify(source), now.toISOString(), actorLabel, now.toISOString(), now.toISOString())
    .run();
  await refreshWake(env);
  return getDatabase(env.db, workspaceId, database.id);
};

const kindOf = (kind: GitHubSyncKind) => (kind === "issues" ? "issue" : "pull_request");

/**
 * Notion's sync settings: repositories, what to include and the history window, and Pause/Resume.
 * Removing a repository or a kind removes its rows; a change to what is read reads everything again.
 */
export const updateSync = async (env: SyncEnv, workspaceId: string, databaseId: string, input: DatabaseSyncUpdateInput): Promise<DatabaseSyncInfo> => {
  const record = await requireRecord(env.db, workspaceId, databaseId);
  const before = parseSource(record.source_json);
  const next: SyncSource = {
    repositories: input.repositories ? [...new Set(input.repositories.map((name) => name.trim()))] : before.repositories,
    include: input.include ? [...new Set(input.include)] : before.include,
    history: input.history ?? before.history,
  };
  const sourceChanged = JSON.stringify(next) !== JSON.stringify(before);
  const status = input.paused === undefined ? record.status : input.paused ? "paused" : "active";
  const now = env.now().toISOString();
  await env.db
    .prepare(
      `UPDATE database_syncs SET source_json = ?, status = ?, next_run_at = ?, updated_at = ?,
         etag = CASE WHEN ? THEN NULL ELSE etag END, cursor = CASE WHEN ? THEN NULL ELSE cursor END,
         last_error = CASE WHEN ? THEN NULL ELSE last_error END, last_error_code = CASE WHEN ? THEN NULL ELSE last_error_code END
       WHERE database_id = ?`
    )
    .bind(JSON.stringify(next), status, status === "active" ? (sourceChanged || record.status === "paused" ? now : record.next_run_at ?? now) : null, now,
      sourceChanged ? 1 : 0, sourceChanged ? 1 : 0, sourceChanged ? 1 : 0, sourceChanged ? 1 : 0, databaseId)
    .run();
  if (sourceChanged) {
    const keepRepositories = new Set(next.repositories.map((name) => name.toLowerCase()));
    const keepKinds = new Set(next.include.map(kindOf));
    const items = await env.db
      .prepare(`SELECT item_key, row_id, repository, kind FROM database_sync_items WHERE database_id = ?`)
      .bind(databaseId)
      .all<{ item_key: string; row_id: string; repository: string; kind: "pull_request" | "issue" }>();
    const leaving = items.results.filter((item) => !keepRepositories.has(item.repository.toLowerCase()) || !keepKinds.has(item.kind));
    await removeItems(env, workspaceId, databaseId, leaving);
    // New repositories get their own option on the Repository property.
    const database = await getDatabase(env.db, workspaceId, databaseId);
    const added = next.repositories.filter((name) => !before.repositories.some((old) => old.toLowerCase() === name.toLowerCase()));
    if (added.length) {
      const { schema } = resolveOptions(database.schema, added.map((repository) => ({
        key: "", kind: "issue", repository, updatedAt: "", title: "", values: {}, names: { repository, assignees: [], labels: [] },
      })));
      if (schema) await updateDatabase(env.db, workspaceId, databaseId, { schema }, SYNC_ACTOR, SYNC_LABEL, { syncWrite: true });
    }
  }
  await refreshWake(env);
  return getSync(env.db, workspaceId, databaseId);
};

/** Stops syncing. The database and its rows stay, and every property becomes editable again. */
export const deleteSync = async (env: SyncEnv, workspaceId: string, databaseId: string) => {
  await requireRecord(env.db, workspaceId, databaseId);
  const database = await getDatabase(env.db, workspaceId, databaseId);
  await env.db.batch([
    env.db.prepare(`DELETE FROM database_sync_items WHERE database_id = ?`).bind(databaseId),
    env.db.prepare(`DELETE FROM database_syncs WHERE database_id = ?`).bind(databaseId),
  ]);
  const schema = { ...database.schema, properties: database.schema.properties.map(({ synced: _synced, ...property }) => property) };
  await updateDatabase(env.db, workspaceId, databaseId, { schema }, SYNC_ACTOR, SYNC_LABEL, { syncWrite: true });
  await refreshWake(env);
};

const removeItems = async (env: SyncEnv, workspaceId: string, databaseId: string, items: { item_key: string; row_id: string }[]) => {
  for (let index = 0; index < items.length; index += REMOVE_BATCH) {
    const chunk = items.slice(index, index + REMOVE_BATCH);
    const rowIds = chunk.map((item) => item.row_id);
    const keys = chunk.map((item) => item.item_key);
    if (env.trashRows) await env.trashRows(workspaceId, rowIds);
    else {
      const now = env.now().toISOString();
      const placeholders = rowIds.map(() => "?").join(", ");
      await env.db.batch([
        env.db.prepare(`UPDATE memos SET is_deleted = 1, deleted_at = ?, updated_at = ? WHERE workspace_id = ? AND is_deleted = 0 AND database_id = ? AND id IN (${placeholders})`)
          .bind(now, now, workspaceId, databaseId, ...rowIds),
        deleteMemoSearchDocumentsStatement(env.db, rowIds),
      ]);
    }
    await env.db
      .prepare(`DELETE FROM database_sync_items WHERE database_id = ? AND item_key IN (${keys.map(() => "?").join(", ")})`)
      .bind(databaseId, ...keys)
      .run();
  }
};

// ---------------------------------------------------------------------------
// Running a sync
// ---------------------------------------------------------------------------

type RunOutcome = { ok: boolean; created: number; updated: number; removed: number; pending: boolean; error: string | null };

/** Holds the sync for this run; false when another run has it. */
const claim = async (db: DatabaseAdapter, databaseId: string, now: Date) =>
  Boolean(await db
    .prepare(`UPDATE database_syncs SET lease_until = ? WHERE database_id = ? AND (lease_until IS NULL OR lease_until < ?) RETURNING database_id`)
    .bind(minutesFrom(now, LEASE_MINUTES), databaseId, now.toISOString())
    .first<{ database_id: string }>());

/** Writes one page of items: new ones become rows, changed ones are updated, unchanged ones are skipped. */
const writeItems = async (
  env: SyncEnv,
  record: SyncRecord,
  database: DatabaseDetail,
  items: SyncedItem[],
  changes: RowChange[],
  counts: { created: number; updated: number },
) => {
  if (items.length === 0) return database;
  const known = new Map<string, { row_id: string; source_updated_at: string }>();
  const keys = items.map((item) => item.key);
  const stored = await env.db
    .prepare(`SELECT item_key, row_id, source_updated_at FROM database_sync_items WHERE database_id = ? AND item_key IN (${keys.map(() => "?").join(", ")})`)
    .bind(record.database_id, ...keys)
    .all<{ item_key: string; row_id: string; source_updated_at: string }>();
  for (const row of stored.results) known.set(row.item_key, row);
  const fresh = items.filter((item) => known.get(item.key)?.source_updated_at !== item.updatedAt);
  if (fresh.length === 0) return database;

  const resolved = resolveOptions(database.schema, fresh);
  let current = database;
  if (resolved.schema) current = await updateDatabase(env.db, record.workspace_id, record.database_id, { schema: resolved.schema }, SYNC_ACTOR, SYNC_LABEL, { syncWrite: true });
  const options = { syncWrite: true, onRowChange: (change: RowChange) => changes.push(change) };

  for (const { item, values } of resolved.rows) {
    const existing = known.get(item.key);
    let rowId: string | null = null;
    if (existing) {
      const row = await env.db
        .prepare(`SELECT title, is_deleted FROM memos WHERE workspace_id = ? AND id = ? AND database_id = ?`)
        .bind(record.workspace_id, existing.row_id, record.database_id)
        .first<{ title: string | null; is_deleted: number }>();
      // A row someone moved to Trash stays there; it is only made again if it was deleted for good.
      if (row?.is_deleted === 1) {
        rowId = existing.row_id;
      } else if (row) {
        await updateDatabaseRow(env.db, record.workspace_id, record.database_id, existing.row_id, {
          ...(row.title !== item.title ? { title: item.title } : {}),
          properties: values,
        }, SYNC_ACTOR, SYNC_LABEL, options);
        rowId = existing.row_id;
        counts.updated += 1;
      }
    }
    if (!rowId) {
      const count = await env.db
        .prepare(`SELECT COUNT(*) AS total FROM memos WHERE workspace_id = ? AND database_id = ? AND is_deleted = 0`)
        .bind(record.workspace_id, record.database_id)
        .first<{ total: number }>();
      if ((count?.total ?? 0) >= DATABASE_ROW_LIMIT) {
        throw new SyncError("database_full", `This database holds the most rows a database can (${DATABASE_ROW_LIMIT}). Choose fewer repositories or a shorter history to keep syncing.`);
      }
      const row = await createDatabaseRow(env.db, record.workspace_id, record.database_id, { title: item.title, properties: values }, SYNC_ACTOR, SYNC_LABEL, options);
      rowId = row.id;
      counts.created += 1;
    }
    await env.db
      .prepare(
        `INSERT INTO database_sync_items (database_id, item_key, kind, repository, row_id, source_updated_at) VALUES (?, ?, ?, ?, ?, ?)
         ON CONFLICT(database_id, item_key) DO UPDATE SET row_id = excluded.row_id, source_updated_at = excluded.source_updated_at, kind = excluded.kind, repository = excluded.repository`
      )
      .bind(record.database_id, item.key, item.kind, item.repository, rowId, item.updatedAt)
      .run();
  }
  return current;
};

const historyStart = (history: SyncSource["history"], now: Date) =>
  history === "all" ? null : new Date(now.getTime() - Number(history) * 86_400_000).toISOString();

const laterOf = (left: string | undefined, right: string | null | undefined) => (!left ? right ?? undefined : !right ? left : left > right ? left : right);

/**
 * One pass over every repository and kind, within this run's budget. Progress, ETags and the outcome are
 * saved even when GitHub refuses part way, so the next run carries on where this one stopped.
 */
const runPass = async (env: SyncEnv, record: SyncRecord, changes: RowChange[]) => {
  const source = parseSource(record.source_json);
  const progress = parseJsonObject<Progress>(record.cursor);
  const etags = parseJsonObject<ETags>(record.etag);
  const now = env.now();
  const windowStart = historyStart(source.history, now);
  const counts = { created: 0, updated: 0 };
  const budget = { requests: 0, items: 0 };
  let pending = false;
  let database = await getDatabase(env.db, record.workspace_id, record.database_id);
  let error: SyncError | null = null;

  try {
    for (const repository of source.repositories) {
      for (const kind of source.include) {
        const key = streamKey(repository, kind);
        const state: StreamState = { ...progress[key] };
        // Issues can be asked for by date; pull requests are read until one is older than the last pass.
        const since = laterOf(state.cursor, windowStart);
        let page = state.page ?? 1;
        if (page === 1) state.since = since;
        for (;;) {
          if (budget.requests >= MAX_REQUESTS_PER_RUN || budget.items >= MAX_ITEMS_PER_RUN) {
            state.page = page;
            pending = true;
            break;
          }
          const [owner, name] = repository.split("/");
          const base = `${GITHUB_API}/repos/${encodeURIComponent(owner!)}/${encodeURIComponent(name!)}`;
          const query = new URLSearchParams({ state: "all", sort: "updated", direction: "desc", per_page: String(PAGE_SIZE), page: String(page) });
          if (kind === "issues" && state.since) query.set("since", state.since);
          const url = `${base}/${kind === "issues" ? "issues" : "pulls"}?${query}`;
          const remembered = page === 1 && etags[key]?.url === url ? etags[key]!.etag : undefined;
          budget.requests += 1;
          const response = await callGitHub(env, record.connection_id, url, remembered);
          if (response.status === 304) {
            // Nothing changed since the last pass.
            delete state.page;
            delete state.maxSeen;
            break;
          }
          if (!response.ok) throw await failure(response, repository, record.account_name, now);
          if (page === 1) {
            const etag = response.headers.get("etag");
            if (etag) etags[key] = { url, etag };
          }
          const body = await readBody(response);
          const raw = Array.isArray(body) ? body as Json[] : [];
          let reachedOld = false;
          const items: SyncedItem[] = [];
          for (const entry of raw) {
            const updatedAt = typeof entry.updated_at === "string" ? entry.updated_at : "";
            state.maxSeen = laterOf(state.maxSeen, updatedAt);
            if (kind === "pull_requests" && state.since && updatedAt < state.since) {
              reachedOld = true;
              continue;
            }
            // The issues listing has pull requests in it too; they come from their own listing.
            if (kind === "issues" && entry.pull_request) continue;
            const item = toSyncedItem(entry, kindOf(kind), repository);
            if (item) items.push(item);
          }
          budget.items += items.length;
          database = await writeItems(env, record, database, items, changes, counts);
          if (reachedOld || !hasNextPage(response) || raw.length === 0) {
            state.cursor = laterOf(state.cursor, state.maxSeen);
            delete state.page;
            delete state.maxSeen;
            break;
          }
          page += 1;
        }
        progress[key] = state;
        if (pending) break;
      }
      if (pending) break;
    }
  } catch (cause) {
    if (!(cause instanceof SyncError)) throw cause;
    error = cause;
  }

  // Notion removes pages that fall outside the history window, own properties included.
  let removed = 0;
  if (!error && windowStart) {
    const old = await env.db
      .prepare(`SELECT item_key, row_id FROM database_sync_items WHERE database_id = ? AND source_updated_at < ? LIMIT ?`)
      .bind(record.database_id, windowStart, REMOVE_BATCH)
      .all<{ item_key: string; row_id: string }>();
    await removeItems(env, record.workspace_id, record.database_id, old.results);
    removed = old.results.length;
  }

  return { progress, etags, pending, error, counts, removed };
};

/** The outcome of a run is saved with when the next one is due. */
const finishRun = async (env: SyncEnv, record: SyncRecord, pass: Awaited<ReturnType<typeof runPass>>) => {
  const now = env.now();
  const { error, pending } = pass;
  const next = error
    ? error.retryAt?.toISOString() ?? minutesFrom(now, error.code === "connection_lost" ? LOST_RETRY_MINUTES : GITHUB_SYNC_INTERVAL_MINUTES)
    // A first import or a big change carries on at the next cron tick.
    : pending ? now.toISOString() : minutesFrom(now, GITHUB_SYNC_INTERVAL_MINUTES);
  await env.db
    .prepare(
      `UPDATE database_syncs SET etag = ?, cursor = ?, next_run_at = CASE WHEN status = 'active' THEN ? ELSE NULL END, lease_until = NULL,
         last_error = ?, last_error_code = ?, last_synced_at = CASE WHEN ? THEN ? ELSE last_synced_at END,
         imported = CASE WHEN ? THEN 1 ELSE imported END, updated_at = ?
       WHERE database_id = ?`
    )
    .bind(JSON.stringify(pass.etags), JSON.stringify(pass.progress), next, error?.message ?? null, error?.code ?? null,
      error ? 0 : 1, now.toISOString(), !error && !pending ? 1 : 0, now.toISOString(), record.database_id)
    .run();
  if (error) console.warn(`GitHub sync for ${record.database_id}: ${error.code}: ${error.message}`);
};

/**
 * A login that stopped working may have been replaced by logging in again as the same GitHub account,
 * which can give the connection a new id. The sync then follows it, as Notion's "Reconnect" does.
 */
const followReconnectedLogin = async (env: SyncEnv, record: SyncRecord) => {
  if (!env.listConnections || !record.account_name) return null;
  const accounts = await env.listConnections("github").catch(() => []);
  const replacement = accounts.find((account) => account.status === "active" && account.name === record.account_name && account.id !== record.connection_id);
  if (!replacement) return null;
  await env.db.prepare(`UPDATE database_syncs SET connection_id = ? WHERE database_id = ?`).bind(replacement.id, record.database_id).run();
  return { ...record, connection_id: replacement.id };
};

export const runSync = async (env: SyncEnv, databaseId: string): Promise<RunOutcome> => {
  let record = await loadRecord(env.db, databaseId);
  if (!record) throw new AppError("not_found", "This database isn't synced from GitHub.", 404);
  const now = env.now();
  if (!(await claim(env.db, databaseId, now))) {
    return { ok: false, created: 0, updated: 0, removed: 0, pending: true, error: "A sync of this database is already running." };
  }
  const trashed = await env.db
    .prepare(`SELECT m.is_deleted FROM databases d INNER JOIN memos m ON m.id = d.page_memo_id WHERE d.id = ?`)
    .bind(databaseId)
    .first<{ is_deleted: number }>();
  if (!trashed || trashed.is_deleted === 1) {
    await env.db.prepare(`UPDATE database_syncs SET lease_until = NULL, next_run_at = CASE WHEN status = 'active' THEN ? ELSE NULL END WHERE database_id = ?`)
      .bind(minutesFrom(now, TRASHED_RETRY_MINUTES), databaseId).run();
    return { ok: false, created: 0, updated: 0, removed: 0, pending: false, error: "The database is in Trash." };
  }
  const changes: RowChange[] = [];
  let pass;
  try {
    pass = await runPass(env, record, changes);
    if (pass.error?.code === "connection_lost") {
      const followed = await followReconnectedLogin(env, record);
      if (followed) {
        record = followed;
        pass = await runPass(env, record, changes);
      }
    }
    await finishRun(env, record, pass);
  } catch (cause) {
    // Something unexpected: let the next tick try again rather than holding the lease for ten minutes.
    await env.db.prepare(`UPDATE database_syncs SET lease_until = NULL, next_run_at = ? WHERE database_id = ?`)
      .bind(minutesFrom(now, GITHUB_SYNC_INTERVAL_MINUTES), databaseId).run();
    throw cause;
  }
  // Rows the sync added or changed set off the database's automations, as a person's edits do.
  for (const change of changes) await handleRowChange(env, change).catch((error: unknown) => console.error("Automation after GitHub sync failed", error));
  return {
    ok: !pass.error,
    created: pass.counts.created,
    updated: pass.counts.updated,
    removed: pass.removed,
    pending: pass.pending,
    error: pass.error?.message ?? null,
  };
};

/** The cron's share: syncs that are due, a few per tick. The caller refreshes the wake time afterwards. */
export const runDueSyncs = async (env: SyncEnv) => {
  const now = env.now().toISOString();
  const due = await env.db
    .prepare(
      `SELECT database_id FROM database_syncs
       WHERE status = 'active' AND next_run_at IS NOT NULL AND next_run_at <= ? AND (lease_until IS NULL OR lease_until < ?)
       ORDER BY next_run_at LIMIT ?`
    )
    .bind(now, now, MAX_SYNCS_PER_TICK)
    .all<{ database_id: string }>();
  let ran = 0;
  for (const { database_id: databaseId } of due.results) {
    try {
      await runSync(env, databaseId);
      ran += 1;
    } catch (error) {
      console.error(`GitHub sync for ${databaseId} failed`, error);
    }
  }
  return ran;
};
