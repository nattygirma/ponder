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
