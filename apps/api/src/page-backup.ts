import {
  AutomationActionSchema,
  AutomationTriggerSchema,
  DatabaseFormQuestionSchema,
  DatabaseSchemaSchema,
  nextScheduleRun,
  ScheduleSchema,
  DatabaseViewConfigSchema,
  DATABASE_VIEW_TYPES,
  type JsonBackupAutomation,
  type JsonBackupComment,
  type JsonBackupDatabase,
  type JsonBackupDatabaseTemplate,
  type JsonBackupDatabaseView,
  type JsonBackupForm,
  type JsonBackupPageNode,
  type JsonBackupPages,
  type TiptapDoc,
} from "@ponder/shared";
import { AppError } from "./app-error";
import { rescheduleAutomations } from "./automation-service";
import { replaceMemoLinksStatements } from "./page-service";
import { readSyncedBlocksBackup, replaceSyncedRefsStatements, restoreSyncedBlocksStatements } from "./synced-block-service";
import type { DatabaseAdapter, PreparedStatementAdapter } from "./storage-contract";

/*
 * Backs up and restores what turns notes into Notion-style pages: where each page sits in the
 * tree, its icon, cover and style, databases with their views and row values, and comments.
 * Notes keep their IDs through a backup, so this only ever points at memo IDs.
 * Page permissions are left out: they name team members, who belong to the workspace, not the backup.
 */

// D1 allows 100 bound parameters per statement.
const ID_CHUNK = 90;
const BATCH_SIZE = 50;

const chunks = <T>(items: T[], size: number) => {
  const out: T[][] = [];
  for (let index = 0; index < items.length; index += size) out.push(items.slice(index, index + size));
  return out;
};

const parseObject = (raw: string | null): Record<string, unknown> | null => {
  if (!raw) return null;
  try {
    const value = JSON.parse(raw) as unknown;
    return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : null;
  } catch {
    return null;
  }
};

const parseStringArray = (raw: string | null) => {
  try {
    const value = JSON.parse(raw ?? "[]") as unknown;
    return Array.isArray(value) ? value.filter((item): item is string => typeof item === "string") : [];
  } catch {
    return [];
  }
};

type PageBackupRow = {
  id: string;
  parent_memo_id: string | null;
  page_position: number | null;
  page_icon: string | null;
  page_cover: string | null;
  page_style: string | null;
  database_id: string | null;
  properties_json: string | null;
  row_number: number | null;
};

type DatabaseBackupRow = { id: string; page_memo_id: string; schema_json: string; created_at: string; updated_at: string };
type TemplateBackupRow = {
  id: string; database_id: string; name: string; icon: string | null; title: string; properties_json: string;
  content_markdown: string; is_default: number; position: number; created_at: string; updated_at: string; repeat_json: string | null;
};
type AutomationBackupRow = {
  id: string; database_id: string; name: string; enabled: number; trigger_json: string; actions_json: string;
  position: number; created_at: string; updated_at: string;
};
type FormBackupRow = {
  id: string; database_id: string; view_id: string; token: string; access: "workspace" | "public" | "closed"; anonymous: number;
  title: string; description: string; submit_label: string; confirmation_title: string; confirmation_message: string;
  submit_another: number; notify: number; fields_json: string; password_hash: string | null; created_at: string; updated_at: string;
};
type ViewBackupRow = { id: string; database_id: string; name: string; type: string; config_json: string; position: number; created_at: string; updated_at: string };
type CommentBackupRow = {
  id: string; memo_id: string; thread_id: string; quote: string | null; quote_occurrence: number; body: string;
  mentions_json: string; author_id: string | null; author_name: string; resolved_at: string | null; created_at: string; updated_at: string;
};

/** Everything a backup needs beyond the notes themselves, for the notes not in Trash. */
export const readPageBackup = async (db: DatabaseAdapter, workspaceId: string): Promise<JsonBackupPages> => {
  const [pages, databases, views, comments, templates, automations, forms, syncedBlocks] = await Promise.all([
    db.prepare(
      `SELECT id, parent_memo_id, page_position, page_icon, page_cover, page_style, database_id, properties_json, row_number
       FROM memos WHERE workspace_id = ? AND is_deleted = 0 ORDER BY id ASC`,
    ).bind(workspaceId).all<PageBackupRow>(),
    db.prepare(
      `SELECT d.id, d.page_memo_id, d.schema_json, d.created_at, d.updated_at
       FROM databases d INNER JOIN memos m ON m.id = d.page_memo_id
       WHERE d.workspace_id = ? AND m.is_deleted = 0 ORDER BY d.id ASC`,
    ).bind(workspaceId).all<DatabaseBackupRow>(),
    db.prepare(
      `SELECT v.id, v.database_id, v.name, v.type, v.config_json, v.position, v.created_at, v.updated_at
       FROM database_views v
       INNER JOIN databases d ON d.id = v.database_id
       INNER JOIN memos m ON m.id = d.page_memo_id
       WHERE v.workspace_id = ? AND m.is_deleted = 0 ORDER BY v.database_id ASC, v.position ASC, v.id ASC`,
    ).bind(workspaceId).all<ViewBackupRow>(),
    db.prepare(
      `SELECT c.id, c.memo_id, c.thread_id, c.quote, c.quote_occurrence, c.body, c.mentions_json, c.author_id,
              c.author_name, c.resolved_at, c.created_at, c.updated_at
       FROM memo_comments c INNER JOIN memos m ON m.id = c.memo_id
       WHERE c.workspace_id = ? AND m.is_deleted = 0 ORDER BY c.created_at ASC, c.id ASC`,
    ).bind(workspaceId).all<CommentBackupRow>(),
    db.prepare(
      `SELECT t.id, t.database_id, t.name, t.icon, t.title, t.properties_json, t.content_markdown, t.is_default, t.position,
              t.created_at, t.updated_at, t.repeat_json
       FROM database_templates t
       INNER JOIN databases d ON d.id = t.database_id
       INNER JOIN memos m ON m.id = d.page_memo_id
       WHERE t.workspace_id = ? AND m.is_deleted = 0 ORDER BY t.database_id ASC, t.position ASC, t.id ASC`,
    ).bind(workspaceId).all<TemplateBackupRow>(),
    db.prepare(
      `SELECT a.id, a.database_id, a.name, a.enabled, a.trigger_json, a.actions_json, a.position, a.created_at, a.updated_at
       FROM database_automations a
       INNER JOIN databases d ON d.id = a.database_id
       INNER JOIN memos m ON m.id = d.page_memo_id
       WHERE a.workspace_id = ? AND m.is_deleted = 0 ORDER BY a.database_id ASC, a.position ASC, a.id ASC`,
    ).bind(workspaceId).all<AutomationBackupRow>(),
    db.prepare(
      `SELECT f.id, f.database_id, f.view_id, f.token, f.access, f.anonymous, f.title, f.description, f.submit_label,
              f.confirmation_title, f.confirmation_message, f.submit_another, f.notify, f.fields_json, f.password_hash,
              f.created_at, f.updated_at
       FROM database_forms f
       INNER JOIN databases d ON d.id = f.database_id
       INNER JOIN memos m ON m.id = d.page_memo_id
       WHERE f.workspace_id = ? AND m.is_deleted = 0 ORDER BY f.database_id ASC, f.id ASC`,
    ).bind(workspaceId).all<FormBackupRow>(),
    readSyncedBlocksBackup(db, workspaceId),
  ]);
  const live = new Set(pages.results.map((row) => row.id));
  return {
    syncedBlocks,
    pages: pages.results.map((row): JsonBackupPageNode => ({
      memoId: row.id,
      // A parent in Trash is not in the backup; the page comes back at the top of its notebook.
      parentId: row.parent_memo_id && live.has(row.parent_memo_id) ? row.parent_memo_id : null,
      position: Number(row.page_position ?? 0),
      icon: row.page_icon,
      cover: row.page_cover,
      style: parseObject(row.page_style),
      databaseId: row.database_id,
      properties: parseObject(row.properties_json) ?? {},
      rowNumber: row.row_number,
    })),
    databases: databases.results.map((row): JsonBackupDatabase => ({
      id: row.id,
      pageMemoId: row.page_memo_id,
      schema: parseObject(row.schema_json) ?? {},
      createdAt: row.created_at,
      updatedAt: row.updated_at,
    })),
    views: views.results.map((row): JsonBackupDatabaseView => ({
      id: row.id,
      databaseId: row.database_id,
      name: row.name,
      type: row.type,
      config: parseObject(row.config_json) ?? {},
      position: Number(row.position ?? 0),
      createdAt: row.created_at,
      updatedAt: row.updated_at,
    })),
    comments: comments.results.map((row): JsonBackupComment => ({
      id: row.id,
      memoId: row.memo_id,
      threadId: row.thread_id,
      quote: row.quote,
      quoteOccurrence: Number(row.quote_occurrence ?? 0),
      body: row.body,
      mentions: parseStringArray(row.mentions_json),
      authorId: row.author_id,
      authorName: row.author_name,
      resolvedAt: row.resolved_at,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
    })),
    templates: templates.results.map((row): JsonBackupDatabaseTemplate => ({
      id: row.id,
      databaseId: row.database_id,
      name: row.name,
      icon: row.icon,
      title: row.title,
      properties: parseObject(row.properties_json) ?? {},
      content: row.content_markdown,
      isDefault: row.is_default === 1,
      position: Number(row.position ?? 0),
      createdAt: row.created_at,
      updatedAt: row.updated_at,
      repeat: parseObject(row.repeat_json),
    })),
    automations: automations.results.map((row): JsonBackupAutomation => ({
      id: row.id,
      databaseId: row.database_id,
      name: row.name,
      enabled: row.enabled === 1,
      trigger: parseObject(row.trigger_json) ?? {},
      actions: (() => {
        try {
          const parsed = JSON.parse(row.actions_json) as unknown;
          return Array.isArray(parsed) ? parsed.filter((item): item is Record<string, unknown> => !!item && typeof item === "object") : [];
        } catch {
          return [];
        }
      })(),
      position: Number(row.position ?? 0),
      createdAt: row.created_at,
      updatedAt: row.updated_at,
    })),
    forms: forms.results.map((row): JsonBackupForm => ({
      id: row.id,
      databaseId: row.database_id,
      viewId: row.view_id,
      token: row.token,
      access: row.access,
      anonymous: row.anonymous === 1,
      title: row.title,
      description: row.description,
      submitLabel: row.submit_label,
      confirmationTitle: row.confirmation_title,
      confirmationMessage: row.confirmation_message,
      submitAnother: row.submit_another === 1,
      notify: row.notify === 1,
      questions: (() => {
        try {
          const parsed = JSON.parse(row.fields_json) as unknown;
          return Array.isArray(parsed) ? parsed.filter((item): item is Record<string, unknown> => !!item && typeof item === "object") : [];
        } catch {
          return [];
        }
      })(),
      passwordProtected: Boolean(row.password_hash),
      createdAt: row.created_at,
      updatedAt: row.updated_at,
    })),
  };
};

const invalid = (message: string) => new AppError("invalid_backup", message, 400);

/** IDs from `ids` that exist in `table` for this workspace (and, when asked, aren't in Trash). */
const existingIds = async (db: DatabaseAdapter, table: "memos" | "databases", workspaceId: string, ids: string[]) => {
  const found = new Set<string>();
  for (const chunk of chunks([...new Set(ids)], ID_CHUNK)) {
    const extra = table === "memos" ? " AND is_deleted = 0" : "";
    const rows = await db.prepare(
      `SELECT id FROM ${table} WHERE workspace_id = ?${extra} AND id IN (${chunk.map(() => "?").join(", ")})`,
    ).bind(workspaceId, ...chunk).all<{ id: string }>();
    for (const row of rows.results) found.add(row.id);
  }
  return found;
};

/** A restore never overwrites another workspace's rows. */
const assertNotInOtherWorkspace = async (
  db: DatabaseAdapter,
  table: "databases" | "database_views" | "database_templates" | "database_automations" | "database_forms" | "memo_comments",
  workspaceId: string,
  ids: string[],
) => {
  for (const chunk of chunks(ids, ID_CHUNK)) {
    const collision = await db.prepare(
      `SELECT id FROM ${table} WHERE workspace_id <> ? AND id IN (${chunk.map(() => "?").join(", ")}) LIMIT 1`,
    ).bind(workspaceId, ...chunk).first<{ id: string }>();
    if (collision) throw new AppError("cross_workspace_id_conflict", "Backup contains an ID already used by another user.", 409);
  }
};

const runBatches = async (db: DatabaseAdapter, statements: PreparedStatementAdapter[]) => {
  for (const batch of chunks(statements, BATCH_SIZE)) await db.batch(batch);
};

/**
 * Restores one request's worth of page data into notes that were already restored.
 * The client sends databases, then views, then pages, then comments, so each list can
 * refer to what came before it. Writing the same data twice changes nothing.
 */
export const restorePageBackup = async (db: DatabaseAdapter, workspaceId: string, input: JsonBackupPages) => {
  const { pages, databases, views, comments } = input;
  const templates = input.templates ?? [];
  const automations = input.automations ?? [];
  const forms = input.forms ?? [];
  const syncedBlocks = input.syncedBlocks ?? [];
  const memoIds = [
    ...syncedBlocks.map((block) => block.sourceMemoId),
    ...pages.flatMap((page) => [page.memoId, ...(page.parentId ? [page.parentId] : [])]),
    ...databases.map((database) => database.pageMemoId),
    ...comments.map((comment) => comment.memoId),
  ];
  const memos = await existingIds(db, "memos", workspaceId, memoIds);
  const missing = memoIds.find((id) => !memos.has(id));
  if (missing) throw invalid("Backup page data points at a note that wasn't restored.");

  for (const database of databases) {
    if (!DatabaseSchemaSchema.safeParse(database.schema).success) throw invalid("A database in the backup has a damaged schema.");
  }
  for (const view of views) {
    if (!(DATABASE_VIEW_TYPES as readonly string[]).includes(view.type)) throw invalid("A database view in the backup has an unknown type.");
  }
  await assertNotInOtherWorkspace(db, "databases", workspaceId, databases.map((item) => item.id));
  await assertNotInOtherWorkspace(db, "database_views", workspaceId, views.map((item) => item.id));
  await assertNotInOtherWorkspace(db, "database_templates", workspaceId, templates.map((item) => item.id));
  await assertNotInOtherWorkspace(db, "database_automations", workspaceId, automations.map((item) => item.id));
  await assertNotInOtherWorkspace(db, "database_forms", workspaceId, forms.map((item) => item.id));
  // A form link belongs to one form: a token another workspace (or another form) uses is never taken over.
  for (const chunk of chunks(forms, ID_CHUNK)) {
    const taken = await db.prepare(
      `SELECT id FROM database_forms WHERE token IN (${chunk.map(() => "?").join(", ")}) AND NOT (workspace_id = ? AND id IN (${chunk.map(() => "?").join(", ")})) LIMIT 1`,
    ).bind(...chunk.map((form) => form.token), workspaceId, ...chunk.map((form) => form.id)).first<{ id: string }>();
    if (taken) throw new AppError("cross_workspace_id_conflict", "Backup contains a form link already used by another form.", 409);
  }
  await assertNotInOtherWorkspace(db, "memo_comments", workspaceId, comments.map((item) => item.id));

  const databaseIds = [...views.map((view) => view.databaseId), ...templates.map((template) => template.databaseId), ...automations.map((item) => item.databaseId), ...forms.map((item) => item.databaseId), ...pages.flatMap((page) => (page.databaseId ? [page.databaseId] : []))];
  const knownDatabases = await existingIds(db, "databases", workspaceId, databaseIds);
  for (const database of databases) knownDatabases.add(database.id);
  if (databaseIds.some((id) => !knownDatabases.has(id))) throw invalid("Backup page data points at a database that isn't in it.");

  // A page can't end up inside itself.
  const parents = new Map(pages.map((page) => [page.memoId, page.parentId]));
  for (const page of pages) {
    const seen = new Set([page.memoId]);
    let parent = page.parentId;
    while (parent) {
      if (seen.has(parent)) throw invalid("Backup pages are nested inside themselves.");
      seen.add(parent);
      parent = parents.get(parent) ?? null;
    }
  }

  const statements: PreparedStatementAdapter[] = [];
  for (const database of databases) {
    statements.push(db.prepare(
      `INSERT INTO databases (id, workspace_id, page_memo_id, schema_json, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?)
       ON CONFLICT(id) DO UPDATE SET schema_json = excluded.schema_json, updated_at = excluded.updated_at
       WHERE databases.workspace_id = excluded.workspace_id`,
    ).bind(database.id, workspaceId, database.pageMemoId, JSON.stringify(database.schema), database.createdAt, database.updatedAt));
  }
  for (const view of views) {
    const config = DatabaseViewConfigSchema.safeParse(view.config);
    statements.push(db.prepare(
      `INSERT INTO database_views (id, database_id, workspace_id, name, type, config_json, position, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(id) DO UPDATE SET name = excluded.name, type = excluded.type, config_json = excluded.config_json,
         position = excluded.position, updated_at = excluded.updated_at
       WHERE database_views.workspace_id = excluded.workspace_id`,
    ).bind(view.id, view.databaseId, workspaceId, view.name, view.type, JSON.stringify(config.success ? config.data : {}), view.position, view.createdAt, view.updatedAt));
  }
  for (const template of templates) {
    statements.push(db.prepare(
      `INSERT INTO database_templates (id, database_id, workspace_id, name, icon, title, properties_json, content_markdown, is_default, position, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(id) DO UPDATE SET name = excluded.name, icon = excluded.icon, title = excluded.title,
         properties_json = excluded.properties_json, content_markdown = excluded.content_markdown,
         is_default = excluded.is_default, position = excluded.position, updated_at = excluded.updated_at
       WHERE database_templates.workspace_id = excluded.workspace_id AND database_templates.database_id = excluded.database_id`,
    ).bind(
      template.id, template.databaseId, workspaceId, template.name, template.icon, template.title, JSON.stringify(template.properties),
      template.content, template.isDefault ? 1 : 0, template.position, template.createdAt, template.updatedAt,
    ));
    if (template.repeat !== undefined) {
      // A repeat starts again from now; a damaged one is dropped rather than failing the restore.
      const repeat = template.repeat ? ScheduleSchema.safeParse(template.repeat) : null;
      const schedule = repeat?.success ? repeat.data : null;
      statements.push(db.prepare(
        `UPDATE database_templates SET repeat_json = ?, repeat_next_at = ?, repeat_runs = 0 WHERE workspace_id = ? AND id = ?`,
      ).bind(schedule ? JSON.stringify(schedule) : null, schedule ? nextScheduleRun(schedule, new Date())?.toISOString() ?? null : null, workspaceId, template.id));
    }
  }
  const restoredAutomations: string[] = [];
  for (const automation of automations) {
    const trigger = AutomationTriggerSchema.safeParse(automation.trigger);
    const actions = automation.actions.flatMap((item) => {
      const action = AutomationActionSchema.safeParse(item);
      return action.success ? [action.data] : [];
    });
    if (!trigger.success || actions.length === 0) continue;
    restoredAutomations.push(automation.id);
    statements.push(db.prepare(
      `INSERT INTO database_automations (id, workspace_id, database_id, name, enabled, trigger_json, actions_json, position, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(id) DO UPDATE SET name = excluded.name, enabled = excluded.enabled, trigger_json = excluded.trigger_json,
         actions_json = excluded.actions_json, position = excluded.position, updated_at = excluded.updated_at
       WHERE database_automations.workspace_id = excluded.workspace_id AND database_automations.database_id = excluded.database_id`,
    ).bind(
      automation.id, automation.databaseId, workspaceId, automation.name, automation.enabled ? 1 : 0, JSON.stringify(trigger.data),
      JSON.stringify(actions), automation.position, automation.createdAt, automation.updatedAt,
    ));
  }
  for (const form of forms) {
    const questions = form.questions.flatMap((item) => {
      const question = DatabaseFormQuestionSchema.safeParse(item);
      return question.success ? [question.data] : [];
    });
    // The password isn't in the backup, so a protected public form comes back closed until someone sets a new one.
    const access = form.passwordProtected && form.access === "public" ? "closed" : form.access;
    statements.push(db.prepare(
      `INSERT INTO database_forms (id, workspace_id, database_id, view_id, token, access, anonymous, title, description, submit_label,
         confirmation_title, confirmation_message, submit_another, notify, fields_json, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(id) DO UPDATE SET access = excluded.access, anonymous = excluded.anonymous, title = excluded.title,
         description = excluded.description, submit_label = excluded.submit_label, confirmation_title = excluded.confirmation_title,
         confirmation_message = excluded.confirmation_message, submit_another = excluded.submit_another, notify = excluded.notify,
         fields_json = excluded.fields_json, updated_at = excluded.updated_at
       WHERE database_forms.workspace_id = excluded.workspace_id AND database_forms.database_id = excluded.database_id`,
    ).bind(
      form.id, workspaceId, form.databaseId, form.viewId, form.token, access, form.anonymous ? 1 : 0, form.title, form.description,
      form.submitLabel, form.confirmationTitle, form.confirmationMessage, form.submitAnother ? 1 : 0, form.notify ? 1 : 0,
      JSON.stringify(questions), form.createdAt, form.updatedAt,
    ));
  }
  for (const page of pages) {
    statements.push(db.prepare(
      `UPDATE memos SET parent_memo_id = ?, page_position = ?, page_icon = ?, page_cover = ?, page_style = ?,
         database_id = ?, properties_json = ?, row_number = COALESCE(?, row_number)
       WHERE workspace_id = ? AND id = ?`,
    ).bind(
      page.parentId,
      page.position,
      page.icon,
      page.cover,
      page.style ? JSON.stringify(page.style) : null,
      page.databaseId,
      JSON.stringify(page.properties),
      page.rowNumber ?? null,
      workspaceId,
      page.memoId,
    ));
  }
  for (const comment of comments) {
    statements.push(db.prepare(
      `INSERT INTO memo_comments (id, workspace_id, memo_id, thread_id, quote, quote_occurrence, body, mentions_json,
         author_id, author_name, resolved_at, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(id) DO NOTHING`,
    ).bind(
      comment.id, workspaceId, comment.memoId, comment.threadId, comment.quote, comment.quoteOccurrence, comment.body,
      JSON.stringify(comment.mentions), comment.authorId, comment.authorName, comment.resolvedAt, comment.createdAt, comment.updatedAt,
    ));
  }
  await runBatches(db, statements);
  // Time-based automations count from the restore, not from when the backup was made.
  if (restoredAutomations.length) await rescheduleAutomations(db, workspaceId, restoredAutomations, new Date());

  // A restored row keeps its number, so new rows must count on from the highest one.
  const rowDatabases = [...new Set(pages.flatMap((page) => (page.databaseId ? [page.databaseId] : [])))];
  for (const chunk of chunks(rowDatabases, ID_CHUNK)) {
    await db.prepare(
      `UPDATE databases SET next_row_number = MAX(next_row_number,
         COALESCE((SELECT MAX(row_number) FROM memos WHERE memos.database_id = databases.id), 0) + 1)
       WHERE workspace_id = ? AND id IN (${chunk.map(() => "?").join(", ")})`,
    ).bind(workspaceId, ...chunk).run();
  }

  // Synced blocks come before the pages' references to them, so the references find them.
  await runBatches(db, await restoreSyncedBlocksStatements(db, workspaceId, syncedBlocks));

  // Restored notes don't index their page links; do it now so backlinks come back too.
  const pageIds = pages.map((page) => page.memoId);
  const linkStatements: PreparedStatementAdapter[] = [];
  for (const chunk of chunks(pageIds, ID_CHUNK)) {
    const rows = await db.prepare(
      `SELECT memo_id, content_json FROM memo_contents WHERE memo_id IN (${chunk.map(() => "?").join(", ")})`,
    ).bind(...chunk).all<{ memo_id: string; content_json: string | null }>();
    for (const row of rows.results) {
      const doc = parseObject(row.content_json) as TiptapDoc | null;
      if (doc) linkStatements.push(...replaceMemoLinksStatements(db, workspaceId, row.memo_id, doc), ...replaceSyncedRefsStatements(db, workspaceId, row.memo_id, doc));
    }
  }
  await runBatches(db, linkStatements);
  return { syncedBlocks: syncedBlocks.length, pages: pages.length, databases: databases.length, views: views.length, comments: comments.length };
};
