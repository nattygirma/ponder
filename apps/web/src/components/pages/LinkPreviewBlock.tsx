import { LinkPreview, parseConnectedLink, safeLinkPreviewUrl } from "@ponder/shared";
import { useQuery } from "@tanstack/react-query";
import { Extension, type Editor } from "@tiptap/core";
import { Plugin, PluginKey } from "@tiptap/pm/state";
import { NodeViewWrapper, ReactNodeViewRenderer, type NodeViewProps } from "@tiptap/react";
import { api } from "@/lib/api";
import { AppMark } from "./Connections";

const REFRESH_MS = 10 * 60_000;

const LinkPreviewView = ({ node }: NodeViewProps) => {
  const url = String(node.attrs.url ?? "");
  // The page keeps what was saved. People who can read the connected app see it current.
  const live = useQuery({
    queryKey: ["link-preview", url],
    queryFn: () => api.getLinkPreview(url),
    enabled: Boolean(parseConnectedLink(url)),
    staleTime: REFRESH_MS,
    retry: false,
  });
  const preview = live.data?.preview;
  const title = preview?.title || String(node.attrs.title ?? "") || url;
  const subtitle = preview?.subtitle ?? String(node.attrs.subtitle ?? "");
  return (
    <NodeViewWrapper data-link-preview={String(node.attrs.provider ?? "")} contentEditable={false}>
      <a
        className="my-1 flex items-center gap-3 rounded-md border border-slate-200 px-3 py-2 !no-underline hover:bg-slate-50"
        href={safeLinkPreviewUrl(url)}
        target="_blank"
        rel="noopener noreferrer"
      >
        <AppMark app={String(node.attrs.provider ?? "")} />
        <span className="min-w-0 flex-1">
          <span className="block truncate text-sm font-medium text-slate-900">{title}</span>
          {subtitle ? <span className="block truncate text-xs text-slate-500">{subtitle}</span> : null}
        </span>
      </a>
    </NodeViewWrapper>
  );
};

export const EditorLinkPreview = LinkPreview.extend({
  addNodeView() {
    return ReactNodeViewRenderer(LinkPreviewView);
  },
});

/** Finds the paragraph that holds nothing but this address, wherever it has moved to by now. */
const findPastedLink = (editor: Editor, url: string) => {
  let found: { pos: number; size: number } | null = null;
  editor.state.doc.descendants((node, pos) => {
    if (found) return false;
    if (node.type.name === "paragraph" && node.textContent.trim() === url) found = { pos, size: node.nodeSize };
    return !found;
  });
  return found as { pos: number; size: number } | null;
};

const upgradePastedLink = async (editor: Editor, url: string) => {
  const { preview } = await api.getLinkPreview(url);
  if (!preview || editor.isDestroyed) return;
  const target = findPastedLink(editor, url);
  if (!target) return;
  const { doc, schema, tr } = editor.state;
  const block = schema.nodes[LinkPreview.name].create(preview);
  tr.replaceWith(target.pos, target.pos + target.size, block);
  // Without a line after it, a block at the very end leaves nowhere to keep typing.
  if (target.pos + target.size === doc.content.size) tr.insert(tr.doc.content.size, schema.nodes.paragraph.create());
  editor.view.dispatch(tr);
};

/**
 * Pasting a link to a connected app on an empty line turns it into a preview once the app has
 * answered. The paste itself is left alone, so a failed lookup still leaves an ordinary link.
 */
export const LinkPreviewPaste = Extension.create({
  name: "linkPreviewPaste",
  addProseMirrorPlugins() {
    const { editor } = this;
    return [new Plugin({
      key: new PluginKey("linkPreviewPaste"),
      props: {
        handlePaste: (view, event) => {
          const text = event.clipboardData?.getData("text/plain").trim() ?? "";
          const { empty, $from } = view.state.selection;
          if (empty && $from.parent.type.name === "paragraph" && $from.parent.content.size === 0 && parseConnectedLink(text)) {
            void upgradePastedLink(editor, text).catch(() => undefined);
          }
          return false;
        },
      },
    })];
  },
});
