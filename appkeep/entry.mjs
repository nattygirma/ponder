// AppKeep entry for Ponder. Only hosting differences live here:
// - AppKeep exposes file storage as env.MEDIA; Ponder's Worker reads env.RESOURCES.
// - Cloudflare's wrangler.toml serves the SPA shell for unknown paths and runs the Worker
//   first only for run_worker_first paths. AppKeep serves static files itself and hands
//   everything else to the app, so the shell fallback is done here. AppKeep's ASSETS binding
//   only matches exact file paths, so it is wrapped to behave like wrangler's
//   not_found_handling = "single-page-application": a missing page (including "/") gets
//   index.html. Public share pages and notebook sites load the shell through it. Missing
//   files under /assets/, and other paths with a file extension that aren't page loads,
//   keep their 404: a tab still on an old build then sees its chunk is gone and reloads,
//   instead of getting HTML for a script.
// - PONDER_APPKEEP turns on sign-in through AppKeep's identity headers.
import worker from "../apps/api/src/index.ts";
import { spaAssets } from "./spa-assets.mjs";

const WORKER_FIRST = [/^\/api\//, /^\/mcp$/, /^\/__scheduled$/, /^\/s\//, /^\/share\//];

const bindings = (env) => ({
  ...env,
  ASSETS: spaAssets(env.ASSETS),
  PONDER_APPKEEP: "true",
  RESOURCES: env.MEDIA,
  sendEmail: env.ALTSTACK?.sendEmail ? (message) => env.ALTSTACK.sendEmail(message) : undefined,
  // Automations and repeating templates: tell AppKeep when the cron next has work, and send "Send webhook" events.
  wakeAt: env.ALTSTACK?.wakeAt ? (when) => env.ALTSTACK.wakeAt(when) : undefined,
  emitEvent: env.ALTSTACK?.emit ? (name, data) => env.ALTSTACK.emit(name, data) : undefined,
  listConnections: env.ALTSTACK?.connections ? (provider) => env.ALTSTACK.connections(provider) : undefined,
  disconnectConnection: env.ALTSTACK?.disconnect ? (id) => env.ALTSTACK.disconnect(id) : undefined,
  connectionProviders: env.ALTSTACK?.connectionProviders ? () => env.ALTSTACK.connectionProviders() : undefined,
  // AppKeep's text model, paid from the owner's balance: Ponder offers it as the "AppKeep AI" service.
  hostAiText: env.ALTSTACK?.ai?.text ? (request, options) => env.ALTSTACK.ai.text(request, options) : undefined,
  // The same model streamed, with no time limit (platform 2026-11 and later); older platforms answer in one piece.
  hostAiStream: env.ALTSTACK?.ai?.stream ? (request, options) => env.ALTSTACK.ai.stream(request, options) : undefined,
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
