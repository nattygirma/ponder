import { afterAll, beforeAll, describe, expect, test } from "bun:test";

const stored = new Map();
const events = [];
let sidebar;
const hadWindow = "window" in globalThis;
const previousWindow = globalThis.window;

beforeAll(async () => {
  // Other tests may have set up a window already; this one needs its own storage and events.
  globalThis.window = {
    ...previousWindow,
    localStorage: { getItem: (key) => stored.get(key) ?? null, setItem: (key, value) => stored.set(key, String(value)), removeItem: (key) => stored.delete(key) },
    dispatchEvent: (event) => { events.push(event); return true; },
  };
  sidebar = await import("./AiSidebar.tsx");
});

afterAll(() => {
  if (hadWindow) globalThis.window = previousWindow;
  else delete globalThis.window;
});

const THREAD_KEY = "ponder.invalidSidebar.thread";
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

describe("New chat", () => {
  test("starts an empty conversation instead of reopening the last one", () => {
    const last = "11111111-1111-4111-8111-111111111111";
    sidebar.openAiSidebarThread(last);
    expect(stored.get(THREAD_KEY)).toBe(last);

    sidebar.startAiSidebarChat();
    const fresh = stored.get(THREAD_KEY);
    expect(fresh).toMatch(UUID);
    expect(fresh).not.toBe(last);
    // An open panel switches to it straight away.
    expect(events.at(-1).detail).toBe(fresh);

    sidebar.startAiSidebarChat();
    expect(stored.get(THREAD_KEY)).not.toBe(fresh);
  });
});

describe("A reply while moving around the app", () => {
  test("a started built-in reply keeps running when its panel closes; one not started yet, or a local agent's, doesn't", () => {
    expect(sidebar.replyOutlivesPanel({ kind: "companion", started: true })).toBe(true);
    expect(sidebar.replyOutlivesPanel({ kind: "companion", started: false })).toBe(false);
    expect(sidebar.replyOutlivesPanel({ kind: "acp", started: true })).toBe(false);
    expect(sidebar.replyOutlivesPanel(null)).toBe(false);
  });

  test("a panel checks the server for a running reply it isn't running itself, so it never stays on Replying", () => {
    const running = [{ status: "completed" }, { status: "running" }];
    expect(sidebar.panelWatchesReply({ builtin: true, busy: false, turns: running })).toBe(true);
    // The panel running the reply gets its events directly.
    expect(sidebar.panelWatchesReply({ builtin: true, busy: true, turns: running })).toBe(false);
    expect(sidebar.panelWatchesReply({ builtin: true, busy: false, turns: [{ status: "interrupted" }] })).toBe(false);
    expect(sidebar.panelWatchesReply({ builtin: false, busy: false, turns: running })).toBe(false);
  });
});
