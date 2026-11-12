import { z } from "zod";
import type { DatabaseOptionColor, DatabaseProperty, DatabasePropertyType } from "./database";

/**
 * Forms that fill a database, like Notion's Form view. A form is a database view of type "form";
 * each question is linked to one of the database's properties, and an answer becomes a row.
 */

/** Who can open the form's link: signed-in members, anyone (public), or nobody (closed). Notion's "Who can fill out". */
export const DATABASE_FORM_ACCESS = ["workspace", "public", "closed"] as const;
export type DatabaseFormAccess = (typeof DATABASE_FORM_ACCESS)[number];

export const DATABASE_FORM_QUESTION_LIMIT = 100;
/** Each uploaded file, as for the older table forms. */
export const DATABASE_FORM_FILE_BYTES = 20 * 1024 * 1024;
export const DATABASE_FORM_FILES_PER_QUESTION = 10;

/** Property types a question can fill. Computed ones, relations and people can't be answered by a visitor. */
export const FORM_QUESTION_TYPES = [
  "title", "text", "number", "select", "multi_select", "status", "date", "checkbox", "url", "email", "phone", "files",
] as const satisfies readonly DatabasePropertyType[];
export type FormQuestionType = (typeof FORM_QUESTION_TYPES)[number];

/** What "+ Add question" offers, in Notion's order. Each makes a new property of that type. */
export const FORM_NEW_QUESTION_TYPES = [
  "text", "multi_select", "select", "date", "files", "number", "checkbox", "email", "url", "phone",
] as const satisfies readonly FormQuestionType[];

export const isFormQuestionType = (type: DatabasePropertyType): type is FormQuestionType =>
  (FORM_QUESTION_TYPES as readonly string[]).includes(type);

export const DatabaseFormQuestionSchema = z.object({
  propertyId: z.string().min(1).max(64),
  /** The question as asked. Empty, or with syncName on, it is the property's name. */
  label: z.string().trim().max(200).optional(),
  /** Notion's "Sync with property name": the question title follows the property's name. On by default. */
  syncName: z.boolean().optional(),
  description: z.string().max(1000).optional(),
  required: z.boolean().optional(),
  /** Text questions: a multi-line answer box. */
  longAnswer: z.boolean().optional(),
});
export type DatabaseFormQuestion = z.infer<typeof DatabaseFormQuestionSchema>;

export const DatabaseFormUpdateSchema = z.object({
  title: z.string().max(200),
  description: z.string().max(2000),
  access: z.enum(DATABASE_FORM_ACCESS),
  anonymous: z.boolean(),
  submitLabel: z.string().trim().max(60),
  confirmationTitle: z.string().trim().max(200),
  confirmationMessage: z.string().max(2000),
  submitAnother: z.boolean(),
  notify: z.boolean(),
  questions: z.array(DatabaseFormQuestionSchema).max(DATABASE_FORM_QUESTION_LIMIT),
  passwordProtected: z.boolean(),
  /** With passwordProtected, makes a new password and returns it once. */
  rotatePassword: z.boolean(),
}).partial();
export type DatabaseFormUpdate = z.infer<typeof DatabaseFormUpdateSchema>;

/** A form as its owners edit it. */
export type DatabaseForm = {
  id: string;
  databaseId: string;
  viewId: string;
  token: string;
  access: DatabaseFormAccess;
  anonymous: boolean;
  title: string;
  description: string;
  submitLabel: string;
  confirmationTitle: string;
  confirmationMessage: string;
  submitAnother: boolean;
  notify: boolean;
  questions: DatabaseFormQuestion[];
  passwordProtected: boolean;
  /** Only in the response that made a new password. */
  password?: string;
  responseCount: number;
};

export type PublicFormQuestion = {
  /** The property the answer goes to. */
  id: string;
  label: string;
  description: string;
  required: boolean;
  type: FormQuestionType;
  longAnswer: boolean;
  options?: { id: string; name: string; color: DatabaseOptionColor }[];
};

/** A form as a visitor sees it. */
export type PublicDatabaseForm = {
  passwordRequired: boolean;
  title: string;
  description: string;
  submitLabel: string;
  confirmationTitle: string;
  confirmationMessage: string;
  submitAnother: boolean;
  /** The signed-in member a non-anonymous response is recorded as, shown as "Submitting response as". */
  respondent: { name: string } | null;
  questions: PublicFormQuestion[];
};

export const PublicFormSubmissionSchema = z.object({
  answers: z.record(z.string().max(64), z.unknown()),
  /** Hidden from people; a bot that fills it in gets a success reply and nothing is saved. */
  website: z.string().max(500).optional(),
});

/** The question's title: its own label, or the property's name when synced. */
export const formQuestionLabel = (question: DatabaseFormQuestion, property: Pick<DatabaseProperty, "name"> | undefined) =>
  (question.syncName === false && question.label ? question.label : property?.name ?? question.label ?? "");

/** Questions whose property still exists and can be answered, each once, in order. */
export const activeFormQuestions = (
  questions: DatabaseFormQuestion[],
  properties: DatabaseProperty[],
): { question: DatabaseFormQuestion; property: DatabaseProperty }[] => {
  const byId = new Map(properties.map((property) => [property.id, property]));
  const seen = new Set<string>();
  return questions.flatMap((question) => {
    const property = byId.get(question.propertyId);
    if (!property || !isFormQuestionType(property.type) || seen.has(property.id)) return [];
    seen.add(property.id);
    return [{ question, property }];
  });
};

/** A new form starts with the title as its first question, as Notion's does. */
export const defaultFormQuestions = (properties: DatabaseProperty[]): DatabaseFormQuestion[] => {
  const title = properties.find((property) => property.type === "title");
  return title ? [{ propertyId: title.id, syncName: true, required: false }] : [];
};

/** The questions as a visitor sees them. The server sends these; the builder's preview makes them itself. */
export const toPublicFormQuestions = (questions: DatabaseFormQuestion[], properties: DatabaseProperty[]): PublicFormQuestion[] =>
  activeFormQuestions(questions, properties).map(({ question, property }) => {
    const type = property.type as FormQuestionType;
    return {
      id: property.id,
      label: formQuestionLabel(question, property),
      description: question.description ?? "",
      required: question.required === true,
      type,
      longAnswer: question.longAnswer === true && (type === "text" || type === "title"),
      ...(type === "select" || type === "multi_select" || type === "status"
        ? { options: (property.options ?? []).map((option) => ({ id: option.id, name: option.name, color: option.color })) }
        : {}),
    };
  });
