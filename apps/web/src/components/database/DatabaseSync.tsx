import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { AlertTriangle, PauseCircle, RefreshCw } from "lucide-react";
import type { DatabaseSyncInfo } from "@ponder/shared";
import { Button } from "@/components/ui/button";
import { ButtonTooltip } from "@/components/ui/button-tooltip";
import { AppMark, startConnection, useConnections } from "@/components/pages/Connections";
import { api } from "@/lib/api";
import { cn } from "@/lib/utils";
import { databaseKey, databaseRowsKey, type DatabaseHandle } from "./useDatabase";

export const DATABASE_SYNCS_KEY = ["database-syncs"] as const;

/** "3 minutes ago", in the reader's language. */
export const useRelativeTime = () => {
  const { t, i18n } = useTranslation();
  return (iso: string | null) => {
    if (!iso) return null;
    const seconds = Math.round((new Date(iso).getTime() - Date.now()) / 1000);
    if (Math.abs(seconds) < 45) return t("pages.githubSync.justNow");
    const format = new Intl.RelativeTimeFormat(i18n.language || "en", { numeric: "auto" });
    const minutes = Math.round(seconds / 60);
    if (Math.abs(minutes) < 60) return format.format(minutes, "minute");
    const hours = Math.round(minutes / 60);
    if (Math.abs(hours) < 24) return format.format(hours, "hour");
    return format.format(Math.round(hours / 24), "day");
  };
};

/** The mark beside a synced property's name: a hint, visible on hover and keyboard focus. */
export const SyncedMark = ({ className }: { className?: string }) => {
  const { t } = useTranslation();
  return (
    <ButtonTooltip title={t("pages.githubSync.readOnly")}>
      <span tabIndex={0} role="img" aria-label={t("pages.githubSync.readOnly")} className={cn("inline-flex shrink-0 rounded text-slate-400 outline-none focus-visible:ring-2 focus-visible:ring-slate-400", className)} data-synced-mark>
        <RefreshCw className="h-3 w-3" aria-hidden="true" />
      </span>
    </ButtonTooltip>
  );
};

const repositoriesText = (sync: DatabaseSyncInfo) =>
  sync.repositories.length <= 2 ? sync.repositories.join(", ") : `${sync.repositories.slice(0, 2).join(", ")} +${sync.repositories.length - 2}`;

/**
 * The sync's status under a synced database's title: where it comes from, when it last synced, and any
 * error with what to do about it (Notion: "Open the sync's status details. Reconnect your GitHub account…").
 */
export const SyncStatus = ({ db }: { db: DatabaseHandle }) => {
  const { t } = useTranslation();
  const queryClient = useQueryClient();
  const relative = useRelativeTime();
  const sync = db.sync;
  const connections = useConnections(Boolean(sync));
  const canManage = connections.data?.canManage ?? false;
  const databaseId = db.database.id;
  const [, tick] = useState(0);

  const refresh = () => Promise.all([
    queryClient.invalidateQueries({ queryKey: databaseKey(databaseId) }),
    queryClient.invalidateQueries({ queryKey: databaseRowsKey(databaseId) }),
    queryClient.invalidateQueries({ queryKey: DATABASE_SYNCS_KEY }),
  ]);

  const run = useMutation({ mutationFn: () => api.runDatabaseSync(databaseId), onSettled: refresh });
  const resume = useMutation({ mutationFn: () => api.updateDatabaseSync(databaseId, { paused: false }), onSettled: refresh });

  // While the first import runs (it carries on through the cron), keep the rows coming in.
  const importing = sync?.state === "importing";
  useEffect(() => {
    if (!importing) return undefined;
    const timer = window.setInterval(() => void refresh(), 5000);
    return () => window.clearInterval(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [importing, databaseId]);
  // "Last synced 3 minutes ago" stays true as time passes.
  useEffect(() => {
    const timer = window.setInterval(() => tick((value) => value + 1), 60_000);
    return () => window.clearInterval(timer);
  }, []);

  if (!sync) return null;
  const error = run.error instanceof Error ? run.error.message : null;
  const busy = run.isPending;
  const when = relative(sync.lastSyncedAt);

  return (
    <div className="mb-2 space-y-2" data-database-sync={sync.state}>
      <div className="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1 text-xs text-slate-500">
        <span className="inline-flex min-w-0 items-center gap-1.5 rounded-md border border-slate-200 px-1.5 py-0.5 text-slate-700">
          <AppMark app="github" className="h-3.5 w-3.5" />
          <span className="truncate">{t("pages.githubSync.syncedFrom")}</span>
        </span>
        <span className="min-w-0 truncate" data-sync-repositories>{repositoriesText(sync)}</span>
        <span aria-hidden="true">·</span>
        {sync.state === "paused" ? (
          <span className="inline-flex items-center gap-1"><PauseCircle className="h-3.5 w-3.5" aria-hidden="true" />{t("pages.githubSync.paused")}</span>
        ) : importing ? (
          <span className="inline-flex items-center gap-1" role="status"><RefreshCw className="h-3.5 w-3.5 animate-spin" aria-hidden="true" />{t("pages.githubSync.importing", { count: sync.itemCount })}</span>
        ) : (
          <span data-sync-last>{when ? t("pages.githubSync.lastSynced", { time: when }) : t("pages.githubSync.notSynced")}</span>
        )}
        <span className="ml-auto flex items-center gap-1">
          {sync.state === "paused" ? (
            canManage ? <Button type="button" size="sm" variant="ghost" className="h-6 px-2 text-xs" disabled={resume.isPending} onClick={() => resume.mutate()}>{t("pages.githubSync.resume")}</Button> : null
          ) : (
            <Button type="button" size="sm" variant="ghost" className="h-6 gap-1 px-2 text-xs" disabled={busy} onClick={() => run.mutate()} data-sync-now>
              <RefreshCw className={cn("h-3.5 w-3.5", busy && "animate-spin")} aria-hidden="true" />
              {busy ? t("pages.githubSync.syncing") : t("pages.githubSync.syncNow")}
            </Button>
          )}
        </span>
      </div>
      {sync.lastError || error ? (
        <div className="flex flex-wrap items-start gap-2 rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-900" role="alert" data-sync-error={sync.lastError?.code ?? "request"}>
          <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
          <span className="min-w-0 flex-1">{error ?? sync.lastError?.message}</span>
          {sync.lastError?.code === "connection_lost" && canManage ? (
            <Button type="button" size="sm" className="h-7" onClick={() => startConnection("github", window.location.pathname + window.location.search)}>
              {t("pages.githubSync.logInAgain")}
            </Button>
          ) : null}
        </div>
      ) : null}
    </div>
  );
};
