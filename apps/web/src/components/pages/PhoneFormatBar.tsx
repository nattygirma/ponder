import { useEffect, useReducer, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { useTranslation } from "react-i18next";
import type { Editor } from "@tiptap/react";
import {
  AtSign, Bold, ChevronDown, IndentDecrease, IndentIncrease, Italic, List, ListOrdered, ListTodo, Paperclip, Plus, Redo2, Strikethrough, Undo2,
} from "lucide-react";
import { cn } from "@/lib/utils";

/** How far the on-screen keyboard pushes into the page, from the visual viewport. 0 when it is closed. */
const useKeyboardInset = () => {
  const [inset, setInset] = useState(0);
  useEffect(() => {
    const viewport = window.visualViewport;
    if (!viewport) return;
    const update = () => setInset(Math.max(0, Math.round(window.innerHeight - viewport.height - viewport.offsetTop)));
    update();
    viewport.addEventListener("resize", update);
    viewport.addEventListener("scroll", update);
    return () => {
      viewport.removeEventListener("resize", update);
      viewport.removeEventListener("scroll", update);
    };
  }, []);
  return inset;
};

const listItemType = (editor: Editor) => (editor.isActive("taskItem") ? "taskItem" : "listItem");

/**
 * The formatting bar a phone shows above its keyboard while a page is being written, like Notion's.
 * Buttons keep the editor focused, so the keyboard stays up while you tap them.
 */
export const PhoneFormatBar = ({ editor, onPickFile }: { editor: Editor | null; onPickFile?: () => void }) => {
  const { t } = useTranslation();
  const inset = useKeyboardInset();
  const [focused, setFocused] = useState(false);
  const [, rerender] = useReducer((count: number) => count + 1, 0);

  useEffect(() => {
    if (!editor) return;
    let blurTimer: number | undefined;
    const onFocus = () => {
      window.clearTimeout(blurTimer);
      setFocused(true);
    };
    // A short grace period, so moving focus to a menu the bar opened doesn't make the bar flicker.
    const onBlur = () => {
      blurTimer = window.setTimeout(() => setFocused(editor.isFocused), 120);
    };
    setFocused(editor.isFocused);
    editor.on("focus", onFocus);
    editor.on("blur", onBlur);
    editor.on("transaction", rerender);
    return () => {
      window.clearTimeout(blurTimer);
      editor.off("focus", onFocus);
      editor.off("blur", onBlur);
      editor.off("transaction", rerender);
    };
  }, [editor]);

  if (!editor || !editor.isEditable || !focused) return null;

  const run = (command: (chain: ReturnType<Editor["chain"]>) => ReturnType<Editor["chain"]>) => () => {
    command(editor.chain().focus()).run();
  };
  const type = listItemType(editor);
  const buttons: { id: string; label: string; icon: ReactNode; onClick: () => void; active?: boolean; disabled?: boolean }[] = [
    { id: "insert", label: t("pages.phoneBar.insert"), icon: <Plus />, onClick: run((chain) => chain.insertContent("/")) },
    { id: "mention", label: t("pages.phoneBar.mention"), icon: <AtSign />, onClick: run((chain) => chain.insertContent("@")) },
    { id: "taskList", label: t("editorToolbar.taskList"), icon: <ListTodo />, onClick: run((chain) => chain.toggleTaskList()), active: editor.isActive("taskList") },
    { id: "bulletList", label: t("editorToolbar.bulletList"), icon: <List />, onClick: run((chain) => chain.toggleBulletList()), active: editor.isActive("bulletList") },
    { id: "orderedList", label: t("editorToolbar.orderedList"), icon: <ListOrdered />, onClick: run((chain) => chain.toggleOrderedList()), active: editor.isActive("orderedList") },
    { id: "bold", label: t("editorToolbar.bold"), icon: <Bold />, onClick: run((chain) => chain.toggleBold()), active: editor.isActive("bold") },
    { id: "italic", label: t("editorToolbar.italic"), icon: <Italic />, onClick: run((chain) => chain.toggleItalic()), active: editor.isActive("italic") },
    { id: "strike", label: t("editorToolbar.strike"), icon: <Strikethrough />, onClick: run((chain) => chain.toggleStrike()), active: editor.isActive("strike") },
    { id: "indent", label: t("pages.phoneBar.indent"), icon: <IndentIncrease />, onClick: run((chain) => chain.sinkListItem(type)), disabled: !editor.can().sinkListItem(type) },
    { id: "outdent", label: t("pages.phoneBar.outdent"), icon: <IndentDecrease />, onClick: run((chain) => chain.liftListItem(type)), disabled: !editor.can().liftListItem(type) },
    ...(onPickFile ? [{ id: "file", label: t("editorToolbar.attachment"), icon: <Paperclip />, onClick: onPickFile }] : []),
    { id: "undo", label: t("editorToolbar.undo"), icon: <Undo2 />, onClick: run((chain) => chain.undo()), disabled: !editor.can().undo() },
    { id: "redo", label: t("editorToolbar.redo"), icon: <Redo2 />, onClick: run((chain) => chain.redo()), disabled: !editor.can().redo() },
  ];

  return createPortal(
    <div
      role="toolbar"
      aria-label={t("pages.phoneBar.label")}
      data-phone-format-bar=""
      className="fixed inset-x-0 z-40 flex h-11 items-center border-t border-slate-200 bg-[var(--workspace-editor,white)] sm:hidden"
      style={{ bottom: inset, paddingBottom: inset ? 0 : "env(safe-area-inset-bottom)" }}
    >
      <div className="flex min-w-0 flex-1 items-center overflow-x-auto px-1 [scrollbar-width:none]">
        {buttons.map((button) => (
          <button
            key={button.id}
            type="button"
            aria-label={button.label}
            aria-pressed={button.active}
            disabled={button.disabled}
            data-phone-format={button.id}
            className={cn(
              "flex h-9 w-10 shrink-0 items-center justify-center rounded-md text-slate-700 disabled:opacity-35 [&_svg]:h-[1.15rem] [&_svg]:w-[1.15rem]",
              button.active ? "bg-slate-200 text-slate-950" : "active:bg-slate-100",
            )}
            // Keep the editor focused, so the keyboard doesn't close on every tap.
            onPointerDown={(event) => event.preventDefault()}
            onClick={button.onClick}
          >
            {button.icon}
          </button>
        ))}
      </div>
      <button
        type="button"
        aria-label={t("pages.phoneBar.done")}
        data-phone-format="done"
        className="flex h-11 w-11 shrink-0 items-center justify-center border-l border-slate-200 text-slate-700 active:bg-slate-100"
        onPointerDown={(event) => event.preventDefault()}
        onClick={() => {
          editor.commands.blur();
          (document.activeElement as HTMLElement | null)?.blur();
        }}
      >
        <ChevronDown className="h-5 w-5" />
      </button>
    </div>,
    document.body,
  );
};
