import { describe, expect, test } from "bun:test";
import {
  buildDesktopDiagnosticIssueUrl,
  normalizeDesktopDiagnostic,
  sanitizeDesktopDiagnosticText,
} from "./desktop-diagnostics.mjs";

describe("desktop crash diagnostics", () => {
  test("redacts URLs, credentials, and home directory names", () => {
    const sanitized = sanitizeDesktopDiagnosticText(
      'https://notes.example.com/api Bearer private-token /Users/alice/note "token":"secret-value"',
    );
    expect(sanitized).not.toContain("notes.example.com");
    expect(sanitized).not.toContain("private-token");
    expect(sanitized).not.toContain("alice");
    expect(sanitized).not.toContain("secret-value");
    expect(sanitized).toContain("[redacted-url]");
  });

  test("retains packaged asset locations without exposing the installation path", () => {
    expect(sanitizeDesktopDiagnosticText(
      "at render (file:///Applications/Ponder.app/Contents/Resources/web/assets/index-a1b2.js:42:7)",
    )).toBe("at render (file:///[app]/assets/index-a1b2.js:42:7)");
  });

  test("normalizes renderer supplied data to the diagnostic allowlist", () => {
    expect(normalizeDesktopDiagnostic({ kind: "react-error", message: "boom", private: "note" })).toEqual({
      kind: "react-error",
      message: "boom",
      stack: "",
      componentStack: "",
      reason: "",
      exitCode: null,
    });
    expect(normalizeDesktopDiagnostic(null)).toMatchObject({ kind: "unknown", message: "" });
  });

  test("sends crash reports to the AppKeep site without putting diagnostics in the link", () => {
    expect(buildDesktopDiagnosticIssueUrl()).toBe("https://appkeep.io");
  });
});
