import { Extension, type Editor } from "@tiptap/core";
import type { Node as ProseMirrorNode } from "@tiptap/pm/model";
import { Plugin, PluginKey, type EditorState } from "@tiptap/pm/state";
import { Decoration, DecorationSet } from "@tiptap/pm/view";

export type CommentAnchor = { threadId: string; quote: string; occurrence: number };

const key = new PluginKey<DecorationSet>("commentHighlights");
const INLINE_LEAF = "\u0000";

type TextBlock = { start: number; text: string };

const textBlocks = (doc: ProseMirrorNode) => {
  const blocks: TextBlock[] = [];
  doc.descendants((node, pos) => {
    if (!node.isTextblock) return true;
    // One character per inline leaf keeps string offsets equal to document offsets.
    blocks.push({ start: pos + 1, text: node.textBetween(0, node.content.size, INLINE_LEAF, INLINE_LEAF) });
    return false;
  });
  return blocks;
};

const findAll = (text: string, quote: string) => {
  const found: number[] = [];
  let index = text.indexOf(quote);
  while (index >= 0) {
    found.push(index);
    index = text.indexOf(quote, index + quote.length);
  }
  return found;
};

/** Where a quote is now. Anchors live on the text, so they need no marks in the saved document. */
export const locateQuote = (doc: ProseMirrorNode, quote: string, occurrence: number) => {
  if (!quote) return null;
  const matches = textBlocks(doc).flatMap((block) => findAll(block.text, quote).map((offset) => block.start + offset));
  const from = matches[occurrence] ?? matches[0];
  return from === undefined ? null : { from, to: from + quote.length };
};

const build = (state: EditorState, anchors: CommentAnchor[]) => {
  const decorations = anchors.flatMap((anchor) => {
    const range = locateQuote(state.doc, anchor.quote, anchor.occurrence);
    return range ? [Decoration.inline(range.from, range.to, { class: "ponder-comment-highlight", "data-comment-thread": anchor.threadId })] : [];
  });
  return DecorationSet.create(state.doc, decorations);
};

export const createCommentHighlights = (getAnchors: () => CommentAnchor[], onOpen: (threadId: string) => void) =>
  Extension.create({
    name: "commentHighlights",
    addProseMirrorPlugins() {
      return [
        new Plugin<DecorationSet>({
          key,
          state: {
            init: (_, state) => build(state, getAnchors()),
            apply: (tr, current, _old, state) => (tr.docChanged || tr.getMeta(key) ? build(state, getAnchors()) : current),
          },
          props: {
            decorations: (state) => key.getState(state),
            handleClick: (_view, _pos, event) => {
              const thread = (event.target as HTMLElement | null)?.closest?.("[data-comment-thread]")?.getAttribute("data-comment-thread");
              if (!thread) return false;
              onOpen(thread);
              return false;
            },
          },
        }),
      ];
    },
  });

export const refreshCommentHighlights = (editor: Editor) => {
  editor.view.dispatch(editor.state.tr.setMeta(key, true).setMeta("addToHistory", false));
};

const countBefore = (doc: ProseMirrorNode, quote: string, from: number) =>
  textBlocks(doc).flatMap((block) => findAll(block.text, quote).map((offset) => block.start + offset)).filter((pos) => pos < from).length;

/** The commentable text in the selection, clipped to the block it starts in. */
export const anchorFromSelection = (editor: Editor) => {
  const { $from, to, empty } = editor.state.selection;
  if (empty || !$from.parent.isTextblock) return null;
  const from = $from.pos;
  const end = Math.min(to, $from.end());
  const quote = editor.state.doc.textBetween(from, end, INLINE_LEAF, INLINE_LEAF);
  if (!quote.trim() || quote.includes(INLINE_LEAF)) return null;
  return { quote: quote.slice(0, 2000), occurrence: countBefore(editor.state.doc, quote, from) };
};

export const anchorFromBlock = (editor: Editor, pos: number, node: ProseMirrorNode) => {
  let start = -1;
  let text = "";
  node.descendants((child, offset) => {
    if (start >= 0) return false;
    if (!child.isTextblock || !child.textContent.trim()) return true;
    start = pos + offset + 2;
    text = child.textContent;
    return false;
  });
  if (start < 0 && node.isTextblock && node.textContent.trim()) {
    start = pos + 1;
    text = node.textContent;
  }
  if (start < 0) return null;
  const quote = text.slice(0, 120);
  return { quote, occurrence: countBefore(editor.state.doc, quote, start) };
};
