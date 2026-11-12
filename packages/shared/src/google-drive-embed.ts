/**
 * Turns a Google Drive, Docs, Sheets, Slides or Forms share link into the address of its preview
 * frame, for Notion's /Google Drive embed.
 *
 * Adapted from AppFlowy-Web (https://github.com/AppFlowy-IO/AppFlowy-Web), Copyright AppFlowy, AGPL-3.0:
 * src/components/editor/components/blocks/google-drive/google-drive-utils.ts
 * (isGoogleDriveUrl, getGoogleDriveFileId, buildGoogleDriveEmbeddedUrl). AppFlowy's `processUrl`
 * became Ponder's `normalizeMediaUrl`, and the builder returns null instead of the raw link when a
 * link has no file id, so the caller can fall back to a bookmark.
 */
import { normalizeMediaUrl } from "./media-links";

const SUPPORTED_GOOGLE_DRIVE_HOSTS = [
  "drive.google.com",
  "docs.google.com",
  "sheets.google.com",
  "slides.google.com",
  "forms.google.com",
];

const parseGoogleDriveUrl = (rawUrl: string) => {
  const processed = normalizeMediaUrl(rawUrl);
  if (!processed) return null;
  try {
    return new URL(processed);
  } catch {
    return null;
  }
};

export const isGoogleDriveUrl = (rawUrl: string) => {
  const url = parseGoogleDriveUrl(rawUrl);
  if (!url || url.username || url.password || !["https:", "http:"].includes(url.protocol)) return false;
  const host = url.hostname.toLowerCase();
  if (!SUPPORTED_GOOGLE_DRIVE_HOSTS.includes(host)) return false;
  const path = url.pathname.toLowerCase();
  const hasDriveQueryId = host === "drive.google.com" && Boolean(url.searchParams.get("id"));
  return (
    path.includes("/document/")
    || path.includes("/spreadsheets/")
    || path.includes("/presentation/")
    || path.includes("/forms/")
    || path.includes("/file/")
    || path.includes("/folders/")
    || hasDriveQueryId
  );
};

const extractGoogleDriveId = (url: URL, segments: string[]) => {
  for (let i = 0; i < segments.length; i += 1) {
    const current = segments[i];
    if (current === "d" && i + 1 < segments.length) {
      const next = segments[i + 1];
      if (next === "e" && i + 2 < segments.length) return segments[i + 2];
      return next;
    }
    if (current === "folders" && i + 1 < segments.length) return segments[i + 1];
  }
  return url.searchParams.get("id");
};

export const getGoogleDriveFileId = (rawUrl: string) => {
  if (!isGoogleDriveUrl(rawUrl)) return undefined;
  const url = parseGoogleDriveUrl(rawUrl);
  if (!url) return undefined;
  return extractGoogleDriveId(url, url.pathname.split("/").filter(Boolean)) ?? undefined;
};

/** The preview frame for a Drive link, or null when the link isn't a Drive file, doc or folder. */
export const buildGoogleDriveEmbedUrl = (rawUrl: string): string | null => {
  if (!isGoogleDriveUrl(rawUrl)) return null;
  const url = parseGoogleDriveUrl(rawUrl);
  if (!url) return null;
  const host = url.hostname.toLowerCase();
  const segments = url.pathname.split("/").filter(Boolean);
  const rawId = extractGoogleDriveId(url, segments);
  if (!rawId || !/^[\w-]+$/.test(rawId)) return null;
  const id = rawId;

  // Always https, whatever the pasted link said.
  const base = `https://${url.host}`;
  const resourcekey = url.searchParams.get("resourcekey");
  const resourceKeyQuery = resourcekey ? `resourcekey=${encodeURIComponent(resourcekey)}` : "";
  const appendResourceKey = (target: string) => {
    if (!resourceKeyQuery) return target;
    const hashIndex = target.indexOf("#");
    const head = hashIndex === -1 ? target : target.slice(0, hashIndex);
    const tail = hashIndex === -1 ? "" : target.slice(hashIndex);
    const separator = head.includes("?") ? "&" : "?";
    return `${head}${separator}${resourceKeyQuery}${tail}`;
  };

  if (host === "docs.google.com") {
    const type = segments[0] || "";
    switch (type) {
      case "document":
      case "spreadsheets":
        return appendResourceKey(`${base}/${type}/d/${id}/preview`);
      case "presentation":
        return appendResourceKey(`${base}/presentation/d/${id}/embed?start=false&loop=false`);
      case "forms":
        return appendResourceKey(`${base}/forms/d/${segments.includes("e") ? "e/" : ""}${id}/viewform?embedded=true`);
      default:
        return appendResourceKey(`https://drive.google.com/file/d/${id}/preview`);
    }
  }

  if (host === "drive.google.com") {
    if (segments.includes("folders")) return appendResourceKey(`https://drive.google.com/embeddedfolderview?id=${id}#grid`);
    return appendResourceKey(`https://drive.google.com/file/d/${id}/preview`);
  }

  // sheets/slides/forms.google.com short hosts redirect to docs.google.com; frame the file preview.
  return appendResourceKey(`https://drive.google.com/file/d/${id}/preview`);
};
