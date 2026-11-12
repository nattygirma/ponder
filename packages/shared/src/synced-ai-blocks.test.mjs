import { describe, expect, test } from "bun:test";
import {
  buildAiBlockInstruction,
  collectSyncedIds,
  docToMarkdown,
  docWithoutNodeAt,
  expandSyncedMarkdown,
  listSyncedIdsInMarkdown,
  markdownToDoc,
  normalizeGeneratedMarkdown,
  replaceSyncedNodes,
  stripSyncedMarkdown,
} from "./index.ts";

const text = (value) => ({ type: "text", text: value });
const paragraph = (value) => ({ type: "paragraph", content: [text(value)] });
const roundTrip = (content) => markdownToDoc(docToMarkdown({ type: "doc", content }));
const ID = "syn_abcdef123456";
const OTHER = "syn_zzzzzz999999";

describe("synced block in Markdown", () => {
  test("a page stores only the reference, and it round-trips", () => {
    const markdown = docToMarkdown({ type: "doc", content: [paragraph("Before"), { type: "ponderSynced", attrs: { syncedId: ID } }, paragraph("After")] });
    expect(markdown).toContain(`<ponder-synced id="${ID}"></ponder-synced>`);
    const back = markdownToDoc(markdown);
    expect(back.content.map((node) => node.type)).toEqual(["paragraph", "ponderSynced", "paragraph"]);
    expect(back.content[1].attrs.syncedId).toBe(ID);
  });

  test("an expanded tag (as AI and exports see it) parses back to the bare reference", () => {
    const expanded = expandSyncedMarkdown(`Intro\n\n<ponder-synced id="${ID}"></ponder-synced>\n\nOutro`, (id) => (id === ID ? "## Shared\n\n- one\n- two" : null));
    expect(expanded).toContain("## Shared");
    const doc = markdownToDoc(expanded);
    expect(doc.content.map((node) => node.type)).toEqual(["paragraph", "ponderSynced", "paragraph"]);
    expect(JSON.stringify(doc)).not.toContain("Shared");
  });

  test("blocks a reader can't see stay empty when expanded", () => {
    const expanded = expandSyncedMarkdown(`<ponder-synced id="${ID}"></ponder-synced>\n\n<ponder-synced id="${OTHER}"></ponder-synced>`, (id) => (id === ID ? "Visible" : null));
    expect(expanded).toContain(`<ponder-synced id="${OTHER}"></ponder-synced>`);
    expect(expanded).toContain("Visible");
  });

  test("strip returns the stored form and the content each tag carried", () => {
    const { markdown, edits } = stripSyncedMarkdown(`A\n\n<ponder-synced id="${ID}">\n\nEdited by AI\n\n</ponder-synced>\n\n<ponder-synced id="${OTHER}"></ponder-synced>`);
    expect(markdown).toBe(`A\n\n<ponder-synced id="${ID}"></ponder-synced>\n\n<ponder-synced id="${OTHER}"></ponder-synced>`);
    expect(edits).toEqual([{ id: ID, markdown: "Edited by AI" }]);
  });

  test("tags inside fenced code are text, not references", () => {
    const source = `\`\`\`html\n<ponder-synced id="${ID}">x</ponder-synced>\n\`\`\``;
    expect(stripSyncedMarkdown(source)).toEqual({ markdown: source, edits: [] });
    expect(listSyncedIdsInMarkdown(source)).toEqual([]);
  });

  test("ids are collected from JSON and Markdown, once each, and malformed ids are ignored", () => {
    const doc = { type: "doc", content: [{ type: "ponderSynced", attrs: { syncedId: ID } }, { type: "ponderColumns", content: [{ type: "ponderColumn", content: [{ type: "ponderSynced", attrs: { syncedId: ID } }, { type: "ponderSynced", attrs: { syncedId: "../x" } }] }] }] };
    expect(collectSyncedIds(doc)).toEqual([ID]);
    expect(listSyncedIdsInMarkdown(`<ponder-synced id="${ID}"></ponder-synced>\n\n<ponder-synced id="${OTHER}"></ponder-synced>`)).toEqual([ID, OTHER]);
  });

  test("replacing references unsyncs (inline blocks), removes, or keeps", () => {
    const doc = { type: "doc", content: [{ type: "ponderSynced", attrs: { syncedId: ID } }, { type: "ponderSynced", attrs: { syncedId: OTHER } }, paragraph("x")] };
    const replaced = replaceSyncedNodes(doc, (id) => (id === ID ? [paragraph("Inline now")] : null));
    expect(replaced.content).toEqual([paragraph("Inline now"), paragraph("x")]);
    expect(replaceSyncedNodes(doc, () => undefined)).toEqual(doc);
  });
});

describe("AI block in Markdown", () => {
  test("prompt and answer survive a round trip, and an AI edit of the page keeps them", () => {
    const block = { type: "ponderAiBlock", attrs: { prompt: "Summarize \"this\" <page>", generatedAt: "2026-11-11T10:00:00.000Z" }, content: [{ type: "bulletList", content: [{ type: "listItem", content: [paragraph("Point one")] }] }] };
    const back = roundTrip([paragraph("Body"), block]);
    expect(back.content[1].type).toBe("ponderAiBlock");
    expect(back.content[1].attrs).toEqual(block.attrs);
    expect(back.content[1].content[0].type).toBe("bulletList");
    // update_memo writes Markdown: the same text read back keeps the block.
    expect(markdownToDoc(docToMarkdown(back)).content[1].attrs.prompt).toBe("Summarize \"this\" <page>");
  });

  test("an AI block that hasn't run yet is empty", () => {
    const back = roundTrip([{ type: "ponderAiBlock", attrs: { prompt: "", generatedAt: "" } }]);
    expect(back.content[0].type).toBe("ponderAiBlock");
    expect(back.content[0].content ?? []).toEqual([]);
  });

  test("a fenced answer is unwrapped (AppFlowy's rule)", () => {
    expect(normalizeGeneratedMarkdown("```markdown\n# Title\n\n- a\n```")).toBe("# Title\n\n- a");
    expect(normalizeGeneratedMarkdown("  plain  ")).toBe("plain");
  });

  test("the instruction carries the request, and the page leaves the block out", () => {
    expect(buildAiBlockInstruction("Write a haiku")).toContain("Request: Write a haiku");
    // The gateway's limit for an instruction is 2,000 characters.
    expect(buildAiBlockInstruction("x".repeat(5000)).length).toBeLessThanOrEqual(2000);
    expect(buildAiBlockInstruction("x".repeat(1500))).toContain("x".repeat(1500));
    const doc = { type: "doc", content: [paragraph("Keep"), { type: "ponderAiBlock", attrs: { prompt: "p" }, content: [paragraph("Old answer")] }] };
    expect(docToMarkdown(docWithoutNodeAt(doc, [1]))).not.toContain("Old answer");
  });
});
