// Vendored copy of AppKeep's @appkeep/ai-ui 0.1.0 (MIT licence), the web components AppKeep offers its apps.
// To update, replace this file with the package's ai-ui.js / ai-ui.d.ts and keep this header; don't edit it here.
// Types for @appkeep/ai-ui (ai-ui.js).

export type AiToolStatus = "started" | "running" | "done" | "failed";

/** One usage record, as AppKeep's ai.usage(id) returns it. Every field is optional so partial numbers work too. */
export type AiUsageRecord = {
  id?: string;
  model?: string | null;
  provider?: string | null;
  paid_with?: "credits" | "key" | null;
  result?: string | null;
  stop_reason?: string | null;
  usage?: {
    input_tokens?: number;
    cache_read_tokens?: number;
    cache_write_tokens?: number;
    output_tokens?: number;
    thinking_tokens?: number;
  };
  /** Micro-dollars. */
  price_micros?: number | null;
  estimated?: boolean;
  started_at?: string;
  first_token_ms?: number | null;
  duration_ms?: number | null;
};

/** Events for AppKeepAiMessageElement.push. `at` (ms since the epoch) replays an event at its original time. */
export type AiUiEvent = { at?: number } & (
  | { type: "start" }
  | { type: "text"; text: string }
  | { type: "thinking"; text: string }
  | { type: "tool-start"; id: string; name: string; input?: string }
  | { type: "tool-input"; id: string; delta: string }
  | { type: "tool-run"; id: string }
  | { type: "tool-end"; id: string; status: "done" | "failed"; summary?: string; name?: string }
  | { type: "tool-status"; id: string; status: AiToolStatus; summary?: string }
  | ({ type: "usage" } & AiUsageRecord)
  | { type: "finish"; reason: string | null }
  | { type: "error"; message: string }
);

export type AiTool = { id: string; name: string; input: string; status: AiToolStatus; summary: string };

export type AiMessageState = {
  startedAt: number | null;
  text: string;
  thinking: { text: string; endedAt: number | null; gap: boolean };
  tools: AiTool[];
  usage: AiUsageRecord[];
  finish: { reason: string | null; cutOff: boolean } | null;
  error: string | null;
  done: boolean;
};

export type AiUiLabels = typeof DEFAULT_LABELS;

export declare const DEFAULT_LABELS: Readonly<{
  thinking: string; thoughtFor: string; thinkingStatus: string; thoughtStatus: string; seconds: string; minutes: string;
  toolStarted: string; toolRunning: string; toolDone: string; toolFailed: string; cutOff: string;
  button: string; title: string; model: string; input: string; output: string; calls: string; price: string; paidWith: string;
  cached: string; thinkingTokens: string; credits: string; key: string; mixed: string; about: string; tokens: string;
  loading: string; unavailable: string; running: string;
}>;

export declare function createMessageState(at?: number | null): AiMessageState;
export declare function reduceMessage(state: AiMessageState, event: AiUiEvent, at?: number): AiMessageState;
export declare function thinkingDuration(state: AiMessageState, at?: number): number;
export declare function formatDuration(ms: number, labels?: Partial<AiUiLabels>): string;

export type AiStreamAdapter = (event: unknown) => AiUiEvent[];
export declare function createClaudeAdapter(): AiStreamAdapter;
export declare function createOpenAIChatAdapter(): AiStreamAdapter;
export declare function createOpenAIResponsesAdapter(): AiStreamAdapter;
export declare function createSSEParser(onEvent: (event: { event: string; data: string }) => void): { push(chunk: string): void; end(): void };

export type AiUsageSummary = {
  calls: number;
  models: string[];
  input: number | null;
  cached: number | null;
  output: number | null;
  thinking: number | null;
  priceMicros: number | null;
  estimated: boolean;
  paidWith: "credits" | "key" | "mixed" | null;
  running: boolean;
};
export declare function summarizeUsage(records: AiUsageRecord | AiUsageRecord[] | null | undefined): AiUsageSummary;
export declare function formatTokens(count: number, locale?: string): string;
export declare function formatPrice(micros: number, locale?: string): string;
export declare function usageRows(
  summary: AiUsageSummary,
  options?: { labels?: AiUiLabels; locale?: string; modelName?: (id: string) => string },
): [string, string][];
export declare function defineAiUi(registry?: CustomElementRegistry): boolean;

export interface AppKeepAiMessageElement extends HTMLElement {
  readonly state: AiMessageState;
  labels: Partial<AiUiLabels>;
  toolLabel: ((name: string, tool: AiTool) => string) | null;
  renderText: ((text: string, container: HTMLElement) => void) | null;
  start(at?: number): void;
  push(event: AiUiEvent): void;
  pushAll(events: Iterable<AiUiEvent>): void;
  reset(): void;
}

export interface AppKeepAiInfoElement extends HTMLElement {
  labels: Partial<AiUiLabels>;
  records: AiUsageRecord[] | undefined;
  usage: AiUsageRecord[] | undefined;
  loader: (() => Promise<AiUsageRecord | AiUsageRecord[] | null | undefined>) | null;
  modelNames: Record<string, string> | ((id: string) => string) | null;
  readonly open: boolean;
  show(): void;
  hide(): void;
  refresh(): void;
}

declare global {
  interface HTMLElementTagNameMap {
    "appkeep-ai-message": AppKeepAiMessageElement;
    "appkeep-ai-info": AppKeepAiInfoElement;
  }
}
