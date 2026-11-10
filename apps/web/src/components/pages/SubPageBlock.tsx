import { SubPage } from "@ponder/shared";
import { NodeViewWrapper, ReactNodeViewRenderer, type NodeViewProps } from "@tiptap/react";
import { useTranslation } from "react-i18next";
import { usePages } from "./PagesProvider";
import { PageIcon } from "./PageTree";

const SubPageView = ({ node }: NodeViewProps) => {
  const pages = usePages();
  const { t } = useTranslation();
  const memoId = String(node.attrs.memoId ?? "");
  const page = pages?.getPage(memoId);
  // The tree only has live pages, so a block pointing elsewhere is a deleted page once the tree has loaded.
  const missing = Boolean(pages && pages.nodes.length > 0 && !page);
  const title = page?.title?.trim() || String(node.attrs.title ?? "").trim() || t("common.untitledMemo");
  return (
    <NodeViewWrapper className="ponder-sub-page" contentEditable={false} data-drag-handle="">
      <button
        type="button"
        className="flex w-full min-w-0 items-center gap-2 rounded px-1 py-1 text-left hover:bg-slate-100 disabled:cursor-default disabled:text-slate-400"
        disabled={missing || !page}
        onClick={() => page && pages?.openPage(page)}
      >
        <PageIcon icon={page?.icon} />
        <span className={`truncate font-medium ${missing ? "" : "underline decoration-slate-300 underline-offset-4"}`}>
          {missing ? t("pages.deletedPage") : title}
        </span>
      </button>
    </NodeViewWrapper>
  );
};

export const EditorSubPage = SubPage.extend({
  addNodeView() {
    return ReactNodeViewRenderer(SubPageView);
  },
});
