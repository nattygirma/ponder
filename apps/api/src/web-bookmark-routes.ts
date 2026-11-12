import { zValidator } from "@hono/zod-validator";
import { bookmarkFallback, normalizeMediaUrl, parseBookmarkHtml, type WebBookmarkData } from "@ponder/shared";
import type { Hono } from "hono";
import { z } from "zod";
import type { AppEnv } from "./api-context";
import { guarded } from "./route-guard";
import { apiError } from "./http-errors";
import { validatePublicUrl } from "./public-network-policy";

const MAX_REDIRECTS = 4;
const BOOKMARK_TIMEOUT_MS = 8_000;
/** The <head> is near the top; there's no need to read a whole page. */
const MAX_HTML_BYTES = 512_000;

type PublicFetch = (input: string, init: RequestInit) => Promise<Response>;

/**
 * Reads a page's title, description, icon and image for Notion's Web bookmark.
 *
 * Only public HTTPS hosts are fetched (the shared public-network policy: no localhost, private
 * addresses, `.local`/`.internal` names, credentials or odd ports). Redirects are followed by hand
 * so each hop is checked the same way, and the body is cut off at a size and time limit. Anything
 * that fails gives the plain card with the address, so a bookmark is never lost.
 */
export const fetchWebBookmark = async (input: string, transport: PublicFetch | undefined, signal?: AbortSignal): Promise<WebBookmarkData> => {
  const fallback = bookmarkFallback(input);
  if (!transport) return fallback;
  let url: URL;
  try {
    url = validatePublicUrl(fallback.url);
  } catch {
    return fallback;
  }
  const timeout = AbortSignal.timeout(BOOKMARK_TIMEOUT_MS);
  const combined = signal ? AbortSignal.any([signal, timeout]) : timeout;
  try {
    for (let hop = 0; hop <= MAX_REDIRECTS; hop += 1) {
      const response = await transport(url.href, {
        method: "GET",
        headers: { accept: "text/html,application/xhtml+xml;q=0.9,*/*;q=0.1", "accept-language": "en", "user-agent": "Mozilla/5.0 (compatible; PonderBookmark/1.0)" },
        redirect: "manual",
        credentials: "omit",
        signal: combined,
      });
      if (response.status >= 300 && response.status < 400) {
        const location = response.headers.get("location");
        await response.body?.cancel().catch(() => undefined);
        if (!location) return fallback;
        url = validatePublicUrl(new URL(location, url).href);
        continue;
      }
      if (!response.ok || !/html|xml/i.test(response.headers.get("content-type") ?? "text/html")) {
        await response.body?.cancel().catch(() => undefined);
        return fallback;
      }
      const html = await readLimitedText(response, combined);
      // Details are about the page the person linked, so the card keeps their address.
      return { ...parseBookmarkHtml(html, url.href), url: fallback.url };
    }
  } catch {
    return fallback;
  }
  return fallback;
};

const readLimitedText = async (response: Response, signal: AbortSignal) => {
  const reader = response.body?.getReader();
  if (!reader) return "";
  const chunks: Uint8Array[] = [];
  let size = 0;
  try {
    while (size < MAX_HTML_BYTES) {
      signal.throwIfAborted();
      const { done, value } = await reader.read();
      if (done) break;
      chunks.push(value);
      size += value.byteLength;
      // The head is enough; stop once it has closed.
      if (new TextDecoder().decode(value).toLowerCase().includes("</head>")) break;
    }
  } finally {
    await reader.cancel().catch(() => undefined);
  }
  const bytes = new Uint8Array(Math.min(size, MAX_HTML_BYTES));
  let offset = 0;
  for (const chunk of chunks) {
    const part = chunk.subarray(0, bytes.byteLength - offset);
    bytes.set(part, offset);
    offset += part.byteLength;
    if (offset >= bytes.byteLength) break;
  }
  return new TextDecoder().decode(bytes);
};

export const registerWebBookmarkRoutes = (app: Hono<AppEnv>) => {
  app.post(
    "/api/v1/web-bookmark",
    zValidator("json", z.object({ url: z.string().trim().min(1).max(2000) })),
    (c) => guarded(c, "write:memos", async () => {
      const input = c.req.valid("json").url;
      if (!normalizeMediaUrl(input)) return apiError(c, "bookmark_invalid_url", "Paste a web address.", 400);
      return c.json({ bookmark: await fetchWebBookmark(input, c.env.publicNetworkFetch, c.req.raw.signal) });
    }),
  );
};
