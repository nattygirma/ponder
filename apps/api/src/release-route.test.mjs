import { describe, expect, test } from "bun:test";
import releaseSummary from "../../../release-summary.json";
import { fetchPonderApp } from "./index";

const executionContext = {
  passThroughOnException() {},
  waitUntil() {},
};

describe("instance release metadata", () => {
  test("exposes the deployed release and localized changes without authentication", async () => {
    const response = await fetchPonderApp(
      new Request("https://notes.example.com/api/release"),
      {},
      executionContext,
    );

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual(releaseSummary);
  });
});
