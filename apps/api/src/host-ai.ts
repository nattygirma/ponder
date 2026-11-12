// AI provided by the host (AppKeep's ai.text, paid from the owner's AppKeep balance), offered to the
// browser as an Anthropic-compatible service so Ponder's AI works with no key of the user's own.
// This module is pure: constants, keys and the translation between Anthropic's Messages API and the
// host's one-turn text call. host-ai-routes.ts serves it; ai-service.ts seeds the provider row.

/** Where the service lives on the copy's own address. Outside /api/v1, which needs a signed-in session. */
export const HOST_AI_PATH = "/api/host-ai/v1";
export const HOST_AI_DISPLAY_NAME = "AppKeep AI";
/** The models offered when the host can't list its own (platforms before ai.textModels). */
export const HOST_AI_MODELS: readonly HostAiModel[] = [
  { modelId: "claude-sonnet-5-5", displayName: "Claude Sonnet 5.5" },
  { modelId: "claude-opus-5-5", displayName: "Claude Opus 5.5" },
  { modelId: "claude-haiku-5-5", displayName: "Claude Haiku 5.5" },
  { modelId: "claude-fable-5-2", displayName: "Claude Fable 5.2" },
];
export type HostAiModel = { modelId: string; displayName: string };
const DEFAULT_MODEL = HOST_AI_MODELS[0].modelId;
const MAX_TOKENS = 16_000;
// Streamed replies have no time limit, so they can be long; the platform lowers the cap to what the balance can pay for.
export const HOST_AI_STREAM_MAX_TOKENS = 32_000;
const DEFAULT_MAX_TOKENS = 4_096;
const EFFORTS = new Set(["low", "medium", "high"]);
const STREAM_EFFORTS = new Set(["low", "medium", "high", "xhigh", "max"]);
const HOST_BLOCKS = new Set(["text", "tool_use", "tool_result", "thinking", "redacted_thinking"]);

export type HostAiTextRequest = {
  model?: string;
  system?: string;
  messages: { role: "user" | "assistant"; content: string | Record<string, unknown>[] }[];
  tools?: { name: string; description?: string; input_schema: Record<string, unknown> }[];
  max_tokens?: number;
  effort?: "low" | "medium" | "high";
};
export type HostAiTextResult =
  | {
    ok: true; id: string; usage_id?: string; model: string; stop_reason: string | null; content: Record<string, unknown>[];
    usage: { input_tokens: number; output_tokens: number }; charged_micros?: number;
  }
  | { ok: false; reason: "insufficient_funds"; required_micros: number; available_micros: number };
export type HostAiText = (request: HostAiTextRequest, options?: { user?: string; ref?: string }) => Promise<HostAiTextResult>;

/** The host's streaming call (AppKeep's ai.stream): Claude's own Messages request in, Claude's own server-sent events out. */
export type HostAiStreamRequest = Record<string, unknown> & { model: string; messages: HostAiTextRequest["messages"]; max_tokens: number };
export type HostAiStreamResult =
  | { ok: true; id: string; model: string; max_tokens: number; stream: ReadableStream<Uint8Array> }
  | { ok: false; reason: "insufficient_funds"; required_micros: number; available_micros: number }
  | { ok: false; reason: "error"; status: number; type: string; message: string };
export type HostAiStream = (request: HostAiStreamRequest, options?: { user?: string; ref?: string }) => Promise<HostAiStreamResult>;

/** A usage record (AppKeep's ai.usage), one per model call. price_micros is micro-dollars. */
export type HostAiUsageRecord = {
  id: string; model: string; provider: string; paid_with: "credits" | "key"; result: string; stop_reason: string | null;
  usage: { input_tokens: number; cache_read_tokens: number; cache_write_tokens: number; output_tokens: number; thinking_tokens: number };
  price_micros: number; estimated: boolean; started_at: string; first_token_ms: number | null; duration_ms: number | null;
};
export type HostAiUsage = (id: string) => Promise<HostAiUsageRecord | null>;
/** One of the host's text models (AppKeep's ai.textModels). Ponder keeps sending Claude-format requests; the host translates. */
export type HostAiTextModel = {
  id: string; name: string; provider: string; provider_name: string; thinking: boolean; tools: boolean; images: boolean;
  context_tokens: number; max_output: number; price: { input: number; output: number; cache_read: number } | null;
  credits: boolean; own_key: boolean; available: boolean; retires_at: string | null; successor: string | null;
};
export type HostAiTextModels = () => Promise<HostAiTextModel[]>;
/** The app owner's AI settings in AppKeep (ai.settings). model is the owner's override, or null. */
export type HostAiSettings = () => Promise<{ model: string | null; effort: string | null; max_tokens: number | null; show_thinking: boolean; pay_with: string | null }>;

export type HostAiEnvironment = {
  hostAiText?: HostAiText; hostAiStream?: HostAiStream; hostAiUsage?: HostAiUsage;
  hostAiModels?: HostAiTextModels; hostAiSettings?: HostAiSettings; ALTSTACK_APP_URL?: string;
};

// The model list changes rarely, and one copy serves one account, so it's kept for a minute per isolate.
const MODEL_LIST_TTL_MS = 60_000;
let modelListCache: { at: number; source: HostAiTextModels; models: HostAiModel[] } | null = null;

/** The host's own model list as a typed list, dropping models this account can't use and ones without tools. */
export const hostTextModelsAsList = (models: unknown): HostAiModel[] => {
  if (!Array.isArray(models)) return [];
  const seen = new Set<string>();
  const out: HostAiModel[] = [];
  for (const raw of models) {
    const model = asRecord(raw);
    const id = typeof model?.id === "string" ? model.id.trim() : "";
    if (!model || !id || id.length > 128 || seen.has(id)) continue;
    // Ponder's chat runs tools, so a model without them can't do its work.
    if (model.available === false || model.tools === false) continue;
    seen.add(id);
    const name = typeof model.name === "string" && model.name.trim() ? model.name.trim().slice(0, 120) : id;
    out.push({ modelId: id, displayName: name });
  }
  return out;
};

/**
 * The models AppKeep AI offers: the host's list (ai.textModels) when it has one, else HOST_AI_MODELS. A host
 * that fails to answer, or lists nothing usable, falls back too, so the picker never empties.
 */
export const hostAiModelList = async (environment: HostAiEnvironment, now = Date.now()): Promise<readonly HostAiModel[]> => {
  const source = environment.hostAiModels;
  if (!source) return HOST_AI_MODELS;
  if (modelListCache && modelListCache.source === source && now - modelListCache.at < MODEL_LIST_TTL_MS) return modelListCache.models;
  try {
    const models = hostTextModelsAsList(await source());
    if (!models.length) return HOST_AI_MODELS;
    modelListCache = { at: now, source, models };
    return models;
  } catch {
    return HOST_AI_MODELS;
  }
};
export const resetHostAiModelCache = () => { modelListCache = null; };

/** The owner's model override for AppKeep AI, with its display name, or null when the members choose. */
export const hostAiOwnerModel = async (environment: HostAiEnvironment): Promise<HostAiModel | null> => {
  if (!environment.hostAiSettings) return null;
  try {
    const settings = await environment.hostAiSettings();
    const id = typeof settings?.model === "string" ? settings.model.trim() : "";
    if (!id) return null;
    const known = (await hostAiModelList(environment)).find((model) => model.modelId === id);
    return { modelId: id, displayName: known?.displayName ?? id };
  } catch {
    return null;
  }
};

export const hostAiProviderId = (workspaceId: string) => `aip_host_${workspaceId}`;
export const hostAiModelConfigId = (workspaceId: string, modelId: string) =>
  `aim_host_${modelId.replace(/[^A-Za-z0-9]+/g, "_")}_${workspaceId}`;

/** The service's base URL on the copy's own address, or null when the host offers no AI. */
export const hostAiBaseUrl = (environment: HostAiEnvironment) => {
  const appUrl = environment.ALTSTACK_APP_URL?.trim().replace(/\/+$/, "");
  if (!environment.hostAiText || !appUrl) return null;
  try {
    return `${new URL(appUrl).origin}${HOST_AI_PATH}`;
  } catch {
    return null;
  }
};

// A key names its workspace so a request needs no session; the rest is a random secret checked
// against the saved (encrypted) key.
const KEY_PATTERN = /^pkhost\.([A-Za-z0-9_-]{1,128})\.([0-9a-f]{48})$/;
export const createHostAiKey = (workspaceId: string) => {
  const secret = Array.from(crypto.getRandomValues(new Uint8Array(24)), (byte) => byte.toString(16).padStart(2, "0")).join("");
  return `pkhost.${workspaceId}.${secret}`;
};
export const hostAiKeyWorkspace = (key: string | null | undefined) => (key ? KEY_PATTERN.exec(key)?.[1] ?? null : null);

export const sameSecret = (left: string, right: string) => {
  if (left.length !== right.length) return false;
  let difference = 0;
  for (let index = 0; index < left.length; index++) difference |= left.charCodeAt(index) ^ right.charCodeAt(index);
  return difference === 0;
};

export class HostAiRequestError extends Error {}

const asRecord = (value: unknown): Record<string, unknown> | null =>
  value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : null;

const systemText = (system: unknown) => {
  if (typeof system === "string") return system;
  if (!Array.isArray(system)) return undefined;
  return system.map((block) => (typeof asRecord(block)?.text === "string" ? asRecord(block)!.text as string : "")).filter(Boolean).join("\n\n");
};

/** An Anthropic Messages request as the host's one-turn call. Unsupported settings (temperature, tool_choice) are dropped. */
export const toHostAiRequest = (
  body: unknown,
  models: readonly HostAiModel[] = HOST_AI_MODELS,
): { request: HostAiTextRequest; streamRequest: HostAiStreamRequest; stream: boolean; model: string } => {
  const input = asRecord(body);
  if (!input || !Array.isArray(input.messages) || !input.messages.length) throw new HostAiRequestError("messages is required.");
  // A model the host no longer offers (retired, or its key removed) falls back to the host's first one.
  const model = models.some((item) => item.modelId === input.model) ? input.model as string : models[0]?.modelId ?? DEFAULT_MODEL;
  const messages: HostAiTextRequest["messages"] = [];
  for (const raw of input.messages) {
    const message = asRecord(raw);
    if (message?.role !== "user" && message?.role !== "assistant") throw new HostAiRequestError("Each message needs a role of user or assistant.");
    if (typeof message.content === "string") {
      messages.push({ role: message.role, content: message.content });
      continue;
    }
    if (!Array.isArray(message.content)) throw new HostAiRequestError("A message's content is text or a list of blocks.");
    for (const block of message.content) {
      const type = asRecord(block)?.type;
      if (type === "image" || type === "document") {
        throw new HostAiRequestError("AppKeep AI can't read images or files yet. Add your own AI service in Settings > AI to use them.");
      }
      if (!HOST_BLOCKS.has(String(type))) throw new HostAiRequestError(`AppKeep AI doesn't take ${String(type)} blocks.`);
    }
    messages.push({ role: message.role, content: message.content as Record<string, unknown>[] });
  }
  // Client tools only: a server tool (web search and the like) has a type and can't be run here.
  const tools = Array.isArray(input.tools)
    ? input.tools.map(asRecord).filter((tool): tool is Record<string, unknown> =>
      !!tool && typeof tool.name === "string" && !!asRecord(tool.input_schema) && (tool.type === undefined || tool.type === "custom"))
      .map((tool) => ({
        name: tool.name as string,
        ...(typeof tool.description === "string" ? { description: tool.description } : {}),
        input_schema: tool.input_schema as Record<string, unknown>,
      }))
    : [];
  const requested = Math.round(Number(input.max_tokens ?? DEFAULT_MAX_TOKENS)) || DEFAULT_MAX_TOKENS;
  const effort = asRecord(input.output_config)?.effort;
  const system = systemText(input.system);
  const outputConfig = asRecord(input.output_config);
  const toolChoice = asRecord(input.tool_choice);
  // The streaming call takes Claude's request nearly as sent: the system blocks keep their cache breakpoints, and
  // thinking and tool_choice pass through (the platform checks them and drops what the models refuse).
  const streamRequest: HostAiStreamRequest = {
    model,
    messages,
    max_tokens: Math.min(HOST_AI_STREAM_MAX_TOKENS, Math.max(1, requested)),
    output_config: {
      ...(outputConfig?.format ? { format: outputConfig.format } : {}),
      effort: STREAM_EFFORTS.has(String(effort)) ? effort : "low",
    },
    ...(typeof input.system === "string" || Array.isArray(input.system) ? { system: input.system } : {}),
    ...(tools.length ? { tools } : {}),
    ...(asRecord(input.thinking) ? { thinking: input.thinking } : {}),
    ...(toolChoice && (toolChoice.type === "auto" || toolChoice.type === "none") ? { tool_choice: toolChoice } : {}),
    ...(Array.isArray(input.stop_sequences) ? { stop_sequences: input.stop_sequences } : {}),
  };
  return {
    stream: input.stream === true,
    streamRequest,
    model,
    request: {
      model,
      messages,
      max_tokens: Math.min(MAX_TOKENS, Math.max(1, requested)),
      // Low effort keeps replies quick: the host answers in one piece, not as a stream.
      effort: EFFORTS.has(String(effort)) ? effort as HostAiTextRequest["effort"] : "low",
      ...(system ? { system } : {}),
      ...(tools.length ? { tools } : {}),
    },
  };
};

type HostAiSuccess = Extract<HostAiTextResult, { ok: true }>;

export const toAnthropicMessage = (result: HostAiSuccess) => ({
  id: result.id,
  type: "message",
  role: "assistant",
  model: result.model,
  content: result.content,
  stop_reason: result.stop_reason ?? "end_turn",
  stop_sequence: null,
  usage: { input_tokens: result.usage.input_tokens, output_tokens: result.usage.output_tokens },
});

const sse = (event: string, data: unknown) => `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;

/** The finished reply as Anthropic's streaming events, so streaming clients read it unchanged. */
export const toAnthropicEventStream = (result: HostAiSuccess) => {
  const message = toAnthropicMessage(result);
  let out = sse("message_start", {
    type: "message_start",
    message: { ...message, content: [], stop_reason: null, usage: { input_tokens: message.usage.input_tokens, output_tokens: 0 } },
  });
  message.content.forEach((block, index) => {
    const type = block.type;
    if (type === "text") {
      out += sse("content_block_start", { type: "content_block_start", index, content_block: { type: "text", text: "" } });
      if (block.text) out += sse("content_block_delta", { type: "content_block_delta", index, delta: { type: "text_delta", text: block.text } });
    } else if (type === "tool_use") {
      out += sse("content_block_start", { type: "content_block_start", index, content_block: { type: "tool_use", id: block.id, name: block.name, input: {} } });
      out += sse("content_block_delta", { type: "content_block_delta", index, delta: { type: "input_json_delta", partial_json: JSON.stringify(block.input ?? {}) } });
    } else if (type === "thinking") {
      out += sse("content_block_start", { type: "content_block_start", index, content_block: { type: "thinking", thinking: "", signature: "" } });
      if (block.thinking) out += sse("content_block_delta", { type: "content_block_delta", index, delta: { type: "thinking_delta", thinking: block.thinking } });
      if (block.signature) out += sse("content_block_delta", { type: "content_block_delta", index, delta: { type: "signature_delta", signature: block.signature } });
    } else {
      out += sse("content_block_start", { type: "content_block_start", index, content_block: block });
    }
    out += sse("content_block_stop", { type: "content_block_stop", index });
  });
  out += sse("message_delta", {
    type: "message_delta",
    delta: { stop_reason: message.stop_reason, stop_sequence: null },
    usage: { input_tokens: message.usage.input_tokens, output_tokens: message.usage.output_tokens },
  });
  out += sse("message_stop", { type: "message_stop" });
  return out;
};

export const anthropicError = (type: string, message: string) => ({ type: "error", error: { type, message } });

export const lowBalanceMessage = (requiredMicros: number) => {
  const dollars = Math.max(0.01, Math.ceil(requiredMicros / 10_000) / 100);
  return `Your AppKeep balance is too low for this AI request (it needs up to $${dollars.toFixed(2)}). Add money to your balance on AppKeep to keep using AI.`;
};
