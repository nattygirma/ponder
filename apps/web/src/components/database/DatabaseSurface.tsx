import { useCallback, useMemo, useState, type ReactNode } from "react";
import { useTranslation } from "react-i18next";
import { ArrowDownUp, CalendarDays, ChartPie, Columns3, FileText, Filter, GalleryHorizontal, Group, List, ListTree, MoreHorizontal, Plus, Settings2, Table2, Trash2, X } from "lucide-react";
import {
  applyDatabaseView,
  DATABASE_VIEW_TYPES,
  defaultChartXProperty,
  type DatabaseFilter,
  type DatabaseProperty,
  type DatabaseView as DatabaseViewRecord,
  type DatabaseViewConfig,
  type DatabaseViewType,
  type FilterOperator,
} from "@ponder/shared";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { cn } from "@/lib/utils";
import { BoardView, CalendarView, GalleryView, ListView, RowPeekContext, TableView, TimelineView, type DatabaseViewProps } from "./DatabaseViews";
import { NewRowButton } from "./DatabaseTemplates";
import { AutomationsButton } from "./DatabaseAutomations";
import { ChartSettings, ChartView } from "./DatabaseChart";
import { FormBuilder, FormTools } from "./DatabaseForm";
import { RowPeek } from "./RowPeek";
import { SyncStatus } from "./DatabaseSync";
import { useDatabase, type DatabaseHandle } from "./useDatabase";

const VIEW_ICONS: Record<DatabaseViewType, typeof Table2> = {
  table: Table2,
  board: Columns3,
  calendar: CalendarDays,
  gallery: GalleryHorizontal,
  list: List,
  timeline: ListTree,
  chart: ChartPie,
  form: FileText,
};

const VIEW_COMPONENTS: Record<DatabaseViewType, (props: DatabaseViewProps) => ReactNode> = {
  table: TableView,
  board: BoardView,
  calendar: CalendarView,
  gallery: GalleryView,
  list: ListView,
  timeline: TimelineView,
  chart: ChartView,
  // Form views draw their own builder (see Loaded); this is never used.
  form: () => null,
};

const TEXT_OPERATORS: FilterOperator[] = ["contains", "not_contains", "is", "is_not", "starts_with", "ends_with", "is_empty", "is_not_empty"];
const operatorsFor = (property: DatabaseProperty | undefined): FilterOperator[] => {
  switch (property?.type) {
    case "number":
      return ["is", "is_not", "gt", "gte", "lt", "lte", "is_empty", "is_not_empty"];
    case "select":
    case "status":
      return ["is", "is_not", "is_empty", "is_not_empty"];
    case "multi_select":
    case "relation":
      return ["contains", "not_contains", "is_empty", "is_not_empty"];
    case "date":
    case "created_time":
    case "last_edited_time":
      return ["is", "before", "after", "on_or_before", "on_or_after", "is_empty", "is_not_empty"];
    case "checkbox":
      return ["checked", "unchecked"];
    default:
      return TEXT_OPERATORS;
  }
};
const NO_VALUE_OPERATORS = new Set<FilterOperator>(["is_empty", "is_not_empty", "checked", "unchecked"]);

const ToolbarButton = ({ icon: Icon, label, active, children, ...rest }: {
  icon: typeof Filter;
  label: string;
  active?: boolean;
  children: ReactNode;
}) => (
  <Popover>
    <PopoverTrigger asChild>
      <button type="button" aria-label={label} className={cn("flex h-7 w-7 shrink-0 items-center justify-center rounded text-slate-500 hover:bg-slate-100", active && "text-blue-600")} {...rest}>
        <Icon className="h-3.5 w-3.5" aria-hidden="true" />
      </button>
    </PopoverTrigger>
    <PopoverContent align="end" className="w-96 space-y-2">{children}</PopoverContent>
  </Popover>
);

const FilterValue = ({ property, filter, onChange }: { property: DatabaseProperty | undefined; filter: DatabaseFilter; onChange: (value: string | number | null) => void }) => {
  const { t } = useTranslation();
  if (NO_VALUE_OPERATORS.has(filter.operator)) return null;
  if (property?.options && (property.type === "select" || property.type === "status" || property.type === "multi_select")) {
    return (
      <Select value={typeof filter.value === "string" && filter.value ? filter.value : undefined} onValueChange={onChange}>
        <SelectTrigger className="h-7 min-w-0 flex-1"><SelectValue placeholder={t("pages.db.choose")} /></SelectTrigger>
        <SelectContent>{property.options.map((option) => <SelectItem key={option.id} value={option.name}>{option.name}</SelectItem>)}</SelectContent>
      </Select>
    );
  }
  const type = property?.type === "number" ? "number" : property?.type === "date" || property?.type === "created_time" || property?.type === "last_edited_time" ? "date" : "text";
  return (
    <Input
      className="h-7 min-w-0 flex-1"
      type={type}
      aria-label={t("pages.db.filterValue")}
      defaultValue={filter.value === null || filter.value === undefined ? "" : String(filter.value)}
      onBlur={(event) => onChange(type === "number" ? (event.target.value === "" ? null : Number(event.target.value)) : event.target.value)}
      onKeyDown={(event) => { if (event.key === "Enter") event.currentTarget.blur(); }}
    />
  );
};

const FilterPanel = ({ db, config, update }: { db: DatabaseHandle; config: DatabaseViewConfig; update: DatabaseViewProps["updateConfig"] }) => {
  const { t } = useTranslation();
  const properties = db.database.schema.properties;
  const filters = config.filters ?? [];
  const setFilter = (index: number, patch: Partial<DatabaseFilter>) => update({
    filters: filters.map((filter, position) => (position === index ? { ...filter, ...patch } : filter)),
  });
  return (
    <>
      {filters.length > 1 ? (
        <Select value={config.filterMode ?? "and"} onValueChange={(filterMode) => update({ filterMode: filterMode as "and" | "or" })}>
          <SelectTrigger className="h-7 w-44"><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value="and">{t("pages.db.matchAll")}</SelectItem>
            <SelectItem value="or">{t("pages.db.matchAny")}</SelectItem>
          </SelectContent>
        </Select>
      ) : null}
      {filters.map((filter, index) => {
        const property = properties.find((item) => item.id === filter.propertyId);
        return (
          <div key={`${filter.propertyId}-${index}`} className="flex items-center gap-1">
            <Select value={filter.propertyId} onValueChange={(propertyId) => {
              const next = properties.find((item) => item.id === propertyId);
              setFilter(index, { propertyId, operator: operatorsFor(next)[0]!, value: null });
            }}>
              <SelectTrigger className="h-7 w-28 min-w-0"><SelectValue /></SelectTrigger>
              <SelectContent>{properties.map((item) => <SelectItem key={item.id} value={item.id}>{item.name}</SelectItem>)}</SelectContent>
            </Select>
            <Select value={filter.operator} onValueChange={(operator) => setFilter(index, { operator: operator as FilterOperator })}>
              <SelectTrigger className="h-7 w-28 min-w-0"><SelectValue /></SelectTrigger>
              <SelectContent>{operatorsFor(property).map((operator) => <SelectItem key={operator} value={operator}>{t(`pages.db.operators.${operator}`)}</SelectItem>)}</SelectContent>
            </Select>
            <FilterValue property={property} filter={filter} onChange={(value) => setFilter(index, { value })} />
            <button type="button" className="rounded p-1 text-slate-500 hover:bg-slate-100" aria-label={t("pages.db.removeFilter")} onClick={() => update({ filters: filters.filter((_, position) => position !== index) })}>
              <X className="h-3.5 w-3.5" aria-hidden="true" />
            </button>
          </div>
        );
      })}
      <Button variant="ghost" size="sm" className="h-7" onClick={() => {
        const property = properties[0]!;
        update({ filters: [...filters, { propertyId: property.id, operator: operatorsFor(property)[0]!, value: null }] });
      }}>+ {t("pages.db.addFilter")}</Button>
    </>
  );
};

const SortPanel = ({ db, config, update }: { db: DatabaseHandle; config: DatabaseViewConfig; update: DatabaseViewProps["updateConfig"] }) => {
  const { t } = useTranslation();
  const properties = db.database.schema.properties;
  const sorts = config.sorts ?? [];
  return (
    <>
      {sorts.map((sort, index) => (
        <div key={`${sort.propertyId}-${index}`} className="flex items-center gap-1">
          <Select value={sort.propertyId} onValueChange={(propertyId) => update({ sorts: sorts.map((item, position) => (position === index ? { ...item, propertyId } : item)) })}>
            <SelectTrigger className="h-7 min-w-0 flex-1"><SelectValue /></SelectTrigger>
            <SelectContent>{properties.map((item) => <SelectItem key={item.id} value={item.id}>{item.name}</SelectItem>)}</SelectContent>
          </Select>
          <Select value={sort.direction} onValueChange={(direction) => update({ sorts: sorts.map((item, position) => (position === index ? { ...item, direction: direction as "asc" | "desc" } : item)) })}>
            <SelectTrigger className="h-7 w-32"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="asc">{t("pages.db.ascending")}</SelectItem>
              <SelectItem value="desc">{t("pages.db.descending")}</SelectItem>
            </SelectContent>
          </Select>
          <button type="button" className="rounded p-1 text-slate-500 hover:bg-slate-100" aria-label={t("pages.db.removeSort")} onClick={() => update({ sorts: sorts.filter((_, position) => position !== index) })}>
            <X className="h-3.5 w-3.5" aria-hidden="true" />
          </button>
        </div>
      ))}
      <Button variant="ghost" size="sm" className="h-7" onClick={() => update({ sorts: [...sorts, { propertyId: properties[0]!.id, direction: "asc" }] })}>+ {t("pages.db.addSort")}</Button>
    </>
  );
};

const newPropertyId = () => crypto.randomUUID().replace(/-/g, "").slice(0, 12);

/**
 * Turns sub-items or dependencies on or off. On, it reuses a two-way relation of this database to itself with
 * the expected names (left from an earlier time), or makes one; off, it keeps the relations and their values.
 */
const RelationPairSwitch = ({ db, kind }: { db: DatabaseHandle; kind: "subItems" | "dependencies" }) => {
  const { t } = useTranslation();
  const schema = db.database.schema;
  const [firstName, secondName] = kind === "subItems"
    ? [t("pages.db.parentItem"), t("pages.db.subItem")]
    : [t("pages.db.blockedBy"), t("pages.db.blocking")];
  const enabled = Boolean(schema[kind]);
  const set = (on: boolean) => {
    if (!on) {
      void db.updateSchema({ [kind]: undefined });
      return;
    }
    const selfRelation = (name: string) => schema.properties.find((property) => (
      property.type === "relation" && property.name === name && property.relation?.databaseId === db.database.id && property.relation.syncedPropertyId
    ));
    const existing = selfRelation(firstName);
    const partner = existing && schema.properties.find((property) => property.id === existing.relation?.syncedPropertyId);
    const [firstId, secondId] = existing && partner ? [existing.id, partner.id] : [newPropertyId(), newPropertyId()];
    const added = existing && partner ? [] : [
      { id: firstId, name: firstName, type: "relation" as const, relation: { databaseId: db.database.id, syncedPropertyId: secondId } },
      { id: secondId, name: secondName, type: "relation" as const, relation: { databaseId: db.database.id, syncedPropertyId: firstId } },
    ];
    const pair = kind === "subItems"
      ? { subItems: { parentPropertyId: firstId, childPropertyId: secondId } }
      : { dependencies: { blockedByPropertyId: firstId, blockingPropertyId: secondId } };
    void db.updateSchema({ properties: [...schema.properties, ...added], ...pair });
  };
  return (
    <label className="flex items-start justify-between gap-3 text-sm">
      <span>
        {t(kind === "subItems" ? "pages.db.subItems" : "pages.db.dependencies")}
        <span className="block text-xs text-slate-500">{t(kind === "subItems" ? "pages.db.subItemsHelp" : "pages.db.dependenciesHelp")}</span>
      </span>
      <Switch checked={enabled} onCheckedChange={set} />
    </label>
  );
};

const PropertiesPanel = ({ db, config, update }: { db: DatabaseHandle; config: DatabaseViewConfig; update: DatabaseViewProps["updateConfig"] }) => {
  const properties = db.database.schema.properties;
  const visible = (id: string) => !config.visiblePropertyIds || config.visiblePropertyIds.includes(id);
  return (
    <div className="max-h-96 space-y-1 overflow-y-auto">
      {properties.filter((property) => property.type !== "title").map((property) => (
        <label key={property.id} className="flex items-center justify-between gap-2 text-sm">
          <span className="truncate">{property.name}</span>
          <Switch
            checked={visible(property.id)}
            onCheckedChange={(checked) => update({
              visiblePropertyIds: properties.filter((item) => (item.id === property.id ? checked : visible(item.id))).map((item) => item.id),
            })}
          />
        </label>
      ))}
      <div className="space-y-2 border-t border-slate-100 pt-2">
        <RelationPairSwitch db={db} kind="subItems" />
        {db.database.schema.subItems ? <SubItemsDisplay config={config} update={update} /> : null}
        <RelationPairSwitch db={db} kind="dependencies" />
      </div>
    </div>
  );
};

const SUB_ITEM_DISPLAYS = ["nested", "flattened", "disabled"] as const;

/** Notion's per-view "Show as" for sub-items. */
const SubItemsDisplay = ({ config, update }: { config: DatabaseViewConfig; update: DatabaseViewProps["updateConfig"] }) => {
  const { t } = useTranslation();
  return (
    <label className="flex items-center justify-between gap-3 pl-3 text-xs text-slate-500">
      {t("pages.db.subItemsShowAs")}
      <Select value={config.subItemsDisplay ?? "nested"} onValueChange={(value) => update({ subItemsDisplay: value as (typeof SUB_ITEM_DISPLAYS)[number] })}>
        <SelectTrigger className="h-7 w-40" aria-label={t("pages.db.subItemsShowAs")}><SelectValue /></SelectTrigger>
        <SelectContent>
          {SUB_ITEM_DISPLAYS.map((value) => <SelectItem key={value} value={value}>{t(`pages.db.subItemsDisplay.${value}`)}</SelectItem>)}
        </SelectContent>
      </Select>
    </label>
  );
};

const NONE = "__none";
const PropertyChoice = ({ value, options, onChange }: { value: string | null | undefined; options: DatabaseProperty[]; onChange: (id: string | null) => void }) => {
  const { t } = useTranslation();
  return (
    <Select value={value ?? NONE} onValueChange={(next) => onChange(next === NONE ? null : next)}>
      <SelectTrigger className="h-8"><SelectValue /></SelectTrigger>
      <SelectContent>
        <SelectItem value={NONE}>{t("pages.db.none")}</SelectItem>
        {options.map((item) => <SelectItem key={item.id} value={item.id}>{item.name}</SelectItem>)}
      </SelectContent>
    </Select>
  );
};

const ViewTab = ({ db, view, active, onSelect, canDelete }: {
  db: DatabaseHandle;
  view: DatabaseViewRecord;
  active: boolean;
  onSelect: () => void;
  canDelete: boolean;
}) => {
  const { t } = useTranslation();
  const Icon = VIEW_ICONS[view.type];
  return (
    <div className={cn("group/tab flex shrink-0 items-center rounded-full", active && "bg-slate-100")}>
      <button type="button" className={cn("flex h-7 items-center gap-1 rounded-full px-2.5 text-sm text-slate-500 hover:text-slate-900", active && "font-medium text-slate-900")} onClick={onSelect} aria-pressed={active}>
        <Icon className="h-3.5 w-3.5" aria-hidden="true" />{view.name}
      </button>
      {active ? (
        <Popover>
          <PopoverTrigger asChild>
            <button type="button" className="rounded p-0.5 text-slate-400 hover:bg-slate-100" aria-label={t("pages.db.viewSettings", { name: view.name })}>
              <MoreHorizontal className="h-3.5 w-3.5" aria-hidden="true" />
            </button>
          </PopoverTrigger>
          <PopoverContent className="w-56 space-y-2">
            <Input
              key={view.name}
              defaultValue={view.name}
              aria-label={t("pages.db.viewName")}
              onBlur={(event) => { const name = event.target.value.trim(); if (name && name !== view.name) void db.updateView(view.id, { name }); }}
              onKeyDown={(event) => { if (event.key === "Enter") event.currentTarget.blur(); }}
            />
            <Select value={view.type} onValueChange={(type) => void db.updateView(view.id, { type: type as DatabaseViewType })}>
              <SelectTrigger className="h-8"><SelectValue /></SelectTrigger>
              <SelectContent>{DATABASE_VIEW_TYPES.map((type) => <SelectItem key={type} value={type}>{t(`pages.db.views.${type}`)}</SelectItem>)}</SelectContent>
            </Select>
            {canDelete ? (
              <button type="button" className="flex w-full items-center gap-2 rounded px-1.5 py-1 text-red-600 hover:bg-red-50" onClick={() => void db.deleteView(view.id)}>
                <Trash2 className="h-3.5 w-3.5" aria-hidden="true" />{t("pages.db.deleteView")}
              </button>
            ) : null}
          </PopoverContent>
        </Popover>
      ) : null}
    </div>
  );
};

const AddView = ({ db, onAdded }: { db: DatabaseHandle; onAdded: (id: string) => void }) => {
  const { t } = useTranslation();
  const [open, setOpen] = useState(false);
  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <button type="button" className="rounded p-1 text-slate-400 hover:bg-slate-100" aria-label={t("pages.db.addView")}><Plus className="h-3.5 w-3.5" aria-hidden="true" /></button>
      </PopoverTrigger>
      <PopoverContent className="w-44 p-1">
        {DATABASE_VIEW_TYPES.map((type) => {
          const Icon = VIEW_ICONS[type];
          return (
            <button key={type} type="button" className="flex w-full items-center gap-2 rounded px-2 py-1 text-left hover:bg-slate-100" onClick={async () => {
              setOpen(false);
              // A chart starts on the most chartable property, as Notion picks one for you.
              const config = type === "chart" ? { chart: { xPropertyId: defaultChartXProperty(db.database.schema) } } : undefined;
              const view = await db.addView({ name: t(`pages.db.views.${type}`), type, config });
              if (view) onAdded(view.id);
            }}>
              <Icon className="h-3.5 w-3.5" aria-hidden="true" />{t(`pages.db.views.${type}`)}
            </button>
          );
        })}
      </PopoverContent>
    </Popover>
  );
};

const Loaded = ({ db, initialViewId, header }: { db: DatabaseHandle; initialViewId?: string; header?: ReactNode }) => {
  const { t } = useTranslation();
  const [activeId, setActiveId] = useState(initialViewId);
  const [search, setSearch] = useState("");
  const [peekRowId, setPeekRowId] = useState<string | null>(null);
  const [formShareOpen, setFormShareOpen] = useState(false);
  const closePeek = useCallback(() => setPeekRowId(null), []);
  const views = db.database.views;
  const view = views.find((item) => item.id === activeId) ?? views[0];
  const schema = db.database.schema;
  const stored = view?.config ?? {};
  // A view switched to a chart has no chart settings yet; it starts on the most chartable property.
  const config = view?.type === "chart" && stored.chart?.xPropertyId === undefined
    ? { ...stored, chart: { ...stored.chart, xPropertyId: defaultChartXProperty(schema) } }
    : stored;

  const rows = useMemo(() => {
    const applied = applyDatabaseView({ schema, rows: db.rows, cells: db.cells, config, now: new Date() });
    const query = search.trim().toLowerCase();
    return query ? applied.filter((row) => (row.title ?? "").toLowerCase().includes(query) || row.excerpt.toLowerCase().includes(query)) : applied;
  }, [config, db.cells, db.rows, schema, search]);

  if (!view) return null;
  const updateConfig = (patch: Partial<DatabaseViewConfig>) => void db.updateView(view.id, { config: { ...config, ...patch } });
  const isChart = view.type === "chart";
  const properties = schema.properties;
  const title = properties.find((property) => property.type === "title")!;
  const ordered = config.visiblePropertyIds
    ? config.visiblePropertyIds.flatMap((id) => properties.filter((property) => property.id === id && property.type !== "title"))
    : properties.filter((property) => property.type !== "title");
  const visible = [title, ...ordered];
  const groupable = properties.filter((property) => property.type === "select" || property.type === "status" || property.type === "checkbox");
  const dateOptions = properties.filter((property) => property.type === "date");
  const Body = VIEW_COMPONENTS[view.type];

  return (
    <div className="ponder-database min-w-0" data-database-id={db.database.id}>
      {header}
      {db.error ? (
        <Alert variant="destructive" className="mb-2 py-2">
          <AlertDescription className="flex items-center justify-between gap-2">
            {db.error}
            <button type="button" aria-label={t("pages.db.dismiss")} onClick={db.clearError}><X className="h-3.5 w-3.5" aria-hidden="true" /></button>
          </AlertDescription>
        </Alert>
      ) : null}
      <SyncStatus db={db} />
      <div className="mb-2 flex min-w-0 flex-wrap items-center gap-1 pb-1">
        <div className="flex min-w-0 items-center gap-1 overflow-x-auto">
          {views.map((item) => (
            <ViewTab key={item.id} db={db} view={item} active={item.id === view.id} canDelete={views.length > 1} onSelect={() => setActiveId(item.id)} />
          ))}
          <AddView db={db} onAdded={setActiveId} />
        </div>
        {view.type === "form" ? (
          <div className="ml-auto flex flex-wrap items-center gap-0.5">
            <AutomationsButton db={db} />
            <FormTools db={db} view={view} shareOpen={formShareOpen} onShareOpenChange={setFormShareOpen} />
          </div>
        ) : (
        <div className="ml-auto flex flex-wrap items-center gap-0.5">
          <ToolbarButton icon={Filter} label={t("pages.db.filter")} active={Boolean(config.filters?.length)}><FilterPanel db={db} config={config} update={updateConfig} /></ToolbarButton>
          {isChart ? null : <ToolbarButton icon={ArrowDownUp} label={t("pages.db.sort")} active={Boolean(config.sorts?.length)}><SortPanel db={db} config={config} update={updateConfig} /></ToolbarButton>}
          {view.type === "table" || view.type === "board" ? (
            <ToolbarButton icon={Group} label={t("pages.db.group")} active={Boolean(config.groupByPropertyId)}>
              <PropertyChoice value={config.groupByPropertyId} options={groupable} onChange={(groupByPropertyId) => updateConfig({ groupByPropertyId })} />
            </ToolbarButton>
          ) : null}
          {view.type === "calendar" || view.type === "timeline" ? (
            <ToolbarButton icon={CalendarDays} label={t("pages.db.dateProperty")}>
              <PropertyChoice value={config.datePropertyId} options={dateOptions} onChange={(datePropertyId) => updateConfig({ datePropertyId })} />
            </ToolbarButton>
          ) : null}
          {isChart ? (
            <ToolbarButton icon={Settings2} label={t("pages.db.chart.edit")}><ChartSettings db={db} config={config} update={updateConfig} rows={rows} viewName={view.name} /></ToolbarButton>
          ) : (
            <>
              <ToolbarButton icon={Settings2} label={t("pages.db.properties")}><PropertiesPanel db={db} config={config} update={updateConfig} /></ToolbarButton>
              <Input className="h-7 w-32 text-xs" value={search} placeholder={t("pages.db.search")} aria-label={t("pages.db.search")} onChange={(event) => setSearch(event.target.value)} />
            </>
          )}
          <AutomationsButton db={db} />
          {/* A synced database's rows come from GitHub, so it has no New button, as in Notion. */}
          {db.sync ? null : <NewRowButton db={db} />}
        </div>
        )}
      </div>
      {view.type === "form" ? (
        <FormBuilder key={view.id} db={db} view={view} onChangeAccess={() => setFormShareOpen(true)} />
      ) : (
        <RowPeekContext.Provider value={setPeekRowId}>
          <Body db={db} rows={rows} config={config} visible={visible} updateConfig={updateConfig} />
        </RowPeekContext.Provider>
      )}
      {peekRowId ? <RowPeek db={db} rowId={peekRowId} onClose={closePeek} /> : null}
    </div>
  );
};

export const DatabaseSurface = ({ databaseId, viewId, header }: { databaseId: string; viewId?: string; header?: (db: DatabaseHandle) => ReactNode }) => {
  const { t } = useTranslation();
  const { handle, isLoading, failed, retry } = useDatabase(databaseId);
  if (isLoading) return <div className="py-6 text-sm text-slate-400">{t("pages.db.loading")}</div>;
  if (failed || !handle) {
    return (
      <div className="rounded border border-slate-200 p-4 text-sm text-slate-500" role="alert">
        {t("pages.db.loadFailed")}{" "}
        <button type="button" className="underline" onClick={() => void retry()}>{t("pages.db.retry")}</button>
      </div>
    );
  }
  return <Loaded db={handle} initialViewId={viewId || undefined} header={header?.(handle)} />;
};
