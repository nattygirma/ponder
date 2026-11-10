import type { Hono } from "hono";
import type { AppContext, AppEnv, AuthContext } from "./api-context";
import { unauthorized } from "./http-errors";
import { requireOwner } from "./request-auth";
import { mapResourceStorageSummary, type ResourceStatsRow } from "./resource-service";

type UserRouteDependencies = {
  authenticateRequest: (context: AppContext, touch: boolean) => Promise<AuthContext | null>;
};

const requireOwnerRequest = async (
  context: AppContext,
  authenticateRequest: UserRouteDependencies["authenticateRequest"],
) => {
  const auth = await authenticateRequest(context, true);
  if (!auth) return unauthorized(context, "Authentication required.");
  context.set("auth", auth);
  return requireOwner(context);
};

export const registerUserRoutes = (
  app: Hono<AppEnv>,
  dependencies: UserRouteDependencies,
) => {
  app.get("/api/v1/instance/storage-usage", async (context) => {
    const denied = await requireOwnerRequest(context, dependencies.authenticateRequest);
    if (denied) return denied;

    const [stats, userStats] = await Promise.all([
      context.env.storage.db.prepare(
        `SELECT COUNT(*) AS total_count,
                COALESCE(SUM(r.byte_size), 0) AS total_bytes,
                COALESCE(SUM(CASE WHEN r.kind = 'image' THEN 1 ELSE 0 END), 0) AS image_count,
                COALESCE(SUM(CASE WHEN r.kind = 'attachment' THEN 1 ELSE 0 END), 0) AS attachment_count
         FROM resources r
         INNER JOIN memos m ON m.id = r.memo_id
         WHERE r.is_deleted = 0`,
      ).first<ResourceStatsRow>(),
      context.env.storage.db.prepare(
        `SELECT wm.user_id, COUNT(r.memo_id) AS total_count,
                COALESCE(SUM(r.byte_size), 0) AS total_bytes,
                COALESCE(SUM(CASE WHEN r.kind = 'image' THEN 1 ELSE 0 END), 0) AS image_count,
                COALESCE(SUM(CASE WHEN r.kind = 'attachment' THEN 1 ELSE 0 END), 0) AS attachment_count
         FROM workspace_members wm
         LEFT JOIN memos m ON m.workspace_id = wm.workspace_id
         LEFT JOIN resources r ON r.memo_id = m.id AND r.is_deleted = 0
         GROUP BY wm.user_id`,
      ).all<ResourceStatsRow & { user_id: string }>(),
    ]);

    return context.json({
      summary: mapResourceStorageSummary(stats),
      users: userStats.results.map((row) => ({
        userId: row.user_id,
        summary: mapResourceStorageSummary(row),
      })),
    });
  });

};
