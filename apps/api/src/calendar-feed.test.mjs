import { describe, expect, test } from "bun:test";
import { fetchCalendarText, parseCalendarEvents, parseCalendarUrl } from "./calendar-feed";

const window = { from: Date.UTC(2026, 10, 1), to: Date.UTC(2026, 11, 31) };
const feed = (...events) => ["BEGIN:VCALENDAR", ...events.flatMap((event) => ["BEGIN:VEVENT", ...event, "END:VEVENT"]), "END:VCALENDAR"].join("\r\n");

describe("calendar addresses", () => {
  test("accepts the three providers and turns webcal into https", () => {
    expect(parseCalendarUrl("https://calendar.google.com/calendar/ical/a/private-b/basic.ics")?.label).toBe("Google Calendar");
    expect(parseCalendarUrl("webcal://p12-caldav.icloud.com/published/2/abc")).toEqual({ url: "https://p12-caldav.icloud.com/published/2/abc", label: "Apple Calendar" });
    expect(parseCalendarUrl("https://outlook.office365.com/owa/calendar/a/b/calendar.ics")?.label).toBe("Outlook");
  });
  test("refuses anything else", () => {
    for (const url of ["http://calendar.google.com/a", "https://evil.example/a.ics", "https://calendar.google.com.evil.example/a", "https://user:pw@calendar.google.com/a", "https://localhost/a", "https://calendar.google.com:8443/a", "nonsense"]) {
      expect(parseCalendarUrl(url)).toBeNull();
    }
  });
  test("a redirect to another host is refused", async () => {
    const fetcher = async () => new Response(null, { status: 302, headers: { location: "https://169.254.169.254/latest" } });
    await expect(fetchCalendarText("https://calendar.google.com/a", fetcher)).rejects.toThrow("redirected");
  });
  test("an oversized calendar is refused", async () => {
    const fetcher = async () => new Response(new Uint8Array(5 * 1024 * 1024));
    await expect(fetchCalendarText("https://calendar.google.com/a", fetcher)).rejects.toThrow("too large");
  });
});

describe("calendar events", () => {
  test("reads a timed event, folded lines and escapes", () => {
    const [event] = parseCalendarEvents(["BEGIN:VEVENT", "UID:1", "DTSTART:20261110T150000Z", "DTEND:20261110T160000Z", "SUMMARY:Team\\, sync wi", " th Alex", "LOCATION:Room 1", "END:VEVENT"].join("\r\n"), window);
    expect(event).toMatchObject({ title: "Team, sync with Alex", start: "2026-11-10T15:00:00.000Z", end: "2026-11-10T16:00:00.000Z", allDay: false, location: "Room 1" });
  });
  test("keeps an all-day event as a date", () => {
    const [event] = parseCalendarEvents(feed(["UID:2", "DTSTART;VALUE=DATE:20261112", "DTEND;VALUE=DATE:20261113", "SUMMARY:Holiday"]), window);
    expect(event).toMatchObject({ start: "2026-11-12", allDay: true });
  });
  test("converts a named zone, including Outlook's Windows names", () => {
    const iana = parseCalendarEvents(feed(["UID:3", "DTSTART;TZID=America/New_York:20261110T090000", "SUMMARY:a"]), window);
    const windows = parseCalendarEvents(feed(["UID:4", "DTSTART;TZID=\"Eastern Standard Time\":20261110T090000", "SUMMARY:b"]), window);
    expect(iana[0].start).toBe("2026-11-10T14:00:00.000Z");
    expect(windows[0].start).toBe("2026-11-10T14:00:00.000Z");
  });
  test("a weekly event keeps its local time across a clock change", () => {
    const events = parseCalendarEvents(feed(["UID:5", "DTSTART;TZID=America/New_York:20261026T090000", "RRULE:FREQ=WEEKLY;BYDAY=MO;COUNT=3", "SUMMARY:Standup"]), { from: Date.UTC(2026, 9, 1), to: Date.UTC(2026, 11, 1) });
    expect(events.map((event) => event.start)).toEqual(["2026-10-26T13:00:00.000Z", "2026-11-02T14:00:00.000Z", "2026-11-09T14:00:00.000Z"]);
  });
  test("honours until, excluded dates, moved instances and cancellations", () => {
    const events = parseCalendarEvents(feed(
      ["UID:6", "DTSTART:20261102T100000Z", "RRULE:FREQ=DAILY;UNTIL=20261105T100000Z", "EXDATE:20261103T100000Z", "SUMMARY:Daily"],
      ["UID:6", "RECURRENCE-ID:20261104T100000Z", "DTSTART:20261104T120000Z", "SUMMARY:Moved"],
      ["UID:7", "DTSTART:20261106T100000Z", "STATUS:CANCELLED", "SUMMARY:Gone"],
    ), window);
    expect(events.map((event) => [event.title, event.start])).toEqual([
      ["Daily", "2026-11-02T10:00:00.000Z"],
      ["Moved", "2026-11-04T12:00:00.000Z"],
      ["Daily", "2026-11-05T10:00:00.000Z"],
    ]);
  });
  test("handles the last weekday of a month", () => {
    const events = parseCalendarEvents(feed(["UID:8", "DTSTART:20261030T100000Z", "RRULE:FREQ=MONTHLY;BYDAY=-1FR", "SUMMARY:Review"]), window);
    expect(events.slice(0, 2).map((event) => event.start)).toEqual(["2026-11-27T10:00:00.000Z", "2026-12-25T10:00:00.000Z"]);
  });
  test("an alarm's fields don't replace the event's", () => {
    const [event] = parseCalendarEvents(feed(["UID:9", "DTSTART:20261110T100000Z", "SUMMARY:Real", "BEGIN:VALARM", "SUMMARY:Alarm", "END:VALARM"]), window);
    expect(event.title).toBe("Real");
  });
});
