import { describe, expect, test } from "bun:test";
import { applyDatabaseView, computeRowValues, formatRowId, nestRows } from "./database-engine.ts";
import {
  DatabaseRowValueSchema,
  DatabaseSchemaSchema,
  userIdFromActorLabel,
  withValidRelationPairs,
} from "./database.ts";

const row = (id, title, properties = {}, extra = {}) => ({
  id,
  title,
  icon: null,
  cover: null,
  excerpt: "",
  properties,
  position: 0,
  number: null,
  createdBy: null,
  updatedBy: null,
  createdAt: "2026-01-02T03:04:05.000Z",
  updatedAt: "2026-01-03T03:04:05.000Z",
  ...extra,
});

const title = { id: "title", name: "Name", type: "title" };
const schemaOf = (...properties) => ({ properties: [title, ...properties] });
const compute = (schema, rows, people) => computeRowValues({ schema, rows, relatedRows: {}, now: new Date(2026, 0, 5), people });

describe("new property types", () => {
  test("person values show names when the workspace's people are known", () => {
    const schema = schemaOf({ id: "owner", name: "Owner", type: "person" });
    const people = new Map([["usr_1", "Ada"], ["usr_2", "Grace"]]);
    const cells = compute(schema, [row("r1", "One", { owner: ["usr_1", "usr_2"] })], people);
    expect(cells.get("r1").owner.value).toEqual(["Ada", "Grace"]);
    expect(cells.get("r1").owner.display).toBe("Ada, Grace");
    // Without names it still shows something rather than nothing.
    expect(compute(schema, [row("r1", "One", { owner: ["usr_9"] })]).get("r1").owner.value).toEqual(["usr_9"]);
  });

  test("created by and last edited by come from the row, not stored values", () => {
    const schema = schemaOf({ id: "cb", name: "Created by", type: "created_by" }, { id: "eb", name: "Edited by", type: "last_edited_by" });
    const people = new Map([["usr_1", "Ada"], ["usr_2", "Grace"]]);
    const cells = compute(schema, [row("r1", "One", { cb: "forged" }, { createdBy: "usr_1", updatedBy: "usr_2" })], people);
    expect(cells.get("r1").cb.display).toBe("Ada");
    expect(cells.get("r1").eb.display).toBe("Grace");
    expect(compute(schema, [row("r2", "Two")], people).get("r2").cb.value).toBeNull();
  });

  test("files show their names and count as empty when there are none", () => {
    const schema = schemaOf({ id: "files", name: "Files", type: "files" });
    const files = [{ id: "res_1", name: "plan.pdf", mimeType: "application/pdf", size: 10 }, { id: "res_2", name: "photo.png" }];
    const rows = [row("r1", "One", { files }), row("r2", "Two", { files: [] })];
    const cells = compute(schema, rows);
    expect(cells.get("r1").files.display).toBe("plan.pdf, photo.png");
    const empty = applyDatabaseView({ schema, rows, cells, config: { filters: [{ propertyId: "files", operator: "is_empty" }] } });
    expect(empty.map((item) => item.id)).toEqual(["r2"]);
  });

  test("IDs show the prefix and sort and filter as numbers", () => {
    const schema = schemaOf({ id: "id", name: "ID", type: "unique_id", uniqueId: { prefix: "TASK" } });
    const rows = [row("a", "A", {}, { number: 10 }), row("b", "B", {}, { number: 2 }), row("c", "C", {}, { number: null })];
    const cells = compute(schema, rows);
    expect(cells.get("a").id.display).toBe("TASK-10");
    expect(cells.get("c").id.display).toBe("");
    const sorted = applyDatabaseView({ schema, rows, cells, config: { sorts: [{ propertyId: "id", direction: "asc" }] } });
    expect(sorted.map((item) => item.id)).toEqual(["b", "a", "c"]);
    const over = applyDatabaseView({ schema, rows, cells, config: { filters: [{ propertyId: "id", operator: "gt", value: 5 }] } });
    expect(over.map((item) => item.id)).toEqual(["a"]);
    expect(formatRowId(7)).toBe("7");
  });

  test("a relation ignores file values instead of treating them as row ids", () => {
    const schema = schemaOf({ id: "rel", name: "Rel", type: "relation", relation: { databaseId: "db_1" } });
    const cells = compute(schema, [row("r1", "One", { rel: [{ id: "x", name: "x.txt" }] })]);
    expect(cells.get("r1").rel.value).toEqual([]);
  });
});

describe("stored values", () => {
  test("file lists are accepted, malformed ones are not", () => {
    expect(DatabaseRowValueSchema.safeParse([{ id: "res_1", name: "a.pdf", mimeType: "application/pdf", size: 3 }]).success).toBe(true);
    expect(DatabaseRowValueSchema.safeParse([{ id: "res_1" }]).success).toBe(false);
    expect(DatabaseRowValueSchema.safeParse([{ id: "", name: "a" }]).success).toBe(false);
  });

  test("ID prefixes are short and plain", () => {
    const withPrefix = (prefix) => DatabaseSchemaSchema.safeParse(schemaOf({ id: "id", name: "ID", type: "unique_id", uniqueId: { prefix } })).success;
    expect(withPrefix("TASK")).toBe(true);
    expect(withPrefix("")).toBe(true);
    expect(withPrefix("<b>")).toBe(false);
    expect(withPrefix("A".repeat(13))).toBe(false);
  });

  test("only people's labels become user ids", () => {
    expect(userIdFromActorLabel("user:usr_appkeep_42")).toBe("usr_appkeep_42");
    expect(userIdFromActorLabel("api_token:tok_1")).toBeNull();
    expect(userIdFromActorLabel("user")).toBeNull();
    expect(userIdFromActorLabel(null)).toBeNull();
  });
});

describe("sub-items and dependencies in the schema", () => {
  const parent = { id: "p", name: "Parent item", type: "relation", relation: { databaseId: "db_1", syncedPropertyId: "c" } };
  const child = { id: "c", name: "Sub-item", type: "relation", relation: { databaseId: "db_1", syncedPropertyId: "p" } };

  test("need two different relation properties", () => {
    expect(DatabaseSchemaSchema.safeParse({ ...schemaOf(parent, child), subItems: { parentPropertyId: "p", childPropertyId: "c" } }).success).toBe(true);
    expect(DatabaseSchemaSchema.safeParse({ ...schemaOf(parent, child), subItems: { parentPropertyId: "p", childPropertyId: "p" } }).success).toBe(false);
    expect(DatabaseSchemaSchema.safeParse({ ...schemaOf(parent), subItems: { parentPropertyId: "p", childPropertyId: "missing" } }).success).toBe(false);
    const text = { id: "t", name: "Notes", type: "text" };
    expect(DatabaseSchemaSchema.safeParse({ ...schemaOf(parent, text), dependencies: { blockedByPropertyId: "p", blockingPropertyId: "t" } }).success).toBe(false);
  });

  test("deleting or retyping one of the relations drops the setting instead of breaking the schema", () => {
    const schema = { ...schemaOf(parent, child), subItems: { parentPropertyId: "p", childPropertyId: "c" }, dependencies: { blockedByPropertyId: "p", blockingPropertyId: "c" } };
    expect(withValidRelationPairs(schema)).toEqual(schema);
    const deleted = withValidRelationPairs({ ...schema, properties: [title, parent] });
    expect(deleted.subItems).toBeUndefined();
    expect(deleted.dependencies).toBeUndefined();
    expect(DatabaseSchemaSchema.safeParse(deleted).success).toBe(true);
    const retyped = withValidRelationPairs({ ...schema, properties: [title, parent, { id: "c", name: "Sub-item", type: "text" }] });
    expect(retyped.subItems).toBeUndefined();
  });
});

describe("nestRows", () => {
  const P = "parent";
  const ids = (nested) => nested.map(({ row: item, depth }) => `${"-".repeat(depth)}${item.id}`);

  test("nests expanded rows under their parent in the given order", () => {
    const rows = [row("a", "A"), row("b", "B", { [P]: ["a"] }), row("c", "C"), row("d", "D", { [P]: ["b"] })];
    expect(ids(nestRows({ rows, parentPropertyId: P, expanded: new Set(["a", "b"]) }))).toEqual(["a", "-b", "--d", "c"]);
    const collapsed = nestRows({ rows, parentPropertyId: P, expanded: new Set() });
    expect(ids(collapsed)).toEqual(["a", "c"]);
    expect(collapsed[0].childCount).toBe(1);
  });

  test("a row whose parent is filtered out shows at the top level", () => {
    const rows = [row("b", "B", { [P]: ["a"] }), row("c", "C")];
    expect(ids(nestRows({ rows, parentPropertyId: P, expanded: new Set() }))).toEqual(["b", "c"]);
  });

  test("rows that are each other's parents still each appear once", () => {
    const rows = [row("a", "A", { [P]: ["b"] }), row("b", "B", { [P]: ["a"] }), row("s", "Self", { [P]: ["s"] })];
    const nested = nestRows({ rows, parentPropertyId: P, expanded: new Set(["a", "b"]) });
    expect(ids(nested)).toEqual(["s", "a", "-b"]);
    expect(nested.length).toBe(3);
  });
});
