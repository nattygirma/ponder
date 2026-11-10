import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, test } from "bun:test";
import { buildMacUpdateMetadata } from "./create-mac-update-metadata.mjs";

describe("macOS update metadata", () => {
  test("lists architecture-specific ZIPs so the updater can select the matching Mac", () => {
    const outputDirectory = mkdtempSync(join(tmpdir(), "ponder-update-metadata-"));
    writeFileSync(join(outputDirectory, "Ponder-1.7.0-mac-arm64.zip"), "arm");
    writeFileSync(join(outputDirectory, "Ponder-1.7.0-mac-x64.zip"), "intel");

    const metadata = buildMacUpdateMetadata({
      version: "1.7.0",
      outputDirectory,
      releaseDate: "2026-07-30T00:00:00.000Z",
    });

    expect(metadata).toContain("Ponder-1.7.0-mac-arm64.zip");
    expect(metadata).toContain("Ponder-1.7.0-mac-x64.zip");
    expect(metadata).toContain("releaseDate: '2026-07-30T00:00:00.000Z'");
    expect(metadata.match(/sha512:/g)).toHaveLength(3);
  });
});
