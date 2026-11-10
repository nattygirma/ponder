import { yXmlFragmentToProsemirrorJSON } from "@tiptap/y-tiptap";
import * as Y from "yjs";
import { docToMarkdown, markdownToDoc, type TiptapDoc } from "@ponder/shared";
import type { AuthContext } from "./api-context";
import { AppError } from "./app-error";
import { isoNow } from "./entity-utils";
import { updateMemoRecord } from "./memo-service";
import type { DatabaseAdapter, PreparedStatementAdapter } from "./storage-contract";

const FRAGMENT = "default";
const PRESENCE_WINDOW_MS = 20_000;
const PERSIST_INTERVAL_MS = 5_000;
const PULL_LIMIT = 500;
const MERGE_LIMIT = 2000;
// Longer than any client's poll gap, so someone keeping up never has to download the whole page again.
const COMPACT_AFTER_MS = 60_000;

export type CollabJoin = { state: string; cursor: number; generation: number; canEdit: boolean };
export type CollabSync = {
  updates: string[];
  awareness: string[];
  cursor: number;
  peers: number;
  title: string | null;
  /** The whole document, sent when this client fell behind what the server has already merged. */
  state?: string;
  /** The page was replaced outside the live session; the editor has to start over. */
  reset?: boolean;
};

const encode = (bytes: Uint8Array) => {
  let binary = "";
  for (let index = 0; index < bytes.length; index += 0x8000) {
    binary += String.fromCharCode(...bytes.subarray(index, index + 0x8000));
  }
  return btoa(binary);
};

const decode = (text: string) => Uint8Array.from(atob(text), (character) => character.charCodeAt(0));

type JsonNode = { type: string; text?: string; attrs?: Record<string, unknown>; marks?: { type: string; attrs?: Record<string, unknown> }[]; content?: JsonNode[] };

/** Builds the shared tree straight from saved JSON, so a block type the server doesn't know can't fail a page. */
const appendNodes = (parent: Y.XmlFragment | Y.XmlElement, nodes: JsonNode[]) => {
  let text: Y.XmlText | null = null;
  let length = 0;
  for (const node of nodes) {
    if (node.type === "text") {
      if (!text) {
        text = new Y.XmlText();
        parent.push([text]);
        length = 0;
      }
      const attributes = Object.fromEntries((node.marks ?? []).map((mark) => [mark.type, mark.attrs ?? {}]));
      text.insert(length, node.text ?? "", attributes);
      length += (node.text ?? "").length;
      continue;
    }
    text = null;
    const element = new Y.XmlElement(node.type);
    parent.push([element]);
    for (const [name, value] of Object.entries(node.attrs ?? {})) {
      if (value !== null && value !== undefined) element.setAttribute(name, value as string);
    }
    appendNodes(element, node.content ?? []);
  }
};

const seedState = (doc: TiptapDoc) => {
  const ydoc = new Y.Doc();
  ydoc.transact(() => appendNodes(ydoc.getXmlFragment(FRAGMENT), ((doc as unknown as JsonNode).content ?? [])));
  const state = encode(Y.encodeStateAsUpdate(ydoc));
  ydoc.destroy();
  return state;
};

type CollabRow = {
  state: string;
  base_seq: number;
  persisted_seq: number;
  generation: number;
  base_hash: string | null;
  persisted_at: string;
  title: string | null;
  content_hash: string;
  content_json: string | null;
  content_markdown: string | null;
};

const loadRow = (db: DatabaseAdapter, workspaceId: string, memoId: string) =>
  db.prepare(
    `SELECT c.state, c.base_seq, c.persisted_seq, c.generation, c.base_hash, c.persisted_at, m.title, b.content_hash, b.content_json, b.content_markdown
     FROM memo_collab c
     JOIN memos m ON m.id = c.memo_id AND m.workspace_id = ? AND m.is_deleted = 0
     JOIN memo_contents b ON b.memo_id = m.id
     WHERE c.memo_id = ?`,
  ).bind(workspaceId, memoId).first<CollabRow>();

const presenceCutoff = () => new Date(Date.now() - PRESENCE_WINDOW_MS).toISOString();

const parseDoc = (json: string | null, markdown: string | null): TiptapDoc =>
  json ? JSON.parse(json) as TiptapDoc : markdownToDoc(markdown ?? "");

/** Something other than the live session wrote the page, such as restoring a version. That write wins. */
const reseedIfReplaced = async (db: DatabaseAdapter, memoId: string, row: CollabRow): Promise<CollabRow> => {
  if (row.base_hash === null || row.base_hash === row.content_hash) return row;
  const state = seedState(parseDoc(row.content_json, row.content_markdown));
  const now = isoNow();
  await db.batch([
    db.prepare(`UPDATE memo_collab SET state = ?, generation = generation + 1, base_hash = ?, persisted_at = ?, updated_at = ? WHERE memo_id = ? AND generation = ?`)
      .bind(state, row.content_hash, now, now, memoId, row.generation),
    db.prepare(`DELETE FROM memo_collab_updates WHERE memo_id = ?`).bind(memoId),
  ]);
  return { ...row, state, generation: row.generation + 1, base_hash: row.content_hash, persisted_at: now };
};

export const joinCollab = async (db: DatabaseAdapter, auth: AuthContext, memoId: string, canEdit: boolean): Promise<CollabJoin> => {
  await db.prepare(`DELETE FROM memo_collab_presence WHERE memo_id = ? AND last_seen <= ?`).bind(memoId, presenceCutoff()).run();
  let row = await loadRow(db, auth.workspaceId, memoId);
  if (!row) {
    const memo = await db.prepare(
      `SELECT b.content_hash, b.content_json, b.content_markdown
       FROM memos m JOIN memo_contents b ON b.memo_id = m.id
       WHERE m.workspace_id = ? AND m.id = ? AND m.is_deleted = 0`,
    ).bind(auth.workspaceId, memoId).first<Pick<CollabRow, "content_hash" | "content_json" | "content_markdown">>();
    if (!memo) throw new AppError("not_found", "Page not found", 404);
    const now = isoNow();
    // When two people open a fresh page at once the first seed wins, so its content can't be duplicated.
    await db.prepare(
      `INSERT OR IGNORE INTO memo_collab (memo_id, workspace_id, state, base_hash, persisted_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)`,
    ).bind(memoId, auth.workspaceId, seedState(parseDoc(memo.content_json, memo.content_markdown)), memo.content_hash, now, now).run();
    row = await loadRow(db, auth.workspaceId, memoId);
    if (!row) throw new AppError("not_found", "Page not found", 404);
  }
  row = await reseedIfReplaced(db, memoId, row);
  return { state: row.state, cursor: row.base_seq, generation: row.generation, canEdit };
};

/** Writes the live document back to the page, so search, exports and backlinks see it. */
const persist = async (db: DatabaseAdapter, auth: AuthContext, memoId: string, row: CollabRow, force: boolean) => {
  const now = Date.now();
  if (!force && now - Date.parse(row.persisted_at) < PERSIST_INTERVAL_MS) return;
  const pending = await db
    .prepare(`SELECT seq, data, created_at FROM memo_collab_updates WHERE memo_id = ? AND seq > ? ORDER BY seq ASC LIMIT ?`)
    .bind(memoId, row.base_seq, MERGE_LIMIT)
    .all<{ seq: number; data: string; created_at: string }>();
  const lastSeq = pending.results[pending.results.length - 1]?.seq ?? 0;
  if (lastSeq <= row.persisted_seq) return;

  // Only the request that moves persisted_at does the work. Clearing the hash stops our own write looking like an outside one.
  const claim = await db
    .prepare(`UPDATE memo_collab SET persisted_at = ?, base_hash = NULL WHERE memo_id = ? AND persisted_at = ?`)
    .bind(new Date(now).toISOString(), memoId, row.persisted_at)
    .run();
  if (claim.meta.changes === 0) return;

  const merged = Y.mergeUpdates([decode(row.state), ...pending.results.map((item) => decode(item.data))]);
  const doc = new Y.Doc();
  Y.applyUpdate(doc, merged);
  const json = yXmlFragmentToProsemirrorJSON(doc.getXmlFragment(FRAGMENT)) as TiptapDoc;
  doc.destroy();

  const saved = await updateMemoRecord(
    db,
    auth.workspaceId,
    memoId,
    { contentJson: json, contentMarkdown: docToMarkdown(json), allowDestructiveOverwrite: true },
    { actorType: "user", actorId: auth.actorId },
    auth.displayName ?? auth.username,
  );
  if ("error" in saved && saved.error) throw new AppError(saved.error, saved.message, saved.status ?? 500);
  const hash = (saved as { memo: { contentHash: string } }).memo.contentHash;

  const settled = pending.results.filter((item) => now - Date.parse(item.created_at) >= COMPACT_AFTER_MS);
  const statements = [
    db.prepare(`UPDATE memo_collab SET base_hash = ?, persisted_seq = MAX(persisted_seq, ?), updated_at = ? WHERE memo_id = ?`).bind(hash, lastSeq, isoNow(), memoId),
  ];
  if (settled.length > 0) {
    const settledSeq = settled[settled.length - 1]!.seq;
    const base = Y.mergeUpdates([decode(row.state), ...settled.map((item) => decode(item.data))]);
    // Two writers can overlap. Only the one that covers more updates may move the base.
    statements.push(
      db.prepare(`UPDATE memo_collab SET state = ?, base_seq = ? WHERE memo_id = ? AND base_seq < ?`).bind(encode(base), settledSeq, memoId, settledSeq),
      db.prepare(`DELETE FROM memo_collab_updates WHERE memo_id = ? AND seq <= (SELECT base_seq FROM memo_collab WHERE memo_id = ?)`).bind(memoId, memoId),
    );
  }
  await db.batch(statements);
};

const persistQuietly = async (db: DatabaseAdapter, auth: AuthContext, memoId: string, row: CollabRow, force: boolean) => {
  try {
    await persist(db, auth, memoId, row, force);
  } catch (error) {
    // The updates stay in the log, so the next request tries again and typing never stops over this.
    console.error("Live page save failed", memoId, error);
  }
};

const assertValidUpdate = (update: string) => {
  try {
    Y.decodeUpdate(decode(update));
  } catch {
    throw new AppError("invalid_update", "That change could not be read", 400);
  }
};

export const syncCollab = async (
  db: DatabaseAdapter,
  auth: AuthContext,
  memoId: string,
  input: { clientId: string; cursor: number; generation: number; update?: string; awareness?: string },
  canEdit: boolean,
): Promise<CollabSync> => {
  const loaded = await loadRow(db, auth.workspaceId, memoId);
  if (!loaded) throw new AppError("not_found", "Page not found", 404);
  const row = await reseedIfReplaced(db, memoId, loaded);
  if (row.generation !== input.generation) return { updates: [], awareness: [], cursor: row.base_seq, peers: 0, title: row.title, reset: true };
  if (input.update) assertValidUpdate(input.update);

  const now = isoNow();
  const statements: PreparedStatementAdapter[] = [
    db.prepare(
      `INSERT INTO memo_collab_presence (memo_id, client_id, user_id, awareness, last_seen) VALUES (?, ?, ?, ?, ?)
       ON CONFLICT(memo_id, client_id) DO UPDATE SET awareness = COALESCE(excluded.awareness, awareness), last_seen = excluded.last_seen`,
    ).bind(memoId, input.clientId, auth.actorId, input.awareness ?? null, now),
  ];
  // Whatever the client claims, somebody who can only read never changes the document.
  if (input.update && canEdit) {
    statements.push(
      db.prepare(`INSERT INTO memo_collab_updates (memo_id, client_id, data, created_at) VALUES (?, ?, ?, ?)`)
        .bind(memoId, input.clientId, input.update, now),
    );
  }
  await db.batch(statements);

  const behind = input.cursor < row.base_seq;
  const from = behind ? row.base_seq : input.cursor;
  const [updates, presence] = await Promise.all([
    db.prepare(`SELECT seq, client_id, data FROM memo_collab_updates WHERE memo_id = ? AND seq > ? ORDER BY seq ASC LIMIT ?`)
      .bind(memoId, from, PULL_LIMIT)
      .all<{ seq: number; client_id: string; data: string }>(),
    db.prepare(`SELECT client_id, awareness FROM memo_collab_presence WHERE memo_id = ? AND last_seen > ?`)
      .bind(memoId, presenceCutoff())
      .all<{ client_id: string; awareness: string | null }>(),
  ]);

  await persistQuietly(db, auth, memoId, row, false);

  const last = updates.results[updates.results.length - 1];
  return {
    updates: updates.results.filter((item) => item.client_id !== input.clientId).map((item) => item.data),
    awareness: presence.results.flatMap((item) => (item.client_id !== input.clientId && item.awareness ? [item.awareness] : [])),
    cursor: last?.seq ?? from,
    peers: presence.results.length,
    title: row.title,
    state: behind ? row.state : undefined,
  };
};

export const leaveCollab = async (
  db: DatabaseAdapter,
  auth: AuthContext,
  memoId: string,
  input: { clientId: string; generation: number; update?: string },
  canEdit: boolean,
) => {
  const row = await loadRow(db, auth.workspaceId, memoId);
  const statements = [db.prepare(`DELETE FROM memo_collab_presence WHERE memo_id = ? AND client_id = ?`).bind(memoId, input.clientId)];
  if (row && input.update && canEdit && row.generation === input.generation) {
    assertValidUpdate(input.update);
    statements.push(
      db.prepare(`INSERT INTO memo_collab_updates (memo_id, client_id, data, created_at) VALUES (?, ?, ?, ?)`)
        .bind(memoId, input.clientId, input.update, isoNow()),
    );
  }
  await db.batch(statements);
  if (row && row.generation === input.generation && row.base_hash === row.content_hash) await persistQuietly(db, auth, memoId, row, true);
};

/** Statements that remove live-editing data for permanently deleted pages. */
export const collabPurgeStatements = (db: DatabaseAdapter, condition: string, binds: unknown[]): PreparedStatementAdapter[] =>
  ["memo_collab_updates", "memo_collab_presence", "memo_collab"].map((table) =>
    db.prepare(`DELETE FROM ${table} WHERE memo_id IN (${condition})`).bind(...binds));
