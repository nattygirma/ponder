import type { Editor } from "@tiptap/core";
import type { Node as ProseMirrorNode } from "@tiptap/pm/model";
import { Selection, TextSelection, type EditorState, type Transaction } from "@tiptap/pm/state";
import {
  CellSelection,
  TableMap,
  addColumn,
  addRow,
  cellAround,
  deleteCellSelection,
  isInTable,
  mergeCells,
  moveTableColumn,
  moveTableRow,
  selectedRect,
  splitCell,
  type TableRect,
} from "@tiptap/pm/tables";
import { isPageColor, type PageColor } from "@ponder/shared/page-color";
import { TABLE_DEFAULT_COLUMN_WIDTH, TABLE_MIN_COLUMN_WIDTH, tableCellText } from "@ponder/shared/markdown-table";

/**
 * Notion's simple-table actions. The row and column handles select their row or column first, so
 * every action works on the selected rectangle of cells, as Notion's menus do.
 */

export type TableAxis = "row" | "column";

/** The table node at `tablePos` (the position just before it), with its map. */
export const tableAt = (state: EditorState, tablePos: number) => {
  const table = state.doc.nodeAt(tablePos);
  if (!table || table.type.spec.tableRole !== "table") return null;
  return { table, tableStart: tablePos + 1, map: TableMap.get(table) };
};

/** Where the selection's table starts, or null outside a table. */
export const selectedTablePos = (state: EditorState): number | null => {
  if (!isInTable(state)) return null;
  const $cell = state.selection instanceof CellSelection ? state.selection.$anchorCell : cellAround(state.selection.$from);
  if (!$cell) return null;
  return $cell.start(-1) - 1;
};

const cellPosAt = (state: EditorState, tablePos: number, row: number, col: number) => {
  const found = tableAt(state, tablePos);
  if (!found) return null;
  const { map, tableStart } = found;
  if (row < 0 || col < 0 || row >= map.height || col >= map.width) return null;
  return tableStart + map.map[row * map.width + col];
};

/** Selects a whole row or column, as clicking its handle does. */
export const selectTableLine = (editor: Editor, tablePos: number, axis: TableAxis, index: number) => {
  const found = tableAt(editor.state, tablePos);
  if (!found) return false;
  const last = axis === "row" ? found.map.width - 1 : found.map.height - 1;
  const anchor = axis === "row" ? cellPosAt(editor.state, tablePos, index, 0) : cellPosAt(editor.state, tablePos, 0, index);
  const head = axis === "row" ? cellPosAt(editor.state, tablePos, index, last) : cellPosAt(editor.state, tablePos, last, index);
  if (anchor === null || head === null) return false;
  const $anchor = editor.state.doc.resolve(anchor);
  const $head = editor.state.doc.resolve(head);
  const selection = axis === "row" ? CellSelection.rowSelection($anchor, $head) : CellSelection.colSelection($anchor, $head);
  editor.view.dispatch(editor.state.tr.setSelection(selection));
  return true;
};

/** Selects one cell as a cell selection, so the cell menu's actions apply to it. */
export const selectTableCell = (editor: Editor, cellPos: number) => {
  const $cell = editor.state.doc.resolve(cellPos);
  editor.view.dispatch(editor.state.tr.setSelection(new CellSelection($cell)));
};

/** What the selection covers: whole rows, whole columns, several cells or one. */
export const describeTableSelection = (state: EditorState) => {
  if (!isInTable(state)) return null;
  const rect = selectedRect(state);
  const rows = rect.bottom - rect.top;
  const cols = rect.right - rect.left;
  const wholeRows = cols === rect.map.width;
  const wholeColumns = rows === rect.map.height;
  const cells = rect.map.cellsInRect(rect);
  const merged = cells.some((pos) => {
    const cell = rect.table.nodeAt(pos);
    return Boolean(cell && (cell.attrs.colspan > 1 || cell.attrs.rowspan > 1));
  });
  return { rect, rows, cols, wholeRows, wholeColumns, cellCount: cells.length, merged };
};

const isHeaderCell = (node: ProseMirrorNode | null | undefined) => node?.type.spec.tableRole === "header_cell";

/** Whether every cell of the table's first row (or column) is a header cell. */
export const hasHeader = (state: EditorState, tablePos: number, axis: TableAxis) => {
  const found = tableAt(state, tablePos);
  if (!found) return false;
  const { map, table } = found;
  const count = axis === "row" ? map.width : map.height;
  for (let index = 0; index < count; index += 1) {
    const pos = axis === "row" ? map.map[index] : map.map[index * map.width];
    if (!isHeaderCell(table.nodeAt(pos))) return false;
  }
  return count > 0;
};

/** Header row or Header column, from the first row's or column's menu. */
export const toggleTableHeader = (editor: Editor, tablePos: number, axis: TableAxis) => {
  const found = tableAt(editor.state, tablePos);
  if (!found) return false;
  const on = !hasHeader(editor.state, tablePos, axis);
  const { map, table, tableStart } = found;
  const { tableHeader, tableCell } = editor.schema.nodes;
  const tr = editor.state.tr;
  const seen = new Set<number>();
  const count = axis === "row" ? map.width : map.height;
  for (let index = 0; index < count; index += 1) {
    const pos = axis === "row" ? map.map[index] : map.map[index * map.width];
    if (seen.has(pos)) continue;
    seen.add(pos);
    const cell = table.nodeAt(pos)!;
    // A cell that's also in the other header line stays a header.
    const row = Math.floor(map.map.indexOf(pos) / map.width);
    const col = map.map.indexOf(pos) % map.width;
    const otherHeader = axis === "row"
      ? col === 0 && hasHeader(editor.state, tablePos, "column")
      : row === 0 && hasHeader(editor.state, tablePos, "row");
    const type = on || otherHeader ? tableHeader : tableCell;
    if (cell.type !== type) tr.setNodeMarkup(tableStart + pos, type, cell.attrs);
  }
  editor.view.dispatch(tr);
  return true;
};

/** Colour for the selected cells; a text colour replaces a background and the other way round, as in Notion. */
export const setTableColor = (editor: Editor, color: PageColor | null) => {
  if (!isInTable(editor.state) || (color !== null && !isPageColor(color))) return false;
  return editor.chain().setCellAttribute("color", color).run();
};

export const insertTableLine = (editor: Editor, axis: TableAxis, side: "before" | "after") => {
  if (!isInTable(editor.state)) return false;
  const chain = editor.chain();
  if (axis === "row") return (side === "before" ? chain.addRowBefore() : chain.addRowAfter()).run();
  return (side === "before" ? chain.addColumnBefore() : chain.addColumnAfter()).run();
};

/** Copies the selected rows or columns and puts the copy right after them. */
export const duplicateTableLines = (editor: Editor, axis: TableAxis) => {
  if (!isInTable(editor.state)) return false;
  const state = editor.state;
  const rect = selectedRect(state);
  const tablePos = rect.tableStart - 1;
  let tr = state.tr;
  if (axis === "row") {
    const rows: ProseMirrorNode[] = [];
    for (let row = rect.top; row < rect.bottom; row += 1) rows.push(rect.table.child(row));
    let insertAt = rect.tableStart;
    for (let row = 0; row < rect.bottom; row += 1) insertAt += rect.table.child(row).nodeSize;
    tr.insert(insertAt, rows.map((row) => row.type.create(row.attrs, row.content, row.marks)));
  } else {
    const width = rect.right - rect.left;
    for (let offset = 0; offset < width; offset += 1) {
      const before = tr.doc.nodeAt(tablePos)!;
      tr = addColumn(tr, { map: TableMap.get(before), table: before, tableStart: tablePos + 1, left: 0, top: 0, right: 0, bottom: 0 }, rect.right + offset);
      // Copy each source cell's content into the new column, unless a merge covers it.
      const table = tr.doc.nodeAt(tablePos)!;
      const map = TableMap.get(table);
      const sourceCol = rect.left + offset;
      const targetCol = rect.right + offset;
      for (let row = map.height - 1; row >= 0; row -= 1) {
        const targetPos = map.map[row * map.width + targetCol];
        const sourcePos = map.map[row * map.width + sourceCol];
        if (targetPos === sourcePos) continue;
        if (row > 0 && map.map[(row - 1) * map.width + targetCol] === targetPos) continue;
        const source = table.nodeAt(sourcePos)!;
        const target = table.nodeAt(targetPos)!;
        tr.replaceWith(
          tablePos + 1 + targetPos,
          tablePos + 1 + targetPos + target.nodeSize,
          source.type.create({ ...source.attrs, colspan: 1, rowspan: target.attrs.rowspan, colwidth: source.attrs.colwidth?.slice(0, 1) ?? null }, source.content),
        );
      }
    }
  }
  editor.view.dispatch(tr);
  return true;
};

/** Empties the selected cells and keeps the table's shape. */
export const clearTableCells = (editor: Editor) => {
  if (!isInTable(editor.state)) return false;
  if (!(editor.state.selection instanceof CellSelection)) {
    const $cell = cellAround(editor.state.selection.$from);
    if (!$cell) return false;
    editor.view.dispatch(editor.state.tr.setSelection(new CellSelection($cell)));
  }
  return deleteCellSelection(editor.state, (tr) => editor.view.dispatch(tr));
};

/** Deletes the selected rows or columns, and the table when nothing would be left. */
export const deleteTableLines = (editor: Editor, axis: TableAxis) => {
  const described = describeTableSelection(editor.state);
  if (!described) return false;
  const everything = axis === "row" ? described.rows === described.rect.map.height : described.cols === described.rect.map.width;
  if (everything) return editor.chain().deleteTable().run();
  return axis === "row" ? editor.chain().deleteRow().run() : editor.chain().deleteColumn().run();
};

/** Merges the selection. Like Notion, the top-left cell's content is what stays. */
export const mergeTableCells = (editor: Editor) => {
  const described = describeTableSelection(editor.state);
  if (!described || described.cellCount < 2) return false;
  const { rect } = described;
  const first = rect.map.map[rect.top * rect.map.width + rect.left];
  const tr = editor.state.tr;
  const { paragraph } = editor.schema.nodes;
  // Empty every other cell, last first so positions stay valid.
  for (const pos of [...rect.map.cellsInRect(rect)].sort((a, b) => b - a)) {
    if (pos === first) continue;
    const cell = rect.table.nodeAt(pos)!;
    const start = rect.tableStart + pos + 1;
    tr.replaceWith(start, start + cell.content.size, paragraph.create());
  }
  // Merge on the cleared table, then send both as one change so a single undo restores it.
  const cleared = editor.state.apply(tr);
  const merged: Transaction[] = [];
  if (!mergeCells(cleared, (next) => merged.push(next)) || !merged[0]) return false;
  for (const step of merged[0].steps) tr.step(step);
  tr.setSelection(Selection.fromJSON(tr.doc, merged[0].selection.toJSON()));
  editor.view.dispatch(tr);
  return true;
};

export const unmergeTableCells = (editor: Editor) => splitCell(editor.state, (tr) => editor.view.dispatch(tr));

/** Drag a row or column handle to here. */
export const moveTableLine = (editor: Editor, tablePos: number, axis: TableAxis, from: number, to: number) => {
  if (from === to) return false;
  const command = axis === "row" ? moveTableRow({ from, to, pos: tablePos + 1 }) : moveTableColumn({ from, to, pos: tablePos + 1 });
  return command(editor.state, (tr) => editor.view.dispatch(tr));
};

/** The `+` bars: a new row at the bottom or a new column at the right. */
export const appendTableLine = (editor: Editor, tablePos: number, axis: TableAxis, count = 1) => {
  let tr = editor.state.tr;
  for (let added = 0; added < count; added += 1) {
    const table = tr.doc.nodeAt(tablePos);
    if (!table) return false;
    const map = TableMap.get(table);
    const rect: TableRect = { map, table, tableStart: tablePos + 1, left: 0, top: 0, right: map.width, bottom: map.height };
    tr = axis === "row" ? addRow(tr, rect, map.height) : addColumn(tr, rect, map.width);
  }
  editor.view.dispatch(tr);
  return true;
};

const cellIsEmpty = (cell: ProseMirrorNode) => cell.textContent.trim() === "" && cell.childCount <= 1 && !cell.firstChild?.childCount;

/** Whether the last row or column has nothing in it, so the corner drag may take it away. */
export const lastLineIsEmpty = (state: EditorState, tablePos: number, axis: TableAxis) => {
  const found = tableAt(state, tablePos);
  if (!found) return false;
  const { map, table } = found;
  const count = axis === "row" ? map.height : map.width;
  if (count <= 1) return false;
  const positions = axis === "row"
    ? map.map.slice((map.height - 1) * map.width)
    : Array.from({ length: map.height }, (_, row) => map.map[row * map.width + map.width - 1]);
  return positions.every((pos) => {
    const cell = table.nodeAt(pos)!;
    // A merged cell reaching into the line isn't the line's own; keep it.
    return (axis === "row" ? cell.attrs.rowspan : cell.attrs.colspan) === 1 && cellIsEmpty(cell);
  });
};

/** The corner and `+` bar drags take back only empty rows and columns, so nothing typed is lost. */
export const removeEmptyTrailingLines = (editor: Editor, tablePos: number, axis: TableAxis, count: number) => {
  let removed = 0;
  while (removed < count && lastLineIsEmpty(editor.state, tablePos, axis)) {
    const found = tableAt(editor.state, tablePos)!;
    const last = (axis === "row" ? found.map.height : found.map.width) - 1;
    const anchor = axis === "row" ? cellPosAt(editor.state, tablePos, last, 0)! : cellPosAt(editor.state, tablePos, 0, last)!;
    editor.view.dispatch(editor.state.tr.setSelection(new CellSelection(editor.state.doc.resolve(anchor))));
    if (!(axis === "row" ? editor.commands.deleteRow() : editor.commands.deleteColumn())) break;
    removed += 1;
  }
  return removed;
};

/*
 * Adapted from AppFlowy-Web (https://github.com/AppFlowy-IO/AppFlowy-Web), Copyright AppFlowy,
 * AGPL-3.0: resizeSimpleTable in src/components/editor/components/blocks/simple-table/SimpleTable.layout.ts.
 * AppFlowy gives every column an equal share; Notion's "Fit to width" keeps the columns' proportions.
 */
/** Notion's "Fit to width": scale the columns so the table is exactly `width` pixels wide. */
export const fitTableToWidth = (editor: Editor, tablePos: number, width: number) => {
  const found = tableAt(editor.state, tablePos);
  if (!found || width <= 0) return false;
  const { map, table, tableStart } = found;
  const widths = Array.from({ length: map.width }, (_, col) => {
    const pos = map.map[col];
    const cell = table.nodeAt(pos)!;
    const rect = map.findCell(pos);
    const colwidth = cell.attrs.colwidth as number[] | null;
    return colwidth?.[col - rect.left] || TABLE_DEFAULT_COLUMN_WIDTH;
  });
  const total = widths.reduce((sum, value) => sum + value, 0);
  // Whole pixels, with the rounding left over given to the last column.
  const scaled = widths.map((value) => Math.max(TABLE_MIN_COLUMN_WIDTH, Math.floor((value / total) * width)));
  scaled[scaled.length - 1] += Math.max(0, width - scaled.reduce((sum, value) => sum + value, 0));
  const tr = editor.state.tr;
  const seen = new Set<number>();
  for (const pos of map.map) {
    if (seen.has(pos)) continue;
    seen.add(pos);
    const cell = table.nodeAt(pos)!;
    const rect = map.findCell(pos);
    tr.setNodeMarkup(tableStart + pos, null, { ...cell.attrs, colwidth: scaled.slice(rect.left, rect.right) });
  }
  if (table.attrs.fitWidth) tr.setNodeAttribute(tablePos, "fitWidth", false);
  editor.view.dispatch(tr);
  return true;
};

/** The block menu works on the whole table, so Notion shows all of it selected while it is open. */
export const selectWholeTable = (editor: Editor, tablePos: number) => {
  const found = tableAt(editor.state, tablePos);
  if (!found || !found.map.map.length) return false;
  const { map, tableStart } = found;
  const doc = editor.state.doc;
  const selection = CellSelection.create(doc, tableStart + map.map[0], tableStart + map.map[map.map.length - 1]);
  editor.view.dispatch(editor.state.tr.setSelection(selection));
  return true;
};

/** When the block menu closes, put the cursor back in the table's first cell if it is still selected whole. */
export const releaseTable = (editor: Editor, tablePos: number) => {
  const found = tableAt(editor.state, tablePos);
  const { selection } = editor.state;
  if (!found || !(selection instanceof CellSelection)) return false;
  const all = found.map.map.length;
  let count = 0;
  selection.forEachCell(() => { count += 1; });
  if (count < new Set(found.map.map).size || selection.$anchorCell.start(-1) !== found.tableStart || !all) return false;
  const first = found.tableStart + found.map.map[0];
  editor.view.dispatch(editor.state.tr.setSelection(TextSelection.near(editor.state.doc.resolve(first + 1))));
  return true;
};

/** Text of every cell, row by row, with a merged cell's text in its first slot only. */
export const tableText = (table: ProseMirrorNode): string[][] => {
  const map = TableMap.get(table);
  const rows: string[][] = [];
  for (let row = 0; row < map.height; row += 1) {
    const values: string[] = [];
    for (let col = 0; col < map.width; col += 1) {
      const pos = map.map[row * map.width + col];
      const firstSlot = map.map.indexOf(pos) === row * map.width + col;
      values.push(firstSlot ? tableCellText(table.nodeAt(pos)!) : "");
    }
    rows.push(values);
  }
  return rows;
};

/**
 * What Turn into database makes: the header row's text as property names (all Text), and a row
 * for every other row. Without a header row, every row becomes a database row.
 */
export const tableToDatabase = (table: ProseMirrorNode, fallbackName: (index: number) => string) => {
  const text = tableText(table);
  const firstIsHeader = table.childCount > 0 && Array.from({ length: table.child(0).childCount }, (_, index) => table.child(0).child(index))
    .every((cell) => isHeaderCell(cell));
  const header = firstIsHeader ? text[0] : [];
  const width = text[0]?.length ?? 0;
  const used = new Set<string>();
  const columns = Array.from({ length: width }, (_, index) => {
    let name = (header[index] ?? "").replace(/\s+/g, " ").trim().slice(0, 120) || fallbackName(index);
    for (let copy = 2; used.has(name.toLowerCase()); copy += 1) name = `${name.replace(/ \d+$/, "")} ${copy}`;
    used.add(name.toLowerCase());
    return name;
  });
  return { columns, rows: firstIsHeader ? text.slice(1) : text };
};

type ContextAction = {
  key: string;
  destructive?: boolean;
  enabled?: (editor: Editor) => boolean;
  act: (editor: Editor) => unknown;
};

const CONTEXT_ACTIONS: ContextAction[] = [
  { key: "pages.table.insertAbove", act: (editor) => insertTableLine(editor, "row", "before") },
  { key: "pages.table.insertBelow", act: (editor) => insertTableLine(editor, "row", "after") },
  { key: "pages.table.insertLeft", act: (editor) => insertTableLine(editor, "column", "before") },
  { key: "pages.table.insertRight", act: (editor) => insertTableLine(editor, "column", "after") },
  { key: "pages.table.mergeCells", enabled: (editor) => (describeTableSelection(editor.state)?.cellCount ?? 0) > 1, act: mergeTableCells },
  { key: "pages.table.unmergeCells", enabled: (editor) => Boolean(describeTableSelection(editor.state)?.merged), act: unmergeTableCells },
  { key: "pages.table.clearContents", act: clearTableCells },
  { key: "editorToolbar.deleteTableRow", act: (editor) => deleteTableLines(editor, "row") },
  { key: "editorToolbar.deleteTableColumn", act: (editor) => deleteTableLines(editor, "column") },
  { key: "editorToolbar.deleteTable", destructive: true, act: (editor) => editor.chain().deleteTable().run() },
];

/** The right-click menu's table section: a shortcut to the same actions as the handles. */
export const getEditorTableActions = (editor: Editor | null, readOnly: boolean) => {
  const usable = (active: Editor | null): active is Editor =>
    Boolean(active && !active.isDestroyed && active.isEditable && !readOnly && isInTable(active.state));
  return CONTEXT_ACTIONS.map((action) => ({
    key: action.key,
    destructive: Boolean(action.destructive),
    disabled: !usable(editor) || (action.enabled ? !action.enabled(editor) : false),
    run: ({ focus = true }: { focus?: boolean } = {}) => {
      if (!usable(editor) || (action.enabled && !action.enabled(editor))) return;
      if (focus) editor.commands.focus();
      action.act(editor);
    },
  }));
};
