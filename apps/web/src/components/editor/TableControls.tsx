import { useCallback, useEffect, useMemo, useRef, useState, type PointerEvent as ReactPointerEvent, type ReactNode } from "react";
import { createPortal } from "react-dom";
import type { Editor } from "@tiptap/react";
import { CellSelection, TableMap, cellAround } from "@tiptap/pm/tables";
import { ArrowDown, ArrowLeft, ArrowRight, ArrowUp, Baseline, CircleX, Copy, Ellipsis, PanelTop, PanelLeft, Plus, TableCellsMerge, TableCellsSplit, Trash2 } from "lucide-react";
import { useTranslation } from "react-i18next";
import { PAGE_COLORS, type PageColor } from "@ponder/shared/page-color";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSub,
  DropdownMenuSubContent,
  DropdownMenuSubTrigger,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Switch } from "@/components/ui/switch";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { MenuSearch } from "@/components/pages/MenuSearch";
import { ColorSwatch } from "@/components/pages/SelectionBubble";
import {
  appendTableLine,
  clearTableCells,
  deleteTableLines,
  describeTableSelection,
  duplicateTableLines,
  hasHeader,
  insertTableLine,
  mergeTableCells,
  moveTableLine,
  removeEmptyTrailingLines,
  selectTableCell,
  selectTableLine,
  setTableColor,
  tableAt,
  toggleTableHeader,
  unmergeTableCells,
  type TableAxis,
} from "@/lib/editor-table-actions";
import { cn } from "@/lib/utils";

/**
 * Notion's simple-table controls, drawn over the editor: a six-dot handle on the hovered row and
 * column, `+` bars on the right and bottom edges, a corner that adds rows and columns together,
 * and a ⋯ menu on the focused cell. On a phone the handles follow the tapped cell and the `+`
 * bars are always shown.
 */

type Box = { left: number; top: number; width: number; height: number };

type Hover = {
  tablePos: number;
  table: HTMLTableElement;
  row: number;
  col: number;
};

/** The cells a menu was opened on; clicking a menu item can move the editor's selection first. */
type Cells = { anchor: number; head: number };

type Menu =
  | { kind: "row" | "column"; tablePos: number; index: number; left: number; top: number; cells: Cells | null }
  | { kind: "cell"; tablePos: number; left: number; top: number; cells: Cells | null };

const selectedCells = (editor: Editor): Cells | null => {
  const { selection } = editor.state;
  return selection instanceof CellSelection ? { anchor: selection.$anchorCell.pos, head: selection.$headCell.pos } : null;
};

type Drag = { axis: TableAxis; tablePos: number; from: number; to: number; pointer: number };

const NOTION_BLUE = "rgb(35, 131, 226)";
const BAR = 16;
const BAR_GAP = 8;

const mountedView = (editor: Editor) => {
  try {
    return editor.isDestroyed ? null : editor.view;
  } catch {
    return null;
  }
};

const boxOf = (element: Element): Box => {
  const rect = element.getBoundingClientRect();
  return { left: rect.left, top: rect.top, width: rect.width, height: rect.height };
};

/*
 * Adapted from AppFlowy-Web (https://github.com/AppFlowy-IO/AppFlowy-Web), Copyright AppFlowy, AGPL-3.0:
 * revealLastRow follows revealSimpleTableRow in
 * src/components/editor/components/blocks/simple-table/SimpleTable.scroll.ts.
 */
/** After a row is added at the bottom, scroll the page only as far as needed to show it. */
const revealLastRow = (table: HTMLTableElement) => {
  const row = table.querySelector("tr:last-child");
  if (!(row instanceof HTMLElement)) return;
  const viewportBottom = window.visualViewport
    ? window.visualViewport.offsetTop + window.visualViewport.height
    : window.innerHeight;
  for (let ancestor = row.parentElement; ancestor; ancestor = ancestor.parentElement) {
    if (ancestor === document.scrollingElement) break;
    const overflowY = getComputedStyle(ancestor).overflowY;
    if (!["auto", "scroll", "overlay"].includes(overflowY) || ancestor.scrollHeight <= ancestor.clientHeight) continue;
    const bounds = ancestor.getBoundingClientRect();
    const bottom = Math.min(bounds.top + ancestor.clientTop + ancestor.clientHeight, viewportBottom);
    const overflow = row.getBoundingClientRect().bottom - bottom;
    // Only the vertical position changes, so a wide table keeps its horizontal scroll.
    if (overflow > 0) ancestor.scrollTop += overflow;
    return;
  }
  const overflow = row.getBoundingClientRect().bottom - viewportBottom;
  if (overflow > 0) window.scrollBy({ top: overflow });
};

/** The table node's position for a table element in the editor, or null. */
const tablePosOf = (editor: Editor, table: HTMLTableElement): number | null => {
  const view = mountedView(editor);
  const cell = table.querySelector("td, th");
  if (!view || !cell) return null;
  try {
    const $cell = cellAround(view.state.doc.resolve(view.posAtDOM(cell, 0)));
    return $cell ? $cell.start(-1) - 1 : null;
  } catch {
    return null;
  }
};

/** Row and column of a cell element (its top-left slot when merged). */
const slotOf = (editor: Editor, tablePos: number, cell: Element) => {
  const view = mountedView(editor);
  const found = view ? tableAt(view.state, tablePos) : null;
  if (!view || !found) return null;
  try {
    const $cell = cellAround(view.state.doc.resolve(view.posAtDOM(cell, 0)));
    if (!$cell) return null;
    const rect = found.map.findCell($cell.pos - found.tableStart);
    return { row: rect.top, col: rect.left, rect };
  } catch {
    return null;
  }
};

/** Screen box of rows top..bottom and columns left..right of a table element. */
const rangeBox = (editor: Editor, tablePos: number, table: HTMLTableElement, rect: { left: number; top: number; right: number; bottom: number }): Box | null => {
  const view = mountedView(editor);
  const found = view ? tableAt(view.state, tablePos) : null;
  if (!view || !found) return null;
  const { map, tableStart } = found;
  let left = Infinity, top = Infinity, right = -Infinity, bottom = -Infinity;
  for (const pos of map.cellsInRect(rect)) {
    const dom = view.nodeDOM(tableStart + pos);
    if (!(dom instanceof Element) || !table.contains(dom)) continue;
    const box = dom.getBoundingClientRect();
    left = Math.min(left, box.left);
    top = Math.min(top, box.top);
    right = Math.max(right, box.right);
    bottom = Math.max(bottom, box.bottom);
  }
  return Number.isFinite(left) ? { left, top, width: right - left, height: bottom - top } : null;
};

const SixDots = ({ vertical }: { vertical: boolean }) => (
  <svg viewBox="0 0 10 6" width={vertical ? 6 : 10} height={vertical ? 10 : 6} aria-hidden="true" style={vertical ? { transform: "rotate(90deg)" } : undefined}>
    {[1, 5, 9].flatMap((x) => [1.5, 4.5].map((y) => <circle key={`${x}-${y}`} cx={x} cy={y} r={0.9} fill="currentColor" />))}
  </svg>
);

/** The Color submenu shared by every table menu, laid out like Notion's. */
const ColorMenu = ({ onPick }: { onPick: (color: PageColor | null) => void }) => {
  const { t } = useTranslation();
  return (
    <DropdownMenuSub>
      <DropdownMenuSubTrigger>
        <Baseline className="h-4 w-4" aria-hidden="true" />
        {t("pages.color.label")}
      </DropdownMenuSubTrigger>
      <DropdownMenuSubContent className="max-h-[420px] w-52 overflow-y-auto">
        <div className="px-2 pb-0.5 pt-1 text-xs font-medium text-slate-500" data-menu-note>{t("pages.color.text")}</div>
        <DropdownMenuItem onSelect={() => onPick(null)}><ColorSwatch />{t("pages.table.colorText", { color: t("pages.color.default") })}</DropdownMenuItem>
        {PAGE_COLORS.map((color) => (
          <DropdownMenuItem key={color} onSelect={() => onPick(color)}><ColorSwatch color={color} />{t("pages.table.colorText", { color: t(`pages.color.${color}`) })}</DropdownMenuItem>
        ))}
        <div className="px-2 pb-0.5 pt-1 text-xs font-medium text-slate-500" data-menu-note>{t("pages.color.background")}</div>
        <DropdownMenuItem onSelect={() => onPick(null)}><ColorSwatch />{t("pages.color.defaultBackground")}</DropdownMenuItem>
        {PAGE_COLORS.map((color) => (
          <DropdownMenuItem key={color} onSelect={() => onPick(`${color}_background`)}><ColorSwatch color={`${color}_background`} />{t(`pages.color.${color}Background`)}</DropdownMenuItem>
        ))}
      </DropdownMenuSubContent>
    </DropdownMenuSub>
  );
};

const Hint = ({ label, children }: { label: string; children: ReactNode }) => (
  <Tooltip>
    <TooltipTrigger asChild>{children}</TooltipTrigger>
    <TooltipContent side="top">{label}</TooltipContent>
  </Tooltip>
);

export const TableControls = ({ editor, touch, readOnly }: { editor: Editor; touch: boolean; readOnly: boolean }) => {
  const { t } = useTranslation();
  const [hover, setHover] = useState<Hover | null>(null);
  const [menu, setMenu] = useState<Menu | null>(null);
  const [drag, setDrag] = useState<Drag | null>(null);
  const [, setFrame] = useState(0);
  const rerender = useCallback(() => setFrame((frame) => (frame + 1) % 1_000_000), []);
  const overControls = useRef(false);
  const menuRef = useRef(menu);
  menuRef.current = menu;
  const dragRef = useRef(drag);
  dragRef.current = drag;

  // Redraw when the document, selection, layout or scroll position changes.
  useEffect(() => {
    let frame = 0;
    const schedule = () => {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(rerender);
    };
    editor.on("transaction", schedule);
    window.addEventListener("scroll", schedule, true);
    window.addEventListener("resize", schedule);
    return () => {
      cancelAnimationFrame(frame);
      editor.off("transaction", schedule);
      window.removeEventListener("scroll", schedule, true);
      window.removeEventListener("resize", schedule);
    };
  }, [editor, rerender]);

  // Hover tracking: the cell under the pointer decides which handles show.
  useEffect(() => {
    if (touch) return;
    const view = mountedView(editor);
    if (!view) return;
    const root = view.dom;
    const onMove = (event: MouseEvent) => {
      if (menuRef.current || dragRef.current) return;
      const target = event.target instanceof Element ? event.target : null;
      const cell = target?.closest("td, th");
      const table = cell?.closest<HTMLTableElement>(".ponder-table table");
      if (!cell || !table || !root.contains(table)) return;
      const tablePos = tablePosOf(editor, table);
      const slot = tablePos === null ? null : slotOf(editor, tablePos, cell);
      if (tablePos === null || !slot) return;
      setHover((current) => (current && current.table === table && current.row === slot.row && current.col === slot.col
        ? current
        : { tablePos, table, row: slot.row, col: slot.col }));
    };
    const onLeave = (event: MouseEvent) => {
      if (menuRef.current || dragRef.current) return;
      const next = event.relatedTarget instanceof Element ? event.relatedTarget : null;
      if (next?.closest("[data-table-control]")) return;
      window.setTimeout(() => {
        if (!overControls.current && !menuRef.current && !dragRef.current) setHover(null);
      }, 80);
    };
    root.addEventListener("mousemove", onMove);
    root.addEventListener("mouseleave", onLeave);
    return () => {
      root.removeEventListener("mousemove", onMove);
      root.removeEventListener("mouseleave", onLeave);
    };
  }, [editor, touch]);

  const view = mountedView(editor);
  const state = view?.state ?? null;

  // The focused cell (or cell selection) decides the ⋯ button, the blue outline and, on a phone, the handles.
  const focus = useMemo(() => {
    if (!view || !state) return null;
    const described = describeTableSelection(state);
    if (!described) return null;
    const tablePos = described.rect.tableStart - 1;
    const dom = view.nodeDOM(tablePos);
    const table = dom instanceof Element ? dom.querySelector("table") : null;
    if (!table) return null;
    return { tablePos, table, described };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [view, state, state?.selection, state?.doc]);

  // On a phone the handles belong to the tapped cell.
  const hovered: Hover | null = touch
    ? (focus ? { tablePos: focus.tablePos, table: focus.table, row: focus.described.rect.top, col: focus.described.rect.left } : null)
    : hover && hover.table.isConnected ? hover : null;

  const editable = Boolean(view && editor.isEditable && !readOnly);
  if (!view || !state || !editable) return null;

  const tableInfo = hovered ? tableAt(state, hovered.tablePos) : null;
  // Rows or columns may have been removed since the pointer last moved; keep the slot inside the table.
  const active: Hover | null = hovered && tableInfo
    ? { ...hovered, row: Math.min(hovered.row, tableInfo.map.height - 1), col: Math.min(hovered.col, tableInfo.map.width - 1) }
    : null;
  const tableBox = active ? boxOf(active.table) : null;

  const openLineMenu = (axis: TableAxis, index: number, anchor: DOMRect) => {
    if (!active) return;
    const described = describeTableSelection(state);
    const keep = described && described.rect.tableStart - 1 === active.tablePos
      && (axis === "row" ? described.wholeRows && index >= described.rect.top && index < described.rect.bottom
        : described.wholeColumns && index >= described.rect.left && index < described.rect.right);
    if (!keep) selectTableLine(editor, active.tablePos, axis, index);
    setMenu({ kind: axis, tablePos: active.tablePos, index, left: anchor.left, top: anchor.bottom, cells: selectedCells(editor) });
  };

  const openCellMenu = (anchor: DOMRect) => {
    if (!focus) return;
    if (!(state.selection instanceof CellSelection)) {
      const $cell = cellAround(state.selection.$from);
      if ($cell) selectTableCell(editor, $cell.pos);
    }
    setMenu({ kind: "cell", tablePos: focus.tablePos, left: anchor.left, top: anchor.bottom, cells: selectedCells(editor) });
  };

  const closeMenu = () => {
    setMenu(null);
    overControls.current = false;
  };

  /** Click opens the menu; dragging past a few pixels moves the row or column instead. */
  const startHandle = (axis: TableAxis, index: number) => (event: ReactPointerEvent<HTMLButtonElement>) => {
    if (!active || event.button !== 0) return;
    event.preventDefault();
    const button = event.currentTarget;
    const start = axis === "row" ? event.clientY : event.clientX;
    const tablePos = active.tablePos;
    const table = active.table;
    let moved = false;
    const boundaries = () => {
      const found = tableAt(editor.state, tablePos);
      if (!found) return [];
      const count = axis === "row" ? found.map.height : found.map.width;
      return Array.from({ length: count }, (_, line) => {
        const box = rangeBox(editor, tablePos, table, axis === "row"
          ? { left: 0, right: found.map.width, top: line, bottom: line + 1 }
          : { left: line, right: line + 1, top: 0, bottom: found.map.height });
        return box ? (axis === "row" ? box.top + box.height / 2 : box.left + box.width / 2) : 0;
      });
    };
    const centers = boundaries();
    const targetFor = (pointer: number) => {
      let to = 0;
      centers.forEach((center, line) => { if (pointer > center) to = line; });
      return pointer < centers[0] ? 0 : to;
    };
    const onMove = (move: PointerEvent) => {
      const pointer = axis === "row" ? move.clientY : move.clientX;
      if (!moved && Math.abs(pointer - start) < 4) return;
      if (!moved) selectTableLine(editor, tablePos, axis, index);
      moved = true;
      setDrag({ axis, tablePos, from: index, to: targetFor(pointer), pointer });
    };
    const onUp = () => {
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
      const finished = dragRef.current;
      setDrag(null);
      if (moved && finished) {
        moveTableLine(editor, tablePos, axis, finished.from, finished.to);
        return;
      }
      openLineMenu(axis, index, button.getBoundingClientRect());
    };
    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp);
  };

  /** The `+` bars and the corner: click adds one; dragging adds or takes back as many as the pointer travels. */
  const startGrow = (tablePos: number, table: HTMLTableElement, axes: TableAxis[]) => (event: ReactPointerEvent<HTMLButtonElement>) => {
    if (event.button !== 0) return;
    event.preventDefault();
    const startX = event.clientX;
    const startY = event.clientY;
    const firstCell = table.querySelector("td, th");
    const step = { row: firstCell ? Math.max(28, firstCell.getBoundingClientRect().height) : 34, column: 120 };
    const lastColumn = table.querySelector("colgroup")?.lastElementChild;
    if (lastColumn) step.column = Math.max(40, lastColumn.getBoundingClientRect().width || 120);
    const applied = { row: 0, column: 0 };
    let moved = false;
    const onMove = (move: PointerEvent) => {
      const delta = { row: move.clientY - startY, column: move.clientX - startX };
      if (!moved && Math.abs(delta.row) < 4 && Math.abs(delta.column) < 4) return;
      moved = true;
      for (const axis of axes) {
        const want = Math.round(delta[axis] / step[axis]);
        if (want > applied[axis]) {
          appendTableLine(editor, tablePos, axis, want - applied[axis]);
          applied[axis] = want;
        } else if (want < applied[axis]) {
          applied[axis] -= removeEmptyTrailingLines(editor, tablePos, axis, applied[axis] - want);
        }
      }
    };
    const onUp = () => {
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
      if (!moved) for (const axis of axes) appendTableLine(editor, tablePos, axis);
      if (axes.includes("row") && (!moved || applied.row > 0)) requestAnimationFrame(() => revealLastRow(table));
    };
    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp);
  };

  const controls: ReactNode[] = [];
  const hoverProps = {
    "data-table-control": "",
    onMouseEnter: () => { overControls.current = true; },
    onMouseLeave: () => { overControls.current = false; },
  };

  // `+` bars: on a phone for every table, on a computer for the hovered table's last row or column.
  const barTables: Array<{ tablePos: number; table: HTMLTableElement; showRow: boolean; showColumn: boolean }> = [];
  if (touch) {
    view.dom.querySelectorAll<HTMLTableElement>(".ponder-table table").forEach((table) => {
      const tablePos = tablePosOf(editor, table);
      if (tablePos !== null) barTables.push({ tablePos, table, showRow: true, showColumn: true });
    });
  } else if (active && tableInfo) {
    const lastRow = active.row + (tableInfo.map.findCell(tableInfo.map.map[active.row * tableInfo.map.width + active.col]).bottom - active.row) >= tableInfo.map.height;
    const lastColumn = tableInfo.map.findCell(tableInfo.map.map[active.row * tableInfo.map.width + active.col]).right >= tableInfo.map.width;
    barTables.push({ tablePos: active.tablePos, table: active.table, showRow: lastRow, showColumn: lastColumn });
  }

  for (const bar of barTables) {
    const box = boxOf(bar.table);
    const wrapper = bar.table.closest(".tableWrapper");
    const visible = wrapper ? boxOf(wrapper) : box;
    const right = Math.min(box.left + box.width, visible.left + visible.width);
    const grow = (axes: TableAxis[]) => startGrow(bar.tablePos, bar.table, axes);
    if (bar.showColumn) {
      controls.push(
        <Hint key={`col-bar-${bar.tablePos}`} label={t("pages.table.addColumn")}>
          <button
            type="button"
            {...hoverProps}
            aria-label={t("pages.table.addColumn")}
            className="ponder-table-bar"
            style={{ left: right + BAR_GAP, top: box.top, width: BAR, height: box.height, cursor: "col-resize" }}
            onPointerDown={grow(["column"])}
          >
            <Plus className="h-3 w-3" aria-hidden="true" />
          </button>
        </Hint>,
      );
    }
    if (bar.showRow) {
      controls.push(
        <Hint key={`row-bar-${bar.tablePos}`} label={t("pages.table.addRow")}>
          <button
            type="button"
            {...hoverProps}
            aria-label={t("pages.table.addRow")}
            className="ponder-table-bar"
            style={{ left: box.left, top: box.top + box.height + BAR_GAP, width: right - box.left, height: BAR, cursor: "row-resize" }}
            onPointerDown={grow(["row"])}
          >
            <Plus className="h-3 w-3" aria-hidden="true" />
          </button>
        </Hint>,
      );
    }
    if (bar.showRow && bar.showColumn) {
      controls.push(
        <Hint key={`corner-${bar.tablePos}`} label={t("pages.table.addBoth")}>
          <button
            type="button"
            {...hoverProps}
            aria-label={t("pages.table.addBoth")}
            className="ponder-table-bar"
            style={{ left: right + BAR_GAP, top: box.top + box.height + BAR_GAP, width: BAR, height: BAR, cursor: "nwse-resize", borderRadius: 999 }}
            onPointerDown={grow(["row", "column"])}
          >
            <Plus className="h-3 w-3" aria-hidden="true" />
          </button>
        </Hint>,
      );
    }
  }

  // Row and column handles.
  if (active && tableInfo && tableBox) {
    const rowBox = rangeBox(editor, active.tablePos, active.table, { left: 0, right: tableInfo.map.width, top: active.row, bottom: active.row + 1 });
    const colBox = rangeBox(editor, active.tablePos, active.table, { left: active.col, right: active.col + 1, top: 0, bottom: tableInfo.map.height });
    const openRow = menu?.kind === "row" && menu.index === active.row;
    const openCol = menu?.kind === "column" && menu.index === active.col;
    if (rowBox) {
      controls.push(
        <Hint key="row-handle" label={t("pages.table.dragHint")}>
          <button
            type="button"
            {...hoverProps}
            aria-label={t("pages.table.rowMenu")}
            className={cn("ponder-table-handle", openRow && "is-open")}
            style={{ left: tableBox.left - 6, top: rowBox.top + rowBox.height / 2 - 10, width: 12, height: 20, cursor: "grab" }}
            onPointerDown={startHandle("row", active.row)}
          >
            <SixDots vertical />
          </button>
        </Hint>,
      );
    }
    if (colBox) {
      controls.push(
        <Hint key="col-handle" label={t("pages.table.dragHint")}>
          <button
            type="button"
            {...hoverProps}
            aria-label={t("pages.table.columnMenu")}
            className={cn("ponder-table-handle", openCol && "is-open")}
            style={{ left: colBox.left + colBox.width / 2 - 10, top: tableBox.top - 6, width: 20, height: 12, cursor: "grab" }}
            onPointerDown={startHandle("column", active.col)}
          >
            <SixDots vertical={false} />
          </button>
        </Hint>,
      );
    }
  }

  // The blue outline around the focused cell or selected cells, and the ⋯ cell menu button.
  if (focus) {
    const outline = rangeBox(editor, focus.tablePos, focus.table, focus.described.rect);
    // Adapted from AppFlowy-Web (https://github.com/AppFlowy-IO/AppFlowy-Web), Copyright AppFlowy, AGPL-3.0:
    // the selection outline in SimpleTableActionOverlay.tsx. A wide table scrolls sideways inside its
    // wrapper, so keep the outline inside the visible part and drop the border on a hidden side.
    const wrapper = focus.table.closest(".tableWrapper");
    const visible = wrapper ? boxOf(wrapper) : null;
    const left = outline && visible ? Math.max(outline.left, visible.left) : outline?.left ?? 0;
    const right = outline && visible ? Math.min(outline.left + outline.width, visible.left + visible.width) : outline ? outline.left + outline.width : 0;
    if (outline && right > left) {
      const cutLeft = left > outline.left;
      const cutRight = right < outline.left + outline.width;
      controls.push(
        <div key="outline" aria-hidden="true" className="ponder-table-outline" style={{
          left: cutLeft ? left : left - 1, top: outline.top - 1, width: right - left + (cutLeft ? 0 : 1), height: outline.height + 1,
          borderColor: NOTION_BLUE, borderLeftWidth: cutLeft ? 0 : undefined, borderRightWidth: cutRight ? 0 : undefined,
        }} />,
      );
      // Notion shows the cell menu for cells, not for a whole row or column picked by its handle.
      const wholeLine = (focus.described.wholeRows || focus.described.wholeColumns) && focus.described.cellCount > 1;
      if (!wholeLine && !cutRight) {
        controls.push(
          <Hint key="cell-menu" label={t("pages.table.cellMenu")}>
            <button
              type="button"
              {...hoverProps}
              aria-label={t("pages.table.cellMenu")}
              className={cn("ponder-table-cell-button", menu?.kind === "cell" && "is-open")}
              style={{ left: outline.left + outline.width - 22, top: outline.top + 6, width: 18, height: 18 }}
              onMouseDown={(event) => event.preventDefault()}
              onClick={(event) => openCellMenu(event.currentTarget.getBoundingClientRect())}
            >
              <Ellipsis className="h-3.5 w-3.5" aria-hidden="true" />
            </button>
          </Hint>,
        );
      }
    }
  }

  // Where a dragged row or column will land.
  if (drag) {
    const found = tableAt(state, drag.tablePos);
    const table = active?.table;
    if (found && table) {
      const line = rangeBox(editor, drag.tablePos, table, drag.axis === "row"
        ? { left: 0, right: found.map.width, top: drag.to, bottom: drag.to + 1 }
        : { left: drag.to, right: drag.to + 1, top: 0, bottom: found.map.height });
      if (line) {
        const after = drag.to > drag.from;
        controls.push(
          <div
            key="drop"
            aria-hidden="true"
            className="ponder-table-drop"
            style={drag.axis === "row"
              ? { left: line.left, top: (after ? line.top + line.height : line.top) - 2, width: line.width, height: 4 }
              : { left: (after ? line.left + line.width : line.left) - 2, top: line.top, width: 4, height: line.height }}
          />,
        );
      }
    }
  }

  const menuState = menu ? tableAt(state, menu.tablePos) : null;
  const described = describeTableSelection(state);
  const axis: TableAxis = menu?.kind === "column" ? "column" : "row";
  const first = menu && menu.kind !== "cell" && menu.index === 0;
  /** Put back the cells the menu was opened on, then act on them. */
  const restore = () => {
    if (!menu?.cells) return;
    try {
      const selection = CellSelection.create(editor.state.doc, menu.cells.anchor, menu.cells.head);
      if (!editor.state.selection.eq(selection)) editor.view.dispatch(editor.state.tr.setSelection(selection));
    } catch {
      // The table changed under the menu; act on whatever is selected now.
    }
  };
  const run = (action: () => unknown) => () => {
    restore();
    action();
    closeMenu();
  };

  return (
    <>
      {createPortal(<div className="ponder-table-controls">{controls}</div>, document.body)}
      <DropdownMenu open={Boolean(menu && menuState)} onOpenChange={(open) => { if (!open) closeMenu(); }}>
        <DropdownMenuTrigger asChild>
          <span aria-hidden="true" style={{ position: "fixed", left: menu?.left ?? 0, top: menu?.top ?? 0, width: 1, height: 1, pointerEvents: "none" }} />
        </DropdownMenuTrigger>
        <DropdownMenuContent align="start" side="bottom" className="w-60" onCloseAutoFocus={(event) => { event.preventDefault(); editor.view.focus(); }}>
          <MenuSearch placeholder={t("pages.block.searchActions")} />
          {menu && menu.kind !== "cell" && first ? (
            <DropdownMenuItem onSelect={(event) => { event.preventDefault(); toggleTableHeader(editor, menu.tablePos, axis); }}>
              {axis === "row" ? <PanelTop className="h-4 w-4" aria-hidden="true" /> : <PanelLeft className="h-4 w-4" aria-hidden="true" />}
              <span className="flex-1">{axis === "row" ? t("pages.table.headerRow") : t("pages.table.headerColumn")}</span>
              <Switch className="pointer-events-none scale-75 data-[state=checked]:bg-[rgb(35,131,226)]" checked={hasHeader(state, menu.tablePos, axis)} tabIndex={-1} aria-hidden="true" />
            </DropdownMenuItem>
          ) : null}
          <ColorMenu onPick={(color) => { restore(); setTableColor(editor, color); closeMenu(); }} />
          {menu && menu.kind !== "cell" ? (
            <>
              <DropdownMenuItem onSelect={run(() => insertTableLine(editor, axis, "before"))}>
                {axis === "row" ? <ArrowUp className="h-4 w-4" aria-hidden="true" /> : <ArrowLeft className="h-4 w-4" aria-hidden="true" />}
                {axis === "row" ? t("pages.table.insertAbove") : t("pages.table.insertLeft")}
              </DropdownMenuItem>
              <DropdownMenuItem onSelect={run(() => insertTableLine(editor, axis, "after"))}>
                {axis === "row" ? <ArrowDown className="h-4 w-4" aria-hidden="true" /> : <ArrowRight className="h-4 w-4" aria-hidden="true" />}
                {axis === "row" ? t("pages.table.insertBelow") : t("pages.table.insertRight")}
              </DropdownMenuItem>
              <DropdownMenuItem onSelect={run(() => duplicateTableLines(editor, axis))}>
                <Copy className="h-4 w-4" aria-hidden="true" />
                {t("pages.table.duplicate")}
              </DropdownMenuItem>
            </>
          ) : null}
          <DropdownMenuItem onSelect={run(() => clearTableCells(editor))}>
            <CircleX className="h-4 w-4" aria-hidden="true" />
            {t("pages.table.clearContents")}
          </DropdownMenuItem>
          {menu?.kind === "cell" && described && described.cellCount > 1 ? (
            <DropdownMenuItem onSelect={run(() => mergeTableCells(editor))}>
              <TableCellsMerge className="h-4 w-4" aria-hidden="true" />
              {t("pages.table.mergeCells")}
            </DropdownMenuItem>
          ) : null}
          {menu?.kind === "cell" && described?.merged ? (
            <DropdownMenuItem onSelect={run(() => unmergeTableCells(editor))}>
              <TableCellsSplit className="h-4 w-4" aria-hidden="true" />
              {t("pages.table.unmergeCells")}
            </DropdownMenuItem>
          ) : null}
          {menu && menu.kind !== "cell" ? (
            <>
              <DropdownMenuItem onSelect={run(() => deleteTableLines(editor, axis))}>
                <Trash2 className="h-4 w-4" aria-hidden="true" />
                {t("pages.table.delete")}
              </DropdownMenuItem>
            </>
          ) : null}
        </DropdownMenuContent>
      </DropdownMenu>
    </>
  );
};
