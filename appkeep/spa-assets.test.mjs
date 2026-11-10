import { describe, expect, test } from "bun:test";
import { isPageRequest, spaAssets } from "./spa-assets.mjs";

const files = { "/index.html": "<!doctype html>shell", "/assets/app-new.js": "export {}" };
const assets = {
  fetch: async (request) => {
    const body = files[new URL(request.url).pathname];
    return body ? new Response(body, { status: 200 }) : new Response("not found", { status: 404 });
  },
};
const get = (path, headers = {}) => spaAssets(assets).fetch(new Request(`https://ponder.example${path}`, { headers }));

describe("AppKeep SPA fallback", () => {
  test("serves the shell for pages", async () => {
    for (const path of ["/", "/notes/abc", "/site/my-notebook"]) {
      const response = await get(path, { accept: "text/html" });
      expect(response.status).toBe(200);
      expect(await response.text()).toContain("shell");
    }
  });

  test("keeps the 404 for a chunk from an old build", async () => {
    const response = await get("/assets/app-old.js", { accept: "*/*", "sec-fetch-mode": "cors" });
    expect(response.status).toBe(404);
    expect((await get("/assets/app-new.js")).status).toBe(200);
  });

  test("keeps the 404 for missing files unless the browser is loading a page", async () => {
    expect((await get("/favicon-old.png", { accept: "image/*" })).status).toBe(404);
    expect((await get("/notes/v1.2", { "sec-fetch-mode": "navigate" })).status).toBe(200);
    expect(isPageRequest(new Request("https://ponder.example/assets/page", { headers: { "sec-fetch-mode": "navigate" } }))).toBe(false);
  });

  test("passes other methods through", async () => {
    const response = await spaAssets(assets).fetch(new Request("https://ponder.example/missing", { method: "POST" }));
    expect(response.status).toBe(404);
  });
});
