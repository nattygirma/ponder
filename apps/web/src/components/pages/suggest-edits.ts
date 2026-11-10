import { Extension, type Editor } from "@tiptap/core";
import type { MarkType, Node as ProseMirrorNode, Schema } from "@tiptap/pm/model";
import { Plugin, TextSelection, type EditorState } from "@tiptap/pm/state";
import {
  applySuggestion, applySuggestions, disableSuggestChanges, enableSuggestChanges, isSuggestChangesEnabled, revertSuggestion, revertSuggestions,
  suggestChanges, withSuggestChanges,
} from "@handlewithcare/prosemirror-suggest-changes";
import { SUGGESTION_MARK_NAMES, suggestionAuthorId } from "@ponder/shared/suggestion";

/**
 * Suggestions can mark whole blocks (a new list item, a deleted paragraph), so every block container has to
 * accept the three suggestion marks. TipTap builds each node's mark list from the node itself, so it is widened here,
 * once the schema exists and before any document is loaded.
 */
export const allowSuggestionMarksOnBlocks = (schema: Schema) => {
  const marks = SUGGESTION_MARK_NAMES.map((name) => schema.marks[name]).filter((mark): mark is MarkType => Boolean(mark));
  if (marks.length !== SUGGESTION_MARK_NAMES.length) return;
  for (const type of Object.values(schema.nodes)) {
    // null already allows every mark; inline content already allows them through its own rules.
    if (type.isInline || type.inlineContent || type.markSet === null) continue;
    (type as { markSet: readonly MarkType[] | null }).markSet = [...type.markSet, ...marks.filter((mark) => !type.markSet?.includes(mark))];
  }
};

const randomPart = () => crypto.randomUUID().replace(/-/g, "").slice(0, 10);

const isDeleted = (node: ProseMirrorNode | null | undefined) => Boolean(node?.marks.some((mark) => mark.type.name === "deletion"));
const WORD_BEFORE = /(?:\s+|[^\s]+\s*)$/u;
const WORD_AFTER = /^(?:\s+|\s*[^\s]+)/u;

/**
 * What Backspace or Delete removes while suggesting, and where the cursor goes. Text already suggested for removal
 * stays in the page, so the keys step over it to the next character, the way they would if it were gone.
 * Null at the edge of a block, where the editor's own join handles it (and becomes a suggestion too).
 */
export const suggestionDeletionRange = (state: EditorState, direction: "backward" | "forward", word: boolean) => {
  const { selection } = state;
  if (!(selection instanceof TextSelection)) return null;
  if (!selection.empty) return { from: selection.from, to: selection.to, cursor: selection.from };
  const $cursor = selection.$from;
  if (!$cursor.parent.isTextblock) return null;
  const start = $cursor.start();
  const end = $cursor.end();
  let pos = $cursor.pos;
  if (direction === "backward") {
    for (let before = state.doc.resolve(pos).nodeBefore; pos > start && isDeleted(before); before = state.doc.resolve(pos).nodeBefore) {
      pos -= before!.nodeSize;
    }
    if (pos <= start) return null;
    const text = state.doc.textBetween(start, pos, undefined, "\ufffc");
    const length = word ? (WORD_BEFORE.exec(text)?.[0].length ?? 1) : Array.from(text.slice(-2)).at(-1)?.length ?? 1;
    return { from: pos - length, to: pos, cursor: pos - length };
  }
  for (let after = state.doc.resolve(pos).nodeAfter; pos < end && isDeleted(after); after = state.doc.resolve(pos).nodeAfter) {
    pos += after!.nodeSize;
  }
  if (pos >= end) return null;
  const text = state.doc.textBetween(pos, end, undefined, "\ufffc");
  const length = word ? (WORD_AFTER.exec(text)?.[0].length ?? 1) : Array.from(text.slice(0, 2))[0]?.length ?? 1;
  return { from: pos, to: pos + length, cursor: pos };
};

/** Turns edits into suggestions while Suggest edits is on. Ids carry the author: "<user id>:<random>". */
export const createSuggestEditsExtension = (getAuthorId: () => string | null) => Extension.create({
  name: "suggestEdits",
  // Its keys run before the editor's own, which leave Backspace inside text to the browser.
  priority: 1000,
  onBeforeCreate() {
    allowSuggestionMarksOnBlocks(this.editor.schema);
  },
  addProseMirrorPlugins() {
    return [
      suggestChanges(),
      // Typed text goes through one explicit insert with the cursor after it. Left to the browser, typing over a
      // selection put the cursor before the text it replaced, so the next letter landed in front.
      new Plugin({
        props: {
          handleTextInput: (view, from, to, text) => {
            if (!isSuggestChangesEnabled(view.state) || view.composing) return false;
            // The browser may not have reported a fresh selection yet. The suggestion code reads the editor's
            // selection to decide where the cursor goes, so record what is being replaced first.
            const { selection } = view.state;
            if (selection.from !== from || selection.to !== to) {
              view.dispatch(view.state.tr.setSelection(TextSelection.create(view.state.doc, from, to)));
            }
            const transaction = view.state.tr.insertText(text, from, to);
            transaction.setSelection(TextSelection.create(transaction.doc, from + text.length));
            view.dispatch(transaction.scrollIntoView());
            return true;
          },
        },
      }),
    ];
  },
  addKeyboardShortcuts() {
    // The browser deletes text itself unless the editor does, and a deletion that leaves the text in place
    // confuses its next edit. While suggesting, the editor does every deletion.
    const remove = (direction: "backward" | "forward", word: boolean) => () => {
      const { editor } = this;
      if (!isSuggesting(editor)) return false;
      const range = suggestionDeletionRange(editor.state, direction, word);
      if (!range) return false;
      const transaction = editor.state.tr.delete(range.from, range.to);
      transaction.setSelection(TextSelection.create(transaction.doc, transaction.mapping.map(range.cursor, -1)));
      editor.view.dispatch(transaction.scrollIntoView());
      return true;
    };
    return {
      Backspace: remove("backward", false),
      "Mod-Backspace": remove("backward", true),
      "Alt-Backspace": remove("backward", true),
      Delete: remove("forward", false),
      "Mod-Delete": remove("forward", true),
      "Alt-Delete": remove("forward", true),
    };
  },
  dispatchTransaction({ transaction, next }) {
    // Undo, other people's live edits and accepting or rejecting suggestions pass straight through.
    withSuggestChanges(next, () => `${getAuthorId() ?? "someone"}:${randomPart()}`).call(this.editor.view, transaction);
  },
});

export const isSuggesting = (editor: Editor | null) => Boolean(editor && isSuggestChangesEnabled(editor.state));

export const setSuggesting = (editor: Editor, on: boolean) => {
  (on ? enableSuggestChanges : disableSuggestChanges)(editor.state, editor.view.dispatch);
};

export type PageSuggestion = {
  id: string | number;
  authorId: string | null;
  added: string;
  removed: string;
  /** A block's type or formatting changed, with no text added or removed. */
  restyled: boolean;
};

/** Every suggestion in a document, in reading order, with the text it adds and removes. */
export const listSuggestions = (doc: ProseMirrorNode): PageSuggestion[] => {
  const byId = new Map<string | number, PageSuggestion>();
  const entry = (id: string | number) => {
    let found = byId.get(id);
    if (!found) {
      found = { id, authorId: suggestionAuthorId(id), added: "", removed: "", restyled: false };
      byId.set(id, found);
    }
    return found;
  };
  doc.descendants((node) => {
    for (const mark of node.marks) {
      const id = mark.attrs.id as string | number | null;
      if (id == null) continue;
      const name = mark.type.name;
      if (name !== "insertion" && name !== "deletion" && name !== "modification") continue;
      const suggestion = entry(id);
      // Anchors the library adds around block changes are zero-width spaces, not text anybody typed.
      const text = (node.isText ? node.text ?? "" : node.textContent).replace(/​/g, "");
      if (name === "insertion") suggestion.added += text || (node.isBlock ? "\n" : "");
      else if (name === "deletion") suggestion.removed += text || (node.isBlock ? "\n" : "");
      else suggestion.restyled = true;
      // A marked block covers its children; don't count their text twice.
      if (!node.isText && node.isBlock) return false;
    }
    return true;
  });
  return [...byId.values()];
};

export const acceptSuggestion = (editor: Editor, id: string | number) => applySuggestion(id)(editor.state, editor.view.dispatch);
export const rejectSuggestion = (editor: Editor, id: string | number) => revertSuggestion(id)(editor.state, editor.view.dispatch);
export const acceptAllSuggestions = (editor: Editor) => applySuggestions(editor.state, editor.view.dispatch);
export const rejectAllSuggestions = (editor: Editor) => revertSuggestions(editor.state, editor.view.dispatch);
