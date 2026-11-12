import type { Context, MiddlewareHandler } from "hono";
import type { PageAccessLevel } from "@ponder/shared";
import type { AppEnv } from "./api-context";
import { forbidden, notFound } from "./http-errors";
import { getPageAccessLevel } from "./team-service";

type Need = Exclude<PageAccessLevel, "none">;

const RANK: Record<PageAccessLevel, number> = { none: 0, view: 1, comment: 2, edit: 3 };
const RESERVED_MEMO_SEGMENTS = new Set(["batch", "merge", "trash", "with-image"]);

/** Anything a non-owner may read in a shared workspace. Deny by default: new routes stay owner-only until added. */
const READABLE = new Set([
  "me", "workspace", "workspaces", "workspace-extensions", "plugins", "templates", "tags", "notebooks", "memos", "pages",
  "databases", "comments", "notifications", "resources", "resource-uploads", "calendar", "connections",
]);
const MEMBER_WRITABLE = new Set(["me", "notebooks", "memos", "pages", "databases", "comments", "resource-uploads"]);
const ALWAYS_WRITABLE = new Set(["connections", "me", "notifications", "workspaces", "invitations", "calendar"]);

const parentFromBody = async (c: Context<AppEnv>) => {
  const body = await c.req.raw.clone().json().catch(() => null) as { parentId?: unknown } | null;
  return typeof body?.parentId === "string" ? body.parentId : null;
};

export const teamGuard: MiddlewareHandler<AppEnv> = async (c, next) => {
  const auth = c.get("auth");
  if (!auth?.teamRole || auth.teamRole === "owner" || c.req.path.startsWith("/api/v1/auth/")) return next();

  const denied = () => forbidden(c, "Your role in this workspace doesn't allow this.");
  const hidden = () => notFound(c, "Not found");
  const db = c.env.storage.db;
  const write = c.req.method !== "GET" && c.req.method !== "HEAD";
  const [area, id, sub] = c.req.path.replace(/^\/api\/v1\//, "").split("/");
  if (!area) return denied();

  if (ALWAYS_WRITABLE.has(area) && write) {
    return next();
  }
  // Anyone may leave; removing somebody else is checked against the owner role in the service.
  if (area === "workspace" && id === "members" && c.req.method === "DELETE" && sub === auth.actorId) {
    return next();
  }
  // Joining a live page is how a read-only person sees edits; the service drops their document updates.
  const collabSession = area === "pages" && sub === "collab";
  if (collabSession) {
    const level = await getPageAccessLevel(db, auth, id!);
    return level === "none" ? hidden() : next();
  }
  // Synced blocks check the original page and the copy's page themselves (synced-block-service.ts).
  if (area === "synced-blocks") return next();
  // Following a page and counting a view only need to see it, whatever the person's role.
  if (area === "pages" && id && (sub === "subscription" || sub === "views")) {
    const level = await getPageAccessLevel(db, auth, id);
    return level === "none" ? hidden() : next();
  }
  if (write ? !MEMBER_WRITABLE.has(area) || auth.teamRole === "viewer" && area !== "comments" && area !== "memos" : !READABLE.has(area)) {
    return denied();
  }

  const requireLevel = async (memoId: string, need: Need) => {
    const level = await getPageAccessLevel(db, auth, memoId);
    if (level === "none") return hidden();
    return RANK[level] >= RANK[need] ? null : denied();
  };
  const requireParent = async () => {
    const parentId = await parentFromBody(c);
    return parentId ? requireLevel(parentId, "edit") : null;
  };
  const defaultNeed: Need = write ? "edit" : "view";

  let problem: Response | null = null;
  switch (area) {
    case "memos":
      if (!id) {
        if (write && auth.teamRole === "viewer") return denied();
        break;
      }
      if (RESERVED_MEMO_SEGMENTS.has(id)) return denied();
      problem = await requireLevel(id, sub === "comments" && write ? "comment" : defaultNeed);
      break;
    case "pages":
      if (id === "tree") break;
      if (!id) {
        problem = await requireParent();
        break;
      }
      problem = await requireLevel(id, sub === "access" && write ? "view" : defaultNeed);
      if (!problem && sub === "move") problem = await requireParent();
      break;
    case "databases": {
      if (!id) {
        problem = await requireParent();
        break;
      }
      const row = await db
        .prepare(`SELECT page_memo_id FROM databases WHERE workspace_id = ? AND id = ?`)
        .bind(auth.workspaceId, id)
        .first<{ page_memo_id: string }>();
      if (!row) return hidden();
      problem = await requireLevel(row.page_memo_id, defaultNeed);
      break;
    }
    case "comments": {
      if (!id) return denied();
      const row = await db
        .prepare(`SELECT memo_id FROM memo_comments WHERE workspace_id = ? AND id = ?`)
        .bind(auth.workspaceId, id)
        .first<{ memo_id: string }>();
      if (!row) return hidden();
      problem = await requireLevel(row.memo_id, "comment");
      break;
    }
    case "resources": {
      if (!id || sub !== "blob" || write) return denied();
      const row = await db
        .prepare(`SELECT memo_id FROM resources WHERE workspace_id = ? AND id = ?`)
        .bind(auth.workspaceId, id)
        .first<{ memo_id: string | null }>();
      if (!row) return hidden();
      if (row.memo_id) problem = await requireLevel(row.memo_id, "view");
      break;
    }
    case "notebooks":
      if (id && sub) return denied();
      if (write && auth.teamRole === "viewer") return denied();
      break;
    default:
      break;
  }
  return problem ?? next();
};
