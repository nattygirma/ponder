import { beforeEach, expect, mock, test } from "bun:test";
import { ApiRequestError } from "@ponder/client";
import type { MemoDetail } from "@ponder/shared";

const storage = new Map<string, string>();

mock.module("@react-native-async-storage/async-storage", () => ({
  default: {
    getItem: async (key: string) => storage.get(key) ?? null,
    removeItem: async (key: string) => {
      storage.delete(key);
    },
    setItem: async (key: string, value: string) => {
      storage.set(key, value);
    },
  },
}));

const {
  armMobileSyncQueueImmediateRetry,
  cancelMobileMemoQueueItems,
  clearMobileMemoUpdateQueueItem,
  discardMobileMemoConflict,
  getMobileConflictDraftClipboardText,
  listMobileSyncQueueItems,
  markMobileMemoUpdateError,
  queueMobileMemoCreate,
  queueMobileMemoUpdate,
  syncMobileQueuedChanges,
} = await import("./sync-queue");
const { writeMobileMemoDraft, clearMobileMemoDraft } = await import("./mobile-drafts");

const basePayload = {
  memoId: "memo-1",
  expectedRevision: 1,
  expectedContentHash: "hash-1",
  title: "First",
  contentMarkdown: "first",
  notebookId: "notebook-1",
  tags: [],
};

beforeEach(() => {
  storage.clear();
});

test("keeps pending updates isolated by instance", async () => {
  await queueMobileMemoUpdate("https://one.example", basePayload);
  await queueMobileMemoUpdate("https://two.example", { ...basePayload, title: "Second instance" });

  expect((await listMobileSyncQueueItems("https://one.example"))[0]?.payload.title).toBe("First");
  expect((await listMobileSyncQueueItems("https://two.example"))[0]?.payload.title).toBe("Second instance");
});

test("keeps a stale mobile edit as an explicit conflict without overwriting the cloud note", async () => {
  const scope = "https://one.example";
  await queueMobileMemoUpdate(scope, basePayload);
  let updateCalled = false;
  const client = {
    createMemoEditSession: async () => ({
      editSession: { id: "edit-2", baseRevision: 2, baseContentHash: "hash-2" },
    }),
    updateMemo: async () => {
      updateCalled = true;
      throw new ApiRequestError("Unexpected update", 500, "unexpected_update");
    },
  };

  const result = await syncMobileQueuedChanges(client as never, scope);
  const queued = (await listMobileSyncQueueItems(scope))[0];

  expect(result.conflicted).toBe(1);
  expect(updateCalled).toBe(false);
  expect(queued?.status).toBe("conflict");
  expect(queued?.payload.contentMarkdown).toBe("first");
});

test("discardMobileMemoConflict clears the local conflict and returns the cloud memo", async () => {
  const scope = "https://one.example";
  await queueMobileMemoUpdate(scope, basePayload);
  await syncMobileQueuedChanges({
    createMemoEditSession: async () => ({
      editSession: { id: "edit-2", baseRevision: 2, baseContentHash: "hash-2" },
    }),
    updateMemo: async () => {
      throw new Error("should not update");
    },
  } as never, scope);

  const cloud = createMemo({ revision: 3, contentHash: "hash-3", contentMarkdown: "cloud wins", title: "Cloud" });
  const client = {
    getMemo: async () => ({ memo: cloud }),
  };

  const adopted = await discardMobileMemoConflict(client as never, scope, "memo-1");
  expect(adopted).toEqual(cloud);
  expect(await listMobileSyncQueueItems(scope)).toEqual([]);
});

test("getMobileConflictDraftClipboardText prefers the queued update payload", async () => {
  const scope = "https://one.example";
  await queueMobileMemoUpdate(scope, {
    ...basePayload,
    title: "Queued title",
    contentMarkdown: "queued body",
    tags: ["demo"],
  });
  await writeMobileMemoDraft({
    memoId: "memo-1",
    expectedRevision: 1,
    title: "Draft title",
    contentMarkdown: "draft body",
    notebookId: "notebook-1",
    tagsText: "other",
    updatedAt: "2026-07-15T00:00:00.000Z",
  });

  const text = await getMobileConflictDraftClipboardText(scope, "memo-1");
  expect(text).toBe("# Queued title\n#demo\n\nqueued body");
  await clearMobileMemoDraft("memo-1");
});

test("rebases a newer local save when an older save finishes syncing", async () => {
  await queueMobileMemoUpdate("https://one.example", basePayload);

  let markUpdateStarted: (() => void) | undefined;
  const updateStarted = new Promise<void>((resolve) => {
    markUpdateStarted = resolve;
  });
  let resolveUpdate: ((memo: MemoDetail) => void) | undefined;
  const updateResponse = new Promise<MemoDetail>((resolve) => {
    resolveUpdate = resolve;
  });
  const syncedMemo = createMemo({ revision: 2, contentHash: "hash-2", contentMarkdown: "first" });
  const client = {
    createMemoEditSession: async () => ({ editSession: { id: "edit-1", baseRevision: 1, baseContentHash: "hash-1" } }),
    updateMemo: async () => {
      markUpdateStarted?.();
      return updateResponse.then((memo) => ({ memo }));
    },
  };

  const firstSync = syncMobileQueuedChanges(client as never, "https://one.example");
  await updateStarted;
  await queueMobileMemoUpdate("https://one.example", {
    ...basePayload,
    title: "Newest",
    contentMarkdown: "newest",
  });
  resolveUpdate?.(syncedMemo);
  await firstSync;

  const queued = (await listMobileSyncQueueItems("https://one.example"))[0];
  expect(queued?.payload.title).toBe("Newest");
  expect(queued?.payload.expectedRevision).toBe(2);
  expect(queued?.payload.expectedContentHash).toBe("hash-2");
});

test("syncs an offline create and reports its temporary id", async () => {
  await queueMobileMemoCreate("https://one.example", {
    memoId: "local:one",
    title: "Offline",
    contentMarkdown: "offline body",
    notebookId: "notebook-1",
    tags: ["offline"],
    createdAt: "2026-01-01T00:00:00.000Z",
  });
  const remoteMemo = createMemo({ id: "memo-remote", title: "Offline", contentMarkdown: "offline body" });
  let syncedTemporaryId = "";

  await syncMobileQueuedChanges({ createMemo: async () => ({ memo: remoteMemo }) } as never, "https://one.example", {
    onSynced: (_memo, item) => {
      syncedTemporaryId = item.memoId;
    },
  });

  expect(syncedTemporaryId).toBe("local:one");
  expect(await listMobileSyncQueueItems("https://one.example")).toHaveLength(0);
});

test("promotes an edit made while an offline create is syncing", async () => {
  const scope = "https://one.example";
  await queueMobileMemoCreate(scope, {
    memoId: "local:one",
    title: "Offline",
    contentMarkdown: "first",
    notebookId: "notebook-1",
    tags: [],
    createdAt: "2026-01-01T00:00:00.000Z",
  });
  let markCreateStarted: (() => void) | undefined;
  const createStarted = new Promise<void>((resolve) => {
    markCreateStarted = resolve;
  });
  let resolveCreate: ((memo: MemoDetail) => void) | undefined;
  const createResponse = new Promise<MemoDetail>((resolve) => {
    resolveCreate = resolve;
  });
  const client = {
    createMemo: async () => {
      markCreateStarted?.();
      return createResponse.then((memo) => ({ memo }));
    },
  };
  const sync = syncMobileQueuedChanges(client as never, scope);
  await createStarted;
  await queueMobileMemoUpdate(scope, {
    ...basePayload,
    memoId: "local:one",
    title: "Newest",
    contentMarkdown: "newest",
  });
  resolveCreate?.(createMemo({ id: "memo-remote", revision: 0, contentHash: "hash-remote" }));
  await sync;

  const queued = (await listMobileSyncQueueItems(scope))[0];
  expect(queued?.kind).toBe("memo.update");
  expect(queued?.memoId).toBe("memo-remote");
  expect(queued?.payload.title).toBe("Newest");
  expect(queued?.payload.expectedContentHash).toBe("hash-remote");
});

test("cancels queue items for a memo", async () => {
  const scope = "https://one.example";
  await queueMobileMemoCreate(scope, {
    memoId: "local:one",
    title: "Offline",
    contentMarkdown: "body",
    notebookId: "notebook-1",
    tags: [],
    createdAt: "2026-01-01T00:00:00.000Z",
  });
  await queueMobileMemoUpdate(scope, { ...basePayload, memoId: "memo-2" });

  await cancelMobileMemoQueueItems(scope, "local:one");

  const remaining = await listMobileSyncQueueItems(scope);
  expect(remaining).toHaveLength(1);
  expect(remaining[0]?.memoId).toBe("memo-2");
});

test("force sync ignores backoff and retries errored items immediately", async () => {
  const scope = "https://one.example";
  await queueMobileMemoUpdate(scope, basePayload);
  await markMobileMemoUpdateError(scope, "memo-1", "temporary outage");

  // Simulate exponential backoff far in the future.
  const items = await listMobileSyncQueueItems(scope);
  expect(items[0]?.status).toBe("error");

  let updateCalled = false;
  const client = {
    createMemoEditSession: async () => ({
      editSession: { id: "edit-1", baseRevision: 1, baseContentHash: "hash-1" },
    }),
    updateMemo: async () => {
      updateCalled = true;
      return { memo: createMemo({ revision: 2, contentHash: "hash-2", contentMarkdown: "first" }) };
    },
  };

  // Without force, a far-future nextAttemptAt would skip the item. Arm + force clears it.
  await armMobileSyncQueueImmediateRetry(scope);
  const result = await syncMobileQueuedChanges(client as never, scope, { force: true });

  expect(result.synced).toBe(1);
  expect(updateCalled).toBe(true);
  expect(await listMobileSyncQueueItems(scope)).toHaveLength(0);
});

test("clearMobileMemoUpdateQueueItem drops a stale outbox update after online save", async () => {
  const scope = "https://one.example";
  await queueMobileMemoUpdate(scope, basePayload);
  await clearMobileMemoUpdateQueueItem(scope, "memo-1");
  expect(await listMobileSyncQueueItems(scope)).toHaveLength(0);
});

test("content_conflict is classified as a conflict instead of a retryable error", async () => {
  const scope = "https://one.example";
  await queueMobileMemoUpdate(scope, basePayload);
  const result = await syncMobileQueuedChanges({
    createMemoEditSession: async () => ({
      editSession: { id: "edit-1", baseRevision: 1, baseContentHash: "hash-1" },
    }),
    updateMemo: async () => {
      throw new ApiRequestError("Note content changed after this edit session started.", 409, "content_conflict");
    },
  } as never, scope);

  const queued = (await listMobileSyncQueueItems(scope))[0];
  expect(result.conflicted).toBe(1);
  expect(result.failed).toBe(0);
  expect(queued?.status).toBe("conflict");
  expect(queued?.lastError).toContain("content changed");
});

test("soft-deletes the remote orphan when an offline create is cancelled mid-sync", async () => {
  const scope = "https://one.example";
  await queueMobileMemoCreate(scope, {
    memoId: "local:one",
    title: "Offline",
    contentMarkdown: "first",
    notebookId: "notebook-1",
    tags: [],
    createdAt: "2026-01-01T00:00:00.000Z",
  });
  let markCreateStarted: (() => void) | undefined;
  const createStarted = new Promise<void>((resolve) => {
    markCreateStarted = resolve;
  });
  let resolveCreate: ((memo: MemoDetail) => void) | undefined;
  const createResponse = new Promise<MemoDetail>((resolve) => {
    resolveCreate = resolve;
  });
  const deletedMemoIds: string[] = [];
  const client = {
    createMemo: async () => {
      markCreateStarted?.();
      return createResponse.then((memo) => ({ memo }));
    },
    deleteMemo: async (memoId: string) => {
      deletedMemoIds.push(memoId);
      return { ok: true as const };
    },
  };
  const sync = syncMobileQueuedChanges(client as never, scope);
  await createStarted;
  await cancelMobileMemoQueueItems(scope, "local:one");
  resolveCreate?.(createMemo({ id: "memo-remote", revision: 0, contentHash: "hash-remote" }));
  await sync;

  expect(deletedMemoIds).toEqual(["memo-remote"]);
  expect(await listMobileSyncQueueItems(scope)).toHaveLength(0);
});

const createMemo = (overrides: Partial<MemoDetail> = {}): MemoDetail => ({
  id: "memo-1",
  notebookId: "notebook-1",
  title: "First",
  excerpt: "first",
  tags: [],
  isPinned: false,
  isArchived: false,
  isDeleted: false,
  revision: 1,
  createdAt: "2026-01-01T00:00:00.000Z",
  updatedAt: "2026-01-01T00:00:00.000Z",
  deletedAt: null,
  contentJson: { type: "doc", content: [] },
  contentMarkdown: "first",
  contentText: "first",
  contentHash: "hash-1",
  sourceMemoIds: [],
  mergeSourceCount: 0,
  mergedIntoMemoId: null,
  ...overrides,
});
