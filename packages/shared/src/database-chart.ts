import {
  CHART_GROUP_LIMIT,
  CHART_SERIES_LIMIT,
  type ChartAggregate,
  type ChartDateGroup,
  type DatabaseChartConfig,
  type DatabaseOptionColor,
  type DatabaseProperty,
  type DatabaseRow,
  type DatabaseSchema,
} from "./database";
import type { ComputedCell, ComputedRowValues } from "./database-engine";

/** One bar, point or slice along the X axis. */
export type ChartGroup = {
  key: string;
  label: string;
  color?: DatabaseOptionColor;
};

/** A "Group by" split of every X group: a stack of bars, or a line. */
export type ChartSeries = ChartGroup;

export type ChartData = {
  groups: ChartGroup[];
  /** Groups the view hides, so the settings can offer them back. */
  hiddenGroups: ChartGroup[];
  series: ChartSeries[];
  /** values[group][series]. Null where no row has a number to sum. */
  values: (number | null)[][];
  /** The row ids behind each value, for the drilldown. */
  rowIds: string[][][];
  /** The single number a number chart shows, over every row. */
  total: number | null;
  /** True when the groups had to be cut to Notion's limits. */
  truncated: boolean;
};

const NONE = "__none";
const ONE_SERIES: ChartSeries = { key: "__all", label: "" };
const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

/** Properties a chart can't group by, as in Notion. */
const UNGROUPABLE = new Set<DatabaseProperty["type"]>(["files", "unique_id", "rollup"]);
const NUMERIC = new Set<DatabaseProperty["type"]>(["number", "formula", "rollup"]);

export const chartGroupableProperties = (schema: DatabaseSchema) =>
  schema.properties.filter((property) => !UNGROUPABLE.has(property.type));

export const chartNumberProperties = (schema: DatabaseSchema) =>
  schema.properties.filter((property) => NUMERIC.has(property.type));

const DEFAULT_X_ORDER: DatabaseProperty["type"][] = ["status", "select", "multi_select", "checkbox", "person", "date", "created_time", "relation"];

/** What a new chart view shows first: the most chartable property, like Notion's pick. */
export const defaultChartXProperty = (schema: DatabaseSchema): string | null => {
  for (const type of DEFAULT_X_ORDER) {
    const property = schema.properties.find((candidate) => candidate.type === type);
    if (property) return property.id;
  }
  return chartGroupableProperties(schema).find((property) => property.type !== "title")?.id ?? null;
};

const pad = (value: number) => String(value).padStart(2, "0");
const dayKey = (date: Date) => `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
const dayLabel = (date: Date) => `${MONTHS[date.getMonth()]} ${date.getDate()}, ${date.getFullYear()}`;

/** Buckets a date by day, week (starting Monday), month or year. The key sorts in time order. */
export const chartDateBucket = (date: Date, group: ChartDateGroup): { key: string; label: string } => {
  if (group === "year") return { key: String(date.getFullYear()), label: String(date.getFullYear()) };
  if (group === "month") return { key: `${date.getFullYear()}-${pad(date.getMonth() + 1)}`, label: `${MONTHS[date.getMonth()]} ${date.getFullYear()}` };
  if (group === "week") {
    const start = new Date(date.getFullYear(), date.getMonth(), date.getDate() - ((date.getDay() + 6) % 7));
    return { key: dayKey(start), label: `Week of ${dayLabel(start)}` };
  }
  return { key: dayKey(date), label: dayLabel(date) };
};

const storedStrings = (value: unknown): string[] => {
  if (Array.isArray(value)) return value.filter((item): item is string => typeof item === "string" && item !== "");
  return typeof value === "string" && value !== "" ? [value] : [];
};

type Keyed = ChartGroup & { rank: number };

/**
 * The groups one row falls in for a property. A row with several values (tags, people, relations) counts in
 * each; a row with none falls in "No <property>".
 */
const keysFor = (
  property: DatabaseProperty,
  row: DatabaseRow,
  cell: ComputedCell | undefined,
  dateGroup: ChartDateGroup,
  names: ChartNames,
): Keyed[] => {
  const none: Keyed = { key: NONE, label: `No ${property.name}`, rank: Number.MAX_SAFE_INTEGER };
  switch (property.type) {
    case "select":
    case "status":
    case "multi_select": {
      const options = property.options ?? [];
      const picked = storedStrings(row.properties[property.id]).flatMap((stored) => {
        const index = options.findIndex((option) => option.id === stored || option.name === stored);
        return index < 0 ? [] : [{ key: options[index].id, label: options[index].name, color: options[index].color, rank: index }];
      });
      const unique = [...new Map(picked.map((item) => [item.key, item])).values()];
      if (property.type !== "multi_select") unique.splice(1);
      return unique.length ? unique : [none];
    }
    case "checkbox":
      return cell?.value === true ? [{ key: "checked", label: "Checked", rank: 0 }] : [{ key: "unchecked", label: "Unchecked", rank: 1 }];
    case "person":
    case "relation": {
      const ids = storedStrings(row.properties[property.id]);
      const label = property.type === "person" ? names.person : names.row;
      return ids.length ? ids.map((id) => ({ key: id, label: label(id), rank: 0 })) : [none];
    }
    case "created_by":
    case "last_edited_by": {
      const id = property.type === "created_by" ? row.createdBy : row.updatedBy;
      return id ? [{ key: id, label: names.person(id), rank: 0 }] : [none];
    }
    case "date":
    case "created_time":
    case "last_edited_time": {
      const value = cell?.value;
      if (!(value instanceof Date)) return [none];
      const bucket = chartDateBucket(value, dateGroup);
      return [{ ...bucket, rank: 0 }];
    }
    case "number": {
      const value = cell?.value;
      return typeof value === "number" ? [{ key: String(value), label: cell?.display || String(value), rank: value }] : [none];
    }
    default: {
      const display = cell?.display?.trim() ?? "";
      return display ? [{ key: display, label: display, rank: 0 }] : [none];
    }
  }
};

export type ChartNames = {
  /** A workspace member's name. */
  person: (id: string) => string;
  /** A related row's title. */
  row: (id: string) => string;
};

const DEFAULT_NAMES: ChartNames = { person: (id) => id, row: (id) => id };

const collator = new Intl.Collator(undefined, { numeric: true, sensitivity: "base" });

const aggregate = (numbers: number[], fn: ChartAggregate): number | null => {
  if (numbers.length === 0) return null;
  switch (fn) {
    case "sum": return numbers.reduce((total, value) => total + value, 0);
    case "average": return numbers.reduce((total, value) => total + value, 0) / numbers.length;
    case "min": return Math.min(...numbers);
    case "max": return Math.max(...numbers);
    case "range": return Math.max(...numbers) - Math.min(...numbers);
    case "median": {
      const sorted = [...numbers].sort((left, right) => left - right);
      const middle = Math.floor(sorted.length / 2);
      return sorted.length % 2 ? sorted[middle] : (sorted[middle - 1] + sorted[middle]) / 2;
    }
  }
};

const roundValue = (value: number | null) => (value === null ? null : Number(value.toPrecision(12)));

/** Every group a property can have even with no rows in it: a select's options, a checkbox's two states. */
const allGroupsOf = (property: DatabaseProperty): Keyed[] => {
  if (property.type === "select" || property.type === "status" || property.type === "multi_select") {
    return (property.options ?? []).map((option, index) => ({ key: option.id, label: option.name, color: option.color, rank: index }));
  }
  if (property.type === "checkbox") return [{ key: "checked", label: "Checked", rank: 0 }, { key: "unchecked", label: "Unchecked", rank: 1 }];
  return [];
};

const isOrdered = (property: DatabaseProperty) =>
  ["select", "status", "multi_select", "checkbox", "number"].includes(property.type);

/**
 * Works out a chart from the rows a view shows, in the browser, the way Notion's chart view does: groups along
 * X, an optional split by a second property, and a count or a sum (average, median, ...) of a number property.
 */
export const computeChart = (input: {
  schema: DatabaseSchema;
  rows: DatabaseRow[];
  cells: ComputedRowValues;
  chart: DatabaseChartConfig;
  names?: Partial<ChartNames>;
}): ChartData => {
  const { schema, rows, cells, chart } = input;
  const names = { ...DEFAULT_NAMES, ...input.names };
  const byId = new Map(schema.properties.map((property) => [property.id, property]));
  const type = chart.type ?? "vertical_bar";
  const dateGroup = chart.dateGroup ?? "month";
  const yProperty = chart.yPropertyId ? byId.get(chart.yPropertyId) : undefined;
  const fn = chart.yAggregate ?? "sum";
  const numberOf = (row: DatabaseRow) => {
    if (!yProperty) return null;
    const value = cells.get(row.id)?.[yProperty.id]?.value;
    return typeof value === "number" && Number.isFinite(value) ? value : null;
  };
  const measure = (members: DatabaseRow[]): number | null => {
    if (!yProperty) return members.length;
    return roundValue(aggregate(members.flatMap((row) => numberOf(row) ?? []), fn));
  };

  const total = measure(rows);
  const xProperty = chart.xPropertyId ? byId.get(chart.xPropertyId) : undefined;
  if (type === "number" || !xProperty || UNGROUPABLE.has(xProperty.type)) {
    return { groups: [], hiddenGroups: [], series: [], values: [], rowIds: [], total, truncated: false };
  }
  const seriesProperty = type !== "donut" && chart.groupByPropertyId ? byId.get(chart.groupByPropertyId) : undefined;
  const splitting = Boolean(seriesProperty && !UNGROUPABLE.has(seriesProperty.type) && seriesProperty.id !== xProperty.id);

  const groups = new Map<string, Keyed>();
  const series = new Map<string, Keyed>();
  const members = new Map<string, DatabaseRow[]>();
  if (!chart.omitZero) for (const group of allGroupsOf(xProperty)) groups.set(group.key, group);
  if (splitting && seriesProperty) for (const item of allGroupsOf(seriesProperty)) series.set(item.key, item);

  for (const row of rows) {
    const rowCells = cells.get(row.id);
    const xKeys = keysFor(xProperty, row, rowCells?.[xProperty.id], dateGroup, names);
    const sKeys = splitting && seriesProperty ? keysFor(seriesProperty, row, rowCells?.[seriesProperty.id], dateGroup, names) : [{ ...ONE_SERIES, rank: 0 }];
    for (const x of xKeys) {
      if (!groups.has(x.key)) groups.set(x.key, x);
      for (const s of sKeys) {
        if (!series.has(s.key)) series.set(s.key, s);
        const cell = `${x.key}\u0000${s.key}`;
        members.set(cell, [...(members.get(cell) ?? []), row]);
      }
    }
  }

  const seriesList = [...series.values()]
    .sort((left, right) => (seriesProperty && isOrdered(seriesProperty) ? left.rank - right.rank : 0) || (left.key === NONE ? 1 : right.key === NONE ? -1 : 0))
    .slice(0, CHART_SERIES_LIMIT);
  if (seriesList.length === 0) seriesList.push({ ...ONE_SERIES, rank: 0 });

  const valueFor = (groupKey: string, seriesKey: string) => {
    const found = members.get(`${groupKey}\u0000${seriesKey}`) ?? [];
    return { value: found.length || !yProperty ? measure(found) : null, rowIds: found.map((row) => row.id) };
  };
  const groupTotal = (groupKey: string) => seriesList.reduce((sum, item) => sum + (valueFor(groupKey, item.key).value ?? 0), 0);

  const hidden = new Set(chart.hiddenGroups ?? []);
  let ordered = [...groups.values()];
  const naturalOrder = (left: Keyed, right: Keyed) => {
    if (left.key === NONE || right.key === NONE) return left.key === NONE ? 1 : -1;
    if (isOrdered(xProperty)) return left.rank - right.rank;
    if (["date", "created_time", "last_edited_time"].includes(xProperty.type)) return left.key < right.key ? -1 : left.key > right.key ? 1 : 0;
    return collator.compare(left.label, right.label);
  };
  const sort = chart.xSort ?? "manual";
  ordered.sort((left, right) => {
    if (sort === "asc") return naturalOrder(left, right);
    if (sort === "desc") return -naturalOrder(left, right);
    if (sort === "value_asc") return groupTotal(left.key) - groupTotal(right.key) || naturalOrder(left, right);
    if (sort === "value_desc") return groupTotal(right.key) - groupTotal(left.key) || naturalOrder(left, right);
    return naturalOrder(left, right);
  });
  if (chart.omitZero) ordered = ordered.filter((group) => groupTotal(group.key) !== 0);
  const shown = ordered.filter((group) => !hidden.has(group.key));
  const truncated = shown.length > CHART_GROUP_LIMIT || series.size > CHART_SERIES_LIMIT;
  const kept = shown.slice(0, CHART_GROUP_LIMIT);

  const values = kept.map((group) => seriesList.map((item) => valueFor(group.key, item.key).value));
  const rowIds = kept.map((group) => seriesList.map((item) => valueFor(group.key, item.key).rowIds));
  // Cumulative only makes sense for a running count or sum along an ascending axis, as in Notion.
  if (chart.cumulative && (!yProperty || fn === "sum") && (sort === "manual" || sort === "asc") && type !== "donut") {
    for (let column = 0; column < seriesList.length; column += 1) {
      let running = 0;
      for (let row = 0; row < values.length; row += 1) {
        running += values[row][column] ?? 0;
        values[row][column] = roundValue(running);
      }
    }
  }

  const strip = ({ rank: _rank, ...group }: Keyed): ChartGroup => group;
  return {
    groups: kept.map(strip),
    hiddenGroups: ordered.filter((group) => hidden.has(group.key)).map(strip),
    series: seriesList.map(strip),
    values,
    rowIds,
    total,
    truncated,
  };
};

/** Round, readable steps for an axis from 0 (or the lowest value) to the highest. */
export const chartTicks = (min: number, max: number, count = 5, integers = false): number[] => {
  if (!Number.isFinite(min) || !Number.isFinite(max)) return [0];
  // Counts step in whole numbers, and like Notion a small count still gets an axis up to 4.
  if (integers) max = Math.max(max, min + 4);
  if (max === min) max = min + 1;
  const raw = (max - min) / count;
  const magnitude = 10 ** Math.floor(Math.log10(raw));
  const nice = [1, 2, 2.5, 5, 10].map((factor) => factor * magnitude).find((candidate) => candidate >= raw) ?? raw;
  const step = integers ? Math.max(1, Math.ceil(nice)) : nice;
  const start = Math.floor(min / step) * step;
  const ticks: number[] = [];
  for (let value = start; value <= max + step * 0.0001; value += step) ticks.push(Number(value.toPrecision(12)));
  if (ticks[ticks.length - 1] < max) ticks.push(Number((ticks[ticks.length - 1] + step).toPrecision(12)));
  return ticks;
};
