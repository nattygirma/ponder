import { describe, expect, test } from "bun:test";
import {
  isMountedDiskImageVolume,
  isMountedInstallerPath,
  mountedInstallerCandidates,
} from "./installation-location.mjs";

describe("macOS installation location", () => {
  test("recognizes an app launched from a mounted volume", () => {
    expect(isMountedInstallerPath("/Volumes/Ponder/Ponder.app/Contents/Resources/app.asar", "darwin")).toBe(true);
  });

  test("does not reject the installed Applications copy", () => {
    expect(isMountedInstallerPath("/Applications/Ponder.app/Contents/Resources/app.asar", "darwin")).toBe(false);
  });

  test("does not apply the macOS rule on other platforms", () => {
    expect(isMountedInstallerPath("/Volumes/Ponder/Ponder.app/Contents/Resources/app.asar", "win32")).toBe(false);
  });

  test("builds safe installer candidates for mounted volumes", () => {
    expect(mountedInstallerCandidates(["Ponder Installer", "External Disk"])).toEqual([
      {
        volumePath: "/Volumes/Ponder Installer",
        appPath: "/Volumes/Ponder Installer/Ponder.app",
      },
      {
        volumePath: "/Volumes/External Disk",
        appPath: "/Volumes/External Disk/Ponder.app",
      },
    ]);
  });

  test("rejects invalid mounted volume names", () => {
    expect(mountedInstallerCandidates(["", "../escape", null])).toEqual([]);
  });

  test("only identifies exact disk image mount points", () => {
    const output = [
      "/dev/disk7\tGUID_partition_scheme",
      "/dev/disk7s1\tApple_HFS\t/Volumes/Ponder Installer",
    ].join("\n");
    expect(isMountedDiskImageVolume(output, "/Volumes/Ponder Installer")).toBe(true);
    expect(isMountedDiskImageVolume(output, "/Volumes/Ponder")).toBe(false);
  });
});
