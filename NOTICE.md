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

Parts of Ponder's inline mentions and emoji menu (Phase D of the Notion blocks
plan) are adapted from the same project and licence. The Slate and Yjs code was
rewritten for TipTap; icons, images and branding were not copied (Ponder uses
lucide icons and Notion's labels). Each file below carries a header naming the
AppFlowy-Web files it came from:

- `packages/shared/src/mention-reminders.ts`: the Remind option list and the
  filter for dates with and without a time (`leaf/mention/reminder-options.ts`).
- `apps/web/src/components/editor/mention/mentionable-members.ts`: the shared
  member cache with a 30 second lifetime and shared requests
  (`useMentionableUsers.ts`).
- `apps/web/src/components/editor/mention/mention-panel-items.ts`: section
  order, flattening sections into one keyboard list, untitled page names and the
  Today / Tomorrow / Yesterday items (`panels/mention-panel/mentionUtils.ts`,
  `MentionPanel.tsx`).
- `apps/web/src/components/editor/mention/MentionPanel.tsx`: the `@` menu's
  sections, rows, keyboard handling and inserting the chosen mention
  (`panels/mention-panel/MentionPanel.tsx`).
- `apps/web/src/components/editor/mention/EditorMention.tsx`: the person, page
  and date mention views (`leaf/mention/MentionLeaf.tsx`, `MentionPerson.tsx`,
  `MentionPage.tsx`, `MentionDate.tsx`).
- `apps/web/src/components/editor/mention/MentionDatePicker.tsx`: the date
  picker with Include time and the Remind submenu
  (`leaf/mention/MentionDatePicker.tsx`).
- `apps/web/src/components/editor/emoji/emoji-data.ts`: reading emoji-mart's
  data into categories and laying it out in rows
  (`_shared/emoji-picker/EmojiPicker.hooks.ts`).
- `apps/web/src/components/editor/emoji/EmojiSuggestion.tsx`: the emoji grid
  and its virtual list (`_shared/emoji-picker/EmojiPicker.tsx`,
  `EmojiPickerCategories.tsx`, `EmojisVirtualizer.tsx`, `EmojiItem.tsx`).

AppFlowy's `comment-mentions.ts` and `useNotifyPersonMention.ts` were read but
not used: Ponder sends mention notices from the server when a page is saved
(`apps/api/src/page-mention-service.ts`), so edits made by AI chat, MCP tools and
live co-editing count too.

### Emoji data

The `:` emoji menu uses `@emoji-mart/data` (https://github.com/missive/emoji-mart),
Copyright (c) 2022 Missive, licensed under the MIT License.
