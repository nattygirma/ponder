import {
  DATABASE_SYNC_ERROR_CODES,
  GITHUB_SYNC_HISTORY,
  GITHUB_SYNC_KINDS,
  type DatabaseSyncErrorCode,
  type DatabaseSyncInfo,
  type GitHubSyncHistory,
  type GitHubSyncKind,
} from "@ponder/shared";
import type { DatabaseAdapter } from "./storage-contract";

/**
 * Reading database_syncs. Kept apart from the sync engine so the database service can say whether a
 * database is synced (and so read only) without importing the engine, which imports it.
 */

export type SyncSource = { repositories: string[]; include: GitHubSyncKind[]; history: GitHubSyncHistory };

export type SyncRecord = {
  database_id: string;
  workspace_id: string;
  provider: string;
  connection_id: string;
  account_name: string;
  source_json: string;
  status: "active" | "paused";
  etag: string | null;
  cursor: string | null;
  imported: number;
  last_synced_at: string | null;
  last_error: string | null;
  last_error_code: string | null;
  next_run_at: string | null;
  lease_until: string | null;
  created_by: string | null;
  created_at: string;
  updated_at: string;
};

export const SYNC_COLUMNS = `s.database_id, s.workspace_id, s.provider, s.connection_id, s.account_name, s.source_json, s.status, s.etag, s.cursor,
  s.imported, s.last_synced_at, s.last_error, s.last_error_code, s.next_run_at, s.lease_until, s.created_by, s.created_at, s.updated_at`;

export const parseSource = (json: string): SyncSource => {
  let raw: Record<string, unknown> = {};
  try {
    raw = JSON.parse(json) as Record<string, unknown>;
  } catch {
    raw = {};
  }
  const repositories = Array.isArray(raw.repositories) ? raw.repositories.filter((item): item is string => typeof item === "string") : [];
  const include = Array.isArray(raw.include)
    ? raw.include.filter((item): item is GitHubSyncKind => (GITHUB_SYNC_KINDS as readonly string[]).includes(String(item)))
    : [];
  const history = (GITHUB_SYNC_HISTORY as readonly string[]).includes(String(raw.history)) ? raw.history as GitHubSyncHistory : "all";
  return { repositories, include: include.length ? include : ["pull_requests"], history };
};

const errorCode = (code: string | null): DatabaseSyncErrorCode | null =>
  code && (DATABASE_SYNC_ERROR_CODES as readonly string[]).includes(code) ? code as DatabaseSyncErrorCode : null;

export const mapSync = (record: SyncRecord, name: string, itemCount: number): DatabaseSyncInfo => {
  const source = parseSource(record.source_json);
  const code = errorCode(record.last_error_code);
  const lastError = code && record.last_error ? { code, message: record.last_error } : null;
  const paused = record.status === "paused";
  return {
    databaseId: record.database_id,
    provider: "github",
    name,
    connectionId: record.connection_id,
    accountName: record.account_name,
    repositories: source.repositories,
    include: source.include,
    history: source.history,
    paused,
    state: paused ? "paused" : lastError ? "error" : record.imported ? "synced" : "importing",
    lastSyncedAt: record.last_synced_at,
    lastError,
    nextRunAt: paused ? null : record.next_run_at,
    itemCount,
    createdAt: record.created_at,
  };
};

/** True when the database is synced: its synced properties and its rows then come only from the sync. */
export const isSyncedDatabase = async (db: DatabaseAdapter, workspaceId: string, databaseId: string) =>
  Boolean(await db
    .prepare(`SELECT 1 AS synced FROM database_syncs WHERE workspace_id = ? AND database_id = ?`)
    .bind(workspaceId, databaseId)
    .first<{ synced: number }>());

export const loadSyncInfo = async (db: DatabaseAdapter, workspaceId: string, databaseId: string, name: string): Promise<DatabaseSyncInfo | null> => {
  const record = await db
    .prepare(`SELECT ${SYNC_COLUMNS} FROM database_syncs s WHERE s.workspace_id = ? AND s.database_id = ?`)
    .bind(workspaceId, databaseId)
    .first<SyncRecord>();
  if (!record) return null;
  const count = await db
    .prepare(`SELECT COUNT(*) AS total FROM database_sync_items WHERE database_id = ?`)
    .bind(databaseId)
    .first<{ total: number }>();
  return mapSync(record, name, count?.total ?? 0);
};
