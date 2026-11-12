import { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore } from "react";
import { useTranslation } from "react-i18next";
import Collaboration from "@tiptap/extension-collaboration";
import Placeholder from "@tiptap/extension-placeholder";
import { EditorContent, NodeViewWrapper, ReactNodeViewRenderer, useEditor, type NodeViewProps } from "@tiptap/react";
import * as Y from "yjs";
import { ArrowUpRight, ChevronDown, Copy, Lock, MoreHorizontal, RefreshCcw, Trash2, Unlink } from "lucide-react";
import { createPonderDocumentExtensions, SyncedBlock, type TiptapDoc } from "@ponder/shared";
import type { SyncedBlockView } from "@ponder/client";
import { createPonderMathematics } from "@ponder/shared/mathematics";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuLabel, DropdownMenuSeparator, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import { showActionToast } from "@/components/database/action-toast";
import { api } from "@/lib/api";
import { cn } from "@/lib/utils";
import { usePages } from "./PagesProvider";
import "@/styles/synced-ai-blocks.css";

/**
 * Notion's Synced block (Phase F of the Notion blocks plan). Ponder's own: AppFlowy has no synced
 * block. The page holds only `ponderSynced{syncedId}`; the content is a separate Yjs document on
 * the server (synced_blocks), edited here in a nested editor that every copy shares. Someone who
 * can see this page but not the original gets no content at all (synced-block-service.ts).
 */

const PUSH_DELAY_MS = 250;
const TICK_ACTIVE_MS = 1_500;
const TICK_IDLE_MS = 6_000;
const RETRY_MS = 4_000;

const encode = (bytes: Uint8Array) => {
  let binary = "";
  for (let index = 0; index < bytes.length; index += 0x8000) binary += String.fromCharCode(...bytes.subarray(index, index + 0x8000));
  return btoa(binary);
};
const decode = (text: string) => Uint8Array.from(atob(text), (character) => character.charCodeAt(0));

/** The block's shared document, kept in step with the server by polling, like the page's own live session. */
class SyncedBlockSession {
  doc = new Y.Doc();
  canEdit = false;
  /** Bumps when the server starts the block over (an AI edit or a restore); the editor remounts. */
  docKey = 0;
  private generation: number;
  private version: number;
  private pending: Uint8Array[] = [];
  private timer = 0;
  private busy = false;
  private stopped = false;
  private active = false;
  private readonly listeners = new Set<() => void>();

  constructor(private readonly id: string, private readonly memoId: string | null, view: SyncedBlockView) {
    this.generation = view.generation;
    this.version = view.version;
    this.canEdit = view.canEdit;
    if (view.state) Y.applyUpdate(this.doc, decode(view.state), this);
    this.doc.on("update", this.handleUpdate);
    document.addEventListener("visibilitychange", this.handleVisibility);
    this.schedule(TICK_IDLE_MS);
  }

  subscribe = (listener: () => void) => {
    this.listeners.add(listener);
    return () => { this.listeners.delete(listener); };
  };
  snapshot = () => this.docKey;

  /** Polls faster while someone is working in the block. */
  setActive(active: boolean) {
    this.active = active;
    if (active) this.schedule(0);
  }

  stop() {
    if (this.stopped) return;
    this.stopped = true;
    window.clearTimeout(this.timer);
    document.removeEventListener("visibilitychange", this.handleVisibility);
    this.doc.off("update", this.handleUpdate);
    // A last push, so an edit made just before leaving isn't lost.
    if (this.pending.length && this.canEdit) void this.tick(true);
  }

  private readonly handleUpdate = (update: Uint8Array, origin: unknown) => {
    if (origin === this || !this.canEdit) return;
    this.pending.push(update);
    this.schedule(PUSH_DELAY_MS);
  };

  private readonly handleVisibility = () => {
    if (document.visibilityState === "visible") this.schedule(0);
  };

  private schedule(delay: number) {
    if (this.stopped && delay > 0) return;
    window.clearTimeout(this.timer);
    this.timer = window.setTimeout(() => void this.tick(), delay);
  }

  private async tick(final = false) {
    if (this.busy) {
      if (!final) this.schedule(PUSH_DELAY_MS);
      return;
    }
    if (!final && document.visibilityState === "hidden" && this.pending.length === 0) {
      this.schedule(TICK_IDLE_MS);
      return;
    }
    this.busy = true;
    const outgoing = this.pending.length ? Y.mergeUpdates(this.pending) : null;
    this.pending = [];
    let next = this.active ? TICK_ACTIVE_MS : TICK_IDLE_MS;
    try {
      const result = await api.syncSyncedBlock(this.id, {
        memoId: this.memoId,
        generation: this.generation,
        version: this.version,
        ...(outgoing ? { update: encode(outgoing) } : {}),
        stateVector: encode(Y.encodeStateVector(this.doc)),
      });
      this.canEdit = result.canEdit;
      this.generation = result.generation;
      this.version = result.version;
      if (result.reset) {
        // Started over on the server: a fresh document, and any unsent edit is dropped, as the page does.
        this.doc.off("update", this.handleUpdate);
        this.doc = new Y.Doc();
        Y.applyUpdate(this.doc, decode(result.state), this);
        this.doc.on("update", this.handleUpdate);
        this.docKey += 1;
        this.listeners.forEach((listener) => listener());
      } else if (result.update) {
        Y.applyUpdate(this.doc, decode(result.update), this);
      }
    } catch {
      if (outgoing) this.pending.unshift(outgoing);
      next = RETRY_MS;
    } finally {
      this.busy = false;
    }
    if (!this.stopped) this.schedule(this.pending.length ? PUSH_DELAY_MS : next);
  }
}

type SyncedBlockOptions = { getPageId: () => string | null };

/** The page-free extensions the nested editor uses: the same document schema as the server's. */
const innerExtensions = (doc: Y.Doc, placeholder: string) => [
  ...createPonderDocumentExtensions({ mathematics: createPonderMathematics(), starterKit: { undoRedo: false } }),
  Collaboration.configure({ document: doc, field: "default" }),
  Placeholder.configure({ placeholder }),
];

const InnerEditor = ({ session, editable, autoFocus, onAutoFocused, onReady, onFocusChange }: {
  session: SyncedBlockSession;
  editable: boolean;
  autoFocus: boolean;
  onAutoFocused: () => void;
  onReady: (getJson: () => TiptapDoc | null) => void;
  onFocusChange: (focused: boolean) => void;
}) => {
  const { t } = useTranslation();
  const docKey = useSyncExternalStore(session.subscribe, session.snapshot);
  const editor = useEditor({
    extensions: innerExtensions(session.doc, t("pages.synced.placeholder")),
    editable,
    editorProps: { attributes: { class: "ponder-synced-editor prose prose-slate max-w-none focus:outline-none" } },
    onFocus: () => onFocusChange(true),
    onBlur: () => onFocusChange(false),
  }, [docKey]);
  useEffect(() => {
    if (editor && editor.isEditable !== editable) editor.setEditable(editable);
  }, [editor, editable]);
  useEffect(() => {
    onReady(() => (editor ? editor.getJSON() as TiptapDoc : null));
  }, [editor, onReady]);
  // Like Notion, a block just made with /synced takes the cursor, so typing goes inside it.
  useEffect(() => {
    if (!editor || !autoFocus || !editable) return;
    onAutoFocused();
    editor.commands.focus("end");
  }, [editor, autoFocus, editable, onAutoFocused]);
  return <EditorContent editor={editor} className="ponder-synced-body" />;
};

const SyncedBlockNodeView = ({ node, editor, extension, getPos, selected, updateAttributes, deleteNode }: NodeViewProps) => {
  const { t } = useTranslation();
  const pages = usePages();
  const syncedId = String(node.attrs.syncedId ?? "");
  const pageId = (extension.options as SyncedBlockOptions).getPageId();
  const [editable, setEditable] = useState(editor.isEditable);
  const [view, setView] = useState<SyncedBlockView | null>(null);
  const [failed, setFailed] = useState<"missing" | "error" | null>(null);
  const [session, setSession] = useState<SyncedBlockSession | null>(null);
  const [menuOpen, setMenuOpen] = useState(false);
  const [query, setQuery] = useState("");
  const creating = useRef(false);
  const [focusNew, setFocusNew] = useState(false);
  const clearFocusNew = useCallback(() => setFocusNew(false), []);
  const innerJson = useRef<() => TiptapDoc | null>(() => null);
  const handleInnerReady = useCallback((getJson: () => TiptapDoc | null) => { innerJson.current = getJson; }, []);

  useEffect(() => {
    const sync = () => setEditable(editor.isEditable);
    sync();
    editor.on("transaction", sync);
    return () => { editor.off("transaction", sync); };
  }, [editor]);

  // A new /synced block gets its shared document on the server the first time it shows.
  useEffect(() => {
    if (syncedId || !editable || !pageId || creating.current) return;
    creating.current = true;
    api.createSyncedBlock(pageId)
      .then(({ id }) => {
        setFocusNew(true);
        updateAttributes({ syncedId: id });
      })
      .catch(() => setFailed("error"))
      .finally(() => { creating.current = false; });
  }, [editable, pageId, syncedId, updateAttributes]);

  const load = useCallback(async () => {
    if (!syncedId) return;
    try {
      const { block } = await api.getSyncedBlock(syncedId, pageId);
      setView(block);
      setFailed(null);
    } catch (error) {
      setFailed((error as { status?: number }).status === 404 ? "missing" : "error");
    }
  }, [pageId, syncedId]);
  useEffect(() => { void load(); }, [load]);

  useEffect(() => {
    if (!view?.canRead) return;
    const next = new SyncedBlockSession(view.id, pageId, view);
    setSession(next);
    return () => {
      next.stop();
      setSession(null);
    };
    // A new session only for another block or page, not for each refresh of the page list.
  }, [view?.id, view?.canRead, pageId]); // eslint-disable-line react-hooks/exhaustive-deps

  const isOriginal = Boolean(view && (!pageId || view.sourceMemoId === pageId));
  // A copy is on at least two pages (its own and the original's), even before this page's save lands.
  const pageCount = Math.max(view?.pageCount ?? 1, isOriginal ? 1 : 2);
  const statusLabel = isOriginal ? t("pages.synced.editingOriginal") : t("pages.synced.editingIn", { count: pageCount });
  const canEditContent = editable && Boolean(view?.canEdit);

  const range = () => {
    const pos = getPos();
    return typeof pos === "number" ? { from: pos, to: pos + node.nodeSize } : null;
  };

  const copyAndSync = async () => {
    const html = `<div data-type="ponder-synced" data-synced-id="${syncedId}"></div>`;
    const text = `<ponder-synced id="${syncedId}"></ponder-synced>`;
    // A copy event writes both formats without asking for clipboard permission, as Notion's button does.
    let copied = false;
    const onCopy = (event: ClipboardEvent) => {
      event.preventDefault();
      event.clipboardData?.setData("text/html", html);
      event.clipboardData?.setData("text/plain", text);
      copied = Boolean(event.clipboardData);
    };
    document.addEventListener("copy", onCopy, true);
    try {
      document.execCommand("copy");
    } catch {
      copied = false;
    } finally {
      document.removeEventListener("copy", onCopy, true);
    }
    try {
      if (!copied && typeof ClipboardItem !== "undefined" && navigator.clipboard?.write) {
        await navigator.clipboard.write([new ClipboardItem({ "text/html": new Blob([html], { type: "text/html" }), "text/plain": new Blob([text], { type: "text/plain" }) })]);
        copied = true;
      }
    } catch {
      copied = false;
    }
    if (copied) showActionToast(t("pages.synced.copied"), { dismissLabel: t("common.close") });
    else showActionToast(t("pages.synced.copyFailed"), { tone: "error", dismissLabel: t("common.close") });
  };

  /** Puts this copy's content in place of the block, as ordinary blocks. */
  const unsyncHere = () => {
    const target = range();
    const doc = innerJson.current();
    if (!target || !doc) return;
    const blocks = (doc.content ?? []).filter((block) => block.type !== node.type.name);
    editor.chain().focus().insertContentAt(target, blocks.length ? blocks : [{ type: "paragraph" }]).run();
  };

  const unsyncAll = async () => {
    try {
      const result = await api.unsyncAllSyncedBlock(syncedId);
      unsyncHere();
      if (result.skipped) showActionToast(t("pages.synced.unsyncSkipped", { count: result.skipped }), { dismissLabel: t("common.close") });
    } catch {
      showActionToast(t("pages.synced.unsyncFailed"), { tone: "error", dismissLabel: t("common.close") });
    }
  };

  const openPage = (memoId: string) => {
    const page = pages?.getPage(memoId);
    if (page) pages?.openPage(page);
  };

  const actions = useMemo(() => {
    const list: Array<{ key: string; label: string; icon: typeof Copy; run: () => void; shortcut?: string; show: boolean }> = [
      { key: "copy", label: t("pages.synced.copyAndSync"), icon: Copy, run: () => void copyAndSync(), show: Boolean(view?.canRead) },
      { key: "unsync", label: t("pages.synced.unsync"), icon: Unlink, run: unsyncHere, show: editable && Boolean(view?.canRead) && !isOriginal },
      { key: "unsync-all", label: t("pages.synced.unsyncAll"), icon: Unlink, run: () => void unsyncAll(), show: editable && isOriginal && Boolean(view?.canEdit) },
      { key: "original", label: t("pages.synced.goToOriginal"), icon: ArrowUpRight, run: () => view && openPage(view.sourceMemoId), show: Boolean(view?.canRead) && !isOriginal },
      { key: "refresh", label: t("pages.synced.refresh"), icon: RefreshCcw, run: () => void load(), show: true },
      { key: "delete", label: t("pages.synced.delete"), icon: Trash2, run: deleteNode, show: editable },
    ];
    const needle = query.trim().toLowerCase();
    return list.filter((action) => action.show && (!needle || action.label.toLowerCase().includes(needle)));
  }, [deleteNode, editable, isOriginal, load, query, t, view]); // eslint-disable-line react-hooks/exhaustive-deps

  const pageList = (
    <>
      <DropdownMenuLabel className="text-xs font-medium text-slate-500 dark:text-slate-400">{t("pages.synced.syncedTo")}</DropdownMenuLabel>
      {(view?.pages ?? []).map((page) => (
        <DropdownMenuItem key={page.memoId} onSelect={() => openPage(page.memoId)} className="gap-2">
          <span className="min-w-0 flex-1 truncate">{page.title || t("common.untitledMemo")}</span>
          {page.isOriginal ? <span className="ponder-synced-original-tag">{t("pages.synced.original")}</span> : null}
          {page.memoId === pageId ? <span className="text-xs text-slate-400">{t("pages.synced.thisPage")}</span> : null}
        </DropdownMenuItem>
      ))}
      {view && view.pageCount > view.pages.length ? (
        <div className="px-2 py-1 text-xs text-slate-500 dark:text-slate-400">{t("pages.synced.hiddenPages", { count: view.pageCount - view.pages.length })}</div>
      ) : null}
    </>
  );

  if (!syncedId || (!view && !failed)) {
    return (
      <NodeViewWrapper className="ponder-synced-block is-loading" contentEditable={false} data-drag-handle="">
        <div className="ponder-synced-placeholder">{failed === "error" ? t("pages.synced.loadFailed") : t("pages.synced.loading")}</div>
      </NodeViewWrapper>
    );
  }

  if (failed || !view?.canRead) {
    return (
      <NodeViewWrapper className={cn("ponder-synced-block is-locked", selected && "is-selected")} contentEditable={false} data-drag-handle="">
        <div className="ponder-synced-placeholder">
          <Lock className="h-4 w-4 shrink-0" aria-hidden="true" />
          <span>{failed === "missing" ? t("pages.synced.missing") : failed === "error" ? t("pages.synced.loadFailed") : t("pages.synced.noAccess")}</span>
        </div>
      </NodeViewWrapper>
    );
  }

  return (
    <NodeViewWrapper className={cn("ponder-synced-block", selected && "is-selected", menuOpen && "is-open")} data-synced-id={syncedId}>
      <div className="ponder-synced-toolbar" contentEditable={false}>
        <DropdownMenu modal={false} onOpenChange={(open) => { if (open) void load(); }}>
          <DropdownMenuTrigger asChild>
            <button type="button" className="ponder-synced-status" onMouseDown={(event) => event.preventDefault()}>
              {statusLabel}
              <ChevronDown className="h-3.5 w-3.5" aria-hidden="true" />
            </button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="w-64" onCloseAutoFocus={(event) => event.preventDefault()}>
            {pageList}
          </DropdownMenuContent>
        </DropdownMenu>
        <span className="ponder-synced-divider" aria-hidden="true" />
        <TooltipProvider delayDuration={300}>
          <Tooltip>
            <TooltipTrigger asChild>
              <button type="button" className="ponder-synced-icon" aria-label={t("pages.synced.copyTooltip")} onMouseDown={(event) => event.preventDefault()} onClick={() => void copyAndSync()}>
                <Copy className="h-3.5 w-3.5" aria-hidden="true" />
              </button>
            </TooltipTrigger>
            <TooltipContent side="top">{t("pages.synced.copyTooltip")}</TooltipContent>
          </Tooltip>
          <DropdownMenu open={menuOpen} onOpenChange={(open) => { setMenuOpen(open); if (open) void load(); else setQuery(""); }} modal={false}>
            <Tooltip>
              <TooltipTrigger asChild>
                <DropdownMenuTrigger asChild>
                  <button type="button" className="ponder-synced-icon" aria-label={t("pages.synced.more")} onMouseDown={(event) => event.preventDefault()}>
                    <MoreHorizontal className="h-4 w-4" aria-hidden="true" />
                  </button>
                </DropdownMenuTrigger>
              </TooltipTrigger>
              <TooltipContent side="top">{t("pages.synced.more")}</TooltipContent>
            </Tooltip>
            <DropdownMenuContent align="end" className="w-64" onCloseAutoFocus={(event) => event.preventDefault()}>
              <div className="px-1 pb-1">
                <input
                  className="ponder-synced-search"
                  placeholder={t("pages.synced.searchActions")}
                  aria-label={t("pages.synced.searchActions")}
                  value={query}
                  onChange={(event) => setQuery(event.target.value)}
                  onKeyDown={(event) => event.stopPropagation()}
                  autoFocus
                />
              </div>
              <DropdownMenuLabel className="text-xs font-medium text-slate-500 dark:text-slate-400">{t("pages.synced.section")}</DropdownMenuLabel>
              {actions.map((action) => (
                <DropdownMenuItem key={action.key} onSelect={action.run} className="gap-2">
                  <action.icon className="h-4 w-4" aria-hidden="true" />
                  {action.label}
                </DropdownMenuItem>
              ))}
              {actions.length === 0 ? <div className="px-2 py-1.5 text-sm text-slate-500">{t("pages.synced.noActions")}</div> : null}
              <DropdownMenuSeparator />
              {pageList}
            </DropdownMenuContent>
          </DropdownMenu>
        </TooltipProvider>
      </div>
      {session ? (
        <InnerEditor
          session={session}
          editable={canEditContent}
          autoFocus={focusNew}
          onAutoFocused={clearFocusNew}
          onReady={handleInnerReady}
          onFocusChange={(focused) => session.setActive(focused)}
        />
      ) : null}
    </NodeViewWrapper>
  );
};

export const EditorSyncedBlock = SyncedBlock.extend<SyncedBlockOptions>({
  addOptions() {
    return { getPageId: () => null };
  },
  addNodeView() {
    return ReactNodeViewRenderer(SyncedBlockNodeView, {
      // The nested editor, the toolbar and its menus handle their own events.
      stopEvent: ({ event }) => event.target instanceof Element && Boolean(event.target.closest(".ponder-synced-body, .ponder-synced-toolbar")),
      ignoreMutation: () => true,
    });
  },
});
