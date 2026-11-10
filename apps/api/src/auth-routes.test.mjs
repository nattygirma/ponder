import { describe, expect, test } from "bun:test";
import { Hono } from "hono";
import { registerAuthRoutes } from "./auth-routes.ts";

const environment = {
  storage: {
    db: {
      prepare: () => {
        throw new Error("Database access was not expected");
      },
      batch: async () => [],
    },
    resources: {},
  },
};

const createApp = (overrides = {}) => {
  const app = new Hono();
  registerAuthRoutes(app, {
    authenticateRequest: async () => null,
    authenticateSession: async () => null,
    getBearerToken: () => null,
    getInstanceAuthMode: async () => "required",
    isDemoEnvironment: () => false,
    revokeSession: async () => undefined,
    ...overrides,
  });
  return app;
};

describe("auth route contracts", () => {
  test("reports the local owner when authentication is disabled", async () => {
    const app = createApp({
      getInstanceAuthMode: async () => "disabled",
      isDemoEnvironment: () => true,
    });
    const response = await app.request("/api/v1/auth/session", {}, environment);

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      authRequired: false,
      authenticated: true,
      demoMode: true,
      user: {
        id: "local",
        username: "owner",
        displayName: "Owner",
        role: "owner",
      },
    });
  });

  test("reports an anonymous required-auth session without touching storage", async () => {
    const app = createApp();
    const response = await app.request("/api/v1/auth/session", {}, environment);

    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({
      authRequired: true,
      authenticated: false,
      user: null,
    });
  });
});
