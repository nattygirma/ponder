import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { parseConnectedLink } from "../../../packages/shared/src/connected-links.ts";
import { canUseConnections, listAccounts, loadConnectedCalendars, loadLinkPreview, savePageToDrive, searchConnectedApps } from "./connections.ts";

const OWNER = { kind: "user", role: "owner" };
const MEMBER = { kind: "user", role: "member" };
const AGENT = { kind: "agent", role: "owner" };

const account = (id, provider, name, status = "active") => ({ id, provider, external_id: id, name, status, scopes: [], connected_at: "2026-11-08T00:00:00Z" });

const context = (auth, accounts) => ({
  get: () => auth,
  env: accounts ? { listConnections: async (provider) => accounts.filter((row) => !provider || row.provider === provider) } : {},
});

const realFetch = globalThis.fetch;
let calls;
let respond;

const json = (body, status = 200) => new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });

beforeEach(() => {
  calls = [];
  respond = () => json({});
  globalThis.fetch = async (url, init = {}) => {
    calls.push({ url: String(url), headers: new Headers(init.headers), method: init.method ?? "GET", body: init.body });
    return respond(String(url));
  };
});

afterEach(() => {
  globalThis.fetch = realFetch;
});

describe("parseConnectedLink", () => {
  test("reads GitHub repositories, issues and pull requests", () => {
    expect(parseConnectedLink("https://github.com/acme/app")).toMatchObject({ kind: "repo", owner: "acme", repo: "app" });
    expect(parseConnectedLink("https://github.com/acme/app/issues/12")).toMatchObject({ kind: "issue", number: "12" });
    expect(parseConnectedLink("https://github.com/acme/app/pull/7/files")).toMatchObject({ kind: "issue", number: "7" });
    expect(parseConnectedLink("https://github.com/acme/app/blob/main/a.ts")).toBeNull();
  });

  test("reads Slack message links, with or without a thread", () => {
    expect(parseConnectedLink("https://acme.slack.com/archives/C024BE91L/p1700000000000100")).toMatchObject({ channel: "C024BE91L", ts: "1700000000.000100", threadTs: null });
    expect(parseConnectedLink("https://acme.slack.com/archives/C024BE91L/p1700000000000100?thread_ts=1699999999.000100&cid=C024BE91L")).toMatchObject({ threadTs: "1699999999.000100" });
    expect(parseConnectedLink("https://acme.slack.com/messages/C024BE91L")).toBeNull();
  });

  test("reads Drive and Docs links", () => {
    expect(parseConnectedLink("https://drive.google.com/file/d/abc_D-1/view?usp=sharing")).toMatchObject({ fileId: "abc_D-1" });
    expect(parseConnectedLink("https://drive.google.com/open?id=xyz")).toMatchObject({ fileId: "xyz" });
    expect(parseConnectedLink("https://docs.google.com/document/d/doc1/edit")).toMatchObject({ fileId: "doc1" });
    expect(parseConnectedLink("https://docs.google.com/a/acme.com/spreadsheets/d/sheet1/edit")).toMatchObject({ fileId: "sheet1" });
  });

  test("refuses lookalike hosts, other schemes and embedded credentials", () => {
    for (const url of ["https://github.com.evil.test/a/b", "http://github.com/a/b", "https://evil.test/slack.com/archives/C1/p1700000000000100", "https://me:pw@github.com/a/b", "javascript:alert(1)", "not a url"]) {
      expect(parseConnectedLink(url)).toBeNull();
    }
  });
});

describe("who can read connected accounts", () => {
  const accounts = [account("c1", "google", "me@example.test"), account("c2", "github", "octocat")];

  test("only the instance owner's own session", () => {
    expect(canUseConnections(context(OWNER, accounts))).toBe(true);
    expect(canUseConnections(context(MEMBER, accounts))).toBe(false);
    expect(canUseConnections(context(AGENT, accounts))).toBe(false);
  });

  test("a member never reaches the owner's accounts or their data", async () => {
    const c = context(MEMBER, accounts);
    expect(await listAccounts(c)).toEqual([]);
    expect(await loadConnectedCalendars(c, 0, 1)).toEqual([]);
    expect(await loadLinkPreview(c, "https://github.com/acme/app")).toBeNull();
    expect(await searchConnectedApps(c, "bug")).toEqual([]);
    await expect(savePageToDrive(c, { title: "x", html: "" })).rejects.toThrow();
    expect(calls).toEqual([]);
  });

  test("a host without connections just has none", async () => {
    expect(await listAccounts(context(OWNER))).toEqual([]);
  });
});

describe("Google Calendar", () => {
  test("maps events, skips cancelled ones and names the connection on the request", async () => {
    respond = () => json({ items: [
      { id: "a", summary: "Standup", start: { dateTime: "2026-11-09T09:00:00+02:00" }, end: { dateTime: "2026-11-09T09:30:00+02:00" }, location: "Room  1" },
      { id: "b", start: { date: "2026-11-10" }, end: { date: "2026-11-11" } },
      { id: "c", status: "cancelled", summary: "Gone", start: { date: "2026-11-12" } },
    ] });
    const [calendar] = await loadConnectedCalendars(context(OWNER, [account("c1", "google", "me@example.test")]), Date.UTC(2026, 10, 8), Date.UTC(2026, 10, 20));
    expect(calendar).toMatchObject({ id: "connection:c1", label: "Google Calendar (me@example.test)", lastError: null });
    expect(calendar.events).toEqual([
      { id: "gcal_a", title: "Standup", start: "2026-11-09T07:00:00.000Z", end: "2026-11-09T07:30:00.000Z", allDay: false, location: "Room 1" },
      { id: "gcal_b", title: "Untitled event", start: "2026-11-10", end: "2026-11-11", allDay: true, location: null },
    ]);
    expect(calls[0].headers.get("x-altstack-connection")).toBe("c1");
    expect(new URL(calls[0].url).searchParams.get("singleEvents")).toBe("true");
  });

  test("an expired login asks to log in again without calling Google", async () => {
    const [calendar] = await loadConnectedCalendars(context(OWNER, [account("c1", "google", "me", "expired")]), 0, 1);
    expect(calendar.lastError).toContain("again");
    expect(calls).toEqual([]);
  });

  test("a refused request reports an error instead of failing the whole calendar", async () => {
    respond = () => json({ error: { code: "connection_unavailable" } }, 401);
    const [calendar] = await loadConnectedCalendars(context(OWNER, [account("c1", "google", "me")]), 0, 1);
    expect(calendar).toMatchObject({ lastError: "This calendar could not be read.", events: [] });
  });
});

describe("Outlook Calendar", () => {
  test("maps events to UTC, keeps all-day dates and skips cancelled ones", async () => {
    respond = () => json({ value: [
      { id: "a", subject: "Standup", isAllDay: false, start: { dateTime: "2026-11-09T07:00:00.0000000", timeZone: "UTC" }, end: { dateTime: "2026-11-09T07:30:00.0000000", timeZone: "UTC" }, location: { displayName: "Room 1" } },
      { id: "b", isAllDay: true, start: { dateTime: "2026-11-10T00:00:00.0000000", timeZone: "UTC" }, end: { dateTime: "2026-11-11T00:00:00.0000000", timeZone: "UTC" }, location: { displayName: "" } },
      { id: "c", subject: "Gone", isCancelled: true, start: { dateTime: "2026-11-12T00:00:00.0000000", timeZone: "UTC" } },
    ] });
    const [calendar] = await loadConnectedCalendars(context(OWNER, [account("m1", "microsoft", "me@outlook.test")]), Date.UTC(2026, 10, 8), Date.UTC(2026, 10, 20));
    expect(calendar).toMatchObject({ id: "connection:m1", label: "Outlook Calendar (me@outlook.test)", lastError: null });
    expect(calendar.events).toEqual([
      { id: "outlook_a", title: "Standup", start: "2026-11-09T07:00:00.000Z", end: "2026-11-09T07:30:00.000Z", allDay: false, location: "Room 1" },
      { id: "outlook_b", title: "Untitled event", start: "2026-11-10", end: "2026-11-11", allDay: true, location: null },
    ]);
    expect(calls[0].url.startsWith("https://graph.microsoft.com/v1.0/me/calendarView?")).toBe(true);
    expect(calls[0].headers.get("x-altstack-connection")).toBe("m1");
    expect(calls[0].headers.get("prefer")).toBe('outlook.timezone="UTC"');
  });

  test("Google and Outlook show together, and one failing leaves the other", async () => {
    respond = (url) => (url.includes("graph.microsoft.com") ? json({}, 500) : json({ items: [{ id: "g", summary: "Kept", start: { date: "2026-11-10" } }] }));
    const calendars = await loadConnectedCalendars(context(OWNER, [account("g1", "google", "a"), account("m1", "microsoft", "b"), account("s1", "slack", "c")]), 0, 1);
    expect(calendars.map((calendar) => calendar.id)).toEqual(["connection:g1", "connection:m1"]);
    expect(calendars[0].events).toHaveLength(1);
    expect(calendars[1].lastError).toBe("This calendar could not be read.");
  });

  test("an expired login names Microsoft", async () => {
    const [calendar] = await loadConnectedCalendars(context(OWNER, [account("m1", "microsoft", "me", "expired")]), 0, 1);
    expect(calendar.lastError).toBe("Log in to Microsoft again to see these events.");
    expect(calls).toEqual([]);
  });
});

describe("link previews", () => {
  test("GitHub issue, with its state and author", async () => {
    respond = () => json({ title: "Fix  login", state: "open", user: { login: "octocat" } });
    const preview = await loadLinkPreview(context(OWNER, [account("gh", "github", "me")]), "https://github.com/acme/app/issues/12");
    expect(preview).toEqual({ url: "https://github.com/acme/app/issues/12", provider: "github", title: "Fix login #12", subtitle: "acme/app · Open · octocat" });
    expect(calls[0].url).toBe("https://api.github.com/repos/acme/app/issues/12");
    expect(calls[0].headers.get("x-altstack-connection")).toBe("gh");
    expect(calls[0].headers.get("user-agent")).toBe("Ponder");
  });

  test("a merged pull request says so", async () => {
    respond = () => json({ title: "Ship", state: "closed", user: { login: "a" }, pull_request: { merged_at: "2026-01-01" } });
    const preview = await loadLinkPreview(context(OWNER, [account("gh", "github", "me")]), "https://github.com/acme/app/pull/3");
    expect(preview.subtitle).toBe("acme/app · Merged · a");
  });

  test("Slack message with its channel, tidying Slack's markup", async () => {
    respond = (url) => url.includes("conversations.info")
      ? json({ ok: true, channel: { name: "general" } })
      : json({ ok: true, messages: [{ text: "See <https://a.test|the doc>  and\nask <@U123>" }] });
    const preview = await loadLinkPreview(context(OWNER, [account("sl", "slack", "Acme")]), "https://acme.slack.com/archives/C1/p1700000000000100");
    expect(preview).toMatchObject({ provider: "slack", title: "#general", subtitle: "See the doc and ask @…" });
  });

  test("Slack's ok:false leaves the plain link", async () => {
    respond = () => json({ ok: false, error: "not_in_channel" });
    expect(await loadLinkPreview(context(OWNER, [account("sl", "slack", "Acme")]), "https://acme.slack.com/archives/C1/p1700000000000100")).toBeNull();
  });

  test("Drive uses the Google login", async () => {
    respond = () => json({ name: "Plan", mimeType: "application/vnd.google-apps.document" });
    const preview = await loadLinkPreview(context(OWNER, [account("g", "google", "me")]), "https://docs.google.com/document/d/doc1/edit");
    expect(preview).toMatchObject({ provider: "drive", title: "Plan", subtitle: "Google Doc" });
  });

  test("tries the next account when the first can't see the item", async () => {
    respond = () => (calls.length === 1 ? json({}, 404) : json({ full_name: "acme/app", description: "x" }));
    const preview = await loadLinkPreview(context(OWNER, [account("a", "github", "one"), account("b", "github", "two")]), "https://github.com/acme/app");
    expect(preview.title).toBe("acme/app");
    expect(calls.map((call) => call.headers.get("x-altstack-connection"))).toEqual(["a", "b"]);
  });

  test("no call for an unconnected app or an unknown address", async () => {
    expect(await loadLinkPreview(context(OWNER, []), "https://github.com/acme/app")).toBeNull();
    expect(await loadLinkPreview(context(OWNER, [account("a", "github", "one")]), "https://example.test/acme/app")).toBeNull();
    expect(calls).toEqual([]);
  });
});

describe("search and Drive", () => {
  test("GitHub search asks for both kinds, limited to the account, newest first", async () => {
    respond = (url) => json({ items: [{
      title: url.includes("is%3Aissue") ? "Older issue" : "Newer pull",
      number: 1,
      updated_at: url.includes("is%3Aissue") ? "2026-01-01" : "2026-02-01",
      repository_url: "https://api.github.com/repos/acme/app",
      html_url: "https://github.com/acme/app/issues/1",
    }] });
    const results = await searchConnectedApps(context(OWNER, [account("a", "github", "octocat")]), "login");
    expect(results.map((result) => result.title)).toEqual(["Newer pull", "Older issue"]);
    expect(results[0].subtitle).toBe("acme/app #1");
    expect(new URL(calls[0].url).searchParams.get("q")).toContain("involves:octocat");
  });

  test("saving to Drive uploads a Google Doc", async () => {
    respond = () => json({ id: "doc1", webViewLink: "https://docs.google.com/document/d/doc1/edit" });
    const saved = await savePageToDrive(context(OWNER, [account("g", "google", "me")]), { title: "Plan", html: "<p>Hi</p>" });
    expect(saved.url).toBe("https://docs.google.com/document/d/doc1/edit");
    expect(calls[0].method).toBe("POST");
    expect(calls[0].headers.get("content-type")).toContain("multipart/related");
    expect(calls[0].body).toContain('"mimeType":"application/vnd.google-apps.document"');
    expect(calls[0].body).toContain("<p>Hi</p>");
  });
});
