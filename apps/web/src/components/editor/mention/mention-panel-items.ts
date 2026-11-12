/*
 * Adapted from AppFlowy-Web (https://github.com/AppFlowy-IO/AppFlowy-Web), Copyright AppFlowy, AGPL-3.0.
 * Sources: src/components/editor/components/panels/mention-panel/mentionUtils.ts (the section order,
 * flattening sections into one keyboard list with stable keys, display titles for untitled pages) and
 * MentionPanel.tsx (`getDateMentionItems`: Today / Tomorrow / Yesterday filtered by the query, and the
 * "Create … sub-page" option). Sections, wording and the typed-date reading follow Notion's `@` menu.
 */
import type { PageNode, WorkspaceMember } from "@ponder/shared";
import { formatMentionDate, toMentionDay } from "@ponder/shared";

/** What the menu offers: everything (`@`), or one section (the `/` Inline items and `[[`). */
export type MentionMode = "all" | "people" | "pages" | "dates";

export type MentionSectionKind = "date" | "people" | "pages" | "newPage";

/** Notion's order: Date, People, Link to page, New page. */
export const MENTION_SECTION_ORDER: MentionSectionKind[] = ["date", "people", "pages", "newPage"];

const SECTIONS_FOR_MODE: Record<MentionMode, MentionSectionKind[]> = {
  all: MENTION_SECTION_ORDER,
  people: ["people"],
  pages: ["pages", "newPage"],
  dates: ["date"],
};

export type MentionOption =
  | { key: string; section: "date"; kind: "date"; day: string; label: string; remind: boolean; hint: string }
  | { key: string; section: "people"; kind: "person"; id: string; label: string; isViewer: boolean; role: WorkspaceMember["role"] }
  | { key: string; section: "pages"; kind: "page"; id: string; label: string; icon: string | null; database: boolean; subtitle: string }
  | { key: string; section: "newPage"; kind: "createSubPage"; title: string };

export type MentionPageCandidate = Pick<PageNode, "id" | "title" | "icon" | "databaseId" | "parentId">;

export type MentionLabels = {
  untitled: string;
  remindMe: string;
  /** "Tomorrow 9am", the hint beside Remind me with nothing typed. */
  tomorrowNineAm: string;
};

const MAX_PEOPLE = 6;
const MAX_PAGES = 8;

const startOfDay = (date: Date) => new Date(date.getFullYear(), date.getMonth(), date.getDate());
const addDays = (date: Date, days: number) => new Date(date.getFullYear(), date.getMonth(), date.getDate() + days);

const WEEKDAYS = ["sunday", "monday", "tuesday", "wednesday", "thursday", "friday", "saturday"];
const MONTHS = ["january", "february", "march", "april", "may", "june", "july", "august", "september", "october", "november", "december"];

const monthIndex = (word: string) => (word.length >= 3 ? MONTHS.findIndex((month) => month.startsWith(word)) : -1);

const validDay = (year: number, month: number, day: number) => {
  const date = new Date(year, month, day);
  return date.getFullYear() === year && date.getMonth() === month && date.getDate() === day ? date : null;
};

/**
 * Reads a date typed after `@`, as Notion does: "today", "tomorrow", "yesterday" (or the start of
 * one), a weekday ("fri" is the coming Friday), "next friday", "in 3 days", "nov 12", "12 nov 2027",
 * "2026-11-12" and "11/12" or "11/12/2026" (month first). Null when it isn't a date.
 */
export const parseTypedDate = (raw: string, now = new Date()): Date | null => {
  const query = raw.trim().toLowerCase().replace(/[,.]/g, " ").replace(/\s+/g, " ");
  if (!query) return null;
  const today = startOfDay(now);
  if (query.length >= 3) {
    if ("today".startsWith(query)) return today;
    if ("tomorrow".startsWith(query)) return addDays(today, 1);
    if ("yesterday".startsWith(query)) return addDays(today, -1);
  }
  const weekday = /^(next )?([a-z]{3,})$/.exec(query);
  if (weekday) {
    const index = WEEKDAYS.findIndex((day) => day.startsWith(weekday[2]));
    if (index >= 0) {
      const ahead = (index - today.getDay() + 7) % 7 || 7;
      return addDays(today, ahead + (weekday[1] && ahead < 7 ? 7 : 0));
    }
  }
  const relative = /^in (\d{1,3}) (day|days|week|weeks|month|months)$/.exec(query);
  if (relative) {
    const count = Number(relative[1]);
    if (relative[2].startsWith("day")) return addDays(today, count);
    if (relative[2].startsWith("week")) return addDays(today, count * 7);
    return validDay(today.getFullYear(), today.getMonth() + count, today.getDate())
      ?? new Date(today.getFullYear(), today.getMonth() + count + 1, 0);
  }
  const iso = /^(\d{4})-(\d{1,2})-(\d{1,2})$/.exec(query);
  if (iso) return validDay(Number(iso[1]), Number(iso[2]) - 1, Number(iso[3]));
  const slash = /^(\d{1,2})\/(\d{1,2})(?:\/(\d{2,4}))?$/.exec(query);
  if (slash) {
    const year = slash[3] ? (slash[3].length === 2 ? 2000 + Number(slash[3]) : Number(slash[3])) : today.getFullYear();
    return validDay(year, Number(slash[1]) - 1, Number(slash[2]));
  }
  const monthFirst = /^([a-z]{3,}) (\d{1,2})(?: (\d{4}))?$/.exec(query);
  const dayFirst = /^(\d{1,2}) ([a-z]{3,})(?: (\d{4}))?$/.exec(query);
  const words = monthFirst ? { month: monthFirst[1], day: monthFirst[2], year: monthFirst[3] }
    : dayFirst ? { month: dayFirst[2], day: dayFirst[1], year: dayFirst[3] }
    : null;
  if (words) {
    const month = monthIndex(words.month);
    if (month < 0) return null;
    return validDay(words.year ? Number(words.year) : today.getFullYear(), month, Number(words.day));
  }
  return null;
};

const matches = (value: string, query: string) => value.toLowerCase().includes(query);

const dateOptions = (query: string, now: Date, labels: MentionLabels): MentionOption[] => {
  const today = startOfDay(now);
  const option = (day: Date, remind: boolean, hint = ""): MentionOption => ({
    key: `date:${remind ? "remind" : "day"}:${toMentionDay(day)}`,
    section: "date",
    kind: "date",
    day: toMentionDay(day),
    label: remind ? labels.remindMe : formatMentionDate(toMentionDay(day), false, now),
    remind,
    hint,
  });
  if (!query) return [option(today, false), option(addDays(today, 1), true, labels.tomorrowNineAm)];
  const typed = parseTypedDate(query, now);
  if (typed) {
    return [option(typed, false), option(typed, true, new Intl.DateTimeFormat("en-US", { month: "long", day: "numeric", year: "numeric" }).format(typed))];
  }
  // "rem…" offers Remind me for tomorrow, as with nothing typed.
  return query.length >= 2 && labels.remindMe.toLowerCase().startsWith(query) ? [option(addDays(today, 1), true, labels.tomorrowNineAm)] : [];
};

const personOptions = (query: string, members: readonly WorkspaceMember[], viewerId: string | null, mode: MentionMode): MentionOption[] => {
  const found = members
    .filter((member) => {
      const name = member.displayName?.trim() || member.username;
      if (!query) return mode === "people" || member.id !== viewerId;
      return matches(name, query) || matches(member.username, query) || Boolean(member.email && matches(member.email, query));
    })
    .slice(0, MAX_PEOPLE);
  return found.map((member) => ({
    key: `person:${member.id}`,
    section: "people",
    kind: "person",
    id: member.id,
    label: member.displayName?.trim() || member.username,
    isViewer: member.id === viewerId,
    role: member.role,
  }));
};

/**
 * Everything the menu shows for `query`, in Notion's section order, as one list (the keyboard moves
 * through it top to bottom, across sections, as in AppFlowy's flattened sections).
 */
export const buildMentionOptions = ({
  mode,
  query: rawQuery,
  now = new Date(),
  members,
  viewerId,
  pages,
  currentPageId,
  parentTitle,
  canCreatePage,
  labels,
}: {
  mode: MentionMode;
  query: string;
  now?: Date;
  members: readonly WorkspaceMember[];
  viewerId: string | null;
  /** Recent pages with nothing typed, otherwise the search results. */
  pages: readonly MentionPageCandidate[];
  currentPageId: string | null;
  parentTitle: (parentId: string) => string;
  canCreatePage: boolean;
  labels: MentionLabels;
}): MentionOption[] => {
  const query = rawQuery.trim().toLowerCase();
  const sections = SECTIONS_FOR_MODE[mode];
  const options: MentionOption[] = [];
  for (const section of sections) {
    if (section === "date") options.push(...dateOptions(query, now, labels));
    if (section === "people") options.push(...personOptions(query, members, viewerId, mode));
    if (section === "pages") {
      const seen = new Set<string>();
      for (const page of pages) {
        if (page.id === currentPageId || seen.has(page.id) || seen.size >= MAX_PAGES) continue;
        seen.add(page.id);
        options.push({
          key: `page:${page.id}`,
          section: "pages",
          kind: "page",
          id: page.id,
          label: page.title?.trim() || labels.untitled,
          icon: page.icon,
          database: Boolean(page.databaseId),
          // Notion names the parent beside a search result.
          subtitle: query && page.parentId ? parentTitle(page.parentId) : "",
        });
      }
    }
    if (section === "newPage" && canCreatePage) {
      options.push({ key: "new:sub-page", section: "newPage", kind: "createSubPage", title: rawQuery.trim() });
    }
  }
  return options;
};

/** The options grouped for display, keeping each option's place in the flat keyboard list. */
export const groupMentionOptions = (options: readonly MentionOption[]) => {
  const groups: Array<{ section: MentionSectionKind; options: Array<{ option: MentionOption; index: number }> }> = [];
  options.forEach((option, index) => {
    const last = groups[groups.length - 1];
    if (last?.section === option.section) last.options.push({ option, index });
    else groups.push({ section: option.section, options: [{ option, index }] });
  });
  return groups;
};

/** Whether a menu with these options is worth showing: "New page" alone means nothing matched. */
export const hasMentionResults = (options: readonly MentionOption[]) => options.some((option) => option.section !== "newPage");
