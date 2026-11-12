import { collectMentions, type DocMention } from "@ponder/shared";
import { listWorkspaceMembers } from "./comment-service";
import { createId, isoNow } from "./entity-utils";
import type { DatabaseAdapter, PreparedStatementAdapter } from "./storage-contract";

/*
 * Mentions in page content (Notion's `@`), kept in step on every save of a page:
 * - a person mentioned for the first time in a page gets a "mention" in their Inbox;
 * - a date with a reminder becomes a row in page_reminders, which the cron sends when due.
 *
 * Works from the saved document, so mentions added by the editor, live co-editing, AI chat and
 * MCP tools (which write `ponder:` links in Markdown) all count. Nothing is read when a save
 * neither adds a person nor changes a reminder.
 */

const EXCERPT_LENGTH = 140;
const MAX_NEW_PEOPLE_PER_SAVE = 50;
const MAX_REMINDERS_PER_PAGE = 100;
/** A reminder set for a time already gone by more than this is kept in the page but never sent. */
const PAST_GRACE_MS = 60_000;
const MAX_DUE_PER_TICK = 100;
const SENT_RETENTION_DAYS = 30;

const excerptOf = (text: string) => (text.length > EXCERPT_LENGTH ? `${text.slice(0, EXCERPT_LENGTH - 1)}…` : text);

type Reminder = { id: string; at: string; by: string; label: string };

const remindersOf = (mentions: DocMention[]): Reminder[] => {
  const byId = new Map<string, Reminder>();
  for (const mention of mentions) {
    if (mention.kind !== "date" || !mention.remindAt) continue;
    // Reminders written by hand may lack an id; the fire time then names it.
    const id = mention.reminderId || `at_${mention.remindAt}`;
    if (!byId.has(id)) byId.set(id, { id, at: mention.remindAt, by: mention.remindedBy, label: excerptOf(mention.context) });
  }
  return [...byId.values()].slice(0, MAX_REMINDERS_PER_PAGE);
};

const reminderKey = (reminder: Reminder) => `${reminder.id}|${reminder.at}|${reminder.by}`;

export type PageMentionSync = { statements: PreparedStatementAdapter[]; remindersChanged: boolean };

/**
 * Statements to run in the same batch as a page save. `before` and `after` are the page's
 * TipTap JSON documents.
 */
export const pageMentionStatements = async (
  db: DatabaseAdapter,
  input: {
    workspaceId: string;
    memoId: string;
    before: unknown;
    after: unknown;
    actorId: string | null;
    actorName: string;
    now?: Date;
  },
): Promise<PageMentionSync> => {
  const after = collectMentions(input.after);
  const before = collectMentions(input.before);
  const known = new Set(before.filter((mention) => mention.kind === "person").map((mention) => mention.id));
  const newPeople = new Map<string, DocMention>();
  for (const mention of after) {
    if (mention.kind !== "person" || known.has(mention.id) || mention.id === input.actorId || newPeople.has(mention.id)) continue;
    newPeople.set(mention.id, mention);
  }
  const nextReminders = remindersOf(after);
  const previousReminders = remindersOf(before);
  const remindersChanged = nextReminders.map(reminderKey).sort().join("\n") !== previousReminders.map(reminderKey).sort().join("\n");
  if (newPeople.size === 0 && !remindersChanged) return { statements: [], remindersChanged: false };

  // Only people in this workspace hear about a page, whatever the document claims.
  const memberList = await listWorkspaceMembers(db, input.workspaceId);
  const members = new Set(memberList.map((member) => member.id));
  const actor = memberList.find((member) => member.id === input.actorId);
  const actorName = actor ? actor.displayName || actor.username : input.actorName;
  const now = input.now ?? new Date();
  const nowIso = now.toISOString();
  const statements: PreparedStatementAdapter[] = [];

  for (const [personId, mention] of [...newPeople].slice(0, MAX_NEW_PEOPLE_PER_SAVE)) {
    if (!members.has(personId)) continue;
    statements.push(
      db.prepare(
        `INSERT INTO notifications (id, workspace_id, recipient_id, kind, memo_id, comment_id, actor_name, excerpt, created_at)
         VALUES (?, ?, ?, 'mention', ?, NULL, ?, ?, ?)`,
      ).bind(createId("ntf"), input.workspaceId, personId, input.memoId, actorName, excerptOf(mention.context), nowIso),
    );
  }

  if (remindersChanged) {
    const keep = nextReminders.map((reminder) => reminder.id);
    // Reminders taken out of the page stop, unless already sent.
    statements.push(
      db.prepare(
        `DELETE FROM page_reminders WHERE memo_id = ? AND sent_at IS NULL${keep.length ? ` AND reminder_id NOT IN (${keep.map(() => "?").join(", ")})` : ""}`,
      ).bind(input.memoId, ...keep),
    );
    for (const reminder of nextReminders) {
      const recipient = reminder.by && members.has(reminder.by) ? reminder.by : input.actorId && members.has(input.actorId) ? input.actorId : null;
      if (!recipient || Date.parse(reminder.at) < now.getTime() - PAST_GRACE_MS) continue;
      // A reminder moved to a new time goes off again; one left alone keeps its sent mark.
      statements.push(
        db.prepare(
          `INSERT INTO page_reminders (workspace_id, memo_id, reminder_id, recipient_id, remind_at, label, sent_at, created_at)
           VALUES (?, ?, ?, ?, ?, ?, NULL, ?)
           ON CONFLICT(memo_id, reminder_id) DO UPDATE SET
             recipient_id = excluded.recipient_id,
             label = excluded.label,
             sent_at = CASE WHEN page_reminders.remind_at = excluded.remind_at THEN page_reminders.sent_at ELSE NULL END,
             remind_at = excluded.remind_at`,
        ).bind(input.workspaceId, input.memoId, reminder.id, recipient, reminder.at, reminder.label, nowIso),
      );
    }
  }
  return { statements, remindersChanged };
};

/** The earliest reminder still to send, for the host's wake time. */
export const nextReminderAt = async (db: DatabaseAdapter): Promise<string | null> =>
  (await db.prepare(`SELECT MIN(remind_at) AS next FROM page_reminders WHERE sent_at IS NULL`).first<{ next: string | null }>())?.next ?? null;

/**
 * The cron's part: sends due reminders to the Inbox of the person who set them. A reminder in a
 * page that has been deleted is marked sent without a notification, so it can't keep waking the app.
 */
export const runDueReminders = async (db: DatabaseAdapter, now = new Date()) => {
  const nowIso = now.toISOString();
  const due = await db
    .prepare(
      `SELECT r.workspace_id, r.memo_id, r.reminder_id, r.recipient_id, r.label, m.id AS live_id
       FROM page_reminders r
       LEFT JOIN memos m ON m.id = r.memo_id AND m.workspace_id = r.workspace_id AND m.is_deleted = 0
       WHERE r.sent_at IS NULL AND r.remind_at <= ?
       ORDER BY r.remind_at
       LIMIT ?`,
    )
    .bind(nowIso, MAX_DUE_PER_TICK)
    .all<{ workspace_id: string; memo_id: string; reminder_id: string; recipient_id: string; label: string; live_id: string | null }>();
  const statements: PreparedStatementAdapter[] = [];
  let sent = 0;
  for (const row of due.results) {
    if (row.live_id) {
      sent += 1;
      statements.push(
        db.prepare(
          `INSERT INTO notifications (id, workspace_id, recipient_id, kind, memo_id, comment_id, actor_name, excerpt, created_at)
           VALUES (?, ?, ?, 'reminder', ?, NULL, '', ?, ?)`,
        ).bind(createId("ntf"), row.workspace_id, row.recipient_id, row.memo_id, row.label, nowIso),
      );
    }
    statements.push(
      db.prepare(`UPDATE page_reminders SET sent_at = ? WHERE memo_id = ? AND reminder_id = ? AND sent_at IS NULL`)
        .bind(nowIso, row.memo_id, row.reminder_id),
    );
  }
  if (statements.length === 0) return { sent, due: 0, at: isoNow() };
  // Old sent rows are cleared on ticks that sent something, so an idle tick costs one read.
  const cutoff = new Date(now.getTime() - SENT_RETENTION_DAYS * 86_400_000).toISOString();
  statements.push(db.prepare(`DELETE FROM page_reminders WHERE sent_at IS NOT NULL AND sent_at < ?`).bind(cutoff));
  await db.batch(statements);
  return { sent, due: due.results.length, at: isoNow() };
};
