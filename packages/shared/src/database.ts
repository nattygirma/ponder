import { z } from "zod";

/** Notion-style databases: each row is a real page (a memo) with typed properties. */
export const DATABASE_ROW_LIMIT = 5000;
export const DATABASE_PROPERTY_LIMIT = 100;

export const DATABASE_PROPERTY_TYPES = [
  "title",
  "text",
  "number",
  "select",
  "multi_select",
  "status",
  "date",
  "checkbox",
  "url",
  "email",
  "phone",
  "person",
  "relation",
  "rollup",
  "formula",
  "files",
  "created_time",
  "created_by",
  "last_edited_time",
  "last_edited_by",
  "unique_id",
] as const;
export type DatabasePropertyType = (typeof DATABASE_PROPERTY_TYPES)[number];

export const DATABASE_VIEW_TYPES = ["table", "board", "calendar", "gallery", "list", "timeline"] as const;
export type DatabaseViewType = (typeof DATABASE_VIEW_TYPES)[number];

export const DATABASE_OPTION_COLORS = ["gray", "brown", "orange", "yellow", "green", "blue", "purple", "pink", "red"] as const;
export type DatabaseOptionColor = (typeof DATABASE_OPTION_COLORS)[number];

export const ROLLUP_FUNCTIONS = [
  "show_original", "count", "count_values", "sum", "average", "min", "max", "percent_checked", "earliest", "latest",
] as const;
export type RollupFunction = (typeof ROLLUP_FUNCTIONS)[number];

export const FILTER_OPERATORS = [
  "contains", "not_contains", "is", "is_not", "starts_with", "ends_with", "is_empty", "is_not_empty",
  "gt", "gte", "lt", "lte", "before", "after", "on_or_before", "on_or_after", "checked", "unchecked",
] as const;
export type FilterOperator = (typeof FILTER_OPERATORS)[number];

const optionSchema = z.object({
  id: z.string().min(1).max(64),
  name: z.string().trim().min(1).max(120),
  color: z.enum(DATABASE_OPTION_COLORS),
  /** Status options only: which of the three status groups the option belongs to. */
  group: z.enum(["todo", "in_progress", "done"]).optional(),
});
export type DatabaseOption = z.infer<typeof optionSchema>;

export const DatabasePropertySchema = z.object({
  id: z.string().min(1).max(64),
  name: z.string().trim().min(1).max(120),
  type: z.enum(DATABASE_PROPERTY_TYPES),
  options: z.array(optionSchema).max(500).optional(),
  numberFormat: z.enum(["number", "percent", "dollar", "euro", "pound", "yen"]).optional(),
  relation: z.object({
    databaseId: z.string().min(1).max(64),
    /** The matching property on the other database, when the relation is two-way. */
    syncedPropertyId: z.string().min(1).max(64).nullable().optional(),
  }).optional(),
  rollup: z.object({
    relationPropertyId: z.string().min(1).max(64),
    targetPropertyId: z.string().min(1).max(64),
    function: z.enum(ROLLUP_FUNCTIONS),
  }).optional(),
  formula: z.object({ expression: z.string().max(4000) }).optional(),
  /** ID properties: an optional prefix shown before each row's number, like "TASK-12". */
  uniqueId: z.object({ prefix: z.string().trim().max(12).regex(/^[A-Za-z0-9_-]*$/) }).optional(),
});
export type DatabaseProperty = z.infer<typeof DatabasePropertySchema>;

/** Property types whose values are worked out, never stored or edited. */
export const COMPUTED_PROPERTY_TYPES: ReadonlySet<DatabasePropertyType> = new Set([
  "title", "rollup", "formula", "created_time", "created_by", "last_edited_time", "last_edited_by", "unique_id",
]);

const relationPairSchema = <A extends string, B extends string>(first: A, second: B) =>
  z.object({ [first]: z.string().min(1).max(64), [second]: z.string().min(1).max(64) } as Record<A | B, z.ZodString>);

export const DatabaseSchemaSchema = z.object({
  properties: z.array(DatabasePropertySchema).min(1).max(DATABASE_PROPERTY_LIMIT),
  /** Sub-items: rows nest under the row named in the parent relation. Both relations point at this database. */
  subItems: relationPairSchema("parentPropertyId", "childPropertyId").optional(),
  /** Dependencies: "Blocked by" and "Blocking", drawn as arrows on the timeline. Both point at this database. */
  dependencies: relationPairSchema("blockedByPropertyId", "blockingPropertyId").optional(),
}).superRefine((schema, context) => {
  if (schema.properties.filter((property) => property.type === "title").length !== 1) {
    context.addIssue({ code: "custom", message: "A database needs exactly one title property." });
  }
  if (new Set(schema.properties.map((property) => property.id)).size !== schema.properties.length) {
    context.addIssue({ code: "custom", message: "Property ids must be unique." });
  }
  const isRelation = (id: string) => schema.properties.some((property) => property.id === id && property.type === "relation");
  const pairs: [string, Record<string, string> | undefined][] = [["Sub-items", schema.subItems], ["Dependencies", schema.dependencies]];
  for (const [label, pair] of pairs) {
    if (!pair) continue;
    const ids = Object.values(pair);
    if (ids[0] === ids[1] || !ids.every(isRelation)) {
      context.addIssue({ code: "custom", message: `${label} need two different relation properties.` });
    }
  }
});
export type DatabaseSchema = z.infer<typeof DatabaseSchemaSchema>;

export const DatabaseFilterSchema = z.object({
  propertyId: z.string().min(1).max(64),
  operator: z.enum(FILTER_OPERATORS),
  value: z.union([z.string().max(2000), z.number(), z.boolean(), z.null()]).optional(),
});
export type DatabaseFilter = z.infer<typeof DatabaseFilterSchema>;

export const DatabaseSortSchema = z.object({
  propertyId: z.string().min(1).max(64),
  direction: z.enum(["asc", "desc"]),
});
export type DatabaseSort = z.infer<typeof DatabaseSortSchema>;

export const DatabaseViewConfigSchema = z.object({
  filterMode: z.enum(["and", "or"]).optional(),
  filters: z.array(DatabaseFilterSchema).max(50).optional(),
  sorts: z.array(DatabaseSortSchema).max(20).optional(),
  /** Visible properties, in display order. The title is always shown. */
  visiblePropertyIds: z.array(z.string().max(64)).max(DATABASE_PROPERTY_LIMIT).optional(),
  /** Board column / table grouping property. */
  groupByPropertyId: z.string().max(64).nullable().optional(),
  /** Calendar date, or timeline start. */
  datePropertyId: z.string().max(64).nullable().optional(),
  columnWidths: z.record(z.string(), z.number().min(40).max(2000)).optional(),
});
export type DatabaseViewConfig = z.infer<typeof DatabaseViewConfigSchema>;

export type DatabaseView = {
  id: string;
  databaseId: string;
  name: string;
  type: DatabaseViewType;
  config: DatabaseViewConfig;
  position: number;
};

export type DatabaseDetail = {
  id: string;
  pageMemoId: string;
  notebookId: string;
  title: string | null;
  icon: string | null;
  schema: DatabaseSchema;
  views: DatabaseView[];
  templates: DatabaseTemplate[];
  updatedAt: string;
};

export type DatabaseDateValue = { start: string; end?: string | null };

/** A file in a "Files & media" property: an attachment of the row's page. */
export type DatabaseFileValue = { id: string; name: string; mimeType?: string | null; size?: number | null };

/** Stored values, keyed by property id. Computed properties are never stored. */
export type DatabasePropertyValue =
  | string
  | number
  | boolean
  | string[]
  | DatabaseFileValue[]
  | DatabaseDateValue
  | null;

/**
 * Drops sub-item and dependency settings whose relations were deleted or changed type,
 * so editing properties never leaves a schema the server rejects.
 */
export const withValidRelationPairs = (schema: DatabaseSchema): DatabaseSchema => {
  const isRelation = (id: string) => schema.properties.some((property) => property.id === id && property.type === "relation");
  const keep = <T extends Record<string, string>>(pair: T | undefined) =>
    pair && Object.values(pair).every(isRelation) ? pair : undefined;
  const { subItems, dependencies, ...rest } = schema;
  const nextSubItems = keep(subItems);
  const nextDependencies = keep(dependencies);
  return {
    ...rest,
    ...(nextSubItems ? { subItems: nextSubItems } : {}),
    ...(nextDependencies ? { dependencies: nextDependencies } : {}),
  };
};

/** Who made or last changed something, from the "user:<id>" label Ponder records on each write. */
export const userIdFromActorLabel = (label: string | null | undefined): string | null => {
  const match = /^user:(.+)$/.exec(label ?? "");
  return match ? match[1]! : null;
};

export type DatabaseRow = {
  id: string;
  title: string | null;
  icon: string | null;
  cover: string | null;
  excerpt: string;
  properties: Record<string, DatabasePropertyValue>;
  position: number;
  /** The row's number in its database, for ID properties. Null only for rows made before numbering. */
  number: number | null;
  /** User ids, when a person (not an API token or import) made or last changed the row. */
  createdBy: string | null;
  updatedBy: string | null;
  createdAt: string;
  updatedAt: string;
};

export const DatabaseCreateSchema = z.object({
  notebookId: z.string().trim().min(1).optional(),
  parentId: z.string().trim().min(1).nullable().optional(),
  title: z.string().trim().max(160).optional(),
}).refine((input) => input.notebookId || input.parentId, { message: "notebookId or parentId is required" });

export const DatabaseUpdateSchema = z.object({
  schema: DatabaseSchemaSchema.optional(),
  title: z.string().trim().max(160).optional(),
}).refine((input) => input.schema !== undefined || input.title !== undefined, { message: "Nothing to update" });

const fileValueSchema = z.object({
  id: z.string().min(1).max(64),
  name: z.string().trim().min(1).max(255),
  mimeType: z.string().max(255).nullable().optional(),
  size: z.number().int().nonnegative().nullable().optional(),
});

export const DatabaseRowValueSchema = z.union([
  z.string().max(20000),
  z.number(),
  z.boolean(),
  z.array(z.string().max(120)).max(1000),
  z.array(fileValueSchema).max(100),
  z.object({ start: z.string().max(40), end: z.string().max(40).nullable().optional() }),
  z.null(),
]);

export const DatabaseRowCreateSchema = z.object({
  title: z.string().trim().max(160).optional(),
  properties: z.record(z.string(), DatabaseRowValueSchema).optional(),
  /** Start the row from this template; title and properties given here win over the template's. */
  templateId: z.string().min(1).max(64).optional(),
});

export const DatabaseRowUpdateSchema = z.object({
  title: z.string().trim().max(160).optional(),
  properties: z.record(z.string(), DatabaseRowValueSchema).optional(),
  beforeId: z.string().min(1).nullable().optional(),
  afterId: z.string().min(1).nullable().optional(),
});

export const DatabaseViewCreateSchema = z.object({
  name: z.string().trim().min(1).max(120),
  type: z.enum(DATABASE_VIEW_TYPES),
  config: DatabaseViewConfigSchema.optional(),
});

export const DatabaseViewUpdateSchema = z.object({
  name: z.string().trim().min(1).max(120).optional(),
  type: z.enum(DATABASE_VIEW_TYPES).optional(),
  config: DatabaseViewConfigSchema.optional(),
  position: z.number().optional(),
});

export const createDefaultDatabaseSchema = (createId: () => string): DatabaseSchema => ({
  properties: [
    { id: "title", name: "Name", type: "title" },
    {
      id: createId(),
      name: "Status",
      type: "status",
      options: [
        { id: createId(), name: "Not started", color: "gray", group: "todo" },
        { id: createId(), name: "In progress", color: "blue", group: "in_progress" },
        { id: createId(), name: "Done", color: "green", group: "done" },
      ],
    },
    { id: createId(), name: "Tags", type: "multi_select", options: [] },
  ],
});

/** A starting point for new rows: Notion's database templates. */
export type DatabaseTemplate = {
  id: string;
  databaseId: string;
  name: string;
  icon: string | null;
  title: string;
  properties: Record<string, DatabasePropertyValue>;
  content: string;
  isDefault: boolean;
  position: number;
};

export const DATABASE_TEMPLATE_LIMIT = 50;

const templateFields = {
  name: z.string().trim().min(1).max(120),
  icon: z.string().trim().max(32).nullable(),
  title: z.string().trim().max(160),
  properties: z.record(z.string(), DatabaseRowValueSchema),
  /** The page body, as Markdown. */
  content: z.string().max(200_000),
  isDefault: z.boolean(),
};

export const DatabaseTemplateCreateSchema = z.object(templateFields).partial().extend({ name: templateFields.name });
export const DatabaseTemplateUpdateSchema = z.object(templateFields).partial().extend({ position: z.number().optional() });
