import { describe, expect, test } from "bun:test";
import { Editor } from "@tiptap/core";
import { CellSelection } from "@tiptap/pm/tables";
import { createPonderDocumentExtensions, docToMarkdown, markdownToDoc } from "@ponder/shared";
import { createPonderMathematics } from "@ponder/shared/mathematics";
import { cellSelectionToTsv, parseTsv, tableClipboardKey } from "@ponder/shared/markdown-table";
import { ensureTestWindowDom } from "./restore-test-global.mjs";
import {
  appendTableLine,
  clearTableCells,
  deleteTableLines,
  describeTableSelection,
  duplicateTableLines,
  fitTableToWidth,
  hasHeader,
  insertTableLine,
  lastLineIsEmpty,
  mergeTableCells,
  moveTableLine,
  releaseTable,
  removeEmptyTrailingLines,
  selectTableCell,
  selectTableLine,
  selectWholeTable,
  selectedTablePos,
  setTableColor,
  tableAt,
  tableText,
  tableToDatabase,
  toggleTableHeader,
  unmergeTableCells,
} from "./editor-table-actions.ts";

const p = (text) => ({ type: "paragraph", content: text ? [{ type: "text", text }] : [] });
const cell = (text, type = "tableCell") => ({ type, content: [p(text)] });
const grid = (rows) => ({
  type: "doc",
  content: [{ type: "table", content: rows.map((row) => ({ type: "tableRow", content: row.map((text) => cell(text)) })) }, p("after")],
});

const createEditor = (rows = [["a", "b", "c"], ["d", "e", "f"], ["g", "h", "i"]]) => {
  ensureTestWindowDom();
  const editor = new Editor({ extensions: createPonderDocumentExtensions({ mathematics: createPonderMathematics() }), content: grid(rows) });
  // Headless editors start without plugins; undo history and table fixing need them.
  editor.view.updateState(editor.state.reconfigure({ plugins: editor.extensionManager.plugins }));
  return editor;
};

const TABLE = 0;
const text = (editor) => tableText(editor.state.doc.nodeAt(TABLE));
const cellPos = (editor, row, col) => {
  const { map, tableStart } = tableAt(editor.state, TABLE);
  return tableStart + map.map[row * map.width + col];
};
const cellNode = (editor, row, col) => editor.state.doc.nodeAt(cellPos(editor, row, col));
const putCursorIn = (editor, row, col) => editor.commands.setTextSelection(cellPos(editor, row, col) + 2);

describe("Notion table actions", () => {
  test("/table inserts a 3 × 3 table with no header row", () => {
    ensureTestWindowDom();
    const editor = new Editor({ extensions: createPonderDocumentExtensions({ mathematics: createPonderMathematics() }), content: { type: "doc", content: [p("")] } });
    editor.commands.insertTable({ rows: 3, cols: 3, withHeaderRow: true });
    const table = editor.state.doc.firstChild;
    expect(table.type.name).toBe("table");
    expect(table.childCount).toBe(3);
    expect(table.child(0).childCount).toBe(3);
    expect(hasHeader(editor.state, 0, "row")).toBe(false);
    expect(selectedTablePos(editor.state)).toBe(0);
  });

  test("a row handle selects the row and the column handle selects the column", () => {
    const editor = createEditor();
    selectTableLine(editor, TABLE, "row", 1);
    let described = describeTableSelection(editor.state);
    expect(described.wholeRows && !described.wholeColumns).toBe(true);
    expect([described.rect.top, described.rect.bottom]).toEqual([1, 2]);
    selectTableLine(editor, TABLE, "column", 2);
    described = describeTableSelection(editor.state);
    expect(described.wholeColumns).toBe(true);
    expect([described.rect.left, described.rect.right]).toEqual([2, 3]);
  });

  test("header row and header column toggle on and off independently", () => {
    const editor = createEditor();
    toggleTableHeader(editor, TABLE, "row");
    expect(hasHeader(editor.state, TABLE, "row")).toBe(true);
    toggleTableHeader(editor, TABLE, "column");
    expect(hasHeader(editor.state, TABLE, "column")).toBe(true);
    toggleTableHeader(editor, TABLE, "row");
    expect(hasHeader(editor.state, TABLE, "row")).toBe(false);
    // The corner cell still belongs to the header column.
    expect(hasHeader(editor.state, TABLE, "column")).toBe(true);
    expect(cellNode(editor, 0, 1).type.name).toBe("tableCell");
  });

  test("colour applies to the whole selected column and can be reset", () => {
    const editor = createEditor();
    selectTableLine(editor, TABLE, "column", 1);
    setTableColor(editor, "blue_background");
    expect([0, 1, 2].map((row) => cellNode(editor, row, 1).attrs.color)).toEqual(["blue_background", "blue_background", "blue_background"]);
    expect(cellNode(editor, 0, 0).attrs.color).toBe(null);
    setTableColor(editor, null);
    expect(cellNode(editor, 1, 1).attrs.color).toBe(null);
    expect(setTableColor(editor, "not-a-colour")).toBe(false);
  });

  test("insert above, below, left and right", () => {
    const editor = createEditor();
    selectTableLine(editor, TABLE, "row", 0);
    insertTableLine(editor, "row", "before");
    expect(text(editor)[0]).toEqual(["", "", ""]);
    expect(text(editor)[1]).toEqual(["a", "b", "c"]);
    selectTableLine(editor, TABLE, "column", 2);
    insertTableLine(editor, "column", "after");
    expect(text(editor)[1]).toEqual(["a", "b", "c", ""]);
  });

  test("duplicate puts a copy right after the row or column", () => {
    const editor = createEditor();
    selectTableLine(editor, TABLE, "row", 1);
    duplicateTableLines(editor, "row");
    expect(text(editor).map((row) => row[0])).toEqual(["a", "d", "d", "g"]);
    selectTableLine(editor, TABLE, "column", 0);
    duplicateTableLines(editor, "column");
    expect(text(editor)[0]).toEqual(["a", "a", "b", "c"]);
    expect(text(editor)[3]).toEqual(["g", "g", "h", "i"]);
  });

  test("clear contents empties the cells and keeps the table", () => {
    const editor = createEditor();
    selectTableLine(editor, TABLE, "row", 2);
    clearTableCells(editor);
    expect(text(editor)).toEqual([["a", "b", "c"], ["d", "e", "f"], ["", "", ""]]);
    putCursorIn(editor, 0, 0);
    clearTableCells(editor);
    expect(text(editor)[0]).toEqual(["", "b", "c"]);
  });

  test("delete removes rows and columns, and the table with the last one", () => {
    const editor = createEditor();
    selectTableLine(editor, TABLE, "column", 1);
    deleteTableLines(editor, "column");
    expect(text(editor)).toEqual([["a", "c"], ["d", "f"], ["g", "i"]]);
    selectTableLine(editor, TABLE, "row", 0);
    deleteTableLines(editor, "row");
    expect(text(editor)).toEqual([["d", "f"], ["g", "i"]]);
    const all = createEditor([["only"]]);
    selectTableLine(all, TABLE, "row", 0);
    deleteTableLines(all, "row");
    expect(all.state.doc.firstChild.type.name).not.toBe("table");
  });

  test("merge keeps the top-left cell's content, and unmerge splits it again", () => {
    const editor = createEditor();
    const anchor = editor.state.doc.resolve(cellPos(editor, 0, 0));
    const head = editor.state.doc.resolve(cellPos(editor, 1, 1));
    editor.view.dispatch(editor.state.tr.setSelection(new CellSelection(anchor, head)));
    expect(describeTableSelection(editor.state).cellCount).toBe(4);
    expect(mergeTableCells(editor)).toBe(true);
    const merged = cellNode(editor, 0, 0);
    expect([merged.attrs.colspan, merged.attrs.rowspan]).toEqual([2, 2]);
    expect(merged.textContent).toBe("a");
    expect(describeTableSelection(editor.state).merged).toBe(true);
    // One undo brings back all four cells.
    editor.commands.undo();
    expect(text(editor)[1]).toEqual(["d", "e", "f"]);
    editor.commands.redo();
    selectTableCell(editor, cellPos(editor, 0, 0));
    unmergeTableCells(editor);
    expect(cellNode(editor, 0, 0).attrs.colspan).toBe(1);
    expect(text(editor)[0]).toEqual(["a", "", "c"]);
  });

  test("dragging a handle moves the row or column", () => {
    const editor = createEditor();
    moveTableLine(editor, TABLE, "row", 0, 2);
    expect(text(editor).map((row) => row[0])).toEqual(["d", "g", "a"]);
    moveTableLine(editor, TABLE, "column", 2, 0);
    expect(text(editor)[0]).toEqual(["f", "d", "e"]);
  });

  test("the + bars add at the end, and the corner drag takes back only empty lines", () => {
    const editor = createEditor();
    appendTableLine(editor, TABLE, "row", 2);
    appendTableLine(editor, TABLE, "column");
    expect(text(editor).length).toBe(5);
    expect(text(editor)[0].length).toBe(4);
    expect(lastLineIsEmpty(editor.state, TABLE, "row")).toBe(true);
    expect(removeEmptyTrailingLines(editor, TABLE, "row", 5)).toBe(2);
    expect(removeEmptyTrailingLines(editor, TABLE, "column", 5)).toBe(1);
    expect(text(editor)).toEqual([["a", "b", "c"], ["d", "e", "f"], ["g", "h", "i"]]);
  });

  test("Tab in the last cell adds a row", () => {
    const editor = createEditor([["a", "b"]]);
    putCursorIn(editor, 0, 1);
    const key = (name) => ({ key: name, keyCode: 9, shiftKey: false, altKey: false, ctrlKey: false, metaKey: false, preventDefault() {} });
    // Headless editors have no view to press keys in; run the keymaps directly.
    const handled = editor.state.plugins.some((plugin) => plugin.props.handleKeyDown?.call(plugin, editor.view, key("Tab")));
    expect(handled).toBe(true);
    expect(text(editor).length).toBe(2);
  });

  test("fit to width scales the columns to the page and keeps their proportions", () => {
    const editor = createEditor([["a", "b"]]);
    editor.view.dispatch(editor.state.tr.setNodeAttribute(cellPos(editor, 0, 0), "colwidth", [100]));
    editor.view.dispatch(editor.state.tr.setNodeAttribute(cellPos(editor, 0, 1), "colwidth", [300]));
    expect(fitTableToWidth(editor, TABLE, 720)).toBe(true);
    expect([cellNode(editor, 0, 0).attrs.colwidth, cellNode(editor, 0, 1).attrs.colwidth]).toEqual([[180], [540]]);
    // The widths are plain column widths, which Markdown already keeps.
    const back = markdownToDoc(docToMarkdown(editor.getJSON()));
    expect(back.content[0].content[0].content.map((c) => c.attrs.colwidth)).toEqual([[180], [540]]);
  });

  test("fit to width never makes a column narrower than the minimum", () => {
    const editor = createEditor([["a", "b", "c"]]);
    editor.view.dispatch(editor.state.tr.setNodeAttribute(cellPos(editor, 0, 0), "colwidth", [2000]));
    fitTableToWidth(editor, TABLE, 400);
    const widths = [0, 1, 2].map((col) => cellNode(editor, 0, col).attrs.colwidth[0]);
    expect(Math.min(...widths)).toBeGreaterThanOrEqual(32);
  });

  test("the block menu selects the whole table, and closing it puts the cursor back", () => {
    const editor = createEditor();
    expect(selectWholeTable(editor, TABLE)).toBe(true);
    const described = describeTableSelection(editor.state);
    expect(described.wholeRows && described.wholeColumns).toBe(true);
    expect(releaseTable(editor, TABLE)).toBe(true);
    expect(editor.state.selection instanceof CellSelection).toBe(false);
    expect(editor.state.selection.from).toBe(cellPos(editor, 0, 0) + 2);
    // A selection the user changed meanwhile is left alone.
    selectTableLine(editor, TABLE, "row", 1);
    expect(releaseTable(editor, TABLE)).toBe(false);
  });

  test("duplicating a row keeps its colour", () => {
    const editor = createEditor();
    selectTableLine(editor, TABLE, "row", 0);
    setTableColor(editor, "red_background");
    selectTableLine(editor, TABLE, "row", 0);
    duplicateTableLines(editor, "row");
    expect([0, 1, 2].map((col) => cellNode(editor, 1, col).attrs.color)).toEqual(["red_background", "red_background", "red_background"]);
  });

  test("turn into database uses the header row as property names", () => {
    const editor = createEditor([["Name", "Role", "Role"], ["Ada", "Engineer", "x"], ["", "", ""]]);
    toggleTableHeader(editor, TABLE, "row");
    const result = tableToDatabase(editor.state.doc.nodeAt(TABLE), (index) => `Column ${index + 1}`);
    expect(result.columns).toEqual(["Name", "Role", "Role 2"]);
    expect(result.rows).toEqual([["Ada", "Engineer", "x"], ["", "", ""]]);
    const plain = tableToDatabase(createEditor([["", "b"]]).state.doc.nodeAt(TABLE), (index) => `Column ${index + 1}`);
    expect(plain.columns).toEqual(["Column 1", "Column 2"]);
    expect(plain.rows).toEqual([["", "b"]]);
  });

  test("turn into database keeps maths, attachments and line breaks as they read", () => {
    ensureTestWindowDom();
    const editor = new Editor({ extensions: createPonderDocumentExtensions({ mathematics: createPonderMathematics() }), content: {
      type: "doc",
      content: [{ type: "table", content: [{ type: "tableRow", content: [
        { type: "tableCell", content: [{ type: "paragraph", content: [{ type: "text", text: "x = " }, { type: "inlineMath", attrs: { latex: "a^2" } }] }] },
        { type: "tableCell", content: [{ type: "paragraph", content: [{ type: "text", text: "one" }, { type: "hardBreak" }, { type: "text", text: "two" }] }] },
        { type: "tableCell", content: [{ type: "paragraph", content: [{ type: "ponderFileAttachment", attrs: { url: "/f/1", label: "Report.pdf", filename: "report.pdf" } }] }] },
      ] }] }],
    } });
    const result = tableToDatabase(editor.state.doc.nodeAt(TABLE), (index) => `Column ${index + 1}`);
    expect(result.rows).toEqual([["x = a^2", "one\ntwo", "Report.pdf"]]);
  });

  test("an AI edit through Markdown keeps colours, widths and merges made with these actions", () => {
    const editor = createEditor();
    toggleTableHeader(editor, TABLE, "column");
    selectTableLine(editor, TABLE, "row", 2);
    setTableColor(editor, "red");
    const anchor = editor.state.doc.resolve(cellPos(editor, 0, 1));
    const head = editor.state.doc.resolve(cellPos(editor, 0, 2));
    editor.view.dispatch(editor.state.tr.setSelection(new CellSelection(anchor, head)));
    mergeTableCells(editor);
    editor.view.dispatch(editor.state.tr.setNodeAttribute(cellPos(editor, 1, 0), "colwidth", [240]));
    const before = editor.getJSON();
    // update_memo: the AI reads Markdown, appends a line, and the server parses it back.
    const markdown = `${docToMarkdown(before)}\n\nA new paragraph from the AI.`;
    const after = markdownToDoc(markdown);
    const strip = (table) => JSON.stringify(table.content.map((row) => row.content.map((c) => [c.type, c.attrs?.colspan ?? 1, c.attrs?.rowspan ?? 1, c.attrs?.colwidth ?? null, c.attrs?.color ?? null])));
    expect(strip(after.content[0])).toBe(strip(before.content[0]));
    expect(after.content.at(-1).content[0].text).toBe("A new paragraph from the AI.");
  });
});

/*
 * Copy and paste as tab-separated text. The cases follow AppFlowy-Web's simple-table copy and paste
 * specs (https://github.com/AppFlowy-IO/AppFlowy-Web, Copyright AppFlowy, AGPL-3.0), limited to
 * what Notion also does.
 */
describe("table copy and paste", () => {
  const pasteEvent = (plain, html = "") => ({
    clipboardData: { getData: (type) => (type === "text/plain" ? plain : type === "text/html" ? html : "") },
    preventDefault() {},
  });
  const paste = (editor, plain, html) => tableClipboardKey.get(editor.state).props.handlePaste(editor.view, pasteEvent(plain, html));

  test("parseTsv reads spreadsheet text and ignores text with no tabs", () => {
    expect(parseTsv("a\tb\r\nc\td\n")).toEqual([["a", "b"], ["c", "d"]]);
    expect(parseTsv("just a line")).toBe(null);
  });

  test("copying cells gives tabs between cells and new lines between rows", () => {
    const editor = createEditor();
    const anchor = editor.state.doc.resolve(cellPos(editor, 0, 0));
    const head = editor.state.doc.resolve(cellPos(editor, 1, 1));
    expect(cellSelectionToTsv(new CellSelection(anchor, head))).toBe("a\tb\nd\te");
  });

  test("a merged cell is copied once", () => {
    const editor = createEditor();
    const anchor = editor.state.doc.resolve(cellPos(editor, 0, 0));
    editor.view.dispatch(editor.state.tr.setSelection(new CellSelection(anchor, editor.state.doc.resolve(cellPos(editor, 0, 1)))));
    mergeTableCells(editor);
    const all = new CellSelection(editor.state.doc.resolve(cellPos(editor, 0, 0)), editor.state.doc.resolve(cellPos(editor, 1, 2)));
    expect(cellSelectionToTsv(all)).toBe("a\tc\nd\te\tf");
  });

  test("pasting tab-separated text fills cells from the cursor and grows the table", () => {
    const editor = createEditor([["a", "b"], ["c", "d"]]);
    putCursorIn(editor, 1, 1);
    expect(paste(editor, "1\t2\n3\t4")).toBe(true);
    expect(text(editor)).toEqual([["a", "b", ""], ["c", "1", "2"], ["", "3", "4"]]);
  });

  test("plain text and pasted HTML tables go to the normal paste", () => {
    const editor = createEditor();
    putCursorIn(editor, 0, 0);
    expect(paste(editor, "no tabs here")).toBe(false);
    expect(paste(editor, "1\t2", "<table><tr><td>1</td><td>2</td></tr></table>")).toBe(false);
    editor.commands.setTextSelection(editor.state.doc.content.size - 1);
    expect(paste(editor, "1\t2")).toBe(false);
  });
});
