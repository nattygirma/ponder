import { describe, expect, test } from "bun:test";
import { Editor } from "@tiptap/core";
import { createPonderDocumentExtensions, markdownToDoc } from "@ponder/shared";
import { createPonderMathematics } from "@ponder/shared/mathematics";
import { ensureTestWindowDom } from "../../lib/restore-test-global.mjs";
import { docToEditableMarkdown } from "./editor-mode-content.ts";
import { markdownOffsetToRichPosition, richPositionToMarkdownOffset } from "./editor-mode-selection.ts";

const createEditor = (source) => {
  ensureTestWindowDom();
  return new Editor({
    extensions: createPonderDocumentExtensions({ mathematics: createPonderMathematics() }),
    content: markdownToDoc(source),
  });
};

describe("Markdown mode cursor mapping", () => {
  test("keeps the caret after ordinary punctuation when entering source mode", () => {
    const editor = createEditor("Alpha [ ] & Bravo");
    const source = docToEditableMarkdown(editor.getJSON());
    const richPosition = 1 + "Alpha [ ] &".length;
    const sourceOffset = richPositionToMarkdownOffset(editor.state.doc, source, richPosition);

    expect(source).toBe("Alpha [ ] & Bravo");
    expect(sourceOffset).toBe("Alpha [ ] &".length);
    expect(markdownOffsetToRichPosition(editor.schema, editor.state.doc, source, sourceOffset)).toBe(richPosition);
    editor.destroy();
  });

  test("accounts for Markdown marks around a caret in formatted prose", () => {
    const editor = createEditor("Before **bold** after");
    const source = docToEditableMarkdown(editor.getJSON());
    const richPosition = 1 + "Before bold".length;
    const sourceOffset = richPositionToMarkdownOffset(editor.state.doc, source, richPosition);

    expect(sourceOffset).toBe(source.indexOf("** after"));
    expect(markdownOffsetToRichPosition(editor.schema, editor.state.doc, source, sourceOffset)).toBe(richPosition);
    editor.destroy();
  });

  test("keeps UTF-16 positions after Chinese text and emoji", () => {
    const editor = createEditor("繁體中文🙂 [ ] & 後文");
    const source = docToEditableMarkdown(editor.getJSON());
    const prefix = "繁體中文🙂 [ ] &";
    const richPosition = 1 + prefix.length;
    const sourceOffset = richPositionToMarkdownOffset(editor.state.doc, source, richPosition);

    expect(sourceOffset).toBe(prefix.length);
    expect(markdownOffsetToRichPosition(editor.schema, editor.state.doc, source, sourceOffset)).toBe(richPosition);
    editor.destroy();
  });

  test("declines unsafe positions inside Markdown syntax", () => {
    const editor = createEditor("[Ponder](https://appkeep.io)");
    const source = docToEditableMarkdown(editor.getJSON());

    expect(markdownOffsetToRichPosition(editor.schema, editor.state.doc, source, source.indexOf("https") + 2)).toBeNull();
    editor.destroy();
  });
});
