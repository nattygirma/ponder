import { Mark, mergeAttributes } from "@tiptap/core";

/**
 * Suggested edits ("Suggest edits"): text somebody proposed adding, text they proposed removing, and blocks whose
 * formatting they proposed changing. The names and attributes match @handlewithcare/prosemirror-suggest-changes,
 * which the web editor uses to turn edits into suggestions. Ids are "<user id>:<random>", so a suggestion knows its author.
 */
export const SUGGESTION_MARK_NAMES = ["insertion", "deletion", "modification"] as const;
const SUGGESTION_EXCLUDES = "insertion deletion modification";

/** Who made a suggestion, from its id. */
export const suggestionAuthorId = (id: unknown): string | null => {
  if (typeof id !== "string") return null;
  const separator = id.lastIndexOf(":");
  return separator > 0 ? id.slice(0, separator) : null;
};

const parseId = (value: string | null) => {
  if (!value) return null;
  try {
    const parsed: unknown = JSON.parse(value);
    return typeof parsed === "string" || typeof parsed === "number" ? parsed : null;
  } catch {
    return null;
  }
};

const escapeAttribute = (value: string) => value.replace(/&/g, "&amp;").replace(/"/g, "&quot;").replace(/</g, "&lt;");
const unescapeAttribute = (value: string) => value.replace(/&lt;/g, "<").replace(/&quot;/g, "\"").replace(/&amp;/g, "&");

type MarkdownHelpers = {
  applyMark: (name: string, content: unknown[], attrs?: Record<string, unknown>) => unknown;
  parseInline: (tokens: unknown[]) => unknown[];
};

/** Markdown keeps a suggestion as <ins>/<del> with its id, so saving and reopening a page keeps it. */
const textSuggestion = (name: "insertion" | "deletion", tag: "ins" | "del", className: string) => {
  const pattern = new RegExp(`^<${tag} data-suggestion-id="([^"]*)">([\\s\\S]*?)</${tag}>`);
  return Mark.create({
    name,
    inclusive: false,
    excludes: SUGGESTION_EXCLUDES,
    addAttributes() {
      return {
        id: {
          default: null,
          parseHTML: (element) => parseId(element.getAttribute("data-id")),
          renderHTML: (attributes) => (attributes.id == null ? {} : { "data-id": JSON.stringify(attributes.id) }),
        },
      };
    },
    parseHTML() {
      return [{ tag: `${tag}[data-id]` }];
    },
    renderHTML({ HTMLAttributes }) {
      return [tag, mergeAttributes(HTMLAttributes, { class: className }), 0];
    },
    markdownTokenName: name,
    markdownTokenizer: {
      name,
      level: "inline",
      start: (source: string) => source.indexOf(`<${tag} data-suggestion-id=`),
      tokenize: (source: string, _tokens: unknown[], lexer: { inlineTokens: (text: string) => unknown[] }) => {
        const match = pattern.exec(source);
        if (!match) return undefined;
        return { type: name, raw: match[0], id: parseId(unescapeAttribute(match[1] ?? "")), tokens: lexer.inlineTokens(match[2] ?? "") };
      },
    },
    parseMarkdown: (token: { id?: unknown; tokens?: unknown[] }, helpers: MarkdownHelpers) =>
      helpers.applyMark(name, helpers.parseInline(token.tokens ?? []), { id: token.id ?? null }),
    renderMarkdown: (node: { attrs?: { id?: unknown } }, helpers: { renderChildren: (node: unknown) => string }) => {
      const content = helpers.renderChildren(node);
      const id = node.attrs?.id;
      return id == null ? content : `<${tag} data-suggestion-id="${escapeAttribute(JSON.stringify(id))}">${content}</${tag}>`;
    },
  } as Parameters<typeof Mark.create>[0]);
};

export const InsertionMark = textSuggestion("insertion", "ins", "ponder-suggestion-insert");
export const DeletionMark = textSuggestion("deletion", "del", "ponder-suggestion-delete");

/** A proposed change to a block's type, attributes or marks, keeping what it was so it can be undone. */
export const ModificationMark = Mark.create({
  name: "modification",
  inclusive: false,
  excludes: "insertion deletion",
  addAttributes() {
    return {
      id: { default: null, parseHTML: (element) => parseId(element.getAttribute("data-id")), renderHTML: (attributes) => ({ "data-id": JSON.stringify(attributes.id) }) },
      type: { default: null, parseHTML: (element) => element.getAttribute("data-mod-type"), renderHTML: (attributes) => ({ "data-mod-type": attributes.type }) },
      attrName: { default: null, rendered: false },
      previousValue: { default: null, rendered: false },
      newValue: { default: null, rendered: false },
    };
  },
  parseHTML() {
    return [{ tag: "span[data-type='modification']" }];
  },
  renderHTML({ HTMLAttributes }) {
    return ["span", mergeAttributes(HTMLAttributes, { "data-type": "modification", class: "ponder-suggestion-modify" }), 0];
  },
  renderMarkdown: (node: unknown, helpers: { renderChildren: (node: unknown) => string }) => helpers.renderChildren(node),
} as Parameters<typeof Mark.create>[0]);

export const SuggestionMarks = [InsertionMark, DeletionMark, ModificationMark];
