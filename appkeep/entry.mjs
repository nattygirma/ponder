// AppKeep entry for Ponder. Only hosting differences live here:
// - AppKeep exposes file storage as env.MEDIA; Ponder's Worker reads env.RESOURCES.
// - Cloudflare's wrangler.toml serves the SPA shell for unknown paths and runs the Worker
//   first only for run_worker_first paths. AppKeep serves static files itself and hands
//   everything else to the app, so the shell fallback is done here.
// - PONDER_APPKEEP turns on sign-in through AppKeep's identity headers.
import worker from "../apps/api/src/index.ts";

const WORKER_FIRST = [/^\/api\//, /^\/mcp$/, /^\/__scheduled$/, /^\/s\//, /^\/share\//];

const bindings = (env) => ({
  ...env,
  PONDER_APPKEEP: "true",
  RESOURCES: env.MEDIA,
  sendEmail: env.ALTSTACK?.sendEmail ? (message) => env.ALTSTACK.sendEmail(message) : undefined,
  listConnections: env.ALTSTACK?.connections ? (provider) => env.ALTSTACK.connections(provider) : undefined,
  disconnectConnection: env.ALTSTACK?.disconnect ? (id) => env.ALTSTACK.disconnect(id) : undefined,
});

export default {
  async fetch(request, env, ctx) {
    const { pathname } = new URL(request.url);
    if (!WORKER_FIRST.some((re) => re.test(pathname)) && (request.method === "GET" || request.method === "HEAD")) {
      const asset = await env.ASSETS.fetch(request);
      if (asset.status !== 404) return asset;
      return env.ASSETS.fetch(new Request(new URL("/index.html", request.url), { method: request.method, headers: request.headers }));
    }
    return worker.fetch(request, bindings(env), ctx);
  },
  scheduled(controller, env, ctx) {
    return worker.scheduled(controller, bindings(env), ctx);
  },
};
