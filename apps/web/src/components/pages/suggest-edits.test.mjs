import { describe, expect, test } from "bun:test";
import { Editor } from "@tiptap/core";
import { splitListItem } from "@tiptap/pm/schema-list";
import { withSuggestChanges } from "@handlewithcare/prosemirror-suggest-changes";
import { createPonderDocumentExtensions, docToMarkdown, markdownToDoc } from "@ponder/shared";
import { createPonderMathematics } from "@ponder/shared/mathematics";
import { ensureTestWindowDom } from "../../lib/restore-test-global.mjs";
import {
  acceptAllSuggestions, acceptSuggestion, createSuggestEditsExtension, isSuggesting, listSuggestions, rejectAllSuggestions, rejectSuggestion, setSuggesting,
  suggestionDeletionRange,
} from "./suggest-edits.ts";
import { TextSelection } from "@tiptap/pm/state";

const paragraph = (text) => ({ type: "paragraph", content: [{ type: "text", text }] });

const createEditor = (content, author = "usr_ana") => {
  ensureTestWindowDom();
  const editor = new Editor({
    extensions: [...createPonderDocumentExtensions({ mathematics: createPonderMathematics() }), createSuggestEditsExtension(() => author)],
    content,
  });
  editor.view.updateState(editor.state.reconfigure({ plugins: editor.extensionManager.plugins }));
  return editor;
};

/** What the editor's dispatch does while Suggest edits is on (headless editors skip extension dispatch hooks). */
let counter = 0;
const suggest = (editor, makeTransaction, author = "usr_ana") => {
  const dispatch = withSuggestChanges((transaction) => editor.view.dispatch(transaction), () => `${author}:t${(counter += 1)}`);
  dispatch.call({ get state() { return editor.state; } }, makeTransaction(editor.state));
};

const textOf = (editor) => editor.state.doc.textContent.replace(/​/g, "");

describe("Suggest edits", () => {
  test("is off until turned on, and can be turned off", () => {
    const editor = createEditor({ type: "doc", content: [paragraph("Hello")] });
    expect(isSuggesting(editor)).toBe(false);
    setSuggesting(editor, true);
    expect(isSuggesting(editor)).toBe(true);
    setSuggesting(editor, false);
    expect(isSuggesting(editor)).toBe(false);
  });

  test("typing and deleting become suggestions that keep their author", () => {
    const editor = createEditor({ type: "doc", content: [paragraph("Ship on Monday")] });
    setSuggesting(editor, true);
    // Replace "Monday" (positions 9..15) with "Friday".
    suggest(editor, (state) => state.tr.insertText("Friday", 9, 15));
    const [suggestion] = listSuggestions(editor.state.doc);
    expect(suggestion).toMatchObject({ authorId: "usr_ana", added: "Friday", removed: "Monday" });
    // Both versions stay in the page until someone decides.
    expect(textOf(editor)).toContain("Monday");
    expect(textOf(editor)).toContain("Friday");
  });

  test("accepting applies a suggestion, rejecting restores the original", () => {
    const accepted = createEditor({ type: "doc", content: [paragraph("Ship on Monday")] });
    setSuggesting(accepted, true);
    suggest(accepted, (state) => state.tr.insertText("Friday", 9, 15));
    acceptSuggestion(accepted, listSuggestions(accepted.state.doc)[0].id);
    expect(textOf(accepted)).toBe("Ship on Friday");
    expect(listSuggestions(accepted.state.doc)).toEqual([]);

    const rejected = createEditor({ type: "doc", content: [paragraph("Ship on Monday")] });
    setSuggesting(rejected, true);
    suggest(rejected, (state) => state.tr.insertText("Friday", 9, 15));
    rejectSuggestion(rejected, listSuggestions(rejected.state.doc)[0].id);
    expect(textOf(rejected)).toBe("Ship on Monday");
  });

  test("accept all and reject all handle every suggestion", () => {
    const make = () => {
      const editor = createEditor({ type: "doc", content: [paragraph("One two"), paragraph("Three")] });
      setSuggesting(editor, true);
      suggest(editor, (state) => state.tr.delete(4, 8));
      suggest(editor, (state) => state.tr.insertText(" four", state.doc.content.size - 1));
      return editor;
    };
    const all = make();
    expect(listSuggestions(all.state.doc).length).toBe(2);
    acceptAllSuggestions(all);
    expect(textOf(all)).toBe("OneThree four");
    const none = make();
    rejectAllSuggestions(none);
    expect(textOf(none)).toBe("One twoThree");
  });

  test("a new list item while suggesting keeps the document valid", () => {
    const editor = createEditor({
      type: "doc",
      content: [{ type: "bulletList", content: [{ type: "listItem", content: [paragraph("First")] }] }],
    });
    setSuggesting(editor, true);
    // Cursor at the end of "First", then Enter: a new list item, nested inside the list.
    suggest(editor, (state) => {
      let transaction = state.tr.setSelection(state.selection.constructor.near(state.doc.resolve(8)));
      const after = state.apply(transaction);
      splitListItem(state.schema.nodes.listItem)(after, (split) => {
        for (const step of split.steps) transaction.step(step);
      });
      return transaction;
    });
    expect(() => editor.state.doc.check()).not.toThrow();
    expect(listSuggestions(editor.state.doc).length).toBe(1);
    rejectAllSuggestions(editor);
    expect(editor.state.doc.firstChild.childCount).toBe(1);
  });

  test("suggestions survive a Markdown save and reload", () => {
    const editor = createEditor({ type: "doc", content: [paragraph("Ship on Monday")] });
    setSuggesting(editor, true);
    suggest(editor, (state) => state.tr.insertText("Friday", 9, 15));
    const markdown = docToMarkdown(editor.getJSON());
    expect(markdown).toContain("<del data-suggestion-id=");
    expect(markdown).toContain("<ins data-suggestion-id=");
    const reloaded = createEditor(markdownToDoc(markdown));
    expect(listSuggestions(reloaded.state.doc)).toEqual(listSuggestions(editor.state.doc));
  });

  test("Backspace and Delete step over text already suggested for removal", () => {
    const editor = createEditor({ type: "doc", content: [paragraph("Ship it now")] });
    setSuggesting(editor, true);
    const backspaceAt = (pos, word = false) => {
      const state = editor.state.apply(editor.state.tr.setSelection(TextSelection.create(editor.state.doc, pos)));
      return suggestionDeletionRange(state, "backward", word);
    };
    // "Ship it now": cursor after "it" (position 8) removes "t".
    expect(backspaceAt(8)).toEqual({ from: 7, to: 8, cursor: 7 });
    expect(backspaceAt(8, true)).toEqual({ from: 6, to: 8, cursor: 6 });
    // Suggest removing " now", then Backspace from the end lands on "t" of "it", not on the removed text.
    suggest(editor, (state) => state.tr.delete(8, 12));
    expect(backspaceAt(12)).toEqual({ from: 7, to: 8, cursor: 7 });
    // At the start of a block the editor's own join takes over.
    expect(backspaceAt(1)).toBeNull();
    const forward = editor.state.apply(editor.state.tr.setSelection(TextSelection.create(editor.state.doc, 8)));
    expect(suggestionDeletionRange(forward, "forward", false)).toBeNull();
  });
});
