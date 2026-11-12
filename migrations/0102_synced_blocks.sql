-- Notion's synced blocks (Phase F of the Notion blocks plan). The shared content lives here, once;
-- each page that shows the block holds only a <ponder-synced id="…"> reference to it.
-- state is the Yjs document the copies edit together (base64). content_json and content_markdown are
-- derived from it on every save, for AI, search, export and backups.
-- source_memo_id is the page the block was created on ("ORIGINAL"). Reading the content needs access
-- to that page, and editing it needs edit access to it, whichever page shows the copy.
CREATE TABLE IF NOT EXISTS synced_blocks (
  id TEXT PRIMARY KEY,
  workspace_id TEXT NOT NULL,
  source_memo_id TEXT NOT NULL,
  state TEXT NOT NULL,
  generation INTEGER NOT NULL DEFAULT 1,
  version INTEGER NOT NULL DEFAULT 1,
  content_json TEXT NOT NULL CHECK (json_valid(content_json)),
  content_markdown TEXT NOT NULL DEFAULT '',
  created_by TEXT,
  updated_by TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_synced_blocks_workspace ON synced_blocks(workspace_id);
CREATE INDEX IF NOT EXISTS idx_synced_blocks_source ON synced_blocks(source_memo_id);

-- Which pages show which synced block, rebuilt from a page's content whenever it is saved.
-- Used for "Editing in N pages", the list of pages, and Unsync all.
CREATE TABLE IF NOT EXISTS synced_block_refs (
  synced_id TEXT NOT NULL,
  memo_id TEXT NOT NULL,
  workspace_id TEXT NOT NULL,
  created_at TEXT NOT NULL,
  PRIMARY KEY (synced_id, memo_id)
);

CREATE INDEX IF NOT EXISTS idx_synced_block_refs_memo ON synced_block_refs(memo_id);
