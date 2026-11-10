/** Reads iCal calendars: which addresses may be fetched, and the events inside them. */

export type CalendarEvent = {
  id: string;
  title: string;
  /** An ISO instant, or `YYYY-MM-DD` for an all-day event. */
  start: string;
  end: string | null;
  allDay: boolean;
  location: string | null;
};

const ALLOWED_HOSTS: { test: (host: string) => boolean; label: string }[] = [
  { test: (host) => host === "calendar.google.com", label: "Google Calendar" },
  { test: (host) => host === "outlook.office365.com" || host === "outlook.live.com", label: "Outlook" },
  { test: (host) => host.endsWith(".icloud.com"), label: "Apple Calendar" },
];

/** The https address to fetch and its provider, or null when it isn't a supported calendar host. */
export const parseCalendarUrl = (value: string): { url: string; label: string } | null => {
  let parsed: URL;
  try {
    parsed = new URL(value.trim().replace(/^webcal:\/\//i, "https://"));
  } catch {
    return null;
  }
  if (parsed.protocol !== "https:" || parsed.username || parsed.password || (parsed.port && parsed.port !== "443")) return null;
  const allowed = ALLOWED_HOSTS.find((host) => host.test(parsed.hostname.toLowerCase()));
  return allowed ? { url: parsed.toString(), label: allowed.label } : null;
};

const MAX_FEED_BYTES = 4 * 1024 * 1024;
const MAX_REDIRECTS = 3;

/** Fetches a calendar, re-checking the host on every redirect and refusing oversized files. */
export const fetchCalendarText = async (startUrl: string, fetcher: typeof fetch = fetch) => {
  let url = startUrl;
  for (let hop = 0; hop <= MAX_REDIRECTS; hop += 1) {
    const response = await fetcher(url, { redirect: "manual", signal: AbortSignal.timeout(10_000), headers: { accept: "text/calendar" } });
    if (response.status >= 300 && response.status < 400) {
      const next = response.headers.get("location");
      const allowed = next ? parseCalendarUrl(new URL(next, url).toString()) : null;
      if (!allowed) throw new Error("The calendar redirected somewhere unexpected.");
      url = allowed.url;
      continue;
    }
    if (!response.ok || !response.body) throw new Error(`The calendar answered with status ${response.status}.`);
    const reader = response.body.getReader();
    const chunks: Uint8Array[] = [];
    let size = 0;
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > MAX_FEED_BYTES) {
        await reader.cancel();
        throw new Error("The calendar is too large.");
      }
      chunks.push(value);
    }
    const bytes = new Uint8Array(size);
    let offset = 0;
    for (const chunk of chunks) {
      bytes.set(chunk, offset);
      offset += chunk.byteLength;
    }
    return new TextDecoder().decode(bytes);
  }
  throw new Error("The calendar redirected too many times.");
};

/** Outlook publishes Windows zone names, which the runtime's time zone data doesn't know. */
const WINDOWS_ZONES: Record<string, string> = {
  "UTC": "UTC",
  "Pacific Standard Time": "America/Los_Angeles",
  "Mountain Standard Time": "America/Denver",
  "Central Standard Time": "America/Chicago",
  "Eastern Standard Time": "America/New_York",
  "GMT Standard Time": "Europe/London",
  "W. Europe Standard Time": "Europe/Berlin",
  "Romance Standard Time": "Europe/Paris",
  "Central Europe Standard Time": "Europe/Budapest",
  "E. Africa Standard Time": "Africa/Nairobi",
  "South Africa Standard Time": "Africa/Johannesburg",
  "Arab Standard Time": "Asia/Riyadh",
  "India Standard Time": "Asia/Kolkata",
  "China Standard Time": "Asia/Shanghai",
  "Tokyo Standard Time": "Asia/Tokyo",
  "AUS Eastern Standard Time": "Australia/Sydney",
};

const formatters = new Map<string, Intl.DateTimeFormat | null>();
const formatterFor = (zone: string) => {
  const cached = formatters.get(zone);
  if (cached !== undefined) return cached;
  let formatter: Intl.DateTimeFormat | null = null;
  try {
    formatter = new Intl.DateTimeFormat("en-US", {
      timeZone: WINDOWS_ZONES[zone] ?? zone,
      hourCycle: "h23",
      year: "numeric", month: "numeric", day: "numeric", hour: "numeric", minute: "numeric", second: "numeric",
    });
  } catch {
    // An unknown zone is read as UTC, which is at worst a few hours off.
  }
  formatters.set(zone, formatter);
  return formatter;
};

const zoneOffset = (instant: number, formatter: Intl.DateTimeFormat) => {
  const part: Record<string, number> = {};
  for (const { type, value } of formatter.formatToParts(instant)) part[type] = Number(value);
  return Date.UTC(part.year!, part.month! - 1, part.day!, part.hour!, part.minute!, part.second!) - Math.floor(instant / 1000) * 1000;
};

const wallToInstant = (wall: number, zone: string | null) => {
  const formatter = zone ? formatterFor(zone) : null;
  if (!formatter) return wall;
  const guess = wall - zoneOffset(wall, formatter);
  return wall - zoneOffset(guess, formatter);
};

type ParsedDate = { wall: number; zone: string | null; allDay: boolean };

const parseDate = (value: string, params: Record<string, string>): ParsedDate | null => {
  const match = /^(\d{4})(\d{2})(\d{2})(?:T(\d{2})(\d{2})(\d{2})(Z)?)?$/.exec(value.trim());
  if (!match) return null;
  const [, y, mo, d, h, mi, s, utc] = match;
  const wall = Date.UTC(Number(y), Number(mo) - 1, Number(d), Number(h ?? 0), Number(mi ?? 0), Number(s ?? 0));
  return { wall, zone: utc ? null : params.TZID?.replace(/^"|"$/g, "") ?? null, allDay: h === undefined };
};

type Property = { value: string; params: Record<string, string> };

const unescapeText = (value: string) => value.replace(/\\([\;,nN])/g, (_, character: string) => (character.toLowerCase() === "n" ? "\n" : character));

const parseLine = (line: string): [string, Property] | null => {
  let inQuotes = false;
  let colon = -1;
  for (let index = 0; index < line.length; index += 1) {
    if (line[index] === '"') inQuotes = !inQuotes;
    else if (line[index] === ":" && !inQuotes) {
      colon = index;
      break;
    }
  }
  if (colon < 1) return null;
  const [name, ...rawParams] = line.slice(0, colon).split(";");
  const params: Record<string, string> = {};
  for (const raw of rawParams) {
    const equals = raw.indexOf("=");
    if (equals > 0) params[raw.slice(0, equals).toUpperCase()] = raw.slice(equals + 1);
  }
  return [name!.toUpperCase(), { value: line.slice(colon + 1), params }];
};

const parseRule = (value: string) => {
  const rule: Record<string, string> = {};
  for (const part of value.split(";")) {
    const [key, item] = part.split("=");
    if (key && item) rule[key.toUpperCase()] = item.toUpperCase();
  }
  return rule;
};

const DAY_MS = 86_400_000;
const WEEKDAYS = ["SU", "MO", "TU", "WE", "TH", "FR", "SA"];
const MAX_STEPS = 20_000;

const monthlyDay = (year: number, month: number, spec: string) => {
  const match = /^([+-]?\d)?([A-Z]{2})$/.exec(spec);
  if (!match) return null;
  const weekday = WEEKDAYS.indexOf(match[2]!);
  if (weekday < 0) return null;
  const ordinal = Number(match[1] ?? 1);
  if (ordinal > 0) {
    const first = new Date(Date.UTC(year, month, 1)).getUTCDay();
    const day = 1 + ((weekday - first + 7) % 7) + (ordinal - 1) * 7;
    return day <= new Date(Date.UTC(year, month + 1, 0)).getUTCDate() ? day : null;
  }
  const lastDate = new Date(Date.UTC(year, month + 1, 0)).getUTCDate();
  const last = new Date(Date.UTC(year, month, lastDate)).getUTCDay();
  return lastDate - ((last - weekday + 7) % 7) + (ordinal + 1) * 7;
};

/** Every start, as wall-clock time, that a recurring event has up to `until`. */
const occurrences = (start: number, ruleText: string, until: number) => {
  const rule = parseRule(ruleText);
  const frequency = rule.FREQ;
  const interval = Math.max(1, Number(rule.INTERVAL ?? 1) || 1);
  const limit = rule.COUNT ? Number(rule.COUNT) : Number.POSITIVE_INFINITY;
  const parsedUntil = rule.UNTIL ? parseDate(rule.UNTIL, {}) : null;
  const end = Math.min(until, parsedUntil ? parsedUntil.wall + (parsedUntil.allDay ? DAY_MS - 1 : 0) : Number.POSITIVE_INFINITY);
  const byDay = rule.BYDAY?.split(",") ?? [];
  const startDate = new Date(start);
  const time = start - Date.UTC(startDate.getUTCFullYear(), startDate.getUTCMonth(), startDate.getUTCDate());
  const results: number[] = [];
  const accept = (value: number) => {
    if (value < start || value > end || results.length >= limit) return false;
    results.push(value);
    return true;
  };

  for (let step = 0; step < MAX_STEPS && results.length < limit; step += 1) {
    let period: number;
    if (frequency === "DAILY") {
      period = start + step * interval * DAY_MS;
      if (period > end) break;
      accept(period);
    } else if (frequency === "WEEKLY") {
      const sunday = start - startDate.getUTCDay() * DAY_MS + step * interval * 7 * DAY_MS;
      if (sunday > end) break;
      const days = byDay.length ? byDay.map((day) => WEEKDAYS.indexOf(day.slice(-2))).filter((day) => day >= 0).sort((a, b) => a - b) : [startDate.getUTCDay()];
      for (const day of days) accept(sunday + day * DAY_MS);
    } else if (frequency === "MONTHLY" || frequency === "YEARLY") {
      const months = startDate.getUTCFullYear() * 12 + startDate.getUTCMonth() + step * interval * (frequency === "YEARLY" ? 12 : 1);
      const year = Math.floor(months / 12);
      const month = months % 12;
      period = Date.UTC(year, month, 1);
      if (period > end) break;
      const days = byDay.length ? byDay.map((day) => monthlyDay(year, month, day)) : [startDate.getUTCDate()];
      for (const day of days) {
        if (day && day <= new Date(Date.UTC(year, month + 1, 0)).getUTCDate()) accept(Date.UTC(year, month, day) + time);
      }
    } else {
      break;
    }
  }
  return results.sort((a, b) => a - b);
};

const toStamp = (wall: number, zone: string | null, allDay: boolean) =>
  allDay ? new Date(wall).toISOString().slice(0, 10) : new Date(wallToInstant(wall, zone)).toISOString();

/** The events of a calendar between two instants, soonest first. */
export const parseCalendarEvents = (text: string, window: { from: number; to: number }, limit = 200): CalendarEvent[] => {
  const lines = text.replace(/\r?\n[ \t]/g, "").split(/\r?\n/);
  const events: Map<string, Property[]>[] = [];
  let current: Map<string, Property[]> | null = null;
  let depth = 0;
  for (const line of lines) {
    if (line === "BEGIN:VEVENT") {
      current = new Map();
      depth = 0;
    } else if (line === "END:VEVENT") {
      if (current) events.push(current);
      current = null;
    } else if (current) {
      // Alarms nest inside an event and have their own fields.
      if (line.startsWith("BEGIN:")) depth += 1;
      else if (line.startsWith("END:")) depth -= 1;
      else if (depth === 0) {
        const parsed = parseLine(line);
        if (parsed) current.set(parsed[0], [...(current.get(parsed[0]) ?? []), parsed[1]]);
      }
    }
  }

  const replaced = new Set<string>();
  for (const event of events) {
    const uid = event.get("UID")?.[0]?.value;
    const recurrence = event.get("RECURRENCE-ID")?.[0];
    const parsed = recurrence ? parseDate(recurrence.value, recurrence.params) : null;
    if (uid && parsed) replaced.add(`${uid}|${wallToInstant(parsed.wall, parsed.zone)}`);
  }

  const results: CalendarEvent[] = [];
  for (const event of events) {
    const startProperty = event.get("DTSTART")?.[0];
    const start = startProperty ? parseDate(startProperty.value, startProperty.params) : null;
    if (!start || event.get("STATUS")?.[0]?.value.toUpperCase() === "CANCELLED") continue;
    const endProperty = event.get("DTEND")?.[0];
    const end = endProperty ? parseDate(endProperty.value, endProperty.params) : null;
    const duration = end ? end.wall - start.wall : 0;
    const uid = event.get("UID")?.[0]?.value ?? `${start.wall}`;
    const title = unescapeText(event.get("SUMMARY")?.[0]?.value ?? "").trim() || "Untitled event";
    const location = unescapeText(event.get("LOCATION")?.[0]?.value ?? "").trim() || null;
    const isOverride = event.has("RECURRENCE-ID");
    const rule = isOverride ? undefined : event.get("RRULE")?.[0]?.value;

    const excluded = new Set<number>();
    for (const property of event.get("EXDATE") ?? []) {
      for (const value of property.value.split(",")) {
        const parsed = parseDate(value, property.params);
        if (parsed) excluded.add(wallToInstant(parsed.wall, parsed.zone));
      }
    }

    // The window is padded by a day so wall-clock arithmetic can't drop an event near its edge.
    const starts = rule ? occurrences(start.wall, rule, window.to + DAY_MS) : [start.wall];
    for (const wall of starts) {
      const instant = wallToInstant(wall, start.zone);
      const finish = wallToInstant(wall + duration, start.zone);
      if (excluded.has(instant) || (rule && replaced.has(`${uid}|${instant}`))) continue;
      if (Math.max(instant, finish) < window.from || instant > window.to) continue;
      results.push({
        id: `${uid}:${instant}`,
        title,
        start: toStamp(wall, start.zone, start.allDay),
        end: duration > 0 ? toStamp(wall + duration, start.zone, start.allDay) : null,
        allDay: start.allDay,
        location,
      });
    }
  }
  return results.sort((a, b) => a.start.localeCompare(b.start)).slice(0, limit);
};
