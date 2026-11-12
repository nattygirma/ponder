/**
 * What Notion's Web bookmark card shows for a link: title, description, site icon and image.
 *
 * `bookmarkFallback` and `truncateBookmarkDescription` are adapted from AppFlowy-Web
 * (https://github.com/AppFlowy-IO/AppFlowy-Web), Copyright AppFlowy, AGPL-3.0:
 * src/utils/link-preview.ts (buildFallbackLinkPreviewData, truncateDescription).
 * AppFlowy asks a third-party service (microlink) for the rest; Ponder reads the page's own
 * <head> on its server instead, so links aren't sent to anyone else.
 */
import { normalizeMediaUrl } from "./media-links";

export type WebBookmarkData = {
  url: string;
  title: string;
  description: string;
  /** The site's icon, an absolute https address or "". */
  icon: string;
  /** The page's preview image, an absolute https address or "". */
  image: string;
};

const DESCRIPTION_MAX_LENGTH = 240;
const TITLE_MAX_LENGTH = 300;

const safeDecode = (value: string) => {
  try {
    return decodeURIComponent(value);
  } catch {
    return value;
  }
};

export const truncateBookmarkDescription = (value: string) =>
  value.length <= DESCRIPTION_MAX_LENGTH ? value : `${value.slice(0, DESCRIPTION_MAX_LENGTH - 3).trimEnd()}...`;

/** The card before (or without) the page's own details: the address without its scheme. */
export const bookmarkFallback = (input: string): WebBookmarkData => {
  const url = normalizeMediaUrl(input) ?? input.trim();
  try {
    const parsed = new URL(url);
    const host = parsed.hostname.replace(/^www\./, "");
    const path = parsed.pathname.split("/").filter(Boolean).map(safeDecode).join("/");
    return { url, title: path ? `${host}/${path}` : host || url, description: "", icon: "", image: "" };
  } catch {
    return { url, title: url, description: "", icon: "", image: "" };
  }
};

const NAMED_ENTITIES: Record<string, string> = { amp: "&", lt: "<", gt: ">", quot: "\"", apos: "'", nbsp: " ", "#39": "'" };

const decodeEntities = (value: string) => value.replace(/&(#x[\da-f]+|#\d+|[a-z]+\d*);/gi, (entity, name: string) => {
  const lower = name.toLowerCase();
  if (lower.startsWith("#x")) return String.fromCodePoint(Number.parseInt(lower.slice(2), 16) || 32);
  if (lower.startsWith("#")) return String.fromCodePoint(Number(lower.slice(1)) || 32);
  return NAMED_ENTITIES[lower] ?? entity;
});

const clean = (value: string | undefined, max: number) =>
  decodeEntities(value ?? "").replace(/\s+/g, " ").trim().slice(0, max);

const ATTRIBUTE = /([a-z_:][-\w:.]*)\s*(?:=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'>]+)))?/gi;

const readAttributes = (tag: string) => {
  const attributes: Record<string, string> = {};
  const body = tag.replace(/^<\w+/, "").replace(/\/?>$/, "");
  for (const match of body.matchAll(ATTRIBUTE)) {
    attributes[match[1].toLowerCase()] = match[2] ?? match[3] ?? match[4] ?? "";
  }
  return attributes;
};

/** Only https images, so the card never loads anything insecure or local. */
const absoluteHttps = (value: string, base: string) => {
  if (!value.trim()) return "";
  try {
    const url = new URL(decodeEntities(value.trim()), base);
    return url.protocol === "https:" ? url.href : "";
  } catch {
    return "";
  }
};

/** Reads a page's title, description, icon and image from its <head>. */
export const parseBookmarkHtml = (html: string, pageUrl: string): WebBookmarkData => {
  const fallback = bookmarkFallback(pageUrl);
  const head = (/<head[\s>][\s\S]*?<\/head>/i.exec(html)?.[0] ?? html.slice(0, 200_000));
  const meta = new Map<string, string>();
  for (const tag of head.match(/<meta\b[^>]*>/gi) ?? []) {
    const attributes = readAttributes(tag);
    const key = (attributes.property ?? attributes.name ?? attributes.itemprop ?? "").toLowerCase();
    if (key && attributes.content !== undefined && !meta.has(key)) meta.set(key, attributes.content);
  }
  let icon = "";
  let base = pageUrl;
  const baseHref = /<base\b[^>]*>/i.exec(head)?.[0];
  if (baseHref) base = absoluteHttps(readAttributes(baseHref).href ?? "", pageUrl) || pageUrl;
  for (const tag of head.match(/<link\b[^>]*>/gi) ?? []) {
    const attributes = readAttributes(tag);
    const rel = (attributes.rel ?? "").toLowerCase().split(/\s+/);
    if (!rel.includes("icon") && !rel.includes("apple-touch-icon")) continue;
    const href = absoluteHttps(attributes.href ?? "", base);
    // A plain "icon" wins over apple-touch-icon, which is often large and padded.
    if (href && (!icon || rel.includes("icon"))) icon = href;
    if (icon && rel.includes("icon")) break;
  }
  if (!icon) icon = absoluteHttps("/favicon.ico", base);
  const title = clean(meta.get("og:title") ?? meta.get("twitter:title") ?? /<title\b[^>]*>([\s\S]*?)<\/title>/i.exec(head)?.[1], TITLE_MAX_LENGTH);
  const description = clean(meta.get("og:description") ?? meta.get("twitter:description") ?? meta.get("description"), 1000);
  const image = absoluteHttps(meta.get("og:image:secure_url") ?? meta.get("og:image") ?? meta.get("twitter:image") ?? meta.get("twitter:image:src") ?? "", base);
  return {
    url: fallback.url,
    title: title || fallback.title,
    description: truncateBookmarkDescription(description),
    icon,
    image,
  };
};
