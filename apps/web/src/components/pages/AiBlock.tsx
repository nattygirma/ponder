/*
 * Adapted from AppFlowy-Web (https://github.com/AppFlowy-IO/AppFlowy-Web), Copyright AppFlowy,
 * AGPL-3.0: the request lifecycle of `useAIMeetingRegenerate`
 * (src/components/editor/components/blocks/ai-meeting/useAIMeetingRegenerate.ts): one active
 * request held in a ref with its AbortController, cancel on unmount, the "only the current request
 * may clear the loading state" rule in `finally`, re-reading the block after the stream before
 * replacing its children, and the empty-answer and error handling. The layout and wording follow
 * Notion's AI block, not AppFlowy's.
 */
import { useCallback, useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { NodeViewContent, NodeViewWrapper, ReactNodeViewRenderer, type NodeViewProps } from "@tiptap/react";
import { Fragment, type Node as ProseMirrorNode } from "@tiptap/pm/model";
import { ChevronDown, FileText, Loader2, SlidersHorizontal, Sparkles, Square } from "lucide-react";
import {
  AI_BLOCK_NODE_TYPE,
  AI_BLOCK_PROMPT_MAX,
  AiBlock,
  buildAiBlockInstruction,
  docToMarkdown,
  docWithoutNodeAt,
  markdownToDoc,
  normalizeGeneratedMarkdown,
  replaceSyncedNodes,
  type TiptapDoc,
} from "@ponder/shared";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import { api } from "@/lib/api";
import { cn } from "@/lib/utils";
import { usePages } from "./PagesProvider";
import "@/styles/synced-ai-blocks.css";

/** Set by the slash command, so the AI block just inserted opens its prompt, as Notion's does. */
let openNextAiBlock = false;
export const openNextAiBlockSetup = () => { openNextAiBlock = true; };

type AiBlockOptions = { getPageId: () => string | null };
const PAGE_CONTEXT_MAX = 290_000;

/** Where the block sits, as child indexes from the top of the page. */
const nodePath = (doc: ProseMirrorNode, pos: number) => {
  const $pos = doc.resolve(pos);
  const path: number[] = [];
  for (let depth = 0; depth <= $pos.depth; depth += 1) path.push($pos.index(depth));
  return path;
};

const errorReason = (error: unknown) => {
  const message = error instanceof Error ? error.message : typeof error === "string" ? error : "";
  return message.trim() || "unknown error";
};

const useAiBlockGeneration = ({ editor, getPos, node, pageId }: Pick<NodeViewProps, "editor" | "getPos" | "node"> & { pageId: string | null }) => {
  const { t, i18n } = useTranslation();
  const pages = usePages();
  const [generating, setGenerating] = useState(false);
  const [streamed, setStreamed] = useState("");
  const [error, setError] = useState<string | null>(null);
  const generatingRef = useRef(false);
  const activeRequest = useRef<AbortController | null>(null);

  const cancel = useCallback(() => {
    const controller = activeRequest.current;
    if (!controller) return;
    activeRequest.current = null;
    controller.abort();
    generatingRef.current = false;
    setGenerating(false);
    setStreamed("");
  }, []);

  useEffect(() => cancel, [cancel]);

  const generate = useCallback(async (promptOverride?: string) => {
    if (generatingRef.current || !editor.isEditable) return;
    const prompt = (promptOverride ?? String(node.attrs.prompt ?? "")).trim();
    if (!prompt) {
      setError(t("pages.aiBlock.needsPrompt"));
      return;
    }
    const pos = getPos();
    if (typeof pos !== "number") return;
    const controller = new AbortController();
    activeRequest.current = controller;
    generatingRef.current = true;
    setError(null);
    setStreamed("");
    setGenerating(true);
    try {
      // The page as context, without this block's own earlier answer, and with synced blocks this person may read.
      const pageDoc = docWithoutNodeAt(editor.getJSON() as TiptapDoc, nodePath(editor.state.doc, pos));
      let contentMarkdown = docToMarkdown(pageDoc);
      if (contentMarkdown.includes("<ponder-synced")) {
        contentMarkdown = (await api.expandSyncedMarkdown(contentMarkdown).catch(() => ({ markdown: contentMarkdown }))).markdown;
      }
      const title = (pageId ? pages?.getPage(pageId)?.title : "")?.trim() ?? "";
      let answer = "";
      let failure: string | null = null;
      await api.streamAiGeneration({
        action: "custom",
        title: title.slice(0, 160),
        contentMarkdown: contentMarkdown.slice(0, PAGE_CONTEXT_MAX),
        instruction: buildAiBlockInstruction(prompt),
        locale: i18n.language,
      }, {
        signal: controller.signal,
        onEvent: (event) => {
          if (event.type === "text-delta") {
            answer += event.text;
            setStreamed(answer);
          } else if (event.type === "error") {
            failure = event.message || event.code;
          }
        },
      });
      if (failure) throw new Error(failure);
      if (controller.signal.aborted) return;

      // Read the block again: someone may have moved or deleted it while the answer streamed.
      const current = getPos();
      const block = typeof current === "number" ? editor.state.doc.nodeAt(current) : null;
      if (typeof current !== "number" || !block || block.type.name !== AI_BLOCK_NODE_TYPE) return;
      const markdown = normalizeGeneratedMarkdown(answer);
      if (!markdown) throw new Error(t("pages.aiBlock.emptyAnswer"));
      // No synced or AI blocks inside an answer.
      const parsed = replaceSyncedNodes(markdownToDoc(markdown), () => null);
      const children = (parsed.content ?? []).filter((child) => child.type !== AI_BLOCK_NODE_TYPE).flatMap((child) => {
        try {
          return [editor.schema.nodeFromJSON(child)];
        } catch {
          return [];
        }
      });
      if (children.length === 0) throw new Error(t("pages.aiBlock.emptyAnswer"));
      const tr = editor.state.tr.replaceWith(current + 1, current + block.nodeSize - 1, Fragment.fromArray(children));
      tr.setNodeMarkup(current, undefined, { ...block.attrs, prompt, generatedAt: new Date().toISOString() });
      editor.view.dispatch(tr);
    } catch (caught) {
      if (controller.signal.aborted) return;
      setError(t("pages.aiBlock.failed", { reason: errorReason(caught) }));
    } finally {
      // A cancelled request can finish after the next one starts; only the current one clears the state.
      if (activeRequest.current === controller) {
        activeRequest.current = null;
        generatingRef.current = false;
        setGenerating(false);
        setStreamed("");
      }
    }
  }, [editor, getPos, i18n.language, node.attrs.prompt, pageId, pages, t]);

  return { generate, cancel, generating, streamed, error, dismissError: () => setError(null) };
};

const AiBlockView = ({ node, editor, extension, getPos, selected, updateAttributes }: NodeViewProps) => {
  const { t } = useTranslation();
  const pageId = (extension.options as AiBlockOptions).getPageId();
  const [editable, setEditable] = useState(editor.isEditable);
  const prompt = String(node.attrs.prompt ?? "");
  const hasAnswer = node.childCount > 0 && node.textContent.trim().length > 0;
  const [setupOpen, setSetupOpen] = useState(false);
  const [draft, setDraft] = useState(prompt);
  const { generate, cancel, generating, streamed, error, dismissError } = useAiBlockGeneration({ editor, getPos, node, pageId });

  useEffect(() => {
    const sync = () => setEditable(editor.isEditable);
    sync();
    editor.on("transaction", sync);
    return () => { editor.off("transaction", sync); };
  }, [editor]);

  useEffect(() => {
    if (openNextAiBlock && editable && !prompt) {
      openNextAiBlock = false;
      setSetupOpen(true);
    }
  }, [editable, prompt]);

  const openSetup = () => {
    if (!editable) return;
    setDraft(prompt);
    setSetupOpen(true);
  };

  const saveSetup = () => {
    const next = draft.trim().slice(0, AI_BLOCK_PROMPT_MAX);
    setSetupOpen(false);
    if (next !== prompt) updateAttributes({ prompt: next });
    // As in Notion, finishing the setup of an empty block writes its first answer.
    if (next && !hasAnswer) void generate(next);
  };

  const generateButton = (
    <button
      type="button"
      className="ponder-ai-generate"
      disabled={!editable}
      onMouseDown={(event) => event.preventDefault()}
      onClick={() => (prompt ? void generate() : openSetup())}
    >
      {hasAnswer ? t("pages.aiBlock.regenerate") : t("pages.aiBlock.generate")}
    </button>
  );

  return (
    <NodeViewWrapper className={cn("ponder-ai-block", selected && "is-selected", setupOpen && "is-setup", hasAnswer && "has-answer", generating && "is-generating")}>
      {setupOpen ? (
        <div className="ponder-ai-setup" contentEditable={false}>
          <div className="ponder-ai-setup-head">
            <span className="ponder-ai-setup-title"><Sparkles className="h-4 w-4" aria-hidden="true" />{t("pages.aiBlock.title")}</span>
            <button type="button" className="ponder-ai-done" onClick={saveSetup}>{t("pages.aiBlock.done")}</button>
          </div>
          <div className="ponder-ai-setup-row">
            <span className="ponder-ai-setup-label">{t("pages.aiBlock.generateLabel")}</span>
            <span className="ponder-ai-output">{t("pages.aiBlock.customOutput")}<ChevronDown className="h-3.5 w-3.5" aria-hidden="true" /></span>
          </div>
          <textarea
            className="ponder-ai-prompt"
            aria-label={t("pages.aiBlock.promptLabel")}
            placeholder={t("pages.aiBlock.promptPlaceholder")}
            value={draft}
            maxLength={AI_BLOCK_PROMPT_MAX}
            rows={3}
            autoFocus
            onChange={(event) => setDraft(event.target.value)}
            onKeyDown={(event) => {
              event.stopPropagation();
              if (event.key === "Enter" && (event.metaKey || event.ctrlKey)) saveSetup();
              if (event.key === "Escape") setSetupOpen(false);
            }}
          />
          <div className="ponder-ai-using">
            <span>{t("pages.aiBlock.using")}</span>
            <span className="ponder-ai-using-chip"><FileText className="h-3.5 w-3.5" aria-hidden="true" />{t("pages.aiBlock.currentPage")}</span>
          </div>
        </div>
      ) : null}

      {!setupOpen ? (
        <div className="ponder-ai-toolbar" contentEditable={false}>
          {generating ? (
            <button type="button" className="ponder-ai-stop" onMouseDown={(event) => event.preventDefault()} onClick={cancel}>
              <Square className="h-3 w-3" aria-hidden="true" />{t("pages.aiBlock.stop")}
            </button>
          ) : (
            <>
              <TooltipProvider delayDuration={300}>
                <Tooltip>
                  <TooltipTrigger asChild>
                    <button type="button" className="ponder-ai-icon" aria-label={t("pages.aiBlock.settings")} disabled={!editable} onMouseDown={(event) => event.preventDefault()} onClick={openSetup}>
                      <SlidersHorizontal className="h-3.5 w-3.5" aria-hidden="true" />
                    </button>
                  </TooltipTrigger>
                  <TooltipContent side="top">{t("pages.aiBlock.settings")}</TooltipContent>
                </Tooltip>
              </TooltipProvider>
              {generateButton}
            </>
          )}
        </div>
      ) : null}

      {!hasAnswer && !generating && !setupOpen ? (
        <div className="ponder-ai-empty" contentEditable={false}>
          <button type="button" className="ponder-ai-empty-hint" disabled={!editable} onClick={openSetup}>
            <Sparkles className="h-4 w-4 shrink-0" aria-hidden="true" />
            <span>{prompt || t("pages.aiBlock.emptyHint")}</span>
          </button>
        </div>
      ) : null}

      {generating ? (
        <div className="ponder-ai-stream" contentEditable={false} aria-live="polite">
          {streamed || <span className="inline-flex items-center gap-2 text-slate-500 dark:text-slate-400"><Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />{t("pages.aiBlock.generating")}</span>}
        </div>
      ) : null}

      {error ? (
        <div className="ponder-ai-error" contentEditable={false} role="alert">
          <span>{error}</span>
          <button type="button" className="ponder-ai-error-close" onClick={dismissError}>{t("common.close")}</button>
        </div>
      ) : null}

      <NodeViewContent className={cn("ponder-ai-content", (generating || !hasAnswer) && "is-hidden")} />
    </NodeViewWrapper>
  );
};

export const EditorAiBlock = AiBlock.extend<AiBlockOptions>({
  addOptions() {
    return { getPageId: () => null };
  },
  addNodeView() {
    return ReactNodeViewRenderer(AiBlockView, {
      // The prompt card and the toolbar handle their own events; the answer is ordinary editable blocks.
      stopEvent: ({ event }) => event.target instanceof Element && Boolean(event.target.closest(".ponder-ai-setup, .ponder-ai-toolbar, .ponder-ai-empty, .ponder-ai-error")),
    });
  },
});
