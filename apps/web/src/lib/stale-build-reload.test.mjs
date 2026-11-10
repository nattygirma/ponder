import { describe, expect, test } from "bun:test";
import { installStaleBuildReload } from "./stale-build-reload";

const fakeWindow = (storage = new Map()) => {
  const listeners = [];
  const win = {
    reloads: 0,
    addEventListener: (type, listener) => listeners.push({ type, listener }),
    sessionStorage: {
      getItem: (key) => storage.get(key) ?? null,
      setItem: (key, value) => storage.set(key, String(value)),
    },
    location: { reload: () => { win.reloads += 1; } },
    fire: () => {
      const event = { defaultPrevented: false, preventDefault() { this.defaultPrevented = true; } };
      for (const { type, listener } of listeners) if (type === "vite:preloadError") listener(event);
      return event;
    },
  };
  return win;
};

describe("stale build reload", () => {
  test("reloads once when a chunk from an old build fails to load", () => {
    let clock = 1_000_000;
    const win = fakeWindow();
    installStaleBuildReload(win, () => clock);
    expect(win.fire().defaultPrevented).toBe(true);
    expect(win.reloads).toBe(1);
  });

  test("doesn't loop when the chunk is still missing after the reload", () => {
    let clock = 1_000_000;
    const storage = new Map();
    const first = fakeWindow(storage);
    installStaleBuildReload(first, () => clock);
    first.fire();
    clock += 5_000;
    const afterReload = fakeWindow(storage);
    installStaleBuildReload(afterReload, () => clock);
    expect(afterReload.fire().defaultPrevented).toBe(false);
    expect(afterReload.reloads).toBe(0);
    clock += 60_000;
    afterReload.fire();
    expect(afterReload.reloads).toBe(1);
  });

  test("leaves the error alone when session storage is blocked", () => {
    const win = fakeWindow();
    win.sessionStorage.getItem = () => { throw new Error("blocked"); };
    installStaleBuildReload(win);
    expect(win.fire().defaultPrevented).toBe(false);
    expect(win.reloads).toBe(0);
  });
});
