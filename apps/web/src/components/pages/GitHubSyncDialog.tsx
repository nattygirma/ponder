import { useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { AlertTriangle, BadgeCheck, Check, Link as LinkIcon, Lock, RefreshCw, X } from "lucide-react";
import { GITHUB_REPOSITORY_PATTERN, type DatabaseSyncInfo, type GitHubSyncHistory, type GitHubSyncKind } from "@ponder/shared";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Dialog, DialogContent, DialogDescription, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { DATABASE_SYNCS_KEY, useRelativeTime } from "@/components/database/DatabaseSync";
import { usePages } from "@/components/pages/PagesProvider";
import { api } from "@/lib/api";
import { cn } from "@/lib/utils";
import { AppMark, startConnection, useConnections } from "./Connections";

type Pane = "link_preview" | "database_sync";
type Tab = "overview" | "syncs";
type Account = { id: string; name: string; status: "active" | "expired" };

export const useDatabaseSyncs = (enabled = true) => useQuery({
  queryKey: DATABASE_SYNCS_KEY,
  queryFn: () => api.listDatabaseSyncs(),
  enabled,
  staleTime: 30_000,
});

const HISTORY: GitHubSyncHistory[] = ["all", "30", "90", "365"];
const HISTORY_LABELS: Record<GitHubSyncHistory, string> = {
  all: "pages.githubSync.historyAll", 30: "pages.githubSync.history30", 90: "pages.githubSync.history90", 365: "pages.githubSync.history365",
};

/** A small picture of GitHub syncing into a database, like the one on Notion's Database sync overview. */
const SyncIllustration = () => (
  <div className="relative flex h-40 items-center overflow-hidden rounded-lg border border-slate-200 bg-slate-50 pl-10" aria-hidden="true">
    <span className="relative flex h-14 w-14 items-center justify-center rounded-full bg-card shadow-sm">
      <AppMark app="github" className="h-9 w-9" />
      <RefreshCw className="absolute -bottom-1 -right-1 h-5 w-5 rounded-full bg-card p-0.5 text-slate-600" />
    </span>
    <span className="mx-5 flex gap-1.5">{[0, 1, 2].map((dot) => <span key={dot} className="h-1.5 w-1.5 rounded-full bg-slate-400" />)}</span>
    <div className="absolute -right-6 top-6 w-60 rounded-lg border border-slate-200 bg-card shadow-sm">
      <div className="border-b border-slate-200 px-3 py-2 text-sm font-semibold text-slate-800">Ponder</div>
      {[0, 1, 2].map((row) => (
        <div key={row} className="flex items-center gap-2 border-b border-slate-100 px-3 py-2 last:border-0">
          <Check className="h-3.5 w-3.5 rounded-sm border border-slate-300 text-slate-500" />
          <span className="h-2 w-20 rounded-full bg-slate-200" />
          <span className="h-2 w-12 rounded-full bg-slate-200" />
        </div>
      ))}
    </div>
  </div>
);

const StatusBadge = ({ sync }: { sync: DatabaseSyncInfo }) => {
  const { t } = useTranslation();
  const tone = sync.state === "error" ? "bg-amber-100 text-amber-800"
    : sync.state === "synced" ? "bg-emerald-100 text-emerald-800 dark:bg-emerald-950 dark:text-emerald-200"
    : "bg-slate-100 text-slate-600";
  return <span className={cn("inline-flex shrink-0 items-center rounded px-1.5 text-xs font-medium", tone)}>{t(`pages.githubSync.status.${sync.state}`)}</span>;
};

/** Repositories to sync: a searchable list of the login's repositories, or owner/name typed in. */
const RepositoryPicker = ({ connectionId, value, onChange }: { connectionId: string; value: string[]; onChange: (next: string[]) => void }) => {
  const { t } = useTranslation();
  const [query, setQuery] = useState("");
  const repositories = useQuery({
    queryKey: ["github-repositories", connectionId],
    queryFn: () => api.listGitHubRepositories(connectionId),
    enabled: Boolean(connectionId),
    staleTime: 60_000,
    retry: false,
  });
  const needle = query.trim().toLowerCase();
  const listed = (repositories.data?.repositories ?? []).filter((repo) => !needle || repo.fullName.toLowerCase().includes(needle));
  const typed = query.trim();
  const canAdd = GITHUB_REPOSITORY_PATTERN.test(typed) && !value.some((name) => name.toLowerCase() === typed.toLowerCase());
  const toggle = (name: string) => onChange(value.some((item) => item === name) ? value.filter((item) => item !== name) : [...value, name]);
  return (
    <div className="space-y-2" data-repository-picker>
      {value.length ? (
        <div className="flex flex-wrap gap-1">
          {value.map((name) => (
            <span key={name} className="inline-flex items-center gap-1 rounded bg-slate-100 py-0.5 pl-2 pr-1 text-xs text-slate-700">
              {name}
              <button type="button" className="rounded p-0.5 hover:bg-slate-200" aria-label={t("pages.githubSync.removeRepository", { name })} onClick={() => toggle(name)}>
                <X className="h-3 w-3" aria-hidden="true" />
              </button>
            </span>
          ))}
        </div>
      ) : null}
      <div className="flex gap-2">
        <Input
          className="h-8"
          value={query}
          placeholder={repositories.isError ? t("pages.githubSync.typeRepository") : t("pages.githubSync.searchRepositories")}
          aria-label={t("pages.githubSync.searchRepositories")}
          onChange={(event) => setQuery(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === "Enter" && canAdd) {
              event.preventDefault();
              onChange([...value, typed]);
              setQuery("");
            }
          }}
        />
        {canAdd ? <Button type="button" size="sm" variant="outline" className="h-8" onClick={() => { onChange([...value, typed]); setQuery(""); }}>{t("pages.githubSync.addRepository")}</Button> : null}
      </div>
      <div className="max-h-44 overflow-y-auto rounded-md border border-slate-200">
        {repositories.isLoading ? <p className="px-3 py-2 text-xs text-slate-500">{t("pages.githubSync.loadingRepositories")}</p> : null}
        {repositories.isError ? <p className="px-3 py-2 text-xs text-slate-500">{t("pages.githubSync.repositoriesFailed")}</p> : null}
        {repositories.data && listed.length === 0 ? <p className="px-3 py-2 text-xs text-slate-500">{t("pages.githubSync.noRepositories")}</p> : null}
        {listed.map((repo) => (
          <label key={repo.fullName} className="flex cursor-pointer items-center gap-2 px-3 py-1.5 text-sm hover:bg-slate-50">
            <Checkbox checked={value.includes(repo.fullName)} onCheckedChange={() => toggle(repo.fullName)} aria-label={repo.fullName} />
            <span className="min-w-0 flex-1 truncate">{repo.fullName}</span>
            {repo.private ? <Lock className="h-3 w-3 shrink-0 text-slate-400" aria-hidden="true" /> : null}
          </label>
        ))}
      </div>
    </div>
  );
};

/** Notion's sync settings: account, repositories, name, what to bring in and how much history. */
const SyncForm = ({ accounts, editing, onDone, onCancel }: {
  accounts: Account[];
  editing: DatabaseSyncInfo | null;
  onDone: (result: { databaseId: string; pageMemoId?: string; notebookId?: string }) => void;
  onCancel: () => void;
}) => {
  const { t } = useTranslation();
  const pages = usePages();
  const active = accounts.filter((account) => account.status === "active");
  const [connectionId, setConnectionId] = useState(editing?.connectionId ?? active[0]?.id ?? "");
  const [repositories, setRepositories] = useState<string[]>(editing?.repositories ?? []);
  const [name, setName] = useState("");
  const [include, setInclude] = useState<GitHubSyncKind[]>(editing?.include ?? ["pull_requests"]);
  const [history, setHistory] = useState<GitHubSyncHistory>(editing?.history ?? "all");
  const save = useMutation({
    mutationFn: async () => {
      if (editing) {
        await api.updateDatabaseSync(editing.databaseId, { repositories, include, history });
        return { databaseId: editing.databaseId };
      }
      const { database } = await api.createDatabaseSync({
        connectionId, repositories, include, history,
        ...(name.trim() ? { name: name.trim() } : {}),
        ...(pages?.rootNotebookId ? { notebookId: pages.rootNotebookId } : {}),
      });
      return { databaseId: database.id, pageMemoId: database.pageMemoId, notebookId: database.notebookId };
    },
    onSuccess: onDone,
  });
  const toggleKind = (kind: GitHubSyncKind, on: boolean) => setInclude((current) => (on ? [...new Set([...current, kind])] : current.filter((item) => item !== kind)));
  const ready = Boolean(connectionId) && repositories.length > 0 && include.length > 0 && !save.isPending;

  return (
    <form className="space-y-4" data-github-sync-form onSubmit={(event) => { event.preventDefault(); if (ready) save.mutate(); }}>
      {!editing && active.length > 1 ? (
        <label className="block space-y-1 text-xs font-medium text-slate-600">
          <span>{t("pages.githubSync.account")}</span>
          <Select value={connectionId} onValueChange={setConnectionId}>
            <SelectTrigger className="h-8"><SelectValue /></SelectTrigger>
            <SelectContent>{active.map((account) => <SelectItem key={account.id} value={account.id}>{account.name}</SelectItem>)}</SelectContent>
          </Select>
        </label>
      ) : null}
      <div className="space-y-1">
        <p className="text-xs font-medium text-slate-600">{t("pages.githubSync.repositories")}</p>
        <RepositoryPicker connectionId={connectionId} value={repositories} onChange={setRepositories} />
      </div>
      {editing ? null : (
        <label className="block space-y-1 text-xs font-medium text-slate-600">
          <span>{t("pages.githubSync.name")}</span>
          <Input className="h-8" value={name} placeholder={repositories.length === 1 ? repositories[0] : t("pages.githubSync.namePlaceholder")} onChange={(event) => setName(event.target.value)} />
        </label>
      )}
      <fieldset className="space-y-1.5">
        <legend className="text-xs font-medium text-slate-600">{t("pages.githubSync.include")}</legend>
        {(["pull_requests", "issues"] as const).map((kind) => (
          <label key={kind} className="flex items-center gap-2 text-sm">
            <Checkbox checked={include.includes(kind)} onCheckedChange={(checked) => toggleKind(kind, checked === true)} />
            {t(kind === "issues" ? "pages.githubSync.issues" : "pages.githubSync.pullRequests")}
          </label>
        ))}
      </fieldset>
      <label className="block space-y-1 text-xs font-medium text-slate-600">
        <span>{t("pages.githubSync.history")}</span>
        <Select value={history} onValueChange={(next) => setHistory(next as GitHubSyncHistory)}>
          <SelectTrigger className="h-8"><SelectValue /></SelectTrigger>
          <SelectContent>{HISTORY.map((option) => <SelectItem key={option} value={option}>{t(HISTORY_LABELS[option])}</SelectItem>)}</SelectContent>
        </Select>
        <span className="block font-normal leading-5 text-slate-500">{t("pages.githubSync.historyHint")}</span>
      </label>
      {save.error ? <p className="text-sm text-red-600" role="alert">{save.error instanceof Error ? save.error.message : String(save.error)}</p> : null}
      <div className="flex justify-end gap-2">
        <Button type="button" variant="ghost" size="sm" onClick={onCancel}>{t("pages.githubSync.back")}</Button>
        <Button type="submit" size="sm" disabled={!ready} data-create-sync>
          {save.isPending ? t(editing ? "pages.githubSync.saving" : "pages.githubSync.creating") : t(editing ? "pages.githubSync.save" : "pages.githubSync.create")}
        </Button>
      </div>
    </form>
  );
};

const SyncRow = ({ sync, canManage, onEdit, onOpen }: { sync: DatabaseSyncInfo; canManage: boolean; onEdit: () => void; onOpen: () => void }) => {
  const { t } = useTranslation();
  const queryClient = useQueryClient();
  const relative = useRelativeTime();
  const settle = () => Promise.all([
    queryClient.invalidateQueries({ queryKey: DATABASE_SYNCS_KEY }),
    queryClient.invalidateQueries({ queryKey: ["database", sync.databaseId] }),
  ]);
  const pause = useMutation({ mutationFn: () => api.updateDatabaseSync(sync.databaseId, { paused: !sync.paused }), onSettled: settle });
  const stop = useMutation({ mutationFn: () => api.deleteDatabaseSync(sync.databaseId), onSettled: settle });
  const when = relative(sync.lastSyncedAt);
  return (
    <li className="space-y-2 px-3 py-3" data-sync-row={sync.databaseId}>
      <div className="flex min-w-0 items-center gap-2">
        <AppMark app="github" className="h-4 w-4" />
        <button type="button" className="min-w-0 truncate text-sm font-medium text-slate-900 hover:underline" onClick={onOpen}>{sync.name || sync.repositories.join(", ")}</button>
        <StatusBadge sync={sync} />
      </div>
      <p className="truncate text-xs text-slate-500">
        {sync.repositories.join(", ")} · {t("pages.githubSync.items", { count: sync.itemCount })} · {when ? t("pages.githubSync.lastSynced", { time: when }) : t("pages.githubSync.notSynced")}
      </p>
      {sync.lastError ? (
        <div className="flex flex-wrap items-start gap-2 rounded-md bg-amber-50 px-2.5 py-2 text-xs text-amber-900" role="alert" data-sync-error={sync.lastError.code}>
          <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden="true" />
          <span className="min-w-0 flex-1">{sync.lastError.message}</span>
          {sync.lastError.code === "connection_lost" && canManage ? (
            <Button type="button" size="sm" className="h-6 px-2 text-xs" onClick={() => startConnection("github", "/connections")}>{t("pages.githubSync.logInAgain")}</Button>
          ) : null}
        </div>
      ) : null}
      {canManage ? (
        <div className="flex flex-wrap gap-1">
          <Button type="button" size="sm" variant="outline" className="h-7 text-xs" onClick={onOpen}>{t("pages.githubSync.open")}</Button>
          <Button type="button" size="sm" variant="outline" className="h-7 text-xs" onClick={onEdit}>{t("pages.githubSync.edit")}</Button>
          <Button type="button" size="sm" variant="ghost" className="h-7 text-xs" disabled={pause.isPending} onClick={() => pause.mutate()}>
            {t(sync.paused ? "pages.githubSync.resume" : "pages.githubSync.pause")}
          </Button>
          <Button type="button" size="sm" variant="ghost" className="h-7 text-xs text-red-600" disabled={stop.isPending} onClick={() => {
            if (window.confirm(t("pages.githubSync.stopConfirm"))) stop.mutate();
          }}>{t("pages.githubSync.stop")}</Button>
        </div>
      ) : null}
    </li>
  );
};

/**
 * Settings for the GitHub connection, laid out like Notion's: the connection's types on the left (Link
 * preview, Database sync) and the chosen one on the right. Database sync has Overview and Your syncs.
 */
export const GitHubSyncDialog = ({ open, onOpenChange, initialPane = "database_sync" }: { open: boolean; onOpenChange: (open: boolean) => void; initialPane?: Pane }) => {
  const { t } = useTranslation();
  const pages = usePages();
  const queryClient = useQueryClient();
  const connections = useConnections(open);
  const syncs = useDatabaseSyncs(open);
  const [pane, setPane] = useState<Pane>(initialPane);
  const [tab, setTab] = useState<Tab>("overview");
  const [form, setForm] = useState<{ editing: DatabaseSyncInfo | null } | null>(null);
  const accounts = useMemo(() => (connections.data?.accounts ?? []).filter((account) => account.provider === "github"), [connections.data]);
  const connected = accounts.some((account) => account.status === "active");
  const canManage = connections.data?.canManage ?? false;
  const list = syncs.data?.syncs ?? [];
  const typesConnected = connected ? (list.length ? 2 : 1) : 0;

  const openDatabase = async (databaseId: string, page?: { pageMemoId?: string; notebookId?: string }) => {
    let target = page?.pageMemoId && page.notebookId ? { id: page.pageMemoId, notebookId: page.notebookId } : null;
    if (!target) {
      const { database } = await api.getDatabase(databaseId);
      target = { id: database.pageMemoId, notebookId: database.notebookId };
    }
    pages?.refresh();
    onOpenChange(false);
    pages?.openPage(target);
  };

  const navItem = (id: Pane, Icon: typeof LinkIcon, label: string, hint: string) => (
    <button
      type="button"
      className={cn("flex w-full items-start gap-3 rounded-lg px-2 py-2 text-left hover:bg-slate-100", pane === id && "bg-slate-100")}
      aria-current={pane === id ? "page" : undefined}
      onClick={() => { setPane(id); setForm(null); }}
    >
      <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg border border-slate-200 bg-card"><Icon className="h-4 w-4 text-slate-600" aria-hidden="true" /></span>
      <span className="min-w-0">
        <span className="block text-sm font-medium text-slate-900">{label}</span>
        <span className="block text-xs leading-4 text-slate-500">{hint}</span>
      </span>
    </button>
  );

  return (
    <Dialog open={open} onOpenChange={(next) => { onOpenChange(next); if (!next) setForm(null); }}>
      <DialogContent className="flex max-h-[min(44rem,90vh)] max-w-3xl flex-col gap-0 overflow-hidden p-0 sm:flex-row" data-github-sync-dialog>
        <aside className="shrink-0 border-b border-slate-200 bg-slate-50/60 p-4 sm:w-60 sm:border-b-0 sm:border-r">
          <AppMark app="github" className="h-7 w-7" />
          <DialogTitle className="mt-3 text-lg font-semibold">GitHub</DialogTitle>
          <DialogDescription className="text-sm text-slate-500">{t("pages.githubSync.types", { count: typesConnected })}</DialogDescription>
          <nav className="mt-4 flex gap-1 sm:flex-col">
            {navItem("link_preview", LinkIcon, t("pages.githubSync.linkPreview"), t("pages.githubSync.linkPreviewHint"))}
            {navItem("database_sync", RefreshCw, t("pages.githubSync.databaseSync"), t("pages.githubSync.databaseSyncHint"))}
          </nav>
        </aside>
        <section className="min-h-0 flex-1 overflow-y-auto p-5 sm:p-6">
          {pane === "link_preview" ? (
            <div className="space-y-4">
              <h2 className="pr-8 text-2xl font-bold tracking-tight text-slate-900">{t("pages.githubSync.linkPreview")}</h2>
              <p className="text-sm leading-6 text-slate-600">{t("pages.githubSync.linkPreviewBody")}</p>
              {connected ? (
                <p className="text-sm text-slate-600">{t("pages.connections.connectedAs", { name: accounts.map((account) => account.name).join(", ") })}</p>
              ) : (
                <Button type="button" disabled={!canManage} onClick={() => startConnection("github", "/connections")}>{t("pages.githubSync.connect")}</Button>
              )}
            </div>
          ) : (
            <div className="space-y-4">
              <div className="pr-8">
                <h2 className="text-2xl font-bold tracking-tight text-slate-900">{t("pages.githubSync.databaseSync")}</h2>
                <p className="mt-1 inline-flex items-center gap-1 text-sm text-slate-500"><BadgeCheck className="h-4 w-4" aria-hidden="true" />{t("pages.githubSync.builtBy")}</p>
              </div>
              {connections.data && !canManage ? (
                <p className="rounded-md bg-slate-100 px-3 py-2 text-sm text-slate-600">{t("pages.githubSync.ownerOnly")}</p>
              ) : null}
              {form ? (
                <SyncForm
                  accounts={accounts}
                  editing={form.editing}
                  onCancel={() => setForm(null)}
                  onDone={async (result) => {
                    await queryClient.invalidateQueries({ queryKey: DATABASE_SYNCS_KEY });
                    await queryClient.invalidateQueries({ queryKey: ["database", result.databaseId] });
                    setForm(null);
                    setTab("syncs");
                    if (!form.editing) await openDatabase(result.databaseId, result);
                  }}
                />
              ) : (
                <>
                  <div className="flex items-center gap-1" role="tablist">
                    {(["overview", "syncs"] as const).map((id) => (
                      <button
                        key={id}
                        type="button"
                        role="tab"
                        aria-selected={tab === id}
                        className={cn("rounded-full px-3 py-1 text-sm text-slate-500 hover:bg-slate-100", tab === id && "bg-slate-100 font-medium text-slate-900")}
                        onClick={() => setTab(id)}
                      >
                        {id === "overview" ? t("pages.githubSync.overview") : t("pages.githubSync.yourSyncs", { count: list.length })}
                      </button>
                    ))}
                    {tab === "syncs" && connected && canManage ? (
                      <Button type="button" size="sm" className="ml-auto h-7" onClick={() => setForm({ editing: null })} data-new-sync>{t("pages.githubSync.newSync")}</Button>
                    ) : null}
                  </div>
                  {tab === "overview" ? (
                    <div className="space-y-3">
                      <SyncIllustration />
                      <h3 className="text-base font-semibold text-slate-900">{t("pages.githubSync.overviewTitle")}</h3>
                      <p className="text-sm leading-6 text-slate-600">{t("pages.githubSync.overviewBody")}</p>
                      <p className="text-sm leading-6 text-slate-600">{t("pages.githubSync.overviewReadOnly")}</p>
                      {connected ? (
                        <Button type="button" disabled={!canManage} onClick={() => { setTab("syncs"); setForm({ editing: null }); }}>{t("pages.githubSync.newSync")}</Button>
                      ) : (
                        <Button type="button" disabled={!canManage || !connections.data?.available} onClick={() => startConnection("github", "/connections")}>{t("pages.githubSync.connect")}</Button>
                      )}
                    </div>
                  ) : !connected && list.length === 0 ? (
                    <div className="flex min-h-56 items-center justify-center rounded-lg border border-slate-200 px-6 text-center text-sm text-slate-600">
                      {t("pages.githubSync.needAccount")}
                    </div>
                  ) : list.length === 0 ? (
                    <div className="flex min-h-56 items-center justify-center rounded-lg border border-slate-200 px-6 text-center text-sm text-slate-600">{t("pages.githubSync.noSyncs")}</div>
                  ) : (
                    <ul className="divide-y divide-slate-200 rounded-lg border border-slate-200" data-sync-list>
                      {list.map((sync) => (
                        <SyncRow key={sync.databaseId} sync={sync} canManage={canManage} onEdit={() => setForm({ editing: sync })} onOpen={() => void openDatabase(sync.databaseId)} />
                      ))}
                    </ul>
                  )}
                </>
              )}
            </div>
          )}
        </section>
      </DialogContent>
    </Dialog>
  );
};
