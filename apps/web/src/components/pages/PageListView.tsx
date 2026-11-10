import { useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { Hash, RotateCcw, Trash2 } from "lucide-react";
import type { MemoSummary } from "@ponder/shared";
import { Input } from "@/components/ui/input";
import { formatRelativeTime } from "@/lib/relative-time";
import { usePages } from "./PagesProvider";
import { PageIcon } from "./PageTree";
import { PhoneTopBar } from "./PhoneChrome";

/**
 * A list of pages in the page layout: what's in Trash, or every page with a tag.
 * Phones use it in place of the note list, so they stay in Notion's layout.
 */
export const PageListView = ({ kind, tag, memos, isLoading, onOpen, onRestore, onDeleteForever, onEmptyTrash }: {
  kind: "trash" | "tag";
  tag?: string | null;
  memos: MemoSummary[];
  isLoading: boolean;
  onOpen: (memo: MemoSummary) => void;
  onRestore?: (memoId: string) => void;
  onDeleteForever?: (memoId: string) => void;
  onEmptyTrash?: () => void;
}) => {
  const { t, i18n } = useTranslation();
  const pages = usePages();
  const [filter, setFilter] = useState("");
  const rows = useMemo(() => {
    const needle = filter.trim().toLowerCase();
    return needle ? memos.filter((memo) => (memo.title ?? "").toLowerCase().includes(needle)) : memos;
  }, [filter, memos]);
  const trash = kind === "trash";
  const title = trash ? t("pages.pageList.trash") : `#${tag ?? ""}`;

  return (
    <div className="h-full overflow-y-auto bg-[var(--workspace-editor,transparent)]" data-page-list={kind}>
      <PhoneTopBar
        title={title}
        icon={trash ? <Trash2 className="h-4 w-4" aria-hidden="true" /> : <Hash className="h-4 w-4" aria-hidden="true" />}
        actions={trash && memos.length > 0 && onEmptyTrash ? (
          <button type="button" className="h-9 shrink-0 rounded-md px-2 text-sm text-rose-600 active:bg-slate-100" onClick={onEmptyTrash}>
            {t("pages.pageList.emptyTrash")}
          </button>
        ) : null}
      />
      <div className="mx-auto w-full max-w-3xl px-4 pb-16 pt-3">
        <Input
          className="h-9"
          aria-label={t("pages.pageList.filter")}
          placeholder={t("pages.pageList.filter")}
          value={filter}
          onChange={(event) => setFilter(event.target.value)}
        />
        {isLoading ? (
          <p className="px-1 py-6 text-sm text-slate-500" role="status">{t("pages.pageList.loading")}</p>
        ) : rows.length === 0 ? (
          <div className="px-1 py-8 text-center">
            <p className="text-sm font-medium text-slate-700">{trash ? t("pages.pageList.trashEmpty") : t("pages.pageList.tagEmpty")}</p>
            {trash ? <p className="mt-1 text-sm text-slate-500">{t("pages.pageList.trashHint")}</p> : null}
          </div>
        ) : (
          <ul className="mt-2">
            {rows.map((memo) => {
              const node = pages?.getPage(memo.id);
              const name = memo.title?.trim() || t("common.untitledMemo");
              return (
                <li key={memo.id} className="flex min-h-12 items-center gap-1 rounded-md" data-page-list-row>
                  <button
                    type="button"
                    className="flex min-w-0 flex-1 items-center gap-3 rounded-md px-2 py-2 text-left active:bg-slate-100"
                    onClick={() => onOpen(memo)}
                  >
                    <PageIcon icon={node?.icon} database={Boolean(node?.databaseId)} className="h-5 w-5 text-base" />
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-base text-slate-900">{name}</span>
                      <span className="block truncate text-xs text-slate-500">{formatRelativeTime(memo.updatedAt, i18n.language)}</span>
                    </span>
                  </button>
                  {trash && onRestore ? (
                    <button type="button" className="flex h-10 w-10 shrink-0 items-center justify-center rounded-md text-slate-500 active:bg-slate-100" aria-label={`${t("pages.pageList.restore")}: ${name}`} onClick={() => onRestore(memo.id)}>
                      <RotateCcw className="h-4 w-4" aria-hidden="true" />
                    </button>
                  ) : null}
                  {trash && onDeleteForever ? (
                    <button type="button" className="flex h-10 w-10 shrink-0 items-center justify-center rounded-md text-slate-500 active:bg-slate-100" aria-label={`${t("pages.pageList.deleteForever")}: ${name}`} onClick={() => onDeleteForever(memo.id)}>
                      <Trash2 className="h-4 w-4" aria-hidden="true" />
                    </button>
                  ) : null}
                </li>
              );
            })}
          </ul>
        )}
      </div>
    </div>
  );
};
