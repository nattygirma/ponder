import type { JSONContent, MarkdownParseHelpers, MarkdownRendererHelpers, MarkdownToken } from "@tiptap/core";
import { openBlockSource } from "./markdown-block-start";

/** Helpers for blocks stored in Markdown as `<ponder-… attr="…">…</ponder-…>` tags. */
export const escapeAttr = (value: string) =>
  value.replace(/&/g, "&amp;").replace(/"/g, "&quot;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

export const unescapeAttr = (value: string) =>
  value.replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, "\"").replace(/&amp;/g, "&");

export const readAttr = (attrs: string, name: string) => {
  const match = new RegExp(`\\b${name}="([^"]*)"`).exec(attrs);
  return match ? unescapeAttr(match[1]) : "";
};

/** Finds the balanced `<tag …>…</tag>` at the start of `source`, so a block can nest inside its own kind. */
export const findBalancedBlock = (source: string, tag: string) => {
  const open = new RegExp(`^<${tag}\\b([^>]*)>`).exec(source);
  if (!open) return null;
  const pattern = new RegExp(`<${tag}\\b[^>]*>|</${tag}>`, "g");
  pattern.lastIndex = open[0].length;
  let depth = 1;
  for (let match = pattern.exec(source); match; match = pattern.exec(source)) {
    depth += match[0].startsWith("</") ? -1 : 1;
    if (depth === 0) {
      return {
        raw: source.slice(0, match.index + match[0].length),
        attrs: open[1],
        inner: source.slice(open[0].length, match.index),
      };
    }
  }
  return null;
};

export const htmlBlockTokenizer = (name: string, tag: string, parseInner: boolean) => ({
  name,
  level: "block" as const,
  start(source: string) {
    return openBlockSource(source).indexOf(`<${tag}`);
  },
  tokenize(source: string, _tokens: MarkdownToken[], lexer: { blockTokens: (src: string) => MarkdownToken[] }) {
    const leading = /^\s*/.exec(source)?.[0] ?? "";
    const block = findBalancedBlock(source.slice(leading.length), tag);
    if (!block) return undefined;
    const trailing = /^\s*\n/.exec(source.slice(leading.length + block.raw.length))?.[0] ?? "";
    const inner = block.inner.trim();
    return {
      type: name,
      raw: `${leading}${block.raw}${trailing}`,
      blockAttrs: block.attrs,
      text: inner,
      tokens: parseInner && inner ? lexer.blockTokens(inner) : [],
    };
  },
});

export const childrenOrParagraph = (token: MarkdownToken, helpers: MarkdownParseHelpers) => {
  const content = helpers.parseChildren(token.tokens || []);
  return content.length > 0 ? content : [{ type: "paragraph" }];
};

export const renderBlocks = (node: JSONContent, helpers: MarkdownRendererHelpers) =>
  (Array.isArray(node.content) ? helpers.renderChildren(node.content, "\n\n") : "").trim();

export const blockAttrs = (token: MarkdownToken) => (token as MarkdownToken & { blockAttrs?: string }).blockAttrs ?? "";


export const dataAttribute = (name: string) => ({ default: "", parseHTML: (element: HTMLElement) => element.getAttribute(`data-${name}`) ?? "" });
