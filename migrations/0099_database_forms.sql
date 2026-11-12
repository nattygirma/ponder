-- Forms that fill a database (Notion's Form view). Each form is one database view of type 'form';
-- this row holds its questions, its share settings and its public link token.
-- access: 'workspace' (members who are signed in), 'public' (anyone with the link) or 'closed'.
-- Answers become rows through the normal row path, so automations see them as "page added".
CREATE TABLE IF NOT EXISTS database_forms (
  id TEXT PRIMARY KEY,
  workspace_id TEXT NOT NULL,
  database_id TEXT NOT NULL,
  view_id TEXT NOT NULL UNIQUE,
  token TEXT NOT NULL UNIQUE,
  access TEXT NOT NULL DEFAULT 'workspace' CHECK (access IN ('workspace', 'public', 'closed')),
  anonymous INTEGER NOT NULL DEFAULT 0,
  title TEXT NOT NULL DEFAULT '',
  description TEXT NOT NULL DEFAULT '',
  submit_label TEXT NOT NULL DEFAULT '',
  confirmation_title TEXT NOT NULL DEFAULT '',
  confirmation_message TEXT NOT NULL DEFAULT '',
  submit_another INTEGER NOT NULL DEFAULT 1,
  notify INTEGER NOT NULL DEFAULT 0,
  fields_json TEXT NOT NULL DEFAULT '[]' CHECK (json_valid(fields_json)),
  password_hash TEXT,
  submit_count INTEGER NOT NULL DEFAULT 0,
  submit_window_started_at TEXT,
  unlock_failed_count INTEGER NOT NULL DEFAULT 0,
  unlock_window_started_at TEXT,
  unlock_blocked_until TEXT,
  response_count INTEGER NOT NULL DEFAULT 0,
  created_by TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_database_forms_database ON database_forms(workspace_id, database_id);
