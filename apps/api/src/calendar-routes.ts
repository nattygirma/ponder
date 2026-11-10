import { zValidator } from "@hono/zod-validator";
import type { Hono } from "hono";
import { z } from "zod";
import type { AppContext, AppEnv } from "./api-context";
import { AppError } from "./app-error";
import { resolvePrimaryAiCredentialEncryptionKey } from "./ai-service";
import { fetchCalendarText, parseCalendarEvents, parseCalendarUrl, type CalendarEvent } from "./calendar-feed";
import { loadConnectedCalendars } from "./connections";
import { getWorkspaceId } from "./request-auth";
import { guarded } from "./route-guard";
import { decryptSecret, encryptSecret } from "./secret-encryption";

const MAX_FEEDS = 3;
const REFRESH_MS = 15 * 60_000;
const WINDOW_DAYS = 60;
const DAY_MS = 86_400_000;

type FeedRow = {
  id: string;
  label: string;
  url_encrypted: string;
  events_json: string;
  fetched_at: string | null;
  last_error: string | null;
};

const encryptionKey = (c: AppContext) => {
  const key = resolvePrimaryAiCredentialEncryptionKey(c.env);
  if (!key) throw new AppError("calendar_encryption_missing", "Connecting a calendar needs this instance's encryption key to be set.", 400);
  return key;
};

const actorOf = (c: AppContext) => {
  const actorId = c.get("auth")?.actorId;
  if (!actorId) throw new AppError("calendar_actor_missing", "Sign in to use calendars.", 403);
  return actorId;
};

const loadEvents = async (url: string) => {
  const now = Date.now();
  return parseCalendarEvents(await fetchCalendarText(url), { from: now - DAY_MS, to: now + WINDOW_DAYS * DAY_MS });
};

const refreshFeed = async (c: AppContext, feed: FeedRow) => {
  const now = new Date().toISOString();
  try {
    const url = await decryptSecret(feed.url_encrypted, encryptionKey(c));
    const events = await loadEvents(url);
    const eventsJson = JSON.stringify(events);
    await c.env.storage.db.prepare("UPDATE calendar_feeds SET events_json = ?, fetched_at = ?, last_error = NULL WHERE id = ?").bind(eventsJson, now, feed.id).run();
    return { ...feed, events_json: eventsJson, fetched_at: now, last_error: null };
  } catch {
    // The last good copy stays on screen; the row says the refresh failed.
    const message = "This calendar could not be refreshed.";
    await c.env.storage.db.prepare("UPDATE calendar_feeds SET fetched_at = ?, last_error = ? WHERE id = ?").bind(now, message, feed.id).run();
    return { ...feed, fetched_at: now, last_error: message };
  }
};

const parseStored = (value: string): CalendarEvent[] => {
  try {
    const parsed: unknown = JSON.parse(value);
    return Array.isArray(parsed) ? parsed as CalendarEvent[] : [];
  } catch {
    return [];
  }
};

export const registerCalendarRoutes = (app: Hono<AppEnv>) => {
  app.get("/api/v1/calendar", (c) =>
    guarded(c, "read:memos", async () => {
      const { results } = await c.env.storage.db
        .prepare("SELECT id, label, url_encrypted, events_json, fetched_at, last_error FROM calendar_feeds WHERE workspace_id = ? AND actor_id = ? ORDER BY created_at")
        .bind(getWorkspaceId(c), actorOf(c))
        .all<FeedRow>();
      const cutoff = Date.now() - REFRESH_MS;
      const feeds = await Promise.all(results.map((feed) => (
        !feed.fetched_at || new Date(feed.fetched_at).getTime() < cutoff ? refreshFeed(c, feed) : feed
      )));
      const now = Date.now();
      // Calendars connected by login are read fresh and never stored here.
      const connected = await loadConnectedCalendars(c, now - DAY_MS, now + WINDOW_DAYS * DAY_MS);
      const today = new Date(now - DAY_MS).toISOString().slice(0, 10);
      const events = [...feeds.flatMap((feed) => parseStored(feed.events_json)), ...connected.flatMap((calendar) => calendar.events)]
        .filter((event) => (event.end ?? event.start) >= today)
        .sort((a, b) => a.start.localeCompare(b.start))
        .slice(0, 100);
      // The address works as a password, so it never leaves the server.
      return c.json({
        feeds: [
          ...connected.map((calendar) => ({ id: calendar.id, label: calendar.label, lastError: calendar.lastError, connected: true })),
          ...feeds.map((feed) => ({ id: feed.id, label: feed.label, lastError: feed.last_error, connected: false })),
        ],
        events,
      });
    }));

  app.post("/api/v1/calendar/feeds", zValidator("json", z.object({ url: z.string().trim().min(1).max(2000) })), (c) =>
    guarded(c, "write:memos", async () => {
      const parsed = parseCalendarUrl(c.req.valid("json").url);
      if (!parsed) throw new AppError("calendar_url_invalid", "Paste the secret iCal address from Google Calendar, Apple Calendar or Outlook.", 400);
      const workspaceId = getWorkspaceId(c);
      const actorId = actorOf(c);
      const count = await c.env.storage.db.prepare("SELECT COUNT(*) AS total FROM calendar_feeds WHERE workspace_id = ? AND actor_id = ?").bind(workspaceId, actorId).first<{ total: number }>();
      if ((count?.total ?? 0) >= MAX_FEEDS) throw new AppError("calendar_limit", `You can connect up to ${MAX_FEEDS} calendars.`, 400);
      const key = encryptionKey(c);
      let events: CalendarEvent[];
      try {
        events = await loadEvents(parsed.url);
      } catch {
        throw new AppError("calendar_unreachable", "That calendar could not be read. Check the address and try again.", 400);
      }
      const id = `cal_${crypto.randomUUID()}`;
      const now = new Date().toISOString();
      await c.env.storage.db
        .prepare("INSERT INTO calendar_feeds (id, workspace_id, actor_id, label, url_encrypted, events_json, fetched_at, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)")
        .bind(id, workspaceId, actorId, parsed.label, await encryptSecret(parsed.url, key), JSON.stringify(events), now, now)
        .run();
      return c.json({ feed: { id, label: parsed.label, lastError: null } }, 201);
    }));

  app.delete("/api/v1/calendar/feeds/:id", (c) =>
    guarded(c, "write:memos", async () => {
      await c.env.storage.db.prepare("DELETE FROM calendar_feeds WHERE id = ? AND workspace_id = ? AND actor_id = ?").bind(c.req.param("id"), getWorkspaceId(c), actorOf(c)).run();
      return c.json({ ok: true });
    }));
};
