-- Database rows get a number that never changes or repeats, for the "ID" property.
-- next_row_number is the number the database's next row will get.
ALTER TABLE memos ADD COLUMN row_number INTEGER;
ALTER TABLE databases ADD COLUMN next_row_number INTEGER NOT NULL DEFAULT 1;

-- Existing rows, deleted ones included so a restored row keeps a number of its own, are numbered in the order they were made.
UPDATE memos SET row_number = numbered.n
FROM (
  SELECT id, ROW_NUMBER() OVER (PARTITION BY database_id ORDER BY created_at, id) AS n
  FROM memos
  WHERE database_id IS NOT NULL
) AS numbered
WHERE memos.id = numbered.id;

UPDATE databases SET next_row_number = COALESCE(
  (SELECT MAX(row_number) FROM memos WHERE memos.database_id = databases.id), 0
) + 1;

-- Templates for new database rows: a name, default title, icon, property values and page body.
CREATE TABLE IF NOT EXISTS database_templates (
  id TEXT PRIMARY KEY,
  database_id TEXT NOT NULL,
  workspace_id TEXT NOT NULL,
  name TEXT NOT NULL,
  icon TEXT,
  title TEXT NOT NULL DEFAULT '',
  properties_json TEXT NOT NULL DEFAULT '{}' CHECK (json_valid(properties_json)),
  content_markdown TEXT NOT NULL DEFAULT '',
  is_default INTEGER NOT NULL DEFAULT 0,
  position REAL NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_database_templates_database ON database_templates(workspace_id, database_id, position);
