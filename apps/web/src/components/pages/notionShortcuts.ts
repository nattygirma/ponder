import { Extension, InputRule } from "@tiptap/core";
import { applyToggleBlock, type ToggleLevel } from "./toggleHeading";

/**
 * Typing shortcuts as people coming from Notion expect them: "> " starts a toggle ("# > " a toggle
 * heading) and '" ' starts a quote. Outside the page layout "> " keeps its Markdown meaning, a quote.
 */
export const createNotionShortcuts = (isEnabled: () => boolean) => Extension.create({
  name: "ponderNotionShortcuts",
  // Input rules run in extension priority order, so this must be ahead of the blockquote's own "> " rule.
  priority: 1000,
  addInputRules() {
    return [
      new InputRule({
        find: /^>\s$/,
        handler: ({ chain, range, state }) => {
          if (!isEnabled()) return null;
          const parent = state.doc.resolve(range.from).parent;
          const level = parent.type.name === "heading" ? Number(parent.attrs.level) : 0;
          if (level >= 1 && level <= 3) {
            chain().deleteRange(range).command(({ tr }) => applyToggleBlock(tr, level as ToggleLevel)).run();
            return;
          }
          chain().deleteRange(range).setDetails().run();
        },
      }),
      new InputRule({
        find: /^["“”]\s$/,
        handler: ({ chain, range }) => {
          if (!isEnabled()) return null;
          chain().deleteRange(range).toggleBlockquote().run();
        },
      }),
    ];
  },
});
