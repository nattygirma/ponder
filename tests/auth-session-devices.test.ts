import { describe, expect, test } from "bun:test";
import { resolveSessionDeviceId } from "../apps/api/src/auth-session-devices";

describe("session device ids", () => {
  test("falls back to a stable legacy user-agent device id", () => {
    expect(resolveSessionDeviceId(undefined, "Ponder/1.4.0", "sess_new"))
      .toBe("legacy-ua:Ponder/1.4.0");
    expect(resolveSessionDeviceId(undefined, null, "sess_new")).toBe("legacy-session:sess_new");
  });
});
