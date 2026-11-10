import { getCookie, setCookie } from "hono/cookie";
import { appKeepIdentity, appKeepUserId, ensureAppKeepUser, isAppKeepHosted } from "./appkeep-identity";
import { randomToken, SESSION_TOKEN_BYTES } from "./auth-crypto";
import { resolveSessionDeviceId } from "./auth-session-devices";
import {
  isDatabaseNotReadyError,
  isUnauthenticatedAccessEnabled,
  resolveInstanceAuthMode,
  type InstanceAuthMode,
} from "./auth-state";
import type { ApiTokenRow } from "./api-token-routes";
import type { AppContext, AuthContext, Bindings } from "./api-context";
import { AppError } from "./app-error";
import type { UserRow } from "./auth-routes";
import { createId, isoNow, parseJsonArray } from "./entity-utils";
import { sha256 } from "./hash-utils";
import type { DatabaseAdapter } from "./storage-contract";
import { ensureUserWorkspace } from "./workspace-provisioning";
import { ensureWorkspaceExampleSeed } from "./workspace-example-seed";

type SessionRow = {
  id: string;
  user_id: string;
  username: string;
  display_name: string | null;
  expires_at: string;
  last_seen_at: string | null;
  workspace_id: string | null;
  role: "owner" | "member" | null;
  team_workspace_id: string | null;
  team_role: "owner" | "member" | "viewer" | null;
};

const SESSION_COOKIE = "ponder_session";
const DEFAULT_SESSION_TTL_DAYS = 400;
const MAX_SESSION_TTL_DAYS = 400;
const SESSION_LAST_SEEN_UPDATE_INTERVAL_MS = 60 * 60 * 1000;
const API_TOKEN_LAST_USED_UPDATE_INTERVAL_MS = 60 * 60 * 1000;
const clampNumber = (value: number, min: number, max: number) =>
  Number.isNaN(value) ? min : Math.min(Math.max(value, min), max);

export const getInstanceAuthMode = async (
  env: Bindings,
  verifyDatabase = false,
): Promise<InstanceAuthMode> => {
  if (!env.storage.db || typeof env.storage.db.prepare !== "function") {
    throw new AppError(
      "database_not_ready",
      "Database is not ready. Bind the D1 database as DB and apply the remote migrations.",
      503,
    );
  }

  const allowUnauthenticated = isUnauthenticatedAccessEnabled(env.PONDER_ALLOW_UNAUTHENTICATED);
  const platformSignIn = isAppKeepHosted(env);

  if (!verifyDatabase) {
    if (allowUnauthenticated) return "disabled";
    if (platformSignIn) return "required";
  }

  let user: { id: string } | null;
  try {
    user = await env.storage.db.prepare(`SELECT id FROM users WHERE is_disabled = 0 LIMIT 1`).first<{ id: string }>();
  } catch (error) {
    if (isDatabaseNotReadyError(error)) {
      throw new AppError(
        "database_not_ready",
        "Database is not ready. Bind the D1 database as DB and apply the remote migrations.",
        503,
      );
    }
    throw error;
  }

  return resolveInstanceAuthMode({
    allowUnauthenticated,
    platformSignIn,
    hasEnabledUser: Boolean(user),
  });
};

export const createSession = async (c: AppContext, user: UserRow, requestedDeviceId?: string) => {
  const token = randomToken(SESSION_TOKEN_BYTES);
  const id = createId("sess");
  const now = isoNow();
  const maxAge = getSessionMaxAge(c.env);
  const expiresAt = new Date(Date.now() + maxAge * 1000).toISOString();
  const userAgent = c.req.header("User-Agent") ?? null;
  const deviceId = resolveSessionDeviceId(requestedDeviceId, userAgent, id);
  const ip = c.req.header("CF-Connecting-IP");
  const ipHash = ip ? await sha256(ip) : null;
  const cf = c.req.raw.cf as { country?: string; region?: string } | undefined;
  const ipCountry = c.req.header("CF-IPCountry") ?? cf?.country ?? null;
  const ipRegion = cf?.region ?? null;

  await c.env.storage.db.batch([
    c.env.storage.db.prepare(
      `UPDATE sessions SET revoked_at = ?
       WHERE user_id = ? AND device_id = ? AND revoked_at IS NULL`
    ).bind(now, user.id, deviceId),
    c.env.storage.db.prepare(
      `INSERT INTO sessions (
        id, user_id, token_hash, device_id, user_agent, ip_hash, device_label, ip_address, ip_country, ip_region, expires_at, created_at, last_seen_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    ).bind(id, user.id, await sha256(token), deviceId, userAgent, ipHash, null, ip ?? null, ipCountry, ipRegion, expiresAt, now, now),
  ]);

  return { id, token, maxAge };
};

export const setSessionCookie = (c: AppContext, token: string, maxAge: number) => {
  setCookie(c, SESSION_COOKIE, token, {
    httpOnly: true,
    secure: new URL(c.req.url).protocol === "https:",
    sameSite: "Lax",
    path: "/",
    maxAge,
  });
};

export const revokeSession = async (db: DatabaseAdapter, token: string) => {
  await db
    .prepare(`UPDATE sessions SET revoked_at = ? WHERE token_hash = ? AND revoked_at IS NULL`)
    .bind(isoNow(), await sha256(token))
    .run();
};

export const authenticateRequest = async (c: AppContext, touch: boolean): Promise<AuthContext | null> => {
  const bearerAuth = await authenticateBearerToken(c, touch);

  if (bearerAuth) {
    return bearerAuth;
  }

  return authenticateSession(c, touch);
};

const authenticateBearerToken = async (c: AppContext, touch: boolean): Promise<AuthContext | null> => {
  const token = getBearerToken(c);

  if (!token) {
    return null;
  }

  // On AppKeep a session only counts next to AppKeep's sign-in, so a saved
  // session token can't outlive someone's access to the account.
  const sessionAuth = isAppKeepHosted(c.env) ? null : await authenticateSessionToken(c, token, touch);

  if (sessionAuth) {
    return sessionAuth;
  }

  const row = await c.env.storage.db.prepare(
    `SELECT id, name, token_value, scopes_json, last_used_at, expires_at, is_revoked, created_at, workspace_id
     FROM api_tokens
     WHERE token_hash = ?
       AND is_revoked = 0
       AND (expires_at IS NULL OR expires_at > ?)`
  )
    .bind(await sha256(token), isoNow())
    .first<ApiTokenRow>();

  if (!row) {
    return null;
  }

  const lastUsedAt = row.last_used_at ? Date.parse(row.last_used_at) : Number.NaN;
  if (
    touch
    && (!Number.isFinite(lastUsedAt) || lastUsedAt <= Date.now() - API_TOKEN_LAST_USED_UPDATE_INTERVAL_MS)
  ) {
    const now = isoNow();
    const cutoff = new Date(Date.now() - API_TOKEN_LAST_USED_UPDATE_INTERVAL_MS).toISOString();
    await c.env.storage.db.prepare(
      `UPDATE api_tokens
       SET last_used_at = ?
       WHERE id = ? AND (last_used_at IS NULL OR last_used_at <= ?)`,
    ).bind(now, row.id, cutoff).run();
  }

  await ensureWorkspaceExampleSeed(c.env, row.workspace_id).catch((error) => {
    console.error("Ponder example seed failed", error);
  });

  return {
    kind: "agent",
    actorType: "agent",
    actorId: row.id,
    username: row.name,
    displayName: row.name,
    scopes: parseJsonArray(row.scopes_json),
    workspaceId: row.workspace_id,
    role: "member",
    tokenId: row.id,
  };
};

const authenticateSessionToken = async (c: AppContext, token: string, touch: boolean): Promise<AuthContext | null> => {
  const now = isoNow();
  const row = await c.env.storage.db.prepare(
    `SELECT s.id, s.user_id, u.username, u.display_name, s.expires_at, s.last_seen_at,
            wm.workspace_id, wm.role, tm.workspace_id AS team_workspace_id, tm.role AS team_role
     FROM sessions s
     INNER JOIN users u ON u.id = s.user_id
     LEFT JOIN workspace_members wm ON wm.user_id = s.user_id
     LEFT JOIN team_members tm ON tm.user_id = s.user_id AND tm.workspace_id = s.active_workspace_id
     WHERE s.token_hash = ?
       AND s.revoked_at IS NULL
       AND s.expires_at > ?
       AND u.is_disabled = 0`
  )
    .bind(await sha256(token), now)
    .first<SessionRow>();

  if (!row) {
    return null;
  }

  const lastSeenAt = row.last_seen_at ? Date.parse(row.last_seen_at) : Number.NaN;
  if (
    touch
    && (!Number.isFinite(lastSeenAt) || lastSeenAt <= Date.now() - SESSION_LAST_SEEN_UPDATE_INTERVAL_MS)
  ) {
    const cutoff = new Date(Date.now() - SESSION_LAST_SEEN_UPDATE_INTERVAL_MS).toISOString();
    await c.env.storage.db.prepare(
      `UPDATE sessions
       SET last_seen_at = ?
       WHERE id = ? AND (last_seen_at IS NULL OR last_seen_at <= ?)`,
    ).bind(now, row.id, cutoff).run();
  }

  const workspace = row.workspace_id && row.role
    ? { workspaceId: row.workspace_id, role: row.role }
    : await ensureUserWorkspace(c.env.storage.db, row.user_id, row.username, c.req.header("accept-language"));

  await ensureWorkspaceExampleSeed(c.env, workspace.workspaceId).catch((error) => {
    console.error("Ponder example seed failed", error);
  });

  return {
    kind: "user",
    actorType: "user",
    actorId: row.user_id,
    username: row.username,
    displayName: row.display_name,
    scopes: [],
    workspaceId: row.team_workspace_id ?? workspace.workspaceId,
    role: workspace.role,
    teamRole: row.team_workspace_id && row.team_role ? row.team_role : undefined,
    sessionId: row.id,
  };
};

// A request can authenticate more than once, before its cookie reaches the browser.
const issuedAppKeepTokens = new WeakMap<Request, string>();

const authenticateAppKeepSession = async (c: AppContext, touch: boolean): Promise<AuthContext | null> => {
  const identity = appKeepIdentity(c.env, c.req.raw.headers);
  if (!identity) return null;

  const token = issuedAppKeepTokens.get(c.req.raw) ?? getCookie(c, SESSION_COOKIE);
  let auth = token ? await authenticateSessionToken(c, token, touch) : null;
  if (auth?.actorId !== appKeepUserId(identity)) {
    const user = await ensureAppKeepUser(c.env.storage.db, identity);
    const session = await createSession(c, user);
    issuedAppKeepTokens.set(c.req.raw, session.token);
    setSessionCookie(c, session.token, session.maxAge);
    auth = await authenticateSessionToken(c, session.token, touch);
  }
  return auth && { ...auth, role: identity.canManageApp ? "owner" : "member" };
};

export const authenticateSession = async (c: AppContext, touch: boolean): Promise<AuthContext | null> => {
  if (isAppKeepHosted(c.env)) return authenticateAppKeepSession(c, touch);

  const token = getCookie(c, SESSION_COOKIE);

  if (!token) {
    return null;
  }

  return authenticateSessionToken(c, token, touch);
};

export const getBearerToken = (c: AppContext) => {
  const authorization = c.req.header("Authorization");

  if (!authorization) {
    return null;
  }

  const [scheme, token] = authorization.split(/\s+/, 2);
  return scheme.toLowerCase() === "bearer" && token ? token : null;
};

const getSessionMaxAge = (env: Bindings) => {
  const days = clampNumber(Number(env.PONDER_SESSION_TTL_DAYS ?? DEFAULT_SESSION_TTL_DAYS), 1, MAX_SESSION_TTL_DAYS);
  return days * 24 * 60 * 60;
};
