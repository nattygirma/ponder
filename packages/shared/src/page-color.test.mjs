import { describe, expect, test } from "bun:test";
import { docToMarkdown, markdownToDoc } from "./content";

const doc = (...content) => ({ type: "doc", content });
const colored = (text, color) => ({ type: "text", text, marks: [{ type: "pageColor", attrs: { color } }] });

describe("page colours", () => {
  test("a coloured word survives Markdown and back", () => {
    const source = doc({ type: "paragraph", content: [{ type: "text", text: "Hello " }, colored("world", "red")] });
    const markdown = docToMarkdown(source);
    expect(markdown).toContain('<span data-page-color="red">world</span>');
    const content = markdownToDoc(markdown).content[0].content;
    expect(content[1]).toMatchObject({ text: "world", marks: [{ type: "pageColor", attrs: { color: "red" } }] });
  });
  test("a background colour survives too", () => {
    const markdown = docToMarkdown(doc({ type: "paragraph", content: [colored("note", "yellow_background")] }));
    expect(markdownToDoc(markdown).content[0].content[0].marks[0].attrs.color).toBe("yellow_background");
  });
  test("an unknown colour stays as plain text instead of becoming a mark", () => {
    const content = markdownToDoc('<span data-page-color="url(x)">bad</span>').content[0].content ?? [];
    expect(content.some((node) => node.marks?.some((mark) => mark.type === "pageColor"))).toBe(false);
  });
});
