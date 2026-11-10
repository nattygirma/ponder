import { useState, type ReactNode } from "react";
import { useTranslation } from "react-i18next";
import { EyeOff, Trash2 } from "lucide-react";
import {
  DATABASE_OPTION_COLORS,
  DATABASE_PROPERTY_TYPES,
  ROLLUP_FUNCTIONS,
  type DatabaseOption,
  type DatabaseProperty,
  type DatabasePropertyType,
  type RollupFunction,
} from "@ponder/shared";
import { Input } from "@/components/ui/input";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import { api } from "@/lib/api";
import { usePages } from "@/components/pages/PagesProvider";
import type { DatabaseHandle } from "./useDatabase";

const newId = () => crypto.randomUUID().replace(/-/g, "").slice(0, 12);

const CREATABLE_TYPES = DATABASE_PROPERTY_TYPES.filter((type) => type !== "title");

const propertyDefaults = (type: DatabasePropertyType): Partial<DatabaseProperty> => {
  if (type === "select" || type === "multi_select") return { options: [] };
  if (type === "status") {
    return {
      options: [
        { id: newId(), name: "Not started", color: "gray", group: "todo" },
        { id: newId(), name: "In progress", color: "blue", group: "in_progress" },
        { id: newId(), name: "Done", color: "green", group: "done" },
      ],
    };
  }
  return {};
};

export const useTypeLabel = () => {
  const { t } = useTranslation();
  return (type: DatabasePropertyType) => t(`pages.db.types.${type}`);
};

export const AddPropertyMenu = ({ db, onAdded, children }: {
  db: DatabaseHandle;
  onAdded?: (id: string) => void;
  children: ReactNode;
}) => {
  const typeLabel = useTypeLabel();
  const [open, setOpen] = useState(false);
  const add = (type: DatabasePropertyType) => {
    const id = newId();
    setOpen(false);
    void db.updateSchema({
      properties: [...db.database.schema.properties, { id, name: typeLabel(type), type, ...propertyDefaults(type) }],
    });
    onAdded?.(id);
  };
  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>{children}</PopoverTrigger>
      <PopoverContent className="w-52 p-1">
        <div className="max-h-80 overflow-y-auto">
          {CREATABLE_TYPES.map((type) => (
            <button key={type} type="button" className="block w-full rounded px-2 py-1 text-left hover:bg-slate-100" onClick={() => add(type)}>
              {typeLabel(type)}
            </button>
          ))}
        </div>
      </PopoverContent>
    </Popover>
  );
};

const OptionsEditor = ({ property, onChange }: { property: DatabaseProperty; onChange: (patch: Partial<DatabaseProperty>) => void }) => {
  const { t } = useTranslation();
  const options = property.options ?? [];
  const update = (id: string, patch: Partial<DatabaseOption>) =>
    onChange({ options: options.map((option) => (option.id === id ? { ...option, ...patch } : option)) });
  return (
    <div className="space-y-1">
      <p className="text-xs text-slate-500">{t("pages.db.options")}</p>
      <div className="max-h-44 space-y-1 overflow-y-auto">
        {options.map((option) => (
          <div key={option.id} className="flex items-center gap-1">
            <Select value={option.color} onValueChange={(color) => update(option.id, { color: color as DatabaseOption["color"] })}>
              <SelectTrigger className="h-7 w-16 px-1" aria-label={t("pages.db.optionColor")}>
                <span className="ponder-db-chip" data-color={option.color}>&nbsp;&nbsp;</span>
              </SelectTrigger>
              <SelectContent>
                {DATABASE_OPTION_COLORS.map((color) => (
                  <SelectItem key={color} value={color}>
                    <span className="ponder-db-chip" data-color={color}>{color}</span>
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <Input
              className="h-7"
              defaultValue={option.name}
              aria-label={t("pages.db.optionName")}
              onBlur={(event) => {
                const name = event.target.value.trim();
                if (name && name !== option.name) update(option.id, { name });
              }}
            />
            <button type="button" className="rounded p-1 text-slate-500 hover:bg-slate-100" aria-label={t("pages.db.deleteOption", { name: option.name })} onClick={() => onChange({ options: options.filter((item) => item.id !== option.id) })}>
              <Trash2 className="h-3.5 w-3.5" aria-hidden="true" />
            </button>
          </div>
        ))}
      </div>
    </div>
  );
};

const RelationEditor = ({ db, property }: { db: DatabaseHandle; property: DatabaseProperty }) => {
  const { t } = useTranslation();
  const pages = usePages();
  const [busy, setBusy] = useState(false);
  const databases = (pages?.nodes ?? []).filter((node) => node.databaseId);
  const targetId = property.relation?.databaseId;
  const twoWay = Boolean(property.relation?.syncedPropertyId);

  const applyTarget = async (databaseId: string, makeTwoWay: boolean) => {
    setBusy(true);
    try {
      const self = databaseId === db.database.id;
      const syncedId = makeTwoWay ? property.relation?.syncedPropertyId ?? newId() : null;
      const properties = db.database.schema.properties.map((item) => (
        item.id === property.id ? { ...item, relation: { databaseId, syncedPropertyId: syncedId } } : item
      ));
      const reverse: DatabaseProperty | null = syncedId ? {
        id: syncedId,
        name: t("pages.db.relatedTo", { name: db.database.title || t("common.untitledMemo") }),
        type: "relation",
        relation: { databaseId: db.database.id, syncedPropertyId: property.id },
      } : null;
      if (self) {
        const hasReverse = properties.some((item) => item.id === syncedId);
        await db.updateSchema({ properties: reverse && !hasReverse ? [...properties, reverse] : properties });
        return;
      }
      if (reverse) {
        const { database } = await api.getDatabase(databaseId);
        if (!database.schema.properties.some((item) => item.id === reverse.id)) {
          await api.updateDatabase(databaseId, { schema: { properties: [...database.schema.properties, reverse] } });
        }
      }
      await db.updateSchema({ properties });
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="space-y-2">
      <label className="block text-xs text-slate-500">
        {t("pages.db.relatedDatabase")}
        <Select value={targetId} disabled={busy} onValueChange={(next) => void applyTarget(next, twoWay)}>
          <SelectTrigger className="h-8"><SelectValue placeholder={t("pages.db.choose")} /></SelectTrigger>
          <SelectContent>
            {databases.map((node) => (
              <SelectItem key={node.databaseId} value={node.databaseId!}>{node.title || t("common.untitledMemo")}</SelectItem>
            ))}
          </SelectContent>
        </Select>
      </label>
      {targetId ? (
        <label className="flex items-center justify-between text-xs text-slate-600">
          {t("pages.db.twoWay")}
          <Switch checked={twoWay} disabled={busy} onCheckedChange={(checked) => void applyTarget(targetId, checked)} />
        </label>
      ) : null}
    </div>
  );
};

const RollupEditor = ({ db, property, onChange }: { db: DatabaseHandle; property: DatabaseProperty; onChange: (patch: Partial<DatabaseProperty>) => void }) => {
  const { t } = useTranslation();
  const relations = db.database.schema.properties.filter((item) => item.type === "relation" && item.relation);
  const config = property.rollup;
  const relation = relations.find((item) => item.id === config?.relationPropertyId);
  const target = relation?.relation ? db.related.get(relation.relation.databaseId) : undefined;
  const set = (patch: Partial<NonNullable<DatabaseProperty["rollup"]>>) => onChange({
    rollup: { relationPropertyId: "", targetPropertyId: "", function: "show_original", ...config, ...patch },
  });
  return (
    <div className="space-y-2 text-xs text-slate-500">
      <label className="block">
        {t("pages.db.rollupRelation")}
        <Select value={config?.relationPropertyId || undefined} onValueChange={(relationPropertyId) => set({ relationPropertyId, targetPropertyId: "" })}>
          <SelectTrigger className="h-8"><SelectValue placeholder={t("pages.db.choose")} /></SelectTrigger>
          <SelectContent>{relations.map((item) => <SelectItem key={item.id} value={item.id}>{item.name}</SelectItem>)}</SelectContent>
        </Select>
      </label>
      <label className="block">
        {t("pages.db.rollupProperty")}
        <Select value={config?.targetPropertyId || undefined} disabled={!target} onValueChange={(targetPropertyId) => set({ targetPropertyId })}>
          <SelectTrigger className="h-8"><SelectValue placeholder={t("pages.db.choose")} /></SelectTrigger>
          <SelectContent>{(target?.database.schema.properties ?? []).map((item) => <SelectItem key={item.id} value={item.id}>{item.name}</SelectItem>)}</SelectContent>
        </Select>
      </label>
      <label className="block">
        {t("pages.db.rollupCalculate")}
        <Select value={config?.function ?? "show_original"} onValueChange={(value) => set({ function: value as RollupFunction })}>
          <SelectTrigger className="h-8"><SelectValue /></SelectTrigger>
          <SelectContent>{ROLLUP_FUNCTIONS.map((fn) => <SelectItem key={fn} value={fn}>{t(`pages.db.rollup.${fn}`)}</SelectItem>)}</SelectContent>
        </Select>
      </label>
    </div>
  );
};

export const PropertyMenu = ({ db, property, onHide, children }: {
  db: DatabaseHandle;
  property: DatabaseProperty;
  onHide?: () => void;
  children: ReactNode;
}) => {
  const { t } = useTranslation();
  const typeLabel = useTypeLabel();
  const [open, setOpen] = useState(false);

  const patch = (next: Partial<DatabaseProperty>) => void db.updateSchema({
    properties: db.database.schema.properties.map((item) => (item.id === property.id ? { ...item, ...next } : item)),
  });

  const changeType = (type: DatabasePropertyType) => void db.updateSchema({
    properties: db.database.schema.properties.map((item) => (
      item.id === property.id ? { id: item.id, name: item.name, type, ...propertyDefaults(type) } : item
    )),
  });

  const remove = () => {
    setOpen(false);
    void db.updateSchema({ properties: db.database.schema.properties.filter((item) => item.id !== property.id) });
  };

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>{children}</PopoverTrigger>
      <PopoverContent className="w-72 space-y-2">
        <Input
          key={property.name}
          defaultValue={property.name}
          aria-label={t("pages.db.propertyName")}
          onBlur={(event) => {
            const name = event.target.value.trim();
            if (name && name !== property.name) patch({ name });
          }}
          onKeyDown={(event) => { if (event.key === "Enter") event.currentTarget.blur(); }}
        />
        {property.type === "title" ? null : (
          <label className="block text-xs text-slate-500">
            {t("pages.db.propertyType")}
            <Select value={property.type} onValueChange={(type) => changeType(type as DatabasePropertyType)}>
              <SelectTrigger className="h-8"><SelectValue /></SelectTrigger>
              <SelectContent>{CREATABLE_TYPES.map((type) => <SelectItem key={type} value={type}>{typeLabel(type)}</SelectItem>)}</SelectContent>
            </Select>
          </label>
        )}
        {property.type === "select" || property.type === "multi_select" || property.type === "status" ? <OptionsEditor property={property} onChange={patch} /> : null}
        {property.type === "number" ? (
          <label className="block text-xs text-slate-500">
            {t("pages.db.numberFormat")}
            <Select value={property.numberFormat ?? "number"} onValueChange={(numberFormat) => patch({ numberFormat: numberFormat as DatabaseProperty["numberFormat"] })}>
              <SelectTrigger className="h-8"><SelectValue /></SelectTrigger>
              <SelectContent>{["number", "percent", "dollar", "euro", "pound", "yen"].map((format) => <SelectItem key={format} value={format}>{t(`pages.db.formats.${format}`)}</SelectItem>)}</SelectContent>
            </Select>
          </label>
        ) : null}
        {property.type === "relation" ? <RelationEditor db={db} property={property} /> : null}
        {property.type === "rollup" ? <RollupEditor db={db} property={property} onChange={patch} /> : null}
        {property.type === "formula" ? (
          <label className="block text-xs text-slate-500">
            {t("pages.db.formula")}
            <Textarea
              rows={3}
              className="font-mono text-xs"
              defaultValue={property.formula?.expression ?? ""}
              placeholder={'prop("Price") * 2'}
              onBlur={(event) => patch({ formula: { expression: event.target.value } })}
            />
          </label>
        ) : null}
        {property.type === "title" ? null : (
          <div className="border-t border-slate-100 pt-1">
            {onHide ? (
              <button type="button" className="flex w-full items-center gap-2 rounded px-1.5 py-1 hover:bg-slate-100" onClick={() => { setOpen(false); onHide(); }}>
                <EyeOff className="h-3.5 w-3.5" aria-hidden="true" />{t("pages.db.hideInView")}
              </button>
            ) : null}
            <button type="button" className="flex w-full items-center gap-2 rounded px-1.5 py-1 text-red-600 hover:bg-red-50" onClick={remove}>
              <Trash2 className="h-3.5 w-3.5" aria-hidden="true" />{t("pages.db.deleteProperty")}
            </button>
          </div>
        )}
      </PopoverContent>
    </Popover>
  );
};
