import { describe, expect, test } from "bun:test";
import { spawnSync } from "node:child_process";
import {
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { resolve } from "node:path";
import { tmpdir } from "node:os";
import {
  decideUpstreamSync,
  shouldRedeploy,
} from "../scripts/upstream-sync-plan.mjs";
import { repositoryWranglerConfigError } from "../scripts/wrangler-runner.mjs";
import {
  ponderDeploymentEnvironment,
  hasPlaceholderD1Binding,
  shouldRunPonderDeployment,
} from "../packages/wrangler/dispatch.mjs";

const repositoryRoot = resolve(import.meta.dir, "..");
const normalizeLineEndings = (value: string) => value.replace(/\r\n/g, "\n");
const readRepositoryFile = (path: string) =>
  normalizeLineEndings(readFileSync(resolve(repositoryRoot, path), "utf8"));
const runFixtureGit = (cwd: string, ...args: string[]) => {
  const result = spawnSync("git", args, { cwd, encoding: "utf8" });
  if (result.error) throw result.error;
  if (result.status !== 0) {
    throw new Error(
      `git ${args.join(" ")} failed:\n${result.stdout.trim()}\n${result.stderr.trim()}`,
    );
  }
};
const fixtureGitStatus = (cwd: string, ...args: string[]) =>
  spawnSync("git", args, { cwd, encoding: "utf8" }).status;
const writeFixtureFile = (cwd: string, path: string, content: string) => {
  const absolutePath = resolve(cwd, path);
  mkdirSync(resolve(absolutePath, ".."), { recursive: true });
  writeFileSync(absolutePath, content);
};
const initializeSyncFixture = (cwd: string) => {
  runFixtureGit(cwd, "init", "-b", "main");
  runFixtureGit(cwd, "config", "user.name", "Ponder Test");
  runFixtureGit(cwd, "config", "user.email", "ponder-test@example.com");
  runFixtureGit(cwd, "config", "core.autocrlf", "false");
};
const prepareFixtureUpstreamSync = (
  cwd: string,
  alignMode: "merge" | "snapshot",
  targetRevision: string,
) => {
  const result = spawnSync(
    "node",
    [resolve(repositoryRoot, "scripts/prepare-upstream-sync.mjs"), "prepare"],
    {
      cwd,
      encoding: "utf8",
      env: {
        ...process.env,
        EDGE_SYNC_ALIGN_MODE: alignMode,
        EDGE_SYNC_BASE_COMMIT: "HEAD",
        EDGE_SYNC_TARGET_COMMIT: targetRevision,
      },
    },
  );
  if (result.error) throw result.error;
  if (result.status !== 0) {
    throw new Error(`prepare-upstream-sync failed:\n${result.stdout}\n${result.stderr}`);
  }
};

describe("Cloudflare deployment entrypoints", () => {
  test("all entrypoints converge on the common deployment pipeline", () => {
    const packageJson = JSON.parse(readRepositoryFile("package.json"));
    const scripts = packageJson.scripts as Record<string, string>;

    expect(scripts.deploy).toContain("bun run build:cloudflare");
    expect(scripts.deploy).toContain("PONDER_USE_EXISTING_AUTH_SECRET=true");
    expect(scripts.deploy).toContain("deploy:ci");
    expect(scripts["deploy:manual"]).toBe(
      "export PONDER_DEPLOYMENT_TRIGGER=manual PONDER_DEPLOYMENT_METHOD=local_cli && bun run deploy:doctor && bun run build:cloudflare && bun run deploy:ci",
    );
    expect(scripts["deploy:ci"]).toBe(
      "bun run db:migrate:remote && bun run deploy:worker && bun run deploy:verify",
    );
    expect(scripts["deploy:cloudflare-builds"]).toBe(
      "PONDER_USE_EXISTING_AUTH_SECRET=true bun run deploy:ci",
    );
    expect(scripts["build:cloudflare"]).toContain("bun run build:worker");

    const wranglerConfig = readRepositoryFile("wrangler.toml");
    expect(wranglerConfig).toContain('main = ".wrangler/ponder-worker/index.js"');
    expect(wranglerConfig).toContain("no_bundle = true");
    expect(wranglerConfig).toContain("find_additional_modules = true");
    expect(wranglerConfig).toContain('globs = ["modules/*.js"]');
  });

  test("Cloudflare's default Wrangler command cannot bypass the deployment pipeline", () => {
    const packageJson = JSON.parse(readRepositoryFile("package.json"));
    const shimPackage = JSON.parse(readRepositoryFile("packages/wrangler/package.json"));
    const shim = readRepositoryFile("packages/wrangler/bin/wrangler.js");
    const englishGuide = readRepositoryFile("docs/deploy-cloudflare-button.md");

    expect(packageJson.devDependencies.wrangler).toBe("workspace:*");
    expect(shimPackage.name).toBe("wrangler");
    expect(shimPackage.dependencies["ponder-wrangler-cli"]).toMatch(/^npm:wrangler@/);
    expect(shim).toContain('["run", "deploy"]');
    const placeholderConfig = 'database_id = "00000000-0000-0000-0000-000000000000"';
    const legacyConfig = 'database_id = "11111111-1111-1111-1111-111111111111"';
    expect(hasPlaceholderD1Binding(placeholderConfig)).toBe(true);
    expect(hasPlaceholderD1Binding(legacyConfig)).toBe(false);
    expect(shouldRunPonderDeployment(
      ["deploy"],
      { WORKERS_CI: "1" },
      placeholderConfig,
    )).toBe(true);
    expect(shouldRunPonderDeployment(["deploy"], {}, placeholderConfig)).toBe(false);
    expect(shouldRunPonderDeployment(
      ["deploy"],
      { WORKERS_CI: "1" },
      legacyConfig,
    )).toBe(false);
    expect(shouldRunPonderDeployment(
      ["deploy"],
      { WORKERS_CI: "1", WRANGLER_CONFIG: "custom.toml" },
      placeholderConfig,
    )).toBe(false);
    expect(shouldRunPonderDeployment(
      ["deploy", "--config", "custom.toml"],
      { WORKERS_CI: "1" },
      placeholderConfig,
    )).toBe(false);
    expect(shouldRunPonderDeployment(
      ["deploy", "--env", "production"],
      { WORKERS_CI: "1" },
      placeholderConfig,
    )).toBe(false);
    expect(shouldRunPonderDeployment(
      ["deploy", "--name", "custom-worker"],
      { WORKERS_CI: "1" },
      placeholderConfig,
    )).toBe(false);
    expect(shouldRunPonderDeployment(
      ["deploy"],
      { WORKERS_CI: "1", PONDER_WRANGLER_BYPASS_SHIM: "1" },
      placeholderConfig,
    )).toBe(false);
    expect(ponderDeploymentEnvironment({ WORKERS_CI: "1" }))
      .toMatchObject({
        PONDER_DEPLOYMENT_TRIGGER: "main_push",
        PONDER_DEPLOYMENT_METHOD: "cloudflare_workers_builds_default",
      });
    expect(englishGuide).toContain("Deploy command: npx wrangler deploy");
  });

  test("deployment verification lets piped diagnostics flush before exiting", () => {
    const verificationScript = readRepositoryFile("scripts/verify-deployment.mjs");

    expect(verificationScript).toContain("process.exitCode = 1");
    expect(verificationScript).not.toContain("process.exit(1)");
  });

  test("online deployment declares the required authentication Secret", () => {
    const example = readRepositoryFile(".dev.vars.example");
    expect(example).toMatch(/^PONDER_AUTH_PASSWORD=\s*$/m);

    const packageJson = JSON.parse(readRepositoryFile("package.json"));
    expect(packageJson.cloudflare.bindings.PONDER_AUTH_PASSWORD.description).toBeTruthy();

    const englishGuide = readRepositoryFile("docs/deploy-cloudflare-button.md");
    expect(englishGuide).toContain("Worker runtime Secret, not a Workers Builds variable");
  });

  test("Workers Builds receives configuration but never the runtime password", () => {
    const setup = readRepositoryFile("scripts/cloudflare-workers-builds.mjs");

    expect(setup).toContain('"AUTH_USERNAME"');
    expect(setup).toContain('"AUTH_LOGIN_WINDOW_SECONDS"');
    expect(setup).not.toContain('"AUTH_PASSWORD",');
    expect(setup).not.toContain('"AUTH_PASSWORD_HASH",');
    expect(setup).not.toContain("Missing PONDER_AUTH_PASSWORD");
    expect(setup).toContain("is_secret: false");
  });

  test("online deployment resolves the D1 id without editing the repository config", () => {
    const runner = readRepositoryFile("scripts/run-wrangler.mjs");
    const wranglerConfig = readRepositoryFile("wrangler.toml");
    const englishAgentDoc = readRepositoryFile("docs/agent-deploy-cloudflare.md");

    expect(wranglerConfig).toContain(
      'database_id = "00000000-0000-0000-0000-000000000000"',
    );
    expect(runner).toContain('"d1", "list", "--json"');
    expect(runner).toContain("findD1DatabaseIdByName");
    expect(runner).toContain("repositoryWranglerConfigError(config, usesRepositoryConfig)");
    expect(runner).not.toContain("replace the database_id placeholder");
    expect(englishAgentDoc).toContain("automatically resolves the D1 UUID");
  });

  test("rejects instance-specific values in the repository Wrangler config", () => {
    const repositoryConfig = readRepositoryFile("wrangler.toml");
    expect(repositoryConfig).toContain('[version_metadata]\nbinding = "CF_VERSION_METADATA"');
    const instanceConfigs = [
      repositoryConfig.replace('name = "ponder"', 'name = "my-notes"'),
      repositoryConfig.replace("workers_dev = true", "workers_dev = false"),
      repositoryConfig.replace('database_name = "ponder"', 'database_name = "my-notes"'),
      repositoryConfig.replace(
        'database_id = "00000000-0000-0000-0000-000000000000"',
        'database_id = "11111111-1111-1111-1111-111111111111"',
      ),
      repositoryConfig.replace('bucket_name = "ponder-resources"', 'bucket_name = "my-notes"'),
      repositoryConfig.replace('compatibility_date = "2026-06-26"', 'compatibility_date = "2026-08-17"'),
      `${repositoryConfig}\n[vars]\nPONDER_AUTH_USERNAME = "owner"\n`,
      `${repositoryConfig}\n[[routes]]\npattern = "notes.example.com"\ncustom_domain = true\n`,
    ];

    for (const instanceConfig of instanceConfigs) {
      const error = repositoryWranglerConfigError(instanceConfig, true);
      expect(error).toContain("Refusing instance-specific setting");
      expect(error).toContain("PONDER_*");
      expect(error).toContain("WRANGLER_CONFIG");
    }
    expect(repositoryWranglerConfigError(repositoryConfig, true)).toBeUndefined();
    expect(repositoryWranglerConfigError(instanceConfigs[0], false)).toBeUndefined();
  });

  test("keeps D1 resolver diagnostics out of Wrangler JSON stdout", () => {
    const workingDirectory = mkdtempSync(resolve(tmpdir(), "ponder-wrangler-output-"));
    const wranglerBinDirectory = resolve(
      workingDirectory,
      "node_modules",
      "wrangler",
      "bin",
    );
    const queryOutput = JSON.stringify([{ results: [{ name: "users" }] }]);
    const inheritedEnvironment = Object.fromEntries(
      ["PATH", "Path", "PATHEXT", "SystemRoot", "ComSpec", "TEMP", "TMP"]
        .map((name) => [name, process.env[name]])
        .filter((entry): entry is [string, string] => Boolean(entry[1])),
    );
    const environment = {
      ...inheritedEnvironment,
      PONDER_INSTANCE: "",
      WRANGLER_CONFIG: resolve(workingDirectory, "wrangler.external.toml"),
    };

    try {
      mkdirSync(wranglerBinDirectory, { recursive: true });
      writeFileSync(
        resolve(workingDirectory, "wrangler.external.toml"),
        [
          'name = "ponder"',
          'database_name = "ponder"',
          'database_id = "00000000-0000-0000-0000-000000000000"',
          'bucket_name = "ponder-resources"',
          'preview_bucket_name = "ponder-resources-preview"',
          'migrations_dir = "migrations"',
          "",
        ].join("\n"),
      );
      writeFileSync(
        resolve(wranglerBinDirectory, "wrangler.js"),
        [
          'const args = process.argv.slice(2);',
          'if (args.includes("list")) {',
          '  process.stdout.write(JSON.stringify([{ name: "ponder", uuid: "11111111-1111-1111-1111-111111111111" }]));',
          "} else {",
          `  process.stdout.write(${JSON.stringify(`${queryOutput}\n`)});`,
          "}",
          "",
        ].join("\n"),
      );

      const resultPath = resolve(workingDirectory, "result.json");
      const runnerArguments = [
        "d1",
        "execute",
        "DB",
        "--remote",
        "--command",
        "SELECT name FROM sqlite_master",
        "--json",
      ];
      const harness = spawnSync(
        "node",
        [
          "-e",
          [
            'const { spawnSync } = require("node:child_process");',
            'const { writeFileSync } = require("node:fs");',
            "const result = spawnSync(",
            "  process.env.EDGE_TEST_RUNTIME,",
            "  [process.env.EDGE_TEST_RUNNER, ...JSON.parse(process.env.EDGE_TEST_ARGUMENTS)],",
            '  { cwd: process.env.EDGE_TEST_CWD, encoding: "utf8", env: process.env },',
            ");",
            "writeFileSync(process.env.EDGE_TEST_RESULT, JSON.stringify({",
            "  status: result.status,",
            "  stdout: result.stdout,",
            "  stderr: result.stderr,",
            "  error: result.error?.message,",
            "}));",
          ].join("\n"),
        ],
        {
          env: {
            ...environment,
            EDGE_TEST_ARGUMENTS: JSON.stringify(runnerArguments),
            EDGE_TEST_CWD: workingDirectory,
            EDGE_TEST_RESULT: resultPath,
            EDGE_TEST_RUNNER: resolve(repositoryRoot, "scripts", "run-wrangler.mjs"),
            EDGE_TEST_RUNTIME: process.execPath,
          },
        },
      );
      expect(harness.status).toBe(0);
      const result = JSON.parse(readFileSync(resultPath, "utf8")) as {
        error?: string;
        status: number;
        stderr: string;
        stdout: string;
      };

      expect(result.error).toBeUndefined();
      expect(result.status).toBe(0);
      expect(result.stdout).toBe(`${queryOutput}\n`);
      expect(result.stderr).toContain("[info] resolving Cloudflare D1 database id for ponder");
      expect(result.stderr).toContain("[ok] resolved D1 database ponder");
    } finally {
      rmSync(workingDirectory, { force: true, recursive: true });
    }
  });

  test("records the public Worker target reported by a CI deployment", () => {
    const workingDirectory = mkdtempSync(resolve(tmpdir(), "ponder-deployment-target-"));
    const wranglerBinDirectory = resolve(
      workingDirectory,
      "node_modules",
      "wrangler",
      "bin",
    );
    const inheritedEnvironment = Object.fromEntries(
      ["PATH", "Path", "PATHEXT", "SystemRoot", "ComSpec", "TEMP", "TMP"]
        .map((name) => [name, process.env[name]])
        .filter((entry): entry is [string, string] => Boolean(entry[1])),
    );

    try {
      mkdirSync(wranglerBinDirectory, { recursive: true });
      writeFileSync(
        resolve(workingDirectory, "wrangler.external.toml"),
        [
          'name = "ponder"',
          "workers_dev = true",
          'database_name = "ponder"',
          'database_id = "11111111-1111-1111-1111-111111111111"',
          'bucket_name = "ponder-resources"',
          'preview_bucket_name = "ponder-resources-preview"',
          'migrations_dir = "migrations"',
          "",
        ].join("\n"),
      );
      writeFileSync(
        resolve(wranglerBinDirectory, "wrangler.js"),
        [
          'if (process.argv.includes("deployments")) {',
          '  process.stdout.write(JSON.stringify({ versions: [{ version_id: "legacy-version", percentage: 100 }] }));',
          '} else if (process.argv.includes("versions")) {',
          '  process.stdout.write(JSON.stringify({ resources: { bindings: [',
          '    { name: "RESOURCES", type: "r2_bucket", bucket_name: "legacy-user-resources" },',
          '    { name: "PONDER_AUTH_USERNAME", type: "plain_text", text: "legacy-owner" }',
          '  ] } }));',
          '} else if (process.argv.includes("deploy")) {',
          '  process.stdout.write("Uploaded ponder\\nDeployed ponder triggers (0.4 sec)\\n  https://ponder.example.workers.dev\\nCurrent Version ID: version-1\\n");',
          "}",
          "",
        ].join("\n"),
      );

      const result = spawnSync(
        process.execPath,
        [resolve(repositoryRoot, "scripts", "run-wrangler.mjs"), "deploy"],
        {
          cwd: workingDirectory,
          encoding: "utf8",
          env: {
            ...inheritedEnvironment,
            CI: "true",
            PONDER_AUTH_PASSWORD: "test-password",
            PONDER_INSTANCE: "",
            WRANGLER_CONFIG: resolve(workingDirectory, "wrangler.external.toml"),
          },
        },
      );

      expect(result.status).toBe(0);
      expect(JSON.parse(readFileSync(
        resolve(workingDirectory, ".wrangler.deployment-targets.json"),
        "utf8",
      ))).toEqual({
        urls: ["https://ponder.example.workers.dev"],
        versionId: "version-1",
      });
      const generatedConfig = readFileSync(
        resolve(workingDirectory, ".wrangler.generated.toml"),
        "utf8",
      );
      expect(generatedConfig).toContain('bucket_name = "legacy-user-resources"');
      expect(generatedConfig).toContain('PONDER_R2_BUCKET_NAME = "legacy-user-resources"');
      expect(generatedConfig).toContain('PONDER_AUTH_USERNAME = "legacy-owner"');
    } finally {
      rmSync(workingDirectory, { force: true, recursive: true });
    }
  });

  test("deployed repositories receive guarded daily upstream updates", () => {
    const workflow = readRepositoryFile(".github/workflows/sync-ponder-upstream.yml");
    const bunConfig = Bun.TOML.parse(readRepositoryFile("bunfig.toml")) as {
      test: { pathIgnorePatterns: string[] };
    };
    const packageJson = JSON.parse(readRepositoryFile("package.json"));
    const scripts = packageJson.scripts as Record<string, string>;

    expect(workflow).toContain("github.repository != 'tianma-if/edgeever'");
    expect(workflow).toContain("UPSTREAM_REPOSITORY: tianma-if/edgeever");
    expect(workflow).toContain("Require a GitHub Fork");
    expect(workflow).toContain(".fork");
    expect(workflow).toContain("PONDER_UPDATE_CHANNEL");
    expect(workflow).toContain("stable)");
    expect(workflow).toContain("edge)");
    expect(workflow).toContain("FORCE_REDEPLOY: ${{ github.event_name == 'workflow_dispatch' }}");
    expect(workflow).not.toContain("force_redeploy:");
    expect(workflow).toContain("bun run db:migrate:local");
    expect(bunConfig.test.pathIgnorePatterns).toContain("tests/e2e/**");
    expect(scripts.test).toBe("bun run test:bulk && bun run test:integration");
    for (const pattern of bunConfig.test.pathIgnorePatterns) {
      expect(scripts["test:bulk"]).toContain(`--path-ignore-patterns='${pattern}'`);
    }
    expect(scripts["test:bulk"]).toContain("apps/api/src/companion-learning.test.mjs");
    expect(scripts["test:bulk"]).toContain("apps/api/src/resource-upload-integration.test.mjs");
    expect(scripts["test:bulk"]).toContain("apps/desktop/src/main/workbuddy-auth.test.mjs");
    expect(scripts["test:bulk"]).toContain("apps/desktop/src/main/acp-cleanup.test.mjs");
    expect(scripts["test:integration"]).toBe(
      "bun test apps/api/src/companion-learning.test.mjs apps/api/src/resource-upload-integration.test.mjs && bun test --cwd apps/desktop src/main/workbuddy-auth.test.mjs src/main/acp-cleanup.test.mjs",
    );
    expect(workflow).toContain("bun run test");
    expect(workflow.match(/if: steps\.upstream\.outputs\.align_mode == 'merge'/g)).toHaveLength(2);
    expect(workflow).toContain("git push origin HEAD:main");
    expect(workflow).not.toContain("git push --force-with-lease origin HEAD:main");
    expect(workflow).not.toContain("git reset --hard");
    expect(workflow).toContain("scripts/prepare-upstream-sync.mjs");
    expect(workflow).toContain("':(exclude).github/workflows/**'");
    expect(workflow).toContain("planner_path");
    expect(workflow).toContain('if [ "${align_mode}" = "reset" ]');
    expect(workflow).toContain("Refusing to publish an update that changes the downstream updater");
    expect(workflow).toContain("content_matches_target");
    expect(workflow).toContain("already_on_target");
    expect(workflow).toContain("fork_mode=mirror");
    expect(workflow).toContain("GITHUB_STEP_SUMMARY");
    expect(workflow).toContain("name: Sync Fork and trigger deployment");
    expect(workflow).toContain("name: Report result");
    expect(workflow).toContain("::notice title=Manual redeploy");
    expect(workflow).toContain("PUBLISH_OUTCOME: ${{ steps.publish.outcome }}");
    expect(workflow).toContain("DEPLOY_TRIGGER_OUTCOME: ${{ steps.deploy.outcome }}");
    expect(workflow).toContain("| Git publish |");
    expect(workflow).toContain("| Deployment trigger |");
    expect(workflow).toContain("| Live deployment |");
    expect(workflow).toContain("Not verified by this workflow");
    expect(workflow).toContain("PONDER_CLOUDFLARE_DEPLOY_HOOK_URL");
    expect(workflow).toContain("PONDER_PRESERVE_FORK_CHANGES");
    expect(workflow).toContain("PRESERVE_FORK_CHANGES");
    expect(workflow).not.toContain("upstream_merge_base");
    expect(workflow).not.toContain("local_app_changes");
    expect(workflow).toContain("scripts/upstream-sync-plan.mjs");
    expect(workflow).toContain("Prefer this workflow over GitHub **Sync fork**");
  });

  test("forks skip every workflow job except upstream updates", () => {
    const workflowsDirectory = resolve(repositoryRoot, ".github/workflows");
    const workflowFiles = readdirSync(workflowsDirectory)
      .filter((file) => /\.ya?ml$/.test(file))
      .filter((file) => file !== "sync-ponder-upstream.yml");

    for (const file of workflowFiles) {
      const workflow = readRepositoryFile(`.github/workflows/${file}`);
      const jobs = workflow.slice(workflow.indexOf("\njobs:\n") + "\njobs:\n".length);
      const jobStarts = [...jobs.matchAll(/^  ([A-Za-z0-9_-]+):\s*$/gm)];

      expect(jobStarts.length).toBeGreaterThan(0);
      for (const [index, match] of jobStarts.entries()) {
        const nextJob = jobStarts[index + 1];
        const job = jobs.slice(match.index, nextJob?.index);
        expect(job).toContain("github.repository == 'tianma-if/edgeever'");
      }
    }
  });

  test("republishes an already-aligned deploy mirror when redeploy is requested", () => {
    expect(
      decideUpstreamSync({
        contentMatchesTarget: true,
        forceRedeploy: true,
        headEqualsTarget: true,
        headIsAncestorOfTarget: true,
        preserveForkChanges: false,
        targetIsAncestorOfHead: true,
      }),
    ).toEqual({
      alignMode: "none",
      reason: "already_on_target",
      republishOnly: true,
      updateRequired: false,
    });
  });

  test("manual dispatch redeploys through an older Fork workflow", () => {
    expect(shouldRedeploy({
      eventName: "workflow_dispatch",
      forceRedeploy: false,
    })).toBe(true);
    expect(shouldRedeploy({
      eventName: "schedule",
      forceRedeploy: false,
    })).toBe(false);
  });

  test("snapshots a deploy mirror that moved ahead of the stable release", () => {
    expect(
      decideUpstreamSync({
        contentMatchesTarget: false,
        forceRedeploy: false,
        headEqualsTarget: false,
        headIsAncestorOfTarget: false,
        preserveForkChanges: false,
        targetIsAncestorOfHead: true,
      }),
    ).toEqual({
      alignMode: "snapshot",
      reason: "deploy_mirror_ahead",
      republishOnly: false,
      updateRequired: true,
    });
  });

  test("preserves changes only when a customized fork explicitly opts in", () => {
    expect(
      decideUpstreamSync({
        contentMatchesTarget: false,
        forceRedeploy: false,
        headEqualsTarget: false,
        headIsAncestorOfTarget: false,
        preserveForkChanges: true,
        targetIsAncestorOfHead: true,
      }),
    ).toEqual({
      alignMode: "none",
      reason: "customized_contains_target",
      republishOnly: false,
      updateRequired: false,
    });
  });

  test("merges a diverged customized fork only after explicit opt-in", () => {
    expect(
      decideUpstreamSync({
        contentMatchesTarget: false,
        forceRedeploy: false,
        headEqualsTarget: false,
        headIsAncestorOfTarget: false,
        preserveForkChanges: true,
        targetIsAncestorOfHead: false,
      }),
    ).toEqual({
      alignMode: "merge",
      reason: "customized_merge",
      republishOnly: false,
      updateRequired: true,
    });
  });

  test("prepares a linear product snapshot without changing downstream workflows", () => {
    const workingDirectory = mkdtempSync(resolve(tmpdir(), "ponder-upstream-snapshot-"));

    try {
      initializeSyncFixture(workingDirectory);
      writeFixtureFile(workingDirectory, "app.txt", "base\n");
      writeFixtureFile(workingDirectory, "removed.txt", "remove me\n");
      writeFixtureFile(
        workingDirectory,
        ".github/workflows/sync-ponder-upstream.yml",
        "name: downstream base\n",
      );
      writeFixtureFile(
        workingDirectory,
        "scripts/prepare-upstream-sync.mjs",
        "// downstream prepare helper\n",
      );
      writeFixtureFile(
        workingDirectory,
        "scripts/upstream-sync-plan.mjs",
        "// downstream planner\n",
      );
      runFixtureGit(workingDirectory, "add", ".");
      runFixtureGit(workingDirectory, "commit", "-m", "base");

      runFixtureGit(workingDirectory, "checkout", "-b", "upstream");
      writeFixtureFile(workingDirectory, "app.txt", "upstream target\n");
      writeFixtureFile(workingDirectory, "added.txt", "added upstream\n");
      writeFixtureFile(
        workingDirectory,
        ".github/workflows/sync-ponder-upstream.yml",
        "name: upstream changed\n",
      );
      writeFixtureFile(
        workingDirectory,
        ".github/workflows/windows-test-signing.yml",
        "name: official only\n",
      );
      writeFixtureFile(
        workingDirectory,
        "scripts/prepare-upstream-sync.mjs",
        "// upstream prepare helper\n",
      );
      writeFixtureFile(
        workingDirectory,
        "scripts/upstream-sync-plan.mjs",
        "// upstream planner\n",
      );
      rmSync(resolve(workingDirectory, "removed.txt"));
      runFixtureGit(workingDirectory, "add", "-A");
      runFixtureGit(workingDirectory, "commit", "-m", "upstream target");

      runFixtureGit(workingDirectory, "checkout", "-b", "downstream", "main");
      writeFixtureFile(workingDirectory, "app.txt", "stale downstream product\n");
      writeFixtureFile(
        workingDirectory,
        ".github/workflows/sync-ponder-upstream.yml",
        "name: downstream updater\n",
      );
      runFixtureGit(workingDirectory, "add", ".");
      runFixtureGit(workingDirectory, "commit", "-m", "downstream state");
      runFixtureGit(workingDirectory, "tag", "downstream-base");

      prepareFixtureUpstreamSync(workingDirectory, "snapshot", "upstream");

      expect(readFileSync(resolve(workingDirectory, "app.txt"), "utf8")).toBe(
        "upstream target\n",
      );
      expect(readFileSync(resolve(workingDirectory, "added.txt"), "utf8")).toBe(
        "added upstream\n",
      );
      expect(readFileSync(resolve(
        workingDirectory,
        ".github/workflows/sync-ponder-upstream.yml",
      ), "utf8")).toBe("name: downstream updater\n");
      expect(readFileSync(resolve(
        workingDirectory,
        "scripts/prepare-upstream-sync.mjs",
      ), "utf8")).toBe("// downstream prepare helper\n");
      expect(readFileSync(resolve(
        workingDirectory,
        "scripts/upstream-sync-plan.mjs",
      ), "utf8")).toBe("// downstream planner\n");
      expect(readdirSync(resolve(workingDirectory, ".github/workflows"))).toEqual([
        "sync-ponder-upstream.yml",
      ]);
      expect(fixtureGitStatus(
        workingDirectory,
        "diff",
        "--cached",
        "--quiet",
        "--",
        ".github/workflows",
        "scripts/prepare-upstream-sync.mjs",
        "scripts/upstream-sync-plan.mjs",
      )).toBe(0);

      runFixtureGit(workingDirectory, "commit", "-m", "sync upstream product");
      expect(fixtureGitStatus(workingDirectory, "diff", "--quiet", "downstream-base", "HEAD^"))
        .toBe(0);
      expect(fixtureGitStatus(workingDirectory, "rev-parse", "--verify", "HEAD^2"))
        .not.toBe(0);
      expect(fixtureGitStatus(
        workingDirectory,
        "diff",
        "--quiet",
        "upstream",
        "HEAD",
        "--",
        ".",
        ":(exclude).github/workflows/**",
        ":(exclude)scripts/prepare-upstream-sync.mjs",
        ":(exclude)scripts/upstream-sync-plan.mjs",
      )).toBe(0);
      expect(fixtureGitStatus(
        workingDirectory,
        "diff",
        "--quiet",
        "downstream-base",
        "HEAD",
        "--",
        ".github/workflows",
        "scripts/prepare-upstream-sync.mjs",
        "scripts/upstream-sync-plan.mjs",
      )).toBe(0);
    } finally {
      rmSync(workingDirectory, { force: true, recursive: true });
    }
  });

  test("flattens customized merges and preserves their downstream workflows", () => {
    const workingDirectory = mkdtempSync(resolve(tmpdir(), "ponder-upstream-merge-"));

    try {
      initializeSyncFixture(workingDirectory);
      writeFixtureFile(workingDirectory, "upstream.txt", "base\n");
      writeFixtureFile(workingDirectory, "custom.txt", "base\n");
      writeFixtureFile(
        workingDirectory,
        ".github/workflows/sync-ponder-upstream.yml",
        "name: base\n",
      );
      runFixtureGit(workingDirectory, "add", ".");
      runFixtureGit(workingDirectory, "commit", "-m", "base");

      runFixtureGit(workingDirectory, "checkout", "-b", "upstream");
      writeFixtureFile(workingDirectory, "upstream.txt", "upstream target\n");
      writeFixtureFile(
        workingDirectory,
        ".github/workflows/sync-ponder-upstream.yml",
        "name: upstream workflow\n",
      );
      runFixtureGit(workingDirectory, "add", ".");
      runFixtureGit(workingDirectory, "commit", "-m", "upstream target");
      runFixtureGit(workingDirectory, "tag", "upstream-v1");

      runFixtureGit(workingDirectory, "checkout", "-b", "downstream", "main");
      writeFixtureFile(workingDirectory, "custom.txt", "downstream customization\n");
      writeFixtureFile(
        workingDirectory,
        ".github/workflows/sync-ponder-upstream.yml",
        "name: downstream updater\n",
      );
      runFixtureGit(workingDirectory, "add", ".");
      runFixtureGit(workingDirectory, "commit", "-m", "customized downstream");
      runFixtureGit(workingDirectory, "tag", "downstream-base");

      prepareFixtureUpstreamSync(workingDirectory, "merge", "upstream-v1");

      expect(readFileSync(resolve(workingDirectory, "upstream.txt"), "utf8")).toBe(
        "upstream target\n",
      );
      expect(readFileSync(resolve(workingDirectory, "custom.txt"), "utf8")).toBe(
        "downstream customization\n",
      );
      expect(readFileSync(resolve(
        workingDirectory,
        ".github/workflows/sync-ponder-upstream.yml",
      ), "utf8")).toBe("name: downstream updater\n");

      runFixtureGit(
        workingDirectory,
        "commit",
        "-m",
        "sync customized fork",
        "-m",
        "Ponder-Upstream-Commit: upstream-v1",
      );
      expect(fixtureGitStatus(workingDirectory, "diff", "--quiet", "downstream-base", "HEAD^"))
        .toBe(0);
      expect(fixtureGitStatus(workingDirectory, "rev-parse", "--verify", "HEAD^2"))
        .not.toBe(0);
      expect(fixtureGitStatus(
        workingDirectory,
        "diff",
        "--quiet",
        "downstream-base",
        "HEAD",
        "--",
        ".github/workflows",
      )).toBe(0);

      runFixtureGit(workingDirectory, "checkout", "upstream");
      writeFixtureFile(workingDirectory, "upstream.txt", "upstream target v2\n");
      writeFixtureFile(
        workingDirectory,
        ".github/workflows/sync-ponder-upstream.yml",
        "name: upstream workflow v2\n",
      );
      runFixtureGit(workingDirectory, "add", ".");
      runFixtureGit(workingDirectory, "commit", "-m", "upstream target v2");
      runFixtureGit(workingDirectory, "tag", "upstream-v2");
      runFixtureGit(workingDirectory, "checkout", "downstream");
      prepareFixtureUpstreamSync(workingDirectory, "merge", "upstream-v2");

      expect(readFileSync(resolve(workingDirectory, "upstream.txt"), "utf8")).toBe(
        "upstream target v2\n",
      );
      expect(readFileSync(resolve(workingDirectory, "custom.txt"), "utf8")).toBe(
        "downstream customization\n",
      );
      expect(readFileSync(resolve(
        workingDirectory,
        ".github/workflows/sync-ponder-upstream.yml",
      ), "utf8")).toBe("name: downstream updater\n");
      runFixtureGit(
        workingDirectory,
        "commit",
        "-m",
        "sync customized fork v2",
        "-m",
        "Ponder-Upstream-Commit: upstream-v2",
      );
      expect(fixtureGitStatus(workingDirectory, "rev-parse", "--verify", "HEAD^2"))
        .not.toBe(0);
    } finally {
      rmSync(workingDirectory, { force: true, recursive: true });
    }
  }, 20_000);

  // Ponder's README sends people to AppKeep; the inherited self-hosting guides live in docs/.
  test("the README points to AppKeep and offers no one-click Cloudflare deploy", () => {
    const readme = readRepositoryFile("README.md");

    expect(readme).toContain("https://appkeep.io/apps/ponder");
    expect(readme).not.toContain("deploy.workers.cloudflare.com");
  });

  test("product site deployment copy comes from the shared prompts", () => {
    const siteDeploymentComponent = readRepositoryFile(
      "apps/site/src/components/agent-install-tabs.astro",
    );

    expect(siteDeploymentComponent).toContain('deploymentPrompts["en-US"]');
    expect(siteDeploymentComponent).toContain('manualDeploymentCopy["en-US"]');
    expect(siteDeploymentComponent).toContain("UnionPay");
    expect(siteDeploymentComponent).toContain("free storage allowance");
    expect(siteDeploymentComponent).not.toContain("dual-currency credit card");
    expect(siteDeploymentComponent).not.toContain("China Merchants Bank");
  });

  test("AI Agent deployment remains fully online", () => {
    const englishAgentDoc = readRepositoryFile("docs/agent-deploy-cloudflare.md");

    expect(englishAgentDoc).toContain("Workers & Pages");
    expect(englishAgentDoc).toContain("Update deployed Ponder");
    expect(englishAgentDoc).toContain("deployment mirror by default");
    expect(englishAgentDoc).toContain("PONDER_PRESERVE_FORK_CHANGES");
    expect(englishAgentDoc).not.toContain("bun run deploy:manual");
    expect(englishAgentDoc).not.toContain("deploy:setup");
    expect(englishAgentDoc).not.toContain(".env.local");
  });
});
