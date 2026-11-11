import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { NodeViewWrapper, ReactNodeViewRenderer, type NodeViewProps } from "@tiptap/react";
import { Settings2 } from "lucide-react";
import { AutomationActionSchema, BUTTON_ACTION_TYPES, ButtonBlock, type AutomationAction } from "@ponder/shared";
import { Input } from "@/components/ui/input";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import { api } from "@/lib/api";
import { ButtonEditorDialog, useButtonRunner } from "@/components/database/ButtonProperty";

/** Set by the slash command, so the button just inserted opens its editor, as Notion's does. */
let openNextButton = false;
export const openNextButtonEditor = () => { openNextButton = true; };

/** A block's actions; "Edit property" needs a database row, which a block has none of. */
const BLOCK_ACTION_TYPES = BUTTON_ACTION_TYPES.filter((type) => type !== "edit_property");

const parseActions = (json: unknown): AutomationAction[] => {
  try {
    const parsed = JSON.parse(String(json || "[]")) as unknown;
    if (!Array.isArray(parsed)) return [];
    return parsed.flatMap((item) => {
      const action = AutomationActionSchema.safeParse(item);
      return action.success ? [action.data] : [];
    });
  } catch {
    return [];
  }
};

type ButtonBlockOptions = { getPageId: () => string | null };

const ButtonBlockView = ({ node, updateAttributes, editor, extension, selected }: NodeViewProps) => {
  const { t } = useTranslation();
  const [editing, setEditing] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);
  const [name, setName] = useState(String(node.attrs.label ?? ""));
  const [icon, setIcon] = useState(String(node.attrs.icon ?? ""));
  const runner = useButtonRunner();
  const actions = parseActions(node.attrs.actions);
  const label = String(node.attrs.label || t("pages.db.button.newButton"));
  // The page may become editable after the block first renders (it loads read-only), so follow it.
  const [editable, setEditable] = useState(editor.isEditable);
  useEffect(() => {
    const sync = () => setEditable(editor.isEditable);
    sync();
    editor.on("transaction", sync);
    editor.on("update", sync);
    return () => {
      editor.off("transaction", sync);
      editor.off("update", sync);
    };
  }, [editor]);
  const pageId = (extension.options as ButtonBlockOptions).getPageId();

  useEffect(() => {
    if (openNextButton && editable && actions.length === 0) {
      openNextButton = false;
      setEditing(true);
    }
    // Only on mount: the block that was just inserted.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const openEditor = (message: string | null = null) => {
    setName(String(node.attrs.label ?? ""));
    setIcon(String(node.attrs.icon ?? ""));
    setProblem(message);
    setEditing(true);
  };

  return (
    <NodeViewWrapper className="ponder-button-node group/button my-1 flex items-center gap-1" data-button-block contentEditable={false}>
      <button
        type="button"
        disabled={runner.running}
        className={`inline-flex max-w-full items-center gap-1.5 truncate rounded-md border border-slate-300 bg-white px-2.5 py-1 text-sm font-medium text-slate-700 shadow-sm hover:bg-slate-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#2383e2] disabled:opacity-60 dark:border-slate-600 dark:bg-slate-800 dark:text-slate-100 ${selected ? "ring-2 ring-[#2383e2]/40" : ""}`}
        onClick={() => void runner.run(
          actions,
          () => api.runButtonBlock({ pageId: pageId ?? undefined, actions }),
          editable ? (message) => openEditor(message) : undefined,
        )}
      >
        {node.attrs.icon ? <span aria-hidden="true">{String(node.attrs.icon)}</span> : null}
        <span className="truncate">{runner.running ? t("pages.db.button.running") : label}</span>
      </button>
      {editable ? (
        <TooltipProvider delayDuration={200}>
          <Tooltip>
            <TooltipTrigger asChild>
              <button
                type="button"
                aria-label={t("pages.db.button.edit")}
                className="rounded p-1 text-slate-400 opacity-0 hover:bg-slate-100 focus-visible:opacity-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#2383e2] group-hover/button:opacity-100 max-lg:opacity-100"
                onClick={() => openEditor()}
                data-edit-button-block
              >
                <Settings2 className="h-3.5 w-3.5" aria-hidden="true" />
              </button>
            </TooltipTrigger>
            <TooltipContent>{t("pages.db.button.edit")}</TooltipContent>
          </Tooltip>
        </TooltipProvider>
      ) : null}
      {runner.dialog}
      {editing ? (
        <ButtonEditorDialog
          title={name || t("pages.db.button.newButton")}
          actions={actions}
          allowed={BLOCK_ACTION_TYPES}
          schema={null}
          databaseId={null}
          problem={problem}
          extra={(
            <div className="flex items-center gap-2">
              <Input className="h-9 w-14 text-center text-lg" maxLength={8} value={icon} placeholder="🔘" aria-label={t("pages.db.button.icon")} onChange={(event) => setIcon(event.target.value)} />
              <Input className="h-9" value={name} placeholder={t("pages.db.button.newButton")} aria-label={t("pages.db.button.name")} onChange={(event) => setName(event.target.value)} />
            </div>
          )}
          onSave={(next) => updateAttributes({ label: name.trim().slice(0, 120), icon: icon.trim(), actions: JSON.stringify(next) })}
          onClose={() => setEditing(false)}
        />
      ) : null}
    </NodeViewWrapper>
  );
};

export const EditorButtonBlock = ButtonBlock.extend<ButtonBlockOptions>({
  addOptions() {
    return { getPageId: () => null };
  },
  addNodeView() {
    // The block's own buttons and dialogs handle their events; the editor leaves them alone.
    return ReactNodeViewRenderer(ButtonBlockView, { stopEvent: () => true });
  },
});
