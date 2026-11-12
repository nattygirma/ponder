/*
 * Adapted from AppFlowy-Web (https://github.com/AppFlowy-IO/AppFlowy-Web), Copyright AppFlowy, AGPL-3.0.
 * Source: src/components/editor/components/leaf/mention/reminder-options.ts (the option list and the
 * time-based filter). Labels follow Notion's Remind menu; the fire-time rule is Ponder's.
 */

/** Notion's Remind options. Date-only reminders fire at 9:00 AM; timed ones relative to the time. */
export const REMINDER_OPTIONS = [
  { name: "none", label: "None", requiresTime: false, dateOnly: false },
  { name: "atTimeOfEvent", label: "At time of event", requiresTime: true, dateOnly: false },
  { name: "fiveMinsBefore", label: "5 minutes before", requiresTime: true, dateOnly: false },
  { name: "tenMinsBefore", label: "10 minutes before", requiresTime: true, dateOnly: false },
  { name: "fifteenMinsBefore", label: "15 minutes before", requiresTime: true, dateOnly: false },
  { name: "thirtyMinsBefore", label: "30 minutes before", requiresTime: true, dateOnly: false },
  { name: "oneHourBefore", label: "1 hour before", requiresTime: true, dateOnly: false },
  { name: "twoHoursBefore", label: "2 hours before", requiresTime: true, dateOnly: false },
  { name: "onDayOfEvent", label: "On day of event (9:00 AM)", requiresTime: false, dateOnly: true },
  { name: "oneDayBefore", label: "1 day before (9:00 AM)", requiresTime: false, dateOnly: false },
  { name: "twoDaysBefore", label: "2 days before (9:00 AM)", requiresTime: false, dateOnly: false },
  { name: "oneWeekBefore", label: "1 week before (9:00 AM)", requiresTime: false, dateOnly: false },
] as const;

export type ReminderOptionName = (typeof REMINDER_OPTIONS)[number]["name"];

const OPTION_NAMES = new Set<string>(REMINDER_OPTIONS.map((option) => option.name));

export const isReminderOption = (value: unknown): value is ReminderOptionName =>
  typeof value === "string" && OPTION_NAMES.has(value);

export function getReminderLabel(name: string): string {
  return REMINDER_OPTIONS.find((option) => option.name === name)?.label ?? "None";
}

/**
 * The options Notion lists for a date: with a time, the "before" times and the day ones;
 * without, only the day ones ("On day of event" is for dates without a time).
 */
export function getFilteredReminderOptions(includeTime: boolean) {
  return REMINDER_OPTIONS.filter((option) => includeTime ? !option.dateOnly : !option.requiresTime);
}

/** The reminder Notion sets for "Remind me": 9:00 AM on the day, or at the time when there is one. */
export const defaultReminderOption = (includeTime: boolean): ReminderOptionName =>
  includeTime ? "atTimeOfEvent" : "onDayOfEvent";

const MINUTES_BEFORE: Partial<Record<ReminderOptionName, number>> = {
  atTimeOfEvent: 0,
  fiveMinsBefore: 5,
  tenMinsBefore: 10,
  fifteenMinsBefore: 15,
  thirtyMinsBefore: 30,
  oneHourBefore: 60,
  twoHoursBefore: 120,
};

const DAYS_BEFORE: Partial<Record<ReminderOptionName, number>> = {
  onDayOfEvent: 0,
  oneDayBefore: 1,
  twoDaysBefore: 2,
  oneWeekBefore: 7,
};

/** A mention's date as a Date in the viewer's time zone: "YYYY-MM-DD" is local midnight. */
export const parseMentionDate = (value: string): Date | null => {
  const dateOnly = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  if (dateOnly) {
    const date = new Date(Number(dateOnly[1]), Number(dateOnly[2]) - 1, Number(dateOnly[3]));
    return Number.isNaN(date.getTime()) ? null : date;
  }
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
};

/**
 * When a reminder fires, worked out where the reminder was set (the person's own time zone),
 * so the server only has to compare instants. Null for "none" or a date it can't read.
 */
export const reminderFireTime = (date: string, includeTime: boolean, option: string): Date | null => {
  if (!isReminderOption(option) || option === "none") return null;
  const start = parseMentionDate(date);
  if (!start) return null;
  const minutes = MINUTES_BEFORE[option];
  if (minutes !== undefined) {
    if (!includeTime) return null;
    return new Date(start.getTime() - minutes * 60_000);
  }
  const days = DAYS_BEFORE[option];
  if (days === undefined) return null;
  const fire = new Date(start.getFullYear(), start.getMonth(), start.getDate() - days, 9, 0, 0, 0);
  return fire;
};
