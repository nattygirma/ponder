/*
 * Adapted from AppFlowy-Web (https://github.com/AppFlowy-IO/AppFlowy-Web), Copyright AppFlowy, AGPL-3.0.
 * Sources: src/components/_shared/emoji-picker/EmojiPicker.tsx (loading the data, then search results
 * or every category), EmojiPickerCategories.tsx and EmojisVirtualizer.tsx (category title rows and
 * emoji rows in a virtual list, measured as they render) and EmojiItem.tsx (one fixed-size emoji
 * button, flags set apart). The search header and skin-tone switch are left out: Notion's picker
 * filters by what is typed after `:` and has a category bar along the bottom instead.
 */
import { forwardRef, useEffect, useImperativeHandle, useMemo, useRef, useState, type ComponentType } from "react";
import { Extension, type Editor } from "@tiptap/core";
import { ReactRenderer } from "@tiptap/react";
import { PluginKey } from "@tiptap/pm/state";
import { shift } from "@floating-ui/react-dom";
import Suggestion, { type SuggestionKeyDownProps, type SuggestionProps } from "@tiptap/suggestion";
import { useVirtualizer } from "@tanstack/react-virtual";
import { CircleCheck, Carrot, Clock, Flag, Leaf, Lightbulb, Plane, Smile, Volleyball } from "lucide-react";
import { cn } from "@/lib/utils";
import {
  EMOJI_COLUMNS,
  getRowsWithCategories,
  loadEmojiCategories,
  MIN_EMOJI_QUERY,
  readRecentEmojis,
  rememberEmoji,
  searchEmojis,
  withRecent,
  type Emoji,
  type EmojiCategory,
} from "./emoji-data";

export type EmojiPickerLabels = {
  menu: string;
  results: string;
  empty: string;
  categories: Record<string, string>;
};

type PickerProps = SuggestionProps<Emoji, Emoji> & { labels: EmojiPickerLabels; full: boolean };
export type EmojiPickerHandle = { onKeyDown: (props: SuggestionKeyDownProps) => boolean };

const CATEGORY_ICONS: Record<string, ComponentType<{ className?: string }>> = {
  recent: Clock,
  people: Smile,
  nature: Leaf,
  foods: Carrot,
  activity: Volleyball,
  places: Plane,
  objects: Lightbulb,
  symbols: CircleCheck,
  flags: Flag,
};

const CELL = 32;

const EmojiButton = ({ emoji, selected, flag, onPick, onHover, index }: {
  emoji: Emoji;
  selected: boolean;
  flag: boolean;
  onPick: () => void;
  onHover: () => void;
  index: number;
}) => (
  <button
    type="button"
    role="option"
    aria-selected={selected}
    aria-label={emoji.name}
    data-emoji-index={index}
    className={cn("ponder-emoji-cell flex h-8 w-8 shrink-0 items-center justify-center rounded-md text-2xl leading-none", flag && "is-flag", selected && "is-selected")}
    onMouseMove={onHover}
    onClick={onPick}
  >
    {emoji.native}
  </button>
);

export const EmojiPicker = forwardRef<EmojiPickerHandle, PickerProps>(({ query, command, labels, full }, ref) => {
  const [categories, setCategories] = useState<EmojiCategory[] | null>(null);
  const [selected, setSelected] = useState(0);
  const scrollRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    let current = true;
    void loadEmojiCategories().then((loaded) => current && setCategories(loaded)).catch(() => current && setCategories([]));
    return () => {
      current = false;
    };
  }, []);

  const searching = query.trim().length > 0;
  const results = useMemo(
    () => {
      if (!categories || !(searching || !full)) return [];
      if (!full && query.trim().length < MIN_EMOJI_QUERY) return [];
      return searchEmojis(categories, query, full ? 400 : undefined);
    },
    [categories, full, query, searching],
  );
  const shown = useMemo<EmojiCategory[]>(() => {
    if (!categories) return [];
    if (searching || !full) return results.length ? [{ id: "results", emojis: results }] : [];
    return withRecent(categories, readRecentEmojis());
  }, [categories, full, results, searching]);
  const rows = useMemo(() => (full ? getRowsWithCategories(shown) : []), [full, shown]);
  const flat = useMemo(() => shown.flatMap((category) => category.emojis), [shown]);

  useEffect(() => setSelected(0), [query]);

  const virtualizer = useVirtualizer({
    count: rows.length,
    getScrollElement: () => scrollRef.current,
    estimateSize: (index) => (rows[index]?.type === "category" ? 30 : CELL),
    overscan: 6,
  });

  const startOf = useMemo(() => {
    const starts = new Map<string, number>();
    let count = 0;
    for (const category of shown) {
      starts.set(category.id, count);
      count += category.emojis.length;
    }
    return starts;
  }, [shown]);

  const pick = (emoji: Emoji) => {
    rememberEmoji(emoji.native);
    command(emoji);
  };

  useEffect(() => {
    const element = scrollRef.current?.querySelector(`[data-emoji-index="${selected}"]`);
    if (element) element.scrollIntoView({ block: "nearest" });
    else if (full) {
      // A row outside the rendered window: find it and bring it in.
      const rowIndex = rows.findIndex((row) => {
        if (row.type !== "emojis") return false;
        const start = (startOf.get(row.category) ?? 0) + Number(row.id.split("-").pop()) * EMOJI_COLUMNS;
        return selected >= start && selected < start + row.emojis.length;
      });
      if (rowIndex >= 0) virtualizer.scrollToIndex(rowIndex, { align: "auto" });
    }
  }, [full, rows, selected, startOf, virtualizer]);

  useImperativeHandle(ref, () => ({
    onKeyDown: ({ event }) => {
      if (event.isComposing || !flat.length) return false;
      const moves: Record<string, number> = { ArrowRight: 1, ArrowLeft: -1, ArrowDown: EMOJI_COLUMNS, ArrowUp: -EMOJI_COLUMNS };
      if (event.key in moves) {
        setSelected((current) => Math.min(flat.length - 1, Math.max(0, current + moves[event.key])));
        return true;
      }
      if (event.key === "Enter" || event.key === "Tab") {
        const emoji = flat[Math.min(selected, flat.length - 1)];
        if (emoji) pick(emoji);
        return true;
      }
      return false;
    },
  }));

  // Notion's `:` menu stays hidden until two letters match something.
  if (!full && (query.trim().length < MIN_EMOJI_QUERY || !flat.length)) return null;

  const button = (emoji: Emoji, index: number, category: string) => (
    <EmojiButton
      key={`${category}-${emoji.id}`}
      emoji={emoji}
      index={index}
      selected={index === selected}
      flag={category === "flags"}
      onHover={() => index !== selected && setSelected(index)}
      onPick={() => pick(emoji)}
    />
  );

  if (!full) {
    return (
      <div
        role="listbox"
        aria-label={labels.menu}
        className="ponder-emoji-panel grid gap-0 rounded-xl border border-slate-200 bg-card p-1.5 shadow-2xl ring-1 ring-slate-950/5"
        style={{ gridTemplateColumns: `repeat(${Math.min(EMOJI_COLUMNS, flat.length)}, ${CELL}px)`, maxWidth: "calc(100vw - 1.5rem)" }}
        onMouseDown={(event) => event.preventDefault()}
        ref={scrollRef}
      >
        {flat.map((emoji, index) => button(emoji, index, "results"))}
      </div>
    );
  }

  const jumpTo = (categoryId: string) => {
    const index = rows.findIndex((row) => row.type === "category" && row.category === categoryId);
    if (index >= 0) virtualizer.scrollToIndex(index, { align: "start" });
  };

  return (
    <div
      role="listbox"
      aria-label={labels.menu}
      className="ponder-emoji-panel flex w-[min(25.5rem,calc(100vw-1.5rem))] flex-col overflow-hidden rounded-xl border border-slate-200 bg-card shadow-2xl ring-1 ring-slate-950/5"
      onMouseDown={(event) => event.preventDefault()}
    >
      <div ref={scrollRef} className="h-[min(20rem,45dvh)] overflow-y-auto px-2 pt-1">
        {categories && !flat.length && <div className="px-1 py-6 text-center text-sm text-slate-400">{labels.empty}</div>}
        <div style={{ height: virtualizer.getTotalSize(), position: "relative" }}>
          {virtualizer.getVirtualItems().map((item) => {
            const row = rows[item.index];
            return (
              <div
                key={item.key}
                data-index={item.index}
                ref={virtualizer.measureElement}
                className="absolute left-0 top-0 flex w-full"
                style={{ transform: `translateY(${item.start}px)` }}
              >
                {row.type === "category" ? (
                  <div className="px-1 pb-1 pt-2.5 text-xs font-medium text-slate-500">{labels.categories[row.category] ?? labels.results}</div>
                ) : (
                  row.emojis.map((emoji, offset) => button(
                    emoji,
                    (startOf.get(row.category) ?? 0) + Number(row.id.split("-").pop()) * EMOJI_COLUMNS + offset,
                    row.category,
                  ))
                )}
              </div>
            );
          })}
        </div>
      </div>
      {!searching && (
        <div className="flex items-center justify-between border-t border-slate-100 px-2 py-1">
          {shown.map((category) => {
            const Icon = CATEGORY_ICONS[category.id] ?? Smile;
            return (
              <button
                key={category.id}
                type="button"
                aria-label={labels.categories[category.id] ?? category.id}
                className="flex h-7 w-7 items-center justify-center rounded-md text-slate-400 hover:bg-slate-100 hover:text-slate-600"
                onClick={() => jumpTo(category.id)}
              >
                <Icon className="h-4 w-4" />
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
});
EmojiPicker.displayName = "EmojiPicker";

const pendingFull = new WeakSet<Editor>();

/** `/emoji`: types `:` and opens the full picker, as Notion does. */
export const startEmojiPicker = (editor: Editor) => {
  pendingFull.add(editor);
  editor.chain().focus().insertContent(":").run();
};

/** Notion's `:` emoji menu: `:smi` lists matching emojis; `/emoji` opens every category. */
export const createEmojiSuggestionExtension = ({ isEnabled, getLabels }: { isEnabled: () => boolean; getLabels: () => EmojiPickerLabels }) => {
  let full = false;
  return Extension.create({
    name: "ponderEmojiSuggestion",
    addProseMirrorPlugins() {
      return [Suggestion<Emoji, Emoji>({
        editor: this.editor,
        pluginKey: new PluginKey("ponder-emoji-suggestion"),
        char: ":",
        allowSpaces: false,
        allowedPrefixes: null,
        placement: "bottom-start",
        offset: { mainAxis: 6 },
        // On a phone the menu slides back inside the screen instead of running off its edge.
        floatingUi: { middleware: [shift({ padding: 12 })] },
        decorationClass: "ponder-emoji-query",
        allow: ({ state, range }) => {
          const position = state.doc.resolve(range.from);
          if (!isEnabled() || !this.editor.isEditable || !position.parent.isTextblock || position.parent.type.spec.code) return false;
          const prefix = position.parent.textBetween(Math.max(0, position.parentOffset - 1), position.parentOffset, "\n", "￼");
          // "10:30" and "Note:" are not emoji names; only `:` at a word's start opens the menu.
          if (position.parentOffset > 0 && !/[\s￼]/u.test(prefix)) return false;
          return /^:[\p{L}\p{N}_+-]*$/u.test(state.doc.textBetween(range.from, range.to, "", ""));
        },
        items: () => [],
        command: ({ editor, range, props: emoji }) => {
          editor.chain().focus().insertContentAt(range, emoji.native).run();
        },
        render: () => {
          let renderer: ReactRenderer<EmojiPickerHandle, PickerProps> | null = null;
          let unmount: (() => void) | null = null;
          const propsFor = (props: SuggestionProps<Emoji, Emoji>) => ({ ...props, labels: getLabels(), full });
          return {
            onBeforeStart: (props) => {
              full = pendingFull.has(props.editor);
              pendingFull.delete(props.editor);
            },
            onStart: (props) => {
              renderer = new ReactRenderer(EmojiPicker, { editor: props.editor, props: propsFor(props) });
              unmount = props.mount(renderer.element);
            },
            onUpdate: (props) => renderer?.updateProps(propsFor(props)),
            onKeyDown: (props) => {
              if (props.event.key === "Escape") return false;
              return renderer?.ref?.onKeyDown(props) ?? false;
            },
            onExit: () => {
              full = false;
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
