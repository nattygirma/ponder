// AppKeep entry for Ponder. Only hosting differences live here:
// - AppKeep exposes file storage as env.MEDIA; Ponder's Worker reads env.RESOURCES.
// - Cloudflare's wrangler.toml serves the SPA shell for unknown paths and runs the Worker
//   first only for run_worker_first paths. AppKeep serves static files itself and hands
//   everything else to the app, so the shell fallback is done here. AppKeep's ASSETS binding
//   only matches exact file paths, so it is wrapped to behave like wrangler's
//   not_found_handling = "single-page-application": a missing file (including "/") gets
//   index.html. Public share pages and notebook sites load the shell through it.
// - PONDER_APPKEEP turns on sign-in through AppKeep's identity headers.
import worker from "../apps/api/src/index.ts";

const WORKER_FIRST = [/^\/api\//, /^\/mcp$/, /^\/__scheduled$/, /^\/s\//, /^\/share\//];

const spaAssets = (assets) => ({
  async fetch(input, init) {
    const request = new Request(input, init);
    const asset = await assets.fetch(request);
    if (asset.status !== 404 || (request.method !== "GET" && request.method !== "HEAD")) return asset;
    return assets.fetch(new Request(new URL("/index.html", request.url), { method: request.method, headers: request.headers }));
  },
});

const bindings = (env) => ({
  ...env,
  ASSETS: spaAssets(env.ASSETS),
  PONDER_APPKEEP: "true",
  RESOURCES: env.MEDIA,
  sendEmail: env.ALTSTACK?.sendEmail ? (message) => env.ALTSTACK.sendEmail(message) : undefined,
  listConnections: env.ALTSTACK?.connections ? (provider) => env.ALTSTACK.connections(provider) : undefined,
  disconnectConnection: env.ALTSTACK?.disconnect ? (id) => env.ALTSTACK.disconnect(id) : undefined,
  connectionProviders: env.ALTSTACK?.connectionProviders ? () => env.ALTSTACK.connectionProviders() : undefined,
  // AppKeep's text model, paid from the owner's balance: Ponder offers it as the "AppKeep AI" service.
  hostAiText: env.ALTSTACK?.ai?.text ? (request, options) => env.ALTSTACK.ai.text(request, options) : undefined,
});

export default {
  async fetch(request, env, ctx) {
    const { pathname } = new URL(request.url);
    if (!WORKER_FIRST.some((re) => re.test(pathname)) && (request.method === "GET" || request.method === "HEAD")) {
      return spaAssets(env.ASSETS).fetch(request);
    }
    return worker.fetch(request, bindings(env), ctx);
  },
  scheduled(controller, env, ctx) {
    return worker.scheduled(controller, bindings(env), ctx);
  },
};
