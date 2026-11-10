import { afterEach, describe, expect, test } from "bun:test";
import { defaultLocale, getBrowserLocale, getInitialLocale, normalizeLocale } from "./locales.ts";

const originalNavigator = globalThis.navigator;
const originalWindow = globalThis.window;

const setNavigatorLanguages = (languages, language = languages[0]) => {
  Object.defineProperty(globalThis, "navigator", {
    configurable: true,
    value: { languages, language },
  });
};

afterEach(() => {
  if (originalNavigator === undefined) {
    delete globalThis.navigator;
  } else {
    Object.defineProperty(globalThis, "navigator", {
      configurable: true,
      value: originalNavigator,
    });
  }
  if (originalWindow === undefined) {
    delete globalThis.window;
  } else {
    globalThis.window = originalWindow;
  }
});

describe("web locale resolution", () => {
  test("resolves English and unsupported Chinese browser languages to English", () => {
    setNavigatorLanguages(["zh-TW", "en-US"]);
    expect(getBrowserLocale()).toBe("en-US");
    setNavigatorLanguages(["en-GB"]);
    expect(getBrowserLocale()).toBe("en-US");
    expect(normalizeLocale("zh-Hans")).toBeNull();
  });

  test("keeps Japanese browser languages on the shipped ja locale", () => {
    setNavigatorLanguages(["ja-JP", "ja"]);
    expect(getBrowserLocale()).toBe("ja");
  });

  test("keeps Polish browser languages on the shipped pl locale", () => {
    setNavigatorLanguages(["pl-PL", "en-US"]);
    expect(getBrowserLocale()).toBe("pl");
  });

  test("keeps Russian browser languages on the shipped ru locale", () => {
    setNavigatorLanguages(["ru-RU", "en-US"]);
    expect(getBrowserLocale()).toBe("ru");
  });

  test("falls unmatched browser languages back to English", () => {
    setNavigatorLanguages(["fr-FR", "de-DE"]);
    expect(getBrowserLocale()).toBe("en-US");
    setNavigatorLanguages(["ko-KR"]);
    expect(getInitialLocale()).toBe("en-US");
    expect(defaultLocale).toBe("en-US");
  });

  test("uses the first supported language in the browser preference list", () => {
    setNavigatorLanguages(["ja-JP", "zh-CN"]);
    expect(getBrowserLocale()).toBe("ja");
    setNavigatorLanguages(["fr-FR", "zh-CN"]);
    expect(getBrowserLocale()).toBe("en-US");
  });
});
