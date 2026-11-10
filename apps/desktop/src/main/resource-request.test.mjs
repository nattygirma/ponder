import { expect, test } from "bun:test";
import { resourceRequestHeaders } from "./resource-request.mjs";

test("desktop resource requests use the securely stored session token", () => {
  const headers = resourceRequestHeaders({ sessionToken: " session-token " });

  expect(headers.get("Authorization")).toBe("Bearer session-token");
  expect(headers.has("Cookie")).toBe(false);
});

test("desktop resource requests preserve cookies alongside bearer authentication", () => {
  const headers = resourceRequestHeaders({
    cookies: [
      { name: "ponder_session", value: "cookie-token" },
      { name: "preference", value: "compact" },
    ],
    sessionToken: "session-token",
  });

  expect(headers.get("Cookie")).toBe("ponder_session=cookie-token; preference=compact");
  expect(headers.get("Authorization")).toBe("Bearer session-token");
});

test("desktop resource requests omit empty authentication headers", () => {
  const headers = resourceRequestHeaders();

  expect([...headers]).toEqual([]);
});
