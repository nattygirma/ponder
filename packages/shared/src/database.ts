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
  "created_time",
  "last_edited_time",
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
});
export type DatabaseProperty = z.infer<typeof DatabasePropertySchema>;

export const DatabaseSchemaSchema = z.object({
  properties: z.array(DatabasePropertySchema).min(1).max(DATABASE_PROPERTY_LIMIT),
}).superRefine((schema, context) => {
  if (schema.properties.filter((property) => property.type === "title").length !== 1) {
    context.addIssue({ code: "custom", message: "A database needs exactly one title property." });
  }
  if (new Set(schema.properties.map((property) => property.id)).size !== schema.properties.length) {
    context.addIssue({ code: "custom", message: "Property ids must be unique." });
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
  updatedAt: string;
};

export type DatabaseDateValue = { start: string; end?: string | null };

/** Stored values, keyed by property id. Computed properties are never stored. */
export type DatabasePropertyValue =
  | string
  | number
  | boolean
  | string[]
  | DatabaseDateValue
  | null;

export type DatabaseRow = {
  id: string;
  title: string | null;
  icon: string | null;
  cover: string | null;
  excerpt: string;
  properties: Record<string, DatabasePropertyValue>;
  position: number;
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

export const DatabaseRowValueSchema = z.union([
  z.string().max(20000),
  z.number(),
  z.boolean(),
  z.array(z.string().max(120)).max(1000),
  z.object({ start: z.string().max(40), end: z.string().max(40).nullable().optional() }),
  z.null(),
]);

export const DatabaseRowCreateSchema = z.object({
  title: z.string().trim().max(160).optional(),
  properties: z.record(z.string(), DatabaseRowValueSchema).optional(),
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
