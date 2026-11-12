import { mergeAttributes, Node, type JSONContent } from "@tiptap/core";
import { NOTION_BLOCK_NODE_TYPES } from "./notion-blocks";
import { blockAttrs, childrenOrParagraph, dataAttribute, escapeAttr, htmlBlockTokenizer, readAttr, renderBlocks, unescapeAttr } from "./page-block-markdown";

export const SUB_PAGE_NODE_TYPE = "ponderSubPage" as const;
export const CALLOUT_NODE_TYPE = "ponderCallout" as const;
export const COLUMNS_NODE_TYPE = "ponderColumns" as const;
export const COLUMN_NODE_TYPE = "ponderColumn" as const;
export const DATABASE_EMBED_NODE_TYPE = "ponderDatabase" as const;
export const LINK_PREVIEW_NODE_TYPE = "ponderLinkPreview" as const;
export const BUTTON_NODE_TYPE = "ponderButton" as const;

export const CALLOUT_COLORS = ["gray", "brown", "orange", "yellow", "green", "blue", "purple", "pink", "red"] as const;
export type CalloutColor = (typeof CALLOUT_COLORS)[number];

export const PAGE_BLOCK_NODE_TYPES = [
  SUB_PAGE_NODE_TYPE,
  CALLOUT_NODE_TYPE,
  COLUMNS_NODE_TYPE,
  COLUMN_NODE_TYPE,
  DATABASE_EMBED_NODE_TYPE,
  LINK_PREVIEW_NODE_TYPE,
  BUTTON_NODE_TYPE,
  ...NOTION_BLOCK_NODE_TYPES,
] as const;

export const SubPage = Node.create({
  name: SUB_PAGE_NODE_TYPE,
  group: "block",
  atom: true,
  selectable: true,
  draggable: true,

  addAttributes() {
    return {
      memoId: { default: "", parseHTML: (element) => element.getAttribute("data-memo-id") ?? "" },
      title: { default: "", parseHTML: (element) => element.textContent ?? "" },
    };
  },

  parseHTML() {
    return [{ tag: 'div[data-type="ponder-sub-page"]' }];
  },

  renderHTML({ node }) {
    return [
      "div",
      { "data-type": "ponder-sub-page", "data-memo-id": node.attrs.memoId, class: "ponder-sub-page" },
      node.attrs.title || "Untitled",
    ];
  },

  parseMarkdown: (token) => ({
    type: SUB_PAGE_NODE_TYPE,
    attrs: { memoId: readAttr(blockAttrs(token), "id"), title: unescapeAttr(token.text ?? "") },
  }),

  renderMarkdown: (node) =>
    `<ponder-page id="${escapeAttr(String(node.attrs?.memoId ?? ""))}">${escapeAttr(String(node.attrs?.title ?? ""))}</ponder-page>`,

  markdownTokenizer: htmlBlockTokenizer(SUB_PAGE_NODE_TYPE, "ponder-page", false),
});

export const DatabaseEmbed = Node.create({
  name: DATABASE_EMBED_NODE_TYPE,
  group: "block",
  atom: true,
  selectable: true,
  draggable: true,

  addAttributes() {
    return {
      databaseId: { default: "", parseHTML: (element) => element.getAttribute("data-database-id") ?? "" },
      viewId: { default: "", parseHTML: (element) => element.getAttribute("data-view-id") ?? "" },
    };
  },

  parseHTML() {
    return [{ tag: 'div[data-type="ponder-database"]' }];
  },

  renderHTML({ node }) {
    return [
      "div",
      { "data-type": "ponder-database", "data-database-id": node.attrs.databaseId, "data-view-id": node.attrs.viewId, class: "ponder-database-embed" },
      "Database",
    ];
  },

  parseMarkdown: (token) => ({
    type: DATABASE_EMBED_NODE_TYPE,
    attrs: { databaseId: readAttr(blockAttrs(token), "id"), viewId: readAttr(blockAttrs(token), "view") },
  }),

  renderMarkdown: (node) =>
    `<ponder-database id="${escapeAttr(String(node.attrs?.databaseId ?? ""))}" view="${escapeAttr(String(node.attrs?.viewId ?? ""))}"></ponder-database>`,

  markdownTokenizer: htmlBlockTokenizer(DATABASE_EMBED_NODE_TYPE, "ponder-database", false),
});

/** Only web addresses become clickable, whatever an imported document claims. */
export const safeLinkPreviewUrl = (url: string) => (/^https:\/\//i.test(url) ? url : "#");


/** A card for a link to a connected app. It stores what the app said, so everyone can read it. */
export const LinkPreview = Node.create({
  name: LINK_PREVIEW_NODE_TYPE,
  group: "block",
  atom: true,
  selectable: true,
  draggable: true,

  addAttributes() {
    return { url: dataAttribute("url"), provider: dataAttribute("provider"), title: dataAttribute("title"), subtitle: dataAttribute("subtitle") };
  },

  parseHTML() {
    return [{ tag: 'div[data-type="ponder-link-preview"]' }];
  },

  renderHTML({ node }) {
    const { url, provider, title, subtitle } = node.attrs;
    return [
      "div",
      { "data-type": "ponder-link-preview", "data-url": url, "data-provider": provider, "data-title": title, "data-subtitle": subtitle, class: "ponder-link-preview" },
      ["a", { href: safeLinkPreviewUrl(String(url)), target: "_blank", rel: "noopener noreferrer" }, String(title || url)],
      ["span", {}, String(subtitle)],
    ];
  },

  parseMarkdown: (token) => ({
    type: LINK_PREVIEW_NODE_TYPE,
    attrs: {
      url: readAttr(blockAttrs(token), "url"),
      provider: readAttr(blockAttrs(token), "provider"),
      title: readAttr(blockAttrs(token), "title"),
      subtitle: readAttr(blockAttrs(token), "subtitle"),
    },
  }),

  renderMarkdown: (node) => {
    const attribute = (name: string) => `${name}="${escapeAttr(String(node.attrs?.[name] ?? ""))}"`;
    return `<ponder-link-preview ${["url", "provider", "title", "subtitle"].map(attribute).join(" ")}></ponder-link-preview>`;
  },

  markdownTokenizer: htmlBlockTokenizer(LINK_PREVIEW_NODE_TYPE, "ponder-link-preview", false),
});

/**
 * Notion's /button block: a labelled button whose actions (the same ones as a Button property)
 * are kept in the page as JSON, so they travel with it in Markdown, backups and copies.
 */
export const ButtonBlock = Node.create({
  name: BUTTON_NODE_TYPE,
  group: "block",
  atom: true,
  selectable: true,
  draggable: true,

  addAttributes() {
    return { label: dataAttribute("label"), icon: dataAttribute("icon"), actions: { ...dataAttribute("actions"), default: "[]" } };
  },

  parseHTML() {
    return [{ tag: 'div[data-type="ponder-button"]' }];
  },

  renderHTML({ node }) {
    const { label, icon, actions } = node.attrs;
    return [
      "div",
      { "data-type": "ponder-button", "data-label": label, "data-icon": icon, "data-actions": actions, class: "ponder-button-block" },
      ["button", { type: "button", disabled: "true" }, `${icon ? `${String(icon)} ` : ""}${String(label || "Button")}`],
    ];
  },

  parseMarkdown: (token) => ({
    type: BUTTON_NODE_TYPE,
    attrs: {
      label: readAttr(blockAttrs(token), "label"),
      icon: readAttr(blockAttrs(token), "icon"),
      actions: readAttr(blockAttrs(token), "actions") || "[]",
    },
  }),

  renderMarkdown: (node) => {
    const attribute = (name: string, fallback = "") => `${name}="${escapeAttr(String(node.attrs?.[name] ?? fallback))}"`;
    return `<ponder-button ${[attribute("label"), attribute("icon"), attribute("actions", "[]")].join(" ")}></ponder-button>`;
  },

  markdownTokenizer: htmlBlockTokenizer(BUTTON_NODE_TYPE, "ponder-button", false),
});

export const Callout = Node.create({
  name: CALLOUT_NODE_TYPE,
  group: "block",
  content: "block+",
  defining: true,

  addAttributes() {
    return {
      icon: { default: "💡", parseHTML: (element) => element.getAttribute("data-icon") ?? "💡" },
      color: { default: "gray", parseHTML: (element) => element.getAttribute("data-color") ?? "gray" },
    };
  },

  parseHTML() {
    return [{ tag: 'aside[data-type="ponder-callout"]', contentElement: "div" }];
  },

  renderHTML({ node, HTMLAttributes }) {
    return [
      "aside",
      mergeAttributes(HTMLAttributes, {
        "data-type": "ponder-callout",
        "data-icon": node.attrs.icon,
        "data-color": node.attrs.color,
        class: "ponder-callout",
      }),
      ["span", { class: "ponder-callout-icon", contenteditable: "false" }, node.attrs.icon],
      ["div", { class: "ponder-callout-body" }, 0],
    ];
  },

  parseMarkdown: (token, helpers) => helpers.createNode(
    CALLOUT_NODE_TYPE,
    { icon: readAttr(blockAttrs(token), "icon") || "💡", color: readAttr(blockAttrs(token), "color") || "gray" },
    childrenOrParagraph(token, helpers),
  ),

  renderMarkdown: (node, helpers) =>
    `<ponder-callout icon="${escapeAttr(String(node.attrs?.icon ?? "💡"))}" color="${escapeAttr(String(node.attrs?.color ?? "gray"))}">\n\n${renderBlocks(node, helpers)}\n\n</ponder-callout>`,

  markdownTokenizer: htmlBlockTokenizer(CALLOUT_NODE_TYPE, "ponder-callout", true),
});

export const Columns = Node.create({
  name: COLUMNS_NODE_TYPE,
  group: "block",
  content: `${COLUMN_NODE_TYPE}{2,5}`,
  isolating: true,

  parseHTML() {
    return [{ tag: 'div[data-type="ponder-columns"]' }];
  },

  renderHTML({ HTMLAttributes }) {
    return ["div", mergeAttributes(HTMLAttributes, { "data-type": "ponder-columns", class: "ponder-columns" }), 0];
  },

  parseMarkdown: (token, helpers) => helpers.createNode(COLUMNS_NODE_TYPE, undefined, helpers.parseChildren(token.tokens || [])),

  renderMarkdown: (node, helpers) => `<ponder-columns>\n\n${renderBlocks(node, helpers)}\n\n</ponder-columns>`,

  markdownTokenizer: htmlBlockTokenizer(COLUMNS_NODE_TYPE, "ponder-columns", true),
});

export const Column = Node.create({
  name: COLUMN_NODE_TYPE,
  content: "block+",
  isolating: true,

  parseHTML() {
    return [{ tag: 'div[data-type="ponder-column"]' }];
  },

  renderHTML({ HTMLAttributes }) {
    return ["div", mergeAttributes(HTMLAttributes, { "data-type": "ponder-column", class: "ponder-column" }), 0];
  },

  parseMarkdown: (token, helpers) => helpers.createNode(COLUMN_NODE_TYPE, undefined, childrenOrParagraph(token, helpers)),

  renderMarkdown: (node, helpers) => `<ponder-column>\n\n${renderBlocks(node, helpers)}\n\n</ponder-column>`,

  markdownTokenizer: htmlBlockTokenizer(COLUMN_NODE_TYPE, "ponder-column", true),
});

export const createColumnsContent = (count: number): JSONContent => ({
  type: COLUMNS_NODE_TYPE,
  content: Array.from({ length: Math.min(5, Math.max(2, count)) }, () => ({
    type: COLUMN_NODE_TYPE,
    content: [{ type: "paragraph" }],
  })),
});
