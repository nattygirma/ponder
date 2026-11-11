import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { useTranslation } from "react-i18next";
import { ChartBar, ChartColumn, ChartLine, ChartPie, Download, Eye, EyeOff, Hash, Plus, Trash2, X } from "lucide-react";
import {
  CHART_AGGREGATES,
  CHART_AXIS_NAMES,
  CHART_COLORS,
  CHART_DATE_GROUPS,
  CHART_DONUT_LABELS,
  CHART_GRID_LINES,
  CHART_HEIGHTS,
  CHART_X_SORTS,
  chartGroupableProperties,
  chartNumberProperties,
  chartTicks,
  computeChart,
  type ChartColor,
  type ChartData,
  type ChartType,
  type DatabaseChartConfig,
  type DatabaseOptionColor,
  type DatabaseViewConfig,
} from "@ponder/shared";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";
import { useAppearanceTheme } from "@/components/ThemeProvider";
import { useOpenRow, type DatabaseViewProps } from "./DatabaseViews";
import type { DatabaseHandle } from "./useDatabase";

/** Notion's chart palette, close to its option colors. */
const HUES: Record<Exclude<ChartColor, "auto" | "colorful" | "colorless"> | DatabaseOptionColor, string> = {
  gray: "#9B9A97",
  brown: "#A27763",
  orange: "#E2873B",
  yellow: "#D9A72C",
  green: "#4F9C6E",
  blue: "#3F89C8",
  purple: "#9168C9",
  pink: "#D1558F",
  red: "#D9584F",
  teal: "#3AA29D",
};
const COLORFUL = [HUES.blue, HUES.green, HUES.yellow, HUES.orange, HUES.purple, HUES.pink, HUES.red, HUES.teal, HUES.brown, HUES.gray];
const PLOT_HEIGHTS = { small: 200, medium: 300, large: 400, extra_large: 520 } as const;

type Theme = { text: string; muted: string; grid: string; background: string; colorless: string };
const THEMES: Record<"light" | "dark", Theme> = {
  light: { text: "#37352F", muted: "#9B9A97", grid: "#E9E9E7", background: "#FFFFFF", colorless: "#D3D1CB" },
  dark: { text: "#E3E3E1", muted: "#8C8C8A", grid: "#373737", background: "#191919", colorless: "#454545" },
};

const formatValue = (value: number | null) => {
  if (value === null) return "";
  return Math.abs(value) >= 1000 ? value.toLocaleString(undefined, { maximumFractionDigits: 2 }) : String(Number(value.toFixed(2)));
};

/** Colors for each group (single series, or a donut) or each series, following the chart's Color setting. */
const paint = (chart: DatabaseChartConfig, items: { color?: DatabaseOptionColor }[], theme: Theme, values?: (number | null)[]) => {
  const color = chart.color ?? "auto";
  const max = Math.max(1, ...(values ?? []).map((value) => value ?? 0));
  return items.map((item, index) => {
    if (color === "colorless") return theme.colorless;
    if (color === "colorful") return COLORFUL[index % COLORFUL.length];
    if (color === "auto") return item.color ? HUES[item.color] : items.length > 1 ? COLORFUL[index % COLORFUL.length] : theme.colorless;
    const hue = HUES[color];
    if (!chart.colorByValue || !values) return hue;
    // Darker as the value grows, as Notion's "Color by value".
    const share = Math.max(0, values[index] ?? 0) / max;
    return `color-mix(in srgb, ${hue} ${Math.round(35 + share * 65)}%, ${theme.background})`;
  });
};

type Hover = { x: number; y: number; title: string; detail: string } | null;
type Pick = { group: number; series: number | null };

const useWidth = () => {
  const ref = useRef<HTMLDivElement | null>(null);
  const [width, setWidth] = useState(640);
  useEffect(() => {
    const element = ref.current;
    if (!element) return;
    const observer = new ResizeObserver(([entry]) => setWidth(Math.max(240, Math.floor(entry.contentRect.width))));
    observer.observe(element);
    return () => observer.disconnect();
  }, []);
  return { ref, width };
};

const smoothPath = (points: [number, number][]) => {
  if (points.length < 3) return points.map(([x, y], index) => `${index ? "L" : "M"}${x},${y}`).join(" ");
  let path = `M${points[0][0]},${points[0][1]}`;
  for (let index = 0; index < points.length - 1; index += 1) {
    const [x0, y0] = points[index - 1] ?? points[index];
    const [x1, y1] = points[index];
    const [x2, y2] = points[index + 1];
    const [x3, y3] = points[index + 2] ?? points[index + 1];
    path += ` C${x1 + (x2 - x0) / 6},${y1 + (y2 - y0) / 6} ${x2 - (x3 - x1) / 6},${y2 - (y3 - y1) / 6} ${x2},${y2}`;
  }
  return path;
};

const truncate = (text: string, max: number) => (text.length > max ? `${text.slice(0, max - 1)}…` : text);

/** Bar and line charts: groups along X, values up Y, stacked bars or one line per "Group by" value. */
const AxisChart = ({ chart, data, hiddenSeries, width, height, theme, xName, yName, onHover, onPick }: {
  chart: DatabaseChartConfig;
  data: ChartData;
  hiddenSeries: ReadonlySet<string>;
  width: number;
  height: number;
  theme: Theme;
  xName: string;
  yName: string;
  onHover: (hover: Hover) => void;
  onPick: (pick: Pick) => void;
}) => {
  const type = chart.type ?? "vertical_bar";
  const horizontal = type === "horizontal_bar";
  const line = type === "line";
  const seriesShown = data.series.map((item) => !hiddenSeries.has(item.key));
  const stackTotals = data.values.map((row) => row.reduce<number>((sum, value, index) => sum + (seriesShown[index] ? value ?? 0 : 0), 0));
  const flat = line ? data.values.flatMap((row) => row.filter((_, index) => seriesShown[index]).map((value) => value ?? 0)) : stackTotals;
  const lines = chart.referenceLines ?? [];
  const lowest = chart.rangeMin ?? Math.min(0, ...flat, ...lines.map((item) => item.value));
  const highest = chart.rangeMax ?? Math.max(1, ...flat, ...lines.map((item) => item.value));
  const ticks = chartTicks(lowest, highest, 5, flat.every((value) => Number.isInteger(value)));
  const min = chart.rangeMin ?? ticks[0];
  const max = chart.rangeMax ?? ticks[ticks.length - 1];
  const axisNames = chart.axisName ?? "none";
  const showX = axisNames === "x" || axisNames === "both";
  const showY = axisNames === "y" || axisNames === "both";
  const grid = chart.gridLine ?? "horizontal";
  const labels = chart.dataLabels ?? true;
  const groupCount = Math.max(1, data.groups.length);
  const valueLabelWidth = Math.max(...ticks.map((tick) => formatValue(tick).length)) * 7 + 12;
  const categoryWidth = horizontal ? Math.min(160, Math.max(48, ...data.groups.map((group) => truncate(group.label, 22).length * 6.5 + 12))) : 0;
  const pad = {
    left: (horizontal ? categoryWidth : valueLabelWidth) + (horizontal ? (showX ? 20 : 0) : showY ? 20 : 0),
    right: 16,
    top: 20,
    bottom: 28 + (horizontal ? (showY ? 20 : 0) : showX ? 20 : 0),
  };
  const plotW = Math.max(10, width - pad.left - pad.right);
  const plotH = Math.max(10, height - pad.top - pad.bottom);
  const valueSpan = max - min || 1;
  // Position along the value axis, and the slot of each group along the category axis.
  const toValue = (value: number) => (horizontal ? pad.left + ((value - min) / valueSpan) * plotW : pad.top + plotH - ((value - min) / valueSpan) * plotH);
  const band = (horizontal ? plotH : plotW) / groupCount;
  const center = (index: number) => (horizontal ? pad.top : pad.left) + band * index + band / 2;
  const barSize = Math.max(2, Math.min(band * 0.6, 24));
  const colors = paint(chart, data.series.length > 1 ? data.series : data.groups, theme, data.series.length > 1 ? undefined : stackTotals);
  const colorAt = (group: number, series: number) => (data.series.length > 1 ? colors[series] : colors[group]);
  const tickEvery = Math.max(1, Math.ceil(groupCount / Math.max(1, Math.floor((horizontal ? plotH : plotW) / (horizontal ? 18 : 64)))));

  const hover = (group: number, series: number | null) => (event: React.MouseEvent) => {
    const box = (event.currentTarget as SVGElement).ownerSVGElement?.getBoundingClientRect();
    const value = series === null ? stackTotals[group] : data.values[group][series];
    onHover({
      x: event.clientX - (box?.left ?? 0),
      y: event.clientY - (box?.top ?? 0),
      title: data.groups[group].label,
      detail: `${series !== null && data.series.length > 1 ? `${data.series[series].label} · ` : ""}${yName}: ${formatValue(value)}`,
    });
  };

  return (
    <svg width={width} height={height} role="img" aria-label={`${xName} / ${yName}`} data-chart-svg>
      <rect width={width} height={height} fill="transparent" />
      {ticks.map((tick) => {
        const at = toValue(tick);
        const drawGrid = horizontal ? grid === "vertical" || grid === "both" : grid === "horizontal" || grid === "both";
        return (
          <g key={tick}>
            {drawGrid ? (horizontal
              ? <line x1={at} x2={at} y1={pad.top} y2={pad.top + plotH} stroke={theme.grid} strokeDasharray="2 3" />
              : <line x1={pad.left} x2={pad.left + plotW} y1={at} y2={at} stroke={theme.grid} strokeDasharray="2 3" />) : null}
            {horizontal
              ? <text x={at} y={pad.top + plotH + 16} fill={theme.muted} fontSize="11" textAnchor="middle">{formatValue(tick)}</text>
              : <text x={pad.left - 8} y={at + 4} fill={theme.muted} fontSize="11" textAnchor="end">{formatValue(tick)}</text>}
          </g>
        );
      })}
      {(horizontal ? grid === "horizontal" || grid === "both" : grid === "vertical" || grid === "both")
        ? data.groups.map((group, index) => (horizontal
          ? <line key={group.key} x1={pad.left} x2={pad.left + plotW} y1={center(index)} y2={center(index)} stroke={theme.grid} strokeDasharray="2 3" />
          : <line key={group.key} x1={center(index)} x2={center(index)} y1={pad.top} y2={pad.top + plotH} stroke={theme.grid} strokeDasharray="2 3" />))
        : null}
      {horizontal
        ? <line x1={pad.left} x2={pad.left} y1={pad.top} y2={pad.top + plotH} stroke={theme.grid} />
        : <line x1={pad.left} x2={pad.left + plotW} y1={toValue(Math.max(min, 0))} y2={toValue(Math.max(min, 0))} stroke={theme.grid} />}
      {data.groups.map((group, index) => (index % tickEvery === 0 ? (
        horizontal
          ? <text key={group.key} x={pad.left - 8} y={center(index) + 4} fill={theme.muted} fontSize="11" textAnchor="end">{truncate(group.label, 22)}</text>
          : <text key={group.key} x={center(index)} y={pad.top + plotH + 18} fill={theme.muted} fontSize="11" textAnchor="middle">{truncate(group.label, Math.max(4, Math.floor((band * tickEvery) / 6.5)))}</text>
      ) : null))}
      {line ? data.series.map((item, series) => {
        if (!seriesShown[series]) return null;
        const points = data.values.map((row, group): [number, number] => [center(group), toValue(row[series] ?? 0)]);
        const color = data.series.length > 1 ? colors[series] : (chart.color ?? "auto") === "auto" ? HUES.blue : colors[0];
        const path = chart.smoothLine ? smoothPath(points) : points.map(([x, y], index) => `${index ? "L" : "M"}${x},${y}`).join(" ");
        const gradientId = `chart-area-${series}`;
        return (
          <g key={item.key} data-chart-series={item.key}>
            {chart.gradientArea && points.length > 0 ? (
              <>
                <defs>
                  <linearGradient id={gradientId} x1="0" x2="0" y1="0" y2="1">
                    <stop offset="0%" stopColor={color} stopOpacity="0.35" />
                    <stop offset="100%" stopColor={color} stopOpacity="0" />
                  </linearGradient>
                </defs>
                <path d={`${path} L${points[points.length - 1][0]},${pad.top + plotH} L${points[0][0]},${pad.top + plotH} Z`} fill={`url(#${gradientId})`} />
              </>
            ) : null}
            <path d={path} fill="none" stroke={color} strokeWidth="2" />
            {points.map(([x, y], group) => (
              <g key={data.groups[group].key}>
                <circle cx={x} cy={y} r="3.5" fill={color} stroke={theme.background} strokeWidth="1.5" className="cursor-pointer"
                  onMouseMove={hover(group, series)} onMouseLeave={() => onHover(null)} onClick={() => onPick({ group, series })} data-chart-point />
                {labels ? <text x={x} y={y - 9} fill={theme.text} fontSize="11" textAnchor="middle">{formatValue(data.values[group][series])}</text> : null}
              </g>
            ))}
          </g>
        );
      }) : data.groups.map((group, groupIndex) => {
        let offset = 0;
        const segments = data.series.map((item, series) => {
          if (!seriesShown[series]) return null;
          const value = data.values[groupIndex][series] ?? 0;
          const from = toValue(Math.max(min, offset));
          offset += value;
          const to = toValue(Math.max(min, offset));
          const start = center(groupIndex) - barSize / 2;
          const size = Math.abs(to - from);
          const rect = horizontal
            ? { x: Math.min(from, to), y: start, width: size, height: barSize }
            : { x: start, y: Math.min(from, to), width: barSize, height: size };
          return (
            <rect key={item.key} {...rect} rx="3" fill={colorAt(groupIndex, series)} className="cursor-pointer"
              onMouseMove={hover(groupIndex, series)} onMouseLeave={() => onHover(null)} onClick={() => onPick({ group: groupIndex, series })} data-chart-bar />
          );
        });
        const totalAt = toValue(Math.max(min, stackTotals[groupIndex]));
        return (
          <g key={group.key}>
            {segments}
            {labels ? (horizontal
              ? <text x={totalAt + 6} y={center(groupIndex) + 4} fill={theme.text} fontSize="11">{formatValue(stackTotals[groupIndex])}</text>
              : <text x={center(groupIndex)} y={totalAt - 6} fill={theme.text} fontSize="11" textAnchor="middle">{formatValue(stackTotals[groupIndex])}</text>) : null}
          </g>
        );
      })}
      {lines.map((reference, index) => {
        const at = toValue(reference.value);
        return (
          <g key={`${reference.value}-${index}`} data-chart-reference>
            {horizontal
              ? <line x1={at} x2={at} y1={pad.top} y2={pad.top + plotH} stroke={theme.text} strokeDasharray="5 4" strokeOpacity="0.6" />
              : <line x1={pad.left} x2={pad.left + plotW} y1={at} y2={at} stroke={theme.text} strokeDasharray="5 4" strokeOpacity="0.6" />}
            {reference.label ? <text x={horizontal ? at + 4 : pad.left + plotW} y={horizontal ? pad.top + 10 : at - 5} fill={theme.text} fontSize="11" textAnchor={horizontal ? "start" : "end"}>{reference.label}</text> : null}
          </g>
        );
      })}
      {showX ? (horizontal
        ? <text transform={`translate(12 ${pad.top + plotH / 2}) rotate(-90)`} fill={theme.muted} fontSize="11" textAnchor="middle">{xName}</text>
        : <text x={pad.left + plotW / 2} y={height - 6} fill={theme.muted} fontSize="11" textAnchor="middle">{xName}</text>) : null}
      {showY ? (horizontal
        ? <text x={pad.left + plotW / 2} y={height - 6} fill={theme.muted} fontSize="11" textAnchor="middle">{yName}</text>
        : <text transform={`translate(12 ${pad.top + plotH / 2}) rotate(-90)`} fill={theme.muted} fontSize="11" textAnchor="middle">{yName}</text>) : null}
    </svg>
  );
};

const arc = (cx: number, cy: number, outer: number, inner: number, start: number, end: number) => {
  const sweep = Math.min(end - start, Math.PI * 2 - 0.0001);
  const point = (radius: number, angle: number) => [cx + radius * Math.sin(angle), cy - radius * Math.cos(angle)];
  const [x1, y1] = point(outer, start);
  const [x2, y2] = point(outer, start + sweep);
  const [x3, y3] = point(inner, start + sweep);
  const [x4, y4] = point(inner, start);
  const large = sweep > Math.PI ? 1 : 0;
  return `M${x1},${y1} A${outer},${outer} 0 ${large} 1 ${x2},${y2} L${x3},${y3} A${inner},${inner} 0 ${large} 0 ${x4},${y4} Z`;
};

const DonutChart = ({ chart, data, hiddenSeries, width, height, theme, yName, onHover, onPick }: {
  chart: DatabaseChartConfig;
  data: ChartData;
  hiddenSeries: ReadonlySet<string>;
  width: number;
  height: number;
  theme: Theme;
  yName: string;
  onHover: (hover: Hover) => void;
  onPick: (pick: Pick) => void;
}) => {
  const values = data.groups.map((group, index) => (hiddenSeries.has(group.key) ? 0 : Math.max(0, data.values[index]?.[0] ?? 0)));
  const total = values.reduce((sum, value) => sum + value, 0);
  const colors = paint(chart, data.groups, theme, values);
  const outer = Math.max(20, Math.min(width, height) / 2 - 24);
  const inner = outer * 0.62;
  const cx = width / 2;
  const cy = height / 2;
  const labelMode = chart.donutLabels ?? "none";
  let angle = 0;
  return (
    <svg width={width} height={height} role="img" aria-label={yName} data-chart-svg>
      {total === 0 ? <circle cx={cx} cy={cy} r={(outer + inner) / 2} fill="none" stroke={theme.grid} strokeWidth={outer - inner} /> : null}
      {data.groups.map((group, index) => {
        if (values[index] <= 0 || total === 0) return null;
        const start = angle;
        angle += (values[index] / total) * Math.PI * 2;
        const middle = (start + angle) / 2;
        const percent = Math.round((values[index] / total) * 100);
        const text = labelMode === "value" ? formatValue(values[index])
          : labelMode === "name" ? group.label
            : labelMode === "name_and_value" ? `${group.label} ${formatValue(values[index])}`
              : labelMode === "percent" ? `${percent}%` : "";
        const labelRadius = outer + 12;
        return (
          <g key={group.key}>
            <path d={arc(cx, cy, outer, inner, start, angle)} fill={colors[index]} stroke={theme.background} strokeWidth="1.5" className="cursor-pointer"
              onMouseMove={(event) => {
                const box = event.currentTarget.ownerSVGElement?.getBoundingClientRect();
                onHover({ x: event.clientX - (box?.left ?? 0), y: event.clientY - (box?.top ?? 0), title: group.label, detail: `${yName}: ${formatValue(values[index])} (${percent}%)` });
              }}
              onMouseLeave={() => onHover(null)}
              onClick={() => onPick({ group: index, series: 0 })}
              data-chart-slice />
            {text ? (
              <text x={cx + labelRadius * Math.sin(middle)} y={cy - labelRadius * Math.cos(middle) + 4} fill={theme.text} fontSize="11"
                textAnchor={Math.sin(middle) > 0.1 ? "start" : Math.sin(middle) < -0.1 ? "end" : "middle"}>{truncate(text, 24)}</text>
            ) : null}
          </g>
        );
      })}
      {chart.showValueInCenter ?? true ? (
        <>
          <text x={cx} y={cy + 6} fill={theme.text} fontSize="24" fontWeight="600" textAnchor="middle" data-chart-center>{formatValue(total)}</text>
          <text x={cx} y={cy + 24} fill={theme.muted} fontSize="11" textAnchor="middle">{yName}</text>
        </>
      ) : null}
    </svg>
  );
};

const NumberChart = ({ value, label, width, height, theme }: { value: number | null; label: string; width: number; height: number; theme: Theme }) => (
  <svg width={width} height={height} role="img" aria-label={`${label}: ${formatValue(value)}`} data-chart-svg>
    <text x={width / 2} y={height / 2 + 8} fill={theme.text} fontSize={Math.min(96, height / 2.4)} fontWeight="600" textAnchor="middle" data-chart-number>{formatValue(value ?? 0)}</text>
    <text x={width / 2} y={height / 2 + 8 + Math.min(40, height / 6)} fill={theme.muted} fontSize="13" textAnchor="middle">{label}</text>
  </svg>
);

/** Rows behind one bar, point or slice, like Notion's chart drilldown. */
const Drilldown = ({ db, title, rowIds, onClose }: { db: DatabaseHandle; title: string; rowIds: string[]; onClose: () => void }) => {
  const { t } = useTranslation();
  const openRow = useOpenRow(db);
  const rows = rowIds.flatMap((id) => db.rows.find((row) => row.id === id) ?? []);
  return (
    <Dialog open onOpenChange={(open) => { if (!open) onClose(); }}>
      <DialogContent className="max-h-[80vh] max-w-xl overflow-y-auto" data-chart-drilldown>
        <DialogHeader><DialogTitle>{title}</DialogTitle></DialogHeader>
        <p className="text-xs text-slate-500">{t("pages.db.chart.drilldownCount", { count: rows.length })}</p>
        <ul className="divide-y divide-slate-100 rounded border border-slate-200 text-sm">
          {rows.map((row) => (
            <li key={row.id}>
              <button type="button" className="flex w-full items-center gap-2 px-3 py-1.5 text-left hover:bg-slate-50" onClick={() => { onClose(); openRow(row); }}>
                {row.icon ? <span aria-hidden="true">{row.icon}</span> : null}
                <span className="truncate">{row.title || t("common.untitledMemo")}</span>
              </button>
            </li>
          ))}
        </ul>
      </DialogContent>
    </Dialog>
  );
};

export const yAxisLabel = (db: DatabaseHandle, chart: DatabaseChartConfig, t: (key: string, options?: Record<string, unknown>) => string) => {
  const property = chart.yPropertyId ? db.database.schema.properties.find((item) => item.id === chart.yPropertyId) : undefined;
  if (!property) return t("pages.db.chart.count");
  return t("pages.db.chart.aggregateOf", { aggregate: t(`pages.db.chart.aggregates.${chart.yAggregate ?? "sum"}`), name: property.name });
};

export const useChartData = (db: DatabaseHandle, rows: DatabaseViewProps["rows"], chart: DatabaseChartConfig) => {
  const { t } = useTranslation();
  return useMemo(() => {
    const titles = new Map<string, string>();
    for (const entry of db.related.values()) for (const row of entry.rows) titles.set(row.id, row.title || t("common.untitledMemo"));
    for (const row of db.rows) titles.set(row.id, row.title || t("common.untitledMemo"));
    return computeChart({
      schema: db.database.schema,
      rows,
      cells: db.cells,
      chart,
      names: { person: (id) => db.people.get(id) ?? id, row: (id) => titles.get(id) ?? id },
    });
  }, [chart, db.cells, db.database.schema, db.people, db.related, db.rows, rows, t]);
};

/** Notion's chart view: a bar, line, donut or number chart of the rows the view shows. */
export const ChartView = ({ db, rows, config }: DatabaseViewProps) => {
  const { t } = useTranslation();
  const { resolvedTheme } = useAppearanceTheme();
  const theme = THEMES[resolvedTheme === "dark" ? "dark" : "light"];
  const chart = config.chart ?? {};
  const type: ChartType = chart.type ?? "vertical_bar";
  const data = useChartData(db, rows, chart);
  const { ref, width } = useWidth();
  const [hover, setHover] = useState<Hover>(null);
  const [hiddenSeries, setHiddenSeries] = useState<ReadonlySet<string>>(() => new Set());
  const [drill, setDrill] = useState<{ title: string; rowIds: string[] } | null>(null);
  const height = PLOT_HEIGHTS[chart.height ?? "medium"];
  const xProperty = db.database.schema.properties.find((property) => property.id === chart.xPropertyId);
  const yName = yAxisLabel(db, chart, t);
  const legendItems = type === "donut" ? data.groups : data.series.length > 1 ? data.series : [];
  const showLegend = legendItems.length > 0 && (chart.legend ?? true);
  const legendColors = paint(chart, legendItems, theme);

  const pick = ({ group, series }: Pick) => {
    const groupLabel = data.groups[group]?.label ?? "";
    const ids = series === null ? [...new Set(data.rowIds[group].flat())] : data.rowIds[group][series];
    const seriesLabel = series !== null && data.series.length > 1 ? ` · ${data.series[series].label}` : "";
    setDrill({ title: `${groupLabel}${seriesLabel}`, rowIds: ids });
  };

  let body: ReactNode;
  if (type === "number") {
    body = <NumberChart value={data.total} label={yName} width={width} height={height} theme={theme} />;
  } else if (!xProperty) {
    body = <p className="flex items-center justify-center text-sm text-slate-500" style={{ height }}>{t("pages.db.chart.pickX")}</p>;
  } else if (type === "donut") {
    body = <DonutChart chart={chart} data={data} hiddenSeries={hiddenSeries} width={width} height={height} theme={theme} yName={yName} onHover={setHover} onPick={pick} />;
  } else {
    body = <AxisChart chart={chart} data={data} hiddenSeries={hiddenSeries} width={width} height={height} theme={theme} xName={xProperty.name} yName={yName} onHover={setHover} onPick={pick} />;
  }

  return (
    <div className="min-w-0" data-db-chart={type}>
      <div ref={ref} className="relative w-full" onMouseLeave={() => setHover(null)}>
        {body}
        {hover ? (
          <div className="pointer-events-none absolute z-10 rounded-md border border-slate-200 bg-[var(--card)] px-2 py-1 text-xs shadow-md" style={{ left: Math.min(hover.x + 12, width - 160), top: Math.max(0, hover.y - 40) }} role="status" data-chart-tooltip>
            <div className="font-medium text-slate-900">{hover.title}</div>
            <div className="text-slate-500">{hover.detail}</div>
          </div>
        ) : null}
      </div>
      {showLegend ? (
        <div className="mt-2 flex flex-wrap justify-center gap-x-3 gap-y-1 text-xs text-slate-600" data-chart-legend>
          {legendItems.map((item, index) => {
            const off = hiddenSeries.has(item.key);
            return (
              <button key={item.key} type="button" className={cn("flex items-center gap-1.5 rounded px-1 hover:bg-slate-100", off && "opacity-40")} aria-pressed={!off}
                onClick={() => setHiddenSeries((current) => {
                  const next = new Set(current);
                  if (next.has(item.key)) next.delete(item.key);
                  else next.add(item.key);
                  return next;
                })}>
                <span className="h-2 w-2 rounded-full" style={{ background: legendColors[index] }} aria-hidden="true" />{item.label}
              </button>
            );
          })}
        </div>
      ) : null}
      {data.truncated ? <p className="mt-1 text-xs text-slate-500">{t("pages.db.chart.truncated")}</p> : null}
      {chart.caption !== null && chart.caption !== undefined ? <p className="mt-2 text-sm text-slate-500" data-chart-caption>{chart.caption}</p> : null}
      {drill ? <Drilldown db={db} title={drill.title} rowIds={drill.rowIds} onClose={() => setDrill(null)} /> : null}
    </div>
  );
};

/* ---------- Settings, laid out like Notion's "Edit chart" panel ---------- */

const TYPE_ICONS: Record<ChartType, typeof ChartColumn> = {
  vertical_bar: ChartColumn,
  horizontal_bar: ChartBar,
  line: ChartLine,
  donut: ChartPie,
  number: Hash,
};

const Section = ({ title, children }: { title: string; children: ReactNode }) => (
  <div className="space-y-1.5 border-t border-slate-100 pt-2 first:border-t-0 first:pt-0">
    <p className="text-xs font-medium text-slate-500">{title}</p>
    {children}
  </div>
);

const Row = ({ label, children }: { label: string; children: ReactNode }) => (
  <label className="flex min-h-7 items-center justify-between gap-3 text-sm">
    <span className="shrink-0">{label}</span>
    {children}
  </label>
);

const Choice = <T extends string>({ value, options, label, onChange }: { value: T; options: readonly { value: T; label: string }[]; label: string; onChange: (value: T) => void }) => (
  <Select value={value} onValueChange={(next) => onChange(next as T)}>
    <SelectTrigger className="h-7 w-40 text-xs" aria-label={label}><SelectValue /></SelectTrigger>
    <SelectContent>{options.map((option) => <SelectItem key={option.value} value={option.value}>{option.label}</SelectItem>)}</SelectContent>
  </Select>
);

const COUNT = "__count";
const NONE = "__none";

const exportSvg = (root: HTMLElement | null, background: string) => {
  const svg = root?.querySelector<SVGSVGElement>("[data-chart-svg]");
  if (!svg) return null;
  const copy = svg.cloneNode(true) as SVGSVGElement;
  copy.setAttribute("xmlns", "http://www.w3.org/2000/svg");
  copy.style.fontFamily = getComputedStyle(svg).fontFamily;
  copy.insertBefore(Object.assign(document.createElementNS("http://www.w3.org/2000/svg", "rect"), {}), copy.firstChild);
  const backdrop = copy.firstChild as SVGRectElement;
  backdrop.setAttribute("width", svg.getAttribute("width") ?? "0");
  backdrop.setAttribute("height", svg.getAttribute("height") ?? "0");
  backdrop.setAttribute("fill", background);
  return { text: new XMLSerializer().serializeToString(copy), width: Number(svg.getAttribute("width")), height: Number(svg.getAttribute("height")) };
};

const toPng = async (svg: { text: string; width: number; height: number }) => {
  const image = new Image();
  image.src = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg.text)}`;
  await image.decode();
  const canvas = document.createElement("canvas");
  canvas.width = svg.width * 2;
  canvas.height = svg.height * 2;
  const context = canvas.getContext("2d")!;
  context.scale(2, 2);
  context.drawImage(image, 0, 0);
  return new Promise<Blob>((resolve, reject) => canvas.toBlob((blob) => (blob ? resolve(blob) : reject(new Error("PNG failed"))), "image/png"));
};

const download = (blob: Blob, name: string) => {
  const link = document.createElement("a");
  link.href = URL.createObjectURL(blob);
  link.download = name;
  link.click();
  window.setTimeout(() => URL.revokeObjectURL(link.href), 1000);
};

export const ChartSettings = ({ db, config, update, rows, viewName }: {
  db: DatabaseHandle;
  config: DatabaseViewConfig;
  update: (patch: Partial<DatabaseViewConfig>) => void;
  rows: DatabaseViewProps["rows"];
  viewName: string;
}) => {
  const { t } = useTranslation();
  const { resolvedTheme } = useAppearanceTheme();
  const chart = config.chart ?? {};
  const set = (patch: Partial<DatabaseChartConfig>) => update({ chart: { ...chart, ...patch } });
  const type: ChartType = chart.type ?? "vertical_bar";
  const data = useChartData(db, rows, chart);
  const [saved, setSaved] = useState<string | null>(null);
  const groupable = chartGroupableProperties(db.database.schema);
  const numbers = chartNumberProperties(db.database.schema);
  const xProperty = groupable.find((property) => property.id === chart.xPropertyId);
  const isDate = xProperty && ["date", "created_time", "last_edited_time"].includes(xProperty.type);
  const axis = type === "vertical_bar" || type === "horizontal_bar" || type === "line";
  const hidden = new Set(chart.hiddenGroups ?? []);
  const allGroups = [...data.groups, ...data.hiddenGroups];
  const fileName = (viewName || "chart").replace(/[^\w.-]+/g, "-");

  const whatToShow = (
    <>
      <Row label={t("pages.db.chart.whatToShow")}>
        <Choice
          label={t("pages.db.chart.yWhatToShow")}
          value={chart.yPropertyId ?? COUNT}
          options={[{ value: COUNT, label: t("pages.db.chart.count") }, ...numbers.map((property) => ({ value: property.id, label: property.name }))]}
          onChange={(value) => set({ yPropertyId: value === COUNT ? null : value })}
        />
      </Row>
      {chart.yPropertyId ? (
        <Row label={t("pages.db.chart.aggregate")}>
          <Choice label={t("pages.db.chart.aggregate")} value={chart.yAggregate ?? "sum"} options={CHART_AGGREGATES.map((value) => ({ value, label: t(`pages.db.chart.aggregates.${value}`) }))} onChange={(yAggregate) => set({ yAggregate })} />
        </Row>
      ) : null}
    </>
  );

  return (
    <div className="max-h-[70vh] w-full space-y-3 overflow-y-auto pr-1" data-chart-settings>
      <Section title={t("pages.db.chart.chartType")}>
        <TooltipProvider delayDuration={200}>
          <div className="grid grid-cols-5 gap-1.5">
            {(Object.keys(TYPE_ICONS) as ChartType[]).map((value) => {
              const Icon = TYPE_ICONS[value];
              return (
                <Tooltip key={value}>
                  <TooltipTrigger asChild>
                    <button type="button" aria-label={t(`pages.db.chart.types.${value}`)} aria-pressed={type === value}
                      className={cn("flex h-9 items-center justify-center rounded-md border border-slate-200 text-slate-600 hover:bg-slate-50", type === value && "border-[#2383e2] text-[#2383e2] ring-1 ring-[#2383e2]")}
                      onClick={() => set({ type: value })}>
                      <Icon className="h-4 w-4" aria-hidden="true" />
                    </button>
                  </TooltipTrigger>
                  <TooltipContent>{t(`pages.db.chart.types.${value}`)}</TooltipContent>
                </Tooltip>
              );
            })}
          </div>
        </TooltipProvider>
      </Section>

      {type === "number" ? <Section title={t("pages.db.chart.data")}>{whatToShow}</Section> : (
        <Section title={type === "donut" ? t("pages.db.chart.data") : t("pages.db.chart.xAxis")}>
          {type === "donut" ? whatToShow : null}
          <Row label={type === "donut" ? t("pages.db.chart.eachSlice") : t("pages.db.chart.whatToShow")}>
            <Choice label={t("pages.db.chart.xWhatToShow")} value={chart.xPropertyId ?? NONE}
              options={[{ value: NONE, label: t("pages.db.none") }, ...groupable.map((property) => ({ value: property.id, label: property.name }))]}
              onChange={(value) => set({ xPropertyId: value === NONE ? null : value, hiddenGroups: [] })} />
          </Row>
          {isDate ? (
            <Row label={t("pages.db.chart.dateGroup")}>
              <Choice label={t("pages.db.chart.dateGroup")} value={chart.dateGroup ?? "month"} options={CHART_DATE_GROUPS.map((value) => ({ value, label: t(`pages.db.chart.dateGroups.${value}`) }))} onChange={(dateGroup) => set({ dateGroup })} />
            </Row>
          ) : null}
          <Row label={t("pages.db.chart.sortBy")}>
            <Choice label={t("pages.db.chart.sortBy")} value={chart.xSort ?? "manual"}
              options={CHART_X_SORTS.map((value) => ({ value, label: t(`pages.db.chart.sorts.${value}`, { name: xProperty?.name ?? "" }) }))}
              onChange={(xSort) => set({ xSort })} />
          </Row>
          <Row label={t("pages.db.chart.omitZero")}><Switch checked={chart.omitZero ?? false} onCheckedChange={(omitZero) => set({ omitZero })} /></Row>
          {allGroups.length > 0 ? (
            <details className="text-sm">
              <summary className="cursor-pointer text-xs text-slate-500">{t("pages.db.chart.groups", { shown: data.groups.length, total: allGroups.length })}</summary>
              <ul className="mt-1 max-h-40 space-y-0.5 overflow-y-auto">
                {allGroups.map((group) => {
                  const off = hidden.has(group.key);
                  return (
                    <li key={group.key} className="flex items-center justify-between gap-2">
                      <span className={cn("truncate", off && "text-slate-400")}>{group.label}</span>
                      <button type="button" className="rounded p-0.5 text-slate-500 hover:bg-slate-100" aria-label={t(off ? "pages.db.chart.showGroup" : "pages.db.chart.hideGroup", { name: group.label })}
                        onClick={() => set({ hiddenGroups: off ? [...hidden].filter((key) => key !== group.key) : [...hidden, group.key] })}>
                        {off ? <EyeOff className="h-3.5 w-3.5" aria-hidden="true" /> : <Eye className="h-3.5 w-3.5" aria-hidden="true" />}
                      </button>
                    </li>
                  );
                })}
              </ul>
            </details>
          ) : null}
        </Section>
      )}

      {axis ? (
        <Section title={t("pages.db.chart.yAxis")}>
          {whatToShow}
          <Row label={t("pages.db.chart.groupBy")}>
            <Choice label={t("pages.db.chart.groupBy")} value={chart.groupByPropertyId ?? NONE}
              options={[{ value: NONE, label: t("pages.db.none") }, ...groupable.filter((property) => property.id !== chart.xPropertyId).map((property) => ({ value: property.id, label: property.name }))]}
              onChange={(value) => set({ groupByPropertyId: value === NONE ? null : value })} />
          </Row>
          {!chart.yPropertyId || (chart.yAggregate ?? "sum") === "sum" ? (
            <Row label={t("pages.db.chart.cumulative")}><Switch checked={chart.cumulative ?? false} onCheckedChange={(cumulative) => set({ cumulative })} /></Row>
          ) : null}
          <Row label={t("pages.db.chart.range")}>
            <span className="flex w-40 items-center gap-1">
              <Input className="h-7 px-1.5 text-xs" inputMode="decimal" placeholder={t("pages.db.chart.auto")} aria-label={t("pages.db.chart.rangeMin")} defaultValue={chart.rangeMin ?? ""}
                onBlur={(event) => { const value = event.target.value.trim(); set({ rangeMin: value === "" || !Number.isFinite(Number(value)) ? null : Number(value) }); }} />
              <span className="text-slate-400">–</span>
              <Input className="h-7 px-1.5 text-xs" inputMode="decimal" placeholder={t("pages.db.chart.auto")} aria-label={t("pages.db.chart.rangeMax")} defaultValue={chart.rangeMax ?? ""}
                onBlur={(event) => { const value = event.target.value.trim(); set({ rangeMax: value === "" || !Number.isFinite(Number(value)) ? null : Number(value) }); }} />
            </span>
          </Row>
          <div className="space-y-1">
            <div className="flex items-center justify-between text-sm">
              {t("pages.db.chart.referenceLines", { count: chart.referenceLines?.length ?? 0 })}
              {(chart.referenceLines?.length ?? 0) < 5 ? (
                <button type="button" className="rounded p-0.5 text-slate-500 hover:bg-slate-100" aria-label={t("pages.db.chart.addReferenceLine")}
                  onClick={() => set({ referenceLines: [...(chart.referenceLines ?? []), { value: 0, label: "" }] })}>
                  <Plus className="h-3.5 w-3.5" aria-hidden="true" />
                </button>
              ) : null}
            </div>
            {(chart.referenceLines ?? []).map((reference, index) => (
              <div key={index} className="flex items-center gap-1">
                <Input className="h-7 w-20 px-1.5 text-xs" inputMode="decimal" defaultValue={reference.value} aria-label={t("pages.db.chart.referenceValue")}
                  onBlur={(event) => {
                    const value = Number(event.target.value);
                    if (!Number.isFinite(value)) return;
                    set({ referenceLines: (chart.referenceLines ?? []).map((item, at) => (at === index ? { ...item, value } : item)) });
                  }} />
                <Input className="h-7 min-w-0 flex-1 px-1.5 text-xs" maxLength={60} defaultValue={reference.label} placeholder={t("pages.db.chart.referenceLabel")} aria-label={t("pages.db.chart.referenceLabel")}
                  onBlur={(event) => set({ referenceLines: (chart.referenceLines ?? []).map((item, at) => (at === index ? { ...item, label: event.target.value.trim() } : item)) })} />
                <button type="button" className="rounded p-1 text-slate-500 hover:bg-slate-100" aria-label={t("pages.db.chart.removeReferenceLine")}
                  onClick={() => set({ referenceLines: (chart.referenceLines ?? []).filter((_, at) => at !== index) })}>
                  <Trash2 className="h-3.5 w-3.5" aria-hidden="true" />
                </button>
              </div>
            ))}
          </div>
        </Section>
      ) : null}

      <Section title={t("pages.db.chart.style")}>
        {type !== "number" ? (
          <Row label={t("pages.db.chart.color")}>
            <Choice label={t("pages.db.chart.color")} value={chart.color ?? "auto"} options={CHART_COLORS.map((value) => ({ value, label: t(`pages.db.chart.colors.${value}`) }))} onChange={(color) => set({ color })} />
          </Row>
        ) : null}
        <Row label={t("pages.db.chart.height")}>
          <Choice label={t("pages.db.chart.height")} value={chart.height ?? "medium"} options={CHART_HEIGHTS.map((value) => ({ value, label: t(`pages.db.chart.heights.${value}`) }))} onChange={(height) => set({ height })} />
        </Row>
        {axis ? (
          <>
            <Row label={t("pages.db.chart.gridLine")}>
              <Choice label={t("pages.db.chart.gridLine")} value={chart.gridLine ?? "horizontal"} options={CHART_GRID_LINES.map((value) => ({ value, label: t(`pages.db.chart.gridLines.${value}`) }))} onChange={(gridLine) => set({ gridLine })} />
            </Row>
            <Row label={t("pages.db.chart.axisName")}>
              <Choice label={t("pages.db.chart.axisName")} value={chart.axisName ?? "none"} options={CHART_AXIS_NAMES.map((value) => ({ value, label: t(`pages.db.chart.axisNames.${value}`) }))} onChange={(axisName) => set({ axisName })} />
            </Row>
            <Row label={t("pages.db.chart.dataLabels")}><Switch checked={chart.dataLabels ?? true} onCheckedChange={(dataLabels) => set({ dataLabels })} /></Row>
          </>
        ) : null}
        {type === "donut" ? (
          <>
            <Row label={t("pages.db.chart.dataLabels")}>
              <Choice label={t("pages.db.chart.dataLabels")} value={chart.donutLabels ?? "none"} options={CHART_DONUT_LABELS.map((value) => ({ value, label: t(`pages.db.chart.donutLabels.${value}`) }))} onChange={(donutLabels) => set({ donutLabels })} />
            </Row>
            <Row label={t("pages.db.chart.showValueInCenter")}><Switch checked={chart.showValueInCenter ?? true} onCheckedChange={(showValueInCenter) => set({ showValueInCenter })} /></Row>
          </>
        ) : null}
        {type === "line" ? (
          <>
            <Row label={t("pages.db.chart.smoothLine")}><Switch checked={chart.smoothLine ?? false} onCheckedChange={(smoothLine) => set({ smoothLine })} /></Row>
            <Row label={t("pages.db.chart.gradientArea")}><Switch checked={chart.gradientArea ?? false} onCheckedChange={(gradientArea) => set({ gradientArea })} /></Row>
          </>
        ) : null}
        {(type === "vertical_bar" || type === "horizontal_bar" || type === "donut") && !["auto", "colorful", "colorless"].includes(chart.color ?? "auto") ? (
          <Row label={t("pages.db.chart.colorByValue")}><Switch checked={chart.colorByValue ?? false} onCheckedChange={(colorByValue) => set({ colorByValue })} /></Row>
        ) : null}
        {type === "line" || type === "donut" || chart.groupByPropertyId ? (
          <Row label={t("pages.db.chart.legend")}><Switch checked={chart.legend ?? true} onCheckedChange={(legend) => set({ legend })} /></Row>
        ) : null}
        <Row label={t("pages.db.chart.caption")}>
          <Switch checked={chart.caption !== null && chart.caption !== undefined} onCheckedChange={(on) => set({ caption: on ? "" : null })} />
        </Row>
        {chart.caption !== null && chart.caption !== undefined ? (
          <Input className="h-7 text-xs" maxLength={500} defaultValue={chart.caption} placeholder={t("pages.db.chart.captionPlaceholder")} aria-label={t("pages.db.chart.caption")}
            onBlur={(event) => set({ caption: event.target.value })} />
        ) : null}
      </Section>

      <Section title={t("pages.db.chart.saveAs")}>
        <div className="flex flex-wrap gap-1">
          {(["png", "svg", "copy"] as const).map((kind) => (
            <button key={kind} type="button" className="flex items-center gap-1 rounded border border-slate-200 px-2 py-1 text-xs hover:bg-slate-50" onClick={async () => {
              const root = document.querySelector<HTMLElement>(`[data-database-id="${db.database.id}"] [data-db-chart]`);
              const svg = exportSvg(root, THEMES[resolvedTheme === "dark" ? "dark" : "light"].background);
              if (!svg) return;
              try {
                if (kind === "svg") download(new Blob([svg.text], { type: "image/svg+xml" }), `${fileName}.svg`);
                else if (kind === "png") download(await toPng(svg), `${fileName}.png`);
                else await navigator.clipboard.write([new ClipboardItem({ "image/png": await toPng(svg) })]);
                setSaved(t(`pages.db.chart.saved.${kind}`));
              } catch {
                setSaved(t("pages.db.chart.saveFailed"));
              }
            }}>
              {kind === "copy" ? null : <Download className="h-3 w-3" aria-hidden="true" />}{t(`pages.db.chart.save.${kind}`)}
            </button>
          ))}
        </div>
        {saved ? <p className="flex items-center justify-between text-xs text-slate-500" role="status">{saved}<button type="button" aria-label={t("pages.db.dismiss")} onClick={() => setSaved(null)}><X className="h-3 w-3" aria-hidden="true" /></button></p> : null}
      </Section>
    </div>
  );
};

/** The /chart command, like Notion's: chart one of your databases, or start a new one. */
export const ChartInsertDialog = ({ databases, onPick, onClose }: {
  databases: { id: string; databaseId: string; title: string | null; icon: string | null }[];
  /** Null starts a new database. */
  onPick: (databaseId: string | null) => void;
  onClose: () => void;
}) => {
  const { t } = useTranslation();
  const [query, setQuery] = useState("");
  const shown = databases.filter((item) => (item.title ?? "").toLowerCase().includes(query.trim().toLowerCase()));
  const item = "flex w-full items-center gap-2 rounded px-2 py-1.5 text-left text-sm hover:bg-slate-100";
  return (
    <Dialog open onOpenChange={(open) => { if (!open) onClose(); }}>
      <DialogContent className="max-w-md" data-chart-insert>
        <DialogHeader><DialogTitle>{t("pages.db.chart.insertTitle")}</DialogTitle></DialogHeader>
        <p className="text-xs text-slate-500">{t("pages.db.chart.insertHint")}</p>
        <Input autoFocus value={query} placeholder={t("pages.db.search")} aria-label={t("pages.db.search")} onChange={(event) => setQuery(event.target.value)} />
        <div className="max-h-72 overflow-y-auto">
          <button type="button" className={item} onClick={() => onPick(null)}>
            <Plus className="h-4 w-4 text-slate-500" aria-hidden="true" />{t("pages.db.chart.newDatabase")}
          </button>
          {shown.map((database) => (
            <button key={database.id} type="button" className={item} onClick={() => onPick(database.databaseId)}>
              <span className="w-4 text-center" aria-hidden="true">{database.icon ?? <ChartColumn className="h-4 w-4 text-slate-500" />}</span>
              <span className="truncate">{database.title || t("common.untitledMemo")}</span>
            </button>
          ))}
        </div>
      </DialogContent>
    </Dialog>
  );
};
