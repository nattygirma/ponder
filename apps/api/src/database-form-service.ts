import {
  activeFormQuestions,
  DATABASE_FORM_FILES_PER_QUESTION,
  DatabaseFormQuestionSchema,
  DatabaseSchemaSchema,
  defaultFormQuestions,
  formQuestionLabel,
  toPublicFormQuestions,
  userIdFromActorLabel,
  type DatabaseFileValue,
  type DatabaseForm,
  type DatabaseFormAccess,
  type DatabaseFormQuestion,
  type DatabaseFormUpdate,
  type DatabasePropertyValue,
  type DatabaseSchema,
  type PublicFormQuestion,
} from "@ponder/shared";
import { AppError } from "./app-error";
import { hashPassword, randomToken } from "./auth-crypto";
import { createId, isoNow } from "./entity-utils";
import { generateSharePassword } from "./share-password";
import type { DatabaseAdapter } from "./storage-contract";

const FORM_TOKEN_BYTES = 32;
export const FORM_TOKEN_PATTERN = /^[A-Za-z0-9_-]{43}$/;
/** A whole form takes at most this many responses in ten minutes, on top of AppKeep's per-visitor limit. */
export const FORM_SUBMIT_LIMIT = 300;
export const FORM_SUBMIT_WINDOW_MS = 10 * 60 * 1000;

const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;
const URL_PATTERN = /^https?:\/\/[^\s]+$/i;
const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const PHONE_PATTERN = /^[0-9+().\-\s]{3,40}$/;

export type FormRecord = {
  id: string;
  workspace_id: string;
  database_id: string;
  view_id: string;
  token: string;
  access: DatabaseFormAccess;
  anonymous: number;
  title: string;
  description: string;
  submit_label: string;
  confirmation_title: string;
  confirmation_message: string;
  submit_another: number;
  notify: number;
  fields_json: string;
  password_hash: string | null;
  submit_count: number;
  submit_window_started_at: string | null;
  response_count: number;
  created_by: string | null;
};

const FORM_COLUMNS = `f.id, f.workspace_id, f.database_id, f.view_id, f.token, f.access, f.anonymous, f.title, f.description,
  f.submit_label, f.confirmation_title, f.confirmation_message, f.submit_another, f.notify, f.fields_json, f.password_hash,
  f.submit_count, f.submit_window_started_at, f.response_count, f.created_by`;

export const parseFormQuestions = (json: string): DatabaseFormQuestion[] => {
  try {
    const parsed = JSON.parse(json) as unknown;
    if (!Array.isArray(parsed)) return [];
    return parsed.flatMap((item) => {
      const question = DatabaseFormQuestionSchema.safeParse(item);
      return question.success ? [question.data] : [];
    });
  } catch {
    return [];
  }
};

export const mapForm = (row: FormRecord, password?: string): DatabaseForm => ({
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
  questions: parseFormQuestions(row.fields_json),
  passwordProtected: Boolean(row.password_hash),
  ...(password ? { password } : {}),
  responseCount: row.response_count,
});

const parseSchema = (json: string): DatabaseSchema => {
  const parsed = DatabaseSchemaSchema.safeParse(JSON.parse(json));
  if (!parsed.success) throw new AppError("invalid_database", "This database's schema is damaged.", 500);
  return parsed.data;
};

const loadSchema = async (db: DatabaseAdapter, workspaceId: string, databaseId: string) => {
  const row = await db
    .prepare(
      `SELECT d.schema_json FROM databases d INNER JOIN memos m ON m.id = d.page_memo_id
       WHERE d.workspace_id = ? AND d.id = ? AND m.is_deleted = 0`
    )
    .bind(workspaceId, databaseId)
    .first<{ schema_json: string }>();
  if (!row) throw new AppError("not_found", "Database not found", 404);
  return parseSchema(row.schema_json);
};

const selectOwnerForm = (db: DatabaseAdapter, workspaceId: string, databaseId: string, viewId: string) =>
  db
    .prepare(`SELECT ${FORM_COLUMNS} FROM database_forms f WHERE f.workspace_id = ? AND f.database_id = ? AND f.view_id = ?`)
    .bind(workspaceId, databaseId, viewId)
    .first<FormRecord>();

/** The form behind a form view, made on first open with the title as its first question. */
export const getOrCreateForm = async (
  db: DatabaseAdapter,
  workspaceId: string,
  databaseId: string,
  viewId: string,
  actorLabel: string,
): Promise<DatabaseForm> => {
  const existing = await selectOwnerForm(db, workspaceId, databaseId, viewId);
  if (existing) return mapForm(existing);
  const view = await db
    .prepare(`SELECT type FROM database_views WHERE id = ? AND database_id = ? AND workspace_id = ?`)
    .bind(viewId, databaseId, workspaceId)
    .first<{ type: string }>();
  if (!view || view.type !== "form") throw new AppError("not_found", "Form not found", 404);
  const schema = await loadSchema(db, workspaceId, databaseId);
  const now = isoNow();
  // Two tabs opening a new form at once both try; the unique view id keeps one.
  await db
    .prepare(
      `INSERT OR IGNORE INTO database_forms (id, workspace_id, database_id, view_id, token, fields_json, created_by, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
    )
    .bind(createId("dbf"), workspaceId, databaseId, viewId, randomToken(FORM_TOKEN_BYTES), JSON.stringify(defaultFormQuestions(schema.properties)), actorLabel, now, now)
    .run();
  const created = await selectOwnerForm(db, workspaceId, databaseId, viewId);
  if (!created) throw new AppError("not_found", "Form not found", 404);
  return mapForm(created);
};

export const updateForm = async (
  db: DatabaseAdapter,
  workspaceId: string,
  databaseId: string,
  viewId: string,
  input: DatabaseFormUpdate,
  actorLabel: string,
): Promise<DatabaseForm> => {
  await getOrCreateForm(db, workspaceId, databaseId, viewId, actorLabel);
  const current = (await selectOwnerForm(db, workspaceId, databaseId, viewId))!;
  let questions = parseFormQuestions(current.fields_json);
  if (input.questions) {
    const schema = await loadSchema(db, workspaceId, databaseId);
    // Questions about properties that are gone, or that can't be answered, are dropped.
    questions = activeFormQuestions(input.questions, schema.properties).map((item) => item.question);
  }
  const passwordOn = input.passwordProtected ?? Boolean(current.password_hash);
  const newPassword = passwordOn && (input.rotatePassword === true || !current.password_hash) ? generateSharePassword() : undefined;
  const passwordHash = !passwordOn ? null : newPassword ? await hashPassword(newPassword) : current.password_hash;
  const flag = (value: boolean | undefined, fallback: number) => (value === undefined ? fallback : value ? 1 : 0);
  await db
    .prepare(
      `UPDATE database_forms
       SET title = ?, description = ?, access = ?, anonymous = ?, submit_label = ?, confirmation_title = ?, confirmation_message = ?,
           submit_another = ?, notify = ?, fields_json = ?, password_hash = ?, updated_at = ?,
           unlock_failed_count = CASE WHEN ? IS NULL THEN 0 ELSE unlock_failed_count END
       WHERE id = ?`
    )
    .bind(
      input.title ?? current.title,
      input.description ?? current.description,
      input.access ?? current.access,
      flag(input.anonymous, current.anonymous),
      input.submitLabel ?? current.submit_label,
      input.confirmationTitle ?? current.confirmation_title,
      input.confirmationMessage ?? current.confirmation_message,
      flag(input.submitAnother, current.submit_another),
      flag(input.notify, current.notify),
      JSON.stringify(questions),
      passwordHash,
      isoNow(),
      passwordHash,
      current.id,
    )
    .run();
  return mapForm((await selectOwnerForm(db, workspaceId, databaseId, viewId))!, newPassword);
};

export type PublicFormRecord = FormRecord & { page_memo_id: string; schema_json: string; database_title: string | null };

/** A form by its link, while its view, database and database page exist. Closed forms are returned too, for a clear message. */
export const loadFormByToken = (db: DatabaseAdapter, token: string) =>
  db
    .prepare(
      `SELECT ${FORM_COLUMNS}, d.page_memo_id, d.schema_json, m.title AS database_title
       FROM database_forms f
       INNER JOIN databases d ON d.id = f.database_id AND d.workspace_id = f.workspace_id
       INNER JOIN memos m ON m.id = d.page_memo_id AND m.is_deleted = 0
       INNER JOIN database_views v ON v.id = f.view_id AND v.workspace_id = f.workspace_id AND v.type = 'form'
       WHERE f.token = ?`
    )
    .bind(token)
    .first<PublicFormRecord>();

export const formSchema = (form: PublicFormRecord) => parseSchema(form.schema_json);

export const publicQuestions = (form: FormRecord, schema: DatabaseSchema): PublicFormQuestion[] =>
  toPublicFormQuestions(parseFormQuestions(form.fields_json), schema.properties);

const invalid = (label: string, message: string) => new AppError("form_invalid", `${label}: ${message}`, 400);

const fileIdsIn = (value: unknown): string[] => {
  if (!Array.isArray(value)) return [];
  return value.flatMap((item) => {
    if (typeof item === "string") return [item];
    if (item && typeof item === "object" && typeof (item as { id?: unknown }).id === "string") return [(item as { id: string }).id];
    return [];
  });
};

/** Every file id the answers mention, so the route can look up the uploads in one query. */
export const answeredFileIds = (answers: Record<string, unknown>) => Object.values(answers).flatMap(fileIdsIn);

const isEmpty = (value: DatabasePropertyValue | undefined) =>
  value === undefined || value === null || value === "" || value === false || (Array.isArray(value) && value.length === 0);

/**
 * Turns a visitor's answers into a row's title and property values, checking each against its question.
 * Only questions on the form are read; anything else in the answers is ignored.
 */
export const buildFormRow = (
  schema: DatabaseSchema,
  questions: DatabaseFormQuestion[],
  answers: Record<string, unknown>,
  uploads: Map<string, DatabaseFileValue>,
): { title: string | undefined; properties: Record<string, DatabasePropertyValue>; fileIds: string[] } => {
  const properties: Record<string, DatabasePropertyValue> = {};
  const fileIds: string[] = [];
  let title: string | undefined;
  for (const { question, property } of activeFormQuestions(questions, schema.properties)) {
    const label = formQuestionLabel(question, property) || property.name;
    const raw = answers[property.id];
    const text = typeof raw === "string" ? raw.trim() : typeof raw === "number" ? String(raw) : "";
    let value: DatabasePropertyValue = null;
    switch (property.type) {
      case "title":
        value = text.slice(0, 160);
        break;
      case "text":
        value = text.slice(0, 20000);
        break;
      case "url":
        if (text && !URL_PATTERN.test(text)) throw invalid(label, "enter a link that starts with http:// or https://.");
        value = text.slice(0, 2000);
        break;
      case "email":
        if (text && !EMAIL_PATTERN.test(text)) throw invalid(label, "enter an email address.");
        value = text.slice(0, 320);
        break;
      case "phone":
        if (text && !PHONE_PATTERN.test(text)) throw invalid(label, "enter a phone number.");
        value = text;
        break;
      case "number": {
        if (raw === null || raw === undefined || text === "") break;
        const number = Number(text);
        if (!Number.isFinite(number)) throw invalid(label, "enter a number.");
        value = number;
        break;
      }
      case "date":
        if (text && (!DATE_PATTERN.test(text) || Number.isNaN(Date.parse(`${text}T00:00:00Z`)))) throw invalid(label, "enter a date.");
        value = text ? { start: text } : null;
        break;
      case "checkbox":
        value = raw === true || raw === "true";
        break;
      case "select":
      case "status": {
        if (!text) break;
        const option = property.options?.find((item) => item.id === text) ?? property.options?.find((item) => item.name === text);
        if (!option) throw invalid(label, "choose one of the listed options.");
        value = option.id;
        break;
      }
      case "multi_select": {
        const picked = Array.isArray(raw) ? raw : raw ? [raw] : [];
        const ids: string[] = [];
        for (const item of picked) {
          const key = typeof item === "string" ? item : "";
          const option = property.options?.find((entry) => entry.id === key) ?? property.options?.find((entry) => entry.name === key);
          if (!option) throw invalid(label, "choose from the listed options.");
          if (!ids.includes(option.id)) ids.push(option.id);
        }
        value = ids;
        break;
      }
      case "files": {
        const files: DatabaseFileValue[] = [];
        for (const id of fileIdsIn(raw)) {
          const file = uploads.get(id);
          if (!file) throw invalid(label, "upload the file again.");
          if (files.some((item) => item.id === id)) continue;
          files.push(file);
          fileIds.push(id);
          if (files.length >= DATABASE_FORM_FILES_PER_QUESTION) break;
        }
        value = files;
        break;
      }
      default:
        continue;
    }
    if (question.required && isEmpty(value)) {
      throw new AppError("form_required", `${label}: this question is required.`, 400);
    }
    if (property.type === "title") title = (value as string) || undefined;
    else if (!isEmpty(value) || property.type === "checkbox") properties[property.id] = value;
  }
  return { title, properties, fileIds };
};

/**
 * Counts a response against the whole form's window. The update is conditional, so two responses
 * racing for the last place can't both take it.
 */
export const reserveFormSubmission = async (db: DatabaseAdapter, form: FormRecord, nowMs = Date.now()) => {
  const windowStart = Date.parse(form.submit_window_started_at ?? "");
  const inWindow = Number.isFinite(windowStart) && nowMs - windowStart < FORM_SUBMIT_WINDOW_MS;
  if (inWindow && form.submit_count >= FORM_SUBMIT_LIMIT) {
    throw new AppError("form_rate_limited", "This form is getting too many responses. Try again in a few minutes.", 429);
  }
  const result = inWindow
    ? await db
      .prepare(`UPDATE database_forms SET submit_count = submit_count + 1 WHERE id = ? AND submit_count < ? AND submit_window_started_at = ?`)
      .bind(form.id, FORM_SUBMIT_LIMIT, form.submit_window_started_at)
      .run()
    : await db
      .prepare(`UPDATE database_forms SET submit_count = 1, submit_window_started_at = ? WHERE id = ?`)
      .bind(new Date(nowMs).toISOString(), form.id)
      .run();
  if (Number(result.meta?.changes ?? 1) === 0) {
    throw new AppError("form_rate_limited", "This form is getting too many responses. Try again in a few minutes.", 429);
  }
};

/** Counts the response and tells the form's maker, when they asked to hear about responses. */
export const afterFormResponse = async (
  db: DatabaseAdapter,
  form: PublicFormRecord,
  rowId: string,
  respondentName: string | null,
  rowTitle: string | null,
) => {
  const statements = [
    db.prepare(`UPDATE database_forms SET response_count = response_count + 1 WHERE id = ?`).bind(form.id),
  ];
  const owner = userIdFromActorLabel(form.created_by);
  if (form.notify === 1 && owner) {
    const formTitle = form.title.trim() || form.database_title?.trim() || "Form";
    statements.push(
      db.prepare(
        `INSERT INTO notifications (id, workspace_id, recipient_id, kind, memo_id, comment_id, actor_name, excerpt, created_at)
         VALUES (?, ?, ?, 'form', ?, NULL, ?, ?, ?)`
      ).bind(createId("ntf"), form.workspace_id, owner, rowId, respondentName ?? "Someone", `${formTitle}${rowTitle ? `: ${rowTitle}` : ""}`.slice(0, 160), isoNow()),
    );
  }
  await db.batch(statements);
};
