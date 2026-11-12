import {
  APPKEEP_EMAILS_PER_DAY,
  AUTOMATION_LIMIT_PER_DATABASE,
  AUTOMATION_RUN_RETENTION_DAYS,
  AUTOMATION_RUNS_PER_MINUTE,
  AutomationActionSchema,
  AutomationTriggerSchema,
  CLIENT_ACTION_TYPES,
  emptyOutcome,
  fillPlaceholders,
  nextScheduleRun,
  resolveDynamicValue,
  zonedTimeToUtc,
  type ActionOutcome,
  type AutomationAction,
  type AutomationRun,
  type AutomationRunStatus,
  type AutomationTrigger,
  type DatabaseAutomation,
  type DatabaseDetail,
  type DatabaseProperty,
  type DatabasePropertyValue,
  type DatabaseRow,
  type WorkspaceMember,
} from "@ponder/shared";
import type { AuditActor, AuthContext, Bindings } from "./api-context";
import { AppError } from "./app-error";
import { createMemoComment, listWorkspaceMembers } from "./comment-service";
import {
  createDatabaseRow,
  getDatabase,
  getDatabaseRow,
  listDueRepeatingTemplates,
  setTemplateRepeatProgress,
  updateDatabaseRow,
  type RowChange,
  type RowWriteOptions,
} from "./database-service";
import { createId, isoNow } from "./entity-utils";
import type { DatabaseAdapter } from "./storage-contract";

/**
 * Database automations, buttons and repeating templates: one engine for Notion's ⚡ automations,
 * Button properties, /button blocks and "Duplicate every…".
 *
 * Loop guard: actions write rows through the database service without a row-change listener,
 * so an automation's own edits never set off automations. Buttons are clicks by a person, so
 * their edits do, as in Notion.
 */

export type AutomationEnv = {
  db: DatabaseAdapter;
  sendEmail?: Bindings["sendEmail"];
  emitEvent?: Bindings["emitEvent"];
  wakeAt?: Bindings["wakeAt"];
  /** AppKeep's per-app daily email limit, or null where there is none. */
  emailDailyLimit: number | null;
  now: () => Date;
};

export const automationEnvFrom = (env: Bindings): AutomationEnv => ({
  db: env.storage.db,
  sendEmail: env.sendEmail,
  emitEvent: env.emitEvent,
  wakeAt: env.wakeAt,
  emailDailyLimit: env.PONDER_APPKEEP === "true" ? APPKEEP_EMAILS_PER_DAY : null,
  now: () => new Date(),
});

/** A failed action: the message goes to the run log, or back to whoever clicked the button. */
export class AutomationError extends Error {}

const MAX_DUE_PER_TICK = 25;
const MAX_DATE_ROWS_PER_RUN = 100;
const EVENT_LIMIT_BYTES = 16_000;

type AutomationRecord = {
  id: string;
  workspace_id: string;
  database_id: string;
  name: string;
  enabled: number;
  trigger_json: string;
  actions_json: string;
  created_by: string | null;
  next_run_at: string | null;
  last_run_at: string | null;
  run_count: number;
  created_at: string;
  updated_at: string;
};

const AUTOMATION_COLUMNS = "id, workspace_id, database_id, name, enabled, trigger_json, actions_json, created_by, next_run_at, last_run_at, run_count, created_at, updated_at";

const parseTrigger = (json: string): AutomationTrigger | null => {
  try {
    const parsed = AutomationTriggerSchema.safeParse(JSON.parse(json));
    return parsed.success ? parsed.data : null;
  } catch {
    return null;
  }
};

const parseActions = (json: string): AutomationAction[] => {
  try {
    const parsed = JSON.parse(json) as unknown;
    if (!Array.isArray(parsed)) return [];
    return parsed.flatMap((item) => {
      const action = AutomationActionSchema.safeParse(item);
      return action.success ? [action.data] : [];
    });
  } catch {
    return [];
  }
};

const mapAutomation = (row: AutomationRecord): DatabaseAutomation | null => {
  const trigger = parseTrigger(row.trigger_json);
  if (!trigger) return null;
  return {
    id: row.id,
    databaseId: row.database_id,
    name: row.name,
    enabled: row.enabled === 1,
    trigger,
    actions: parseActions(row.actions_json),
    createdBy: row.created_by,
    nextRunAt: row.next_run_at,
    lastRunAt: row.last_run_at,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
};

// ---------------------------------------------------------------------------
// Checking an automation against its database
// ---------------------------------------------------------------------------

const propertyOf = (database: DatabaseDetail, id: string) => database.schema.properties.find((property) => property.id === id);

const PERSON_TYPES = new Set(["person", "created_by", "last_edited_by"]);

/** Says what's wrong in Notion's terms, or nothing. Saving is refused until it's fixed, like Notion's editor. */
export const checkActions = async (
  db: DatabaseAdapter,
  workspaceId: string,
  database: DatabaseDetail,
  actions: AutomationAction[],
  context: { hasPage: boolean; members?: WorkspaceMember[] },
): Promise<string | null> => {
  for (const action of actions) {
    switch (action.type) {
      case "edit_property":
        if (!context.hasPage) return "“Edit property” needs a page to edit, and this trigger has none.";
        if (Object.keys(action.values).length === 0) return "Choose a property to edit.";
        break;
      case "add_comment":
        if (!context.hasPage) return "“Add comment” needs a page to comment on, and this trigger has none.";
        break;
      case "add_page": {
        const target = action.databaseId === database.id ? database : await getDatabase(db, workspaceId, action.databaseId).catch(() => null);
        if (!target) return "The database for “Add page to” no longer exists.";
        break;
      }
      case "send_notification":
        if (action.recipients.kind === "people") {
          if (action.recipients.userIds.length === 0) return "Choose who to notify.";
        } else if (!PERSON_TYPES.has(propertyOf(database, action.recipients.propertyId)?.type ?? "")) {
          return "Notifications go to a person property, and that one is gone.";
        }
        break;
      case "send_mail":
        if (action.to.kind === "emails" && action.to.emails.length === 0) return "Add an email address to send to.";
        if (action.to.kind === "property") {
          const type = propertyOf(database, action.to.propertyId)?.type ?? "";
          if (!PERSON_TYPES.has(type) && type !== "email") return "Mail goes to a person or email property, and that one is gone.";
        }
        if (!action.subject.trim()) return "Add a subject to the mail.";
        break;
      case "open_url":
        if (!action.url.trim()) return "Add the page or URL to open.";
        break;
      default:
        break;
    }
  }
  return null;
};

const checkTrigger = (database: DatabaseDetail, trigger: AutomationTrigger): string | null => {
  if (trigger.type === "property_edited" && trigger.propertyId !== "title" && !propertyOf(database, trigger.propertyId)) {
    return "The property this automation watches no longer exists.";
  }
  if (trigger.type === "date_reached" && propertyOf(database, trigger.propertyId)?.type !== "date") {
    return "Choose a date property.";
  }
  return null;
};

// ---------------------------------------------------------------------------
// Time-based triggers
// ---------------------------------------------------------------------------

/** When a date-reached trigger fires for a row's date: at the trigger's time on a date-only value, or at the value's own time. */
export const dateFireTime = (start: string, trigger: Extract<AutomationTrigger, { type: "date_reached" }>): Date | null => {
  const shift = trigger.offsetDays * 86_400_000;
  if (/^\d{4}-\d{2}-\d{2}$/.test(start)) return new Date(zonedTimeToUtc(start, trigger.time, trigger.timezone).getTime() + shift);
  const instant = Date.parse(start);
  return Number.isFinite(instant) ? new Date(instant + shift) : null;
};

const jsonPathFor = (propertyId: string) => `$."${propertyId.replace(/["\\]/g, "")}".start`;

const datedRows = async (db: DatabaseAdapter, workspaceId: string, databaseId: string, propertyId: string) => {
  const path = jsonPathFor(propertyId);
  const rows = await db
    .prepare(
      `SELECT id, json_extract(properties_json, ?) AS start FROM memos
       WHERE workspace_id = ? AND database_id = ? AND is_deleted = 0 AND json_extract(properties_json, ?) IS NOT NULL`
    )
    .bind(path, workspaceId, databaseId, path)
    .all<{ id: string; start: string }>();
  return rows.results.filter((row) => typeof row.start === "string");
};

const nextRunFor = async (
  db: DatabaseAdapter,
  workspaceId: string,
  databaseId: string,
  trigger: AutomationTrigger,
  now: Date,
  runsSoFar: number,
): Promise<string | null> => {
  if (trigger.type === "recurring") return nextScheduleRun(trigger.schedule, now, runsSoFar)?.toISOString() ?? null;
  if (trigger.type !== "date_reached") return null;
  let earliest: number | null = null;
  for (const row of await datedRows(db, workspaceId, databaseId, trigger.propertyId)) {
    const fire = dateFireTime(row.start, trigger)?.getTime();
    if (fire !== undefined && fire > now.getTime() && (earliest === null || fire < earliest)) earliest = fire;
  }
  return earliest === null ? null : new Date(earliest).toISOString();
};

/**
 * Tells AppKeep when Ponder next has scheduled work (automations, repeating templates, GitHub syncs), or that it has none, so an idle copy
 * isn't woken every five minutes for nothing.
 */
export const refreshWake = async (env: AutomationEnv) => {
  if (!env.wakeAt) return;
  const [automation, template, sync] = await Promise.all([
    env.db.prepare(`SELECT MIN(next_run_at) AS next FROM database_automations WHERE enabled = 1 AND next_run_at IS NOT NULL`).first<{ next: string | null }>(),
    env.db.prepare(`SELECT MIN(repeat_next_at) AS next FROM database_templates WHERE repeat_next_at IS NOT NULL`).first<{ next: string | null }>(),
    // GitHub synced databases (database-sync-service.ts) check GitHub every 15 minutes.
    env.db.prepare(`SELECT MIN(next_run_at) AS next FROM database_syncs WHERE status = 'active' AND next_run_at IS NOT NULL`).first<{ next: string | null }>(),
  ]);
  const times = [automation?.next, template?.next, sync?.next].filter((value): value is string => Boolean(value)).sort();
  await env.wakeAt(times[0] ? new Date(times[0]) : null);
};

/** Sets next runs after a restore; their schedules start again from `now`. */
export const rescheduleAutomations = async (db: DatabaseAdapter, workspaceId: string, ids: string[], now: Date) => {
  for (const id of ids) {
    const row = await db
      .prepare(`SELECT ${AUTOMATION_COLUMNS} FROM database_automations WHERE workspace_id = ? AND id = ?`)
      .bind(workspaceId, id)
      .first<AutomationRecord>();
    const trigger = row ? parseTrigger(row.trigger_json) : null;
    if (!row || !trigger) continue;
    const next = row.enabled === 1 ? await nextRunFor(db, workspaceId, row.database_id, trigger, now, 0) : null;
    await db.prepare(`UPDATE database_automations SET next_run_at = ?, run_count = 0, last_run_at = ? WHERE id = ?`).bind(next, now.toISOString(), id).run();
  }
};

// ---------------------------------------------------------------------------
// Storage
// ---------------------------------------------------------------------------

export const listAutomations = async (db: DatabaseAdapter, workspaceId: string, databaseId: string): Promise<DatabaseAutomation[]> => {
  await getDatabase(db, workspaceId, databaseId);
  const rows = await db
    .prepare(`SELECT ${AUTOMATION_COLUMNS} FROM database_automations WHERE workspace_id = ? AND database_id = ? ORDER BY position ASC, created_at ASC`)
    .bind(workspaceId, databaseId)
    .all<AutomationRecord>();
  return rows.results.flatMap((row) => {
    const automation = mapAutomation(row);
    return automation ? [automation] : [];
  });
};

const loadAutomation = async (db: DatabaseAdapter, workspaceId: string, databaseId: string, id: string) => {
  const row = await db
    .prepare(`SELECT ${AUTOMATION_COLUMNS} FROM database_automations WHERE workspace_id = ? AND database_id = ? AND id = ?`)
    .bind(workspaceId, databaseId, id)
    .first<AutomationRecord>();
  if (!row) throw new AppError("not_found", "Automation not found", 404);
  return row;
};

type AutomationInput = { name?: string; enabled?: boolean; trigger?: AutomationTrigger; actions?: AutomationAction[] };

const assertValid = async (env: AutomationEnv, workspaceId: string, database: DatabaseDetail, trigger: AutomationTrigger, actions: AutomationAction[]) => {
  const problem = checkTrigger(database, trigger)
    ?? (actions.some((action) => CLIENT_ACTION_TYPES.has(action.type)) ? "That action is only for buttons." : null)
    ?? await checkActions(env.db, workspaceId, database, actions, { hasPage: trigger.type !== "recurring" });
  if (problem) throw new AppError("invalid_automation", problem, 400);
};

export const createAutomation = async (
  env: AutomationEnv,
  workspaceId: string,
  databaseId: string,
  input: Required<Pick<AutomationInput, "trigger" | "actions">> & AutomationInput,
  createdBy: string | null,
): Promise<DatabaseAutomation> => {
  const database = await getDatabase(env.db, workspaceId, databaseId);
  await assertValid(env, workspaceId, database, input.trigger, input.actions);
  const stats = await env.db
    .prepare(`SELECT COUNT(*) AS total, MAX(position) AS position FROM database_automations WHERE workspace_id = ? AND database_id = ?`)
    .bind(workspaceId, databaseId)
    .first<{ total: number; position: number | null }>();
  if ((stats?.total ?? 0) >= AUTOMATION_LIMIT_PER_DATABASE) {
    throw new AppError("too_many_automations", `A database can have at most ${AUTOMATION_LIMIT_PER_DATABASE} automations.`, 409);
  }
  const id = createId("dba");
  const now = env.now();
  const enabled = input.enabled ?? true;
  const nextRunAt = enabled ? await nextRunFor(env.db, workspaceId, databaseId, input.trigger, now, 0) : null;
  await env.db
    .prepare(
      `INSERT INTO database_automations (id, workspace_id, database_id, name, enabled, trigger_json, actions_json, created_by, next_run_at, position, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    )
    .bind(
      id, workspaceId, databaseId, input.name ?? "", enabled ? 1 : 0, JSON.stringify(input.trigger), JSON.stringify(input.actions),
      createdBy, nextRunAt, (stats?.position ?? 0) + 1024, now.toISOString(), now.toISOString(),
    )
    .run();
  await refreshWake(env);
  return mapAutomation(await loadAutomation(env.db, workspaceId, databaseId, id))!;
};

export const updateAutomation = async (
  env: AutomationEnv,
  workspaceId: string,
  databaseId: string,
  id: string,
  input: AutomationInput,
): Promise<DatabaseAutomation> => {
  const current = await loadAutomation(env.db, workspaceId, databaseId, id);
  const trigger = input.trigger ?? parseTrigger(current.trigger_json);
  if (!trigger) throw new AppError("invalid_automation", "This automation's trigger is damaged; choose a new one.", 400);
  const actions = input.actions ?? parseActions(current.actions_json);
  if (input.trigger || input.actions) {
    await assertValid(env, workspaceId, await getDatabase(env.db, workspaceId, databaseId), trigger, actions);
  }
  const enabled = input.enabled ?? current.enabled === 1;
  // A changed trigger starts its schedule again; turning it back on picks up from now.
  const runCount = input.trigger ? 0 : current.run_count;
  const nextRunAt = enabled ? await nextRunFor(env.db, workspaceId, databaseId, trigger, env.now(), runCount) : null;
  await env.db
    .prepare(
      `UPDATE database_automations SET name = ?, enabled = ?, trigger_json = ?, actions_json = ?, next_run_at = ?, run_count = ?, updated_at = ?
       WHERE workspace_id = ? AND database_id = ? AND id = ?`
    )
    .bind(
      input.name ?? current.name, enabled ? 1 : 0, JSON.stringify(trigger), JSON.stringify(actions), nextRunAt, runCount, isoNow(),
      workspaceId, databaseId, id,
    )
    .run();
  await refreshWake(env);
  return mapAutomation(await loadAutomation(env.db, workspaceId, databaseId, id))!;
};

export const deleteAutomation = async (env: AutomationEnv, workspaceId: string, databaseId: string, id: string) => {
  await loadAutomation(env.db, workspaceId, databaseId, id);
  await env.db.batch([
    env.db.prepare(`DELETE FROM database_automations WHERE workspace_id = ? AND database_id = ? AND id = ?`).bind(workspaceId, databaseId, id),
    env.db.prepare(`DELETE FROM automation_runs WHERE workspace_id = ? AND automation_id = ?`).bind(workspaceId, id),
  ]);
  await refreshWake(env);
};

export const listAutomationRuns = async (
  db: DatabaseAdapter,
  workspaceId: string,
  databaseId: string,
  automationId: string | null,
  limit = 50,
): Promise<AutomationRun[]> => {
  const rows = await db
    .prepare(
      `SELECT r.id, r.automation_id, r.row_id, r.status, r.error, r.started_at, m.title AS row_title
       FROM automation_runs r
       INNER JOIN database_automations a ON a.id = r.automation_id AND a.workspace_id = r.workspace_id
       LEFT JOIN memos m ON m.id = r.row_id AND m.workspace_id = r.workspace_id
       WHERE r.workspace_id = ? AND a.database_id = ? ${automationId ? "AND r.automation_id = ?" : ""}
       ORDER BY r.started_at DESC
       LIMIT ?`
    )
    .bind(...(automationId ? [workspaceId, databaseId, automationId, limit] : [workspaceId, databaseId, limit]))
    .all<{ id: string; automation_id: string; row_id: string | null; status: AutomationRunStatus; error: string | null; started_at: string; row_title: string | null }>();
  return rows.results.map((row) => ({
    id: row.id,
    automationId: row.automation_id,
    rowId: row.row_id,
    rowTitle: row.row_title,
    status: row.status,
    error: row.error,
    startedAt: row.started_at,
  }));
};

const utcDay = (now: Date) => now.toISOString().slice(0, 10);

export const emailUsage = async (env: AutomationEnv) => {
  const row = await env.db.prepare(`SELECT sent FROM automation_email_days WHERE day = ?`).bind(utcDay(env.now())).first<{ sent: number }>();
  return { sent: row?.sent ?? 0, limit: env.emailDailyLimit, available: Boolean(env.sendEmail) };
};

// ---------------------------------------------------------------------------
// Running actions
// ---------------------------------------------------------------------------

type RunContext = {
  workspaceId: string;
  database: DatabaseDetail;
  /** The page the trigger or button is about. Null for "Every {frequency}" automations. */
  row: DatabaseRow | null;
  /** A /button block's page, when it isn't a database row. */
  pageId: string | null;
  actor: AuditActor;
  actorLabel: string;
  /** Who it shows as: the automation's name, or the person who clicked. */
  authorName: string;
  timeZone: string;
  /** Present for buttons, so a click's edits set off automations; absent for automations (the loop guard). */
  writeOptions: RowWriteOptions;
};

const optionNames = (property: DatabaseProperty, value: DatabasePropertyValue) => {
  const ids = Array.isArray(value) ? value : [value];
  return (property.options ?? []).filter((option) => ids.includes(option.id as never)).map((option) => option.name).join(", ");
};

/** A value as words, for `{{Property}}` in messages and for webhook events. */
const valueText = (property: DatabaseProperty, row: DatabaseRow, members: WorkspaceMember[]): string => {
  const value = row.properties[property.id];
  const person = (id: string | null) => {
    const member = members.find((item) => item.id === id);
    return member ? member.displayName || member.username : "";
  };
  switch (property.type) {
    case "title": return row.title ?? "";
    case "select":
    case "status":
    case "multi_select": return optionNames(property, value ?? null);
    case "checkbox": return value === true ? "Yes" : "No";
    case "date": return value && typeof value === "object" && "start" in value ? String(value.start) : "";
    case "person": return Array.isArray(value) ? value.map((id) => person(String(id))).filter(Boolean).join(", ") : "";
    case "created_by": return person(row.createdBy);
    case "last_edited_by": return person(row.updatedBy);
    case "created_time": return row.createdAt;
    case "last_edited_time": return row.updatedAt;
    case "unique_id": return row.number === null ? "" : `${property.uniqueId?.prefix ? `${property.uniqueId.prefix}-` : ""}${row.number}`;
    case "files": return Array.isArray(value) ? value.map((file) => (typeof file === "object" && file ? file.name : "")).join(", ") : "";
    default: return value === null || value === undefined ? "" : Array.isArray(value) ? value.join(", ") : String(value);
  }
};

const filler = (context: RunContext, members: WorkspaceMember[]) => (template: string) =>
  fillPlaceholders(template, (name) => {
    if (!context.row) return null;
    const property = context.database.schema.properties.find((item) => item.name.toLowerCase() === name.toLowerCase());
    return property ? valueText(property, context.row, members) : null;
  });

const resolveValues = (values: Record<string, DatabasePropertyValue>, context: RunContext, now: Date) =>
  Object.fromEntries(Object.entries(values).map(([key, value]) => [key, resolveDynamicValue(value, now, context.timeZone)]));

const peopleIn = (context: RunContext, propertyId: string): string[] => {
  const property = propertyOf(context.database, propertyId);
  if (!context.row || !property) return [];
  if (property.type === "created_by") return context.row.createdBy ? [context.row.createdBy] : [];
  if (property.type === "last_edited_by") return context.row.updatedBy ? [context.row.updatedBy] : [];
  const value = context.row.properties[propertyId];
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === "string") : [];
};

const targetPageId = (context: RunContext) => context.row?.id ?? context.pageId ?? context.database.pageMemoId;

const sendOneEmail = async (env: AutomationEnv, message: { to: string; subject: string; text: string }) => {
  if (!env.sendEmail) throw new AutomationError("Email isn't set up on this server, so the mail wasn't sent.");
  if (env.emailDailyLimit !== null) {
    const usage = await emailUsage(env);
    if (usage.sent >= env.emailDailyLimit) {
      throw new AutomationError(`AppKeep sends at most ${env.emailDailyLimit} emails a day for Ponder, and today's are used up. Mail will send again tomorrow.`);
    }
  }
  try {
    await env.sendEmail(message);
  } catch (error) {
    const reason = error instanceof Error && error.message ? error.message : "the mail service refused it";
    throw new AutomationError(`The mail to ${message.to} wasn't sent: ${reason}`);
  }
  await env.db
    .prepare(`INSERT INTO automation_email_days (day, sent) VALUES (?, 1) ON CONFLICT(day) DO UPDATE SET sent = sent + 1`)
    .bind(utcDay(env.now()))
    .run();
};

const eventPayload = (context: RunContext, members: WorkspaceMember[], automation: { id: string; name: string } | null) => {
  const properties = context.row
    ? Object.fromEntries(context.database.schema.properties.filter((property) => property.type !== "button").map((property) => [property.name, valueText(property, context.row!, members)]))
    : {};
  const payload = {
    automation: automation ?? { id: null, name: "Button" },
    database: { id: context.database.id, title: context.database.title },
    page: context.row ? { id: context.row.id, title: context.row.title } : null,
    properties,
    at: new Date().toISOString(),
  };
  // AppKeep events hold at most 16 KB: long values are cut, never the whole event.
  let body = JSON.stringify(payload);
  if (body.length > EVENT_LIMIT_BYTES) {
    payload.properties = Object.fromEntries(Object.entries(properties).map(([key, value]) => [key, value.slice(0, 200)]));
    body = JSON.stringify(payload);
    if (body.length > EVENT_LIMIT_BYTES) payload.properties = {};
  }
  return payload;
};

/** Runs actions in order and stops at the first that fails, as Notion does. */
export const runActions = async (
  env: AutomationEnv,
  context: RunContext,
  actions: AutomationAction[],
  automation: { id: string; name: string } | null,
): Promise<ActionOutcome> => {
  const outcome = emptyOutcome();
  const members = await listWorkspaceMembers(env.db, context.workspaceId);
  const fill = filler(context, members);
  const { db } = env;
  for (const action of actions) {
    const now = env.now();
    switch (action.type) {
      case "edit_property": {
        if (!context.row) throw new AutomationError("“Edit property” needs a page to edit, and there is none.");
        const values = resolveValues(action.values, context, now);
        const { title, ...properties } = values;
        context.row = await updateDatabaseRow(
          db, context.workspaceId, context.database.id, context.row.id,
          { ...(typeof title === "string" ? { title: fill(title) } : {}), properties },
          context.actor, context.actorLabel, context.writeOptions,
        );
        outcome.editedPages += 1;
        break;
      }
      case "add_page": {
        await createDatabaseRow(
          db, context.workspaceId, action.databaseId,
          { title: fill(action.title) || undefined, properties: resolveValues(action.values, context, now) },
          context.actor, context.actorLabel, context.writeOptions,
        ).catch((error: unknown) => {
          throw new AutomationError(error instanceof AppError ? `“Add page to” failed: ${error.message}` : "“Add page to” failed.");
        });
        outcome.createdPages += 1;
        break;
      }
      case "add_comment": {
        const auth: AuthContext = {
          kind: "agent", actorType: "agent", actorId: null, username: "automation", displayName: context.authorName,
          scopes: [], workspaceId: context.workspaceId, role: "member",
        };
        const { emails } = await createMemoComment(db, context.workspaceId, targetPageId(context), { body: fill(action.body) }, auth);
        // People following the page hear about it as they would any comment; those emails are best effort.
        if (env.sendEmail) await Promise.all(emails.map((email) => sendOneEmail(env, email).catch(() => undefined)));
        outcome.comments += 1;
        break;
      }
      case "send_notification": {
        const memberIds = new Set(members.map((member) => member.id));
        const ids = action.recipients.kind === "people" ? action.recipients.userIds : peopleIn(context, action.recipients.propertyId);
        const recipients = [...new Set(ids)].filter((id) => memberIds.has(id));
        const message = fill(action.message).trim() || (context.row?.title ? `About ${context.row.title}` : context.authorName);
        if (recipients.length > 0) {
          await db.batch(recipients.map((recipientId) => db
            .prepare(
              `INSERT INTO notifications (id, workspace_id, recipient_id, kind, memo_id, comment_id, actor_name, excerpt, created_at)
               VALUES (?, ?, ?, 'automation', ?, NULL, ?, ?, ?)`
            )
            .bind(createId("ntf"), context.workspaceId, recipientId, targetPageId(context), context.authorName, message.slice(0, 160), now.toISOString())));
        }
        outcome.notified += recipients.length;
        break;
      }
      case "send_mail": {
        let addresses: string[];
        if (action.to.kind === "emails") {
          addresses = action.to.emails;
        } else {
          const property = propertyOf(context.database, action.to.propertyId);
          if (property?.type === "email") {
            const value = context.row?.properties[property.id];
            addresses = typeof value === "string" && value.includes("@") ? [value.trim()] : [];
          } else {
            const people = new Set(peopleIn(context, action.to.propertyId));
            addresses = members.flatMap((member) => (people.has(member.id) && member.email ? [member.email] : []));
          }
        }
        const subject = fill(action.subject).trim() || context.authorName;
        const text = fill(action.body).trim() || subject;
        for (const to of [...new Set(addresses)]) {
          await sendOneEmail(env, { to, subject: subject.slice(0, 200), text });
          outcome.emailed += 1;
        }
        break;
      }
      case "send_webhook": {
        if (!env.emitEvent) throw new AutomationError("Webhooks are sent through AppKeep, and this server isn't running on AppKeep.");
        try {
          await env.emitEvent("automation", eventPayload(context, members, automation));
        } catch (error) {
          throw new AutomationError(`The webhook wasn't sent: ${error instanceof Error ? error.message : "AppKeep refused the event"}`);
        }
        outcome.events += 1;
        break;
      }
      case "show_confirmation":
      case "open_url":
        // The browser does these before and after it asks the server to run the rest.
        break;
    }
  }
  return outcome;
};

// ---------------------------------------------------------------------------
// Automations: triggers
// ---------------------------------------------------------------------------

const recordRun = async (env: AutomationEnv, workspaceId: string, automationId: string, rowId: string | null, status: AutomationRunStatus, error: string | null) => {
  const now = env.now();
  const cutoff = new Date(now.getTime() - AUTOMATION_RUN_RETENTION_DAYS * 86_400_000).toISOString();
  await env.db.batch([
    env.db
      .prepare(`INSERT INTO automation_runs (id, workspace_id, automation_id, row_id, status, error, started_at) VALUES (?, ?, ?, ?, ?, ?, ?)`)
      .bind(createId("dbr"), workspaceId, automationId, rowId, status, error, now.toISOString()),
    env.db.prepare(`DELETE FROM automation_runs WHERE automation_id = ? AND started_at < ?`).bind(automationId, cutoff),
  ]);
};

const automationActor: AuditActor = { actorType: "agent", actorId: null };

/** Runs one automation for one page (or none), with the rate limit and the run log. */
const runAutomation = async (env: AutomationEnv, automation: DatabaseAutomation, workspaceId: string, database: DatabaseDetail, row: DatabaseRow | null) => {
  const since = new Date(env.now().getTime() - 60_000).toISOString();
  const recent = await env.db
    .prepare(`SELECT COUNT(*) AS total FROM automation_runs WHERE automation_id = ? AND started_at > ? AND status <> 'skipped'`)
    .bind(automation.id, since)
    .first<{ total: number }>();
  if ((recent?.total ?? 0) >= AUTOMATION_RUNS_PER_MINUTE) {
    await recordRun(env, workspaceId, automation.id, row?.id ?? null, "skipped", `Ran ${AUTOMATION_RUNS_PER_MINUTE} times in the last minute, so this run was skipped.`);
    return "skipped" as const;
  }
  const timeZone = automation.trigger.type === "date_reached"
    ? automation.trigger.timezone
    : automation.trigger.type === "recurring" ? automation.trigger.schedule.timezone : "UTC";
  try {
    await runActions(env, {
      workspaceId,
      database,
      row,
      pageId: null,
      actor: automationActor,
      actorLabel: `automation:${automation.id}`,
      authorName: automation.name || "Automation",
      timeZone,
      writeOptions: {},
    }, automation.actions, { id: automation.id, name: automation.name });
    await recordRun(env, workspaceId, automation.id, row?.id ?? null, "success", null);
    return "success" as const;
  } catch (error) {
    const message = error instanceof AutomationError || error instanceof AppError ? error.message : "Something went wrong running this automation.";
    if (!(error instanceof AutomationError || error instanceof AppError)) console.error("Ponder automation failed", error);
    await recordRun(env, workspaceId, automation.id, row?.id ?? null, "error", message);
    return "error" as const;
  }
};

const matchesTo = (value: DatabasePropertyValue | undefined, to: DatabasePropertyValue) => {
  if (Array.isArray(to)) return Array.isArray(value) && to.every((item) => (value as unknown[]).includes(item));
  return JSON.stringify(value ?? null) === JSON.stringify(to);
};

const loadEnabled = async (db: DatabaseAdapter, workspaceId: string, databaseId: string) => {
  const rows = await db
    .prepare(`SELECT ${AUTOMATION_COLUMNS} FROM database_automations WHERE workspace_id = ? AND database_id = ? AND enabled = 1 ORDER BY position ASC`)
    .bind(workspaceId, databaseId)
    .all<AutomationRecord>();
  return rows.results.flatMap((row) => {
    const automation = mapAutomation(row);
    return automation ? [{ automation, record: row }] : [];
  });
};

/** Called after a row is added or edited by a person, an API token, a button or a template's schedule. */
export const handleRowChange = async (env: AutomationEnv, change: RowChange) => {
  const enabled = await loadEnabled(env.db, change.workspaceId, change.databaseId);
  if (enabled.length === 0) return;
  let database: DatabaseDetail | null = null;
  let row: DatabaseRow | null = null;
  let wakeChanged = false;
  for (const { automation, record } of enabled) {
    const trigger = automation.trigger;
    if (trigger.type === "date_reached") {
      // A new or moved date may be sooner than anything scheduled; a later one is found at the next run.
      if (!change.changed.includes(trigger.propertyId)) continue;
      const start = change.after[trigger.propertyId];
      const fire = start && typeof start === "object" && !Array.isArray(start) && "start" in start ? dateFireTime(String(start.start), trigger) : null;
      if (fire && fire > env.now() && (!record.next_run_at || fire.toISOString() < record.next_run_at)) {
        await env.db.prepare(`UPDATE database_automations SET next_run_at = ? WHERE id = ?`).bind(fire.toISOString(), automation.id).run();
        wakeChanged = true;
      }
      continue;
    }
    const fires = trigger.type === "page_added"
      ? change.kind === "added"
      : trigger.type === "property_edited"
        && change.kind === "edited"
        && change.changed.includes(trigger.propertyId)
        && (trigger.to === undefined || matchesTo(trigger.propertyId === "title" ? undefined : change.after[trigger.propertyId], trigger.to));
    if (!fires) continue;
    database ??= await getDatabase(env.db, change.workspaceId, change.databaseId);
    // Each automation sees the row as the last one left it.
    row = await getDatabaseRow(env.db, change.workspaceId, change.databaseId, change.rowId).catch(() => null);
    if (!row) return;
    await runAutomation(env, automation, change.workspaceId, database, row);
    await env.db.prepare(`UPDATE database_automations SET last_run_at = ? WHERE id = ?`).bind(env.now().toISOString(), automation.id).run();
  }
  if (wakeChanged) await refreshWake(env);
};

/** Runs a time-based automation that is due: once for "Every…", or for each row whose date was reached. */
const runDueAutomation = async (env: AutomationEnv, record: AutomationRecord) => {
  const automation = mapAutomation(record);
  const now = env.now();
  const workspaceId = record.workspace_id;
  if (!automation) {
    await env.db.prepare(`UPDATE database_automations SET next_run_at = NULL WHERE id = ?`).bind(record.id).run();
    return;
  }
  const database = await getDatabase(env.db, workspaceId, record.database_id).catch(() => null);
  let runs = record.run_count;
  if (database && automation.trigger.type === "recurring") {
    await runAutomation(env, automation, workspaceId, database, null);
    runs += 1;
  } else if (database && automation.trigger.type === "date_reached") {
    const trigger = automation.trigger;
    // Dates reached since the last check; a new automation only looks forward from when it was made.
    const from = Date.parse(record.last_run_at ?? record.created_at);
    const due = (await datedRows(env.db, workspaceId, record.database_id, trigger.propertyId))
      .filter((row) => {
        const fire = dateFireTime(row.start, trigger)?.getTime();
        return fire !== undefined && fire > from && fire <= now.getTime();
      })
      .slice(0, MAX_DATE_ROWS_PER_RUN);
    for (const item of due) {
      const row = await getDatabaseRow(env.db, workspaceId, record.database_id, item.id).catch(() => null);
      if (row) await runAutomation(env, automation, workspaceId, database, row);
    }
  }
  // A database in the trash keeps its schedule, so it carries on if restored.
  const next = await nextRunFor(env.db, workspaceId, record.database_id, automation.trigger, now, runs);
  await env.db
    .prepare(`UPDATE database_automations SET next_run_at = ?, last_run_at = ?, run_count = ? WHERE id = ?`)
    .bind(next, now.toISOString(), runs, record.id)
    .run();
};

/** Makes the page a repeating template is due to make, then schedules the next one. */
const runDueTemplate = async (env: AutomationEnv, template: Awaited<ReturnType<typeof listDueRepeatingTemplates>>[number]) => {
  const now = env.now();
  if (!template.repeat) {
    await setTemplateRepeatProgress(env.db, template.id, template.runs, null);
    return;
  }
  const changes: RowChange[] = [];
  let runs = template.runs;
  try {
    await createDatabaseRow(
      env.db, template.workspaceId, template.databaseId, { templateId: template.id },
      automationActor, `template:${template.id}`, { onRowChange: (change) => changes.push(change) },
    );
    runs += 1;
  } catch (error) {
    // The database is in the trash, or full: skip this time and try at the next.
    if (!(error instanceof AppError)) console.error("Ponder repeating template failed", error);
  }
  const next = nextScheduleRun(template.repeat, now, runs);
  await setTemplateRepeatProgress(env.db, template.id, runs, next?.toISOString() ?? null);
  // A page made on schedule is a new page like any other, so "Page added" automations run for it.
  for (const change of changes) await handleRowChange(env, change);
};

/** The cron's work: due automations and repeating templates, old runs cleared, then the next wake. */
export const runScheduledAutomations = async (env: AutomationEnv) => {
  const now = env.now().toISOString();
  const [automations, templates] = await Promise.all([
    env.db
      .prepare(`SELECT ${AUTOMATION_COLUMNS} FROM database_automations WHERE enabled = 1 AND next_run_at IS NOT NULL AND next_run_at <= ? ORDER BY next_run_at LIMIT ?`)
      .bind(now, MAX_DUE_PER_TICK)
      .all<AutomationRecord>(),
    listDueRepeatingTemplates(env.db, now, MAX_DUE_PER_TICK),
  ]);
  for (const record of automations.results) await runDueAutomation(env, record);
  for (const template of templates) await runDueTemplate(env, template);
  const cutoff = new Date(env.now().getTime() - AUTOMATION_RUN_RETENTION_DAYS * 86_400_000).toISOString();
  await env.db.prepare(`DELETE FROM automation_runs WHERE started_at < ?`).bind(cutoff).run();
  await refreshWake(env);
  return { automations: automations.results.length, templates: templates.length };
};

// ---------------------------------------------------------------------------
// Buttons
// ---------------------------------------------------------------------------

type ButtonClick = {
  workspaceId: string;
  actions: AutomationAction[];
  database: DatabaseDetail | null;
  row: DatabaseRow | null;
  pageId: string | null;
  actor: AuditActor;
  actorLabel: string;
  authorName: string;
  timeZone: string;
  writeOptions: RowWriteOptions;
};

/** A button click: the same actions, run as the person who clicked. */
export const runButton = async (env: AutomationEnv, click: ButtonClick): Promise<ActionOutcome> => {
  const serverActions = click.actions.filter((action) => !CLIENT_ACTION_TYPES.has(action.type));
  if (serverActions.length === 0) return emptyOutcome();
  // A /button block outside a database borrows an empty database shape: its actions name their own databases.
  const database: DatabaseDetail = click.database ?? {
    id: "", pageMemoId: click.pageId ?? "", notebookId: "", title: null, icon: null,
    schema: { properties: [{ id: "title", name: "Name", type: "title" }] }, views: [], templates: [], updatedAt: "",
  };
  const problem = await checkActions(env.db, click.workspaceId, database, serverActions, { hasPage: Boolean(click.row || click.pageId) });
  if (problem) throw new AppError("invalid_button", problem, 400);
  try {
    return await runActions(env, {
      workspaceId: click.workspaceId,
      database,
      row: click.row,
      pageId: click.pageId,
      actor: click.actor,
      actorLabel: click.actorLabel,
      authorName: click.authorName,
      timeZone: click.timeZone,
      writeOptions: click.writeOptions,
    }, serverActions, null);
  } catch (error) {
    if (error instanceof AutomationError) throw new AppError("button_failed", error.message, 400);
    throw error;
  }
};
