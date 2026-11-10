import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";

const globals = readFileSync(new URL("./globals.css", import.meta.url), "utf8");

const mobile = readFileSync(new URL("./mobile-markdown-editor.css", import.meta.url), "utf8");

describe("Mermaid editor layout", () => {
  test("uses the note column and scrolls wide diagrams at their drawn size", () => {
    expect(globals).not.toContain("max-width: min(60vw, 52rem)");
    expect(globals).toMatch(
      /\.ProseMirror \.ponder-mermaid-preview\s*{[^}]*max-height: min\(70vh, 44rem\);[^}]*overflow: auto;/s,
    );
    expect(globals).toMatch(
      /\.ProseMirror \.ponder-mermaid-svg svg\s*{[^}]*width: var\(--mermaid-display-width, auto\);[^}]*max-width: none;[^}]*max-height: none;/s,
    );
    expect(globals).toMatch(
      /\.ProseMirror \.ponder-mermaid-svg text\s*{[^}]*font-family: var\(--editor-body-font-family, var\(--ponder-system-font-family\)\);[^}]*font-synthesis: weight;/s,
    );
    expect(globals).toContain('.ProseMirror .ponder-mermaid-svg text[font-weight="500"]');
    expect(globals).toContain("font-weight: 550;");
  });

  test("keeps the phone editor on the same readable diagram size", () => {
    expect(mobile).toMatch(
      /\.ponder-mobile-tiptap-content \.ponder-mermaid-svg svg\s*{[^}]*max-width: none;[^}]*max-height: none;/s,
    );
    expect(mobile).toContain("font-weight: 550;");
    expect(mobile).not.toContain("max-height: 440px");
  });
});
