import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync, statSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const MAC_ARCHES = ["arm64", "x64"];

const sha512File = (path) =>
  createHash("sha512").update(readFileSync(path)).digest("base64");

export const buildMacUpdateMetadata = ({
  version,
  outputDirectory,
  releaseDate = new Date().toISOString(),
}) => {
  assert.match(version, /^\d+\.\d+\.\d+$/, `Invalid desktop version: ${version}`);
  const files = MAC_ARCHES.map((arch) => {
    const url = `Ponder-${version}-mac-${arch}.zip`;
    const path = join(outputDirectory, url);
    return {
      url,
      sha512: sha512File(path),
      size: statSync(path).size,
    };
  });
  const primary = files[0];
  const lines = [
    `version: ${version}`,
    "files:",
    ...files.flatMap((file) => [
      `  - url: ${file.url}`,
      `    sha512: ${file.sha512}`,
      `    size: ${file.size}`,
    ]),
    `path: ${primary.url}`,
    `sha512: ${primary.sha512}`,
    `releaseDate: '${releaseDate}'`,
    "",
  ];
  return lines.join("\n");
};

const run = () => {
  const [outputDirectoryValue, version] = process.argv.slice(2);
  if (!outputDirectoryValue || !version) {
    console.error(
      "Usage: node scripts/create-mac-update-metadata.mjs <output-directory> <version>",
    );
    process.exit(1);
  }
  const outputDirectory = resolve(outputDirectoryValue);
  writeFileSync(
    join(outputDirectory, "latest-mac.yml"),
    buildMacUpdateMetadata({ version, outputDirectory }),
  );
};

if (
  process.argv[1] &&
  resolve(process.argv[1]) === fileURLToPath(import.meta.url)
) {
  run();
}
