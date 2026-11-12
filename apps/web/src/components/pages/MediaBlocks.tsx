/**
 * Notion's media blocks: the empty /image, /video, /audio, /file and /bookmark block with its
 * Upload / Link panel, the video frame for YouTube, Vimeo and Loom, and the Web bookmark card.
 *
 * Adapted from AppFlowy-Web (https://github.com/AppFlowy-IO/AppFlowy-Web), Copyright AppFlowy, AGPL-3.0:
 * - src/components/editor/components/block-popover/{Image,Video,Audio,File}BlockPopoverContent.tsx
 *   and src/components/_shared/image-upload/EmbedLink.tsx: the Upload / Link tabs, the link field
 *   with its validator, error and submit button.
 * - src/components/editor/components/blocks/{audio/AudioBlock,video/VideoBlock,video/VideoEmpty}.tsx:
 *   the empty block bar that opens the panel.
 * - src/components/editor/components/blocks/video/VideoRender.tsx: the 16:9 player frame.
 * - src/components/editor/components/blocks/link-preview/LinkPreview.tsx: the bookmark card.
 * Slate and Yjs calls became TipTap node views and transactions, MUI tabs became plain buttons,
 * react-player became the provider's own iframe, and Notion's labels replace AppFlowy's.
 */
import { useCallback, useEffect, useRef, useState, type ChangeEvent, type KeyboardEvent } from "react";
import { useTranslation } from "react-i18next";
import { NodeViewWrapper, ReactNodeViewRenderer, type NodeViewProps } from "@tiptap/react";
import type { Editor } from "@tiptap/core";
import { AudioLines, Bookmark, Image as ImageIcon, Paperclip, Video } from "lucide-react";
import {
  BOOKMARK_NODE_TYPE,
  bookmarkFallback,
  EMBED_NODE_TYPE,
  FILE_ATTACHMENT_NODE_TYPE,
  fileNameFromUrl,
  isAudioUrl,
  isMediaKind,
  resolveAudioMimeType,
  resolvePlayableMediaMimeType,
  resolveVideoMimeType,
  isValidMediaLink,
  MediaPlaceholder,
  normalizeMediaUrl,
  parseVideoEmbed,
  VideoEmbed,
  WebBookmark,
  type MediaKind,
} from "@ponder/shared";
import { Popover, PopoverAnchor, PopoverContent } from "@/components/ui/popover";
import { api } from "@/lib/api";
import { cn } from "@/lib/utils";

const ICONS: Record<MediaKind, typeof ImageIcon> = { image: ImageIcon, video: Video, audio: AudioLines, file: Paperclip, bookmark: Bookmark };
const ACCEPT: Record<MediaKind, string | undefined> = { image: "image/*", video: "video/*", audio: "audio/*", file: undefined, bookmark: undefined };

type MediaPlaceholderOptions = {
  /** Uploads files at the cursor, as a paste would. */
  uploadFiles: (files: File[]) => void;
};

// The `/` menu asks the next empty media block to open its panel, as Notion does on insert.
let openNextPanel = false;
export const openNextMediaPanel = () => {
  openNextPanel = true;
};

/** The block a link becomes: a picture, a video frame, a file, or a bookmark card. */
const blockForLink = (kind: MediaKind, url: string, bookmark?: ReturnType<typeof bookmarkFallback>) => {
  if (kind === "image") return [{ type: "image", attrs: { src: url } }];
  if (kind === "bookmark") return [{ type: BOOKMARK_NODE_TYPE, attrs: bookmark ?? bookmarkFallback(url) }];
  if (kind === "video" && parseVideoEmbed(url)) return [{ type: EMBED_NODE_TYPE, attrs: { url } }];
  const filename = fileNameFromUrl(url, kind === "file" ? "file" : kind);
  const mimeType = kind === "video" ? resolveVideoMimeType(null, filename) ?? "video/mp4"
    : kind === "audio" || isAudioUrl(url) ? resolveAudioMimeType(null, filename) ?? "audio/mpeg"
      : resolvePlayableMediaMimeType(null, filename) ?? "";
  return [{
    type: "paragraph",
    content: [{ type: FILE_ATTACHMENT_NODE_TYPE, attrs: { url, filename, label: `Attachment: ${filename}`, mimeType } }],
  }];
};

/** Swaps the empty block for what was added, wherever the block has moved to by now. */
const replacePlaceholder = (editor: Editor, getPos: NodeViewProps["getPos"], content: Record<string, unknown>[]) => {
  const pos = getPos();
  if (typeof pos !== "number") return;
  const node = editor.state.doc.nodeAt(pos);
  if (!node || node.type.name !== MediaPlaceholder.name) return;
  editor.chain().focus(undefined, { scrollIntoView: false }).insertContentAt({ from: pos, to: pos + node.nodeSize }, content).run();
};

const MediaLinkField = ({ kind, onDone }: { kind: MediaKind; onDone: (url: string) => Promise<void> | void }) => {
  const { t } = useTranslation();
  const [value, setValue] = useState("");
  const [error, setError] = useState(false);
  const [busy, setBusy] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  useEffect(() => inputRef.current?.focus(), []);

  const handleChange = (event: ChangeEvent<HTMLInputElement>) => {
    setValue(event.target.value);
    setError(Boolean(event.target.value.trim()) && !isValidMediaLink(kind, event.target.value));
  };
  const submit = async () => {
    if (busy || !value.trim()) return;
    if (!isValidMediaLink(kind, value)) {
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
        placeholder={t(`pages.blocks.media.${kind}.placeholder`)}
        value={value}
        onChange={handleChange}
        onKeyDown={handleKeyDown}
      />
      {error ? <p className="ponder-media-error" role="alert">{t("pages.blocks.invalidLink")}</p> : null}
      <button type="button" className="ponder-media-submit" disabled={busy || !value.trim() || error} onClick={() => void submit()}>
        {busy && kind === "bookmark" ? t("pages.blocks.loadingBookmark") : t(`pages.blocks.media.${kind}.submit`)}
      </button>
      <p className="ponder-media-hint">{t(`pages.blocks.media.${kind}.hint`)}</p>
    </div>
  );
};

const MediaPlaceholderView = ({ editor, node, getPos, extension, selected }: NodeViewProps) => {
  const { t } = useTranslation();
  const kind: MediaKind = isMediaKind(node.attrs.kind) ? node.attrs.kind : "image";
  const Icon = ICONS[kind];
  // Notion's bookmark has only a link field; the rest open on Upload.
  const [tab, setTab] = useState<"upload" | "link">(kind === "bookmark" ? "link" : "upload");
  const [open, setOpen] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (!openNextPanel || !editor.isEditable) return;
    openNextPanel = false;
    setOpen(true);
  }, [editor]);

  const upload = useCallback((files: File[]) => {
    const pos = getPos();
    if (typeof pos !== "number" || files.length === 0) return;
    setOpen(false);
    // The uploads take the empty block's place, as if pasted on an empty line there.
    editor.chain()
      .insertContentAt({ from: pos, to: pos + node.nodeSize }, { type: "paragraph" })
      .setTextSelection(pos + 1)
      .focus(undefined, { scrollIntoView: false })
      .run();
    (extension.options as MediaPlaceholderOptions).uploadFiles(files);
  }, [editor, extension.options, getPos, node.nodeSize]);

  const embedLink = useCallback(async (url: string) => {
    if (kind === "bookmark") {
      const bookmark = await api.getWebBookmark(url).then((result) => result.bookmark).catch(() => bookmarkFallback(url));
      replacePlaceholder(editor, getPos, blockForLink(kind, url, bookmark));
    } else {
      replacePlaceholder(editor, getPos, blockForLink(kind, url));
    }
    setOpen(false);
  }, [editor, getPos, kind]);

  return (
    <NodeViewWrapper className={cn("ponder-media-block", selected && "is-selected")} data-media-kind={kind} contentEditable={false}>
      <Popover open={open} onOpenChange={setOpen}>
        <PopoverAnchor asChild>
          <button
            type="button"
            className="ponder-media-placeholder"
            onMouseDown={(event) => event.preventDefault()}
            onClick={() => editor.isEditable && setOpen(true)}
          >
            <Icon className="h-5 w-5 shrink-0 stroke-[1.5]" aria-hidden="true" />
            <span>{t(`pages.blocks.media.${kind}.add`)}</span>
          </button>
        </PopoverAnchor>
        <PopoverContent
          align="center"
          side="bottom"
          sideOffset={4}
          className={cn("ponder-media-panel", kind === "image" && "is-wide")}
          onOpenAutoFocus={(event) => event.preventDefault()}
          onCloseAutoFocus={(event) => event.preventDefault()}
        >
          {kind !== "bookmark" ? (
            <div className="ponder-media-tabs" role="tablist">
              {(["upload", "link"] as const).map((value) => (
                <button key={value} type="button" role="tab" aria-selected={tab === value} className="ponder-media-tab" onClick={() => setTab(value)}>
                  {t(`pages.blocks.${value}`)}
                </button>
              ))}
            </div>
          ) : null}
          {tab === "upload" && kind !== "bookmark" ? (
            <div className="ponder-media-upload">
              <button type="button" className={cn("ponder-media-choose", kind === "image" && "is-plain")} onClick={() => fileRef.current?.click()}>
                {t(`pages.blocks.media.${kind}.choose`)}
              </button>
              <input
                ref={fileRef}
                type="file"
                hidden
                multiple={kind === "image" || kind === "file"}
                accept={ACCEPT[kind]}
                onChange={(event) => {
                  upload(Array.from(event.target.files ?? []));
                  event.target.value = "";
                }}
              />
            </div>
          ) : (
            <MediaLinkField key={kind} kind={kind} onDone={embedLink} />
          )}
        </PopoverContent>
      </Popover>
    </NodeViewWrapper>
  );
};

export const EditorMediaPlaceholder = MediaPlaceholder.extend<MediaPlaceholderOptions>({
  addOptions() {
    return { uploadFiles: () => undefined };
  },
  addNodeView() {
    return ReactNodeViewRenderer(MediaPlaceholderView, { stopEvent: ({ event }) => !(event.type === "dragstart" || event.type === "drop") });
  },
});

/** A YouTube, Vimeo or Loom video in the provider's player, 16:9 like Notion's. */
const VideoEmbedView = ({ node, selected }: NodeViewProps) => {
  const url = String(node.attrs.url ?? "");
  const embed = parseVideoEmbed(url);
  return (
    <NodeViewWrapper className={cn("ponder-embed-block", selected && "is-selected")} contentEditable={false} data-provider={embed?.provider}>
      {embed ? (
        <div className="ponder-embed-frame">
          <iframe
            src={embed.embedUrl}
            title={embed.provider}
            sandbox="allow-scripts allow-same-origin allow-presentation allow-popups"
            allow="fullscreen; picture-in-picture; encrypted-media; clipboard-write"
            allowFullScreen
            loading="lazy"
            referrerPolicy="strict-origin-when-cross-origin"
          />
        </div>
      ) : (
        <a className="ponder-embed-link" href={normalizeMediaUrl(url) ?? "#"} target="_blank" rel="noopener noreferrer">{url}</a>
      )}
    </NodeViewWrapper>
  );
};

export const EditorVideoEmbed = VideoEmbed.extend({
  addNodeView() {
    return ReactNodeViewRenderer(VideoEmbedView);
  },
});

/** Notion's Web bookmark card: the preview image at the left, then the site icon, title, two lines of description and the address. */
const BookmarkView = ({ node, selected }: NodeViewProps) => {
  const { t } = useTranslation();
  const url = String(node.attrs.url ?? "");
  const fallback = bookmarkFallback(url);
  const title = String(node.attrs.title || "") || fallback.title;
  const description = String(node.attrs.description ?? "");
  const icon = /^https:\/\//i.test(String(node.attrs.icon ?? "")) ? String(node.attrs.icon) : "";
  const image = /^https:\/\//i.test(String(node.attrs.image ?? "")) ? String(node.attrs.image) : "";
  const [iconFailed, setIconFailed] = useState(false);
  const [imageFailed, setImageFailed] = useState(false);
  const href = normalizeMediaUrl(url) ?? "#";
  return (
    <NodeViewWrapper className={cn("ponder-bookmark-block", selected && "is-selected")} contentEditable={false}>
      <a className="ponder-bookmark-card" href={href} target="_blank" rel="noopener noreferrer" aria-label={`${t("pages.blocks.openLink")}: ${title}`}>
        {image && !imageFailed ? (
          <span className="ponder-bookmark-image">
            <img src={image} alt="" referrerPolicy="no-referrer" loading="lazy" onError={() => setImageFailed(true)} />
          </span>
        ) : null}
        <span className="ponder-bookmark-content">
          {icon && !iconFailed ? <img className="ponder-bookmark-icon" src={icon} alt="" width={20} height={20} referrerPolicy="no-referrer" onError={() => setIconFailed(true)} /> : null}
          <span className="ponder-bookmark-title">{title}</span>
          {description ? <span className="ponder-bookmark-description">{description}</span> : null}
          <span className="ponder-bookmark-url truncate">{url}</span>
        </span>
      </a>
    </NodeViewWrapper>
  );
};

export const EditorWebBookmark = WebBookmark.extend({
  addNodeView() {
    return ReactNodeViewRenderer(BookmarkView);
  },
});
