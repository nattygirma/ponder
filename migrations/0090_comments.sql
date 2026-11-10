-- Page and block comments, plus the in-app inbox they feed.
ALTER TABLE users ADD COLUMN email TEXT;

CREATE TABLE IF NOT EXISTS memo_comments (
  id TEXT PRIMARY KEY,
  workspace_id TEXT NOT NULL,
  memo_id TEXT NOT NULL,
  thread_id TEXT NOT NULL,
  quote TEXT,
  quote_occurrence INTEGER NOT NULL DEFAULT 0,
  body TEXT NOT NULL,
  mentions_json TEXT NOT NULL DEFAULT '[]' CHECK (json_valid(mentions_json)),
  author_id TEXT,
  author_name TEXT NOT NULL,
  resolved_at TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_memo_comments_memo ON memo_comments(workspace_id, memo_id, created_at);
CREATE INDEX IF NOT EXISTS idx_memo_comments_thread ON memo_comments(thread_id, created_at);

CREATE TABLE IF NOT EXISTS notifications (
  id TEXT PRIMARY KEY,
  workspace_id TEXT NOT NULL,
  recipient_id TEXT NOT NULL,
  kind TEXT NOT NULL,
  memo_id TEXT NOT NULL,
  comment_id TEXT,
  actor_name TEXT NOT NULL,
  excerpt TEXT NOT NULL,
  read_at TEXT,
  created_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_notifications_recipient ON notifications(recipient_id, read_at, created_at DESC);
