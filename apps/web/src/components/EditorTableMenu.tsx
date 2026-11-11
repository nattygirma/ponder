import { useEditorState, type Editor } from "@tiptap/react";
import { Table } from "lucide-react";
import { useTranslation } from "react-i18next";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";

/**
 * The toolbar's table button inserts Notion's 3 × 3 table. Rows, columns, colours and merges are
 * edited on the table itself, with its handles, `+` bars and cell menu.
 */
export const EditorTableMenu = ({ editor, readOnly }: { editor: Editor | null; readOnly: boolean }) => {
  const { t } = useTranslation();
  const inTable = Boolean(useEditorState({ editor, selector: ({ editor: active }) => active?.isActive("table") ?? false }));
  const disabled = readOnly || !editor || editor.isDestroyed || inTable;
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <button
          className={cn(
            "flex h-8 w-8 shrink-0 items-center justify-center rounded-md transition disabled:pointer-events-none disabled:opacity-40",
            inTable ? "bg-slate-200/80 text-slate-900" : "bg-transparent text-slate-500 hover:bg-slate-100 hover:text-slate-800",
          )}
          type="button"
          aria-label={t("editorToolbar.insertTable")}
          aria-pressed={inTable || undefined}
          disabled={disabled}
          onClick={() => editor?.chain().focus().insertTable({ rows: 3, cols: 3 }).run()}
        >
          <Table aria-hidden="true" className="h-4 w-4" />
        </button>
      </TooltipTrigger>
      <TooltipContent side="bottom">{t("editorToolbar.insertTable")}</TooltipContent>
    </Tooltip>
  );
};
