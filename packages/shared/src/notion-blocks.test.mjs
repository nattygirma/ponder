import { describe, expect, test } from "bun:test";
import { Schema } from "@tiptap/pm/model";
import { getSchema } from "@tiptap/core";
import { createPonderMarkdownMathematics } from "./mathematics-markdown.ts";
import {
  bookmarkFallback,
  createPonderDocumentExtensions,
  createTabsContent,
  docToMarkdown,
  extractHeadings,
  flattenHeadings,
  getActiveHeading,
  isValidMediaLink,
  markdownToDoc,
  nestHeadings,
  normalizeMediaUrl,
  parseBookmarkHtml,
  parseVideoEmbed,
  resolveMemoContentDoc,
} from "./index.ts";

const text = (value) => ({ type: "text", text: value });
const paragraph = (value) => ({ type: "paragraph", content: [text(value)] });
const heading = (level, value) => ({ type: "heading", attrs: { level }, content: [text(value)] });
const roundTrip = (content) => markdownToDoc(docToMarkdown({ type: "doc", content }));

describe("Phase C blocks in Markdown", () => {
  test("table of contents and breadcrumb survive a round trip", () => {
    const back = roundTrip([paragraph("Before"), { type: "ponderToc" }, { type: "ponderBreadcrumb" }, paragraph("After")]);
    expect(back.content.map((node) => node.type)).toEqual(["paragraph", "ponderToc", "ponderBreadcrumb", "paragraph"]);
  });

  test("tabs keep their names and each tab's blocks", () => {
    const tabs = {
      type: "ponderTabs",
      content: [
        { type: "ponderTab", attrs: { title: "Plan \"A\" <one>" }, content: [paragraph("First"), heading(2, "Inside")] },
        { type: "ponderTab", attrs: { title: "Two" }, content: [{ type: "bulletList", content: [{ type: "listItem", content: [paragraph("Item")] }] }] },
        { type: "ponderTab", attrs: { title: "Empty" }, content: [{ type: "paragraph" }] },
      ],
    };
    const markdown = docToMarkdown({ type: "doc", content: [tabs, paragraph("After")] });
    expect(markdown).toContain('<ponder-tab title="Plan &quot;A&quot; &lt;one&gt;">');
    const back = markdownToDoc(markdown);
    expect(back.content.map((node) => node.type)).toEqual(["ponderTabs", "paragraph"]);
    const [first, second, third] = back.content[0].content;
    expect(back.content[0].content).toHaveLength(3);
    expect(first.attrs.title).toBe("Plan \"A\" <one>");
    expect(first.content.map((node) => node.type)).toEqual(["paragraph", "heading"]);
    expect(second.content[0].type).toBe("bulletList");
    expect(third.attrs.title).toBe("Empty");
    expect(third.content).toEqual([{ type: "paragraph" }]);
  });

  test("tabs nest inside tabs", () => {
    const inner = createTabsContent(["A", "B"]);
    const back = roundTrip([{ type: "ponderTabs", content: [{ type: "ponderTab", attrs: { title: "Outer" }, content: [inner] }] }]);
    expect(back.content[0].content[0].content[0].type).toBe("ponderTabs");
    expect(back.content[0].content[0].content[0].content.map((tab) => tab.attrs.title)).toEqual(["A", "B"]);
  });

  test("video embeds, bookmarks and empty media blocks keep their attributes", () => {
    const bookmark = { url: "https://example.com/a?b=1&c=2", title: "Title & \"quotes\"", description: "A <b>page</b>", icon: "https://example.com/favicon.ico", image: "https://example.com/og.png" };
    const back = roundTrip([
      { type: "ponderEmbed", attrs: { url: "https://www.youtube.com/watch?v=aqz-KE-bpKQ" } },
      { type: "ponderBookmark", attrs: bookmark },
      { type: "ponderMedia", attrs: { kind: "audio" } },
      { type: "ponderMedia", attrs: { kind: "bookmark" } },
    ]);
    expect(back.content.map((node) => node.type)).toEqual(["ponderEmbed", "ponderBookmark", "ponderMedia", "ponderMedia"]);
    expect(back.content[0].attrs.url).toBe("https://www.youtube.com/watch?v=aqz-KE-bpKQ");
    expect(back.content[1].attrs).toEqual(bookmark);
    expect(back.content[2].attrs.kind).toBe("audio");
    expect(back.content[3].attrs.kind).toBe("bookmark");
  });

  test("an unknown media kind reads as an image", () => {
    const back = markdownToDoc('<ponder-media kind="script"></ponder-media>');
    expect(back.content[0]).toEqual({ type: "ponderMedia", attrs: { kind: "image", service: "" } });
  });

  test("toggle headings keep their level; toggle lists stay plain", () => {
    const toggle = (level, title) => ({
      type: "details",
      ...(level ? { attrs: { level } } : {}),
      content: [{ type: "detailsSummary", content: [text(title)] }, { type: "detailsContent", content: [paragraph(`${title} body`)] }],
    });
    const markdown = docToMarkdown({ type: "doc", content: [toggle(1, "One"), toggle(3, "Three"), toggle(0, "Plain")] });
    expect(markdown).toContain('<details data-heading="1">');
    expect(markdown).toContain('<details data-heading="3">');
    expect(markdown).toContain("<details>\n<summary>Plain</summary>");
    const back = markdownToDoc(markdown);
    expect(back.content.map((node) => node.attrs?.level ?? 0)).toEqual([1, 3, 0]);
    expect(back.content[0].content[0].content[0].text).toBe("One");
    expect(back.content[1].content[1].content[0].content[0].text).toBe("Three body");
  });

  test("a level outside 1 to 3 is a toggle list", () => {
    const back = markdownToDoc('<details data-heading="9">\n<summary>X</summary>\n\nBody\n\n</details>');
    expect(back.content[0].attrs?.level ?? 0).toBe(0);
  });

  test("a saved page with the new blocks keeps its JSON over its Markdown", () => {
    for (const block of [{ type: "ponderToc" }, { type: "ponderBreadcrumb" }, { type: "ponderMedia", attrs: { kind: "image" } }, createTabsContent()]) {
      const json = { type: "doc", content: [paragraph("Kept"), block] };
      expect(resolveMemoContentDoc(json, "Stale markdown")).toEqual(json);
    }
  });

  test("the editor schema accepts every new block", () => {
    const schema = getSchema(createPonderDocumentExtensions({ mathematics: createPonderMarkdownMathematics() }));
    expect(schema).toBeInstanceOf(Schema);
    const node = schema.nodeFromJSON({
      type: "doc",
      content: [
        { type: "ponderToc" },
        { type: "ponderBreadcrumb" },
        createTabsContent(),
        { type: "ponderEmbed", attrs: { url: "https://vimeo.com/76979871" } },
        { type: "ponderBookmark", attrs: { url: "https://example.com" } },
        { type: "ponderMedia", attrs: { kind: "file" } },
        { type: "details", attrs: { level: 2 }, content: [{ type: "detailsSummary" }, { type: "detailsContent", content: [{ type: "paragraph" }] }] },
      ],
    });
    node.check();
    expect(node.childCount).toBe(7);
  });
});

describe("video links", () => {
  test("YouTube, Vimeo and Loom links play in the provider's frame", () => {
    expect(parseVideoEmbed("https://www.youtube.com/watch?v=aqz-KE-bpKQ&t=90")).toEqual({ provider: "youtube", embedUrl: "https://www.youtube.com/embed/aqz-KE-bpKQ?start=90" });
    expect(parseVideoEmbed("youtu.be/aqz-KE-bpKQ?t=1m5s")?.embedUrl).toBe("https://www.youtube.com/embed/aqz-KE-bpKQ?start=65");
    expect(parseVideoEmbed("https://youtube.com/shorts/aqz-KE-bpKQ")?.embedUrl).toBe("https://www.youtube.com/embed/aqz-KE-bpKQ");
    expect(parseVideoEmbed("https://m.youtube.com/embed/aqz-KE-bpKQ")?.provider).toBe("youtube");
    expect(parseVideoEmbed("https://vimeo.com/76979871")).toEqual({ provider: "vimeo", embedUrl: "https://player.vimeo.com/video/76979871" });
    expect(parseVideoEmbed("https://vimeo.com/76979871/abc123")?.embedUrl).toBe("https://player.vimeo.com/video/76979871?h=abc123");
    expect(parseVideoEmbed("https://vimeo.com/channels/staffpicks/76979871")?.embedUrl).toBe("https://player.vimeo.com/video/76979871");
    expect(parseVideoEmbed("https://player.vimeo.com/video/76979871?h=ff")?.embedUrl).toBe("https://player.vimeo.com/video/76979871?h=ff");
    expect(parseVideoEmbed("https://www.loom.com/share/0281766fa2d04bb788eaf19e65135184")).toEqual({ provider: "loom", embedUrl: "https://www.loom.com/embed/0281766fa2d04bb788eaf19e65135184" });
  });

  test("other links are not embedded", () => {
    for (const url of ["https://youtube.com/watch?v=short", "https://evil.com/youtube.com/watch?v=aqz-KE-bpKQ", "https://youtube.com.evil.com/watch?v=aqz-KE-bpKQ", "javascript:alert(1)", "https://vimeo.com/about", "https://loom.com/share/../x", ""]) {
      expect(parseVideoEmbed(url)).toBeNull();
    }
  });

  test("addresses typed without https get one; others are refused", () => {
    expect(normalizeMediaUrl("example.com/a.png")).toBe("https://example.com/a.png");
    expect(normalizeMediaUrl("http://example.com")).toBe("http://example.com/");
    expect(normalizeMediaUrl("javascript:alert(1)")).toBeNull();
    expect(normalizeMediaUrl("data:image/png;base64,AAAA")).toBeNull();
    expect(normalizeMediaUrl("not a link")).toBeNull();
  });

  test("each media block accepts links of its kind", () => {
    expect(isValidMediaLink("video", "https://youtu.be/aqz-KE-bpKQ")).toBe(true);
    expect(isValidMediaLink("video", "https://example.com/clip.mp4")).toBe(true);
    expect(isValidMediaLink("video", "https://example.com/page")).toBe(false);
    expect(isValidMediaLink("audio", "https://example.com/song.mp3?x=1")).toBe(true);
    expect(isValidMediaLink("audio", "https://example.com/song")).toBe(false);
    expect(isValidMediaLink("image", "https://example.com/anything")).toBe(true);
    expect(isValidMediaLink("file", "ftp://example.com/x")).toBe(false);
  });
});

describe("web bookmarks", () => {
  test("read the page's Open Graph details, made absolute", () => {
    const html = `<!doctype html><html><head>
      <title>Fallback title</title>
      <meta property="og:title" content="Big &amp; Bold">
      <meta name="description" content="  A   page &quot;about&quot; things. ">
      <meta property="og:image" content="/img/card.png">
      <link rel="apple-touch-icon" href="/apple.png">
      <link rel="shortcut icon" href="https://cdn.example.com/fav.ico">
    </head><body><header><title>Not this</title></header></body></html>`;
    expect(parseBookmarkHtml(html, "https://example.com/post/1")).toEqual({
      url: "https://example.com/post/1",
      title: "Big & Bold",
      description: "A page \"about\" things.",
      icon: "https://cdn.example.com/fav.ico",
      image: "https://example.com/img/card.png",
    });
  });

  test("fall back to <title>, /favicon.ico and the address", () => {
    const parsed = parseBookmarkHtml("<html><head><title>Plain page</title></head></html>", "https://example.com/");
    expect(parsed.title).toBe("Plain page");
    expect(parsed.icon).toBe("https://example.com/favicon.ico");
    expect(parsed.image).toBe("");
    expect(parseBookmarkHtml("", "https://www.example.com/docs/a%20b").title).toBe("example.com/docs/a b");
  });

  test("never keep insecure or script images", () => {
    const html = '<head><meta property="og:image" content="javascript:alert(1)"><link rel="icon" href="http://example.com/i.png"></head>';
    const parsed = parseBookmarkHtml(html, "https://example.com/");
    expect(parsed.image).toBe("");
    expect(parsed.icon).toBe("https://example.com/favicon.ico");
  });

  test("shorten long descriptions as AppFlowy does", () => {
    const parsed = parseBookmarkHtml(`<head><meta name="description" content="${"word ".repeat(100)}"></head>`, "https://example.com/");
    expect(parsed.description.length).toBeLessThanOrEqual(240);
    expect(parsed.description.endsWith("...")).toBe(true);
    expect(bookmarkFallback("example.com").title).toBe("example.com");
  });
});

const outlineSchema = getSchema(createPonderDocumentExtensions({ mathematics: createPonderMarkdownMathematics() }));
const toOutlineNode = (json) => outlineSchema.nodeFromJSON(json);

describe("table of contents headings", () => {
  const page = toOutlineNode({
    type: "doc",
    content: [
      heading(1, "Introduction"),
      paragraph("Body"),
      heading(2, "Details"),
      heading(3, "Smaller part"),
      heading(4, "Too deep"),
      {
        type: "details",
        attrs: { level: 2 },
        content: [
          { type: "detailsSummary", content: [text("Toggle heading")] },
          { type: "detailsContent", content: [heading(3, "Inside the toggle")] },
        ],
      },
      { type: "ponderColumns", content: [{ type: "ponderColumn", content: [heading(2, "In a column")] }] },
      heading(1, "  Another section  "),
    ],
  });

  test("lists H1 to H3 in order, including toggle headings and nested headings", () => {
    const { headings, hasHeadings } = extractHeadings(page, 3);
    expect(hasHeadings).toBe(true);
    expect(headings.map((item) => [item.level, item.text])).toEqual([
      [1, "Introduction"],
      [2, "Details"],
      [3, "Smaller part"],
      [2, "Toggle heading"],
      [3, "Inside the toggle"],
      [2, "In a column"],
      [1, "Another section"],
    ]);
    expect(new Set(headings.map((item) => item.pos)).size).toBe(headings.length);
    expect(headings[0].pos).toBe(0);
  });

  test("indents each heading under the one above it", () => {
    const items = flattenHeadings(nestHeadings(extractHeadings(page, 3).headings));
    expect(items.map((item) => item.indent)).toEqual([0, 1, 2, 1, 2, 1, 0]);
  });

  test("a page without headings says so", () => {
    expect(extractHeadings(toOutlineNode({ type: "doc", content: [paragraph("x")] }))).toEqual({ hasHeadings: false, headings: [] });
  });

  test("the active heading is the last one above the reading line", () => {
    const positions = [{ id: "a", top: -400 }, { id: "b", top: 40 }, { id: "c", top: 600 }];
    expect(getActiveHeading(positions, 100)).toBe("b");
    expect(getActiveHeading(positions, -1000)).toBe("a");
    expect(getActiveHeading(positions, 100, true)).toBe("c");
    expect(getActiveHeading([], 100)).toBeUndefined();
  });
});
