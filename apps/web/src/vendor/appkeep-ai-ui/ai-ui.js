// Vendored copy of AppKeep's @appkeep/ai-ui 0.1.0 (MIT licence), the web components AppKeep offers its apps.
// To update, replace this file with the package's ai-ui.js / ai-ui.d.ts and keep this header; don't edit it here.
// @appkeep/ai-ui: web components for AI chat on AppKeep. One dependency-free ES module.
//
//   <appkeep-ai-message>  a live reply: streaming text, a collapsible thinking section and tool steps,
//                         driven by el.push(event). Adapters turn Claude, OpenAI chat and OpenAI
//                         Responses streams into those events.
//   <appkeep-ai-info>     the "…" button after a reply. Hover, keyboard focus or tap opens a card with
//                         the model, tokens, price and who paid, from usage records (ai.usage(id)).
//
// The pure parts (the reducer, the adapters, usage totals and formatting) are exported too, so they can
// be tested and reused without a DOM. Elements are defined on import when the page has custom elements;
// call defineAiUi() yourself when a DOM is set up later (tests, server rendering).

// ---------------------------------------------------------------------------------------------------
// Labels. Every visible string can be replaced (el.labels = { ... }) for translation.

export const DEFAULT_LABELS = Object.freeze({
  thinking: "Thinking…",
  thoughtFor: "Thought for {time}",
  thinkingStatus: "Thinking",
  thoughtStatus: "Finished thinking",
  seconds: "{s}s",
  minutes: "{m}m {s}s",
  toolStarted: "Preparing",
  toolRunning: "Running",
  toolDone: "Done",
  toolFailed: "Failed",
  cutOff: "The reply was cut off at its length limit.",
  button: "Message info",
  title: "Message info",
  model: "Model",
  input: "Input",
  output: "Output",
  calls: "Model calls",
  price: "Price",
  paidWith: "Paid with",
  cached: "{n} cached",
  thinkingTokens: "{n} thinking",
  credits: "AppKeep credits",
  key: "Your key, estimated",
  mixed: "AppKeep credits and your key",
  about: "about {price}",
  tokens: "{n} tokens",
  loading: "Loading…",
  unavailable: "Usage isn't available for this message.",
  running: "Still running, so these numbers may change.",
});

const fill = (template, values) => String(template).replace(/\{(\w+)\}/g, (match, key) => (key in values ? String(values[key]) : match));

// ---------------------------------------------------------------------------------------------------
// Message state. reduceMessage(state, event) returns the next state and never mutates its input.

/** Finish reasons that mean the model stopped at its length limit. */
const CUT_OFF = new Set(["max_tokens", "length", "max_output_tokens"]);
/** Finish reasons that end one model call but not the reply: the app runs tools and calls again. */
const CONTINUES = new Set(["tool_use", "tool_calls", "tool-calls", "pause_turn"]);
const TOOL_STATUSES = new Set(["started", "running", "done", "failed"]);

export const createMessageState = (at = null) => ({
  startedAt: at,
  text: "",
  /** endedAt is set at the first output (text or a tool step) or when the reply ends. */
  thinking: { text: "", endedAt: null, gap: false },
  tools: [],
  usage: [],
  finish: null,
  error: null,
  done: false,
});

const now = () => Date.now();

export const reduceMessage = (state, event, at = now()) => {
  if (!event || typeof event !== "object") return state;
  const when = typeof event.at === "number" ? event.at : at;
  const next = { ...state, thinking: { ...state.thinking } };
  if (next.startedAt == null) next.startedAt = when;
  const endThinking = () => {
    if (next.thinking.endedAt == null) next.thinking.endedAt = when;
    next.thinking.gap = true;
  };
  const tool = (id, change) => {
    const index = next.tools.findIndex((item) => item.id === id);
    if (index < 0) return;
    next.tools = next.tools.slice();
    next.tools[index] = { ...next.tools[index], ...change };
  };
  switch (event.type) {
    case "start":
      next.startedAt = when;
      break;
    case "text":
      if (!event.text) return state;
      next.text = state.text + event.text;
      endThinking();
      break;
    case "thinking": {
      if (!event.text) return state;
      // Thinking after text or a tool step (the next call of a tool loop) starts a new paragraph.
      const separator = next.thinking.gap && next.thinking.text && !/\n\s*$/.test(next.thinking.text) ? "\n\n" : "";
      next.thinking.text = next.thinking.text + separator + event.text;
      next.thinking.gap = false;
      break;
    }
    case "tool-start": {
      endThinking();
      const id = String(event.id ?? `tool-${state.tools.length + 1}`);
      if (state.tools.some((item) => item.id === id)) {
        if (event.name) tool(id, { name: String(event.name) });
        break;
      }
      next.tools = [...state.tools, { id, name: String(event.name ?? "tool"), input: typeof event.input === "string" ? event.input : "", status: "started", summary: "" }];
      break;
    }
    case "tool-input":
      tool(String(event.id), { input: (state.tools.find((item) => item.id === String(event.id))?.input ?? "") + String(event.delta ?? "") });
      break;
    case "tool-run":
      tool(String(event.id), { status: "running" });
      break;
    case "tool-end": {
      const id = String(event.id);
      if (!state.tools.some((item) => item.id === id)) {
        endThinking();
        next.tools = [...state.tools, { id, name: String(event.name ?? "tool"), input: "", status: "started", summary: "" }];
      }
      tool(id, {
        status: event.status === "failed" || event.status === "error" ? "failed" : "done",
        summary: typeof event.summary === "string" ? event.summary : "",
        ...(event.name ? { name: String(event.name) } : {}),
      });
      break;
    }
    case "tool-status":
      if (TOOL_STATUSES.has(event.status)) tool(String(event.id), { status: event.status, ...(typeof event.summary === "string" ? { summary: event.summary } : {}) });
      break;
    case "usage": {
      const { type: _type, at: _at, ...record } = event;
      next.usage = [...state.usage, record];
      break;
    }
    case "finish": {
      const reason = event.reason == null ? null : String(event.reason);
      if (reason && CONTINUES.has(reason)) {
        endThinking();
        break;
      }
      next.finish = { reason, cutOff: !!reason && CUT_OFF.has(reason) };
      next.done = true;
      if (next.thinking.endedAt == null) next.thinking.endedAt = when;
      break;
    }
    case "error":
      next.error = String(event.message || "Something went wrong.");
      next.done = true;
      if (next.thinking.endedAt == null) next.thinking.endedAt = when;
      break;
    default:
      return state;
  }
  return next;
};

/** How long the model thought, in milliseconds (still counting while it thinks). */
export const thinkingDuration = (state, at = now()) => {
  if (state.startedAt == null) return 0;
  return Math.max(0, (state.thinking.endedAt ?? at) - state.startedAt);
};

export const formatDuration = (ms, labels = DEFAULT_LABELS) => {
  const total = Math.max(0, Math.round(ms / 1000));
  if (total < 60) return fill(labels.seconds, { s: total });
  return fill(labels.minutes, { m: Math.floor(total / 60), s: total % 60 });
};

// ---------------------------------------------------------------------------------------------------
// Adapters: each returns a function that takes one provider stream event (parsed JSON, or its JSON text)
// and returns the matching list of events for el.push. They keep a little state per stream, so make one
// adapter per model call.

const parsed = (data) => {
  if (typeof data !== "string") return data && typeof data === "object" ? data : null;
  if (!data.trim() || data.trim() === "[DONE]") return null;
  try {
    return JSON.parse(data);
  } catch {
    return null;
  }
};
const num = (value) => (typeof value === "number" && Number.isFinite(value) ? value : undefined);

/** Claude Messages API stream events (the `data` of each server-sent event). */
export const createClaudeAdapter = () => {
  const blocks = new Map();
  let model = null;
  let usage = {};
  let stopReason = null;
  return (input) => {
    const data = parsed(input);
    if (!data) return [];
    const out = [];
    switch (data.type) {
      case "message_start":
        model = data.message?.model ?? null;
        usage = { ...(data.message?.usage ?? {}) };
        break;
      case "content_block_start": {
        const block = data.content_block ?? {};
        blocks.set(data.index, { type: block.type, id: block.id });
        if (block.type === "tool_use" || block.type === "server_tool_use" || block.type === "mcp_tool_use") {
          out.push({ type: "tool-start", id: block.id, name: block.name });
        } else if (block.type === "text" && block.text) {
          out.push({ type: "text", text: block.text });
        } else if (block.type === "thinking" && block.thinking) {
          out.push({ type: "thinking", text: block.thinking });
        } else if (typeof block.type === "string" && block.type.endsWith("_tool_result")) {
          const content = block.content;
          const failed = block.is_error === true || (content && !Array.isArray(content) && typeof content.type === "string" && content.type.endsWith("_error"));
          out.push({ type: "tool-end", id: block.tool_use_id, status: failed ? "failed" : "done" });
        }
        break;
      }
      case "content_block_delta": {
        const delta = data.delta ?? {};
        if (delta.type === "text_delta" && delta.text) out.push({ type: "text", text: delta.text });
        else if (delta.type === "thinking_delta" && delta.thinking) out.push({ type: "thinking", text: delta.thinking });
        else if (delta.type === "input_json_delta" && delta.partial_json) {
          const id = blocks.get(data.index)?.id;
          if (id) out.push({ type: "tool-input", id, delta: delta.partial_json });
        }
        break;
      }
      case "content_block_stop": {
        const block = blocks.get(data.index);
        if (block && (block.type === "tool_use" || block.type === "server_tool_use" || block.type === "mcp_tool_use")) out.push({ type: "tool-run", id: block.id });
        break;
      }
      case "message_delta":
        usage = { ...usage, ...(data.usage ?? {}) };
        if (data.delta?.stop_reason) stopReason = data.delta.stop_reason;
        break;
      case "message_stop":
        out.push({
          type: "usage",
          model,
          usage: {
            input_tokens: num(usage.input_tokens) ?? 0,
            cache_read_tokens: num(usage.cache_read_input_tokens) ?? 0,
            cache_write_tokens: num(usage.cache_creation_input_tokens) ?? 0,
            output_tokens: num(usage.output_tokens) ?? 0,
          },
        });
        out.push({ type: "finish", reason: stopReason });
        break;
      case "error":
        out.push({ type: "error", message: data.error?.message ?? "The model returned an error." });
        break;
      default:
        break;
    }
    return out;
  };
};

/** OpenAI chat completion chunks (`chat.completion.chunk`), including `reasoning_content` for thinking. */
export const createOpenAIChatAdapter = () => {
  const tools = new Map();
  let model = null;
  let finished = false;
  return (input) => {
    const data = parsed(input);
    if (!data) return [];
    const out = [];
    if (data.error) return [{ type: "error", message: data.error.message ?? "The model returned an error." }];
    if (data.model) model = data.model;
    for (const choice of Array.isArray(data.choices) ? data.choices : []) {
      const delta = choice.delta ?? {};
      const thinking = delta.reasoning_content ?? delta.reasoning;
      if (typeof thinking === "string" && thinking) out.push({ type: "thinking", text: thinking });
      if (typeof delta.content === "string" && delta.content) out.push({ type: "text", text: delta.content });
      for (const call of Array.isArray(delta.tool_calls) ? delta.tool_calls : []) {
        const index = call.index ?? 0;
        let known = tools.get(index);
        if (!known) {
          known = { id: call.id ?? `call-${index}`, name: call.function?.name ?? "tool" };
          tools.set(index, known);
          out.push({ type: "tool-start", id: known.id, name: known.name });
        }
        if (call.function?.arguments) out.push({ type: "tool-input", id: known.id, delta: call.function.arguments });
      }
      if (choice.finish_reason && !finished) {
        finished = true;
        if (choice.finish_reason === "tool_calls") for (const known of tools.values()) out.push({ type: "tool-run", id: known.id });
        out.push({ type: "finish", reason: choice.finish_reason });
      }
    }
    if (data.usage) {
      const cached = num(data.usage.prompt_tokens_details?.cached_tokens) ?? 0;
      // OpenAI counts cached tokens inside prompt_tokens; usage records count them apart, as Claude does.
      out.push({
        type: "usage",
        model,
        usage: {
          input_tokens: Math.max(0, (num(data.usage.prompt_tokens) ?? 0) - cached),
          cache_read_tokens: cached,
          cache_write_tokens: 0,
          output_tokens: num(data.usage.completion_tokens) ?? 0,
          thinking_tokens: num(data.usage.completion_tokens_details?.reasoning_tokens) ?? 0,
        },
      });
      // A stream with usage sends it after the finish reason; keep the finish event last.
      const finish = out.findIndex((event) => event.type === "finish");
      if (finish >= 0) out.push(...out.splice(finish, 1));
    }
    return out;
  };
};

/** OpenAI Responses API stream events (`response.*`), which carry reasoning summaries. */
export const createOpenAIResponsesAdapter = () => {
  const items = new Map();
  let summaryParts = 0;
  return (input) => {
    const data = parsed(input);
    if (!data) return [];
    const out = [];
    switch (data.type) {
      case "response.output_text.delta":
        if (data.delta) out.push({ type: "text", text: data.delta });
        break;
      case "response.reasoning_summary_part.added":
        if (summaryParts++ > 0) out.push({ type: "thinking", text: "\n\n" });
        break;
      case "response.reasoning_summary_text.delta":
        if (data.delta) out.push({ type: "thinking", text: data.delta });
        break;
      case "response.output_item.added": {
        const item = data.item ?? {};
        if (item.type === "function_call" || item.type === "custom_tool_call" || item.type === "mcp_call") {
          const id = item.call_id ?? item.id;
          items.set(item.id, { id, server: false });
          out.push({ type: "tool-start", id, name: item.name ?? "tool" });
        } else if (typeof item.type === "string" && item.type.endsWith("_call")) {
          items.set(item.id, { id: item.id, server: true });
          out.push({ type: "tool-start", id: item.id, name: item.type.replace(/_call$/, "") });
        }
        break;
      }
      case "response.function_call_arguments.delta":
      case "response.custom_tool_call_input.delta": {
        const known = items.get(data.item_id);
        if (known && data.delta) out.push({ type: "tool-input", id: known.id, delta: data.delta });
        break;
      }
      case "response.output_item.done": {
        const item = data.item ?? {};
        const known = items.get(item.id);
        if (!known) break;
        if (known.server) out.push({ type: "tool-end", id: known.id, status: item.status === "failed" ? "failed" : "done" });
        else out.push({ type: "tool-run", id: known.id });
        break;
      }
      case "response.completed":
      case "response.incomplete": {
        const response = data.response ?? {};
        const usage = response.usage;
        if (usage) {
          const cached = num(usage.input_tokens_details?.cached_tokens) ?? 0;
          out.push({
            type: "usage",
            model: response.model ?? null,
            usage: {
              input_tokens: Math.max(0, (num(usage.input_tokens) ?? 0) - cached),
              cache_read_tokens: cached,
              cache_write_tokens: 0,
              output_tokens: num(usage.output_tokens) ?? 0,
              thinking_tokens: num(usage.output_tokens_details?.reasoning_tokens) ?? 0,
            },
          });
        }
        const calledTools = (response.output ?? []).some((item) => item?.type === "function_call" || item?.type === "custom_tool_call");
        const reason = data.type === "response.incomplete"
          ? response.incomplete_details?.reason ?? "incomplete"
          : calledTools ? "tool_calls" : "stop";
        out.push({ type: "finish", reason });
        break;
      }
      case "response.failed":
        out.push({ type: "error", message: data.response?.error?.message ?? "The model returned an error." });
        break;
      case "error":
        out.push({ type: "error", message: data.message ?? data.error?.message ?? "The model returned an error." });
        break;
      default:
        break;
    }
    return out;
  };
};

/**
 * Splits a text/event-stream into events. push(chunk) as text arrives, end() at the close;
 * onEvent gets { event, data } for each complete event.
 */
export const createSSEParser = (onEvent) => {
  let buffer = "";
  const flush = (block) => {
    let event = "message";
    const data = [];
    for (const line of block.split(/\r?\n/)) {
      if (!line || line.startsWith(":")) continue;
      const colon = line.indexOf(":");
      const field = colon < 0 ? line : line.slice(0, colon);
      const value = colon < 0 ? "" : line.slice(colon + 1).replace(/^ /, "");
      if (field === "event") event = value;
      else if (field === "data") data.push(value);
    }
    if (data.length) onEvent({ event, data: data.join("\n") });
  };
  return {
    push(chunk) {
      buffer += chunk;
      const blocks = buffer.split(/\r?\n\r?\n/);
      buffer = blocks.pop() ?? "";
      for (const block of blocks) flush(block);
    },
    end() {
      if (buffer.trim()) flush(buffer);
      buffer = "";
    },
  };
};

// ---------------------------------------------------------------------------------------------------
// Usage totals and formatting for the info card.

const asList = (records) => (Array.isArray(records) ? records : records ? [records] : []).filter((item) => item && typeof item === "object");

/**
 * Totals across the usage records of one message (a tool loop makes several calls). Input counts cached
 * tokens too; output includes thinking. Missing numbers stay null so the card can leave them out.
 */
export const summarizeUsage = (records) => {
  const list = asList(records);
  const sum = (pick) => {
    let seen = false;
    let total = 0;
    for (const record of list) {
      const value = num(pick(record.usage ?? {}));
      if (value === undefined) continue;
      seen = true;
      total += value;
    }
    return seen ? total : null;
  };
  const input = sum((u) => u.input_tokens);
  const cacheRead = sum((u) => u.cache_read_tokens);
  const cacheWrite = sum((u) => u.cache_write_tokens);
  const prices = list.map((record) => num(record.price_micros)).filter((value) => value !== undefined);
  const paid = new Set(list.map((record) => record.paid_with).filter((value) => value === "credits" || value === "key"));
  return {
    calls: list.length,
    models: [...new Set(list.map((record) => record.model).filter(Boolean))],
    input: input === null && cacheRead === null && cacheWrite === null ? null : (input ?? 0) + (cacheRead ?? 0) + (cacheWrite ?? 0),
    cached: cacheRead,
    output: sum((u) => u.output_tokens),
    thinking: sum((u) => u.thinking_tokens),
    priceMicros: prices.length ? prices.reduce((a, b) => a + b, 0) : null,
    estimated: list.some((record) => record.estimated === true || record.paid_with === "key"),
    paidWith: paid.size > 1 ? "mixed" : paid.size ? [...paid][0] : null,
    running: list.some((record) => record.result === "running"),
  };
};

export const formatTokens = (count, locale) => new Intl.NumberFormat(locale || undefined).format(Math.round(count));

/** Micro-dollars as dollars: two decimals, or two significant digits under a cent. */
export const formatPrice = (micros, locale) => {
  const dollars = micros / 1_000_000;
  const options = dollars > 0 && dollars < 0.01
    ? { style: "currency", currency: "USD", maximumSignificantDigits: 2 }
    : { style: "currency", currency: "USD", minimumFractionDigits: 2, maximumFractionDigits: 2 };
  return new Intl.NumberFormat(locale || undefined, options).format(dollars);
};

/** The rows the card shows, as [label, value] pairs, so apps can reuse the wording elsewhere. */
export const usageRows = (summary, { labels = DEFAULT_LABELS, locale, modelName = (id) => id } = {}) => {
  const rows = [];
  const tokens = (n) => formatTokens(n, locale);
  if (summary.models.length) rows.push([labels.model, summary.models.map((id) => modelName(id) || id).join(", ")]);
  if (summary.input !== null) {
    rows.push([labels.input, summary.cached ? `${tokens(summary.input)} (${fill(labels.cached, { n: tokens(summary.cached) })})` : tokens(summary.input)]);
  }
  if (summary.output !== null) {
    rows.push([labels.output, summary.thinking ? `${tokens(summary.output)} (${fill(labels.thinkingTokens, { n: tokens(summary.thinking) })})` : tokens(summary.output)]);
  }
  if (summary.calls > 1) rows.push([labels.calls, tokens(summary.calls)]);
  if (summary.priceMicros !== null) {
    const price = formatPrice(summary.priceMicros, locale);
    rows.push([labels.price, summary.estimated ? fill(labels.about, { price }) : price]);
  }
  if (summary.paidWith) rows.push([labels.paidWith, labels[summary.paidWith]]);
  return rows;
};

// ---------------------------------------------------------------------------------------------------
// Styles. Hosts theme the elements with these custom properties (they pass into the shadow roots):
//   --appkeep-ai-font, --appkeep-ai-font-size, --appkeep-ai-fg, --appkeep-ai-muted, --appkeep-ai-border,
//   --appkeep-ai-surface, --appkeep-ai-subtle, --appkeep-ai-hover, --appkeep-ai-focus, --appkeep-ai-danger,
//   --appkeep-ai-success, --appkeep-ai-radius, --appkeep-ai-shadow
// Defaults follow the page's color-scheme (light-dark()); theme="dark" or theme="light" forces one.

const TOKENS = `
  :host {
    --_font: var(--appkeep-ai-font, inherit);
    --_size: var(--appkeep-ai-font-size, 0.8125rem);
    --_fg: var(--appkeep-ai-fg, light-dark(#1f2328, #e8e8e6));
    --_muted: var(--appkeep-ai-muted, light-dark(#6b6f76, #9b9b97));
    --_border: var(--appkeep-ai-border, light-dark(#e3e3e0, #373735));
    --_surface: var(--appkeep-ai-surface, light-dark(#ffffff, #252524));
    --_subtle: var(--appkeep-ai-subtle, light-dark(#f7f7f5, #2a2a29));
    --_hover: var(--appkeep-ai-hover, light-dark(rgba(55, 53, 47, 0.08), rgba(255, 255, 255, 0.08)));
    --_focus: var(--appkeep-ai-focus, light-dark(#2f6fde, #6fa1ff));
    --_danger: var(--appkeep-ai-danger, light-dark(#c4314b, #ff7b8a));
    --_success: var(--appkeep-ai-success, light-dark(#2e7d4f, #6fcf97));
    --_radius: var(--appkeep-ai-radius, 6px);
    --_shadow: var(--appkeep-ai-shadow, 0 8px 24px light-dark(rgba(15, 15, 15, 0.12), rgba(0, 0, 0, 0.45)), 0 0 0 1px var(--_border));
    font-family: var(--_font);
    font-size: var(--_size);
    color: var(--_fg);
  }
  :host([theme="dark"]) { color-scheme: dark; }
  :host([theme="light"]) { color-scheme: light; }
  :host([hidden]) { display: none !important; }
  button { font: inherit; color: inherit; }
  button:focus-visible { outline: 2px solid var(--_focus); outline-offset: 1px; }
  .sr { position: absolute; width: 1px; height: 1px; margin: -1px; overflow: hidden; clip: rect(0 0 0 0); white-space: nowrap; border: 0; }
  @media (prefers-reduced-motion: reduce) { * { animation: none !important; transition: none !important; } }
`;

const MESSAGE_CSS = `${TOKENS}
  :host { display: block; line-height: 1.5; }
  :host([empty]) { display: none; }
  .thinking { margin: 0 0 6px; }
  .toggle { display: inline-flex; align-items: center; gap: 6px; max-width: 100%; padding: 2px 6px 2px 2px; margin-left: -2px;
    border: 0; border-radius: var(--_radius); background: none; color: var(--_muted); cursor: pointer; text-align: left; }
  .toggle:hover:not(:disabled) { background: var(--_hover); color: var(--_fg); }
  .toggle:disabled { cursor: default; }
  .chevron { width: 12px; height: 12px; flex: none; transition: transform 120ms ease; transform: rotate(-90deg); }
  .toggle[aria-expanded="true"] .chevron { transform: rotate(0deg); }
  .toggle:disabled .chevron { visibility: hidden; }
  .active .label { background: linear-gradient(90deg, var(--_muted) 0%, var(--_fg) 50%, var(--_muted) 100%);
    background-size: 200% 100%; -webkit-background-clip: text; background-clip: text; color: transparent; animation: shimmer 1.6s linear infinite; }
  @keyframes shimmer { from { background-position: 100% 0; } to { background-position: -100% 0; } }
  .time { font-variant-numeric: tabular-nums; }
  .summary { margin: 4px 0 0 7px; padding: 0 0 0 11px; border-left: 2px solid var(--_border); color: var(--_muted);
    white-space: pre-wrap; overflow-wrap: anywhere; max-height: 18em; overflow: auto; }
  .tools { list-style: none; margin: 0 0 6px; padding: 0; display: grid; gap: 2px; }
  .tool { display: flex; align-items: flex-start; gap: 6px; color: var(--_muted); min-width: 0; }
  .tool .icon { width: 14px; height: 14px; flex: none; margin-top: 0.2em; }
  .tool[data-status="started"] .icon, .tool[data-status="running"] .icon { animation: spin 0.9s linear infinite; }
  .tool[data-status="done"] .icon { color: var(--_success); }
  .tool[data-status="failed"] .icon, .tool[data-status="failed"] .state { color: var(--_danger); }
  .tool .name { color: var(--_fg); font-weight: 500; overflow-wrap: anywhere; }
  .tool .detail { overflow-wrap: anywhere; }
  @keyframes spin { to { transform: rotate(360deg); } }
  .text { white-space: pre-wrap; overflow-wrap: anywhere; }
  .note { margin: 6px 0 0; color: var(--_muted); }
  .error { margin: 6px 0 0; color: var(--_danger); }
`;

const INFO_CSS = `${TOKENS}
  :host { display: inline-block; position: relative; vertical-align: middle; line-height: 1.4; }
  .button { display: inline-flex; align-items: center; justify-content: center; width: 24px; height: 24px; padding: 0;
    border: 0; border-radius: var(--_radius); background: none; color: var(--_muted); cursor: pointer; touch-action: manipulation; }
  .button:hover, .button[aria-expanded="true"] { background: var(--_hover); color: var(--_fg); }
  .button svg { width: 16px; height: 16px; }
  .card { position: fixed; inset: auto; margin: 0; z-index: 2147483000; box-sizing: border-box; width: max-content; min-width: 200px; max-width: min(300px, calc(100vw - 16px));
    padding: 10px 12px; border: 0; border-radius: calc(var(--_radius) + 2px); background: var(--_surface); color: var(--_fg);
    box-shadow: var(--_shadow); font: inherit; font-family: var(--_font); font-size: var(--_size); overflow: visible; }
  .card:not(.open) { display: none; }
  .heading { margin: 0 0 6px; font-weight: 600; }
  dl { display: grid; grid-template-columns: auto 1fr; gap: 3px 14px; margin: 0; }
  dt { color: var(--_muted); }
  dd { margin: 0; font-variant-numeric: tabular-nums; overflow-wrap: anywhere; }
  .status { margin: 0; color: var(--_muted); }
  .status + dl, dl + .status { margin-top: 6px; }
`;

const ICONS = {
  chevron: '<svg class="chevron" viewBox="0 0 16 16" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M4 6l4 4 4-4"/></svg>',
  pending: '<svg class="icon" viewBox="0 0 16 16" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"><path d="M8 2a6 6 0 1 0 6 6" opacity="0.9"/></svg>',
  done: '<svg class="icon" viewBox="0 0 16 16" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M3.5 8.5l3 3 6-7"/></svg>',
  failed: '<svg class="icon" viewBox="0 0 16 16" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"><path d="M4.5 4.5l7 7M11.5 4.5l-7 7"/></svg>',
  dots: '<svg viewBox="0 0 16 16" aria-hidden="true" fill="currentColor"><circle cx="3.5" cy="8" r="1.4"/><circle cx="8" cy="8" r="1.4"/><circle cx="12.5" cy="8" r="1.4"/></svg>',
};

let uid = 0;
const nextId = (prefix) => `${prefix}-${++uid}`;

// ---------------------------------------------------------------------------------------------------
// Elements. Built in a function so the module still imports where HTMLElement doesn't exist (Node).

export const defineAiUi = (registry = globalThis.customElements) => {
  if (!registry || typeof HTMLElement === "undefined") return false;
  if (!registry.get("appkeep-ai-message")) registry.define("appkeep-ai-message", createMessageElement());
  if (!registry.get("appkeep-ai-info")) registry.define("appkeep-ai-info", createInfoElement());
  return true;
};

const createMessageElement = () => class AppKeepAiMessage extends HTMLElement {
  static get observedAttributes() { return ["sections"]; }

  constructor() {
    super();
    this._state = createMessageState();
    this._labels = DEFAULT_LABELS;
    this._toolLabel = null;
    this._renderText = null;
    this._userToggled = false;
    this._open = false;
    this._timer = null;
    this._frame = 0;
    this._phase = "";
    const root = this.attachShadow({ mode: "open" });
    const bodyId = nextId("appkeep-ai-thinking");
    root.innerHTML = `<style>${MESSAGE_CSS}</style>
      <div class="thinking" part="thinking" hidden>
        <button type="button" class="toggle" part="thinking-toggle" aria-expanded="false" aria-controls="${bodyId}">${ICONS.chevron}<span class="label"></span><span class="time" aria-hidden="true"></span></button>
        <div class="summary" part="thinking-summary" id="${bodyId}" hidden></div>
        <span class="sr" role="status"></span>
      </div>
      <ul class="tools" part="tools" hidden></ul>
      <slot name="text"><div class="text" part="text"></div></slot>
      <p class="note" part="note" hidden></p>
      <p class="error" part="error" role="alert" hidden></p>`;
    this._el = {
      thinking: root.querySelector(".thinking"),
      toggle: root.querySelector(".toggle"),
      label: root.querySelector(".label"),
      time: root.querySelector(".time"),
      summary: root.querySelector(".summary"),
      status: root.querySelector("[role=status]"),
      tools: root.querySelector(".tools"),
      text: root.querySelector(".text"),
      note: root.querySelector(".note"),
      error: root.querySelector(".error"),
    };
    this._el.toggle.addEventListener("click", () => {
      this._userToggled = true;
      this._open = !this._open;
      this._render();
    });
  }

  connectedCallback() { this._render(); }
  disconnectedCallback() { this._stopTimer(); if (this._frame && typeof cancelAnimationFrame === "function") cancelAnimationFrame(this._frame); this._frame = 0; }
  attributeChangedCallback() { this._render(); }

  /** The current state (read-only). */
  get state() { return this._state; }
  get labels() { return this._labels; }
  set labels(value) { this._labels = { ...DEFAULT_LABELS, ...(value || {}) }; this._render(); }
  /** (name) => display name for a tool. */
  get toolLabel() { return this._toolLabel; }
  set toolLabel(fn) { this._toolLabel = typeof fn === "function" ? fn : null; this._render(); }
  /** (text, container) => void, to render the reply as Markdown or anything else. */
  get renderText() { return this._renderText; }
  set renderText(fn) { this._renderText = typeof fn === "function" ? fn : null; this._renderedText = undefined; this._render(); }

  /** Starts the thinking timer now (or at `at`), before the first event arrives. */
  start(at) { this.push({ type: "start", ...(typeof at === "number" ? { at } : {}) }); }

  push(event) {
    const before = this._state;
    this._state = reduceMessage(before, event);
    if (this._state === before) return;
    if (event.type === "usage") this.dispatchEvent(new CustomEvent("appkeep-ai-usage", { detail: this._state.usage[this._state.usage.length - 1], bubbles: true, composed: true }));
    if (this._state.done && !before.done) this.dispatchEvent(new CustomEvent("appkeep-ai-finish", { detail: { finish: this._state.finish, error: this._state.error }, bubbles: true, composed: true }));
    this._schedule();
  }

  pushAll(events) { for (const event of events || []) this.push(event); }

  reset() {
    this._state = createMessageState();
    this._userToggled = false;
    this._open = false;
    this._phase = "";
    this._renderedText = undefined;
    this._el.tools.textContent = "";
    this._render();
  }

  _sections() {
    const raw = this.getAttribute("sections");
    return new Set((raw ?? "thinking tools text").split(/[\s,]+/).filter(Boolean));
  }

  _schedule() {
    if (typeof requestAnimationFrame !== "function") { this._render(); return; }
    if (this._frame) return;
    this._frame = requestAnimationFrame(() => { this._frame = 0; this._render(); });
  }

  _stopTimer() { if (this._timer) clearInterval(this._timer); this._timer = null; }

  _render() {
    const state = this._state;
    const labels = this._labels;
    const sections = this._sections();
    const el = this._el;
    if (state.startedAt != null && !state.done) this.setAttribute("aria-busy", "true");
    else this.removeAttribute("aria-busy");

    // Thinking: "Thinking… 4s" from the start until the first output, then "Thought for 4s".
    const active = state.startedAt != null && state.thinking.endedAt == null;
    const summary = state.thinking.text.trim();
    const duration = thinkingDuration(state);
    const showThinking = sections.has("thinking") && state.startedAt != null && (active || summary || duration >= 1000);
    el.thinking.hidden = !showThinking;
    if (showThinking) {
      if (!this._userToggled) this._open = active && !!summary;
      el.thinking.classList.toggle("active", active);
      el.label.textContent = active ? labels.thinking : fill(labels.thoughtFor, { time: formatDuration(duration, labels) });
      el.time.textContent = active ? formatDuration(duration, labels) : "";
      el.toggle.disabled = !summary;
      el.toggle.setAttribute("aria-expanded", String(!!summary && this._open));
      el.summary.hidden = !(summary && this._open);
      if (el.summary.textContent !== state.thinking.text) {
        const pinned = el.summary.scrollHeight - el.summary.scrollTop - el.summary.clientHeight < 8;
        el.summary.textContent = state.thinking.text;
        if (pinned) el.summary.scrollTop = el.summary.scrollHeight;
      }
      // Announced once per phase, not every second.
      const phase = active ? labels.thinkingStatus : labels.thoughtStatus;
      if (phase !== this._phase) { this._phase = phase; el.status.textContent = phase; }
    }
    if (active && showThinking && this.isConnected) {
      if (!this._timer) this._timer = setInterval(() => this._render(), 1000);
    } else this._stopTimer();

    // Tool steps, keyed by id so a live list doesn't rebuild.
    const showTools = sections.has("tools") && state.tools.length > 0;
    el.tools.hidden = !showTools;
    if (showTools) {
      const existing = new Map([...el.tools.children].map((node) => [node.dataset.id, node]));
      state.tools.forEach((tool, index) => {
        let node = existing.get(tool.id);
        if (!node) {
          node = document.createElement("li");
          node.className = "tool";
          node.setAttribute("part", "tool");
          node.dataset.id = tool.id;
          node.innerHTML = '<span class="glyph"></span><span><span class="name"></span> <span class="state"></span><span class="detail"></span></span>';
        }
        if (el.tools.children[index] !== node) el.tools.insertBefore(node, el.tools.children[index] ?? null);
        if (node.dataset.status !== tool.status) {
          node.dataset.status = tool.status;
          node.querySelector(".glyph").innerHTML = tool.status === "done" ? ICONS.done : tool.status === "failed" ? ICONS.failed : ICONS.pending;
        }
        const name = this._toolLabel ? this._toolLabel(tool.name, tool) : tool.name;
        node.querySelector(".name").textContent = name || tool.name;
        node.querySelector(".state").textContent = labels[`tool${tool.status[0].toUpperCase()}${tool.status.slice(1)}`] ?? tool.status;
        node.querySelector(".detail").textContent = tool.summary ? ` · ${tool.summary}` : "";
        existing.delete(tool.id);
      });
      for (const stale of existing.values()) stale.remove();
    }

    // Text.
    const showText = sections.has("text");
    el.text.hidden = !showText || !state.text;
    if (showText && this._renderedText !== state.text) {
      this._renderedText = state.text;
      if (this._renderText) this._renderText(state.text, el.text);
      else el.text.textContent = state.text;
    }

    el.note.hidden = !(state.finish?.cutOff);
    el.note.textContent = state.finish?.cutOff ? labels.cutOff : "";
    el.error.hidden = !state.error;
    el.error.textContent = state.error ?? "";
    // Nothing to show (say only thinking is drawn and the answer came at once): take no room in the layout.
    const empty = el.thinking.hidden && el.tools.hidden && el.text.hidden && el.note.hidden && el.error.hidden && !this.querySelector(":scope > [slot=text]");
    if (empty) this.setAttribute("empty", "");
    else this.removeAttribute("empty");
  }
};

const popoverSupported = () => typeof HTMLElement !== "undefined" && Object.prototype.hasOwnProperty.call(HTMLElement.prototype, "popover");

const createInfoElement = () => class AppKeepAiInfo extends HTMLElement {
  constructor() {
    super();
    this._labels = DEFAULT_LABELS;
    this._records = undefined;
    this._loader = null;
    this._loading = null;
    this._failed = false;
    this._modelNames = null;
    this._open = false;
    this._pinned = false;
    this._hovering = 0;
    this._closeTimer = null;
    this._openTimer = null;
    const root = this.attachShadow({ mode: "open" });
    const cardId = nextId("appkeep-ai-info");
    root.innerHTML = `<style>${INFO_CSS}</style>
      <button type="button" class="button" part="button" aria-expanded="false" aria-controls="${cardId}">${ICONS.dots}</button>
      <div class="card" part="card" id="${cardId}" role="group"></div>`;
    this._button = root.querySelector(".button");
    this._card = root.querySelector(".card");
    if (popoverSupported()) this._card.setAttribute("popover", "manual");
    const headingId = `${cardId}-title`;
    this._card.setAttribute("aria-labelledby", headingId);
    this._card.innerHTML = `<p class="heading" id="${headingId}"></p><div class="body"></div>`;
    this._heading = this._card.querySelector(".heading");
    this._body = this._card.querySelector(".body");

    const hoverable = (event) => event.pointerType === "mouse" || event.pointerType === "pen";
    const enter = (event) => {
      if (!hoverable(event)) return;
      this._hovering++;
      clearTimeout(this._closeTimer);
      if (!this._open) { clearTimeout(this._openTimer); this._openTimer = setTimeout(() => this.show(), 120); }
    };
    const leave = (event) => {
      if (!hoverable(event)) return;
      this._hovering = Math.max(0, this._hovering - 1);
      clearTimeout(this._openTimer);
      this._scheduleClose();
    };
    for (const node of [this._button, this._card]) {
      node.addEventListener("pointerenter", enter);
      node.addEventListener("pointerleave", leave);
    }
    // A tap or click pins the card open (and closes it again); hover alone never pins.
    this._button.addEventListener("click", () => {
      clearTimeout(this._openTimer);
      if (this._open && this._pinned) { this.hide(); return; }
      this._pinned = true;
      this.show();
    });
    this._button.addEventListener("focus", () => {
      let keyboard = true;
      try { keyboard = this._button.matches(":focus-visible"); } catch { /* older engines: treat focus as keyboard focus */ }
      if (keyboard) this.show();
    });
    // Leaving with the keyboard closes the card even when it was pinned; the pointer still over it keeps it.
    this._button.addEventListener("blur", () => this._scheduleClose(true));
    this._onKey = (event) => {
      if (event.key !== "Escape" || !this._open) return;
      event.stopPropagation();
      this.hide();
      this._button.focus({ preventScroll: true });
    };
    this._onOutside = (event) => {
      if (!this._open) return;
      const path = typeof event.composedPath === "function" ? event.composedPath() : [];
      if (path.includes(this) || path.includes(this._card)) return;
      this.hide();
    };
    this._onMove = () => { if (this._open) this._place(); };
    this._applyLabels();
  }

  disconnectedCallback() { this.hide(); }

  get labels() { return this._labels; }
  set labels(value) { this._labels = { ...DEFAULT_LABELS, ...(value || {}) }; this._applyLabels(); if (this._open) this._renderCard(); }
  /** One usage record or a list of them (several model calls can make one message). */
  get records() { return this._records; }
  set records(value) { this._records = value == null ? undefined : asList(value); this._failed = false; if (this._open) this._renderCard(); }
  /** Alias of records, for apps that call it usage. */
  get usage() { return this._records; }
  set usage(value) { this.records = value; }
  /** async () => record | records. Called the first time the card opens; refresh() calls it again. */
  get loader() { return this._loader; }
  set loader(fn) { this._loader = typeof fn === "function" ? fn : null; this._records = undefined; this._failed = false; }
  /** { [modelId]: displayName } or (modelId) => displayName. */
  get modelNames() { return this._modelNames; }
  set modelNames(value) { this._modelNames = value || null; if (this._open) this._renderCard(); }
  get open() { return this._open; }

  refresh() {
    if (!this._loader) return;
    this._records = undefined;
    this._failed = false;
    if (this._open) void this._load();
  }

  show() {
    clearTimeout(this._closeTimer);
    if (!this._open) {
      this._open = true;
      this._button.setAttribute("aria-expanded", "true");
      this._card.classList.add("open");
      if (this._card.hasAttribute("popover")) { try { this._card.showPopover(); } catch { /* already open */ } }
      document.addEventListener("keydown", this._onKey, true);
      document.addEventListener("pointerdown", this._onOutside, true);
      window.addEventListener("scroll", this._onMove, true);
      window.addEventListener("resize", this._onMove);
    }
    const running = summarizeUsage(this._records).running;
    if ((this._records === undefined || running) && this._loader && !this._loading) void this._load();
    this._renderCard();
    this._place();
  }

  hide() {
    clearTimeout(this._closeTimer);
    clearTimeout(this._openTimer);
    this._pinned = false;
    if (!this._open) return;
    this._open = false;
    this._button.setAttribute("aria-expanded", "false");
    this._card.classList.remove("open");
    if (this._card.hasAttribute("popover")) { try { this._card.hidePopover(); } catch { /* already closed */ } }
    document.removeEventListener("keydown", this._onKey, true);
    document.removeEventListener("pointerdown", this._onOutside, true);
    window.removeEventListener("scroll", this._onMove, true);
    window.removeEventListener("resize", this._onMove);
  }

  _scheduleClose(evenIfPinned = false) {
    clearTimeout(this._closeTimer);
    this._closeTimer = setTimeout(() => {
      const focused = this.shadowRoot.activeElement === this._button;
      if ((evenIfPinned || !this._pinned) && !this._hovering && !focused) this.hide();
    }, 160);
  }

  async _load() {
    const loader = this._loader;
    this._loading = Promise.resolve().then(() => loader());
    try {
      const result = await this._loading;
      if (loader !== this._loader) return;
      this._records = asList(result);
      this._failed = false;
    } catch {
      if (loader !== this._loader) return;
      this._failed = true;
    } finally {
      this._loading = null;
      if (this._open) { this._renderCard(); this._place(); }
    }
  }

  _applyLabels() {
    this._button.setAttribute("aria-label", this._labels.button);
    this._heading.textContent = this._labels.title;
  }

  _modelName(id) {
    const names = this._modelNames;
    if (typeof names === "function") return names(id) || id;
    return (names && names[id]) || id;
  }

  _renderCard() {
    const labels = this._labels;
    const locale = this.getAttribute("locale") || this.closest?.("[lang]")?.getAttribute("lang") || undefined;
    this._heading.textContent = labels.title;
    const body = this._body;
    body.textContent = "";
    const status = (text) => {
      const p = document.createElement("p");
      p.className = "status";
      p.textContent = text;
      body.append(p);
    };
    if (this._records === undefined && this._loading) { status(labels.loading); return; }
    const summary = summarizeUsage(this._records);
    const rows = usageRows(summary, { labels, locale, modelName: (id) => this._modelName(id) });
    if (this._failed || !rows.length) { status(labels.unavailable); return; }
    const list = document.createElement("dl");
    for (const [term, value] of rows) {
      const dt = document.createElement("dt");
      dt.textContent = term;
      const dd = document.createElement("dd");
      dd.textContent = value;
      list.append(dt, dd);
    }
    body.append(list);
    if (summary.running) status(labels.running);
  }

  _place() {
    if (!this._open || typeof this._button.getBoundingClientRect !== "function") return;
    const anchor = this._button.getBoundingClientRect();
    const card = this._card.getBoundingClientRect();
    const width = card.width || 240;
    const height = card.height || 120;
    const viewWidth = document.documentElement.clientWidth || window.innerWidth || 0;
    const viewHeight = window.innerHeight || document.documentElement.clientHeight || 0;
    const gap = 6;
    const margin = 8;
    let left = anchor.left;
    if (left + width > viewWidth - margin) left = anchor.right - width;
    left = Math.max(margin, Math.min(left, viewWidth - width - margin));
    let top = anchor.bottom + gap;
    if (top + height > viewHeight - margin && anchor.top - gap - height >= margin) top = anchor.top - gap - height;
    this._card.style.left = `${Math.round(left)}px`;
    this._card.style.top = `${Math.round(top)}px`;
  }
};

defineAiUi();
