/*
 * Adapted from AppFlowy-Web (https://github.com/AppFlowy-IO/AppFlowy-Web), Copyright AppFlowy, AGPL-3.0.
 * Sources: src/components/editor/components/leaf/mention/MentionLeaf.tsx (one inline leaf that picks
 * the person, page or date view), MentionPerson.tsx (a dimmed "@" before the live member name, the
 * saved name until members load), MentionPage.tsx (the page icon with a link-arrow overlay before the
 * live page title, opening the page on click) and MentionDate.tsx (the date with a reminder icon that
 * opens the date picker in a popover, writing changes back to the mention). The Slate leaf becomes a
 * TipTap node view; the look follows Notion (gray person and date, underlined page, blue reminder).
 */
import { useState, type MouseEvent } from "react";
import { useTranslation } from "react-i18next";
import { NodeViewWrapper, ReactNodeViewRenderer, type NodeViewProps } from "@tiptap/react";
import * as HoverCardPrimitive from "@radix-ui/react-hover-card";
import { AlarmClock, ArrowUpRight } from "lucide-react";
import {
  formatMentionDate,
  Mention,
  normalizeMentionAttributes,
  reminderFireTime,
  type MentionAttributes,
} from "@ponder/shared";
import { HoverCard, HoverCardTrigger } from "@/components/ui/hover-card";
import { Popover, PopoverAnchor, PopoverContent } from "@/components/ui/popover";
import { usePages } from "@/components/pages/PagesProvider";
import { useViewer } from "@/components/teams/Teams";
import { cn } from "@/lib/utils";
import { MentionDatePicker, type MentionDateValue } from "./MentionDatePicker";
import { createReminderId, MentionAvatar, MentionPageIcon } from "./MentionPanel";
import { memberDisplayName, useMentionableMembers } from "./mentionable-members";

export type EditorMentionOptions = {
  /** Opens a mentioned page; the page tree is used when it knows the page. */
  onOpenPage: (pageId: string) => void;
};

const MentionPerson = ({ attrs }: { attrs: MentionAttributes }) => {
  const { t } = useTranslation();
  const viewer = useViewer();
  const members = useMentionableMembers();
  const member = members.find((item) => item.id === attrs.id);
  const name = member ? memberDisplayName(member) : attrs.label || t("pages.mention.someone");
  const role = member ? t(`pages.mention.roles.${member.role}`) : "";
  return (
    <HoverCard openDelay={350} closeDelay={80}>
      <HoverCardTrigger asChild>
        <span className="ponder-mention-person" data-mention-id={attrs.id}>
          <span className="ponder-mention-at">@</span>{name}
        </span>
      </HoverCardTrigger>
      <HoverCardPrimitive.Portal>
        <HoverCardPrimitive.Content
          side="top"
          align="start"
          sideOffset={6}
          className="ponder-mention-card z-50 flex w-64 items-center gap-3 rounded-lg border border-slate-200 bg-card p-3 text-sm shadow-lg"
        >
          <MentionAvatar name={name} className="h-9 w-9 text-sm" />
          <span className="flex min-w-0 flex-col">
            <span className="truncate font-medium text-slate-900">
              {name}{viewer?.id === attrs.id ? ` (${t("pages.mention.you")})` : ""}
            </span>
            {role && <span className="truncate text-xs text-slate-500">{role}</span>}
          </span>
        </HoverCardPrimitive.Content>
      </HoverCardPrimitive.Portal>
    </HoverCard>
  );
};

const MentionPage = ({ attrs, onOpenPage }: { attrs: MentionAttributes; onOpenPage: (pageId: string) => void }) => {
  const { t } = useTranslation();
  const pages = usePages();
  const page = pages?.getPage(attrs.id);
  const title = page ? page.title?.trim() || t("common.untitledMemo") : attrs.label || t("common.untitledMemo");
  const open = (event: MouseEvent) => {
    event.preventDefault();
    event.stopPropagation();
    if (page && pages) pages.openPage(page);
    else onOpenPage(attrs.id);
  };
  return (
    <span
      className="ponder-mention-page"
      role="link"
      tabIndex={-1}
      data-mention-id={attrs.id}
      onClick={open}
      onMouseDown={(event) => event.preventDefault()}
    >
      <span className="ponder-mention-page-icon">
        <MentionPageIcon icon={page?.icon} database={Boolean(page?.databaseId)} className="h-[1.1em] w-[1.1em] text-[1em]" />
        <ArrowUpRight className="ponder-mention-page-arrow" aria-hidden="true" strokeWidth={3} />
      </span>
      <span className="ponder-mention-page-title">{title}</span>
    </span>
  );
};

const MentionDate = ({ attrs, isEditable, updateAttributes, deleteNode }: {
  attrs: MentionAttributes;
  /** Read when clicked: the editor turns editable after its node views first render. */
  isEditable: () => boolean;
  updateAttributes: (attrs: Partial<MentionAttributes>) => void;
  deleteNode: () => void;
}) => {
  const { t } = useTranslation();
  const viewer = useViewer();
  const [open, setOpen] = useState(false);
  const reminder = Boolean(attrs.remind && attrs.remindAt);
  const text = (
    <span className={cn("ponder-mention-date", reminder && "has-reminder")}>
      <span className="ponder-mention-at">@</span>{formatMentionDate(attrs.date, attrs.includeTime)}
      {reminder && <AlarmClock className="ponder-mention-date-icon" aria-label={t("pages.mention.reminderSet")} />}
    </span>
  );
  const change = (value: MentionDateValue) => {
    const remind = value.remind && value.remind !== "none" ? value.remind : "";
    const fireAt = remind ? reminderFireTime(value.date, value.includeTime, remind) : null;
    const next = normalizeMentionAttributes({
      kind: "date",
      date: value.date,
      includeTime: value.includeTime,
      remind,
      remindAt: fireAt?.toISOString() ?? "",
      // The same reminder moves with the date; whoever changes it is the one reminded.
      reminderId: remind ? attrs.reminderId || createReminderId() : "",
      remindedBy: remind ? viewer?.id ?? attrs.remindedBy : "",
    });
    if (next) updateAttributes(next);
  };

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverAnchor asChild>
        <span
          role="button"
          tabIndex={-1}
          onMouseDown={(event) => event.preventDefault()}
          onClick={(event) => {
            if (!isEditable()) return;
            event.stopPropagation();
            setOpen(true);
          }}
        >
          {text}
        </span>
      </PopoverAnchor>
      <PopoverContent
        side="bottom"
        align="start"
        sideOffset={6}
        collisionPadding={8}
        className="max-h-[var(--radix-popover-content-available-height)] w-auto overflow-y-auto p-0"
        onOpenAutoFocus={(event) => event.preventDefault()}
      >
        <MentionDatePicker
          value={{ date: attrs.date, includeTime: attrs.includeTime, remind: attrs.remind }}
          canRemind={Boolean(viewer?.id)}
          labels={{
            includeTime: t("pages.mention.includeTime"),
            remind: t("pages.mention.remind"),
            clear: t("pages.mention.clear"),
            today: t("pages.mention.today"),
            previousMonth: t("pages.mention.previousMonth"),
            nextMonth: t("pages.mention.nextMonth"),
            dateInput: t("pages.mention.dateInput"),
            timeInput: t("pages.mention.timeInput"),
          }}
          onChange={change}
          onClear={() => {
            setOpen(false);
            deleteNode();
          }}
        />
      </PopoverContent>
    </Popover>
  );
};

const MentionView = ({ node, editor, extension, updateAttributes, deleteNode, selected }: NodeViewProps) => {
  const attrs = normalizeMentionAttributes(node.attrs as MentionAttributes);
  const options = extension.options as EditorMentionOptions;
  return (
    <NodeViewWrapper
      as="span"
      className={cn("ponder-mention", attrs && `ponder-mention-${attrs.kind}-wrap`, selected && "is-selected")}
      data-ponder-mention={attrs?.kind ?? "invalid"}
    >
      {!attrs ? null
        : attrs.kind === "person" ? <MentionPerson attrs={attrs} />
        : attrs.kind === "page" ? <MentionPage attrs={attrs} onOpenPage={options.onOpenPage} />
        : (
          <MentionDate
            attrs={attrs}
            isEditable={() => editor.isEditable}
            updateAttributes={updateAttributes as (attrs: Partial<MentionAttributes>) => void}
            deleteNode={deleteNode}
          />
        )}
    </NodeViewWrapper>
  );
};

/** The mention node with its editor view. */
export const EditorMention = Mention.extend<EditorMentionOptions>({
  addOptions() {
    return { onOpenPage: () => undefined };
  },
  addNodeView() {
    return ReactNodeViewRenderer(MentionView, { as: "span", className: "ponder-mention-root" });
  },
});
