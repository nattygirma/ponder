import { describe, expect, test } from "bun:test";
import worker from "../apps/api/src/index";

const executionContext = {
  passThroughOnException() {},
  waitUntil() {},
  props: {},
} as unknown as ExecutionContext;

const createDatabase = (options: { userId?: string; error?: Error } = {}) =>
  ({
    prepare(sql: string) {
      return {
        bind() {
          return this;
        },
        async first() {
          if (options.error) throw options.error;
          if (sql.includes("d1_migrations")) return { name: "0035_normalized_memo_tags.sql" };
          if (sql.includes("object_storage_configs")) return { provider: "s3" };
          return options.userId ? { id: options.userId } : null;
        },
      };
    },
  }) as unknown as D1Database;

const fetchApi = (path: string, env: Record<string, unknown>) =>
  worker.fetch(
    new Request(`https://ponder.test${path}`),
    env as never,
    executionContext,
  );

describe("production authentication guard", () => {
  test("returns a diagnosable 503 instead of opening an empty production instance", async () => {
    const response = await fetchApi("/api/v1/auth/session", { DB: createDatabase() });

    expect(response.status).toBe(503);
    expect(await response.json()).toEqual({
      error: {
        code: "auth_not_configured",
        message: "Sign-in is not available. Open Ponder from your AppKeep dashboard.",
      },
    });
  });

  test("reports unapplied D1 migrations as database_not_ready", async () => {
    const response = await fetchApi("/api/health", {
      DB: createDatabase({ error: new Error("D1_ERROR: no such table: users") }),
      PONDER_APPKEEP: "true",
    });

    expect(response.status).toBe(503);
    expect((await response.json()) as { error: { code: string } }).toMatchObject({
      error: { code: "database_not_ready" },
    });
  });

  test("reports a missing R2 binding as object_storage_not_ready", async () => {
    const response = await fetchApi("/api/health", {
      DB: createDatabase({ userId: "owner" }),
      PONDER_APPKEEP: "true",
    });

    expect(response.status).toBe(503);
    expect(await response.json()).toEqual({
      error: {
        code: "object_storage_not_ready",
        message: "Object storage is not configured. Bind RESOURCES and redeploy.",
      },
    });
  });

  test("reports healthy only when D1, authentication, and object storage are ready", async () => {
    const response = await fetchApi("/api/health", {
      DB: createDatabase({ userId: "owner" }),
      RESOURCES: {},
      PONDER_APPKEEP: "true",
    });

    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({
      ok: true,
      build: expect.any(String),
      deployment: { trigger: "unknown", method: "unknown" },
      migration: "0035",
      storage: { database: "d1", resources: "r2" },
      objectStorageProvider: "s3",
    });
  });

  test("reports deployment metadata supplied by the running instance", async () => {
    const response = await fetchApi("/api/health", {
      DB: createDatabase({ userId: "owner" }),
      RESOURCES: {},
      PONDER_APPKEEP: "true",
      PONDER_DEPLOYMENT_TRIGGER: "github_release",
      PONDER_DEPLOYMENT_METHOD: "github_actions",
    });

    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({
      deployment: { trigger: "github_release", method: "github_actions" },
    });
  });

  test("keeps Cloudflare health free of image build metadata", async () => {
    const response = await fetchApi("/api/health", {
      DB: createDatabase({ userId: "owner" }),
      RESOURCES: {},
      PONDER_APPKEEP: "true",
      PONDER_BUILD_CREATED_AT: "2026-01-02T03:04:05Z",
      PONDER_BUILD_TRIGGER: "main_push",
      PONDER_BUILD_METHOD: "github_actions",
    });

    expect(response.status).toBe(200);
    const health = await response.json() as Record<string, unknown>;
    expect(health).not.toHaveProperty("buildCreatedAt");
    expect(health).not.toHaveProperty("buildProvenance");
    expect(health).not.toHaveProperty("containerImageSource");
    expect(health.deploymentVersionCreatedAt).toBeNull();
  });

  test("reports self-hosted image build metadata separately from deployment metadata", async () => {
    const response = await fetchApi("/api/health", {
      DB: createDatabase({ userId: "owner" }),
      RESOURCES: {},
      PONDER_APPKEEP: "true",
      PONDER_RUNTIME: "self-hosted-bun",
      PONDER_BUILD_CREATED_AT: "2026-01-02T03:04:05Z",
      PONDER_BUILD_TRIGGER: "github_release",
      PONDER_BUILD_METHOD: "github_actions",
      PONDER_DEPLOYMENT_TRIGGER: "manual",
      PONDER_DEPLOYMENT_METHOD: "docker",
    });

    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({
      runtime: "self-hosted-bun",
      containerImageSource: "unknown",
      buildCreatedAt: "2026-01-02T03:04:05.000Z",
      buildProvenance: { trigger: "github_release", method: "github_actions" },
      deployment: { trigger: "manual", method: "docker" },
      deploymentVersionCreatedAt: null,
    });
  });

  test("keeps anonymous share responses out of search indexes, caches and Referer headers", async () => {
    for (const path of ["/api/public/shares/not-a-token", "/api/public/notebook-shares/not-a-token", "/api/public/forms/not-a-token"]) {
      const response = await fetchApi(path, {
        DB: createDatabase({ userId: "owner" }),
        RESOURCES: {},
        PONDER_APPKEEP: "true",
      });

      expect(response.status).toBe(404);
      expect(response.headers.get("X-Robots-Tag")).toBe("noindex, nofollow, noarchive, nosnippet, noimageindex");
      expect(response.headers.get("Cache-Control")).toBe("private, no-store");
      expect(response.headers.get("Referrer-Policy")).toBe("no-referrer");
    }
  });

  test("reports exhausted D1 daily quotas without exposing the underlying database error", async () => {
    for (const operation of ["read", "write"]) {
      const response = await fetchApi("/api/health", {
        DB: createDatabase({ error: new Error("Query failed", {
          cause: new Error(`D1_ERROR: Your account has exceeded D1's free tier daily row ${operation} limit. private-query-details`),
        }) }),
        PONDER_APPKEEP: "true",
      });
      expect(response.status).toBe(503);
      const body = await response.json();
      expect(body.error.code).toBe("database_daily_quota_exceeded");
      expect(body.error.message).toContain("00:00 UTC");
      expect(JSON.stringify(body)).not.toContain("private-query-details");
    }
  });

  test("does not misreport transient D1 failures as unapplied migrations", async () => {
    const response = await fetchApi("/api/health", {
      DB: createDatabase({ error: new Error("D1_ERROR: Network connection lost.") }),
    });

    expect(response.status).toBe(500);
    expect((await response.json()) as { error: { code: string } }).toMatchObject({
      error: { code: "internal_error" },
    });
  });

  test("keeps passwordless access behind the explicit local-only flag", async () => {
    const response = await fetchApi("/api/v1/auth/session", {
      DB: createDatabase(),
      PONDER_ALLOW_UNAUTHENTICATED: "true",
    });

    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({
      authRequired: false,
      authenticated: true,
    });
  });

});
