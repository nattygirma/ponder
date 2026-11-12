/**
 * Notion's Embed block (Phase E of the Notion blocks plan): the empty /embed or named-embed block
 * with its link panel, and the embedded frame, which can be resized by dragging its edges.
 *
 * The panel follows Phase C's media panel (MediaBlocks.tsx, itself adapted from AppFlowy-Web's
 * EmbedLink.tsx); the frame and its preview-yields-while-dragging behaviour follow AppFlowy-Web's
 * Google Drive block (src/components/editor/components/blocks/google-drive/GoogleDriveBlock.tsx),
 * Copyright AppFlowy, AGPL-3.0. The handles are in EmbedResizeHandles.tsx.
 */
import { useCallback, useEffect, useMemo, useRef, useState, type ChangeEvent, type ComponentType, type KeyboardEvent } from "react";
import { useTranslation } from "react-i18next";
import { NodeViewWrapper, type NodeViewProps } from "@tiptap/react";
import type { Editor } from "@tiptap/core";
import {
  BookUser,
  Bookmark,
  Box,
  ChartLine,
  ChartNoAxesCombined,
  CircleCheckBig,
  Clapperboard,
  Cloud,
  CodeXml,
  Contact,
  ExternalLink,
  FileCode2,
  FileText,
  Frame,
  GitBranch,
  GitMerge,
  Globe,
  HardDrive,
  Headset,
  Hexagon,
  Layers,
  Lightbulb,
  ListTodo,
  Mail,
  MapPin,
  MessageCircle,
  MessageSquareQuote,
  MessagesSquare,
  MonitorPlay,
  MonitorSmartphone,
  NotebookText,
  Package,
  PackageOpen,
  Palette,
  PenTool,
  Pencil,
  Presentation,
  ScanSearch,
  Shapes,
  ShoppingCart,
  Siren,
  SquareDashed,
  SquareKanban,
  SquarePlus,
  SquareStack,
  SquareTerminal,
  Ticket,
  ClipboardList,
  ListChecks,
  Workflow,
  Eraser,
  Video,
  Diamond,
  Projector,
} from "lucide-react";
import {
  BOOKMARK_NODE_TYPE,
  bookmarkFallback,
  clampEmbedSize,
  EMBED_ALLOW,
  EMBED_NODE_TYPE,
  EMBED_SANDBOX,
  fileNameFromUrl,
  getEmbedService,
  isBookmarkOnlyService,
  isEmbedServiceId,
  isValidEmbedLink,
  MediaPlaceholder,
  MIN_EMBED_HEIGHT,
  normalizeMediaUrl,
  PDF_ATTACHMENT_NODE_TYPE,
  readTweetHeight,
  resolveEmbed,
  type EmbedServiceId,
  type EmbedTarget,
} from "@ponder/shared";
import { Popover, PopoverAnchor, PopoverContent } from "@/components/ui/popover";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import { api } from "@/lib/api";
import { cn } from "@/lib/utils";
import { EmbedResizeHandles, type EmbedSize } from "./EmbedResizeHandles";

type Icon = ComponentType<{ className?: string; "aria-hidden"?: boolean | "true" }>;

/** Generic lucide icons for each service: no brand marks. */
export const EMBED_SERVICE_ICONS: Record<EmbedServiceId, Icon> = {
  googleDrive: HardDrive,
  tweet: MessageSquareQuote,
  githubGist: FileCode2,
  googleMaps: MapPin,
  figma: PenTool,
  abstract: Layers,
  invision: MonitorSmartphone,
  mixpanel: ChartNoAxesCombined,
  framer: Frame,
  whimsical: Shapes,
  miro: Presentation,
  sketch: Diamond,
  excalidraw: Pencil,
  pdf: FileText,
  loom: Video,
  typeform: ClipboardList,
  codepen: CodeXml,
  replit: SquareTerminal,
  hex: Hexagon,
  deepnote: NotebookText,
  slack: MessagesSquare,
  trello: SquareKanban,
  pitch: Projector,
  onedrive: Cloud,
  dropbox: PackageOpen,
  amplitude: ChartLine,
  claap: Clapperboard,
  box: Package,
  linear: ListChecks,
  lucidchart: Workflow,
  lucidspark: Lightbulb,
  eraser: Eraser,
  clickup: CircleCheckBig,
  plus: SquarePlus,
  dovetail: ScanSearch,
  streak: Mail,
  shortcut: SquareStack,
  sendowl: ShoppingCart,
  amplitudeEu: ChartLine,
  zendesk: Headset,
  googleContacts: Contact,
  discord: MessageCircle,
  microsoftContacts: BookUser,
  pagerduty: Siren,
  asana: ListTodo,
  gitlab: GitMerge,
  zoom: MonitorPlay,
  adobeXd: Palette,
  jira: Ticket,
  github: GitBranch,
};

/** The `/` menu's Embed icon: Notion's dashed frame. */
export const EmbedMenuIcon = SquareDashed;
export const iconForEmbedService = (id: unknown): Icon => (isEmbedServiceId(id) ? EMBED_SERVICE_ICONS[id] : Globe);

/** The texts of a service's panel: Notion's own where known, otherwise the generic lines. */
const useEmbedTexts = (serviceId: EmbedServiceId | null) => {
  const { t } = useTranslation();
  return useMemo(() => {
    const service = getEmbedService(serviceId);
    if (!service) {
      return { name: "", add: t("pages.embeds.generic.add"), placeholder: t("pages.embeds.generic.placeholder"), submit: t("pages.embeds.generic.submit"), hint: t("pages.embeds.generic.hint"), bookmarkOnly: false };
    }
    const name = service.label;
    const bookmarkOnly = isBookmarkOnlyService(service);
    const key = `pages.embeds.services.${service.id}`;
    return {
      name,
      add: t(`${key}.add`, { defaultValue: t("pages.embeds.add", { name }) }),
      placeholder: service.example,
      submit: bookmarkOnly ? t("pages.embeds.bookmarkSubmit") : t(`${key}.submit`, { defaultValue: t("pages.embeds.submit") }),
      hint: bookmarkOnly ? t("pages.embeds.bookmarkHint", { name }) : t(`${key}.hint`, { defaultValue: t("pages.embeds.hint", { name }) }),
      bookmarkOnly,
    };
  }, [serviceId, t]);
};

/**
 * The block a link becomes. A frame the rules don't vouch for is checked by the server first, and
 * a page that refuses frames becomes a bookmark card, as Notion shows one.
 */
export const blocksForEmbedLink = async (target: EmbedTarget, url: string): Promise<Record<string, unknown>[]> => {
  if (target.kind === "pdf") {
    const filename = fileNameFromUrl(url, "document.pdf");
    return [{ type: "paragraph", content: [{ type: PDF_ATTACHMENT_NODE_TYPE, attrs: { url, label: filename, filename, mimeType: "application/pdf", displayMode: "inline" } }] }];
  }
  if (target.kind === "frame" && !target.checkFraming) {
    // A player keeps its shape and a Tweet fits itself, so neither stores a height.
    return [{ type: EMBED_NODE_TYPE, attrs: { url, service: target.service ?? "", width: null, height: target.video || target.service === "tweet" ? null : target.height } }];
  }
  const page = await api.getWebBookmark(url).catch(() => null);
  if (target.kind === "frame" && page?.frameable !== false) {
    return [{ type: EMBED_NODE_TYPE, attrs: { url, service: target.service ?? "", width: null, height: target.height } }];
  }
  return [{ type: BOOKMARK_NODE_TYPE, attrs: page?.bookmark ?? bookmarkFallback(url) }];
};

const replaceEmbedPlaceholder = (editor: Editor, getPos: NodeViewProps["getPos"], content: Record<string, unknown>[]) => {
  const pos = getPos();
  if (typeof pos !== "number") return;
  const node = editor.state.doc.nodeAt(pos);
  if (!node || node.type.name !== MediaPlaceholder.name) return;
  editor.chain().focus(undefined, { scrollIntoView: false }).insertContentAt({ from: pos, to: pos + node.nodeSize }, content).run();
};

const EmbedLinkField = ({ serviceId, onDone }: { serviceId: EmbedServiceId | null; onDone: (url: string) => Promise<void> }) => {
  const { t } = useTranslation();
  const texts = useEmbedTexts(serviceId);
  const [value, setValue] = useState("");
  const [error, setError] = useState(false);
  const [busy, setBusy] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  useEffect(() => inputRef.current?.focus(), []);

  const handleChange = (event: ChangeEvent<HTMLInputElement>) => {
    setValue(event.target.value);
    setError(Boolean(event.target.value.trim()) && !isValidEmbedLink(serviceId, event.target.value));
  };
  const submit = async () => {
    if (busy || !value.trim()) return;
    if (!isValidEmbedLink(serviceId, value)) {
      setError(true);
      return;
    }
    setBusy(true);
    try {
      await onDone(normalizeMediaUrl(value) ?? value.trim());
    } finally {
      setBusy(false);
    }
  };
  const handleKeyDown = (event: KeyboardEvent) => {
    if (event.key === "Enter") {
      event.preventDefault();
      void submit();
    }
  };

  return (
    <div className="ponder-media-link">
      <input
        ref={inputRef}
        type="url"
        inputMode="url"
        spellCheck={false}
        className={cn("ponder-media-input", error && "is-error")}
        aria-invalid={error}
        aria-label={texts.add}
        placeholder={texts.placeholder}
        value={value}
        onChange={handleChange}
        onKeyDown={handleKeyDown}
      />
      {error ? (
        <p className="ponder-media-error" role="alert">
          {texts.name ? t("pages.embeds.invalidLink", { name: texts.name }) : t("pages.blocks.invalidLink")}
        </p>
      ) : null}
      <button type="button" className="ponder-media-submit" disabled={busy || !value.trim() || error} onClick={() => void submit()}>
        {busy ? t("pages.embeds.checking") : texts.submit}
      </button>
      <p className="ponder-media-hint">{texts.hint}</p>
    </div>
  );
};

/** The empty /embed block: Notion's bar ("Embed anything…") that opens the link panel. */
export const EmbedPlaceholderView = ({
  editor,
  node,
  getPos,
  selected,
  openOnMount,
  uploadFiles,
}: NodeViewProps & { openOnMount: boolean; uploadFiles: (files: File[]) => void }) => {
  const { t } = useTranslation();
  const serviceId = isEmbedServiceId(node.attrs.service) ? node.attrs.service : null;
  const texts = useEmbedTexts(serviceId);
  const Icon = serviceId ? EMBED_SERVICE_ICONS[serviceId] : Globe;
  // Notion's generic Embed opens on Link, with Upload beside it; named embeds only take a link.
  const tabs = serviceId === null || serviceId === "pdf";
  const [tab, setTab] = useState<"link" | "upload">("link");
  const [open, setOpen] = useState(openOnMount && editor.isEditable);
  const fileRef = useRef<HTMLInputElement>(null);

  const embedLink = useCallback(async (url: string) => {
    const target = resolveEmbed(url, serviceId);
    if (!target) return;
    replaceEmbedPlaceholder(editor, getPos, await blocksForEmbedLink(target, url));
    setOpen(false);
  }, [editor, getPos, serviceId]);

  const upload = useCallback((files: File[]) => {
    const pos = getPos();
    if (typeof pos !== "number" || files.length === 0) return;
    setOpen(false);
    editor.chain()
      .insertContentAt({ from: pos, to: pos + node.nodeSize }, { type: "paragraph" })
      .setTextSelection(pos + 1)
      .focus(undefined, { scrollIntoView: false })
      .run();
    uploadFiles(files);
  }, [editor, getPos, node.nodeSize, uploadFiles]);

  return (
    <NodeViewWrapper className={cn("ponder-media-block ponder-embed-placeholder-block", selected && "is-selected")} data-media-kind="embed" data-embed-service={serviceId ?? ""} contentEditable={false}>
      <Popover open={open} onOpenChange={setOpen}>
        <PopoverAnchor asChild>
          <button
            type="button"
            className="ponder-media-placeholder"
            onMouseDown={(event) => event.preventDefault()}
            onClick={() => editor.isEditable && setOpen(true)}
          >
            <Icon className="h-5 w-5 shrink-0 stroke-[1.5]" aria-hidden="true" />
            <span className="truncate">{texts.add}</span>
          </button>
        </PopoverAnchor>
        <PopoverContent
          align="center"
          side="bottom"
          sideOffset={4}
          className="ponder-media-panel"
          onOpenAutoFocus={(event) => event.preventDefault()}
          onCloseAutoFocus={(event) => event.preventDefault()}
        >
          {tabs ? (
            <div className="ponder-media-tabs" role="tablist">
              {(["link", "upload"] as const).map((value) => (
                <button key={value} type="button" role="tab" aria-selected={tab === value} className="ponder-media-tab" onClick={() => setTab(value)}>
                  {t(`pages.blocks.${value}`)}
                </button>
              ))}
            </div>
          ) : null}
          {tabs && tab === "upload" ? (
            <div className="ponder-media-upload">
              <button type="button" className="ponder-media-choose" onClick={() => fileRef.current?.click()}>
                {t("pages.embeds.uploadChoose")}
              </button>
              <input
                ref={fileRef}
                type="file"
                hidden
                accept={serviceId === "pdf" ? "application/pdf" : undefined}
                onChange={(event) => {
                  upload(Array.from(event.target.files ?? []));
                  event.target.value = "";
                }}
              />
            </div>
          ) : (
            <EmbedLinkField key={serviceId ?? "embed"} serviceId={serviceId} onDone={embedLink} />
          )}
        </PopoverContent>
      </Popover>
    </NodeViewWrapper>
  );
};

/** Whether Ponder is in its dark theme (the `dark` class on the root), following changes. */
const useDarkTheme = () => {
  const read = () => typeof document !== "undefined" && document.documentElement.classList.contains("dark");
  const [dark, setDark] = useState(read);
  useEffect(() => {
    const observer = new MutationObserver(() => setDark(read()));
    observer.observe(document.documentElement, { attributes: true, attributeFilter: ["class"] });
    return () => observer.disconnect();
  }, []);
  return dark;
};

/** Ponder's own pages can't be framed: a frame of the same site could reach the page around it. */
const isSameSite = (embedUrl: string) => {
  try {
    return typeof window !== "undefined" && new URL(embedUrl).origin === window.location.origin;
  } catch {
    return true;
  }
};

/** The page loads read-only and turns editable later without re-rendering node views, so follow it (as ButtonBlock does). */
const useEditorEditable = (editor: Editor) => {
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
  return editable;
};

/** An embedded frame. Hovering shows the resize handles and an "Open original" button, as in Notion. */
export const EmbedFrameView = ({ editor, node, selected, updateAttributes }: NodeViewProps) => {
  const { t } = useTranslation();
  const url = String(node.attrs.url ?? "");
  const serviceId = isEmbedServiceId(node.attrs.service) ? node.attrs.service : null;
  const target = useMemo(() => resolveEmbed(url, serviceId), [serviceId, url]);
  const stored = clampEmbedSize(node.attrs.width, node.attrs.height);
  const video = target?.kind === "frame" && target.video;
  const [draft, setDraft] = useState<EmbedSize>();
  const columnRef = useRef<HTMLDivElement>(null);
  const service = getEmbedService(target?.service ?? serviceId);
  const name = service?.label ?? (video && target?.kind === "frame" ? new URL(target.embedUrl).hostname.replace(/^www\./, "") : "");
  const href = normalizeMediaUrl(url) ?? "#";
  const isTweet = service?.id === "tweet";
  const dark = useDarkTheme();
  const editable = useEditorEditable(editor as Editor);
  // X draws a Tweet in the page's theme, as Notion's does.
  const frameUrl = target?.kind === "frame" ? (isTweet ? `${target.embedUrl}&theme=${dark ? "dark" : "light"}` : target.embedUrl) : null;
  const frameRef = useRef<HTMLIFrameElement>(null);
  const [fittedHeight, setFittedHeight] = useState<number>();
  // A Tweet reports its own height; until someone drags the frame, it fits the Tweet like Notion's.
  useEffect(() => {
    if (!isTweet) return;
    const onMessage = (event: MessageEvent) => {
      if (event.origin !== "https://platform.twitter.com" || event.source !== frameRef.current?.contentWindow) return;
      const height = readTweetHeight(event.data);
      if (height) setFittedHeight(height);
    };
    window.addEventListener("message", onMessage);
    return () => window.removeEventListener("message", onMessage);
  }, [isTweet]);

  const size: EmbedSize = {
    width: stored.width,
    height: video ? 0 : stored.height || (isTweet && fittedHeight ? Math.max(MIN_EMBED_HEIGHT, fittedHeight) : 0) || (target?.kind === "frame" ? target.height : 0),
  };
  const shown = draft ?? size;

  if (!frameUrl || isSameSite(frameUrl)) {
    return (
      <NodeViewWrapper className={cn("ponder-embed-block", selected && "is-selected")} contentEditable={false}>
        <a className="ponder-embed-link" href={href} target="_blank" rel="noopener noreferrer">
          <Bookmark className="h-4 w-4 shrink-0" aria-hidden="true" />
          <span className="truncate">{url}</span>
        </a>
        {frameUrl ? <p className="ponder-embed-note">{t("pages.embeds.sameSite")}</p> : null}
      </NodeViewWrapper>
    );
  }

  return (
    <NodeViewWrapper
      className={cn("ponder-embed-block", selected && "is-selected", draft && "is-resizing")}
      contentEditable={false}
      data-provider={target?.kind === "frame" && target.video ? "video" : undefined}
      data-embed-service={service?.id ?? ""}
    >
      <div ref={columnRef} className="ponder-embed-column">
        <div className="ponder-embed-card" style={{ width: `${shown.width}%` }}>
          <div className={cn("ponder-embed-frame", video ? "is-video" : "is-sized")} style={video ? undefined : { height: shown.height }}>
            <iframe
              ref={frameRef}
              src={frameUrl}
              // An iframe's accessible name; the one place Ponder's no-title rule allows `title`.
              title={name ? t("pages.embeds.frameTitle", { name }) : url}
              sandbox={EMBED_SANDBOX}
              allow={EMBED_ALLOW}
              allowFullScreen
              loading="lazy"
              referrerPolicy="strict-origin-when-cross-origin"
              style={draft ? { pointerEvents: "none" } : undefined}
            />
          </div>
          <TooltipProvider delayDuration={300}>
            <div className="ponder-embed-toolbar">
              <Tooltip>
                <TooltipTrigger asChild>
                  <a className="ponder-embed-toolbar-button" href={href} target="_blank" rel="noopener noreferrer" aria-label={t("pages.embeds.openOriginal")}>
                    <ExternalLink className="h-3.5 w-3.5" aria-hidden="true" />
                  </a>
                </TooltipTrigger>
                <TooltipContent side="top">{t("pages.embeds.openOriginal")}</TooltipContent>
              </Tooltip>
            </div>
          </TooltipProvider>
          {editable ? (
            <EmbedResizeHandles
              container={columnRef}
              size={size}
              heightLocked={Boolean(video)}
              onDraft={setDraft}
              onCommit={(next) => updateAttributes({ width: next.width < 100 ? next.width : null, height: video ? null : next.height })}
            />
          ) : null}
        </div>
      </div>
    </NodeViewWrapper>
  );
};
