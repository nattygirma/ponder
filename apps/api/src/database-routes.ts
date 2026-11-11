import {
  DatabaseCreateSchema,
  DatabaseRowCreateSchema,
  DatabaseRowUpdateSchema,
  DatabaseTemplateCreateSchema,
  DatabaseTemplateUpdateSchema,
  DatabaseUpdateSchema,
  DatabaseViewCreateSchema,
  DatabaseViewUpdateSchema,
} from "@ponder/shared";
import { zValidator } from "@hono/zod-validator";
import type { Hono } from "hono";
import type { AppContext, AppEnv } from "./api-context";
import { AppError } from "./app-error";
import {
  createDatabase,
  createDatabaseRow,
  createDatabaseTemplate,
  createDatabaseView,
  deleteDatabaseTemplate,
  deleteDatabaseView,
  getDatabase,
  getRowContext,
  listDatabaseRows,
  updateDatabaseRow,
  updateDatabase,
  updateDatabaseTemplate,
  updateDatabaseView,
} from "./database-service";
import { refreshWakeLater, rowChangeListener } from "./automation-routes";
import { apiError } from "./http-errors";
import { getActorLabel, getAuditActor, getWorkspaceId, requireScopes } from "./request-auth";

const guarded = async (
  c: AppContext,
  scope: "read:memos" | "write:memos",
  handler: () => Promise<Response>,
) => {
  const denied = requireScopes(c, scope);
  if (denied) return denied;
  try {
    return await handler();
  } catch (error) {
    if (error instanceof AppError) return apiError(c, error.code, error.message, error.status);
    throw error;
  }
};

export const registerDatabaseRoutes = (app: Hono<AppEnv>) => {
  app.post("/api/v1/databases", zValidator("json", DatabaseCreateSchema), (c) =>
    guarded(c, "write:memos", async () =>
      c.json({
        database: await createDatabase(c.env.storage.db, getWorkspaceId(c), c.req.valid("json"), getAuditActor(c), getActorLabel(c)),
      }, 201)));

  app.get("/api/v1/databases/:id", (c) =>
    guarded(c, "read:memos", async () => c.json({ database: await getDatabase(c.env.storage.db, getWorkspaceId(c), c.req.param("id")) })));

  app.patch("/api/v1/databases/:id", zValidator("json", DatabaseUpdateSchema), (c) =>
    guarded(c, "write:memos", async () =>
      c.json({
        database: await updateDatabase(c.env.storage.db, getWorkspaceId(c), c.req.param("id"), c.req.valid("json"), getAuditActor(c), getActorLabel(c)),
      })));

  app.get("/api/v1/databases/:id/rows", (c) =>
    guarded(c, "read:memos", async () => {
      const cursor = c.req.query("cursor");
      const separator = cursor?.indexOf(":") ?? -1;
      const limit = Number(c.req.query("limit"));
      return c.json(await listDatabaseRows(c.env.storage.db, getWorkspaceId(c), c.req.param("id"), {
        afterPosition: cursor && separator > 0 ? Number(cursor.slice(0, separator)) : undefined,
        afterId: cursor && separator > 0 ? cursor.slice(separator + 1) : undefined,
        limit: Number.isFinite(limit) && limit > 0 ? limit : undefined,
      }));
    }));

  app.post("/api/v1/databases/:id/rows", zValidator("json", DatabaseRowCreateSchema), (c) =>
    guarded(c, "write:memos", async () =>
      c.json({
        row: await createDatabaseRow(c.env.storage.db, getWorkspaceId(c), c.req.param("id"), c.req.valid("json"), getAuditActor(c), getActorLabel(c), rowChangeListener(c)),
      }, 201)));

  app.patch("/api/v1/databases/:id/rows/:rowId", zValidator("json", DatabaseRowUpdateSchema), (c) =>
    guarded(c, "write:memos", async () =>
      c.json({
        row: await updateDatabaseRow(c.env.storage.db, getWorkspaceId(c), c.req.param("id"), c.req.param("rowId"), c.req.valid("json"), getAuditActor(c), getActorLabel(c), rowChangeListener(c)),
      })));

  app.post("/api/v1/databases/:id/views", zValidator("json", DatabaseViewCreateSchema), (c) =>
    guarded(c, "write:memos", async () =>
      c.json({ view: await createDatabaseView(c.env.storage.db, getWorkspaceId(c), c.req.param("id"), c.req.valid("json")) }, 201)));

  app.patch("/api/v1/databases/:id/views/:viewId", zValidator("json", DatabaseViewUpdateSchema), (c) =>
    guarded(c, "write:memos", async () =>
      c.json({ view: await updateDatabaseView(c.env.storage.db, getWorkspaceId(c), c.req.param("id"), c.req.param("viewId"), c.req.valid("json")) })));

  app.delete("/api/v1/databases/:id/views/:viewId", (c) =>
    guarded(c, "write:memos", async () => {
      await deleteDatabaseView(c.env.storage.db, getWorkspaceId(c), c.req.param("id"), c.req.param("viewId"));
      return c.json({ ok: true });
    }));

  app.post("/api/v1/databases/:id/templates", zValidator("json", DatabaseTemplateCreateSchema), (c) =>
    guarded(c, "write:memos", async () =>
      c.json({ template: await createDatabaseTemplate(c.env.storage.db, getWorkspaceId(c), c.req.param("id"), c.req.valid("json")) }, 201)));

  app.patch("/api/v1/databases/:id/templates/:templateId", zValidator("json", DatabaseTemplateUpdateSchema), (c) =>
    guarded(c, "write:memos", async () => {
      const input = c.req.valid("json");
      const template = await updateDatabaseTemplate(c.env.storage.db, getWorkspaceId(c), c.req.param("id"), c.req.param("templateId"), input);
      if (input.repeat !== undefined) refreshWakeLater(c);
      return c.json({ template });
    }));

  app.delete("/api/v1/databases/:id/templates/:templateId", (c) =>
    guarded(c, "write:memos", async () => {
      await deleteDatabaseTemplate(c.env.storage.db, getWorkspaceId(c), c.req.param("id"), c.req.param("templateId"));
      return c.json({ ok: true });
    }));

  app.get("/api/v1/memos/:id/database-row", (c) =>
    guarded(c, "read:memos", async () => c.json({ context: await getRowContext(c.env.storage.db, getWorkspaceId(c), c.req.param("id")) })));
};
