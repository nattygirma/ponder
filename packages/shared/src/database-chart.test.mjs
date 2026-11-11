import { describe, expect, test } from "bun:test";
import { chartDateBucket, chartTicks, computeChart, defaultChartXProperty } from "./database-chart.ts";
import { computeRowValues } from "./database-engine.ts";
import { DatabaseViewConfigSchema } from "./database.ts";

const row = (id, title, properties = {}, extra = {}) => ({
  id, title, icon: null, cover: null, excerpt: "", properties, position: 0, number: null,
  createdBy: null, updatedBy: null, createdAt: "2026-01-01T00:00:00Z", updatedAt: "2026-01-01T00:00:00Z", ...extra,
});

const schema = {
  properties: [
    { id: "title", name: "Name", type: "title" },
    {
      id: "status", name: "Status", type: "status",
      options: [
        { id: "todo", name: "Not started", color: "gray", group: "todo" },
        { id: "doing", name: "In progress", color: "blue", group: "in_progress" },
        { id: "done", name: "Done", color: "green", group: "done" },
      ],
    },
    { id: "tags", name: "Tags", type: "multi_select", options: [{ id: "a", name: "Alpha", color: "red" }, { id: "b", name: "Beta", color: "pink" }] },
    { id: "points", name: "Points", type: "number" },
    { id: "due", name: "Due", type: "date" },
    { id: "owner", name: "Owner", type: "person" },
  ],
};

const rows = [
  row("r1", "One", { status: "todo", tags: ["a"], points: 3, due: "2026-03-02", owner: ["usr_ada"] }),
  row("r2", "Two", { status: "doing", tags: ["a", "b"], points: 5, due: "2026-03-20" }),
  row("r3", "Three", { status: "doing", points: 2, due: "2026-04-01", owner: ["usr_grace"] }),
  row("r4", "Four", { status: "done", tags: ["b"], points: 10 }),
];
const cells = computeRowValues({ schema, rows, relatedRows: {} });
const chartOf = (chart, input = {}) => computeChart({ schema, rows, cells, chart, ...input });

describe("chart view", () => {
  test("counts rows per status, keeping the status order and Notion's colors", () => {
    const data = chartOf({ xPropertyId: "status" });
    expect(data.groups.map((group) => [group.label, group.color])).toEqual([["Not started", "gray"], ["In progress", "blue"], ["Done", "green"]]);
    expect(data.values).toEqual([[1], [2], [1]]);
    expect(data.rowIds[1][0]).toEqual(["r2", "r3"]);
    expect(data.total).toBe(4);
  });

  test("shows options with no rows unless zero values are omitted", () => {
    const fewer = computeChart({ schema, rows: rows.slice(0, 2), cells, chart: { xPropertyId: "status" } });
    expect(fewer.groups.map((group) => group.key)).toEqual(["todo", "doing", "done"]);
    expect(fewer.values[2]).toEqual([0]);
    const omitted = computeChart({ schema, rows: rows.slice(0, 2), cells, chart: { xPropertyId: "status", omitZero: true } });
    expect(omitted.groups.map((group) => group.key)).toEqual(["todo", "doing"]);
  });

  test("a row with several tags counts under each, and an empty one under No <property>", () => {
    const data = chartOf({ xPropertyId: "tags" });
    expect(data.groups.map((group) => group.label)).toEqual(["Alpha", "Beta", "No Tags"]);
    expect(data.values).toEqual([[2], [2], [1]]);
  });

  test("sums, averages and medians a number property", () => {
    expect(chartOf({ xPropertyId: "status", yPropertyId: "points", yAggregate: "sum" }).values).toEqual([[3], [7], [10]]);
    expect(chartOf({ xPropertyId: "status", yPropertyId: "points", yAggregate: "average" }).values).toEqual([[3], [3.5], [10]]);
    expect(chartOf({ type: "number", yPropertyId: "points", yAggregate: "median" }).total).toBe(4);
    expect(chartOf({ type: "number", yPropertyId: "points", yAggregate: "range" }).total).toBe(8);
  });

  test("splits each group by a second property for stacked bars and lines", () => {
    const data = chartOf({ xPropertyId: "status", groupByPropertyId: "tags" });
    expect(data.series.map((item) => item.label)).toEqual(["Alpha", "Beta", "No Tags"]);
    expect(data.values).toEqual([[1, 0, 0], [1, 1, 1], [0, 1, 0]]);
  });

  test("groups dates by month in time order, and adds up when cumulative", () => {
    const data = chartOf({ xPropertyId: "due", dateGroup: "month", cumulative: true });
    expect(data.groups.map((group) => group.label)).toEqual(["Mar 2026", "Apr 2026", "No Due"]);
    expect(data.values).toEqual([[2], [3], [4]]);
  });

  test("sorts by value and hides groups the view hides", () => {
    const data = chartOf({ xPropertyId: "status", xSort: "value_desc", hiddenGroups: ["done"] });
    expect(data.groups.map((group) => group.key)).toEqual(["doing", "todo"]);
    expect(data.hiddenGroups.map((group) => group.key)).toEqual(["done"]);
  });

  test("names people by their workspace name", () => {
    const data = chartOf({ xPropertyId: "owner" }, { names: { person: (id) => ({ usr_ada: "Ada", usr_grace: "Grace" })[id] } });
    expect(data.groups.map((group) => group.label).sort()).toEqual(["Ada", "Grace", "No Owner"]);
  });

  test("picks status for a new chart, and leaves the settings valid to store", () => {
    expect(defaultChartXProperty(schema)).toBe("status");
    expect(DatabaseViewConfigSchema.safeParse({ chart: { type: "donut", xPropertyId: "status", color: "teal", referenceLines: [{ value: 3, label: "Goal" }] } }).success).toBe(true);
    expect(DatabaseViewConfigSchema.safeParse({ chart: { type: "pie" } }).success).toBe(false);
  });

  test("weeks start on Monday and axis ticks are round numbers", () => {
    expect(chartDateBucket(new Date(2026, 10, 11), "week").label).toBe("Week of Nov 9, 2026");
    expect(chartTicks(0, 7)).toEqual([0, 2, 4, 6, 8]);
  });
});
