-- "Notify me" on pages, and the views behind page analytics.

-- What each person wants to hear about a page: everything, every comment, or only replies and mentions (no row).
CREATE TABLE IF NOT EXISTS page_subscriptions (
  workspace_id TEXT NOT NULL,
  memo_id TEXT NOT NULL,
  user_id TEXT NOT NULL,
  level TEXT NOT NULL CHECK (level IN ('all', 'comments')),
  created_at TEXT NOT NULL,
  PRIMARY KEY (workspace_id, memo_id, user_id)
);

-- One row per person, page and day, so counting views stays one small upsert however often a page is opened.
CREATE TABLE IF NOT EXISTS page_views (
  workspace_id TEXT NOT NULL,
  memo_id TEXT NOT NULL,
  user_id TEXT NOT NULL,
  day TEXT NOT NULL,
  views INTEGER NOT NULL DEFAULT 1,
  last_viewed_at TEXT NOT NULL,
  PRIMARY KEY (workspace_id, memo_id, day, user_id)
);
