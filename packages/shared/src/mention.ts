import { mergeAttributes, Node } from "@tiptap/core";
import { isReminderOption, parseMentionDate } from "./mention-reminders";

/*
 * Notion's inline mentions (`@`): a person, a page or a date, optionally with a reminder.
 *
 * Storage: the TipTap JSON keeps a `ponderMention` atom. Markdown keeps a link with a `ponder:`
 * scheme, so AI chat, MCP tools and imports, which all write Markdown, keep the mention:
 *
 *   [@Ada Lovelace](ponder:person/usr_1)
 *   [Reading List](ponder:page/memo_1)
 *   [@November 12, 2026](ponder:date/2026-11-12)
 *   [@November 12, 2026](ponder:date/2026-11-12?remind=onDayOfEvent&at=2026-11-12T08:00:00.000Z&id=rmd_1&by=usr_1)
 *
 * The link text is only a label for readers of the Markdown; a date shows relatively in the editor.
 */

export const MENTION_NODE_TYPE = "ponderMention" as const;
export const MENTION_SCHEME = "ponder:";

export type MentionKind = "person" | "page" | "date";

export type MentionAttributes = {
  kind: MentionKind;
  /** The person's user id, or the page's memo id. Empty for a date. */
  id: string;
  /** The name or title when the mention was made, shown when the live one isn't known. */
  label: string;
  /** "YYYY-MM-DD" for a day, or an ISO instant when the date has a time. */
  date: string;
  includeTime: boolean;
  /** A Remind option name (see mention-reminders.ts), or "" for none. */
  remind: string;
  /** When the reminder fires, as an ISO instant worked out in the setter's time zone. */
  remindAt: string;
  reminderId: string;
  /** Who set the reminder: the person it notifies. */
  remindedBy: string;
};

const EMPTY: MentionAttributes = {
  kind: "person", id: "", label: "", date: "", includeTime: false, remind: "", remindAt: "", reminderId: "", remindedBy: "",
};

const ID_PATTERN = /^[A-Za-z0-9_.:-]{1,128}$/;
const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}(?:T[\d:.]+(?:Z|[+-]\d{2}:?\d{2})?)?$/;

const str = (value: unknown) => (typeof value === "string" ? value : "");

/** Keeps only well-formed values, so a hand-written link can't put markup or junk in the document. */
export const normalizeMentionAttributes = (attrs: Partial<Record<keyof MentionAttributes, unknown>>): MentionAttributes | null => {
  const kind = attrs.kind === "page" || attrs.kind === "date" || attrs.kind === "person" ? attrs.kind : null;
  if (!kind) return null;
  const label = str(attrs.label).replace(/\s+/g, " ").trim().slice(0, 200);
  if (kind === "date") {
    const date = str(attrs.date);
    if (!DATE_PATTERN.test(date) || !parseMentionDate(date)) return null;
    const includeTime = date.includes("T") && attrs.includeTime !== false;
    const remind = isReminderOption(attrs.remind) && attrs.remind !== "none" ? attrs.remind : "";
    const remindAt = remind && !Number.isNaN(Date.parse(str(attrs.remindAt))) ? new Date(str(attrs.remindAt)).toISOString() : "";
    const reminderId = remind && ID_PATTERN.test(str(attrs.reminderId)) ? str(attrs.reminderId) : "";
    const remindedBy = remind && ID_PATTERN.test(str(attrs.remindedBy)) ? str(attrs.remindedBy) : "";
    return { ...EMPTY, kind, label, date, includeTime, remind: remindAt ? remind : "", remindAt, reminderId: remindAt ? reminderId : "", remindedBy: remindAt ? remindedBy : "" };
  }
  const id = str(attrs.id);
  if (!ID_PATTERN.test(id)) return null;
  return { ...EMPTY, kind, id, label };
};

/** The `ponder:` link for a mention. */
export const mentionHref = (attrs: MentionAttributes): string => {
  if (attrs.kind !== "date") return `${MENTION_SCHEME}${attrs.kind}/${encodeURIComponent(attrs.id)}`;
  const params = new URLSearchParams();
  if (attrs.remind && attrs.remindAt) {
    params.set("remind", attrs.remind);
    params.set("at", attrs.remindAt);
    if (attrs.reminderId) params.set("id", attrs.reminderId);
    if (attrs.remindedBy) params.set("by", attrs.remindedBy);
  }
  const query = params.toString();
  return `${MENTION_SCHEME}date/${attrs.date}${query ? `?${query}` : ""}`;
};

export const isMentionHref = (href: unknown): href is string => typeof href === "string" && href.startsWith(MENTION_SCHEME);

/** Reads a `ponder:` link back into a mention; `text` is the link's label. */
export const parseMentionHref = (href: string, text = ""): MentionAttributes | null => {
  if (!isMentionHref(href)) return null;
  const rest = href.slice(MENTION_SCHEME.length);
  const slash = rest.indexOf("/");
  if (slash < 0) return null;
  const kind = rest.slice(0, slash);
  const [path, query = ""] = rest.slice(slash + 1).split("?", 2);
  let value: string;
  try {
    value = decodeURIComponent(path);
  } catch {
    return null;
  }
  const label = text.replace(/^@/, "");
  if (kind === "date") {
    const params = new URLSearchParams(query);
    return normalizeMentionAttributes({
      kind, date: value, label, includeTime: value.includes("T"),
      remind: params.get("remind") ?? "", remindAt: params.get("at") ?? "", reminderId: params.get("id") ?? "", remindedBy: params.get("by") ?? "",
    });
  }
  return normalizeMentionAttributes({ kind, id: value, label });
};

const pad = (value: number) => String(value).padStart(2, "0");

/** "YYYY-MM-DD" for a local day. */
export const toMentionDay = (date: Date) => `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;

const startOfDay = (date: Date) => new Date(date.getFullYear(), date.getMonth(), date.getDate());

/**
 * Notion's "Relative" date format: Today, Tomorrow or Yesterday, otherwise the full date
 * ("November 20, 2026"). A time follows when the date has one ("Tomorrow 3:00 PM").
 */
export const formatMentionDate = (value: string, includeTime: boolean, now = new Date(), locale = "en-US", relative = true): string => {
  const date = parseMentionDate(value);
  if (!date) return value;
  const days = relative ? Math.round((startOfDay(date).getTime() - startOfDay(now).getTime()) / 86_400_000) : Number.NaN;
  const day = days === 0 ? "Today"
    : days === 1 ? "Tomorrow"
    : days === -1 ? "Yesterday"
    : new Intl.DateTimeFormat(locale, { month: "long", day: "numeric", year: "numeric" }).format(date);
  if (!includeTime || !value.includes("T")) return day;
  return `${day} ${new Intl.DateTimeFormat(locale, { hour: "numeric", minute: "2-digit" }).format(date)}`;
};

/**
 * The text a mention stands for, in plain-text views (search, excerpts, notifications, Markdown).
 * Dates are written out in full, since "Tomorrow" in a saved excerpt would soon be wrong.
 */
export const mentionText = (attrs: Partial<MentionAttributes>) => {
  if (attrs.kind === "date") return `@${formatMentionDate(str(attrs.date), Boolean(attrs.includeTime), new Date(), "en-US", false)}`;
  if (attrs.kind === "person") return `@${str(attrs.label) || "someone"}`;
  return str(attrs.label) || "Untitled";
};

const markdownLabel = (value: string) => value.replace(/([\\[\]])/g, "\\$1");

const attributeSpecs = Object.fromEntries(
  (Object.keys(EMPTY) as Array<keyof MentionAttributes>).map((key) => [key, {
    default: EMPTY[key],
    parseHTML: (element: HTMLElement) => {
      const raw = element.getAttribute(`data-mention-${key.replace(/[A-Z]/g, (c) => `-${c.toLowerCase()}`)}`);
      if (key === "includeTime") return raw === "true";
      return raw ?? EMPTY[key];
    },
    renderHTML: (attributes: Record<string, unknown>) => {
      const value = attributes[key];
      if (value === EMPTY[key] || value === undefined || value === null) return {};
      return { [`data-mention-${key.replace(/[A-Z]/g, (c) => `-${c.toLowerCase()}`)}`]: String(value) };
    },
  }]),
);

/** The mention node shared by the editor (which adds a node view) and the Markdown codecs. */
export const Mention = Node.create({
  name: MENTION_NODE_TYPE,
  group: "inline",
  inline: true,
  atom: true,
  selectable: true,
  draggable: false,

  addAttributes() {
    return attributeSpecs;
  },

  parseHTML() {
    return [
      { tag: "span[data-ponder-mention]" },
      {
        // A copied mention pasted somewhere that turned it into a link.
        tag: "a[href^=\"ponder:\"]",
        getAttrs: (element) => {
          const attrs = parseMentionHref((element as HTMLElement).getAttribute("href") ?? "", (element as HTMLElement).textContent ?? "");
          return attrs ?? false;
        },
      },
    ];
  },

  renderHTML({ node, HTMLAttributes }) {
    return [
      "span",
      mergeAttributes(HTMLAttributes, { "data-ponder-mention": node.attrs.kind, class: `ponder-mention ponder-mention-${node.attrs.kind}` }),
      mentionText(node.attrs as MentionAttributes),
    ];
  },

  renderText({ node }) {
    return mentionText(node.attrs as MentionAttributes);
  },

  renderMarkdown(node) {
    const attrs = normalizeMentionAttributes((node.attrs ?? {}) as MentionAttributes);
    if (!attrs) return "";
    const label = attrs.kind === "page" ? attrs.label || "Untitled" : mentionText(attrs);
    return `[${markdownLabel(label)}](${mentionHref(attrs)})`;
  },
});

export type DocMention = MentionAttributes & { /** Text of the block the mention sits in. */ context: string };

type JsonNode = { type?: unknown; text?: unknown; attrs?: Record<string, unknown>; content?: unknown };

const blockText = (node: JsonNode): string => {
  const parts: string[] = [];
  const walk = (current: JsonNode) => {
    if (typeof current.text === "string") parts.push(current.text);
    if (current.type === MENTION_NODE_TYPE && current.attrs) parts.push(mentionText(current.attrs as MentionAttributes));
    if (Array.isArray(current.content)) current.content.forEach((child) => walk(child as JsonNode));
  };
  walk(node);
  return parts.join("").replace(/\s+/g, " ").trim();
};

/** Every mention in a TipTap JSON document, with the text of the block around it. */
export const collectMentions = (doc: unknown): DocMention[] => {
  const found: DocMention[] = [];
  const walk = (node: JsonNode, block: JsonNode | null) => {
    if (!node || typeof node !== "object") return;
    const isTextBlock = Array.isArray(node.content) && node.content.some((child) => {
      const type = (child as JsonNode)?.type;
      return type === "text" || type === MENTION_NODE_TYPE;
    });
    const currentBlock = isTextBlock ? node : block;
    if (node.type === MENTION_NODE_TYPE) {
      const attrs = normalizeMentionAttributes((node.attrs ?? {}) as MentionAttributes);
      if (attrs) found.push({ ...attrs, context: currentBlock ? blockText(currentBlock) : "" });
    }
    if (Array.isArray(node.content)) node.content.forEach((child) => walk(child as JsonNode, currentBlock));
  };
  walk(doc as JsonNode, null);
  return found;
};
