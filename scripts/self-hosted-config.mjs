import { join, resolve } from "node:path";

const SUPPORTED_STORAGE_BACKENDS = new Set(["local", "s3"]);

const parseInteger = (value, fallback, name, minimum, maximum) => {
  const normalized = value?.trim();
  if (!normalized) return fallback;

  const parsed = Number(normalized);
  if (!Number.isInteger(parsed) || parsed < minimum || parsed > maximum) {
    throw new Error(`${name} must be an integer between ${minimum} and ${maximum}`);
  }
  return parsed;
};

export const resolveSelfHostedConfig = (environment = process.env, projectRoot = process.cwd()) => {
  const dataDirectory = resolve(environment.PONDER_DATA_DIR ?? join(projectRoot, ".ponder-data"));
  const storageBackend = (environment.PONDER_STORAGE_BACKEND ?? "local").trim().toLowerCase();

  if (!SUPPORTED_STORAGE_BACKENDS.has(storageBackend)) {
    throw new Error("PONDER_STORAGE_BACKEND must be either local or s3");
  }
  if (storageBackend === "s3" && !environment.PONDER_S3_BUCKET?.trim()) {
    throw new Error("PONDER_S3_BUCKET is required when PONDER_STORAGE_BACKEND=s3");
  }

  return {
    dataDirectory,
    databaseFile: resolve(environment.PONDER_SQLITE_FILE ?? join(dataDirectory, "ponder.sqlite")),
    resourcesDirectory: resolve(environment.PONDER_RESOURCES_DIR ?? join(dataDirectory, "resources")),
    webDirectory: resolve(environment.PONDER_WEB_DIR ?? join(projectRoot, "apps/web/dist")),
    hostname: environment.PONDER_HOST?.trim() || "0.0.0.0",
    port: parseInteger(environment.PORT ?? environment.PONDER_PORT, 8787, "PONDER_PORT", 1, 65_535),
    idleTimeout: parseInteger(
      environment.PONDER_IDLE_TIMEOUT_SECONDS,
      120,
      "PONDER_IDLE_TIMEOUT_SECONDS",
      10,
      255,
    ),
    storageBackend,
  };
};
