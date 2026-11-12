import { useEffect, useRef, type DetailedHTMLProps, type HTMLAttributes } from "react";
import { useTranslation } from "react-i18next";
import type { TFunction } from "i18next";
import type { CompanionTurn } from "@ponder/shared";
import "@/vendor/appkeep-ai-ui/ai-ui.js";
import type { AiUiLabels, AppKeepAiInfoElement, AppKeepAiMessageElement } from "@/vendor/appkeep-ai-ui/ai-ui";
import { api } from "@/lib/api";
import { companionAiStreams, companionSavedToolEvents } from "@/lib/companion-ai-stream";
import { cn } from "@/lib/utils";

// AppKeep's chat UI kit (@appkeep/ai-ui, vendored) in the companion chat. Ponder keeps its own rendering of the
// reply (Markdown with note links, created-note links, the question form); the kit draws the live thinking
// section, the tool steps and the "…" info card after a reply.

type CustomElementProps<T> = DetailedHTMLProps<HTMLAttributes<T>, T>;
declare module "react" {
  namespace JSX {
    interface IntrinsicElements {
      "appkeep-ai-message": CustomElementProps<AppKeepAiMessageElement> & { sections?: string };
      "appkeep-ai-info": CustomElementProps<AppKeepAiInfoElement> & { locale?: string };
    }
  }
}

const AI_UI_LABELS = [
  "thinking", "thoughtFor", "thinkingStatus", "thoughtStatus", "seconds", "minutes", "toolStarted", "toolRunning", "toolDone",
  "toolFailed", "cutOff", "button", "title", "model", "input", "output", "calls", "price", "paidWith", "cached", "thinkingTokens",
  "credits", "key", "mixed", "about", "tokens", "unavailable", "running",
] as const satisfies readonly (keyof AiUiLabels)[];

/** The kit's strings from Ponder's catalogs. They keep the kit's single-brace placeholders ({time}, {n}), which i18next leaves alone. */
const aiUiLabels = (t: TFunction): Partial<AiUiLabels> => ({
  ...Object.fromEntries(AI_UI_LABELS.map((key) => [key, t(`companion.aiUi.${key}`)])),
  loading: t("common.loading"),
});

/**
 * Part of the stream view for a turn: `sections="thinking"` is "Thinking… 4s" until the first output, then a
 * summary to open; `sections="tools"` is the tool steps. Turns this page streamed follow the live store
 * (thinking is kept in memory only); other turns show their saved tool steps and no thinking.
 */
export function CompanionStreamView({ turn, sections, className }: { turn: CompanionTurn; sections: "thinking" | "tools"; className?: string }) {
  const { t } = useTranslation();
  const ref = useRef<AppKeepAiMessageElement>(null);
  const live = companionAiStreams.has(turn.id);
  const savedTools = live || sections !== "tools" ? null : turn.tools ?? [];
  const toolsKey = savedTools?.map((tool) => `${tool.id}:${tool.status}`).join(",") ?? "";
  useEffect(() => {
    const element = ref.current;
    if (!element) return;
    element.labels = aiUiLabels(t);
    element.toolLabel = (name: string) => t(`companion.actions.tools.${name}`, { defaultValue: name });
    element.reset();
    if (!live) {
      if (savedTools) element.pushAll(companionSavedToolEvents(savedTools));
      return;
    }
    element.pushAll(companionAiStreams.events(turn.id));
    return companionAiStreams.subscribe(turn.id, (event) => {
      if (event) element.push(event);
      else element.reset();
    });
    // savedTools is read through toolsKey, which changes only when a step's status does.
  }, [turn.id, live, toolsKey, t]);
  if (!live && !savedTools?.length) return null;
  return <appkeep-ai-message ref={ref} sections={sections} className={cn("companion-ai-ui block", className)} />;
}

/**
 * The "…" button after a reply: model, tokens, price and who paid. On AppKeep it reads AppKeep's usage records for
 * the turn's model calls; elsewhere it shows the token counts the AI SDK reported (there's no price to show).
 */
export function CompanionMessageInfo({ turn }: { turn: CompanionTurn }) {
  const { t, i18n } = useTranslation();
  const ref = useRef<AppKeepAiInfoElement>(null);
  const calls = turn.aiRequests?.length ?? 0;
  const visible = turn.status !== "running" && (calls > 0 || turn.inputTokens != null || turn.outputTokens != null);
  useEffect(() => {
    const element = ref.current;
    if (!element) return;
    element.labels = aiUiLabels(t);
    element.loader = async () => {
      const usage = await api.getCompanionTurnUsage(turn.id);
      element.modelNames = usage.models;
      return usage.records;
    };
  }, [turn.id, turn.status, calls, turn.inputTokens, turn.outputTokens, visible, t]);
  if (!visible) return null;
  return <appkeep-ai-info ref={ref} locale={i18n.resolvedLanguage} className="companion-ai-ui -ml-1" />;
}
