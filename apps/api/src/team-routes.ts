import {
  CollabLeaveSchema,
  CollabSyncSchema,
  InvitationCreateSchema,
  MemberUpdateSchema,
  PageAccessUpdateSchema,
  WorkspaceCreateSchema,
  WorkspaceUpdateSchema,
} from "@ponder/shared";
import { zValidator } from "@hono/zod-validator";
import type { Hono } from "hono";
import type { AppContext, AppEnv } from "./api-context";
import { AppError } from "./app-error";
import { isDemoModeEnabled } from "./demo-mode";
import { joinCollab, leaveCollab, syncCollab } from "./collab-service";
import { wakeForReminders } from "./automation-service";
import { apiError } from "./http-errors";
import { requireUser } from "./request-auth";
import {
  acceptInvitation,
  createInvitation,
  createTeamWorkspace,
  getPageAccess,
  getPageAccessLevel,
  listInvitations,
  listUserWorkspaces,
  previewInvitation,
  removeMember,
  renameWorkspace,
  revokeInvitation,
  setPageAccess,
  switchWorkspace,
  updateMemberRole,
} from "./team-service";

const run = async (c: AppContext, handler: () => Promise<Response>) => {
  try {
    return await handler();
  } catch (error) {
    if (error instanceof AppError) return apiError(c, error.code, error.message, error.status);
    throw error;
  }
};

const userOnly = (c: AppContext, handler: () => Promise<Response>) => {
  const denied = requireUser(c);
  return denied ?? run(c, handler);
};

export const registerPublicInvitationRoutes = (app: Hono<AppEnv>) => {
  app.get("/api/public/invitations/:token", (c) =>
    run(c, async () => c.json({ invitation: await previewInvitation(c.env.storage.db, c.req.param("token")) })));
};

export const registerTeamRoutes = (app: Hono<AppEnv>) => {
  app.get("/api/v1/workspaces", (c) =>
    userOnly(c, async () => c.json({ workspaces: await listUserWorkspaces(c.env.storage.db, c.get("auth")) })));

  app.post("/api/v1/workspaces", zValidator("json", WorkspaceCreateSchema), (c) =>
    userOnly(c, async () => {
      if (isDemoModeEnabled(c.env.PONDER_DEMO_MODE)) throw new AppError("demo_mode", "Shared workspaces are off in the demo.", 403);
      const id = await createTeamWorkspace(c.env.storage.db, c.get("auth"), c.req.valid("json").name, c.req.header("accept-language"));
      return c.json({ id }, 201);
    }));

  app.post("/api/v1/workspaces/:id/switch", (c) =>
    userOnly(c, async () => {
      await switchWorkspace(c.env.storage.db, c.get("auth"), c.req.param("id"));
      return c.json({ ok: true });
    }));

  app.patch("/api/v1/workspace", zValidator("json", WorkspaceUpdateSchema), (c) =>
    userOnly(c, async () => {
      await renameWorkspace(c.env.storage.db, c.get("auth"), c.req.valid("json").name);
      return c.json({ ok: true });
    }));

  app.patch("/api/v1/workspace/members/:userId", zValidator("json", MemberUpdateSchema), (c) =>
    userOnly(c, async () => {
      await updateMemberRole(c.env.storage.db, c.get("auth"), c.req.param("userId"), c.req.valid("json").role);
      return c.json({ ok: true });
    }));

  app.delete("/api/v1/workspace/members/:userId", (c) =>
    userOnly(c, async () => {
      await removeMember(c.env.storage.db, c.get("auth"), c.req.param("userId"));
      return c.json({ ok: true });
    }));

  app.get("/api/v1/workspace/invitations", (c) =>
    userOnly(c, async () => c.json({ invitations: await listInvitations(c.env.storage.db, c.get("auth")) })));

  app.post("/api/v1/workspace/invitations", zValidator("json", InvitationCreateSchema), (c) =>
    userOnly(c, async () => {
      const auth = c.get("auth");
      const input = c.req.valid("json");
      const { invitation, workspaceName } = await createInvitation(c.env.storage.db, auth, input, c.req.header("origin") ?? new URL(c.req.url).origin);
      let emailed = false;
      if (c.env.sendEmail) {
        // The owner always gets the link back, so a failed send never loses the invitation.
        emailed = await c.env.sendEmail({
          to: invitation.email,
          subject: `${auth.displayName ?? auth.username} invited you to ${workspaceName}`,
          text: `Join ${workspaceName}:\n\n${invitation.url}\n\nThis link works for ${14} days.`,
        }).then(() => true, (error: unknown) => {
          console.error("Ponder invitation email failed", error);
          return false;
        });
      }
      return c.json({ invitation, emailed }, 201);
    }));

  app.delete("/api/v1/workspace/invitations/:id", (c) =>
    userOnly(c, async () => {
      await revokeInvitation(c.env.storage.db, c.get("auth"), c.req.param("id"));
      return c.json({ ok: true });
    }));

  app.post("/api/v1/invitations/:token/accept", (c) =>
    userOnly(c, async () => c.json({ workspaceId: await acceptInvitation(c.env.storage.db, c.get("auth"), c.req.param("token")) })));

  const canEditPage = async (c: AppContext) => (await getPageAccessLevel(c.env.storage.db, c.get("auth"), c.req.param("id")!)) === "edit";

  app.post("/api/v1/pages/:id/collab/join", (c) =>
    userOnly(c, async () => c.json(await joinCollab(c.env.storage.db, c.get("auth"), c.req.param("id"), await canEditPage(c)))));

  app.post("/api/v1/pages/:id/collab/sync", zValidator("json", CollabSyncSchema), (c) =>
    userOnly(c, async () => c.json(await syncCollab(c.env.storage.db, c.get("auth"), c.req.param("id"), c.req.valid("json"), await canEditPage(c),
      () => wakeForReminders(c.env, { remindersChanged: true })))));

  app.post("/api/v1/pages/:id/collab/leave", zValidator("json", CollabLeaveSchema), (c) =>
    userOnly(c, async () => {
      await leaveCollab(c.env.storage.db, c.get("auth"), c.req.param("id"), c.req.valid("json"), await canEditPage(c),
        () => wakeForReminders(c.env, { remindersChanged: true }));
      return c.json({ ok: true });
    }));

  app.get("/api/v1/pages/:id/access", (c) =>
    run(c, async () => c.json({ access: await getPageAccess(c.env.storage.db, c.get("auth"), c.req.param("id")) })));

  app.put("/api/v1/pages/:id/access", zValidator("json", PageAccessUpdateSchema), (c) =>
    userOnly(c, async () => c.json({ access: await setPageAccess(c.env.storage.db, c.get("auth"), c.req.param("id"), c.req.valid("json")) })));
};
