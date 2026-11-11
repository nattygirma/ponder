import { useState, type ReactNode } from "react";
import { useTranslation } from "react-i18next";
import { MousePointerClick } from "lucide-react";
import {
  AutomationActionSchema,
  BUTTON_ACTION_TYPES,
  safeButtonUrl,
  type ActionOutcome,
  type AutomationAction,
  type AutomationActionType,
  type DatabaseProperty,
  type DatabaseRow,
  type DatabaseSchema,
} from "@ponder/shared";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogTitle } from "@/components/ui/dialog";
import { PopoverContainer } from "@/components/ui/popover";
import { cn } from "@/lib/utils";
import { api } from "@/lib/api";
import { ActionsEditor } from "./ActionsEditor";
import { outcomeText, showActionToast } from "./action-toast";
import { databaseRowsKey, type DatabaseHandle } from "./useDatabase";
import { useQueryClient } from "@tanstack/react-query";

/** A Button property's stored actions, keeping only the ones that still parse. */
export const buttonActions = (property: DatabaseProperty): AutomationAction[] =>
  (property.button?.actions ?? []).flatMap((item) => {
    const parsed = AutomationActionSchema.safeParse(item);
    return parsed.success ? [parsed.data] : [];
  });

const errorText = (error: unknown) => (error instanceof Error && error.message ? error.message : "Something went wrong.");

/** Notion's button editor: "When / Button is clicked", then "Do" and the actions. */
export const ButtonEditorDialog = ({ title, actions: initial, allowed, schema, databaseId, problem, onSave, onClose, extra }: {
  title: string;
  actions: AutomationAction[];
  allowed: AutomationActionType[];
  schema: DatabaseSchema | null;
  databaseId: string | null;
  problem?: string | null;
  onSave: (actions: AutomationAction[]) => void | Promise<void>;
  onClose: () => void;
  /** Above "When": the /button block's name and icon. */
  extra?: ReactNode;
}) => {
  const { t } = useTranslation();
  const [actions, setActions] = useState(initial);
  const [content, setContent] = useState<HTMLDivElement | null>(null);
  return (
    <Dialog open onOpenChange={(open) => { if (!open) onClose(); }}>
      {/* Menus open in the dialog itself, which doesn't scroll, so they aren't cut off at its edge. */}
      <DialogContent ref={setContent} className="flex max-h-[85vh] max-w-lg flex-col gap-0 p-0" data-button-editor>
        <PopoverContainer.Provider value={content}>
          <div className="min-h-0 space-y-4 overflow-y-auto p-5">
          <DialogTitle className="text-base font-semibold">{title}</DialogTitle>
          <DialogDescription className="sr-only">{t("pages.db.button.edit")}</DialogDescription>
          {problem ? <p className="rounded-md bg-red-50 px-3 py-2 text-sm text-red-700" role="alert">{problem}</p> : null}
          {extra}
          <section className="space-y-1.5">
            <h3 className="text-xs font-medium text-slate-500">{t("pages.db.automations.when")}</h3>
            <div className="flex items-center gap-2 rounded-lg border border-slate-200 px-3 py-2 text-sm">
              <MousePointerClick className="h-4 w-4 text-slate-500" aria-hidden="true" />{t("pages.db.button.clicked")}
            </div>
          </section>
          <section className="space-y-1.5">
            <h3 className="text-xs font-medium text-slate-500">{t("pages.db.automations.do")}</h3>
            <ActionsEditor actions={actions} onChange={setActions} allowed={allowed} schema={schema} databaseId={databaseId} />
            <p className="text-xs text-slate-400">{t("pages.db.automations.placeholders", { example: "{{Name}}" })}</p>
          </section>
          <div className="flex justify-end gap-2 pt-1">
            <Button type="button" variant="ghost" size="sm" onClick={onClose}>{t("pages.db.automations.cancel")}</Button>
            <Button type="button" size="sm" className="bg-[#2383e2] text-white hover:bg-[#0077d4]" onClick={() => void Promise.resolve(onSave(actions)).then(onClose)} data-save-button>{t("pages.db.automations.save")}</Button>
          </div>
          </div>
        </PopoverContainer.Provider>
      </DialogContent>
    </Dialog>
  );
};

/** Asks the "Show confirmation" question in a small dialog, like Notion's. */
const ConfirmDialog = ({ message, onAnswer }: { message: string; onAnswer: (yes: boolean) => void }) => {
  const { t } = useTranslation();
  return (
    <Dialog open onOpenChange={(open) => { if (!open) onAnswer(false); }}>
      <DialogContent className="max-w-sm p-5" data-button-confirm>
        <DialogTitle className="text-sm font-medium">{message || t("pages.db.automations.confirmationPlaceholder")}</DialogTitle>
        <DialogDescription className="sr-only">{t("pages.db.automations.actions.show_confirmation")}</DialogDescription>
        <div className="flex justify-end gap-2">
          <Button type="button" variant="ghost" size="sm" onClick={() => onAnswer(false)}>{t("pages.db.button.cancel")}</Button>
          <Button type="button" size="sm" autoFocus onClick={() => onAnswer(true)}>{t("pages.db.button.confirm")}</Button>
        </div>
      </DialogContent>
    </Dialog>
  );
};

/**
 * Runs a button: asks first if it has "Show confirmation", has the server run the rest,
 * opens its URL, and says what happened.
 */
export const useButtonRunner = () => {
  const { t } = useTranslation();
  const [question, setQuestion] = useState<{ message: string; resolve: (yes: boolean) => void } | null>(null);
  const [running, setRunning] = useState(false);
  const run = async (actions: AutomationAction[], send: () => Promise<{ outcome: ActionOutcome }>, onInvalid?: (problem: string) => void) => {
    if (actions.length === 0) {
      onInvalid?.(t("pages.db.button.noActions"));
      return;
    }
    for (const action of actions) {
      if (action.type !== "show_confirmation") continue;
      const yes = await new Promise<boolean>((resolve) => setQuestion({ message: action.message, resolve }));
      setQuestion(null);
      if (!yes) return;
    }
    const serverSide = actions.some((action) => action.type !== "show_confirmation" && action.type !== "open_url");
    setRunning(true);
    try {
      if (serverSide) {
        const { outcome } = await send();
        showActionToast(outcomeText(outcome, t), { dismissLabel: t("pages.db.button.dismiss") });
      }
      for (const action of actions) {
        if (action.type !== "open_url") continue;
        const url = safeButtonUrl(action.url);
        if (url) window.open(url, url.startsWith("/") ? "_self" : "_blank", "noopener");
      }
    } catch (error) {
      const message = errorText(error);
      showActionToast(message, { tone: "error", dismissLabel: t("pages.db.button.dismiss") });
      onInvalid?.(message);
    } finally {
      setRunning(false);
    }
  };
  const dialog = question ? <ConfirmDialog message={question.message} onAnswer={question.resolve} /> : null;
  return { run, running, dialog };
};

/** A Button property's editor, opened from the property menu or from a button that can't run. */
export const ButtonPropertyEditor = ({ db, property, problem, onClose }: { db: DatabaseHandle; property: DatabaseProperty; problem?: string | null; onClose: () => void }) => (
  <ButtonEditorDialog
    title={property.name}
    actions={buttonActions(property)}
    allowed={BUTTON_ACTION_TYPES}
    schema={db.database.schema}
    databaseId={db.database.id}
    problem={problem}
    onSave={(actions) => db.updateSchema({
      properties: db.database.schema.properties.map((item) => (item.id === property.id ? { ...item, button: { actions } } : item)),
    })}
    onClose={onClose}
  />
);

/** The button in a table cell: Notion's small outlined button labelled with the property's name. */
export const ButtonCell = ({ db, row, property, readOnly }: { db: DatabaseHandle; row: DatabaseRow; property: DatabaseProperty; readOnly?: boolean }) => {
  const { t } = useTranslation();
  const queryClient = useQueryClient();
  const [problem, setProblem] = useState<string | null>(null);
  const runner = useButtonRunner();
  const actions = buttonActions(property);
  const click = () => void runner.run(
    actions,
    async () => {
      const result = await api.clickDatabaseButton(db.database.id, row.id, property.id);
      // The button's edits and the automations they set off.
      await queryClient.invalidateQueries({ queryKey: databaseRowsKey(db.database.id) });
      window.setTimeout(() => void queryClient.invalidateQueries({ queryKey: ["database-rows"] }), 1500);
      return result;
    },
    (message) => setProblem(message),
  );
  return (
    <>
      <button
        type="button"
        disabled={readOnly || runner.running}
        className={cn(
          "inline-flex max-w-full items-center gap-1 truncate rounded-md border border-slate-300 bg-white px-2 py-0.5 text-xs font-medium text-slate-700 shadow-sm hover:bg-slate-50",
          "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#2383e2] disabled:opacity-60",
        )}
        onClick={(event) => { event.stopPropagation(); click(); }}
        data-button-cell={property.id}
      >
        <span className="truncate">{runner.running ? t("pages.db.button.running") : property.name}</span>
      </button>
      {runner.dialog}
      {problem !== null ? <ButtonPropertyEditor db={db} property={property} problem={problem} onClose={() => setProblem(null)} /> : null}
    </>
  );
};
