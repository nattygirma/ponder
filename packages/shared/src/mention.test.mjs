import { describe, expect, test } from "bun:test";
import { docToMarkdown, docToText, markdownToDoc, resolveMemoContentDoc } from "./content.ts";
import {
  collectMentions,
  formatMentionDate,
  MENTION_NODE_TYPE,
  mentionHref,
  normalizeMentionAttributes,
  parseMentionHref,
} from "./mention.ts";
import { defaultReminderOption, getFilteredReminderOptions, reminderFireTime } from "./mention-reminders.ts";
import { collectMemoLinkIds } from "./note-links.ts";

const mention = (attrs) => ({ type: MENTION_NODE_TYPE, attrs: normalizeMentionAttributes(attrs) });
const paragraph = (...content) => ({ type: "paragraph", content });
const text = (value) => ({ type: "text", text: value });
const doc = (...content) => ({ type: "doc", content });

const person = mention({ kind: "person", id: "usr_ada", label: "Ada Lovelace" });
const page = mention({ kind: "page", id: "memo_reading", label: "Reading [List]" });
const day = mention({ kind: "date", date: "2026-11-12", label: "Tomorrow" });
const reminder = mention({
  kind: "date", date: "2026-11-12", remind: "onDayOfEvent", remindAt: "2026-11-12T08:00:00.000Z", reminderId: "rmd_1", remindedBy: "usr_ada",
});
const timed = mention({ kind: "date", date: "2026-11-12T15:30:00.000Z", includeTime: true });

const mentionsOf = (value) => {
  const found = [];
  const walk = (node) => {
    if (node.type === MENTION_NODE_TYPE) found.push(node.attrs);
    node.content?.forEach(walk);
  };
  walk(value);
  return found;
};

describe("mentions in Markdown", () => {
  test("writes each kind as a ponder: link", () => {
    const markdown = docToMarkdown(doc(paragraph(text("Ask "), person, text(" about "), page, text(" by "), day)));
    expect(markdown).toContain("[@Ada Lovelace](ponder:person/usr_ada)");
    expect(markdown).toContain("[Reading \\[List\\]](ponder:page/memo_reading)");
    // Dates are written out in full, so the Markdown doesn't go stale or depend on the server's day.
    expect(markdown).toContain("[@November 12, 2026](ponder:date/2026-11-12)");
  });

  test("round-trips people, pages, dates, times and reminders through Markdown", () => {
    const original = doc(paragraph(person, text(" "), page, text(" "), day, text(" "), reminder, text(" "), timed));
    const parsed = markdownToDoc(docToMarkdown(original));
    const attrs = mentionsOf(parsed);
    expect(attrs.map((item) => item.kind)).toEqual(["person", "page", "date", "date", "date"]);
    expect(attrs[0]).toMatchObject({ id: "usr_ada", label: "Ada Lovelace" });
    expect(attrs[1]).toMatchObject({ id: "memo_reading", label: "Reading [List]" });
    expect(attrs[2]).toMatchObject({ date: "2026-11-12", includeTime: false, remind: "" });
    expect(attrs[3]).toMatchObject({ remind: "onDayOfEvent", remindAt: "2026-11-12T08:00:00.000Z", reminderId: "rmd_1", remindedBy: "usr_ada" });
    expect(attrs[4]).toMatchObject({ date: "2026-11-12T15:30:00.000Z", includeTime: true });
    // A second pass changes nothing, so AI and MCP edits keep the mention as it was.
    expect(docToMarkdown(parsed)).toBe(docToMarkdown(original));
  });

  test("reads mentions an AI or MCP tool wrote as Markdown", () => {
    const parsed = markdownToDoc("Remind [@Ada](ponder:person/usr_ada) about [Plan](ponder:page/memo_plan) [@Friday](ponder:date/2026-11-13?remind=oneDayBefore&at=2026-11-12T08:00:00.000Z&by=usr_me)");
    const attrs = mentionsOf(parsed);
    expect(attrs).toHaveLength(3);
    expect(attrs[2]).toMatchObject({ kind: "date", date: "2026-11-13", remind: "oneDayBefore", remindedBy: "usr_me" });
  });

  test("leaves malformed ponder: links as plain text instead of making a broken mention", () => {
    const parsed = markdownToDoc("[x](ponder:person/<script>) [y](ponder:date/not-a-date) [z](ponder:unknown/abc)");
    expect(mentionsOf(parsed)).toHaveLength(0);
  });

  test("keeps the JSON document when it has mentions", () => {
    const json = doc(paragraph(person));
    expect(resolveMemoContentDoc(json, "@Ada Lovelace")).toBe(json);
  });

  test("puts the mention's text in search text", () => {
    expect(docToText(doc(paragraph(text("Ping"), person)))).toBe("Ping @Ada Lovelace");
  });

  test("counts page mentions as links for backlinks", () => {
    expect(collectMemoLinkIds(doc(paragraph(page)))).toEqual(["memo_reading"]);
  });
});

describe("mention links", () => {
  test("href and parse are inverses", () => {
    for (const node of [person, page, day, reminder, timed]) {
      expect(parseMentionHref(mentionHref(node.attrs), node.attrs.label)).toEqual({ ...node.attrs });
    }
  });

  test("drops a reminder without a fire time", () => {
    expect(normalizeMentionAttributes({ kind: "date", date: "2026-11-12", remind: "onDayOfEvent" }).remind).toBe("");
  });

  test("collects mentions with the text of their block", () => {
    const found = collectMentions(doc(paragraph(text("Ask "), person, text(" today"))));
    expect(found).toHaveLength(1);
    expect(found[0]).toMatchObject({ kind: "person", id: "usr_ada", context: "Ask @Ada Lovelace today" });
  });
});

describe("relative dates and reminders", () => {
  const now = new Date(2026, 10, 11, 14, 0);
  test("shows Today, Tomorrow and Yesterday, then the full date, as Notion's Relative format does", () => {
    expect(formatMentionDate("2026-11-11", false, now)).toBe("Today");
    expect(formatMentionDate("2026-11-12", false, now)).toBe("Tomorrow");
    expect(formatMentionDate("2026-11-10", false, now)).toBe("Yesterday");
    expect(formatMentionDate("2026-11-20", false, now)).toBe("November 20, 2026");
    expect(formatMentionDate(new Date(2026, 10, 12, 15, 0).toISOString(), true, now)).toBe("Tomorrow 3:00 PM");
  });

  test("fires day reminders at 9:00 AM local time and timed ones before the time", () => {
    expect(reminderFireTime("2026-11-12", false, "onDayOfEvent")?.getTime()).toBe(new Date(2026, 10, 12, 9, 0).getTime());
    expect(reminderFireTime("2026-11-12", false, "oneWeekBefore")?.getTime()).toBe(new Date(2026, 10, 5, 9, 0).getTime());
    const at = new Date(2026, 10, 12, 15, 0);
    expect(reminderFireTime(at.toISOString(), true, "fifteenMinsBefore")?.getTime()).toBe(at.getTime() - 15 * 60_000);
    expect(reminderFireTime("2026-11-12", false, "fiveMinsBefore")).toBeNull();
    expect(reminderFireTime("2026-11-12", false, "none")).toBeNull();
  });

  test("lists Notion's Remind options for dates with and without a time", () => {
    expect(getFilteredReminderOptions(false).map((option) => option.label)).toEqual([
      "None", "On day of event (9:00 AM)", "1 day before (9:00 AM)", "2 days before (9:00 AM)", "1 week before (9:00 AM)",
    ]);
    expect(getFilteredReminderOptions(true).map((option) => option.name)).not.toContain("onDayOfEvent");
    expect(defaultReminderOption(false)).toBe("onDayOfEvent");
  });
});
