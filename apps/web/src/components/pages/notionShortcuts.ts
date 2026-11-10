import { Extension, InputRule } from "@tiptap/core";

/**
 * Typing shortcuts as people coming from Notion expect them: "> " starts a toggle and
 * '" ' starts a quote. Outside the page layout "> " keeps its Markdown meaning, a quote.
 */
export const createNotionShortcuts = (isEnabled: () => boolean) => Extension.create({
  name: "ponderNotionShortcuts",
  // Input rules run in extension priority order, so this must be ahead of the blockquote's own "> " rule.
  priority: 1000,
  addInputRules() {
    return [
      new InputRule({
        find: /^>\s$/,
        handler: ({ chain, range }) => {
          if (!isEnabled()) return null;
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
