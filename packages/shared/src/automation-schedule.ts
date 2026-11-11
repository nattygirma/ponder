import { Cron } from "croner";
import { z } from "zod";

/** Schedules for Notion's "Every {frequency}" automations and "Duplicate every…" templates. */

export const SCHEDULE_UNITS = ["day", "weekday", "week", "month", "year"] as const;
export type ScheduleUnit = (typeof SCHEDULE_UNITS)[number];

const DATE_ONLY = /^\d{4}-\d{2}-\d{2}$/;
export const TIME_OF_DAY = /^([01]\d|2[0-3]):([0-5]\d)$/;

export const isValidTimeZone = (zone: string) => {
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: zone });
    return true;
  } catch {
    return false;
  }
};

export const ScheduleSchema = z.object({
  unit: z.enum(SCHEDULE_UNITS),
  /** Every N days, weeks, months or years. Ignored for weekdays. */
  interval: z.number().int().min(1).max(365),
  /** Week schedules: which days, 0 = Sunday … 6 = Saturday. */
  weekdays: z.array(z.number().int().min(0).max(6)).max(7).optional(),
  /** "HH:MM" in the schedule's time zone, or null for Notion's "Around midnight". */
  time: z.string().regex(TIME_OF_DAY).nullable(),
  timezone: z.string().min(1).max(80).refine(isValidTimeZone, "Unknown time zone"),
  /** The first day it may run, "YYYY-MM-DD" in the time zone. */
  startDate: z.string().regex(DATE_ONLY),
  end: z.discriminatedUnion("kind", [
    z.object({ kind: z.literal("never") }),
    z.object({ kind: z.literal("runs"), count: z.number().int().min(1).max(10_000) }),
    z.object({ kind: z.literal("date"), date: z.string().regex(DATE_ONLY) }),
  ]),
});
export type Schedule = z.infer<typeof ScheduleSchema>;

/** The choices in Notion's "Duplicate every…" menu. */
export const SCHEDULE_PRESETS = [
  { id: "day", unit: "day", interval: 1 },
  { id: "weekday", unit: "weekday", interval: 1 },
  { id: "week", unit: "week", interval: 1 },
  { id: "2_weeks", unit: "week", interval: 2 },
  { id: "month", unit: "month", interval: 1 },
  { id: "3_months", unit: "month", interval: 3 },
  { id: "6_months", unit: "month", interval: 6 },
  { id: "year", unit: "year", interval: 1 },
] as const satisfies readonly { id: string; unit: ScheduleUnit; interval: number }[];
export type SchedulePresetId = (typeof SCHEDULE_PRESETS)[number]["id"];

export const presetOfSchedule = (schedule: Pick<Schedule, "unit" | "interval">): SchedulePresetId | null =>
  SCHEDULE_PRESETS.find((preset) => preset.unit === schedule.unit && (preset.unit === "weekday" || preset.interval === schedule.interval))?.id ?? null;

/** The date parts of an instant as seen in a time zone. */
export const zonedParts = (instant: Date, timeZone: string) => {
  const parts = Object.fromEntries(
    new Intl.DateTimeFormat("en-US", {
      timeZone, hourCycle: "h23", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", weekday: "short",
    }).formatToParts(instant).map((part) => [part.type, part.value]),
  );
  return {
    year: Number(parts.year),
    month: Number(parts.month),
    day: Number(parts.day),
    hour: Number(parts.hour),
    minute: Number(parts.minute),
    weekday: ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"].indexOf(parts.weekday ?? ""),
  };
};

export const zonedDateKey = (instant: Date, timeZone: string) => {
  const { year, month, day } = zonedParts(instant, timeZone);
  return `${String(year).padStart(4, "0")}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
};

/** The instant a calendar date and time of day happen in a time zone. */
export const zonedTimeToUtc = (date: string, time: string, timeZone: string): Date => {
  const [year, month, day] = date.split("-").map(Number);
  const [hour, minute] = time.split(":").map(Number);
  const wanted = Date.UTC(year!, month! - 1, day!, hour!, minute!);
  let guess = wanted;
  // Two corrections settle it, daylight saving included.
  for (let step = 0; step < 2; step += 1) {
    const seen = zonedParts(new Date(guess), timeZone);
    const seenUtc = Date.UTC(seen.year, seen.month - 1, seen.day, seen.hour, seen.minute);
    guess += wanted - seenUtc;
  }
  return new Date(guess);
};

/** Whole days from one "YYYY-MM-DD" to another, ignoring time zones (both are calendar dates already). */
const daysBetween = (from: string, to: string) => Math.round((Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / 86_400_000);

/** Monday on or before a calendar date, so weeks count the way people do. */
const weekStart = (date: string) => {
  const day = new Date(`${date}T00:00:00Z`).getUTCDay();
  return new Date(Date.parse(`${date}T00:00:00Z`) - ((day + 6) % 7) * 86_400_000).toISOString().slice(0, 10);
};

const cronFor = (schedule: Schedule) => {
  const [hour, minute] = (schedule.time ?? "00:00").split(":").map(Number);
  const [, startMonth, startDay] = schedule.startDate.split("-").map(Number);
  switch (schedule.unit) {
    case "day": return `${minute} ${hour} * * *`;
    case "weekday": return `${minute} ${hour} * * 1-5`;
    case "week": {
      const days = [...new Set(schedule.weekdays ?? [])].sort();
      return `${minute} ${hour} * * ${days.length > 0 ? days.join(",") : new Date(`${schedule.startDate}T00:00:00Z`).getUTCDay()}`;
    }
    // A month's run is on the start date's day; months that are too short run on their last day, as Notion does.
    case "month": return `${minute} ${hour} ${startDay! > 28 ? "L" : startDay} * *`;
    case "year": return `${minute} ${hour} ${startDay} ${startMonth} *`;
  }
};

/** Whether a calendar date is on the schedule's every-N rhythm, counted from its start date. */
const onRhythm = (schedule: Schedule, date: string) => {
  if (schedule.interval <= 1 || schedule.unit === "weekday") return true;
  const [startYear, startMonth] = schedule.startDate.split("-").map(Number);
  const [year, month] = date.split("-").map(Number);
  switch (schedule.unit) {
    case "day": return daysBetween(schedule.startDate, date) % schedule.interval === 0;
    case "week": return (daysBetween(weekStart(schedule.startDate), weekStart(date)) / 7) % schedule.interval === 0;
    case "month": return ((year! - startYear!) * 12 + (month! - startMonth!)) % schedule.interval === 0;
    case "year": return (year! - startYear!) % schedule.interval === 0;
  }
};

/**
 * The first time after `after` that the schedule runs, or null when it has ended.
 * `runsSoFar` counts runs already made, for "Ending: Number of runs".
 */
export const nextScheduleRun = (schedule: Schedule, after: Date, runsSoFar = 0): Date | null => {
  if (schedule.end.kind === "runs" && runsSoFar >= schedule.end.count) return null;
  const cron = new Cron(cronFor(schedule), { timezone: schedule.timezone, paused: true });
  let cursor = after;
  // A daily schedule finds its next run at once; this bound covers every-N-years rhythms and leap days.
  for (let step = 0; step < 800; step += 1) {
    const next = cron.nextRun(cursor);
    if (!next) return null;
    const date = zonedDateKey(next, schedule.timezone);
    if (schedule.end.kind === "date" && date > schedule.end.date) return null;
    if (date >= schedule.startDate && onRhythm(schedule, date)) return next;
    cursor = next;
  }
  return null;
};

export const defaultSchedule = (unit: ScheduleUnit, interval: number, now: Date, timeZone: string): Schedule => {
  // Notion starts a new schedule tomorrow.
  const tomorrow = zonedDateKey(new Date(now.getTime() + 86_400_000), timeZone);
  const weekday = new Date(`${tomorrow}T00:00:00Z`).getUTCDay();
  return {
    unit,
    interval,
    ...(unit === "week" ? { weekdays: [weekday] } : {}),
    time: null,
    timezone: timeZone,
    startDate: tomorrow,
    end: { kind: "never" },
  };
};

