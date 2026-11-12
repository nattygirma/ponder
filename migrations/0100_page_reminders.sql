-- Reminders set on date mentions in pages (Notion's "@Remind me"), one row per reminder.
-- Saving a page keeps these rows in step with its date mentions; the cron sends the due ones
-- to the Inbox and marks them sent. remind_at is an ISO instant, worked out in the setter's time zone.
CREATE TABLE IF NOT EXISTS page_reminders (
  workspace_id TEXT NOT NULL,
  memo_id TEXT NOT NULL,
  reminder_id TEXT NOT NULL,
  recipient_id TEXT NOT NULL,
  remind_at TEXT NOT NULL,
  label TEXT NOT NULL DEFAULT '',
  sent_at TEXT,
  created_at TEXT NOT NULL,
  PRIMARY KEY (memo_id, reminder_id)
);

CREATE INDEX IF NOT EXISTS idx_page_reminders_due ON page_reminders(remind_at) WHERE sent_at IS NULL;
