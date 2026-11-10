import { useRef, useState, type KeyboardEvent, type ReactNode } from "react";
import { useQuery } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import { CalendarDays, Home, MessageCircle, NotebookPen, Settings2, Video } from "lucide-react";
import { api } from "@/lib/api";
import { chatThreadsFromTurns } from "@/lib/local-agent-threads";
import { cn } from "@/lib/utils";
import { type CalendarEventView } from "./Calendar";
import { AiFaceIcon } from "../AiFaceIcon";

/** Notion's sidebar tabs: Home (pages), Chat (AI chats) and Meetings (calendar and notes). */
export const SIDEBAR_TABS = ["home", "chat", "meetings"] as const;
export type SidebarTab = (typeof SIDEBAR_TABS)[number];

const TAB_KEY = "ponder.sidebar.tab";

const readSidebarTab = (): SidebarTab => {
  try {
    const stored = window.localStorage.getItem(TAB_KEY);
    return SIDEBAR_TABS.find((tab) => tab === stored) ?? "home";
  } catch {
    return "home";
  }
};

/** The open tab, kept across visits. */
export const useSidebarTab = () => {
  const [tab, setTab] = useState<SidebarTab>(readSidebarTab);
  const choose = (next: SidebarTab) => {
    setTab(next);
    try {
      window.localStorage.setItem(TAB_KEY, next);
    } catch {
      // The tab resets to Home next visit when storage is unavailable.
    }
  };
  return [tab, choose] as const;
};

const TAB_ICONS: Record<SidebarTab, typeof Home> = { home: Home, chat: MessageCircle, meetings: CalendarDays };

export const SidebarTabStrip = ({ tab, onSelect, phone = false }: { tab: SidebarTab; onSelect: (tab: SidebarTab) => void; phone?: boolean }) => {
  const { t } = useTranslation();
  const refs = useRef<Partial<Record<SidebarTab, HTMLButtonElement | null>>>({});
  // Arrow keys move between tabs, the way a tab list works everywhere else.
  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    const step = event.key === "ArrowRight" ? 1 : event.key === "ArrowLeft" ? -1 : 0;
    const edge = event.key === "Home" ? SIDEBAR_TABS[0] : event.key === "End" ? SIDEBAR_TABS.at(-1) : null;
    if (!step && !edge) return;
    event.preventDefault();
    const next = edge ?? SIDEBAR_TABS[(SIDEBAR_TABS.indexOf(tab) + step + SIDEBAR_TABS.length) % SIDEBAR_TABS.length]!;
    onSelect(next);
    refs.current[next]?.focus();
  };
  return (
    <div role="tablist" aria-label={t("pages.sidebarTabs.label")} className={cn("flex items-center gap-1", phone ? "px-1.5 py-2" : "py-2")} onKeyDown={onKeyDown} data-sidebar-tabs>
      {SIDEBAR_TABS.map((id) => {
        const Icon = TAB_ICONS[id];
        const selected = id === tab;
        return (
          <button
            key={id}
            ref={(element) => { refs.current[id] = element; }}
            type="button"
            role="tab"
            id={`sidebar-tab-${id}`}
            aria-selected={selected}
            aria-controls={`sidebar-panel-${id}`}
            tabIndex={selected ? 0 : -1}
            className={cn(
              "flex items-center gap-1.5 rounded-md font-medium text-slate-500 transition-colors hover:bg-slate-100 hover:text-slate-900 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-slate-400/70",
              phone ? "h-9 px-3 text-[15px] active:bg-slate-100" : "h-7 px-2 text-sm",
              selected && "ponder-workspace-selection text-slate-950",
            )}
            onClick={() => onSelect(id)}
            data-sidebar-tab={id}
          >
            <Icon className={phone ? "h-[18px] w-[18px]" : "h-4 w-4"} aria-hidden="true" />
            {t(`pages.sidebarTabs.${id}`)}
          </button>
        );
      })}
    </div>
  );
};

const rowClass = (phone: boolean) => cn(
  "flex w-full min-w-0 items-center gap-2 rounded-md text-left text-slate-600 transition-colors hover:bg-slate-100 hover:text-slate-950 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-slate-400/70",
  phone ? "h-11 gap-3 px-3 text-base text-slate-700 active:bg-slate-100" : "h-[30px] px-2 text-sm",
);

const Row = ({ phone, icon, label, onClick, data }: { phone: boolean; icon: ReactNode; label: string; onClick: () => void; data?: string }) => (
  <button type="button" className={rowClass(phone)} onClick={onClick} data-sidebar-tab-row={data}>
    <span className="flex h-5 w-5 shrink-0 items-center justify-center text-slate-500">{icon}</span>
    <span className="min-w-0 flex-1 truncate">{label}</span>
  </button>
);

const Heading = ({ phone, children }: { phone: boolean; children: ReactNode }) => (
  <div className={cn("flex items-center font-medium text-slate-500", phone ? "h-11 px-3 text-[13px] font-semibold" : "h-[30px] px-2 text-xs")}>{children}</div>
);

const Note = ({ phone, children, tone = "muted" }: { phone: boolean; children: ReactNode; tone?: "muted" | "error" }) => (
  <p className={cn(phone ? "px-3 py-2 text-sm" : "px-2 py-1 text-xs", tone === "error" ? "text-red-600" : "text-slate-500")}>{children}</p>
);

const whenLabel = (iso: string, language: string) => {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return "";
  const now = new Date();
  return date.toDateString() === now.toDateString()
    ? date.toLocaleTimeString(language, { hour: "numeric", minute: "2-digit" })
    : date.toLocaleDateString(language, { month: "short", day: "numeric" });
};

/** The Chat tab: start a chat with AI, or pick up a recent one. */
export const ChatTabPanel = ({ phone, onNewChat, onOpenChat }: { phone: boolean; onNewChat: () => void; onOpenChat?: (threadId: string) => void }) => {
  const { t, i18n } = useTranslation();
  const turns = useQuery({
    queryKey: ["sidebar-chat-threads"],
    queryFn: async () => (await api.listCompanionTurns()).turns,
    staleTime: 15_000,
    refetchOnMount: "always",
  });
  const threads = chatThreadsFromTurns(turns.data ?? []).slice(0, 30);
  return (
    <div role="tabpanel" id="sidebar-panel-chat" aria-labelledby="sidebar-tab-chat" className="space-y-px" data-sidebar-panel="chat">
      <Row phone={phone} icon={<AiFaceIcon className={phone ? "h-5 w-5" : "h-4 w-4"} aria-hidden="true" />} label={t("pages.sidebar.newChat")} onClick={onNewChat} data="new-chat" />
      <div className={phone ? "pt-3" : "pt-2"}>
        <Heading phone={phone}>{t("pages.sidebarTabs.recentChats")}</Heading>
        {turns.isPending ? <Note phone={phone}>{t("pages.sidebarTabs.loading")}</Note> : null}
        {turns.isError ? <Note phone={phone} tone="error">{t("pages.sidebarTabs.chatsFailed")}</Note> : null}
        {turns.isSuccess && threads.length === 0 ? <Note phone={phone}>{t("pages.sidebarTabs.noChats")}</Note> : null}
        {threads.map((thread) => (
          <button
            key={thread.id}
            type="button"
            className={cn(rowClass(phone), "justify-between")}
            onClick={() => (onOpenChat ? onOpenChat(thread.id) : onNewChat())}
            data-sidebar-chat={thread.id}
          >
            <span className="min-w-0 flex-1 truncate">{thread.title || t("aiAssistant.sidebar.newThread")}</span>
            <span className={cn("shrink-0 text-slate-400", phone ? "text-xs" : "text-[11px]")}>{whenLabel(thread.updatedAt, i18n.language)}</span>
          </button>
        ))}
      </div>
    </div>
  );
};

const eventStart = (event: CalendarEventView) => new Date(event.allDay ? `${event.start}T00:00:00` : event.start);

const dayLabel = (date: Date, language: string, t: (key: string) => string) => {
  const today = new Date();
  const tomorrow = new Date(today);
  tomorrow.setDate(today.getDate() + 1);
  if (date.toDateString() === today.toDateString()) return t("pages.sidebarTabs.today");
  if (date.toDateString() === tomorrow.toDateString()) return t("pages.sidebarTabs.tomorrow");
  return date.toLocaleDateString(language, { weekday: "long", month: "short", day: "numeric" });
};

/** The Meetings tab: what is coming up, by day, with a page of notes one click away. */
export const MeetingsTabPanel = ({ phone, events, connected, error, loading, onManage, onTakeNotes }: {
  phone: boolean;
  events: CalendarEventView[];
  connected: boolean;
  error: string | null;
  loading: boolean;
  onManage: () => void;
  onTakeNotes?: (event: CalendarEventView) => void;
}) => {
  const { t, i18n } = useTranslation();
  const days = new Map<string, { label: string; events: CalendarEventView[] }>();
  for (const event of events) {
    const start = eventStart(event);
    const key = start.toDateString();
    const day = days.get(key) ?? { label: dayLabel(start, i18n.language, t), events: [] };
    day.events.push(event);
    days.set(key, day);
  }
  const iconClass = phone ? "h-5 w-5" : "h-4 w-4";
  return (
    <div role="tabpanel" id="sidebar-panel-meetings" aria-labelledby="sidebar-tab-meetings" className="space-y-px" data-sidebar-panel="meetings">
      {connected ? (
        <Row phone={phone} icon={<Settings2 className={iconClass} aria-hidden="true" />} label={t("pages.calendar.manage")} onClick={onManage} data="manage-calendars" />
      ) : (
        <>
          <Row phone={phone} icon={<CalendarDays className={iconClass} aria-hidden="true" />} label={t("pages.calendar.connect")} onClick={onManage} data="connect-calendar" />
          <Note phone={phone}>{t("pages.sidebarTabs.meetingsHint")}</Note>
        </>
      )}
      {connected && loading ? <Note phone={phone}>{t("pages.sidebarTabs.loading")}</Note> : null}
      {connected && error && events.length === 0 ? <Note phone={phone} tone="error">{error}</Note> : null}
      {connected && !loading && !error && events.length === 0 ? <Note phone={phone}>{t("pages.calendar.none")}</Note> : null}
      {[...days.entries()].map(([key, day]) => (
        <section key={key} className={phone ? "pt-3" : "pt-2"} aria-label={day.label}>
          <Heading phone={phone}>{day.label}</Heading>
          {day.events.map((event) => (
            <div key={event.id} className={cn("group flex items-center gap-2 rounded-md hover:bg-slate-100", phone ? "min-h-11 px-3 py-1.5" : "px-2 py-1")} data-sidebar-meeting>
              <Video className={cn("shrink-0 text-slate-400", phone ? "h-[18px] w-[18px]" : "h-3.5 w-3.5")} aria-hidden="true" />
              <div className="min-w-0 flex-1">
                <div className={cn("truncate text-slate-800", phone ? "text-base" : "text-sm")}>{event.title}</div>
                {event.allDay ? null : (
                  <div className={cn("truncate text-slate-500", phone ? "text-sm" : "text-xs")}>
                    {eventStart(event).toLocaleTimeString(i18n.language, { hour: "numeric", minute: "2-digit" })}
                  </div>
                )}
              </div>
              {onTakeNotes ? (
                <button
                  type="button"
                  className={cn(
                    "flex shrink-0 items-center gap-1 rounded text-slate-500 hover:bg-slate-200/70 hover:text-slate-900 focus-visible:opacity-100",
                    phone ? "h-9 px-2 text-sm" : "h-6 px-1.5 text-xs opacity-0 group-hover:opacity-100",
                  )}
                  onClick={() => onTakeNotes(event)}
                  data-sidebar-take-notes
                >
                  <NotebookPen className="h-3.5 w-3.5" aria-hidden="true" />
                  {t("pages.sidebarTabs.takeNotes")}
                </button>
              ) : null}
            </div>
          ))}
        </section>
      ))}
    </div>
  );
};
