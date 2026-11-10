-- Shared team workspaces and per-page access.
-- workspace_members stays the record of each person's personal workspace and instance role;
-- membership of a shared workspace lives apart so it can never grant instance rights.
CREATE TABLE IF NOT EXISTS team_members (
  workspace_id TEXT NOT NULL,
  user_id TEXT NOT NULL,
  role TEXT NOT NULL CHECK (role IN ('owner', 'member', 'viewer')),
  created_at TEXT NOT NULL,
  PRIMARY KEY (workspace_id, user_id)
);

CREATE INDEX IF NOT EXISTS idx_team_members_user ON team_members(user_id);

CREATE TABLE IF NOT EXISTS workspace_invitations (
  id TEXT PRIMARY KEY,
  workspace_id TEXT NOT NULL,
  email TEXT NOT NULL,
  role TEXT NOT NULL CHECK (role IN ('member', 'viewer')),
  token_hash TEXT NOT NULL UNIQUE,
  invited_by TEXT NOT NULL,
  expires_at TEXT NOT NULL,
  accepted_at TEXT,
  created_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_workspace_invitations_workspace ON workspace_invitations(workspace_id, accepted_at);

ALTER TABLE sessions ADD COLUMN active_workspace_id TEXT;

ALTER TABLE memos ADD COLUMN is_restricted INTEGER NOT NULL DEFAULT 0;
CREATE INDEX IF NOT EXISTS idx_memos_restricted ON memos(workspace_id) WHERE is_restricted = 1;

CREATE TABLE IF NOT EXISTS page_shares (
  workspace_id TEXT NOT NULL,
  memo_id TEXT NOT NULL,
  user_id TEXT NOT NULL,
  level TEXT NOT NULL CHECK (level IN ('view', 'comment', 'edit')),
  created_at TEXT NOT NULL,
  PRIMARY KEY (memo_id, user_id)
);
