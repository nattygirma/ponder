import { useState, type DragEvent } from "react";
import { useTranslation } from "react-i18next";
import { ChevronRight, Database, FileText, MoreHorizontal, Plus, Star, Trash2 } from "lucide-react";
import type { PageNode } from "@ponder/shared";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { cn } from "@/lib/utils";
import { usePages } from "./PagesProvider";

export const PAGE_DRAG_MIME = "application/x-ponder-page";

// getData() is empty during dragover, so the row being dragged is remembered here.
let draggingPageId: string | null = null;

export const isPageDrag = (dataTransfer: DataTransfer) => dataTransfer.types.includes(PAGE_DRAG_MIME);

type DropSpot = "before" | "inside" | "after";

const dropSpotFor = (event: DragEvent<HTMLDivElement>): DropSpot => {
  const rect = event.currentTarget.getBoundingClientRect();
  const ratio = (event.clientY - rect.top) / rect.height;
  if (ratio < 0.25) return "before";
  if (ratio > 0.75) return "after";
  return "inside";
};

export const PageIcon = ({ icon, className, database }: { icon: string | null | undefined; className?: string; database?: boolean }) => (
  !icon && database
    ? <Database className={cn("h-4 w-4 shrink-0 text-slate-400", className)} aria-hidden="true" />
    : icon
    ? <span className={cn("flex h-4 w-4 shrink-0 items-center justify-center text-[13px] leading-none", className)} aria-hidden="true">{icon}</span>
    : <FileText className={cn("h-4 w-4 shrink-0 text-slate-400", className)} aria-hidden="true" />
);

const PageTreeRow = ({ page, depth }: { page: PageNode; depth: number }) => {
  const { t } = useTranslation();
  const pages = usePages()!;
  const [drop, setDrop] = useState<DropSpot | null>(null);
  const children = pages.childrenOf(page.id);
  const expanded = pages.isExpanded(page.id);
  const selected = pages.selectedPageId === page.id;
  const title = page.title?.trim() || t("common.untitledMemo");
  const indent = 8 + depth * 14;

  return (
    <div data-page-tree-row={page.id}>
      <div
        className={cn(
          "group relative flex h-[30px] cursor-pointer items-center gap-1 rounded-md pr-1 text-sm select-none transition-colors",
          selected ? "ponder-workspace-selection font-medium text-slate-950" : "text-slate-600 hover:bg-slate-100",
          drop === "inside" && "ring-2 ring-slate-300",
        )}
        style={{ paddingLeft: indent }}
        draggable
        onClick={() => pages.openPage(page)}
        onDragStart={(event) => {
          event.stopPropagation();
          draggingPageId = page.id;
          event.dataTransfer.effectAllowed = "move";
          event.dataTransfer.setData(PAGE_DRAG_MIME, page.id);
          event.dataTransfer.setData("text/plain", title);
        }}
        onDragEnd={() => {
          draggingPageId = null;
          setDrop(null);
        }}
        onDragOver={(event) => {
          if (!isPageDrag(event.dataTransfer) || draggingPageId === page.id) return;
          event.preventDefault();
          event.stopPropagation();
          event.dataTransfer.dropEffect = "move";
          setDrop(dropSpotFor(event));
        }}
        onDragLeave={() => setDrop(null)}
        onDrop={(event) => {
          if (!isPageDrag(event.dataTransfer)) return;
          event.preventDefault();
          event.stopPropagation();
          const id = event.dataTransfer.getData(PAGE_DRAG_MIME);
          const spot = dropSpotFor(event);
          setDrop(null);
          if (!id || id === page.id) return;
          void pages.movePage(id, spot === "inside" ? { parentId: page.id } : spot === "before" ? { beforeId: page.id } : { afterId: page.id });
        }}
      >
        <span className="relative flex h-5 w-5 shrink-0 items-center justify-center">
          <span className="flex transition-opacity group-hover:opacity-0"><PageIcon icon={page.icon} database={Boolean(page.databaseId)} /></span>
          <button
            type="button"
            className="absolute inset-0 flex items-center justify-center rounded opacity-0 hover:bg-slate-200/60 focus-visible:opacity-100 group-hover:opacity-100"
            aria-label={expanded ? t("notebookTree.collapse", { name: title }) : t("notebookTree.expand", { name: title })}
            aria-expanded={expanded}
            onClick={(event) => {
              event.stopPropagation();
              pages.setExpanded(page.id, !expanded);
            }}
          >
            <ChevronRight className={cn("h-3.5 w-3.5 transition-transform duration-150", expanded && "rotate-90")} aria-hidden="true" />
          </button>
        </span>
        <button type="button" className="min-w-0 flex-1 truncate text-left" aria-current={selected ? "page" : undefined}>
          {title}
        </button>
        <span className="hidden shrink-0 items-center group-focus-within:flex group-hover:flex">
          <button
            type="button"
            className="flex h-6 w-6 items-center justify-center rounded hover:bg-slate-200/60"
            aria-label={t("pages.addInside", { name: title })}
            onClick={(event) => {
              event.stopPropagation();
              void pages.createPage({ parentId: page.id });
            }}
          >
            <Plus className="h-3.5 w-3.5" aria-hidden="true" />
          </button>
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <button
                type="button"
                className="flex h-6 w-6 items-center justify-center rounded hover:bg-slate-200/60"
                aria-label={t("pages.actions", { name: title })}
                onClick={(event) => event.stopPropagation()}
              >
                <MoreHorizontal className="h-3.5 w-3.5" aria-hidden="true" />
              </button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="start" onClick={(event) => event.stopPropagation()}>
              <DropdownMenuItem onSelect={() => pages.toggleFavorite(page.id)}>
                <Star className="h-4 w-4" aria-hidden="true" />
                {t(page.isPinned ? "pages.topBar.unfavorite" : "pages.topBar.favorite")}
              </DropdownMenuItem>
              {page.databaseId ? null : (
                <DropdownMenuItem onSelect={() => void pages.createDatabase({ parentId: page.id })}>
                  <Database className="h-4 w-4" aria-hidden="true" />
                  {t("pages.addDatabaseInside")}
                </DropdownMenuItem>
              )}
              <DropdownMenuItem className="text-rose-700" onSelect={() => void pages.deletePage(page)}>
                <Trash2 className="h-4 w-4" aria-hidden="true" />
                {t("pages.delete")}
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </span>
        {drop === "before" ? <div className="absolute top-0 right-2 h-0.5 rounded-full bg-slate-400" style={{ left: indent + 12 }} /> : null}
        {drop === "after" ? <div className="absolute bottom-0 right-2 h-0.5 rounded-full bg-slate-400" style={{ left: indent + 12 }} /> : null}
      </div>
      {expanded && children.length > 0 ? <PageTreeBranch pages={children} depth={depth + 1} /> : null}
      {expanded && children.length === 0 ? (
        <div className="flex h-[30px] items-center text-sm text-slate-400" style={{ paddingLeft: indent + 28 }}>{t("pages.sidebar.noPagesInside")}</div>
      ) : null}
    </div>
  );
};

export const PageTreeBranch = ({ pages, depth }: { pages: PageNode[]; depth: number }) => (
  <div className="space-y-px">
    {pages.map((page) => <PageTreeRow key={page.id} page={page} depth={depth} />)}
  </div>
);
