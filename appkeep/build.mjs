// Builds Ponder for AppKeep: one ES module (dist/app.js) from entry.mjs with the same
// esbuild settings as Ponder's scripts/build-cloudflare-worker.mjs, minus code splitting,
// since an AppKeep package's prebuilt module is a single file. Copies the D1 migrations.
//   bun run build:web      (from the repo root, Node 24)
//   node appkeep/build.mjs
//   appkeep publish appkeep --prebuilt appkeep/dist/app.js --assets apps/web/dist
import { build } from "esbuild";
import fs from "node:fs";
import path from "node:path";
import { execSync } from "node:child_process";

const here = path.dirname(new URL(import.meta.url).pathname);
const src = path.join(here, "..");
const buildId = execSync("git rev-parse --short=12 HEAD", { cwd: src, encoding: "utf8" }).trim();

await build({
  entryPoints: [path.join(here, "entry.mjs")],
  outfile: path.join(here, "dist/app.js"),
  absWorkingDir: src,
  nodePaths: [path.join(src, "node_modules")],
  bundle: true,
  format: "esm",
  platform: "browser",
  target: "es2022",
  conditions: ["workerd", "worker", "browser"],
  external: ["cloudflare:*"],
  minify: true,
  keepNames: true,
  legalComments: "none",
  define: {
    __PONDER_INSTANCE_BUILD_ID__: JSON.stringify(buildId),
    __PONDER_INSTANCE_DEPLOYMENT_TRIGGER__: JSON.stringify("manual"),
    __PONDER_INSTANCE_DEPLOYMENT_METHOD__: JSON.stringify("appkeep"),
  },
});

fs.rmSync(path.join(here, "migrations"), { recursive: true, force: true });
fs.cpSync(path.join(src, "migrations"), path.join(here, "migrations"), { recursive: true });
const size = fs.statSync(path.join(here, "dist/app.js")).size;
console.log(`dist/app.js ${(size / 1024).toFixed(0)} KB, ${fs.readdirSync(path.join(here, "migrations")).length} migrations`);
