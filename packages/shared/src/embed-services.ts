/**
 * Notion's Embeds: the generic /embed and one item per named service, in the order of Notion's `/`
 * menu, with the link rules that turn a share link into the address of the service's own frame.
 *
 * A service with a public embed frame plays inside a sandboxed iframe. One that only works for
 * signed-in people (Slack, Jira, GitHub…) becomes a Web bookmark card instead, as Notion shows a
 * link preview card for those. Links the rules don't know are framed as they are, after the server
 * checks that the site allows framing (`frameable` from POST /api/v1/web-bookmark).
 *
 * The Google Drive rule is adapted from AppFlowy-Web; see `google-drive-embed.ts`. AppFlowy has no
 * other named embeds, so the rest of this file is Ponder's own.
 */
import { buildGoogleDriveEmbedUrl } from "./google-drive-embed";
import { normalizeMediaUrl, parseVideoEmbed } from "./media-links";

export const EMBED_SERVICE_IDS = [
  "googleDrive", "tweet", "githubGist", "googleMaps", "figma", "abstract", "invision", "mixpanel", "framer", "whimsical",
  "miro", "sketch", "excalidraw", "pdf", "loom", "typeform", "codepen", "replit", "hex", "deepnote",
  "slack", "trello", "pitch", "onedrive", "dropbox", "amplitude", "claap", "box", "linear", "lucidchart",
  "lucidspark", "eraser", "clickup", "plus", "dovetail", "streak", "shortcut", "sendowl", "amplitudeEu", "zendesk",
  "googleContacts", "discord", "microsoftContacts", "pagerduty", "asana", "gitlab", "zoom", "adobeXd", "jira", "github",
] as const;

export type EmbedServiceId = (typeof EMBED_SERVICE_IDS)[number];

export const isEmbedServiceId = (value: unknown): value is EmbedServiceId =>
  typeof value === "string" && (EMBED_SERVICE_IDS as readonly string[]).includes(value);

/** What a service does with a link its rule doesn't turn into an embed address. */
type Otherwise = "frame" | "bookmark";

export type EmbedService = {
  id: EmbedServiceId;
  /** Notion's label in the `/` menu. */
  label: string;
  /** Extra words the `/` search finds it by. */
  keywords: string[];
  /** The link field's placeholder, a sample address. */
  example: string;
  /** The frame's height when it goes in, in pixels. */
  height: number;
  /** Whether a link belongs to this service. */
  matches: (url: URL) => boolean;
  /** The embed address for one of its links, or null when the link has none. */
  embed?: (url: URL) => string | null;
  /** Without an embed address: frame the link itself, or show a bookmark card. */
  otherwise: Otherwise;
};

const host = (url: URL) => url.hostname.toLowerCase().replace(/^www\./, "");
const onHost = (...names: string[]) => (url: URL) => names.some((name) => host(url) === name || host(url).endsWith(`.${name}`));
const segmentsOf = (url: URL) => url.pathname.split("/").filter(Boolean);
const SAFE_SEGMENT = /^[\w.~@=-]+$/;
const safe = (value: string | undefined) => (value && SAFE_SEGMENT.test(value) ? value : null);

const tweetEmbed = (url: URL) => {
  const segments = segmentsOf(url);
  const index = segments.findIndex((segment) => segment === "status" || segment === "statuses");
  const id = index >= 0 ? segments[index + 1] : undefined;
  return id && /^\d{1,25}$/.test(id) ? `https://platform.twitter.com/embed/Tweet.html?id=${id}&dnt=true` : null;
};

const gistEmbed = (url: URL) => {
  const segments = segmentsOf(url);
  const id = (segments.length >= 2 ? segments[1] : segments[0])?.replace(/\.(pibb|js)$/, "");
  if (!id || !/^[\da-f]{5,64}$/i.test(id)) return null;
  // `.pibb` is GitHub's frameable page for a gist; `.js` would need a script on Ponder's page.
  return segments.length >= 2 && safe(segments[0]) ? `https://gist.github.com/${segments[0]}/${id}.pibb` : `https://gist.github.com/${id}.pibb`;
};

const googleMapsEmbed = (url: URL) => {
  const segments = segmentsOf(url);
  if (host(url) === "google.com" && segments[0] !== "maps") return null;
  if (segments[1] === "embed") return url.href.replace(/^http:/, "https:");
  const at = segments.find((segment) => segment.startsWith("@"));
  const coordinates = at ? /^@(-?\d+(?:\.\d+)?),(-?\d+(?:\.\d+)?)(?:,(\d+(?:\.\d+)?)z)?/.exec(at) : null;
  const decode = (value: string) => {
    try {
      return decodeURIComponent(value.replace(/\+/g, " "));
    } catch {
      return value.replace(/\+/g, " ");
    }
  };
  let query = url.searchParams.get("q") ?? url.searchParams.get("query") ?? "";
  const named = segments.findIndex((segment) => segment === "place" || segment === "search");
  if (!query && named >= 0 && segments[named + 1] && !segments[named + 1].startsWith("@")) query = decode(segments[named + 1]);
  if (!query && coordinates) query = `${coordinates[1]},${coordinates[2]}`;
  if (!query) return null;
  const zoom = coordinates?.[3] ? Math.round(Number(coordinates[3])) : 0;
  return `https://maps.google.com/maps?q=${encodeURIComponent(query)}${zoom ? `&z=${zoom}` : ""}&output=embed`;
};

const FIGMA_KINDS = new Set(["file", "design", "proto", "board", "slides", "deck", "community"]);
const figmaEmbed = (url: URL) =>
  FIGMA_KINDS.has(segmentsOf(url)[0] ?? "") ? `https://www.figma.com/embed?embed_host=ponder&url=${encodeURIComponent(url.href)}` : null;

const abstractEmbed = (url: URL) => {
  const segments = segmentsOf(url);
  const id = segments[0] === "share" || segments[0] === "embed" ? safe(segments[1]) : null;
  return id ? `https://${url.host}/embed/${id}` : null;
};

const mixpanelEmbed = (url: URL) => (["p", "public"].includes(segmentsOf(url)[0] ?? "") ? url.href : null);

const whimsicalEmbed = (url: URL) => {
  const segments = segmentsOf(url);
  if (segments[0] === "embed") return safe(segments[1]) ? url.href : null;
  const last = segments.at(-1) ?? "";
  const id = safe(last.includes("-") ? last.slice(last.lastIndexOf("-") + 1) : last);
  return id ? `https://whimsical.com/embed/${id}` : null;
};

const miroEmbed = (url: URL) => {
  const segments = segmentsOf(url);
  const index = segments.findIndex((segment) => segment === "board" || segment === "live-embed");
  const id = index >= 0 ? safe(segments[index + 1]) : null;
  return id ? `https://miro.com/app/live-embed/${id}/?embedMode=view_only_without_ui` : null;
};

const sketchEmbed = (url: URL) => {
  const segments = segmentsOf(url);
  const start = segments[0] === "embed" ? 1 : 0;
  if (segments[start] !== "s" || !safe(segments[start + 1])) return null;
  return `https://www.sketch.com/embed/${segments.slice(start).filter((segment) => safe(segment)).join("/")}`;
};

const typeformEmbed = (url: URL) => (segmentsOf(url)[0] === "to" && safe(segmentsOf(url)[1]) ? url.href : null);

const codepenEmbed = (url: URL) => {
  const [user, kind, id] = segmentsOf(url);
  if (!safe(user) || !["pen", "full", "details", "embed", "debug"].includes(kind ?? "") || !safe(id)) return null;
  const pen = kind === "embed" && id === "preview" ? safe(segmentsOf(url)[3]) : id;
  return pen ? `https://codepen.io/${user}/embed/preview/${pen}?default-tab=result` : null;
};

const replitEmbed = (url: URL) => {
  const [user, repl] = segmentsOf(url);
  if (!user?.startsWith("@") || !safe(user) || !safe(repl)) return null;
  return `https://replit.com/${user}/${repl}?embed=true`;
};

const hexEmbed = (url: URL) => {
  const segments = segmentsOf(url);
  const index = segments.findIndex((segment) => segment === "app" || segment === "embed");
  if (index < 0 || !safe(segments[index + 1])) return null;
  const next = [...segments];
  next[index] = "embed";
  return `https://${url.host}/${next.filter((segment) => safe(segment)).join("/")}`;
};

const trelloEmbed = (url: URL) => {
  const [kind, id] = segmentsOf(url);
  const board = id?.replace(/\.html$/, "");
  return kind === "b" && board && /^[\w-]{6,32}$/.test(board) ? `https://trello.com/b/${board}.html` : null;
};

const pitchEmbed = (url: URL) => {
  const [kind, id] = segmentsOf(url);
  if ((kind === "public" || kind === "embed") && safe(id)) return `https://pitch.com/embed/${id}`;
  return null;
};

const oneDriveEmbed = (url: URL) => {
  if (host(url) !== "onedrive.live.com") return null;
  const params = new URLSearchParams();
  for (const key of ["cid", "resid", "authkey", "id", "redeem", "em"]) {
    const value = url.searchParams.get(key);
    if (value) params.set(key, value);
  }
  return params.has("resid") || params.has("id") || params.has("redeem") ? `https://onedrive.live.com/embed?${params}` : null;
};

const amplitudeEmbed = (url: URL) => {
  const path = url.pathname;
  if (!/\/share\//.test(path)) return null;
  return `https://${url.host}${path.replace(/\/share\/(?!embed\/)/, "/share/embed/")}`;
};

const boxEmbed = (url: URL) => {
  const [kind, id] = segmentsOf(url);
  if (kind === "s" && safe(id)) return `https://app.box.com/embed/s/${id}`;
  if (kind === "embed" && segmentsOf(url)[1] === "s" && safe(segmentsOf(url)[2])) return `https://app.box.com/embed/s/${segmentsOf(url)[2]}`;
  return null;
};

const lucidEmbed = (url: URL) => {
  const segments = segmentsOf(url);
  const index = segments.findIndex((segment) => ["lucidchart", "lucidspark", "embeddedchart", "embedded"].includes(segment));
  const id = index >= 0 ? safe(segments[index + 1]) : null;
  return id && /^[\da-f-]{8,64}$/i.test(id) ? `https://lucid.app/documents/embeddedchart/${id}` : null;
};

const clickupEmbed = (url: URL) => (host(url) === "sharing.clickup.com" ? url.href : null);

const discordEmbed = (url: URL) => {
  if (segmentsOf(url)[0] !== "widget") return null;
  const id = url.searchParams.get("id");
  return id && /^\d{5,25}$/.test(id) ? `https://discord.com/widget?id=${id}&theme=${url.searchParams.get("theme") === "light" ? "light" : "dark"}` : null;
};

const adobeXdEmbed = (url: URL) => {
  const [kind, id] = segmentsOf(url);
  return (kind === "view" || kind === "embed") && safe(id) ? `https://xd.adobe.com/embed/${id}` : null;
};

const PASTE = "Paste in https://…";

/** Notion's Embeds group, in its order. */
export const EMBED_SERVICES: readonly EmbedService[] = [
  { id: "googleDrive", label: "Google Drive", keywords: ["drive", "docs", "sheets", "slides", "google"], example: PASTE, height: 480, matches: onHost("drive.google.com", "docs.google.com", "sheets.google.com", "slides.google.com", "forms.google.com"), embed: (url) => buildGoogleDriveEmbedUrl(url.href), otherwise: "bookmark" },
  { id: "tweet", label: "Tweet", keywords: ["twitter", "x", "post"], example: "https://twitter.com/… or https://x.com/", height: 560, matches: onHost("twitter.com", "x.com"), embed: tweetEmbed, otherwise: "bookmark" },
  { id: "githubGist", label: "GitHub Gist", keywords: ["gist", "code", "snippet"], example: "https://gist.github.com/…", height: 360, matches: onHost("gist.github.com"), embed: gistEmbed, otherwise: "bookmark" },
  { id: "googleMaps", label: "Google Maps", keywords: ["map", "location", "place"], example: "https://www.google.com/maps…", height: 400, matches: (url) => onHost("maps.google.com")(url) || (host(url) === "google.com" && segmentsOf(url)[0] === "maps"), embed: googleMapsEmbed, otherwise: "bookmark" },
  { id: "figma", label: "Figma", keywords: ["design", "prototype"], example: PASTE, height: 450, matches: onHost("figma.com"), embed: figmaEmbed, otherwise: "bookmark" },
  { id: "abstract", label: "Abstract", keywords: ["design"], example: PASTE, height: 450, matches: onHost("abstract.com", "goabstract.com"), embed: abstractEmbed, otherwise: "bookmark" },
  { id: "invision", label: "Invision", keywords: ["design", "prototype"], example: PASTE, height: 450, matches: onHost("invisionapp.com", "invis.io"), otherwise: "frame" },
  { id: "mixpanel", label: "Mixpanel", keywords: ["analytics", "report"], example: PASTE, height: 450, matches: onHost("mixpanel.com"), embed: mixpanelEmbed, otherwise: "bookmark" },
  { id: "framer", label: "Framer", keywords: ["prototype", "site"], example: PASTE, height: 450, matches: onHost("framer.com", "framer.app", "framer.website", "framer.ai"), otherwise: "frame" },
  { id: "whimsical", label: "Whimsical", keywords: ["flowchart", "wireframe", "board"], example: PASTE, height: 450, matches: onHost("whimsical.com"), embed: whimsicalEmbed, otherwise: "bookmark" },
  { id: "miro", label: "Miro", keywords: ["whiteboard", "board"], example: "https://miro.com/app/board/…", height: 450, matches: onHost("miro.com"), embed: miroEmbed, otherwise: "bookmark" },
  { id: "sketch", label: "Sketch", keywords: ["design"], example: PASTE, height: 450, matches: onHost("sketch.com"), embed: sketchEmbed, otherwise: "bookmark" },
  { id: "excalidraw", label: "Excalidraw", keywords: ["whiteboard", "drawing", "diagram"], example: PASTE, height: 450, matches: onHost("excalidraw.com"), otherwise: "frame" },
  { id: "pdf", label: "PDF", keywords: ["pdf", "document"], example: PASTE, height: 600, matches: (url) => /\.pdf$/i.test(url.pathname), otherwise: "frame" },
  { id: "loom", label: "Loom", keywords: ["video", "recording"], example: PASTE, height: 400, matches: onHost("loom.com"), embed: (url) => parseVideoEmbed(url.href)?.embedUrl ?? null, otherwise: "bookmark" },
  { id: "typeform", label: "Typeform", keywords: ["form", "survey"], example: PASTE, height: 500, matches: onHost("typeform.com"), embed: typeformEmbed, otherwise: "bookmark" },
  { id: "codepen", label: "CodePen", keywords: ["code", "pen", "demo"], example: PASTE, height: 300, matches: onHost("codepen.io"), embed: codepenEmbed, otherwise: "bookmark" },
  { id: "replit", label: "Replit", keywords: ["code", "repl"], example: PASTE, height: 450, matches: onHost("replit.com", "repl.it"), embed: replitEmbed, otherwise: "bookmark" },
  { id: "hex", label: "Hex", keywords: ["notebook", "data"], example: PASTE, height: 450, matches: onHost("hex.tech"), embed: hexEmbed, otherwise: "bookmark" },
  { id: "deepnote", label: "Deepnote", keywords: ["notebook", "data"], example: PASTE, height: 450, matches: onHost("deepnote.com"), otherwise: "frame" },
  { id: "slack", label: "Slack", keywords: ["message", "chat"], example: PASTE, height: 0, matches: onHost("slack.com"), otherwise: "bookmark" },
  { id: "trello", label: "Trello", keywords: ["board", "kanban"], example: PASTE, height: 450, matches: onHost("trello.com"), embed: trelloEmbed, otherwise: "bookmark" },
  { id: "pitch", label: "Pitch", keywords: ["presentation", "slides", "deck"], example: PASTE, height: 400, matches: onHost("pitch.com"), embed: pitchEmbed, otherwise: "frame" },
  { id: "onedrive", label: "OneDrive", keywords: ["microsoft", "office", "file"], example: PASTE, height: 480, matches: onHost("onedrive.live.com", "1drv.ms"), embed: oneDriveEmbed, otherwise: "bookmark" },
  { id: "dropbox", label: "Dropbox", keywords: ["file"], example: PASTE, height: 0, matches: onHost("dropbox.com", "db.tt"), otherwise: "bookmark" },
  { id: "amplitude", label: "Amplitude", keywords: ["analytics", "chart"], example: PASTE, height: 450, matches: (url) => onHost("amplitude.com")(url) && !host(url).includes(".eu."), embed: amplitudeEmbed, otherwise: "bookmark" },
  { id: "claap", label: "Claap", keywords: ["video", "recording"], example: PASTE, height: 400, matches: onHost("claap.io"), otherwise: "frame" },
  { id: "box", label: "Box", keywords: ["file"], example: PASTE, height: 480, matches: onHost("box.com"), embed: boxEmbed, otherwise: "bookmark" },
  { id: "linear", label: "Linear", keywords: ["issue", "ticket"], example: PASTE, height: 0, matches: onHost("linear.app"), otherwise: "bookmark" },
  { id: "lucidchart", label: "Lucidchart", keywords: ["diagram", "flowchart", "lucid"], example: PASTE, height: 450, matches: (url) => onHost("lucidchart.com")(url) || (onHost("lucid.app")(url) && !url.pathname.includes("/lucidspark/")), embed: lucidEmbed, otherwise: "bookmark" },
  { id: "lucidspark", label: "Lucidspark", keywords: ["whiteboard", "lucid"], example: PASTE, height: 450, matches: (url) => onHost("lucidspark.com")(url) || (onHost("lucid.app")(url) && url.pathname.includes("/lucidspark/")), embed: lucidEmbed, otherwise: "bookmark" },
  { id: "eraser", label: "Eraser", keywords: ["diagram", "whiteboard"], example: PASTE, height: 450, matches: onHost("eraser.io"), otherwise: "frame" },
  { id: "clickup", label: "ClickUp", keywords: ["task", "project"], example: PASTE, height: 450, matches: onHost("clickup.com"), embed: clickupEmbed, otherwise: "bookmark" },
  { id: "plus", label: "Plus", keywords: ["snapshot", "plus docs"], example: PASTE, height: 450, matches: onHost("plusdocs.com"), otherwise: "frame" },
  { id: "dovetail", label: "Dovetail", keywords: ["research", "insight"], example: PASTE, height: 450, matches: onHost("dovetail.com", "dovetailapp.com"), otherwise: "frame" },
  { id: "streak", label: "Streak Share", keywords: ["streak", "crm", "gmail"], example: PASTE, height: 0, matches: onHost("streak.com"), otherwise: "bookmark" },
  { id: "shortcut", label: "Shortcut", keywords: ["story", "issue"], example: PASTE, height: 0, matches: onHost("shortcut.com", "app.shortcut.com"), otherwise: "bookmark" },
  { id: "sendowl", label: "SendOwl", keywords: ["shop", "product", "checkout"], example: PASTE, height: 450, matches: onHost("sendowl.com"), otherwise: "frame" },
  { id: "amplitudeEu", label: "Amplitude - EU", keywords: ["analytics", "chart", "europe"], example: PASTE, height: 450, matches: (url) => onHost("amplitude.com")(url) && host(url).includes(".eu."), embed: amplitudeEmbed, otherwise: "bookmark" },
  { id: "zendesk", label: "Zendesk", keywords: ["ticket", "support"], example: PASTE, height: 0, matches: onHost("zendesk.com"), otherwise: "bookmark" },
  { id: "googleContacts", label: "Google Contacts", keywords: ["contact", "people"], example: PASTE, height: 0, matches: onHost("contacts.google.com"), otherwise: "bookmark" },
  { id: "discord", label: "Discord", keywords: ["chat", "server", "message"], example: PASTE, height: 500, matches: onHost("discord.com", "discord.gg", "discordapp.com"), embed: discordEmbed, otherwise: "bookmark" },
  { id: "microsoftContacts", label: "Microsoft Contacts", keywords: ["contact", "people", "outlook"], example: PASTE, height: 0, matches: (url) => (onHost("outlook.live.com", "outlook.office.com", "outlook.office365.com")(url) && url.pathname.includes("/people")), otherwise: "bookmark" },
  { id: "pagerduty", label: "PagerDuty", keywords: ["incident", "alert"], example: PASTE, height: 0, matches: onHost("pagerduty.com"), otherwise: "bookmark" },
  { id: "asana", label: "Asana", keywords: ["task", "project"], example: PASTE, height: 0, matches: onHost("asana.com"), otherwise: "bookmark" },
  { id: "gitlab", label: "GitLab", keywords: ["merge request", "issue", "code"], example: PASTE, height: 0, matches: onHost("gitlab.com"), otherwise: "bookmark" },
  { id: "zoom", label: "Zoom", keywords: ["meeting", "call"], example: PASTE, height: 0, matches: onHost("zoom.us", "zoom.com"), otherwise: "bookmark" },
  { id: "adobeXd", label: "Adobe XD", keywords: ["design", "prototype", "xd"], example: PASTE, height: 450, matches: onHost("xd.adobe.com"), embed: adobeXdEmbed, otherwise: "bookmark" },
  { id: "jira", label: "Jira", keywords: ["issue", "ticket", "atlassian"], example: PASTE, height: 0, matches: onHost("atlassian.net", "jira.com"), otherwise: "bookmark" },
  { id: "github", label: "GitHub", keywords: ["pull request", "issue", "repository", "code"], example: PASTE, height: 0, matches: (url) => onHost("github.com")(url) && host(url) !== "gist.github.com", otherwise: "bookmark" },
];

const SERVICES_BY_ID = new Map(EMBED_SERVICES.map((service) => [service.id, service]));

export const getEmbedService = (id: unknown) => (isEmbedServiceId(id) ? SERVICES_BY_ID.get(id) ?? null : null);

/** Services whose links always become a bookmark card: they have no public embed frame. */
export const isBookmarkOnlyService = (service: EmbedService) => !service.embed && service.otherwise === "bookmark";

/** The generic frame height, as Notion's. */
export const DEFAULT_EMBED_HEIGHT = 400;
export const MIN_EMBED_HEIGHT = 120;
export const MAX_EMBED_HEIGHT = 2000;
/** Width is stored as a percentage of the column, as AppFlowy's `width_factor` (times 100). */
export const MIN_EMBED_WIDTH = 10;

export type EmbedTarget =
  /** A frame. `video` keeps the player's 16:9 shape; `checkFraming` asks the server first. */
  | { kind: "frame"; service: EmbedServiceId | null; embedUrl: string; height: number; video: boolean; checkFraming: boolean }
  | { kind: "pdf"; service: "pdf"; url: string }
  | { kind: "bookmark"; service: EmbedServiceId | null; url: string };

/** The named service a link belongs to, if any. */
export const findEmbedService = (input: string): EmbedService | null => {
  const normalized = normalizeMediaUrl(input);
  if (!normalized) return null;
  const url = new URL(normalized);
  return EMBED_SERVICES.find((service) => service.matches(url)) ?? null;
};

/**
 * What a link becomes in an embed block. `serviceId` is the `/` item it was pasted into; a link
 * from another service is still handled by that service's rule, as Notion's Embed accepts any link.
 * Null when the input isn't a web address.
 */
export const resolveEmbed = (input: string, serviceId?: EmbedServiceId | null): EmbedTarget | null => {
  const normalized = normalizeMediaUrl(input);
  if (!normalized) return null;
  const url = new URL(normalized);
  const video = parseVideoEmbed(normalized);
  if (video) return { kind: "frame", service: video.provider === "loom" ? "loom" : null, embedUrl: video.embedUrl, height: 0, video: true, checkFraming: false };
  const named = getEmbedService(serviceId);
  const service = named?.matches(url) ? named : EMBED_SERVICES.find((candidate) => candidate.matches(url)) ?? null;
  if (service?.id === "pdf") return { kind: "pdf", service: "pdf", url: normalized };
  if (!service) return { kind: "frame", service: null, embedUrl: normalized, height: DEFAULT_EMBED_HEIGHT, video: false, checkFraming: true };
  const embedUrl = service.embed?.(url) ?? null;
  if (embedUrl) return { kind: "frame", service: service.id, embedUrl, height: service.height || DEFAULT_EMBED_HEIGHT, video: false, checkFraming: false };
  if (service.otherwise === "frame") return { kind: "frame", service: service.id, embedUrl: normalized, height: service.height || DEFAULT_EMBED_HEIGHT, video: false, checkFraming: true };
  return { kind: "bookmark", service: service.id, url: normalized };
};

/**
 * Whether the link field of a `/` item accepts a link. Notion's generic Embed takes any web
 * address; a named item takes its own service's links (and, for PDF, any PDF address).
 */
export const isValidEmbedLink = (serviceId: EmbedServiceId | null | undefined, input: string) => {
  const normalized = normalizeMediaUrl(input);
  if (!normalized) return false;
  const service = getEmbedService(serviceId);
  if (!service) return true;
  const url = new URL(normalized);
  if (service.id === "loom") return Boolean(parseVideoEmbed(normalized));
  return service.matches(url);
};

/** The frame's width (percent of the column) and height (px), clamped as stored. */
export const clampEmbedSize = (width: unknown, height: unknown) => {
  const w = Number(width);
  const h = Number(height);
  return {
    width: Number.isFinite(w) && w > 0 ? Math.round(Math.min(100, Math.max(MIN_EMBED_WIDTH, w))) : 100,
    height: Number.isFinite(h) && h > 0 ? Math.round(Math.min(MAX_EMBED_HEIGHT, Math.max(MIN_EMBED_HEIGHT, h))) : 0,
  };
};

/** The sandbox every embed frame gets: scripts and the provider's own storage, no top navigation. */
export const EMBED_SANDBOX = "allow-scripts allow-same-origin allow-presentation allow-popups allow-popups-to-escape-sandbox allow-forms";
export const EMBED_ALLOW = "fullscreen; picture-in-picture; encrypted-media; clipboard-write";

/** The height X's Tweet frame asks for in its resize message, or 0. */
export const readTweetHeight = (data: unknown): number => {
  let message = data;
  if (typeof message === "string") {
    try {
      message = JSON.parse(message);
    } catch {
      return 0;
    }
  }
  const embed = (message as { "twttr.embed"?: { method?: string; params?: Array<{ height?: unknown }> } } | null)?.["twttr.embed"];
  if (embed?.method !== "twttr.private.resize") return 0;
  const height = Number(embed.params?.[0]?.height);
  return Number.isFinite(height) && height > 0 ? Math.min(MAX_EMBED_HEIGHT, Math.ceil(height)) : 0;
};
