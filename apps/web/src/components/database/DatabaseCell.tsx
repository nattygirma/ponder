import { useMemo, useState, type ReactNode } from "react";
import { useTranslation } from "react-i18next";
import { Check, X } from "lucide-react";
import {
  DATABASE_OPTION_COLORS,
  type DatabaseDateValue,
  type DatabaseOption,
  type DatabaseProperty,
  type DatabasePropertyValue,
  type DatabaseRow,
} from "@ponder/shared";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { usePages } from "@/components/pages/PagesProvider";
import { cn } from "@/lib/utils";
import type { DatabaseHandle } from "./useDatabase";

const COMPUTED_TYPES = new Set(["rollup", "formula", "created_time", "last_edited_time"]);

export const OptionChip = ({ option, onRemove }: { option: { name: string; color: string }; onRemove?: () => void }) => (
  <span className="ponder-db-chip" data-color={option.color}>
    <span className="truncate">{option.name}</span>
    {onRemove ? (
      <button type="button" className="ml-0.5 opacity-60 hover:opacity-100" aria-label={`Remove ${option.name}`} onClick={(event) => { event.stopPropagation(); onRemove(); }}>
        <X className="h-3 w-3" aria-hidden="true" />
      </button>
    ) : null}
  </span>
);

const selectedIds = (value: DatabasePropertyValue | undefined) => {
  if (Array.isArray(value)) return value;
  return typeof value === "string" && value ? [value] : [];
};

const nextOptionColor = (count: number) => DATABASE_OPTION_COLORS[(count + 1) % DATABASE_OPTION_COLORS.length];

const OptionPicker = ({
  db,
  property,
  value,
  onChange,
  readOnly,
}: {
  db: DatabaseHandle;
  property: DatabaseProperty;
  value: DatabasePropertyValue | undefined;
  onChange: (next: DatabasePropertyValue) => void;
  readOnly?: boolean;
}) => {
  const { t } = useTranslation();
  const [query, setQuery] = useState("");
  const [open, setOpen] = useState(false);
  const multi = property.type === "multi_select";
  const options = property.options ?? [];
  const ids = selectedIds(value);
  const selected = ids.flatMap((id) => options.filter((option) => option.id === id));
  const search = query.trim().toLowerCase();
  const matches = options.filter((option) => option.name.toLowerCase().includes(search));
  const canCreate = Boolean(search) && !options.some((option) => option.name.toLowerCase() === search) && property.type !== "status";

  const toggle = (id: string) => {
    if (multi) {
      onChange(ids.includes(id) ? ids.filter((current) => current !== id) : [...ids, id]);
      return;
    }
    onChange(ids[0] === id ? null : id);
    setOpen(false);
  };

  const createOption = async () => {
    const option: DatabaseOption = { id: crypto.randomUUID().slice(0, 12), name: query.trim(), color: nextOptionColor(options.length) };
    await db.updateSchema({
      properties: db.database.schema.properties.map((item) => (
        item.id === property.id ? { ...item, options: [...options, option] } : item
      )),
    });
    setQuery("");
    toggle(option.id);
  };

  const chips = <span className="flex min-h-5 min-w-0 flex-wrap items-center gap-1">{selected.map((option) => <OptionChip key={option.id} option={option} />)}</span>;
  if (readOnly) return chips;

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <button type="button" className="block w-full min-w-0 text-left" aria-label={property.name}>{chips}</button>
      </PopoverTrigger>
      <PopoverContent onClick={(event) => event.stopPropagation()}>
        <Input
          autoFocus
          value={query}
          placeholder={t("pages.db.searchOrCreate")}
          onChange={(event) => setQuery(event.target.value)}
          onKeyDown={(event) => {
            if (event.key !== "Enter") return;
            event.preventDefault();
            if (canCreate) void createOption();
            else if (matches[0]) toggle(matches[0].id);
          }}
        />
        <div className="mt-1 max-h-60 overflow-y-auto">
          {matches.map((option) => (
            <button key={option.id} type="button" className="flex w-full items-center justify-between rounded px-1.5 py-1 hover:bg-slate-100" onClick={() => toggle(option.id)}>
              <OptionChip option={option} />
              {ids.includes(option.id) ? <Check className="h-3.5 w-3.5" aria-hidden="true" /> : null}
            </button>
          ))}
          {canCreate ? (
            <button type="button" className="flex w-full items-center gap-1 rounded px-1.5 py-1 text-left hover:bg-slate-100" onClick={() => void createOption()}>
              {t("pages.db.createOption")} <OptionChip option={{ name: query.trim(), color: nextOptionColor(options.length) }} />
            </button>
          ) : null}
        </div>
      </PopoverContent>
    </Popover>
  );
};

const asDate = (value: DatabasePropertyValue | undefined): DatabaseDateValue | null => (
  value && typeof value === "object" && !Array.isArray(value) && "start" in value ? value : null
);

const DatePicker = ({ value, label, onChange, readOnly }: {
  value: DatabasePropertyValue | undefined;
  label: string;
  onChange: (next: DatabasePropertyValue) => void;
  readOnly?: boolean;
}) => {
  const { t } = useTranslation();
  const date = asDate(value);
  const text = date ? `${date.start.slice(0, 10)}${date.end ? ` → ${date.end.slice(0, 10)}` : ""}` : "";
  if (readOnly) return <span className="truncate">{text}</span>;
  return (
    <Popover>
      <PopoverTrigger asChild>
        <button type="button" className="block min-h-5 w-full truncate text-left" aria-label={label}>{text}</button>
      </PopoverTrigger>
      <PopoverContent className="w-60 space-y-2" onClick={(event) => event.stopPropagation()}>
        <label className="block text-xs text-slate-500">
          {t("pages.db.startDate")}
          <Input type="date" value={date?.start.slice(0, 10) ?? ""} onChange={(event) => onChange(event.target.value ? { start: event.target.value, end: date?.end ?? null } : null)} />
        </label>
        <label className="block text-xs text-slate-500">
          {t("pages.db.endDate")}
          <Input type="date" disabled={!date} value={date?.end?.slice(0, 10) ?? ""} onChange={(event) => date && onChange({ start: date.start, end: event.target.value || null })} />
        </label>
        {date ? <button type="button" className="text-xs text-slate-500 hover:text-slate-900" onClick={() => onChange(null)}>{t("pages.db.clear")}</button> : null}
      </PopoverContent>
    </Popover>
  );
};

const RelationPicker = ({ db, property, value, onChange, readOnly }: {
  db: DatabaseHandle;
  property: DatabaseProperty;
  value: DatabasePropertyValue | undefined;
  onChange: (next: DatabasePropertyValue) => void;
  readOnly?: boolean;
}) => {
  const { t } = useTranslation();
  const pages = usePages();
  const [query, setQuery] = useState("");
  const target = property.relation ? db.related.get(property.relation.databaseId) : undefined;
  const ids = selectedIds(value);
  const byId = useMemo(() => new Map((target?.rows ?? []).map((row) => [row.id, row])), [target?.rows]);
  const search = query.trim().toLowerCase();
  const matches = (target?.rows ?? [])
    .filter((row) => (row.title ?? "").toLowerCase().includes(search))
    .slice(0, 50);
  const label = (row: DatabaseRow | undefined) => row?.title || t("common.untitledMemo");

  const chips = (
    <span className="flex min-h-5 min-w-0 flex-wrap items-center gap-1">
      {ids.map((id) => (
        <span key={id} role="link" tabIndex={0} className="truncate underline decoration-slate-300 underline-offset-2" onClick={(event) => {
          event.stopPropagation();
          if (target) pages?.openPage({ id, notebookId: target.database.notebookId });
        }}>{label(byId.get(id))}</span>
      ))}
    </span>
  );
  if (readOnly || !property.relation) return chips;
  return (
    <Popover>
      <PopoverTrigger asChild><button type="button" className="block w-full min-w-0 text-left" aria-label={property.name}>{chips}</button></PopoverTrigger>
      <PopoverContent onClick={(event) => event.stopPropagation()}>
        <Input autoFocus value={query} placeholder={t("pages.db.searchRows")} onChange={(event) => setQuery(event.target.value)} />
        <div className="mt-1 max-h-60 overflow-y-auto">
          {matches.map((row) => (
            <button key={row.id} type="button" className="flex w-full items-center justify-between gap-2 rounded px-1.5 py-1 text-left hover:bg-slate-100" onClick={() => onChange(ids.includes(row.id) ? ids.filter((id) => id !== row.id) : [...ids, row.id])}>
              <span className="truncate">{label(row)}</span>
              {ids.includes(row.id) ? <Check className="h-3.5 w-3.5 shrink-0" aria-hidden="true" /> : null}
            </button>
          ))}
        </div>
      </PopoverContent>
    </Popover>
  );
};

const InlineText = ({ value, type, label, onCommit, readOnly }: {
  value: string;
  type: string;
  label: string;
  onCommit: (next: string) => void;
  readOnly?: boolean;
}) => {
  const [editing, setEditing] = useState(false);
  if (readOnly || !editing) {
    const isLink = type === "url" && /^https?:\/\//i.test(value);
    return (
      <button type="button" disabled={readOnly} aria-label={label} className="block min-h-5 w-full truncate text-left disabled:cursor-default" onClick={() => setEditing(true)}>
        {isLink ? <a href={value} target="_blank" rel="noreferrer" className="underline" onClick={(event) => event.stopPropagation()}>{value}</a> : value}
      </button>
    );
  }
  return (
    <input
      autoFocus
      aria-label={label}
      type={type === "number" ? "number" : "text"}
      defaultValue={value}
      className="w-full min-w-0 bg-transparent outline-none"
      onClick={(event) => event.stopPropagation()}
      onBlur={(event) => {
        setEditing(false);
        if (event.target.value !== value) onCommit(event.target.value);
      }}
      onKeyDown={(event) => {
        if (event.key === "Enter") event.currentTarget.blur();
        if (event.key === "Escape") { event.currentTarget.value = value; event.currentTarget.blur(); }
      }}
    />
  );
};

export const RowTitle = ({ db, row, children }: { db: DatabaseHandle; row: DatabaseRow; children?: ReactNode }) => {
  const { t } = useTranslation();
  return (
    <span className="flex min-w-0 items-center gap-1.5">
      {row.icon ? <span aria-hidden="true">{row.icon}</span> : null}
      <InlineText value={row.title ?? ""} type="text" label={t("pages.db.rowName")} onCommit={(title) => void db.updateRow(row.id, { title })} />
      {children}
    </span>
  );
};

export const DatabaseCell = ({ db, row, property, readOnly }: {
  db: DatabaseHandle;
  row: DatabaseRow;
  property: DatabaseProperty;
  readOnly?: boolean;
}) => {
  const computed = db.cells.get(row.id)?.[property.id];
  const raw = row.properties[property.id];
  const commit = (next: DatabasePropertyValue) => void db.updateRow(row.id, { properties: { [property.id]: next } });

  if (COMPUTED_TYPES.has(property.type)) {
    return (
      <span className={cn("block truncate", computed?.error && "text-red-600")} role={computed?.error ? "alert" : undefined}>
        {computed?.error ?? computed?.display ?? ""}
      </span>
    );
  }
  switch (property.type) {
    case "title":
      return <RowTitle db={db} row={row} />;
    case "select":
    case "status":
    case "multi_select":
      return <OptionPicker db={db} property={property} value={raw} onChange={commit} readOnly={readOnly} />;
    case "date":
      return <DatePicker value={raw} label={property.name} onChange={commit} readOnly={readOnly} />;
    case "checkbox":
      return <Checkbox checked={raw === true} disabled={readOnly} aria-label={property.name} onCheckedChange={(checked) => commit(checked === true)} onClick={(event) => event.stopPropagation()} />;
    case "relation":
      return <RelationPicker db={db} property={property} value={raw} onChange={commit} readOnly={readOnly} />;
    case "number":
      return (
        <InlineText
          value={typeof raw === "number" ? String(raw) : ""}
          type="number"
          label={property.name}
          readOnly={readOnly}
          onCommit={(next) => commit(next === "" || !Number.isFinite(Number(next)) ? null : Number(next))}
        />
      );
    default:
      return <InlineText value={typeof raw === "string" ? raw : ""} type={property.type} label={property.name} readOnly={readOnly} onCommit={commit} />;
  }
};
