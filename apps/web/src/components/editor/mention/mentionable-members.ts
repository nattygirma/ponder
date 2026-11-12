/*
 * Adapted from AppFlowy-Web (https://github.com/AppFlowy-IO/AppFlowy-Web), Copyright AppFlowy, AGPL-3.0.
 * Source: src/components/.../useMentionableUsers.ts (the module-level member cache with a 30 second
 * time to live, shared in-flight requests, `peekMentionableUsers` and `loadMentionableUsers`).
 * Ponder keeps the cache in memory only (no IndexedDB copy) and reads members from its own API.
 */
import { useEffect, useState } from "react";
import type { WorkspaceMember } from "@ponder/shared";
import { api } from "@/lib/api";

type CacheEntry = { members: WorkspaceMember[]; timestamp: number };

const MEMORY_CACHE_TTL_MS = 30 * 1000;
const EMPTY: WorkspaceMember[] = [];

// One workspace per page load, so one entry is enough.
let cache: CacheEntry | null = null;
let refresh: Promise<WorkspaceMember[]> | null = null;
const listeners = new Set<(members: WorkspaceMember[]) => void>();

const isFresh = (entry: CacheEntry | null): entry is CacheEntry =>
  Boolean(entry) && Date.now() - (entry as CacheEntry).timestamp < MEMORY_CACHE_TTL_MS;

/** The last member list loaded, however old. Empty before the first load. */
export const peekMentionableMembers = (): readonly WorkspaceMember[] => cache?.members ?? EMPTY;

/** Members for the `@` menu; every caller in the same 30 seconds shares one request. */
export const loadMentionableMembers = (force = false): Promise<WorkspaceMember[]> => {
  if (!force && isFresh(cache)) return Promise.resolve(cache.members);
  if (refresh) return refresh;
  const pending = api.getWorkspaceMembers()
    .then(({ members }) => {
      cache = { members, timestamp: Date.now() };
      listeners.forEach((listener) => listener(members));
      return members;
    })
    // Personal workspaces have no member list; the `@` menu then offers only the viewer.
    .catch(() => cache?.members ?? EMPTY)
    .finally(() => {
      if (refresh === pending) refresh = null;
    });
  refresh = pending;
  return pending;
};

/** The member list, loading it when `enabled`, for components such as a mention's hover card. */
export const useMentionableMembers = (enabled = true) => {
  const [members, setMembers] = useState<readonly WorkspaceMember[]>(peekMentionableMembers);
  useEffect(() => {
    if (!enabled) return;
    const listener = (next: WorkspaceMember[]) => setMembers(next);
    listeners.add(listener);
    void loadMentionableMembers().then(listener);
    return () => {
      listeners.delete(listener);
    };
  }, [enabled]);
  return members;
};

export const memberDisplayName = (member: Pick<WorkspaceMember, "displayName" | "username">) =>
  member.displayName?.trim() || member.username;
