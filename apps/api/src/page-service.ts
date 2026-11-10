import { deniedPagesCondition } from "./team-service";
import { collectMemoLinkIds, DEFAULT_MEMO_TITLE, type PageBacklink, type PageNode, type PageStyle, type TiptapDoc } from "@ponder/shared";
import { AppError } from "./app-error";
import { isoNow } from "./entity-utils";
import type { DatabaseAdapter, PreparedStatementAdapter } from "./storage-contract";

// A workspace's sidebar is read as one query; past this the tree is cut and says so.
export const PAGE_TREE_LIMIT = 5000;
const POSITION_GAP = 1024;
// D1 caps one statement at 100 bound values.
const LINK_INSERT_CHUNK = 30;

type PageRow = {
  id: string;
  notebook_id: string;
  parent_memo_id: string | null;
  title: string | null;
  page_icon: string | null;
  page_cover: string | null;
  page_style: string | null;
  is_pinned: number | null;
  page_position: number;
  created_at: string;
  updated_at: string;
  linked_database_id: string | null;
};

// Empty titles are stored as a fixed placeholder; clients show their own language's word for it.
const visibleTitle = (title: string | null) => (title === DEFAULT_MEMO_TITLE ? null : title);

const parsePageStyle = (raw: string | null): PageStyle | null => {
  if (!raw) return null;
  try {
    return JSON.parse(raw) as PageStyle;
  } catch {
    return null;
  }
};

const mapPageNode = (row: PageRow): PageNode => ({
  id: row.id,
  notebookId: row.notebook_id,
  parentId: row.parent_memo_id,
  title: visibleTitle(row.title),
  icon: row.page_icon,
  cover: row.page_cover,
  position: row.page_position,
  databaseId: row.linked_database_id,
  isPinned: row.is_pinned === 1,
  style: parsePageStyle(row.page_style),
  createdAt: row.created_at,
  updatedAt: row.updated_at,
});

const PAGE_COLUMNS = `id, notebook_id, parent_memo_id, title, page_icon, page_cover, page_style, is_pinned, page_position, created_at, updated_at,
  (SELECT d.id FROM databases d WHERE d.page_memo_id = memos.id) AS linked_database_id`;

export const listPageTree = async (db: DatabaseAdapter, workspaceId: string, restrictedFor?: string) => {
  const denied = restrictedFor ? deniedPagesCondition("memos.id", workspaceId, restrictedFor) : null;
  const rows = await db
    .prepare(
      `SELECT ${PAGE_COLUMNS}
       FROM memos
       WHERE workspace_id = ? AND is_deleted = 0 AND is_archived = 0 AND merged_into_memo_id IS NULL
         AND database_id IS NULL ${denied ? `AND ${denied.sql}` : ""}
       ORDER BY page_position ASC, created_at ASC, id ASC
       LIMIT ?`
    )
    .bind(workspaceId, ...(denied?.binds ?? []), PAGE_TREE_LIMIT + 1)
    .all<PageRow>();
  const truncated = rows.results.length > PAGE_TREE_LIMIT;
  return {
    pages: rows.results.slice(0, PAGE_TREE_LIMIT).map(mapPageNode),
    truncated,
  };
};

export const getPageNode = async (db: DatabaseAdapter, workspaceId: string, id: string): Promise<PageNode | null> => {
  const row = await db
    .prepare(`SELECT ${PAGE_COLUMNS} FROM memos WHERE workspace_id = ? AND id = ? AND is_deleted = 0`)
    .bind(workspaceId, id)
    .first<PageRow>();
  return row ? mapPageNode(row) : null;
};

/** Every page under `rootIds`, in any notebook, whose deleted state matches. */
export const listPageDescendantIds = async (
  db: DatabaseAdapter,
  workspaceId: string,
  rootIds: string[],
  deletedState: 0 | 1,
  exclude: ReadonlySet<string> = new Set(),
): Promise<string[]> => {
  if (rootIds.length === 0) return [];
  const seeds = rootIds.map(() => "SELECT ?").join(" UNION ALL ");
  const rows = await db
    .prepare(
      `WITH RECURSIVE subtree(id) AS (
         ${seeds}
         UNION
         SELECT m.id FROM memos m
         INNER JOIN subtree ON m.parent_memo_id = subtree.id
         WHERE m.workspace_id = ? AND m.is_deleted = ?
       )
       SELECT id FROM subtree`
    )
    .bind(...rootIds, workspaceId, deletedState)
    .all<{ id: string }>();
  const roots = new Set(rootIds);
  return rows.results.map((row) => row.id).filter((id) => !roots.has(id) && !exclude.has(id));
};

const isInSubtree = async (db: DatabaseAdapter, workspaceId: string, rootId: string, candidateId: string) => {
  if (rootId === candidateId) return true;
  const descendants = await listPageDescendantIds(db, workspaceId, [rootId], 0);
  return descendants.includes(candidateId);
};

const nextSiblingPosition = async (
  db: DatabaseAdapter,
  workspaceId: string,
  notebookId: string,
  parentId: string | null,
) => {
  const row = await db
    .prepare(
      `SELECT MAX(page_position) AS position
       FROM memos
       WHERE workspace_id = ? AND is_deleted = 0 AND notebook_id = ? AND database_id IS NULL
         AND ${parentId ? "parent_memo_id = ?" : "parent_memo_id IS NULL"}`
    )
    .bind(...(parentId ? [workspaceId, notebookId, parentId] : [workspaceId, notebookId]))
    .first<{ position: number | null }>();
  return (row?.position ?? 0) + POSITION_GAP;
};

/** Where a new page goes: under its parent's notebook, after that parent's other children. */
export const resolveNewPagePlacement = async (
  db: DatabaseAdapter,
  workspaceId: string,
  input: { notebookId?: string; parentId?: string | null },
) => {
  const parent = input.parentId ? await getPageNode(db, workspaceId, input.parentId) : null;
  if (input.parentId && !parent) throw new AppError("not_found", "Parent page not found", 404);
  const notebookId = parent?.notebookId ?? input.notebookId;
  if (!notebookId) throw new AppError("invalid_request", "notebookId or parentId is required", 400);
  return {
    notebookId,
    parentId: parent?.id ?? null,
    position: await nextSiblingPosition(db, workspaceId, notebookId, parent?.id ?? null),
  };
};

export const setPagePlacement = async (
  db: DatabaseAdapter,
  workspaceId: string,
  id: string,
  placement: { parentId: string | null; position: number; icon?: string | null },
) => {
  await db
    .prepare(
      `UPDATE memos
       SET parent_memo_id = ?, page_position = ?, page_icon = COALESCE(?, page_icon)
       WHERE workspace_id = ? AND id = ?`
    )
    .bind(placement.parentId, placement.position, placement.icon ?? null, workspaceId, id)
    .run();
};

export const movePage = async (
  db: DatabaseAdapter,
  workspaceId: string,
  id: string,
  input: { notebookId?: string; parentId?: string | null; beforeId?: string | null; afterId?: string | null },
): Promise<PageNode> => {
  const page = await getPageNode(db, workspaceId, id);
  if (!page) throw new AppError("not_found", "Page not found", 404);

  // A drop before or after a sibling inherits that sibling's place in the tree.
  const anchorId = input.beforeId ?? input.afterId ?? null;
  const anchor = anchorId ? await getPageNode(db, workspaceId, anchorId) : null;
  if (anchorId && !anchor) throw new AppError("not_found", "Target page not found", 404);
  if (anchorId === id) return page;

  const parentId = anchor ? anchor.parentId : input.parentId === undefined ? page.parentId : input.parentId;
  const parent = parentId ? await getPageNode(db, workspaceId, parentId) : null;
  if (parentId && !parent) throw new AppError("not_found", "Parent page not found", 404);
  if (parentId && await isInSubtree(db, workspaceId, id, parentId)) {
    throw new AppError("invalid_move", "A page cannot be moved inside itself.", 400);
  }

  const notebookId = parent?.notebookId ?? anchor?.notebookId ?? input.notebookId ?? page.notebookId;
  if (notebookId !== page.notebookId) {
    const notebook = await db
      .prepare(`SELECT id FROM notebooks WHERE workspace_id = ? AND id = ? AND is_deleted = 0`)
      .bind(workspaceId, notebookId)
      .first<{ id: string }>();
    if (!notebook) throw new AppError("not_found", "Notebook not found", 404);
  }

  const position = anchor
    ? await positionNextTo(db, workspaceId, anchor, input.beforeId ? "before" : "after", id)
    : await nextSiblingPosition(db, workspaceId, notebookId, parentId);

  const now = isoNow();
  const statements: PreparedStatementAdapter[] = [
    // updated_at moves only with the notebook: reordering is not an edit, and sync picks up notebook changes by it.
    db
      .prepare(
        `UPDATE memos
         SET parent_memo_id = ?, page_position = ?, notebook_id = ?,
             updated_at = CASE WHEN notebook_id = ? THEN updated_at ELSE ? END
         WHERE workspace_id = ? AND id = ?`
      )
      .bind(parentId, position, notebookId, notebookId, now, workspaceId, id),
  ];

  if (notebookId !== page.notebookId) {
    const descendants = await listPageDescendantIds(db, workspaceId, [id], 0);
    for (let index = 0; index < descendants.length; index += 80) {
      const chunk = descendants.slice(index, index + 80);
      statements.push(
        db
          .prepare(
            `UPDATE memos SET notebook_id = ?, updated_at = ?
             WHERE workspace_id = ? AND id IN (${chunk.map(() => "?").join(", ")})`
          )
          .bind(notebookId, now, workspaceId, ...chunk),
      );
    }
  }

  await db.batch(statements);
  const moved = await getPageNode(db, workspaceId, id);
  if (!moved) throw new AppError("not_found", "Page not found after move", 404);
  return moved;
};

const positionNextTo = async (
  db: DatabaseAdapter,
  workspaceId: string,
  anchor: PageNode,
  side: "before" | "after",
  movingId: string,
) => {
  const siblings = await db
    .prepare(
      `SELECT id, page_position
       FROM memos
       WHERE workspace_id = ? AND is_deleted = 0 AND notebook_id = ? AND database_id IS NULL
         AND ${anchor.parentId ? "parent_memo_id = ?" : "parent_memo_id IS NULL"}
       ORDER BY page_position ASC, created_at ASC, id ASC`
    )
    .bind(...(anchor.parentId ? [workspaceId, anchor.notebookId, anchor.parentId] : [workspaceId, anchor.notebookId]))
    .all<{ id: string; page_position: number }>();
  const others = siblings.results.filter((row) => row.id !== movingId);
  const anchorIndex = others.findIndex((row) => row.id === anchor.id);
  const previous = side === "before" ? others[anchorIndex - 1] : others[anchorIndex];
  const next = side === "before" ? others[anchorIndex] : others[anchorIndex + 1];

  if (previous && next && previous.page_position === next.page_position) {
    // Existing notes all start at position 0, so the first manual reorder spreads this sibling list out.
    const spread = others.map((row, index) =>
      db.prepare(`UPDATE memos SET page_position = ? WHERE workspace_id = ? AND id = ?`)
        .bind((index + 1) * POSITION_GAP, workspaceId, row.id));
    await db.batch(spread);
    const previousIndex = others.findIndex((row) => row.id === previous.id);
    return (previousIndex + 1) * POSITION_GAP + POSITION_GAP / 2;
  }
  if (previous && next) return (previous.page_position + next.page_position) / 2;
  if (previous) return previous.page_position + POSITION_GAP;
  if (next) return next.page_position - POSITION_GAP;
  return POSITION_GAP;
};

export const updatePageMeta = async (
  db: DatabaseAdapter,
  workspaceId: string,
  id: string,
  input: { icon?: string | null; cover?: string | null; style?: PageStyle | null },
): Promise<PageNode> => {
  const page = await getPageNode(db, workspaceId, id);
  if (!page) throw new AppError("not_found", "Page not found", 404);
  await db
    .prepare(`UPDATE memos SET page_icon = ?, page_cover = ?, page_style = ? WHERE workspace_id = ? AND id = ?`)
    .bind(
      input.icon === undefined ? page.icon : input.icon,
      input.cover === undefined ? page.cover : input.cover,
      JSON.stringify(input.style === undefined ? page.style : input.style),
      workspaceId,
      id,
    )
    .run();
  return {
    ...page,
    icon: input.icon === undefined ? page.icon : input.icon,
    cover: input.cover === undefined ? page.cover : input.cover,
    style: input.style === undefined ? page.style : input.style,
  };
};

export const replaceMemoLinksStatements = (
  db: DatabaseAdapter,
  workspaceId: string,
  memoId: string,
  doc: TiptapDoc,
): PreparedStatementAdapter[] => {
  const targets = doc && Array.isArray(doc.content)
    ? collectMemoLinkIds(doc).filter((target) => target !== memoId)
    : [];
  const statements: PreparedStatementAdapter[] = [
    db.prepare(`DELETE FROM memo_links WHERE source_memo_id = ?`).bind(memoId),
  ];
  for (let index = 0; index < targets.length; index += LINK_INSERT_CHUNK) {
    const chunk = targets.slice(index, index + LINK_INSERT_CHUNK);
    statements.push(
      db
        .prepare(
          `INSERT OR IGNORE INTO memo_links (workspace_id, source_memo_id, target_memo_id)
           VALUES ${chunk.map(() => "(?, ?, ?)").join(", ")}`
        )
        .bind(...chunk.flatMap((target) => [workspaceId, memoId, target])),
    );
  }
  return statements;
};

export const listPageBacklinks = async (
  db: DatabaseAdapter,
  workspaceId: string,
  id: string,
  restrictedFor?: string,
): Promise<PageBacklink[]> => {
  const denied = restrictedFor ? deniedPagesCondition("m.id", workspaceId, restrictedFor) : null;
  const rows = await db
    .prepare(
      `SELECT m.id, m.notebook_id, m.title, m.page_icon, m.excerpt, m.updated_at
       FROM memo_links l
       INNER JOIN memos m ON m.id = l.source_memo_id
       WHERE l.workspace_id = ? AND l.target_memo_id = ? AND m.is_deleted = 0 ${denied ? `AND ${denied.sql}` : ""}
       ORDER BY m.updated_at DESC
       LIMIT 100`
    )
    .bind(workspaceId, id, ...(denied?.binds ?? []))
    .all<{ id: string; notebook_id: string; title: string | null; page_icon: string | null; excerpt: string; updated_at: string }>();
  return rows.results.map((row) => ({
    id: row.id,
    notebookId: row.notebook_id,
    title: visibleTitle(row.title),
    icon: row.page_icon,
    excerpt: row.excerpt,
    updatedAt: row.updated_at,
  }));
};
