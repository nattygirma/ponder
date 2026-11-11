import { forwardRef, useEffect, useImperativeHandle, useState, type ComponentType } from "react";
import { Extension, type Editor, type Range } from "@tiptap/core";
import { ReactRenderer } from "@tiptap/react";
import { PluginKey } from "@tiptap/pm/state";
import Suggestion, { type SuggestionKeyDownProps, type SuggestionProps } from "@tiptap/suggestion";
import {
  BetweenHorizontalStart,
  Bot,
  Braces,
  CalendarClock,
  CalendarDays,
  ChartColumn,
  ChevronsDownUp,
  Columns2,
  Columns3,
  Database,
  FileText,
  Lightbulb,
  MousePointerClick,
  Clock3,
  FileUp,
  Heading1,
  Heading2,
  Heading3,
  Heading4,
  Heading5,
  Heading6,
  Link,
  List,
  ListOrdered,
  ListTodo,
  Pilcrow,
  Quote,
  Sigma,
  Table,
} from "lucide-react";
import { BUTTON_NODE_TYPE, CALLOUT_NODE_TYPE, COLUMNS_NODE_TYPE, createColumnsContent } from "@ponder/shared";
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandItem,
  CommandList,
  CommandShortcut,
  COMMAND_ITEM_STRONG_SELECTED_CLASS_NAME,
} from "@/components/ui/command";

export type SlashCommandId =
  | "ai"
  | "paragraph"
  | "heading-1"
  | "heading-2"
  | "heading-3"
  | "heading-4"
  | "heading-5"
  | "heading-6"
  | "bullet-list"
  | "ordered-list"
  | "task-list"
  | "blockquote"
  | "code-block"
  | "divider"
  | "fold"
  | "table"
  | "inline-math"
  | "block-math"
  | "current-date"
  | "current-time"
  | "current-date-time"
  | "attachment"
  | "note-link"
  | "external-link"
  | "sub-page"
  | "callout"
  | "columns-2"
  | "columns-3"
  | "database"
  | "chart"
  | "button";

type SlashCommandGroup = "suggested" | "basic" | "insert";
type SlashCommandIcon = ComponentType<{ className?: string }>;

export type SlashCommandLabels = {
  menu: string;
  empty: string;
  close: string;
  groups: Record<SlashCommandGroup, string>;
  items: Record<SlashCommandId, string>;
};

export type SlashCommandActions = {
  openAi: () => void;
  openAttachmentPicker: () => void;
  openExternalLinkPicker: () => void;
  openNoteLinkPicker: () => void;
  openMathFormula: (kind: "inline" | "block", range?: { from: number; to: number }) => void;
  pagesAvailable: () => boolean;
  createSubPage: () => void;
  createDatabase: () => void;
  insertChart: () => void;
  /** Called just before a /button block goes in, so it opens its editor. */
  beforeInsertButton?: () => void;
};

export type SlashCommandItem = {
  command: string;
  id: SlashCommandId;
  group: SlashCommandGroup;
  icon: SlashCommandIcon;
  keywords: string[];
  label: string;
};

const slashCommandPluginKey = new PluginKey("ponder-slash-command");

const padDatePart = (value: number) => String(value).padStart(2, "0");

export const formatCurrentDate = (date: Date) =>
  `${date.getFullYear()}-${padDatePart(date.getMonth() + 1)}-${padDatePart(date.getDate())}`;

export const formatCurrentTime = (date: Date) =>
  `${padDatePart(date.getHours())}:${padDatePart(date.getMinutes())}`;

export const formatCurrentDateTime = (date: Date) =>
  `${formatCurrentDate(date)} ${formatCurrentTime(date)}`;

export const createSlashCommandItems = (labels: SlashCommandLabels): SlashCommandItem[] => [
  { id: "ai", command: "ai", group: "suggested", icon: Bot, label: labels.items.ai, keywords: ["assistant"] },
  { id: "paragraph", command: "text", group: "basic", icon: Pilcrow, label: labels.items.paragraph, keywords: ["paragraph"] },
  { id: "heading-1", command: "h1", group: "basic", icon: Heading1, label: labels.items["heading-1"], keywords: ["heading"] },
  { id: "heading-2", command: "h2", group: "basic", icon: Heading2, label: labels.items["heading-2"], keywords: ["heading"] },
  { id: "heading-3", command: "h3", group: "basic", icon: Heading3, label: labels.items["heading-3"], keywords: ["heading"] },
  { id: "heading-4", command: "h4", group: "basic", icon: Heading4, label: labels.items["heading-4"], keywords: ["heading"] },
  { id: "heading-5", command: "h5", group: "basic", icon: Heading5, label: labels.items["heading-5"], keywords: ["heading"] },
  { id: "heading-6", command: "h6", group: "basic", icon: Heading6, label: labels.items["heading-6"], keywords: ["heading"] },
  { id: "current-date", command: "date", group: "basic", icon: CalendarDays, label: labels.items["current-date"], keywords: ["today"] },
  { id: "current-time", command: "time", group: "basic", icon: Clock3, label: labels.items["current-time"], keywords: ["now"] },
  { id: "current-date-time", command: "datetime", group: "basic", icon: CalendarClock, label: labels.items["current-date-time"], keywords: ["timestamp"] },
  { id: "bullet-list", command: "bullet", group: "basic", icon: List, label: labels.items["bullet-list"], keywords: ["list"] },
  { id: "ordered-list", command: "numbered", group: "basic", icon: ListOrdered, label: labels.items["ordered-list"], keywords: ["ordered", "list"] },
  { id: "task-list", command: "task", group: "basic", icon: ListTodo, label: labels.items["task-list"], keywords: ["todo", "check"] },
  { id: "blockquote", command: "quote", group: "basic", icon: Quote, label: labels.items.blockquote, keywords: [] },
  { id: "code-block", command: "code", group: "basic", icon: Braces, label: labels.items["code-block"], keywords: [] },
  { id: "divider", command: "divider", group: "insert", icon: BetweenHorizontalStart, label: labels.items.divider, keywords: ["rule"] },
  { id: "fold", command: "fold", group: "insert", icon: ChevronsDownUp, label: labels.items.fold, keywords: ["collapse", "spoiler", "折りたたみ"] },
  { id: "table", command: "table", group: "insert", icon: Table, label: labels.items.table, keywords: [] },
  { id: "inline-math", command: "math", group: "insert", icon: Sigma, label: labels.items["inline-math"], keywords: ["latex", "formula", "katex", "数式"] },
  { id: "block-math", command: "equation", group: "insert", icon: Sigma, label: labels.items["block-math"], keywords: ["latex", "formula", "display", "katex", "数式"] },
  { id: "attachment", command: "upload", group: "insert", icon: FileUp, label: labels.items.attachment, keywords: ["file", "attachment"] },
  { id: "note-link", command: "note", group: "insert", icon: Link, label: labels.items["note-link"], keywords: ["link", "memo"] },
  { id: "external-link", command: "link", group: "insert", icon: Link, label: labels.items["external-link"], keywords: ["url", "web"] },
  { id: "sub-page", command: "page", group: "insert", icon: FileText, label: labels.items["sub-page"], keywords: ["subpage", "child"] },
  { id: "database", command: "database", group: "insert", icon: Database, label: labels.items.database, keywords: ["board", "calendar", "kanban"] },
  { id: "chart", command: "chart", group: "insert", icon: ChartColumn, label: labels.items.chart, keywords: ["graph", "bar", "line", "donut", "pie"] },
  { id: "button", command: "button", group: "insert", icon: MousePointerClick, label: labels.items.button, keywords: ["action", "automation", "click"] },
  { id: "callout", command: "callout", group: "basic", icon: Lightbulb, label: labels.items.callout, keywords: ["note", "tip", "warning"] },
  { id: "columns-2", command: "columns", group: "insert", icon: Columns2, label: labels.items["columns-2"], keywords: ["layout", "side"] },
  { id: "columns-3", command: "columns3", group: "insert", icon: Columns3, label: labels.items["columns-3"], keywords: ["layout", "side"] },
];

const PAGE_LAYOUT_COMMANDS = new Set<SlashCommandId>(["sub-page", "database", "chart", "button"]);

export const filterSlashCommandItems = (items: SlashCommandItem[], query: string) => {
  const normalizedQuery = query.trim().toLocaleLowerCase();
  if (!normalizedQuery) return items;
  return items.filter((item) => [item.command, item.label, item.id, ...item.keywords]
    .some((value) => value.toLocaleLowerCase().includes(normalizedQuery)));
};

type SlashCommandMenuProps = SuggestionProps<SlashCommandItem, SlashCommandItem> & {
  labels: SlashCommandLabels;
};

export type SlashCommandMenuHandle = {
  onKeyDown: (props: SuggestionKeyDownProps) => boolean;
};

const GROUP_ORDER: SlashCommandGroup[] = ["suggested", "basic", "insert"];

export const SlashCommandMenu = forwardRef<SlashCommandMenuHandle, SlashCommandMenuProps>(
  ({ command, items, labels }, ref) => {
    const [selectedIndex, setSelectedIndex] = useState(0);
    const selectedItem = items[Math.min(selectedIndex, Math.max(0, items.length - 1))];

    useEffect(() => setSelectedIndex(0), [items]);

    useImperativeHandle(ref, () => ({
      onKeyDown: ({ event }) => {
        if (!items.length) return false;
        if (event.key === "ArrowUp") {
          setSelectedIndex((current) => (current + items.length - 1) % items.length);
          return true;
        }
        if (event.key === "ArrowDown") {
          setSelectedIndex((current) => (current + 1) % items.length);
          return true;
        }
        if (event.key === "Enter") {
          command(items[Math.min(selectedIndex, items.length - 1)]);
          return true;
        }
        return false;
      },
    }), [command, items, selectedIndex]);

    return (
      <Command
        aria-label={labels.menu}
        className="w-[min(22rem,calc(100vw-1.5rem))] rounded-xl border border-slate-200 shadow-2xl ring-1 ring-slate-950/5"
        shouldFilter={false}
        value={selectedItem?.id}
        onValueChange={(value) => {
          const index = items.findIndex((item) => item.id === value);
          if (index >= 0) setSelectedIndex(index);
        }}
      >
        <CommandList className="max-h-[min(24rem,60dvh)] p-1.5">
          <CommandEmpty>{labels.empty}</CommandEmpty>
          {GROUP_ORDER.map((group) => {
            const groupItems = items.filter((item) => item.group === group);
            return groupItems.length ? (
              <CommandGroup key={group} heading={labels.groups[group]}>
                {groupItems.map((item) => {
                  const Icon = item.icon;
                  return (
                    <CommandItem
                      key={item.id}
                      value={item.id}
                      keywords={item.keywords}
                      className={COMMAND_ITEM_STRONG_SELECTED_CLASS_NAME}
                      onMouseDown={(event) => event.preventDefault()}
                      onSelect={() => command(item)}
                    >
                      <Icon className="h-4 w-4 shrink-0 text-slate-500" />
                      <span className="min-w-0 flex-1 truncate">{item.label}</span>
                      <CommandShortcut className="font-mono tracking-normal">/{item.command}</CommandShortcut>
                    </CommandItem>
                  );
                })}
              </CommandGroup>
            ) : null;
          })}
        </CommandList>
        <div className="flex items-center justify-between border-t border-slate-100 px-3 py-2 text-xs text-slate-400">
          <span>↑↓ · Enter</span>
          <span>{labels.close} · Esc</span>
        </div>
      </Command>
    );
  },
);
SlashCommandMenu.displayName = "SlashCommandMenu";

const runSlashCommand = ({
  actions,
  editor,
  item,
  range,
}: {
  actions: SlashCommandActions;
  editor: Editor;
  item: SlashCommandItem;
  range: Range;
}) => {
  const chain = editor.chain().focus().deleteRange(range);
  switch (item.id) {
    case "ai":
      chain.run();
      window.requestAnimationFrame(actions.openAi);
      break;
    case "paragraph": chain.setParagraph().run(); break;
    case "heading-1": chain.setHeading({ level: 1 }).run(); break;
    case "heading-2": chain.setHeading({ level: 2 }).run(); break;
    case "heading-3": chain.setHeading({ level: 3 }).run(); break;
    case "heading-4": chain.setHeading({ level: 4 }).run(); break;
    case "heading-5": chain.setHeading({ level: 5 }).run(); break;
    case "heading-6": chain.setHeading({ level: 6 }).run(); break;
    case "bullet-list": chain.toggleBulletList().run(); break;
    case "ordered-list": chain.toggleOrderedList().run(); break;
    case "task-list": chain.toggleTaskList().run(); break;
    case "blockquote": chain.toggleBlockquote().run(); break;
    case "code-block": chain.setCodeBlock().run(); break;
    case "divider": chain.setHorizontalRule().run(); break;
    case "fold": chain.setDetails().run(); break;
    case "table": chain.insertTable({ rows: 3, cols: 3, withHeaderRow: true }).run(); break;
    case "inline-math":
      chain.run();
      actions.openMathFormula("inline", { from: range.from, to: range.from });
      break;
    case "block-math":
      chain.run();
      actions.openMathFormula("block", { from: range.from, to: range.from });
      break;
    case "current-date": chain.insertContent(formatCurrentDate(new Date())).run(); break;
    case "current-time": chain.insertContent(formatCurrentTime(new Date())).run(); break;
    case "current-date-time": chain.insertContent(formatCurrentDateTime(new Date())).run(); break;
    case "attachment":
      chain.run();
      window.requestAnimationFrame(actions.openAttachmentPicker);
      break;
    case "note-link":
      chain.run();
      window.requestAnimationFrame(actions.openNoteLinkPicker);
      break;
    case "external-link":
      chain.run();
      window.requestAnimationFrame(actions.openExternalLinkPicker);
      break;
    case "sub-page":
      chain.run();
      actions.createSubPage();
      break;
    case "database":
      chain.run();
      actions.createDatabase();
      break;
    case "chart":
      chain.run();
      actions.insertChart();
      break;
    case "button":
      actions.beforeInsertButton?.();
      chain.insertContent([{ type: BUTTON_NODE_TYPE, attrs: { label: "", icon: "", actions: "[]" } }, { type: "paragraph" }]).run();
      break;
    case "callout": chain.wrapIn(CALLOUT_NODE_TYPE).run(); break;
    case "columns-2":
    case "columns-3": {
      chain.insertContent(createColumnsContent(item.id === "columns-2" ? 2 : 3)).run();
      // Typing starts on the left, however the insert left the selection.
      const { $from } = editor.state.selection;
      for (let depth = $from.depth; depth > 0; depth -= 1) {
        if ($from.node(depth).type.name === COLUMNS_NODE_TYPE) {
          editor.commands.setTextSelection($from.before(depth) + 3);
          break;
        }
      }
      break;
    }
  }
};

export const createSlashCommandExtension = ({
  actions,
  getLabels,
}: {
  actions: SlashCommandActions;
  getLabels: () => SlashCommandLabels;
}) => Extension.create({
  name: "ponderSlashCommand",
  addProseMirrorPlugins() {
    const availableItems = () => createSlashCommandItems(getLabels())
      .filter((item) => actions.pagesAvailable() || !PAGE_LAYOUT_COMMANDS.has(item.id));
    const initialItems = availableItems();
    return [Suggestion<SlashCommandItem, SlashCommandItem>({
      editor: this.editor,
      pluginKey: slashCommandPluginKey,
      char: "/",
      allowedPrefixes: [" "],
      placement: "bottom-start",
      offset: { mainAxis: 6 },
      decorationClass: "ponder-slash-command-query",
      initialItems,
      allow: ({ state, range }) => {
        const position = state.doc.resolve(range.from);
        return this.editor.isEditable && position.parent.type.name === "paragraph";
      },
      items: ({ query }) => filterSlashCommandItems(availableItems(), query),
      command: ({ editor, range, props }) => runSlashCommand({ actions, editor, item: props, range }),
      render: () => {
        let renderer: ReactRenderer<SlashCommandMenuHandle, SlashCommandMenuProps> | null = null;
        let unmount: (() => void) | null = null;
        return {
          onStart: (props) => {
            renderer = new ReactRenderer(SlashCommandMenu, {
              editor: props.editor,
              props: { ...props, labels: getLabels() },
            });
            unmount = props.mount(renderer.element);
          },
          onUpdate: (props) => renderer?.updateProps({ ...props, labels: getLabels() }),
          onKeyDown: (props) => renderer?.ref?.onKeyDown(props) ?? false,
          onExit: () => {
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
