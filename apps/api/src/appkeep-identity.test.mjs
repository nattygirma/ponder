import { describe, expect, test } from "bun:test";
import { Database } from "bun:sqlite";
import { globSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { appKeepIdentity, appKeepUserId, ensureAppKeepUser, isAppKeepHosted } from "./appkeep-identity";
import { createSelfHostedStorageAdapter } from "./self-hosted-storage-adapter.ts";

const headers = (extra = {}) => new Headers({
  "x-altstack-owner-id": "u1",
  "x-altstack-owner-email": "Nora@Notes.test",
  "x-altstack-role": "member",
  ...extra,
});
const hosted = { PONDER_APPKEEP: "true" };

describe("AppKeep identity", () => {
  test("ignores identity headers unless the AppKeep entry point enabled them", () => {
    expect(isAppKeepHosted({})).toBe(false);
    expect(appKeepIdentity({}, headers())).toBeNull();
    expect(appKeepIdentity({ PONDER_APPKEEP: "false" }, headers())).toBeNull();
  });

  test("reads the signed-in person on AppKeep", () => {
    expect(appKeepIdentity(hosted, headers({ "x-altstack-owner-name": "Nora%20Notes" }))).toEqual({
      id: "u1",
      email: "nora@notes.test",
      name: "Nora Notes",
      canManageApp: false,
    });
  });

  test("treats a visitor without identity headers as signed out", () => {
    expect(appKeepIdentity(hosted, new Headers())).toBeNull();
    expect(appKeepIdentity(hosted, new Headers({ "x-altstack-owner-id": "u1" }))).toBeNull();
  });

  test("gives owners and admins management rights, not members", () => {
    expect(appKeepIdentity(hosted, headers({ "x-altstack-role": "owner" }))?.canManageApp).toBe(true);
    expect(appKeepIdentity(hosted, headers({ "x-altstack-role": "admin" }))?.canManageApp).toBe(true);
    expect(appKeepIdentity(hosted, headers())?.canManageApp).toBe(false);
  });

  test("keeps a person's Ponder account tied to their AppKeep id", () => {
    expect(appKeepUserId({ id: "u1" })).toBe("usr_appkeep_u1");
  });

  test("survives a malformed display name", () => {
    expect(appKeepIdentity(hosted, headers({ "x-altstack-owner-name": "%E0%A4%A" }))?.name).toBeNull();
  });

  test("stores the AppKeep email on the account, and keeps it current", async () => {
    const sqlite = new Database(":memory:");
    for (const file of globSync("migrations/*.sql").sort()) sqlite.exec(readFileSync(file, "utf8"));
    const directory = mkdtempSync(join(tmpdir(), "ponder-identity-"));
    try {
      const db = createSelfHostedStorageAdapter(sqlite, directory).db;
      await ensureAppKeepUser(db, { id: "u1", email: "nora@notes.test", name: "Nora", canManageApp: false });
      expect(sqlite.query("SELECT email FROM users WHERE id = 'usr_appkeep_u1'").get()).toEqual({ email: "nora@notes.test" });
      // An account made before Ponder kept emails gets one on the next visit.
      sqlite.run("UPDATE users SET email = NULL WHERE id = 'usr_appkeep_u1'");
      const user = await ensureAppKeepUser(db, { id: "u1", email: "nora@new.test", name: "Nora", canManageApp: false });
      expect(user.email).toBe("nora@new.test");
      expect(sqlite.query("SELECT email FROM users WHERE id = 'usr_appkeep_u1'").get()).toEqual({ email: "nora@new.test" });
    } finally {
      sqlite.close();
      rmSync(directory, { recursive: true, force: true });
    }
  });
});
