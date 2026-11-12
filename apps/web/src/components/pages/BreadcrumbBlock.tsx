import { useTranslation } from "react-i18next";
import { NodeViewWrapper, ReactNodeViewRenderer, type NodeViewProps } from "@tiptap/react";
import { Breadcrumb } from "@ponder/shared";
import { cn } from "@/lib/utils";
import { usePages } from "./PagesProvider";
import { PageIcon } from "./PageTree";

type BreadcrumbOptions = { getPageId: () => string | null };

/**
 * Notion's /breadcrumb block: the pages above this one and the page itself, separated by slashes.
 * Ponder's own; AppFlowy-Web has no breadcrumb block. It reads the page tree, so it follows moves
 * and renames without storing anything.
 */
const BreadcrumbView = ({ extension, selected }: NodeViewProps) => {
  const { t } = useTranslation();
  const pages = usePages();
  const pageId = (extension.options as BreadcrumbOptions).getPageId();
  const page = pageId ? pages?.getPage(pageId) : undefined;
  const trail = page && pages ? [...pages.ancestorsOf(page.id), page] : [];
  return (
    <NodeViewWrapper as="nav" className={cn("ponder-breadcrumb-block", selected && "is-selected")} aria-label={t("pages.blocks.breadcrumbLabel")} contentEditable={false}>
      {trail.length === 0 ? <span className="ponder-breadcrumb-item">{t("pages.blocks.untitled")}</span> : trail.map((item, index) => (
        <span key={item.id} className="flex min-w-0 items-center">
          {index > 0 ? <span className="ponder-breadcrumb-separator" aria-hidden="true">/</span> : null}
          <button
            type="button"
            className="ponder-breadcrumb-item"
            aria-current={item.id === page?.id ? "page" : undefined}
            onMouseDown={(event) => event.preventDefault()}
            onClick={() => {
              if (item.id !== page?.id) pages?.openPage(item);
            }}
          >
            <PageIcon icon={item.icon} className="h-4 w-4 shrink-0 text-sm" />
            <span className="truncate">{item.title?.trim() || t("pages.blocks.untitled")}</span>
          </button>
        </span>
      ))}
    </NodeViewWrapper>
  );
};

export const EditorBreadcrumb = Breadcrumb.extend<BreadcrumbOptions>({
  addOptions() {
    return { getPageId: () => null };
  },
  addNodeView() {
    return ReactNodeViewRenderer(BreadcrumbView, { stopEvent: ({ event }) => event.type === "click" });
  },
});
