import { CommentCreateSchema, CommentUpdateSchema, NotificationsReadSchema } from "@ponder/shared";
import { zValidator } from "@hono/zod-validator";
import type { Hono } from "hono";
import type { AppContext, AppEnv } from "./api-context";
import { AppError } from "./app-error";
import {
  createMemoComment,
  deleteMemoComment,
  listMemoComments,
  listNotifications,
  listWorkspaceMembers,
  markNotificationsRead,
  updateMemoComment,
  type CommentEmail,
} from "./comment-service";
import { apiError } from "./http-errors";
import { getWorkspaceId, requireScopes } from "./request-auth";

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

/** Email is best effort: the comment and the in-app notification already exist. */
const sendEmails = async (c: AppContext, emails: CommentEmail[]) => {
  const send = c.env.sendEmail;
  if (!send) return;
  await Promise.all(emails.map((email) => send(email).catch((error: unknown) => {
    console.error("Ponder notification email failed", error);
  })));
};

export const registerCommentRoutes = (app: Hono<AppEnv>) => {
  app.get("/api/v1/workspace/members", (c) =>
    guarded(c, "read:memos", async () => c.json({ members: await listWorkspaceMembers(c.env.storage.db, getWorkspaceId(c)) })));

  app.get("/api/v1/memos/:id/comments", (c) =>
    guarded(c, "read:memos", async () => c.json({ comments: await listMemoComments(c.env.storage.db, getWorkspaceId(c), c.req.param("id")) })));

  app.post("/api/v1/memos/:id/comments", zValidator("json", CommentCreateSchema), (c) =>
    guarded(c, "write:memos", async () => {
      const { comment, emails } = await createMemoComment(c.env.storage.db, getWorkspaceId(c), c.req.param("id"), c.req.valid("json"), c.get("auth"));
      await sendEmails(c, emails);
      return c.json({ comment }, 201);
    }));

  app.patch("/api/v1/comments/:id", zValidator("json", CommentUpdateSchema), (c) =>
    guarded(c, "write:memos", async () =>
      c.json({ comment: await updateMemoComment(c.env.storage.db, getWorkspaceId(c), c.req.param("id"), c.req.valid("json"), c.get("auth")) })));

  app.delete("/api/v1/comments/:id", (c) =>
    guarded(c, "write:memos", async () => {
      await deleteMemoComment(c.env.storage.db, getWorkspaceId(c), c.req.param("id"), c.get("auth"));
      return c.json({ ok: true });
    }));

  app.get("/api/v1/notifications", (c) =>
    guarded(c, "read:memos", async () => {
      const auth = c.get("auth");
      if (!auth.actorId || auth.kind !== "user") return c.json({ notifications: [], unread: 0 });
      return c.json(await listNotifications(c.env.storage.db, auth.actorId, getWorkspaceId(c)));
    }));

  app.post("/api/v1/notifications/read", zValidator("json", NotificationsReadSchema), (c) =>
    guarded(c, "write:memos", async () => {
      const auth = c.get("auth");
      if (auth.actorId && auth.kind === "user") {
        await markNotificationsRead(c.env.storage.db, auth.actorId, getWorkspaceId(c), c.req.valid("json"));
      }
      return c.json({ ok: true });
    }));
};
