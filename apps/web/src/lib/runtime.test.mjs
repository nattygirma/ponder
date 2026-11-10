import { afterEach, describe, expect, test } from "bun:test";
import { isNativeDesktopRuntime } from "./runtime.ts";

const originalWindow = Object.getOwnPropertyDescriptor(globalThis, "window");

afterEach(() => {
  if (originalWindow) {
    Object.defineProperty(globalThis, "window", originalWindow);
  } else {
    delete globalThis.window;
  }
});

describe("native desktop runtime detection", () => {
  test("detects the native desktop bridge", () => {
    globalThis.window = {
      ponderDesktop: { isAvailable: true },
    };

    expect(isNativeDesktopRuntime()).toBe(true);
  });

  test("does not expose desktop-only features in a browser", () => {
    globalThis.window = {};

    expect(isNativeDesktopRuntime()).toBe(false);
  });

  test("does not rely on an Electron user agent without the native bridge", () => {
    globalThis.window = {
      navigator: { userAgent: "Mozilla/5.0 Electron/39.0.0" },
    };

    expect(isNativeDesktopRuntime()).toBe(false);
  });

  test("returns false during server-side rendering", () => {
    delete globalThis.window;

    expect(isNativeDesktopRuntime()).toBe(false);
  });
});
