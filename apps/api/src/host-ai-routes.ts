import type { Context, Hono } from "hono";
import type { AppEnv } from "./api-context";
import { decryptAiCredential } from "./ai-service";
import {
  anthropicError,
  HOST_AI_MODELS,
  HOST_AI_PATH,
  HostAiRequestError,
  hostAiKeyWorkspace,
  hostAiProviderId,
  lowBalanceMessage,
  sameSecret,
  toAnthropicEventStream,
  toAnthropicMessage,
  toHostAiRequest,
} from "./host-ai";

// Called from the browser like api.anthropic.com: with a key, without cookies, and from the app's
// one address as well as the copy's own, so every response allows any origin. The key is the only
// credential, and it only spends AI from the owner's balance.
const CORS_HEADERS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "content-type, x-api-key, authorization, anthropic-version, anthropic-beta, anthropic-dangerous-direct-browser-access",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
  "Access-Control-Max-Age": "86400",
};
const MAX_BODY_BYTES = 256 * 1024;

const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), {
  status,
  headers: { ...CORS_HEADERS, "Content-Type": "application/json", "Cache-Control": "no-store" },
});

/** The workspace whose saved AppKeep AI key this request carries, or null. */
const authorize = async (c: Context<AppEnv>) => {
  const header = c.req.header("x-api-key") ?? c.req.header("authorization")?.replace(/^Bearer\s+/i, "");
  const workspaceId = hostAiKeyWorkspace(header);
  if (!header || !workspaceId || !c.env.hostAiText) return null;
  const row = await c.env.storage.db.prepare(
    `SELECT api_key_encrypted FROM ai_provider_configs WHERE id = ? AND workspace_id = ? AND is_enabled = 1`,
  ).bind(hostAiProviderId(workspaceId), workspaceId).first<{ api_key_encrypted: string }>();
  if (!row) return null;
  try {
    return sameSecret(await decryptAiCredential(row.api_key_encrypted, c.env), header) ? workspaceId : null;
  } catch {
    return null;
  }
};

const denied = () => json(anthropicError("authentication_error", "This AppKeep AI key isn't valid. Open Settings > AI in Ponder again."), 401);

export const registerHostAiRoutes = (app: Hono<AppEnv>) => {
  app.options(`${HOST_AI_PATH}/*`, () => new Response(null, { status: 204, headers: CORS_HEADERS }));

  app.get(`${HOST_AI_PATH}/models`, async (c) => {
    if (!(await authorize(c))) return denied();
    return json({
      data: HOST_AI_MODELS.map((model) => ({ type: "model", id: model.modelId, display_name: model.displayName })),
      has_more: false,
    });
  });

  app.post(`${HOST_AI_PATH}/messages`, async (c) => {
    if (!(await authorize(c))) return denied();
    const hostAiText = c.env.hostAiText!;
    const raw = await c.req.text();
    if (raw.length > MAX_BODY_BYTES) return json(anthropicError("request_too_large", "This AI request is too long for AppKeep AI (256 KB at most)."), 413);
    let translated: ReturnType<typeof toHostAiRequest>;
    try {
      translated = toHostAiRequest(JSON.parse(raw));
    } catch (error) {
      const message = error instanceof HostAiRequestError ? error.message : "The AI request isn't valid JSON.";
      return json(anthropicError("invalid_request_error", message), 400);
    }
    // Streamed: the platform's stream goes straight to the browser as it arrives, with no time limit.
    const hostAiStream = c.env.hostAiStream;
    if (translated.stream && hostAiStream) {
      let started: Awaited<ReturnType<typeof hostAiStream>>;
      try {
        started = await hostAiStream(translated.streamRequest);
      } catch (error) {
        const message = error instanceof Error && error.message ? error.message : "AppKeep AI failed. Try again.";
        return json(anthropicError("api_error", message), 502);
      }
      if (!started.ok && started.reason === "insufficient_funds") return json(anthropicError("billing_error", lowBalanceMessage(started.required_micros)), 402);
      if (!started.ok) return json(anthropicError(started.type, started.message), started.status >= 400 && started.status < 600 ? started.status : 502);
      return new Response(started.stream, {
        headers: { ...CORS_HEADERS, "Content-Type": "text/event-stream; charset=utf-8", "Cache-Control": "no-store", "x-appkeep-ai-request": started.id },
      });
    }
    let result: Awaited<ReturnType<typeof hostAiText>>;
    try {
      result = await hostAiText(translated.request);
    } catch (error) {
      const message = error instanceof Error && error.message ? error.message : "AppKeep AI failed. Try again.";
      return json(anthropicError("api_error", message), 502);
    }
    if (!result.ok) return json(anthropicError("billing_error", lowBalanceMessage(result.required_micros)), 402);
    if (!translated.stream) return json(toAnthropicMessage(result));
    return new Response(toAnthropicEventStream(result), {
      headers: { ...CORS_HEADERS, "Content-Type": "text/event-stream; charset=utf-8", "Cache-Control": "no-store" },
    });
  });
};
