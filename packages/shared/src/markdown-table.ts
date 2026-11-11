import { Extension, getTextBetween, getTextSerializersFromSchema, type Node as TiptapNode, type JSONContent, type MarkdownRendererHelpers, type MarkdownToken } from "@tiptap/core";
import { TableKit, TableView, renderTableToMarkdown } from "@tiptap/extension-table";
import { Fragment, Slice, type Node as ProseMirrorNode } from "@tiptap/pm/model";
import type { EditorView } from "@tiptap/pm/view";
import { Plugin, PluginKey, TextSelection } from "@tiptap/pm/state";
import { CellSelection, TableMap, columnResizing, columnResizingPluginKey, handlePaste, isInTable } from "@tiptap/pm/tables";
import { isPageColor } from "./page-color";
import { openBlockSource } from "./markdown-block-start";

// GFM cells use <br> for line breaks, including our own table serializer.
// Recognize only this attribute-free token inside cells; arbitrary HTML and
// literal tags inside text/code keep the normal Markdown safety boundary.
const cellTokens = (tokens: MarkdownToken[]): MarkdownToken[] => tokens.map((token) =>
  token.type === "html" && /^<br\s*\/?>$/i.test(token.raw || "")
    ? { type: "br", raw: token.raw }
    : token.tokens ? { ...token, tokens: cellTokens(token.tokens) } : token,
);

/**
 * Width of a column nobody has resized. Notion's new 3 × 3 table spans its 720px page: each
 * column is (720 - 1) / 3, so the table and its outer border fit without a scrollbar. A fourth
 * column makes the table wider than the page, as in Notion.
 */
export const TABLE_DEFAULT_COLUMN_WIDTH = 719 / 3;
export const TABLE_MIN_COLUMN_WIDTH = 32;

const HTML_TABLE_TOKEN = "ponderHtmlTable";

type HtmlTableCellToken = {
  header: boolean;
  colspan: number;
  rowspan: number;
  colwidth: number[] | null;
  color: string | null;
  align: string | null;
  tokens: MarkdownToken[];
};

type HtmlTableToken = MarkdownToken & {
  fitWidth: boolean;
  rows: HtmlTableCellToken[][];
};

const escapeAttr = (value: string) =>
  value.replace(/&/g, "&amp;").replace(/"/g, "&quot;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

const readAttr = (attrs: string, name: string): string | null => {
  const match = new RegExp(`(?:^|\\s)${name}\\s*=\\s*(?:"([^"]*)"|'([^']*)'|([^\\s"'>]+))`, "i").exec(attrs);
  if (!match) return null;
  return (match[1] ?? match[2] ?? match[3] ?? "")
    .replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, "\"").replace(/&amp;/g, "&");
};

const positiveInt = (value: string | null, fallback: number, max: number) => {
  const parsed = Number.parseInt(value ?? "", 10);
  return Number.isFinite(parsed) && parsed >= 1 ? Math.min(parsed, max) : fallback;
};

const parseWidths = (value: string | null): number[] | null => {
  if (!value) return null;
  const widths = value.split(",").map((part) => Number.parseInt(part.trim(), 10));
  return widths.every((width) => Number.isFinite(width) && width > 0) ? widths.map((width) => Math.min(width, 4000)) : null;
};

/**
 * Cells with a colour, a merge or a width, a header column, or a "fit to page width" table can't
 * be written as GFM. Those tables are written as an HTML table instead, so an edit made through
 * Markdown (AI chat, MCP, imports) keeps them. Plain tables stay GFM.
 */
export const tableNeedsHtml = (table: JSONContent): boolean => {
  if (table.attrs?.fitWidth) return true;
  const rows = table.content ?? [];
  let firstRowAllHeaders = true;
  let firstRowHasText = false;
  let headerElsewhere = false;
  let anyHeader = false;
  for (const [rowIndex, row] of rows.entries()) {
    for (const cell of row.content ?? []) {
      const attrs = cell.attrs ?? {};
      if ((attrs.colspan ?? 1) > 1 || (attrs.rowspan ?? 1) > 1) return true;
      if (Array.isArray(attrs.colwidth) && attrs.colwidth.some(Boolean)) return true;
      if (isPageColor(attrs.color)) return true;
      const header = cell.type === "tableHeader";
      anyHeader ||= header;
      if (rowIndex === 0) {
        if (!header) firstRowAllHeaders = false;
        if (cellHasText(cell)) firstRowHasText = true;
      } else if (header) {
        headerElsewhere = true;
      }
    }
  }
  if (!anyHeader) return false;
  // GFM can say "the first row is the header" and nothing else. An empty header row would read
  // back as no header at all, so it goes out as HTML too.
  return headerElsewhere || !firstRowAllHeaders || !firstRowHasText;
};

const TEXT_CONTAINERS = new Set(["paragraph", "tableCell", "tableHeader", "text", "hardBreak"]);

/** Text, or anything that isn't plain text (an image, an equation). */
const cellHasText = (node: JSONContent): boolean =>
  (typeof node.text === "string" && node.text.trim() !== "")
  || (!TEXT_CONTAINERS.has(node.type ?? "") && !node.content?.length)
  || (node.content ?? []).some(cellHasText);

/** One line per cell; line breaks inside a cell are <br>, as in the GFM form. */
const renderCellInline = (cell: JSONContent, h: MarkdownRendererHelpers) => {
  const children = cell.content ?? [];
  const raw = children.length > 1
    ? children.map((child) => h.renderChildren(child as JSONContent)).join("\n")
    : children.length ? h.renderChildren(children as JSONContent[]) : "";
  return raw
    .replace(/[ \t]*\r?\n[ \t]*/g, "<br>")
    .replace(/<\/(td|th|tr|table)\s*>/gi, (match) => match.replace("<", "&lt;"))
    .trim();
};

export const renderHtmlTableMarkdown = (table: JSONContent, h: MarkdownRendererHelpers) => {
  const lines = [table.attrs?.fitWidth ? `<table data-fit-width="true">` : "<table>"];
  for (const row of table.content ?? []) {
    lines.push("<tr>");
    for (const cell of row.content ?? []) {
      const tag = cell.type === "tableHeader" ? "th" : "td";
      const attrs = cell.attrs ?? {};
      const parts: string[] = [];
      if ((attrs.colspan ?? 1) > 1) parts.push(`colspan="${attrs.colspan}"`);
      if ((attrs.rowspan ?? 1) > 1) parts.push(`rowspan="${attrs.rowspan}"`);
      if (Array.isArray(attrs.colwidth) && attrs.colwidth.some(Boolean)) {
        parts.push(`colwidth="${attrs.colwidth.map((width: unknown) => Number(width) || 0).join(",")}"`);
      }
      if (isPageColor(attrs.color)) parts.push(`data-color="${escapeAttr(attrs.color)}"`);
      if (typeof attrs.align === "string" && attrs.align) parts.push(`align="${escapeAttr(attrs.align)}"`);
      lines.push(`<${tag}${parts.length ? ` ${parts.join(" ")}` : ""}>${renderCellInline(cell, h)}</${tag}>`);
    }
    lines.push("</tr>");
  }
  lines.push("</table>");
  return `\n${lines.join("\n")}\n`;
};

const TABLE_OPEN = /^ {0,3}<table\b([^>]*)>/i;
const ROW_PATTERN = /<tr\b[^>]*>([\s\S]*?)<\/tr\s*>/gi;
const CELL_PATTERN = /<(td|th)\b([^>]*)>([\s\S]*?)<\/\1\s*>/gi;

/** Reads `<table>…</table>` written by renderHtmlTableMarkdown, or a plain HTML table an AI wrote. */
export const tokenizeHtmlTable = (
  source: string,
  inlineTokens: (text: string) => MarkdownToken[],
): HtmlTableToken | undefined => {
  const open = TABLE_OPEN.exec(source);
  if (!open) return undefined;
  const closeIndex = source.search(/<\/table\s*>/i);
  if (closeIndex < 0) return undefined;
  const close = /<\/table\s*>/i.exec(source.slice(closeIndex))!;
  const end = closeIndex + close[0].length;
  const inner = source.slice(open[0].length, closeIndex);
  // A nested table would close early; leave anything that unusual to the HTML fallback.
  if (/<table\b/i.test(inner)) return undefined;
  const rows: HtmlTableCellToken[][] = [];
  for (const rowMatch of inner.matchAll(ROW_PATTERN)) {
    const cells: HtmlTableCellToken[] = [];
    for (const cellMatch of rowMatch[1].matchAll(CELL_PATTERN)) {
      const attrs = cellMatch[2];
      const color = readAttr(attrs, "data-color");
      const content = cellMatch[3].replace(/\r?\n/g, " ").trim();
      cells.push({
        header: cellMatch[1].toLowerCase() === "th",
        colspan: positiveInt(readAttr(attrs, "colspan"), 1, 100),
        rowspan: positiveInt(readAttr(attrs, "rowspan"), 1, 1000),
        colwidth: parseWidths(readAttr(attrs, "colwidth")),
        color: isPageColor(color) ? color : null,
        align: readAttr(attrs, "align"),
        tokens: content ? inlineTokens(content) : [],
      });
    }
    if (cells.length) rows.push(cells);
  }
  if (!rows.length) return undefined;
  const trailing = /^[ \t]*\n?/.exec(source.slice(end))?.[0] ?? "";
  return {
    type: HTML_TABLE_TOKEN,
    raw: source.slice(0, end) + trailing,
    fitWidth: readAttr(open[1], "data-fit-width") === "true",
    rows,
  };
};

/** The HTML form has its own reader; it isn't a node, so it adds nothing to the schema. */
const HtmlTableMarkdown = Extension.create({
  name: HTML_TABLE_TOKEN,
  markdownTokenName: HTML_TABLE_TOKEN,
  markdownTokenizer: {
    name: HTML_TABLE_TOKEN,
    level: "block",
    start: (source: string) => {
      const index = openBlockSource(source).search(/(^|\n) {0,3}<table\b/i);
      return index < 0 ? -1 : index + (source[index] === "\n" ? 1 : 0);
    },
    tokenize: (source: string, _tokens: MarkdownToken[], lexer: { inlineTokens: (text: string) => MarkdownToken[] }) =>
      tokenizeHtmlTable(source, (text) => lexer.inlineTokens(text)),
  },
  parseMarkdown: (token: MarkdownToken, h) => {
    const table = token as HtmlTableToken;
    const rows = table.rows.map((cells) => h.createNode("tableRow", {}, cells.map((cell) => {
      const attrs: Record<string, unknown> = {};
      if (cell.colspan > 1) attrs.colspan = cell.colspan;
      if (cell.rowspan > 1) attrs.rowspan = cell.rowspan;
      if (cell.colwidth) attrs.colwidth = cell.colwidth;
      if (cell.color) attrs.color = cell.color;
      if (cell.align === "left" || cell.align === "right" || cell.align === "center") attrs.align = cell.align;
      return h.createNode(cell.header ? "tableHeader" : "tableCell", attrs, [
        { type: "paragraph", content: h.parseInline(cellTokens(cell.tokens)) },
      ]);
    })));
    return h.createNode("table", table.fitWidth ? { fitWidth: true } : {}, rows);
  },
} as Parameters<typeof Extension.create>[0]);

const colorAttribute = {
  default: null,
  parseHTML: (element: HTMLElement) => {
    const value = element.getAttribute("data-color");
    return isPageColor(value) ? value : null;
  },
  renderHTML: (attributes: Record<string, unknown>) =>
    isPageColor(attributes.color) ? { "data-color": attributes.color } : {},
};

/** The editor's table: TipTap's view plus the "fit to page width" switch on its wrapper. */
export class PonderTableView extends TableView {
  constructor(node: ProseMirrorNode, cellMinWidth: number, view?: EditorView, HTMLAttributes: Record<string, unknown> = {}) {
    super(node, cellMinWidth, view, HTMLAttributes);
    this.dom.classList.add("ponder-table");
    this.applyAttributes(node);
  }

  /** Columns nobody has resized are Notion's default width, so a new table fits its content. */
  private applyAttributes(node: ProseMirrorNode) {
    const fit = Boolean(node.attrs.fitWidth);
    this.dom.toggleAttribute("data-fit-width", fit);
    let total = 0;
    for (const col of Array.from(this.colgroup.children) as HTMLTableColElement[]) {
      if (!col.style.width) {
        col.style.removeProperty("min-width");
        col.style.width = `${TABLE_DEFAULT_COLUMN_WIDTH}px`;
      }
      total += Number.parseFloat(col.style.width) || TABLE_DEFAULT_COLUMN_WIDTH;
    }
    this.table.style.minWidth = "";
    this.table.style.width = fit ? "100%" : `${total}px`;
  }

  override update(node: ProseMirrorNode) {
    if (!super.update(node)) return false;
    this.applyAttributes(node);
    return true;
  }
}

/*
 * Tab-separated clipboard text for tables.
 * Adapted from AppFlowy-Web (https://github.com/AppFlowy-IO/AppFlowy-Web), Copyright AppFlowy, AGPL-3.0:
 * the TSV handling in src/components/editor/plugins/withCopy.ts and withPasted.ts.
 */

/*
 * Inline nodes keep the value they show, as AppFlowy-Web's table conversions do (adapted from
 * AppFlowy-Web (https://github.com/AppFlowy-IO/AppFlowy-Web), Copyright AppFlowy, AGPL-3.0:
 * SimpleTable.convert.ts). Maths keeps its formula and an attachment its name.
 */
const inlineLeafText = ({ node }: { node: ProseMirrorNode }) => {
  const attrs = node.attrs as Record<string, unknown>;
  const value = [attrs.latex, attrs.label, attrs.filename, attrs.title, attrs.href].find((item) => typeof item === "string" && item);
  return (value as string | undefined) ?? "";
};

const cellSerializers = new WeakMap<object, ReturnType<typeof getTextSerializersFromSchema>>();
const serializersFor = (schema: ProseMirrorNode["type"]["schema"]) => {
  let found = cellSerializers.get(schema);
  if (!found) {
    found = getTextSerializersFromSchema(schema);
    for (const type of Object.values(schema.nodes)) {
      if (type.isInline && type.isLeaf && !type.isText && !found[type.name]) found[type.name] = inlineLeafText;
    }
    cellSerializers.set(schema, found);
  }
  return found;
};

/** A cell's text as it reads on screen: maths, attachments and line breaks keep their own text. */
export const tableCellText = (cell: ProseMirrorNode) =>
  getTextBetween(cell, { from: 0, to: cell.content.size }, {
    blockSeparator: "\n",
    textSerializers: serializersFor(cell.type.schema),
  }).trim();

/** The selected cells as text: cells joined by tabs, rows by new lines. A merged cell counts once. */
export const cellSelectionToTsv = (selection: CellSelection) => {
  const table = selection.$anchorCell.node(-1);
  const tableStart = selection.$anchorCell.start(-1);
  const map = TableMap.get(table);
  const rect = map.rectBetween(selection.$anchorCell.pos - tableStart, selection.$headCell.pos - tableStart);
  const seen = new Set<number>();
  const rows: string[] = [];
  for (let row = rect.top; row < rect.bottom; row++) {
    const cells: string[] = [];
    for (let col = rect.left; col < rect.right; col++) {
      const pos = map.map[row * map.width + col];
      if (seen.has(pos)) continue;
      seen.add(pos);
      const cell = table.nodeAt(pos);
      cells.push(cell ? tableCellText(cell).replace(/[\t\n]+/g, " ") : "");
    }
    if (cells.length) rows.push(cells.join("\t"));
  }
  return rows.join("\n");
};

/** Rows of values from tab-separated text, as spreadsheets and other tables copy it. */
export const parseTsv = (text: string): string[][] | null => {
  if (!text.includes("\t")) return null;
  const lines = text.replace(/\r\n?/g, "\n").replace(/\n+$/, "").split("\n");
  return lines.map((line) => line.split("\t").map((value) => value.trim()));
};

const tsvToTable = (view: EditorView, rows: string[][]) => {
  const { table, tableRow, tableCell, paragraph } = view.state.schema.nodes;
  if (!table || !tableRow || !tableCell || !paragraph) return null;
  const width = Math.max(...rows.map((row) => row.length));
  return table.create(null, rows.map((row) => tableRow.create(null, Array.from({ length: width }, (_, index) => {
    const value = row[index] ?? "";
    return tableCell.create(null, paragraph.create(null, value ? view.state.schema.text(value) : null));
  }))));
};

export const tableClipboardKey = new PluginKey("ponderTableClipboard");

/**
 * Copying cells gives tab-separated text, and pasting tab-separated text into a cell fills the
 * cells from there, adding rows and columns when it runs past the edge (as pasting copied cells
 * already does). Rich pastes that carry an HTML table keep the normal path.
 */
export const TableClipboard = Extension.create({
  name: "ponderTableClipboard",
  priority: 1000,
  addProseMirrorPlugins() {
    return [new Plugin({
      key: tableClipboardKey,
      props: {
        clipboardTextSerializer: (_slice, view) =>
          // An empty string lets the next serializer handle selections that aren't cells.
          view.state.selection instanceof CellSelection ? cellSelectionToTsv(view.state.selection) : "",
        handlePaste: (view, event) => {
          if (!view.editable || !isInTable(view.state)) return false;
          const html = event.clipboardData?.getData("text/html") ?? "";
          if (/<table[\s>]/i.test(html)) return false;
          const rows = parseTsv(event.clipboardData?.getData("text/plain") ?? "");
          if (!rows) return false;
          const node = tsvToTable(view, rows);
          if (!node) return false;
          return handlePaste(view, event, new Slice(Fragment.from(node), 0, 0));
        },
      },
    })];
  },
});

export const PonderTableKit = TableKit.extend({
  addExtensions() {
    const extensions = (this.parent?.() ?? []).map((extension) => {
      if (extension.name === "tableCell" || extension.name === "tableHeader") {
        return (extension as TiptapNode).extend({
          addAttributes() {
            return { ...this.parent?.(), color: colorAttribute };
          },
        });
      }
      if (extension.name !== "table") return extension;
      const parseMarkdown = extension.config.parseMarkdown!;
      return (extension as TiptapNode).extend({
        addOptions() {
          return { ...this.parent?.(), View: PonderTableView, cellMinWidth: TABLE_MIN_COLUMN_WIDTH };
        },
        addAttributes() {
          return {
            ...this.parent?.(),
            fitWidth: {
              default: false,
              parseHTML: (element: HTMLElement) => element.getAttribute("data-fit-width") === "true",
              renderHTML: (attributes: Record<string, unknown>) => (attributes.fitWidth ? { "data-fit-width": "true" } : {}),
            },
          };
        },
        // TipTap uses one number for the narrowest a column can be dragged and for the width of a
        // column nobody has sized. Notion's are 32px and 120px.
        addProseMirrorPlugins() {
          const plugins = (this.parent?.() ?? []).filter((plugin) => plugin.spec.key !== columnResizingPluginKey);
          // TipTap adds resizing only if the editor is editable when it's built. Ponder builds its
          // editor read-only while a page loads, so add it anyway; it ignores events while read-only.
          if (!this.options.resizable) return plugins;
          return [columnResizing({
            handleWidth: this.options.handleWidth,
            cellMinWidth: TABLE_MIN_COLUMN_WIDTH,
            defaultCellMinWidth: TABLE_DEFAULT_COLUMN_WIDTH,
            View: this.options.View as never,
            lastColumnResizable: true,
          }), ...plugins];
        },
        parseMarkdown(token, helpers) {
          const cell = (value: { tokens: MarkdownToken[] }) => ({ ...value, tokens: cellTokens(value.tokens) });
          // Our serializer writes a table with no header row as GFM with an empty header line.
          const emptyHeader = Array.isArray(token.header)
            && token.header.every((value: { tokens: MarkdownToken[] }) => !value.tokens.length);
          return parseMarkdown.call(this, {
            ...token,
            header: emptyHeader ? undefined : token.header?.map(cell),
            rows: token.rows?.map((row: Array<{ tokens: MarkdownToken[] }>) => row.map(cell)),
          }, helpers);
        },
        renderMarkdown(node, helpers) {
          return tableNeedsHtml(node) ? renderHtmlTableMarkdown(node, helpers) : renderTableToMarkdown(node, helpers);
        },
        addKeyboardShortcuts() {
          return {
            ...this.parent?.(),
            // Notion: Enter starts a new line inside the cell rather than a new paragraph.
            Enter: () => {
              const { $from, empty } = this.editor.state.selection;
              if (!empty || $from.parent.type.name !== "paragraph" || $from.depth < 2) return false;
              const role = $from.node(-1).type.spec.tableRole;
              if (role !== "cell" && role !== "header_cell") return false;
              return this.editor.commands.setHardBreak();
            },
          };
        },
        addCommands() {
          const parent = this.parent?.() ?? {};
          return {
            ...parent,
            // Notion's /table: three by three, no header row, each column a fixed width so the
            // table fits its content instead of the page.
            insertTable: ({ rows = 3, cols = 3 } = {}) => ({ tr, dispatch, editor }) => {
              const { tableCell, tableRow, table, paragraph } = editor.schema.nodes;
              const cell = () => tableCell.create(null, paragraph.create());
              const node = table.create(null, Array.from({ length: rows }, () =>
                tableRow.create(null, Array.from({ length: cols }, cell))));
              if (dispatch) {
                const offset = tr.selection.from + 1;
                tr.replaceSelectionWith(node).scrollIntoView().setSelection(TextSelection.near(tr.doc.resolve(offset)));
              }
              return true;
            },
          };
        },
      });
    });
    return [...extensions, HtmlTableMarkdown, TableClipboard];
  },
});
