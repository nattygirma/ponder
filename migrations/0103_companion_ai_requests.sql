-- AppKeep AI usage record ids of a chat turn's model calls, so a reply's "…" card can show what it cost.
ALTER TABLE companion_turns ADD COLUMN ai_requests_json TEXT NOT NULL DEFAULT '[]';
