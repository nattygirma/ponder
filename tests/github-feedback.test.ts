import { describe, expect, test } from "bun:test";
import { buildGitHubFeedbackUrl } from "../packages/shared/src/github-feedback";

describe("buildGitHubFeedbackUrl", () => {
  test("sends reports to the AppKeep site without putting diagnostics in the link", () => {
    expect(buildGitHubFeedbackUrl({ systemInfo: [{ label: "Version", value: "v1.46.0" }] })).toBe("https://appkeep.io");
  });
});
