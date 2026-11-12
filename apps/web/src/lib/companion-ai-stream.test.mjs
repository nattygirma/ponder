import { afterEach, describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { parseHTML } from "linkedom";
import { companionSavedToolEvents, companionToolEvents, createCompanionAiStreams } from "./companion-ai-stream.ts";
import { createMessageState, defineAiUi, reduceMessage } from "../vendor/appkeep-ai-ui/ai-ui.js";

// The AI sidebar's live stream view: chat events become @appkeep/ai-ui events, kept per turn for the page.

const tool = (id, status, extra = {}) => ({ id, name: "create_memo", status, ...extra });
const replay = (events) => events.reduce(reduceMessage, createMessageState());

describe("companion stream store", () => {
  test("a turn's thinking, tool steps and text become stream view events with times", () => {
    let now = 1_000;
    const streams = createCompanionAiStreams(() => now);
    expect(streams.has("t1")).toBe(false);
    streams.apply("t1", { type: "text-delta", text: "ignored before begin" });
    expect(streams.events("t1")).toEqual([]);

    streams.begin("t1");
    now = 2_000;
    streams.apply("t1", { type: "thinking", text: "Reading the note." });
    now = 4_000;
    streams.apply("t1", { type: "tools", tools: [tool("a", "running")], todos: [] });
    streams.apply("t1", { type: "tools", tools: [tool("a", "running")], todos: [] });
    streams.apply("t1", { type: "tools", tools: [tool("a", "done", { effects: [{ title: "Q4 plan" }, { title: "Q4 plan" }] })], todos: [] });
    streams.apply("t1", { type: "text-delta", text: "Done." });
    streams.apply("t1", { type: "done", turn: { status: "completed" } });
    streams.apply("t1", { type: "text-delta", text: "after the end" });

    const events = streams.events("t1");
    expect(events.map((event) => event.type)).toEqual(["start", "thinking", "tool-start", "tool-run", "tool-end", "text", "finish"]);
    expect(events[0].at).toBe(1_000);
    const state = replay(events);
    expect(state.thinking.text).toBe("Reading the note.");
    expect(state.thinking.endedAt - state.startedAt).toBe(3_000);
    expect(state.tools.map((item) => [item.name, item.status, item.summary])).toEqual([["create_memo", "done", "Q4 plan"]]);
    expect(state.done).toBe(true);
  });

  test("listeners follow a turn, restart on resume with its earlier steps, and old turns are dropped", () => {
    const streams = createCompanionAiStreams(() => 0);
    streams.begin("t1");
    const seen = [];
    const stop = streams.subscribe("t1", (event) => seen.push(event ? event.type : "reset"));
    streams.apply("t1", { type: "error", code: "x" });
    streams.end("t1");
    expect(seen).toEqual(["finish"]);

    streams.begin("t1", [tool("a", "done"), tool("b", "error", { error: "Note is locked" })]);
    expect(seen.slice(1)).toEqual(["reset", "start", "tool-start", "tool-run", "tool-end", "tool-start", "tool-run", "tool-end"]);
    const failed = replay(streams.events("t1")).tools.find((item) => item.id === "b");
    expect(failed).toMatchObject({ status: "failed", summary: "Note is locked" });
    // A step that was already done doesn't start again when the resumed run reports it.
    streams.apply("t1", { type: "tools", tools: [tool("a", "done"), tool("c", "running")], todos: [] });
    expect(seen.slice(-2)).toEqual(["tool-start", "tool-run"]);
    stop();
    streams.end("t1");
    expect(seen.at(-1)).toBe("tool-run");
    expect(streams.subscribe("missing", () => {})).toBeTypeOf("function");

    streams.subscribe("t1", () => {});
    for (let i = 0; i < 60; i += 1) streams.begin(`turn-${i}`);
    expect(streams.has("turn-0")).toBe(false);
    expect(streams.has("turn-59")).toBe(true);
    // A turn someone is watching is kept.
    expect(streams.has("t1")).toBe(true);
  });

  test("saved turns show their tool steps; changes only when a status does", () => {
    expect(companionToolEvents(tool("a", "running"), "running")).toEqual([]);
    expect(companionToolEvents(tool("a", "done"), "running").map((event) => event.type)).toEqual(["tool-end"]);
    const many = tool("a", "done", { effects: [{ title: "One" }, { title: "Two" }, { title: "Three" }, { title: " " }] });
    expect(companionToolEvents(many).at(-1).summary).toBe("One, Two +1");
    const state = replay(companionSavedToolEvents([tool("a", "done"), tool("b", "running")]));
    expect(state.tools.map((item) => item.status)).toEqual(["done", "running"]);
  });
});

describe("stream view element", () => {
  const originals = new Map(["window", "document", "customElements", "HTMLElement", "Node"].map((key) => [key, Object.getOwnPropertyDescriptor(globalThis, key)]));
  afterEach(() => {
    for (const [key, descriptor] of originals) {
      if (descriptor) Object.defineProperty(globalThis, key, descriptor);
      else delete globalThis[key];
    }
  });

  test("draws the live thinking section and tool steps from the store", () => {
    const { window, document, customElements, HTMLElement, Node } = parseHTML("<!doctype html><html><body></body></html>");
    Object.assign(globalThis, { window, document, customElements, HTMLElement, Node });
    defineAiUi(customElements);
    const streams = createCompanionAiStreams(() => 0);
    streams.begin("t1");
    const thinking = document.createElement("appkeep-ai-message");
    thinking.setAttribute("sections", "thinking");
    const tools = document.createElement("appkeep-ai-message");
    tools.setAttribute("sections", "tools");
    document.body.append(thinking, tools);
    tools.toolLabel = (name) => (name === "create_memo" ? "Create note" : name);
    for (const element of [thinking, tools]) {
      element.pushAll(streams.events("t1"));
      streams.subscribe("t1", (event) => (event ? element.push(event) : element.reset()));
    }
    streams.apply("t1", { type: "thinking", text: "Checking the roadmap." });
    streams.apply("t1", { type: "tools", tools: [tool("a", "done", { effects: [{ title: "Q4 plan" }] })], todos: [] });
    thinking._render?.();
    tools._render?.();
    expect(thinking.state.thinking.text).toBe("Checking the roadmap.");
    expect(tools.state.tools[0]).toMatchObject({ status: "done", summary: "Q4 plan" });
    const toolText = tools.shadowRoot?.innerHTML ?? "";
    expect(toolText).toContain("Create note");
    expect(toolText).toContain("Q4 plan");
    expect(thinking.shadowRoot?.innerHTML ?? "").not.toContain("Create note");
    expect(thinking.shadowRoot?.innerHTML ?? "").toContain("Checking the roadmap.");
  });

  test("the sidebar wires the store into its stream and the vendored copy names its source", () => {
    const sidebar = readFileSync(new URL("../components/ai-sidebar/AiSidebar.tsx", import.meta.url), "utf8");
    expect(sidebar).toContain("companionAiStreams.apply(id, event);");
    expect(sidebar).toContain("companionAiStreams.begin(id);");
    expect(sidebar).toContain("companionAiStreams.begin(turn.id, turn.tools ?? []);");
    expect(sidebar).toContain('<CompanionStreamView turn={turn} sections="thinking" />');
    expect(sidebar).toContain('<CompanionStreamView turn={turn} sections="tools" />');
    expect(sidebar).toContain("<CompanionMessageInfo turn={turn} />");
    const vendored = readFileSync(new URL("../vendor/appkeep-ai-ui/ai-ui.js", import.meta.url), "utf8");
    expect(vendored.split("\n")[0]).toContain("Vendored copy of AppKeep's @appkeep/ai-ui");
    const notice = readFileSync(new URL("../../../../NOTICE.md", import.meta.url), "utf8");
    expect(notice).toContain("apps/web/src/vendor/appkeep-ai-ui/");
  });
});
