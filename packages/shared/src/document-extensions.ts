import type { AnyExtension } from "@tiptap/core";
import { PonderImage as Image, ImageAlignmentAttributes } from "./image-alignment";
import { ImageLinkAttributes } from "./image-link";
import { TaskList } from "@tiptap/extension-list";
import { PonderTableKit as TableKit } from "./markdown-table";
import { Markdown } from "@tiptap/markdown";
import StarterKit from "@tiptap/starter-kit";
import { createPonderDetailsExtensions } from "./details";
import { FileAttachment } from "./file-attachment";
import { ImageGallery } from "./image-gallery";
import { MergeDivider } from "./merge-divider";
import { PdfAttachment } from "./pdf-attachment";
import { PluginEmbed } from "./plugin-embed";
import { ButtonBlock, Callout, Column, Columns, DatabaseEmbed, LinkPreview, SubPage } from "./page-blocks";
import { Breadcrumb, MediaPlaceholder, Tab, TableOfContents, Tabs, VideoEmbed, WebBookmark } from "./notion-blocks";
import { AiBlock, SyncedBlock } from "./synced-ai-blocks";
import { EmptyExternalLink } from "./empty-external-link";
import { PonderLink } from "./editor-link";
import { createPonderTaskItem } from "./task-item-input";
import { MathCodeFence } from "./mathematics-markdown";
import { createPonderMarked } from "./markdown-options";
import { PageBlockAttributes, PageColorMark } from "./page-color";
import { SuggestionMarks } from "./suggestion";
import { Mention } from "./mention";

export type CreatePonderDocumentExtensionsOptions = {
  mathematics: AnyExtension[];
  starterKit?: Parameters<typeof StarterKit.configure>[0];
  image?: AnyExtension | false;
  gallery?: AnyExtension | false;
  pdf?: AnyExtension | false;
  file?: AnyExtension | false;
  pluginEmbed?: AnyExtension | false;
  subPage?: AnyExtension;
  databaseEmbed?: AnyExtension;
  linkPreview?: AnyExtension;
  buttonBlock?: AnyExtension;
  /** Editor versions (node views) of the Phase C blocks, by node name; others keep the plain node. */
  notionBlocks?: Partial<Record<"toc" | "breadcrumb" | "tabs" | "tab" | "embed" | "bookmark" | "media", AnyExtension>>;
  /** Editor versions of the Phase F blocks (synced block, AI block). */
  syncedBlock?: AnyExtension;
  aiBlock?: AnyExtension;
  table?: Parameters<typeof TableKit.configure>[0];
  /** The editor's mention node (with its node view); codecs keep the plain one. */
  mention?: AnyExtension;
  markdown?: boolean;
};

const withOptional = (value: AnyExtension | false | undefined, fallback: AnyExtension) => {
  if (value === false) return [];
  return [value ?? fallback];
};

/**
 * Document-schema TipTap extensions shared by Markdown codecs and editors.
 * Pass KaTeX math from `@ponder/shared/mathematics` in browsers; Worker
 * codecs must keep using `createPonderMarkdownMathematics()`.
 */
export const createPonderDocumentExtensions = (
  options: CreatePonderDocumentExtensionsOptions,
): AnyExtension[] => [
  options.markdown
    ? StarterKit.configure({ ...options.starterKit, link: false })
    : options.starterKit === undefined ? StarterKit : StarterKit.configure(options.starterKit),
  ...(options.markdown ? [PonderLink] : []),
  EmptyExternalLink,
  options.mention ?? Mention,
  TaskList,
  createPonderTaskItem(),
  options.table === undefined ? TableKit : TableKit.configure(options.table),
  ...withOptional(options.image, Image),
  ImageAlignmentAttributes,
  ImageLinkAttributes,
  ...withOptional(options.gallery, ImageGallery),
  ...withOptional(options.pdf, PdfAttachment),
  ...withOptional(options.file, FileAttachment),
  MergeDivider,
  ...createPonderDetailsExtensions(),
  ...withOptional(options.pluginEmbed, PluginEmbed),
  options.subPage ?? SubPage,
  options.databaseEmbed ?? DatabaseEmbed,
  options.linkPreview ?? LinkPreview,
  options.buttonBlock ?? ButtonBlock,
  options.notionBlocks?.toc ?? TableOfContents,
  options.notionBlocks?.breadcrumb ?? Breadcrumb,
  options.notionBlocks?.tabs ?? Tabs,
  options.notionBlocks?.tab ?? Tab,
  options.notionBlocks?.embed ?? VideoEmbed,
  options.notionBlocks?.bookmark ?? WebBookmark,
  options.notionBlocks?.media ?? MediaPlaceholder,
  options.syncedBlock ?? SyncedBlock,
  options.aiBlock ?? AiBlock,
  PageColorMark,
  ...SuggestionMarks,
  // Markdown has no block colours or ids, so its documents stay free of those fields.
  ...(options.markdown ? [] : [PageBlockAttributes]),
  Callout,
  Columns,
  Column,
  ...options.mathematics,
  MathCodeFence,
  ...(options.markdown
    ? [Markdown.configure({ marked: createPonderMarked(), markedOptions: { gfm: true } })]
    : []),
];
