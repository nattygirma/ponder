import { useCallback, useEffect, useState, useSyncExternalStore } from "react";
import { useTranslation } from "react-i18next";
import * as Y from "yjs";
import { applyAwarenessUpdate, Awareness, encodeAwarenessUpdate } from "y-protocols/awareness";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { api } from "@/lib/api";

const PUSH_DELAY_MS = 250;
const TICK_WITH_PEERS_MS = 800;
const TICK_ALONE_MS = 8_000;
const RETRY_MS = 3_000;
const KEEPALIVE_LIMIT = 60_000;
const COLORS = ["#2563eb", "#db2777", "#059669", "#d97706", "#7c3aed", "#dc2626", "#0891b2", "#4f46e5"];

export type CollabUser = { id: string; name: string; color: string };
export type CollabPeer = { key: string; name: string; color: string };

const encode = (bytes: Uint8Array) => {
  let binary = "";
  for (let index = 0; index < bytes.length; index += 0x8000) {
    binary += String.fromCharCode(...bytes.subarray(index, index + 0x8000));
  }
  return btoa(binary);
};

const decode = (text: string) => Uint8Array.from(atob(text), (character) => character.charCodeAt(0));

const colorFor = (id: string) => {
  let hash = 0;
  for (const character of id) hash = (hash * 31 + character.charCodeAt(0)) | 0;
  return COLORS[Math.abs(hash) % COLORS.length]!;
};

/** Yjs over ordinary requests, because the app runs where WebSockets aren't available. */
export class HttpYjsProvider {
  readonly doc = new Y.Doc();
  readonly awareness = new Awareness(this.doc);
  readonly clientId = crypto.randomUUID();
  generation = 0;
  canEdit = false;

  private cursor = 0;
  private pending: Uint8Array[] = [];
  private awarenessDirty = true;
  private timer = 0;
  private busy = false;
  private stopped = false;
  private peerCount = 1;
  private lastTitle: string | null = null;
  private offline = false;
  private peers: CollabPeer[] = [];
  private readonly listeners = new Set<() => void>();
  private readonly titleListeners = new Set<(title: string) => void>();

  constructor(
    private readonly memoId: string,
    readonly user: CollabUser,
    private readonly onReset: () => void,
  ) {}

  private readonly handleDocUpdate = (update: Uint8Array, origin: unknown) => {
    if (origin === this) return;
    this.pending.push(update);
    this.schedule(PUSH_DELAY_MS);
  };

  private readonly handleAwarenessUpdate = ({ added, updated, removed }: { added: number[]; updated: number[]; removed: number[] }, origin: unknown) => {
    if (origin !== this && [...added, ...updated, ...removed].includes(this.doc.clientID)) {
      this.awarenessDirty = true;
      if (this.peerCount > 1) this.schedule(PUSH_DELAY_MS);
    }
    this.refreshPeers();
  };

  private readonly handleVisibility = () => {
    if (document.visibilityState === "visible") this.schedule(0);
    else void this.tick();
  };

  private readonly handlePageHide = () => this.stop();

  async start() {
    const joined = await api.collabJoin(this.memoId);
    this.generation = joined.generation;
    this.canEdit = joined.canEdit;
    this.cursor = joined.cursor;
    Y.applyUpdate(this.doc, decode(joined.state), this);
    this.doc.on("update", this.handleDocUpdate);
    this.awareness.setLocalStateField("user", this.user);
    this.awareness.on("update", this.handleAwarenessUpdate);
    document.addEventListener("visibilitychange", this.handleVisibility);
    window.addEventListener("pagehide", this.handlePageHide);
    this.schedule(0);
  }

  private schedule(delay: number) {
    if (this.stopped) return;
    if (document.visibilityState !== "visible" && this.pending.length === 0) {
      window.clearTimeout(this.timer);
      return;
    }
    window.clearTimeout(this.timer);
    this.timer = window.setTimeout(() => void this.tick(), delay);
  }

  private async tick() {
    if (this.busy || this.stopped) return;
    this.busy = true;
    const sending = this.pending;
    this.pending = [];
    const sendAwareness = this.awarenessDirty;
    this.awarenessDirty = false;
    let nextDelay = TICK_ALONE_MS;
    try {
      const result = await api.collabSync(this.memoId, {
        clientId: this.clientId,
        cursor: this.cursor,
        generation: this.generation,
        update: sending.length > 0 ? encode(Y.mergeUpdates(sending)) : undefined,
        awareness: sendAwareness || this.peerCount > 1 ? encode(encodeAwarenessUpdate(this.awareness, [this.doc.clientID])) : undefined,
      });
      if (this.stopped) return;
      if (result.reset) {
        this.onReset();
        return;
      }
      this.cursor = result.cursor;
      this.peerCount = result.peers;
      if (result.state) Y.applyUpdate(this.doc, decode(result.state), this);
      for (const update of result.updates) Y.applyUpdate(this.doc, decode(update), this);
      for (const update of result.awareness) applyAwarenessUpdate(this.awareness, decode(update), this);
      if (result.title !== null && result.title !== this.lastTitle) {
        const first = this.lastTitle === null;
        this.lastTitle = result.title;
        if (!first) this.titleListeners.forEach((listener) => listener(result.title!));
      }
      this.setOffline(false);
      nextDelay = result.peers > 1 ? TICK_WITH_PEERS_MS : TICK_ALONE_MS;
    } catch {
      // Nothing is lost: unsent edits go back in the queue and are retried.
      this.pending = [...sending, ...this.pending];
      this.awarenessDirty = this.awarenessDirty || sendAwareness;
      this.setOffline(true);
      nextDelay = RETRY_MS;
    } finally {
      this.busy = false;
    }
    this.schedule(this.pending.length > 0 ? Math.min(nextDelay, PUSH_DELAY_MS) : nextDelay);
  }

  private setOffline(offline: boolean) {
    if (offline === this.offline) return;
    this.offline = offline;
    this.emit();
  }

  private refreshPeers() {
    const seen = new Map<string, CollabPeer>();
    this.awareness.getStates().forEach((state, clientId) => {
      const user = state.user as CollabUser | undefined;
      if (clientId === this.doc.clientID || !user || user.id === this.user.id) return;
      seen.set(user.id, { key: user.id, name: user.name, color: user.color });
    });
    const next = [...seen.values()];
    if (next.map((peer) => peer.key).join() !== this.peers.map((peer) => peer.key).join()) {
      this.peers = next;
      this.emit();
    }
  }

  private emit() {
    this.snapshot = { peers: this.peers, offline: this.offline };
    this.listeners.forEach((listener) => listener());
  }

  private snapshot: { peers: CollabPeer[]; offline: boolean } = { peers: [], offline: false };
  readonly subscribe = (listener: () => void) => {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  };
  readonly getSnapshot = () => this.snapshot;

  onTitle(listener: (title: string) => void) {
    this.titleListeners.add(listener);
    return () => { this.titleListeners.delete(listener); };
  }

  /** The person's own rename must not come back to them as somebody else's. */
  noteTitle(title: string) {
    this.lastTitle = title;
  }

  stop() {
    if (this.stopped) return;
    this.stopped = true;
    window.clearTimeout(this.timer);
    document.removeEventListener("visibilitychange", this.handleVisibility);
    window.removeEventListener("pagehide", this.handlePageHide);
    this.doc.off("update", this.handleDocUpdate);
    this.awareness.off("update", this.handleAwarenessUpdate);
    if (this.generation > 0) {
      const update = this.pending.length > 0 ? encode(Y.mergeUpdates(this.pending)) : undefined;
      void api.collabLeave(this.memoId, { clientId: this.clientId, generation: this.generation, update }, (update?.length ?? 0) < KEEPALIVE_LIMIT).catch(() => undefined);
    }
    this.awareness.destroy();
    this.doc.destroy();
  }
}

type Viewer = { id: string; displayName?: string | null; username?: string } | null;

export const useCollabSession = (memoId: string | null, viewer: Viewer) => {
  const [state, setState] = useState<{ memoId: string; provider: HttpYjsProvider | null; failed: boolean } | null>(null);
  const [attempt, setAttempt] = useState(0);
  const viewerId = viewer?.id;
  const viewerName = viewer?.displayName || viewer?.username || "";

  useEffect(() => {
    if (!memoId || !viewerId) {
      setState(null);
      return;
    }
    let active = true;
    setState(null);
    const provider = new HttpYjsProvider(memoId, { id: viewerId, name: viewerName, color: colorFor(viewerId) }, () => {
      if (active) setAttempt((value) => value + 1);
    });
    provider.start()
      .then(() => { if (active) setState({ memoId, provider, failed: false }); })
      .catch(() => { if (active) setState({ memoId, provider: null, failed: true }); });
    return () => {
      active = false;
      provider.stop();
    };
  }, [attempt, memoId, viewerId, viewerName]);

  const retry = useCallback(() => setAttempt((value) => value + 1), []);
  const current = state?.memoId === memoId ? state : null;
  return { provider: current?.provider ?? null, failed: current?.failed ?? false, retry };
};

export const CollabPresence = ({ provider }: { provider: HttpYjsProvider }) => {
  const { t } = useTranslation();
  const { peers, offline } = useSyncExternalStore(provider.subscribe, provider.getSnapshot);
  return (
    <div className="flex items-center gap-1" data-collab-presence>
      {offline ? <span className="text-xs text-slate-500">{t("pages.collab.reconnecting")}</span> : null}
      {peers.slice(0, 5).map((peer) => (
        <Tooltip key={peer.key}>
          <TooltipTrigger asChild>
            <span tabIndex={0} aria-label={peer.name} className="flex h-6 w-6 items-center justify-center rounded-full text-[11px] font-medium text-white" style={{ background: peer.color }}>
              {peer.name.slice(0, 1).toUpperCase()}
            </span>
          </TooltipTrigger>
          <TooltipContent side="bottom">{peer.name}</TooltipContent>
        </Tooltip>
      ))}
    </div>
  );
};
