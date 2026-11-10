import { useEffect, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import { BarChart3, Bell } from "lucide-react";
import type { PageAnalytics, PageSubscriptionLevel } from "@ponder/shared";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import {
  DropdownMenuItem, DropdownMenuRadioGroup, DropdownMenuRadioItem, DropdownMenuSub, DropdownMenuSubContent, DropdownMenuSubTrigger,
} from "@/components/ui/dropdown-menu";
import { api } from "@/lib/api";
import { formatRelativeTime } from "@/lib/relative-time";

const ITEM_CLASS = "flex h-9 w-full items-center gap-2 px-3 text-left text-sm text-slate-700";
const subscriptionKey = (memoId: string) => ["page-subscription", memoId] as const;

/** Counts one view each time a page is opened. Best effort: analytics never get in the way of reading. */
export const usePageViewRecorder = (memoId: string | null, enabled: boolean) => {
  useEffect(() => {
    if (!memoId || !enabled) return;
    void api.recordPageView(memoId).catch(() => undefined);
  }, [enabled, memoId]);
};

/** The page menu's "Notify me": everything, every comment, or only replies and mentions. */
export const PageNotifyMenu = ({ memoId }: { memoId: string }) => {
  const { t } = useTranslation();
  const queryClient = useQueryClient();
  const query = useQuery({ queryKey: subscriptionKey(memoId), queryFn: () => api.getPageSubscription(memoId) });
  const [failed, setFailed] = useState(false);
  const mutation = useMutation({
    mutationFn: (level: PageSubscriptionLevel) => api.setPageSubscription(memoId, level),
    onMutate: (level) => {
      setFailed(false);
      const previous = queryClient.getQueryData(subscriptionKey(memoId));
      queryClient.setQueryData(subscriptionKey(memoId), { level });
      return { previous };
    },
    onError: (_error, _level, context) => {
      queryClient.setQueryData(subscriptionKey(memoId), context?.previous);
      setFailed(true);
    },
  });
  const level = query.data?.level ?? "default";
  const options: [PageSubscriptionLevel, string][] = [
    ["all", t("pages.activity.notifyAll")],
    ["comments", t("pages.activity.notifyComments")],
    ["default", t("pages.activity.notifyDefault")],
  ];
  return (
    <DropdownMenuSub>
      <DropdownMenuSubTrigger className={ITEM_CLASS} data-page-notify>
        <Bell className="h-4 w-4 text-slate-500" aria-hidden="true" />
        {t("pages.activity.notify")}
      </DropdownMenuSubTrigger>
      <DropdownMenuSubContent className="w-60">
        <DropdownMenuRadioGroup value={level} onValueChange={(value) => mutation.mutate(value as PageSubscriptionLevel)}>
          {options.map(([value, label]) => (
            <DropdownMenuRadioItem key={value} value={value} className="text-sm" onSelect={(event) => event.preventDefault()}>
              {label}
            </DropdownMenuRadioItem>
          ))}
        </DropdownMenuRadioGroup>
        {failed ? <p className="px-2 py-1 text-xs text-rose-600" role="alert">{t("pages.activity.notifyFailed")}</p> : null}
      </DropdownMenuSubContent>
    </DropdownMenuSub>
  );
};

export const PageAnalyticsMenuItem = ({ onOpen }: { onOpen: () => void }) => {
  const { t } = useTranslation();
  return (
    <DropdownMenuItem className={ITEM_CLASS} onClick={onOpen} data-page-analytics-item>
      <BarChart3 className="h-4 w-4 text-slate-500" aria-hidden="true" />
      {t("pages.activity.analytics")}
    </DropdownMenuItem>
  );
};

const ViewsChart = ({ analytics }: { analytics: PageAnalytics }) => {
  const { t, i18n } = useTranslation();
  const peak = Math.max(1, ...analytics.daily.map((day) => day.views));
  return (
    <figure className="mt-3" aria-label={t("pages.activity.chart")}>
      <div className="flex h-20 items-end gap-[2px]" data-page-analytics-chart>
        {analytics.daily.map((day) => {
          const label = `${new Date(`${day.day}T00:00:00Z`).toLocaleDateString(i18n.language, { month: "short", day: "numeric", timeZone: "UTC" })}: ${
            day.views === 1 ? t("pages.activity.viewsOne") : t("pages.activity.viewsMany", { count: day.views })}`;
          return (
            <div key={day.day} className="flex h-full flex-1 items-end" role="img" aria-label={label}>
              <div className="w-full rounded-t-sm bg-slate-800/80" style={{ height: day.views ? `${Math.max(6, (day.views / peak) * 100)}%` : "2px", opacity: day.views ? 1 : 0.15 }} />
            </div>
          );
        })}
      </div>
    </figure>
  );
};

/** Notion's "Updates & analytics": views over the past weeks, who looked, and the page's saved versions. */
export const PageAnalyticsDialog = ({ memoId, open, onOpenChange }: { memoId: string; open: boolean; onOpenChange: (open: boolean) => void }) => {
  const { t, i18n } = useTranslation();
  const query = useQuery({ queryKey: ["page-analytics", memoId], queryFn: () => api.getPageAnalytics(memoId), enabled: open });
  const analytics = query.data?.analytics;
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[85dvh] overflow-y-auto sm:max-w-md" data-page-analytics>
        <DialogHeader>
          <DialogTitle>{t("pages.activity.analytics")}</DialogTitle>
          <DialogDescription>{t("pages.activity.period", { count: analytics?.days ?? 28 })}</DialogDescription>
        </DialogHeader>
        {query.isError ? <p className="text-sm text-rose-600" role="alert">{t("pages.activity.failed")}</p> : null}
        {!analytics && !query.isError ? <p className="text-sm text-slate-500" role="status">{t("pages.activity.loading")}</p> : null}
        {analytics ? (
          <div>
            <dl className="grid grid-cols-2 gap-3">
              <div className="rounded-md border border-slate-200 px-3 py-2">
                <dt className="text-xs text-slate-500">{t("pages.activity.views")}</dt>
                <dd className="text-2xl font-semibold" data-page-analytics-views>{analytics.totalViews}</dd>
              </div>
              <div className="rounded-md border border-slate-200 px-3 py-2">
                <dt className="text-xs text-slate-500">{t("pages.activity.viewers")}</dt>
                <dd className="text-2xl font-semibold" data-page-analytics-viewers>{analytics.uniqueViewers}</dd>
              </div>
            </dl>
            <ViewsChart analytics={analytics} />

            <h3 className="mt-5 text-xs font-medium text-slate-500">{t("pages.activity.recentViewers")}</h3>
            {analytics.viewers.length === 0 ? (
              <p className="mt-1 text-sm text-slate-500">{t("pages.activity.noViewers")}</p>
            ) : (
              <ul className="mt-1">
                {analytics.viewers.map((viewer) => (
                  <li key={viewer.userId} className="flex items-center justify-between gap-3 py-1 text-sm">
                    <span className="min-w-0 truncate">{viewer.name ?? t("pages.activity.someone")}</span>
                    <span className="shrink-0 text-xs text-slate-500">
                      {viewer.views === 1 ? t("pages.activity.viewsOne") : t("pages.activity.viewsMany", { count: viewer.views })} · {formatRelativeTime(viewer.lastViewedAt, i18n.language)}
                    </span>
                  </li>
                ))}
              </ul>
            )}

            <h3 className="mt-5 text-xs font-medium text-slate-500">{t("pages.activity.updates")}</h3>
            <ul className="mt-1" data-page-analytics-updates>
              {analytics.updates.map((update, index) => (
                <li key={`${update.at}-${index}`} className="flex items-center justify-between gap-3 py-1 text-sm">
                  <span className="min-w-0 truncate">{t("pages.activity.edited", { name: update.name ?? (update.system ? "Ponder" : t("pages.activity.someone")) })}</span>
                  <span className="shrink-0 text-xs text-slate-500">{formatRelativeTime(update.at, i18n.language)}</span>
                </li>
              ))}
              <li className="flex items-center justify-between gap-3 py-1 text-sm">
                <span>{t("pages.activity.created")}</span>
                <span className="shrink-0 text-xs text-slate-500">{formatRelativeTime(analytics.createdAt, i18n.language)}</span>
              </li>
            </ul>
          </div>
        ) : null}
      </DialogContent>
    </Dialog>
  );
};
