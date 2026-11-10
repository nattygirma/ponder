import { describe, expect, test } from "bun:test";
import { appKeepIdentity, appKeepUserId, isAppKeepHosted } from "./appkeep-identity";

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
});
