-- Live co-editing relay: a merged Yjs state per page, the updates since, and who is on the page.
CREATE TABLE IF NOT EXISTS memo_collab (
  memo_id TEXT PRIMARY KEY,
  workspace_id TEXT NOT NULL,
  state TEXT NOT NULL,
  base_seq INTEGER NOT NULL DEFAULT 0,
  persisted_seq INTEGER NOT NULL DEFAULT 0,
  generation INTEGER NOT NULL DEFAULT 1,
  base_hash TEXT,
  persisted_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS memo_collab_updates (
  seq INTEGER PRIMARY KEY AUTOINCREMENT,
  memo_id TEXT NOT NULL,
  client_id TEXT NOT NULL,
  data TEXT NOT NULL,
  created_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_memo_collab_updates_memo ON memo_collab_updates(memo_id, seq);

CREATE TABLE IF NOT EXISTS memo_collab_presence (
  memo_id TEXT NOT NULL,
  client_id TEXT NOT NULL,
  user_id TEXT,
  awareness TEXT,
  last_seen TEXT NOT NULL,
  PRIMARY KEY (memo_id, client_id)
);

CREATE INDEX IF NOT EXISTS idx_memo_collab_presence_seen ON memo_collab_presence(memo_id, last_seen);
