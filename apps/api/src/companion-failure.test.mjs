import { describe, expect, test } from "bun:test";
import { companionGenerationFailure } from "./companion-routes.ts";

describe("server companion failure codes", () => {
  test("AppKeep AI's 402 is the AppKeep balance, other 402s are the provider's", () => {
    const hostError = Object.assign(new Error("low"), { statusCode: 402, url: "https://ponder-abc.appkeep.app/api/host-ai/v1/messages" });
    const providerError = Object.assign(new Error("low"), { statusCode: 402, url: "https://api.anthropic.com/v1/messages" });
    expect(companionGenerationFailure(hostError)).toEqual({ code: "ai_host_balance_low" });
    expect(companionGenerationFailure(providerError)).toEqual({ code: "ai_provider_payment_required" });
  });
});
