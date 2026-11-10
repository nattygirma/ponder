-- Calendars a person connected by their secret iCal address. The address is stored encrypted.
CREATE TABLE IF NOT EXISTS calendar_feeds (
  id TEXT PRIMARY KEY,
  workspace_id TEXT NOT NULL,
  actor_id TEXT NOT NULL,
  label TEXT NOT NULL,
  url_encrypted TEXT NOT NULL,
  events_json TEXT NOT NULL DEFAULT '[]',
  fetched_at TEXT,
  last_error TEXT,
  created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_calendar_feeds_owner ON calendar_feeds (workspace_id, actor_id);
