import { zValidator } from "@hono/zod-validator";
import type { TiptapDoc } from "@ponder/shared";
import type { Hono } from "hono";
import { z } from "zod";
import type { AppEnv } from "./api-context";
import { AppError } from "./app-error";
import { updateMemoRecord } from "./memo-service";
import { getActorLabel, getAuditActor } from "./request-auth";
import { guarded } from "./route-guard";
import { createSyncedBlock, expandSyncedForReader, getSyncedBlock, syncSyncedBlock, unsyncAllCopies } from "./synced-block-service";

const MemoId = z.string().trim().min(1).max(200);
const CreateSchema = z.object({ memoId: MemoId, content: z.record(z.string(), z.unknown()).optional() });
const SyncSchema = z.object({
  memoId: MemoId.nullable().optional(),
  generation: z.number().int().min(0),
  version: z.number().int().min(0),
  update: z.string().max(3_000_000).optional(),
  stateVector: z.string().max(100_000).optional(),
});
const ExpandSchema = z.object({ markdown: z.string().max(5_000_000) });

/**
 * Synced blocks (Notion blocks plan, Phase F). Every route checks the original page and the page
 * showing the copy itself (synced-block-service.ts), so the team guard lets them through.
 */
export const registerSyncedBlockRoutes = (app: Hono<AppEnv>) => {
  app.post("/api/v1/synced-blocks", zValidator("json", CreateSchema), (c) => guarded(c, "write:memos", async () => {
    const input = c.req.valid("json");
    const created = await createSyncedBlock(c.env.storage.db, c.get("auth"), input.memoId, input.content as TiptapDoc | undefined);
    return c.json(created, 201);
  }));

  app.post("/api/v1/synced-blocks/expand", zValidator("json", ExpandSchema), (c) => guarded(c, "read:memos", async () =>
    c.json({ markdown: await expandSyncedForReader(c.env.storage.db, c.get("auth"), c.req.valid("json").markdown) })));

  app.get("/api/v1/synced-blocks/:id", (c) => guarded(c, "read:memos", async () =>
    c.json({ block: await getSyncedBlock(c.env.storage.db, c.get("auth"), c.req.param("id"), c.req.query("memoId") ?? null) })));

  app.post("/api/v1/synced-blocks/:id/sync", zValidator("json", SyncSchema), (c) => guarded(c, "read:memos", async () => {
    const input = c.req.valid("json");
    c.header("Cache-Control", "no-store");
    return c.json(await syncSyncedBlock(c.env.storage.db, c.get("auth"), c.req.param("id"), { ...input, memoId: input.memoId ?? null }));
  }));

  app.post("/api/v1/synced-blocks/:id/unsync-all", (c) => guarded(c, "write:memos", async () => {
    const db = c.env.storage.db;
    const auth = c.get("auth");
    const result = await unsyncAllCopies(db, auth, c.req.param("id"), async (memoId, doc) => {
      const saved = await updateMemoRecord(db, auth.workspaceId, memoId, { contentJson: doc, allowDestructiveOverwrite: true }, getAuditActor(c), getActorLabel(c));
      if ("error" in saved && saved.error) throw new AppError(saved.error, saved.message, saved.status ?? 500);
    });
    return c.json(result);
  }));
};
