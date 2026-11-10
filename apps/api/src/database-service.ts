import {
  COMPUTED_PROPERTY_TYPES,
  createDefaultDatabaseSchema,
  DATABASE_ROW_LIMIT,
  DATABASE_TEMPLATE_LIMIT,
  DatabaseRowValueSchema,
  DatabaseSchemaSchema,
  DatabaseViewConfigSchema,
  DEFAULT_MEMO_TITLE,
  type DatabaseDetail,
  type DatabaseProperty,
  type DatabasePropertyValue,
  type DatabaseRow,
  type DatabaseSchema,
  type DatabaseTemplate,
  type DatabaseView,
  type DatabaseViewConfig,
  type DatabaseViewType,
  userIdFromActorLabel,
} from "@ponder/shared";
import type { AuditActor } from "./api-context";
import { AppError } from "./app-error";
import { createId, isoNow } from "./entity-utils";
import { createMemoRecord, updateMemoRecord } from "./memo-service";
import { resolveNewPagePlacement, setPagePlacement } from "./page-service";
import type { DatabaseAdapter, PreparedStatementAdapter } from "./storage-contract";

const POSITION_GAP = 1024;
const shortId = () => crypto.randomUUID().replace(/-/g, "").slice(0, 12);

type DatabaseRowRecord = {
  id: string;
  workspace_id: string;
  page_memo_id: string;
  schema_json: string;
  updated_at: string;
  notebook_id: string;
  title: string | null;
  page_icon: string | null;
};

type ViewRecord = {
  id: string;
  database_id: string;
  name: string;
  type: string;
  config_json: string;
  position: number;
};

type RowRecord = {
  id: string;
  title: string | null;
  page_icon: string | null;
  page_cover: string | null;
  excerpt: string;
  properties_json: string;
  page_position: number;
  row_number: number | null;
  created_by: string | null;
  updated_by: string | null;
  created_at: string;
  updated_at: string;
};

type TemplateRecord = {
  id: string;
  database_id: string;
  name: string;
  icon: string | null;
  title: string;
  properties_json: string;
  content_markdown: string;
  is_default: number;
  position: number;
};

const ROW_COLUMNS = "id, title, page_icon, page_cover, excerpt, properties_json, page_position, row_number, created_by, updated_by, created_at, updated_at";

const visibleTitle = (title: string | null) => (title === DEFAULT_MEMO_TITLE ? null : title);

const parseProperties = (json: string): Record<string, DatabasePropertyValue> => {
  try {
    const parsed = JSON.parse(json) as unknown;
    return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed as Record<string, DatabasePropertyValue> : {};
  } catch {
    return {};
  }
};

const mapView = (row: ViewRecord): DatabaseView => {
  const config = DatabaseViewConfigSchema.safeParse(JSON.parse(row.config_json));
  return {
    id: row.id,
    databaseId: row.database_id,
    name: row.name,
    type: row.type as DatabaseViewType,
    config: config.success ? config.data : {},
    position: row.position,
  };
};

const mapRow = (row: RowRecord): DatabaseRow => ({
  id: row.id,
  title: visibleTitle(row.title),
  icon: row.page_icon,
  cover: row.page_cover,
  excerpt: row.excerpt,
  properties: parseProperties(row.properties_json),
  position: row.page_position,
  number: row.row_number,
  createdBy: userIdFromActorLabel(row.created_by),
  updatedBy: userIdFromActorLabel(row.updated_by),
  createdAt: row.created_at,
  updatedAt: row.updated_at,
});

const mapTemplate = (row: TemplateRecord): DatabaseTemplate => ({
  id: row.id,
  databaseId: row.database_id,
  name: row.name,
  icon: row.icon,
  title: row.title,
  properties: parseProperties(row.properties_json),
  content: row.content_markdown,
  isDefault: row.is_default === 1,
  position: row.position,
});

const loadDatabaseRecord = async (db: DatabaseAdapter, workspaceId: string, id: string) => {
  const record = await db
    .prepare(
      `SELECT d.id, d.workspace_id, d.page_memo_id, d.schema_json, d.updated_at, m.notebook_id, m.title, m.page_icon
       FROM databases d
       INNER JOIN memos m ON m.id = d.page_memo_id
       WHERE d.workspace_id = ? AND d.id = ? AND m.is_deleted = 0`
    )
    .bind(workspaceId, id)
    .first<DatabaseRowRecord>();
  if (!record) throw new AppError("not_found", "Database not found", 404);
  return record;
};

const parseSchema = (json: string): DatabaseSchema => {
  const parsed = DatabaseSchemaSchema.safeParse(JSON.parse(json));
  if (!parsed.success) throw new AppError("invalid_database", "This database's schema is damaged.", 500);
  return parsed.data;
};

const listTemplates = (db: DatabaseAdapter, workspaceId: string, databaseId: string) =>
  db
    .prepare(
      `SELECT id, database_id, name, icon, title, properties_json, content_markdown, is_default, position
       FROM database_templates WHERE workspace_id = ? AND database_id = ?
       ORDER BY position ASC, created_at ASC`
    )
    .bind(workspaceId, databaseId)
    .all<TemplateRecord>();

export const getDatabase = async (db: DatabaseAdapter, workspaceId: string, id: string): Promise<DatabaseDetail> => {
  const record = await loadDatabaseRecord(db, workspaceId, id);
  const [views, templates] = await Promise.all([
    db
      .prepare(
        `SELECT id, database_id, name, type, config_json, position
         FROM database_views WHERE database_id = ? AND workspace_id = ?
         ORDER BY position ASC, created_at ASC`
      )
      .bind(id, workspaceId)
      .all<ViewRecord>(),
    listTemplates(db, workspaceId, id),
  ]);
  return {
    id: record.id,
    pageMemoId: record.page_memo_id,
    notebookId: record.notebook_id,
    title: visibleTitle(record.title),
    icon: record.page_icon,
    schema: parseSchema(record.schema_json),
    views: views.results.map(mapView),
    templates: templates.results.map(mapTemplate),
    updatedAt: record.updated_at,
  };
};

export const createDatabase = async (
  db: DatabaseAdapter,
  workspaceId: string,
  input: { notebookId?: string; parentId?: string | null; title?: string; schema?: DatabaseSchema },
  actor: AuditActor,
  actorLabel: string,
): Promise<DatabaseDetail> => {
  const placement = await resolveNewPagePlacement(db, workspaceId, input);
  const page = await createMemoRecord(
    db,
    workspaceId,
    { notebookId: placement.notebookId, title: input.title, contentMarkdown: "", tags: [] },
    actor,
    actorLabel,
  );
  await setPagePlacement(db, workspaceId, page.id, { parentId: placement.parentId, position: placement.position });

  const id = createId("db");
  const now = isoNow();
  const schema = input.schema ?? createDefaultDatabaseSchema(shortId);
  await db.batch([
    db
      .prepare(`INSERT INTO databases (id, workspace_id, page_memo_id, schema_json, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)`)
      .bind(id, workspaceId, page.id, JSON.stringify(schema), now, now),
    db
      .prepare(
        `INSERT INTO database_views (id, database_id, workspace_id, name, type, config_json, position, created_at, updated_at)
         VALUES (?, ?, ?, 'Table', 'table', '{}', ?, ?, ?)`
      )
      .bind(createId("dbv"), id, workspaceId, POSITION_GAP, now, now),
  ]);
  return getDatabase(db, workspaceId, id);
};

/** Sub-items and dependencies relate a database's rows to each other, so both of their relations must point back at it. */
const assertSelfRelations = (databaseId: string, schema: DatabaseSchema) => {
  const pairs = [schema.subItems, schema.dependencies].flatMap((pair) => (pair ? Object.values(pair) : []));
  for (const propertyId of pairs) {
    const property = schema.properties.find((item) => item.id === propertyId);
    if (property?.relation?.databaseId !== databaseId) {
      throw new AppError("invalid_schema", "Sub-items and dependencies must relate this database to itself.", 400);
    }
  }
};

const assertRelationTargets = async (db: DatabaseAdapter, workspaceId: string, schema: DatabaseSchema) => {
  const targets = new Set(
    schema.properties.flatMap((property) => (property.type === "relation" && property.relation ? [property.relation.databaseId] : [])),
  );
  for (const target of targets) {
    await loadDatabaseRecord(db, workspaceId, target);
  }
};

export const updateDatabase = async (
  db: DatabaseAdapter,
  workspaceId: string,
  id: string,
  input: { schema?: DatabaseSchema; title?: string },
  actor: AuditActor,
  actorLabel: string,
): Promise<DatabaseDetail> => {
  const record = await loadDatabaseRecord(db, workspaceId, id);
  if (input.title !== undefined) {
    const result = await updateMemoRecord(db, workspaceId, record.page_memo_id, { title: input.title }, actor, actorLabel);
    if (result.error) throw new AppError(result.error, result.message, result.status ?? 400);
  }
  if (input.schema) {
    assertSelfRelations(id, input.schema);
    await assertRelationTargets(db, workspaceId, input.schema);
    await db
      .prepare(`UPDATE databases SET schema_json = ?, updated_at = ? WHERE workspace_id = ? AND id = ?`)
      .bind(JSON.stringify(input.schema), isoNow(), workspaceId, id)
      .run();
  }
  return getDatabase(db, workspaceId, id);
};

export const listDatabaseRows = async (
  db: DatabaseAdapter,
  workspaceId: string,
  id: string,
  options: { afterPosition?: number; afterId?: string; limit?: number },
): Promise<{ rows: DatabaseRow[]; nextCursor: string | null }> => {
  await loadDatabaseRecord(db, workspaceId, id);
  const limit = Math.min(Math.max(options.limit ?? 500, 1), 1000);
  const hasCursor = options.afterPosition !== undefined && options.afterId !== undefined;
  const result = await db
    .prepare(
      `SELECT ${ROW_COLUMNS}
       FROM memos
       WHERE workspace_id = ? AND database_id = ? AND is_deleted = 0
         ${hasCursor ? "AND (page_position > ? OR (page_position = ? AND id > ?))" : ""}
       ORDER BY page_position ASC, id ASC
       LIMIT ?`
    )
    .bind(
      ...(hasCursor
        ? [workspaceId, id, options.afterPosition, options.afterPosition, options.afterId, limit + 1]
        : [workspaceId, id, limit + 1]),
    )
    .all<RowRecord>();
  const page = result.results.slice(0, limit);
  const last = page[page.length - 1];
  return {
    rows: page.map(mapRow),
    nextCursor: result.results.length > limit && last ? `${last.page_position}:${last.id}` : null,
  };
};

const getRowRecord = async (db: DatabaseAdapter, workspaceId: string, databaseId: string, rowId: string) => {
  const row = await db
    .prepare(
      `SELECT ${ROW_COLUMNS}
       FROM memos WHERE workspace_id = ? AND database_id = ? AND id = ? AND is_deleted = 0`
    )
    .bind(workspaceId, databaseId, rowId)
    .first<RowRecord>();
  if (!row) throw new AppError("not_found", "Row not found", 404);
  return row;
};

const storedProperties = (schema: DatabaseSchema) =>
  new Map(
    schema.properties
      .filter((property) => !COMPUTED_PROPERTY_TYPES.has(property.type))
      .map((property) => [property.id, property]),
  );

const sanitizeValues = (schema: DatabaseSchema, values: Record<string, DatabasePropertyValue> | undefined) => {
  const known = storedProperties(schema);
  return Object.fromEntries(Object.entries(values ?? {}).filter(([key]) => known.has(key)));
};

const asIdList = (value: DatabasePropertyValue | undefined): string[] =>
  (Array.isArray(value) ? value.filter((item): item is string => typeof item === "string") : []);

/** Mirrors a relation edit onto the other database when the relation is two-way. */
const syncRelationStatements = async (
  db: DatabaseAdapter,
  workspaceId: string,
  rowId: string,
  schema: DatabaseSchema,
  before: Record<string, DatabasePropertyValue>,
  changes: Record<string, DatabasePropertyValue>,
): Promise<PreparedStatementAdapter[]> => {
  const statements: PreparedStatementAdapter[] = [];
  const pendingWrites = new Map<string, Record<string, DatabasePropertyValue>>();

  const properties: DatabaseProperty[] = schema.properties.filter(
    (property) => property.type === "relation" && property.relation?.syncedPropertyId && property.id in changes,
  );
  for (const property of properties) {
    const synced = property.relation!.syncedPropertyId!;
    const previous = new Set(asIdList(before[property.id]));
    const next = new Set(asIdList(changes[property.id]));
    const touched = [...next].filter((id) => !previous.has(id)).concat([...previous].filter((id) => !next.has(id)));
    for (const targetId of touched) {
      let target = pendingWrites.get(targetId);
      if (!target) {
        const row = await db
          .prepare(`SELECT properties_json FROM memos WHERE workspace_id = ? AND id = ? AND is_deleted = 0 AND database_id = ?`)
          .bind(workspaceId, targetId, property.relation!.databaseId)
          .first<{ properties_json: string }>();
        if (!row) continue;
        target = parseProperties(row.properties_json);
        pendingWrites.set(targetId, target);
      }
      const links = new Set(asIdList(target[synced]));
      if (next.has(targetId)) links.add(rowId);
      else links.delete(rowId);
      target[synced] = [...links];
    }
  }

  for (const [targetId, values] of pendingWrites) {
    statements.push(
      db.prepare(`UPDATE memos SET properties_json = ? WHERE workspace_id = ? AND id = ?`)
        .bind(JSON.stringify(values), workspaceId, targetId),
    );
  }
  return statements;
};

const nextRowPosition = async (db: DatabaseAdapter, workspaceId: string, databaseId: string) => {
  const row = await db
    .prepare(`SELECT MAX(page_position) AS position FROM memos WHERE workspace_id = ? AND database_id = ? AND is_deleted = 0`)
    .bind(workspaceId, databaseId)
    .first<{ position: number | null }>();
  return (row?.position ?? 0) + POSITION_GAP;
};

/** Takes the database's next row number. Numbers are never handed out twice, even if the row isn't made. */
const takeRowNumber = async (db: DatabaseAdapter, workspaceId: string, databaseId: string) => {
  const taken = await db
    .prepare(`UPDATE databases SET next_row_number = next_row_number + 1 WHERE workspace_id = ? AND id = ? RETURNING next_row_number - 1 AS number`)
    .bind(workspaceId, databaseId)
    .first<{ number: number }>();
  return taken?.number ?? null;
};

const getTemplateRecord = async (db: DatabaseAdapter, workspaceId: string, databaseId: string, templateId: string) => {
  const template = await db
    .prepare(
      `SELECT id, database_id, name, icon, title, properties_json, content_markdown, is_default, position
       FROM database_templates WHERE workspace_id = ? AND database_id = ? AND id = ?`
    )
    .bind(workspaceId, databaseId, templateId)
    .first<TemplateRecord>();
  if (!template) throw new AppError("not_found", "Template not found", 404);
  return mapTemplate(template);
};

export const createDatabaseRow = async (
  db: DatabaseAdapter,
  workspaceId: string,
  databaseId: string,
  input: { title?: string; properties?: Record<string, DatabasePropertyValue>; templateId?: string },
  actor: AuditActor,
  actorLabel: string,
): Promise<DatabaseRow> => {
  const record = await loadDatabaseRecord(db, workspaceId, databaseId);
  const count = await db
    .prepare(`SELECT COUNT(*) AS total FROM memos WHERE workspace_id = ? AND database_id = ? AND is_deleted = 0`)
    .bind(workspaceId, databaseId)
    .first<{ total: number }>();
  if ((count?.total ?? 0) >= DATABASE_ROW_LIMIT) {
    throw new AppError("database_full", `A database can hold at most ${DATABASE_ROW_LIMIT} rows.`, 409);
  }
  const schema = parseSchema(record.schema_json);
  const template = input.templateId ? await getTemplateRecord(db, workspaceId, databaseId, input.templateId) : null;
  const values = sanitizeValues(schema, { ...template?.properties, ...input.properties });
  const created = await createMemoRecord(
    db,
    workspaceId,
    {
      notebookId: record.notebook_id,
      title: input.title ?? (template?.title || undefined),
      contentMarkdown: template?.content ?? "",
      tags: [],
    },
    actor,
    actorLabel,
  );
  const [position, number] = await Promise.all([
    nextRowPosition(db, workspaceId, databaseId),
    takeRowNumber(db, workspaceId, databaseId),
  ]);
  const syncStatements = await syncRelationStatements(db, workspaceId, created.id, schema, {}, values);
  await db.batch([
    db
      // The database page is the row's parent, so deleting or restoring the database carries its rows along.
      .prepare(
        `UPDATE memos SET database_id = ?, parent_memo_id = ?, properties_json = ?, page_position = ?, row_number = ?,
           page_icon = COALESCE(?, page_icon)
         WHERE workspace_id = ? AND id = ?`
      )
      .bind(databaseId, record.page_memo_id, JSON.stringify(values), position, number, template?.icon ?? null, workspaceId, created.id),
    ...syncStatements,
  ]);
  return mapRow(await getRowRecord(db, workspaceId, databaseId, created.id));
};

export const updateDatabaseRow = async (
  db: DatabaseAdapter,
  workspaceId: string,
  databaseId: string,
  rowId: string,
  input: { title?: string; properties?: Record<string, DatabasePropertyValue>; beforeId?: string | null; afterId?: string | null },
  actor: AuditActor,
  actorLabel: string,
): Promise<DatabaseRow> => {
  const record = await loadDatabaseRecord(db, workspaceId, databaseId);
  const schema = parseSchema(record.schema_json);
  const row = await getRowRecord(db, workspaceId, databaseId, rowId);

  if (input.title !== undefined) {
    const result = await updateMemoRecord(db, workspaceId, rowId, { title: input.title }, actor, actorLabel);
    if (result.error) throw new AppError(result.error, result.message, result.status ?? 400);
  }

  const statements: PreparedStatementAdapter[] = [];
  if (input.properties) {
    const before = parseProperties(row.properties_json);
    const changes = sanitizeValues(schema, input.properties);
    statements.push(
      db.prepare(`UPDATE memos SET properties_json = ?, updated_at = ?, updated_by = ? WHERE workspace_id = ? AND id = ?`)
        .bind(JSON.stringify({ ...before, ...changes }), isoNow(), actorLabel, workspaceId, rowId),
      ...await syncRelationStatements(db, workspaceId, rowId, schema, before, changes),
    );
  }

  const anchorId = input.beforeId ?? input.afterId;
  if (anchorId) {
    const position = await rowPositionNextTo(db, workspaceId, databaseId, anchorId, input.beforeId ? "before" : "after", rowId);
    statements.push(
      db.prepare(`UPDATE memos SET page_position = ? WHERE workspace_id = ? AND id = ?`).bind(position, workspaceId, rowId),
    );
  }

  if (statements.length > 0) await db.batch(statements);
  return mapRow(await getRowRecord(db, workspaceId, databaseId, rowId));
};

const rowPositionNextTo = async (
  db: DatabaseAdapter,
  workspaceId: string,
  databaseId: string,
  anchorId: string,
  side: "before" | "after",
  movingId: string,
) => {
  const anchor = await getRowRecord(db, workspaceId, databaseId, anchorId);
  const neighbor = await db
    .prepare(
      `SELECT page_position FROM memos
       WHERE workspace_id = ? AND database_id = ? AND is_deleted = 0 AND id <> ?
         AND page_position ${side === "before" ? "<" : ">"} ?
       ORDER BY page_position ${side === "before" ? "DESC" : "ASC"}
       LIMIT 1`
    )
    .bind(workspaceId, databaseId, movingId, anchor.page_position)
    .first<{ page_position: number }>();
  if (!neighbor) return anchor.page_position + (side === "before" ? -POSITION_GAP : POSITION_GAP);
  return (anchor.page_position + neighbor.page_position) / 2;
};

export const createDatabaseView = async (
  db: DatabaseAdapter,
  workspaceId: string,
  databaseId: string,
  input: { name: string; type: DatabaseViewType; config?: DatabaseViewConfig },
): Promise<DatabaseView> => {
  await loadDatabaseRecord(db, workspaceId, databaseId);
  const last = await db
    .prepare(`SELECT MAX(position) AS position FROM database_views WHERE database_id = ? AND workspace_id = ?`)
    .bind(databaseId, workspaceId)
    .first<{ position: number | null }>();
  const id = createId("dbv");
  const now = isoNow();
  const position = (last?.position ?? 0) + POSITION_GAP;
  await db
    .prepare(
      `INSERT INTO database_views (id, database_id, workspace_id, name, type, config_json, position, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
    )
    .bind(id, databaseId, workspaceId, input.name, input.type, JSON.stringify(input.config ?? {}), position, now, now)
    .run();
  return { id, databaseId, name: input.name, type: input.type, config: input.config ?? {}, position };
};

export const updateDatabaseView = async (
  db: DatabaseAdapter,
  workspaceId: string,
  databaseId: string,
  viewId: string,
  input: { name?: string; type?: DatabaseViewType; config?: DatabaseViewConfig; position?: number },
): Promise<DatabaseView> => {
  const current = await db
    .prepare(`SELECT id, database_id, name, type, config_json, position FROM database_views WHERE id = ? AND database_id = ? AND workspace_id = ?`)
    .bind(viewId, databaseId, workspaceId)
    .first<ViewRecord>();
  if (!current) throw new AppError("not_found", "View not found", 404);
  const next: ViewRecord = {
    ...current,
    name: input.name ?? current.name,
    type: input.type ?? current.type,
    config_json: input.config ? JSON.stringify(input.config) : current.config_json,
    position: input.position ?? current.position,
  };
  await db
    .prepare(`UPDATE database_views SET name = ?, type = ?, config_json = ?, position = ?, updated_at = ? WHERE id = ?`)
    .bind(next.name, next.type, next.config_json, next.position, isoNow(), viewId)
    .run();
  return mapView(next);
};

export const deleteDatabaseView = async (db: DatabaseAdapter, workspaceId: string, databaseId: string, viewId: string) => {
  const count = await db
    .prepare(`SELECT COUNT(*) AS total FROM database_views WHERE database_id = ? AND workspace_id = ?`)
    .bind(databaseId, workspaceId)
    .first<{ total: number }>();
  if ((count?.total ?? 0) <= 1) throw new AppError("last_view", "A database needs at least one view.", 409);
  await db.prepare(`DELETE FROM database_views WHERE id = ? AND database_id = ? AND workspace_id = ?`).bind(viewId, databaseId, workspaceId).run();
};

/** Row context for the page editor: which database a page belongs to, and its property values. */
export const getRowContext = async (db: DatabaseAdapter, workspaceId: string, memoId: string) => {
  const row = await db
    .prepare(`SELECT database_id FROM memos WHERE workspace_id = ? AND id = ? AND is_deleted = 0`)
    .bind(workspaceId, memoId)
    .first<{ database_id: string | null }>();
  if (!row?.database_id) return null;
  const [database, record] = await Promise.all([
    getDatabase(db, workspaceId, row.database_id),
    getRowRecord(db, workspaceId, row.database_id, memoId),
  ]);
  return { database, row: mapRow(record) };
};

const normalizeTemplateValues = (schema: DatabaseSchema, values: Record<string, DatabasePropertyValue> | undefined) =>
  Object.fromEntries(
    Object.entries(sanitizeValues(schema, values)).filter(([, value]) => DatabaseRowValueSchema.safeParse(value).success),
  );

type TemplateInput = {
  name?: string;
  icon?: string | null;
  title?: string;
  properties?: Record<string, DatabasePropertyValue>;
  content?: string;
  isDefault?: boolean;
  position?: number;
};

/** Only one template is the default: setting one clears the others. */
const clearOtherDefaults = (db: DatabaseAdapter, workspaceId: string, databaseId: string, keepId: string) =>
  db
    .prepare(`UPDATE database_templates SET is_default = 0 WHERE workspace_id = ? AND database_id = ? AND id <> ? AND is_default = 1`)
    .bind(workspaceId, databaseId, keepId);

export const createDatabaseTemplate = async (
  db: DatabaseAdapter,
  workspaceId: string,
  databaseId: string,
  input: TemplateInput & { name: string },
): Promise<DatabaseTemplate> => {
  const record = await loadDatabaseRecord(db, workspaceId, databaseId);
  const stats = await db
    .prepare(`SELECT COUNT(*) AS total, MAX(position) AS position FROM database_templates WHERE workspace_id = ? AND database_id = ?`)
    .bind(workspaceId, databaseId)
    .first<{ total: number; position: number | null }>();
  if ((stats?.total ?? 0) >= DATABASE_TEMPLATE_LIMIT) {
    throw new AppError("too_many_templates", `A database can have at most ${DATABASE_TEMPLATE_LIMIT} templates.`, 409);
  }
  const id = createId("dbt");
  const now = isoNow();
  const properties = normalizeTemplateValues(parseSchema(record.schema_json), input.properties);
  const statements = [
    db
      .prepare(
        `INSERT INTO database_templates (id, database_id, workspace_id, name, icon, title, properties_json, content_markdown, is_default, position, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
      )
      .bind(
        id, databaseId, workspaceId, input.name, input.icon ?? null, input.title ?? "", JSON.stringify(properties),
        input.content ?? "", input.isDefault ? 1 : 0, input.position ?? (stats?.position ?? 0) + POSITION_GAP, now, now,
      ),
  ];
  if (input.isDefault) statements.push(clearOtherDefaults(db, workspaceId, databaseId, id));
  await db.batch(statements);
  return getTemplateRecord(db, workspaceId, databaseId, id);
};

export const updateDatabaseTemplate = async (
  db: DatabaseAdapter,
  workspaceId: string,
  databaseId: string,
  templateId: string,
  input: TemplateInput,
): Promise<DatabaseTemplate> => {
  const record = await loadDatabaseRecord(db, workspaceId, databaseId);
  const current = await getTemplateRecord(db, workspaceId, databaseId, templateId);
  const next = {
    name: input.name ?? current.name,
    icon: input.icon === undefined ? current.icon : input.icon,
    title: input.title ?? current.title,
    properties: input.properties ? normalizeTemplateValues(parseSchema(record.schema_json), input.properties) : current.properties,
    content: input.content ?? current.content,
    isDefault: input.isDefault ?? current.isDefault,
    position: input.position ?? current.position,
  };
  const statements = [
    db
      .prepare(
        `UPDATE database_templates SET name = ?, icon = ?, title = ?, properties_json = ?, content_markdown = ?, is_default = ?, position = ?, updated_at = ?
         WHERE workspace_id = ? AND database_id = ? AND id = ?`
      )
      .bind(
        next.name, next.icon, next.title, JSON.stringify(next.properties), next.content, next.isDefault ? 1 : 0, next.position, isoNow(),
        workspaceId, databaseId, templateId,
      ),
  ];
  if (next.isDefault) statements.push(clearOtherDefaults(db, workspaceId, databaseId, templateId));
  await db.batch(statements);
  return getTemplateRecord(db, workspaceId, databaseId, templateId);
};

export const deleteDatabaseTemplate = async (db: DatabaseAdapter, workspaceId: string, databaseId: string, templateId: string) => {
  await getTemplateRecord(db, workspaceId, databaseId, templateId);
  await db
    .prepare(`DELETE FROM database_templates WHERE workspace_id = ? AND database_id = ? AND id = ?`)
    .bind(workspaceId, databaseId, templateId)
    .run();
};
