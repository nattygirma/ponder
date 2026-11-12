import { DatabaseSyncCreateSchema, DatabaseSyncUpdateSchema } from "@ponder/shared";
import { zValidator } from "@hono/zod-validator";
import type { Hono } from "hono";
import { z } from "zod";
import type { AppContext, AppEnv } from "./api-context";
import { AppError } from "./app-error";
import { refreshWake } from "./automation-service";
import { runInBackground } from "./automation-routes";
import { canUseConnections, listAccounts } from "./connections";
import { createGitHubSync, deleteSync, getSync, listSyncs, runSync, syncEnvFrom, updateSync } from "./database-sync-service";
import { guarded } from "./route-guard";
import { getActorLabel, getAuditActor, getWorkspaceId } from "./request-auth";

/** Logins belong to the deployment's owner, so only the owner can point a sync at one or change what it reads. */
const requireOwner = (c: AppContext) => {
  if (!canUseConnections(c)) throw new AppError("connection_forbidden", "Only the workspace owner can set up GitHub syncs.", 403);
};

const githubAccount = async (c: AppContext, connectionId: string) => {
  const account = (await listAccounts(c, "github")).find((item) => item.id === connectionId);
  if (!account) throw new AppError("connection_missing", "Connect GitHub first.", 400);
  if (account.status !== "active") throw new AppError("connection_expired", "Log in to GitHub again first.", 400);
  return account;
};

/** The workspace's first notebook, for a sync made without one (Notion puts new syncs in Private). */
const fallbackNotebook = async (c: AppContext) => {
  const row = await c.env.storage.db
    .prepare(`SELECT id FROM notebooks WHERE workspace_id = ? AND is_deleted = 0 ORDER BY sort_order ASC, created_at ASC LIMIT 1`)
    .bind(getWorkspaceId(c))
    .first<{ id: string }>();
  if (!row) throw new AppError("invalid_request", "Make a notebook first.", 400);
  return row.id;
};

type GitHubRepository = { fullName: string; private: boolean; description: string; updatedAt: string | null };

/** Repositories the GitHub login can read, most recently updated first, for the repository picker. */
const listRepositories = async (connectionId: string, q: string): Promise<GitHubRepository[]> => {
  const query = new URLSearchParams({ per_page: "100", sort: "updated", affiliation: "owner,collaborator,organization_member" });
  const response = await fetch(`https://api.github.com/user/repos?${query}`, {
    headers: { accept: "application/vnd.github+json", "user-agent": "Ponder", "x-altstack-connection": connectionId },
  });
  if (response.status === 401) throw new AppError("connection_expired", "Log in to GitHub again to see your repositories.", 400);
  if (!response.ok) throw new AppError("github_unavailable", `GitHub didn't list your repositories (${response.status}).`, 502);
  const body = await response.json().catch(() => []) as Record<string, any>[];
  const needle = q.trim().toLowerCase();
  return (Array.isArray(body) ? body : [])
    .map((repo) => ({
      fullName: String(repo.full_name ?? ""),
      private: repo.private === true,
      description: String(repo.description ?? "").slice(0, 200),
      updatedAt: typeof repo.updated_at === "string" ? repo.updated_at : null,
    }))
    .filter((repo) => repo.fullName && (!needle || repo.fullName.toLowerCase().includes(needle)));
};

export const registerDatabaseSyncRoutes = (app: Hono<AppEnv>) => {
  app.get("/api/v1/database-syncs", (c) =>
    guarded(c, "read:memos", async () =>
      c.json({ syncs: await listSyncs(c.env.storage.db, getWorkspaceId(c)), canManage: canUseConnections(c) })));

  app.get("/api/v1/database-syncs/github/repositories", zValidator("query", z.object({ connectionId: z.string().min(1).max(200), q: z.string().max(200).optional() })), (c) =>
    guarded(c, "read:memos", async () => {
      requireOwner(c);
      const { connectionId, q } = c.req.valid("query");
      await githubAccount(c, connectionId);
      return c.json({ repositories: await listRepositories(connectionId, q ?? "") });
    }));

  app.post("/api/v1/database-syncs", zValidator("json", DatabaseSyncCreateSchema), (c) =>
    guarded(c, "write:memos", async () => {
      requireOwner(c);
      const input = c.req.valid("json");
      const account = await githubAccount(c, input.connectionId);
      const env = syncEnvFrom(c.env);
      const database = await createGitHubSync(env, getWorkspaceId(c), { ...input, notebookId: input.notebookId ?? await fallbackNotebook(c) },
        { id: account.id, name: account.name }, getAuditActor(c), getActorLabel(c));
      // Notion starts importing as soon as the sync is made; the rest follows through the cron.
      runInBackground(c, async () => {
        await runSync(env, database.id);
        await refreshWake(env);
      });
      return c.json({ database }, 201);
    }));

  app.get("/api/v1/databases/:id/sync", (c) =>
    guarded(c, "read:memos", async () => c.json({ sync: await getSync(c.env.storage.db, getWorkspaceId(c), c.req.param("id")) })));

  app.patch("/api/v1/databases/:id/sync", zValidator("json", DatabaseSyncUpdateSchema), (c) =>
    guarded(c, "write:memos", async () => {
      requireOwner(c);
      const env = syncEnvFrom(c.env);
      const sync = await updateSync(env, getWorkspaceId(c), c.req.param("id"), c.req.valid("json"));
      if (!sync.paused) {
        runInBackground(c, async () => {
          await runSync(env, sync.databaseId);
          await refreshWake(env);
        });
      }
      return c.json({ sync });
    }));

  // "Sync now": anyone who can edit the database may ask for a fresh copy.
  app.post("/api/v1/databases/:id/sync/run", (c) =>
    guarded(c, "write:memos", async () => {
      const workspaceId = getWorkspaceId(c);
      const databaseId = c.req.param("id");
      const env = syncEnvFrom(c.env);
      const current = await getSync(env.db, workspaceId, databaseId);
      if (current.paused) throw new AppError("sync_paused", "This sync is paused. Resume it to sync again.", 409);
      const outcome = await runSync(env, databaseId);
      await refreshWake(env);
      return c.json({ outcome, sync: await getSync(env.db, workspaceId, databaseId) });
    }));

  app.delete("/api/v1/databases/:id/sync", (c) =>
    guarded(c, "write:memos", async () => {
      requireOwner(c);
      await deleteSync(syncEnvFrom(c.env), getWorkspaceId(c), c.req.param("id"));
      return c.json({ ok: true });
    }));
};
