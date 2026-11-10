import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { ArrowLeft, CalendarDays, House, Lock, Workflow } from "lucide-react";
import { useTranslation } from "react-i18next";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { useLocation, useNavigate } from "react-router";
import { api } from "@/lib/api";
import { AppMark, startConnection, useConnections } from "./Connections";

const CALENDAR_KEY = ["calendar"] as const;
const REFRESH_MS = 5 * 60_000;

export const useCalendar = (enabled = true) => useQuery({
  queryKey: CALENDAR_KEY,
  queryFn: () => api.getCalendar(),
  enabled,
  staleTime: REFRESH_MS,
  refetchInterval: REFRESH_MS,
});

export type CalendarEventView = NonNullable<ReturnType<typeof useCalendar>["data"]>["events"][number];

export const eventTimeLabel = (event: CalendarEventView, language: string) => {
  // An all-day date has no time zone; reading it as local midnight keeps the day right.
  const start = new Date(event.allDay ? `${event.start}T00:00:00` : event.start);
  const day = start.toLocaleDateString(language, { weekday: "short", month: "short", day: "numeric" });
  return event.allDay ? day : `${day}, ${start.toLocaleTimeString(language, { hour: "numeric", minute: "2-digit" })}`;
};

type CalendarSource = "google" | "apple" | "outlook";

const SOURCES: { id: CalendarSource; provider?: string; label: string; title: string; steps: string }[] = [
  { id: "google", provider: "google", label: "pages.calendar.continueWithGoogle", title: "pages.calendar.titleGoogle", steps: "pages.calendar.google" },
  { id: "apple", label: "pages.calendar.continueWithIcloud", title: "pages.calendar.titleIcloud", steps: "pages.calendar.apple" },
  { id: "outlook", provider: "microsoft", label: "pages.calendar.continueWithOutlook", title: "pages.calendar.titleOutlook", steps: "pages.calendar.outlook" },
];

const BENEFITS = [
  { icon: CalendarDays, text: "pages.calendar.benefitSidebar" },
  { icon: House, text: "pages.calendar.benefitHome" },
  { icon: Lock, text: "pages.calendar.benefitPrivate" },
] as const;

/** Choosing where a calendar comes from: a login where the host offers one, otherwise its secret address. */
export const ConnectCalendarDialog = ({ open, onOpenChange }: { open: boolean; onOpenChange: (open: boolean) => void }) => {
  const { t } = useTranslation();
  const queryClient = useQueryClient();
  const calendar = useCalendar(open);
  const connections = useConnections(open);
  const location = useLocation();
  const navigate = useNavigate();
  const canLogin = Boolean(connections.data?.available && connections.data.canManage);
  const [sourceId, setSourceId] = useState<CalendarSource | null>(null);
  const [url, setUrl] = useState("");
  const source = SOURCES.find((item) => item.id === sourceId);
  const refresh = () => queryClient.invalidateQueries({ queryKey: CALENDAR_KEY });
  const connect = useMutation({
    mutationFn: () => api.connectCalendar(url),
    onSuccess: async () => {
      setUrl("");
      setSourceId(null);
      await refresh();
    },
  });
  const remove = useMutation({ mutationFn: (id: string) => api.disconnectCalendar(id), onSuccess: refresh });
  const feeds = calendar.data?.feeds ?? [];
  const showStart = () => {
    setSourceId(null);
    setUrl("");
    connect.reset();
  };
  const choose = (item: (typeof SOURCES)[number]) => {
    if (item.provider && canLogin) startConnection(item.provider, `${location.pathname}${location.search}`);
    else setSourceId(item.id);
  };

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (!next) showStart();
        onOpenChange(next);
      }}
    >
      <DialogContent className="max-w-md p-8" data-connect-calendar>
        {source ? (
          <>
            <button type="button" className="flex w-fit items-center gap-1 text-sm text-slate-500 hover:text-slate-900" onClick={showStart}>
              <ArrowLeft className="h-4 w-4" aria-hidden="true" />
              {t("pages.calendar.back")}
            </button>
            <DialogTitle>{t(source.title)}</DialogTitle>
            <DialogDescription>{t(source.steps)}</DialogDescription>
            <form
              className="flex gap-2"
              onSubmit={(event) => {
                event.preventDefault();
                if (url.trim() && !connect.isPending) connect.mutate();
              }}
            >
              <Input autoFocus value={url} onChange={(event) => setUrl(event.target.value)} placeholder={t("pages.calendar.placeholder")} aria-label={t("pages.calendar.placeholder")} autoComplete="off" />
              <Button type="submit" disabled={!url.trim() || connect.isPending}>{connect.isPending ? t("pages.calendar.connecting") : t("pages.calendar.add")}</Button>
            </form>
            {connect.error ? <p className="text-sm text-red-600" role="alert">{connect.error.message}</p> : null}
          </>
        ) : (
          <>
            <Workflow className="mx-auto h-8 w-8 text-slate-900" aria-hidden="true" />
            <DialogTitle className="text-center text-xl font-semibold">{t("pages.calendar.connect")}</DialogTitle>
            <DialogDescription className="text-center">{t("pages.calendar.intro")}</DialogDescription>
            <ul className="space-y-3 py-1 text-sm text-slate-500">
              {BENEFITS.map(({ icon: Icon, text }) => (
                <li key={text} className="flex items-center gap-3">
                  <Icon className="h-5 w-5 shrink-0" aria-hidden="true" />
                  {t(text)}
                </li>
              ))}
            </ul>
            <div className="space-y-2">
              {SOURCES.map((item) => (
                <Button key={item.id} type="button" variant="outline" className="relative h-11 w-full text-sm font-medium" onClick={() => choose(item)}>
                  <AppMark app={item.id} className="absolute left-4" />
                  {t(item.label)}
                </Button>
              ))}
            </div>
            {feeds.length > 0 ? (
              <div className="space-y-1">
                {feeds.map((feed) => (
                  <div key={feed.id} className="flex items-center justify-between gap-2 rounded border border-slate-200 px-3 py-2 text-sm">
                    <span className="min-w-0">
                      <span className="block truncate text-slate-900">{feed.label}</span>
                      {feed.lastError ? <span className="block text-xs text-red-600">{feed.lastError}</span> : null}
                    </span>
                    {feed.connected ? (
                      <Button type="button" size="sm" variant="ghost" onClick={() => { onOpenChange(false); navigate("/connections"); }}>{t("pages.calendar.manageConnection")}</Button>
                    ) : (
                      <Button type="button" size="sm" variant="ghost" disabled={remove.isPending} onClick={() => remove.mutate(feed.id)}>{t("pages.calendar.remove")}</Button>
                    )}
                  </div>
                ))}
              </div>
            ) : null}
          </>
        )}
      </DialogContent>
    </Dialog>
  );
};
