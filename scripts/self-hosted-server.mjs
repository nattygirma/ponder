import { Database } from "bun:sqlite";
import { mkdir, readdir, readFile } from "node:fs/promises";
import { dirname, extname, join, normalize, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { isUnauthenticatedAccessEnabled } from "../apps/api/src/auth-state.ts";
import { fetchPonderApp } from "../apps/api/src/index.ts";
import { isNotebookSitePagePath, renderNotebookSitePage } from "../apps/api/src/notebook-site-page.ts";
import { isPublicMemoSharePagePath, renderPublicMemoSharePage } from "../apps/api/src/share-page.ts";
import { isPublicPagePath, PUBLIC_PAGE_HEADERS } from "../packages/shared/src/public-page-headers.ts";
import { nodePublicFetch } from "../apps/api/src/node-public-network.ts";
import { createSelfHostedStorageAdapter } from "../apps/api/src/self-hosted-storage-adapter.ts";
import { resolveSelfHostedConfig } from "./self-hosted-config.mjs";
import { ensureSelfHostedCredentialSecrets, loadSelfHostedEnvironment } from "./self-hosted-secrets.mjs";

const projectRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const runtimeEnvironment = await loadSelfHostedEnvironment(process.env);
const config = resolveSelfHostedConfig(runtimeEnvironment, projectRoot);
const { dataDirectory, databaseFile, resourcesDirectory, webDirectory } = config;

await mkdir(dataDirectory, { recursive: true });
await mkdir(resourcesDirectory, { recursive: true });
await ensureSelfHostedCredentialSecrets(dataDirectory, runtimeEnvironment);
const sqlite = new Database(databaseFile, { create: true });
sqlite.exec("PRAGMA foreign_keys = ON; PRAGMA journal_mode = WAL; PRAGMA synchronous = NORMAL; PRAGMA busy_timeout = 5000;");

const migrationFiles = (await readdir(join(projectRoot, "migrations")))
  .filter((name) => name.endsWith(".sql"))
  .sort();

sqlite.exec(`
  CREATE TABLE IF NOT EXISTS _ponder_migrations (
    name TEXT PRIMARY KEY,
    applied_at TEXT NOT NULL
  )
`);

const appliedMigrations = new Set(
  sqlite.query("SELECT name FROM _ponder_migrations").all().map((row) => row.name),
);

for (const name of migrationFiles) {
  if (appliedMigrations.has(name)) {
    continue;
  }

  const sql = await readFile(join(projectRoot, "migrations", name), "utf8");
  sqlite.transaction(() => {
    sqlite.exec(sql);
    sqlite.query("INSERT INTO _ponder_migrations (name, applied_at) VALUES (?, ?)").run(name, new Date().toISOString());
  })();
  console.log(`[self-hosted] applied migration ${name}`);
}

const existingUser = sqlite.query("SELECT id FROM users WHERE is_disabled = 0 LIMIT 1").get();
if (
  !existingUser
  && !isUnauthenticatedAccessEnabled(runtimeEnvironment.PONDER_ALLOW_UNAUTHENTICATED)
) {
  sqlite.close();
  throw new Error(
    "Ponder signs in through AppKeep. To run it elsewhere, explicitly set PONDER_ALLOW_UNAUTHENTICATED=true.",
  );
}

await ensureSelfHostedCredentialSecrets(dataDirectory, runtimeEnvironment, { generateIfMissing: true });

const storage = config.storageBackend === "s3"
  ? (
      await import("../apps/api/src/s3-compatible-storage-adapter.ts")
    ).createS3CompatibleStorageAdapter(sqlite, {
        bucket: runtimeEnvironment.PONDER_S3_BUCKET ?? "",
        region: runtimeEnvironment.PONDER_S3_REGION,
        endpoint: runtimeEnvironment.PONDER_S3_ENDPOINT,
        accessKeyId: runtimeEnvironment.PONDER_S3_ACCESS_KEY_ID,
        secretAccessKey: runtimeEnvironment.PONDER_S3_SECRET_ACCESS_KEY,
        forcePathStyle: runtimeEnvironment.PONDER_S3_FORCE_PATH_STYLE
          ? runtimeEnvironment.PONDER_S3_FORCE_PATH_STYLE === "true"
          : undefined,
      })
  : createSelfHostedStorageAdapter(sqlite, resourcesDirectory);
const env = {
  storage,
  publicNetworkFetch: nodePublicFetch,
  PONDER_AUTH_USERNAME: runtimeEnvironment.PONDER_AUTH_USERNAME ?? "admin",
  PONDER_RUNTIME: "self-hosted-bun",
  PONDER_CONTAINER_IMAGE: runtimeEnvironment.PONDER_CONTAINER_IMAGE,
  PONDER_DEPLOYMENT_TRIGGER: runtimeEnvironment.PONDER_DEPLOYMENT_TRIGGER,
  PONDER_DEPLOYMENT_METHOD: runtimeEnvironment.PONDER_DEPLOYMENT_METHOD,
  PONDER_BUILD_CREATED_AT: runtimeEnvironment.PONDER_BUILD_CREATED_AT,
  PONDER_BUILD_TRIGGER: runtimeEnvironment.PONDER_BUILD_TRIGGER,
  PONDER_BUILD_METHOD: runtimeEnvironment.PONDER_BUILD_METHOD,
  PONDER_AUTH_PASSWORD: runtimeEnvironment.PONDER_AUTH_PASSWORD,
  PONDER_AUTH_PASSWORD_HASH: runtimeEnvironment.PONDER_AUTH_PASSWORD_HASH,
  PONDER_AUTH_PASSWORD_FALLBACK: runtimeEnvironment.PONDER_AUTH_PASSWORD_FALLBACK,
  PONDER_SESSION_TTL_DAYS: runtimeEnvironment.PONDER_SESSION_TTL_DAYS ?? "400",
  PONDER_AUTH_LOGIN_WINDOW_SECONDS: runtimeEnvironment.PONDER_AUTH_LOGIN_WINDOW_SECONDS,
  PONDER_AUTH_LOGIN_USERNAME_MAX_ATTEMPTS: runtimeEnvironment.PONDER_AUTH_LOGIN_USERNAME_MAX_ATTEMPTS,
  PONDER_AUTH_LOGIN_USERNAME_COOLDOWN_SECONDS: runtimeEnvironment.PONDER_AUTH_LOGIN_USERNAME_COOLDOWN_SECONDS,
  PONDER_AUTH_LOGIN_IP_MAX_ATTEMPTS: runtimeEnvironment.PONDER_AUTH_LOGIN_IP_MAX_ATTEMPTS,
  PONDER_AUTH_LOGIN_IP_COOLDOWN_SECONDS: runtimeEnvironment.PONDER_AUTH_LOGIN_IP_COOLDOWN_SECONDS,
  // Legacy decryption fallback for credentials saved by older releases.
  PONDER_STORAGE_ENCRYPTION_KEY: runtimeEnvironment.PONDER_STORAGE_ENCRYPTION_KEY,
  PONDER_CREDENTIALS_ENCRYPTION_KEY: runtimeEnvironment.PONDER_CREDENTIALS_ENCRYPTION_KEY,
  PONDER_CREDENTIALS_ENCRYPTION_KEY_PREVIOUS: runtimeEnvironment.PONDER_CREDENTIALS_ENCRYPTION_KEY_PREVIOUS,
  PONDER_DEMO_MODE: runtimeEnvironment.PONDER_DEMO_MODE,
  PONDER_ALLOW_UNAUTHENTICATED: runtimeEnvironment.PONDER_ALLOW_UNAUTHENTICATED,
  PONDER_COMMUNITY_REGISTRY_URL: runtimeEnvironment.PONDER_COMMUNITY_REGISTRY_URL,
};

const executionContext = {
  waitUntil: (promise) => Promise.resolve(promise).catch((error) => console.error("[self-hosted] background task failed", error)),
  passThroughOnException: () => undefined,
};

const contentTypes = {
  ".css": "text/css; charset=utf-8",
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".mjs": "text/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".png": "image/png",
  ".svg": "image/svg+xml",
  ".webp": "image/webp",
  ".woff2": "font/woff2",
};

const serveStatic = async (request) => {
  const url = new URL(request.url);
  const requestedPath = normalize(url.pathname === "/" ? "/index.html" : url.pathname);
  const candidate = resolve(webDirectory, `.${requestedPath}`);
  const relativeCandidate = relative(webDirectory, candidate);

  if (relativeCandidate.startsWith("..") || relativeCandidate.includes(".." + "/")) {
    return new Response("Not Found", { status: 404 });
  }

  const file = Bun.file(candidate);
  if (await file.exists()) {
    return new Response(file, {
      headers: { "Content-Type": contentTypes[extname(candidate)] ?? "application/octet-stream" },
    });
  }

  const index = Bun.file(join(webDirectory, "index.html"));
  return (await index.exists())
    ? new Response(index, {
        headers: {
          "Content-Type": "text/html; charset=utf-8",
          // Share and form links render the app shell; keep them out of search indexes and caches.
          ...(isPublicPagePath(url.pathname) ? PUBLIC_PAGE_HEADERS : {}),
        },
      })
    : new Response("Web build not found. Run bun run build:web first.", { status: 503 });
};

const server = Bun.serve({
  hostname: config.hostname,
  port: config.port,
  // Model providers may take longer than Bun's 10-second default to emit the
  // first streaming token. Keep the connection alive within Bun's supported range.
  idleTimeout: config.idleTimeout,
  async fetch(request) {
    const pathname = new URL(request.url).pathname;
    const loadAppShell = () => serveStatic(new Request(new URL("/index.html", request.url)));
    if (isNotebookSitePagePath(pathname)) {
      return renderNotebookSitePage(request, storage.db, loadAppShell);
    }
    if (isPublicMemoSharePagePath(pathname)) {
      const page = await renderPublicMemoSharePage(request, storage.db, loadAppShell);
      if (page) return page;
    }
    if (pathname.startsWith("/api/") || pathname === "/mcp" || pathname.startsWith("/mcp/")) {
      return fetchPonderApp(request, env, executionContext);
    }
    return serveStatic(request);
  },
});

console.log(`[self-hosted] listening on ${server.url}`);
console.log(`[self-hosted] data directory: ${dataDirectory}`);
console.log(`[self-hosted] storage backend: ${config.storageBackend}`);
console.log(`[self-hosted] idle timeout: ${config.idleTimeout}s`);

let shuttingDown = false;
const shutdown = async (signal) => {
  if (shuttingDown) return;
  shuttingDown = true;
  console.log(`[self-hosted] received ${signal}; shutting down`);

  try {
    await server.stop();
    sqlite.exec("PRAGMA wal_checkpoint(TRUNCATE)");
    sqlite.close();
    console.log("[self-hosted] shutdown complete");
  } catch (error) {
    console.error("[self-hosted] shutdown failed", error);
    process.exitCode = 1;
  }
};

process.once("SIGTERM", () => void shutdown("SIGTERM"));
process.once("SIGINT", () => void shutdown("SIGINT"));
