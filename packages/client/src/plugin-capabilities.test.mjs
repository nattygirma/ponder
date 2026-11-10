import { expect, test } from "bun:test";
import { createPonderClient } from "./index";

test("plugin public client preserves binary bytes and upstream metadata without Base64", async () => {
  const client = createPonderClient({ baseUrl: "https://ponder.test", fetch: async (_url, init) => {
    expect(JSON.parse(init.body).url).toBe("https://example.org/feed");
    return new Response(new Uint8Array([0, 127, 128, 255]), { headers: {
      "X-Ponder-Upstream-Status": "206",
      "X-Ponder-Upstream-Status-Text": "Partial%20Content",
      "X-Ponder-Upstream-Header-Content-Type": "application/octet-stream",
    } });
  } });
  const result = await client.pluginNetwork.fetchPublic({ url: "https://example.org/feed", method: "GET", headers: {} });
  expect(result.status).toBe(206); expect(result.statusText).toBe("Partial Content");
  expect(result.headers).toEqual({ "content-type": "application/octet-stream" });
  expect([...new Uint8Array(result.body)]).toEqual([0, 127, 128, 255]);
});
