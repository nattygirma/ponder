import type { Hono } from "hono";
import { deleteCookie, getCookie } from "hono/cookie";
import { APPKEEP_SIGN_IN, isAppKeepHosted } from "./appkeep-identity";
import type {
  AppContext,
  AppEnv,
  AuthContext,
  Bindings,
} from "./api-context";
import type { InstanceAuthMode } from "./auth-state";
import {
  apiError,
  authNotConfigured,
  notFound,
  unauthorized,
} from "./http-errors";
import type { DatabaseAdapter } from "./storage-contract";

export type UserRow = {
  id: string;
  username: string;
  password_hash: string;
  display_name: string | null;
  is_disabled: number;
};

type AuthRouteDependencies = {
  authenticateRequest: (context: AppContext, touch: boolean) => Promise<AuthContext | null>;
  getBearerToken: (context: AppContext) => string | null;
  getInstanceAuthMode: (environment: Bindings) => Promise<InstanceAuthMode>;
  isDemoEnvironment: (environment: Bindings) => boolean;
  revokeSession: (database: DatabaseAdapter, token: string) => Promise<void>;
};

export const registerAuthRoutes = (
  app: Hono<AppEnv>,
  dependencies: AuthRouteDependencies,
) => {
  app.get("/api/v1/auth/session", async (context) => {
    const authMode = await dependencies.getInstanceAuthMode(context.env);

    if (authMode === "unconfigured") return authNotConfigured(context);
    if (authMode === "disabled") {
      return context.json({
        authRequired: false,
        authenticated: true,
        demoMode: dependencies.isDemoEnvironment(context.env),
        user: {
          id: "local",
          username: "owner",
          displayName: "Owner",
          role: "owner",
        },
      });
    }

    const auth = await dependencies.authenticateRequest(context, false);
    return context.json({
      authRequired: true,
      authenticated: Boolean(auth && auth.kind === "user"),
      demoMode: dependencies.isDemoEnvironment(context.env),
      ...(isAppKeepHosted(context.env) ? { platformSignIn: APPKEEP_SIGN_IN } : {}),
      ...(isAppKeepHosted(context.env) && context.env.ALTSTACK_APP_URL ? { publicUrl: context.env.ALTSTACK_APP_URL.replace(/\/$/, "") } : {}),
      user: auth?.kind === "user" ? {
        id: auth.actorId,
        username: auth.username,
        displayName: auth.displayName,
        role: auth.role,
        workspaceId: auth.workspaceId,
        teamRole: auth.teamRole ?? null,
      } : null,
    });
  });

  app.post("/api/v1/auth/logout", async (context) => {
    const token = getCookie(context, "ponder_session") ?? dependencies.getBearerToken(context);
    if (token) await dependencies.revokeSession(context.env.storage.db, token);

    deleteCookie(context, "ponder_session", { path: "/" });
    return context.json({ ok: true });
  });
};
