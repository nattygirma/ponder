import { type ReactNode } from "react";
import { MoreHorizontal, Search } from "lucide-react";
import { useTranslation } from "react-i18next";
import { ExecutionCenterButton } from "@/components/execution/ExecutionCenterButton";
import { GitHubRepositoryLink } from "@/components/GitHubRepositoryLink";
import { Button, buttonVariants } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuSub,
  DropdownMenuSubContent,
  DropdownMenuSubTrigger,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { IconTooltip } from "@/components/editor/EditorPaneChrome";
import { cn } from "@/lib/utils";

export const MemoEditorHeaderActions = ({
  hideRepositoryLink = false,
  pageMenu,
  pageMenuFooter,
  moreButtonClassName,
  moreMenuClassName,
  moreMenuItems,
  onOpenExecutionCenter,
  onSearch,
  textNoteActions,
  textNoteMenuItems,
}: {
  hideRepositoryLink?: boolean;
  /** In the page layout these lead the menu, and everything else moves under More. */
  pageMenu?: ReactNode;
  pageMenuFooter?: ReactNode;
  moreButtonClassName?: string;
  moreMenuClassName?: string;
  moreMenuItems: ReactNode;
  onOpenExecutionCenter: () => void;
  onSearch?: () => void;
  textNoteActions?: ReactNode;
  textNoteMenuItems?: ReactNode;
}) => {
  const { t } = useTranslation();
  const groups = (
    <>
      {textNoteMenuItems}
          {onSearch ? (
            <DropdownMenuItem
              className="flex h-9 w-full items-center gap-2 px-3 text-left text-xs text-slate-700 hover:bg-slate-50 cursor-pointer outline-none"
              onClick={onSearch}
            >
              <Search className="h-4 w-4 text-slate-500" />
              {t("editor.searchCurrentMemo")}
            </DropdownMenuItem>
          ) : null}
          {moreMenuItems}
    </>
  );

  return (
    <>
      {textNoteActions}
      {hideRepositoryLink ? null : (
        <GitHubRepositoryLink
          className={cn(
            buttonVariants({ variant: "ghost", size: "icon" }),
            "hidden text-slate-500 hover:text-slate-950 sm:inline-flex",
          )}
          iconClassName="h-4 w-4"
        />
      )}
      <ExecutionCenterButton className="h-8 w-8" onClick={onOpenExecutionCenter} />
      <DropdownMenu>
        <IconTooltip label={t("editor.more")}><DropdownMenuTrigger asChild>
          <Button
            className={moreButtonClassName}
            size="icon"
            variant="ghost"
            aria-label={t("editor.moreAria")}
          >
            <MoreHorizontal className="h-4 w-4" />
          </Button>
        </DropdownMenuTrigger></IconTooltip>
        <DropdownMenuContent
          align="end"
          className={cn("border border-slate-200 bg-card py-1 shadow-md", moreMenuClassName)}
        >
          {pageMenu ? (
            <>
              {pageMenu}
              <DropdownMenuSub>
                <DropdownMenuSubTrigger className="flex h-9 w-full items-center gap-2 px-3 text-left text-xs text-slate-700">{t("pages.topBar.more")}</DropdownMenuSubTrigger>
                <DropdownMenuSubContent className="max-h-96 w-56 overflow-y-auto">{groups}</DropdownMenuSubContent>
              </DropdownMenuSub>
              {pageMenuFooter ? <DropdownMenuSeparator /> : null}
              {pageMenuFooter}
            </>
          ) : groups}
        </DropdownMenuContent>
      </DropdownMenu>
    </>
  );
};
