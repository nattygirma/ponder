import { describe, expect, test } from "bun:test";
import { desktopMenuCopy, screenshotRegionCopy } from "./desktop-menu.mjs";

describe("desktop native menu localization", () => {
  test("falls back to English for other or missing locales", () => {
    expect(desktopMenuCopy("en-US").file).toBe("File");
    expect(desktopMenuCopy(undefined).file).toBe("File");
    expect(desktopMenuCopy("de-DE").file).toBe("File");
    expect(screenshotRegionCopy("de-DE").cancel).toBe("Esc to cancel");
  });

  test("resolves region overlay copy for every desktop locale", () => {
    expect(screenshotRegionCopy("pl-PL").cancel).toBe("Esc anuluje");
    expect(screenshotRegionCopy("ja-JP").cancel).toBe("Esc でキャンセル");
    expect(screenshotRegionCopy("RU").cancel).toBe("Esc — отмена");
    expect(screenshotRegionCopy("zh_Hant").cancel).toBe("Esc to cancel");
  });
});
