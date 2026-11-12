import { describe, expect, test } from "bun:test";
import { fetchWebBookmark } from "./web-bookmark-routes.ts";

const html = (body) => new Response(body, { headers: { "content-type": "text/html; charset=utf-8" } });

describe("web bookmarks", () => {
  test("read the linked page's details", async () => {
    const calls = [];
    const bookmark = await fetchWebBookmark("example.com/post", async (url, init) => {
      calls.push([url, init.redirect, init.credentials]);
      return html('<html><head><title>Post</title><meta property="og:description" content="About it"></head><body>x</body></html>');
    });
    expect(calls).toEqual([["https://example.com/post", "manual", "omit"]]);
    expect(bookmark).toEqual({ url: "https://example.com/post", title: "Post", description: "About it", icon: "https://example.com/favicon.ico", image: "" });
  });

  test("never fetch local, private or plain-http addresses", async () => {
    for (const url of ["https://localhost/x", "https://127.0.0.1/", "https://10.0.0.5/", "https://[::1]/", "https://intranet.local/", "https://db.internal/", "http://example.com/", "https://example.com:8443/", "https://user:pass@example.com/"]) {
      let called = false;
      const bookmark = await fetchWebBookmark(url, async () => { called = true; return html("<title>x</title>"); });
      expect(called).toBe(false);
      expect(bookmark.description).toBe("");
    }
  });

  test("check each redirect hop the same way", async () => {
    const calls = [];
    const bookmark = await fetchWebBookmark("https://short.example.com/a", async (url) => {
      calls.push(url);
      if (url === "https://short.example.com/a") return new Response(null, { status: 302, headers: { location: "/b" } });
      if (url === "https://short.example.com/b") return new Response(null, { status: 301, headers: { location: "https://169.254.169.254/latest/meta-data" } });
      return html("<title>Should not load</title>");
    });
    expect(calls).toEqual(["https://short.example.com/a", "https://short.example.com/b"]);
    expect(bookmark.title).toBe("short.example.com/a");
  });

  test("give up after a few redirects, on errors and on non-HTML", async () => {
    let hops = 0;
    const loop = await fetchWebBookmark("https://loop.example.com/", async () => { hops += 1; return new Response(null, { status: 302, headers: { location: `/${hops}` } }); });
    expect(hops).toBe(5);
    expect(loop.title).toBe("loop.example.com");
    expect((await fetchWebBookmark("https://example.com/f.pdf", async () => new Response("%PDF", { headers: { "content-type": "application/pdf" } }))).title).toBe("example.com/f.pdf");
    expect((await fetchWebBookmark("https://example.com/", async () => { throw new Error("offline"); })).title).toBe("example.com");
    expect((await fetchWebBookmark("https://example.com/", undefined)).title).toBe("example.com");
  });

  test("read only the start of a huge page", async () => {
    const big = `<html><head><title>Big</title></head><body>${"x".repeat(3_000_000)}</body></html>`;
    const bookmark = await fetchWebBookmark("https://example.com/", async () => html(big));
    expect(bookmark.title).toBe("Big");
  });
});
