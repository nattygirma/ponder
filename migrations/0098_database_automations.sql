-- Database automations (Notion's ⚡ menu): a trigger and a list of actions, on or off.
-- next_run_at is set for time-based triggers (a date reached, or "Every {frequency}") and read by the cron.
CREATE TABLE IF NOT EXISTS database_automations (
  id TEXT PRIMARY KEY,
  workspace_id TEXT NOT NULL,
  database_id TEXT NOT NULL,
  name TEXT NOT NULL DEFAULT '',
  enabled INTEGER NOT NULL DEFAULT 1,
  trigger_json TEXT NOT NULL CHECK (json_valid(trigger_json)),
  actions_json TEXT NOT NULL CHECK (json_valid(actions_json)),
  created_by TEXT,
  next_run_at TEXT,
  last_run_at TEXT,
  run_count INTEGER NOT NULL DEFAULT 0,
  position REAL NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_database_automations_database ON database_automations(workspace_id, database_id, position);
CREATE INDEX IF NOT EXISTS idx_database_automations_due ON database_automations(next_run_at) WHERE enabled = 1 AND next_run_at IS NOT NULL;

-- One line per run, kept 30 days, for the run log and the 100-a-minute limit.
CREATE TABLE IF NOT EXISTS automation_runs (
  id TEXT PRIMARY KEY,
  workspace_id TEXT NOT NULL,
  automation_id TEXT NOT NULL,
  row_id TEXT,
  status TEXT NOT NULL CHECK (status IN ('success', 'error', 'skipped')),
  error TEXT,
  started_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_automation_runs_automation ON automation_runs(automation_id, started_at DESC);
CREATE INDEX IF NOT EXISTS idx_automation_runs_started ON automation_runs(started_at);

-- Emails sent by automations and buttons each day, because AppKeep sends at most 200 a day for an app.
CREATE TABLE IF NOT EXISTS automation_email_days (
  day TEXT PRIMARY KEY,
  sent INTEGER NOT NULL DEFAULT 0
);

-- Notion's "Duplicate every…": a template can make a page on a schedule.
ALTER TABLE database_templates ADD COLUMN repeat_json TEXT CHECK (repeat_json IS NULL OR json_valid(repeat_json));
ALTER TABLE database_templates ADD COLUMN repeat_next_at TEXT;
ALTER TABLE database_templates ADD COLUMN repeat_runs INTEGER NOT NULL DEFAULT 0;

CREATE INDEX IF NOT EXISTS idx_database_templates_repeat ON database_templates(repeat_next_at) WHERE repeat_next_at IS NOT NULL;
