import { describe, expect, test } from "bun:test";
import { defaultSchedule, nextScheduleRun, presetOfSchedule, ScheduleSchema, zonedTimeToUtc } from "./automation-schedule";

const base = { interval: 1, time: "09:00", timezone: "UTC", startDate: "2026-11-11", end: { kind: "never" } };
const after = (schedule, iso, runs = 0) => nextScheduleRun(ScheduleSchema.parse(schedule), new Date(iso), runs)?.toISOString() ?? null;

describe("repeating schedules", () => {
  test("every day runs at its time, starting on its start date", () => {
    expect(after({ ...base, unit: "day", startDate: "2026-11-13" }, "2026-11-11T12:00:00Z")).toBe("2026-11-13T09:00:00.000Z");
    expect(after({ ...base, unit: "day" }, "2026-11-11T08:00:00Z")).toBe("2026-11-11T09:00:00.000Z");
  });

  test("every weekday skips the weekend", () => {
    expect(after({ ...base, unit: "weekday" }, "2026-11-13T10:00:00Z")).toBe("2026-11-16T09:00:00.000Z");
  });

  test("every week on chosen days, and every 2 weeks counted from the start week", () => {
    expect(after({ ...base, unit: "week", weekdays: [1, 3] }, "2026-11-11T10:00:00Z")).toBe("2026-11-16T09:00:00.000Z");
    const fortnightly = { ...base, unit: "week", interval: 2, weekdays: [1] };
    expect(after(fortnightly, "2026-11-11T10:00:00Z")).toBe("2026-11-23T09:00:00.000Z");
    expect(after(fortnightly, "2026-11-23T10:00:00Z")).toBe("2026-12-07T09:00:00.000Z");
  });

  test("every month on the start day, every 3 months, and the last day for the 31st", () => {
    expect(after({ ...base, unit: "month", startDate: "2026-11-15" }, "2026-11-20T00:00:00Z")).toBe("2026-12-15T09:00:00.000Z");
    expect(after({ ...base, unit: "month", interval: 3, startDate: "2026-11-15" }, "2026-11-20T00:00:00Z")).toBe("2027-02-15T09:00:00.000Z");
    expect(after({ ...base, unit: "month", startDate: "2026-01-31" }, "2026-02-01T00:00:00Z")).toBe("2026-02-28T09:00:00.000Z");
  });

  test("every year on the start date", () => {
    expect(after({ ...base, unit: "year", startDate: "2026-03-01" }, "2026-11-11T00:00:00Z")).toBe("2027-03-01T09:00:00.000Z");
  });

  test("time zones, including a daylight-saving change", () => {
    const ny = { ...base, unit: "day", timezone: "America/New_York", startDate: "2026-10-01" };
    expect(after(ny, "2026-10-31T12:00:00Z")).toBe("2026-10-31T13:00:00.000Z");
    expect(after(ny, "2026-11-01T14:00:00Z")).toBe("2026-11-02T14:00:00.000Z");
    expect(zonedTimeToUtc("2026-07-01", "09:00", "Europe/London").toISOString()).toBe("2026-07-01T08:00:00.000Z");
  });

  test("\"Around midnight\" runs at the start of the day", () => {
    expect(after({ ...base, unit: "day", time: null }, "2026-11-11T12:00:00Z")).toBe("2026-11-12T00:00:00.000Z");
  });

  test("ending after a number of runs, or on a date", () => {
    expect(after({ ...base, unit: "day", end: { kind: "runs", count: 3 } }, "2026-11-11T12:00:00Z", 3)).toBeNull();
    expect(after({ ...base, unit: "day", end: { kind: "runs", count: 3 } }, "2026-11-11T12:00:00Z", 2)).toBe("2026-11-12T09:00:00.000Z");
    expect(after({ ...base, unit: "day", end: { kind: "date", date: "2026-11-12" } }, "2026-11-12T10:00:00Z")).toBeNull();
  });

  test("a new schedule starts tomorrow, on tomorrow's weekday, and maps back to its menu choice", () => {
    const schedule = defaultSchedule("week", 2, new Date("2026-11-11T12:00:00Z"), "UTC");
    expect(schedule).toMatchObject({ startDate: "2026-11-12", weekdays: [4], time: null });
    expect(presetOfSchedule(schedule)).toBe("2_weeks");
    expect(presetOfSchedule({ unit: "month", interval: 2 })).toBeNull();
  });

  test("bad schedules are refused", () => {
    expect(ScheduleSchema.safeParse({ ...base, unit: "day", timezone: "Mars/Olympus" }).success).toBe(false);
    expect(ScheduleSchema.safeParse({ ...base, unit: "day", time: "25:00" }).success).toBe(false);
  });
});
