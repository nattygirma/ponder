import { describe, expect, test } from "bun:test";
import { formatRelativeTime } from "./relative-time.ts";

const NOW = Date.parse("2026-11-08T12:00:00.000Z");
const ago = (seconds) => new Date(NOW - seconds * 1000).toISOString();

describe("formatRelativeTime", () => {
  test("reads under a minute as now", () => {
    expect(formatRelativeTime(ago(20), "en-US", NOW)).toBe("now");
  });
  test("picks the largest whole unit", () => {
    expect(formatRelativeTime(ago(5 * 60), "en-US", NOW)).toBe("5 minutes ago");
    expect(formatRelativeTime(ago(3 * 3600), "en-US", NOW)).toBe("3 hours ago");
    expect(formatRelativeTime(ago(86_400), "en-US", NOW)).toBe("yesterday");
  });
  test("returns nothing for an unreadable date", () => {
    expect(formatRelativeTime("not a date", "en-US", NOW)).toBe("");
  });
});
