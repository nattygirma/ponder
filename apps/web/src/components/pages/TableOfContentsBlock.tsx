/**
 * Notion's /toc block: the page's headings, indented under each other, each scrolling to its heading.
 *
 * Adapted from AppFlowy-Web (https://github.com/AppFlowy-IO/AppFlowy-Web), Copyright AppFlowy, AGPL-3.0:
 * src/components/editor/components/blocks/outline/Outline.tsx and OutlineContent.tsx. The Slate
 * element became a TipTap node view; the frame, title and accent strip gave way to Notion's plain
 * underlined list.
 */
import { useCallback, useMemo, type KeyboardEvent, type MouseEvent } from "react";
import { useTranslation } from "react-i18next";
import { NodeViewWrapper, ReactNodeViewRenderer, type NodeViewProps } from "@tiptap/react";
import { nestHeadings, TableOfContents, type OutlineHeading } from "@ponder/shared";
import { cn } from "@/lib/utils";
import { jumpToHeading, usePageHeadings } from "./outlineNavigation";

const TableOfContentsView = ({ editor, selected }: NodeViewProps) => {
  const { t } = useTranslation();
  const { headings } = usePageHeadings(editor, 3);
  const root = useMemo(() => nestHeadings(headings), [headings]);

  const go = useCallback((event: MouseEvent | KeyboardEvent, heading: OutlineHeading) => {
    event.preventDefault();
    event.stopPropagation();
    jumpToHeading(editor, heading);
  }, [editor]);

  const renderHeading = (heading: OutlineHeading, indent: number) => (
    <div key={heading.id} className="flex flex-col">
      <div
        role="link"
        tabIndex={0}
        data-toc-heading={heading.id}
        className="ponder-toc-row"
        style={{ paddingLeft: `${indent * 24 + 2}px` }}
        onMouseDown={(event) => event.preventDefault()}
        onClick={(event) => go(event, heading)}
        onKeyDown={(event) => {
          if (event.key !== "Enter" && event.key !== " ") return;
          go(event, heading);
        }}
      >
        <span className="ponder-toc-text">{heading.text || t("pages.blocks.untitled")}</span>
      </div>
      {heading.children.map((child) => renderHeading(child, indent + 1))}
    </div>
  );

  return (
    <NodeViewWrapper
      as="nav"
      className={cn("ponder-toc-block", selected && "is-selected")}
      aria-label={t("pages.blocks.tocLabel")}
      contentEditable={false}
    >
      {root.length === 0
        ? <p className="ponder-toc-empty">{t("pages.blocks.tocEmpty")}</p>
        : root.map((heading) => renderHeading(heading, 0))}
    </NodeViewWrapper>
  );
};

export const EditorTableOfContents = TableOfContents.extend({
  addNodeView() {
    return ReactNodeViewRenderer(TableOfContentsView, { stopEvent: ({ event }) => event.type === "keydown" || event.type === "click" });
  },
});
