import { generateKeyPairSync, sign } from "node:crypto";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, test } from "bun:test";
import { createWindowsUpdateMetadata } from "./create-windows-update-metadata.mjs";
import {
  assertWindowsUpdateSigningKey,
  signWindowsUpdateManifest,
} from "./sign-windows-update-manifest.mjs";
import { verifyWindowsUpdateRelease } from "./verify-windows-update-release.mjs";

describe("Windows update release metadata", () => {
  test("creates installer metadata consumed by electron-updater and the trust gate", async () => {
    const directory = await mkdtemp(join(tmpdir(), "ponder-windows-metadata-"));
    try {
      await writeFile(join(directory, "Ponder-1.49.0-windows-x64.exe"), "payload");
      const manifest = await createWindowsUpdateMetadata({ directory, version: "1.49.0" });
      expect(manifest.file).toMatchObject({
        name: "Ponder-1.49.0-windows-x64.exe",
        size: 7,
        sha256: "239f59ed55e737c77147cf55ad0c1b030b6d7ee748a7426952f9b852d5a935e5",
      });
      expect(await readFile(join(directory, "latest.yml"), "utf8"))
        .toContain(`sha512: ${manifest.file.sha512}`);
      expect(await readFile(join(directory, "SHA256SUMS-windows.txt"), "utf8"))
        .toBe(`${manifest.file.sha256}  ${manifest.file.name}\n`);
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });

  test("signs only with the private key matching the expected public key", async () => {
    const directory = await mkdtemp(join(tmpdir(), "ponder-windows-signing-"));
    const { privateKey, publicKey } = generateKeyPairSync("ed25519");
    const { publicKey: otherPublicKey } = generateKeyPairSync("ed25519");
    const manifestPath = join(directory, "latest-windows.json");
    const signaturePath = `${manifestPath}.sig`;
    const privateKeyPath = join(directory, "private.pem");
    try {
      await writeFile(manifestPath, `${JSON.stringify({
        schemaVersion: 1,
        keyId: "ponder-windows-update-2026-01",
        version: "1.49.0",
        platform: "win32",
        arch: "x64",
        releaseDate: "2026-08-30T00:00:00.000Z",
        file: {
          name: "Ponder-1.49.0-windows-x64.exe",
          size: 7,
          sha512: "cLM86ckEfjD5F+fqE+Qvd2cAjD9PnJuvSeQ5D8YlVJ6WJe7jm5RUUHTooYJM8/I4RjsRvAPZc0jg/CmZyh//fw==",
          sha256: "239f59ed55e737c77147cf55ad0c1b030b6d7ee748a7426952f9b852d5a935e5",
        },
      })}\n`);
      await writeFile(privateKeyPath, privateKey.export({ type: "pkcs8", format: "pem" }));
      expect(assertWindowsUpdateSigningKey({
        privateKeyPath,
        expectedPublicKey: publicKey,
      }).asymmetricKeyType).toBe("ed25519");
      expect(signWindowsUpdateManifest({
        manifestPath,
        signaturePath,
        privateKeyPath,
        expectedPublicKey: publicKey,
      }).signature).toHaveLength(88);
      expect(() => signWindowsUpdateManifest({
        manifestPath,
        signaturePath,
        privateKeyPath,
        expectedPublicKey: otherPublicKey,
      })).toThrow("does not match");
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });

  test("audits the complete production release asset set", async () => {
    const directory = await mkdtemp(join(tmpdir(), "ponder-windows-release-audit-"));
    const manifest = {
      schemaVersion: 1,
      keyId: "ponder-windows-update-2026-01",
      version: "1.49.0",
      platform: "win32",
      arch: "x64",
      releaseDate: "2026-08-30T00:00:00.000Z",
      file: {
        name: "Ponder-1.49.0-windows-x64.exe",
        size: 7,
        sha512: "cLM86ckEfjD5F+fqE+Qvd2cAjD9PnJuvSeQ5D8YlVJ6WJe7jm5RUUHTooYJM8/I4RjsRvAPZc0jg/CmZyh//fw==",
        sha256: "239f59ed55e737c77147cf55ad0c1b030b6d7ee748a7426952f9b852d5a935e5",
      },
    };
    const { privateKey, publicKey } = generateKeyPairSync("ed25519");
    const manifestText = `${JSON.stringify(manifest, null, 2)}\n`;
    const trustedPublicKeys = { [manifest.keyId]: publicKey };
    try {
      await writeFile(join(directory, manifest.file.name), "payload");
      await writeFile(join(directory, "latest-windows.json"), manifestText);
      await writeFile(join(directory, "latest-windows.json.sig"), `${JSON.stringify({
        schemaVersion: 1,
        keyId: manifest.keyId,
        signature: sign(null, Buffer.from(manifestText), privateKey).toString("base64"),
      })}\n`);
      await writeFile(join(directory, "latest.yml"), [
        `version: ${manifest.version}`,
        "files:",
        `  - url: ${manifest.file.name}`,
        `    sha512: ${manifest.file.sha512}`,
        `    size: ${manifest.file.size}`,
        `path: ${manifest.file.name}`,
        `sha512: ${manifest.file.sha512}`,
        `releaseDate: '${manifest.releaseDate}'`,
        "",
      ].join("\n"));
      await writeFile(
        join(directory, "SHA256SUMS-windows.txt"),
        `${manifest.file.sha256}  ${manifest.file.name}\n`,
      );
      await expect(verifyWindowsUpdateRelease(directory, { trustedPublicKeys })).resolves.toEqual(manifest);
      await writeFile(join(directory, manifest.file.name), "tampered");
      await expect(verifyWindowsUpdateRelease(directory, { trustedPublicKeys })).rejects.toThrow("size does not match");
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });
});
