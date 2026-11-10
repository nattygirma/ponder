import { useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { Input } from "@/components/ui/input";
import { formatRelativeTime } from "@/lib/relative-time";
import { usePages } from "./PagesProvider";
import { PageIcon } from "./PageTree";
import { PhoneTopBar } from "./PhoneChrome";

/** Every page in the workspace, most recently edited first. */
export const LibraryView = () => {
  const { t, i18n } = useTranslation();
  const pages = usePages()!;
  const [filter, setFilter] = useState("");
  const rows = useMemo(() => {
    const needle = filter.trim().toLowerCase();
    return [...pages.nodes]
      .filter((node) => !needle || (node.title ?? "").toLowerCase().includes(needle))
      .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
  }, [filter, pages.nodes]);
  const location = (parentId: string | null, notebookId: string) => {
    if (parentId) return pages.getPage(parentId)?.title?.trim() || t("common.untitledMemo");
    return notebookId === pages.rootNotebookId ? t("pages.sidebar.private") : pages.notebookName(notebookId);
  };

  return (
    <div className="h-full overflow-y-auto bg-[var(--workspace-editor,transparent)]" data-library-view>
      <PhoneTopBar title={t("pages.library.title")} />
      <div className="mx-auto w-full max-w-3xl px-6 pb-14 pt-6 lg:pt-14">
        <h1 className="text-3xl font-bold tracking-tight text-slate-900">{t("pages.library.title")}</h1>
        <Input
          className="mt-6 h-8"
          aria-label={t("pages.library.filter")}
          placeholder={t("pages.library.filter")}
          value={filter}
          onChange={(event) => setFilter(event.target.value)}
        />
        <div className="mt-4 grid grid-cols-[minmax(0,1fr)_6rem] sm:grid-cols-[minmax(0,1fr)_10rem_8rem] gap-3 border-b border-slate-200 px-2 pb-1.5 text-xs font-medium text-slate-500">
          <span>{t("pages.library.name")}</span>
          <span className="hidden sm:block">{t("pages.library.location")}</span>
          <span>{t("pages.library.edited")}</span>
        </div>
        {rows.length === 0 ? (
          <p className="px-2 py-6 text-sm text-slate-500">{t("pages.library.empty")}</p>
        ) : rows.map((page) => (
          <button
            key={page.id}
            type="button"
            className="grid w-full grid-cols-[minmax(0,1fr)_6rem] sm:grid-cols-[minmax(0,1fr)_10rem_8rem] items-center gap-3 rounded-md px-2 py-1.5 text-left text-sm hover:bg-slate-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-slate-400/70"
            onClick={() => pages.openPage(page)}
          >
            <span className="flex min-w-0 items-center gap-2">
              <PageIcon icon={page.icon} database={Boolean(page.databaseId)} />
              <span className="truncate text-slate-900">{page.title?.trim() || t("common.untitledMemo")}</span>
            </span>
            <span className="hidden truncate text-slate-500 sm:block">{location(page.parentId, page.notebookId)}</span>
            <span className="truncate text-slate-500">{formatRelativeTime(page.updatedAt, i18n.language)}</span>
          </button>
        ))}
      </div>
    </div>
  );
};
