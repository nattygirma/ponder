import { describe, expect, test } from "bun:test";
import {
  createSlashCommandItems,
  filterSlashCommandItems,
  formatCurrentDate,
  formatCurrentDateTime,
  formatCurrentTime,
} from "./SlashCommandMenu.tsx";

const labels = {
  menu: "Insert menu",
  empty: "No matching commands.",
  close: "Close menu",
  groups: { suggested: "Suggested", basic: "Basic blocks", insert: "Insert" },
  items: {
    ai: "Ask AI",
    paragraph: "Body",
    "heading-1": "Heading 1",
    "heading-2": "Heading 2",
    "heading-3": "Heading 3",
    "heading-4": "Heading 4",
    "heading-5": "Heading 5",
    "heading-6": "Heading 6",
    "bullet-list": "Bulleted list",
    "ordered-list": "Numbered list",
    "task-list": "Task list",
    blockquote: "Quote",
    "code-block": "Code block",
    divider: "Divider",
    fold: "Fold",
    table: "Table",
    "inline-math": "Insert formula",
    "block-math": "Display formula",
    "current-date": "Current date",
    "current-time": "Current time",
    "current-date-time": "Current date and time",
    attachment: "Upload attachment",
    "note-link": "Link a note",
    "external-link": "Insert link",
    "sub-page": "Page",
    callout: "Callout",
    "columns-2": "2 columns",
    "columns-3": "3 columns",
    database: "Database",
    chart: "Chart",
    button: "Button",
  },
};

describe("slash command menu", () => {
  const items = createSlashCommandItems(labels);

  test("shows all commands for a bare slash", () => {
    const unfilteredItems = filterSlashCommandItems(items, "");
    const heading6Index = unfilteredItems.findIndex((item) => item.id === "heading-6");

    expect(unfilteredItems).toHaveLength(32);
    expect(unfilteredItems.slice(heading6Index + 1, heading6Index + 4).map((item) => item.id)).toEqual([
      "current-date",
      "current-time",
      "current-date-time",
    ]);
  });

  test("searches localized labels and aliases", () => {
    expect(filterSlashCommandItems(items, "AI").map((item) => item.id)).toEqual(["ai"]);
    expect(filterSlashCommandItems(items, "todo").map((item) => item.id)).toEqual(["task-list"]);
    expect(filterSlashCommandItems(items, "h2").map((item) => item.id)).toEqual(["heading-2"]);
    expect(filterSlashCommandItems(items, "h5").map((item) => item.id)).toEqual(["heading-5"]);
    expect(filterSlashCommandItems(items, "today").map((item) => item.id)).toEqual(["current-date"]);
    expect(filterSlashCommandItems(items, "timestamp").map((item) => item.id)).toEqual(["current-date-time"]);
  });

  test("assigns every item a unique lowercase slash command alias", () => {
    expect(items.map((item) => item.command)).toEqual([
      "ai",
      "text",
      "h1",
      "h2",
      "h3",
      "h4",
      "h5",
      "h6",
      "date",
      "time",
      "datetime",
      "bullet",
      "numbered",
      "task",
      "quote",
      "code",
      "divider",
      "fold",
      "table",
      "math",
      "equation",
      "upload",
      "note",
      "link",
      "page",
      "database",
      "chart",
      "form",
      "button",
      "callout",
      "columns",
      "columns3",
    ]);
    expect(items.every((item) => /^[a-z][a-z0-9]*$/.test(item.command))).toBe(true);
    expect(new Set(items.map((item) => item.command)).size).toBe(items.length);
    expect(filterSlashCommandItems(items, "collapse").map((item) => item.id)).toEqual(["fold"]);
    expect(filterSlashCommandItems(items, "table").map((item) => item.id)).toEqual(["table"]);
    expect(filterSlashCommandItems(items, "task").map((item) => item.id)).toEqual(["task-list"]);
    expect(filterSlashCommandItems(items, "Formula").map((item) => item.id)).toEqual(["inline-math", "block-math"]);
    expect(filterSlashCommandItems(items, "equation").map((item) => item.id)).toEqual(["block-math"]);
  });

  test("formats local date and time as stable static text", () => {
    const date = new Date(2026, 0, 2, 3, 4, 5);

    expect(formatCurrentDate(date)).toBe("2026-01-02");
    expect(formatCurrentTime(date)).toBe("03:04");
    expect(formatCurrentDateTime(date)).toBe("2026-01-02 03:04");
  });
});
