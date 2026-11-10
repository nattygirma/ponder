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
