// Notion-style MCP tools: the same tool set and argument shapes as Notion's hosted MCP server, for
// Ponder's pages, databases, views, comments, versions, people and calendars, so an agent written
// against Notion works here unchanged (without the "notion-" prefix). Each tool checks the token's
// scopes and the person's access to the page, as the app's own routes do.
//
// Notion tools with nothing behind them in Ponder aren't offered: Skills, Custom Agents and their
// sessions, saved memories, suggested edits, permission groups, comment reactions, SQL across data
// sources, file folders and uploads, meeting-note queries, and writing to calendars.
import {
  applyDatabaseView,
  computeRowValues,
  CommentCreateSchema,
  createDefaultDatabaseSchema,
  DATABASE_OPTION_COLORS,
  DATABASE_PROPERTY_TYPES,
  DATABASE_VIEW_TYPES,
  DatabaseSchemaSchema,
  DatabaseViewConfigSchema,
  FILTER_OPERATORS,
  type DatabaseDetail,
  type DatabaseFilter,
  type DatabaseProperty,
  type DatabasePropertyValue,
  type DatabaseRow,
  type DatabaseSchema,
  type DatabaseSort,
  type DatabaseViewConfig,
  type MemoComment,
  type PageAccessLevel,
} from "@ponder/shared";
import type { AppContext, AuthContext } from "./api-context";
import { AppError } from "./app-error";
import { createMemoComment, deleteMemoComment, listMemoComments, listWorkspaceMembers, updateMemoComment } from "./comment-service";
import { loadConnectedCalendars, searchConnectedApps } from "./connections";
import {
  createDatabase,
  createDatabaseRow,
  createDatabaseView,
  getDatabase,
  listDatabaseRows,
  updateDatabase,
  updateDatabaseRow,
  updateDatabaseView,
} from "./database-service";
import { createId } from "./entity-utils";
import { duplicateMemoRecord } from "./memo-duplicate-service";
import { getMemoRevisionRow, listMemoRevisions, restoreMemoRevision } from "./memo-revision-service";
import {
  createMemoRecord,
  deleteMemosRecord,
  getCurrentWorkspaceIdentity,
  getMemoDetail,
  getMemoDetailRow,
  restoreMemosRecord,
  searchMemoSummaries,
  updateMemoRecord,
} from "./memo-service";
import { getPageNode, listPageBacklinks, movePage, setPagePlacement, updatePageMeta, resolveNewPagePlacement } from "./page-service";
import { assertScope, getActorLabel, getAuditActor, hasScopes } from "./request-auth";
import { deniedPagesCondition, getPageAccessLevel, listUserWorkspaces, restrictedUserId } from "./team-service";

const MAX_BATCH = 20;
const PAGE_LIST_MAX = 200;
const QUERY_ROW_SCAN = 1000;

const str = { type: "string" } as const;
const strings = { type: "array", items: { type: "string" } } as const;
const limit = (max: number) => ({ type: "integer", minimum: 1, maximum: max });
const object = (properties: Record<string, unknown>, required: string[] = []) =>
  ({ type: "object", additionalProperties: false, properties, ...(required.length ? { required } : {}) });
const parentSchema = {
  type: "object",
  additionalProperties: false,
  description: "Where to put it: { page_id }, { database_id } (adds database rows), or { notebook_id }. Omit for the top level.",
  properties: { page_id: str, database_id: str, notebook_id: str },
};
const filterSchema = {
  type: "object",
  additionalProperties: false,
  required: ["property", "operator"],
  properties: {
    property: { type: "string", description: "Property name or id." },
    operator: { type: "string", enum: [...FILTER_OPERATORS] },
    value: { description: "Compared value; select and status take the option name." },
  },
};
const sortSchema = object({ property: str, direction: { type: "string", enum: ["ascending", "descending", "asc", "desc"] } }, ["property"]);
const viewSettings = {
  filters: { type: "array", items: filterSchema, maxItems: 50 },
  filter_mode: { type: "string", enum: ["and", "or"] },
  sorts: { type: "array", items: sortSchema, maxItems: 20 },
  group_by: { type: ["string", "null"], description: "Property to group a board by." },
  date_property: { type: ["string", "null"], description: "Date property for calendar and timeline views." },
  visible_properties: { ...strings, description: "Properties to show, in order." },
};
const propertyValues = {
  type: "object",
  description: "Values by property name (or id). Select and status take option names (new select options are added); multi-select takes a list; dates take YYYY-MM-DD or { start, end }; checkbox takes true/false; person and relation take ids.",
};

export const WORKSPACE_TOOL_DEFINITIONS = [
  { name: "search", description: "Search pages and databases by title and content, or look up a workspace member with query_type \"user\".",
    inputSchema: object({ query: str, query_type: { type: "string", enum: ["internal", "user"] }, page_url: { type: "string", description: "Only results inside this page." }, limit: limit(50) }, ["query"]) },
  { name: "connector_search", description: "Search the apps connected to this workspace (GitHub issues and pull requests).",
    inputSchema: object({ question: str, keywords: str, sources: strings }) },
  { name: "fetch", description: "Read a page (properties, Markdown content and sub-pages), a database (schema and views), a view with its rows (\"view://<id>\"), or \"self\".",
    inputSchema: object({ id: { type: "string", description: "Page, database or view id or URL, or \"self\"." } }, ["id"]) },
  { name: "list_private_pages", description: "Top-level pages only you can see (in a personal workspace, every top-level page).", inputSchema: object({ limit: limit(PAGE_LIST_MAX), cursor: str }) },
  { name: "list_shared_pages", description: "Pages shared with specific people.", inputSchema: object({ limit: limit(PAGE_LIST_MAX), cursor: str }) },
  { name: "list_favorite_pages", description: "Favorite (pinned) pages.", inputSchema: object({ limit: limit(PAGE_LIST_MAX), cursor: str }) },
  { name: "list_recent_pages", description: "Pages you viewed most recently.", inputSchema: object({ limit: limit(PAGE_LIST_MAX), cursor: str }) },
  { name: "list_page_backlinks", description: "Pages that link to or mention a page.", inputSchema: object({ page_id: str, page_size: limit(100), cursor: str }, ["page_id"]) },
  { name: "get_self", description: "The connected workspace and user.", inputSchema: object({}) },
  { name: "get_users", description: "Workspace members, optionally searched by name or email, or one member by user_id (\"self\" for you).",
    inputSchema: object({ query: str, user_id: str, page_size: limit(100), start_cursor: str }) },
  { name: "get_teams", description: "The workspaces (teamspaces) you belong to.", inputSchema: object({ query: str }) },
  { name: "create_pages", description: "Create up to 20 pages with Markdown content, or rows in a database (parent { database_id }) with property values.",
    inputSchema: object({
      parent: parentSchema,
      pages: { type: "array", minItems: 1, maxItems: MAX_BATCH, items: object({ title: str, properties: propertyValues, content: { type: "string", description: "Markdown." }, icon: str, cover: str }) },
    }, ["pages"]) },
  { name: "update_page", description: "Change a page. command: update_properties (title, database properties, icon, cover), update_content (search and replace in the Markdown with content_updates), or replace_content (new_str replaces the whole content).",
    inputSchema: object({
      page_id: str,
      command: { type: "string", enum: ["update_properties", "update_content", "replace_content"] },
      title: str, properties: propertyValues, icon: { type: ["string", "null"] }, cover: { type: ["string", "null"] },
      new_str: str,
      content_updates: { type: "array", maxItems: 50, items: object({ old_str: str, new_str: str, replace_all_matches: { type: "boolean" } }, ["old_str", "new_str"]) },
    }, ["page_id", "command"]) },
  { name: "move_pages", description: "Move pages or databases under another page, or to the top level of a notebook. Sub-pages move with them.",
    inputSchema: object({ page_or_database_ids: { ...strings, minItems: 1, maxItems: MAX_BATCH }, new_parent: object({ page_id: str, notebook_id: str, workspace: { type: "boolean" } }) }, ["page_or_database_ids", "new_parent"]) },
  { name: "duplicate_page", description: "Copy a page next to the original.", inputSchema: object({ page_id: str }, ["page_id"]) },
  { name: "delete_pages", description: "Move up to 20 pages (or database rows) to Trash, with their sub-pages. Without user_confirmed: true nothing moves and the pages are listed for confirmation.",
    inputSchema: object({ page_ids: { ...strings, minItems: 1, maxItems: MAX_BATCH }, user_confirmed: { type: "boolean" } }, ["page_ids"]) },
  { name: "restore_pages", description: "Bring up to 20 pages or databases back from Trash.", inputSchema: object({ page_ids: { ...strings, minItems: 1, maxItems: MAX_BATCH } }, ["page_ids"]) },
  { name: "create_database", description: "Create a database with a table view. properties lists columns beyond the title: { name, type, options? }.",
    inputSchema: object({
      parent: parentSchema, title: str,
      properties: { type: "array", maxItems: 99, items: object({ name: str, type: { type: "string", enum: DATABASE_PROPERTY_TYPES.filter((type) => type !== "title") }, options: strings }, ["name", "type"]) },
    }) },
  { name: "update_data_source", description: "Change a database's title or columns. properties maps a column name (or id) to { name?, type?, options? } to add or change it, or to null to remove it. For select, multi-select and status, options lists every option to keep.",
    inputSchema: object({ database_id: str, title: str, properties: { type: "object" } }, ["database_id"]) },
  { name: "create_view", description: "Add a view to a database.",
    inputSchema: object({ database_id: str, name: str, type: { type: "string", enum: [...DATABASE_VIEW_TYPES] }, ...viewSettings }, ["database_id", "name", "type"]) },
  { name: "update_view", description: "Change a view. Only the fields given change; clear_filters, clear_sorts and clear_group_by remove those.",
    inputSchema: object({ view_id: str, name: str, type: { type: "string", enum: [...DATABASE_VIEW_TYPES] }, ...viewSettings, clear_filters: { type: "boolean" }, clear_sorts: { type: "boolean" }, clear_group_by: { type: "boolean" } }, ["view_id"]) },
  { name: "query_data_sources", description: "Read a database's rows with readable property values, filtered and sorted, or a saved view's rows (view_id). Formulas and rollups are computed.",
    inputSchema: object({ database_id: str, view_id: str, filter: { type: "array", items: filterSchema, maxItems: 50 }, filter_mode: { type: "string", enum: ["and", "or"] }, sort: { type: "array", items: sortSchema, maxItems: 20 }, limit: limit(100), cursor: str }) },
  { name: "delete_databases", description: "Move up to 20 databases, with their rows, to Trash. Without user_confirmed: true nothing moves.",
    inputSchema: object({ database_ids: { ...strings, minItems: 1, maxItems: MAX_BATCH }, user_confirmed: { type: "boolean" } }, ["database_ids"]) },
  { name: "create_comment", description: "Comment on a page, on a passage of it (selection_with_ellipsis: the exact text), or reply to a discussion (discussion_id).",
    inputSchema: object({ page_id: str, markdown: str, selection_with_ellipsis: str, discussion_id: str }, ["page_id", "markdown"]) },
  { name: "get_comments", description: "A page's discussions and their comments, resolved ones included when asked.",
    inputSchema: object({ page_id: str, include_resolved: { type: "boolean" } }, ["page_id"]) },
  { name: "update_comment", description: "Replace the text of a comment you wrote.", inputSchema: object({ comment_id: str, markdown: str }, ["comment_id", "markdown"]) },
  { name: "delete_comment", description: "Delete a comment you wrote; deleting a discussion's first comment removes the discussion.", inputSchema: object({ comment_id: str }, ["comment_id"]) },
  { name: "set_discussion_resolved", description: "Resolve or reopen a discussion.", inputSchema: object({ discussion_id: str, resolved: { type: "boolean" } }, ["discussion_id", "resolved"]) },
  { name: "view_version", description: "A page as it was at a past time (ISO 8601).", inputSchema: object({ page_id: str, time: str }, ["page_id", "time"]) },
  { name: "get_version_changes", description: "Saved versions of a page between two times (default: the last 24 hours), with who saved them.",
    inputSchema: object({ page_id: str, start_time: str, end_time: str }, ["page_id"]) },
  { name: "restore_version", description: "Put a page back as it was at a past time. The first call (without user_confirmed) shows what would be restored.",
    inputSchema: object({ page_id: str, time: str, user_confirmed: { type: "boolean" } }, ["page_id", "time"]) },
  { name: "calendar_list_calendars", description: "Calendars connected to this workspace.", inputSchema: object({}) },
  { name: "calendar_list_events", description: "Events from the connected calendars between timeMin and timeMax (ISO 8601; default the next 7 days).",
    inputSchema: object({ timeMin: str, timeMax: str }) },
  { name: "get_tool_access", description: "Which of these tools this connection may use.", inputSchema: object({ tool_names: strings }) },
] as const;

export const WORKSPACE_READ_ONLY_TOOLS = new Set([
  "search", "connector_search", "fetch", "list_private_pages", "list_shared_pages", "list_favorite_pages", "list_recent_pages",
  "list_page_backlinks", "get_self", "get_users", "get_teams", "query_data_sources", "get_comments", "view_version",
  "get_version_changes", "calendar_list_calendars", "calendar_list_events", "get_tool_access",
]);
export const WORKSPACE_NON_DESTRUCTIVE_TOOLS = new Set(["create_pages", "duplicate_page", "restore_pages", "create_database", "create_view", "create_comment", "set_discussion_resolved"]);
export const WORKSPACE_IDEMPOTENT_TOOLS = new Set(["move_pages", "restore_pages", "set_discussion_resolved", "update_view"]);
const WORKSPACE_TOOL_NAMES = new Set<string>(WORKSPACE_TOOL_DEFINITIONS.map((tool) => tool.name));
const WRITE_TOOLS = new Set<string>(WORKSPACE_TOOL_DEFINITIONS.map((tool) => tool.name).filter((name) => !WORKSPACE_READ_ONLY_TOOLS.has(name)));

// ---- arguments ----

const asRecord = (value: unknown): Record<string, unknown> | null =>
  value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : null;
const optional = (value: unknown) => (typeof value === "string" && value.trim() ? value.trim() : undefined);
const required = (value: unknown, name: string) => {
  const text = optional(value);
  if (!text) throw new AppError("invalid_params", `${name} is required`, 400);
  return text;
};
const idList = (value: unknown, name: string) => {
  const list = Array.isArray(value) ? value.map((item) => optional(item)).filter((item): item is string => !!item).map(stripId) : [];
  if (!list.length) throw new AppError("invalid_params", `${name} needs at least one id`, 400);
  if (list.length > MAX_BATCH) throw new AppError("invalid_params", `${name} takes at most ${MAX_BATCH} ids`, 400);
  return [...new Set(list)];
};
/** An id from a page URL (…?p=<id>), a view:// or discussion:// reference, or the id itself. */
const stripId = (value: string) => {
  const text = value.trim();
  try {
    const url = new URL(text);
    if (url.protocol === "view:" || url.protocol === "discussion:") return (url.host + url.pathname).replace(/^\/+/, "");
    return url.searchParams.get("p") ?? url.pathname.split("/").filter(Boolean).at(-1) ?? text;
  } catch {
    return text;
  }
};
const pageLimit = (value: unknown, fallback = 50, max = PAGE_LIST_MAX) => Math.min(max, Math.max(1, Math.round(Number(value ?? fallback)) || fallback));
const cursorOffset = (value: unknown) => Math.max(0, Number.parseInt(String(value ?? "0"), 10) || 0);
const parseTime = (value: unknown, name: string) => {
  const text = required(value, name);
  const time = Date.parse(text);
  if (Number.isNaN(time)) throw new AppError("invalid_params", `${name} must be an ISO 8601 date or time`, 400);
  return new Date(time).toISOString();
};

// ---- access ----

const RANK: Record<PageAccessLevel, number> = { none: 0, view: 1, comment: 2, edit: 3 };
const requireAccess = async (c: AppContext, auth: AuthContext, memoId: string, need: Exclude<PageAccessLevel, "none">) => {
  const level = await getPageAccessLevel(c.env.storage.db, auth, memoId);
  if (level === "none") throw new AppError("not_found", "Page not found", 404);
  if (RANK[level] < RANK[need]) throw new AppError("forbidden", `You can only ${level} this page.`, 403);
};

const pageUrl = (c: AppContext, id: string) => {
  const origin = c.env.ALTSTACK_APP_URL?.replace(/\/+$/, "") || new URL(c.req.url).origin;
  return `${origin}/?p=${encodeURIComponent(id)}`;
};

type PageListRow = { id: string; title: string | null; page_icon: string | null; parent_memo_id: string | null; database_id: string | null; updated_at: string; linked_database_id: string | null };
const listItem = (c: AppContext, row: PageListRow) => ({
  type: row.linked_database_id ? "database" : "page",
  id: row.id,
  ...(row.linked_database_id ? { database_id: row.linked_database_id } : {}),
  title: row.title ?? "Untitled",
  icon: row.page_icon,
  url: pageUrl(c, row.id),
});

/** One page of a sidebar list: live pages (not database rows) matching `where`, visible to this person. */
/** `binds` fill the placeholders in `where` and then `order`, in that order. */
const listPages = async (c: AppContext, auth: AuthContext, args: Record<string, unknown>, where: string, binds: unknown[], order: string) => {
  const size = pageLimit(args.limit);
  const offset = cursorOffset(args.cursor);
  const restricted = restrictedUserId(auth);
  const denied = restricted ? deniedPagesCondition("m.id", auth.workspaceId, restricted) : null;
  const rows = await c.env.storage.db.prepare(
    `SELECT m.id, m.title, m.page_icon, m.parent_memo_id, m.database_id, m.updated_at,
            (SELECT d.id FROM databases d WHERE d.page_memo_id = m.id) AS linked_database_id
     FROM memos m
     WHERE m.workspace_id = ? AND m.is_deleted = 0 AND m.is_archived = 0 AND m.merged_into_memo_id IS NULL AND m.database_id IS NULL
       ${denied ? `AND ${denied.sql}` : ""} AND ${where}
     ORDER BY ${order} LIMIT ? OFFSET ?`,
  ).bind(auth.workspaceId, ...(denied?.binds ?? []), ...binds, size + 1, offset).all<PageListRow>();
  const page = rows.results.slice(0, size);
  return { results: page.map((row) => listItem(c, row)), nextCursor: rows.results.length > size ? String(offset + size) : null };
};

// ---- databases ----

const databaseIdFor = async (c: AppContext, auth: AuthContext, id: string) => {
  const row = await c.env.storage.db.prepare(
    `SELECT id FROM databases WHERE workspace_id = ? AND (id = ? OR page_memo_id = ?)`,
  ).bind(auth.workspaceId, id, id).first<{ id: string }>();
  return row?.id ?? null;
};

const loadDatabase = async (c: AppContext, auth: AuthContext, id: string, need: Exclude<PageAccessLevel, "none">) => {
  const databaseId = await databaseIdFor(c, auth, stripId(id));
  if (!databaseId) throw new AppError("not_found", "Database not found", 404);
  const database = await getDatabase(c.env.storage.db, auth.workspaceId, databaseId);
  await requireAccess(c, auth, database.pageMemoId, need);
  return database;
};

const findProperty = (schema: DatabaseSchema, key: string) => {
  const lower = key.trim().toLowerCase();
  return schema.properties.find((property) => property.id === key)
    ?? schema.properties.find((property) => property.name.toLowerCase() === lower)
    ?? (lower === "title" ? schema.properties.find((property) => property.type === "title") : undefined);
};
const propertyIdOf = (schema: DatabaseSchema, key: unknown) => {
  const property = typeof key === "string" ? findProperty(schema, key) : undefined;
  if (!property) throw new AppError("invalid_params", `No property "${String(key)}". Properties: ${schema.properties.map((item) => item.name).join(", ")}`, 400);
  return property;
};
const optionId = (property: DatabaseProperty, value: string) => {
  const lower = value.trim().toLowerCase();
  return property.options?.find((option) => option.id === value || option.name.toLowerCase() === lower)?.id ?? null;
};
const colorFor = (index: number) => DATABASE_OPTION_COLORS[(index + 1) % DATABASE_OPTION_COLORS.length];

/**
 * Property values given by name, as stored values keyed by property id. Unknown select and
 * multi-select options are added to the schema (`schema` is changed in place; `grew` says so).
 */
const toStoredValues = (schema: DatabaseSchema, input: Record<string, unknown>) => {
  const values: Record<string, DatabasePropertyValue> = {};
  let title: string | undefined;
  let grew = false;
  for (const [rawKey, value] of Object.entries(input)) {
    const dateKey = /^date:(.+):(start|end)$/.exec(rawKey);
    const property = propertyIdOf(schema, dateKey ? dateKey[1] : rawKey);
    const text = typeof value === "string" ? value : value == null ? "" : String(value);
    switch (property.type) {
      case "title": title = text; break;
      case "rollup": case "formula": case "created_time": case "last_edited_time":
        throw new AppError("invalid_params", `"${property.name}" is computed and can't be set.`, 400);
      case "number": {
        const number = value === null || value === "" ? null : Number(value);
        if (number !== null && !Number.isFinite(number)) throw new AppError("invalid_params", `"${property.name}" needs a number.`, 400);
        values[property.id] = number;
        break;
      }
      case "checkbox": values[property.id] = value === true || text === "true" || text === "__YES__"; break;
      case "date": {
        if (value === null || value === "") { values[property.id] = null; break; }
        const record = asRecord(value);
        const current = asRecord(values[property.id]) as { start?: string; end?: string | null } | null;
        if (dateKey) values[property.id] = { start: dateKey[2] === "start" ? text : current?.start ?? text, end: dateKey[2] === "end" ? text : current?.end ?? null };
        else values[property.id] = record ? { start: String(record.start ?? ""), end: record.end == null ? null : String(record.end) } : { start: text, end: null };
        break;
      }
      case "select": case "status": case "multi_select": {
        const names = property.type === "multi_select"
          ? (Array.isArray(value) ? value.map(String) : text ? text.split(",") : []).map((name) => name.trim()).filter(Boolean)
          : text.trim() ? [text.trim()] : [];
        const ids = names.map((name) => {
          const found = optionId(property, name);
          if (found) return found;
          if (property.type === "status") {
            throw new AppError("invalid_params", `"${property.name}" has no status "${name}". Options: ${(property.options ?? []).map((option) => option.name).join(", ")}`, 400);
          }
          const option = { id: createId("opt").slice(0, 24), name: name.slice(0, 120), color: colorFor(property.options?.length ?? 0) };
          property.options = [...(property.options ?? []), option];
          grew = true;
          return option.id;
        });
        values[property.id] = property.type === "multi_select" ? ids : ids[0] ?? null;
        break;
      }
      case "person": case "relation":
        values[property.id] = (Array.isArray(value) ? value.map(String) : text ? text.split(",") : []).map((item) => stripId(item.trim())).filter(Boolean);
        break;
      default: values[property.id] = value === null ? null : text;
    }
  }
  return { values, title, grew };
};

/** Every row of a database (up to QUERY_ROW_SCAN), with computed cells. */
const loadRows = async (c: AppContext, auth: AuthContext, database: DatabaseDetail) => {
  const rows: DatabaseRow[] = [];
  let cursor: { afterPosition: number; afterId: string } | undefined;
  while (rows.length < QUERY_ROW_SCAN) {
    const page = await listDatabaseRows(c.env.storage.db, auth.workspaceId, database.id, { ...cursor, limit: 500 });
    rows.push(...page.rows);
    if (!page.nextCursor) break;
    const [position, ...id] = page.nextCursor.split(":");
    cursor = { afterPosition: Number(position), afterId: id.join(":") };
  }
  const related: Parameters<typeof computeRowValues>[0]["relatedRows"] = {};
  const targets = new Set(database.schema.properties.flatMap((property) => property.relation?.databaseId && property.relation.databaseId !== database.id ? [property.relation.databaseId] : []));
  for (const target of [...targets].slice(0, 5)) {
    try {
      const other = await getDatabase(c.env.storage.db, auth.workspaceId, target);
      related[target] = { schema: other.schema, rows: (await listDatabaseRows(c.env.storage.db, auth.workspaceId, target, { limit: 1000 })).rows };
    } catch {
      // A related database that's gone leaves its relation values unresolved.
    }
  }
  return { rows, cells: computeRowValues({ schema: database.schema, rows, relatedRows: related }) };
};

const rowOut = (c: AppContext, database: DatabaseDetail, row: DatabaseRow, cells: ReturnType<typeof computeRowValues>) => ({
  id: row.id,
  url: pageUrl(c, row.id),
  title: row.title ?? "Untitled",
  properties: Object.fromEntries(database.schema.properties.map((property) => [
    property.name,
    property.type === "title" ? row.title ?? "" : cells.get(row.id)?.[property.id]?.display ?? "",
  ])),
});

const viewConfigFrom = (schema: DatabaseSchema, args: Record<string, unknown>, base: DatabaseViewConfig = {}): DatabaseViewConfig => {
  const config: DatabaseViewConfig = { ...base };
  const filters = Array.isArray(args.filters) ? args.filters : Array.isArray(args.filter) ? args.filter : null;
  if (filters) {
    config.filters = filters.map((raw): DatabaseFilter => {
      const filter = asRecord(raw) ?? {};
      const property = propertyIdOf(schema, filter.property ?? filter.propertyId);
      // Filters compare what a cell shows, so select and status filters take the option's name, as given.
      const value = filter.value as DatabaseFilter["value"];
      return { propertyId: property.id, operator: filter.operator as DatabaseFilter["operator"], ...(value !== undefined ? { value } : {}) };
    });
  }
  if (args.filter_mode === "and" || args.filter_mode === "or") config.filterMode = args.filter_mode;
  const sorts = Array.isArray(args.sorts) ? args.sorts : Array.isArray(args.sort) ? args.sort : null;
  if (sorts) {
    config.sorts = sorts.map((raw): DatabaseSort => {
      const sort = asRecord(raw) ?? {};
      return { propertyId: propertyIdOf(schema, sort.property ?? sort.propertyId).id, direction: String(sort.direction ?? "asc").startsWith("desc") ? "desc" : "asc" };
    });
  }
  if (args.group_by !== undefined) config.groupByPropertyId = args.group_by === null ? null : propertyIdOf(schema, args.group_by).id;
  if (args.date_property !== undefined) config.datePropertyId = args.date_property === null ? null : propertyIdOf(schema, args.date_property).id;
  if (Array.isArray(args.visible_properties)) config.visiblePropertyIds = args.visible_properties.map((key) => propertyIdOf(schema, key).id);
  if (args.clear_filters === true) delete config.filters;
  if (args.clear_sorts === true) delete config.sorts;
  if (args.clear_group_by === true) config.groupByPropertyId = null;
  const parsed = DatabaseViewConfigSchema.safeParse(config);
  if (!parsed.success) throw new AppError("invalid_params", parsed.error.issues.map((issue) => `${issue.path.join(".")}: ${issue.message}`).join("; "), 400);
  return parsed.data;
};

const findView = async (c: AppContext, auth: AuthContext, viewId: string) => {
  const row = await c.env.storage.db.prepare(`SELECT database_id FROM database_views WHERE id = ? AND workspace_id = ?`)
    .bind(viewId, auth.workspaceId).first<{ database_id: string }>();
  if (!row) throw new AppError("not_found", "View not found", 404);
  return row.database_id;
};

const databaseOut = (c: AppContext, database: DatabaseDetail) => ({
  type: "database",
  id: database.id,
  page_id: database.pageMemoId,
  url: pageUrl(c, database.pageMemoId),
  title: database.title ?? "Untitled",
  icon: database.icon,
  properties: database.schema.properties.map((property) => ({
    id: property.id, name: property.name, type: property.type,
    ...(property.options ? { options: property.options.map((option) => option.name) } : {}),
  })),
  views: database.views.map((view) => ({ id: view.id, url: `view://${view.id}`, name: view.name, type: view.type })),
});

const applySchemaChanges = (schema: DatabaseSchema, changes: Record<string, unknown>): DatabaseSchema => {
  const properties: DatabaseProperty[] = structuredClone(schema.properties);
  for (const [key, raw] of Object.entries(changes)) {
    const lower = key.toLowerCase();
    const index = properties.findIndex((property) => property.id === key || property.name.toLowerCase() === lower);
    if (raw === null) {
      if (index < 0) throw new AppError("invalid_params", `No property "${key}" to remove.`, 400);
      if (properties[index]!.type === "title") throw new AppError("invalid_params", "The title property can't be removed.", 400);
      properties.splice(index, 1);
      continue;
    }
    const change = asRecord(raw);
    if (!change) throw new AppError("invalid_params", `properties.${key} must be an object or null.`, 400);
    const current: DatabaseProperty = index >= 0 ? properties[index]! : { id: createId("prop").slice(0, 24), name: key, type: "text" };
    const next: DatabaseProperty = { ...current };
    if (typeof change.name === "string") next.name = change.name.trim();
    if (typeof change.type === "string") {
      if (!DATABASE_PROPERTY_TYPES.includes(change.type as DatabaseProperty["type"])) throw new AppError("invalid_params", `Unknown property type "${change.type}".`, 400);
      if (current.type === "title" && change.type !== "title") throw new AppError("invalid_params", "The title property keeps its type.", 400);
      next.type = change.type as DatabaseProperty["type"];
    }
    if (Array.isArray(change.options)) {
      next.options = change.options.map((option, position) => {
        const name = typeof option === "string" ? option : String(asRecord(option)?.name ?? "");
        const existing = current.options?.find((item) => item.name.toLowerCase() === name.trim().toLowerCase());
        const color = asRecord(option)?.color;
        return existing
          ? { ...existing, ...(DATABASE_OPTION_COLORS.includes(color as never) ? { color: color as typeof existing.color } : {}) }
          : { id: createId("opt").slice(0, 24), name: name.trim(), color: DATABASE_OPTION_COLORS.includes(color as never) ? color as typeof DATABASE_OPTION_COLORS[number] : colorFor(position) };
      });
    } else if (["select", "multi_select", "status"].includes(next.type) && !next.options) {
      next.options = [];
    }
    if (index >= 0) properties[index] = next;
    else properties.push(next);
  }
  const parsed = DatabaseSchemaSchema.safeParse({ properties });
  if (!parsed.success) throw new AppError("invalid_params", parsed.error.issues.map((issue) => issue.message).join("; "), 400);
  return parsed.data;
};

// ---- pages ----

const defaultNotebookId = async (c: AppContext, auth: AuthContext) => {
  const row = await c.env.storage.db.prepare(
    `SELECT id FROM notebooks WHERE workspace_id = ? AND is_deleted = 0 ORDER BY parent_id IS NOT NULL, sort_order, created_at LIMIT 1`,
  ).bind(auth.workspaceId).first<{ id: string }>();
  if (!row) throw new AppError("not_found", "This workspace has no notebook to put the page in.", 404);
  return row.id;
};

const fetchPage = async (c: AppContext, auth: AuthContext, id: string) => {
  const db = c.env.storage.db;
  await requireAccess(c, auth, id, "view");
  const memo = await getMemoDetail(db, auth.workspaceId, id);
  const node = await getPageNode(db, auth.workspaceId, id);
  if (!memo || !node) throw new AppError("not_found", "Page not found", 404);
  const rowContext = await db.prepare(`SELECT database_id FROM memos WHERE id = ? AND workspace_id = ?`).bind(id, auth.workspaceId).first<{ database_id: string | null }>();
  const restricted = restrictedUserId(auth);
  const denied = restricted ? deniedPagesCondition("m.id", auth.workspaceId, restricted) : null;
  const children = await db.prepare(
    `SELECT m.id, m.title, m.page_icon, m.parent_memo_id, m.database_id, m.updated_at,
            (SELECT d.id FROM databases d WHERE d.page_memo_id = m.id) AS linked_database_id
     FROM memos m WHERE m.workspace_id = ? AND m.parent_memo_id = ? AND m.is_deleted = 0 AND m.database_id IS NULL ${denied ? `AND ${denied.sql}` : ""}
     ORDER BY m.page_position, m.created_at LIMIT 200`,
  ).bind(auth.workspaceId, id, ...(denied?.binds ?? [])).all<PageListRow>();
  let properties: Record<string, string> | undefined;
  let parentDatabase: string | undefined;
  if (rowContext?.database_id) {
    const database = await getDatabase(db, auth.workspaceId, rowContext.database_id);
    const { rows, cells } = await loadRows(c, auth, database);
    const row = rows.find((item) => item.id === id);
    if (row) properties = rowOut(c, database, row, cells).properties;
    parentDatabase = database.id;
  }
  return {
    type: node.databaseId ? "database_page" : "page",
    id,
    url: pageUrl(c, id),
    title: memo.title ?? "Untitled",
    icon: node.icon,
    cover: node.cover,
    parent: parentDatabase ? { database_id: parentDatabase } : node.parentId ? { page_id: node.parentId } : { notebook_id: node.notebookId },
    ...(properties ? { properties } : {}),
    ...(node.databaseId ? { database: databaseOut(c, await getDatabase(db, auth.workspaceId, node.databaseId)) } : {}),
    content: memo.contentMarkdown,
    children: children.results.map((row) => listItem(c, row)),
    updated_at: memo.updatedAt,
  };
};

const replaceContent = (content: string, updates: unknown[]) => {
  let next = content;
  const warnings: { index: number; code: string; message: string }[] = [];
  updates.forEach((raw, index) => {
    const update = asRecord(raw);
    const oldStr = typeof update?.old_str === "string" ? update.old_str : "";
    const newStr = typeof update?.new_str === "string" ? update.new_str : "";
    if (!oldStr) throw new AppError("invalid_params", `content_updates[${index}].old_str must not be empty`, 400);
    const count = next.split(oldStr).length - 1;
    if (count === 0) { warnings.push({ index, code: "no_match", message: "old_str wasn't found; nothing changed for it." }); return; }
    if (count > 1 && update?.replace_all_matches !== true) {
      throw new AppError("invalid_params", `content_updates[${index}].old_str matches ${count} places. Give more context or set replace_all_matches.`, 400);
    }
    next = update?.replace_all_matches === true ? next.split(oldStr).join(newStr) : next.replace(oldStr, () => newStr);
  });
  return { content: next, warnings };
};

const saveMemo = async (c: AppContext, auth: AuthContext, id: string, input: { title?: string; contentMarkdown?: string; isPinned?: boolean }) => {
  const result = await updateMemoRecord(c.env.storage.db, auth.workspaceId, id, input, getAuditActor(c), getActorLabel(c));
  if ("error" in result) throw new AppError("conflict", result.message ?? "The page changed while saving. Try again.", 409);
  return result.memo;
};

const writeRowValues = async (c: AppContext, auth: AuthContext, database: DatabaseDetail, rowId: string, input: Record<string, unknown>) => {
  const schema: DatabaseSchema = structuredClone(database.schema);
  const { values, title, grew } = toStoredValues(schema, input);
  if (grew) await updateDatabase(c.env.storage.db, auth.workspaceId, database.id, { schema }, getAuditActor(c), getActorLabel(c));
  return updateDatabaseRow(c.env.storage.db, auth.workspaceId, database.id, rowId, { ...(title !== undefined ? { title } : {}), properties: values }, getAuditActor(c), getActorLabel(c));
};

const discussions = (comments: MemoComment[], includeResolved: boolean) => {
  const threads = new Map<string, MemoComment[]>();
  for (const comment of comments) threads.set(comment.threadId, [...(threads.get(comment.threadId) ?? []), comment]);
  return [...threads.entries()].flatMap(([threadId, items]) => {
    const first = items.find((item) => item.id === threadId) ?? items[0]!;
    if (first.resolvedAt && !includeResolved) return [];
    return [{
      id: threadId, url: `discussion://${threadId}`, quote: first.quote, resolved: !!first.resolvedAt,
      comments: items.map((item) => ({ id: item.id, author: { id: item.authorId, name: item.authorName }, markdown: item.body, created_at: item.createdAt })),
    }];
  });
};

type RevisionRow = { id: string; revision: number; title: string | null; content_markdown: string; created_by: string; created_at: string };

/**
 * The page as it was at `time`. A saved version holds the page as it was just before the edit made
 * at its created_at, so the page at `time` is the first version saved after `time`, or the page as
 * it is now when nothing changed since. `revision` is null in that second case.
 */
const pageAt = async (c: AppContext, auth: AuthContext, pageId: string, time: string) => {
  const db = c.env.storage.db;
  const memo = await getMemoDetail(db, auth.workspaceId, pageId);
  if (!memo) throw new AppError("not_found", "Page not found", 404);
  if (memo.createdAt > time) throw new AppError("not_found", `This page didn't exist yet at ${time}; it was created at ${memo.createdAt}.`, 404);
  const revision = await db.prepare(
    `SELECT id, revision, title, content_markdown, created_by, created_at FROM memo_revisions
     WHERE memo_id = ? AND created_at > ? ORDER BY created_at ASC, revision ASC LIMIT 1`,
  ).bind(pageId, time).first<RevisionRow>();
  return revision
    ? { revision, title: revision.title, content: revision.content_markdown, until: revision.created_at }
    : { revision: null, title: memo.title, content: memo.contentMarkdown, until: null };
};

const memberOut = (member: Awaited<ReturnType<typeof listWorkspaceMembers>>[number]) => ({
  id: member.id, name: member.displayName ?? member.username, email: member.email, role: member.role, type: "person",
});

// ---- dispatch ----

export const isWorkspaceTool = (name: string) => WORKSPACE_TOOL_NAMES.has(name);

export const callWorkspaceTool = async (c: AppContext, auth: AuthContext, name: string, args: Record<string, unknown>): Promise<unknown> => {
  assertScope(auth, WRITE_TOOLS.has(name) ? "write:memos" : "read:memos");
  const db = c.env.storage.db;
  const ws = auth.workspaceId;
  const actor = getAuditActor(c);
  const label = getActorLabel(c);

  switch (name) {
    case "search": {
      const query = required(args.query, "query");
      if (args.query_type === "user") {
        const lower = query.toLowerCase();
        return { results: (await listWorkspaceMembers(db, ws)).filter((member) =>
          [member.displayName, member.username, member.email].some((value) => value?.toLowerCase().includes(lower))).map(memberOut) };
      }
      const size = pageLimit(args.limit, 10, 50);
      const within = optional(args.page_url) ? stripId(String(args.page_url)) : null;
      const summaries = await searchMemoSummaries(db, { workspaceId: ws, query, limit: 50 });
      const results = [];
      for (const memo of summaries) {
        if (results.length >= size) break;
        if (await getPageAccessLevel(db, auth, memo.id) === "none") continue;
        const row = await db.prepare(
          `WITH RECURSIVE up(id, parent) AS (SELECT id, parent_memo_id FROM memos WHERE id = ? UNION SELECT m.id, m.parent_memo_id FROM memos m INNER JOIN up ON m.id = up.parent)
           SELECT (SELECT database_id FROM memos WHERE id = ?) AS database_id, (SELECT d.id FROM databases d WHERE d.page_memo_id = ?) AS linked_database_id,
                  ${within ? "EXISTS (SELECT 1 FROM up WHERE id = ?)" : "1"} AS inside`,
        ).bind(memo.id, memo.id, memo.id, ...(within ? [within] : [])).first<{ database_id: string | null; linked_database_id: string | null; inside: number }>();
        if (within && (!row?.inside || memo.id === within)) continue;
        results.push({
          type: row?.linked_database_id ? "database" : row?.database_id ? "database_row" : "page",
          id: memo.id, title: memo.title ?? "Untitled", url: pageUrl(c, memo.id), highlight: memo.excerpt, updated_at: memo.updatedAt,
          ...(row?.linked_database_id ? { database_id: row.linked_database_id } : {}),
          ...(row?.database_id ? { parent_database_id: row.database_id } : {}),
        });
      }
      return { results, type: "search" };
    }
    case "connector_search": {
      const query = optional(args.keywords) ?? required(args.question, "question or keywords");
      const sources = Array.isArray(args.sources) ? args.sources.map(String) : null;
      if (sources && !sources.includes("github")) return { results: [], message: "Only GitHub can be searched here." };
      return { results: await searchConnectedApps(c, query) };
    }
    case "fetch": {
      const raw = required(args.id, "id");
      if (raw === "self") return await getCurrentWorkspaceIdentity(db, auth);
      if (raw.startsWith("view://")) {
        const viewId = stripId(raw);
        const database = await loadDatabase(c, auth, await findView(c, auth, viewId), "view");
        const view = database.views.find((item) => item.id === viewId)!;
        const { rows, cells } = await loadRows(c, auth, database);
        const visible = applyDatabaseView({ schema: database.schema, rows, cells, config: view.config });
        return { ...databaseOut(c, database), view: { id: view.id, name: view.name, type: view.type }, rows: visible.slice(0, 100).map((row) => rowOut(c, database, row, cells)), has_more: visible.length > 100 };
      }
      const id = stripId(raw);
      const databaseId = await db.prepare(`SELECT id FROM databases WHERE workspace_id = ? AND id = ?`).bind(ws, id).first<{ id: string }>();
      if (databaseId) return databaseOut(c, await loadDatabase(c, auth, id, "view"));
      return await fetchPage(c, auth, id);
    }
    case "list_private_pages":
      // A personal workspace's top-level pages are all private; in a team, the restricted ones shared with nobody else.
      return auth.teamRole
        ? listPages(c, auth, args,
          "m.parent_memo_id IS NULL AND m.is_restricted = 1 AND NOT EXISTS (SELECT 1 FROM page_shares s WHERE s.memo_id = m.id AND s.user_id <> ?)",
          [auth.actorId ?? ""], "m.page_position, m.created_at")
        : listPages(c, auth, args, "m.parent_memo_id IS NULL", [], "m.page_position, m.created_at");
    case "list_shared_pages":
      return listPages(c, auth, args, "EXISTS (SELECT 1 FROM page_shares s WHERE s.memo_id = m.id)", [], "m.updated_at DESC");
    case "list_favorite_pages":
      return listPages(c, auth, args, "m.is_pinned = 1", [], "m.page_position, m.created_at");
    case "list_recent_pages":
      // page_views arrives with page analytics; until then there's nothing recent to list.
      if (!(await db.prepare(`SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = 'page_views'`).first())) {
        return { results: [], nextCursor: null };
      }
      return listPages(c, auth, args,
        "EXISTS (SELECT 1 FROM page_views v WHERE v.workspace_id = m.workspace_id AND v.memo_id = m.id AND v.user_id = ?)",
        [auth.actorId ?? "", auth.actorId ?? ""],
        "(SELECT MAX(v.last_viewed_at) FROM page_views v WHERE v.workspace_id = m.workspace_id AND v.memo_id = m.id AND v.user_id = ?) DESC");
    case "list_page_backlinks": {
      const id = stripId(required(args.page_id, "page_id"));
      await requireAccess(c, auth, id, "view");
      const all = await listPageBacklinks(db, ws, id, restrictedUserId(auth));
      const size = pageLimit(args.page_size, 25, 100);
      const offset = cursorOffset(args.cursor);
      return {
        results: all.slice(offset, offset + size).map((link) => ({ ...link, url: pageUrl(c, (link as { id: string }).id) })),
        next_cursor: all.length > offset + size ? String(offset + size) : null,
      };
    }
    case "get_self":
      return await getCurrentWorkspaceIdentity(db, auth);
    case "get_users": {
      const members = (await listWorkspaceMembers(db, ws)).map(memberOut);
      const userId = optional(args.user_id);
      if (userId) {
        const member = members.find((item) => item.id === (userId === "self" ? auth.actorId : userId));
        if (!member) throw new AppError("not_found", "User not found", 404);
        return member;
      }
      const lower = optional(args.query)?.toLowerCase();
      const matched = lower ? members.filter((member) => [member.name, member.email].some((value) => value?.toLowerCase().includes(lower))) : members;
      const size = pageLimit(args.page_size, 100, 100);
      const offset = cursorOffset(args.start_cursor);
      return { results: matched.slice(offset, offset + size), has_more: matched.length > offset + size, next_cursor: matched.length > offset + size ? String(offset + size) : null };
    }
    case "get_teams": {
      const lower = optional(args.query)?.toLowerCase();
      const workspaces = await listUserWorkspaces(db, auth);
      return { teams: workspaces.filter((workspace) => !lower || JSON.stringify(workspace).toLowerCase().includes(lower)) };
    }
    case "create_pages": {
      const parent = asRecord(args.parent) ?? {};
      const pages = Array.isArray(args.pages) ? args.pages.map(asRecord).filter((page): page is Record<string, unknown> => !!page) : [];
      if (!pages.length || pages.length > MAX_BATCH) throw new AppError("invalid_params", `pages takes 1 to ${MAX_BATCH} pages`, 400);
      if (optional(parent.database_id)) {
        const created: string[] = [];
        let database = await loadDatabase(c, auth, String(parent.database_id), "edit");
        for (const page of pages) {
          const schema: DatabaseSchema = structuredClone(database.schema);
          const { values, title, grew } = toStoredValues(schema, asRecord(page.properties) ?? {});
          if (grew) database = await updateDatabase(db, ws, database.id, { schema }, actor, label);
          const row = await createDatabaseRow(db, ws, database.id, { title: optional(page.title) ?? title, properties: values }, actor, label);
          if (optional(page.content)) await saveMemo(c, auth, row.id, { contentMarkdown: String(page.content) });
          if (page.icon !== undefined || page.cover !== undefined) await updatePageMeta(db, ws, row.id, { icon: optional(page.icon) ?? null, cover: optional(page.cover) ?? null });
          created.push(row.id);
        }
        const { rows, cells } = await loadRows(c, auth, database);
        return { pages: created.map((id) => {
          const row = rows.find((item) => item.id === id);
          return { id, url: pageUrl(c, id), properties: row ? rowOut(c, database, row, cells).properties : {} };
        }) };
      }
      const parentId = optional(parent.page_id) ? stripId(String(parent.page_id)) : null;
      if (parentId) await requireAccess(c, auth, parentId, "edit");
      const notebookId = parentId ? undefined : optional(parent.notebook_id) ?? await defaultNotebookId(c, auth);
      const created = [];
      for (const page of pages) {
        const placement = await resolveNewPagePlacement(db, ws, { parentId, notebookId });
        const title = optional(page.title) ?? optional(asRecord(page.properties)?.title) ?? undefined;
        const memo = await createMemoRecord(db, ws, { notebookId: placement.notebookId, title, contentMarkdown: typeof page.content === "string" ? page.content : "", tags: [] }, actor, label);
        await setPagePlacement(db, ws, memo.id, { parentId: placement.parentId, position: placement.position, icon: optional(page.icon) ?? null });
        if (optional(page.cover)) await updatePageMeta(db, ws, memo.id, { cover: String(page.cover) });
        created.push({ id: memo.id, url: pageUrl(c, memo.id), properties: { title: memo.title ?? "Untitled" } });
      }
      return { pages: created };
    }
    case "update_page": {
      const id = stripId(required(args.page_id, "page_id"));
      await requireAccess(c, auth, id, "edit");
      const command = required(args.command, "command");
      const warnings: { index: number; code: string; message: string }[] = [];
      if (command === "update_properties") {
        const properties = asRecord(args.properties);
        const row = await db.prepare(`SELECT database_id FROM memos WHERE id = ? AND workspace_id = ? AND is_deleted = 0`).bind(id, ws).first<{ database_id: string | null }>();
        if (properties && Object.keys(properties).length) {
          if (row?.database_id) {
            await writeRowValues(c, auth, await getDatabase(db, ws, row.database_id), id, properties);
          } else {
            const unknown = Object.keys(properties).filter((key) => key.toLowerCase() !== "title");
            if (unknown.length) throw new AppError("invalid_params", `Only database rows have properties; this page takes title. Unknown: ${unknown.join(", ")}`, 400);
            await saveMemo(c, auth, id, { title: String(properties.title ?? properties.Title ?? "") });
          }
        }
        if (optional(args.title)) await saveMemo(c, auth, id, { title: String(args.title) });
      } else if (command === "update_content" || command === "replace_content") {
        const memo = await getMemoDetail(db, ws, id);
        if (!memo) throw new AppError("not_found", "Page not found", 404);
        let content: string;
        if (command === "replace_content") {
          if (typeof args.new_str !== "string") throw new AppError("invalid_params", "new_str is required for replace_content", 400);
          content = args.new_str;
        } else {
          const updates = Array.isArray(args.content_updates) ? args.content_updates : [];
          if (!updates.length) throw new AppError("invalid_params", "content_updates is required for update_content", 400);
          const result = replaceContent(memo.contentMarkdown, updates);
          content = result.content;
          warnings.push(...result.warnings);
        }
        if (content !== memo.contentMarkdown) await saveMemo(c, auth, id, { contentMarkdown: content });
      } else {
        throw new AppError("invalid_params", "command is update_properties, update_content or replace_content", 400);
      }
      if (args.icon !== undefined || args.cover !== undefined) {
        await updatePageMeta(db, ws, id, {
          ...(args.icon !== undefined ? { icon: optional(args.icon) ?? null } : {}),
          ...(args.cover !== undefined ? { cover: optional(args.cover) ?? null } : {}),
        });
      }
      const page = await fetchPage(c, auth, id);
      return { page_id: id, url: page.url, title: page.title, ...(page.properties ? { properties: page.properties } : {}), ...(warnings.length ? { warnings } : {}) };
    }
    case "move_pages": {
      const ids = idList(args.page_or_database_ids, "page_or_database_ids");
      const target = asRecord(args.new_parent) ?? {};
      const parentId = optional(target.page_id) ? stripId(String(target.page_id)) : null;
      if (parentId) await requireAccess(c, auth, parentId, "edit");
      if (!parentId && !optional(target.notebook_id) && target.workspace !== true) throw new AppError("invalid_params", "new_parent needs page_id, notebook_id or workspace: true", 400);
      const moved = [];
      for (const raw of ids) {
        const pageId = (await db.prepare(`SELECT page_memo_id FROM databases WHERE workspace_id = ? AND id = ?`).bind(ws, raw).first<{ page_memo_id: string }>())?.page_memo_id ?? raw;
        await requireAccess(c, auth, pageId, "edit");
        const page = await movePage(db, ws, pageId, parentId ? { parentId } : { parentId: null, ...(optional(target.notebook_id) ? { notebookId: String(target.notebook_id) } : {}) });
        moved.push({ id: pageId, parent: page.parentId ? { page_id: page.parentId } : { notebook_id: page.notebookId } });
      }
      return { moved };
    }
    case "duplicate_page": {
      const id = stripId(required(args.page_id, "page_id"));
      await requireAccess(c, auth, id, "view");
      const source = await getPageNode(db, ws, id);
      if (!source) throw new AppError("not_found", "Page not found", 404);
      if (source.parentId) await requireAccess(c, auth, source.parentId, "edit");
      const copy = await duplicateMemoRecord(c, id, {}, actor, label);
      await movePage(db, ws, copy.id, { parentId: source.parentId ?? null, afterId: id });
      if (source.icon || source.cover || source.style) await updatePageMeta(db, ws, copy.id, { icon: source.icon, cover: source.cover, style: source.style });
      return { id: copy.id, url: pageUrl(c, copy.id), title: copy.title };
    }
    case "delete_pages":
    case "restore_pages": {
      const ids = idList(args.page_ids, "page_ids");
      for (const id of ids) await requireAccess(c, auth, id, "edit");
      if (name === "restore_pages") {
        const restored = await restoreMemosRecord(db, ws, ids, actor);
        return { restored };
      }
      if (args.user_confirmed !== true) {
        const pages = await Promise.all(ids.map(async (id) => ({ id, title: (await getMemoDetail(db, ws, id))?.title ?? "Untitled", url: pageUrl(c, id) })));
        return { moved: false, message: "Nothing was moved. Confirm with the person, then call again with user_confirmed: true.", pages };
      }
      return { moved: true, deleted: await deleteMemosRecord(c.env, ws, ids, false, actor) };
    }
    case "create_database": {
      const parent = asRecord(args.parent) ?? {};
      const parentId = optional(parent.page_id) ? stripId(String(parent.page_id)) : null;
      if (parentId) await requireAccess(c, auth, parentId, "edit");
      const schema = createDefaultDatabaseSchema(() => createId("prop").slice(0, 24));
      const extra = Array.isArray(args.properties) ? args.properties : null;
      const finalSchema = extra
        ? applySchemaChanges({ properties: schema.properties.filter((property) => property.type === "title") },
          Object.fromEntries(extra.map((raw) => { const item = asRecord(raw) ?? {}; return [String(item.name ?? ""), { type: item.type, ...(Array.isArray(item.options) ? { options: item.options } : {}) }]; })))
        : schema;
      const database = await createDatabase(db, ws, {
        parentId, notebookId: parentId ? undefined : optional(parent.notebook_id) ?? await defaultNotebookId(c, auth), title: optional(args.title), schema: finalSchema,
      }, actor, label);
      return databaseOut(c, database);
    }
    case "update_data_source": {
      const database = await loadDatabase(c, auth, required(args.database_id, "database_id"), "edit");
      const changes = asRecord(args.properties);
      if (!changes && !optional(args.title)) throw new AppError("invalid_params", "Give title or properties to change", 400);
      const updated = await updateDatabase(db, ws, database.id, {
        ...(changes ? { schema: applySchemaChanges(database.schema, changes) } : {}),
        ...(optional(args.title) ? { title: String(args.title).trim() } : {}),
      }, actor, label);
      return databaseOut(c, updated);
    }
    case "create_view": {
      const database = await loadDatabase(c, auth, required(args.database_id, "database_id"), "edit");
      const type = required(args.type, "type");
      if (!DATABASE_VIEW_TYPES.includes(type as never)) throw new AppError("invalid_params", `type is one of ${DATABASE_VIEW_TYPES.join(", ")}`, 400);
      const view = await createDatabaseView(db, ws, database.id, { name: required(args.name, "name"), type: type as typeof DATABASE_VIEW_TYPES[number], config: viewConfigFrom(database.schema, args) });
      return { id: view.id, url: `view://${view.id}`, name: view.name, type: view.type, config: view.config };
    }
    case "update_view": {
      const viewId = stripId(required(args.view_id, "view_id"));
      const database = await loadDatabase(c, auth, await findView(c, auth, viewId), "edit");
      const current = database.views.find((view) => view.id === viewId)!;
      const type = optional(args.type);
      if (type && !DATABASE_VIEW_TYPES.includes(type as never)) throw new AppError("invalid_params", `type is one of ${DATABASE_VIEW_TYPES.join(", ")}`, 400);
      const view = await updateDatabaseView(db, ws, database.id, viewId, {
        ...(optional(args.name) ? { name: String(args.name).trim() } : {}),
        ...(type ? { type: type as typeof DATABASE_VIEW_TYPES[number] } : {}),
        config: viewConfigFrom(database.schema, args, current.config),
      });
      return { id: view.id, url: `view://${view.id}`, name: view.name, type: view.type, config: view.config };
    }
    case "query_data_sources": {
      const viewId = optional(args.view_id) ? stripId(String(args.view_id)) : null;
      const database = await loadDatabase(c, auth, viewId ? await findView(c, auth, viewId) : required(args.database_id, "database_id or view_id"), "view");
      const base = viewId ? database.views.find((view) => view.id === viewId)!.config : {};
      const config = viewConfigFrom(database.schema, { filter: args.filter, sort: args.sort, filter_mode: args.filter_mode }, { filters: base.filters, sorts: base.sorts, filterMode: base.filterMode });
      const { rows, cells } = await loadRows(c, auth, database);
      const visible = applyDatabaseView({ schema: database.schema, rows, cells, config });
      const size = pageLimit(args.limit, 50, 100);
      const offset = cursorOffset(args.cursor);
      return {
        database_id: database.id,
        results: visible.slice(offset, offset + size).map((row) => rowOut(c, database, row, cells)),
        has_more: visible.length > offset + size,
        next_cursor: visible.length > offset + size ? String(offset + size) : null,
        ...(rows.length >= QUERY_ROW_SCAN ? { truncated: true } : {}),
      };
    }
    case "delete_databases": {
      const ids = idList(args.database_ids, "database_ids");
      const databases = [];
      for (const id of ids) databases.push(await loadDatabase(c, auth, id, "edit"));
      if (args.user_confirmed !== true) {
        return { moved: false, message: "Nothing was moved. Confirm with the person, then call again with user_confirmed: true.", databases: databases.map((database) => ({ id: database.id, title: database.title ?? "Untitled", url: pageUrl(c, database.pageMemoId) })) };
      }
      const pageIds = databases.map((database) => database.pageMemoId);
      // A database's rows are pages of their own: they go to Trash with it, at the same moment, so restoring it brings them back.
      const rowIds = (await Promise.all(databases.map(async (database) => (await db.prepare(`SELECT id FROM memos WHERE workspace_id = ? AND database_id = ? AND is_deleted = 0`).bind(ws, database.id).all<{ id: string }>()).results.map((row) => row.id)))).flat();
      return { moved: true, deleted: await deleteMemosRecord(c.env, ws, [...pageIds, ...rowIds], false, actor) };
    }
    case "create_comment": {
      const id = stripId(required(args.page_id, "page_id"));
      await requireAccess(c, auth, id, "comment");
      const selection = optional(args.selection_with_ellipsis)?.replace(/\.\.\.|…/g, " ").replace(/\s+/g, " ").trim();
      const input = CommentCreateSchema.parse({
        body: required(args.markdown, "markdown"),
        ...(optional(args.discussion_id) ? { threadId: stripId(String(args.discussion_id)) } : {}),
        ...(selection ? { quote: selection } : {}),
      });
      const { comment, emails } = await createMemoComment(db, ws, id, input, auth);
      if (c.env.sendEmail) await Promise.all(emails.map((email) => c.env.sendEmail!(email).catch(() => undefined)));
      return { id: comment.id, discussion_id: comment.threadId, discussion_url: `discussion://${comment.threadId}` };
    }
    case "get_comments": {
      const id = stripId(required(args.page_id, "page_id"));
      await requireAccess(c, auth, id, "view");
      return { discussions: discussions(await listMemoComments(db, ws, id), args.include_resolved === true) };
    }
    case "update_comment": {
      const comment = await updateMemoComment(db, ws, required(args.comment_id, "comment_id"), { body: required(args.markdown, "markdown") }, auth);
      return { id: comment.id, markdown: comment.body };
    }
    case "delete_comment": {
      await deleteMemoComment(db, ws, required(args.comment_id, "comment_id"), auth);
      return { deleted: true };
    }
    case "set_discussion_resolved": {
      const threadId = stripId(required(args.discussion_id, "discussion_id"));
      const root = await db.prepare(`SELECT memo_id FROM memo_comments WHERE id = ? AND workspace_id = ?`).bind(threadId, ws).first<{ memo_id: string }>();
      if (!root) throw new AppError("not_found", "Discussion not found", 404);
      await requireAccess(c, auth, root.memo_id, "comment");
      const comment = await updateMemoComment(db, ws, threadId, { resolved: args.resolved === true }, auth);
      return { discussion_id: threadId, resolved: !!comment.resolvedAt };
    }
    case "view_version": {
      const id = stripId(required(args.page_id, "page_id"));
      await requireAccess(c, auth, id, "view");
      const time = parseTime(args.time, "time");
      const version = await pageAt(c, auth, id, time);
      return { page_id: id, time, is_current: !version.revision, changed_at: version.until, title: version.title, content: version.content };
    }
    case "get_version_changes": {
      const id = stripId(required(args.page_id, "page_id"));
      await requireAccess(c, auth, id, "view");
      const end = args.end_time ? parseTime(args.end_time, "end_time") : new Date().toISOString();
      const start = args.start_time ? parseTime(args.start_time, "start_time") : new Date(Date.parse(end) - 86_400_000).toISOString();
      const revisions = await listMemoRevisions(db, ws, id, 200, getMemoDetail);
      // Each saved version marks an edit: who made it, when, and the title the page had before it.
      return {
        page_id: id, start_time: start, end_time: end,
        changes: revisions.filter((revision) => revision.createdAt >= start && revision.createdAt <= end)
          .map((revision) => ({ time: revision.createdAt, author: revision.createdBy, title_before: revision.title, version_id: revision.id })),
      };
    }
    case "restore_version": {
      const id = stripId(required(args.page_id, "page_id"));
      await requireAccess(c, auth, id, "edit");
      const time = parseTime(args.time, "time");
      const version = await pageAt(c, auth, id, time);
      if (!version.revision) return { restored: false, message: "The page hasn't changed since then, so there's nothing to restore.", title: version.title };
      if (args.user_confirmed !== true) {
        return { restored: false, message: "Nothing changed yet. This is the version that would come back; call again with user_confirmed: true.", time, title: version.title, content: version.content };
      }
      if (!(await getMemoRevisionRow(db, ws, id, version.revision.id))) throw new AppError("not_found", "Version not found", 404);
      await restoreMemoRevision(db, ws, id, version.revision.id, actor, label, { getMemoDetail, getMemoDetailRow });
      return { restored: true, time, page: { id, title: version.title ?? "Untitled", url: pageUrl(c, id) } };
    }
    case "calendar_list_calendars": {
      const now = Date.now();
      const calendars = await loadConnectedCalendars(c, now, now + 60_000);
      return { calendars: calendars.map((calendar) => ({ id: calendar.id, name: calendar.label, error: calendar.lastError ?? null })) };
    }
    case "calendar_list_events": {
      const from = args.timeMin ? Date.parse(parseTime(args.timeMin, "timeMin")) : Date.now();
      const to = args.timeMax ? Date.parse(parseTime(args.timeMax, "timeMax")) : from + 7 * 86_400_000;
      if (to <= from || to - from > 92 * 86_400_000) throw new AppError("invalid_params", "timeMax must be after timeMin, at most 92 days later", 400);
      const calendars = await loadConnectedCalendars(c, from, to);
      return { calendars: calendars.map((calendar) => ({ id: calendar.id, name: calendar.label, error: calendar.lastError ?? null, events: calendar.events })) };
    }
    case "get_tool_access": {
      const wanted = Array.isArray(args.tool_names) ? new Set(args.tool_names.map((item) => String(item).replace(/^notion-/, "").replace(/-/g, "_"))) : null;
      const canWrite = hasScopes(auth, ["write:memos"]) && auth.teamRole !== "viewer";
      const canRead = hasScopes(auth, ["read:memos"]);
      return {
        tools: Object.fromEntries(WORKSPACE_TOOL_DEFINITIONS.filter((tool) => !wanted || wanted.has(tool.name)).map((tool) => [tool.name, {
          available: WRITE_TOOLS.has(tool.name) ? canWrite : canRead,
        }])),
      };
    }
    default:
      throw new Error(`Unknown tool: ${name}`);
  }
};
