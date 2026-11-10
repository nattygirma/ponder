import { describe, expect, test } from "bun:test";
import {
  formatMarkdownLink,
  insertMarkdownSnippet,
  isAttachmentLinkHref,
  isNoteLinkHref,
  normalizeExternalLinkHref,
} from "./editor-external-link.ts";

describe("normalizeExternalLinkHref", () => {
  test("rejects empty input", () => {
    expect(normalizeExternalLinkHref("   ")).toEqual({ ok: false, reason: "empty" });
  });

  test("accepts https URLs", () => {
    expect(normalizeExternalLinkHref("https://appkeep.io")).toEqual({
      ok: true,
      href: "https://appkeep.io/",
    });
  });

  test("adds https for bare domains", () => {
    expect(normalizeExternalLinkHref("example.com/path")).toEqual({
      ok: true,
      href: "https://example.com/path",
    });
  });

  test("adds https for www hosts", () => {
    expect(normalizeExternalLinkHref("www.example.com")).toEqual({
      ok: true,
      href: "https://www.example.com/",
    });
  });

  test("accepts mailto", () => {
    const result = normalizeExternalLinkHref("mailto:hello@example.com");
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.href).toBe("mailto:hello@example.com");
    }
  });

  test("accepts protocol-relative URLs", () => {
    expect(normalizeExternalLinkHref("//cdn.example.com/a.js")).toEqual({
      ok: true,
      href: "https://cdn.example.com/a.js",
    });
  });

  test("accepts same-origin relative paths", () => {
    expect(normalizeExternalLinkHref("/share/abc")).toEqual({ ok: true, href: "/share/abc" });
  });

  test("accepts internal note and resource hrefs", () => {
    expect(normalizeExternalLinkHref("#memo=note_1")).toEqual({ ok: true, href: "#memo=note_1" });
    expect(normalizeExternalLinkHref("ponder-resource://res_1")).toEqual({
      ok: true,
      href: "ponder-resource://res_1",
    });
  });

  test("rejects javascript and data URLs", () => {
    expect(normalizeExternalLinkHref("javascript:alert(1)")).toEqual({
      ok: false,
      reason: "unsupported",
    });
    expect(normalizeExternalLinkHref("data:text/html,hi")).toEqual({
      ok: false,
      reason: "unsupported",
    });
  });

  test("rejects plain words without a scheme", () => {
    expect(normalizeExternalLinkHref("not a link")).toEqual({ ok: false, reason: "invalid" });
  });
});

describe("link href classifiers", () => {
  test("detects note and attachment hrefs", () => {
    expect(isNoteLinkHref("#memo=abc")).toBe(true);
    expect(isNoteLinkHref("https://example.com")).toBe(false);
    expect(isAttachmentLinkHref("/api/v1/resources/res_1/blob")).toBe(true);
    expect(isAttachmentLinkHref("https://example.com")).toBe(false);
  });
});

describe("markdown helpers", () => {
  test("formats a markdown link", () => {
    expect(formatMarkdownLink("Ponder", "https://appkeep.io")).toBe(
      "[Ponder](https://appkeep.io)"
    );
  });

  test("inserts a snippet at the caret", () => {
    expect(insertMarkdownSnippet("hello world", "[x](y)", 6, 11)).toEqual({
      next: "hello [x](y)",
      caret: 12,
    });
  });
});
