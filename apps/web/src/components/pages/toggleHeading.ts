import type { Editor } from "@tiptap/core";
import type { Node as ProseMirrorNode } from "@tiptap/pm/model";
import { TextSelection, type Transaction } from "@tiptap/pm/state";
import { DETAILS_NODE_TYPE } from "@ponder/shared";

export type ToggleLevel = 0 | 1 | 2 | 3;

/**
 * Turns the text block holding the cursor into a toggle whose title is that text, as Notion's
 * toggle headings (and "# > ") do. A toggle's title is plain text, so inline atoms are left out.
 * Inside a toggle's title, it only changes that toggle's level.
 */
export const applyToggleBlock = (tr: Transaction, level: ToggleLevel) => {
  const { $from } = tr.selection;
  const schema = tr.doc.type.schema;
  if ($from.parent.type.name === "detailsSummary" && $from.depth >= 2) {
    tr.setNodeAttribute($from.before($from.depth - 1), "level", level);
    return true;
  }
  if (!$from.parent.isTextblock || !schema.nodes[DETAILS_NODE_TYPE]) return false;
  const inline: ProseMirrorNode[] = [];
  $from.parent.forEach((child) => {
    if (child.isText) inline.push(child);
  });
  const offset = Math.min($from.parentOffset, inline.reduce((size, child) => size + child.nodeSize, 0));
  const details = schema.nodes[DETAILS_NODE_TYPE].create({ level }, [
    schema.nodes.detailsSummary.create(null, inline),
    schema.nodes.detailsContent.create(null, schema.nodes.paragraph.create()),
  ]);
  const start = $from.before();
  tr.replaceWith(start, $from.after(), details);
  tr.setSelection(TextSelection.create(tr.doc, start + 2 + offset));
  tr.scrollIntoView();
  return true;
};

export const setToggleBlock = (editor: Editor, level: ToggleLevel) => {
  const { tr } = editor.state;
  if (!applyToggleBlock(tr, level)) return false;
  editor.view.dispatch(tr);
  return true;
};
