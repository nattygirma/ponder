import {
  AutomationCreateSchema,
  AutomationUpdateSchema,
  ButtonConfigSchema,
  ButtonRunSchema,
  isValidTimeZone,
} from "@ponder/shared";
import { zValidator } from "@hono/zod-validator";
import type { Hono } from "hono";
import type { AppContext, AppEnv } from "./api-context";
import { AppError } from "./app-error";
import {
  automationEnvFrom,
  createAutomation,
  deleteAutomation,
  emailUsage,
  handleRowChange,
  listAutomationRuns,
  listAutomations,
  refreshWake,
  runButton,
  updateAutomation,
} from "./automation-service";
import { getDatabase, getDatabaseRow, getRowContext, type RowChange, type RowWriteOptions } from "./database-service";
import { apiError } from "./http-errors";
import { getActorLabel, getAuditActor, getWorkspaceId, requireScopes } from "./request-auth";

const guarded = async (c: AppContext, scope: "read:memos" | "write:memos", handler: () => Promise<Response>) => {
  const denied = requireScopes(c, scope);
  if (denied) return denied;
  try {
    return await handler();
  } catch (error) {
    if (error instanceof AppError) return apiError(c, error.code, error.message, error.status);
    throw error;
  }
};

/** Work that runs after the response, in the Worker's waitUntil where there is one (tests and Node run it inline). */
export const runInBackground = (c: AppContext, work: () => Promise<unknown>) => {
  const task = work().catch((error: unknown) => console.error("Ponder background work failed", error));
  try {
    c.executionCtx.waitUntil(task);
  } catch {
    // No execution context: the promise still runs.
  }
  return task;
};

/**
 * Row writes from people and API tokens pass this, so automations run once the write has committed.
 * Automations' own writes never do (see automation-service.ts), which is the loop guard.
 */
export const rowChangeListener = (c: AppContext): RowWriteOptions => {
  const env = automationEnvFrom(c.env);
  return { onRowChange: (change: RowChange) => void runInBackground(c, () => handleRowChange(env, change)) };
};

/** Recomputes the next wake after something scheduled changed (a template's "Duplicate every…"). */
export const refreshWakeLater = (c: AppContext) => void runInBackground(c, () => refreshWake(automationEnvFrom(c.env)));

const clickerName = (c: AppContext) => {
  const auth = c.get("auth");
  return auth.displayName || auth.username;
};

const timeZoneOf = (c: AppContext) => {
  const zone = c.req.header("x-ponder-time-zone") ?? "";
  return isValidTimeZone(zone) ? zone : "UTC";
};

export const registerAutomationRoutes = (app: Hono<AppEnv>) => {
  app.get("/api/v1/databases/:id/automations", (c) =>
    guarded(c, "read:memos", async () => {
      const env = automationEnvFrom(c.env);
      const [automations, email] = await Promise.all([
        listAutomations(env.db, getWorkspaceId(c), c.req.param("id")),
        emailUsage(env),
      ]);
      return c.json({ automations, email, webhooks: Boolean(env.emitEvent) });
    }));

  app.post("/api/v1/databases/:id/automations", zValidator("json", AutomationCreateSchema), (c) =>
    guarded(c, "write:memos", async () =>
      c.json({
        automation: await createAutomation(automationEnvFrom(c.env), getWorkspaceId(c), c.req.param("id"), c.req.valid("json"), getAuditActor(c).actorId),
      }, 201)));

  app.patch("/api/v1/databases/:id/automations/:automationId", zValidator("json", AutomationUpdateSchema), (c) =>
    guarded(c, "write:memos", async () =>
      c.json({
        automation: await updateAutomation(automationEnvFrom(c.env), getWorkspaceId(c), c.req.param("id"), c.req.param("automationId"), c.req.valid("json")),
      })));

  app.delete("/api/v1/databases/:id/automations/:automationId", (c) =>
    guarded(c, "write:memos", async () => {
      await deleteAutomation(automationEnvFrom(c.env), getWorkspaceId(c), c.req.param("id"), c.req.param("automationId"));
      return c.json({ ok: true });
    }));

  app.get("/api/v1/databases/:id/automation-runs", (c) =>
    guarded(c, "read:memos", async () => {
      await getDatabase(c.env.storage.db, getWorkspaceId(c), c.req.param("id"));
      const runs = await listAutomationRuns(c.env.storage.db, getWorkspaceId(c), c.req.param("id"), c.req.query("automation") ?? null);
      return c.json({ runs });
    }));

  // A Button property, clicked in a row.
  app.post("/api/v1/databases/:id/rows/:rowId/buttons/:propertyId", (c) =>
    guarded(c, "write:memos", async () => {
      const workspaceId = getWorkspaceId(c);
      const db = c.env.storage.db;
      const database = await getDatabase(db, workspaceId, c.req.param("id"));
      const property = database.schema.properties.find((item) => item.id === c.req.param("propertyId"));
      if (property?.type !== "button") throw new AppError("not_found", "Button not found", 404);
      const config = ButtonConfigSchema.safeParse(property.button ?? { actions: [] });
      if (!config.success || config.data.actions.length === 0) throw new AppError("invalid_button", "This button has no actions yet.", 400);
      const row = await getDatabaseRow(db, workspaceId, database.id, c.req.param("rowId"));
      const outcome = await runButton(automationEnvFrom(c.env), {
        workspaceId, actions: config.data.actions, database, row, pageId: row.id,
        actor: getAuditActor(c), actorLabel: getActorLabel(c), authorName: clickerName(c), timeZone: timeZoneOf(c),
        writeOptions: rowChangeListener(c),
      });
      return c.json({ outcome });
    }));

  // A /button block on a page. Its actions are stored in the page, so they come with the click.
  app.post("/api/v1/buttons/run", zValidator("json", ButtonRunSchema), (c) =>
    guarded(c, "write:memos", async () => {
      const workspaceId = getWorkspaceId(c);
      const { pageId, actions } = c.req.valid("json");
      if (pageId) {
        const page = await c.env.storage.db
          .prepare(`SELECT id FROM memos WHERE workspace_id = ? AND id = ? AND is_deleted = 0`)
          .bind(workspaceId, pageId)
          .first<{ id: string }>();
        if (!page) throw new AppError("not_found", "Page not found", 404);
      }
      const context = pageId ? await getRowContext(c.env.storage.db, workspaceId, pageId) : null;
      const outcome = await runButton(automationEnvFrom(c.env), {
        workspaceId, actions, database: context?.database ?? null, row: context?.row ?? null, pageId: pageId ?? null,
        actor: getAuditActor(c), actorLabel: getActorLabel(c), authorName: clickerName(c), timeZone: timeZoneOf(c),
        writeOptions: rowChangeListener(c),
      });
      return c.json({ outcome });
    }));
};
