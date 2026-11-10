// Serves the SPA shell for missing pages, as wrangler's single-page-application mode does.
// See entry.mjs for why missing files under /assets/ keep their 404.
export const isPageRequest = (request) => {
  const { pathname } = new URL(request.url);
  if (pathname.startsWith("/assets/")) return false;
  if (!pathname.slice(pathname.lastIndexOf("/") + 1).includes(".")) return true;
  return request.headers.get("sec-fetch-mode") === "navigate" || (request.headers.get("accept") ?? "").includes("text/html");
};

export const spaAssets = (assets) => ({
  async fetch(input, init) {
    const request = new Request(input, init);
    const asset = await assets.fetch(request);
    if (asset.status !== 404 || (request.method !== "GET" && request.method !== "HEAD") || !isPageRequest(request)) return asset;
    return assets.fetch(new Request(new URL("/index.html", request.url), { method: request.method, headers: request.headers }));
  },
});
