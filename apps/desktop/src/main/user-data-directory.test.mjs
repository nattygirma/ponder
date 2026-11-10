import { describe, expect, test } from "bun:test";
import { userDataDirectoryFromArguments } from "./user-data-directory.mjs";

describe("desktop user data directory", () => {
  test("reads the equals form", () => {
    expect(userDataDirectoryFromArguments(["Ponder", "--user-data-dir=/tmp/ponder-profile"]))
      .toBe("/tmp/ponder-profile");
  });

  test("reads the separate value form", () => {
    expect(userDataDirectoryFromArguments(["Ponder", "--user-data-dir", "/tmp/ponder-profile"]))
      .toBe("/tmp/ponder-profile");
  });

  test("ignores missing and empty values", () => {
    expect(userDataDirectoryFromArguments(["Ponder"])).toBe("");
    expect(userDataDirectoryFromArguments(["Ponder", "--user-data-dir="])).toBe("");
  });
});
