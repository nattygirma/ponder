import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { useTranslation } from "react-i18next";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useLocation } from "react-router";
import type { PageNode, PageStyle } from "@ponder/shared";
import { api } from "@/lib/api";
import { subscribeRepositoryMutations } from "@/lib/repository-events";
import type { PonderRepository } from "@/lib/repository";

export type WorkspaceLayout = "pages" | "notes";

/** Read once at startup, because routing clears the address's #block= before the page tree has loaded. */
const LINKED_BLOCK_ID = typeof window === "undefined" ? undefined : /^#block=([\w-]+)$/.exec(window.location.hash)?.[1];

const LAYOUT_KEY = "ponder.workspace.layout";
const EXPANDED_KEY = "ponder.pages.expanded";
const RECENT_KEY = "ponder.pages.recent";
const RECENT_LIMIT = 20;
const PAGE_LINK_PARAM = "p";
const SYNC_REFRESH_DELAY_MS = 5_000;
export const PAGE_TREE_QUERY_KEY = ["page-tree"] as const;

const readLayout = (): WorkspaceLayout => {
  try {
    return window.localStorage.getItem(LAYOUT_KEY) === "notes" ? "notes" : "pages";
  } catch {
    return "pages";
  }
};

const readExpanded = () => {
  try {
    const parsed = JSON.parse(window.localStorage.getItem(EXPANDED_KEY) ?? "[]") as unknown;
    return new Set(Array.isArray(parsed) ? parsed.filter((id): id is string => typeof id === "string") : []);
  } catch {
    return new Set<string>();
  }
};

const readRecent = (): string[] => {
  try {
    const parsed = JSON.parse(window.localStorage.getItem(RECENT_KEY) ?? "[]") as unknown;
    return Array.isArray(parsed) ? parsed.filter((id): id is string => typeof id === "string") : [];
  } catch {
    return [];
  }
};

export const useWorkspaceLayoutPreference = () => {
  // Pages need the server's page tree, so the offline desktop client stays on the note list.
  const supported = typeof window === "undefined" || !window.ponderDesktop?.isAvailable;
  const [layout, setLayoutState] = useState<WorkspaceLayout>(() => (supported ? readLayout() : "notes"));
  const setLayout = useCallback((next: WorkspaceLayout) => {
    setLayoutState(next);
    try {
      window.localStorage.setItem(LAYOUT_KEY, next);
    } catch {
      // A remembered layout is a convenience; the choice still applies to this session.
    }
  }, []);
  return { layout, setLayout, supported };
};

export type PagesController = {
  /** The block a link on this page load pointed at, until the editor has shown it. */
  blockLinkFor: (pageId: string) => string | null;
  clearBlockLink: () => void;
  enabled: boolean;
  repository: PonderRepository;
  layout: WorkspaceLayout;
  setLayout: (layout: WorkspaceLayout) => void;
  layoutSupported: boolean;
  /** The notebook whose pages are shown as the top level of the sidebar. */
  rootNotebookId: string | null;
  nodes: PageNode[];
  /** Pages this browser opened last, topped up with the most recently edited. */
  recentPages: (limit: number) => PageNode[];
  /** Shows a title being typed in the tree before it has been saved. */
  renameLocally: (pageId: string, title: string) => void;
  toggleFavorite: (pageId: string) => void;
  /** A link that opens this page, for pasting elsewhere. */
  pageLink: (pageId: string) => string;
  truncated: boolean;
  selectedPageId: string | null;
  rootsOf: (notebookId: string) => PageNode[];
  childrenOf: (pageId: string) => PageNode[];
  getPage: (pageId: string) => PageNode | undefined;
  ancestorsOf: (pageId: string) => PageNode[];
  notebookName: (notebookId: string) => string;
  isExpanded: (pageId: string) => boolean;
  setExpanded: (pageId: string, expanded: boolean) => void;
  openPage: (page: Pick<PageNode, "id" | "notebookId">) => void;
  createPage: (input: { notebookId?: string; parentId?: string | null; title?: string; reveal?: boolean }) => Promise<PageNode | null>;
  /** Creates a full-page database. Without a parent it goes in the selected notebook, or the top level with `root`. */
  createDatabase: (input: { parentId?: string | null; root?: boolean }) => Promise<void>;
  movePage: (id: string, input: { notebookId?: string; parentId?: string | null; beforeId?: string | null; afterId?: string | null }) => Promise<void>;
  updatePage: (id: string, input: { icon?: string | null; cover?: string | null; style?: PageStyle | null }) => Promise<void>;
  deletePage: (page: PageNode) => Promise<void>;
  refresh: () => void;
};

const PagesContext = createContext<PagesController | null>(null);

export const usePages = () => useContext(PagesContext);

export const PagesProvider = ({
  enabled,
  repository,
  layout,
  setLayout,
  layoutSupported,
  scope,
  selectedMemoId,
  notebookNames,
  defaultNotebookId,
  rootNotebookId,
  pageLinks,
  onTogglePin,
  onOpenPage,
  onDeletePage,
  onPageCreated,
  children,
}: {
  repository: PonderRepository;
  enabled: boolean;
  layout: WorkspaceLayout;
  setLayout: (layout: WorkspaceLayout) => void;
  layoutSupported: boolean;
  scope: string;
  selectedMemoId: string | null;
  notebookNames: ReadonlyMap<string, string>;
  defaultNotebookId: string | null;
  rootNotebookId: string | null;
  /** Keep the open page in the address bar. Off on phones, where the back button drives the panes. */
  pageLinks: boolean;
  onTogglePin: (id: string, isPinned: boolean) => void;
  onOpenPage: (id: string, notebookId: string) => void;
  onDeletePage: (id: string) => Promise<unknown>;
  onPageCreated: (memo: Awaited<ReturnType<typeof api.createPage>>["memo"]) => void;
  children: ReactNode;
}) => {
  const queryClient = useQueryClient();
  const { t } = useTranslation();
  const treeQuery = useQuery({
    queryKey: PAGE_TREE_QUERY_KEY,
    queryFn: () => api.getPageTree(),
    enabled,
    staleTime: 30_000,
  });
  const [expanded, setExpandedState] = useState(readExpanded);
  const [recentIds, setRecentIds] = useState(readRecent);
  const pageLinkHandled = useRef(false);
  const syncRefreshTimer = useRef<number | null>(null);

  const refresh = useCallback(() => {
    void queryClient.invalidateQueries({ queryKey: PAGE_TREE_QUERY_KEY });
  }, [queryClient]);

  useEffect(() => {
    if (!enabled) return undefined;
    return subscribeRepositoryMutations(scope, (event) => {
      if (event.type === "note.updated") {
        // A title edit lands on every keystroke-driven save, so patch the row instead of refetching the tree.
        const { note } = event;
        queryClient.setQueryData<{ pages: PageNode[]; truncated: boolean }>(PAGE_TREE_QUERY_KEY, (current) => {
          if (!current) return current;
          const existing = current.pages.find((page) => page.id === note.id);
          if (!existing) return current;
          if (existing.title === note.title && existing.notebookId === note.notebookId) return current;
          return {
            ...current,
            pages: current.pages.map((page) => (page.id === note.id ? { ...page, title: note.title, notebookId: note.notebookId } : page)),
          };
        });
        return;
      }
      if (event.type === "note.created" || event.type === "note.deleted") {
        refresh();
        return;
      }
      // Every save comes back through sync, so one tree read covers a whole burst of typing.
      if (event.type === "workspace.synced" && (event.bootstrapped || event.changed > 0) && syncRefreshTimer.current === null) {
        syncRefreshTimer.current = window.setTimeout(() => {
          syncRefreshTimer.current = null;
          refresh();
        }, SYNC_REFRESH_DELAY_MS);
      }
    });
  }, [enabled, queryClient, refresh, scope]);

  useEffect(() => () => {
    if (syncRefreshTimer.current !== null) window.clearTimeout(syncRefreshTimer.current);
    syncRefreshTimer.current = null;
  }, []);

  const nodes = treeQuery.data?.pages ?? EMPTY_PAGES;
  const index = useMemo(() => {
    const byId = new Map(nodes.map((node) => [node.id, node]));
    const byParent = new Map<string, PageNode[]>();
    const rootsByNotebook = new Map<string, PageNode[]>();
    for (const node of nodes) {
      // A parent that was deleted or left behind in another notebook must not hide its child.
      const parent = node.parentId ? byId.get(node.parentId) : undefined;
      if (parent && parent.notebookId === node.notebookId) {
        byParent.set(parent.id, [...(byParent.get(parent.id) ?? []), node]);
      } else {
        rootsByNotebook.set(node.notebookId, [...(rootsByNotebook.get(node.notebookId) ?? []), node]);
      }
    }
    return { byId, byParent, rootsByNotebook };
  }, [nodes]);

  useEffect(() => {
    if (!enabled || !selectedMemoId) return;
    setRecentIds((current) => {
      if (current[0] === selectedMemoId) return current;
      const next = [selectedMemoId, ...current.filter((id) => id !== selectedMemoId)].slice(0, RECENT_LIMIT);
      try {
        window.localStorage.setItem(RECENT_KEY, JSON.stringify(next));
      } catch {
        // Recents are a convenience; without storage they last for this visit.
      }
      return next;
    });
  }, [enabled, selectedMemoId]);

  const treeLoaded = Boolean(treeQuery.data);
  const blockLinkRef = useRef<{ pageId: string; blockId: string } | null>(null);
  // Opening a page routes to the workspace root, which drops ?p= after this has set it.
  const routerLocationKey = useLocation().key;
  useEffect(() => {
    if (!enabled || !pageLinks || pageLinkHandled.current || !treeLoaded) return;
    pageLinkHandled.current = true;
    const linked = new URLSearchParams(window.location.search).get(PAGE_LINK_PARAM);
    if (!linked) return;
    if (LINKED_BLOCK_ID) blockLinkRef.current = { pageId: linked, blockId: LINKED_BLOCK_ID };
    const page = index.byId.get(linked);
    if (page) {
      onOpenPage(page.id, page.notebookId);
      return;
    }
    // Database rows aren't in the page tree, so ask whether this one exists and is visible.
    void repository.getMemo(linked)
      .then(({ memo }) => onOpenPage(memo.id, memo.notebookId))
      .catch(() => undefined);
  }, [enabled, index, onOpenPage, pageLinks, repository, treeLoaded]);

  useEffect(() => {
    if (!enabled || !pageLinks || !pageLinkHandled.current) return;
    const url = new URL(window.location.href);
    if ((url.searchParams.get(PAGE_LINK_PARAM) ?? null) === selectedMemoId) return;
    if (selectedMemoId) url.searchParams.set(PAGE_LINK_PARAM, selectedMemoId);
    else url.searchParams.delete(PAGE_LINK_PARAM);
    window.history.replaceState(window.history.state, "", url);
  }, [enabled, pageLinks, routerLocationKey, selectedMemoId, treeLoaded]);

  const setExpanded = useCallback((pageId: string, next: boolean) => {
    setExpandedState((current) => {
      const updated = new Set(current);
      if (next) updated.add(pageId);
      else updated.delete(pageId);
      try {
        window.localStorage.setItem(EXPANDED_KEY, JSON.stringify([...updated]));
      } catch {
        // Expansion is remembered per browser when storage allows it.
      }
      return updated;
    });
  }, []);

  const value = useMemo<PagesController>(() => ({
    blockLinkFor: (pageId) => (blockLinkRef.current?.pageId === pageId ? blockLinkRef.current.blockId : null),
    clearBlockLink: () => { blockLinkRef.current = null; },
    enabled,
    repository,
    layout,
    setLayout,
    layoutSupported,
    rootNotebookId,
    nodes,
    recentPages: (limit) => {
      const seen = new Set<string>();
      const result: PageNode[] = [];
      const add = (page: PageNode | undefined) => {
        if (page && !seen.has(page.id) && result.length < limit) {
          seen.add(page.id);
          result.push(page);
        }
      };
      recentIds.forEach((id) => add(index.byId.get(id)));
      [...nodes].sort((a, b) => b.updatedAt.localeCompare(a.updatedAt)).forEach(add);
      return result;
    },
    renameLocally: (pageId, title) => {
      queryClient.setQueryData<{ pages: PageNode[]; truncated: boolean }>(PAGE_TREE_QUERY_KEY, (current) => {
        if (!current?.pages.some((node) => node.id === pageId && node.title !== title)) return current;
        return { ...current, pages: current.pages.map((node) => (node.id === pageId ? { ...node, title } : node)) };
      });
    },
    toggleFavorite: (pageId) => {
      const page = index.byId.get(pageId);
      if (!page) return;
      const isPinned = !page.isPinned;
      queryClient.setQueryData<{ pages: PageNode[]; truncated: boolean }>(PAGE_TREE_QUERY_KEY, (current) => (
        current ? { ...current, pages: current.pages.map((node) => (node.id === pageId ? { ...node, isPinned } : node)) } : current
      ));
      onTogglePin(pageId, isPinned);
    },
    pageLink: (pageId) => {
      const url = new URL(window.location.href);
      url.search = "";
      url.hash = "";
      url.searchParams.set(PAGE_LINK_PARAM, pageId);
      return url.toString();
    },
    truncated: treeQuery.data?.truncated ?? false,
    selectedPageId: selectedMemoId,
    rootsOf: (notebookId) => index.rootsByNotebook.get(notebookId) ?? EMPTY_PAGES,
    childrenOf: (pageId) => index.byParent.get(pageId) ?? EMPTY_PAGES,
    getPage: (pageId) => index.byId.get(pageId),
    ancestorsOf: (pageId) => {
      const chain: PageNode[] = [];
      const seen = new Set([pageId]);
      let current = index.byId.get(pageId);
      while (current?.parentId && !seen.has(current.parentId)) {
        const parent = index.byId.get(current.parentId);
        if (!parent || parent.notebookId !== current.notebookId) break;
        chain.unshift(parent);
        seen.add(parent.id);
        current = parent;
      }
      return chain;
    },
    notebookName: (notebookId) => notebookNames.get(notebookId) ?? "",
    isExpanded: (pageId) => expanded.has(pageId),
    setExpanded,
    openPage: (page) => onOpenPage(page.id, page.notebookId),
    createPage: async (input) => {
      const { reveal = true, ...payload } = input;
      const created = await api.createPage(payload);
      if (input.parentId) setExpanded(input.parentId, true);
      await queryClient.invalidateQueries({ queryKey: PAGE_TREE_QUERY_KEY });
      if (reveal) onPageCreated(created.memo);
      return created.page;
    },
    createDatabase: async ({ parentId, root }) => {
      const notebookId = parentId ? undefined : (root ? rootNotebookId : defaultNotebookId) ?? undefined;
      if (!parentId && !notebookId) return;
      const { database } = await api.createDatabase({ parentId: parentId ?? undefined, notebookId, title: t("pages.db.newTitle") });
      if (parentId) setExpanded(parentId, true);
      await queryClient.invalidateQueries({ queryKey: PAGE_TREE_QUERY_KEY });
      await queryClient.invalidateQueries({ queryKey: ["memos"] });
      onOpenPage(database.pageMemoId, database.notebookId);
    },
    movePage: async (id, input) => {
      await api.movePage(id, input);
      if (input.parentId) setExpanded(input.parentId, true);
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: PAGE_TREE_QUERY_KEY }),
        queryClient.invalidateQueries({ queryKey: ["memos"] }),
      ]);
    },
    updatePage: async (id, input) => {
      const { page } = await api.updatePage(id, input);
      queryClient.setQueryData<{ pages: PageNode[]; truncated: boolean }>(PAGE_TREE_QUERY_KEY, (current) => (
        current ? { ...current, pages: current.pages.map((node) => (node.id === id ? { ...node, ...page } : node)) } : current
      ));
      // Database rows aren't in the tree; their icon and cover come from the row query.
      if (!index.byId.has(id)) {
        await Promise.all([
          queryClient.invalidateQueries({ queryKey: ["database-row-context", id] }),
          queryClient.invalidateQueries({ queryKey: ["database-rows"] }),
        ]);
      }
    },
    deletePage: async (page) => {
      await onDeletePage(page.id);
      await queryClient.invalidateQueries({ queryKey: PAGE_TREE_QUERY_KEY });
    },
    refresh,
  }), [repository, enabled, layout, setLayout, layoutSupported, rootNotebookId, recentIds, onTogglePin, expanded, index, nodes, notebookNames, defaultNotebookId, t, onDeletePage, onOpenPage, onPageCreated, queryClient, refresh, selectedMemoId, setExpanded, treeQuery.data?.truncated]);

  return <PagesContext.Provider value={value}>{children}</PagesContext.Provider>;
};

const EMPTY_PAGES: PageNode[] = [];
