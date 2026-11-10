/** Helpers for insert/edit external hyperlinks in the rich-text editor. */

const BLOCKED_PROTOCOL = /^(javascript|data|vbscript):/i;
const HAS_SCHEME = /^[a-z][a-z0-9+.-]*:/i;
const LOOKS_LIKE_DOMAIN = /^(?:www\.)?[a-z0-9](?:[a-z0-9-]*[a-z0-9])?(?:\.[a-z0-9](?:[a-z0-9-]*[a-z0-9])?)+(?:[/:?#].*)?$/i;

export type NormalizeExternalLinkResult =
  | { ok: true; href: string }
  | { ok: false; reason: "empty" | "invalid" | "unsupported" };

/**
 * Normalize user-entered URL for an external hyperlink.
 * Accepts http(s), mailto, and bare domains (adds https://).
 * Rejects javascript:/data:/vbscript: and other unusable values.
 */
export const normalizeExternalLinkHref = (raw: string): NormalizeExternalLinkResult => {
  const trimmed = raw.trim();
  if (!trimmed) {
    return { ok: false, reason: "empty" };
  }

  if (BLOCKED_PROTOCOL.test(trimmed)) {
    return { ok: false, reason: "unsupported" };
  }

  // Internal note / resource schemes stay as-is (user may paste them intentionally).
  if (
    trimmed.startsWith("#memo=") ||
    trimmed.startsWith("ponder-resource://") ||
    trimmed.startsWith("/api/v1/resources/")
  ) {
    return { ok: true, href: trimmed };
  }

  let candidate = trimmed;
  if (!HAS_SCHEME.test(candidate)) {
    if (candidate.startsWith("//")) {
      candidate = `https:${candidate}`;
    } else if (candidate.startsWith("/") || candidate.startsWith("#") || candidate.startsWith("?")) {
      // Same-origin relative paths and hash fragments.
      return { ok: true, href: candidate };
    } else if (LOOKS_LIKE_DOMAIN.test(candidate) || candidate.toLowerCase().startsWith("www.")) {
      candidate = `https://${candidate}`;
    } else {
      return { ok: false, reason: "invalid" };
    }
  }

  try {
    // Relative paths already returned; absolute URLs must parse.
    if (candidate.startsWith("/") || candidate.startsWith("#") || candidate.startsWith("?")) {
      return { ok: true, href: candidate };
    }
    const parsed = new URL(candidate);
    if (BLOCKED_PROTOCOL.test(parsed.protocol)) {
      return { ok: false, reason: "unsupported" };
    }
    // mailto: and other harmless schemes keep their string form.
    if (parsed.protocol === "mailto:" || parsed.protocol === "http:" || parsed.protocol === "https:") {
      return { ok: true, href: parsed.href };
    }
    // Allow other uncommon but non-script schemes (ftp, tel, …) as typed.
    return { ok: true, href: candidate };
  } catch {
    return { ok: false, reason: "invalid" };
  }
};

export const isAttachmentLinkHref = (href: string | null | undefined): boolean => {
  if (!href) return false;
  return (
    href.includes("/api/v1/resources/") ||
    href.startsWith("ponder-resource://") ||
    href.includes("ponder-attachment")
  );
};

export const isNoteLinkHref = (href: string | null | undefined): boolean => {
  if (!href) return false;
  return href.startsWith("#memo=");
};

/** Build Markdown link syntax for source mode. */
export const formatMarkdownLink = (label: string, href: string): string => {
  const safeLabel = (label.trim() || href).replace(/\\/g, "\\\\").replace(/\[/g, "\\[").replace(/\]/g, "\\]");
  return `[${safeLabel}](${href})`;
};

/**
 * Insert `snippet` into `source` at `selectionStart`/`selectionEnd`,
 * replacing the selected range. Returns the next source and caret position.
 */
export const insertMarkdownSnippet = (
  source: string,
  snippet: string,
  selectionStart: number,
  selectionEnd: number
): { next: string; caret: number } => {
  const start = Math.max(0, Math.min(selectionStart, source.length));
  const end = Math.max(start, Math.min(selectionEnd, source.length));
  const next = `${source.slice(0, start)}${snippet}${source.slice(end)}`;
  return { next, caret: start + snippet.length };
};
