import type { CompanionEvent, CompanionToolCall } from "@ponder/shared";
import type { AiUiEvent } from "@/vendor/appkeep-ai-ui/ai-ui";

// The live stream of each chat turn this session ran, as @appkeep/ai-ui events, so the stream view can follow
// it without re-rendering the whole chat on every piece of thinking. Kept in memory only (thinking summaries
// aren't saved with the turn), and for the whole page, like the replies that keep running in the background
// while the sidebar is closed.

/** Gets each new event, or null when the turn starts a new run and the view should start over. */
type Listener = (event: AiUiEvent | null) => void;
type Log = { events: AiUiEvent[]; listeners: Set<Listener>; tools: Map<string, CompanionToolCall["status"]>; ended: boolean };

const MAX_EVENTS = 4_000;
const MAX_TURNS = 50;

/** What a finished tool step touched (the notes' titles), or its error. */
const toolSummary = (tool: CompanionToolCall) => {
  if (tool.status === "error") return tool.error ?? "";
  const titles = [...new Set((tool.effects ?? []).map((effect) => effect.title?.trim()).filter((title): title is string => !!title))];
  return titles.length > 2 ? `${titles.slice(0, 2).join(", ")} +${titles.length - 2}` : titles.join(", ");
};

/** Stream view events for a tool step's change of status. */
export const companionToolEvents = (tool: CompanionToolCall, before?: CompanionToolCall["status"]): AiUiEvent[] => {
  if (before === tool.status) return [];
  const events: AiUiEvent[] = [];
  if (!before) events.push({ type: "tool-start", id: tool.id, name: tool.name }, { type: "tool-run", id: tool.id });
  if (tool.status !== "running") events.push({ type: "tool-end", id: tool.id, status: tool.status === "done" ? "done" : "failed", summary: toolSummary(tool) });
  return events;
};

/** A saved turn's tool steps, for turns this page didn't stream itself. */
export const companionSavedToolEvents = (tools: readonly CompanionToolCall[]) => tools.flatMap((tool) => companionToolEvents(tool));

export type CompanionAiStreams = ReturnType<typeof createCompanionAiStreams>;

export const createCompanionAiStreams = (now: () => number = Date.now) => {
  const logs = new Map<string, Log>();
  const push = (id: string, event: AiUiEvent) => {
    const log = logs.get(id);
    if (!log || log.ended) return;
    const stamped = { ...event, at: event.at ?? now() } as AiUiEvent;
    if (log.events.length < MAX_EVENTS) log.events.push(stamped);
    if (stamped.type === "finish" || stamped.type === "error") log.ended = true;
    for (const listener of log.listeners) listener(stamped);
  };
  return {
    /** A turn started (or resumed, with the tools it already ran): the thinking timer starts now. */
    begin(id: string, earlierTools: readonly CompanionToolCall[] = []) {
      const listeners = logs.get(id)?.listeners ?? new Set<Listener>();
      logs.delete(id);
      logs.set(id, { events: [], listeners, tools: new Map(earlierTools.map((tool) => [tool.id, tool.status])), ended: false });
      // Oldest first, skipping turns a view is showing.
      for (const [key, log] of logs) {
        if (logs.size <= MAX_TURNS) break;
        if (!log.listeners.size) logs.delete(key);
      }
      // A view already showing this turn (a resumed one) starts over with the new run, keeping earlier steps.
      for (const listener of listeners) listener(null);
      push(id, { type: "start" });
      for (const tool of earlierTools) for (const event of companionToolEvents(tool)) push(id, event);
    },
    has: (id: string) => logs.has(id),
    events: (id: string): readonly AiUiEvent[] => logs.get(id)?.events ?? [],
    subscribe(id: string, listener: Listener) {
      const log = logs.get(id);
      if (!log) return () => {};
      log.listeners.add(listener);
      return () => { logs.get(id)?.listeners.delete(listener); };
    },
    /** Turns a chat event into stream view events. Text isn't drawn by the view, but it ends the thinking timer. */
    apply(id: string, event: CompanionEvent) {
      const log = logs.get(id);
      if (!log) return;
      if (event.type === "thinking") push(id, { type: "thinking", text: event.text });
      else if (event.type === "text-delta") push(id, { type: "text", text: event.text });
      else if (event.type === "tools") {
        for (const tool of event.tools) {
          for (const next of companionToolEvents(tool, log.tools.get(tool.id))) push(id, next);
          log.tools.set(tool.id, tool.status);
        }
      } else if (event.type === "done") push(id, { type: "finish", reason: event.turn.status });
      // Ponder shows its own error message; the stream view only stops its timer.
      else if (event.type === "error") push(id, { type: "finish", reason: "error" });
    },
    /** The run ended without a done event (stopped, network loss). */
    end(id: string, reason = "stopped") { push(id, { type: "finish", reason }); },
  };
};

/** One store for the page, so a reply still running when the sidebar closes shows its thinking when it reopens. */
export const companionAiStreams = createCompanionAiStreams();
