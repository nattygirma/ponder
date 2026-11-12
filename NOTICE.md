# Notice

Ponder is a modified version of EdgeEver, Copyright its original authors,
licensed under the GNU Affero General Public License v3.0. See `LICENSE`.

Original project: https://github.com/tianma-if/edgeever (v2.19.0, commit a80d9bf)
Ponder's source: https://github.com/nattygirma/ponder

Modified between 2026-11-03 and 2026-11-10. The modifications include the
rename from EdgeEver, a Notion-style page and database workspace, team
workspaces with live co-editing, a Notion importer, login-based app
connections, sign-in through AppKeep, and the AppKeep build adapter in
`appkeep/`. They are licensed under the same terms.

## Third-party code

### AppFlowy-Web

Parts of Ponder's simple-table editing are adapted from AppFlowy-Web,
Copyright AppFlowy, licensed under the GNU Affero General Public License v3.0.

Source: https://github.com/AppFlowy-IO/AppFlowy-Web

Adapted logic, ported to TipTap and ProseMirror (no files, icons or design
assets were copied), marked with a header comment where it appears:

- Tab-separated copy and paste of table cells (`withCopy.ts`, `withPasted.ts`)
  in `packages/shared/src/markdown-table.ts` (also used by `apps/web/src/lib/editor-clipboard.ts`).
- Keeping the displayed value of inline nodes when a table is converted
  (`SimpleTable.convert.ts`) in `packages/shared/src/markdown-table.ts`.
- Fitting a table to the page width (`SimpleTable.layout.ts`) in
  `apps/web/src/lib/editor-table-actions.ts`.
- Scrolling a newly added row into view (`SimpleTable.scroll.ts`) and clipping
  the selection outline to a wide table's visible area
  (`SimpleTableActionOverlay.tsx`) in `apps/web/src/components/editor/TableControls.tsx`.
- Test cases drawn from AppFlowy-Web's simple-table Playwright specs in
  `apps/web/src/lib/editor-table-actions.test.mjs`.

Parts of Ponder's Notion-style blocks (Phase C of the Notion blocks plan) are
adapted from the same project and licence. Icons, images and branding were not
copied; Ponder uses lucide icons and Notion's labels. Each file below carries
a header naming the AppFlowy-Web files it came from:

- `packages/shared/src/page-outline.ts`: heading extraction, nesting,
  flattening and the active-heading rule (`blocks/outline/utils.ts`).
- `apps/web/src/components/pages/outlineNavigation.ts`: heading navigation,
  opening collapsed toggles and the reading-line tracker
  (`blocks/outline/OutlineNavigation.tsx`).
- `apps/web/src/components/pages/TableOfContentsBlock.tsx`: the table of
  contents block (`blocks/outline/Outline.tsx`, `OutlineContent.tsx`).
- `apps/web/src/components/pages/FloatingOutline.tsx`: the floating table of
  contents (`blocks/outline/DockableOutline.tsx`, `dockable-outline.scss`).
- `apps/web/src/components/pages/MediaBlocks.tsx`: the empty media block, its
  Upload / Link panel, the video frame and the bookmark card
  (`block-popover/{Image,Video,Audio,File}BlockPopoverContent.tsx`,
  `_shared/image-upload/EmbedLink.tsx`, `blocks/audio/AudioBlock.tsx`,
  `blocks/video/{VideoBlock,VideoEmpty,VideoRender}.tsx`,
  `blocks/link-preview/LinkPreview.tsx`).
- `packages/shared/src/media-links.ts`: adding `https://` to typed addresses
  and the audio extension rule (`utils/url.ts`,
  `block-popover/AudioBlockPopoverContent.tsx`).
- `packages/shared/src/web-bookmark.ts`: the bookmark fallback title and
  description length (`utils/link-preview.ts`).
- `apps/web/src/components/MermaidCodeBlock.tsx`: showing Mermaid's own parse
  error (`blocks/code/MermaidPreview.tsx`).

Parts of Ponder's AI Block (Phase F of the Notion blocks plan) are adapted from
AppFlowy-Web and from the AppFlowy Flutter app (https://github.com/AppFlowy-IO/AppFlowy),
both Copyright AppFlowy and licensed under the GNU Affero General Public License
v3.0. No icons, images or branding were copied; the layout and wording follow
Notion's AI block. Each file carries a header naming its sources:

- `apps/web/src/components/pages/AiBlock.tsx`: the request lifecycle of
  AppFlowy-Web's `useAIMeetingRegenerate`
  (`blocks/ai-meeting/useAIMeetingRegenerate.ts`): one active request with its
  AbortController, cancel on unmount, only the current request clearing the
  loading state, re-reading the block before replacing its children, and the
  empty-answer and error handling.
- `packages/shared/src/synced-ai-blocks.ts` (AI block section):
  `normalizeGeneratedSummaryMarkdown` and the shape of
  `buildSummaryRegeneratePrompt` (AppFlowy-Web,
  `blocks/ai-meeting/ai-meeting.summary-regenerate.ts`), and the user-question
  prompt of the Flutter app's AI writer
  (`frontend/appflowy_flutter/lib/plugins/document/presentation/editor_plugins/ai/operations/ai_writer_entities.dart`).

The synced block is Ponder's own: neither AppFlowy-Web, AppFlowy-Cloud nor the
Flutter app has one.
