import { describe, expect, test } from "bun:test";
import { docToMarkdown, markdownToDoc } from "./index.ts";

const text = (value) => ({ type: "text", text: value });
const paragraph = (value) => ({ type: "paragraph", content: [text(value)] });

const doc = {
  type: "doc",
  content: [
    paragraph("Before"),
    { type: "ponderSubPage", attrs: { memoId: "memo_a", title: "Child \"one\"" } },
    {
      type: "ponderCallout",
      attrs: { icon: "🔥", color: "red" },
      content: [
        paragraph("Inside"),
        { type: "ponderCallout", attrs: { icon: "💡", color: "gray" }, content: [paragraph("Nested")] },
      ],
    },
    {
      type: "ponderColumns",
      content: [
        { type: "ponderColumn", content: [paragraph("Left")] },
        { type: "ponderColumn", content: [{ type: "bulletList", content: [{ type: "listItem", content: [paragraph("Right")] }] }] },
      ],
    },
    { type: "ponderDatabase", attrs: { databaseId: "db_1", viewId: "v_1" } },
    paragraph("After"),
  ],
};

describe("page blocks in Markdown", () => {
  test("survive a round trip", () => {
    const back = markdownToDoc(docToMarkdown(doc));
    expect(back.content.map((node) => node.type)).toEqual(doc.content.map((node) => node.type));
    expect(back.content[1].attrs).toEqual({ memoId: "memo_a", title: "Child \"one\"" });
    expect(back.content[2].attrs).toEqual({ icon: "🔥", color: "red" });
    expect(back.content[2].content[1].type).toBe("ponderCallout");
    expect(back.content[3].content).toHaveLength(2);
    expect(back.content[3].content[1].content[0].type).toBe("bulletList");
    expect(back.content[4].attrs).toEqual({ databaseId: "db_1", viewId: "v_1" });
  });
});
