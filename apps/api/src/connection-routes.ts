import { zValidator } from "@hono/zod-validator";
import type { Hono } from "hono";
import { z } from "zod";
import type { AppContext, AppEnv } from "./api-context";
import { AppError } from "./app-error";
import { canUseConnections, listAccounts, loadLinkPreview, savePageToDrive, searchConnectedApps } from "./connections";
import { guarded } from "./route-guard";

const requireConnectionOwner = (c: AppContext) => {
  if (!canUseConnections(c)) throw new AppError("connection_forbidden", "Only the workspace owner can manage connected apps.", 403);
};

export const registerConnectionRoutes = (app: Hono<AppEnv>) => {
  app.get("/api/v1/connections", (c) =>
    guarded(c, "read:memos", async () => {
      const accounts = await listAccounts(c);
      return c.json({
        // False when the app isn't running on a host that offers login connections.
        available: Boolean(c.env.listConnections),
        canManage: canUseConnections(c),
        accounts: accounts.map((account) => ({
          id: account.id,
          provider: account.provider,
          name: account.name,
          status: account.status,
          connectedAt: account.connected_at,
        })),
      });
    }));

  app.delete("/api/v1/connections/:id", (c) =>
    guarded(c, "write:memos", async () => {
      requireConnectionOwner(c);
      const removed = await c.env.disconnectConnection?.(c.req.param("id"));
      if (!removed) throw new AppError("connection_not_found", "That account is no longer connected.", 404);
      return c.json({ ok: true });
    }));

  app.post("/api/v1/connections/preview", zValidator("json", z.object({ url: z.string().trim().min(1).max(2000) })), (c) =>
    guarded(c, "read:memos", async () => c.json({ preview: await loadLinkPreview(c, c.req.valid("json").url) })));

  app.get("/api/v1/connections/search", zValidator("query", z.object({ q: z.string().trim().min(3).max(200) })), (c) =>
    guarded(c, "read:memos", async () => c.json({ results: await searchConnectedApps(c, c.req.valid("query").q) })));

  app.post("/api/v1/connections/drive/pages", zValidator("json", z.object({ title: z.string().max(500), html: z.string().max(2_000_000) })), (c) =>
    guarded(c, "write:memos", async () => {
      requireConnectionOwner(c);
      return c.json(await savePageToDrive(c, c.req.valid("json")), 201);
    }));
};
