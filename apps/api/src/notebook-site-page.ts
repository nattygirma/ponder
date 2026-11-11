import { getMemoDisplayTitle } from "@ponder/shared/memo-title";
import { PUBLIC_PAGE_HEADERS, PUBLIC_PAGE_ROBOTS } from "@ponder/shared/public-page-headers";
import type { DatabaseAdapter } from "./storage-contract";
import { getNotebookSite, publicTreeSql, resolveNotebookSiteToken } from "./notebook-site-service";

export const isNotebookSitePagePath = (path: string) => /^\/(?:share\/notebook|s)\/[^/]+(?:\/[^/]+)?\/?$/.test(path);
const escapeHtml = (text: string) => text.replace(/[&<>"']/g, (char) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[char]!);

const SITE_FILES = new Set(["sitemap.xml", "robots.txt"]);
const SITEMAP_LIMIT = 50_000;
const textResponse = (request: Request, body: string, status: number, type: string, robots: string) =>
  new Response(request.method === "HEAD" ? null : body, { status, headers: {
    "Content-Type": type, "Cache-Control": "public, max-age=300", "X-Robots-Tag": robots,
  } });

/** `/s/<slug>/sitemap.xml` and `/s/<slug>/robots.txt`; only aliased, public, indexable sites list pages. */
const renderSiteFile = async (request: Request, db: DatabaseAdapter, slug: string, file: string) => {
  const url = new URL(request.url);
  const resolved = await resolveNotebookSiteToken(db, slug);
  const site = resolved ? await getNotebookSite(db, resolved.token) : null;
  if (!site?.site_slug) return textResponse(request, "Not found\n", 404, "text/plain; charset=utf-8", PUBLIC_PAGE_ROBOTS);
  const base = `${url.origin}/s/${encodeURIComponent(site.site_slug)}`;
  const indexable = site.settings.allowIndexing && !site.password_hash;
  if (file === "robots.txt") {
    const body = indexable
      ? `User-agent: *\nAllow: /s/${encodeURIComponent(site.site_slug)}/\nSitemap: ${base}/sitemap.xml\n`
      : `User-agent: *\nDisallow: /s/${encodeURIComponent(site.site_slug)}/\n`;
    return textResponse(request, body, 200, "text/plain; charset=utf-8", "noindex");
  }
  if (!indexable) return textResponse(request, "Not found\n", 404, "text/plain; charset=utf-8", PUBLIC_PAGE_ROBOTS);
  const memos = await db.prepare(`${publicTreeSql} SELECT id, updated_at FROM visible_memos ORDER BY updated_at DESC, id LIMIT ?`)
    .bind(site.token, SITEMAP_LIMIT - 1).all<{ id: string; updated_at: string | null }>();
  const lastmod = (value: string | null) => {
    const date = value ? new Date(value.includes("T") ? value : `${value.replace(" ", "T")}Z`) : null;
    return date && !Number.isNaN(date.getTime()) ? `<lastmod>${date.toISOString()}</lastmod>` : "";
  };
  const entries = [`<url><loc>${escapeHtml(`${base}`)}</loc>${lastmod(memos.results[0]?.updated_at ?? null)}</url>`,
    ...memos.results.map((memo) => `<url><loc>${escapeHtml(`${base}/${encodeURIComponent(memo.id)}`)}</loc>${lastmod(memo.updated_at)}</url>`)];
  const body = `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${entries.join("\n")}\n</urlset>\n`;
  return textResponse(request, body, 200, "application/xml; charset=utf-8", "noindex");
};

/** Google Analytics 4: the standard gtag snippet, only for sites that set a measurement id. */
const analyticsSnippet = (id: string) => `<script async src="https://www.googletagmanager.com/gtag/js?id=${encodeURIComponent(id)}"></script>
<script>window.dataLayer=window.dataLayer||[];function gtag(){dataLayer.push(arguments);}gtag("js",new Date());gtag("config",${JSON.stringify(id).replace(/</g, "\\u003c")});</script>`;

/** Shared business logic; runtime adapters supply only their app-shell loader. */
export const renderNotebookSitePage = async (
  request: Request,
  db: DatabaseAdapter,
  loadTemplate: () => Promise<Response>,
): Promise<Response | null> => {
  const url = new URL(request.url);
  if (!isNotebookSitePagePath(url.pathname)) return null;
  const alias = url.pathname.startsWith("/s/");
  const parts = url.pathname.split("/");
  const identity = parts[alias ? 2 : 3];
  const memoId = parts[alias ? 3 : 4];
  if (alias && memoId && SITE_FILES.has(memoId)) return renderSiteFile(request, db, identity, memoId);
  const resolved = alias ? await resolveNotebookSiteToken(db, identity) : { token: identity };
  const site = resolved ? await getNotebookSite(db, resolved.token) : null;
  let status = site ? 200 : 404;
  let title = "Shared notebook · Ponder";
  let description = "Read a shared notebook on Ponder.";
  let indexable = false;
  let canonical = `${url.origin}${url.pathname}`;
  let image = new URL("/apple-touch-icon.png", url).href;
  let largeImage = false;
  if (site && !site.password_hash) {
    const selected = memoId || site.settings.homeMemoId;
    const note = selected ? await db.prepare(`${publicTreeSql} SELECT title, excerpt FROM visible_memos WHERE id = ?`)
      .bind(site.token, selected).first<{ title: string | null; excerpt: string }>() : null;
    if (memoId && !note) status = 404;
    if (status === 200) {
      const noteTitle = note ? getMemoDisplayTitle(note.title, site.name) : site.name;
      title = noteTitle === site.name ? site.name : `${noteTitle} · ${site.name}`;
      description = note?.excerpt || site.settings.description || site.name;
      indexable = alias && site.settings.allowIndexing;
      const base = site.site_slug ? `/s/${encodeURIComponent(site.site_slug)}` : `/share/notebook/${encodeURIComponent(site.token)}`;
      canonical = `${url.origin}${base}${memoId ? `/${encodeURIComponent(memoId)}` : ""}`;
      image = site.settings.ogImageUrl || site.settings.logoUrl || image;
      largeImage = Boolean(site.settings.ogImageUrl);
    }
  }
  const settings = site?.settings;
  const robots = indexable ? "index, follow" : PUBLIC_PAGE_ROBOTS;
  const metadata = `<title>${escapeHtml(title)}</title>
<meta name="description" content="${escapeHtml(description)}">
<meta name="robots" content="${robots}">
<link rel="canonical" href="${escapeHtml(canonical)}">
<meta property="og:type" content="${memoId ? "article" : "website"}">
<meta property="og:title" content="${escapeHtml(title)}">
<meta property="og:description" content="${escapeHtml(description)}">
<meta property="og:url" content="${escapeHtml(canonical)}">
<meta property="og:image" content="${escapeHtml(image)}">${site && !site.password_hash ? `
<meta property="og:site_name" content="${escapeHtml(site.name)}">` : ""}
<meta name="twitter:card" content="${largeImage ? "summary_large_image" : "summary"}">
<meta name="twitter:title" content="${escapeHtml(title)}">
<meta name="twitter:description" content="${escapeHtml(description)}">
<meta name="twitter:image" content="${escapeHtml(image)}">${settings?.faviconDataUrl ? `
<link rel="icon" type="image/png" href="${escapeHtml(settings.faviconDataUrl)}">
<link rel="apple-touch-icon" href="${escapeHtml(settings.faviconDataUrl)}">` : ""}${settings && settings.theme !== "system" ? `
<meta name="ponder-site-theme" content="${settings.theme}">` : ""}${settings?.gaMeasurementId ? `
${analyticsSnippet(settings.gaMeasurementId)}` : ""}`;
  const template = await loadTemplate();
  if (!template.ok) return template;
  const html = (await template.text())
    .replace(/<title\b[^>]*>[\s\S]*?<\/title>/gi, "")
    .replace(/<meta\b[^>]*(?:name|property)=["'](?:description|robots|og:[^"']+|twitter:[^"']+)["'][^>]*>/gi, "")
    .replace(/<link\b[^>]*rel=["']canonical["'][^>]*>/gi, "")
    .replace(/<link\b[^>]*rel=["'](?:icon|shortcut icon|apple-touch-icon)["'][^>]*>/gi, (tag) => settings?.faviconDataUrl ? "" : tag)
    .replace(/<\/head>/i, () => `${metadata}</head>`);
  const headers = new Headers(template.headers);
  headers.delete("Content-Length");
  headers.delete("ETag");
  headers.delete("Content-Encoding");
  headers.delete("Last-Modified");
  headers.delete("Age");
  headers.delete("CF-Cache-Status");
  for (const [key, value] of Object.entries(PUBLIC_PAGE_HEADERS)) headers.set(key, value);
  headers.set("Content-Type", "text/html; charset=utf-8");
  headers.set("X-Robots-Tag", robots);
  return new Response(request.method === "HEAD" ? null : html, { status, headers });
};
