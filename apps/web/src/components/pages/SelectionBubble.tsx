import { useState, type ReactNode } from "react";
import { TextSelection } from "@tiptap/pm/state";
import type { Editor } from "@tiptap/react";
import { Bold, ChevronRight, Code, Italic, Baseline, Link2, MessageSquare, Radical, RemoveFormatting, Strikethrough, Underline } from "lucide-react";
import { useTranslation } from "react-i18next";
import { cn } from "@/lib/utils";
import { PAGE_COLORS, type PageColor } from "@ponder/shared/page-color";
import { TURN_INTO_TARGETS, turnInto, useTurnIntoLabels, type TurnIntoTarget } from "./BlockHandle";
import { AiFaceIcon } from "../AiFaceIcon";

/** Stable so the bubble doesn't dispatch an options update on every editor transaction. */
export const SELECTION_BUBBLE_OPTIONS = { placement: "bottom-start" as const, offset: 6 };

export const shouldShowSelectionBubble = ({ editor }: { editor: Editor }) => {
  const { selection } = editor.state;
  return editor.isEditable
    && editor.view.hasFocus()
    && selection instanceof TextSelection
    && !selection.empty
    && !editor.isActive("codeBlock");
};

const currentBlock = (editor: Editor): TurnIntoTarget => {
  if (editor.isActive("heading", { level: 1 })) return "h1";
  if (editor.isActive("heading", { level: 2 })) return "h2";
  if (editor.isActive("heading", { level: 3 })) return "h3";
  if (editor.isActive("taskList")) return "task";
  if (editor.isActive("bulletList")) return "bullet";
  if (editor.isActive("orderedList")) return "ordered";
  if (editor.isActive("blockquote")) return "quote";
  if (editor.isActive("details")) return "toggle";
  return "paragraph";
};

const IconButton = ({ label, active, onClick, children }: { label: string; active?: boolean; onClick: () => void; children: ReactNode }) => (
  <button
    type="button"
    aria-label={label}
    aria-pressed={active}
    className={cn("flex h-7 items-center justify-center rounded text-slate-700 hover:bg-slate-100", active && "text-sky-600")}
    onClick={onClick}
  >
    {children}
  </button>
);

const MenuRow = ({ icon, onClick, expanded, trailing, children }: { icon?: ReactNode; onClick: () => void; expanded?: boolean; trailing?: ReactNode; children: ReactNode }) => (
  <button
    type="button"
    aria-expanded={expanded}
    className="flex h-7 w-full items-center gap-2 rounded px-2 text-left text-sm text-slate-700 hover:bg-slate-100"
    onClick={onClick}
  >
    {icon}
    <span className="min-w-0 flex-1 truncate">{children}</span>
    {trailing}
  </button>
);

export const ColorSwatch = ({ color }: { color?: PageColor }) => (
  <span className="flex h-5 w-5 shrink-0 items-center justify-center rounded border border-slate-200 text-xs font-medium" data-page-color={color}>A</span>
);

const Rule = () => <div className="mx-1 my-1 h-px bg-slate-200" />;

/**
 * The menu under selected text. Everything stays inside the bubble rather than in portalled
 * menus, because moving focus out of the editor would close the bubble.
 */
export const SelectionBubble = ({ editor, showAi, onAsk, onExplain, onTranslate, onSkill, onComment, onLink, onMath, linkActive }: {
  editor: Editor;
  showAi: boolean;
  onAsk: () => void;
  onExplain: () => void;
  onTranslate: () => void;
  onSkill: (kind: "improve" | "proofread" | "reformat") => void;
  onComment: () => void;
  onLink: () => void;
  onMath: () => void;
  linkActive: boolean;
}) => {
  const { t } = useTranslation();
  const [panel, setPanel] = useState<"turn" | "color" | null>(null);
  const turnOpen = panel === "turn";
  const colorOpen = panel === "color";
  const turnLabels = useTurnIntoLabels();
  // The schema is gone for a moment while the editor is swapped for another page's, so this must not throw then.
  const hasMark = (name: string) => Boolean(editor.schema?.marks[name]);
  const apply = (name: string) => editor.chain().focus().toggleMark(name).run();
  const turn = (target: TurnIntoTarget) => {
    const { $from } = editor.state.selection;
    setPanel(null);
    turnInto(editor, $from.before($from.depth), target);
  };
  const paint = (color: PageColor | null) => {
    setPanel(null);
    const chain = editor.chain().focus();
    if (color) chain.setMark("pageColor", { color }).run();
    else chain.unsetMark("pageColor").run();
  };
  const icon = "h-4 w-4";

  return (
    <div
      role="toolbar"
      aria-label={t("pages.bubble.toolbar")}
      className="relative w-48 rounded-lg border border-slate-200 bg-card p-1 shadow-lg"
      data-selection-bubble=""
      onMouseDown={(event) => event.preventDefault()}
    >
      <MenuRow expanded={turnOpen} onClick={() => setPanel((open) => (open === "turn" ? null : "turn"))} trailing={<ChevronRight className="h-3.5 w-3.5 text-slate-400" aria-hidden="true" />}>
        {turnLabels[currentBlock(editor)]}
      </MenuRow>
      <Rule />
      <div className="grid grid-cols-5 gap-0.5">
        <IconButton label={t("pages.color.label")} active={colorOpen} onClick={() => setPanel((open) => (open === "color" ? null : "color"))}><Baseline className={icon} aria-hidden="true" /></IconButton>
        <IconButton label={t("pages.bubble.bold")} active={editor.isActive("bold")} onClick={() => apply("bold")}><Bold className={icon} aria-hidden="true" /></IconButton>
        <IconButton label={t("pages.bubble.italic")} active={editor.isActive("italic")} onClick={() => apply("italic")}><Italic className={icon} aria-hidden="true" /></IconButton>
        {hasMark("underline") ? (
          <IconButton label={t("pages.bubble.underline")} active={editor.isActive("underline")} onClick={() => apply("underline")}><Underline className={icon} aria-hidden="true" /></IconButton>
        ) : <span />}
        <IconButton label={t("pages.bubble.clear")} onClick={() => editor.chain().focus().unsetAllMarks().run()}><RemoveFormatting className={icon} aria-hidden="true" /></IconButton>
        <IconButton label={t("pages.bubble.link")} active={linkActive} onClick={onLink}><Link2 className={icon} aria-hidden="true" /></IconButton>
        <IconButton label={t("pages.bubble.strike")} active={editor.isActive("strike")} onClick={() => apply("strike")}><Strikethrough className={icon} aria-hidden="true" /></IconButton>
        <IconButton label={t("pages.bubble.code")} active={editor.isActive("code")} onClick={() => apply("code")}><Code className={icon} aria-hidden="true" /></IconButton>
        <IconButton label={t("pages.bubble.math")} onClick={onMath}><Radical className={icon} aria-hidden="true" /></IconButton>
      </div>
      <Rule />
      <MenuRow icon={<MessageSquare className="h-4 w-4 shrink-0" aria-hidden="true" />} onClick={onComment}>
        <span data-comment-selection="">{t("pages.bubble.comment")}</span>
      </MenuRow>
      {showAi ? (
        <>
          <Rule />
          <div className="px-2 pb-0.5 pt-1 text-xs font-medium text-slate-500">{t("pages.bubble.ai")}</div>
          <MenuRow onClick={() => onSkill("improve")}>{t("pages.skills.improve")}</MenuRow>
          <MenuRow onClick={() => onSkill("proofread")}>{t("pages.skills.proofread")}</MenuRow>
          <MenuRow onClick={onExplain}>{t("pages.skills.explain")}</MenuRow>
          <MenuRow onClick={() => onSkill("reformat")}>{t("pages.skills.reformat")}</MenuRow>
          <MenuRow onClick={onTranslate}>{t("pages.skills.translate")}</MenuRow>
          <MenuRow icon={<AiFaceIcon className="h-4 w-4 shrink-0" aria-hidden="true" />} onClick={onAsk}>{t("pages.bubble.askAi")}</MenuRow>
        </>
      ) : null}

      {colorOpen ? (
        <div className="absolute left-full top-0 z-10 ml-1 max-h-80 w-48 overflow-y-auto rounded-lg border border-slate-200 bg-card p-1 shadow-lg" data-selection-panel="color">
          <div className="px-2 pb-0.5 pt-1 text-xs font-medium text-slate-500">{t("pages.color.text")}</div>
          <MenuRow icon={<ColorSwatch />} onClick={() => paint(null)}>{t("pages.color.default")}</MenuRow>
          {PAGE_COLORS.map((color) => (
            <MenuRow key={color} icon={<ColorSwatch color={color} />} onClick={() => paint(color)}>{t(`pages.color.${color}`)}</MenuRow>
          ))}
          <div className="px-2 pb-0.5 pt-1 text-xs font-medium text-slate-500">{t("pages.color.background")}</div>
          <MenuRow icon={<ColorSwatch />} onClick={() => paint(null)}>{t("pages.color.defaultBackground")}</MenuRow>
          {PAGE_COLORS.map((color) => (
            <MenuRow key={color} icon={<ColorSwatch color={`${color}_background`} />} onClick={() => paint(`${color}_background`)}>{t(`pages.color.${color}Background`)}</MenuRow>
          ))}
        </div>
      ) : null}

      {turnOpen ? (
        <div className="absolute left-full top-0 z-10 ml-1 max-h-72 w-44 overflow-y-auto rounded-lg border border-slate-200 bg-card p-1 shadow-lg" data-selection-panel="turn">
          {TURN_INTO_TARGETS.map((target) => (
            <MenuRow key={target} onClick={() => turn(target)}>{turnLabels[target]}</MenuRow>
          ))}
        </div>
      ) : null}
    </div>
  );
};
