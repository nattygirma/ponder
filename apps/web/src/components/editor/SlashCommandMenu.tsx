import { forwardRef, useEffect, useImperativeHandle, useRef, useState, type ComponentType } from "react";
import { Extension, type Editor, type Range } from "@tiptap/core";
import { ReactRenderer } from "@tiptap/react";
import { PluginKey } from "@tiptap/pm/state";
import { flip, size } from "@floating-ui/react-dom";
import Suggestion, { exitSuggestion, type SuggestionKeyDownProps, type SuggestionProps } from "@tiptap/suggestion";
import {
  AudioLines,
  CalendarClock,
  CalendarDays,
  ChartBar,
  ChartColumn,
  ChartGantt,
  ChartLine,
  ChartPie,
  Check,
  ChevronRight,
  Clock3,
  CodeXml,
  Columns2,
  Columns3,
  Columns4,
  Copy,
  CornerUpRight,
  Database,
  FileArchive,
  FileSymlink,
  FileText,
  FileType,
  Hash,
  Heading1,
  Heading2,
  Heading3,
  Heading4,
  Image,
  Kanban,
  LayoutGrid,
  Link,
  Link2,
  List,
  ListOrdered,
  Lightbulb,
  Minus,
  MousePointerClick,
  Paperclip,
  Quote,
  Rows3,
  Sigma,
  SquareArrowOutUpRight,
  SquareCheck,
  Table,
  Table2,
  Trash2,
  Type,
  Video,
} from "lucide-react";
import { BUTTON_NODE_TYPE, CALLOUT_NODE_TYPE, COLUMNS_NODE_TYPE, createColumnsContent, DETAILS_NODE_TYPE, type ChartType, type DatabaseViewType } from "@ponder/shared";
import { PAGE_COLORS, type PageColorName } from "@ponder/shared/page-color";
import { Command, CommandItem, CommandList } from "@/components/ui/command";
import { cn } from "@/lib/utils";
import type { TurnIntoTarget } from "@/components/pages/BlockHandle";
import { AiFaceIcon } from "@/components/AiFaceIcon";

/**
 * Ponder's `/` menu, laid out like Notion's: the same groups, order, labels and Markdown hints.
 * Notion items whose block Ponder doesn't have yet (Table of contents, Tabs, embeds…) are left
 * out until those blocks exist, rather than shown as dead items.
 */
export type SlashCommandGroup =
  | "suggested"
  | "basic"
  | "media"
  | "database"
  | "advanced"
  | "inline"
  | "embeds"
  | "import"
  | "turnInto"
  | "actions"
  | "textColor"
  | "backgroundColor";

/** Items with a label of their own. Turn into and the colors reuse other labels. */
export type SlashBlockId =
  | "paragraph"
  | "heading-1"
  | "heading-2"
  | "heading-3"
  | "heading-4"
  | "bullet-list"
  | "ordered-list"
  | "task-list"
  | "toggle-list"
  | "sub-page"
  | "callout"
  | "blockquote"
  | "table"
  | "divider"
  | "note-link"
  | "image"
  | "video"
  | "audio"
  | "code-block"
  | "attachment"
  | "view-table"
  | "view-board"
  | "view-gallery"
  | "view-list"
  | "view-calendar"
  | "view-timeline"
  | "chart-vertical_bar"
  | "chart-horizontal_bar"
  | "chart-line"
  | "chart-donut"
  | "chart-number"
  | "database-inline"
  | "database-full-page"
  | "linked-database"
  | "block-math"
  | "button"
  | "columns-2"
  | "columns-3"
  | "columns-4"
  | "columns-5"
  | "inline-math"
  | "current-date"
  | "current-time"
  | "current-date-time"
  | "external-link"
  | "import-markdown"
  | "import-zip"
  | "copy-link"
  | "duplicate"
  | "move-to"
  | "delete"
  | "ai";

export type SlashCommandId =
  | SlashBlockId
  | `turn-${TurnIntoTarget}`
  | `text-${PageColorName | "default"}`
  | `background-${PageColorName | "default"}`;

type SlashCommandIcon = ComponentType<{ className?: string }>;

export type SlashCommandLabels = {
  menu: string;
  empty: string;
  close: string;
  filtered: string;
  placeholder: string;
  groups: Record<SlashCommandGroup, string>;
  items: Record<SlashBlockId, string>;
  textColors: Record<PageColorName | "default", string>;
  backgroundColors: Record<PageColorName | "default", string>;
};

export type SlashCommandActions = {
  openAi: () => void;
  /** Opens the file picker; `accept` narrows it, as Notion's Image, Video and Audio do. */
  openAttachmentPicker: (accept?: string) => void;
  openExternalLinkPicker: () => void;
  openNoteLinkPicker: () => void;
  openMathFormula: (kind: "inline" | "block", range?: { from: number; to: number }) => void;
  pagesAvailable: () => boolean;
  createSubPage: () => void;
  /** An inline database whose first view is `view`. */
  createDatabase: (view?: DatabaseViewType) => void;
  createFullPageDatabase: () => void;
  openLinkedDatabasePicker: () => void;
  insertChart: (type?: ChartType) => void;
  /** Called just before a /button block goes in, so it opens its editor. */
  beforeInsertButton?: () => void;
  importMarkdown: () => void;
  importZip: () => void;
  turnInto: (pos: number, target: TurnIntoTarget) => void;
  paintBlock: (target: SlashBlockTarget, color: string | null) => void;
  /** Null when the page has no link to copy (outside the page layout). */
  copyBlockLink: ((target: SlashBlockTarget) => void) | null;
  duplicateBlock: (target: SlashBlockTarget) => void;
  deleteBlock: (target: SlashBlockTarget) => void;
  moveBlock: (target: SlashBlockTarget) => void;
};

export type SlashBlockTarget = { node: import("@tiptap/pm/model").Node; pos: number };

export type SlashCommandItem = {
  /** Unique among items; the Suggested group repeats ids from other groups. */
  id: SlashCommandId;
  group: SlashCommandGroup;
  icon: SlashCommandIcon;
  label: string;
  keywords: string[];
  /** Notion's Markdown shortcut, shown at the right. */
  hint?: string;
  /** Only in the page layout (pages, databases, buttons, moving blocks). */
  pageOnly?: boolean;
  /** Ponder extras Notion doesn't list: found by searching, not shown in the full menu. */
  searchOnly?: boolean;
  /** The color swatch for Text color and Background color. */
  color?: string;
  /** Marks the block's current type under Turn into. */
  checked?: boolean;
};

const slashCommandPluginKey = new PluginKey("ponder-slash-command");

const padDatePart = (value: number) => String(value).padStart(2, "0");

export const formatCurrentDate = (date: Date) =>
  `${date.getFullYear()}-${padDatePart(date.getMonth() + 1)}-${padDatePart(date.getDate())}`;

export const formatCurrentTime = (date: Date) =>
  `${padDatePart(date.getHours())}:${padDatePart(date.getMinutes())}`;

export const formatCurrentDateTime = (date: Date) =>
  `${formatCurrentDate(date)} ${formatCurrentTime(date)}`;

/** Notion's order of the groups. The last four come after Import, as in Notion. */
export const SLASH_GROUP_ORDER: SlashCommandGroup[] = [
  "suggested", "basic", "media", "database", "advanced", "inline", "embeds", "import", "turnInto", "actions", "textColor", "backgroundColor",
];

/** Groups whose name Notion shows after an item ("Table view · Database") in search results and Suggested. */
const NAMED_GROUPS = new Set<SlashCommandGroup>(["database", "embeds", "import", "turnInto"]);

/** Notion's Turn into list, in its order, with the item whose label each one reuses. */
const TURN_INTO: Array<[TurnIntoTarget, SlashBlockId, SlashCommandIcon]> = [
  ["paragraph", "paragraph", Type],
  ["h1", "heading-1", Heading1],
  ["h2", "heading-2", Heading2],
  ["h3", "heading-3", Heading3],
  ["h4", "heading-4", Heading4],
  ["bullet", "bullet-list", List],
  ["ordered", "ordered-list", ListOrdered],
  ["task", "task-list", SquareCheck],
  ["toggle", "toggle-list", ChevronRight],
  ["code", "code-block", CodeXml],
  ["quote", "blockquote", Quote],
  ["callout", "callout", Lightbulb],
];

const VIEW_ITEMS: Array<[DatabaseViewType, SlashCommandIcon]> = [
  ["table", Table2], ["board", Kanban], ["gallery", LayoutGrid], ["list", Rows3], ["calendar", CalendarDays], ["timeline", ChartGantt],
];
const CHART_ITEMS: Array<[ChartType, SlashCommandIcon]> = [
  ["vertical_bar", ChartColumn], ["horizontal_bar", ChartBar], ["line", ChartLine], ["donut", ChartPie], ["number", Hash],
];

/** Every item in menu order. `current` is the block's type, for the Turn into check mark. */
export const createSlashCommandItems = (labels: SlashCommandLabels, current: TurnIntoTarget | null = null): SlashCommandItem[] => {
  const item = (id: SlashBlockId, group: SlashCommandGroup, icon: SlashCommandIcon, keywords: string[] = [], extra: Partial<SlashCommandItem> = {}): SlashCommandItem =>
    ({ id, group, icon, label: labels.items[id], keywords, ...extra });
  return [
    // Basic blocks
    item("paragraph", "basic", Type, ["text", "plain", "paragraph", "body"]),
    item("heading-1", "basic", Heading1, ["h1", "title", "heading"], { hint: "#" }),
    item("heading-2", "basic", Heading2, ["h2", "subtitle", "heading"], { hint: "##" }),
    item("heading-3", "basic", Heading3, ["h3", "heading"], { hint: "###" }),
    item("heading-4", "basic", Heading4, ["h4", "heading"], { hint: "####" }),
    item("bullet-list", "basic", List, ["bullet", "unordered", "ul"], { hint: "-" }),
    item("ordered-list", "basic", ListOrdered, ["numbered", "ordered", "ol"], { hint: "1." }),
    item("task-list", "basic", SquareCheck, ["todo", "task", "check", "checkbox"], { hint: "[]" }),
    item("toggle-list", "basic", ChevronRight, ["toggle", "collapse", "fold", "details", "spoiler", "折りたたみ"], { hint: ">" }),
    item("sub-page", "basic", FileText, ["page", "subpage", "child"], { pageOnly: true }),
    item("callout", "basic", Lightbulb, ["note", "tip", "warning", "notice"]),
    item("blockquote", "basic", Quote, ["quote", "citation", "blockquote"], { hint: "\"" }),
    item("table", "basic", Table, ["grid", "simple table"]),
    item("divider", "basic", Minus, ["rule", "line", "separator", "hr"], { hint: "---" }),
    item("note-link", "basic", FileSymlink, ["link", "page", "note", "memo"]),
    // Media
    item("image", "media", Image, ["picture", "photo", "upload"]),
    item("video", "media", Video, ["movie", "clip", "upload"]),
    item("audio", "media", AudioLines, ["sound", "music", "upload"]),
    item("code-block", "media", CodeXml, ["code", "snippet", "pre"], { hint: "```" }),
    item("attachment", "media", Paperclip, ["file", "upload", "attachment", "pdf"]),
    // Database: one item per view, then per chart, as in Notion.
    ...VIEW_ITEMS.map(([type, icon]) => item(`view-${type}` as SlashBlockId, "database", icon, ["database", "db", type], { pageOnly: true })),
    ...CHART_ITEMS.map(([type, icon]) => item(`chart-${type}` as SlashBlockId, "database", icon, ["chart", "graph", ...type.split("_")], { pageOnly: true })),
    // TODO(Notion Plus Phase 3): add "Form" here once database forms land on main.
    item("database-inline", "database", Database, ["database", "db", "inline", "kanban", "board"], { pageOnly: true }),
    item("database-full-page", "database", SquareArrowOutUpRight, ["database", "db", "full page"], { pageOnly: true }),
    item("linked-database", "database", Link2, ["linked", "database", "db", "existing", "view"], { pageOnly: true }),
    // Advanced blocks
    item("block-math", "advanced", Sigma, ["equation", "math", "latex", "formula", "katex", "tex", "数式"]),
    item("button", "advanced", MousePointerClick, ["action", "automation", "click"], { pageOnly: true }),
    item("columns-2", "advanced", Columns2, ["columns", "layout", "side"]),
    item("columns-3", "advanced", Columns3, ["columns", "layout", "side"]),
    item("columns-4", "advanced", Columns4, ["columns", "layout", "side"]),
    item("columns-5", "advanced", Columns4, ["columns", "layout", "side"]),
    // Inline
    item("inline-math", "inline", Sigma, ["equation", "math", "latex", "formula", "katex", "tex", "数式"]),
    item("current-date", "inline", CalendarDays, ["date", "today"], { searchOnly: true }),
    item("current-time", "inline", Clock3, ["time", "now"], { searchOnly: true }),
    item("current-date-time", "inline", CalendarClock, ["datetime", "timestamp"], { searchOnly: true }),
    item("external-link", "inline", Link, ["link", "url", "web"], { searchOnly: true }),
    // Import: the formats Ponder can read today.
    item("import-markdown", "import", FileType, ["markdown", "md", "text", "txt"]),
    item("import-zip", "import", FileArchive, ["zip", "notion", "export"], { pageOnly: true }),
    // Turn into
    ...TURN_INTO.map(([target, labelId, icon]): SlashCommandItem => ({
      id: `turn-${target}`, group: "turnInto", icon, label: labels.items[labelId], keywords: [], checked: current === target,
    })),
    // Actions
    item("copy-link", "actions", Link2, ["link", "copy", "block"], { pageOnly: true }),
    item("duplicate", "actions", Copy, ["copy", "clone"]),
    item("move-to", "actions", CornerUpRight, ["move"], { pageOnly: true }),
    item("delete", "actions", Trash2, ["remove", "trash"]),
    item("ai", "actions", AiFaceIcon, ["ai", "assistant"]),
    // Text color and Background color
    ...(["default", ...PAGE_COLORS] as const).map((color): SlashCommandItem => ({
      id: `text-${color}`, group: "textColor", icon: Type, label: labels.textColors[color], keywords: ["color", "colour"], color: color === "default" ? "" : color,
    })),
    ...(["default", ...PAGE_COLORS] as const).map((color): SlashCommandItem => ({
      id: `background-${color}`, group: "backgroundColor", icon: Type, label: labels.backgroundColors[color], keywords: ["color", "colour", "highlight"], color: color === "default" ? "default_background" : `${color}_background`,
    })),
  ];
};

/** Items the person used most recently, newest first, for Suggested. */
const RECENT_KEY = "ponder.slash.recent";
const RECENT_LIMIT = 3;
const RECENT_GROUPS = new Set<SlashCommandGroup>(["basic", "media", "database", "advanced", "inline", "import"]);

export const readRecentSlashItems = (): SlashCommandId[] => {
  try {
    const parsed: unknown = JSON.parse(window.localStorage.getItem(RECENT_KEY) ?? "[]");
    return Array.isArray(parsed) ? parsed.filter((value): value is SlashCommandId => typeof value === "string").slice(0, RECENT_LIMIT) : [];
  } catch {
    return [];
  }
};

const rememberSlashItem = (item: SlashCommandItem) => {
  if (!RECENT_GROUPS.has(item.group)) return;
  try {
    const next = [item.id, ...readRecentSlashItems().filter((id) => id !== item.id)].slice(0, RECENT_LIMIT);
    window.localStorage.setItem(RECENT_KEY, JSON.stringify(next));
  } catch {
    // Without storage, Suggested falls back to Ask AI.
  }
};

/**
 * The menu for a query. With no query it is every group in Notion's order, led by Suggested
 * (recent items, or Ask AI). With a query Notion shows one flat list: items whose label starts
 * with the query first, then the rest, each in menu order. A group's name matches all its items.
 */
export const filterSlashCommandItems = (items: SlashCommandItem[], query: string, options: { recent?: SlashCommandId[]; groups?: Record<SlashCommandGroup, string> } = {}) => {
  const normalizedQuery = query.trim().toLocaleLowerCase();
  if (!normalizedQuery) {
    const browsable = items.filter((item) => !item.searchOnly);
    const recent = (options.recent ?? [])
      .map((id) => browsable.find((item) => item.id === id && RECENT_GROUPS.has(item.group)))
      .filter((item): item is SlashCommandItem => Boolean(item));
    const fallback = browsable.filter((item) => item.id === "ai");
    const suggested = (recent.length ? recent : fallback).map((item) => ({ ...item, group: "suggested" as const, origin: item.group }));
    return [...suggested, ...browsable];
  }
  // The label matches anywhere ("red" finds "Numbered list", as in Notion); aliases and the
  // group name match from the start of a word ("turn" finds every Turn into item).
  const wordStarts = (value: string) => value.toLocaleLowerCase().split(/[\s-]+/).some((word) => word.startsWith(normalizedQuery))
    || value.toLocaleLowerCase().startsWith(normalizedQuery);
  const matches = items.filter((item) => item.label.toLocaleLowerCase().includes(normalizedQuery)
    || [options.groups?.[item.group] ?? "", ...item.keywords].some(wordStarts));
  const starts = (item: SlashCommandItem) => item.label.toLocaleLowerCase().startsWith(normalizedQuery);
  return [...matches.filter(starts), ...matches.filter((item) => !starts(item))];
};

type MenuItem = SlashCommandItem & { origin?: SlashCommandGroup };

type SlashCommandMenuProps = SuggestionProps<MenuItem, MenuItem> & {
  labels: SlashCommandLabels;
};

export type SlashCommandMenuHandle = {
  onKeyDown: (props: SuggestionKeyDownProps) => boolean;
};

const rowKey = (item: MenuItem) => `${item.group}:${item.id}`;

/** Notion's swatch: an "A" in the text color, or a filled square in the background color. */
const Swatch = ({ item }: { item: MenuItem }) => (
  <span
    className={cn("flex h-5 w-5 shrink-0 items-center justify-center rounded border text-xs font-medium", item.group === "backgroundColor" ? "border-slate-200 text-transparent" : "border-[color-mix(in_srgb,currentColor_35%,transparent)]")}
    data-page-color={item.color && item.color !== "default_background" ? item.color : undefined}
    aria-hidden="true"
  >
    A
  </span>
);

export const SlashCommandMenu = forwardRef<SlashCommandMenuHandle, SlashCommandMenuProps>(
  ({ command, editor, items, labels, query }, ref) => {
    const [selectedIndex, setSelectedIndex] = useState(0);
    const listRef = useRef<HTMLDivElement>(null);
    const selectedItem = items[Math.min(selectedIndex, Math.max(0, items.length - 1))];
    const filtered = query.trim().length > 0;

    useEffect(() => setSelectedIndex(0), [items]);
    useEffect(() => {
      listRef.current?.querySelector("[data-selected=true]")?.scrollIntoView({ block: "nearest" });
    }, [selectedIndex]);

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

    const renderItem = (item: MenuItem) => {
      const Icon = item.icon;
      const groupName = filtered
        ? (NAMED_GROUPS.has(item.group) ? labels.groups[item.group] : null)
        : item.origin && NAMED_GROUPS.has(item.origin) ? labels.groups[item.origin] : null;
      return (
        <CommandItem
          key={rowKey(item)}
          value={rowKey(item)}
          className="mx-1 h-8 min-h-8 gap-2 rounded-md px-2 py-0 text-sm text-slate-800 data-[selected=true]:bg-slate-900/[0.06] data-[selected=true]:text-slate-900"
          onMouseDown={(event) => event.preventDefault()}
          onSelect={() => command(item)}
          data-slash-item={item.id}
        >
          {item.color !== undefined ? <Swatch item={item} /> : <Icon className="h-5 w-5 shrink-0 stroke-[1.5] text-slate-700" />}
          <span className="min-w-0 flex-1 truncate">
            {item.label}
            {groupName ? <span className="text-slate-400"><span aria-hidden="true"> · </span>{groupName}</span> : null}
          </span>
          {item.checked ? <Check className="h-4 w-4 shrink-0 text-slate-700" aria-label="✓" /> : null}
          {item.hint ? <span className="shrink-0 pr-0.5 text-xs text-slate-400">{item.hint}</span> : null}
        </CommandItem>
      );
    };

    const heading = (text: string) => (
      <div className="px-3 pb-1.5 pt-2 text-xs font-medium text-slate-500" aria-hidden="true">{text}</div>
    );

    return (
      <Command
        aria-label={labels.menu}
        className="w-[min(20.25rem,calc(100vw-1.5rem))] rounded-[10px] border border-slate-200 bg-card shadow-[0_14px_28px_-6px_rgba(0,0,0,0.1),0_2px_4px_-1px_rgba(0,0,0,0.06),0_0_0_1px_rgba(84,72,49,0.08)]"
        shouldFilter={false}
        value={selectedItem ? rowKey(selectedItem) : ""}
        onValueChange={(value) => {
          const index = items.findIndex((item) => rowKey(item) === value);
          if (index >= 0) setSelectedIndex(index);
        }}
        data-slash-menu=""
      >
        <CommandList ref={listRef} className="max-h-[var(--slash-menu-list-height,25rem)] py-1">
          {!items.length ? <span className="sr-only" role="status">{labels.empty}</span> : null}
          {filtered ? (
            items.length ? (
              <div role="group" aria-label={labels.filtered}>
                {heading(labels.filtered)}
                {items.map(renderItem)}
              </div>
            ) : null
          ) : SLASH_GROUP_ORDER.map((group, index) => {
            const groupItems = items.filter((item) => item.group === group);
            return groupItems.length ? (
              <div key={group} role="group" aria-label={labels.groups[group]} className={cn(index > 0 && group !== "basic" && "mt-1.5", group === "basic" && items.some((item) => item.group === "suggested") && "mt-1.5 border-t border-slate-100 pt-1")}>
                {heading(labels.groups[group])}
                {groupItems.map(renderItem)}
              </div>
            ) : null;
          })}
        </CommandList>
        <button
          type="button"
          className={cn("flex h-11 w-full items-center justify-between px-3 text-left text-sm text-slate-700 hover:bg-slate-900/[0.03]", items.length > 0 && "border-t border-slate-100")}
          onMouseDown={(event) => event.preventDefault()}
          onClick={() => exitSuggestion(editor.view, slashCommandPluginKey)}
          data-slash-close=""
        >
          <span>{labels.close}</span>
          <span className="text-xs text-slate-400">esc</span>
        </button>
      </Command>
    );
  },
);
SlashCommandMenu.displayName = "SlashCommandMenu";

/** The block that `/` was typed in: a list item as a whole, otherwise the paragraph. */
export const slashBlockTarget = (editor: Editor): SlashBlockTarget => {
  const { $from } = editor.state.selection;
  for (let depth = $from.depth; depth > 0; depth -= 1) {
    const node = $from.node(depth);
    if (node.type.name === "listItem" || node.type.name === "taskItem") return { node, pos: $from.before(depth) };
  }
  return { node: $from.parent, pos: $from.before($from.depth) };
};

/** The Turn into type of the block holding the cursor, for its check mark. */
export const currentTurnIntoTarget = (editor: Editor): TurnIntoTarget => {
  const { $from } = editor.state.selection;
  if ($from.parent.type.name === "heading") {
    const level = Number($from.parent.attrs.level);
    if (level >= 1 && level <= 4) return `h${level}` as TurnIntoTarget;
  }
  for (let depth = $from.depth; depth > 0; depth -= 1) {
    const name = $from.node(depth).type.name;
    if (name === "bulletList") return "bullet";
    if (name === "orderedList") return "ordered";
    if (name === "taskList") return "task";
    if (name === "blockquote") return "quote";
    if (name === CALLOUT_NODE_TYPE) return "callout";
    if (name === DETAILS_NODE_TYPE) return "toggle";
  }
  return "paragraph";
};

/** The "Close menu" row, and the least list height before the menu flips above the cursor. */
const MENU_FOOTER_HEIGHT = 46;
const MIN_MENU_LIST_HEIGHT = 140;

const VIEW_TYPES = new Set<string>(VIEW_ITEMS.map(([type]) => type));
const CHART_TYPES = new Set<string>(CHART_ITEMS.map(([type]) => type));

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
  rememberSlashItem(item);
  const chain = editor.chain().focus().deleteRange(range);
  const { id } = item;
  if (id.startsWith("turn-")) {
    chain.run();
    const { $from } = editor.state.selection;
    const offset = $from.parentOffset;
    actions.turnInto($from.before($from.depth), id.slice(5) as TurnIntoTarget);
    // Turning a block moves the cursor to its start; put it back where the `/` was, as Notion does.
    const { $from: $start } = editor.state.selection;
    if ($start.parent.isTextblock) editor.commands.setTextSelection($start.start() + Math.min(offset, $start.parent.content.size));
    return;
  }
  if (item.group === "textColor" || item.group === "backgroundColor") {
    chain.run();
    const color = item.color && item.color !== "default_background" ? item.color : null;
    actions.paintBlock(slashBlockTarget(editor), color);
    return;
  }
  if (id.startsWith("view-") && VIEW_TYPES.has(id.slice(5))) {
    chain.run();
    actions.createDatabase(id.slice(5) as DatabaseViewType);
    return;
  }
  if (id.startsWith("chart-") && CHART_TYPES.has(id.slice(6))) {
    chain.run();
    actions.insertChart(id.slice(6) as ChartType);
    return;
  }
  switch (id) {
    case "ai":
      chain.run();
      window.requestAnimationFrame(actions.openAi);
      break;
    case "paragraph": chain.setParagraph().run(); break;
    case "heading-1": chain.setHeading({ level: 1 }).run(); break;
    case "heading-2": chain.setHeading({ level: 2 }).run(); break;
    case "heading-3": chain.setHeading({ level: 3 }).run(); break;
    case "heading-4": chain.setHeading({ level: 4 }).run(); break;
    case "bullet-list": chain.toggleBulletList().run(); break;
    case "ordered-list": chain.toggleOrderedList().run(); break;
    case "task-list": chain.toggleTaskList().run(); break;
    case "blockquote": chain.toggleBlockquote().run(); break;
    case "code-block": chain.setCodeBlock().run(); break;
    case "divider": chain.setHorizontalRule().run(); break;
    case "toggle-list": chain.setDetails().run(); break;
    // The header row stays: Markdown tables need one (see the tables plan, Phase A).
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
    case "image":
    case "video":
    case "audio":
    case "attachment": {
      chain.run();
      const accept = id === "attachment" ? undefined : `${id}/*`;
      window.requestAnimationFrame(() => actions.openAttachmentPicker(accept));
      break;
    }
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
    case "database-inline":
      chain.run();
      actions.createDatabase();
      break;
    case "database-full-page":
      chain.run();
      actions.createFullPageDatabase();
      break;
    case "linked-database":
      chain.run();
      actions.openLinkedDatabasePicker();
      break;
    case "button":
      actions.beforeInsertButton?.();
      chain.insertContent([{ type: BUTTON_NODE_TYPE, attrs: { label: "", icon: "", actions: "[]" } }, { type: "paragraph" }]).run();
      break;
    case "callout": chain.wrapIn(CALLOUT_NODE_TYPE).run(); break;
    case "columns-2":
    case "columns-3":
    case "columns-4":
    case "columns-5": {
      chain.insertContent(createColumnsContent(Number(id.slice(-1)))).run();
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
    case "import-markdown":
      chain.run();
      window.requestAnimationFrame(actions.importMarkdown);
      break;
    case "import-zip":
      chain.run();
      actions.importZip();
      break;
    case "copy-link":
      chain.run();
      actions.copyBlockLink?.(slashBlockTarget(editor));
      break;
    case "duplicate":
      chain.run();
      actions.duplicateBlock(slashBlockTarget(editor));
      break;
    case "move-to":
      chain.run();
      actions.moveBlock(slashBlockTarget(editor));
      break;
    case "delete":
      chain.run();
      actions.deleteBlock(slashBlockTarget(editor));
      break;
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
    const availableItems = (editor: Editor) => createSlashCommandItems(getLabels(), currentTurnIntoTarget(editor))
      .filter((item) => actions.pagesAvailable() || !item.pageOnly)
      .filter((item) => item.id !== "copy-link" || actions.copyBlockLink);
    const itemsFor = (editor: Editor, query: string) =>
      filterSlashCommandItems(availableItems(editor), query, { recent: readRecentSlashItems(), groups: getLabels().groups });
    return [Suggestion<MenuItem, MenuItem>({
      editor: this.editor,
      pluginKey: slashCommandPluginKey,
      char: "/",
      allowedPrefixes: [" "],
      placement: "bottom-start",
      offset: { mainAxis: 6 },
      // Like Notion, the menu shrinks to the room under the cursor, and flips above it only when
      // that room is too small. Size runs before flip so a short fit doesn't count as overflow.
      flip: false,
      floatingUi: {
        middleware: [
          size({
            padding: 8,
            apply: ({ availableHeight, elements }) => {
              const listHeight = Math.min(400, Math.max(MIN_MENU_LIST_HEIGHT, availableHeight - MENU_FOOTER_HEIGHT));
              elements.floating.style.setProperty("--slash-menu-list-height", `${listHeight}px`);
            },
          }),
          flip({ padding: 8 }),
        ],
      },
      decorationClass: "ponder-slash-command-query",
      decorationContent: getLabels().placeholder,
      initialItems: itemsFor(this.editor, ""),
      allow: ({ state, range }) => {
        const position = state.doc.resolve(range.from);
        // Notion's menu also opens in headings, so they can be turned into something else.
        return this.editor.isEditable && (position.parent.type.name === "paragraph" || position.parent.type.name === "heading");
      },
      items: ({ query, editor }) => itemsFor(editor, query),
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
