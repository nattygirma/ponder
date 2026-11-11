import { describe, expect, test } from "bun:test";
import { docToMarkdown, markdownToDoc } from "./content.ts";
import { tableNeedsHtml } from "./markdown-table.ts";

const p = (text) => ({ type: "paragraph", content: text ? [{ type: "text", text }] : [] });
const cell = (text, attrs = {}) => ({ type: "tableCell", attrs: { colspan: 1, rowspan: 1, colwidth: null, ...attrs }, content: [p(text)] });
const head = (text, attrs = {}) => ({ ...cell(text, attrs), type: "tableHeader" });
const row = (...cells) => ({ type: "tableRow", content: cells });
const table = (rows, attrs = {}) => ({ type: "table", attrs, content: rows });
const doc = (...content) => ({ type: "doc", content });

/** What an AI edit does: read the page as Markdown, write Markdown back, parse it. */
const roundTrip = (value) => markdownToDoc(docToMarkdown(value));

const tableOf = (value) => value.content.find((node) => node.type === "table");
const shape = (value) => tableOf(value).content.map((r) => r.content.map((c) => ({
  type: c.type,
  text: (c.content?.[0]?.content ?? []).map((n) => n.text ?? (n.type === "hardBreak" ? "\n" : "")).join(""),
  colspan: c.attrs?.colspan ?? 1,
  rowspan: c.attrs?.rowspan ?? 1,
  colwidth: c.attrs?.colwidth ?? null,
  color: c.attrs?.color ?? null,
})));

describe("simple table Markdown", () => {
  test("a plain table with a header row stays GFM", () => {
    const value = doc(table([row(head("Name"), head("Role")), row(cell("Ada"), cell("Engineer"))]));
    const markdown = docToMarkdown(value);
    expect(markdown).toContain("| Name");
    expect(markdown).not.toContain("<table");
    expect(shape(roundTrip(value))).toEqual(shape(value));
  });

  test("a table with no header row stays GFM and comes back without a header", () => {
    const value = doc(table([row(cell("a"), cell("b")), row(cell("c"), cell("d"))]));
    const markdown = docToMarkdown(value);
    expect(markdown).not.toContain("<table");
    const back = shape(roundTrip(value));
    expect(back.length).toBe(2);
    expect(back.flat().every((c) => c.type === "tableCell")).toBe(true);
    expect(back.map((r) => r.map((c) => c.text))).toEqual([["a", "b"], ["c", "d"]]);
  });

  test("colours, widths, merges and a header column survive a Markdown edit", () => {
    const value = doc(table([
      row(head("Item", { colwidth: [200] }), head("Q1", { colwidth: [90], color: "blue_background" }), head("Q2")),
      row(head("Apples", { colwidth: [200] }), cell("merged ", { colspan: 2, color: "red" })),
      row(head("Pears", { colwidth: [200], rowspan: 1 }), cell("line 1\nline 2"), cell("", { color: "green_background" })),
    ]));
    tableOf(value).content[1].content[1].content[0].content.push({ type: "text", text: "bold", marks: [{ type: "bold" }] });
    // A hard break inside a cell.
    tableOf(value).content[2].content[1].content[0] = { type: "paragraph", content: [{ type: "text", text: "line 1" }, { type: "hardBreak" }, { type: "text", text: "line 2" }] };
    const markdown = docToMarkdown(value);
    expect(markdown).toContain("<table>");
    expect(markdown).toContain(`<td colspan="2" data-color="red">merged **bold**</td>`);
    expect(markdown).toContain(`<th colwidth="90" data-color="blue_background">Q1</th>`);
    const back = roundTrip(value);
    expect(shape(back)).toEqual(shape(value));
    // Bold text inside the merged cell is still bold.
    const merged = tableOf(back).content[1].content[1].content[0].content;
    expect(merged.some((n) => n.text === "bold" && n.marks?.[0]?.type === "bold")).toBe(true);
    // And a second round trip is stable.
    expect(docToMarkdown(back)).toBe(markdown);
  });

  test("fit to page width survives", () => {
    const value = doc(table([row(cell("a"), cell("b"))], { fitWidth: true }));
    expect(docToMarkdown(value)).toContain(`<table data-fit-width="true">`);
    expect(tableOf(roundTrip(value)).attrs.fitWidth).toBe(true);
  });

  test("an empty header row keeps its row", () => {
    const value = doc(table([row(head(""), head("")), row(cell("a"), cell("b"))]));
    expect(tableNeedsHtml(tableOf(value))).toBe(true);
    expect(shape(roundTrip(value))).toEqual(shape(value));
  });

  test("text around an HTML table is kept, and an AI's own HTML table is read", () => {
    const markdown = [
      "Before",
      "",
      "<table>",
      "<thead><tr><th>Name</th><th>Score</th></tr></thead>",
      "<tbody><tr><td data-color='yellow_background'>Ada</td><td>10</td></tr></tbody>",
      "</table>",
      "",
      "After",
    ].join("\n");
    const value = markdownToDoc(markdown);
    expect(value.content.map((node) => node.type)).toEqual(["paragraph", "table", "paragraph"]);
    expect(shape(value)).toEqual([
      [{ type: "tableHeader", text: "Name", colspan: 1, rowspan: 1, colwidth: null, color: null }, { type: "tableHeader", text: "Score", colspan: 1, rowspan: 1, colwidth: null, color: null }],
      [{ type: "tableCell", text: "Ada", colspan: 1, rowspan: 1, colwidth: null, color: "yellow_background" }, { type: "tableCell", text: "10", colspan: 1, rowspan: 1, colwidth: null, color: null }],
    ]);
  });

  test("unknown colours and silly spans are dropped or capped", () => {
    const value = markdownToDoc(`<table>\n<tr><td data-color="javascript:alert(1)" colspan="99999">x</td></tr>\n</table>`);
    const [[only]] = shape(value);
    expect(only.color).toBe(null);
    expect(only.colspan).toBe(100);
  });

  test("a cell that mentions a closing tag doesn't end the table", () => {
    const value = doc(table([row(cell("see </td> here", { color: "red" }), cell("b"))]));
    expect(shape(roundTrip(value))[0].map((c) => c.text)).toEqual(["see </td> here", "b"]);
  });
});
