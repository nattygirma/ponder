import { useCallback, useEffect, useRef, useState, type CSSProperties } from "react";
import { useTranslation } from "react-i18next";
import { NodeViewContent, NodeViewWrapper, ReactNodeViewRenderer, type NodeViewProps } from "@tiptap/react";
import { TextSelection } from "@tiptap/pm/state";
import { Pencil, Plus, Trash2 } from "lucide-react";
import { createTabContent, Tabs } from "@ponder/shared";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";

/**
 * Notion's /tabs block: a row of named tabs over the open tab's blocks. Ponder's own; AppFlowy-Web
 * has no tabs block. Every tab's blocks stay in the document (so search, Markdown and AI see
 * them); the inactive ones are hidden by CSS keyed to the open tab, which isn't stored.
 */
const MAX_STYLED_TABS = 30;

// One rule per tab position, so ProseMirror's own nodes are never restyled by hand.
const ensureTabStyles = (() => {
  let done = false;
  return () => {
    if (done || typeof document === "undefined") return;
    done = true;
    const rules = Array.from({ length: MAX_STYLED_TABS }, (_, index) =>
      `.ponder-tabs-block[data-active-tab="${index}"] > .ponder-tabs-body > [data-node-view-content-react] > [data-type="ponder-tab"]:not(:nth-child(${index + 1})) { display: none; }`,
    ).join("\n");
    const style = document.createElement("style");
    style.dataset.ponderTabs = "";
    style.textContent = rules;
    document.head.appendChild(style);
  };
})();

const TabsView = ({ editor, node, getPos, selected }: NodeViewProps) => {
  const { t } = useTranslation();
  ensureTabStyles();
  const titles: string[] = [];
  node.forEach((child) => titles.push(String(child.attrs.title ?? "")));
  const [active, setActive] = useState(0);
  const [menuIndex, setMenuIndex] = useState<number | null>(null);
  const [renaming, setRenaming] = useState<{ index: number; value: string } | null>(null);
  const renameRef = useRef<HTMLInputElement>(null);
  const current = Math.min(active, titles.length - 1);

  const tabPosition = useCallback((index: number) => {
    const start = getPos();
    if (typeof start !== "number") return null;
    const tabs = editor.state.doc.nodeAt(start);
    if (!tabs) return null;
    let pos = start + 1;
    for (let child = 0; child < index && child < tabs.childCount; child += 1) pos += tabs.child(child).nodeSize;
    return { pos, tab: tabs.maybeChild(index) };
  }, [editor, getPos]);

  // A cursor that moves into a hidden tab (arrow keys, undo, find) opens that tab, as in Notion.
  useEffect(() => {
    const follow = () => {
      const start = getPos();
      if (typeof start !== "number") return;
      const { $from } = editor.state.selection;
      for (let depth = $from.depth; depth > 0; depth -= 1) {
        if ($from.before(depth) === start && $from.node(depth).type.name === node.type.name) {
          setActive($from.index(depth));
          return;
        }
      }
    };
    editor.on("selectionUpdate", follow);
    return () => {
      editor.off("selectionUpdate", follow);
    };
  }, [editor, getPos, node.type.name]);

  const renamingIndex = renaming?.index ?? null;
  useEffect(() => {
    if (renamingIndex !== null) renameRef.current?.select();
  }, [renamingIndex]);

  const openTab = (index: number) => {
    setActive(index);
    const target = tabPosition(index);
    if (!target || !editor.isEditable) return;
    // Typing goes into the tab that's showing.
    editor.chain().command(({ tr }) => {
      tr.setSelection(TextSelection.near(tr.doc.resolve(target.pos + 1)));
      return true;
    }).focus(undefined, { scrollIntoView: false }).run();
  };

  const addTab = () => {
    const start = getPos();
    if (typeof start !== "number") return;
    const end = start + node.nodeSize - 1;
    const tab = editor.schema.nodeFromJSON(createTabContent(t("pages.blocks.tab", { count: titles.length + 1 })));
    const tr = editor.state.tr.insert(end, tab);
    tr.setSelection(TextSelection.near(tr.doc.resolve(end + 1)));
    editor.view.dispatch(tr);
    setActive(titles.length);
    editor.commands.focus(undefined, { scrollIntoView: false });
  };

  const renameTab = (index: number, value: string) => {
    setRenaming(null);
    const target = tabPosition(index);
    const title = value.trim();
    if (!target?.tab || !title || title === target.tab.attrs.title) return;
    editor.view.dispatch(editor.state.tr.setNodeAttribute(target.pos, "title", title));
  };

  const deleteTab = (index: number) => {
    const start = getPos();
    const target = tabPosition(index);
    if (typeof start !== "number" || !target?.tab) return;
    // Notion removes the whole block with its last tab.
    if (titles.length <= 1) {
      editor.chain().focus().deleteRange({ from: start, to: start + node.nodeSize }).run();
      return;
    }
    editor.view.dispatch(editor.state.tr.delete(target.pos, target.pos + target.tab.nodeSize));
    setActive(Math.max(0, Math.min(index, titles.length - 2)));
  };

  return (
    <NodeViewWrapper
      className={cn("ponder-tabs-block", selected && "is-selected")}
      data-active-tab={current}
      style={{ "--ponder-empty-tab": JSON.stringify(t("pages.blocks.emptyTab")) } as CSSProperties}
    >
      <div className="ponder-tabs-bar" contentEditable={false} role="tablist">
        {titles.map((title, index) => {
          const label = title || t("pages.blocks.tab", { count: index + 1 });
          if (renaming?.index === index) {
            return (
              <input
                key={index}
                ref={renameRef}
                className="ponder-tabs-rename"
                aria-label={t("pages.blocks.tabName")}
                value={renaming.value}
                size={Math.max(4, renaming.value.length + 1)}
                onChange={(event) => setRenaming({ index, value: event.target.value })}
                onBlur={() => renameTab(index, renaming.value)}
                onKeyDown={(event) => {
                  event.stopPropagation();
                  if (event.key === "Enter") renameTab(index, renaming.value);
                  if (event.key === "Escape") setRenaming(null);
                }}
              />
            );
          }
          const tabButton = (
            <button
              key={index}
              type="button"
              role="tab"
              aria-selected={index === current}
              className="ponder-tabs-tab"
              onMouseDown={(event) => event.preventDefault()}
              onClick={() => {
                // As in Notion, clicking the open tab opens its menu.
                if (index === current && editor.isEditable) setMenuIndex(index);
                else openTab(index);
              }}
              onDoubleClick={() => editor.isEditable && setRenaming({ index, value: label })}
            >
              {label}
            </button>
          );
          if (index !== current) return tabButton;
          return (
            <DropdownMenu key={index} open={menuIndex === index} onOpenChange={(open) => setMenuIndex(open ? index : null)}>
              <DropdownMenuTrigger asChild>{tabButton}</DropdownMenuTrigger>
              <DropdownMenuContent align="start" className="min-w-44" aria-label={t("pages.blocks.tabOptions")} onCloseAutoFocus={(event) => event.preventDefault()}>
                <DropdownMenuItem onSelect={() => setRenaming({ index, value: label })}>
                  <Pencil className="h-4 w-4" aria-hidden="true" />{t("pages.blocks.renameTab")}
                </DropdownMenuItem>
                <DropdownMenuItem onSelect={() => deleteTab(index)}>
                  <Trash2 className="h-4 w-4" aria-hidden="true" />{t("pages.blocks.deleteTab")}
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          );
        })}
        {(
          <TooltipProvider delayDuration={300}>
            <Tooltip>
              <TooltipTrigger asChild>
                <button type="button" className="ponder-tabs-add" aria-label={t("pages.blocks.addTab")} onMouseDown={(event) => event.preventDefault()} onClick={addTab}>
                  <Plus className="h-4 w-4" aria-hidden="true" />
                </button>
              </TooltipTrigger>
              <TooltipContent side="bottom">{t("pages.blocks.addTab")}</TooltipContent>
            </Tooltip>
          </TooltipProvider>
        )}
      </div>
      <NodeViewContent className="ponder-tabs-body" />
    </NodeViewWrapper>
  );
};

export const EditorTabs = Tabs.extend({
  addNodeView() {
    return ReactNodeViewRenderer(TabsView, {
      // The tab row's buttons, menu and rename field handle their own events.
      stopEvent: ({ event }) => event.target instanceof Element && Boolean(event.target.closest(".ponder-tabs-bar")),
    });
  },
});

