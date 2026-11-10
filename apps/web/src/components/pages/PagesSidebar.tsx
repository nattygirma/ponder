import { useState, type DragEvent, type ReactNode } from "react";
import { useQuery } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import {
  Bot,
  ChevronDown,
  CircleUserRound,
  Download,
  FileInput,
  Home,
  LayoutGrid,
  LayoutList,
  Library,
  MessageCircle,
  CalendarDays,
  MessageCirclePlus,
  SlidersHorizontal,
  MoreHorizontal,
  Paperclip,
  Plus,
  Search,
  Settings,
  SquarePen,
  Tag,
  Trash2,
  UserPlus,
  X,
} from "lucide-react";
import {
  DropdownMenu,
  DropdownMenuCheckboxItem,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { NotificationsButton } from "@/components/comments/NotificationsButton";
import { OPEN_MEMBERS_EVENT, WorkspaceSwitcher } from "@/components/teams/Teams";
import { api } from "@/lib/api";
import { cn } from "@/lib/utils";
import { openNotionImport } from "./NotionImport";
import { ConnectCalendarDialog, eventTimeLabel, useCalendar } from "./Calendar";
import { usePages } from "./PagesProvider";
import { isPageDrag, PAGE_DRAG_MIME, PageTreeBranch, PageTreeTouchContext } from "./PageTree";

const ROW_CLASS = "flex h-[30px] w-full min-w-0 items-center gap-2 rounded-md px-2 text-left text-sm text-slate-600 transition-colors hover:bg-slate-100 hover:text-slate-950 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-slate-400/70";
const ICON_BUTTON_CLASS = "flex h-7 w-7 items-center justify-center rounded-md text-slate-500 hover:bg-slate-100 hover:text-slate-950 disabled:opacity-50";
const INVITE_CARD_KEY = "ponder.sidebar.inviteCardDismissed";

const PHONE_ROW_CLASS = "flex h-11 w-full min-w-0 items-center gap-3 rounded-md px-3 text-left text-base text-slate-700 active:bg-slate-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-slate-400/70";
const PHONE_ICON_BUTTON_CLASS = "relative flex h-9 w-9 items-center justify-center rounded-md text-slate-600 active:bg-slate-100 disabled:opacity-50";

const PhoneRow = ({ icon, label, active, muted, onClick }: { icon: ReactNode; label: string; active?: boolean; muted?: boolean; onClick: () => void }) => (
  <button
    type="button"
    className={cn(PHONE_ROW_CLASS, muted && "text-slate-500", active && "ponder-workspace-selection font-medium text-slate-950")}
    aria-current={active ? "page" : undefined}
    onClick={onClick}
  >
    <span className="flex h-5 w-5 shrink-0 items-center justify-center text-slate-500">{icon}</span>
    <span className="min-w-0 flex-1 truncate">{label}</span>
  </button>
);

const SidebarRow = ({ icon, label, active, onClick }: { icon: ReactNode; label: string; active?: boolean; onClick: () => void }) => (
  <button
    type="button"
    className={cn(ROW_CLASS, active && "ponder-workspace-selection font-medium text-slate-950")}
    aria-current={active ? "page" : undefined}
    onClick={onClick}
  >
    <span className="flex h-5 w-5 shrink-0 items-center justify-center">{icon}</span>
    <span className="min-w-0 flex-1 truncate">{label}</span>
  </button>
);

export const useActiveWorkspace = () => {
  const workspaces = useQuery({
    queryKey: ["workspaces"],
    queryFn: async () => (await api.getWorkspaces()).workspaces,
    staleTime: 60_000,
  });
  return workspaces.data?.find((workspace) => workspace.active);
};

const SectionHeader = ({ label, onAdd, addLabel, onDrop }: {
  label: string;
  onAdd?: () => void;
  addLabel?: string;
  onDrop?: (event: DragEvent<HTMLDivElement>) => void;
}) => {
  const [dropping, setDropping] = useState(false);
  return (
    <div
      className={cn("group flex h-[30px] items-center gap-1 rounded-md pl-2 pr-1", dropping && "bg-slate-100")}
      onDragOver={onDrop ? (event) => {
        if (!isPageDrag(event.dataTransfer)) return;
        event.preventDefault();
        event.dataTransfer.dropEffect = "move";
        setDropping(true);
      } : undefined}
      onDragLeave={() => setDropping(false)}
      onDrop={onDrop ? (event) => {
        setDropping(false);
        onDrop(event);
      } : undefined}
    >
      <span className="min-w-0 flex-1 truncate text-xs font-medium text-slate-500">{label}</span>
      {onAdd ? (
        <button
          type="button"
          className="flex h-6 w-6 items-center justify-center rounded text-slate-500 opacity-0 hover:bg-slate-200/60 focus-visible:opacity-100 group-hover:opacity-100"
          aria-label={addLabel}
          onClick={onAdd}
        >
          <Plus className="h-3.5 w-3.5" aria-hidden="true" />
        </button>
      ) : null}
    </div>
  );
};

const CUSTOMIZE_KEY = "ponder.sidebar.hidden";
type CustomizableRow = "newChat" | "library" | "connections" | "externalAgents" | "upcoming" | "favorites";
const CUSTOMIZABLE_ROWS: CustomizableRow[] = ["newChat", "library", "connections", "externalAgents", "upcoming", "favorites"];

const readHiddenRows = (): CustomizableRow[] => {
  try {
    const stored: unknown = JSON.parse(window.localStorage.getItem(CUSTOMIZE_KEY) ?? "[]");
    return Array.isArray(stored) ? CUSTOMIZABLE_ROWS.filter((row) => stored.includes(row)) : [];
  } catch {
    return [];
  }
};

const readInviteCardDismissed = () => {
  try {
    return window.localStorage.getItem(INVITE_CARD_KEY) === "1";
  } catch {
    return false;
  }
};

/** The sidebar for the page layout, arranged the way people coming from Notion expect. */
export const PagesSidebar = ({
  homeActive,
  libraryActive,
  createMenu,
  canCreate,
  notebookRows,
  syncStatus,
  collapseButton,
  bottomControls,
  demoRow,
  showSettingsNotice,
  searchHint,
  onOpenHome,
  onOpenSearch,
  onNewChat,
  onOpenSettings,
  onOpenLibrary,
  onOpenExternalAgents,
  onOpenTrash,
  onEmptyTrash,
  onOpenTags,
  onOpenAssets,
  connectionsActive,
  onOpenConnections,
  downloadUrl,
  phone = false,
}: {
  homeActive: boolean;
  libraryActive: boolean;
  createMenu: ReactNode;
  canCreate: boolean;
  notebookRows: ReactNode;
  syncStatus?: ReactNode;
  collapseButton?: ReactNode;
  bottomControls: ReactNode;
  demoRow?: ReactNode;
  showSettingsNotice?: boolean;
  searchHint: string;
  onOpenHome: () => void;
  onOpenSearch: () => void;
  onNewChat: () => void;
  onOpenSettings: () => void;
  onOpenLibrary: () => void;
  onOpenExternalAgents: () => void;
  onOpenTrash: () => void;
  onEmptyTrash: () => void;
  onOpenTags: () => void;
  onOpenAssets: () => void;
  connectionsActive?: boolean;
  onOpenConnections: () => void;
  downloadUrl: string;
  /** Lay the sidebar out as Notion's phone drawer. */
  phone?: boolean;
}) => {
  const { t, i18n } = useTranslation();
  const pages = usePages()!;
  const workspace = useActiveWorkspace();
  const [inviteDismissed, setInviteDismissed] = useState(readInviteCardDismissed);
  const [hiddenRows, setHiddenRows] = useState(readHiddenRows);
  const [calendarOpen, setCalendarOpen] = useState(false);
  const calendar = useCalendar(pages.enabled && !hiddenRows.includes("upcoming"));
  const upcomingEvents = (calendar.data?.events ?? []).slice(0, 3);
  const calendarConnected = (calendar.data?.feeds.length ?? 0) > 0;
  const calendarError = calendar.data?.feeds.find((feed) => feed.lastError)?.lastError ?? null;
  const isVisible = (row: CustomizableRow) => !hiddenRows.includes(row);
  const toggleRow = (row: CustomizableRow) => {
    const next = hiddenRows.includes(row) ? hiddenRows.filter((item) => item !== row) : [...hiddenRows, row];
    setHiddenRows(next);
    try {
      window.localStorage.setItem(CUSTOMIZE_KEY, JSON.stringify(next));
    } catch {
      // The choice lasts until reload when storage is unavailable.
    }
  };
  const rootId = pages.rootNotebookId;
  const rootPages = rootId ? pages.rootsOf(rootId) : [];
  const favorites = pages.nodes.filter((node) => node.isPinned);
  const newPage = () => {
    if (rootId) void pages.createPage({ notebookId: rootId });
  };
  const isTeam = Boolean(workspace && !workspace.isPersonal);
  const sectionLabel = isTeam ? workspace?.name ?? "" : t("pages.sidebar.private");
  const openMembers = () => window.dispatchEvent(new Event(OPEN_MEMBERS_EVENT));
  const dismissInvite = () => {
    setInviteDismissed(true);
    try {
      window.localStorage.setItem(INVITE_CARD_KEY, "1");
    } catch {
      // The card returns next visit when storage is unavailable.
    }
  };

  if (phone) {
    return (
      <PageTreeTouchContext.Provider value>
        <div className="flex h-[calc(3rem+env(safe-area-inset-top))] shrink-0 items-center gap-0.5 px-1.5 pt-[env(safe-area-inset-top)]" data-pages-sidebar data-phone-sidebar>
          <div className="min-w-0 flex-1 [&_[data-workspace-switcher]]:p-0">
            <WorkspaceSwitcher />
          </div>
          <div className="flex items-center [&_button]:h-9 [&_button]:w-9">
            <NotificationsButton variant="compact" />
          </div>
          <button type="button" className={PHONE_ICON_BUTTON_CLASS} aria-label={t("pages.sidebar.search")} onClick={onOpenSearch} data-sidebar-search>
            <Search className="h-5 w-5" aria-hidden="true" />
          </button>
          <button type="button" className={PHONE_ICON_BUTTON_CLASS} aria-label={t("pages.sidebar.newPage")} disabled={!canCreate} onClick={newPage}>
            <SquarePen className="h-5 w-5" aria-hidden="true" />
          </button>
        </div>
        {syncStatus}
        <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain px-1.5 pb-[max(1rem,env(safe-area-inset-bottom))]" data-pages-sidebar-scroll>
          {favorites.length > 0 && isVisible("favorites") ? (
            <section aria-label={t("pages.sidebar.favorites")} className="pt-2">
              <div className="flex h-11 items-center px-3 text-[13px] font-semibold text-slate-500">{t("pages.sidebar.favorites")}</div>
              <PageTreeBranch pages={favorites} depth={0} />
            </section>
          ) : null}
          <section aria-label={sectionLabel} className="pt-2">
            <div className="flex h-11 items-center pl-3 pr-1 text-[13px] font-semibold text-slate-500">
              <span className="min-w-0 flex-1 truncate">{sectionLabel}</span>
            </div>
            <PageTreeBranch pages={rootPages} depth={0} />
            {notebookRows}
            {canCreate ? (
              <PhoneRow muted icon={<Plus className="h-5 w-5" aria-hidden="true" />} label={t("pages.sidebar.addNew")} onClick={newPage} />
            ) : null}
          </section>
          <nav className="mt-4 border-t border-slate-200 pt-3" aria-label={t("notebookPane.entries")}>
            <PhoneRow icon={<Home className="h-5 w-5" aria-hidden="true" />} label={t("pages.sidebar.home")} active={homeActive} onClick={onOpenHome} />
            {isVisible("library") ? <PhoneRow icon={<Library className="h-5 w-5" aria-hidden="true" />} label={t("pages.sidebar.library")} active={libraryActive} onClick={onOpenLibrary} /> : null}
            {isVisible("connections") ? <PhoneRow icon={<LayoutGrid className="h-5 w-5" aria-hidden="true" />} label={t("pages.sidebar.connections")} active={connectionsActive} onClick={onOpenConnections} /> : null}
            {isTeam ? <PhoneRow icon={<UserPlus className="h-5 w-5" aria-hidden="true" />} label={t("pages.sidebar.invite")} onClick={openMembers} /> : null}
            <PhoneRow icon={<FileInput className="h-5 w-5" aria-hidden="true" />} label={t("pages.home.importTitle")} onClick={openNotionImport} />
            <PhoneRow
              icon={<span className="relative flex"><Settings className="h-5 w-5" aria-hidden="true" />{showSettingsNotice ? <span className="absolute -right-0.5 -top-0.5 h-1.5 w-1.5 rounded-full bg-emerald-500" /> : null}</span>}
              label={t("pages.sidebar.settings")}
              onClick={onOpenSettings}
            />
            <PhoneRow icon={<Trash2 className="h-5 w-5" aria-hidden="true" />} label={t("pages.sidebar.trash")} onClick={onOpenTrash} />
            {demoRow}
          </nav>
        </div>
      </PageTreeTouchContext.Provider>
    );
  }

  return (
    <>
      <div className="flex h-11 shrink-0 items-center justify-between px-2" data-pages-sidebar>
        <div className="flex items-center">{collapseButton}</div>
        <div className="flex items-center gap-0.5">
          <NotificationsButton variant="compact" />
          <div className="flex items-center">
            <button type="button" className={cn(ICON_BUTTON_CLASS, "rounded-r-none")} aria-label={t("pages.sidebar.newPage")} disabled={!canCreate} onClick={newPage}>
              <SquarePen className="h-4 w-4" aria-hidden="true" />
            </button>
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <button type="button" className={cn(ICON_BUTTON_CLASS, "w-4 rounded-l-none")} aria-label={t("pages.sidebar.newItem")} disabled={!canCreate}>
                  <ChevronDown className="h-3 w-3" aria-hidden="true" />
                </button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end" sideOffset={6} className="w-52">{createMenu}</DropdownMenuContent>
            </DropdownMenu>
          </div>
        </div>
      </div>

      <div className="shrink-0 px-2">
        <button
          type="button"
          className="flex h-8 w-full items-center gap-2 rounded-md border border-slate-200 bg-slate-50 px-2 text-left text-sm text-slate-500 hover:bg-slate-100"
          onClick={onOpenSearch}
          data-sidebar-search
        >
          <Search className="h-4 w-4 shrink-0" aria-hidden="true" />
          <span className="min-w-0 flex-1 truncate">{t("pages.sidebar.search")}</span>
          <kbd className="shrink-0 rounded bg-slate-200/70 px-1 font-sans text-[11px] text-slate-500">{searchHint}</kbd>
        </button>
        <div className="flex items-center gap-1 py-2">
          <button
            type="button"
            className={cn("flex h-7 items-center gap-1.5 rounded-md px-2 text-sm font-medium text-slate-600 hover:bg-slate-100", homeActive && "ponder-workspace-selection text-slate-950")}
            aria-current={homeActive ? "page" : undefined}
            onClick={onOpenHome}
          >
            <Home className="h-4 w-4" aria-hidden="true" />
            {t("pages.sidebar.home")}
          </button>
          <button type="button" className={ICON_BUTTON_CLASS} aria-label={t("pages.sidebar.newChat")} onClick={onNewChat}>
            <MessageCircle className="h-4 w-4" aria-hidden="true" />
          </button>
        </div>
      </div>

      <nav className="shrink-0 space-y-px px-2 pb-2" aria-label={t("notebookPane.entries")}>
        <SidebarRow icon={<SquarePen className="h-4 w-4" aria-hidden="true" />} label={t("pages.sidebar.newPage")} onClick={newPage} />
        {isVisible("newChat") ? <SidebarRow icon={<MessageCirclePlus className="h-4 w-4" aria-hidden="true" />} label={t("pages.sidebar.newChat")} onClick={onNewChat} /> : null}
        {isVisible("library") ? <SidebarRow icon={<Library className="h-4 w-4" aria-hidden="true" />} label={t("pages.sidebar.library")} active={libraryActive} onClick={onOpenLibrary} /> : null}
        {isVisible("connections") ? <SidebarRow icon={<LayoutGrid className="h-4 w-4" aria-hidden="true" />} label={t("pages.sidebar.connections")} active={connectionsActive} onClick={onOpenConnections} /> : null}
        {isVisible("externalAgents") ? <SidebarRow icon={<Bot className="h-4 w-4" aria-hidden="true" />} label={t("pages.sidebar.externalAgents")} onClick={onOpenExternalAgents} /> : null}
        {demoRow}
      </nav>

      {syncStatus}

      <div className="min-h-0 flex-1 space-y-3 overflow-y-auto px-2 pb-3" data-pages-sidebar-scroll>
        {isVisible("upcoming") ? (
          <section aria-label={t("pages.calendar.upcoming")} data-sidebar-upcoming>
            <SectionHeader label={t("pages.calendar.upcoming")} onAdd={() => setCalendarOpen(true)} addLabel={t("pages.calendar.manage")} />
            {upcomingEvents.map((event) => (
              <div key={event.id} className="rounded px-2 py-1 text-sm">
                <div className="truncate text-slate-800">{event.title}</div>
                <div className="truncate text-xs text-slate-500">{eventTimeLabel(event, i18n.language)}</div>
              </div>
            ))}
            {calendarConnected ? (
              upcomingEvents.length > 0 ? null : calendarError ? (
                <button type="button" className="block w-full rounded px-2 py-1 text-left text-xs text-red-600 hover:bg-slate-100" onClick={() => setCalendarOpen(true)} data-sidebar-calendar-error>
                  <span className="line-clamp-3">{calendarError}</span>
                </button>
              ) : <p className="px-2 py-1 text-xs text-slate-500">{t("pages.calendar.none")}</p>
            ) : (
              <SidebarRow icon={<CalendarDays className="h-4 w-4" aria-hidden="true" />} label={t("pages.calendar.connect")} onClick={() => setCalendarOpen(true)} />
            )}
          </section>
        ) : null}
        {favorites.length > 0 && isVisible("favorites") ? (
          <section aria-label={t("pages.sidebar.favorites")}>
            <SectionHeader label={t("pages.sidebar.favorites")} />
            <PageTreeBranch pages={favorites} depth={0} />
          </section>
        ) : null}
        <section aria-label={sectionLabel}>
          <SectionHeader
            label={sectionLabel}
            addLabel={t("pages.sidebar.newPage")}
            onAdd={canCreate ? newPage : undefined}
            onDrop={rootId ? (event) => {
              const id = event.dataTransfer.getData(PAGE_DRAG_MIME);
              if (!id) return;
              event.preventDefault();
              void pages.movePage(id, { notebookId: rootId, parentId: null });
            } : undefined}
          />
          <PageTreeBranch pages={rootPages} depth={0} />
          {notebookRows}
        </section>
      </div>

      <footer className="ponder-workspace-sidebar-footer shrink-0 px-2 pb-[max(0.5rem,env(safe-area-inset-bottom))] pt-1.5">
        <ConnectCalendarDialog open={calendarOpen} onOpenChange={setCalendarOpen} />
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <button type="button" className={cn(ROW_CLASS, "mb-1")} data-customize-sidebar>
              <span className="flex h-5 w-5 shrink-0 items-center justify-center"><SlidersHorizontal className="h-4 w-4" aria-hidden="true" /></span>
              <span className="min-w-0 flex-1 truncate">{t("pages.sidebar.customize")}</span>
            </button>
          </DropdownMenuTrigger>
          <DropdownMenuContent side="top" align="start" sideOffset={6} className="w-56">
            {CUSTOMIZABLE_ROWS.map((row) => (
              <DropdownMenuCheckboxItem key={row} checked={isVisible(row)} onSelect={(event) => { event.preventDefault(); toggleRow(row); }}>
                {t(`pages.sidebar.${row}`)}
              </DropdownMenuCheckboxItem>
            ))}
          </DropdownMenuContent>
        </DropdownMenu>
        {isTeam && !inviteDismissed ? (
          <div className="mb-2 flex items-start gap-2 rounded-lg border border-slate-200 p-2.5" data-invite-card>
            <UserPlus className="mt-0.5 h-4 w-4 shrink-0 text-slate-500" aria-hidden="true" />
            <button type="button" className="min-w-0 flex-1 text-left" onClick={openMembers}>
              <span className="block text-sm font-medium text-slate-900">{t("pages.sidebar.invite")}</span>
              <span className="block text-xs text-slate-500">{t("pages.sidebar.inviteHint")}</span>
            </button>
            <button type="button" className="rounded p-0.5 text-slate-400 hover:bg-slate-100 hover:text-slate-700" aria-label={t("pages.home.dismiss")} onClick={dismissInvite}>
              <X className="h-3.5 w-3.5" aria-hidden="true" />
            </button>
          </div>
        ) : null}
        <div className="flex items-center gap-0.5">
          <div className="min-w-0 flex-1 [&_[data-workspace-switcher]]:p-0"><WorkspaceSwitcher placement="bottom" /></div>
          {bottomControls}
          <button type="button" className={cn(ICON_BUTTON_CLASS, "relative")} aria-label={t("pages.sidebar.settings")} onClick={onOpenSettings}>
            <Settings className="h-4 w-4" aria-hidden="true" />
            {showSettingsNotice ? <span className="absolute right-1 top-1 h-1.5 w-1.5 rounded-full bg-emerald-500" /> : null}
          </button>
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <button type="button" className={ICON_BUTTON_CLASS} aria-label={t("pages.sidebar.more")}>
                <MoreHorizontal className="h-4 w-4" aria-hidden="true" />
              </button>
            </DropdownMenuTrigger>
            <DropdownMenuContent side="top" align="end" sideOffset={6} className="w-56">
              <DropdownMenuItem onSelect={openNotionImport}><FileInput className="h-4 w-4" aria-hidden="true" />{t("pages.home.importTitle")}</DropdownMenuItem>
              {isTeam ? <DropdownMenuItem onSelect={openMembers}><UserPlus className="h-4 w-4" aria-hidden="true" />{t("pages.sidebar.invite")}</DropdownMenuItem> : null}
              <DropdownMenuItem onSelect={onOpenTrash}><Trash2 className="h-4 w-4" aria-hidden="true" />{t("pages.sidebar.trash")}</DropdownMenuItem>
              <DropdownMenuItem onSelect={onOpenTags}><Tag className="h-4 w-4" aria-hidden="true" />{t("mobileSheets.tags")}</DropdownMenuItem>
              <DropdownMenuItem onSelect={onOpenAssets}><Paperclip className="h-4 w-4" aria-hidden="true" />{t("mobileSheets.assets")}</DropdownMenuItem>
              <DropdownMenuItem onSelect={onOpenSettings}><CircleUserRound className="h-4 w-4" aria-hidden="true" />{t("notebookPane.profile")}</DropdownMenuItem>
              <DropdownMenuSeparator />
              {pages.layoutSupported ? (
                <DropdownMenuItem onSelect={() => pages.setLayout("notes")}><LayoutList className="h-4 w-4" aria-hidden="true" />{t("pages.useNoteList")}</DropdownMenuItem>
              ) : null}
              <DropdownMenuItem asChild>
                <a href={downloadUrl} target="_blank" rel="noreferrer"><Download className="h-4 w-4" aria-hidden="true" />{t("pages.sidebar.downloadApps")}</a>
              </DropdownMenuItem>
              <DropdownMenuItem className="text-rose-700" onSelect={onEmptyTrash}><Trash2 className="h-4 w-4" aria-hidden="true" />{t("notebookPane.emptyTrash")}</DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      </footer>
    </>
  );
};
