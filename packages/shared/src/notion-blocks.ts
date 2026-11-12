import { mergeAttributes, Node, type JSONContent } from "@tiptap/core";
import { clampEmbedSize, EMBED_ALLOW, EMBED_SANDBOX, isEmbedServiceId, resolveEmbed } from "./embed-services";
import { isMediaKind, normalizeMediaUrl } from "./media-links";
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

/** The `<ponder-embed>` form: the link, then the `/` item it came from and its size, when set. */
export const renderEmbedMarkdown = (attrs: Record<string, unknown> | undefined) => {
  const service = isEmbedServiceId(attrs?.service) ? attrs.service : "";
  const { width, height } = clampEmbedSize(attrs?.width, attrs?.height);
  return `<ponder-embed url="${escapeAttr(String(attrs?.url ?? ""))}"${service ? ` service="${service}"` : ""}${width < 100 ? ` width="${width}"` : ""}${height ? ` height="${height}"` : ""}></ponder-embed>`;
};

const numberAttribute = (name: string) => ({
  default: null,
  parseHTML: (element: HTMLElement) => {
    const value = Number(element.getAttribute(`data-${name}`));
    return Number.isFinite(value) && value > 0 ? value : null;
  },
});

/**
 * Notion's Embed block and its named embeds (Phase E), and the YouTube, Vimeo and Loom players
 * from Phase C. `service` is the `/` item it was made from; `width` is a percentage of the column
 * and `height` a pixel height, both set by dragging its edges. A player keeps its 16:9 shape.
 */
export const VideoEmbed = Node.create({
  name: EMBED_NODE_TYPE,
  ...atomBlock,
  addAttributes: () => ({
    url: dataAttribute("url"),
    service: { default: "", parseHTML: (element: HTMLElement) => (isEmbedServiceId(element.getAttribute("data-service")) ? element.getAttribute("data-service") : "") },
    width: numberAttribute("width"),
    height: numberAttribute("height"),
  }),
  parseHTML: () => [{ tag: 'div[data-type="ponder-embed"]' }],
  renderHTML: ({ node }) => {
    const url = String(node.attrs.url ?? "");
    const target = resolveEmbed(url, isEmbedServiceId(node.attrs.service) ? node.attrs.service : null);
    const { width, height } = clampEmbedSize(node.attrs.width, node.attrs.height);
    const frameHeight = target?.kind === "frame" && !target.video ? height || target.height : 0;
    return [
      "div",
      {
        "data-type": "ponder-embed",
        "data-url": url,
        ...(node.attrs.service ? { "data-service": String(node.attrs.service) } : {}),
        ...(node.attrs.width ? { "data-width": String(width) } : {}),
        ...(node.attrs.height ? { "data-height": String(height) } : {}),
        class: "ponder-embed",
        ...(width < 100 ? { style: `width:${width}%` } : {}),
      },
      target?.kind === "frame"
        ? ["iframe", {
          src: target.embedUrl,
          title: url,
          sandbox: EMBED_SANDBOX,
          allow: EMBED_ALLOW,
          allowfullscreen: "true",
          loading: "lazy",
          referrerpolicy: "strict-origin-when-cross-origin",
          ...(frameHeight ? { height: String(frameHeight), style: `width:100%;height:${frameHeight}px;border:0` } : {}),
        }]
        : ["a", { href: normalizeMediaUrl(url) ?? "#", target: "_blank", rel: "noopener noreferrer" }, url],
    ];
  },
  parseMarkdown: (token) => {
    const attrs = blockAttrs(token);
    const service = readAttr(attrs, "service");
    const { width, height } = clampEmbedSize(readAttr(attrs, "width"), readAttr(attrs, "height"));
    return {
      type: EMBED_NODE_TYPE,
      attrs: { url: readAttr(attrs, "url"), service: isEmbedServiceId(service) ? service : "", width: width < 100 ? width : null, height: height || null },
    };
  },
  renderMarkdown: (node) => renderEmbedMarkdown(node.attrs),
  markdownTokenizer: htmlBlockTokenizer(EMBED_NODE_TYPE, "ponder-embed", false),
});

/** Phase E's name for the block; Phase C called it VideoEmbed. */
export const Embed = VideoEmbed;

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
    // The named embed an empty /embed block is for (Phase E), or "" for Notion's generic Embed.
    service: { default: "", parseHTML: (element: HTMLElement) => (isEmbedServiceId(element.getAttribute("data-service")) ? element.getAttribute("data-service") : "") },
  }),
  parseHTML: () => [{ tag: 'div[data-type="ponder-media"]' }],
  renderHTML: ({ node }) => ["div", {
    "data-type": "ponder-media",
    "data-kind": node.attrs.kind,
    ...(node.attrs.service ? { "data-service": String(node.attrs.service) } : {}),
    class: "ponder-media-placeholder",
  }],
  parseMarkdown: (token) => {
    const kind = readAttr(blockAttrs(token), "kind");
    const service = readAttr(blockAttrs(token), "service");
    return { type: MEDIA_PLACEHOLDER_NODE_TYPE, attrs: { kind: isMediaKind(kind) ? kind : "image", service: kind === "embed" && isEmbedServiceId(service) ? service : "" } };
  },
  renderMarkdown: (node) => {
    const service = node.attrs?.kind === "embed" && isEmbedServiceId(node.attrs?.service) ? ` service="${node.attrs.service}"` : "";
    return `<ponder-media kind="${escapeAttr(String(node.attrs?.kind ?? "image"))}"${service}></ponder-media>`;
  },
  markdownTokenizer: htmlBlockTokenizer(MEDIA_PLACEHOLDER_NODE_TYPE, "ponder-media", false),
});
