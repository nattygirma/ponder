import { describe, expect, test } from "bun:test";
import { withEnvironmentTitlePrefix } from "./environment-title.ts";

describe("environment tab title", () => {
  test("marks local development tabs as DEV", () => {
    expect(withEnvironmentTitlePrefix("Ponder", { development: true, profile: "local" }))
      .toBe("[DEV] Ponder");
    expect(withEnvironmentTitlePrefix("Ponder", { development: true, profile: "" }))
      .toBe("[DEV] Ponder");
  });

  test("marks the local demo profile as DEMO", () => {
    expect(withEnvironmentTitlePrefix("Ponder", { development: true, profile: "demo" }))
      .toBe("[DEMO] Ponder");
  });

  test("is idempotent during hot reloads and leaves production titles unchanged", () => {
    expect(withEnvironmentTitlePrefix("[LOCAL DEMO] Ponder", { development: true, profile: "demo" }))
      .toBe("[DEMO] Ponder");
    expect(withEnvironmentTitlePrefix("Ponder", { development: false, profile: "demo" }))
      .toBe("Ponder");
  });
});
