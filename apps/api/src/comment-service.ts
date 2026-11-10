import type { AppNotification, MemoComment, WorkspaceMember } from "@ponder/shared";
import type { AuthContext } from "./api-context";
import { AppError } from "./app-error";
import { createId, isoNow } from "./entity-utils";
import { listCommentSubscribers } from "./page-activity-service";
import type { DatabaseAdapter, PreparedStatementAdapter } from "./storage-contract";

const COMMENT_LIMIT = 500;
const NOTIFICATION_LIMIT = 50;
const EXCERPT_LENGTH = 160;

type CommentRecord = {
  id: string;
  memo_id: string;
  thread_id: string;
  quote: string | null;
  quote_occurrence: number;
  body: string;
  mentions_json: string;
  author_id: string | null;
  author_name: string;
  resolved_at: string | null;
  created_at: string;
  updated_at: string;
};

const mapComment = (row: CommentRecord): MemoComment => ({
  id: row.id,
  memoId: row.memo_id,
  threadId: row.thread_id,
  quote: row.quote,
  quoteOccurrence: row.quote_occurrence,
  body: row.body,
  mentions: JSON.parse(row.mentions_json) as string[],
  authorId: row.author_id,
  authorName: row.author_name,
  resolvedAt: row.resolved_at,
  createdAt: row.created_at,
  updatedAt: row.updated_at,
});

const COMMENT_COLUMNS = `id, memo_id, thread_id, quote, quote_occurrence, body, mentions_json, author_id, author_name, resolved_at, created_at, updated_at`;

export const listWorkspaceMembers = async (db: DatabaseAdapter, workspaceId: string): Promise<WorkspaceMember[]> => {
  const rows = await db
    .prepare(
      `SELECT u.id, u.username, u.display_name, u.email, wm.role
       FROM (
         SELECT workspace_id, user_id, role FROM workspace_members
         UNION ALL
         SELECT workspace_id, user_id, role FROM team_members
       ) wm
       INNER JOIN users u ON u.id = wm.user_id
       WHERE wm.workspace_id = ? AND u.is_disabled = 0
       ORDER BY COALESCE(u.display_name, u.username) COLLATE NOCASE`
    )
    .bind(workspaceId)
    .all<{ id: string; username: string; display_name: string | null; email: string | null; role: WorkspaceMember["role"] }>();
  return rows.results.map((row) => ({
    id: row.id,
    username: row.username,
    displayName: row.display_name,
    email: row.email,
    role: row.role,
  }));
};

const assertLiveMemo = async (db: DatabaseAdapter, workspaceId: string, memoId: string) => {
  const memo = await db
    .prepare(`SELECT id, title FROM memos WHERE workspace_id = ? AND id = ? AND is_deleted = 0`)
    .bind(workspaceId, memoId)
    .first<{ id: string; title: string | null }>();
  if (!memo) throw new AppError("not_found", "Page not found", 404);
  return memo;
};

export const listMemoComments = async (db: DatabaseAdapter, workspaceId: string, memoId: string): Promise<MemoComment[]> => {
  const rows = await db
    .prepare(`SELECT ${COMMENT_COLUMNS} FROM memo_comments WHERE workspace_id = ? AND memo_id = ? ORDER BY created_at ASC LIMIT ?`)
    .bind(workspaceId, memoId, COMMENT_LIMIT)
    .all<CommentRecord>();
  return rows.results.map(mapComment);
};

const excerptOf = (body: string) => (body.length > EXCERPT_LENGTH ? `${body.slice(0, EXCERPT_LENGTH - 1)}…` : body);

export type CommentEmail = { to: string; subject: string; text: string };

export const createMemoComment = async (
  db: DatabaseAdapter,
  workspaceId: string,
  memoId: string,
  input: { body: string; threadId?: string; quote?: string; quoteOccurrence?: number; mentions?: string[] },
  auth: AuthContext,
): Promise<{ comment: MemoComment; emails: CommentEmail[] }> => {
  const memo = await assertLiveMemo(db, workspaceId, memoId);
  const members = await listWorkspaceMembers(db, workspaceId);
  const memberIds = new Set(members.map((member) => member.id));
  // Only people in this workspace can be mentioned, whatever the client sent.
  const mentions = [...new Set(input.mentions ?? [])].filter((id) => memberIds.has(id));

  let participants: string[] = [];
  if (input.threadId) {
    const thread = await db
      .prepare(`SELECT author_id FROM memo_comments WHERE workspace_id = ? AND memo_id = ? AND thread_id = ?`)
      .bind(workspaceId, memoId, input.threadId)
      .all<{ author_id: string | null }>();
    if (thread.results.length === 0) throw new AppError("not_found", "Comment thread not found", 404);
    participants = thread.results.flatMap((row) => (row.author_id && memberIds.has(row.author_id) ? [row.author_id] : []));
  }

  const id = createId("cmt");
  const now = isoNow();
  const authorName = auth.displayName ?? auth.username;
  const actorId = auth.kind === "user" ? auth.actorId : null;
  const statements: PreparedStatementAdapter[] = [
    db
      .prepare(
        `INSERT INTO memo_comments (id, workspace_id, memo_id, thread_id, quote, quote_occurrence, body, mentions_json, author_id, author_name, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
      )
      .bind(
        id, workspaceId, memoId, input.threadId ?? id,
        input.threadId ? null : input.quote?.trim() || null,
        input.quoteOccurrence ?? 0,
        input.body, JSON.stringify(mentions), actorId, authorName, now, now,
      ),
  ];

  const excerpt = excerptOf(input.body);
  const recipients = new Map<string, "mention" | "reply" | "comment">();
  // People following the page hear about every comment; a reply or mention to them says more, so it wins.
  for (const follower of await listCommentSubscribers(db, workspaceId, memoId)) {
    if (memberIds.has(follower)) recipients.set(follower, "comment");
  }
  for (const participant of participants) recipients.set(participant, "reply");
  for (const mention of mentions) recipients.set(mention, "mention");
  if (actorId) recipients.delete(actorId);

  const emails: CommentEmail[] = [];
  const pageTitle = memo.title || "Untitled";
  for (const [recipientId, kind] of recipients) {
    statements.push(
      db
        .prepare(
          `INSERT INTO notifications (id, workspace_id, recipient_id, kind, memo_id, comment_id, actor_name, excerpt, created_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
        )
        .bind(createId("ntf"), workspaceId, recipientId, kind, memoId, id, authorName, excerpt, now),
    );
    const email = members.find((member) => member.id === recipientId)?.email;
    if (email) {
      emails.push({
        to: email,
        subject: kind === "mention"
          ? `${authorName} mentioned you on ${pageTitle}`
          : kind === "reply" ? `${authorName} replied on ${pageTitle}` : `${authorName} commented on ${pageTitle}`,
        text: `${authorName} wrote on "${pageTitle}":\n\n${input.body}`,
      });
    }
  }
  await db.batch(statements);

  const row = await db.prepare(`SELECT ${COMMENT_COLUMNS} FROM memo_comments WHERE id = ?`).bind(id).first<CommentRecord>();
  return { comment: mapComment(row!), emails };
};

const loadComment = async (db: DatabaseAdapter, workspaceId: string, id: string) => {
  const row = await db
    .prepare(`SELECT ${COMMENT_COLUMNS} FROM memo_comments WHERE workspace_id = ? AND id = ?`)
    .bind(workspaceId, id)
    .first<CommentRecord>();
  if (!row) throw new AppError("not_found", "Comment not found", 404);
  return row;
};

const canManage = (row: CommentRecord, auth: AuthContext) =>
  auth.teamRole === "owner" || (!auth.teamRole && auth.role === "owner") || (auth.actorId !== null && row.author_id === auth.actorId);

export const updateMemoComment = async (
  db: DatabaseAdapter,
  workspaceId: string,
  id: string,
  input: { body?: string; resolved?: boolean },
  auth: AuthContext,
): Promise<MemoComment> => {
  const row = await loadComment(db, workspaceId, id);
  const now = isoNow();
  const statements: PreparedStatementAdapter[] = [];
  if (input.body !== undefined) {
    if (!canManage(row, auth)) throw new AppError("forbidden", "Only the author can edit this comment.", 403);
    statements.push(db.prepare(`UPDATE memo_comments SET body = ?, updated_at = ? WHERE id = ?`).bind(input.body, now, id));
  }
  if (input.resolved !== undefined) {
    statements.push(
      db.prepare(`UPDATE memo_comments SET resolved_at = ? WHERE workspace_id = ? AND thread_id = ?`)
        .bind(input.resolved ? now : null, workspaceId, row.thread_id),
    );
  }
  if (statements.length > 0) await db.batch(statements);
  return mapComment(await loadComment(db, workspaceId, id));
};

export const deleteMemoComment = async (db: DatabaseAdapter, workspaceId: string, id: string, auth: AuthContext) => {
  const row = await loadComment(db, workspaceId, id);
  if (!canManage(row, auth)) throw new AppError("forbidden", "Only the author can delete this comment.", 403);
  // Deleting the first comment removes the thread; replies alone would have nothing to attach to.
  await db
    .prepare(row.thread_id === id
      ? `DELETE FROM memo_comments WHERE workspace_id = ? AND thread_id = ?`
      : `DELETE FROM memo_comments WHERE workspace_id = ? AND id = ?`)
    .bind(workspaceId, id)
    .run();
};

export const listNotifications = async (
  db: DatabaseAdapter,
  recipientId: string,
  workspaceId: string,
): Promise<{ notifications: AppNotification[]; unread: number }> => {
  const [rows, unread] = await Promise.all([
    db
      .prepare(
        `SELECT n.id, n.kind, n.memo_id, n.comment_id, n.actor_name, n.excerpt, n.read_at, n.created_at, m.title, m.notebook_id
         FROM notifications n
         LEFT JOIN memos m ON m.id = n.memo_id
         WHERE n.recipient_id = ? AND n.workspace_id = ?
         ORDER BY n.created_at DESC
         LIMIT ?`
      )
      .bind(recipientId, workspaceId, NOTIFICATION_LIMIT)
      .all<{
        id: string; kind: AppNotification["kind"]; memo_id: string; comment_id: string | null; actor_name: string;
        excerpt: string; read_at: string | null; created_at: string; title: string | null; notebook_id: string | null;
      }>(),
    db
      .prepare(`SELECT COUNT(*) AS total FROM notifications WHERE recipient_id = ? AND workspace_id = ? AND read_at IS NULL`)
      .bind(recipientId, workspaceId)
      .first<{ total: number }>(),
  ]);
  return {
    unread: unread?.total ?? 0,
    notifications: rows.results.map((row) => ({
      id: row.id,
      kind: row.kind,
      memoId: row.memo_id,
      notebookId: row.notebook_id,
      memoTitle: row.title,
      commentId: row.comment_id,
      actorName: row.actor_name,
      excerpt: row.excerpt,
      readAt: row.read_at,
      createdAt: row.created_at,
    })),
  };
};

export const markNotificationsRead = async (
  db: DatabaseAdapter,
  recipientId: string,
  workspaceId: string,
  input: { ids?: string[]; all?: boolean },
) => {
  const now = isoNow();
  if (input.all) {
    await db
      .prepare(`UPDATE notifications SET read_at = ? WHERE recipient_id = ? AND workspace_id = ? AND read_at IS NULL`)
      .bind(now, recipientId, workspaceId)
      .run();
    return;
  }
  const ids = input.ids ?? [];
  await db
    .prepare(`UPDATE notifications SET read_at = ? WHERE recipient_id = ? AND workspace_id = ? AND id IN (${ids.map(() => "?").join(",")})`)
    .bind(now, recipientId, workspaceId, ...ids)
    .run();
};
