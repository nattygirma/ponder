import { mergeAttributes, Node, type JSONContent } from "@tiptap/core";
import { blockAttrs, dataAttribute, escapeAttr, findBalancedBlock, htmlBlockTokenizer, readAttr, renderBlocks } from "./page-block-markdown";

/**
 * Notion's Synced block and AI Block (Phase F of the Notion blocks plan).
 *
 * A synced block's content is stored once, in `synced_blocks`; a page holds only a reference,
 * `<ponder-synced id="…"></ponder-synced>`. That keeps the content out of pages whose readers
 * can't see the original page, and out of each page's live-editing document.
 *
 * When AI or an export needs the content, the reference is "expanded" to
 * `<ponder-synced id="…">content</ponder-synced>`, for the readers allowed to see it. A Markdown
 * write that comes back with content inside the tag edits the shared block (when the writer may
 * edit the original), and the page keeps only the reference.
 *
 * The AI block keeps its prompt as an attribute and its answer as ordinary blocks inside it:
 * `<ponder-ai prompt="…">answer</ponder-ai>`.
 */
export const SYNCED_BLOCK_NODE_TYPE = "ponderSynced" as const;
export const AI_BLOCK_NODE_TYPE = "ponderAiBlock" as const;

export const SYNCED_BLOCK_ID_PATTERN = /^syn_[A-Za-z0-9_-]{6,64}$/;
export const isSyncedBlockId = (value: unknown): value is string => typeof value === "string" && SYNCED_BLOCK_ID_PATTERN.test(value);

export const SyncedBlock = Node.create({
  name: SYNCED_BLOCK_NODE_TYPE,
  group: "block",
  atom: true,
  selectable: true,
  draggable: true,
  addAttributes: () => ({
    syncedId: { default: "", parseHTML: (element: HTMLElement) => element.getAttribute("data-synced-id") ?? "" },
  }),
  parseHTML: () => [{ tag: 'div[data-type="ponder-synced"]' }],
  renderHTML: ({ node }) => ["div", { "data-type": "ponder-synced", "data-synced-id": String(node.attrs.syncedId ?? ""), class: "ponder-synced" }],
  // The content inside an expanded tag is applied (or ignored) by the server before parsing.
  parseMarkdown: (token) => ({ type: SYNCED_BLOCK_NODE_TYPE, attrs: { syncedId: readAttr(blockAttrs(token), "id") } }),
  renderMarkdown: (node) => `<ponder-synced id="${escapeAttr(String(node.attrs?.syncedId ?? ""))}"></ponder-synced>`,
  markdownTokenizer: htmlBlockTokenizer(SYNCED_BLOCK_NODE_TYPE, "ponder-synced", false),
});

export const AiBlock = Node.create({
  name: AI_BLOCK_NODE_TYPE,
  group: "block",
  content: "block*",
  isolating: true,
  defining: true,
  draggable: true,
  addAttributes: () => ({
    prompt: dataAttribute("prompt"),
    generatedAt: dataAttribute("generated-at"),
  }),
  parseHTML: () => [{ tag: 'div[data-type="ponder-ai-block"]' }],
  renderHTML: ({ node, HTMLAttributes }) => [
    "div",
    mergeAttributes(HTMLAttributes, {
      "data-type": "ponder-ai-block",
      "data-prompt": String(node.attrs.prompt ?? ""),
      "data-generated-at": String(node.attrs.generatedAt ?? ""),
      class: "ponder-ai-block",
    }),
    0,
  ],
  parseMarkdown: (token, helpers) => {
    const attrs = blockAttrs(token);
    return helpers.createNode(
      AI_BLOCK_NODE_TYPE,
      { prompt: readAttr(attrs, "prompt"), generatedAt: readAttr(attrs, "generated") },
      helpers.parseChildren(token.tokens || []),
    );
  },
  renderMarkdown: (node, helpers) => {
    const prompt = escapeAttr(String(node.attrs?.prompt ?? ""));
    const generated = String(node.attrs?.generatedAt ?? "");
    const body = renderBlocks(node, helpers);
    return `<ponder-ai prompt="${prompt}"${generated ? ` generated="${escapeAttr(generated)}"` : ""}>${body ? `\n\n${body}\n\n` : ""}</ponder-ai>`;
  },
  markdownTokenizer: htmlBlockTokenizer(AI_BLOCK_NODE_TYPE, "ponder-ai", true),
});

// ---------------------------------------------------------------------------------------------
// Synced block references in Markdown and JSON

/** Splits Markdown into the parts outside and inside fenced code, so tags in code are left alone. */
const FENCE = /^[ ]{0,3}(`{3,}|~{3,})/;
const outsideCodeFences = (markdown: string, transform: (text: string) => string) => {
  const lines = markdown.split("\n");
  const out: string[] = [];
  let buffer: string[] = [];
  let fence: string | null = null;
  const flush = () => {
    if (buffer.length) out.push(transform(buffer.join("\n")));
    buffer = [];
  };
  for (const line of lines) {
    const match = FENCE.exec(line);
    if (fence === null && match) {
      flush();
      fence = match[1]![0]!.repeat(match[1]!.length);
      out.push(line);
      continue;
    }
    if (fence !== null) {
      out.push(line);
      if (match && match[1]!.startsWith(fence) && line.trim().replace(/[`~]/g, "") === "") fence = null;
      continue;
    }
    buffer.push(line);
  }
  flush();
  return out.join("\n");
};

const OPEN_TAG = /<ponder-synced\b([^>]*)>/g;

/** Calls `replace` for each synced tag outside code, with its id and the Markdown inside it. */
export const mapSyncedTags = (markdown: string, replace: (id: string, inner: string) => string) =>
  outsideCodeFences(markdown, (text) => {
    let result = "";
    let index = 0;
    OPEN_TAG.lastIndex = 0;
    for (let match = OPEN_TAG.exec(text); match; match = OPEN_TAG.exec(text)) {
      const block = findBalancedBlock(text.slice(match.index), "ponder-synced");
      if (!block) continue;
      result += text.slice(index, match.index) + replace(readAttr(block.attrs, "id"), block.inner.trim());
      index = match.index + block.raw.length;
      OPEN_TAG.lastIndex = index;
    }
    return result + text.slice(index);
  });

export const syncedTag = (id: string, inner = "") =>
  `<ponder-synced id="${escapeAttr(id)}">${inner.trim() ? `\n\n${inner.trim()}\n\n` : ""}</ponder-synced>`;

/** The synced block ids a page's Markdown refers to, in order, without repeats. */
export const listSyncedIdsInMarkdown = (markdown: string) => {
  const ids: string[] = [];
  mapSyncedTags(markdown, (id, inner) => {
    if (isSyncedBlockId(id) && !ids.includes(id)) ids.push(id);
    return syncedTag(id, inner);
  });
  return ids;
};

/**
 * Puts each synced block's content inside its tag, for AI and exports. `contentFor` returns the
 * block's Markdown, or null when this reader may not see it; those tags stay empty.
 */
export const expandSyncedMarkdown = (markdown: string, contentFor: (id: string) => string | null | undefined) =>
  mapSyncedTags(markdown, (id) => syncedTag(id, contentFor(id) ?? ""));

/**
 * Takes the content out of expanded synced tags: the Markdown a page stores, and the content
 * each tag carried (only tags that had some), to apply to the shared block.
 */
export const stripSyncedMarkdown = (markdown: string) => {
  const edits: Array<{ id: string; markdown: string }> = [];
  const stripped = mapSyncedTags(markdown, (id, inner) => {
    if (inner && isSyncedBlockId(id) && !edits.some((edit) => edit.id === id)) edits.push({ id, markdown: inner });
    return syncedTag(id);
  });
  return { markdown: stripped, edits };
};

type JsonNode = JSONContent & { content?: JsonNode[] };

/** The synced block ids a page's JSON refers to, in order, without repeats. */
export const collectSyncedIds = (doc: unknown) => {
  const ids: string[] = [];
  const visit = (node: JsonNode | undefined) => {
    if (!node || typeof node !== "object") return;
    if (node.type === SYNCED_BLOCK_NODE_TYPE) {
      const id = node.attrs?.syncedId;
      if (isSyncedBlockId(id) && !ids.includes(id)) ids.push(id);
      return;
    }
    if (Array.isArray(node.content)) node.content.forEach(visit);
  };
  visit(doc as JsonNode);
  return ids;
};

/**
 * Replaces synced references in a JSON document: with the blocks `blocksFor` returns (unsyncing,
 * or a public page showing its own block), removed when it returns null, kept when undefined.
 */
export const replaceSyncedNodes = <T>(doc: T, blocksFor: (id: string) => JSONContent[] | null | undefined): T => {
  const visit = (node: JsonNode): JsonNode[] => {
    if (node.type === SYNCED_BLOCK_NODE_TYPE) {
      const blocks = blocksFor(String(node.attrs?.syncedId ?? ""));
      if (blocks === undefined) return [node];
      return blocks === null ? [] : blocks as JsonNode[];
    }
    if (!Array.isArray(node.content)) return [node];
    return [{ ...node, content: node.content.flatMap(visit) }];
  };
  return visit(doc as JsonNode)[0] as T;
};

// ---------------------------------------------------------------------------------------------
// AI block

/*
 * Adapted from AppFlowy-Web (https://github.com/AppFlowy-IO/AppFlowy-Web), Copyright AppFlowy,
 * AGPL-3.0: `normalizeGeneratedSummaryMarkdown` and the shape of `buildSummaryRegeneratePrompt` in
 * src/components/editor/components/blocks/ai-meeting/ai-meeting.summary-regenerate.ts; and from
 * AppFlowy (https://github.com/AppFlowy-IO/AppFlowy), Copyright AppFlowy, AGPL-3.0: the user
 * question prompt (`AiWriterCommand.defaultPrompt`) in
 * frontend/appflowy_flutter/lib/plugins/document/presentation/editor_plugins/ai/operations/ai_writer_entities.dart.
 */

/** Models sometimes wrap a whole Markdown answer in a code fence; the block wants the Markdown. */
export const normalizeGeneratedMarkdown = (content: string) => {
  const trimmed = content.trim();
  const match = trimmed.match(/^```(?:markdown|md)?\s*([\s\S]*?)\s*```$/i);
  if (match) return match[1]!.trim();
  return trimmed;
};

/** The prompt's limit: the gateway takes instructions of up to 2,000 characters, preamble included. */
export const AI_BLOCK_PROMPT_MAX = 1500;
const AI_INSTRUCTION_MAX = 2000;

/** The instruction sent with the page: what the AI block's answer should be. */
export const buildAiBlockInstruction = (prompt: string) => [
  "Write the content of an AI block inside this page, in Markdown.",
  "The page is the source; the block's earlier answer is left out.",
  "Reply with only the block's content: no preamble, no closing remarks, don't repeat the request.",
  "Use headings, lists and tables where they help; don't wrap the answer in a code fence.",
  "Don't invent facts the page lacks unless asked for new writing. Write in the request's language.",
  "",
  `Request: ${prompt.trim().slice(0, AI_BLOCK_PROMPT_MAX)}`,
].join("\n").slice(0, AI_INSTRUCTION_MAX);

/** The page's document without the AI block at `index` (a path of child indexes), for its context. */
export const docWithoutNodeAt = <T extends JSONContent>(doc: T, path: number[]): T => {
  if (path.length === 0) return doc;
  const [head, ...rest] = path;
  const content = Array.isArray(doc.content) ? doc.content : [];
  return {
    ...doc,
    content: rest.length === 0
      ? content.filter((_, index) => index !== head)
      : content.map((child, index) => (index === head ? docWithoutNodeAt(child, rest) : child)),
  };
};
