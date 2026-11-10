import { useEffect, useMemo, useReducer, useState } from "react";
import { useTranslation } from "react-i18next";
import type { Editor } from "@tiptap/core";
import { Check, PenLine, X } from "lucide-react";
import { selectSuggestion } from "@handlewithcare/prosemirror-suggest-changes";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { useWorkspaceMembers } from "@/components/comments/PageComments";
import {
  acceptAllSuggestions, acceptSuggestion, isSuggesting, listSuggestions, rejectAllSuggestions, rejectSuggestion, setSuggesting, type PageSuggestion,
} from "./suggest-edits";

const useEditorVersion = (editor: Editor | null) => {
  const [version, bump] = useReducer((count: number) => count + 1, 0);
  useEffect(() => {
    if (!editor) return;
    editor.on("transaction", bump);
    return () => {
      editor.off("transaction", bump);
    };
  }, [editor]);
  return version;
};

const clip = (text: string) => {
  const flat = text.replace(/\s+/g, " ").trim();
  return flat.length > 120 ? `${flat.slice(0, 119)}…` : flat;
};

/**
 * Above a page while anyone is suggesting, or while it has suggestions waiting: who suggested what,
 * with Accept and Reject for people who can edit. Notion's Suggest edits, in one bar.
 */
export const SuggestionsBar = ({ editor, canReview, viewerId }: { editor: Editor | null; canReview: boolean; viewerId: string | null }) => {
  const { t } = useTranslation();
  const version = useEditorVersion(editor);
  const [open, setOpen] = useState(false);
  const suggesting = isSuggesting(editor);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const suggestions = useMemo(() => (editor && !editor.isDestroyed ? listSuggestions(editor.state.doc) : []), [editor, version]);
  const members = useWorkspaceMembers(suggestions.length > 0);
  if (!editor || (!suggesting && suggestions.length === 0)) return null;

  const nameOf = (suggestion: PageSuggestion) => {
    if (suggestion.authorId && suggestion.authorId === viewerId) return t("pages.suggest.you");
    const member = members.data?.find((item) => item.id === suggestion.authorId);
    return member?.displayName || member?.username || t("pages.suggest.someone");
  };
  const countLabel = suggestions.length === 1 ? t("pages.suggest.countOne") : t("pages.suggest.count", { count: suggestions.length });

  return (
    <div className="mb-3 flex flex-wrap items-center gap-2 text-sm" data-suggestions-bar>
      {suggesting ? (
        <span className="inline-flex h-7 items-center gap-1.5 rounded-full bg-emerald-50 pl-2.5 pr-1 text-emerald-800 ring-1 ring-emerald-200" data-suggesting>
          <PenLine className="h-3.5 w-3.5" aria-hidden="true" />
          {t("pages.suggest.on")}
          <button type="button" className="h-6 rounded-full px-2 text-xs hover:bg-emerald-100" onClick={() => setSuggesting(editor, false)}>
            {t("pages.suggest.stop")}
          </button>
        </span>
      ) : null}
      {suggestions.length > 0 ? (
        <Popover open={open} onOpenChange={setOpen}>
          <PopoverTrigger asChild>
            <button type="button" className="h-7 rounded-full px-2.5 text-slate-700 ring-1 ring-slate-200 hover:bg-slate-100" data-suggestions-count>
              {countLabel}
            </button>
          </PopoverTrigger>
          <PopoverContent align="start" className="w-[min(22rem,calc(100vw-2rem))] p-1" data-suggestions-list>
            <div className="max-h-80 overflow-y-auto">
              {suggestions.map((suggestion) => (
                <div key={String(suggestion.id)} className="rounded px-2 py-2 hover:bg-slate-50" data-suggestion-item>
                  <button
                    type="button"
                    className="block w-full text-left"
                    onClick={() => {
                      selectSuggestion(suggestion.id)(editor.state, editor.view.dispatch);
                      editor.commands.scrollIntoView();
                    }}
                  >
                    <span className="block text-xs text-slate-500">{t("pages.suggest.by", { name: nameOf(suggestion) })}</span>
                    {suggestion.added.trim() ? <span className="block break-words text-emerald-700">+ {clip(suggestion.added)}</span> : null}
                    {suggestion.removed.trim() ? <span className="block break-words text-rose-700 line-through">− {clip(suggestion.removed)}</span> : null}
                    {!suggestion.added.trim() && !suggestion.removed.trim() ? (
                      <span className="block text-slate-600">{suggestion.restyled ? t("pages.suggest.restyled") : t("pages.suggest.blocks")}</span>
                    ) : null}
                  </button>
                  {canReview ? (
                    <div className="mt-1 flex gap-1">
                      <button type="button" className="inline-flex h-7 items-center gap-1 rounded px-2 text-xs text-emerald-700 hover:bg-emerald-50" onClick={() => acceptSuggestion(editor, suggestion.id)} data-suggestion-accept>
                        <Check className="h-3.5 w-3.5" aria-hidden="true" />
                        {t("pages.suggest.accept")}
                      </button>
                      <button type="button" className="inline-flex h-7 items-center gap-1 rounded px-2 text-xs text-rose-700 hover:bg-rose-50" onClick={() => rejectSuggestion(editor, suggestion.id)} data-suggestion-reject>
                        <X className="h-3.5 w-3.5" aria-hidden="true" />
                        {t("pages.suggest.reject")}
                      </button>
                    </div>
                  ) : null}
                </div>
              ))}
            </div>
          </PopoverContent>
        </Popover>
      ) : null}
      {canReview && suggestions.length > 1 ? (
        <>
          <button type="button" className="h-7 rounded-full px-2.5 text-emerald-700 hover:bg-emerald-50" onClick={() => acceptAllSuggestions(editor)} data-suggestions-accept-all>
            {t("pages.suggest.acceptAll")}
          </button>
          <button type="button" className="h-7 rounded-full px-2.5 text-rose-700 hover:bg-rose-50" onClick={() => rejectAllSuggestions(editor)} data-suggestions-reject-all>
            {t("pages.suggest.rejectAll")}
          </button>
        </>
      ) : null}
    </div>
  );
};
