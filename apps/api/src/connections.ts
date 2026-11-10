import { parseConnectedLink, type ConnectedLink, type LinkPreviewData } from "@ponder/shared/connected-links";
import type { AppContext, HostConnection } from "./api-context";
import { AppError } from "./app-error";
import type { CalendarEvent } from "./calendar-feed";

// The host keeps the provider's tokens. An outbound request naming a connection gets that
// account's token added on the way out, so nothing here ever holds one.
const CONNECTION_HEADER = "x-altstack-connection";
const MAX_ACCOUNTS = 3;
const MAX_SUBTITLE = 200;

const GITHUB_HEADERS = { accept: "application/vnd.github+json", "user-agent": "Ponder" };

const DRIVE_TYPES: Record<string, string> = {
  "application/vnd.google-apps.document": "Google Doc",
  "application/vnd.google-apps.spreadsheet": "Google Sheet",
  "application/vnd.google-apps.presentation": "Google Slides",
  "application/vnd.google-apps.form": "Google Form",
  "application/vnd.google-apps.folder": "Folder",
  "application/pdf": "PDF",
};

type Json = Record<string, any>;

const oneLine = (value: unknown, max = MAX_SUBTITLE) => String(value ?? "").replace(/\s+/g, " ").trim().slice(0, max);

const callProvider = (connectionId: string, url: string, init: RequestInit = {}) => {
  const headers = new Headers(init.headers);
  headers.set(CONNECTION_HEADER, connectionId);
  return fetch(url, { ...init, headers });
};

const readJson = async (response: Response): Promise<Json | null> => {
  if (!response.ok) return null;
  try {
    return await response.json() as Json;
  } catch {
    return null;
  }
};

/**
 * A connection belongs to the whole deployment, not to whoever is signed in, so an account's
 * data is only ever read for the instance owner. Other members get nothing from here.
 */
export const canUseConnections = (c: AppContext) => {
  const auth = c.get("auth");
  return auth?.kind === "user" && auth.role === "owner";
};

export const listAccounts = async (c: AppContext, provider?: string): Promise<HostConnection[]> => {
  if (!canUseConnections(c) || !c.env.listConnections) return [];
  return c.env.listConnections(provider);
};

const activeAccounts = async (c: AppContext, provider: string) =>
  (await listAccounts(c, provider)).filter((account) => account.status === "active").slice(0, MAX_ACCOUNTS);

// ---- Google Calendar ----

const googleTime = (value: Json | undefined) => {
  if (value?.date) return { time: String(value.date), allDay: true };
  const parsed = value?.dateTime ? new Date(String(value.dateTime)) : null;
  return parsed && !Number.isNaN(parsed.getTime()) ? { time: parsed.toISOString(), allDay: false } : null;
};

const loadGoogleEvents = async (connectionId: string, from: number, to: number): Promise<CalendarEvent[]> => {
  const query = new URLSearchParams({
    timeMin: new Date(from).toISOString(),
    timeMax: new Date(to).toISOString(),
    singleEvents: "true",
    orderBy: "startTime",
    maxResults: "100",
  });
  const data = await readJson(await callProvider(connectionId, `https://www.googleapis.com/calendar/v3/calendars/primary/events?${query}`));
  if (!data) throw new Error("calendar request failed");
  const events: CalendarEvent[] = [];
  for (const item of Array.isArray(data.items) ? data.items as Json[] : []) {
    const start = googleTime(item.start);
    if (!start || item.status === "cancelled") continue;
    events.push({
      id: `gcal_${String(item.id)}`,
      title: oneLine(item.summary, 300) || "Untitled event",
      start: start.time,
      end: googleTime(item.end)?.time ?? null,
      allDay: start.allDay,
      location: item.location ? oneLine(item.location, 300) : null,
    });
  }
  return events;
};

const outlookTime = (value: Json | undefined, allDay: boolean) => {
  const raw = String(value?.dateTime ?? "");
  if (!raw) return null;
  if (allDay) return raw.slice(0, 10);
  // Asked for in UTC, Microsoft sends seven fractional digits and no zone marker.
  const parsed = new Date(`${raw.replace(/\.\d+/, "").replace(/Z$/i, "")}Z`);
  return Number.isNaN(parsed.getTime()) ? null : parsed.toISOString();
};

const loadOutlookEvents = async (connectionId: string, from: number, to: number): Promise<CalendarEvent[]> => {
  const query = new URLSearchParams({
    startDateTime: new Date(from).toISOString(),
    endDateTime: new Date(to).toISOString(),
    $orderby: "start/dateTime",
    $top: "100",
    $select: "id,subject,start,end,isAllDay,isCancelled,location",
  });
  const data = await readJson(await callProvider(connectionId, `https://graph.microsoft.com/v1.0/me/calendarView?${query}`, {
    headers: { prefer: 'outlook.timezone="UTC"' },
  }));
  if (!data) throw new Error("calendar request failed");
  const events: CalendarEvent[] = [];
  for (const item of Array.isArray(data.value) ? data.value as Json[] : []) {
    const allDay = item.isAllDay === true;
    const start = outlookTime(item.start, allDay);
    if (!start || item.isCancelled === true) continue;
    events.push({
      id: `outlook_${String(item.id)}`,
      title: oneLine(item.subject, 300) || "Untitled event",
      start,
      end: outlookTime(item.end, allDay),
      allDay,
      location: item.location?.displayName ? oneLine(item.location.displayName, 300) : null,
    });
  }
  return events;
};

const CALENDAR_APPS = [
  { provider: "google", label: "Google Calendar", service: "Google", load: loadGoogleEvents },
  { provider: "microsoft", label: "Outlook Calendar", service: "Microsoft", load: loadOutlookEvents },
];

export type ConnectedCalendar = { id: string; label: string; lastError: string | null; connected: true; events: CalendarEvent[] };

/** Every connected account's main calendar. A failing account reports its error and leaves the others alone. */
export const loadConnectedCalendars = async (c: AppContext, from: number, to: number): Promise<ConnectedCalendar[]> => {
  const accounts = await listAccounts(c);
  const calendars = CALENDAR_APPS.flatMap((app) =>
    accounts.filter((account) => account.provider === app.provider).slice(0, MAX_ACCOUNTS).map((account) => ({ app, account })));
  return Promise.all(calendars.map(async ({ app, account }) => {
    const base = { id: `connection:${account.id}`, label: `${app.label} (${account.name})`, connected: true as const };
    if (account.status !== "active") return { ...base, lastError: `Log in to ${app.service} again to see these events.`, events: [] };
    try {
      return { ...base, lastError: null, events: await app.load(account.id, from, to) };
    } catch {
      return { ...base, lastError: "This calendar could not be read.", events: [] };
    }
  }));
};

// ---- Link previews ----

const previewGitHub = async (connectionId: string, link: Extract<ConnectedLink, { provider: "github" }>): Promise<LinkPreviewData | null> => {
  const repo = `${encodeURIComponent(link.owner)}/${encodeURIComponent(link.repo)}`;
  if (link.kind === "repo") {
    const data = await readJson(await callProvider(connectionId, `https://api.github.com/repos/${repo}`, { headers: GITHUB_HEADERS }));
    return data ? { url: link.url, provider: "github", title: oneLine(data.full_name), subtitle: oneLine(data.description) } : null;
  }
  const data = await readJson(await callProvider(connectionId, `https://api.github.com/repos/${repo}/issues/${link.number}`, { headers: GITHUB_HEADERS }));
  if (!data) return null;
  const state = data.pull_request?.merged_at ? "Merged" : data.state === "closed" ? "Closed" : "Open";
  return {
    url: link.url,
    provider: "github",
    title: `${oneLine(data.title)} #${link.number}`,
    subtitle: [`${link.owner}/${link.repo}`, state, data.user?.login].filter(Boolean).join(" · "),
  };
};

const slackText = (text: unknown) =>
  oneLine(String(text ?? "").replace(/<[^|>]+\|([^>]+)>/g, "$1").replace(/<(https?:[^>]+)>/g, "$1").replace(/<[@#!][^>]*>/g, "@…"));

const previewSlack = async (connectionId: string, link: Extract<ConnectedLink, { provider: "slack" }>): Promise<LinkPreviewData | null> => {
  const message = new URLSearchParams({ channel: link.channel, oldest: link.ts, latest: link.ts, inclusive: "true", limit: "1" });
  if (link.threadTs) message.set("ts", link.threadTs);
  const method = link.threadTs ? "conversations.replies" : "conversations.history";
  const [history, info] = await Promise.all([
    callProvider(connectionId, `https://slack.com/api/${method}?${message}`).then(readJson),
    callProvider(connectionId, `https://slack.com/api/conversations.info?${new URLSearchParams({ channel: link.channel })}`).then(readJson),
  ]);
  if (!history?.ok || !Array.isArray(history.messages)) return null;
  // A thread's first message can come back alongside the one that was linked.
  const found = (history.messages as Json[]).find((item) => item.ts === link.ts) ?? history.messages[0];
  if (!found) return null;
  const channel = info?.ok ? oneLine(info.channel?.name) : "";
  return { url: link.url, provider: "slack", title: channel ? `#${channel}` : "Slack message", subtitle: slackText(found.text) };
};

const previewDrive = async (connectionId: string, link: Extract<ConnectedLink, { provider: "drive" }>): Promise<LinkPreviewData | null> => {
  const query = new URLSearchParams({ fields: "name,mimeType,modifiedTime", supportsAllDrives: "true" });
  const data = await readJson(await callProvider(connectionId, `https://www.googleapis.com/drive/v3/files/${encodeURIComponent(link.fileId)}?${query}`));
  if (!data) return null;
  return { url: link.url, provider: "drive", title: oneLine(data.name), subtitle: DRIVE_TYPES[String(data.mimeType)] ?? "File" };
};

const previewWith = (connectionId: string, link: ConnectedLink) => {
  if (link.provider === "github") return previewGitHub(connectionId, link);
  if (link.provider === "slack") return previewSlack(connectionId, link);
  return previewDrive(connectionId, link);
};

/** A preview only for links to a connected app, read from the first account allowed to see the item. */
export const loadLinkPreview = async (c: AppContext, raw: string): Promise<LinkPreviewData | null> => {
  const link = parseConnectedLink(raw);
  if (!link) return null;
  for (const account of await activeAccounts(c, link.provider === "drive" ? "google" : link.provider)) {
    try {
      const preview = await previewWith(account.id, link);
      if (preview?.title) return preview;
    } catch {
      // Unreachable or refused: try the next account, and in the end leave the plain link.
    }
  }
  return null;
};

// ---- Search ----

export type ConnectedSearchResult = { provider: "github"; title: string; subtitle: string; url: string };

const searchGitHubKind = async (connectionId: string, kind: string, q: string) => {
  const query = new URLSearchParams({ q: `${q} ${kind}`, sort: "updated", per_page: "4" });
  const data = await readJson(await callProvider(connectionId, `https://api.github.com/search/issues?${query}`, { headers: GITHUB_HEADERS }));
  return Array.isArray(data?.items) ? data.items as Json[] : [];
};

/** GitHub issues and pull requests the connected account is involved in. */
export const searchConnectedApps = async (c: AppContext, q: string): Promise<ConnectedSearchResult[]> => {
  const [account] = await activeAccounts(c, "github");
  if (!account) return [];
  // GitHub only accepts this search when it names one of the two kinds.
  const scoped = `${q} involves:${account.name}`;
  try {
    const [issues, pulls] = await Promise.all([
      searchGitHubKind(account.id, "is:issue", scoped),
      searchGitHubKind(account.id, "is:pull-request", scoped),
    ]);
    return [...issues, ...pulls]
      .sort((a, b) => String(b.updated_at).localeCompare(String(a.updated_at)))
      .map((item) => ({
        provider: "github" as const,
        title: oneLine(item.title),
        subtitle: `${String(item.repository_url ?? "").split("/").slice(-2).join("/")} #${item.number}`,
        url: String(item.html_url),
      }))
      .filter((item) => item.url.startsWith("https://github.com/"));
  } catch {
    return [];
  }
};

// ---- Google Drive ----

/** Creates a Google Doc from a page. The drive.file permission only reaches files made this way. */
export const savePageToDrive = async (c: AppContext, page: { title: string; html: string }) => {
  const [account] = await activeAccounts(c, "google");
  if (!account) throw new AppError("connection_missing", "Connect Google Drive first.", 400);
  const boundary = `ponder-${crypto.randomUUID()}`;
  const metadata = JSON.stringify({ name: page.title || "Untitled", mimeType: "application/vnd.google-apps.document" });
  const body = [
    `--${boundary}\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n${metadata}\r\n`,
    `--${boundary}\r\nContent-Type: text/html; charset=UTF-8\r\n\r\n${page.html}\r\n`,
    `--${boundary}--`,
  ].join("");
  const data = await readJson(await callProvider(account.id, "https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart&fields=id,webViewLink", {
    method: "POST",
    headers: { "content-type": `multipart/related; boundary=${boundary}` },
    body,
  }));
  if (!data?.id) throw new AppError("drive_save_failed", "Google Drive would not save this page. Try connecting it again.", 502);
  return { url: typeof data.webViewLink === "string" ? data.webViewLink : `https://docs.google.com/document/d/${data.id}/edit` };
};
