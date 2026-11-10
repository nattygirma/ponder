import { useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { CalendarDays, Code2, Bot } from "lucide-react";
import { useTranslation } from "react-i18next";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { api } from "@/lib/api";
import { cn } from "@/lib/utils";

const CONNECTIONS_KEY = ["connections"] as const;

export const useConnections = (enabled = true) => useQuery({
  queryKey: CONNECTIONS_KEY,
  queryFn: () => api.getConnections(),
  enabled,
  staleTime: 60_000,
});

/** The host runs the login, then sends the person back to `next`. */
export const startConnection = (provider: string, next: string) => {
  window.location.assign(`/_altstack/connect/${encodeURIComponent(provider)}?next=${encodeURIComponent(next)}`);
};

const GITHUB_MARK = "M12 .297c-6.63 0-12 5.373-12 12 0 5.303 3.438 9.8 8.205 11.385.6.113.82-.258.82-.577 0-.285-.01-1.04-.015-2.04-3.338.724-4.042-1.61-4.042-1.61C4.422 18.07 3.633 17.7 3.633 17.7c-1.087-.744.084-.729.084-.729 1.205.084 1.838 1.236 1.838 1.236 1.07 1.835 2.809 1.305 3.495.998.108-.776.417-1.305.76-1.605-2.665-.3-5.466-1.332-5.466-5.93 0-1.31.465-2.38 1.235-3.22-.135-.303-.54-1.523.105-3.176 0 0 1.005-.322 3.3 1.23.96-.267 1.98-.399 3-.405 1.02.006 2.04.138 3 .405 2.28-1.552 3.285-1.23 3.285-1.23.645 1.653.24 2.873.12 3.176.765.84 1.23 1.91 1.23 3.22 0 4.61-2.805 5.625-5.475 5.92.42.36.81 1.096.81 2.22 0 1.606-.015 2.896-.015 3.286 0 .315.21.69.825.57C20.565 22.092 24 17.592 24 12.297c0-6.627-5.373-12-12-12";
const SLACK_MARK = "M5.042 15.165a2.528 2.528 0 0 1-2.52 2.523A2.528 2.528 0 0 1 0 15.165a2.527 2.527 0 0 1 2.522-2.52h2.52v2.52zM6.313 15.165a2.527 2.527 0 0 1 2.521-2.52 2.527 2.527 0 0 1 2.521 2.52v6.313A2.528 2.528 0 0 1 8.834 24a2.528 2.528 0 0 1-2.521-2.522v-6.313zM8.834 5.042a2.528 2.528 0 0 1-2.521-2.52A2.528 2.528 0 0 1 8.834 0a2.528 2.528 0 0 1 2.521 2.522v2.52H8.834zM8.834 6.313a2.528 2.528 0 0 1 2.521 2.521 2.528 2.528 0 0 1-2.521 2.521H2.522A2.528 2.528 0 0 1 0 8.834a2.528 2.528 0 0 1 2.522-2.521h6.312zM18.956 8.834a2.528 2.528 0 0 1 2.522-2.521A2.528 2.528 0 0 1 24 8.834a2.528 2.528 0 0 1-2.522 2.521h-2.522V8.834zM17.688 8.834a2.528 2.528 0 0 1-2.523 2.521 2.527 2.527 0 0 1-2.52-2.521V2.522A2.527 2.527 0 0 1 15.165 0a2.528 2.528 0 0 1 2.523 2.522v6.312zM15.165 18.956a2.528 2.528 0 0 1 2.523 2.522A2.528 2.528 0 0 1 15.165 24a2.527 2.527 0 0 1-2.52-2.522v-2.522h2.52zM15.165 17.688a2.527 2.527 0 0 1-2.52-2.523 2.526 2.526 0 0 1 2.52-2.52h6.313A2.527 2.527 0 0 1 24 15.165a2.528 2.528 0 0 1-2.522 2.523h-6.313z";
const DRIVE_MARK = "M12.01 1.485c-2.082 0-3.754.02-3.743.047.01.02 1.708 3.001 3.774 6.62l3.76 6.574h3.76c2.081 0 3.753-.02 3.742-.047-.005-.02-1.708-3.001-3.775-6.62l-3.76-6.574zm-4.76 1.73a789.828 789.861 0 0 0-3.63 6.319L0 15.868l1.89 3.298 1.885 3.297 3.62-6.335 3.618-6.33-1.88-3.287C8.1 4.704 7.255 3.22 7.25 3.214zm2.259 12.653-.203.348c-.114.198-.96 1.672-1.88 3.287a423.93 423.948 0 0 1-1.698 2.97c-.01.026 3.24.042 7.222.042h7.244l1.796-3.157c.992-1.734 1.85-3.23 1.906-3.323l.104-.167h-7.249z";

const APPLE_MARK = "M12.152 6.896c-.948 0-2.415-1.078-3.96-1.04-2.04.027-3.91 1.183-4.961 3.014-2.117 3.675-.546 9.103 1.519 12.09 1.013 1.454 2.208 3.09 3.792 3.039 1.52-.065 2.09-.987 3.935-.987 1.831 0 2.35.987 3.96.948 1.637-.026 2.676-1.48 3.676-2.948 1.156-1.688 1.636-3.325 1.662-3.415-.039-.013-3.182-1.221-3.22-4.857-.026-3.04 2.48-4.494 2.597-4.559-1.429-2.09-3.623-2.324-4.39-2.376-2-.156-3.675 1.09-4.61 1.09zM15.53 3.83c.843-1.012 1.4-2.427 1.245-3.83-1.207.052-2.662.805-3.532 1.818-.78.896-1.454 2.338-1.273 3.714 1.338.104 2.715-.688 3.559-1.701";

/** An app's logo, or its first letter for apps that aren't built yet. */
export const AppMark = ({ app, className }: { app: string; className?: string }) => {
  const size = cn("h-5 w-5 shrink-0", className);
  if (app === "google") {
    return (
      <svg viewBox="0 0 24 24" className={size} aria-hidden="true">
        <path fill="#4285F4" d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z" />
        <path fill="#34A853" d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z" />
        <path fill="#FBBC05" d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l3.66-2.84z" />
        <path fill="#EA4335" d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z" />
      </svg>
    );
  }
  if (app === "outlook") {
    return (
      <svg viewBox="0 0 24 24" className={size} aria-hidden="true">
        <rect x="2" y="3" width="20" height="18" rx="3" fill="#0a64ad" />
        <circle cx="12" cy="12" r="4.75" fill="none" stroke="#fff" strokeWidth="2.5" />
      </svg>
    );
  }
  const path = app === "github" ? GITHUB_MARK : app === "slack" ? SLACK_MARK : app === "drive" ? DRIVE_MARK : app === "apple" ? APPLE_MARK : null;
  if (path) {
    const color = app === "slack" ? "text-[#a0559f]" : app === "drive" ? "text-[#1fa463]" : "text-slate-900";
    return <svg viewBox="0 0 24 24" className={cn(size, color)} fill="currentColor" aria-hidden="true"><path d={path} /></svg>;
  }
  if (app === "calendar") return <CalendarDays className={cn(size, "text-[#4285f4]")} aria-hidden="true" />;
  return <span className={cn(size, "flex items-center justify-center rounded bg-slate-200 text-xs font-semibold text-slate-600")} aria-hidden="true">{app.slice(0, 1)}</span>;
};

const LOGIN_APPS = [
  { id: "calendar", name: "Google Calendar", provider: "google", hint: "pages.connections.calendarHint" },
  { id: "outlook", name: "Outlook Calendar", provider: "microsoft", hint: "pages.connections.outlookHint" },
  { id: "drive", name: "Google Drive", provider: "google", hint: "pages.connections.driveHint" },
  { id: "slack", name: "Slack", provider: "slack", hint: "pages.connections.slackHint" },
  { id: "github", name: "GitHub", provider: "github", hint: "pages.connections.githubHint" },
] as const;

const PLANNED_APPS = ["Jira", "Linear", "Figma", "Asana", "Trello", "Dropbox", "OneDrive", "Zoom"];

export const ConnectionsView = ({ onOpenPlugins, onOpenExternalAgents }: { onOpenPlugins: () => void; onOpenExternalAgents: () => void }) => {
  const { t } = useTranslation();
  const queryClient = useQueryClient();
  const connections = useConnections();
  const [filter, setFilter] = useState("");
  const needle = filter.trim().toLowerCase();
  const apps = useMemo(() => LOGIN_APPS.filter((app) => app.name.toLowerCase().includes(needle)), [needle]);
  const planned = useMemo(() => PLANNED_APPS.filter((name) => name.toLowerCase().includes(needle)), [needle]);
  const disconnect = useMutation({
    mutationFn: (ids: string[]) => Promise.all(ids.map((id) => api.disconnectConnection(id))),
    onSettled: () => Promise.all([
      queryClient.invalidateQueries({ queryKey: CONNECTIONS_KEY }),
      queryClient.invalidateQueries({ queryKey: ["calendar"] }),
    ]),
  });
  const available = connections.data?.available ?? false;
  const canManage = connections.data?.canManage ?? false;
  const notice = !connections.data ? null
    : !available ? t("pages.connections.unavailable")
    : !canManage ? t("pages.connections.ownerOnly")
    : null;

  return (
    <div className="h-full overflow-y-auto bg-[var(--workspace-editor,transparent)]" data-connections-view>
      <div className="mx-auto w-full max-w-3xl px-6 py-14">
        <h1 className="text-3xl font-bold tracking-tight text-slate-900">{t("pages.connections.title")}</h1>
        <p className="mt-2 text-sm text-slate-500">{t("pages.connections.intro")}</p>
        <Input
          className="mt-6 h-8"
          aria-label={t("pages.connections.filter")}
          placeholder={t("pages.connections.filter")}
          value={filter}
          onChange={(event) => setFilter(event.target.value)}
        />
        {notice ? <p className="mt-4 rounded-md bg-slate-100 px-3 py-2 text-sm text-slate-600" data-connections-notice>{notice}</p> : null}
        {disconnect.error ? <p className="mt-4 text-sm text-red-600" role="alert">{disconnect.error.message}</p> : null}

        <div className="mt-6 grid gap-2 sm:grid-cols-2">
          {apps.map((app) => {
            const accounts = (connections.data?.accounts ?? []).filter((account) => account.provider === app.provider);
            const expired = accounts.some((account) => account.status === "expired");
            return (
              <div key={app.id} className="flex flex-col justify-between gap-3 rounded-lg border border-slate-200 p-3" data-connection-app={app.id}>
                <div className="min-w-0">
                  <div className="flex items-center gap-2">
                    <AppMark app={app.id} />
                    <span className="text-sm font-medium text-slate-900">{app.name}</span>
                  </div>
                  <p className="mt-1.5 text-xs leading-5 text-slate-500">{t(app.hint)}</p>
                  {accounts.length > 0 ? (
                    <p className={cn("mt-1 truncate text-xs", expired ? "text-amber-600" : "text-slate-600")}>
                      {expired ? t("pages.connections.expired") : t("pages.connections.connectedAs", { name: accounts.map((account) => account.name).join(", ") })}
                    </p>
                  ) : null}
                </div>
                <div className="flex gap-2">
                  {accounts.length === 0 || expired ? (
                    <Button
                      type="button"
                      size="sm"
                      disabled={!available || !canManage}
                      onClick={() => startConnection(app.provider, "/connections")}
                    >
                      {expired ? t("pages.connections.reconnect") : t("pages.connections.connect")}
                    </Button>
                  ) : null}
                  {accounts.length > 0 && canManage ? (
                    <Button type="button" size="sm" variant="ghost" disabled={disconnect.isPending} onClick={() => disconnect.mutate(accounts.map((account) => account.id))}>
                      {t(app.provider === "google" ? "pages.connections.disconnectGoogle" : "pages.connections.disconnect")}
                    </Button>
                  ) : null}
                </div>
              </div>
            );
          })}
        </div>

        {planned.length > 0 ? (
          <>
            <h2 className="mt-8 text-sm font-medium text-slate-900">{t("pages.connections.comingSoon")}</h2>
            <div className="mt-2 grid grid-cols-2 gap-2 sm:grid-cols-4">
              {planned.map((name) => (
                <div key={name} className="flex items-center gap-2 rounded-lg border border-slate-200 px-3 py-2 text-sm text-slate-500">
                  <AppMark app={name} />
                  <span className="truncate">{name}</span>
                </div>
              ))}
            </div>
          </>
        ) : null}

        {apps.length === 0 && planned.length === 0 ? <p className="mt-6 text-sm text-slate-500">{t("pages.connections.none")}</p> : null}

        <h2 className="mt-8 text-sm font-medium text-slate-900">{t("pages.connections.more")}</h2>
        <div className="mt-2 space-y-px">
          <button type="button" className="flex w-full items-center gap-3 rounded-md px-2 py-2 text-left hover:bg-slate-100" onClick={onOpenPlugins}>
            <Code2 className="h-4 w-4 shrink-0 text-slate-500" aria-hidden="true" />
            <span className="min-w-0">
              <span className="block text-sm text-slate-900">{t("pages.connections.plugins")}</span>
              <span className="block text-xs text-slate-500">{t("pages.connections.pluginsHint")}</span>
            </span>
          </button>
          <button type="button" className="flex w-full items-center gap-3 rounded-md px-2 py-2 text-left hover:bg-slate-100" onClick={onOpenExternalAgents}>
            <Bot className="h-4 w-4 shrink-0 text-slate-500" aria-hidden="true" />
            <span className="min-w-0">
              <span className="block text-sm text-slate-900">{t("pages.sidebar.externalAgents")}</span>
              <span className="block text-xs text-slate-500">{t("pages.connections.agentsHint")}</span>
            </span>
          </button>
        </div>
      </div>
    </div>
  );
};
