/*
 * Adapted from AppFlowy-Web (https://github.com/AppFlowy-IO/AppFlowy-Web), Copyright AppFlowy, AGPL-3.0.
 * Source: src/components/editor/components/panels/mention-panel/MentionPanel.tsx (the panel's
 * sections with titles and dividers, the result rows with an icon per kind, the person avatar
 * fallback, the "Create … sub-page" row, keyboard handling that wraps across sections and scrolls
 * the selected row into view, and inserting the chosen mention in place of the typed `@query`).
 * The Slate/Yjs plumbing is replaced by a TipTap Suggestion; sections and wording follow Notion.
 */
import { forwardRef, useEffect, useImperativeHandle, useRef, useState } from "react";
import { Extension, type Editor, type Range } from "@tiptap/core";
import { ReactRenderer } from "@tiptap/react";
import { PluginKey } from "@tiptap/pm/state";
import { shift } from "@floating-ui/react-dom";
import Suggestion, { type SuggestionKeyDownProps, type SuggestionProps } from "@tiptap/suggestion";
import { AlarmClock, Clock, Database, FileText, Plus } from "lucide-react";
import {
  MENTION_NODE_TYPE,
  normalizeMentionAttributes,
  reminderFireTime,
  type MentionAttributes,
  type WorkspaceMember,
} from "@ponder/shared";
import { cn } from "@/lib/utils";
import {
  buildMentionOptions,
  groupMentionOptions,
  hasMentionResults,
  type MentionLabels,
  type MentionMode,
  type MentionOption,
  type MentionPageCandidate,
  type MentionSectionKind,
} from "./mention-panel-items";

export type MentionPanelLabels = MentionLabels & {
  menu: string;
  sections: Record<MentionSectionKind, string>;
  you: string;
  newSubPage: (title: string) => string;
  addSubPage: string;
  empty: string;
  placeholders: Record<Exclude<MentionMode, "all">, string>;
};

type PanelProps = SuggestionProps<MentionOption, MentionOption> & { labels: MentionPanelLabels; mode: MentionMode };

export type MentionPanelHandle = { onKeyDown: (props: SuggestionKeyDownProps) => boolean };

const initials = (name: string) => name.trim().slice(0, 1).toUpperCase() || "?";

export const MentionAvatar = ({ name, className }: { name: string; className?: string }) => (
  <span
    aria-hidden="true"
    className={cn("ponder-mention-avatar flex h-5 w-5 shrink-0 items-center justify-center rounded-full text-[11px] font-medium", className)}
  >
    {initials(name)}
  </span>
);

/** A page's emoji icon, or a page or database glyph, as the page tree shows it. */
export const MentionPageIcon = ({ icon, database, className }: { icon: string | null | undefined; database?: boolean; className?: string }) => {
  if (icon) return <span aria-hidden="true" className={cn("flex shrink-0 items-center justify-center leading-none", className)}>{icon}</span>;
  const Glyph = database ? Database : FileText;
  return <Glyph aria-hidden="true" className={cn("shrink-0 text-slate-400", className)} />;
};

const OptionIcon = ({ option }: { option: MentionOption }) => {
  if (option.kind === "date") {
    return option.remind
      ? <AlarmClock className="h-4 w-4 shrink-0 text-slate-500" aria-hidden="true" />
      : <Clock className="h-4 w-4 shrink-0 text-slate-500" aria-hidden="true" />;
  }
  if (option.kind === "person") return <MentionAvatar name={option.label} />;
  if (option.kind === "page") return <MentionPageIcon icon={option.icon} database={option.database} className="h-[18px] w-[18px] text-[15px]" />;
  return <Plus className="h-4 w-4 shrink-0 text-slate-500" aria-hidden="true" />;
};

const OptionText = ({ option, labels }: { option: MentionOption; labels: MentionPanelLabels }) => {
  if (option.kind === "createSubPage") {
    return <span className="min-w-0 flex-1 truncate">{option.title ? labels.newSubPage(option.title) : labels.addSubPage}</span>;
  }
  return (
    <span className="flex min-w-0 flex-1 items-baseline gap-1.5">
      <span className="truncate">{option.label}</span>
      {option.kind === "person" && option.isViewer && <span className="shrink-0 text-slate-400">({labels.you})</span>}
      {option.kind === "date" && option.hint && <span className="truncate text-xs text-slate-400">— {option.hint}</span>}
      {option.kind === "page" && option.subtitle && <span className="truncate text-xs text-slate-400">{option.subtitle}</span>}
    </span>
  );
};

export const MentionPanel = forwardRef<MentionPanelHandle, PanelProps>(({ items, command, labels }, ref) => {
  const [selected, setSelected] = useState(0);
  const listRef = useRef<HTMLDivElement>(null);
  useEffect(() => setSelected(0), [items]);

  useEffect(() => {
    listRef.current?.querySelector(`[data-option-index="${selected}"]`)?.scrollIntoView({ block: "nearest" });
  }, [selected]);

  useImperativeHandle(ref, () => ({
    onKeyDown: ({ event }) => {
      // Let an input method confirm its text instead of choosing a row.
      if (event.isComposing || !items.length) return false;
      if (event.key === "ArrowDown" || event.key === "ArrowUp") {
        const step = event.key === "ArrowDown" ? 1 : -1;
        setSelected((current) => (current + step + items.length) % items.length);
        return true;
      }
      if (event.key === "Enter" || event.key === "Tab") {
        command(items[Math.min(selected, items.length - 1)]);
        return true;
      }
      return false;
    },
  }), [command, items, selected]);

  const groups = groupMentionOptions(items);
  if (!items.length) return null;

  return (
    <div
      role="listbox"
      aria-label={labels.menu}
      ref={listRef}
      className="ponder-mention-panel max-h-[min(24rem,50dvh)] w-[min(24rem,calc(100vw-1.5rem))] overflow-y-auto rounded-xl border border-slate-200 bg-card py-1 text-sm text-slate-900 shadow-2xl ring-1 ring-slate-950/5"
      onMouseDown={(event) => event.preventDefault()}
    >
      {groups.map((group, groupIndex) => (
        <div key={group.section} className={cn("px-1 py-0.5", groupIndex > 0 && "mt-1 border-t border-slate-100 pt-1.5")}>
          <div className="px-2 pb-1 pt-1 text-xs font-medium text-slate-500">{labels.sections[group.section]}</div>
          {group.options.map(({ option, index }) => (
            <button
              key={option.key}
              type="button"
              role="option"
              aria-selected={index === selected}
              data-option-index={index}
              className={cn(
                "flex h-[33px] w-full items-center gap-2.5 rounded-md px-2 text-left text-sm text-slate-800",
                index === selected && "bg-slate-100",
              )}
              // Moving the mouse picks a row; a menu opening under a resting pointer doesn't.
              onMouseMove={() => index !== selected && setSelected(index)}
              onClick={() => command(option)}
            >
              <OptionIcon option={option} />
              <OptionText option={option} labels={labels} />
            </button>
          ))}
        </div>
      ))}
    </div>
  );
});
MentionPanel.displayName = "MentionPanel";

/** A reminder id unique enough to key a page's reminders. */
export const createReminderId = () => `rmd_${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`;

/** The attributes a chosen option puts in the document. */
export const mentionFromOption = (option: MentionOption, viewerId: string | null): MentionAttributes | null => {
  if (option.kind === "person") return normalizeMentionAttributes({ kind: "person", id: option.id, label: option.label });
  if (option.kind === "page") return normalizeMentionAttributes({ kind: "page", id: option.id, label: option.label });
  if (option.kind !== "date") return null;
  if (!option.remind) return normalizeMentionAttributes({ kind: "date", date: option.day });
  // Remind me: 9:00 AM on the day, in the setter's time zone, sent to the setter.
  return normalizeMentionAttributes({
    kind: "date",
    date: option.day,
    remind: "onDayOfEvent",
    remindAt: reminderFireTime(option.day, false, "onDayOfEvent")?.toISOString() ?? "",
    reminderId: createReminderId(),
    remindedBy: viewerId ?? "",
  });
};

/** Puts a mention in place of `range`, followed by a space, as Notion does. */
export const insertMention = (editor: Editor, range: Range, attrs: MentionAttributes) => {
  editor.chain().focus().insertContentAt(range, [
    { type: MENTION_NODE_TYPE, attrs },
    { type: "text", text: " " },
  ]).run();
};

// The `/` Inline items open the menu on one section; the next `@` typed by them picks it up.
const pendingModes = new WeakMap<Editor, MentionMode>();

/** Opens the `@` menu on one section, as Notion's "Mention a person" and "Date or reminder" do. */
export const startMention = (editor: Editor, mode: MentionMode) => {
  pendingModes.set(editor, mode);
  editor.chain().focus().insertContent("@").run();
};

export type MentionSuggestionOptions = {
  char?: "@" | "[[";
  isEnabled: () => boolean;
  getLabels: () => MentionPanelLabels;
  getViewerId: () => string | null;
  getCurrentPageId: () => string | null;
  recentPages: () => MentionPageCandidate[];
  searchPages: (query: string) => Promise<MentionPageCandidate[]>;
  parentTitle: (parentId: string) => string;
  /** Null when sub-pages can't be made here. */
  createSubPage: ((title: string) => Promise<{ id: string; title: string | null } | null>) | null;
  loadMembers: () => Promise<readonly WorkspaceMember[]>;
};

const PLACEHOLDER_PROPERTY = "--ponder-mention-placeholder";

/** Notion's `@` menu (and `[[`, which opens it on pages). */
export const createMentionSuggestionExtension = (options: MentionSuggestionOptions) => {
  const char = options.char ?? "@";
  const defaultMode: MentionMode = char === "[[" ? "pages" : "all";
  let mode: MentionMode = defaultMode;
  return Extension.create({
    name: char === "@" ? "ponderMentionSuggestion" : "ponderMentionSuggestionPages",
    addProseMirrorPlugins() {
      return [Suggestion<MentionOption, MentionOption>({
        editor: this.editor,
        pluginKey: new PluginKey(char === "@" ? "ponder-mention-suggestion" : "ponder-mention-suggestion-pages"),
        char,
        allowSpaces: true,
        allowedPrefixes: null,
        placement: "bottom-start",
        offset: { mainAxis: 6 },
        // On a phone the menu slides back inside the screen instead of running off its edge.
        floatingUi: { middleware: [shift({ padding: 12 })] },
        decorationClass: "ponder-mention-query",
        decorationEmptyClass: "is-empty",
        allow: ({ state, range }) => {
          const position = state.doc.resolve(range.from);
          const prefix = position.parent.textBetween(
            Math.max(0, position.parentOffset - 1), position.parentOffset, "\n",
            (node) => (node.type.name === "hardBreak" ? "\n" : "￼"),
          );
          return options.isEnabled() && this.editor.isEditable && position.parent.isTextblock
            && position.parent.type.name !== "codeBlock" && !position.parent.type.spec.code
            && (position.parentOffset === 0 || /[\s￼]/u.test(prefix));
        },
        items: async ({ query }) => {
          // A query that runs on past every match closes the menu, as Notion's does after a few words.
          if (query.length > 60) return [];
          const trimmed = query.trim();
          const wantsPages = mode === "all" || mode === "pages";
          const [members, pages] = await Promise.all([
            mode === "all" || mode === "people" ? options.loadMembers() : Promise.resolve([] as readonly WorkspaceMember[]),
            wantsPages ? (trimmed ? options.searchPages(trimmed) : Promise.resolve(options.recentPages())) : Promise.resolve([]),
          ]);
          const built = buildMentionOptions({
            mode,
            query,
            members,
            viewerId: options.getViewerId(),
            pages,
            currentPageId: options.getCurrentPageId(),
            parentTitle: options.parentTitle,
            canCreatePage: Boolean(options.createSubPage && options.getCurrentPageId()),
            labels: options.getLabels(),
          });
          // Nothing but "New page" means the words typed aren't a mention: let the menu close.
          return hasMentionResults(built) || (mode === "pages" && !trimmed) ? built : [];
        },
        command: ({ editor, range, props: option }) => {
          if (option.kind === "createSubPage") {
            const create = options.createSubPage;
            if (!create) return;
            editor.chain().focus().deleteRange(range).run();
            const at = range.from;
            void create(option.title).then((page) => {
              if (!page || editor.isDestroyed) return;
              const attrs = normalizeMentionAttributes({ kind: "page", id: page.id, label: page.title || option.title });
              const position = Math.min(at, editor.state.doc.content.size);
              if (attrs) insertMention(editor, { from: position, to: position }, attrs);
            });
            return;
          }
          const attrs = mentionFromOption(option, options.getViewerId());
          if (attrs) insertMention(editor, range, attrs);
        },
        render: () => {
          let renderer: ReactRenderer<MentionPanelHandle, PanelProps> | null = null;
          let unmount: (() => void) | null = null;
          let dom: HTMLElement | null = null;
          const propsFor = (props: SuggestionProps<MentionOption, MentionOption>) => ({ ...props, labels: options.getLabels(), mode });
          return {
            onBeforeStart: (props) => {
              mode = pendingModes.get(props.editor) ?? defaultMode;
              pendingModes.delete(props.editor);
              dom = props.editor.view.dom as HTMLElement;
              // The slash items say what to type after the `@`, as Notion's "Mention a date…".
              if (mode !== "all") dom.style.setProperty(PLACEHOLDER_PROPERTY, JSON.stringify(options.getLabels().placeholders[mode]));
            },
            onStart: (props) => {
              renderer = new ReactRenderer(MentionPanel, { editor: props.editor, props: propsFor(props) });
              unmount = props.mount(renderer.element);
            },
            onUpdate: (props) => renderer?.updateProps(propsFor(props)),
            onKeyDown: (props) => {
              if (props.event.key === "Escape") return false;
              return renderer?.ref?.onKeyDown(props) ?? false;
            },
            onExit: () => {
              dom?.style.removeProperty(PLACEHOLDER_PROPERTY);
              mode = defaultMode;
              unmount?.();
              renderer?.destroy();
              unmount = null;
              renderer = null;
            },
          };
        },
      })];
    },
  });
};
