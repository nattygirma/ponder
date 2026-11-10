import type {
  InvitationPreview,
  PageAccess,
  PageAccessLevel,
  PageShare,
  TeamRole,
  WorkspaceInvitation,
  WorkspaceSummary,
} from "@ponder/shared";
import type { AuthContext } from "./api-context";
import { AppError } from "./app-error";
import { createId, isoNow } from "./entity-utils";
import { sha256 } from "./hash-utils";
import type { DatabaseAdapter, PreparedStatementAdapter } from "./storage-contract";
import { createDefaultNotebookRows } from "./workspace-provisioning";

const INVITATION_DAYS = 14;

export const isTeamAdmin = (auth: AuthContext) => !auth.teamRole || auth.teamRole === "owner";

/** The user whose page restrictions apply to this request, or undefined when none do. */
export const restrictedUserId = (auth: AuthContext) =>
  (auth.teamRole && auth.teamRole !== "owner" ? auth.actorId ?? undefined : undefined);

/** Ids of pages hidden from a user: restricted pages they have no share on, and pages inside those. */
const DENIED_PAGES_SQL = `WITH RECURSIVE denied(id) AS (
    SELECT r.id FROM memos r
    WHERE r.workspace_id = ? AND r.is_restricted = 1
      AND NOT EXISTS (SELECT 1 FROM page_shares s WHERE s.memo_id = r.id AND s.user_id = ?)
    UNION
    SELECT c.id FROM memos c
    INNER JOIN denied d ON c.parent_memo_id = d.id
    WHERE c.workspace_id = ?
      AND (c.is_restricted = 0 OR NOT EXISTS (SELECT 1 FROM page_shares s WHERE s.memo_id = c.id AND s.user_id = ?))
  )
  SELECT id FROM denied`;

export const deniedPagesCondition = (idColumn: string, workspaceId: string, userId: string) => ({
  sql: `${idColumn} NOT IN (${DENIED_PAGES_SQL})`,
  binds: [workspaceId, userId, workspaceId, userId] as unknown[],
});

const defaultLevel = (role: TeamRole): PageAccessLevel => (role === "viewer" ? "view" : "edit");

/** Nearest restricted page at or above this one; its shares decide access for the whole branch. */
const findRestrictionRoot = async (db: DatabaseAdapter, workspaceId: string, memoId: string) => {
  const row = await db
    .prepare(
      `WITH RECURSIVE chain(id, parent, restricted, depth) AS (
         SELECT id, parent_memo_id, is_restricted, 0 FROM memos WHERE workspace_id = ? AND id = ?
         UNION ALL
         SELECT m.id, m.parent_memo_id, m.is_restricted, chain.depth + 1
         FROM memos m INNER JOIN chain ON m.id = chain.parent
         WHERE m.workspace_id = ? AND chain.restricted = 0 AND chain.depth < 200
       )
       SELECT id, restricted, depth FROM chain ORDER BY depth DESC LIMIT 1`
    )
    .bind(workspaceId, memoId, workspaceId)
    .first<{ id: string; restricted: number; depth: number }>();
  return row && row.restricted === 1 ? row.id : null;
};

export const getPageAccessLevel = async (
  db: DatabaseAdapter,
  auth: AuthContext,
  memoId: string,
): Promise<PageAccessLevel> => {
  if (isTeamAdmin(auth)) return "edit";
  const root = await findRestrictionRoot(db, auth.workspaceId, memoId);
  if (!root) return defaultLevel(auth.teamRole!);
  const share = await db
    .prepare(`SELECT level FROM page_shares WHERE memo_id = ? AND user_id = ?`)
    .bind(root, auth.actorId)
    .first<{ level: Exclude<PageAccessLevel, "none"> }>();
  if (!share) return "none";
  // A viewer stays read-only even on a page shared for editing.
  return auth.teamRole === "viewer" ? "view" : share.level;
};

export const getPageAccess = async (db: DatabaseAdapter, auth: AuthContext, memoId: string): Promise<PageAccess> => {
  const memo = await db
    .prepare(`SELECT id, is_restricted, database_id FROM memos WHERE workspace_id = ? AND id = ? AND is_deleted = 0`)
    .bind(auth.workspaceId, memoId)
    .first<{ id: string; is_restricted: number; database_id: string | null }>();
  if (!memo) throw new AppError("not_found", "Page not found", 404);
  const [level, root] = await Promise.all([
    getPageAccessLevel(db, auth, memoId),
    findRestrictionRoot(db, auth.workspaceId, memoId),
  ]);
  const shares = root
    ? (await db.prepare(`SELECT user_id, level FROM page_shares WHERE memo_id = ?`).bind(root).all<{ user_id: string; level: PageShare["level"] }>())
      .results.map((row) => ({ userId: row.user_id, level: row.level }))
    : [];
  return {
    level,
    restricted: memo.is_restricted === 1,
    inheritedFrom: root && root !== memoId ? root : null,
    canManage: Boolean(auth.teamRole) && memo.database_id === null && level === "edit",
    isTeamWorkspace: Boolean(auth.teamRole),
    shares,
  };
};

export const setPageAccess = async (
  db: DatabaseAdapter,
  auth: AuthContext,
  memoId: string,
  input: { restricted: boolean; shares: PageShare[] },
): Promise<PageAccess> => {
  const current = await getPageAccess(db, auth, memoId);
  if (!current.canManage) throw new AppError("forbidden", "You can't change who has access to this page.", 403);
  const memberIds = new Set((await db
    .prepare(`SELECT user_id FROM team_members WHERE workspace_id = ?`)
    .bind(auth.workspaceId)
    .all<{ user_id: string }>()).results.map((row) => row.user_id));
  const now = isoNow();
  const shares = new Map(input.shares.filter((share) => memberIds.has(share.userId)).map((share) => [share.userId, share.level]));
  // Whoever restricts a page keeps access, so nobody locks themselves out by accident.
  if (input.restricted && auth.actorId) shares.set(auth.actorId, "edit");
  await db.batch([
    db.prepare(`UPDATE memos SET is_restricted = ? WHERE workspace_id = ? AND id = ?`).bind(input.restricted ? 1 : 0, auth.workspaceId, memoId),
    db.prepare(`DELETE FROM page_shares WHERE memo_id = ?`).bind(memoId),
    ...(input.restricted ? [...shares].map(([userId, level]) =>
      db.prepare(`INSERT INTO page_shares (workspace_id, memo_id, user_id, level, created_at) VALUES (?, ?, ?, ?, ?)`)
        .bind(auth.workspaceId, memoId, userId, level, now)) : []),
  ]);
  return getPageAccess(db, auth, memoId);
};

export const listUserWorkspaces = async (db: DatabaseAdapter, auth: AuthContext): Promise<WorkspaceSummary[]> => {
  const rows = await db
    .prepare(
      `SELECT w.id, w.name, w.is_personal, tm.role
       FROM team_members tm INNER JOIN workspaces w ON w.id = tm.workspace_id
       WHERE tm.user_id = ?
       UNION ALL
       SELECT w.id, w.name, w.is_personal, 'owner'
       FROM workspace_members wm INNER JOIN workspaces w ON w.id = wm.workspace_id
       WHERE wm.user_id = ?
       ORDER BY 3 DESC, 2 COLLATE NOCASE`
    )
    .bind(auth.actorId, auth.actorId)
    .all<{ id: string; name: string; is_personal: number; role: TeamRole }>();
  return rows.results.map((row) => ({
    id: row.id,
    name: row.name,
    isPersonal: row.is_personal === 1,
    role: row.role,
    active: row.id === auth.workspaceId,
  }));
};

export const createTeamWorkspace = async (db: DatabaseAdapter, auth: AuthContext, name: string, locale?: string | null) => {
  if (!auth.actorId || !auth.sessionId) throw new AppError("forbidden", "Sign in to create a workspace.", 403);
  const id = createId("ws");
  const now = isoNow();
  const statements: PreparedStatementAdapter[] = [
    db.prepare(`INSERT INTO workspaces (id, name, is_personal, created_at, updated_at) VALUES (?, ?, 0, ?, ?)`).bind(id, name, now, now),
    db.prepare(`INSERT INTO team_members (workspace_id, user_id, role, created_at) VALUES (?, ?, 'owner', ?)`).bind(id, auth.actorId, now),
    ...createDefaultNotebookRows(id, locale).map((notebook) => db
      .prepare(
        `INSERT INTO notebooks (id, workspace_id, parent_id, name, slug, icon, color, sort_order, created_at, updated_at)
         VALUES (?, ?, NULL, ?, ?, 'notebook', ?, ?, ?, ?)`
      )
      .bind(notebook.id, id, notebook.name, notebook.slug, notebook.color, notebook.sortOrder, now, now)),
    db.prepare(`UPDATE sessions SET active_workspace_id = ? WHERE id = ?`).bind(id, auth.sessionId),
  ];
  await db.batch(statements);
  return id;
};

export const switchWorkspace = async (db: DatabaseAdapter, auth: AuthContext, workspaceId: string) => {
  if (!auth.sessionId) throw new AppError("forbidden", "Only a signed-in session can switch workspaces.", 403);
  const workspaces = await listUserWorkspaces(db, auth);
  if (!workspaces.some((workspace) => workspace.id === workspaceId)) throw new AppError("not_found", "Workspace not found", 404);
  await db.prepare(`UPDATE sessions SET active_workspace_id = ? WHERE id = ?`).bind(workspaceId, auth.sessionId).run();
};

const requireTeamOwner = (auth: AuthContext) => {
  if (auth.teamRole !== "owner") throw new AppError("forbidden", "Only the workspace owner can do this.", 403);
};

export const renameWorkspace = async (db: DatabaseAdapter, auth: AuthContext, name: string) => {
  requireTeamOwner(auth);
  await db.prepare(`UPDATE workspaces SET name = ?, updated_at = ? WHERE id = ?`).bind(name, isoNow(), auth.workspaceId).run();
};

const countOwners = async (db: DatabaseAdapter, workspaceId: string) =>
  (await db.prepare(`SELECT COUNT(*) AS total FROM team_members WHERE workspace_id = ? AND role = 'owner'`).bind(workspaceId).first<{ total: number }>())?.total ?? 0;

const loadMemberRole = async (db: DatabaseAdapter, workspaceId: string, userId: string) => {
  const row = await db.prepare(`SELECT role FROM team_members WHERE workspace_id = ? AND user_id = ?`).bind(workspaceId, userId).first<{ role: TeamRole }>();
  if (!row) throw new AppError("not_found", "Member not found", 404);
  return row.role;
};

export const updateMemberRole = async (db: DatabaseAdapter, auth: AuthContext, userId: string, role: TeamRole) => {
  requireTeamOwner(auth);
  const current = await loadMemberRole(db, auth.workspaceId, userId);
  if (current === "owner" && role !== "owner" && await countOwners(db, auth.workspaceId) <= 1) {
    throw new AppError("last_owner", "A workspace needs at least one owner.", 409);
  }
  await db.prepare(`UPDATE team_members SET role = ? WHERE workspace_id = ? AND user_id = ?`).bind(role, auth.workspaceId, userId).run();
};

export const removeMember = async (db: DatabaseAdapter, auth: AuthContext, userId: string) => {
  if (auth.actorId !== userId) requireTeamOwner(auth);
  if (!auth.teamRole) throw new AppError("forbidden", "Your personal workspace can't be left.", 403);
  const current = await loadMemberRole(db, auth.workspaceId, userId);
  if (current === "owner" && await countOwners(db, auth.workspaceId) <= 1) {
    throw new AppError("last_owner", "A workspace needs at least one owner.", 409);
  }
  await db.batch([
    db.prepare(`DELETE FROM team_members WHERE workspace_id = ? AND user_id = ?`).bind(auth.workspaceId, userId),
    db.prepare(`DELETE FROM page_shares WHERE workspace_id = ? AND user_id = ?`).bind(auth.workspaceId, userId),
    db.prepare(`UPDATE sessions SET active_workspace_id = NULL WHERE user_id = ? AND active_workspace_id = ?`).bind(userId, auth.workspaceId),
  ]);
};

const mapInvitation = (row: { id: string; email: string; role: "member" | "viewer"; expires_at: string; created_at: string }): WorkspaceInvitation => ({
  id: row.id,
  email: row.email,
  role: row.role,
  expiresAt: row.expires_at,
  createdAt: row.created_at,
});

export const listInvitations = async (db: DatabaseAdapter, auth: AuthContext) => {
  requireTeamOwner(auth);
  const rows = await db
    .prepare(
      `SELECT id, email, role, expires_at, created_at FROM workspace_invitations
       WHERE workspace_id = ? AND accepted_at IS NULL AND expires_at > ? ORDER BY created_at DESC LIMIT 200`
    )
    .bind(auth.workspaceId, isoNow())
    .all<Parameters<typeof mapInvitation>[0]>();
  return rows.results.map(mapInvitation);
};

const randomToken = () => {
  const bytes = crypto.getRandomValues(new Uint8Array(32));
  return btoa(String.fromCharCode(...bytes)).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
};

export const createInvitation = async (
  db: DatabaseAdapter,
  auth: AuthContext,
  input: { email: string; role: "member" | "viewer" },
  origin: string,
): Promise<{ invitation: WorkspaceInvitation; workspaceName: string }> => {
  requireTeamOwner(auth);
  const token = randomToken();
  const id = createId("inv");
  const now = new Date();
  const expiresAt = new Date(now.getTime() + INVITATION_DAYS * 86_400_000).toISOString();
  const workspace = await db.prepare(`SELECT name FROM workspaces WHERE id = ?`).bind(auth.workspaceId).first<{ name: string }>();
  await db
    .prepare(
      `INSERT INTO workspace_invitations (id, workspace_id, email, role, token_hash, invited_by, expires_at, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
    )
    .bind(id, auth.workspaceId, input.email.toLowerCase(), input.role, await sha256(token), auth.actorId, expiresAt, now.toISOString())
    .run();
  return {
    invitation: { id, email: input.email.toLowerCase(), role: input.role, expiresAt, createdAt: now.toISOString(), url: `${origin}/invite/${token}` },
    workspaceName: workspace?.name ?? "",
  };
};

export const revokeInvitation = async (db: DatabaseAdapter, auth: AuthContext, id: string) => {
  requireTeamOwner(auth);
  await db.prepare(`DELETE FROM workspace_invitations WHERE id = ? AND workspace_id = ? AND accepted_at IS NULL`).bind(id, auth.workspaceId).run();
};

type InvitationRow = { id: string; workspace_id: string; email: string; role: "member" | "viewer"; name: string };

const loadOpenInvitation = async (db: DatabaseAdapter, token: string): Promise<InvitationRow> => {
  const row = await db
    .prepare(
      `SELECT i.id, i.workspace_id, i.email, i.role, w.name
       FROM workspace_invitations i INNER JOIN workspaces w ON w.id = i.workspace_id
       WHERE i.token_hash = ? AND i.accepted_at IS NULL AND i.expires_at > ?`
    )
    .bind(await sha256(token), isoNow())
    .first<InvitationRow>();
  if (!row) throw new AppError("invitation_invalid", "This invitation has expired or was already used.", 404);
  return row;
};

export const previewInvitation = async (db: DatabaseAdapter, token: string): Promise<InvitationPreview> => {
  const row = await loadOpenInvitation(db, token);
  return { workspaceName: row.name, email: row.email, role: row.role };
};

const claimStatements = (db: DatabaseAdapter, invitation: InvitationRow, userId: string, now: string) => [
  db.prepare(`INSERT OR IGNORE INTO team_members (workspace_id, user_id, role, created_at) VALUES (?, ?, ?, ?)`)
    .bind(invitation.workspace_id, userId, invitation.role, now),
  db.prepare(`UPDATE workspace_invitations SET accepted_at = ? WHERE id = ? AND accepted_at IS NULL`).bind(now, invitation.id),
];

/** Joins as the signed-in user and opens the workspace in this session. */
export const acceptInvitation = async (db: DatabaseAdapter, auth: AuthContext, token: string) => {
  if (!auth.actorId || !auth.sessionId) throw new AppError("forbidden", "Sign in to accept this invitation.", 403);
  const invitation = await loadOpenInvitation(db, token);
  await db.batch([
    ...claimStatements(db, invitation, auth.actorId, isoNow()),
    db.prepare(`UPDATE sessions SET active_workspace_id = ? WHERE id = ?`).bind(invitation.workspace_id, auth.sessionId),
  ]);
  return invitation.workspace_id;
};

