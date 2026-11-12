import { describe, expect, test } from "bun:test";
import { Schema } from "@tiptap/pm/model";
import { getSchema } from "@tiptap/core";
import { createPonderMarkdownMathematics } from "./mathematics-markdown.ts";
import {
  buildGoogleDriveEmbedUrl,
  clampEmbedSize,
  createPonderDocumentExtensions,
  docToMarkdown,
  EMBED_SERVICE_IDS,
  EMBED_SERVICES,
  findEmbedService,
  getGoogleDriveFileId,
  isBookmarkOnlyService,
  isGoogleDriveUrl,
  isValidEmbedLink,
  isValidMediaLink,
  markdownToDoc,
  readTweetHeight,
  resolveEmbed,
} from "./index.ts";

const roundTrip = (content) => markdownToDoc(docToMarkdown({ type: "doc", content }));
const frame = (input, service) => {
  const target = resolveEmbed(input, service);
  return target?.kind === "frame" ? target.embedUrl : target?.kind ?? null;
};

describe("Notion's Embeds group", () => {
  test("has Notion's named services in Notion's order, each once", () => {
    expect(EMBED_SERVICES.map((service) => service.label)).toEqual([
      "Google Drive", "Tweet", "GitHub Gist", "Google Maps", "Figma", "Abstract", "Invision", "Mixpanel", "Framer", "Whimsical",
      "Miro", "Sketch", "Excalidraw", "PDF", "Loom", "Typeform", "CodePen", "Replit", "Hex", "Deepnote",
      "Slack", "Trello", "Pitch", "OneDrive", "Dropbox", "Amplitude", "Claap", "Box", "Linear", "Lucidchart",
      "Lucidspark", "Eraser", "ClickUp", "Plus", "Dovetail", "Streak Share", "Shortcut", "SendOwl", "Amplitude - EU", "Zendesk",
      "Google Contacts", "Discord", "Microsoft Contacts", "PagerDuty", "Asana", "GitLab", "Zoom", "Adobe XD", "Jira", "GitHub",
    ]);
    expect(new Set(EMBED_SERVICE_IDS).size).toBe(EMBED_SERVICE_IDS.length);
    expect(EMBED_SERVICES.map((service) => service.id)).toEqual([...EMBED_SERVICE_IDS]);
  });

  test("services without a public embed are bookmark only", () => {
    const bookmarkOnly = EMBED_SERVICES.filter(isBookmarkOnlyService).map((service) => service.id);
    expect(bookmarkOnly).toEqual([
      "slack", "dropbox", "linear", "streak", "shortcut", "zendesk", "googleContacts", "microsoftContacts", "pagerduty", "asana", "gitlab", "zoom", "jira", "github",
    ]);
    for (const url of ["https://github.com/AppFlowy-IO/AppFlowy-Web", "https://acme.slack.com/archives/C01/p123", "https://linear.app/acme/issue/ENG-1", "https://acme.atlassian.net/browse/ENG-1"]) {
      expect(resolveEmbed(url)?.kind).toBe("bookmark");
    }
  });
});

describe("link rules", () => {
  test("Google Drive, Docs, Sheets, Slides and Forms (AppFlowy-Web's rules)", () => {
    // Cases from AppFlowy-Web's google-drive-utils tests.
    expect(isGoogleDriveUrl("https://docs.google.com/document/d/abc123/edit")).toBe(true);
    expect(isGoogleDriveUrl("https://drive.google.com/drive/my-drive")).toBe(false);
    expect(isGoogleDriveUrl("https://user:pw@drive.google.com/file/d/abc/view")).toBe(false);
    expect(getGoogleDriveFileId("https://docs.google.com/forms/d/e/1FAIpQL/viewform")).toBe("1FAIpQL");
    expect(buildGoogleDriveEmbedUrl("https://docs.google.com/document/d/abc123/edit")).toBe("https://docs.google.com/document/d/abc123/preview");
    expect(buildGoogleDriveEmbedUrl("https://docs.google.com/spreadsheets/d/abc123/edit#gid=0")).toBe("https://docs.google.com/spreadsheets/d/abc123/preview");
    expect(buildGoogleDriveEmbedUrl("https://docs.google.com/presentation/d/abc123/edit")).toBe("https://docs.google.com/presentation/d/abc123/embed?start=false&loop=false");
    expect(buildGoogleDriveEmbedUrl("https://docs.google.com/forms/d/e/1FAIpQL/viewform")).toBe("https://docs.google.com/forms/d/e/1FAIpQL/viewform?embedded=true");
    expect(buildGoogleDriveEmbedUrl("https://drive.google.com/file/d/abc123/view?resourcekey=0-k")).toBe("https://drive.google.com/file/d/abc123/preview?resourcekey=0-k");
    expect(buildGoogleDriveEmbedUrl("https://drive.google.com/drive/folders/fold1")).toBe("https://drive.google.com/embeddedfolderview?id=fold1#grid");
    expect(buildGoogleDriveEmbedUrl("https://drive.google.com/open?id=abc123")).toBe("https://drive.google.com/file/d/abc123/preview");
    expect(resolveEmbed("https://drive.google.com/drive/my-drive")?.kind).toBe("bookmark");
  });

  test("Tweets, Gists, Maps and Figma", () => {
    expect(frame("https://x.com/jack/status/20")).toBe("https://platform.twitter.com/embed/Tweet.html?id=20&dnt=true");
    expect(frame("https://twitter.com/jack/status/20?s=21")).toBe("https://platform.twitter.com/embed/Tweet.html?id=20&dnt=true");
    expect(frame("https://x.com/jack")).toBe("bookmark");
    expect(frame("https://gist.github.com/octocat/6cad326836d38bd3a7ae")).toBe("https://gist.github.com/octocat/6cad326836d38bd3a7ae.pibb");
    expect(frame("https://gist.github.com/6cad326836d38bd3a7ae")).toBe("https://gist.github.com/6cad326836d38bd3a7ae.pibb");
    expect(frame("https://www.google.com/maps/place/Paris,+France")).toBe("https://maps.google.com/maps?q=Paris%2C%20France&output=embed");
    expect(frame("https://www.google.com/maps/place/Eiffel+Tower/@48.8584,2.2945,17z/data=x")).toBe("https://maps.google.com/maps?q=Eiffel%20Tower&z=17&output=embed");
    expect(frame("https://www.google.com/maps/@48.8584,2.2945,15z")).toBe("https://maps.google.com/maps?q=48.8584%2C2.2945&z=15&output=embed");
    expect(frame("https://maps.google.com/?q=Berlin")).toBe("https://maps.google.com/maps?q=Berlin&output=embed");
    expect(frame("https://www.google.com/search?q=maps")).toBe("https://www.google.com/search?q=maps");
    expect(frame("https://www.figma.com/design/AbC123/My-file?node-id=1-2")).toBe(`https://www.figma.com/embed?embed_host=ponder&url=${encodeURIComponent("https://www.figma.com/design/AbC123/My-file?node-id=1-2")}`);
    expect(frame("https://www.figma.com/community/file/1035203688168086460")).toContain("figma.com/embed?embed_host=ponder");
    expect(frame("https://www.figma.com/pricing")).toBe("bookmark");
  });

  test("design and whiteboard tools", () => {
    expect(frame("https://miro.com/app/board/uXjVOabc=/")).toBe("https://miro.com/app/live-embed/uXjVOabc=/?embedMode=view_only_without_ui");
    expect(frame("https://whimsical.com/product-flow-8aBcD3fGh")).toBe("https://whimsical.com/embed/8aBcD3fGh");
    expect(frame("https://www.sketch.com/s/0f6b-uuid/a/abc")).toBe("https://www.sketch.com/embed/s/0f6b-uuid/a/abc");
    expect(frame("https://xd.adobe.com/view/1234-abcd/")).toBe("https://xd.adobe.com/embed/1234-abcd");
    expect(frame("https://lucid.app/lucidchart/0b1c2d3e-aaaa-bbbb/view")).toBe("https://lucid.app/documents/embeddedchart/0b1c2d3e-aaaa-bbbb");
    expect(resolveEmbed("https://lucid.app/lucidspark/0b1c2d3e-aaaa-bbbb/edit")?.service).toBe("lucidspark");
    expect(resolveEmbed("https://excalidraw.com/#json=abc,def")).toMatchObject({ kind: "frame", service: "excalidraw", checkFraming: true });
  });

  test("code, data and docs tools", () => {
    expect(frame("https://codepen.io/chriscoyier/pen/gfdDu")).toBe("https://codepen.io/chriscoyier/embed/preview/gfdDu?default-tab=result");
    expect(frame("https://replit.com/@replit/Python")).toBe("https://replit.com/@replit/Python?embed=true");
    expect(frame("https://app.hex.tech/acme/app/1a2b3c/latest")).toBe("https://app.hex.tech/acme/embed/1a2b3c/latest");
    expect(frame("https://trello.com/b/nC8QJJoZ/trello-development-roadmap")).toBe("https://trello.com/b/nC8QJJoZ.html");
    expect(frame("https://trello.com/c/abc123/1-card")).toBe("bookmark");
    expect(frame("https://pitch.com/public/0a1b2c3d")).toBe("https://pitch.com/embed/0a1b2c3d");
    expect(frame("https://app.box.com/s/abc123")).toBe("https://app.box.com/embed/s/abc123");
    expect(frame("https://onedrive.live.com/redir?resid=ABC!123&authkey=!k")).toBe("https://onedrive.live.com/embed?resid=ABC%21123&authkey=%21k");
    expect(frame("https://1drv.ms/w/s!abc")).toBe("bookmark");
    expect(frame("https://app.amplitude.com/analytics/share/abc123")).toBe("https://app.amplitude.com/analytics/share/embed/abc123");
    expect(resolveEmbed("https://analytics.eu.amplitude.com/share/abc123")?.service).toBe("amplitudeEu");
    expect(frame("https://discord.com/widget?id=123456789012")).toBe("https://discord.com/widget?id=123456789012&theme=dark");
    expect(frame("https://discord.gg/invite")).toBe("bookmark");
    expect(frame("https://form.typeform.com/to/AbCdEf")).toBe("https://form.typeform.com/to/AbCdEf");
    expect(frame("https://mixpanel.com/p/AbC123")).toBe("https://mixpanel.com/p/AbC123");
    expect(frame("https://mixpanel.com/project/1/view/2")).toBe("bookmark");
  });

  test("videos keep using Phase C's player rules, and PDFs open in the PDF viewer", () => {
    expect(resolveEmbed("https://www.youtube.com/watch?v=jNQXAC9IVRw")).toMatchObject({ kind: "frame", video: true, embedUrl: "https://www.youtube.com/embed/jNQXAC9IVRw" });
    expect(resolveEmbed("https://www.loom.com/share/0281766fa2d04bb788eaf19e65135184", "loom")).toMatchObject({ kind: "frame", service: "loom", video: true });
    expect(resolveEmbed("https://example.com/files/report.PDF")).toEqual({ kind: "pdf", service: "pdf", url: "https://example.com/files/report.PDF" });
  });

  test("other links are framed as they are, once the server says framing is allowed", () => {
    expect(resolveEmbed("example.com/page")).toEqual({ kind: "frame", service: null, embedUrl: "https://example.com/page", height: 400, video: false, checkFraming: true });
    expect(resolveEmbed("javascript:alert(1)")).toBeNull();
    expect(resolveEmbed("not a link")).toBeNull();
    expect(findEmbedService("https://gist.github.com/x/abcdef")?.id).toBe("githubGist");
    expect(findEmbedService("https://github.com/x/y")?.id).toBe("github");
  });

  test("a named item only takes its own service's links; the generic Embed takes any", () => {
    expect(isValidEmbedLink("googleMaps", "https://www.google.com/maps/place/Paris")).toBe(true);
    expect(isValidEmbedLink("googleMaps", "https://example.com")).toBe(false);
    expect(isValidEmbedLink("pdf", "https://example.com/a.pdf")).toBe(true);
    expect(isValidEmbedLink("loom", "https://www.loom.com/share/0281766fa2d04bb788eaf19e65135184")).toBe(true);
    expect(isValidEmbedLink(null, "https://example.com")).toBe(true);
    expect(isValidEmbedLink(null, "ftp://example.com")).toBe(false);
    expect(isValidMediaLink("embed", "https://example.com")).toBe(true);
  });

  test("a Tweet frame's resize message gives its height", () => {
    const message = { "twttr.embed": { method: "twttr.private.resize", params: [{ height: 312.4, width: 550 }] } };
    expect(readTweetHeight(message)).toBe(313);
    expect(readTweetHeight(JSON.stringify(message))).toBe(313);
    expect(readTweetHeight({ "twttr.embed": { method: "twttr.private.trigger", params: [{ height: 10 }] } })).toBe(0);
    expect(readTweetHeight("not json")).toBe(0);
    expect(readTweetHeight(null)).toBe(0);
  });

  test("sizes are clamped", () => {
    expect(clampEmbedSize(55.4, 333.3)).toEqual({ width: 55, height: 333 });
    expect(clampEmbedSize(500, 5)).toEqual({ width: 100, height: 120 });
    expect(clampEmbedSize(null, "x")).toEqual({ width: 100, height: 0 });
    expect(clampEmbedSize(2, 99999)).toEqual({ width: 10, height: 2000 });
  });
});

describe("embeds in Markdown", () => {
  test("an embed keeps its link, service and size through a round trip", () => {
    const attrs = { url: "https://www.figma.com/design/AbC123/My-file?a=1&b=\"2\"", service: "figma", width: 60, height: 520 };
    const markdown = docToMarkdown({ type: "doc", content: [{ type: "ponderEmbed", attrs }] });
    expect(markdown).toBe('<ponder-embed url="https://www.figma.com/design/AbC123/My-file?a=1&amp;b=&quot;2&quot;" service="figma" width="60" height="520"></ponder-embed>');
    const back = markdownToDoc(markdown);
    expect(back.content[0]).toEqual({ type: "ponderEmbed", attrs });
  });

  test("a full-width embed with no height writes only its link, as Phase C did", () => {
    const back = roundTrip([{ type: "ponderEmbed", attrs: { url: "https://vimeo.com/76979871" } }]);
    expect(docToMarkdown(back)).toBe('<ponder-embed url="https://vimeo.com/76979871"></ponder-embed>');
    expect(back.content[0].attrs).toEqual({ url: "https://vimeo.com/76979871", service: "", width: null, height: null });
  });

  test("Phase C's embeds still read", () => {
    const back = markdownToDoc('<ponder-embed url="https://www.youtube.com/watch?v=aqz-KE-bpKQ"></ponder-embed>');
    expect(back.content[0].attrs.url).toBe("https://www.youtube.com/watch?v=aqz-KE-bpKQ");
  });

  test("an unknown service or bad size is dropped, not kept", () => {
    const back = markdownToDoc('<ponder-embed url="https://example.com" service="evil" width="-4" height="abc"></ponder-embed>');
    expect(back.content[0].attrs).toEqual({ url: "https://example.com", service: "", width: null, height: null });
  });

  test("an empty named embed block keeps which service it is for", () => {
    const back = roundTrip([{ type: "ponderMedia", attrs: { kind: "embed", service: "googleMaps" } }, { type: "ponderMedia", attrs: { kind: "embed", service: "" } }]);
    expect(back.content.map((node) => node.attrs)).toEqual([{ kind: "embed", service: "googleMaps" }, { kind: "embed", service: "" }]);
    expect(docToMarkdown(back)).toContain('<ponder-media kind="embed" service="googleMaps"></ponder-media>');
  });

  test("text around an embed survives an AI edit written in Markdown", () => {
    const markdown = 'Intro\n\n<ponder-embed url="https://gist.github.com/octocat/6cad326836d38bd3a7ae" service="githubGist" height="300"></ponder-embed>\n\nOutro';
    const doc = markdownToDoc(markdown);
    expect(doc.content.map((node) => node.type)).toEqual(["paragraph", "ponderEmbed", "paragraph"]);
    expect(docToMarkdown(doc)).toBe(markdown);
  });

  test("the editor schema accepts embeds with sizes", () => {
    const schema = getSchema(createPonderDocumentExtensions({ mathematics: createPonderMarkdownMathematics() }));
    expect(schema).toBeInstanceOf(Schema);
    const node = schema.nodeFromJSON({
      type: "doc",
      content: [
        { type: "ponderEmbed", attrs: { url: "https://x.com/jack/status/20", service: "tweet", width: 50, height: 400 } },
        { type: "ponderMedia", attrs: { kind: "embed", service: "miro" } },
      ],
    });
    node.check();
    expect(node.childCount).toBe(2);
  });
});
