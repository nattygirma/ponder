import { describe, expect, test } from "bun:test";
import {
  createSlashCommandItems,
  filterSlashCommandItems,
  formatCurrentDate,
  formatCurrentDateTime,
  formatCurrentTime,
  SLASH_GROUP_ORDER,
} from "./SlashCommandMenu.tsx";

const colors = ["gray", "brown", "orange", "yellow", "green", "blue", "purple", "pink", "red"];
const capital = (value) => value[0].toUpperCase() + value.slice(1);

// Notion's labels, as read from its `/` menu on 2026-11-11.
const labels = {
  menu: "Insert menu",
  empty: "No results",
  close: "Close menu",
  filtered: "Filtered results",
  placeholder: "Type to search",
  groups: {
    suggested: "Suggested", basic: "Basic blocks", media: "Media", database: "Database", advanced: "Advanced blocks", inline: "Inline",
    embeds: "Embeds", import: "Import", turnInto: "Turn into", actions: "Actions", textColor: "Text color", backgroundColor: "Background color",
  },
  items: {
    paragraph: "Text", "heading-1": "Heading 1", "heading-2": "Heading 2", "heading-3": "Heading 3", "heading-4": "Heading 4",
    "bullet-list": "Bulleted list", "ordered-list": "Numbered list", "task-list": "To-do list", "toggle-list": "Toggle list",
    "sub-page": "Page", callout: "Callout", blockquote: "Quote", table: "Table", divider: "Divider", "note-link": "Link to page",
    image: "Image", video: "Video", audio: "Audio", "code-block": "Code", attachment: "File", "web-bookmark": "Web bookmark",
    "view-table": "Table view", "view-board": "Board view", "view-gallery": "Gallery view", "view-list": "List view",
    "view-calendar": "Calendar view", "view-timeline": "Timeline view",
    "chart-vertical_bar": "Vertical bar chart", "chart-horizontal_bar": "Horizontal bar chart", "chart-line": "Line chart",
    "chart-donut": "Donut chart", "chart-number": "Number chart", form: "Form",
    "database-inline": "Database - Inline", "database-full-page": "Database - Full page", "linked-database": "Linked view of data source",
    toc: "Table of contents", breadcrumb: "Breadcrumb", tabs: "Tabs", mermaid: "Code - Mermaid",
    "toggle-heading-1": "Toggle heading 1", "toggle-heading-2": "Toggle heading 2", "toggle-heading-3": "Toggle heading 3",
    "block-math": "Block equation", button: "Button", "columns-2": "2 columns", "columns-3": "3 columns", "columns-4": "4 columns", "columns-5": "5 columns",
    "inline-math": "Inline equation", "current-date": "Current date", "current-time": "Current time", "current-date-time": "Current date and time",
    "external-link": "Web link", "import-markdown": "Text and Markdown", "import-zip": "ZIP",
    "copy-link": "Copy link to block", duplicate: "Duplicate", "move-to": "Move to", delete: "Delete", ai: "Ask AI",
  },
  textColors: Object.fromEntries([["default", "Default text"], ...colors.map((color) => [color, `${capital(color)} text`])]),
  backgroundColors: Object.fromEntries([["default", "Default background"], ...colors.map((color) => [color, `${capital(color)} background`])]),
};

// Notion's Embeds group, read from its `/` menu on 2026-11-11 (less HTML, which the plan leaves out).
const EMBEDS = [
  "Google Drive", "Tweet", "GitHub Gist", "Google Maps", "Figma", "Abstract", "Invision", "Mixpanel", "Framer", "Whimsical",
  "Miro", "Sketch", "Excalidraw", "PDF", "Loom", "Typeform", "CodePen", "Replit", "Hex", "Deepnote",
  "Slack", "Trello", "Pitch", "OneDrive", "Dropbox", "Amplitude", "Claap", "Box", "Linear", "Lucidchart",
  "Lucidspark", "Eraser", "ClickUp", "Plus", "Dovetail", "Streak Share", "Shortcut", "SendOwl", "Amplitude - EU", "Zendesk",
  "Google Contacts", "Discord", "Microsoft Contacts", "PagerDuty", "Asana", "GitLab", "Zoom", "Adobe XD", "Jira", "GitHub",
];

const filter = (query, options = {}) => filterSlashCommandItems(createSlashCommandItems(labels, options.current ?? "paragraph"), query, { groups: labels.groups, ...options });
const labelsOf = (items) => items.map((item) => item.label);
const inGroup = (items, group) => labelsOf(items.filter((item) => item.group === group));

describe("slash command menu", () => {
  test("lists Notion's groups in Notion's order", () => {
    const groups = [...new Set(filter("").map((item) => item.group))];
    expect(groups).toEqual(SLASH_GROUP_ORDER);
  });

  test("uses Notion's labels, order and Markdown hints for Basic blocks", () => {
    const basic = filter("").filter((item) => item.group === "basic");
    expect(basic.map((item) => [item.label, item.hint ?? ""])).toEqual([
      ["Text", ""], ["Heading 1", "#"], ["Heading 2", "##"], ["Heading 3", "###"], ["Heading 4", "####"],
      ["Bulleted list", "-"], ["Numbered list", "1."], ["To-do list", "[]"], ["Toggle list", ">"], ["Page", ""],
      ["Callout", ""], ["Quote", "\""], ["Table", ""], ["Divider", "---"], ["Link to page", ""],
    ]);
  });

  test("hides Heading 5 and 6 and Notion-only blocks Ponder lacks", () => {
    const all = labelsOf(filter(""));
    expect(all.some((label) => /Heading [56]/.test(label))).toBe(false);
    for (const missing of ["Synced block", "AI Notetaker", "Feed view", "Map view", "HTML"]) {
      expect(all).not.toContain(missing);
    }
  });

  test("has one Database item per view and per chart type", () => {
    expect(inGroup(filter(""), "database")).toEqual([
      "Table view", "Board view", "Gallery view", "List view", "Calendar view", "Timeline view",
      "Vertical bar chart", "Horizontal bar chart", "Line chart", "Donut chart", "Number chart",
      "Form", "Database - Inline", "Database - Full page", "Linked view of data source",
    ]);
  });

  test("lists Media, Advanced, Inline, Import and Actions as Notion does", () => {
    const all = filter("");
    expect(inGroup(all, "media")).toEqual(["Image", "Video", "Audio", "Code", "File", "Web bookmark"]);
    // Notion's order, read on 2026-11-11, less Synced block and AI Notetaker.
    expect(inGroup(all, "advanced")).toEqual([
      "Table of contents", "Block equation", "Button", "Breadcrumb", "Tabs", "Toggle heading 1", "Toggle heading 2", "Toggle heading 3",
      "2 columns", "3 columns", "4 columns", "5 columns", "Code - Mermaid",
    ]);
    expect(all.filter((item) => item.id.startsWith("toggle-heading")).map((item) => item.hint)).toEqual(["# >", "## >", "### >"]);
    expect(inGroup(all, "inline")).toEqual(["Inline equation"]);
    expect(inGroup(all, "import")).toEqual(["Text and Markdown", "ZIP"]);
    expect(inGroup(all, "actions")).toEqual(["Copy link to block", "Duplicate", "Move to", "Delete", "Ask AI"]);
    expect(inGroup(all, "textColor")).toHaveLength(10);
    expect(inGroup(all, "backgroundColor")).toEqual(["Default background", ...colors.map((color) => `${capital(color)} background`)]);
  });

  test("suggests recently used blocks, or Ask AI before any are used", () => {
    expect(inGroup(filter(""), "suggested")).toEqual(["Ask AI"]);
    const suggested = filter("", { recent: ["view-board", "heading-2", "duplicate"] }).filter((item) => item.group === "suggested");
    expect(suggested.map((item) => [item.label, item.origin])).toEqual([["Board view", "database"], ["Heading 2", "basic"]]);
  });

  test("checks the block's current type under Turn into", () => {
    const turnInto = filter("", { current: "bullet" }).filter((item) => item.group === "turnInto");
    expect(turnInto.map((item) => item.label)).toEqual([
      "Text", "Heading 1", "Heading 2", "Heading 3", "Heading 4", "Bulleted list", "Numbered list", "To-do list", "Toggle list", "Code", "Quote", "Callout",
      "Toggle heading 1", "Toggle heading 2", "Toggle heading 3",
    ]);
    expect(turnInto.filter((item) => item.checked).map((item) => item.label)).toEqual(["Bulleted list"]);
  });

  test("filters like Notion: label prefixes first, group names match their items", () => {
    expect(filter("table").map((item) => item.id)).toEqual(["table", "view-table", "toc"]);
    expect(filter("red").map((item) => item.id)).toEqual(["text-red", "background-red", "ordered-list", "turn-ordered"]);
    expect(filter("turn").every((item) => item.group === "turnInto")).toBe(true);
    expect(filter("turn")).toHaveLength(15);
    expect(filter("equation").map((item) => item.id)).toEqual(["block-math", "inline-math"]);
    // "embed" is the Embeds group's name, so Notion lists the whole group, Embed first.
    expect(filter("embed").map((item) => item.label)).toEqual(["Embed", ...EMBEDS]);
    expect(filter("zzz")).toEqual([]);
  });

  test("keeps Ponder's extra date, time and link items findable by search only", () => {
    expect(labelsOf(filter(""))).not.toContain("Current date");
    expect(filter("today").map((item) => item.id)).toEqual(["current-date"]);
    expect(filter("timestamp").map((item) => item.id)).toEqual(["current-date-time"]);
    expect(filter("url").map((item) => item.id)).toEqual(["external-link"]);
    expect(filter("collapse").map((item) => item.id)).toEqual(["toggle-list"]);
    expect(filter("h2").map((item) => item.id)).toEqual(["heading-2"]);
    expect(filter("todo").map((item) => item.id)).toEqual(["task-list"]);
  });

  test("finds the Phase C blocks by Notion's names and aliases", () => {
    expect(filter("toggle h").map((item) => item.id)).toEqual(["toggle-heading-1", "toggle-heading-2", "toggle-heading-3", "turn-toggle-h1", "turn-toggle-h2", "turn-toggle-h3"]);
    expect(filter("mermaid").map((item) => item.id)).toEqual(["mermaid"]);
    expect(filter("bookmark").map((item) => item.id)).toEqual(["web-bookmark"]);
    expect(filter("toc").map((item) => item.id)).toEqual(["toc"]);
    expect(filter("tabs").map((item) => item.id)).toEqual(["tabs"]);
    expect(filter("", { current: "toggle-h2" }).filter((item) => item.checked).map((item) => item.id)).toEqual(["turn-toggle-h2"]);
  });

  test("gives every item a unique id", () => {
    const items = createSlashCommandItems(labels);
    expect(new Set(items.map((item) => item.id)).size).toBe(items.length);
  });

  test("formats local date and time as stable static text", () => {
    const date = new Date(2026, 0, 2, 3, 4, 5);

    expect(formatCurrentDate(date)).toBe("2026-01-02");
    expect(formatCurrentTime(date)).toBe("03:04");
    expect(formatCurrentDateTime(date)).toBe("2026-01-02 03:04");
  });

  test("lists Notion's Embeds group: Embed, then every named service in Notion's order (Phase E)", () => {
    const all = filter("");
    expect(inGroup(all, "embeds")).toEqual(["Embed", ...EMBEDS]);
    expect(all.filter((item) => item.group === "embeds").every((item) => typeof item.icon === "function" || typeof item.icon === "object")).toBe(true);
    expect(filter("figma").map((item) => item.id)).toEqual(["embed-figma"]);
    expect(filter("gist").map((item) => item.id)).toEqual(["embed-githubGist"]);
    expect(filter("google").map((item) => item.id)).toEqual(["embed-googleDrive", "embed-googleMaps", "embed-googleContacts"]);
    expect(filter("tweet").map((item) => item.id)).toEqual(["embed-tweet"]);
    expect(filter("whiteboard").map((item) => item.id)).toEqual(["embed-miro", "embed-excalidraw", "embed-lucidspark", "embed-eraser"]);
  });

  test("puts a recently used embed in Suggested, named after its group", () => {
    const suggested = filter("", { recent: ["embed-googleMaps"] }).filter((item) => item.group === "suggested");
    expect(suggested.map((item) => [item.label, item.origin])).toEqual([["Google Maps", "embeds"]]);
  });
});
