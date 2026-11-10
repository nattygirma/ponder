-- Pages inside pages: a memo can sit under another memo, carry an icon and cover,
-- and keep a manual position among its siblings. memo_links powers "Linked from".
ALTER TABLE memos ADD COLUMN parent_memo_id TEXT;
ALTER TABLE memos ADD COLUMN page_position REAL NOT NULL DEFAULT 0;
ALTER TABLE memos ADD COLUMN page_icon TEXT;
ALTER TABLE memos ADD COLUMN page_cover TEXT;

CREATE INDEX IF NOT EXISTS idx_memos_page_tree
  ON memos(workspace_id, is_deleted, parent_memo_id, page_position);

CREATE TABLE IF NOT EXISTS memo_links (
  workspace_id TEXT NOT NULL,
  source_memo_id TEXT NOT NULL,
  target_memo_id TEXT NOT NULL,
  PRIMARY KEY (source_memo_id, target_memo_id)
);

CREATE INDEX IF NOT EXISTS idx_memo_links_target
  ON memo_links(workspace_id, target_memo_id);

INSERT OR IGNORE INTO memo_links (workspace_id, source_memo_id, target_memo_id)
SELECT m.workspace_id,
       c.memo_id,
       substr(t.value, instr(t.value, '#memo=') + 6)
FROM memo_contents c
JOIN memos m ON m.id = c.memo_id,
     json_tree(CASE WHEN json_valid(c.content_json) THEN c.content_json ELSE '{}' END) t
WHERE t.key = 'href'
  AND t.type = 'text'
  AND t.value LIKE '%#memo=%';
