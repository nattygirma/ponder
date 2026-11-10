import { describe, expect, test } from "bun:test";
import { companionLocale } from "./companion-locale.ts";

describe("companion locale", () => {
  test("maps Japanese and Polish families and falls back to English", () => {
    expect(companionLocale("zh-CN")).toBe("en-US");
    expect(companionLocale("zh-TW")).toBe("en-US");
    expect(companionLocale("ja-JP")).toBe("ja");
    expect(companionLocale("pl-PL")).toBe("pl");
    expect(companionLocale("en-GB")).toBe("en-US");
    expect(companionLocale()).toBe("en-US");
    // Older servers reject "ru"; Russian messages are still answered in Russian.
    expect(companionLocale("ru-RU")).toBe("en-US");
  });
});
