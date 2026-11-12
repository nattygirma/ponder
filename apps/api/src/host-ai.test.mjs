import { describe, expect, test } from "bun:test";
import { Database } from "bun:sqlite";
import { globSync, readFileSync } from "node:fs";
import { createAnthropic } from "@ai-sdk/anthropic";
import { generateText, jsonSchema, streamText, tool } from "ai";
import { Hono } from "hono";
import { consumeProviderEventStream } from "@ponder/shared/provider-event-stream";
import { extractAiDirectStreamDelta } from "@ponder/shared/ai-generation";
import { decryptAiCredential, getAiSettings, loadDefaultAiModelCredentials } from "./ai-service.ts";
import { HOST_AI_MODELS, HOST_AI_PATH, HOST_AI_STREAM_MAX_TOKENS, hostAiModelList, hostAiProviderId, hostTextModelsAsList, resetHostAiModelCache, toHostAiRequest } from "./host-ai.ts";
import { prepareCompanionTurn } from "./companion-prepare.ts";
import { beginCompanionTurn } from "./companion-service.ts";
import { COMPANION_MAX_OUTPUT_TOKENS, companionMaxOutputTokens } from "./companion-prepare.ts";
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
    expect(settings.providers[0].models.map((model) => model.modelId).sort()).toEqual(["claude-fable-5-2", "claude-haiku-5-5", "claude-opus-5-5", "claude-sonnet-5-5"]);
    expect(settings.defaultModelId).toBeTruthy();

    const credentials = await loadDefaultAiModelCredentials(s.env.storage.db, WS, s.env);
    expect(credentials).toMatchObject({ provider: "anthropic", baseUrl: `${APP_URL}${HOST_AI_PATH}`, modelId: "claude-sonnet-5-5" });
    expect(credentials.apiKey).toMatch(/^pkhost\.ws_member\.[0-9a-f]{48}$/);

    await getAiSettings(s.env.storage.db, WS, true, false, s.env);
    expect(s.sqlite.query("SELECT COUNT(*) AS n FROM ai_provider_configs").get().n).toBe(1);
  });

  test("a workspace that got AppKeep AI earlier gets the models added since, and keeps its default", async () => {
    const s = setup();
    const first = await getAiSettings(s.env.storage.db, WS, true, false, s.env);
    s.sqlite.query("DELETE FROM ai_models WHERE model_id IN ('claude-haiku-5-5', 'claude-fable-5-2')").run();
    const later = await getAiSettings(s.env.storage.db, WS, true, false, s.env);
    expect(later.providers[0].models.map((model) => model.modelId).sort()).toEqual(["claude-fable-5-2", "claude-haiku-5-5", "claude-opus-5-5", "claude-sonnet-5-5"]);
    expect(later.defaultModelId).toBe(first.defaultModelId);
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

describe("AppKeep AI streaming (ai.stream)", () => {
  const sse = (events) => new ReadableStream({
    start(controller) {
      for (const event of events) controller.enqueue(new TextEncoder().encode(`event: ${event.type}\ndata: ${JSON.stringify(event)}\n\n`));
      controller.close();
    },
  });
  const claudeEvents = (text, stopReason = "end_turn") => [
    { type: "message_start", message: { id: "msg_s", type: "message", role: "assistant", model: "claude-sonnet-5-5", content: [], stop_reason: null, usage: { input_tokens: 20, output_tokens: 0 } } },
    { type: "content_block_start", index: 0, content_block: { type: "text", text: "" } },
    ...text.split(" ").map((word, i) => ({ type: "content_block_delta", index: 0, delta: { type: "text_delta", text: (i ? " " : "") + word } })),
    { type: "content_block_stop", index: 0 },
    { type: "message_delta", delta: { stop_reason: stopReason, stop_sequence: null }, usage: { output_tokens: 9 } },
    { type: "message_stop" },
  ];
  const streaming = (result) => {
    const s = setup();
    s.streamCalls = [];
    s.env.hostAiStream = async (request) => { s.streamCalls.push(request); return result(request); };
    return s;
  };

  test("a streamed request goes to the host's stream as Claude's request and comes back as it arrives", async () => {
    const s = streaming(() => ({ ok: true, id: "air_1", model: "claude-sonnet-5-5", max_tokens: 32_000, stream: sse(claudeEvents("Hello from the stream.")) }));
    await getAiSettings(s.env.storage.db, WS, true, false, s.env);
    const key = await keyFor(s);
    const system = [{ type: "text", text: "Be brief.", cache_control: { type: "ephemeral" } }];
    const res = await post(s, key, {
      model: "claude-opus-5-5", stream: true, max_tokens: 100_000, system, temperature: 0.2,
      thinking: { type: "adaptive", display: "summarized" }, tool_choice: { type: "auto" },
      tools: [{ name: "lookup", input_schema: { type: "object" } }, { type: "web_search_20260209", name: "web_search" }],
      messages: [{ role: "user", content: "hi" }],
    });
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toContain("text/event-stream");
    expect(res.headers.get("x-appkeep-ai-request")).toBe("air_1");
    expect(res.headers.get("access-control-allow-origin")).toBe("*");
    expect(await res.text()).toContain('"text":" stream."');
    expect(s.calls).toHaveLength(0);
    const [sent] = s.streamCalls;
    expect(sent.model).toBe("claude-opus-5-5");
    expect(sent.max_tokens).toBe(HOST_AI_STREAM_MAX_TOKENS);
    expect(sent.system).toEqual(system);
    expect(sent.thinking).toEqual({ type: "adaptive", display: "summarized" });
    expect(sent.tool_choice).toEqual({ type: "auto" });
    expect(sent.output_config).toEqual({ effort: "low" });
    expect(sent.tools.map((t) => t.name)).toEqual(["lookup"]);
    expect("temperature" in sent).toBe(false);
  });

  test("a request that isn't streamed still answers in one piece", async () => {
    const s = streaming(() => { throw new Error("must not stream"); });
    await getAiSettings(s.env.storage.db, WS, true, false, s.env);
    const res = await post(s, await keyFor(s), { messages: [{ role: "user", content: "hi" }] });
    expect(res.status).toBe(200);
    expect((await res.json()).content.at(-1).text).toBe("Hello from AppKeep.");
    expect(s.calls).toHaveLength(1);
  });

  test("a low balance and the host's own errors keep their status", async () => {
    let next;
    const s = streaming(() => next());
    await getAiSettings(s.env.storage.db, WS, true, false, s.env);
    const key = await keyFor(s);
    const ask = { stream: true, messages: [{ role: "user", content: "hi" }] };
    next = () => ({ ok: false, reason: "insufficient_funds", required_micros: 50_000, available_micros: 0 });
    const broke = await post(s, key, ask);
    expect(broke.status).toBe(402);
    expect((await broke.json()).error.type).toBe("billing_error");
    next = () => ({ ok: false, reason: "error", status: 429, type: "rate_limit_error", message: "Claude is busy." });
    const busy = await post(s, key, ask);
    expect(busy.status).toBe(429);
    expect(await busy.json()).toEqual({ type: "error", error: { type: "rate_limit_error", message: "Claude is busy." } });
    next = () => { throw new Error("connection lost"); };
    const lost = await post(s, key, ask);
    expect(lost.status).toBe(502);
  });

  test("the AI SDK's Anthropic client streams through it and sees a cut-off reply", async () => {
    const s = streaming(() => ({ ok: true, id: "air_2", model: "claude-sonnet-5-5", max_tokens: 50, stream: sse(claudeEvents("Partial answer", "max_tokens")) }));
    await getAiSettings(s.env.storage.db, WS, true, false, s.env);
    const anthropic = createAnthropic({ baseURL: `${APP_URL}${HOST_AI_PATH}`, apiKey: await keyFor(s), fetch: s.fetchApp });
    const result = streamText({ model: anthropic("claude-sonnet-5-5"), prompt: "Say hi", maxOutputTokens: 50 });
    let text = "";
    for await (const delta of result.textStream) text += delta;
    expect(text).toBe("Partial answer");
    expect(await result.finishReason).toBe("length");
  });

  test("AppKeep AI gets a long reply cap, Claude and Gemini a medium one, other services the small default", () => {
    expect(companionMaxOutputTokens({ provider: "anthropic", apiKey: `pkhost.${WS}.${"a".repeat(48)}` })).toBe(HOST_AI_STREAM_MAX_TOKENS);
    expect(companionMaxOutputTokens({ provider: "anthropic", apiKey: "sk-ant-x" })).toBe(8192);
    expect(companionMaxOutputTokens({ provider: "google", apiKey: "g" })).toBe(8192);
    expect(companionMaxOutputTokens({ provider: "openai-compatible", apiKey: "o" })).toBe(COMPANION_MAX_OUTPUT_TOKENS);
  });
});

describe("AppKeep's model list, the owner's model and usage ids", () => {
  const textModel = (id, name, extra = {}) => ({
    id, name, provider: "anthropic", provider_name: "Anthropic", thinking: true, tools: true, images: true,
    context_tokens: 200_000, max_output: 64_000, price: null, credits: true, own_key: false, available: true, retires_at: null, successor: null, ...extra,
  });
  const withModels = (list, settings) => {
    resetHostAiModelCache();
    const s = setup();
    let current = list;
    s.setModels = (next) => { current = next; resetHostAiModelCache(); };
    s.env.hostAiModels = async () => (typeof current === "function" ? current() : current);
    if (settings) s.env.hostAiSettings = async () => settings;
    return s;
  };

  test("the host's list replaces the built-in models, without ones the account can't use or that have no tools", async () => {
    const s = withModels([
      textModel("gpt-5-5", "GPT-5.5", { provider: "openai" }),
      textModel("claude-sonnet-5-5", "Claude Sonnet 5.5"),
      textModel("gemini-old", "Gemini Old", { available: false }),
      textModel("tiny", "Tiny", { tools: false }),
      textModel("gpt-5-5", "GPT-5.5 again"),
    ]);
    const settings = await getAiSettings(s.env.storage.db, WS, true, false, s.env);
    const listed = (result) => result.providers[0].models.map((model) => [model.modelId, model.displayName]).sort((a, b) => a[0].localeCompare(b[0]));
    expect(listed(settings)).toEqual([["claude-sonnet-5-5", "Claude Sonnet 5.5"], ["gpt-5-5", "GPT-5.5"]]);
    // The host's first model is the default.
    expect(settings.providers[0].models.find((model) => model.id === settings.defaultModelId)?.modelId).toBe("gpt-5-5");
    expect(settings.hostModel).toBeUndefined();
    const key = await keyFor(s);
    const models = await (await s.fetchApp(`${APP_URL}${HOST_AI_PATH}/models`, { headers: { "x-api-key": key } })).json();
    expect(models.data.map((model) => model.id)).toEqual(["gpt-5-5", "claude-sonnet-5-5"]);

    // Requests keep Claude's format; a model the host offers is passed on, any other falls back to the host's first.
    await post(s, key, { model: "claude-sonnet-5-5", max_tokens: 50, messages: [{ role: "user", content: "hi" }] });
    await post(s, key, { model: "claude-opus-5-5", max_tokens: 50, messages: [{ role: "user", content: "hi" }] });
    expect(s.calls.map((call) => call.model)).toEqual(["claude-sonnet-5-5", "gpt-5-5"]);

    // Later: one model renamed, one added, one gone. The gone one stays so a saved default keeps working.
    s.setModels([textModel("gpt-5-5", "GPT-5.5 Pro"), textModel("gemini-3", "Gemini 3")]);
    const later = await getAiSettings(s.env.storage.db, WS, true, false, s.env);
    expect(listed(later)).toEqual([["claude-sonnet-5-5", "Claude Sonnet 5.5"], ["gemini-3", "Gemini 3"], ["gpt-5-5", "GPT-5.5 Pro"]]);
  });

  test("a host that fails, lists nothing usable or has no list falls back to the built-in models", async () => {
    expect(await hostAiModelList({})).toBe(HOST_AI_MODELS);
    resetHostAiModelCache();
    expect(await hostAiModelList({ hostAiModels: async () => { throw new Error("rpc gone"); } })).toBe(HOST_AI_MODELS);
    expect(await hostAiModelList({ hostAiModels: async () => [textModel("x", "X", { available: false })] })).toBe(HOST_AI_MODELS);
    expect(hostTextModelsAsList("nope")).toEqual([]);
    expect(hostTextModelsAsList([{ id: "  m1 ", name: "" }, { name: "no id" }])).toEqual([{ modelId: "m1", displayName: "m1" }]);
    expect(toHostAiRequest({ model: "gone", messages: [{ role: "user", content: "hi" }] }).model).toBe("claude-sonnet-5-5");
    expect(toHostAiRequest({ model: "m1", messages: [{ role: "user", content: "hi" }] }, [{ modelId: "m1", displayName: "M1" }]).model).toBe("m1");

    let calls = 0;
    const source = async () => { calls += 1; return [textModel("m1", "M1")]; };
    resetHostAiModelCache();
    await hostAiModelList({ hostAiModels: source }, 1_000);
    await hostAiModelList({ hostAiModels: source }, 30_000);
    expect(calls).toBe(1);
    await hostAiModelList({ hostAiModels: source }, 62_000);
    expect(calls).toBe(2);
  });

  test("the owner's model shows in the settings with its name, and only on AppKeep", async () => {
    const s = withModels([textModel("claude-opus-5-5", "Claude Opus 5.5"), textModel("gpt-5-5", "GPT-5.5")], { model: "gpt-5-5", effort: null, max_tokens: null, show_thinking: true, pay_with: null });
    const settings = await getAiSettings(s.env.storage.db, WS, true, false, s.env);
    expect(settings.hostModel).toEqual({ modelId: "gpt-5-5", displayName: "GPT-5.5", providerConfigId: hostAiProviderId(WS) });

    s.env.hostAiSettings = async () => ({ model: null });
    expect((await getAiSettings(s.env.storage.db, WS, true, false, s.env)).hostModel).toBeUndefined();
    s.env.hostAiSettings = async () => { throw new Error("old platform"); };
    expect((await getAiSettings(s.env.storage.db, WS, true, false, s.env)).hostModel).toBeUndefined();
    const offHost = { ...s.env, ALTSTACK_APP_URL: undefined, hostAiSettings: async () => ({ model: "gpt-5-5" }) };
    expect((await getAiSettings(s.env.storage.db, WS, true, false, offHost)).hostModel).toBeUndefined();
  });

  test("the browser can read each call's usage id, streamed or not", async () => {
    const s = setup({ reply: (request) => ({ ok: true, id: "msg_text", usage_id: "air_text", model: request.model, stop_reason: "end_turn", content: [{ type: "text", text: "Hi" }], usage: { input_tokens: 1, output_tokens: 1 } }) });
    await getAiSettings(s.env.storage.db, WS, true, false, s.env);
    const key = await keyFor(s);
    const preflight = await s.fetchApp(`${APP_URL}${HOST_AI_PATH}/messages`, { method: "OPTIONS", headers: { origin: "https://ponder.appkeep.test" } });
    expect(preflight.headers.get("access-control-expose-headers")).toContain("x-appkeep-ai-request");
    const whole = await post(s, key, { max_tokens: 50, messages: [{ role: "user", content: "hi" }] });
    expect(whole.headers.get("x-appkeep-ai-request")).toBe("air_text");
    expect(whole.headers.get("access-control-expose-headers")).toContain("x-appkeep-ai-request");
    const streamed = await post(s, key, { max_tokens: 50, stream: true, messages: [{ role: "user", content: "hi" }] });
    expect(streamed.headers.get("x-appkeep-ai-request")).toBe("air_text");
  });

  test("chat on AppKeep AI asks for thinking summaries and records usage ids; other services don't", async () => {
    const s = setup();
    await getAiSettings(s.env.storage.db, WS, true, false, s.env);
    const db = s.env.storage.db;
    const scope = { workspaceId: WS, ownerId: "owner" };
    const input = { id: crypto.randomUUID(), threadId: crypto.randomUUID(), message: "hi", allowNotes: false, useMemory: false, locale: "en-US" };
    const row = await beginCompanionTurn(db, scope, input, "claude-sonnet-5-5");
    const prepare = (credentials) => prepareCompanionTurn({ db, scope, input, row, credentials });
    const onHost = await prepare({ provider: "anthropic", baseUrl: `${APP_URL}${HOST_AI_PATH}`, apiKey: await keyFor(s), modelId: "claude-sonnet-5-5" });
    expect(onHost).toMatchObject({ thinking: "summarized", recordsAiRequests: true });
    const ownKey = await prepare({ provider: "anthropic", baseUrl: "https://api.anthropic.com/v1", apiKey: "sk-ant-x", modelId: "claude-sonnet-5-5" });
    expect(ownKey.thinking).toBeUndefined();
    expect(ownKey.recordsAiRequests).toBeUndefined();
  });
});
