import {
  DatabaseSchemaSchema,
  DatabaseViewConfigSchema,
  DATABASE_VIEW_TYPES,
  type JsonBackupComment,
  type JsonBackupDatabase,
  type JsonBackupDatabaseView,
  type JsonBackupPageNode,
  type JsonBackupPages,
  type TiptapDoc,
} from "@ponder/shared";
import { AppError } from "./app-error";
import { replaceMemoLinksStatements } from "./page-service";
import type { DatabaseAdapter, PreparedStatementAdapter } from "./storage-contract";

/*
 * Backs up and restores what turns notes into Notion-style pages: where each page sits in the
 * tree, its icon, cover and style, databases with their views and row values, and comments.
 * Notes keep their IDs through a backup, so this only ever points at memo IDs.
 * Page permissions are left out: they name team members, who belong to the workspace, not the backup.
 */

// D1 allows 100 bound parameters per statement.
const ID_CHUNK = 90;
const BATCH_SIZE = 50;

const chunks = <T>(items: T[], size: number) => {
  const out: T[][] = [];
  for (let index = 0; index < items.length; index += size) out.push(items.slice(index, index + size));
  return out;
};

const parseObject = (raw: string | null): Record<string, unknown> | null => {
  if (!raw) return null;
  try {
    const value = JSON.parse(raw) as unknown;
    return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : null;
  } catch {
    return null;
  }
};

const parseStringArray = (raw: string | null) => {
  try {
    const value = JSON.parse(raw ?? "[]") as unknown;
    return Array.isArray(value) ? value.filter((item): item is string => typeof item === "string") : [];
  } catch {
    return [];
  }
};

type PageBackupRow = {
  id: string;
  parent_memo_id: string | null;
  page_position: number | null;
  page_icon: string | null;
  page_cover: string | null;
  page_style: string | null;
  database_id: string | null;
  properties_json: string | null;
};

type DatabaseBackupRow = { id: string; page_memo_id: string; schema_json: string; created_at: string; updated_at: string };
type ViewBackupRow = { id: string; database_id: string; name: string; type: string; config_json: string; position: number; created_at: string; updated_at: string };
type CommentBackupRow = {
  id: string; memo_id: string; thread_id: string; quote: string | null; quote_occurrence: number; body: string;
  mentions_json: string; author_id: string | null; author_name: string; resolved_at: string | null; created_at: string; updated_at: string;
};

/** Everything a backup needs beyond the notes themselves, for the notes not in Trash. */
export const readPageBackup = async (db: DatabaseAdapter, workspaceId: string): Promise<JsonBackupPages> => {
  const [pages, databases, views, comments] = await Promise.all([
    db.prepare(
      `SELECT id, parent_memo_id, page_position, page_icon, page_cover, page_style, database_id, properties_json
       FROM memos WHERE workspace_id = ? AND is_deleted = 0 ORDER BY id ASC`,
    ).bind(workspaceId).all<PageBackupRow>(),
    db.prepare(
      `SELECT d.id, d.page_memo_id, d.schema_json, d.created_at, d.updated_at
       FROM databases d INNER JOIN memos m ON m.id = d.page_memo_id
       WHERE d.workspace_id = ? AND m.is_deleted = 0 ORDER BY d.id ASC`,
    ).bind(workspaceId).all<DatabaseBackupRow>(),
    db.prepare(
      `SELECT v.id, v.database_id, v.name, v.type, v.config_json, v.position, v.created_at, v.updated_at
       FROM database_views v
       INNER JOIN databases d ON d.id = v.database_id
       INNER JOIN memos m ON m.id = d.page_memo_id
       WHERE v.workspace_id = ? AND m.is_deleted = 0 ORDER BY v.database_id ASC, v.position ASC, v.id ASC`,
    ).bind(workspaceId).all<ViewBackupRow>(),
    db.prepare(
      `SELECT c.id, c.memo_id, c.thread_id, c.quote, c.quote_occurrence, c.body, c.mentions_json, c.author_id,
              c.author_name, c.resolved_at, c.created_at, c.updated_at
       FROM memo_comments c INNER JOIN memos m ON m.id = c.memo_id
       WHERE c.workspace_id = ? AND m.is_deleted = 0 ORDER BY c.created_at ASC, c.id ASC`,
    ).bind(workspaceId).all<CommentBackupRow>(),
  ]);
  const live = new Set(pages.results.map((row) => row.id));
  return {
    pages: pages.results.map((row): JsonBackupPageNode => ({
      memoId: row.id,
      // A parent in Trash is not in the backup; the page comes back at the top of its notebook.
      parentId: row.parent_memo_id && live.has(row.parent_memo_id) ? row.parent_memo_id : null,
      position: Number(row.page_position ?? 0),
      icon: row.page_icon,
      cover: row.page_cover,
      style: parseObject(row.page_style),
      databaseId: row.database_id,
      properties: parseObject(row.properties_json) ?? {},
    })),
    databases: databases.results.map((row): JsonBackupDatabase => ({
      id: row.id,
      pageMemoId: row.page_memo_id,
      schema: parseObject(row.schema_json) ?? {},
      createdAt: row.created_at,
      updatedAt: row.updated_at,
    })),
    views: views.results.map((row): JsonBackupDatabaseView => ({
      id: row.id,
      databaseId: row.database_id,
      name: row.name,
      type: row.type,
      config: parseObject(row.config_json) ?? {},
      position: Number(row.position ?? 0),
      createdAt: row.created_at,
      updatedAt: row.updated_at,
    })),
    comments: comments.results.map((row): JsonBackupComment => ({
      id: row.id,
      memoId: row.memo_id,
      threadId: row.thread_id,
      quote: row.quote,
      quoteOccurrence: Number(row.quote_occurrence ?? 0),
      body: row.body,
      mentions: parseStringArray(row.mentions_json),
      authorId: row.author_id,
      authorName: row.author_name,
      resolvedAt: row.resolved_at,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
    })),
  };
};

const invalid = (message: string) => new AppError("invalid_backup", message, 400);

/** IDs from `ids` that exist in `table` for this workspace (and, when asked, aren't in Trash). */
const existingIds = async (db: DatabaseAdapter, table: "memos" | "databases", workspaceId: string, ids: string[]) => {
  const found = new Set<string>();
  for (const chunk of chunks([...new Set(ids)], ID_CHUNK)) {
    const extra = table === "memos" ? " AND is_deleted = 0" : "";
    const rows = await db.prepare(
      `SELECT id FROM ${table} WHERE workspace_id = ?${extra} AND id IN (${chunk.map(() => "?").join(", ")})`,
    ).bind(workspaceId, ...chunk).all<{ id: string }>();
    for (const row of rows.results) found.add(row.id);
  }
  return found;
};

/** A restore never overwrites another workspace's rows. */
const assertNotInOtherWorkspace = async (
  db: DatabaseAdapter,
  table: "databases" | "database_views" | "memo_comments",
  workspaceId: string,
  ids: string[],
) => {
  for (const chunk of chunks(ids, ID_CHUNK)) {
    const collision = await db.prepare(
      `SELECT id FROM ${table} WHERE workspace_id <> ? AND id IN (${chunk.map(() => "?").join(", ")}) LIMIT 1`,
    ).bind(workspaceId, ...chunk).first<{ id: string }>();
    if (collision) throw new AppError("cross_workspace_id_conflict", "Backup contains an ID already used by another user.", 409);
  }
};

const runBatches = async (db: DatabaseAdapter, statements: PreparedStatementAdapter[]) => {
  for (const batch of chunks(statements, BATCH_SIZE)) await db.batch(batch);
};

/**
 * Restores one request's worth of page data into notes that were already restored.
 * The client sends databases, then views, then pages, then comments, so each list can
 * refer to what came before it. Writing the same data twice changes nothing.
 */
export const restorePageBackup = async (db: DatabaseAdapter, workspaceId: string, input: JsonBackupPages) => {
  const { pages, databases, views, comments } = input;
  const memoIds = [
    ...pages.flatMap((page) => [page.memoId, ...(page.parentId ? [page.parentId] : [])]),
    ...databases.map((database) => database.pageMemoId),
    ...comments.map((comment) => comment.memoId),
  ];
  const memos = await existingIds(db, "memos", workspaceId, memoIds);
  const missing = memoIds.find((id) => !memos.has(id));
  if (missing) throw invalid("Backup page data points at a note that wasn't restored.");

  for (const database of databases) {
    if (!DatabaseSchemaSchema.safeParse(database.schema).success) throw invalid("A database in the backup has a damaged schema.");
  }
  for (const view of views) {
    if (!(DATABASE_VIEW_TYPES as readonly string[]).includes(view.type)) throw invalid("A database view in the backup has an unknown type.");
  }
  await assertNotInOtherWorkspace(db, "databases", workspaceId, databases.map((item) => item.id));
  await assertNotInOtherWorkspace(db, "database_views", workspaceId, views.map((item) => item.id));
  await assertNotInOtherWorkspace(db, "memo_comments", workspaceId, comments.map((item) => item.id));

  const databaseIds = [...views.map((view) => view.databaseId), ...pages.flatMap((page) => (page.databaseId ? [page.databaseId] : []))];
  const knownDatabases = await existingIds(db, "databases", workspaceId, databaseIds);
  for (const database of databases) knownDatabases.add(database.id);
  if (databaseIds.some((id) => !knownDatabases.has(id))) throw invalid("Backup page data points at a database that isn't in it.");

  // A page can't end up inside itself.
  const parents = new Map(pages.map((page) => [page.memoId, page.parentId]));
  for (const page of pages) {
    const seen = new Set([page.memoId]);
    let parent = page.parentId;
    while (parent) {
      if (seen.has(parent)) throw invalid("Backup pages are nested inside themselves.");
      seen.add(parent);
      parent = parents.get(parent) ?? null;
    }
  }

  const statements: PreparedStatementAdapter[] = [];
  for (const database of databases) {
    statements.push(db.prepare(
      `INSERT INTO databases (id, workspace_id, page_memo_id, schema_json, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?)
       ON CONFLICT(id) DO UPDATE SET schema_json = excluded.schema_json, updated_at = excluded.updated_at
       WHERE databases.workspace_id = excluded.workspace_id`,
    ).bind(database.id, workspaceId, database.pageMemoId, JSON.stringify(database.schema), database.createdAt, database.updatedAt));
  }
  for (const view of views) {
    const config = DatabaseViewConfigSchema.safeParse(view.config);
    statements.push(db.prepare(
      `INSERT INTO database_views (id, database_id, workspace_id, name, type, config_json, position, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(id) DO UPDATE SET name = excluded.name, type = excluded.type, config_json = excluded.config_json,
         position = excluded.position, updated_at = excluded.updated_at
       WHERE database_views.workspace_id = excluded.workspace_id`,
    ).bind(view.id, view.databaseId, workspaceId, view.name, view.type, JSON.stringify(config.success ? config.data : {}), view.position, view.createdAt, view.updatedAt));
  }
  for (const page of pages) {
    statements.push(db.prepare(
      `UPDATE memos SET parent_memo_id = ?, page_position = ?, page_icon = ?, page_cover = ?, page_style = ?,
         database_id = ?, properties_json = ?
       WHERE workspace_id = ? AND id = ?`,
    ).bind(
      page.parentId,
      page.position,
      page.icon,
      page.cover,
      page.style ? JSON.stringify(page.style) : null,
      page.databaseId,
      JSON.stringify(page.properties),
      workspaceId,
      page.memoId,
    ));
  }
  for (const comment of comments) {
    statements.push(db.prepare(
      `INSERT INTO memo_comments (id, workspace_id, memo_id, thread_id, quote, quote_occurrence, body, mentions_json,
         author_id, author_name, resolved_at, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(id) DO NOTHING`,
    ).bind(
      comment.id, workspaceId, comment.memoId, comment.threadId, comment.quote, comment.quoteOccurrence, comment.body,
      JSON.stringify(comment.mentions), comment.authorId, comment.authorName, comment.resolvedAt, comment.createdAt, comment.updatedAt,
    ));
  }
  await runBatches(db, statements);

  // Restored notes don't index their page links; do it now so backlinks come back too.
  const pageIds = pages.map((page) => page.memoId);
  const linkStatements: PreparedStatementAdapter[] = [];
  for (const chunk of chunks(pageIds, ID_CHUNK)) {
    const rows = await db.prepare(
      `SELECT memo_id, content_json FROM memo_contents WHERE memo_id IN (${chunk.map(() => "?").join(", ")})`,
    ).bind(...chunk).all<{ memo_id: string; content_json: string | null }>();
    for (const row of rows.results) {
      const doc = parseObject(row.content_json) as TiptapDoc | null;
      if (doc) linkStatements.push(...replaceMemoLinksStatements(db, workspaceId, row.memo_id, doc));
    }
  }
  await runBatches(db, linkStatements);
  return { pages: pages.length, databases: databases.length, views: views.length, comments: comments.length };
};
