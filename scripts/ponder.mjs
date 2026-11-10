#!/usr/bin/env bun

import { mkdir, readFile, writeFile } from "node:fs/promises";
import { basename, dirname, join } from "node:path";
import { homedir } from "node:os";

const CONFIG_PATH = process.env.PONDER_CONFIG || join(homedir(), ".ponder", "config.json");
const DEFAULT_URL = "http://127.0.0.1:8787";
const rawArgs = process.argv.slice(2);
const globalOptions = parseOptions(rawArgs);
const commandArgs = stripGlobalOptions(rawArgs, new Set(["profile"]));
const [command, ...argv] = commandArgs;

const usage = `Ponder CLI

Usage:
  bun run cli -- profile set <name> --url <url> --token <token>
  bun run cli -- profile list
  bun run cli -- --profile <name> notebooks
  bun run cli -- --profile <name> tags
  bun run cli -- --profile <name> search <query>
  bun run cli -- --profile <name> get <memoId>
  bun run cli -- --profile <name> create --notebook <id> [--title <title>] [--body <markdown> | --body-file <path>] [--tags a,b]
  bun run cli -- --profile <name> update <memoId> [--title <title>] [--body <markdown> | --body-file <path>] [--tags a,b] [--notebook <id>]
  bun run cli -- --profile <name> move --notebook <id> <memoId...>
  bun run cli -- --profile <name> merge [--notebook <id>] [--title <title>] <memoId...>
  bun run cli -- --profile <name> upload --memo <id> --file <path> [--type <mime>]
  bun run cli -- --profile <name> export <memoId> [--format markdown|json] [--out <path>]

Env fallback:
  PONDER_URL=http://127.0.0.1:8787
  PONDER_TOKEN=...
`;

if (!command || command === "help" || command === "--help" || command === "-h") {
  console.log(usage);
  process.exit(0);
}

const main = async () => {
  if (command === "profile") {
    return handleProfileCommand(argv);
  }

  const client = await createClient(globalOptions.profile);

  switch (command) {
    case "notebooks":
      return printJson(await client.request("/api/v1/notebooks"));
    case "tags":
      return printJson(await client.request("/api/v1/tags"));
    case "search": {
      const query = argv.join(" ").trim();
      const params = new URLSearchParams();

      if (query) {
        params.set("q", query);
      }

      return printJson(await client.request(`/api/v1/memos?${params.toString()}`));
    }
    case "get": {
      const memoId = requireValue(argv[0], "memoId");
      return printJson(await client.request(`/api/v1/memos/${encodeURIComponent(memoId)}`));
    }
    case "create": {
      const options = parseOptions(argv);
      const notebookId = requireValue(options.notebook, "--notebook");
      const body = await readBodyOption(options);

      return printJson(
        await client.request("/api/v1/memos", {
          method: "POST",
          body: {
            notebookId,
            title: options.title,
            contentMarkdown: body,
            tags: parseTags(options.tags),
          },
        })
      );
    }
    case "update": {
      const memoId = requireValue(argv[0], "memoId");
      const options = parseOptions(argv.slice(1));
      const body = options.body || options["body-file"] ? await readBodyOption(options) : undefined;
      const payload = removeUndefined({
        title: options.title,
        notebookId: options.notebook,
        contentMarkdown: body,
        tags: options.tags === undefined ? undefined : parseTags(options.tags),
      });

      return printJson(
        await client.request(`/api/v1/memos/${encodeURIComponent(memoId)}`, {
          method: "PATCH",
          body: payload,
        })
      );
    }
    case "move": {
      const options = parseOptions(argv);
      const memoIds = positionalArgs(argv);

      return printJson(
        await client.request("/api/v1/memos/batch/move", {
          method: "POST",
          body: {
            notebookId: requireValue(options.notebook, "--notebook"),
            memoIds,
          },
        })
      );
    }
    case "merge": {
      const options = parseOptions(argv);
      const memoIds = positionalArgs(argv);

      return printJson(
        await client.request("/api/v1/memos/merge", {
          method: "POST",
          body: removeUndefined({
            notebookId: options.notebook,
            title: options.title,
            memoIds,
          }),
        })
      );
    }
    case "upload": {
      const options = parseOptions(argv);
      const memoId = requireValue(options.memo, "--memo");
      const filePath = requireValue(options.file, "--file");
      return printJson(await client.uploadMemoResource(memoId, filePath, options.type));
    }
    case "export": {
      const memoId = requireValue(argv[0], "memoId");
      const options = parseOptions(argv.slice(1));
      const format = options.format === "json" ? "json" : "markdown";
      const data = await client.request(`/api/v1/memos/${encodeURIComponent(memoId)}`);
      const output = format === "json" ? `${JSON.stringify(data.memo, null, 2)}\n` : data.memo.contentMarkdown;

      if (options.out) {
        await writeFile(options.out, output);
        return;
      }

      process.stdout.write(output);
      return;
    }
    default:
      console.error(`Unknown command: ${command}\n`);
      console.error(usage);
      process.exit(1);
  }
};

const createClient = async (profileName) => {
  const config = await readConfig();
  const profile = profileName ? config.profiles?.[profileName] : undefined;
  const baseUrl = (process.env.PONDER_URL || profile?.url || DEFAULT_URL).replace(/\/+$/, "");
  const token = process.env.PONDER_TOKEN || profile?.token;

  if (!token) {
    throw new Error("PONDER_TOKEN is required, or configure a profile with `ponder profile set`.");
  }

  return {
    request: (path, init = {}) => request(baseUrl, token, path, init),
    uploadMemoResource: (memoId, filePath, mimeType) => uploadMemoResource(baseUrl, token, memoId, filePath, mimeType),
  };
};

const request = async (baseUrl, token, path, init = {}) => {
  const response = await fetch(`${baseUrl}${path}`, {
    method: init.method || "GET",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
    },
    body: init.body === undefined ? undefined : JSON.stringify(init.body),
  });
  const body = await response.json().catch(() => null);

  if (!response.ok) {
    const message = body?.error?.message || response.statusText;
    throw new Error(`${response.status} ${message}`);
  }

  return body;
};

const uploadMemoResource = async (baseUrl, token, memoId, filePath, mimeType) => {
  const bytes = await readFile(filePath);
  const form = new FormData();
  form.append("file", new File([bytes], basename(filePath), { type: mimeType || inferMimeType(filePath) }));

  const response = await fetch(`${baseUrl}/api/v1/memos/${encodeURIComponent(memoId)}/resources`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
    },
    body: form,
  });
  const body = await response.json().catch(() => null);

  if (!response.ok) {
    const message = body?.error?.message || response.statusText;
    throw new Error(`${response.status} ${message}`);
  }

  return body;
};

const handleProfileCommand = async (args) => {
  const [subcommand, name, ...rest] = args;

  if (subcommand === "list") {
    const config = await readConfig();
    return printJson({
      profiles: Object.entries(config.profiles || {}).map(([profileName, profile]) => ({
        name: profileName,
        url: profile.url,
        hasToken: Boolean(profile.token),
      })),
    });
  }

  if (subcommand === "set") {
    const profileName = requireValue(name, "profile name");
    const options = parseOptions(rest);
    const config = await readConfig();
    config.profiles = config.profiles || {};
    config.profiles[profileName] = {
      url: requireValue(options.url, "--url").replace(/\/+$/, ""),
      token: requireValue(options.token, "--token"),
    };
    await writeConfig(config);
    return printJson({ ok: true, profile: profileName, path: CONFIG_PATH });
  }

  throw new Error("Unknown profile command.");
};

const readConfig = async () => {
  try {
    const value = JSON.parse(await readFile(CONFIG_PATH, "utf8"));
    return value && typeof value === "object" ? value : {};
  } catch {
    return {};
  }
};

const writeConfig = async (config) => {
  await mkdir(dirname(CONFIG_PATH), { recursive: true, mode: 0o700 });
  await writeFile(CONFIG_PATH, `${JSON.stringify(config, null, 2)}\n`, { mode: 0o600 });
};

function parseOptions(args) {
  const options = {};

  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];

    if (!arg.startsWith("--")) {
      continue;
    }

    const key = arg.slice(2);
    const next = args[index + 1];

    if (!next || next.startsWith("--")) {
      options[key] = "true";
      continue;
    }

    options[key] = next;
    index += 1;
  }

  return options;
}

function positionalArgs(args) {
  const values = [];

  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];

    if (!arg.startsWith("--")) {
      values.push(arg);
      continue;
    }

    const next = args[index + 1];

    if (next && !next.startsWith("--")) {
      index += 1;
    }
  }

  return values;
}

function stripGlobalOptions(args, globalKeys) {
  const result = [];

  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];

    if (!arg.startsWith("--") || !globalKeys.has(arg.slice(2))) {
      result.push(arg);
      continue;
    }

    if (args[index + 1] && !args[index + 1].startsWith("--")) {
      index += 1;
    }
  }

  return result;
}

const readBodyOption = async (options) => {
  if (options["body-file"]) {
    return readFile(options["body-file"], "utf8");
  }

  return options.body || "";
};

const parseTags = (value) =>
  value
    ? value
        .split(/[,，\s]+/)
        .map((tag) => tag.trim().replace(/^#/, ""))
        .filter(Boolean)
    : [];

const inferMimeType = (filePath) => {
  const normalized = filePath.toLowerCase();

  if (normalized.endsWith(".png")) {
    return "image/png";
  }

  if (normalized.endsWith(".jpg") || normalized.endsWith(".jpeg")) {
    return "image/jpeg";
  }

  if (normalized.endsWith(".gif")) {
    return "image/gif";
  }

  if (normalized.endsWith(".webp")) {
    return "image/webp";
  }

  if (normalized.endsWith(".avif")) {
    return "image/avif";
  }

  return "application/octet-stream";
};

const removeUndefined = (value) =>
  Object.fromEntries(Object.entries(value).filter(([, item]) => item !== undefined));

const requireValue = (value, name) => {
  if (!value) {
    throw new Error(`${name} is required.`);
  }

  return value;
};

const printJson = (value) => {
  console.log(JSON.stringify(value, null, 2));
};

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
