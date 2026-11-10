import { DatabaseEmbed } from "@ponder/shared";
import { NodeViewWrapper, ReactNodeViewRenderer, type NodeViewProps } from "@tiptap/react";
import { useTranslation } from "react-i18next";
import { Database, Link as LinkIcon, Lock, MoreHorizontal, Star, Trash2 } from "lucide-react";
import { useState, type ReactNode } from "react";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { ShareMemoDialog } from "@/components/dialogs/ShareMemoDialog";
import { PageShareButton } from "@/components/teams/Teams";
import { copyTextToClipboard } from "@/lib/clipboard";
import { PageBreadcrumbs, PageCover, PageHeader } from "@/components/pages/PageHeader";
import { usePages } from "@/components/pages/PagesProvider";
import { PageIcon } from "@/components/pages/PageTree";
import { PhoneTopBar } from "@/components/pages/PhoneChrome";
import { DatabaseSurface } from "./DatabaseSurface";
import { DatabaseCell } from "./DatabaseCell";
import { useDatabase, useRowContext } from "./useDatabase";

/** Share and ••• for a database page in the phone top bar, matching a document page's. */
const DatabasePhoneActions = ({ memoId }: { memoId: string }) => {
  const { t } = useTranslation();
  const pages = usePages();
  const [shareOpen, setShareOpen] = useState(false);
  const page = pages?.getPage(memoId);
  if (!pages || !page) return null;
  return (
    <div className="flex shrink-0 items-center gap-0.5 text-sm text-slate-700" data-database-phone-actions>
      <PageShareButton
        memoId={memoId}
        fallback={(
          <button type="button" className="flex h-9 items-center gap-1 rounded px-1.5 active:bg-slate-100" onClick={() => setShareOpen(true)}>
            <Lock className="h-3.5 w-3.5" aria-hidden="true" />
            {t("pages.topBar.share")}
          </button>
        )}
      />
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <button type="button" className="flex h-9 w-9 items-center justify-center rounded-md active:bg-slate-100" aria-label={t("editor.moreAria")}>
            <MoreHorizontal className="h-5 w-5" aria-hidden="true" />
          </button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" className="w-56">
          <DropdownMenuItem onSelect={() => void copyTextToClipboard(pages.pageLink(memoId))}>
            <LinkIcon className="h-4 w-4" aria-hidden="true" />{t("pages.topBar.copyLink")}
          </DropdownMenuItem>
          <DropdownMenuItem onSelect={() => pages.toggleFavorite(memoId)}>
            <Star className="h-4 w-4" aria-hidden="true" />{t(page.isPinned ? "pages.topBar.unfavorite" : "pages.topBar.favorite")}
          </DropdownMenuItem>
          <DropdownMenuItem className="text-rose-700" onSelect={() => void pages.deletePage(page)}>
            <Trash2 className="h-4 w-4" aria-hidden="true" />{t("pages.delete")}
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
      <ShareMemoDialog memoId={memoId} open={shareOpen} onOpenChange={setShareOpen} />
    </div>
  );
};

/** Full-page database, shown in place of the editor when the selected page is a database. */
export const DatabasePane = ({ memoId, databaseId, title }: { memoId: string; databaseId: string; title: string }) => {
  const { t } = useTranslation();
  const page = usePages()?.getPage(memoId);
  return (
    <div className="h-full min-w-0 overflow-y-auto bg-transparent" data-database-pane>
      <PhoneTopBar title={title || t("common.untitledMemo")} icon={<PageIcon icon={page?.icon} database className="h-5 w-5 text-base" />} actions={<DatabasePhoneActions memoId={memoId} />} />
      <div className="hidden px-4 pt-2 text-xs text-slate-500 lg:block"><PageBreadcrumbs memoId={memoId} fallbackTitle={title} /></div>
      <PageCover memoId={memoId} readOnly={false} />
      <div className="px-6 pb-16 sm:px-12">
        <DatabaseSurface
          databaseId={databaseId}
          header={(db) => (
            <PageHeader
              memoId={memoId}
              readOnly={false}
              titleInput={(
                <input
                  key={db.database.title ?? ""}
                  className="ponder-page-title-input w-full min-w-0 bg-transparent px-0 outline-none"
                  defaultValue={db.database.title ?? ""}
                  placeholder={t("common.untitledMemo")}
                  aria-label={t("pages.database")}
                  onBlur={(event) => {
                    const next = event.target.value.trim();
                    if (next !== (db.database.title ?? "")) void db.rename(next);
                  }}
                  onKeyDown={(event) => { if (event.key === "Enter") event.currentTarget.blur(); }}
                />
              )}
            />
          )}
        />
      </div>
    </div>
  );
};

/** Chooses between the database surface and the document editor for the selected page. */
export const PageSurface = ({ memoId, title, children }: { memoId: string | null | undefined; title: string; children: ReactNode }) => {
  const pages = usePages();
  const databaseId = memoId && pages?.enabled ? pages.getPage(memoId)?.databaseId : null;
  if (memoId && databaseId) return <DatabasePane key={databaseId} memoId={memoId} databaseId={databaseId} title={title} />;
  return <>{children}</>;
};

const DatabaseBlockView = ({ node }: NodeViewProps) => {
  const { t } = useTranslation();
  const pages = usePages();
  const databaseId = String(node.attrs.databaseId ?? "");
  const page = pages?.nodes.find((item) => item.databaseId === databaseId);
  return (
    <NodeViewWrapper className="ponder-database-block my-3" contentEditable={false}>
      {databaseId ? (
        <DatabaseSurface
          databaseId={databaseId}
          viewId={String(node.attrs.viewId ?? "")}
          header={(db) => (
            <button type="button" className="mb-1 flex items-center gap-1.5 text-base font-semibold hover:underline" disabled={!page} onClick={() => page && pages?.openPage(page)}>
              <Database className="h-4 w-4 text-slate-400" aria-hidden="true" />
              {db.database.title || t("common.untitledMemo")}
            </button>
          )}
        />
      ) : null}
    </NodeViewWrapper>
  );
};

export const EditorDatabaseEmbed = DatabaseEmbed.extend({
  addNodeView() {
    return ReactNodeViewRenderer(DatabaseBlockView, { stopEvent: () => true });
  },
});

const RowPropertiesLoaded = ({ databaseId, rowId }: { databaseId: string; rowId: string }) => {
  const { handle } = useDatabase(databaseId);
  const pages = usePages();
  const { t } = useTranslation();
  const row = handle?.rows.find((item) => item.id === rowId);
  if (!handle || !row) return null;
  const owner = pages?.nodes.find((node) => node.databaseId === databaseId);
  return (
    <div className="mb-3 mt-1 border-b border-slate-100 pb-3 text-sm" data-row-properties>
      {owner ? (
        <button type="button" className="mb-1 flex items-center gap-1 text-xs text-slate-500 hover:text-slate-900" onClick={() => pages?.openPage(owner)}>
          <Database className="h-3 w-3" aria-hidden="true" />{owner.title || t("common.untitledMemo")}
        </button>
      ) : null}
      {handle.database.schema.properties.filter((property) => property.type !== "title").map((property) => (
        <div key={property.id} className="flex min-h-7 items-center gap-2">
          <span className="w-36 shrink-0 truncate text-slate-500">{property.name}</span>
          <div className="min-w-0 flex-1"><DatabaseCell db={handle} row={row} property={property} /></div>
        </div>
      ))}
    </div>
  );
};

/** The property panel at the top of a page that is a database row. */
export const RowProperties = ({ memoId }: { memoId: string }) => {
  const pages = usePages();
  // Pages in the tree are never rows, which spares a request for every ordinary note.
  const isTreePage = Boolean(pages?.getPage(memoId));
  const context = useRowContext(memoId, !isTreePage);
  if (isTreePage || !context.data) return null;
  return <RowPropertiesLoaded databaseId={context.data.database.id} rowId={memoId} />;
};
