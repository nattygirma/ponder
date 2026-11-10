import type { TiptapDoc } from "@ponder/shared";
import { PageCreateSchema, PageMoveSchema, PageUpdateSchema } from "@ponder/shared";
import { zValidator } from "@hono/zod-validator";
import type { Hono } from "hono";
import type { AppEnv } from "./api-context";
import { AppError } from "./app-error";
import { apiError } from "./http-errors";
import { createMemoRecord, getMemoDetail, updateMemoRecord } from "./memo-service";
import {
  getPageNode,
  listPageBacklinks,
  listPageTree,
  movePage,
  resolveNewPagePlacement,
  setPagePlacement,
  updatePageMeta,
} from "./page-service";
import { getActorLabel, getAuditActor, getWorkspaceId, requireScopes } from "./request-auth";
import { restrictedUserId } from "./team-service";

const respond = (c: Parameters<typeof apiError>[0], error: unknown) => {
  if (error instanceof AppError) return apiError(c, error.code, error.message, error.status);
  throw error;
};

export const registerPageRoutes = (app: Hono<AppEnv>) => {
  app.get("/api/v1/pages/tree", async (c) => {
    const denied = requireScopes(c, "read:memos");
    if (denied) return denied;
    return c.json(await listPageTree(c.env.storage.db, getWorkspaceId(c), restrictedUserId(c.get("auth"))));
  });

  app.post("/api/v1/pages", zValidator("json", PageCreateSchema), async (c) => {
    const denied = requireScopes(c, "write:memos");
    if (denied) return denied;
    try {
      const db = c.env.storage.db;
      const workspaceId = getWorkspaceId(c);
      const input = c.req.valid("json");
      const placement = await resolveNewPagePlacement(db, workspaceId, input);
      const created = await createMemoRecord(
        db,
        workspaceId,
        { notebookId: placement.notebookId, title: input.title, contentMarkdown: "", tags: [] },
        getAuditActor(c),
        getActorLabel(c),
      );
      await setPagePlacement(db, workspaceId, created.id, {
        parentId: placement.parentId,
        position: placement.position,
        icon: input.icon,
      });
      const [memo, page] = await Promise.all([
        getMemoDetail(db, workspaceId, created.id),
        getPageNode(db, workspaceId, created.id),
      ]);
      return c.json({ memo: memo ?? created, page }, 201);
    } catch (error) {
      return respond(c, error);
    }
  });

  app.post("/api/v1/pages/:id/move", zValidator("json", PageMoveSchema), async (c) => {
    const denied = requireScopes(c, "write:memos");
    if (denied) return denied;
    try {
      const page = await movePage(c.env.storage.db, getWorkspaceId(c), c.req.param("id"), c.req.valid("json"));
      return c.json({ page });
    } catch (error) {
      return respond(c, error);
    }
  });

  app.patch("/api/v1/pages/:id", zValidator("json", PageUpdateSchema), async (c) => {
    const denied = requireScopes(c, "write:memos");
    if (denied) return denied;
    try {
      const { title, tags, contentJson, contentMarkdown, ...meta } = c.req.valid("json");
      if (title !== undefined || tags !== undefined || contentJson !== undefined || contentMarkdown !== undefined) {
        const saved = await updateMemoRecord(
          c.env.storage.db,
          getWorkspaceId(c),
          c.req.param("id"),
          { title, tags, contentJson: contentJson as TiptapDoc | undefined, contentMarkdown },
          getAuditActor(c),
          getActorLabel(c),
        );
        if (saved.error) return apiError(c, saved.error, saved.message, (saved.status ?? 400) as never);
      }
      const page = await updatePageMeta(c.env.storage.db, getWorkspaceId(c), c.req.param("id"), meta);
      return c.json({ page });
    } catch (error) {
      return respond(c, error);
    }
  });

  app.get("/api/v1/pages/:id/backlinks", async (c) => {
    const denied = requireScopes(c, "read:memos");
    if (denied) return denied;
    return c.json({ backlinks: await listPageBacklinks(c.env.storage.db, getWorkspaceId(c), c.req.param("id"), restrictedUserId(c.get("auth"))) });
  });
};
