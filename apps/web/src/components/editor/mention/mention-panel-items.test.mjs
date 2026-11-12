import { describe, expect, test } from "bun:test";
import { buildMentionOptions, groupMentionOptions, hasMentionResults, parseTypedDate } from "./mention-panel-items.ts";
import { mentionFromOption } from "./MentionPanel.tsx";
import { EMOJI_COLUMNS, getRowsWithCategories, searchEmojis, toEmojiCategories, withRecent } from "../emoji/emoji-data.ts";
import emojiData from "@emoji-mart/data/sets/15/native.json";

// Wednesday 11 November 2026, 2 PM local time.
const now = new Date(2026, 10, 11, 14, 0);
const day = (date) => `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
const labels = { untitled: "Untitled", remindMe: "Remind me", tomorrowNineAm: "Tomorrow 9am" };
const members = [
  { id: "usr_me", username: "me", displayName: "Natnael Girma", email: null, role: "owner" },
  { id: "usr_ada", username: "ada", displayName: "Ada Lovelace", email: "ada@example.com", role: "member" },
];
const pages = [
  { id: "memo_here", title: "This page", icon: null, databaseId: null, parentId: null },
  { id: "memo_reading", title: "Reading List", icon: "📚", databaseId: null, parentId: "memo_parent" },
  { id: "memo_tasks", title: "", icon: null, databaseId: "db_1", parentId: null },
];
const build = (mode, query, extra = {}) => buildMentionOptions({
  mode, query, now, members, viewerId: "usr_me", pages, currentPageId: "memo_here",
  parentTitle: () => "Parent", canCreatePage: true, labels, ...extra,
});

describe("the @ menu", () => {
  test("shows Notion's sections in Notion's order with nothing typed", () => {
    const options = build("all", "");
    expect(groupMentionOptions(options).map((group) => group.section)).toEqual(["date", "people", "pages", "newPage"]);
    expect(options.filter((option) => option.section === "date").map((option) => [option.label, option.hint])).toEqual([["Today", ""], ["Remind me", "Tomorrow 9am"]]);
    // The viewer isn't offered with nothing typed, and the open page isn't offered as a link.
    expect(options.filter((option) => option.kind === "person").map((option) => option.id)).toEqual(["usr_ada"]);
    expect(options.filter((option) => option.kind === "page").map((option) => option.label)).toEqual(["Reading List", "Untitled"]);
  });

  test("finds people by name, username or email and marks the viewer", () => {
    expect(build("all", "nat").filter((option) => option.kind === "person").map((option) => [option.label, option.isViewer])).toEqual([["Natnael Girma", true]]);
    expect(build("people", "example").map((option) => option.id)).toEqual(["usr_ada"]);
    expect(build("people", "").map((option) => option.id)).toEqual(["usr_me", "usr_ada"]);
  });

  test("limits the slash items and [[ to one section", () => {
    expect(new Set(build("dates", "").map((option) => option.section))).toEqual(new Set(["date"]));
    expect(new Set(build("pages", "").map((option) => option.section))).toEqual(new Set(["pages", "newPage"]));
  });

  test("names a search result's parent and offers a sub-page named after the query", () => {
    const options = build("pages", "read");
    expect(options.find((option) => option.kind === "page")?.subtitle).toBe("Parent");
    expect(options.at(-1)).toMatchObject({ kind: "createSubPage", title: "read" });
    expect(hasMentionResults([options.at(-1)])).toBe(false);
  });

  test("reads typed dates and offers to remind on them", () => {
    const options = build("dates", "tomorrow");
    expect(options.map((option) => [option.label, option.day, option.remind])).toEqual([
      ["Tomorrow", "2026-11-12", false], ["Remind me", "2026-11-12", true],
    ]);
    expect(options[1].hint).toBe("November 12, 2026");
  });

  test("turns a choice into the mention it inserts", () => {
    const [today, remind] = build("dates", "");
    expect(mentionFromOption(today, "usr_me")).toMatchObject({ kind: "date", date: "2026-11-11", remind: "" });
    const reminder = mentionFromOption(remind, "usr_me");
    expect(reminder).toMatchObject({ kind: "date", date: "2026-11-12", remind: "onDayOfEvent", remindedBy: "usr_me" });
    expect(new Date(reminder.remindAt).getTime()).toBe(new Date(2026, 10, 12, 9, 0).getTime());
    expect(reminder.reminderId).toMatch(/^rmd_/);
  });
});

describe("typed dates", () => {
  test.each([
    ["today", day(now)], ["tod", day(now)], ["tomorrow", "2026-11-12"], ["yesterday", "2026-11-10"],
    ["friday", "2026-11-13"], ["wed", "2026-11-18"], ["next friday", "2026-11-20"], ["in 3 days", "2026-11-14"],
    ["in 2 weeks", "2026-11-25"], ["nov 20", "2026-11-20"], ["20 November 2027", "2027-11-20"],
    ["2026-12-01", "2026-12-01"], ["12/25", "2026-12-25"], ["1/2/27", "2027-01-02"],
  ])("reads %p", (typed, expected) => {
    expect(day(parseTypedDate(typed, now))).toBe(expected);
  });

  test("rejects words and impossible dates", () => {
    for (const typed of ["reading", "to", "feb 30", "13/40", "2026-02-30", ""]) expect(parseTypedDate(typed, now)).toBeNull();
  });
});

describe("the : emoji menu", () => {
  const categories = toEmojiCategories(emojiData);

  test("puts the closest names first, as Notion's :smi does", () => {
    const found = searchEmojis(categories, "smi");
    expect(found.length).toBeGreaterThan(10);
    expect(found.length).toBeLessThanOrEqual(35);
    expect(found.slice(0, 3).every((emoji) => /smil/i.test(`${emoji.id} ${emoji.name}`))).toBe(true);
    expect(searchEmojis(categories, "")).toEqual([]);
    expect(searchEmojis(categories, "zzzzqq")).toEqual([]);
  });

  test("lays out the full picker in rows of 12 under category titles, with Recent first", () => {
    const rows = getRowsWithCategories(withRecent(categories, ["😄", "not an emoji"]));
    expect(rows[0]).toMatchObject({ type: "category", category: "recent" });
    expect(rows[1].emojis.map((emoji) => emoji.native)).toEqual(["😄"]);
    expect(rows.filter((row) => row.type === "emojis").every((row) => row.emojis.length <= EMOJI_COLUMNS)).toBe(true);
    expect(rows.filter((row) => row.type === "category").map((row) => row.category)).toEqual([
      "recent", "people", "nature", "foods", "activity", "places", "objects", "symbols", "flags",
    ]);
  });
});
