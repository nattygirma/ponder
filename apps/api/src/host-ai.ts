// AI provided by the host (AppKeep's ai.text, paid from the owner's AppKeep balance), offered to the
// browser as an Anthropic-compatible service so Ponder's AI works with no key of the user's own.
// This module is pure: constants, keys and the translation between Anthropic's Messages API and the
// host's one-turn text call. host-ai-routes.ts serves it; ai-service.ts seeds the provider row.

/** Where the service lives on the copy's own address. Outside /api/v1, which needs a signed-in session. */
export const HOST_AI_PATH = "/api/host-ai/v1";
export const HOST_AI_DISPLAY_NAME = "AppKeep AI";
export const HOST_AI_MODELS = [
  { modelId: "claude-sonnet-5-5", displayName: "Claude Sonnet 5.5" },
  { modelId: "claude-opus-5-5", displayName: "Claude Opus 5.5" },
] as const;
const DEFAULT_MODEL = HOST_AI_MODELS[0].modelId;
const MAX_TOKENS = 16_000;
const DEFAULT_MAX_TOKENS = 4_096;
const EFFORTS = new Set(["low", "medium", "high"]);
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
    ok: true; id: string; model: string; stop_reason: string | null; content: Record<string, unknown>[];
    usage: { input_tokens: number; output_tokens: number }; charged_micros?: number;
  }
  | { ok: false; reason: "insufficient_funds"; required_micros: number; available_micros: number };
export type HostAiText = (request: HostAiTextRequest, options?: { user?: string; ref?: string }) => Promise<HostAiTextResult>;

export type HostAiEnvironment = { hostAiText?: HostAiText; ALTSTACK_APP_URL?: string };

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
export const toHostAiRequest = (body: unknown): { request: HostAiTextRequest; stream: boolean; model: string } => {
  const input = asRecord(body);
  if (!input || !Array.isArray(input.messages) || !input.messages.length) throw new HostAiRequestError("messages is required.");
  const model = HOST_AI_MODELS.some((item) => item.modelId === input.model) ? input.model as string : DEFAULT_MODEL;
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
  return {
    stream: input.stream === true,
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
