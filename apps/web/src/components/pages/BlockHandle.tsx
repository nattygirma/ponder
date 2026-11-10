import { useEffect, useState, useSyncExternalStore } from "react";
import { createPortal } from "react-dom";
import { DragHandle } from "@tiptap/extension-drag-handle";
import { TextSelection } from "@tiptap/pm/state";
import type { Node as ProseMirrorNode } from "@tiptap/pm/model";
import type { Editor } from "@tiptap/react";
import { CALLOUT_NODE_TYPE } from "@ponder/shared";
import { Baseline, Copy, CornerUpRight, Link2, MessageSquare, GripVertical, Plus, Repeat2, Sparkles, Trash2 } from "lucide-react";
import { PAGE_COLORS, type PageColor } from "@ponder/shared/page-color";
import { MenuSearch } from "./MenuSearch";
import { usePages } from "./PagesProvider";
import { appendBlockToPage } from "./page-content";
import { useViewer } from "@/components/teams/Teams";
import { ColorSwatch } from "./SelectionBubble";
import { copyTextToClipboard } from "@/lib/clipboard";
import { useTranslation } from "react-i18next";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuSub,
  DropdownMenuSubContent,
  DropdownMenuSubTrigger,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";

export type TurnIntoTarget = "paragraph" | "h1" | "h2" | "h3" | "bullet" | "ordered" | "task" | "quote" | "code" | "callout" | "toggle";

const CONVERTIBLE = new Set([
  "paragraph", "heading", "bulletList", "orderedList", "taskList", "blockquote", "codeBlock", CALLOUT_NODE_TYPE,
]);

export const TURN_INTO_TARGETS: TurnIntoTarget[] = ["paragraph", "h1", "h2", "h3", "bullet", "ordered", "task", "quote", "code", "callout", "toggle"];

export const useTurnIntoLabels = (): Record<TurnIntoTarget, string> => {
  const { t } = useTranslation();
  return {
    paragraph: t("editorToolbar.paragraph"),
    h1: t("editorToolbar.heading1"),
    h2: t("editorToolbar.heading2"),
    h3: t("editorToolbar.heading3"),
    bullet: t("editorToolbar.bulletList"),
    ordered: t("editorToolbar.orderedList"),
    task: t("editorToolbar.taskList"),
    quote: t("editorToolbar.quote"),
    code: t("editorToolbar.codeBlock"),
    callout: t("pages.callout"),
    toggle: t("editorToolbar.fold"),
  };
};

export const turnInto = (editor: Editor, pos: number, target: TurnIntoTarget) => {
  const chain = editor.chain().focus()
    .command(({ tr }) => {
      tr.setSelection(TextSelection.near(tr.doc.resolve(pos + 1)));
      return true;
    })
    .clearNodes();
  switch (target) {
    case "paragraph": chain.setParagraph().run(); break;
    case "h1": chain.setHeading({ level: 1 }).run(); break;
    case "h2": chain.setHeading({ level: 2 }).run(); break;
    case "h3": chain.setHeading({ level: 3 }).run(); break;
    case "bullet": chain.toggleBulletList().run(); break;
    case "ordered": chain.toggleOrderedList().run(); break;
    case "task": chain.toggleTaskList().run(); break;
    case "quote": chain.toggleBlockquote().run(); break;
    case "code": chain.setCodeBlock().run(); break;
    case "callout": chain.wrapIn(CALLOUT_NODE_TYPE).run(); break;
    case "toggle": chain.setDetails().run(); break;
  }
};

type BlockTarget = { node: ProseMirrorNode; pos: number };

/**
 * The drag handle has to be in the editor's extension list from the start: adding its plugin to a
 * running editor stops the slash and @ menus from opening. React then fills its element with a portal.
 */
/** With a narrow gutter the handle would slide under the sidebar, out of reach. */
const keepInsideEditorColumn = {
  name: "keepInsideEditorColumn",
  fn: ({ x, elements }: { x: number; elements: { floating: HTMLElement } }) => {
    const column = elements.floating.closest("[data-editor-column]");
    if (!column) return {};
    const offset = (elements.floating.offsetParent ?? document.body).getBoundingClientRect().left;
    const minimum = column.getBoundingClientRect().left + 2 - offset;
    return x < minimum ? { x: minimum } : {};
  },
};

export const createBlockHandleExtension = () => {
  const createElement = () => {
    const created = document.createElement("div");
    created.className = "ponder-block-handle bg-card rounded";
    created.dataset.blockHandle = "";
    return created;
  };
  let elements = [createElement()];
  let target: BlockTarget | null = null;
  const listeners = new Set<() => void>();
  return {
    // Hovering a block notifies subscribers, so the buttons land in the live element before they show.
    getElement: () => elements.find((element) => element.isConnected) ?? elements[elements.length - 1],
    getTarget: () => target,
    notify: () => listeners.forEach((listener) => listener()),
    subscribe: (listener: () => void) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    extension: DragHandle.configure({
      // The plugin moves whatever it is given into its own wrapper, and it can be built more than
      // once for one editor. A shared element would leave the mounted wrapper empty.
      render: () => {
        const element = createElement();
        elements = [...elements.filter((existing) => existing.isConnected), element];
        // The editor can be built during a React render, so subscribers hear about it afterwards.
        queueMicrotask(() => listeners.forEach((listener) => listener()));
        return element;
      },
      computePositionConfig: { placement: "left-start", middleware: [keepInsideEditorColumn] },
      // The extension's published type omits pos; its plugin always passes it.
      onNodeChange: (change) => {
        const { node, pos } = change as typeof change & { pos: number };
        target = node ? { node, pos } : null;
        listeners.forEach((listener) => listener());
      },
    }),
  };
};

export type BlockHandleController = ReturnType<typeof createBlockHandleExtension>;

/** The editor's element, or null while the editor isn't on the page yet. */
const mountedDom = (editor: Editor): HTMLElement | null => {
  try {
    return editor.view.dom;
  } catch {
    return null;
  }
};

export const BlockHandle = ({ editor, controller, pageId, pageLink, onComment, onAskAi, onSkill }: {
  editor: Editor;
  controller: BlockHandleController;
  /** The link to this page; a block link adds the block to it. */
  pageLink: string | null;
  pageId: string | null;
  onSkill?: (kind: "improve" | "proofread" | "reformat" | "explain" | "translate", pos: number, node: BlockTarget["node"]) => void;
  onComment?: (pos: number, node: BlockTarget["node"]) => void;
  onAskAi?: (pos: number, node: BlockTarget["node"]) => void;
}) => {
  const { t } = useTranslation();
  const current = useSyncExternalStore(controller.subscribe, controller.getTarget, controller.getTarget);
  const handleElement = useSyncExternalStore(controller.subscribe, controller.getElement, controller.getElement);
  const pagesForLink = usePages();
  // A block link scrolls to its block once the page has rendered.
  useEffect(() => {
    let timer = 0;
    const show = (blockId: string) => {
      window.clearInterval(timer);
      let attempts = 0;
      timer = window.setInterval(() => {
        const element = mountedDom(editor)?.querySelector(`[data-block-id="${blockId}"]`);
        attempts += 1;
        if (!element && attempts < 30) return;
        window.clearInterval(timer);
        pagesForLink?.clearBlockLink();
        if (!element) return;
        element.scrollIntoView({ block: "center" });
        // An animation, because the editor undoes any class added to its own elements.
        element.animate([{ backgroundColor: "rgba(35, 131, 226, 0.28)" }, { backgroundColor: "transparent" }], { duration: 1600, easing: "ease-out" });
      }, 200);
    };
    const linked = pageId ? pagesForLink?.blockLinkFor(pageId) : null;
    if (linked) show(linked);
    // Pasting a link to this same page only changes the address's #block=.
    const onHashChange = () => {
      const blockId = /^#block=([\w-]+)$/.exec(window.location.hash)?.[1];
      if (blockId) show(blockId);
    };
    window.addEventListener("hashchange", onHashChange);
    return () => {
      window.clearInterval(timer);
      window.removeEventListener("hashchange", onHashChange);
    };
  }, [editor, pageId, pagesForLink]);

  // The wrapper is mounted after this first renders, so look for it again once the editor is running.
  useEffect(() => {
    // The plugin adds its wrapper beside the editor when it is built; a build before the editor is on the page leaves it nowhere.
    const place = () => {
      const wrapper = controller.getElement().parentElement;
      const host = mountedDom(editor)?.parentElement;
      if (wrapper && host && !wrapper.isConnected) host.appendChild(wrapper);
      controller.notify();
    };
    place();
    editor.on("transaction", place);
    return () => {
      editor.off("transaction", place);
    };
  }, [controller, editor]);
  // The menu keeps the block it was opened on, because the handle follows the pointer.
  const [menu, setMenu] = useState<{ target: BlockTarget; left: number; top: number } | null>(null);
  const target = { current: menu?.target ?? current };
  const convertible = Boolean(menu && CONVERTIBLE.has(menu.target.node.type.name));
  const closeMenu = () => {
    setMenu(null);
    editor.commands.setMeta("lockDragHandle", false);
  };

  const turnIntoOptions: Array<[TurnIntoTarget, string]> = [
    ["paragraph", t("editorToolbar.paragraph")],
    ["h1", t("editorToolbar.heading1")],
    ["h2", t("editorToolbar.heading2")],
    ["h3", t("editorToolbar.heading3")],
    ["bullet", t("editorToolbar.bulletList")],
    ["ordered", t("editorToolbar.orderedList")],
    ["task", t("editorToolbar.taskList")],
    ["quote", t("editorToolbar.quote")],
    ["code", t("editorToolbar.codeBlock")],
    ["callout", t("pages.callout")],
    ["toggle", t("editorToolbar.fold")],
  ];

  const insertBelow = () => {
    const current = target.current;
    if (!current) return;
    const after = current.pos + current.node.nodeSize;
    editor.chain().focus()
      .insertContentAt(after, { type: "paragraph", content: [{ type: "text", text: "/" }] })
      .setTextSelection(after + 2)
      .run();
  };

  const paintBlock = (color: PageColor | null) => {
    const current = target.current;
    if (!current) return;
    editor.chain().focus().command(({ tr }) => {
      tr.doc.nodesBetween(current.pos, current.pos + current.node.nodeSize, (node, pos) => {
        if (!node.type.spec.attrs?.blockColor) return true;
        tr.setNodeAttribute(pos, "blockColor", color);
        return false;
      });
      return true;
    }).run();
  };

  const copyBlockLink = () => {
    const current = target.current;
    if (!current || !pageLink) return;
    let id = "";
    let at: number | null = null;
    editor.state.doc.nodesBetween(current.pos, current.pos + current.node.nodeSize, (node, pos) => {
      if (at !== null) return false;
      if (!node.type.spec.attrs?.blockId) return true;
      at = pos;
      id = typeof node.attrs.blockId === "string" ? node.attrs.blockId : "";
      return false;
    });
    if (at === null) return;
    if (!id) {
      id = crypto.randomUUID().slice(0, 12);
      const position = at;
      editor.chain().command(({ tr }) => {
        tr.setNodeAttribute(position, "blockId", id);
        return true;
      }).run();
    }
    void copyTextToClipboard(`${pageLink}#block=${id}`);
  };

  const pages = usePages();
  const viewer = useViewer();
  const [moveFailed, setMoveFailed] = useState(false);
  const moveTargets = pages
    ? pages.nodes.filter((page) => page.id !== pageId && !page.databaseId).sort((a, b) => b.updatedAt.localeCompare(a.updatedAt)).slice(0, 200)
    : [];

  const moveBlock = async (memoId: string) => {
    const current = target.current;
    if (!current || !pages) return;
    const { node, pos } = current;
    const parent = editor.state.doc.resolve(pos).parent;
    const single = node.toJSON() as Record<string, unknown>;
    const block = node.type.name === "listItem" || node.type.name === "taskItem"
      ? { type: parent.type.name, attrs: parent.attrs, content: [single] }
      : single;
    try {
      setMoveFailed(false);
      await appendBlockToPage({ memoId, block, schema: editor.schema, repository: pages.repository, viewer });
    } catch {
      setMoveFailed(true);
      return;
    }
    // Live editing can shift the block while the other page is saved; then leave it rather than remove something else.
    if (editor.state.doc.nodeAt(pos)?.eq(node)) {
      editor.chain().deleteRange({ from: pos, to: pos + node.nodeSize }).run();
    }
  };

  const duplicate = () => {
    const current = target.current;
    if (!current) return;
    editor.chain().focus().insertContentAt(current.pos + current.node.nodeSize, current.node.toJSON()).run();
  };

  const remove = () => {
    const current = target.current;
    if (!current) return;
    editor.chain().focus().deleteRange({ from: current.pos, to: current.pos + current.node.nodeSize }).run();
  };

  return (
    <>
      {moveFailed ? <span className="sr-only" role="alert">{t("pages.block.moveFailed")}</span> : null}
      {createPortal(
        <>
          <button type="button" aria-label={t("pages.addBlockBelow")} onClick={insertBelow}>
            <Plus className="h-4 w-4" aria-hidden="true" />
          </button>
          <button
            type="button"
            aria-label={t("pages.blockMenu")}
            data-block-grip
            onClick={(event) => {
              if (!current) return;
              const rect = event.currentTarget.getBoundingClientRect();
              editor.commands.setMeta("lockDragHandle", true);
              setMenu({ target: current, left: rect.left, top: rect.top });
            }}
          >
            <GripVertical className="h-4 w-4" aria-hidden="true" />
          </button>
        </>,
        handleElement,
      )}
      <DropdownMenu open={Boolean(menu)} onOpenChange={(open) => { if (!open) closeMenu(); }}>
        <DropdownMenuTrigger asChild>
          <span aria-hidden="true" style={{ position: "fixed", left: menu?.left ?? 0, top: menu?.top ?? 0, width: 1, height: 24, pointerEvents: "none" }} />
        </DropdownMenuTrigger>
        <DropdownMenuContent align="start" side="left" className="w-56" onCloseAutoFocus={(event) => event.preventDefault()}>
          <MenuSearch placeholder={t("pages.block.searchActions")} />
          {convertible ? (
            <DropdownMenuSub>
              <DropdownMenuSubTrigger>
                <Repeat2 className="h-4 w-4" aria-hidden="true" />
                {t("pages.turnInto")}
              </DropdownMenuSubTrigger>
              <DropdownMenuSubContent className="w-44">
                {turnIntoOptions.map(([id, label]) => (
                  <DropdownMenuItem key={id} onSelect={() => menu && turnInto(editor, menu.target.pos, id)}>
                    {label}
                  </DropdownMenuItem>
                ))}
              </DropdownMenuSubContent>
            </DropdownMenuSub>
          ) : null}
          <DropdownMenuSub>
            <DropdownMenuSubTrigger>
              <Baseline className="h-4 w-4" aria-hidden="true" />
              {t("pages.color.label")}
            </DropdownMenuSubTrigger>
            <DropdownMenuSubContent className="max-h-80 w-52 overflow-y-auto">
              <div className="px-2 pb-0.5 pt-1 text-xs font-medium text-slate-500" data-menu-note>{t("pages.color.text")}</div>
              <DropdownMenuItem onSelect={() => paintBlock(null)}><ColorSwatch />{t("pages.color.default")}</DropdownMenuItem>
              {PAGE_COLORS.map((color) => (
                <DropdownMenuItem key={color} onSelect={() => paintBlock(color)}><ColorSwatch color={color} />{t(`pages.color.${color}`)}</DropdownMenuItem>
              ))}
              <div className="px-2 pb-0.5 pt-1 text-xs font-medium text-slate-500" data-menu-note>{t("pages.color.background")}</div>
              {PAGE_COLORS.map((color) => (
                <DropdownMenuItem key={color} onSelect={() => paintBlock(`${color}_background`)}><ColorSwatch color={`${color}_background`} />{t(`pages.color.${color}Background`)}</DropdownMenuItem>
              ))}
            </DropdownMenuSubContent>
          </DropdownMenuSub>
          {pageLink ? (
            <DropdownMenuItem onSelect={copyBlockLink}>
              <Link2 className="h-4 w-4" aria-hidden="true" />
              {t("pages.block.copyLink")}
            </DropdownMenuItem>
          ) : null}
          {pages ? (
            <DropdownMenuSub>
              <DropdownMenuSubTrigger>
                <CornerUpRight className="h-4 w-4" aria-hidden="true" />
                {t("pages.block.moveTo")}
              </DropdownMenuSubTrigger>
              <DropdownMenuSubContent className="max-h-80 w-60 overflow-y-auto">
                <MenuSearch placeholder={t("pages.block.movePlaceholder")} />
                {moveTargets.map((page) => (
                  <DropdownMenuItem key={page.id} onSelect={() => void moveBlock(page.id)}>
                    <span className="truncate">{page.title?.trim() || t("common.untitledMemo")}</span>
                  </DropdownMenuItem>
                ))}
              </DropdownMenuSubContent>
            </DropdownMenuSub>
          ) : null}
          <DropdownMenuItem onSelect={duplicate}>
            <Copy className="h-4 w-4" aria-hidden="true" />
            {t("pages.duplicateBlock")}
          </DropdownMenuItem>
          <DropdownMenuSeparator />
          <DropdownMenuItem className="text-rose-700" onSelect={remove}>
            <Trash2 className="h-4 w-4" aria-hidden="true" />
            {t("pages.deleteBlock")}
          </DropdownMenuItem>
          <DropdownMenuSeparator />
          {onComment ? (
            <DropdownMenuItem onSelect={() => menu && onComment(menu.target.pos, menu.target.node)}>
              <MessageSquare className="h-4 w-4" aria-hidden="true" />
              {t("pages.comments.onBlock")}
            </DropdownMenuItem>
          ) : null}
          {onAskAi ? (
            <DropdownMenuItem onSelect={() => menu && onAskAi(menu.target.pos, menu.target.node)}>
              <Sparkles className="h-4 w-4" aria-hidden="true" />
              {t("pages.blockAskAi")}
            </DropdownMenuItem>
          ) : null}
          {onSkill ? (
            <DropdownMenuSub>
              <DropdownMenuSubTrigger>
                <Sparkles className="h-4 w-4" aria-hidden="true" />
                {t("pages.block.skills")}
              </DropdownMenuSubTrigger>
              <DropdownMenuSubContent className="w-44">
                {(["improve", "proofread", "explain", "reformat", "translate"] as const).map((kind) => (
                  <DropdownMenuItem key={kind} onSelect={() => menu && onSkill(kind, menu.target.pos, menu.target.node)}>{t(`pages.skills.${kind}`)}</DropdownMenuItem>
                ))}
              </DropdownMenuSubContent>
            </DropdownMenuSub>
          ) : null}
        </DropdownMenuContent>
      </DropdownMenu>
    </>
  );
};
