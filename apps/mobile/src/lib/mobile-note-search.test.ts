import { describe, expect, test } from "bun:test";
import { Schema } from "@tiptap/pm/model";
import { getMobileNoteSearchMatches, getNextMobileNoteSearchIndex } from "./mobile-note-search";

const schema = new Schema({
  nodes: {
    doc: { content: "block+" },
    paragraph: { content: "inline*", group: "block" },
    text: { group: "inline" },
  },
  marks: {
    strong: {},
  },
});

describe("mobile note search", () => {
  test("finds case-insensitive matches split across inline marks", () => {
    const strong = schema.marks.strong.create();
    const doc = schema.node("doc", null, [
      schema.node("paragraph", null, [
        schema.text("Pon"),
        schema.text("der", [strong]),
        schema.text(" ponder"),
      ]),
    ]);

    expect(getMobileNoteSearchMatches(doc, "ponder")).toEqual([
      { from: 1, to: 7 },
      { from: 8, to: 14 },
    ]);
  });

  test("does not create a match across block boundaries", () => {
    const doc = schema.node("doc", null, [
      schema.node("paragraph", null, schema.text("pon")),
      schema.node("paragraph", null, schema.text("der")),
    ]);

    expect(getMobileNoteSearchMatches(doc, "ponder")).toEqual([]);
  });

  test("wraps previous and next navigation", () => {
    expect(getNextMobileNoteSearchIndex(0, -1, 3)).toBe(2);
    expect(getNextMobileNoteSearchIndex(2, 1, 3)).toBe(0);
    expect(getNextMobileNoteSearchIndex(0, 1, 0)).toBe(0);
  });
});
