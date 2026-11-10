import { describe, expect, test } from "bun:test";
import { Database } from "bun:sqlite";
import { globSync, readFileSync } from "node:fs";
import { createAnthropic } from "@ai-sdk/anthropic";
import { generateText, jsonSchema, streamText, tool } from "ai";
import { Hono } from "hono";
import { consumeProviderEventStream } from "@ponder/shared/provider-event-stream";
import { extractAiDirectStreamDelta } from "@ponder/shared/ai-generation";
import { decryptAiCredential, getAiSettings, loadDefaultAiModelCredentials } from "./ai-service.ts";
import { HOST_AI_PATH, hostAiProviderId } from "./host-ai.ts";
import { registerHostAiRoutes } from "./host-ai-routes.ts";

// AppKeep AI: a workspace on AppKeep with no AI service gets one backed by the host's text model,
// offered to the browser as an Anthropic-compatible service.

class Statement {
  constructor(db, sql, bindings = []) { Object.assign(this, { db, sql, bindings }); }
  bind(...bindings) { return new Statement(this.db, this.sql, bindings); }
  async all() { return { results: this.db.query(this.sql).all(...this.bindings), success: true, meta: {} }; }
  async first() { return this.db.query(this.sql).get(...this.bindings) ?? null; }
  async run() { this.db.query(this.sql).run(...this.bindings); return { success: true, meta: {} }; }
}
class Db {
  constructor(db) { this.db = db; }
  prepare(sql) { return new Statement(this.db, sql); }
  async batch(statements) { return this.db.transaction(() => statements.map((s) => this.db.query(s.sql).run(...s.bindings)))(); }
}

const WS = "ws_member";
const APP_URL = "https://ponder-abc123.appkeep.test";

const setup = ({ reply, appUrl = APP_URL } = {}) => {
  const sqlite = new Database(":memory:");
  for (const file of globSync("migrations/*.sql").sort()) sqlite.exec(readFileSync(file, "utf8"));
  sqlite.query("INSERT INTO workspaces (id, name, is_personal) VALUES (?, ?, 1)").run(WS, "Member workspace");
  const calls = [];
  const env = {
    storage: { db: new Db(sqlite), resources: {} },
    PONDER_AUTH_PASSWORD: "x".repeat(32),
    ALTSTACK_APP_URL: appUrl,
    hostAiText: async (request) => {
      calls.push(request);
      return reply ? reply(request) : {
        ok: true, id: "msg_1", model: request.model, stop_reason: "end_turn",
        content: [{ type: "thinking", thinking: "Short.", signature: "sig" }, { type: "text", text: "Hello from AppKeep." }],
        usage: { input_tokens: 12, output_tokens: 5 },
      };
    },
  };
  const app = new Hono();
  registerHostAiRoutes(app);
  const fetchApp = (input, init) => app.request(new Request(input, init), undefined, env);
  return { sqlite, env, calls, fetchApp };
};

const keyFor = async (s) => {
  const row = s.sqlite.query("SELECT api_key_encrypted FROM ai_provider_configs WHERE id = ?").get(hostAiProviderId(WS));
  return decryptAiCredential(row.api_key_encrypted, s.env);
};

const post = (s, key, body, headers = {}) => s.fetchApp(`${APP_URL}${HOST_AI_PATH}/messages`, {
  method: "POST",
  headers: { "content-type": "application/json", "x-api-key": key, "anthropic-version": "2023-06-01", ...headers },
  body: JSON.stringify(body),
});

describe("AppKeep AI provider", () => {
  test("a workspace with no AI service gets AppKeep AI with a default model, once", async () => {
    const s = setup();
    const settings = await getAiSettings(s.env.storage.db, WS, true, false, s.env);
    expect(settings.providers).toHaveLength(1);
    expect(settings.providers[0]).toMatchObject({ provider: "anthropic", displayName: "AppKeep AI", baseUrl: `${APP_URL}${HOST_AI_PATH}`, isEnabled: true });
    expect(settings.providers[0].models.map((model) => model.modelId)).toEqual(["claude-opus-5-5", "claude-sonnet-5-5"].sort());
    expect(settings.defaultModelId).toBeTruthy();

    const credentials = await loadDefaultAiModelCredentials(s.env.storage.db, WS, s.env);
    expect(credentials).toMatchObject({ provider: "anthropic", baseUrl: `${APP_URL}${HOST_AI_PATH}`, modelId: "claude-sonnet-5-5" });
    expect(credentials.apiKey).toMatch(/^pkhost\.ws_member\.[0-9a-f]{48}$/);

    await getAiSettings(s.env.storage.db, WS, true, false, s.env);
    expect(s.sqlite.query("SELECT COUNT(*) AS n FROM ai_provider_configs").get().n).toBe(1);
  });

  test("it follows the copy's address, and isn't added back over the workspace's own service", async () => {
    const s = setup();
    await getAiSettings(s.env.storage.db, WS, true, false, s.env);
    const moved = { ...s.env, ALTSTACK_APP_URL: "https://renamed.appkeep.test/" };
    const settings = await getAiSettings(s.env.storage.db, WS, true, false, moved);
    expect(settings.providers[0].baseUrl).toBe(`https://renamed.appkeep.test${HOST_AI_PATH}`);

    const other = setup();
    other.sqlite.query(`INSERT INTO ai_provider_configs (id, workspace_id, provider, display_name, base_url, api_key_encrypted) VALUES ('aip_own', ?, 'openai-compatible', 'Mine', 'https://api.openai.com/v1', 'v1.x.y')`).run(WS);
    const own = await getAiSettings(other.env.storage.db, WS, true, false, other.env);
    expect(own.providers.map((provider) => provider.id)).toEqual(["aip_own"]);
  });

  test("without the host's AI nothing is added", async () => {
    const s = setup();
    const settings = await getAiSettings(s.env.storage.db, WS, true, false, { ...s.env, hostAiText: undefined });
    expect(settings.providers).toEqual([]);
  });

  test("the service checks its key and answers preflight requests from any origin", async () => {
    const s = setup();
    await getAiSettings(s.env.storage.db, WS, true, false, s.env);
    const preflight = await s.fetchApp(`${APP_URL}${HOST_AI_PATH}/messages`, { method: "OPTIONS", headers: { origin: "https://ponder.appkeep.test" } });
    expect(preflight.status).toBe(204);
    expect(preflight.headers.get("access-control-allow-origin")).toBe("*");
    expect(preflight.headers.get("access-control-allow-headers")).toContain("x-api-key");

    const body = { model: "claude-sonnet-5-5", max_tokens: 50, messages: [{ role: "user", content: "hi" }] };
    for (const key of ["", "ponder-cors-probe", "pkhost.ws_member." + "0".repeat(48), "pkhost.ws_other." + "0".repeat(48)]) {
      const response = await post(s, key, body);
      expect(response.status).toBe(401);
      expect(response.headers.get("access-control-allow-origin")).toBe("*");
      expect((await response.json()).error.type).toBe("authentication_error");
    }
    expect(s.calls).toHaveLength(0);

    const models = await s.fetchApp(`${APP_URL}${HOST_AI_PATH}/models`, { headers: { "x-api-key": await keyFor(s) } });
    expect((await models.json()).data.map((model) => model.id)).toContain("claude-opus-5-5");
  });

  test("a disabled AppKeep AI stops answering", async () => {
    const s = setup();
    await getAiSettings(s.env.storage.db, WS, true, false, s.env);
    const key = await keyFor(s);
    s.sqlite.query("UPDATE ai_provider_configs SET is_enabled = 0").run();
    expect((await post(s, key, { messages: [{ role: "user", content: "hi" }] })).status).toBe(401);
  });

  test("a request becomes one host call, and its reply comes back as a message or as stream events", async () => {
    const s = setup();
    await getAiSettings(s.env.storage.db, WS, true, false, s.env);
    const key = await keyFor(s);
    const response = await post(s, key, {
      model: "claude-opus-5-5", max_tokens: 99_999, temperature: 0.2, tool_choice: { type: "auto" },
      system: [{ type: "text", text: "Be brief." }, { type: "text", text: "Use Markdown." }],
      messages: [{ role: "user", content: [{ type: "text", text: "Say hello", cache_control: { type: "ephemeral" } }] }],
      tools: [{ name: "lookup", description: "Find a page", input_schema: { type: "object", properties: {} } }, { type: "web_search_20250305", name: "web_search" }],
    });
    expect(response.status).toBe(200);
    const message = await response.json();
    expect(message).toMatchObject({ type: "message", role: "assistant", stop_reason: "end_turn", usage: { input_tokens: 12, output_tokens: 5 } });
    expect(message.content.at(-1)).toEqual({ type: "text", text: "Hello from AppKeep." });
    expect(s.calls[0]).toEqual({
      model: "claude-opus-5-5", max_tokens: 16_000, effort: "low", system: "Be brief.\n\nUse Markdown.",
      messages: [{ role: "user", content: [{ type: "text", text: "Say hello", cache_control: { type: "ephemeral" } }] }],
      tools: [{ name: "lookup", description: "Find a page", input_schema: { type: "object", properties: {} } }],
    });

    // Ponder's own note generation streams and reads text deltas and usage from the events.
    const stream = await post(s, key, { model: "unknown-model", max_tokens: 200, stream: true, messages: [{ role: "user", content: "hi" }] });
    expect(stream.headers.get("content-type")).toContain("text/event-stream");
    expect(s.calls[1].model).toBe("claude-sonnet-5-5");
    let text = "";
    let outputTokens;
    await consumeProviderEventStream(stream.body, (payload) => {
      const delta = extractAiDirectStreamDelta("anthropic", payload);
      text += delta.text;
      outputTokens = delta.outputTokens ?? outputTokens;
    });
    expect(text).toBe("Hello from AppKeep.");
    expect(outputTokens).toBe(5);
  });

  test("images, a low balance and host failures come back as clear errors", async () => {
    let next;
    const s = setup({ reply: () => next() });
    await getAiSettings(s.env.storage.db, WS, true, false, s.env);
    const key = await keyFor(s);
    const image = await post(s, key, { messages: [{ role: "user", content: [{ type: "image", source: { type: "base64", media_type: "image/png", data: "AA==" } }] }] });
    expect(image.status).toBe(400);
    expect((await image.json()).error.message).toContain("can't read images");

    next = async () => ({ ok: false, reason: "insufficient_funds", required_micros: 123_456, available_micros: 0 });
    const broke = await post(s, key, { messages: [{ role: "user", content: "hi" }] });
    expect(broke.status).toBe(402);
    const brokeBody = await broke.json();
    expect(brokeBody.error.type).toBe("billing_error");
    expect(brokeBody.error.message).toContain("$0.13");

    next = async () => { throw new Error("The text model is busy. Try again in a moment."); };
    const busy = await post(s, key, { messages: [{ role: "user", content: "hi" }] });
    expect(busy.status).toBe(502);
    expect((await busy.json()).error.message).toBe("The text model is busy. Try again in a moment.");
  });

  test("the AI SDK's Anthropic client streams text and runs a tool through it", async () => {
    const s = setup({
      reply: (request) => {
        const last = request.messages.at(-1).content;
        const result = Array.isArray(last) ? last.find((block) => block.type === "tool_result") : null;
        if (request.tools?.length && !result) {
          return {
            ok: true, id: "msg_tool", model: request.model, stop_reason: "tool_use",
            content: [{ type: "tool_use", id: "toolu_1", name: "lookup", input: { title: "Roadmap" } }],
            usage: { input_tokens: 30, output_tokens: 8 },
          };
        }
        const value = !result ? "nothing" : Array.isArray(result.content) ? result.content.map((part) => part.text).join("") : String(result.content);
        return {
          ok: true, id: "msg_done", model: request.model, stop_reason: "end_turn",
          content: [{ type: "text", text: `Found: ${value}` }], usage: { input_tokens: 40, output_tokens: 4 },
        };
      },
    });
    const credentials = await loadDefaultAiModelCredentials(s.env.storage.db, WS, s.env);
    const model = createAnthropic({ baseURL: credentials.baseUrl, apiKey: credentials.apiKey, fetch: s.fetchApp })(credentials.modelId);

    const streamed = streamText({
      model,
      prompt: "Find the roadmap page",
      tools: { lookup: tool({ description: "Find a page", inputSchema: jsonSchema({ type: "object", properties: { title: { type: "string" } } }), execute: async ({ title }) => `page ${title}` }) },
      stopWhen: ({ steps }) => steps.length >= 2,
    });
    expect(await streamed.text).toBe("Found: page Roadmap");
    expect((await streamed.steps).length).toBe(2);
    expect(s.calls[0].tools[0].name).toBe("lookup");

    const generated = await generateText({ model, prompt: "Say hi" });
    expect(generated.text).toBe("Found: nothing");
  });
});
