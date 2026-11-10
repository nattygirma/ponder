import { describe, expect, test } from "bun:test";
import { createDefaultDiagramDocument } from "@ponder/shared";
import { formatMindMapOutline, projectMindMapOutline, updateMindMapOutlineDraft } from "./mind-map-outline.ts";

const project = (document, draft) => {
  let next = 0;
  return projectMindMapOutline(document, draft, () => `new-${++next}`);
};

describe("mind map outline", () => {
  test("round trips existing labels, hierarchy, and node identities", () => {
    const document = createDefaultDiagramDocument("mind-map");
    document.nodes[0].label = "- Root\\name\nsecond line\tend ";
    const draft = formatMindMapOutline(document);
    expect(draft).not.toBeNull();
    expect(draft.text).toStartWith("# \\- Root\\\\name\\nsecond line\\tend ");
    expect(draft.text).toContain("\n- Capture ideas\n  - Quick notes");
    expect(draft.text).not.toContain("\t");
    const result = project(document, draft);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.structureChanged).toBe(false);
    expect(result.document.nodes.find((node) => node.id === "topic-root")?.label).toBe(document.nodes[0].label);
    expect(result.document.nodes.map((node) => node.id).sort()).toEqual(document.nodes.map((node) => node.id).sort());
  });

  test("typing a label retains its node and labeled branch", () => {
    const document = createDefaultDiagramDocument("mind-map");
    const branch = document.edges.find((edge) => edge.target === "topic-1-a");
    branch.label = "context";
    const initial = formatMindMapOutline(document);
    const edited = updateMindMapOutlineDraft(initial, initial.text.replace("Quick notes", "Quick notes 2"));
    const result = project(document, edited);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.structureChanged).toBe(false);
    expect(result.document.nodes.find((node) => node.id === "topic-1-a")?.label).toBe("Quick notes 2");
    expect(result.document.edges.find((edge) => edge.id === branch.id)).toEqual(branch);
  });

  test("pasting a renamed topic and a new topic keeps the renamed topic metadata", () => {
    const document = createDefaultDiagramDocument("mind-map");
    const existing = document.nodes.find((node) => node.id === "topic-1-a");
    existing.width = 180;
    const initial = formatMindMapOutline(document);
    const edited = initial.text.replace("Quick notes", "Quick notes and filing").concat("\n- New topic");
    const result = project(document, updateMindMapOutlineDraft(initial, edited));
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.document.nodes.find((node) => node.label === "Quick notes and filing")).toMatchObject({
      id: "topic-1-a", width: 180,
    });
    expect(result.document.nodes.find((node) => node.label === "New topic")?.id).toStartWith("new-");
  });

  test("pasting and reparenting topics preserves existing IDs and edge labels", () => {
    const document = createDefaultDiagramDocument("mind-map");
    const branch = document.edges.find((edge) => edge.target === "topic-1-a");
    branch.label = "context";
    const initial = formatMindMapOutline(document);
    const lines = initial.text.split("\n");
    const moved = lines.splice(lines.findIndex((line) => line.endsWith("Quick notes")), 1)[0];
    lines.splice(lines.findIndex((line) => line.endsWith("Notebooks")) + 1, 0, moved, "  - New subtopic");
    const result = project(document, updateMindMapOutlineDraft(initial, lines.join("\n")));
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.structureChanged).toBe(true);
    expect(result.document.nodes.find((node) => node.id === "topic-1-a")?.parentId).toBe("topic-2");
    expect(result.document.edges.find((edge) => edge.id === branch.id)).toMatchObject({
      source: "topic-2", target: "topic-1-a", label: "context",
    });
    expect(result.document.nodes.find((node) => node.label === "New subtopic")?.id).toStartWith("new-");
  });

  test("rejects malformed hierarchy without changing the source", () => {
    const document = createDefaultDiagramDocument("mind-map");
    const initial = formatMindMapOutline(document);
    for (const [text, reason] of [
      ["", "empty"],
      ["# Root\n# Sibling", "root"],
      ["# Root\n  - Skipped", "depth"],
      ["# Root\n - Child", "indent"],
      ["# Root\n- X" + "x".repeat(500), "label"],
    ]) {
      const result = project(document, updateMindMapOutlineDraft(initial, text));
      expect(result).toMatchObject({ ok: false, error: { reason } });
    }
    expect(document.nodes).toHaveLength(8);
  });

  test("ignores an empty list item without changing the diagram", () => {
    const document = createDefaultDiagramDocument("mind-map");
    const initial = formatMindMapOutline(document);
    const edited = initial.text.replace("  - Sync across devices", "  - \n  - Sync across devices");
    const result = project(document, updateMindMapOutlineDraft(initial, edited));
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.structureChanged).toBe(false);
    expect(result.document.nodes.map((node) => node.id).sort()).toEqual(document.nodes.map((node) => node.id).sort());
  });

  test("omits an emptied topic and promotes its nonempty children", () => {
    const document = createDefaultDiagramDocument("mind-map");
    const initial = formatMindMapOutline(document);
    const edited = initial.text.replace("- Capture ideas", "- ");
    const result = project(document, updateMindMapOutlineDraft(initial, edited));
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.document.nodes.some((node) => node.id === "topic-1")).toBe(false);
    expect(result.document.nodes.find((node) => node.id === "topic-1-a")?.parentId).toBe("topic-root");
    expect(result.document.nodes.find((node) => node.id === "topic-1-b")?.parentId).toBe("topic-root");
  });

  test("keeps the last valid map while the root is empty", () => {
    const document = createDefaultDiagramDocument("mind-map");
    const initial = formatMindMapOutline(document);
    const result = project(document, updateMindMapOutlineDraft(initial, initial.text.replace("# Main topic", "# ")));
    expect(result).toMatchObject({ ok: false, error: { reason: "empty" } });
    expect(document.nodes).toHaveLength(8);
  });

  test("restores identities after an invalid intermediate paste", () => {
    const document = createDefaultDiagramDocument("mind-map");
    const original = formatMindMapOutline(document);
    const invalid = updateMindMapOutlineDraft(original, "Main topic\nSecond root");
    expect(project(document, invalid).ok).toBe(false);
    const restored = updateMindMapOutlineDraft(invalid, original.text);
    const result = project(document, restored);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.document.nodes.map((node) => node.id).sort()).toEqual(document.nodes.map((node) => node.id).sort());
    expect(result.structureChanged).toBe(false);
  });

  test("a wholesale replacement does not silently inherit old topic identities", () => {
    const document = createDefaultDiagramDocument("mind-map");
    const initial = formatMindMapOutline(document);
    const replacement = initial.text.split("\n").map((line, index) =>
      `${line.match(/^(?:# | *- )/)?.[0] ?? ""}Replacement ${index}`,
    ).join("\n");
    const result = project(document, updateMindMapOutlineDraft(initial, replacement));
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.document.nodes.every((node) => node.id.startsWith("new-"))).toBe(true);
  });

  test("accepts pasted Markdown lists and preserves unrelated edges", () => {
    const document = createDefaultDiagramDocument("mind-map");
    document.edges.push({ id: "extra", source: "topic-1-a", target: "topic-3-a", label: "see also" });
    const initial = formatMindMapOutline(document);
    const draft = updateMindMapOutlineDraft(initial, "# Main topic\r\n- Capture ideas\r\n  - Quick notes\r\n  - Sync across devices\r\n- Organize\r\n  - Notebooks\r\n- Share\r\n  - Public links");
    const result = project(document, draft);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.document.nodes.map((node) => node.id).sort()).toEqual(document.nodes.map((node) => node.id).sort());
    expect(result.document.edges.find((edge) => edge.id === "extra")).toMatchObject({ label: "see also" });
  });

  test("still accepts the earlier plain indented outline", () => {
    const document = createDefaultDiagramDocument("mind-map");
    const initial = formatMindMapOutline(document);
    const plain = "Main topic\n\tCapture ideas\n\t\tQuick notes\n\t\tSync across devices\n\tOrganize\n\t\tNotebooks\n\tShare\n\t\tPublic links";
    const result = project(document, updateMindMapOutlineDraft(initial, plain));
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.document.nodes.map((node) => node.id).sort()).toEqual(document.nodes.map((node) => node.id).sort());
  });
});
