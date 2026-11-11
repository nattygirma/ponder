import { z } from "zod";
import { isValidTimeZone, ScheduleSchema, TIME_OF_DAY, zonedDateKey } from "./automation-schedule";
import { DatabaseRowValueSchema, type DatabasePropertyValue } from "./database";

export * from "./automation-schedule";

/**
 * Database automations, buttons and repeating templates, after Notion's.
 * One action list runs three ways: when a trigger fires, when a button is clicked,
 * and (for templates) on a repeating schedule. The engine lives in the API; this file
 * holds what both sides need: the stored shapes and the schedule maths.
 */

export const AUTOMATION_LIMIT_PER_DATABASE = 50;
export const AUTOMATION_ACTION_LIMIT = 20;
/** Each automation runs at most this many times a minute; more is almost always a loop or a bulk import. */
export const AUTOMATION_RUNS_PER_MINUTE = 100;
/** Run history is kept this long. */
export const AUTOMATION_RUN_RETENTION_DAYS = 30;
/** AppKeep sends at most this many emails a day for each app. */
export const APPKEEP_EMAILS_PER_DAY = 200;
/** Notion's limit for "Send notification to". */
export const AUTOMATION_NOTIFY_LIMIT = 20;

// ---------------------------------------------------------------------------
// Triggers
// ---------------------------------------------------------------------------

const propertyId = z.string().min(1).max(64);

export const AutomationTriggerSchema = z.discriminatedUnion("type", [
  /** Notion's "Page added". Also fires for rows made by a template's schedule. */
  z.object({ type: z.literal("page_added") }),
  /** Notion's "Property edited": any change, or ("is set to") a change to one value. */
  z.object({ type: z.literal("property_edited"), propertyId, to: DatabaseRowValueSchema.optional() }),
  /** A date property is reached: on the day (or some days before or after), at a time. */
  z.object({
    type: z.literal("date_reached"),
    propertyId,
    offsetDays: z.number().int().min(-365).max(365),
    time: z.string().regex(TIME_OF_DAY),
    timezone: z.string().min(1).max(80).refine(isValidTimeZone, "Unknown time zone"),
  }),
  /** Notion's "Every {frequency}". */
  z.object({ type: z.literal("recurring"), schedule: ScheduleSchema }),
]);
export type AutomationTrigger = z.infer<typeof AutomationTriggerSchema>;
export type AutomationTriggerType = AutomationTrigger["type"];
export const AUTOMATION_TRIGGER_TYPES: AutomationTriggerType[] = ["page_added", "property_edited", "date_reached", "recurring"];

// ---------------------------------------------------------------------------
// Actions
// ---------------------------------------------------------------------------

const values = z.record(z.string(), DatabaseRowValueSchema);
const text = (max: number) => z.string().max(max);

export const AutomationActionSchema = z.discriminatedUnion("type", [
  /** "Edit property" on the page that triggered it (or the button's row). */
  z.object({ type: z.literal("edit_property"), values }),
  /** "Add page to" a database, with a title and property values. */
  z.object({ type: z.literal("add_page"), databaseId: z.string().min(1).max(64), title: text(160), values }),
  /** A comment on the triggering page, written as the automation. */
  z.object({ type: z.literal("add_comment"), body: z.string().trim().min(1).max(4000) }),
  /** "Send notification to" people, or to whoever is in a person property. Ponder's own inbox. */
  z.object({
    type: z.literal("send_notification"),
    recipients: z.discriminatedUnion("kind", [
      z.object({ kind: z.literal("people"), userIds: z.array(z.string().min(1).max(64)).max(AUTOMATION_NOTIFY_LIMIT) }),
      z.object({ kind: z.literal("property"), propertyId }),
    ]),
    message: text(2000),
  }),
  /** "Send mail to" addresses, or the people or email in a property. Sent by AppKeep. */
  z.object({
    type: z.literal("send_mail"),
    to: z.discriminatedUnion("kind", [
      z.object({ kind: z.literal("emails"), emails: z.array(z.string().trim().email().max(254)).max(AUTOMATION_NOTIFY_LIMIT) }),
      z.object({ kind: z.literal("property"), propertyId }),
    ]),
    subject: z.string().trim().max(200),
    body: text(10_000),
  }),
  /** "Send webhook": an AppKeep event that reaches the buyer's Slack or Zapier webhooks. */
  z.object({ type: z.literal("send_webhook") }),
  /** Buttons only: ask before the other actions run. Shown in the browser. */
  z.object({ type: z.literal("show_confirmation"), message: text(500) }),
  /** Buttons only: "Open page, form, or URL". Opened in the browser. */
  z.object({ type: z.literal("open_url"), url: z.string().trim().max(2000) }),
]);
export type AutomationAction = z.infer<typeof AutomationActionSchema>;
export type AutomationActionType = AutomationAction["type"];

/** Actions a database automation offers, in Notion's order. */
export const AUTOMATION_ACTION_TYPES: AutomationActionType[] = [
  "edit_property", "add_page", "send_notification", "add_comment", "send_mail", "send_webhook",
];
/** Buttons offer the same, plus the two that only make sense with someone at the screen. */
export const BUTTON_ACTION_TYPES: AutomationActionType[] = [
  "edit_property", "add_page", "send_notification", "show_confirmation", "open_url", "add_comment", "send_mail", "send_webhook",
];
/** Run in the browser, never by the engine. */
export const CLIENT_ACTION_TYPES: ReadonlySet<AutomationActionType> = new Set(["show_confirmation", "open_url"]);

export const AutomationActionsSchema = z.array(AutomationActionSchema).min(1).max(AUTOMATION_ACTION_LIMIT);

/** Only web, mail and Ponder links open from a button; anything else could run script. */
export const safeButtonUrl = (url: string) => {
  const trimmed = url.trim();
  if (/^(https?:|mailto:)/i.test(trimmed)) return trimmed;
  if (/^\/(?!\/)/.test(trimmed)) return trimmed;
  return null;
};

export const ButtonConfigSchema = z.object({ actions: z.array(AutomationActionSchema).max(AUTOMATION_ACTION_LIMIT) });
export type ButtonConfig = z.infer<typeof ButtonConfigSchema>;

// ---------------------------------------------------------------------------
// Stored automations and their run log
// ---------------------------------------------------------------------------

export type DatabaseAutomation = {
  id: string;
  databaseId: string;
  name: string;
  enabled: boolean;
  trigger: AutomationTrigger;
  actions: AutomationAction[];
  createdBy: string | null;
  nextRunAt: string | null;
  lastRunAt: string | null;
  createdAt: string;
  updatedAt: string;
};

export type AutomationRunStatus = "success" | "error" | "skipped";

export type AutomationRun = {
  id: string;
  automationId: string;
  rowId: string | null;
  rowTitle: string | null;
  status: AutomationRunStatus;
  error: string | null;
  startedAt: string;
};

export const AutomationCreateSchema = z.object({
  name: z.string().trim().max(120),
  enabled: z.boolean().optional(),
  trigger: AutomationTriggerSchema,
  actions: AutomationActionsSchema,
});
export const AutomationUpdateSchema = AutomationCreateSchema.partial();

export const ButtonRunSchema = z.object({
  /** The page a /button block sits on, so edits and comments have somewhere to go. */
  pageId: z.string().min(1).max(64).optional(),
  actions: AutomationActionsSchema,
});

/** What a button or automation did, for the "Created 1 page and edited 1 page" toast. */
export type ActionOutcome = { createdPages: number; editedPages: number; notified: number; emailed: number; comments: number; events: number };

export const emptyOutcome = (): ActionOutcome => ({ createdPages: 0, editedPages: 0, notified: 0, emailed: 0, comments: 0, events: 0 });

/** Replaces `{{Property name}}` with the triggering page's values, as text. */
export const fillPlaceholders = (template: string, lookup: (name: string) => string | null) =>
  template.replace(/\{\{\s*([^{}]{1,120}?)\s*\}\}/g, (match, name: string) => lookup(name) ?? match);

/** Date values in actions can say "today" or "now", resolved when the action runs. */
export const resolveDynamicValue = (value: DatabasePropertyValue, now: Date, timeZone: string): DatabasePropertyValue => {
  if (value && typeof value === "object" && !Array.isArray(value) && "start" in value) {
    if (value.start === "@today") return { start: zonedDateKey(now, timeZone) };
    if (value.start === "@now") return { start: now.toISOString() };
  }
  return value;
};
