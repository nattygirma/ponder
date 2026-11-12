-- GitHub synced databases (Notion's GitHub "Database sync"): a repository's pull requests and issues,
-- copied one way into a database whose GitHub properties are read only.
-- source_json holds the repositories, what to include and the history window. etag and cursor are JSON
-- maps keyed by repository and kind: the last ETag GitHub sent, and how far each listing has been read.
-- next_run_at is read by the five-minute cron, which syncs each database every 15 minutes.
CREATE TABLE IF NOT EXISTS database_syncs (
  database_id TEXT PRIMARY KEY,
  workspace_id TEXT NOT NULL,
  provider TEXT NOT NULL CHECK (provider IN ('github')),
  connection_id TEXT NOT NULL,
  account_name TEXT NOT NULL DEFAULT '',
  source_json TEXT NOT NULL CHECK (json_valid(source_json)),
  status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'paused')),
  etag TEXT CHECK (etag IS NULL OR json_valid(etag)),
  cursor TEXT CHECK (cursor IS NULL OR json_valid(cursor)),
  imported INTEGER NOT NULL DEFAULT 0,
  last_synced_at TEXT,
  last_error TEXT,
  last_error_code TEXT,
  next_run_at TEXT,
  -- Held while a run is under way, so "Sync now" and the cron never write the same rows at once.
  lease_until TEXT,
  created_by TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_database_syncs_workspace ON database_syncs(workspace_id);
CREATE INDEX IF NOT EXISTS idx_database_syncs_due ON database_syncs(next_run_at) WHERE status = 'active' AND next_run_at IS NOT NULL;

-- Which row holds which pull request or issue. Rows are matched by repository and number.
CREATE TABLE IF NOT EXISTS database_sync_items (
  database_id TEXT NOT NULL,
  item_key TEXT NOT NULL,
  kind TEXT NOT NULL CHECK (kind IN ('pull_request', 'issue')),
  repository TEXT NOT NULL,
  row_id TEXT NOT NULL,
  source_updated_at TEXT NOT NULL,
  PRIMARY KEY (database_id, item_key)
);

CREATE INDEX IF NOT EXISTS idx_database_sync_items_updated ON database_sync_items(database_id, source_updated_at);
CREATE INDEX IF NOT EXISTS idx_database_sync_items_row ON database_sync_items(row_id);
