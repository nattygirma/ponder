import type { PageAnalytics, PageSubscriptionLevel } from "@ponder/shared";
import { AppError } from "./app-error";
import { isoNow } from "./entity-utils";
import type { DatabaseAdapter, PreparedStatementAdapter } from "./storage-contract";

const ANALYTICS_DAYS = 28;
const RECENT_LIMIT = 20;

const assertPage = async (db: DatabaseAdapter, workspaceId: string, memoId: string) => {
  const memo = await db
    .prepare(`SELECT id, created_at FROM memos WHERE workspace_id = ? AND id = ? AND is_deleted = 0`)
    .bind(workspaceId, memoId)
    .first<{ id: string; created_at: string }>();
  if (!memo) throw new AppError("not_found", "Page not found", 404);
  return memo;
};

export const getPageSubscription = async (db: DatabaseAdapter, workspaceId: string, memoId: string, userId: string): Promise<PageSubscriptionLevel> => {
  const row = await db
    .prepare(`SELECT level FROM page_subscriptions WHERE workspace_id = ? AND memo_id = ? AND user_id = ?`)
    .bind(workspaceId, memoId, userId)
    .first<{ level: "all" | "comments" }>();
  return row?.level ?? "default";
};

export const setPageSubscription = async (
  db: DatabaseAdapter,
  workspaceId: string,
  memoId: string,
  userId: string,
  level: PageSubscriptionLevel,
): Promise<PageSubscriptionLevel> => {
  await assertPage(db, workspaceId, memoId);
  if (level === "default") {
    await db.prepare(`DELETE FROM page_subscriptions WHERE workspace_id = ? AND memo_id = ? AND user_id = ?`).bind(workspaceId, memoId, userId).run();
  } else {
    await db
      .prepare(
        `INSERT INTO page_subscriptions (workspace_id, memo_id, user_id, level, created_at) VALUES (?, ?, ?, ?, ?)
         ON CONFLICT(workspace_id, memo_id, user_id) DO UPDATE SET level = excluded.level`,
      )
      .bind(workspaceId, memoId, userId, level, isoNow())
      .run();
  }
  return level;
};

/** People who asked to hear about every comment on a page. */
export const listCommentSubscribers = async (db: DatabaseAdapter, workspaceId: string, memoId: string): Promise<string[]> => {
  const rows = await db
    .prepare(`SELECT user_id FROM page_subscriptions WHERE workspace_id = ? AND memo_id = ? AND level IN ('all', 'comments')`)
    .bind(workspaceId, memoId)
    .all<{ user_id: string }>();
  return rows.results.map((row) => row.user_id);
};

/**
 * Tells everyone following all updates that a page changed. Saves arrive every few seconds while somebody types,
 * so each follower gets one unread "edited" notification per page until they read it, not one per save.
 */
export const pageEditNotificationStatement = (
  db: DatabaseAdapter,
  workspaceId: string,
  memoId: string,
  actorId: string | null,
  actorName: string,
): PreparedStatementAdapter =>
  db
    .prepare(
      `INSERT INTO notifications (id, workspace_id, recipient_id, kind, memo_id, comment_id, actor_name, excerpt, created_at)
       SELECT 'ntf_' || lower(hex(randomblob(16))), s.workspace_id, s.user_id, 'edit', s.memo_id, NULL, ?, '', ?
       FROM page_subscriptions s
       WHERE s.workspace_id = ? AND s.memo_id = ? AND s.level = 'all' AND s.user_id != ?
         AND NOT EXISTS (
           SELECT 1 FROM notifications n
           WHERE n.recipient_id = s.user_id AND n.workspace_id = s.workspace_id AND n.read_at IS NULL AND n.memo_id = s.memo_id AND n.kind = 'edit'
         )`,
    )
    .bind(actorName, isoNow(), workspaceId, memoId, actorId ?? "");

export const notifyPageEdit = async (db: DatabaseAdapter, workspaceId: string, memoId: string, actorId: string | null, actorName: string) => {
  await pageEditNotificationStatement(db, workspaceId, memoId, actorId, actorName).run();
};

const dayOf = (iso: string) => iso.slice(0, 10);

/** Counts one view: a single upsert on the person's row for today. */
export const recordPageView = async (db: DatabaseAdapter, workspaceId: string, memoId: string, userId: string) => {
  await assertPage(db, workspaceId, memoId);
  const now = isoNow();
  await db
    .prepare(
      `INSERT INTO page_views (workspace_id, memo_id, user_id, day, views, last_viewed_at) VALUES (?, ?, ?, ?, 1, ?)
       ON CONFLICT(workspace_id, memo_id, day, user_id) DO UPDATE SET views = views + 1, last_viewed_at = excluded.last_viewed_at`,
    )
    .bind(workspaceId, memoId, userId, dayOf(now), now)
    .run();
};

export const getPageAnalytics = async (db: DatabaseAdapter, workspaceId: string, memoId: string, now = new Date()): Promise<PageAnalytics> => {
  const memo = await assertPage(db, workspaceId, memoId);
  const days: string[] = [];
  for (let offset = ANALYTICS_DAYS - 1; offset >= 0; offset -= 1) {
    days.push(dayOf(new Date(now.getTime() - offset * 86_400_000).toISOString()));
  }
  const since = days[0]!;
  // Reads bounded by the page and the window: daily totals, distinct viewers, recent viewers, recent saves.
  const [daily, unique, viewers, updates] = await Promise.all([
    db
      .prepare(
        `SELECT day, SUM(views) AS views, COUNT(*) AS viewers FROM page_views
         WHERE workspace_id = ? AND memo_id = ? AND day >= ? GROUP BY day`,
      )
      .bind(workspaceId, memoId, since)
      .all<{ day: string; views: number; viewers: number }>(),
    db
      .prepare(`SELECT COUNT(DISTINCT user_id) AS total FROM page_views WHERE workspace_id = ? AND memo_id = ? AND day >= ?`)
      .bind(workspaceId, memoId, since)
      .first<{ total: number }>(),
    db
      .prepare(
        `SELECT v.user_id, SUM(v.views) AS views, MAX(v.last_viewed_at) AS last_viewed_at, COALESCE(u.display_name, u.username) AS name
         FROM page_views v LEFT JOIN users u ON u.id = v.user_id
         WHERE v.workspace_id = ? AND v.memo_id = ? AND v.day >= ?
         GROUP BY v.user_id ORDER BY last_viewed_at DESC LIMIT ?`,
      )
      .bind(workspaceId, memoId, since, RECENT_LIMIT)
      .all<{ user_id: string; views: number; last_viewed_at: string; name: string | null }>(),
    db
      .prepare(
        `SELECT r.created_at, r.created_by, COALESCE(u.display_name, u.username) AS name
         FROM memo_revisions r LEFT JOIN users u ON r.created_by = 'user:' || u.id
         WHERE r.memo_id = ? ORDER BY r.revision DESC LIMIT ?`,
      )
      .bind(memoId, RECENT_LIMIT)
      .all<{ created_at: string; created_by: string; name: string | null }>(),
  ]);
  const byDay = new Map(daily.results.map((row) => [row.day, row]));
  return {
    days: ANALYTICS_DAYS,
    createdAt: memo.created_at,
    totalViews: daily.results.reduce((sum, row) => sum + Number(row.views), 0),
    uniqueViewers: Number(unique?.total ?? 0),
    daily: days.map((day) => ({ day, views: Number(byDay.get(day)?.views ?? 0), viewers: Number(byDay.get(day)?.viewers ?? 0) })),
    viewers: viewers.results.map((row) => ({ userId: row.user_id, name: row.name, views: Number(row.views), lastViewedAt: row.last_viewed_at })),
    updates: updates.results.map((row) => ({ at: row.created_at, name: row.name, system: row.created_by === "system" })),
  };
};
