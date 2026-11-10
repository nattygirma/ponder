import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import { ChevronDown, ChevronRight, Image as ImageIcon, Link2, Lock, Smile, Users, X } from "lucide-react";
import type { ReactNode } from "react";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Input } from "@/components/ui/input";
import { api } from "@/lib/api";
import { cn } from "@/lib/utils";
import { useRowContext } from "@/components/database/useDatabase";
import { usePages } from "./PagesProvider";
import { PageIcon } from "./PageTree";
import { useActiveWorkspace } from "./PagesSidebar";

const EMOJI = [
  "📄","📝","📚","📌","📎","📅","🗂️","🗒️","📊","📈","💡","🔥","⭐","✅","❗","❓","🎯","🚀","🏁","🧭",
  "🧠","🛠️","⚙️","🔧","🔒","🔑","💬","📣","📬","💼","💰","🛒","🏠","🏢","🌍","🌱","🌳","🌸","☀️","🌙",
  "⚡","🎨","🎵","🎬","📷","🎮","🍎","☕","🍕","✈️","🚗","🏃","👋","👍","❤️","🙂","😎","🤔","🎉","🎁",
];

const GRADIENTS = [
  "linear-gradient(120deg,#f6d365,#fda085)",
  "linear-gradient(120deg,#a1c4fd,#c2e9fb)",
  "linear-gradient(120deg,#84fab0,#8fd3f4)",
  "linear-gradient(120deg,#cfd9df,#e2ebf0)",
  "linear-gradient(120deg,#fbc2eb,#a6c1ee)",
  "linear-gradient(120deg,#30cfd0,#330867)",
  "linear-gradient(120deg,#434343,#000000)",
  "linear-gradient(120deg,#c79081,#dfa579)",
];

const coverStyle = (cover: string) => {
  if (cover.startsWith("gradient:")) {
    return { backgroundImage: GRADIENTS[Number(cover.slice(9))] ?? GRADIENTS[0] };
  }
  return { backgroundImage: `url("${cover.replace(/["\\\n]/g, "")}")`, backgroundSize: "cover", backgroundPosition: "center" };
};

const isSafeCoverUrl = (value: string) => {
  try {
    return new URL(value).protocol === "https:";
  } catch {
    return false;
  }
};

/** Icon and cover for a page in the tree, or for a database row, which isn't in the tree. */
const usePageMeta = (memoId: string) => {
  const pages = usePages();
  const treePage = pages?.getPage(memoId);
  const context = useRowContext(memoId, Boolean(pages?.enabled && !treePage));
  return treePage ?? context.data?.row;
};

export const PageBreadcrumbs = ({ memoId, fallbackTitle, location }: { memoId: string; fallbackTitle: string; location?: ReactNode }) => {
  const pages = usePages();
  const { t } = useTranslation();
  const page = pages?.getPage(memoId);
  if (!pages) return null;
  const ancestors = pages.ancestorsOf(memoId);
  return (
    <nav aria-label={t("pages.breadcrumbs")} className="flex h-8 w-full min-w-0 items-center gap-0.5 overflow-hidden px-2 text-xs text-slate-500">
      {ancestors.map((ancestor) => (
        <span key={ancestor.id} className="flex min-w-0 items-center gap-0.5">
          <button
            type="button"
            className="flex min-w-0 max-w-40 items-center gap-1 rounded px-1 py-0.5 hover:bg-slate-100"
            onClick={() => pages.openPage(ancestor)}
          >
            <PageIcon icon={ancestor.icon} className="h-3.5 w-3.5" />
            <span className="truncate">{ancestor.title?.trim() || t("common.untitledMemo")}</span>
          </button>
          <ChevronRight className="h-3 w-3 shrink-0" aria-hidden="true" />
        </span>
      ))}
      <span className="flex min-w-0 items-center gap-1 px-1 font-medium text-slate-800">
        <PageIcon icon={page?.icon} className="h-3.5 w-3.5" />
        <span className="truncate">{fallbackTitle || t("common.untitledMemo")}</span>
      </span>
      {location}
    </nav>
  );
};

/** Where the page lives, beside its title; opens the list of places it can move to. */
export const PageLocationChip = ({ notebookId, options, disabled, onMove }: {
  notebookId: string;
  options: Array<{ id: string; selectLabel: string }>;
  disabled: boolean;
  onMove: (notebookId: string) => void;
}) => {
  const pages = usePages();
  const { t } = useTranslation();
  const workspace = useActiveWorkspace();
  if (!pages) return null;
  const atRoot = notebookId === pages.rootNotebookId;
  const isTeam = Boolean(workspace && !workspace.isPersonal);
  const label = !atRoot ? pages.notebookName(notebookId) : isTeam ? workspace?.name ?? "" : t("pages.sidebar.private");
  const Icon = isTeam ? Users : Lock;
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button type="button" disabled={disabled} className="flex shrink-0 items-center gap-1 rounded px-1 py-0.5 text-slate-500 hover:bg-slate-100 disabled:hover:bg-transparent" data-page-location>
          <Icon className="h-3 w-3" aria-hidden="true" />
          <span className="max-w-32 truncate">{label}</span>
          <ChevronDown className="h-3 w-3" aria-hidden="true" />
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" className="max-h-72 w-56 overflow-y-auto">
        <div className="px-2 py-1 text-xs text-slate-500">{t("pages.topBar.moveTo")}</div>
        {options.map((option) => (
          <DropdownMenuItem key={option.id} disabled={option.id === notebookId} onSelect={() => onMove(option.id)}>
            {option.id === pages.rootNotebookId ? t("pages.topBar.topLevel") : option.selectLabel}
          </DropdownMenuItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  );
};

export const PageCover = ({ memoId, readOnly }: { memoId: string; readOnly: boolean }) => {
  const pages = usePages();
  const { t } = useTranslation();
  const cover = usePageMeta(memoId)?.cover;
  if (!pages || !cover) return null;
  return (
    <div className="group relative h-44 w-full bg-cover" style={coverStyle(cover)} data-page-cover>
      {readOnly ? null : (
        <button
          type="button"
          className="absolute right-3 bottom-3 hidden items-center gap-1 rounded-md bg-black/55 px-2 py-1 text-xs text-white group-hover:flex"
          onClick={() => void pages.updatePage(memoId, { cover: null })}
        >
          <X className="h-3 w-3" aria-hidden="true" />
          {t("pages.removeCover")}
        </button>
      )}
    </div>
  );
};

const Backlinks = ({ memoId }: { memoId: string }) => {
  const pages = usePages();
  const { t } = useTranslation();
  const [open, setOpen] = useState(false);
  const query = useQuery({
    queryKey: ["page-backlinks", memoId],
    queryFn: () => api.getPageBacklinks(memoId),
    staleTime: 30_000,
  });
  const backlinks = query.data?.backlinks ?? [];
  if (!pages || backlinks.length === 0) return null;
  return (
    <div className="mt-1 text-xs text-slate-500" data-page-backlinks>
      <button
        type="button"
        className="flex items-center gap-1 rounded px-1 py-0.5 hover:bg-slate-100"
        aria-expanded={open}
        onClick={() => setOpen((value) => !value)}
      >
        <Link2 className="h-3 w-3" aria-hidden="true" />
        {t("pages.linkedFrom", { count: backlinks.length })}
      </button>
      {open ? (
        <ul className="mt-1 space-y-0.5">
          {backlinks.map((link) => (
            <li key={link.id}>
              <button
                type="button"
                className="flex w-full min-w-0 items-center gap-1.5 rounded px-1 py-1 text-left hover:bg-slate-100"
                onClick={() => pages.openPage(link)}
              >
                <PageIcon icon={link.icon} className="h-3.5 w-3.5" />
                <span className="truncate font-medium text-slate-700">{link.title?.trim() || t("common.untitledMemo")}</span>
                <span className="min-w-0 flex-1 truncate">{link.excerpt}</span>
              </button>
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  );
};

export const PageHeader = ({ memoId, readOnly, titleInput }: { memoId: string; readOnly: boolean; titleInput: ReactNode }) => {
  const pages = usePages();
  const { t } = useTranslation();
  const [customEmoji, setCustomEmoji] = useState("");
  const [coverUrl, setCoverUrl] = useState("");
  const page = usePageMeta(memoId);
  if (!pages) return null;

  const setIcon = (icon: string | null) => void pages.updatePage(memoId, { icon });

  const iconPicker = (trigger: ReactNode) => (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>{trigger}</DropdownMenuTrigger>
      <DropdownMenuContent align="start" className="w-72 p-2">
        <div className="grid grid-cols-10 gap-0.5">
          {EMOJI.map((emoji) => (
            <button key={emoji} type="button" className="h-6 w-6 rounded text-sm hover:bg-slate-100" aria-label={emoji} onClick={() => setIcon(emoji)}>
              {emoji}
            </button>
          ))}
        </div>
        <form
          className="mt-2 flex gap-1"
          onSubmit={(event) => {
            event.preventDefault();
            if (customEmoji.trim()) setIcon(customEmoji.trim().slice(0, 16));
            setCustomEmoji("");
          }}
          onKeyDown={(event) => event.stopPropagation()}
        >
          <Input value={customEmoji} onChange={(event) => setCustomEmoji(event.target.value)} placeholder={t("pages.typeEmoji")} className="h-7 text-xs" aria-label={t("pages.typeEmoji")} />
        </form>
        {page?.icon ? (
          <button type="button" className="mt-1 w-full rounded px-2 py-1 text-left text-xs text-slate-600 hover:bg-slate-100" onClick={() => setIcon(null)}>
            {t("pages.removeIcon")}
          </button>
        ) : null}
      </DropdownMenuContent>
    </DropdownMenu>
  );

  return (
    <div className={cn("group/page-header pb-2", page?.cover ? "pt-0" : "pt-10")} data-page-header>
      {page?.icon ? (
        <div className={cn("relative", page.cover && "-mt-9")}>
          {iconPicker(
            <button type="button" className="rounded-md text-[3.5rem] leading-none hover:bg-slate-100/60 disabled:cursor-default" disabled={readOnly} aria-label={t("pages.changeIcon")}>
              {page.icon}
            </button>,
          )}
        </div>
      ) : null}
      {readOnly ? null : (
        <div className="flex h-7 items-center gap-1 text-xs text-slate-500 opacity-0 transition-opacity group-focus-within/page-header:opacity-100 group-hover/page-header:opacity-100">
          {page?.icon ? null : iconPicker(
            <button type="button" className="flex items-center gap-1 rounded px-1.5 py-1 hover:bg-slate-100">
              <Smile className="h-3.5 w-3.5" aria-hidden="true" />
              {t("pages.addIcon")}
            </button>,
          )}
          {page?.cover ? null : (
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <button type="button" className="flex items-center gap-1 rounded px-1.5 py-1 hover:bg-slate-100">
                  <ImageIcon className="h-3.5 w-3.5" aria-hidden="true" />
                  {t("pages.addCover")}
                </button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="start" className="w-72 p-2">
                <div className="grid grid-cols-4 gap-1">
                  {GRADIENTS.map((gradient, index) => (
                    <button
                      key={gradient}
                      type="button"
                      className="h-10 rounded"
                      style={{ backgroundImage: gradient }}
                      aria-label={t("pages.coverOption", { index: index + 1 })}
                      onClick={() => void pages.updatePage(memoId, { cover: `gradient:${index}` })}
                    />
                  ))}
                </div>
                <form
                  className="mt-2"
                  onSubmit={(event) => {
                    event.preventDefault();
                    if (isSafeCoverUrl(coverUrl.trim())) void pages.updatePage(memoId, { cover: coverUrl.trim() });
                    setCoverUrl("");
                  }}
                  onKeyDown={(event) => event.stopPropagation()}
                >
                  <Input value={coverUrl} onChange={(event) => setCoverUrl(event.target.value)} placeholder={t("pages.coverUrl")} className="h-7 text-xs" aria-label={t("pages.coverUrl")} />
                </form>
              </DropdownMenuContent>
            </DropdownMenu>
          )}
        </div>
      )}
      {titleInput}
      <Backlinks memoId={memoId} />
    </div>
  );
};
