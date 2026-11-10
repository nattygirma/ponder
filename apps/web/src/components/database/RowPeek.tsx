import { useEffect, useRef } from "react";
import { createPortal } from "react-dom";
import { useQuery } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import { ChevronsRight, Maximize2 } from "lucide-react";
import Collaboration from "@tiptap/extension-collaboration";
import { EditorContent, useEditor } from "@tiptap/react";
import {
  createPonderDocumentExtensions,
  resolveMemoContentDoc,
  type DatabaseProperty,
  type DatabaseRow,
  type MemoDetail,
} from "@ponder/shared";
import { createPonderMathematics } from "@ponder/shared/mathematics";
import { PageBlockAttributes } from "@ponder/shared/page-color";
import { createLocalEditSession } from "@/components/editor/editor-pane-helpers";
import { usePages } from "@/components/pages/PagesProvider";
import { useCollabSession, type HttpYjsProvider } from "@/components/teams/collab";
import { useViewer } from "@/components/teams/Teams";
import { DatabaseCell } from "./DatabaseCell";
import type { DatabaseHandle } from "./useDatabase";

const SAVE_DELAY_MS = 600;

const PeekEditor = ({ memoId, collab, rowTitle }: { memoId: string; collab: HttpYjsProvider | null; rowTitle: string }) => {
  const { t } = useTranslation();
  const pages = usePages()!;
  const repository = pages.repository;
  const memoQuery = useQuery({
    queryKey: ["row-peek", memoId],
    queryFn: async () => (await repository.getMemo(memoId) as { memo: MemoDetail }).memo,
    enabled: !collab,
    gcTime: 0,
    staleTime: 0,
  });
  const memo = memoQuery.data;
  const memoRef = useRef<MemoDetail | null>(null);
  const titleRef = useRef(rowTitle);
  titleRef.current = rowTitle;
  const timer = useRef(0);
  const dirty = useRef(false);
  const saving = useRef<Promise<unknown>>(Promise.resolve());

  const editor = useEditor({
    editable: collab ? collab.canEdit : false,
    extensions: [
      ...createPonderDocumentExtensions({
        mathematics: createPonderMathematics({ onInlineClick: () => undefined, onBlockClick: () => undefined }),
        markdown: true,
        ...(collab ? { starterKit: { undoRedo: false as const } } : {}),
      }),
      PageBlockAttributes,
      ...(collab ? [Collaboration.configure({ document: collab.doc, field: "default" })] : []),
    ],
    onUpdate: () => {
      if (collab) return;
      dirty.current = true;
      window.clearTimeout(timer.current);
      timer.current = window.setTimeout(() => flushRef.current(), SAVE_DELAY_MS);
    },
  }, [collab]);

  const flushRef = useRef<() => void>(() => undefined);
  flushRef.current = () => {
    window.clearTimeout(timer.current);
    if (!dirty.current || !editor) return;
    dirty.current = false;
    const contentJson = editor.getJSON();
    saving.current = saving.current.then(async () => {
      if (!memoRef.current) return;
      // Reread it: an earlier save may have reached the server and moved the version this one builds on.
      const { memo: current } = await repository.getMemo(memoId) as { memo: MemoDetail };
      const result = await repository.updateMemo(current, {
        expectedRevision: current.revision,
        expectedContentHash: current.contentHash,
        editSessionId: createLocalEditSession(current).id,
        title: titleRef.current,
        contentJson,
        tags: current.tags,
      });
      memoRef.current = result.memo;
    }).catch(() => {
      dirty.current = true;
    });
  };

  useEffect(() => {
    if (collab || !editor || !memo || memoRef.current?.id === memo.id) return;
    memoRef.current = memo;
    const doc = resolveMemoContentDoc(memo.contentJson, memo.contentMarkdown);
    try {
      // A block this small editor doesn't know must not be lost by saving over it.
      editor.schema.nodeFromJSON(doc).check();
    } catch {
      editor.setEditable(false, false);
      return;
    }
    editor.commands.setContent(doc, { emitUpdate: false });
    // Without the second argument this counts as an edit and rewrites the row just by opening it.
    editor.setEditable(true, false);
  }, [collab, editor, memo]);

  useEffect(() => () => flushRef.current(), []);

  return (
    <div data-row-peek-body>
      <EditorContent editor={editor} className="min-h-40 outline-none [&_.ProseMirror]:min-h-40 [&_.ProseMirror]:outline-none" aria-label={t("pages.peek.body")} />
    </div>
  );
};

const PeekBody = ({ memoId, rowTitle }: { memoId: string; rowTitle: string }) => {
  const { t } = useTranslation();
  const viewer = useViewer();
  const collabMemoId = viewer?.teamRole ? memoId : null;
  const collab = useCollabSession(collabMemoId, viewer);
  if (collabMemoId && !collab.provider) {
    return <p className="text-sm text-slate-500" role="status">{collab.failed ? t("pages.collab.failed") : t("pages.collab.opening")}</p>;
  }
  return <PeekEditor key={collab.provider ? `${memoId}:${collab.provider.generation}` : memoId} memoId={memoId} collab={collab.provider} rowTitle={rowTitle} />;
};

const PeekProperty = ({ db, row, property }: { db: DatabaseHandle; row: DatabaseRow; property: DatabaseProperty }) => (
  <div className="flex min-h-8 items-start gap-2 text-sm">
    <span className="w-36 shrink-0 truncate py-1 text-slate-500">{property.name}</span>
    <div className="min-w-0 flex-1 rounded px-1 py-1 hover:bg-slate-100"><DatabaseCell db={db} row={row} property={property} /></div>
  </div>
);

/** A row opened beside its database, so the table stays in view. */
export const RowPeek = ({ db, rowId, onClose }: { db: DatabaseHandle; rowId: string; onClose: () => void }) => {
  const { t } = useTranslation();
  const pages = usePages();
  const row = db.rows.find((item) => item.id === rowId);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== "Escape" || document.querySelector('[role="menu"], [role="listbox"], [data-radix-popper-content-wrapper]')) return;
      onClose();
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [onClose]);

  if (!row) return null;
  const properties = db.database.schema.properties.filter((property) => property.type !== "title");
  const openFull = () => {
    onClose();
    pages?.openPage({ id: row.id, notebookId: db.database.notebookId });
  };
  const iconButton = "flex h-7 w-7 items-center justify-center rounded text-slate-500 hover:bg-slate-100 hover:text-slate-900";

  return createPortal(
    <aside className="fixed inset-y-0 right-0 z-40 flex w-[min(720px,50vw)] flex-col border-l border-slate-200 bg-[var(--workspace-editor,var(--card))] shadow-2xl max-md:w-full" aria-label={t("pages.peek.label")} data-row-peek>
      <div className="flex h-11 shrink-0 items-center gap-1 px-3">
        <button type="button" className={iconButton} aria-label={t("pages.peek.close")} onClick={onClose}><ChevronsRight className="h-4 w-4" aria-hidden="true" /></button>
        <button type="button" className={iconButton} aria-label={t("pages.peek.openFull")} onClick={openFull}><Maximize2 className="h-4 w-4" aria-hidden="true" /></button>
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto px-12 pb-16 pt-6 max-md:px-5">
        <input
          key={row.title ?? ""}
          className="w-full bg-transparent text-3xl font-bold text-slate-900 outline-none placeholder:text-slate-300"
          defaultValue={row.title ?? ""}
          placeholder={t("common.untitledMemo")}
          aria-label={t("pages.peek.title")}
          onBlur={(event) => {
            const next = event.target.value.trim();
            if (next !== (row.title ?? "")) void db.updateRow(row.id, { title: next });
          }}
          onKeyDown={(event) => { if (event.key === "Enter") event.currentTarget.blur(); }}
        />
        <div className="mt-4 space-y-0.5">
          {properties.map((property) => <PeekProperty key={property.id} db={db} row={row} property={property} />)}
        </div>
        <hr className="my-4 border-slate-200" />
        <PeekBody memoId={row.id} rowTitle={row.title ?? ""} />
      </div>
    </aside>,
    document.body,
  );
};
