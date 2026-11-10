import { describe, expect, test } from "bun:test";
import { enableMacShareExtension, macShareExtensionPath } from "./share-extension-registration.mjs";

const executable = "/Applications/Ponder.app/Contents/MacOS/Ponder";

describe("macOS share extension registration", () => {
  test("points at the PlugIns copy next to the packaged executable", () => {
    expect(macShareExtensionPath(executable)).toBe(
      "/Applications/Ponder.app/Contents/PlugIns/PonderShare.appex",
    );
  });

  test("elects the installed extension for the current user", async () => {
    const calls = [];
    const result = await enableMacShareExtension({
      platform: "darwin",
      packaged: true,
      executablePath: executable,
      exists: () => true,
      execFile: (_command, args, _options, callback) => {
        calls.push(args);
        callback(null);
      },
    });
    expect(result).toEqual({ enabled: true });
    expect(calls).toEqual([
      ["-a", "/Applications/Ponder.app/Contents/PlugIns/PonderShare.appex"],
      ["-e", "use", "-i", "io.appkeep.ponder.desktop.share"],
    ]);
  });

  test("skips registration away from a packaged Mac app", async () => {
    const execFile = () => { throw new Error("should not run"); };
    expect(await enableMacShareExtension({
      platform: "win32",
      packaged: true,
      executablePath: executable,
      exists: () => true,
      execFile,
    })).toEqual({ enabled: false });
    expect(await enableMacShareExtension({
      platform: "darwin",
      packaged: false,
      executablePath: executable,
      exists: () => true,
      execFile,
    })).toEqual({ enabled: false });
    expect(await enableMacShareExtension({
      platform: "darwin",
      packaged: true,
      executablePath: executable,
      exists: () => false,
      execFile,
    })).toEqual({ enabled: false });
  });
});
