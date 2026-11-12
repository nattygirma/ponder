import { mergeAttributes, Node, type JSONContent } from "@tiptap/core";
import { isMediaKind, normalizeMediaUrl, parseVideoEmbed } from "./media-links";
import { blockAttrs, childrenOrParagraph, dataAttribute, escapeAttr, htmlBlockTokenizer, readAttr, renderBlocks } from "./page-block-markdown";

/**
 * Notion blocks Ponder added in Phase C of the Notion blocks plan: table of contents, breadcrumb,
 * tabs, video embeds, web bookmarks and the empty media blocks that wait for an upload or a link.
 * Each is stored in Markdown as a `<ponder-…>` tag, so AI chat, MCP and imports can write them.
 */
export const TOC_NODE_TYPE = "ponderToc" as const;
export const BREADCRUMB_NODE_TYPE = "ponderBreadcrumb" as const;
export const TABS_NODE_TYPE = "ponderTabs" as const;
export const TAB_NODE_TYPE = "ponderTab" as const;
export const EMBED_NODE_TYPE = "ponderEmbed" as const;
export const BOOKMARK_NODE_TYPE = "ponderBookmark" as const;
export const MEDIA_PLACEHOLDER_NODE_TYPE = "ponderMedia" as const;

export const NOTION_BLOCK_NODE_TYPES = [
  TOC_NODE_TYPE,
  BREADCRUMB_NODE_TYPE,
  TABS_NODE_TYPE,
  TAB_NODE_TYPE,
  EMBED_NODE_TYPE,
  BOOKMARK_NODE_TYPE,
  MEDIA_PLACEHOLDER_NODE_TYPE,
] as const;

const atomBlock = { group: "block", atom: true, selectable: true, draggable: true } as const;

/** Notion's /toc: lists the page's headings. The list is drawn from the page, so nothing is stored. */
export const TableOfContents = Node.create({
  name: TOC_NODE_TYPE,
  ...atomBlock,
  parseHTML: () => [{ tag: 'nav[data-type="ponder-toc"]' }],
  renderHTML: () => ["nav", { "data-type": "ponder-toc", class: "ponder-toc" }],
  parseMarkdown: () => ({ type: TOC_NODE_TYPE }),
  renderMarkdown: () => "<ponder-toc></ponder-toc>",
  markdownTokenizer: htmlBlockTokenizer(TOC_NODE_TYPE, "ponder-toc", false),
});

/** Notion's /breadcrumb: the page's path from the top. Drawn from the page tree. */
export const Breadcrumb = Node.create({
  name: BREADCRUMB_NODE_TYPE,
  ...atomBlock,
  parseHTML: () => [{ tag: 'nav[data-type="ponder-breadcrumb"]' }],
  renderHTML: () => ["nav", { "data-type": "ponder-breadcrumb", class: "ponder-breadcrumb" }],
  parseMarkdown: () => ({ type: BREADCRUMB_NODE_TYPE }),
  renderMarkdown: () => "<ponder-breadcrumb></ponder-breadcrumb>",
  markdownTokenizer: htmlBlockTokenizer(BREADCRUMB_NODE_TYPE, "ponder-breadcrumb", false),
});

/** Notion's /tabs: named tabs, each holding its own blocks. Which tab is open isn't stored. */
export const Tabs = Node.create({
  name: TABS_NODE_TYPE,
  group: "block",
  content: `${TAB_NODE_TYPE}+`,
  isolating: true,
  defining: true,
  draggable: true,
  parseHTML: () => [{ tag: 'div[data-type="ponder-tabs"]' }],
  renderHTML: ({ HTMLAttributes }) => ["div", mergeAttributes(HTMLAttributes, { "data-type": "ponder-tabs", class: "ponder-tabs" }), 0],
  parseMarkdown: (token, helpers) => {
    const tabs = helpers.parseChildren(token.tokens || []).filter((child) => child.type === TAB_NODE_TYPE);
    return helpers.createNode(TABS_NODE_TYPE, undefined, tabs.length ? tabs : [createTabContent("Tab 1")]);
  },
  renderMarkdown: (node, helpers) => `<ponder-tabs>\n\n${renderBlocks(node, helpers)}\n\n</ponder-tabs>`,
  markdownTokenizer: htmlBlockTokenizer(TABS_NODE_TYPE, "ponder-tabs", true),
});

export const Tab = Node.create({
  name: TAB_NODE_TYPE,
  content: "block+",
  isolating: true,
  defining: true,
  addAttributes: () => ({ title: dataAttribute("title") }),
  parseHTML: () => [{ tag: 'section[data-type="ponder-tab"]' }],
  renderHTML: ({ node, HTMLAttributes }) => [
    "section",
    mergeAttributes(HTMLAttributes, { "data-type": "ponder-tab", "data-title": node.attrs.title, class: "ponder-tab" }),
    0,
  ],
  parseMarkdown: (token, helpers) => helpers.createNode(
    TAB_NODE_TYPE,
    { title: readAttr(blockAttrs(token), "title") },
    childrenOrParagraph(token, helpers),
  ),
  renderMarkdown: (node, helpers) =>
    `<ponder-tab title="${escapeAttr(String(node.attrs?.title ?? ""))}">\n\n${renderBlocks(node, helpers)}\n\n</ponder-tab>`,
  markdownTokenizer: htmlBlockTokenizer(TAB_NODE_TYPE, "ponder-tab", true),
});

export const createTabContent = (title: string): JSONContent => ({ type: TAB_NODE_TYPE, attrs: { title }, content: [{ type: "paragraph" }] });

/** A new /tabs block, with Notion's three tabs. */
export const createTabsContent = (titles: string[] = ["Tab 1", "Tab 2", "Tab 3"]): JSONContent => ({
  type: TABS_NODE_TYPE,
  content: titles.map(createTabContent),
});

const SANDBOX = "allow-scripts allow-same-origin allow-presentation allow-popups";

/** A YouTube, Vimeo or Loom video, played in the provider's own frame. */
export const VideoEmbed = Node.create({
  name: EMBED_NODE_TYPE,
  ...atomBlock,
  addAttributes: () => ({ url: dataAttribute("url") }),
  parseHTML: () => [{ tag: 'div[data-type="ponder-embed"]' }],
  renderHTML: ({ node }) => {
    const url = String(node.attrs.url ?? "");
    const embed = parseVideoEmbed(url);
    return [
      "div",
      { "data-type": "ponder-embed", "data-url": url, class: "ponder-embed" },
      embed
        ? ["iframe", { src: embed.embedUrl, sandbox: SANDBOX, allow: "fullscreen; picture-in-picture; encrypted-media", allowfullscreen: "true", loading: "lazy", referrerpolicy: "strict-origin-when-cross-origin" }]
        : ["a", { href: normalizeMediaUrl(url) ?? "#", target: "_blank", rel: "noopener noreferrer" }, url],
    ];
  },
  parseMarkdown: (token) => ({ type: EMBED_NODE_TYPE, attrs: { url: readAttr(blockAttrs(token), "url") } }),
  renderMarkdown: (node) => `<ponder-embed url="${escapeAttr(String(node.attrs?.url ?? ""))}"></ponder-embed>`,
  markdownTokenizer: htmlBlockTokenizer(EMBED_NODE_TYPE, "ponder-embed", false),
});

const BOOKMARK_ATTRIBUTES = ["url", "title", "description", "icon", "image"] as const;

/** Only web addresses are linked or loaded, whatever an imported document claims. */
const httpsOnly = (value: unknown) => (/^https:\/\//i.test(String(value ?? "")) ? String(value) : "");

/** Notion's Web bookmark: a card with the page's title, description, icon and image. */
export const WebBookmark = Node.create({
  name: BOOKMARK_NODE_TYPE,
  ...atomBlock,
  addAttributes: () => Object.fromEntries(BOOKMARK_ATTRIBUTES.map((name) => [name, dataAttribute(name)])),
  parseHTML: () => [{ tag: 'div[data-type="ponder-bookmark"]' }],
  renderHTML: ({ node }) => {
    const { url, title, description, icon, image } = node.attrs;
    const href = normalizeMediaUrl(String(url ?? "")) ?? "#";
    return [
      "div",
      { "data-type": "ponder-bookmark", ...Object.fromEntries(BOOKMARK_ATTRIBUTES.map((name) => [`data-${name}`, String(node.attrs[name] ?? "")])), class: "ponder-bookmark" },
      ["a", { href, target: "_blank", rel: "noopener noreferrer" },
        ["span", { class: "ponder-bookmark-text" },
          ["strong", {}, String(title || url || "")],
          ["span", {}, String(description ?? "")],
          ["span", {}, ...(httpsOnly(icon) ? [["img", { src: httpsOnly(icon), alt: "", width: "16", height: "16" }] as const] : []), String(url ?? "")],
        ],
        ...(httpsOnly(image) ? [["img", { class: "ponder-bookmark-image", src: httpsOnly(image), alt: "" }] as const] : []),
      ],
    ];
  },
  parseMarkdown: (token) => ({
    type: BOOKMARK_NODE_TYPE,
    attrs: Object.fromEntries(BOOKMARK_ATTRIBUTES.map((name) => [name, readAttr(blockAttrs(token), name)])),
  }),
  renderMarkdown: (node) =>
    `<ponder-bookmark ${BOOKMARK_ATTRIBUTES.map((name) => `${name}="${escapeAttr(String(node.attrs?.[name] ?? ""))}"`).join(" ")}></ponder-bookmark>`,
  markdownTokenizer: htmlBlockTokenizer(BOOKMARK_NODE_TYPE, "ponder-bookmark", false),
});

/**
 * An empty /image, /video, /audio, /file or /bookmark block ("Add an image"), as Notion leaves one
 * on the page until a file is uploaded or a link embedded.
 */
export const MediaPlaceholder = Node.create({
  name: MEDIA_PLACEHOLDER_NODE_TYPE,
  ...atomBlock,
  addAttributes: () => ({
    kind: { default: "image", parseHTML: (element: HTMLElement) => (isMediaKind(element.getAttribute("data-kind")) ? element.getAttribute("data-kind") : "image") },
  }),
  parseHTML: () => [{ tag: 'div[data-type="ponder-media"]' }],
  renderHTML: ({ node }) => ["div", { "data-type": "ponder-media", "data-kind": node.attrs.kind, class: "ponder-media-placeholder" }],
  parseMarkdown: (token) => {
    const kind = readAttr(blockAttrs(token), "kind");
    return { type: MEDIA_PLACEHOLDER_NODE_TYPE, attrs: { kind: isMediaKind(kind) ? kind : "image" } };
  },
  renderMarkdown: (node) => `<ponder-media kind="${escapeAttr(String(node.attrs?.kind ?? "image"))}"></ponder-media>`,
  markdownTokenizer: htmlBlockTokenizer(MEDIA_PLACEHOLDER_NODE_TYPE, "ponder-media", false),
});
