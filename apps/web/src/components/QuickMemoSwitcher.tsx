import { useDeferredValue, useEffect, useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Check, ChevronDown, FileText, LoaderCircle } from "lucide-react";
import { useTranslation } from "react-i18next";
import type { MemoSummary } from "@ponder/shared";
import { api } from "@/lib/api";
import type { PonderRepository } from "@/lib/repository";
import { AppMark, useConnections } from "./pages/Connections";
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
  COMMAND_ITEM_STRONG_SELECTED_CLASS_NAME,
} from "@/components/ui/command";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { useWorkspaceMembers } from "@/components/comments/PageComments";
import { usePages } from "@/components/pages/PagesProvider";
import { useViewer } from "@/components/teams/Teams";
import { PageIcon } from "@/components/pages/PageTree";
import { cn } from "@/lib/utils";

type QuickMemoSwitcherProps = {
  open: boolean;
  query: string;
  repository: PonderRepository;
  /** The large search window with date groups and a preview, used by the page layout. */
  wide?: boolean;
  onOpenChange: (open: boolean) => void;
  onQueryChange: (query: string) => void;
  onOpenMemo: (memo: MemoSummary) => void;
};

const EMPTY_MEMOS: MemoSummary[] = [];
const CONNECTED_SEARCH_DELAY_MS = 400;
const DAY_MS = 86_400_000;
const DATE_GROUPS = ["today", "yesterday", "pastWeek", "pastMonth", "older"] as const;
type DateGroup = (typeof DATE_GROUPS)[number];

const dateGroup = (updatedAt: string, now: Date): DateGroup => {
  const midnight = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
  const time = new Date(updatedAt).getTime();
  if (time >= midnight) return "today";
  if (time >= midnight - DAY_MS) return "yesterday";
  if (time >= midnight - 7 * DAY_MS) return "pastWeek";
  if (time >= midnight - 30 * DAY_MS) return "pastMonth";
  return "older";
};

const FILTER_BUTTON = "inline-flex h-7 items-center gap-1 rounded-full border border-slate-200 px-2.5 text-xs text-slate-600 hover:bg-slate-100";
const FILTER_BUTTON_ON = "border-blue-200 bg-blue-50 text-blue-700 hover:bg-blue-50";

const FilterMenu = ({ label, value, options, onChange }: {
  label: string;
  value: string;
  options: { value: string; label: string }[];
  onChange: (value: string) => void;
}) => {
  const selected = options.find((option) => option.value === value);
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button type="button" className={cn(FILTER_BUTTON, value && FILTER_BUTTON_ON)}>
          {value && selected ? `${label}: ${selected.label}` : label}
          <ChevronDown className="h-3 w-3" aria-hidden="true" />
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" className="max-h-72 w-56 overflow-y-auto">
        {options.map((option) => (
          <DropdownMenuItem key={option.value} onSelect={() => onChange(option.value)}>
            <span className="min-w-0 flex-1 truncate">{option.label}</span>
            {option.value === value ? <Check className="h-4 w-4" aria-hidden="true" /> : null}
          </DropdownMenuItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  );
};

export const QuickMemoSwitcher = ({
  open,
  query,
  repository,
  wide = false,
  onOpenChange,
  onQueryChange,
  onOpenMemo,
}: QuickMemoSwitcherProps) => {
  const { t } = useTranslation();
  const pages = usePages();
  const [selectedMemoId, setSelectedMemoId] = useState("");
  const [titleOnly, setTitleOnly] = useState(false);
  const [inPageId, setInPageId] = useState("");
  const [days, setDays] = useState("");
  const [createdBy, setCreatedBy] = useState("");
  const viewer = useViewer();
  const members = useWorkspaceMembers(open && wide && Boolean(viewer?.teamRole));
  const filtering = titleOnly || Boolean(inPageId || days || createdBy);
  const deferredQuery = useDeferredValue(query.trim());
  const memoQuery = useQuery({
    queryKey: ["quick-memo-switcher", deferredQuery, filtering],
    queryFn: () => repository.listMemos({
      notebookId: null,
      q: deferredQuery,
      trash: false,
      filter: "all",
      sort: "updated-desc",
      offset: 0,
      limit: filtering ? 200 : 50,
    }),
    enabled: open,
    staleTime: 15_000,
  });
  const found = memoQuery.data?.memos ?? EMPTY_MEMOS;
  const memos = useMemo(() => {
    if (!filtering) return found;
    const needle = deferredQuery.toLowerCase();
    const cutoff = days ? Date.now() - Number(days) * DAY_MS : 0;
    return found.filter((memo) => {
      if (titleOnly && needle && !(memo.title ?? "").toLowerCase().includes(needle)) return false;
      if (cutoff && new Date(memo.updatedAt).getTime() < cutoff) return false;
      if (createdBy && memo.createdBy !== createdBy) return false;
      if (inPageId && memo.id !== inPageId && !pages?.ancestorsOf(memo.id).some((page) => page.id === inPageId)) return false;
      return true;
    });
  }, [createdBy, days, deferredQuery, filtering, found, inPageId, pages, titleOnly]);
  const loading = memoQuery.isPending || memoQuery.isFetching;
  const connections = useConnections(open && wide);
  const hasGitHub = connections.data?.accounts.some((account) => account.provider === "github" && account.status === "active") ?? false;
  const [connectedQuery, setConnectedQuery] = useState("");
  useEffect(() => {
    // GitHub limits searches per minute, so wait until typing pauses.
    const timer = window.setTimeout(() => setConnectedQuery(deferredQuery), CONNECTED_SEARCH_DELAY_MS);
    return () => window.clearTimeout(timer);
  }, [deferredQuery]);
  const connectedSearch = useQuery({
    queryKey: ["connected-search", connectedQuery],
    queryFn: () => api.searchConnectedApps(connectedQuery),
    enabled: open && wide && hasGitHub && !filtering && connectedQuery.length >= 3,
    staleTime: 60_000,
    retry: false,
  });
  const connectedResults = connectedSearch.data?.results ?? [];

  useEffect(() => {
    setSelectedMemoId((current) => (
      memos.some((memo) => memo.id === current) ? current : memos[0]?.id ?? ""
    ));
  }, [memos]);

  const groups = useMemo(() => {
    if (!wide) return null;
    const now = new Date();
    const buckets = new Map<DateGroup, MemoSummary[]>();
    for (const memo of memos) {
      const key = dateGroup(memo.updatedAt, now);
      buckets.set(key, [...(buckets.get(key) ?? []), memo]);
    }
    return DATE_GROUPS.flatMap((key) => (buckets.has(key) ? [{ key, memos: buckets.get(key) ?? EMPTY_MEMOS }] : []));
  }, [memos, wide]);
  const selectedMemo = memos.find((memo) => memo.id === selectedMemoId);

  const renderItem = (memo: MemoSummary) => (
    <CommandItem
      key={memo.id}
      className={COMMAND_ITEM_STRONG_SELECTED_CLASS_NAME}
      value={memo.id}
      onSelect={() => onOpenMemo(memo)}
    >
      {wide ? <PageIcon icon={pages?.getPage(memo.id)?.icon} database={Boolean(pages?.getPage(memo.id)?.databaseId)} /> : <FileText className="h-4 w-4 shrink-0 text-slate-500" />}
      <div className="min-w-0 flex-1 py-0.5">
        <div className="truncate font-medium text-slate-900">{memo.title}</div>
        {memo.excerpt && !wide ? (
          <div className="mt-0.5 truncate text-xs text-slate-500">{memo.excerpt}</div>
        ) : null}
      </div>
    </CommandItem>
  );

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className={cn("block translate-y-0 overflow-hidden p-0", wide ? "top-[9%] max-w-[1008px]" : "top-[18%] max-w-xl")} data-page-search={wide ? "" : undefined}>
        <DialogTitle className="sr-only">{t("quickSwitcher.title")}</DialogTitle>
        <DialogDescription className="sr-only">{t("quickSwitcher.description")}</DialogDescription>
        <Command shouldFilter={false} value={selectedMemoId} onValueChange={setSelectedMemoId}>
          <CommandInput
            autoFocus
            className="pr-9"
            placeholder={wide ? t("pages.search.placeholder") : t("quickSwitcher.placeholder")}
            value={query}
            onValueChange={onQueryChange}
          />
          {wide ? (
            <div className="flex flex-wrap items-center gap-1.5 border-b border-slate-100 px-3 py-2" data-page-search-filters>
              <button type="button" className={cn(FILTER_BUTTON, titleOnly && FILTER_BUTTON_ON)} aria-pressed={titleOnly} onClick={() => setTitleOnly((value) => !value)}>{t("pages.search.titleOnly")}</button>
              <FilterMenu
                label={t("pages.search.createdBy")}
                value={createdBy}
                onChange={setCreatedBy}
                options={[
                  { value: "", label: t("pages.search.anyone") },
                  ...(viewer?.teamRole
                    ? (members.data ?? []).map((member) => ({ value: `user:${member.id}`, label: member.displayName || member.username }))
                    : viewer ? [{ value: `user:${viewer.id}`, label: t("pages.search.you") }] : []),
                ]}
              />
              <FilterMenu
                label={t("pages.search.in")}
                value={inPageId}
                onChange={setInPageId}
                options={[
                  { value: "", label: t("pages.search.anywhere") },
                  ...(pages?.nodes ?? []).slice(0, 100).map((page) => ({ value: page.id, label: page.title?.trim() || t("common.untitledMemo") })),
                ]}
              />
              <FilterMenu
                label={t("pages.search.date")}
                value={days}
                onChange={setDays}
                options={[
                  { value: "", label: t("pages.search.anyTime") },
                  { value: "7", label: t("pages.search.last7") },
                  { value: "30", label: t("pages.search.last30") },
                ]}
              />
            </div>
          ) : null}
          <div className={cn(wide && "grid h-[min(36rem,70dvh)] grid-cols-[minmax(0,1fr)_minmax(0,24rem)] gap-3 p-2")}>
            <CommandList className={cn(wide ? "max-h-none" : "max-h-[min(26rem,60dvh)]", "p-1.5")}>
              {loading ? (
                <div className="flex items-center justify-center gap-2 py-8 text-sm text-slate-500" role="status">
                  <LoaderCircle className="h-4 w-4 animate-spin" />
                  {t("quickSwitcher.loading")}
                </div>
              ) : (
                <>
                  {connectedResults.length === 0 ? <CommandEmpty>{t("quickSwitcher.empty")}</CommandEmpty> : null}
                  {groups ? groups.map((group) => (
                    <CommandGroup key={group.key} heading={t(`pages.search.${group.key}`)}>
                      {group.memos.map(renderItem)}
                    </CommandGroup>
                  )) : (
                    <CommandGroup heading={deferredQuery ? t("quickSwitcher.results") : t("quickSwitcher.recent")}>
                      {memos.map(renderItem)}
                    </CommandGroup>
                  )}
                  {connectedResults.length > 0 ? (
                    <CommandGroup heading={t("pages.search.github")} data-connected-search>
                      {connectedResults.map((result) => (
                        <CommandItem
                          key={result.url}
                          className={COMMAND_ITEM_STRONG_SELECTED_CLASS_NAME}
                          value={result.url}
                          onSelect={() => {
                            window.open(result.url, "_blank", "noopener,noreferrer");
                            onOpenChange(false);
                          }}
                        >
                          <AppMark app={result.provider} className="h-4 w-4" />
                          <div className="min-w-0 flex-1 py-0.5">
                            <div className="truncate font-medium text-slate-900">{result.title}</div>
                            <div className="mt-0.5 truncate text-xs text-slate-500">{result.subtitle}</div>
                          </div>
                        </CommandItem>
                      ))}
                    </CommandGroup>
                  ) : null}
                </>
              )}
            </CommandList>
            {wide ? (
              <aside className="overflow-hidden rounded-lg border border-slate-200 p-5" data-page-search-preview>
                {selectedMemo ? (
                  <>
                    <PageIcon icon={pages?.getPage(selectedMemo.id)?.icon} database={Boolean(pages?.getPage(selectedMemo.id)?.databaseId)} className="h-8 w-8 text-3xl" />
                    <h3 className="mt-3 text-xl font-bold text-slate-900">{selectedMemo.title}</h3>
                    <p className="mt-2 line-clamp-[12] whitespace-pre-wrap break-words text-sm text-slate-600">{selectedMemo.excerpt || t("pages.search.noPreview")}</p>
                  </>
                ) : null}
              </aside>
            ) : null}
          </div>
          <div className="flex items-center justify-between border-t border-slate-100 px-3 py-2 text-xs text-slate-400">
            <span>{t("quickSwitcher.openHint")}</span>
            <span>{t("quickSwitcher.closeHint")}</span>
          </div>
        </Command>
      </DialogContent>
    </Dialog>
  );
};
