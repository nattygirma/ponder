import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import { Inbox } from "lucide-react";
import type { AppNotification } from "@ponder/shared";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { usePages } from "@/components/pages/PagesProvider";
import { api } from "@/lib/api";
import { cn } from "@/lib/utils";

const KEY = ["notifications"] as const;
const POLL_MS = 60_000;

export const NotificationsButton = ({ variant = "icon" }: { variant?: "icon" | "row" | "compact" }) => {
  const { t } = useTranslation();
  const pages = usePages();
  const queryClient = useQueryClient();
  const [open, setOpen] = useState(false);
  const query = useQuery({
    queryKey: KEY,
    queryFn: () => api.getNotifications(),
    refetchInterval: POLL_MS,
    refetchIntervalInBackground: false,
  });
  const unread = query.data?.unread ?? 0;
  const label = t("pages.notifications.open", { count: unread });
  const refresh = () => queryClient.invalidateQueries({ queryKey: KEY });

  const openNotification = async (notification: AppNotification) => {
    setOpen(false);
    if (notification.notebookId) pages?.openPage({ id: notification.memoId, notebookId: notification.notebookId });
    if (!notification.readAt) {
      await api.markNotificationsRead({ ids: [notification.id] });
      await refresh();
    }
  };

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <Tooltip>
        <TooltipTrigger asChild>
          <PopoverTrigger asChild>
            <button
              type="button"
              aria-label={label}
              className={cn(
                "relative flex w-full min-w-0 items-center rounded-md text-slate-600 hover:bg-slate-100 hover:text-slate-950",
                variant === "row" ? "h-[30px] gap-2 px-2 text-left text-sm" : variant === "compact" ? "h-7 w-7 justify-center text-slate-500" : "h-9 justify-center",
              )}
            >
              <Inbox className="h-4 w-4 shrink-0" aria-hidden="true" />
              {variant === "row" ? <span className="min-w-0 flex-1 truncate">{t("pages.notifications.title")}</span> : null}
              {unread > 0 ? (
                <span className={cn("min-w-3.5 rounded-full bg-rose-600 px-1 text-[10px] font-medium leading-3.5 text-white", variant === "row" ? "shrink-0" : "absolute right-1 top-1")} data-unread-count>
                  {unread > 99 ? "99+" : unread}
                </span>
              ) : null}
            </button>
          </PopoverTrigger>
        </TooltipTrigger>
        {variant === "icon" ? <TooltipContent side="bottom">{t("pages.notifications.title")}</TooltipContent> : null}
      </Tooltip>
      <PopoverContent className="w-80 p-1" align="start">
        <div className="flex items-center justify-between px-2 py-1">
          <h3 className="text-sm font-medium">{t("pages.notifications.title")}</h3>
          {unread > 0 ? (
            <button type="button" className="text-xs text-slate-500 hover:text-slate-900" onClick={() => void api.markNotificationsRead({ all: true }).then(refresh)}>
              {t("pages.notifications.markAllRead")}
            </button>
          ) : null}
        </div>
        <div className="max-h-96 overflow-y-auto">
          {(query.data?.notifications ?? []).map((notification) => (
            <button key={notification.id} type="button" className={cn("block w-full rounded px-2 py-1.5 text-left hover:bg-slate-100", notification.readAt && "opacity-60")} onClick={() => void openNotification(notification)}>
              <span className="block truncate text-xs text-slate-500">
                {notification.kind === "mention"
                  ? t("pages.notifications.mentioned", { name: notification.actorName })
                  : t("pages.notifications.replied", { name: notification.actorName })}
                {notification.memoTitle ? ` · ${notification.memoTitle}` : ""}
              </span>
              <span className="block truncate text-sm">{notification.excerpt}</span>
            </button>
          ))}
          {query.data && query.data.notifications.length === 0 ? <p className="px-2 py-3 text-sm text-slate-500">{t("pages.notifications.empty")}</p> : null}
        </div>
      </PopoverContent>
    </Popover>
  );
};
