import type { ReactNode } from "react";
import { useTranslation } from "react-i18next";
import { Menu } from "lucide-react";
import { cn } from "@/lib/utils";

/** Asks the workspace to slide the page sidebar in, the way Notion's phone app does. */
export const OPEN_PAGE_DRAWER_EVENT = "ponder:open-page-drawer";

export const openPageDrawer = () => window.dispatchEvent(new Event(OPEN_PAGE_DRAWER_EVENT));

/** The menu button at the left of every phone top bar. Hidden once the sidebar is always shown. */
export const PhoneMenuButton = ({ className }: { className?: string }) => {
  const { t } = useTranslation();
  return (
    <button
      type="button"
      className={cn("flex h-11 w-9 shrink-0 items-center justify-center rounded-md text-slate-700 active:bg-slate-100 lg:hidden", className)}
      aria-label={t("pages.sidebar.openSidebar")}
      data-phone-menu
      onClick={openPageDrawer}
    >
      <Menu className="h-5 w-5" aria-hidden="true" />
    </button>
  );
};

/** A 44px phone top bar for views that have no page header of their own (Home, Library, Connections). */
export const PhoneTopBar = ({ title, icon, actions }: { title: string; icon?: ReactNode; actions?: ReactNode }) => (
  <div className="sticky top-0 z-20 flex h-11 shrink-0 items-center gap-1 bg-[var(--workspace-editor)] px-1 pt-[env(safe-area-inset-top)] lg:hidden" data-phone-top-bar>
    <PhoneMenuButton />
    {icon ? <span className="flex h-5 w-5 shrink-0 items-center justify-center text-slate-500">{icon}</span> : null}
    <span className="min-w-0 flex-1 truncate text-base text-slate-900">{title}</span>
    {actions}
  </div>
);
