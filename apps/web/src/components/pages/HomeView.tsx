import { useState, type ReactNode } from "react";
import { useTranslation } from "react-i18next";
import { Database, FileInput, FilePlus2, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { formatRelativeTime } from "@/lib/relative-time";
import { openNotionImport } from "./NotionImport";
import { ConnectCalendarDialog, eventTimeLabel, useCalendar } from "./Calendar";
import { usePages } from "./PagesProvider";
import { PageIcon } from "./PageTree";

const IMPORT_HINT_KEY = "ponder.home.importHintDismissed";

const readHintDismissed = () => {
  try {
    return window.localStorage.getItem(IMPORT_HINT_KEY) === "1";
  } catch {
    return false;
  }
};

const StarterCard = ({ icon, title, description, onClick }: { icon: ReactNode; title: string; description: string; onClick: () => void }) => (
  <button
    type="button"
    className="flex min-w-0 flex-col items-start gap-1 rounded-lg border border-slate-200 bg-card p-3 text-left transition-colors hover:bg-slate-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-slate-400/70"
    onClick={onClick}
  >
    <span className="text-slate-500">{icon}</span>
    <span className="text-sm font-medium text-slate-900">{title}</span>
    <span className="text-xs text-slate-500">{description}</span>
  </button>
);

const greetingKey = (hour: number) => {
  if (hour < 5 || hour >= 18) return "pages.home.goodEvening";
  return hour < 12 ? "pages.home.goodMorning" : "pages.home.goodAfternoon";
};

/** The landing page in the page layout: recent pages, and the ways to start. */
export const HomeView = ({ userName }: { userName: string | null }) => {
  const { t, i18n } = useTranslation();
  const pages = usePages()!;
  const [hintDismissed, setHintDismissed] = useState(readHintDismissed);
  const recents = pages.recentPages(8);
  const [calendarOpen, setCalendarOpen] = useState(false);
  const calendar = useCalendar();
  const events = (calendar.data?.events ?? []).slice(0, 5);
  const rootId = pages.rootNotebookId;
  const greeting = t(greetingKey(new Date().getHours()));

  const dismissHint = () => {
    setHintDismissed(true);
    try {
      window.localStorage.setItem(IMPORT_HINT_KEY, "1");
    } catch {
      // The hint comes back next visit when storage is unavailable.
    }
  };

  return (
    <div className="h-full overflow-y-auto bg-[var(--workspace-editor,transparent)]" data-home-view>
      <div className="mx-auto w-full max-w-3xl px-6 py-14">
        <h1 className="text-center text-3xl font-semibold tracking-tight text-slate-900">
          {userName ? `${greeting}, ${userName}` : greeting}
        </h1>

        {hintDismissed ? null : (
          <div className="mt-8 flex items-start gap-3 rounded-lg border border-slate-200 bg-card p-4" data-import-hint>
            <FileInput className="mt-0.5 h-5 w-5 shrink-0 text-slate-500" aria-hidden="true" />
            <div className="min-w-0 flex-1">
              <p className="text-sm font-medium text-slate-900">{t("pages.home.importHintTitle")}</p>
              <p className="mt-0.5 text-sm text-slate-500">{t("pages.home.importHintBody")}</p>
              <Button type="button" size="sm" className="mt-2" onClick={openNotionImport}>{t("pages.home.importAction")}</Button>
            </div>
            <button type="button" className="rounded p-1 text-slate-400 hover:bg-slate-100 hover:text-slate-700" aria-label={t("pages.home.dismiss")} onClick={dismissHint}>
              <X className="h-4 w-4" aria-hidden="true" />
            </button>
          </div>
        )}

        <section className="mt-10" aria-label={t("pages.home.recent")}>
          <h2 className="mb-2 text-xs font-medium text-slate-500">{t("pages.home.recent")}</h2>
          {recents.length === 0 ? (
            <p className="text-sm text-slate-500">{t("pages.home.noPages")}</p>
          ) : (
            <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
              {recents.map((page) => (
                <button
                  key={page.id}
                  type="button"
                  className="flex h-28 min-w-0 flex-col justify-between rounded-lg border border-slate-200 bg-card p-3 text-left transition-colors hover:bg-slate-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-slate-400/70"
                  onClick={() => pages.openPage(page)}
                >
                  <PageIcon icon={page.icon} database={Boolean(page.databaseId)} className="h-5 w-5 text-base" />
                  <span className="min-w-0">
                    <span className="line-clamp-2 text-sm font-medium text-slate-900">{page.title?.trim() || t("common.untitledMemo")}</span>
                    <span className="mt-0.5 block truncate text-xs text-slate-400">{formatRelativeTime(page.updatedAt, i18n.language)}</span>
                  </span>
                </button>
              ))}
            </div>
          )}
        </section>

        <section className="mt-10" aria-label={t("pages.calendar.upcoming")} data-home-upcoming>
          <h2 className="mb-2 text-xs font-medium text-slate-500">{t("pages.calendar.upcoming")}</h2>
          {events.length > 0 ? (
            <div className="divide-y divide-slate-100 rounded-lg border border-slate-200 bg-card">
              {events.map((event) => (
                <div key={event.id} className="flex items-baseline justify-between gap-4 px-3 py-2 text-sm">
                  <span className="min-w-0 truncate text-slate-900">{event.title}</span>
                  <span className="shrink-0 text-xs text-slate-500">{eventTimeLabel(event, i18n.language)}</span>
                </div>
              ))}
            </div>
          ) : (
            <Button type="button" variant="outline" size="sm" onClick={() => setCalendarOpen(true)}>
              {calendar.data?.feeds.length ? t("pages.calendar.manage") : t("pages.calendar.connect")}
            </Button>
          )}
          <ConnectCalendarDialog open={calendarOpen} onOpenChange={setCalendarOpen} />
        </section>

        <section className="mt-10" aria-label={t("pages.home.getStarted")}>
          <h2 className="mb-2 text-xs font-medium text-slate-500">{t("pages.home.getStarted")}</h2>
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
            <StarterCard
              icon={<FilePlus2 className="h-5 w-5" aria-hidden="true" />}
              title={t("pages.sidebar.newPage")}
              description={t("pages.home.newPageHint")}
              onClick={() => { if (rootId) void pages.createPage({ notebookId: rootId }); }}
            />
            <StarterCard
              icon={<Database className="h-5 w-5" aria-hidden="true" />}
              title={t("pages.db.newDatabase")}
              description={t("pages.home.databaseHint")}
              onClick={() => void pages.createDatabase({ root: true })}
            />
            <StarterCard
              icon={<FileInput className="h-5 w-5" aria-hidden="true" />}
              title={t("pages.home.importTitle")}
              description={t("pages.home.importCardHint")}
              onClick={openNotionImport}
            />
          </div>
        </section>
      </div>
    </div>
  );
};
