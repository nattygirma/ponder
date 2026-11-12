import { createContext, useContext, useMemo, useRef, useState, type DragEvent, type ReactNode } from "react";
import { useTranslation } from "react-i18next";
import { ChevronDown, ChevronLeft, ChevronRight, CornerDownRight, ExternalLink, GripVertical, Plus, Trash2 } from "lucide-react";
import {
  groupRows,
  nestRows,
  type DatabaseDateValue,
  type DatabaseProperty,
  type DatabasePropertyValue,
  type DatabaseRow,
  type DatabaseViewConfig,
} from "@ponder/shared";
import { Button } from "@/components/ui/button";
import { usePages } from "@/components/pages/PagesProvider";
import { cn } from "@/lib/utils";
import { DatabaseCell, OptionChip, RowTitle } from "./DatabaseCell";
import { AddPropertyMenu, PropertyMenu } from "./PropertyMenu";
import { SyncedMark } from "./DatabaseSync";
import type { DatabaseHandle } from "./useDatabase";
import { isDesktopViewport } from "@/lib/workspace-shell";

const PAGE_SIZE = 100;
const ROW_DRAG_MIME = "application/x-ponder-database-row";

export type DatabaseViewProps = {
  db: DatabaseHandle;
  rows: DatabaseRow[];
  config: DatabaseViewConfig;
  visible: DatabaseProperty[];
  updateConfig: (patch: Partial<DatabaseViewConfig>) => void;
};

/** Set by the database surface so a row opens beside the table instead of replacing it. */
export const RowPeekContext = createContext<((rowId: string) => void) | null>(null);

export const useOpenRow = (db: DatabaseHandle) => {
  const pages = usePages();
  const peek = useContext(RowPeekContext);
  return (row: Pick<DatabaseRow, "id">) => {
    // A phone has no room beside the table, so the row opens as its own page.
    if (peek && isDesktopViewport()) peek(row.id);
    else pages?.openPage({ id: row.id, notebookId: db.database.notebookId });
  };
};

const rowDrag = (rowId: string) => (event: DragEvent) => {
  event.dataTransfer.setData(ROW_DRAG_MIME, rowId);
  event.dataTransfer.effectAllowed = "move";
};
const draggedRow = (event: DragEvent) => event.dataTransfer.getData(ROW_DRAG_MIME);
const allowRowDrop = (event: DragEvent) => {
  if (event.dataTransfer.types.includes(ROW_DRAG_MIME)) event.preventDefault();
};

/** A value that makes a row belong to the given group; empty groups clear the property. */
const groupValue = (property: DatabaseProperty, key: string, optionId: string | null): DatabasePropertyValue => {
  if (property.type === "checkbox") return key === "checked";
  return optionId ?? null;
};

const LoadMore = ({ shown, total, onMore }: { shown: number; total: number; onMore: () => void }) => {
  const { t } = useTranslation();
  if (shown >= total) return null;
  return <Button variant="ghost" size="sm" className="mt-1 text-slate-500" onClick={onMore}>{t("pages.db.loadMore", { count: total - shown })}</Button>;
};

const Column = ({ db, property, config, updateConfig, width }: {
  db: DatabaseHandle;
  property: DatabaseProperty;
  config: DatabaseViewConfig;
  updateConfig: DatabaseViewProps["updateConfig"];
  width: number;
}) => {
  const [dragWidth, setDragWidth] = useState<number | null>(null);
  const start = useRef(0);
  const hide = property.type === "title" ? undefined : () => updateConfig({
    visiblePropertyIds: db.database.schema.properties
      .filter((item) => item.id !== property.id && (config.visiblePropertyIds ? config.visiblePropertyIds.includes(item.id) : true))
      .map((item) => item.id),
  });
  return (
    <th className="relative border-b border-r border-slate-200 p-0 text-left text-xs font-normal text-slate-500" style={{ width: dragWidth ?? width, minWidth: dragWidth ?? width }}>
      <PropertyMenu db={db} property={property} onHide={hide}>
        <button type="button" className={cn("flex w-full min-w-0 items-center gap-1 px-2 py-1.5 text-left hover:bg-slate-50", db.isSynced(property) && "pr-6")}>
          <span className="truncate">{property.name}</span>
        </button>
      </PropertyMenu>
      {db.isSynced(property) ? <SyncedMark className="absolute right-2 top-2" /> : null}
      <span
        aria-hidden="true"
        className="absolute inset-y-0 -right-0.5 z-10 w-1 cursor-col-resize hover:bg-slate-300"
        onPointerDown={(event) => {
          start.current = event.clientX - width;
          event.currentTarget.setPointerCapture(event.pointerId);
          setDragWidth(width);
        }}
        onPointerMove={(event) => {
          if (dragWidth !== null) setDragWidth(Math.min(2000, Math.max(60, event.clientX - start.current)));
        }}
        onPointerUp={() => {
          if (dragWidth !== null) updateConfig({ columnWidths: { ...config.columnWidths, [property.id]: dragWidth } });
          setDragWidth(null);
        }}
      />
    </th>
  );
};

export const TableView = ({ db, rows, config, visible, updateConfig }: DatabaseViewProps) => {
  const { t } = useTranslation();
  const openRow = useOpenRow(db);
  const [limit, setLimit] = useState(PAGE_SIZE);
  const [expanded, setExpanded] = useState<ReadonlySet<string>>(() => new Set());
  const subItems = db.database.schema.subItems;
  const display = subItems ? config.subItemsDisplay ?? "nested" : "disabled";
  const nested = useMemo(
    () => (subItems && display === "nested" && !config.groupByPropertyId ? nestRows({ rows, parentPropertyId: subItems.parentPropertyId, expanded }) : null),
    [config.groupByPropertyId, display, expanded, rows, subItems],
  );
  // A flattened list names each sub-item's parent in front of its title, as Notion does.
  const parentName = useMemo(() => {
    if (!subItems || display !== "flattened") return () => null;
    const titles = new Map(db.rows.map((item) => [item.id, item.title || t("common.untitledMemo")]));
    return (row: DatabaseRow) => {
      const parents = row.properties[subItems.parentPropertyId];
      const parentId = Array.isArray(parents) ? parents[0] : null;
      return typeof parentId === "string" ? titles.get(parentId) ?? null : null;
    };
  }, [db.rows, display, subItems, t]);
  const depthOf = useMemo(() => new Map((nested ?? []).map((item) => [item.row.id, item])), [nested]);
  const toggle = (rowId: string, open?: boolean) => setExpanded((current) => {
    const next = new Set(current);
    if (open ?? !next.has(rowId)) next.add(rowId);
    else next.delete(rowId);
    return next;
  });
  const addSubItem = async (parent: DatabaseRow) => {
    if (!subItems) return;
    toggle(parent.id, true);
    await db.addRow({ properties: { [subItems.parentPropertyId]: [parent.id] } });
  };
  const canReorder = !config.sorts?.length && !config.groupByPropertyId && !nested;
  const widthOf = (property: DatabaseProperty) => config.columnWidths?.[property.id] ?? (property.type === "title" ? 280 : 180);

  const groups = config.groupByPropertyId
    ? groupRows({ schema: db.database.schema, rows, cells: db.cells, propertyId: config.groupByPropertyId })
    : null;
  const groupProperty = db.database.schema.properties.find((item) => item.id === config.groupByPropertyId);

  const renderRow = (row: DatabaseRow) => {
    const place = depthOf.get(row.id);
    const name = row.title || t("common.untitledMemo");
    return (
    <tr
      key={row.id}
      className="group/row hover:bg-slate-50"
      onDragOver={canReorder ? allowRowDrop : undefined}
      onDrop={canReorder ? (event) => {
        const id = draggedRow(event);
        if (id && id !== row.id) void db.moveRow(id, { beforeId: row.id });
      } : undefined}
    >
      {visible.map((property, index) => (
        <td key={property.id} className="relative border-b border-r border-slate-100 px-2 py-1.5 align-top text-sm">
          {index === 0 ? (
            <div className="flex items-center gap-1" style={place ? { paddingLeft: place.depth * 20 } : undefined}>
              {place ? (
                place.childCount > 0 ? (
                  <button
                    type="button"
                    className="shrink-0 rounded p-0.5 text-slate-500 hover:bg-slate-200"
                    aria-expanded={expanded.has(row.id)}
                    aria-label={t(expanded.has(row.id) ? "pages.db.collapseRow" : "pages.db.expandRow", { name })}
                    onClick={() => toggle(row.id)}
                  >
                    {expanded.has(row.id) ? <ChevronDown className="h-3.5 w-3.5" aria-hidden="true" /> : <ChevronRight className="h-3.5 w-3.5" aria-hidden="true" />}
                  </button>
                ) : <span className="w-[18px] shrink-0" aria-hidden="true" />
              ) : null}
              {canReorder ? (
                <span draggable onDragStart={rowDrag(row.id)} className="absolute -left-5 top-1.5 cursor-grab text-slate-300 opacity-0 group-hover/row:opacity-100" aria-hidden="true">
                  <GripVertical className="h-4 w-4" />
                </span>
              ) : null}
              {parentName(row) ? (
                <span className="flex max-w-[40%] shrink-0 items-center gap-0.5 truncate text-xs text-slate-400" data-db-parent-name>
                  {parentName(row)}<ChevronRight className="h-3 w-3 shrink-0" aria-hidden="true" />
                </span>
              ) : null}
              <div className="min-w-0 flex-1"><DatabaseCell db={db} row={row} property={property} /></div>
              <span className="flex shrink-0 gap-0.5 opacity-0 focus-within:opacity-100 group-hover/row:opacity-100 max-lg:opacity-100">
                <button type="button" className="rounded p-0.5 text-slate-500 hover:bg-slate-200" aria-label={t("pages.db.openRow")} onClick={() => openRow(row)}>
                  <ExternalLink className="h-3.5 w-3.5" aria-hidden="true" />
                </button>
                {subItems ? (
                  <button type="button" className="rounded p-0.5 text-slate-500 hover:bg-slate-200" aria-label={`${t("pages.db.newSubItem")}: ${name}`} onClick={() => void addSubItem(row)}>
                    <CornerDownRight className="h-3.5 w-3.5" aria-hidden="true" />
                  </button>
                ) : null}
                <button type="button" className="rounded p-0.5 text-slate-500 hover:bg-slate-200" aria-label={t("pages.db.deleteRow")} onClick={() => void db.deleteRow(row.id)}>
                  <Trash2 className="h-3.5 w-3.5" aria-hidden="true" />
                </button>
              </span>
            </div>
          ) : <DatabaseCell db={db} row={row} property={property} />}
        </td>
      ))}
      <td className="border-b border-slate-100" />
    </tr>
    );
  };
  const flat = nested ? nested.map((item) => item.row) : rows;

  return (
    <div className="overflow-x-auto pl-5" data-db-table>
      <table className="w-max min-w-full border-collapse">
        <thead>
          <tr>
            {visible.map((property) => (
              <Column key={property.id} db={db} property={property} config={config} updateConfig={updateConfig} width={widthOf(property)} />
            ))}
            <th className="border-b border-slate-200 p-0 text-left">
              <AddPropertyMenu db={db}>
                <button type="button" className="px-2 py-1.5 text-slate-400 hover:bg-slate-50" aria-label={t("pages.db.addProperty")}>
                  <Plus className="h-4 w-4" aria-hidden="true" />
                </button>
              </AddPropertyMenu>
            </th>
          </tr>
        </thead>
        <tbody>
          {groups
            ? groups.map((group) => (
              <GroupRows key={group.key} colSpan={visible.length + 1} heading={group.optionId && group.color ? <OptionChip option={{ name: group.label, color: group.color }} /> : group.label || t("pages.db.noValue")} count={group.rows.length}>
                {group.rows.slice(0, PAGE_SIZE).map(renderRow)}
                {db.sync ? null : (
                  <tr><td colSpan={visible.length + 1}>
                    <button type="button" className="px-2 py-1 text-xs text-slate-400 hover:text-slate-700" onClick={() => {
                      if (groupProperty) void db.addRow({ properties: { [groupProperty.id]: groupValue(groupProperty, group.key, group.optionId) } });
                    }}>+ {t("pages.db.newRow")}</button>
                  </td></tr>
                )}
              </GroupRows>
            ))
            : flat.slice(0, limit).map(renderRow)}
        </tbody>
      </table>
      {groups ? null : <LoadMore shown={Math.min(limit, flat.length)} total={flat.length} onMore={() => setLimit((current) => current + PAGE_SIZE)} />}
      {groups || db.sync ? null : (
        <button type="button" className="mt-0.5 block w-full rounded px-2 py-1.5 text-left text-sm text-slate-400 hover:bg-slate-50" onClick={() => void db.addRow()}>
          + {t("pages.db.newRow")}
        </button>
      )}
    </div>
  );
};

const GroupRows = ({ heading, count, colSpan, children }: { heading: ReactNode; count: number; colSpan: number; children: ReactNode }) => (
  <>
    <tr><td colSpan={colSpan} className="px-2 pb-1 pt-4 text-sm font-medium"><span className="flex items-center gap-2">{heading}<span className="text-xs font-normal text-slate-400">{count}</span></span></td></tr>
    {children}
  </>
);

const Card = ({ db, row, visible, children }: { db: DatabaseHandle; row: DatabaseRow; visible: DatabaseProperty[]; children?: ReactNode }) => {
  const { t } = useTranslation();
  const openRow = useOpenRow(db);
  return (
    <div className="group/card relative rounded-md border border-slate-200 bg-card p-2 text-sm shadow-sm">
      {children}
      <button type="button" className="absolute right-1 top-1 rounded bg-card p-0.5 text-slate-500 opacity-0 hover:bg-slate-100 focus-visible:opacity-100 group-hover/card:opacity-100 max-lg:opacity-100" aria-label={t("pages.db.openRow")} onClick={() => openRow(row)}>
        <ExternalLink className="h-3.5 w-3.5" aria-hidden="true" />
      </button>
      <div className="pr-5 font-medium"><RowTitle db={db} row={row} /></div>
      {visible.filter((property) => property.type !== "title").map((property) => (
        <div key={property.id} className="mt-1 min-w-0 text-xs text-slate-600"><DatabaseCell db={db} row={row} property={property} /></div>
      ))}
    </div>
  );
};

export const BoardView = ({ db, rows, config, visible, updateConfig }: DatabaseViewProps) => {
  const { t } = useTranslation();
  const groupable = db.database.schema.properties.filter((property) => property.type === "select" || property.type === "status" || property.type === "checkbox");
  const property = groupable.find((item) => item.id === config.groupByPropertyId) ?? groupable[0];
  const groups = useMemo(
    () => (property ? groupRows({ schema: db.database.schema, rows, cells: db.cells, propertyId: property.id }) : []),
    [db.cells, db.database.schema, property, rows],
  );
  if (!property) {
    return (
      <div className="rounded border border-dashed border-slate-300 p-6 text-center text-sm text-slate-500">
        <p>{t("pages.db.boardNeedsGroup")}</p>
        <AddPropertyMenu db={db} onAdded={(groupByPropertyId) => updateConfig({ groupByPropertyId })}>
          <Button variant="outline" size="sm" className="mt-2">{t("pages.db.addProperty")}</Button>
        </AddPropertyMenu>
      </div>
    );
  }
  return (
    <div className="flex items-start gap-3 overflow-x-auto pb-2" data-db-board>
      {groups.map((group) => {
        const value = groupValue(property, group.key, group.optionId);
        return (
          <section
            key={group.key}
            data-db-column={group.label}
            className="w-64 shrink-0 rounded-md bg-slate-50 p-2"
            onDragOver={allowRowDrop}
            onDrop={(event) => {
              const id = draggedRow(event);
              if (id) void db.updateRow(id, { properties: { [property.id]: value } });
            }}
          >
            <h4 className="mb-2 flex items-center gap-2 text-xs font-normal text-slate-500">
              {group.optionId && group.color ? <OptionChip option={{ name: group.label, color: group.color }} /> : group.label || t("pages.db.noValue")}
              <span>{group.rows.length}</span>
            </h4>
            <div className="space-y-1.5">
              {group.rows.slice(0, PAGE_SIZE).map((row) => (
                <div
                  key={row.id}
                  draggable
                  onDragStart={rowDrag(row.id)}
                  onDragOver={allowRowDrop}
                  onDrop={(event) => {
                    const id = draggedRow(event);
                    if (!id || id === row.id) return;
                    event.stopPropagation();
                    void db.updateRow(id, { properties: { [property.id]: value } });
                    void db.moveRow(id, { beforeId: row.id });
                  }}
                >
                  <Card db={db} row={row} visible={visible.filter((item) => item.id !== property.id)} />
                </div>
              ))}
            </div>
            {db.sync ? null : (
              <button type="button" className="mt-1.5 block w-full rounded px-1 py-1 text-left text-xs text-slate-400 hover:bg-slate-100" onClick={() => void db.addRow({ properties: { [property.id]: value } })}>
                + {t("pages.db.newRow")}
              </button>
            )}
          </section>
        );
      })}
    </div>
  );
};

export const GalleryView = ({ db, rows, visible }: DatabaseViewProps) => {
  const { t } = useTranslation();
  const [limit, setLimit] = useState(PAGE_SIZE);
  return (
    <div data-db-gallery>
      <div className="grid gap-3" style={{ gridTemplateColumns: "repeat(auto-fill, minmax(220px, 1fr))" }}>
        {rows.slice(0, limit).map((row) => (
          <Card key={row.id} db={db} row={row} visible={visible}>
            <div className="-mx-2 -mt-2 mb-2 h-24 overflow-hidden rounded-t-md bg-slate-50 px-3 pt-2 text-xs text-slate-400">
              {row.icon ? <span className="text-3xl">{row.icon}</span> : row.excerpt}
            </div>
          </Card>
        ))}
        {db.sync ? null : (
          <button type="button" className="min-h-32 rounded-md border border-dashed border-slate-300 text-sm text-slate-400 hover:bg-slate-50" onClick={() => void db.addRow()}>
            + {t("pages.db.newRow")}
          </button>
        )}
      </div>
      <LoadMore shown={Math.min(limit, rows.length)} total={rows.length} onMore={() => setLimit((current) => current + PAGE_SIZE)} />
    </div>
  );
};

export const ListView = ({ db, rows, visible }: DatabaseViewProps) => {
  const { t } = useTranslation();
  const openRow = useOpenRow(db);
  const [limit, setLimit] = useState(PAGE_SIZE);
  return (
    <div data-db-list>
      {rows.slice(0, limit).map((row) => (
        <div key={row.id} className="group/row flex min-w-0 items-center gap-4 border-b border-slate-100 px-1 py-1.5 text-sm hover:bg-slate-50">
          <div className="min-w-0 flex-1 font-medium"><RowTitle db={db} row={row} /></div>
          {visible.filter((property) => property.type !== "title").map((property) => (
            <div key={property.id} className="w-36 min-w-0 shrink-0 text-xs text-slate-600"><DatabaseCell db={db} row={row} property={property} /></div>
          ))}
          <button type="button" className="rounded p-0.5 text-slate-500 opacity-0 hover:bg-slate-200 focus-visible:opacity-100 group-hover/row:opacity-100 max-lg:opacity-100" aria-label={t("pages.db.openRow")} onClick={() => openRow(row)}>
            <ExternalLink className="h-3.5 w-3.5" aria-hidden="true" />
          </button>
        </div>
      ))}
      <LoadMore shown={Math.min(limit, rows.length)} total={rows.length} onMore={() => setLimit((current) => current + PAGE_SIZE)} />
      {db.sync ? null : (
        <button type="button" className="mt-0.5 block w-full rounded px-1 py-1.5 text-left text-sm text-slate-400 hover:bg-slate-50" onClick={() => void db.addRow()}>
          + {t("pages.db.newRow")}
        </button>
      )}
    </div>
  );
};

const dateProperties = (db: DatabaseHandle) => db.database.schema.properties.filter((property) => property.type === "date");

const asDateValue = (value: DatabasePropertyValue | undefined): DatabaseDateValue | null => (
  value && typeof value === "object" && !Array.isArray(value) && "start" in value && value.start ? value : null
);

const toDay = (date: Date) => `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;

const NeedsDate = ({ db, updateConfig }: Pick<DatabaseViewProps, "db" | "updateConfig">) => {
  const { t } = useTranslation();
  return (
    <div className="rounded border border-dashed border-slate-300 p-6 text-center text-sm text-slate-500">
      <p>{t("pages.db.needsDate")}</p>
      <Button
        variant="outline"
        size="sm"
        className="mt-2"
        onClick={() => {
          const id = crypto.randomUUID().replace(/-/g, "").slice(0, 12);
          void db.updateSchema({ properties: [...db.database.schema.properties, { id, name: t("pages.db.types.date"), type: "date" }] });
          updateConfig({ datePropertyId: id });
        }}
      >
        {t("pages.db.addDateProperty")}
      </Button>
    </div>
  );
};

export const CalendarView = ({ db, rows, config, updateConfig }: DatabaseViewProps) => {
  const { t, i18n } = useTranslation();
  const openRow = useOpenRow(db);
  const [month, setMonth] = useState(() => { const now = new Date(); return new Date(now.getFullYear(), now.getMonth(), 1); });
  const candidates = dateProperties(db);
  const property = candidates.find((item) => item.id === config.datePropertyId) ?? candidates[0];
  const byDay = useMemo(() => {
    const map = new Map<string, DatabaseRow[]>();
    if (!property) return map;
    for (const row of rows) {
      const start = asDateValue(row.properties[property.id])?.start.slice(0, 10);
      if (start) map.set(start, [...(map.get(start) ?? []), row]);
    }
    return map;
  }, [property, rows]);
  if (!property) return <NeedsDate db={db} updateConfig={updateConfig} />;

  const first = new Date(month.getFullYear(), month.getMonth(), 1 - month.getDay());
  const days = Array.from({ length: 42 }, (_, index) => new Date(first.getFullYear(), first.getMonth(), first.getDate() + index));
  const today = toDay(new Date());
  const shift = (delta: number) => setMonth(new Date(month.getFullYear(), month.getMonth() + delta, 1));
  const weekday = new Intl.DateTimeFormat(i18n.language, { weekday: "short" });

  return (
    <div data-db-calendar>
      <div className="mb-2 flex items-center gap-1">
        <span className="mr-2 text-sm font-medium">{new Intl.DateTimeFormat(i18n.language, { month: "long", year: "numeric" }).format(month)}</span>
        <Button variant="ghost" size="icon" className="h-7 w-7" aria-label={t("pages.db.previousMonth")} onClick={() => shift(-1)}><ChevronLeft className="h-4 w-4" aria-hidden="true" /></Button>
        <Button variant="ghost" size="sm" className="h-7" onClick={() => { const now = new Date(); setMonth(new Date(now.getFullYear(), now.getMonth(), 1)); }}>{t("pages.db.today")}</Button>
        <Button variant="ghost" size="icon" className="h-7 w-7" aria-label={t("pages.db.nextMonth")} onClick={() => shift(1)}><ChevronRight className="h-4 w-4" aria-hidden="true" /></Button>
      </div>
      <div className="grid grid-cols-7 border-l border-t border-slate-200">
        {days.slice(0, 7).map((day) => <div key={day.getDay()} className="border-b border-r border-slate-200 px-1.5 py-1 text-xs text-slate-500">{weekday.format(day)}</div>)}
        {days.map((day) => {
          const key = toDay(day);
          const items = byDay.get(key) ?? [];
          return (
            <div
              key={key}
              data-day={key}
              className={cn("group/day min-h-24 border-b border-r border-slate-200 p-1", day.getMonth() !== month.getMonth() && "bg-slate-50/70")}
              onDragOver={allowRowDrop}
              onDrop={(event) => {
                const id = draggedRow(event);
                const row = rows.find((item) => item.id === id);
                if (!row) return;
                const current = asDateValue(row.properties[property.id]);
                void db.updateRow(row.id, { properties: { [property.id]: { start: key, end: current?.end ?? null } } });
              }}
            >
              <div className="flex items-center justify-between text-xs text-slate-500">
                <span className={cn(key === today && "rounded bg-slate-900 px-1 text-slate-50")}>{day.getDate()}</span>
                {db.sync ? null : <button type="button" className="rounded px-1 opacity-0 hover:bg-slate-100 focus-visible:opacity-100 group-hover/day:opacity-100" aria-label={t("pages.db.addOnDay", { day: key })} onClick={() => void db.addRow({ properties: { [property.id]: { start: key } } })}>+</button>}
              </div>
              {items.slice(0, 4).map((row) => (
                <button key={row.id} type="button" draggable onDragStart={rowDrag(row.id)} className="mt-0.5 block w-full truncate rounded border border-slate-200 bg-card px-1 py-0.5 text-left text-xs shadow-sm hover:bg-slate-50" onClick={() => openRow(row)}>
                  {row.icon ? `${row.icon} ` : ""}{row.title || t("common.untitledMemo")}
                </button>
              ))}
              {items.length > 4 ? <span className="text-xs text-slate-400">+{items.length - 4}</span> : null}
            </div>
          );
        })}
      </div>
    </div>
  );
};

const DAY_MS = 86_400_000;
const DAY_WIDTH = 30;
const MAX_TIMELINE_DAYS = 400;
const utcDay = (text: string) => Date.parse(`${text.slice(0, 10)}T00:00:00Z`);

const ROW_HEIGHT = 32;
const HEADER_HEIGHT = 24;
const LABEL_WIDTH = 240;

/** Arrows from each blocking row's bar to the bars of the rows it blocks. */
const DependencyArrows = ({ db, bars, width, height }: {
  db: DatabaseHandle;
  bars: Map<string, { index: number; left: number; right: number }>;
  width: number;
  height: number;
}) => {
  const blockedBy = db.database.schema.dependencies?.blockedByPropertyId;
  if (!blockedBy) return null;
  const arrows: { key: string; path: string }[] = [];
  for (const [rowId, target] of bars) {
    const row = db.rows.find((item) => item.id === rowId);
    const blockers = row?.properties[blockedBy];
    if (!Array.isArray(blockers)) continue;
    for (const blockerId of blockers) {
      const source = typeof blockerId === "string" ? bars.get(blockerId) : undefined;
      if (!source) continue;
      const y1 = HEADER_HEIGHT + source.index * ROW_HEIGHT + ROW_HEIGHT / 2;
      const y2 = HEADER_HEIGHT + target.index * ROW_HEIGHT + ROW_HEIGHT / 2;
      const x1 = source.right;
      const x2 = target.left;
      const bend = Math.max(x1 + 8, Math.min(x2 - 8, (x1 + x2) / 2));
      arrows.push({ key: `${blockerId}-${rowId}`, path: `M ${x1} ${y1} H ${bend} V ${y2} H ${x2 - 2}` });
    }
  }
  if (arrows.length === 0) return null;
  return (
    <svg className="pointer-events-none absolute left-0 top-0 z-20 text-slate-400" width={width} height={height} aria-hidden="true" data-db-dependencies>
      <defs>
        <marker id="ponder-dependency-arrow" viewBox="0 0 6 6" refX="5" refY="3" markerWidth="6" markerHeight="6" orient="auto">
          <path d="M0,0 L6,3 L0,6 z" fill="currentColor" />
        </marker>
      </defs>
      {arrows.map((arrow) => (
        <path key={arrow.key} d={arrow.path} fill="none" stroke="currentColor" strokeWidth="1.5" markerEnd="url(#ponder-dependency-arrow)" />
      ))}
    </svg>
  );
};

export const TimelineView = ({ db, rows, config, updateConfig }: DatabaseViewProps) => {
  const { t, i18n } = useTranslation();
  const openRow = useOpenRow(db);
  const candidates = dateProperties(db);
  const property = candidates.find((item) => item.id === config.datePropertyId) ?? candidates[0];
  const spans = useMemo(() => {
    if (!property) return [];
    return rows.map((row) => {
      const value = asDateValue(row.properties[property.id]);
      if (!value) return { row, start: null, end: null };
      const start = utcDay(value.start);
      const end = value.end ? Math.max(start, utcDay(value.end)) : start;
      return { row, start, end };
    });
  }, [property, rows]);
  if (!property) return <NeedsDate db={db} updateConfig={updateConfig} />;

  const today = utcDay(new Date().toISOString());
  const dated = spans.filter((span) => span.start !== null);
  const min = Math.min(today, ...dated.map((span) => span.start!)) - 7 * DAY_MS;
  const max = Math.max(today, ...dated.map((span) => span.end!)) + 21 * DAY_MS;
  const dayCount = Math.min(MAX_TIMELINE_DAYS, Math.round((max - min) / DAY_MS));
  const days = Array.from({ length: dayCount }, (_, index) => new Date(min + index * DAY_MS));
  const monthLabel = new Intl.DateTimeFormat(i18n.language, { month: "short", timeZone: "UTC" });

  const shownSpans = spans.slice(0, PAGE_SIZE * 3);
  const barLeft = (start: number) => LABEL_WIDTH + Math.round((start - min) / DAY_MS) * DAY_WIDTH;
  const barWidth = (start: number, end: number) => (Math.round((end - start) / DAY_MS) + 1) * DAY_WIDTH;
  const bars = new Map(shownSpans.flatMap(({ row, start, end }, index) => (
    start === null ? [] : [[row.id, { index, left: barLeft(start), right: barLeft(start) + barWidth(start, end!) }] as const]
  )));
  const totalWidth = LABEL_WIDTH + dayCount * DAY_WIDTH;

  return (
    <div className="overflow-x-auto" data-db-timeline>
      <div className="relative" style={{ width: totalWidth }}>
        <DependencyArrows db={db} bars={bars} width={totalWidth} height={HEADER_HEIGHT + shownSpans.length * ROW_HEIGHT} />
        <div className="flex h-6 items-center border-b border-slate-200 text-xs text-slate-500">
          <div className="sticky left-0 z-10 w-60 shrink-0 bg-card px-2 py-1">{property.name}</div>
          {days.map((day) => (
            <div key={day.getTime()} className="shrink-0 text-center" style={{ width: DAY_WIDTH }}>
              {day.getUTCDate() === 1 ? monthLabel.format(day) : day.getUTCDate()}
            </div>
          ))}
        </div>
        {shownSpans.map(({ row, start, end }) => (
          <div key={row.id} className="relative flex h-8 items-center border-b border-slate-100 text-sm">
            <div className="sticky left-0 z-10 flex h-full w-60 shrink-0 items-center bg-card px-2"><RowTitle db={db} row={row} /></div>
            {start !== null ? (
              <button
                type="button"
                className="absolute h-6 truncate rounded bg-slate-200 px-2 text-left text-xs hover:bg-slate-300"
                style={{ left: barLeft(start), width: barWidth(start, end!) }}
                onClick={() => openRow(row)}
              >
                {row.title || t("common.untitledMemo")}
              </button>
            ) : null}
          </div>
        ))}
        {db.sync ? null : (
          <button type="button" className="sticky left-0 mt-0.5 block rounded px-2 py-1.5 text-left text-sm text-slate-400 hover:bg-slate-50" onClick={() => void db.addRow({ properties: { [property.id]: { start: new Date().toISOString().slice(0, 10) } } })}>
            + {t("pages.db.newRow")}
          </button>
        )}
      </div>
    </div>
  );
};
