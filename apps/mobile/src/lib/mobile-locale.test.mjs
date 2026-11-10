import { describe, expect, test } from "bun:test";
import { formatMobileCopy, getMobileCatalog, localizeMissingNotebookName, localizeUntitledMemoTitle, toMobileSyncErrorSourceText, translateMobileText } from "./mobile-locale.tsx";

describe("mobile locale translation", () => {
  test("translates mobile-only static copy", () => {
    expect(translateMobileText("Syncing your notes", "en-US")).toBe("Syncing your notes");
    expect(translateMobileText("Choose from library", "en-US")).toBe("Choose from library");
    expect(translateMobileText("Syncing your notes", "ja")).toBe("ノートを同期しています");
    expect(translateMobileText("Choose from library", "ja")).toBe("ライブラリから選ぶ");
    expect(translateMobileText("Syncing your notes", "pl")).toBe("Synchronizowanie notatek");
    expect(translateMobileText("Choose from library", "pl")).toBe("Wybierz z galerii");
  });

  test("uses shared translations for the descendant preference", () => {
    expect(translateMobileText("Show notes from sub-notebooks", "en-US")).toBe("Show notes from sub-notebooks");
    expect(translateMobileText("Show notes from sub-notebooks", "ja")).toBe("サブノートブックのノートを表示");
    expect(translateMobileText("Show notes from sub-notebooks in parent notebooks", "en-US")).toBe("Show notes from sub-notebooks in parent notebooks");
  });

  test("reads native copy from the shared catalog for every locale", () => {
    expect(getMobileCatalog("pl").mobile.update.title).toBe("Aktualizacje aplikacji");
    expect(getMobileCatalog("ja").mobile.update.title).toBe("アプリのアップデート");
    expect(getMobileCatalog("en-US").mobile.update.title).toBe("App updates");
    expect(formatMobileCopy(getMobileCatalog("pl").mobile.login.serverError, { status: 503 }))
      .toBe("Instancja zwróciła błąd serwera (HTTP 503).");
    expect(formatMobileCopy("{{known}} {{missing}}", { known: "a" })).toBe("a {{missing}}");
  });

});
