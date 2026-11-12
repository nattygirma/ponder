import { yXmlFragmentToProsemirrorJSON } from "@tiptap/y-tiptap";
import * as Y from "yjs";
import {
  collectSyncedIds,
  docToMarkdown,
  expandSyncedMarkdown,
  isSyncedBlockId,
  listSyncedIdsInMarkdown,
  mapSyncedTags,
  markdownToDoc,
  normalizeGeneratedMarkdown,
  replaceSyncedNodes,
  stripSyncedMarkdown,
  type JsonBackupSyncedBlock,
  type PageAccessLevel,
  type TiptapDoc,
} from "@ponder/shared";
import type { AuthContext } from "./api-context";
import { AppError } from "./app-error";
import { seedState } from "./collab-service";
import { isoNow } from "./entity-utils";
import { getPageAccessLevel, isTeamAdmin } from "./team-service";
import type { DatabaseAdapter, PreparedStatementAdapter } from "./storage-contract";

/**
 * Notion's synced blocks. One row holds the content; pages hold `<ponder-synced id>` references.
 *
 * Permissions (the rule, also in the Phase F report):
 * - Reading a synced block's content needs at least view access to its ORIGINAL page (the page it
 *   was created on), whichever page shows the copy. Someone who can open a page with a copy but
 *   not the original sees "You don't have access to this synced block", never the content. This is
 *   Notion's rule.
 * - Editing it needs edit access to the original page and to the page showing the copy.
 * - An original page in Trash, or gone, hides the content from everyone but workspace owners.
 * - Workspace owners (and everyone in a personal workspace) can read and edit every block in it.
 *
 * Live editing: each copy keeps a Yjs document and exchanges updates through `syncSyncedBlock`,
 * polled like the page's own live session. Saves are merged, never overwritten.
 */
const FRAGMENT = "default";
const MERGE_RETRIES = 5;
const PAGE_LIST_LIMIT = 50;
const MAX_STATE_BYTES = 2 * 1024 * 1024;

const encode = (bytes: Uint8Array) => {
  let binary = "";
  for (let index = 0; index < bytes.length; index += 0x8000) binary += String.fromCharCode(...bytes.subarray(index, index + 0x8000));
  return btoa(binary);
};
const decode = (text: string) => Uint8Array.from(atob(text), (character) => character.charCodeAt(0));

export type SyncedBlockRow = {
  id: string;
  workspace_id: string;
  source_memo_id: string;
  state: string;
  generation: number;
  version: number;
  content_json: string;
  content_markdown: string;
  created_at: string;
  updated_at: string;
};

export type SyncedBlockAccess = { row: SyncedBlockRow; canRead: boolean; canEdit: boolean };

const EMPTY_DOC: TiptapDoc = { type: "doc", content: [{ type: "paragraph" }] } as TiptapDoc;

/** Synced blocks can't hold synced blocks (as in Notion): nested references are dropped. */
const withoutNestedSynced = (doc: TiptapDoc) => replaceSyncedNodes(doc, () => null);

const docFromState = (state: string) => {
  const ydoc = new Y.Doc();
  Y.applyUpdate(ydoc, decode(state));
  const json = yXmlFragmentToProsemirrorJSON(ydoc.getXmlFragment(FRAGMENT)) as TiptapDoc;
  ydoc.destroy();
  return json;
};

const loadRow = (db: DatabaseAdapter, workspaceId: string, id: string) =>
  db.prepare(`SELECT * FROM synced_blocks WHERE id = ? AND workspace_id = ?`).bind(id, workspaceId).first<SyncedBlockRow>();

/** A page's access level, with a page in Trash or gone counting as no access for non-owners. */
const pageLevel = async (db: DatabaseAdapter, auth: AuthContext, memoId: string): Promise<PageAccessLevel> => {
  if (isTeamAdmin(auth)) return "edit";
  const memo = await db.prepare(`SELECT is_deleted FROM memos WHERE id = ? AND workspace_id = ?`).bind(memoId, auth.workspaceId).first<{ is_deleted: number }>();
  if (!memo || memo.is_deleted) return "none";
  return getPageAccessLevel(db, auth, memoId);
};

const canWrite = (auth: AuthContext) => auth.kind === "user" || auth.scopes.includes("write:memos");

/** What this person may do with a block, seen through the page `hostMemoId` (the copy's page). */
export const getSyncedBlockAccess = async (db: DatabaseAdapter, auth: AuthContext, id: string, hostMemoId: string | null): Promise<SyncedBlockAccess> => {
  if (!isSyncedBlockId(id)) throw new AppError("not_found", "Synced block not found", 404);
  const row = await loadRow(db, auth.workspaceId, id);
  if (!row) throw new AppError("not_found", "Synced block not found", 404);
  const [source, host] = await Promise.all([
    pageLevel(db, auth, row.source_memo_id),
    hostMemoId && hostMemoId !== row.source_memo_id ? pageLevel(db, auth, hostMemoId) : null,
  ]);
  if (host === "none") throw new AppError("not_found", "Page not found", 404);
  const hostLevel = host ?? source;
  return {
    row,
    canRead: source !== "none",
    canEdit: source === "edit" && hostLevel === "edit" && canWrite(auth),
  };
};

const contentFields = (doc: TiptapDoc) => {
  const clean = withoutNestedSynced(doc);
  return { json: JSON.stringify(clean), markdown: docToMarkdown(clean).trim() };
};

/** A new synced block on `memoId`, empty or holding `content` (Turn into synced block). */
export const createSyncedBlock = async (db: DatabaseAdapter, auth: AuthContext, memoId: string, content?: TiptapDoc) => {
  if (!canWrite(auth)) throw new AppError("forbidden", "Missing required scope: write:memos", 403);
  const level = await pageLevel(db, auth, memoId);
  const exists = await db.prepare(`SELECT 1 AS ok FROM memos WHERE id = ? AND workspace_id = ? AND is_deleted = 0`).bind(memoId, auth.workspaceId).first();
  if (!exists || level === "none") throw new AppError("not_found", "Page not found", 404);
  if (level !== "edit") throw new AppError("forbidden", "You can't edit this page.", 403);
  const doc = withoutNestedSynced(content?.content?.length ? content : EMPTY_DOC);
  const id = `syn_${crypto.randomUUID().replace(/-/g, "")}`;
  const now = isoNow();
  const fields = contentFields(doc);
  await db.batch([
    db.prepare(
      `INSERT INTO synced_blocks (id, workspace_id, source_memo_id, state, content_json, content_markdown, created_by, updated_by, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    ).bind(id, auth.workspaceId, memoId, seedState(doc), fields.json, fields.markdown, auth.actorId, auth.actorId, now, now),
    db.prepare(`INSERT OR IGNORE INTO synced_block_refs (synced_id, memo_id, workspace_id, created_at) VALUES (?, ?, ?, ?)`).bind(id, memoId, auth.workspaceId, now),
  ]);
  return { id };
};

type PageRef = { memoId: string; title: string; isOriginal: boolean };

/** The pages showing this block that this person can see, and how many there are in all. */
const listPages = async (db: DatabaseAdapter, auth: AuthContext, row: SyncedBlockRow) => {
  const refs = await db.prepare(
    `SELECT r.memo_id, m.title FROM synced_block_refs r
     INNER JOIN memos m ON m.id = r.memo_id AND m.workspace_id = r.workspace_id AND m.is_deleted = 0
     WHERE r.synced_id = ? AND r.workspace_id = ?
     ORDER BY CASE WHEN r.memo_id = ? THEN 0 ELSE 1 END, r.created_at ASC LIMIT ?`,
  ).bind(row.id, row.workspace_id, row.source_memo_id, PAGE_LIST_LIMIT + 1).all<{ memo_id: string; title: string | null }>();
  const visible: PageRef[] = [];
  for (const ref of refs.results.slice(0, PAGE_LIST_LIMIT)) {
    if ((await pageLevel(db, auth, ref.memo_id)) === "none") continue;
    visible.push({ memoId: ref.memo_id, title: ref.title ?? "", isOriginal: ref.memo_id === row.source_memo_id });
  }
  return { pages: visible, pageCount: refs.results.length };
};

export type SyncedBlockView = {
  id: string;
  sourceMemoId: string;
  canRead: boolean;
  canEdit: boolean;
  generation: number;
  version: number;
  state: string | null;
  pages: PageRef[];
  pageCount: number;
};

/** Opening a copy: its state when this person may read it, and the pages it is on. */
export const getSyncedBlock = async (db: DatabaseAdapter, auth: AuthContext, id: string, hostMemoId: string | null): Promise<SyncedBlockView> => {
  const { row, canRead, canEdit } = await getSyncedBlockAccess(db, auth, id, hostMemoId);
  if (!canRead) {
    // Nothing about the content, nor which pages hold it, reaches someone without the original.
    return { id, sourceMemoId: "", canRead: false, canEdit: false, generation: 0, version: 0, state: null, pages: [], pageCount: 0 };
  }
  const { pages, pageCount } = await listPages(db, auth, row);
  return { id, sourceMemoId: row.source_memo_id, canRead, canEdit, generation: row.generation, version: row.version, state: row.state, pages, pageCount };
};

export type SyncedSyncResult =
  | { reset: true; generation: number; version: number; state: string; canEdit: boolean }
  | { reset?: false; generation: number; version: number; update: string | null; canEdit: boolean };

/**
 * One round of live editing: merges this copy's update (when it may edit) into the shared state,
 * and returns what the copy is missing. Concurrent saves retry on the version, so none is lost.
 */
export const syncSyncedBlock = async (
  db: DatabaseAdapter,
  auth: AuthContext,
  id: string,
  input: { memoId: string | null; generation: number; version: number; update?: string; stateVector?: string },
): Promise<SyncedSyncResult> => {
  const access = await getSyncedBlockAccess(db, auth, id, input.memoId);
  if (!access.canRead) throw new AppError("not_found", "Synced block not found", 404);
  let row = access.row;
  if (input.generation !== row.generation) {
    return { reset: true, generation: row.generation, version: row.version, state: row.state, canEdit: access.canEdit };
  }
  // Whatever the client claims, someone who may only read never changes the block.
  if (input.update && access.canEdit) {
    let update: Uint8Array;
    try {
      update = decode(input.update);
      Y.decodeUpdate(update);
    } catch {
      throw new AppError("invalid_update", "That change could not be read", 400);
    }
    for (let attempt = 0; ; attempt += 1) {
      const merged = Y.mergeUpdates([decode(row.state), update]);
      if (merged.byteLength > MAX_STATE_BYTES) throw new AppError("synced_block_too_large", "This synced block is too large.", 413);
      const state = encode(merged);
      const fields = contentFields(docFromState(state));
      const now = isoNow();
      const result = await db.prepare(
        `UPDATE synced_blocks SET state = ?, content_json = ?, content_markdown = ?, version = version + 1, updated_by = ?, updated_at = ?
         WHERE id = ? AND workspace_id = ? AND version = ? AND generation = ?`,
      ).bind(state, fields.json, fields.markdown, auth.actorId, now, id, auth.workspaceId, row.version, row.generation).run();
      if (Number(result.meta.changes) > 0) {
        row = { ...row, state, version: row.version + 1, content_json: fields.json, content_markdown: fields.markdown };
        break;
      }
      const fresh = await loadRow(db, auth.workspaceId, id);
      if (!fresh) throw new AppError("not_found", "Synced block not found", 404);
      if (fresh.generation !== row.generation) {
        return { reset: true, generation: fresh.generation, version: fresh.version, state: fresh.state, canEdit: access.canEdit };
      }
      row = fresh;
      if (attempt >= MERGE_RETRIES) throw new AppError("synced_block_busy", "Too many changes at once. Try again.", 409);
    }
  } else if (input.version === row.version) {
    return { generation: row.generation, version: row.version, update: null, canEdit: access.canEdit };
  }
  let missing: Uint8Array;
  if (input.stateVector) {
    const ydoc = new Y.Doc();
    Y.applyUpdate(ydoc, decode(row.state));
    try {
      missing = Y.encodeStateAsUpdate(ydoc, decode(input.stateVector));
    } catch {
      missing = Y.encodeStateAsUpdate(ydoc);
    }
    ydoc.destroy();
  } else {
    missing = decode(row.state);
  }
  return { generation: row.generation, version: row.version, update: encode(missing), canEdit: access.canEdit };
};

/** Replaces the block's content from Markdown (an AI edit): copies start over from the new state. */
const replaceSyncedContent = async (db: DatabaseAdapter, auth: AuthContext, row: SyncedBlockRow, markdown: string) => {
  const doc = withoutNestedSynced(markdownToDoc(normalizeGeneratedMarkdown(markdown)));
  const fields = contentFields(doc);
  if (fields.markdown === row.content_markdown.trim()) return false;
  const result = await db.prepare(
    `UPDATE synced_blocks SET state = ?, content_json = ?, content_markdown = ?, generation = generation + 1, version = version + 1, updated_by = ?, updated_at = ?
     WHERE id = ? AND workspace_id = ?`,
  ).bind(seedState(doc), fields.json, fields.markdown, auth.actorId, isoNow(), row.id, auth.workspaceId).run();
  return Number(result.meta.changes) > 0;
};

/**
 * A Markdown write to page `memoId` (AI's update_memo, MCP): content inside a synced tag edits
 * the shared block, for every copy, when this person may edit it; otherwise it is ignored. The
 * page itself always keeps only the reference.
 */
export const applySyncedMarkdownEdits = async (db: DatabaseAdapter, auth: AuthContext, memoId: string, markdown: string) => {
  if (!markdown.includes("<ponder-synced")) return { markdown, applied: [] as string[], ignored: [] as string[] };
  const { markdown: stripped, edits } = stripSyncedMarkdown(markdown);
  const applied: string[] = [];
  const ignored: string[] = [];
  for (const edit of edits) {
    try {
      const access = await getSyncedBlockAccess(db, auth, edit.id, memoId);
      if (access.canEdit && await replaceSyncedContent(db, auth, access.row, edit.markdown)) applied.push(edit.id);
      else if (!access.canEdit) ignored.push(edit.id);
    } catch (error) {
      if (!(error instanceof AppError)) throw error;
      ignored.push(edit.id);
    }
  }
  return { markdown: stripped, applied, ignored };
};

/** Content of these blocks, keyed by id, for the ones this person may read. One query for all. */
const readableContent = async (db: DatabaseAdapter, auth: AuthContext, ids: string[]) => {
  const result = new Map<string, SyncedBlockRow>();
  const wanted = ids.filter(isSyncedBlockId);
  for (let offset = 0; offset < wanted.length; offset += 80) {
    const batch = wanted.slice(offset, offset + 80);
    const rows = await db.prepare(
      `SELECT * FROM synced_blocks WHERE workspace_id = ? AND id IN (${batch.map(() => "?").join(", ")})`,
    ).bind(auth.workspaceId, ...batch).all<SyncedBlockRow>();
    const levels = new Map<string, PageAccessLevel>();
    for (const row of rows.results) {
      if (!levels.has(row.source_memo_id)) levels.set(row.source_memo_id, await pageLevel(db, auth, row.source_memo_id));
      if (levels.get(row.source_memo_id) !== "none") result.set(row.id, row);
    }
  }
  return result;
};

/** A page's Markdown with each synced block's content inside its tag, for this reader (AI, export). */
export const expandSyncedForReader = async (db: DatabaseAdapter, auth: AuthContext, markdown: string) => {
  if (!markdown.includes("<ponder-synced")) return markdown;
  const rows = await readableContent(db, auth, listSyncedIdsInMarkdown(markdown));
  return expandSyncedMarkdown(markdown, (id) => rows.get(id)?.content_markdown ?? null);
};

/** Expands many pages at once (the Markdown export), reading each block only once. */
export const expandSyncedInMemos = async <T extends { contentMarkdown: string }>(db: DatabaseAdapter, auth: AuthContext, memos: T[]) => {
  const has = (memo: T) => typeof memo.contentMarkdown === "string" && memo.contentMarkdown.includes("<ponder-synced");
  const ids = [...new Set(memos.flatMap((memo) => (has(memo) ? listSyncedIdsInMarkdown(memo.contentMarkdown) : [])))];
  if (ids.length === 0) return memos;
  const rows = await readableContent(db, auth, ids);
  return memos.map((memo) => (has(memo) ? { ...memo, contentMarkdown: expandSyncedMarkdown(memo.contentMarkdown, (id) => rows.get(id)?.content_markdown ?? null) } : memo));
};

/**
 * A public link shows the blocks whose original is the shared page itself, inline, and drops the
 * copies of blocks from other pages: the visitor was given this page, not those.
 */
export const resolveSyncedForPublicPage = async (db: DatabaseAdapter, workspaceId: string, memoId: string, doc: TiptapDoc, markdown: string) => {
  const ids = [...new Set([...collectSyncedIds(doc), ...listSyncedIdsInMarkdown(markdown)])];
  if (ids.length === 0) return { doc, markdown };
  const rows = await db.prepare(
    `SELECT id, content_json, content_markdown FROM synced_blocks WHERE workspace_id = ? AND source_memo_id = ? AND id IN (${ids.map(() => "?").join(", ")})`,
  ).bind(workspaceId, memoId, ...ids).all<Pick<SyncedBlockRow, "id" | "content_json" | "content_markdown">>();
  const own = new Map(rows.results.map((row) => [row.id, row]));
  return {
    doc: replaceSyncedNodes(doc, (id) => {
      const row = own.get(id);
      return row ? ((JSON.parse(row.content_json) as TiptapDoc).content ?? []) : null;
    }),
    markdown: mapSyncedTags(markdown, (id) => own.get(id)?.content_markdown ?? ""),
  };
};

/** Statements that rebuild which synced blocks a page shows, from its saved content. */
export const replaceSyncedRefsStatements = (db: DatabaseAdapter, workspaceId: string, memoId: string, doc: unknown): PreparedStatementAdapter[] => {
  const ids = collectSyncedIds(doc);
  const now = isoNow();
  return [
    db.prepare(`DELETE FROM synced_block_refs WHERE memo_id = ? AND workspace_id = ?`).bind(memoId, workspaceId),
    ...ids.map((id) => db.prepare(
      `INSERT OR IGNORE INTO synced_block_refs (synced_id, memo_id, workspace_id, created_at)
       SELECT id, ?, workspace_id, ? FROM synced_blocks WHERE id = ? AND workspace_id = ?`,
    ).bind(memoId, now, id, workspaceId)),
  ];
};

export const syncedRefsPurgeStatements = (db: DatabaseAdapter, condition: string, binds: unknown[]): PreparedStatementAdapter[] => [
  db.prepare(`DELETE FROM synced_block_refs WHERE memo_id IN (${condition})`).bind(...binds),
];

/**
 * Notion's "Unsync all", on the original: every copy this person can edit becomes ordinary
 * blocks holding the current content. The editor that asked turns the original into blocks itself
 * (it has the content open); copies on pages this person can't edit stay synced. `updatePage` saves a
 * page's new JSON through the normal page save, so live sessions start over with it.
 */
export const unsyncAllCopies = async (
  db: DatabaseAdapter,
  auth: AuthContext,
  id: string,
  updatePage: (memoId: string, doc: TiptapDoc) => Promise<void>,
) => {
  const { row, canEdit } = await getSyncedBlockAccess(db, auth, id, null);
  if (!canEdit) throw new AppError("forbidden", "You need edit access to the original page.", 403);
  const blocks = (JSON.parse(row.content_json) as TiptapDoc).content ?? [];
  const refs = await db.prepare(
    `SELECT r.memo_id, c.content_json FROM synced_block_refs r
     INNER JOIN memos m ON m.id = r.memo_id AND m.workspace_id = r.workspace_id AND m.is_deleted = 0
     INNER JOIN memo_contents c ON c.memo_id = m.id
     WHERE r.synced_id = ? AND r.workspace_id = ? AND r.memo_id <> ?`,
  ).bind(id, auth.workspaceId, row.source_memo_id).all<{ memo_id: string; content_json: string }>();
  let unsynced = 0;
  let skipped = 0;
  for (const ref of refs.results) {
    if ((await pageLevel(db, auth, ref.memo_id)) !== "edit") {
      skipped += 1;
      continue;
    }
    const doc = replaceSyncedNodes(JSON.parse(ref.content_json) as TiptapDoc, (syncedId) => (syncedId === id ? blocks : undefined));
    await updatePage(ref.memo_id, doc);
    unsynced += 1;
  }
  return { unsynced, skipped };
};

/** The workspace's synced blocks whose original page isn't in Trash, for a backup. */
export const readSyncedBlocksBackup = async (db: DatabaseAdapter, workspaceId: string): Promise<JsonBackupSyncedBlock[]> => {
  const rows = await db.prepare(
    `SELECT s.id, s.source_memo_id, s.content_json, s.content_markdown, s.created_at, s.updated_at
     FROM synced_blocks s INNER JOIN memos m ON m.id = s.source_memo_id AND m.workspace_id = s.workspace_id
     WHERE s.workspace_id = ? AND m.is_deleted = 0 ORDER BY s.id ASC`,
  ).bind(workspaceId).all<Pick<SyncedBlockRow, "id" | "source_memo_id" | "content_json" | "content_markdown" | "created_at" | "updated_at">>();
  return rows.results.map((row) => ({
    id: row.id,
    sourceMemoId: row.source_memo_id,
    content: JSON.parse(row.content_json) as Record<string, unknown>,
    markdown: row.content_markdown,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  }));
};

/** Restores synced blocks from a backup; a block already here keeps its id and takes the backup's content. */
export const restoreSyncedBlocksStatements = async (db: DatabaseAdapter, workspaceId: string, blocks: JsonBackupSyncedBlock[]) => {
  if (blocks.length === 0) return [];
  const foreign = await db.prepare(
    `SELECT id FROM synced_blocks WHERE workspace_id <> ? AND id IN (${blocks.map(() => "?").join(", ")}) LIMIT 1`,
  ).bind(workspaceId, ...blocks.map((block) => block.id)).first();
  if (foreign) throw new AppError("invalid_backup", "A synced block in this backup belongs to another workspace.", 400);
  return blocks.map((block) => {
    const doc = withoutNestedSynced(block.content as unknown as TiptapDoc);
    const fields = contentFields(doc?.type === "doc" ? doc : markdownToDoc(block.markdown));
    return db.prepare(
      `INSERT INTO synced_blocks (id, workspace_id, source_memo_id, state, content_json, content_markdown, created_at, updated_at)
       SELECT ?, ?, id, ?, ?, ?, ?, ? FROM memos WHERE id = ? AND workspace_id = ?
       ON CONFLICT(id) DO UPDATE SET state = excluded.state, content_json = excluded.content_json, content_markdown = excluded.content_markdown,
         source_memo_id = excluded.source_memo_id, generation = synced_blocks.generation + 1, version = synced_blocks.version + 1, updated_at = excluded.updated_at
       WHERE synced_blocks.workspace_id = excluded.workspace_id`,
    ).bind(block.id, workspaceId, seedState(JSON.parse(fields.json) as TiptapDoc), fields.json, fields.markdown, block.createdAt, block.updatedAt, block.sourceMemoId, workspaceId);
  });
};
