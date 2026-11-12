import { afterEach, describe, expect, test } from "bun:test";
import { Database } from "bun:sqlite";
import { globSync, readFileSync } from "node:fs";
import { Hono } from "hono";
import { createSelfHostedStorageAdapter } from "./self-hosted-storage-adapter.ts";
import { registerCompanionRoutes } from "./companion-routes.ts";
import { beginCompanionTurn, checkpointCompanionTurn, getCompanionTurn, mapCompanionTurn, mergeAiRequests } from "./companion-service.ts";
import { toUsageRecord } from "./companion-usage.ts";
import { resetHostAiModelCache } from "./host-ai.ts";

// A chat reply's "…" card: on AppKeep it reads the usage record of each model call the browser saved with the turn;
// elsewhere it shows the AI SDK's token counts. Only the signed-in member's own turns.

const databases = [];
afterEach(() => { databases.splice(0).forEach((db) => db.close()); resetHostAiModelCache(); });
const scope = { workspaceId: "ws_usage", ownerId: "owner" };

const record = (id, extra = {}) => ({
  id, model: "claude-sonnet-5-5", provider: "anthropic", paid_with: "credits", result: "ok", stop_reason: "end_turn",
  usage: { input_tokens: 120, cache_read_tokens: 3000, cache_write_tokens: 0, output_tokens: 80, thinking_tokens: 20 },
  price_micros: 4200, estimated: false, started_at: "2026-11-12T10:00:00.000Z", first_token_ms: 900, duration_ms: 3100,
  deployment_id: "dep_secret", account_id: "acct_secret", ...extra,
});

async function setup({ hostAiUsage, hostAiModels } = {}) {
  const sqlite = new Database(":memory:"); databases.push(sqlite);
  for (const file of globSync("migrations/*.sql").sort()) sqlite.exec(readFileSync(file, "utf8"));
  sqlite.query("INSERT INTO workspaces(id, name) VALUES (?, 'Test')").run(scope.workspaceId);
  const storage = createSelfHostedStorageAdapter(sqlite, "/tmp/ponder-companion-usage-test-unused");
  const db = storage.db;
  const auth = { kind: "user", actorType: "user", actorId: scope.ownerId, workspaceId: scope.workspaceId, scopes: [], role: "member" };
  const lookups = [];
  const env = {
    storage,
    ...(hostAiUsage ? { hostAiUsage: async (id) => { lookups.push(id); return hostAiUsage(id); } } : {}),
    ...(hostAiModels ? { hostAiModels } : {}),
  };
  const turn = await beginCompanionTurn(db, scope, {
    id: crypto.randomUUID(), threadId: crypto.randomUUID(), message: "Summarise my notes", allowNotes: true, useMemory: false, locale: "en-US",
  }, "claude-sonnet-5-5");
  const app = new Hono();
  app.use("*", async (c, next) => { c.set("auth", c.req.header("x-other") ? { ...auth, actorId: "other" } : auth); await next(); });
  registerCompanionRoutes(app, { isDemoMode: () => false });
  const call = (path, init = {}) => app.request(`/api/v1/companion/${path}`, init, env);
  const post = (path, body) => call(path, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
  return { sqlite, db, turn, env, lookups, call, post };
}

describe("companion turn usage", () => {
  test("the browser's usage ids are saved with the turn, merged across checkpoints, and checked", async () => {
    const s = await setup();
    expect((await s.post(`turns/${s.turn.id}/checkpoint`, { response: "", process: "", aiRequests: ["air_1"] })).status).toBe(200);
    // A checkpoint without ids leaves the saved ones alone.
    expect((await s.post(`turns/${s.turn.id}/checkpoint`, { response: "Half", process: "" })).status).toBe(200);
    const completed = await s.post(`turns/${s.turn.id}/complete`, { response: "Done.", process: "", status: "completed", inputTokens: 10, outputTokens: 4, aiRequests: ["air_1", "air_2"] });
    expect(completed.status).toBe(200);
    expect((await completed.json()).turn.aiRequests).toEqual(["air_1", "air_2"]);

    const bad = await setup();
    const rejected = await bad.post(`turns/${bad.turn.id}/checkpoint`, { response: "", process: "", aiRequests: ["air 1; DROP"] });
    expect(rejected.status).toBe(400);
    const tooMany = await bad.post(`turns/${bad.turn.id}/checkpoint`, { response: "", process: "", aiRequests: Array.from({ length: 65 }, (_, i) => `air_${i}`) });
    expect(tooMany.status).toBe(400);
  });

  test("mergeAiRequests keeps order, drops repeats and stays within the cap", async () => {
    const s = await setup();
    expect(mergeAiRequests({ ai_requests_json: '["a","b"]' }, undefined)).toBeUndefined();
    expect(mergeAiRequests({ ai_requests_json: '["a","b"]' }, ["b", "c"])).toEqual(["a", "b", "c"]);
    expect(mergeAiRequests({ ai_requests_json: JSON.stringify(Array.from({ length: 64 }, (_, i) => `x${i}`)) }, ["late"])).toHaveLength(64);
    const row = await getCompanionTurn(s.db, scope, s.turn.id);
    expect(mapCompanionTurn(row).aiRequests).toBeUndefined();
  });

  test("on AppKeep the card gets each call's record with only the fields it shows, and the models' names", async () => {
    const s = await setup({
      hostAiUsage: async (id) => (id === "air_gone" ? null : id === "air_broken" ? Promise.reject(new Error("boom")) : record(id)),
      hostAiModels: async () => [{ id: "claude-sonnet-5-5", name: "Claude Sonnet 5.5 (AppKeep)", tools: true, available: true }],
    });
    await s.post(`turns/${s.turn.id}/complete`, { response: "Done.", process: "", status: "completed", inputTokens: 10, outputTokens: 4, aiRequests: ["air_1", "air_gone", "air_broken", "air_2"] });
    const response = await s.call(`turns/${s.turn.id}/usage`);
    expect(response.status).toBe(200);
    const usage = await response.json();
    expect(usage.source).toBe("appkeep");
    expect(s.lookups).toEqual(["air_1", "air_gone", "air_broken", "air_2"]);
    expect(usage.records.map((item) => item.id)).toEqual(["air_1", "air_2"]);
    expect(usage.records[0]).toMatchObject({ model: "claude-sonnet-5-5", paid_with: "credits", price_micros: 4200, usage: { input_tokens: 120, cache_read_tokens: 3000, thinking_tokens: 20 } });
    expect(JSON.stringify(usage)).not.toContain("secret");
    expect(usage.models).toEqual({ "claude-sonnet-5-5": "Claude Sonnet 5.5 (AppKeep)" });
  });

  test("off AppKeep, or when no record is found, it shows the AI SDK's token counts with no price", async () => {
    const s = await setup();
    await s.post(`turns/${s.turn.id}/complete`, { response: "Done.", process: "", status: "completed", inputTokens: 321, outputTokens: 45 });
    const usage = await (await s.call(`turns/${s.turn.id}/usage`)).json();
    expect(usage).toEqual({ source: "sdk", records: [{ model: "claude-sonnet-5-5", usage: { input_tokens: 321, output_tokens: 45 } }], models: {} });

    const empty = await setup({ hostAiUsage: async () => null });
    await empty.post(`turns/${empty.turn.id}/complete`, { response: "Done.", process: "", status: "completed", inputTokens: 1, outputTokens: 2, aiRequests: ["air_x"] });
    expect((await (await empty.call(`turns/${empty.turn.id}/usage`)).json()).source).toBe("sdk");
  });

  test("another member can't read a turn's usage, and a malformed id is not found", async () => {
    const s = await setup({ hostAiUsage: async (id) => record(id) });
    await checkpointCompanionTurn(s.db, scope, await getCompanionTurn(s.db, scope, s.turn.id), "Done.", [], "completed", undefined, { aiRequests: ["air_1"] });
    const other = await s.call(`turns/${s.turn.id}/usage`, { headers: { "x-other": "1" } });
    expect(other.status).toBe(404);
    expect(s.lookups).toEqual([]);
    expect((await s.call("turns/not%20an%20id/usage")).status).toBe(404);
  });

  test("toUsageRecord ignores what isn't a record and bad numbers", () => {
    expect(toUsageRecord(null)).toBeNull();
    expect(toUsageRecord("air_1")).toBeNull();
    const cleaned = toUsageRecord({ id: "air_1", paid_with: "cash", price_micros: -5, usage: { input_tokens: "12", output_tokens: Number.NaN } });
    expect(cleaned).toMatchObject({ id: "air_1", paid_with: null, price_micros: null, usage: { input_tokens: undefined, output_tokens: undefined } });
  });
});
