import {
  DATABASE_FORM_FILE_BYTES,
  DatabaseFormUpdateSchema,
  PublicFormSubmissionSchema,
  PublicShareUnlockSchema,
  resolveResourceUploadMimeType,
  type DatabaseFileValue,
  type PublicDatabaseForm,
} from "@ponder/shared";
import { zValidator } from "@hono/zod-validator";
import type { Hono } from "hono";
import { getCookie, setCookie } from "hono/cookie";
import type { AppContext, AppEnv, AuthContext } from "./api-context";
import { AppError } from "./app-error";
import { authenticateRequest } from "./auth-service";
import { verifyPassword } from "./auth-crypto";
import { rowChangeListener } from "./automation-routes";
import {
  afterFormResponse,
  answeredFileIds,
  buildFormRow,
  FORM_TOKEN_PATTERN,
  formSchema,
  getOrCreateForm,
  loadFormByToken,
  parseFormQuestions,
  publicQuestions,
  reserveFormSubmission,
  updateForm,
  type PublicFormRecord,
} from "./database-form-service";
import { createDatabaseRow } from "./database-service";
import { isoNow } from "./entity-utils";
import { apiError, notFound } from "./http-errors";
import { getActorLabel, getWorkspaceId, requireScopes } from "./request-auth";
import {
  createAttachmentResource,
  createImageResource,
  deleteReleasedResourceObjects,
  SUPPORTED_IMAGE_MIME_TYPES,
} from "./resource-service";
import {
  createShareAccessCookieValue,
  isShareUnlockBlocked,
  isValidShareAccessCookieValue,
  nextShareUnlockFailure,
  SHARE_ACCESS_MAX_AGE_SECONDS,
} from "./share-access";

const FORM_COOKIE = "ee_dbform";
// Uploads not yet sent with a response; stale ones are retired after an hour.
const PENDING_UPLOAD_MS = 60 * 60 * 1000;
const PENDING_UPLOAD_LIMIT = 50;

/** AppKeep's per-visitor limit from the manifest's "ratelimits" (FORM_LIMIT). Other hosts don't have one. */
type RateLimiter = { limit: (options: { key: string }) => Promise<{ success: boolean }> };

const guarded = async (c: AppContext, scope: "read:memos" | "write:memos", handler: () => Promise<Response>) => {
  const denied = requireScopes(c, scope);
  if (denied) return denied;
  try {
    return await handler();
  } catch (error) {
    if (error instanceof AppError) return apiError(c, error.code, error.message, error.status);
    throw error;
  }
};

const publicRoute = async (c: AppContext, handler: () => Promise<Response>) => {
  c.header("Cache-Control", "private, no-store");
  try {
    return await handler();
  } catch (error) {
    if (error instanceof AppError) return apiError(c, error.code, error.message, error.status);
    throw error;
  }
};

const cookiePath = (token: string) => `/api/public/database-forms/${encodeURIComponent(token)}`;

const findForm = async (c: AppContext) => {
  const token = c.req.param("token") ?? "";
  if (!FORM_TOKEN_PATTERN.test(token)) return null;
  return loadFormByToken(c.env.storage.db, token);
};

const signedInMember = async (c: AppContext, form: PublicFormRecord): Promise<AuthContext | null> => {
  const auth = await authenticateRequest(c, false).catch(() => null);
  return auth && auth.kind === "user" && auth.workspaceId === form.workspace_id ? auth : null;
};

type Access = { allowed: true; member: AuthContext | null } | { allowed: false; reason: "closed" | "members" | "password" };

/** Whether this visitor may open and answer the form. Members of the workspace pass a password. */
const formAccess = async (c: AppContext, form: PublicFormRecord): Promise<Access> => {
  if (form.access === "closed") return { allowed: false, reason: "closed" };
  const member = await signedInMember(c, form);
  if (form.access === "workspace" && !member) return { allowed: false, reason: "members" };
  if (form.password_hash && !member && !(await isValidShareAccessCookieValue(getCookie(c, FORM_COOKIE), form.password_hash, form.token))) {
    return { allowed: false, reason: "password" };
  }
  return { allowed: true, member };
};

const deniedResponse = (c: AppContext, reason: "closed" | "members" | "password") => {
  if (reason === "closed") return apiError(c, "form_closed", "This form isn't accepting responses.", 403);
  if (reason === "members") return apiError(c, "form_members_only", "Only members of this workspace can fill out this form. Sign in to continue.", 403);
  return apiError(c, "form_password_required", "Enter the form's password.", 403);
};

const respondentName = (member: AuthContext | null) => (member ? member.displayName || member.username : null);

const visitorKey = (c: AppContext, token: string) =>
  `${token}:${c.req.header("cf-connecting-ip") ?? c.req.header("x-forwarded-for")?.split(",")[0]?.trim() ?? "unknown"}`;

/** AppKeep's FORM_LIMIT: 20 responses or uploads a minute for each visitor on each form. */
const withinVisitorLimit = async (c: AppContext, token: string) => {
  const limiter = (c.env as unknown as { FORM_LIMIT?: RateLimiter }).FORM_LIMIT;
  if (!limiter?.limit) return true;
  const { success } = await limiter.limit({ key: visitorKey(c, token) });
  return success;
};

const pendingUploads = async (c: AppContext, form: PublicFormRecord, ids: string[]) => {
  const uploads = new Map<string, DatabaseFileValue>();
  if (!ids.length) return uploads;
  const rows = await c.env.storage.db
    .prepare(
      `SELECT id, filename, mime_type, byte_size FROM resources
       WHERE memo_id = ? AND is_deleted = 0
         AND json_extract(metadata_json, '$.databaseFormId') = ? AND json_extract(metadata_json, '$.pending') = 1
         AND id IN (${ids.map(() => "?").join(", ")})`
    )
    .bind(form.page_memo_id, form.id, ...ids)
    .all<{ id: string; filename: string | null; mime_type: string | null; byte_size: number }>();
  for (const row of rows.results) {
    uploads.set(row.id, { id: row.id, name: row.filename || "file", mimeType: row.mime_type, size: row.byte_size });
  }
  return uploads;
};

const countPendingUploads = async (c: AppContext, form: PublicFormRecord) => (await c.env.storage.db
  .prepare(
    `SELECT COUNT(*) AS count FROM resources
     WHERE memo_id = ? AND is_deleted = 0
       AND json_extract(metadata_json, '$.databaseFormId') = ? AND json_extract(metadata_json, '$.pending') = 1`
  )
  .bind(form.page_memo_id, form.id)
  .first<{ count: number }>())?.count ?? 0;

const releaseUploads = async (c: AppContext, rows: { id: string; object_key: string; storage_config_id: string }[]) => {
  if (!rows.length) return;
  const now = isoNow();
  await c.env.storage.db.batch(rows.map((row) => c.env.storage.db
    .prepare(`UPDATE resources SET is_deleted = 1, deleted_at = ?, updated_at = ? WHERE id = ? AND is_deleted = 0`)
    .bind(now, now, row.id)));
  await deleteReleasedResourceObjects(c.env, rows.map((row) => ({ objectKey: row.object_key, storageConfigId: row.storage_config_id })));
};

const retireStaleUploads = async (c: AppContext, form: PublicFormRecord) => {
  const cutoff = new Date(Date.now() - PENDING_UPLOAD_MS).toISOString();
  const stale = await c.env.storage.db
    .prepare(
      `SELECT id, object_key, storage_config_id FROM resources
       WHERE memo_id = ? AND is_deleted = 0
         AND json_extract(metadata_json, '$.databaseFormId') = ? AND json_extract(metadata_json, '$.pending') = 1
         AND created_at < ?`
    )
    .bind(form.page_memo_id, form.id, cutoff)
    .all<{ id: string; object_key: string; storage_config_id: string }>();
  await releaseUploads(c, stale.results);
};

export const registerPublicDatabaseFormRoutes = (app: Hono<AppEnv>) => {
  app.get("/api/public/database-forms/:token", (c) => publicRoute(c, async () => {
    const form = await findForm(c);
    if (!form) return notFound(c, "Form not found");
    const access = await formAccess(c, form);
    if (!access.allowed) {
      if (access.reason !== "password") return deniedResponse(c, access.reason);
      const locked: PublicDatabaseForm = {
        passwordRequired: true, title: "", description: "", submitLabel: "", confirmationTitle: "", confirmationMessage: "",
        submitAnother: false, respondent: null, questions: [],
      };
      return c.json({ form: locked });
    }
    const view: PublicDatabaseForm = {
      passwordRequired: false,
      title: form.title.trim() || form.database_title?.trim() || "",
      description: form.description,
      submitLabel: form.submit_label,
      confirmationTitle: form.confirmation_title,
      confirmationMessage: form.confirmation_message,
      submitAnother: form.submit_another === 1,
      respondent: access.member && form.anonymous !== 1 ? { name: respondentName(access.member)! } : null,
      questions: publicQuestions(form, formSchema(form)),
    };
    return c.json({ form: view });
  }));

  app.post("/api/public/database-forms/:token/unlock", zValidator("json", PublicShareUnlockSchema), (c) => publicRoute(c, async () => {
    const form = await findForm(c);
    if (!form?.password_hash || form.access !== "public") return notFound(c, "Form not found");
    const gate = await c.env.storage.db
      .prepare(`SELECT unlock_failed_count, unlock_window_started_at, unlock_blocked_until FROM database_forms WHERE id = ?`)
      .bind(form.id)
      .first<{ unlock_failed_count: number; unlock_window_started_at: string | null; unlock_blocked_until: string | null }>();
    if (gate && isShareUnlockBlocked(gate.unlock_blocked_until)) {
      return apiError(c, "form_rate_limited", "Too many password attempts. Try again later.", 429);
    }
    if (!(await verifyPassword(c.req.valid("json").password, form.password_hash))) {
      const failure = nextShareUnlockFailure({
        unlock_failed_count: gate?.unlock_failed_count ?? 0,
        unlock_window_started_at: gate?.unlock_window_started_at ?? null,
        unlock_blocked_until: gate?.unlock_blocked_until ?? null,
      });
      await c.env.storage.db
        .prepare(`UPDATE database_forms SET unlock_failed_count = ?, unlock_window_started_at = ?, unlock_blocked_until = ? WHERE id = ?`)
        .bind(failure.failureCount, failure.windowStartedAt, failure.blockedUntil, form.id)
        .run();
      return apiError(c, "form_password_invalid", "That password isn't right.", 403);
    }
    await c.env.storage.db
      .prepare(`UPDATE database_forms SET unlock_failed_count = 0, unlock_window_started_at = NULL, unlock_blocked_until = NULL WHERE id = ?`)
      .bind(form.id)
      .run();
    setCookie(c, FORM_COOKIE, await createShareAccessCookieValue(form.password_hash, form.token), {
      httpOnly: true,
      secure: new URL(c.req.url).protocol === "https:",
      sameSite: "Lax",
      path: cookiePath(form.token),
      maxAge: SHARE_ACCESS_MAX_AGE_SECONDS,
    });
    return c.json({ ok: true });
  }));

  app.post("/api/public/database-forms/:token/files", (c) => publicRoute(c, async () => {
    const form = await findForm(c);
    if (!form) return notFound(c, "Form not found");
    const access = await formAccess(c, form);
    if (!access.allowed) return deniedResponse(c, access.reason);
    if (!(await withinVisitorLimit(c, form.token))) return apiError(c, "form_rate_limited", "Too many uploads. Wait a minute and try again.", 429);
    if (!publicQuestions(form, formSchema(form)).some((question) => question.type === "files")) {
      return apiError(c, "form_invalid", "This form doesn't take files.", 400);
    }
    const body = await c.req.raw.formData();
    const file = body.get("file");
    if (!(file instanceof File)) return apiError(c, "form_invalid", "Choose a file to upload.", 400);
    if (file.size <= 0 || file.size > DATABASE_FORM_FILE_BYTES) {
      return apiError(c, "upload_too_large", "Each file can be up to 20 MB.", 413);
    }
    await retireStaleUploads(c, form);
    if (await countPendingUploads(c, form) >= PENDING_UPLOAD_LIMIT) {
      return apiError(c, "form_rate_limited", "Too many uploads. Try again later.", 429);
    }
    const metadata = { databaseFormId: form.id, pending: 1 };
    const input = {
      // Visitors aren't signed in, so the workspace comes from the form. Files wait on the database page
      // until the response is sent, then move to the new row's page.
      workspaceId: form.workspace_id,
      memoId: form.page_memo_id,
      filename: file.name,
      mimeType: resolveResourceUploadMimeType(file.name, file.type),
      bytes: new Uint8Array(await file.arrayBuffer()),
      actor: { actorType: "agent" as const, actorId: null },
      metadata,
    };
    const isImage = SUPPORTED_IMAGE_MIME_TYPES.has(input.mimeType);
    const resource = isImage ? await createImageResource(c, { ...input, source: "upload" }) : await createAttachmentResource(c, input);
    if (isImage) {
      await c.env.storage.db.prepare(`UPDATE resources SET metadata_json = ? WHERE id = ?`).bind(JSON.stringify(metadata), resource.id).run();
    }
    // Concurrent uploads can pass the count above together; count again now this one is stored.
    if (await countPendingUploads(c, form) > PENDING_UPLOAD_LIMIT) {
      const stored = await c.env.storage.db
        .prepare(`SELECT id, object_key, storage_config_id FROM resources WHERE id = ?`)
        .bind(resource.id)
        .first<{ id: string; object_key: string; storage_config_id: string }>();
      if (stored) await releaseUploads(c, [stored]);
      return apiError(c, "form_rate_limited", "Too many uploads. Try again later.", 429);
    }
    return c.json({ file: { id: resource.id, name: resource.filename || file.name, mimeType: resource.mimeType, size: resource.byteSize } }, 201);
  }));

  app.post("/api/public/database-forms/:token/responses", zValidator("json", PublicFormSubmissionSchema), (c) => publicRoute(c, async () => {
    const form = await findForm(c);
    if (!form) return notFound(c, "Form not found");
    const access = await formAccess(c, form);
    if (!access.allowed) return deniedResponse(c, access.reason);
    if (!(await withinVisitorLimit(c, form.token))) {
      return apiError(c, "form_rate_limited", "You've sent a lot of responses. Wait a minute and try again.", 429);
    }
    const { answers, website } = c.req.valid("json");
    // The honeypot: people never see this field, so whatever filled it in is a bot. It's told all went well.
    if (website) return c.json({ ok: true }, 201);
    await reserveFormSubmission(c.env.storage.db, form);
    await retireStaleUploads(c, form);
    const schema = formSchema(form);
    const uploads = await pendingUploads(c, form, answeredFileIds(answers));
    const built = buildFormRow(schema, parseFormQuestions(form.fields_json), answers, uploads);
    const member = access.member && form.anonymous !== 1 ? access.member : null;
    const actorLabel = member?.actorId ? `user:${member.actorId}` : `form:${form.id}`;
    // The same path as a row added in the app, so "Page added" automations run for responses too.
    const row = await createDatabaseRow(
      c.env.storage.db,
      form.workspace_id,
      form.database_id,
      { title: built.title, properties: built.properties },
      { actorType: member ? "user" : "agent", actorId: member?.actorId ?? null },
      actorLabel,
      rowChangeListener(c),
    );
    if (built.fileIds.length) {
      const now = isoNow();
      await c.env.storage.db.batch(built.fileIds.map((id) => c.env.storage.db
        .prepare(
          `UPDATE resources SET memo_id = ?, metadata_json = json_set(metadata_json, '$.pending', 0), updated_at = ?
           WHERE id = ? AND memo_id = ? AND json_extract(metadata_json, '$.databaseFormId') = ?`
        )
        .bind(row.id, now, id, form.page_memo_id, form.id)));
    }
    await afterFormResponse(c.env.storage.db, form, row.id, respondentName(member), row.title);
    return c.json({ ok: true }, 201);
  }));
};

export const registerDatabaseFormRoutes = (app: Hono<AppEnv>) => {
  app.get("/api/v1/databases/:id/forms/:viewId", (c) =>
    guarded(c, "read:memos", async () => c.json({
      form: await getOrCreateForm(c.env.storage.db, getWorkspaceId(c), c.req.param("id"), c.req.param("viewId"), getActorLabel(c)),
    })));

  app.patch("/api/v1/databases/:id/forms/:viewId", zValidator("json", DatabaseFormUpdateSchema), (c) =>
    guarded(c, "write:memos", async () => c.json({
      form: await updateForm(c.env.storage.db, getWorkspaceId(c), c.req.param("id"), c.req.param("viewId"), c.req.valid("json"), getActorLabel(c)),
    })));
};
