/**
 * Link rules for Notion's media blocks (/image, /video, /audio, /file, /bookmark) and their
 * "Link" tab: which addresses are accepted, and which videos play in a frame.
 *
 * `normalizeMediaUrl` and the audio extension rule are adapted from AppFlowy-Web
 * (https://github.com/AppFlowy-IO/AppFlowy-Web), Copyright AppFlowy, AGPL-3.0:
 * src/utils/url.ts (processUrl) and
 * src/components/editor/components/block-popover/AudioBlockPopoverContent.tsx (isAudioUrl).
 * The YouTube, Vimeo and Loom rules are Ponder's own, since AppFlowy hands those to react-player.
 */

const FQDN = /^(?=.{1,253}$)(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}$/i;
const IPV4 = /^(?:\d{1,3}\.){3}\d{1,3}$/;

/**
 * Adds `https://` to an address typed without one ("youtube.com/watch?v=…"), as AppFlowy's
 * processUrl does. Returns null for anything that isn't an http(s) address.
 */
export const normalizeMediaUrl = (input: string): string | null => {
  const value = input.trim();
  // oxlint-disable-next-line no-control-regex -- rejects addresses with spaces or control characters
  if (!value || /[\u0000- <>"`]/.test(value)) return null;
  const candidate = /^[a-z][a-z0-9+.-]*:/i.test(value)
    ? value
    : FQDN.test(value.split(/[/?#]/)[0] ?? "") || IPV4.test(value.split(/[/?#:]/)[0] ?? "") ? `https://${value}` : null;
  if (!candidate) return null;
  try {
    const url = new URL(candidate);
    if (url.protocol !== "http:" && url.protocol !== "https:") return null;
    if (!url.hostname) return null;
    return url.href;
  } catch {
    return null;
  }
};

export type VideoEmbedProvider = "youtube" | "vimeo" | "loom";
export type VideoEmbedTarget = { provider: VideoEmbedProvider; embedUrl: string };

const YOUTUBE_ID = /^[\w-]{11}$/;

/** Seconds from YouTube's `t` / `start` (`90`, `90s`, `1m30s`, `1h2m3s`). */
const youtubeStart = (value: string | null) => {
  if (!value) return 0;
  if (/^\d+$/.test(value)) return Number(value);
  const match = /^(?:(\d+)h)?(?:(\d+)m)?(?:(\d+)s)?$/.exec(value);
  if (!match || !match[0]) return 0;
  return Number(match[1] ?? 0) * 3600 + Number(match[2] ?? 0) * 60 + Number(match[3] ?? 0);
};

/** The player address for a YouTube, Vimeo or Loom link, or null for any other link. */
export const parseVideoEmbed = (input: string): VideoEmbedTarget | null => {
  const normalized = normalizeMediaUrl(input);
  if (!normalized) return null;
  const url = new URL(normalized);
  const host = url.hostname.toLowerCase().replace(/^(www\.|m\.)/, "");
  const segments = url.pathname.split("/").filter(Boolean);

  if (host === "youtu.be" || host === "youtube.com" || host === "youtube-nocookie.com" || host === "music.youtube.com") {
    let id = "";
    if (host === "youtu.be") id = segments[0] ?? "";
    else if (segments[0] === "watch") id = url.searchParams.get("v") ?? segments[1] ?? "";
    else if (["embed", "shorts", "live", "v"].includes(segments[0] ?? "")) id = segments[1] ?? "";
    if (!YOUTUBE_ID.test(id)) return null;
    const start = youtubeStart(url.searchParams.get("t") ?? url.searchParams.get("start"));
    return { provider: "youtube", embedUrl: `https://www.youtube.com/embed/${id}${start ? `?start=${start}` : ""}` };
  }

  if (host === "vimeo.com" || host === "player.vimeo.com") {
    const videoIndex = host === "player.vimeo.com"
      ? (segments[0] === "video" ? 1 : -1)
      : segments.findIndex((segment) => /^\d+$/.test(segment));
    const id = videoIndex >= 0 ? segments[videoIndex] ?? "" : "";
    if (!/^\d+$/.test(id)) return null;
    // Unlisted videos carry a hash, as a path segment (vimeo.com/123/abc) or as ?h=.
    const hash = url.searchParams.get("h") ?? (host === "vimeo.com" && /^[\da-f]+$/i.test(segments[videoIndex + 1] ?? "") ? segments[videoIndex + 1] : "");
    return { provider: "vimeo", embedUrl: `https://player.vimeo.com/video/${id}${hash ? `?h=${encodeURIComponent(hash)}` : ""}` };
  }

  if (host === "loom.com") {
    if (segments[0] !== "share" && segments[0] !== "embed") return null;
    const id = segments[1] ?? "";
    if (!/^[\da-f]{16,64}$/i.test(id)) return null;
    return { provider: "loom", embedUrl: `https://www.loom.com/embed/${id}` };
  }

  return null;
};

const AUDIO_EXTENSION = /\.(mp3|wav|ogg|oga|flac|aac|wma|alac|aiff|m4a|opus|weba)($|[?#])/i;
const VIDEO_EXTENSION = /\.(mp4|webm|mov|m4v|ogv)($|[?#])/i;

export const isAudioUrl = (input: string) => {
  const url = normalizeMediaUrl(input);
  return Boolean(url && AUDIO_EXTENSION.test(new URL(url).pathname));
};

export const isVideoFileUrl = (input: string) => {
  const url = normalizeMediaUrl(input);
  return Boolean(url && VIDEO_EXTENSION.test(new URL(url).pathname));
};

/** The last path segment, decoded, as a file name for a linked file. */
export const fileNameFromUrl = (input: string, fallback = "file") => {
  const url = normalizeMediaUrl(input);
  if (!url) return fallback;
  try {
    const name = decodeURIComponent(new URL(url).pathname.split("/").filter(Boolean).pop() ?? "").trim();
    return name && name.length <= 160 ? name : fallback;
  } catch {
    return fallback;
  }
};

/** What a link in each media block's Link tab may be. */
export type MediaKind = "image" | "video" | "audio" | "file" | "bookmark";

export const MEDIA_KINDS: readonly MediaKind[] = ["image", "video", "audio", "file", "bookmark"];

export const isMediaKind = (value: unknown): value is MediaKind => typeof value === "string" && (MEDIA_KINDS as readonly string[]).includes(value);

/** Notion accepts any web address for an image or file, and checks the rest by kind. */
export const isValidMediaLink = (kind: MediaKind, input: string) => {
  if (!normalizeMediaUrl(input)) return false;
  if (kind === "video") return Boolean(parseVideoEmbed(input)) || isVideoFileUrl(input);
  if (kind === "audio") return isAudioUrl(input);
  return true;
};
