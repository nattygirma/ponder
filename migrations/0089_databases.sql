-- Databases: a page that holds typed properties, whose rows are themselves pages.
CREATE TABLE IF NOT EXISTS databases (
  id TEXT PRIMARY KEY,
  workspace_id TEXT NOT NULL,
  page_memo_id TEXT NOT NULL UNIQUE,
  schema_json TEXT NOT NULL CHECK (json_valid(schema_json)),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_databases_workspace ON databases(workspace_id);

CREATE TABLE IF NOT EXISTS database_views (
  id TEXT PRIMARY KEY,
  database_id TEXT NOT NULL,
  workspace_id TEXT NOT NULL,
  name TEXT NOT NULL,
  type TEXT NOT NULL,
  config_json TEXT NOT NULL DEFAULT '{}' CHECK (json_valid(config_json)),
  position REAL NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_database_views_database ON database_views(database_id, position);

ALTER TABLE memos ADD COLUMN database_id TEXT;
ALTER TABLE memos ADD COLUMN properties_json TEXT NOT NULL DEFAULT '{}';

CREATE INDEX IF NOT EXISTS idx_memos_database_rows
  ON memos(workspace_id, database_id, is_deleted, page_position);
