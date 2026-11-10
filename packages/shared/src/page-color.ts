import { Extension, Mark, mergeAttributes } from "@tiptap/core";

export const PAGE_COLORS = ["gray", "brown", "orange", "yellow", "green", "blue", "purple", "pink", "red"] as const;
export type PageColorName = (typeof PAGE_COLORS)[number];
export type PageColor = PageColorName | `${PageColorName}_background`;

const COLOR_VALUES = new Set<string>(PAGE_COLORS.flatMap((color) => [color, `${color}_background`]));
export const isPageColor = (value: unknown): value is PageColor => typeof value === "string" && COLOR_VALUES.has(value);

const COLORED_SPAN = /^<span data-page-color="([a-z_]+)">([\s\S]*?)<\/span>/;

/** Text or background colour on part of a line. Markdown keeps it as a small inline span. */
export const PageColorMark = Mark.create({
  name: "pageColor",
  addAttributes() {
    return {
      color: {
        default: null,
        parseHTML: (element) => {
          const value = element.getAttribute("data-page-color");
          return isPageColor(value) ? value : null;
        },
        renderHTML: (attributes) => (isPageColor(attributes.color) ? { "data-page-color": attributes.color } : {}),
      },
    };
  },
  parseHTML() {
    return [{ tag: "span[data-page-color]" }];
  },
  renderHTML({ HTMLAttributes }) {
    return ["span", mergeAttributes(HTMLAttributes), 0];
  },
  markdownTokenName: "pageColor",
  markdownTokenizer: {
    name: "pageColor",
    level: "inline",
    start: (source: string) => source.indexOf("<span data-page-color="),
    tokenize: (source: string, _tokens: unknown[], lexer: { inlineTokens: (text: string) => unknown[] }) => {
      const match = COLORED_SPAN.exec(source);
      if (!match || !isPageColor(match[1])) return undefined;
      return { type: "pageColor", raw: match[0], color: match[1], tokens: lexer.inlineTokens(match[2]) };
    },
  },
  parseMarkdown: (token: { color?: string; tokens?: unknown[] }, helpers: {
    applyMark: (name: string, content: unknown[], attrs?: Record<string, unknown>) => unknown;
    parseInline: (tokens: unknown[]) => unknown[];
  }) => helpers.applyMark("pageColor", helpers.parseInline(token.tokens ?? []), { color: token.color }),
  renderMarkdown: (node: { attrs?: { color?: unknown } }, helpers: { renderChildren: (node: unknown) => string }) => {
    const content = helpers.renderChildren(node);
    return isPageColor(node.attrs?.color) ? `<span data-page-color="${node.attrs.color}">${content}</span>` : content;
  },
} as Parameters<typeof Mark.create>[0]);

const BLOCK_TYPES = ["paragraph", "heading", "blockquote", "listItem", "taskItem", "callout"];

/** A colour for a whole block, and the id a block link points at. */
export const PageBlockAttributes = Extension.create({
  name: "pageBlockAttributes",
  addGlobalAttributes() {
    return [{
      types: BLOCK_TYPES,
      attributes: {
        blockColor: {
          default: null,
          parseHTML: (element) => {
            const value = element.getAttribute("data-block-color");
            return isPageColor(value) ? value : null;
          },
          renderHTML: (attributes) => (isPageColor(attributes.blockColor) ? { "data-block-color": attributes.blockColor } : {}),
        },
        blockId: {
          default: null,
          parseHTML: (element) => element.getAttribute("data-block-id"),
          renderHTML: (attributes) => (typeof attributes.blockId === "string" ? { "data-block-id": attributes.blockId } : {}),
        },
      },
    }];
  },
});
