import { useState } from "react";
import { useTranslation } from "react-i18next";
import { ChevronDown, FileText, MoreHorizontal, Pencil, Plus, Star, Trash2 } from "lucide-react";
import {
  COMPUTED_PROPERTY_TYPES,
  type DatabasePropertyValue,
  type DatabaseRow,
  type DatabaseTemplate,
} from "@ponder/shared";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Popover, PopoverContainer, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import { DatabaseCell } from "./DatabaseCell";
import type { DatabaseHandle, TemplateInput } from "./useDatabase";

/** A stand-in row so the template editor can reuse the database's own cell editors. */
const templateRow = (values: Record<string, DatabasePropertyValue>): DatabaseRow => ({
  id: "template",
  title: null,
  icon: null,
  cover: null,
  excerpt: "",
  properties: values,
  position: 0,
  number: null,
  createdBy: null,
  updatedBy: null,
  createdAt: "",
  updatedAt: "",
});

const TemplateDialog = ({ db, template, onClose }: {
  db: DatabaseHandle;
  /** Null makes a new template. */
  template: DatabaseTemplate | null;
  onClose: () => void;
}) => {
  const { t } = useTranslation();
  const [draft, setDraft] = useState<Required<TemplateInput>>({
    name: template?.name ?? t("pages.db.templates.defaultName"),
    icon: template?.icon ?? null,
    title: template?.title ?? "",
    properties: template?.properties ?? {},
    content: template?.content ?? "",
    isDefault: template?.isDefault ?? db.database.templates.length === 0,
  });
  const [saving, setSaving] = useState(false);
  const [content, setContent] = useState<HTMLDivElement | null>(null);
  // Files belong to a row's own page, so a template can't hold them; computed values can't be set at all.
  const editable = db.database.schema.properties.filter((property) => !COMPUTED_PROPERTY_TYPES.has(property.type) && property.type !== "files");
  const row = templateRow(draft.properties);

  const save = async () => {
    setSaving(true);
    const saved = await db.saveTemplate(template?.id ?? null, { ...draft, name: draft.name.trim() || t("pages.db.templates.defaultName") });
    setSaving(false);
    if (saved) onClose();
  };

  return (
    <Dialog open onOpenChange={(open) => { if (!open) onClose(); }}>
      <DialogContent ref={setContent} className="max-h-[90vh] max-w-xl overflow-y-auto" data-template-editor>
        <PopoverContainer.Provider value={content}>
        <DialogHeader><DialogTitle>{t("pages.db.templates.dialogTitle")}</DialogTitle></DialogHeader>
        <div className="space-y-3 text-sm">
          <div className="flex gap-2">
            <label className="w-20 shrink-0 text-xs text-slate-500">
              {t("pages.db.templates.icon")}
              <Input className="h-8 text-center" maxLength={8} value={draft.icon ?? ""} placeholder="📄" onChange={(event) => setDraft({ ...draft, icon: event.target.value.trim() || null })} />
            </label>
            <label className="min-w-0 flex-1 text-xs text-slate-500">
              {t("pages.db.templates.name")}
              <Input className="h-8" value={draft.name} maxLength={120} onChange={(event) => setDraft({ ...draft, name: event.target.value })} />
            </label>
          </div>
          <label className="block text-xs text-slate-500">
            {t("pages.db.templates.rowTitle")}
            <Input className="h-8" value={draft.title} maxLength={160} onChange={(event) => setDraft({ ...draft, title: event.target.value })} />
            <span className="mt-1 block">{t("pages.db.templates.rowTitleHelp")}</span>
          </label>
          {editable.length > 0 ? (
            <div>
              <p className="mb-1 text-xs text-slate-500">{t("pages.db.templates.values")}</p>
              <div className="divide-y divide-slate-100 rounded border border-slate-200">
                {editable.map((property) => (
                  <div key={property.id} className="flex min-w-0 items-center gap-2 px-2 py-1.5">
                    <span className="w-32 shrink-0 truncate text-xs text-slate-500">{property.name}</span>
                    <div className="min-w-0 flex-1">
                      <DatabaseCell
                        db={db}
                        row={row}
                        property={property}
                        onChange={(value) => setDraft((current) => ({ ...current, properties: { ...current.properties, [property.id]: value } }))}
                      />
                    </div>
                  </div>
                ))}
              </div>
            </div>
          ) : null}
          <label className="block text-xs text-slate-500">
            {t("pages.db.templates.body")}
            <Textarea rows={8} className="font-mono text-xs" value={draft.content} onChange={(event) => setDraft({ ...draft, content: event.target.value })} />
            <span className="mt-1 block">{t("pages.db.templates.bodyHelp")}</span>
          </label>
          <label className="flex items-center justify-between text-sm">
            {t("pages.db.templates.setDefault")}
            <Switch checked={draft.isDefault} onCheckedChange={(isDefault) => setDraft({ ...draft, isDefault })} />
          </label>
        </div>
        <DialogFooter>
          <Button variant="ghost" onClick={onClose}>{t("pages.db.templates.cancel")}</Button>
          <Button disabled={saving} onClick={() => void save()}>{t("pages.db.templates.save")}</Button>
        </DialogFooter>
        </PopoverContainer.Provider>
      </DialogContent>
    </Dialog>
  );
};

const TemplateItem = ({ db, template, onUse, onEdit }: {
  db: DatabaseHandle;
  template: DatabaseTemplate;
  onUse: () => void;
  onEdit: () => void;
}) => {
  const { t } = useTranslation();
  return (
    <div className="group/template flex items-center rounded hover:bg-slate-100">
      <button type="button" className="flex min-w-0 flex-1 items-center gap-2 px-2 py-1 text-left" onClick={onUse}>
        <span aria-hidden="true" className="w-4 shrink-0 text-center">{template.icon ?? <FileText className="h-3.5 w-3.5 text-slate-500" />}</span>
        <span className="truncate">{template.name}</span>
        {template.isDefault ? <span className="shrink-0 rounded bg-slate-200 px-1 text-[10px] text-slate-600">{t("pages.db.templates.isDefault")}</span> : null}
      </button>
      <Popover>
        <PopoverTrigger asChild>
          <button type="button" className="mr-1 rounded p-0.5 text-slate-500 opacity-0 hover:bg-slate-200 focus-visible:opacity-100 group-hover/template:opacity-100 max-lg:opacity-100" aria-label={t("pages.db.templates.editTemplate", { name: template.name })}>
            <MoreHorizontal className="h-3.5 w-3.5" aria-hidden="true" />
          </button>
        </PopoverTrigger>
        <PopoverContent align="start" side="right" className="w-44 p-1 text-sm">
          <button type="button" className="flex w-full items-center gap-2 rounded px-2 py-1 hover:bg-slate-100" onClick={onEdit}>
            <Pencil className="h-3.5 w-3.5" aria-hidden="true" />{t("pages.db.templates.edit")}
          </button>
          {template.isDefault ? null : (
            <button type="button" className="flex w-full items-center gap-2 rounded px-2 py-1 hover:bg-slate-100" onClick={() => void db.saveTemplate(template.id, { isDefault: true })}>
              <Star className="h-3.5 w-3.5" aria-hidden="true" />{t("pages.db.templates.setDefault")}
            </button>
          )}
          <button type="button" className="flex w-full items-center gap-2 rounded px-2 py-1 text-red-600 hover:bg-red-50" onClick={() => void db.deleteTemplate(template.id)}>
            <Trash2 className="h-3.5 w-3.5" aria-hidden="true" />{t("pages.db.templates.delete")}
          </button>
        </PopoverContent>
      </Popover>
    </div>
  );
};

/** Notion's blue "New" button: a click uses the default template, the arrow picks another or edits them. */
export const NewRowButton = ({ db }: { db: DatabaseHandle }) => {
  const { t } = useTranslation();
  const [menuOpen, setMenuOpen] = useState(false);
  const [editing, setEditing] = useState<DatabaseTemplate | null | undefined>(undefined);
  const templates = db.database.templates;
  const fallback = templates.find((template) => template.isDefault);
  const use = (templateId?: string) => {
    setMenuOpen(false);
    void db.addRow(templateId ? { templateId } : undefined);
  };
  const edit = (template: DatabaseTemplate | null) => {
    setMenuOpen(false);
    setEditing(template);
  };

  return (
    <div className="ml-1 flex h-7 items-stretch overflow-hidden rounded-md bg-[#2383e2] text-sm text-white">
      <button type="button" className="px-2.5 hover:bg-[#0077d4]" onClick={() => use(fallback?.id)}>{t("pages.db.new")}</button>
      <Popover open={menuOpen} onOpenChange={setMenuOpen}>
        <PopoverTrigger asChild>
          <button type="button" className="border-l border-white/30 px-1 hover:bg-[#0077d4]" aria-label={t("pages.db.templates.menu")}>
            <ChevronDown className="h-3.5 w-3.5" aria-hidden="true" />
          </button>
        </PopoverTrigger>
        <PopoverContent align="end" className="w-64 p-1 text-sm" data-template-menu>
          <p className="px-2 py-1 text-xs text-slate-500">{t("pages.db.templates.menu")}</p>
          {templates.map((template) => (
            <TemplateItem key={template.id} db={db} template={template} onUse={() => use(template.id)} onEdit={() => edit(template)} />
          ))}
          <button type="button" className="flex w-full items-center gap-2 rounded px-2 py-1 text-left hover:bg-slate-100" onClick={() => use()}>
            <FileText className="h-3.5 w-3.5 text-slate-500" aria-hidden="true" />{t("pages.db.templates.empty")}
          </button>
          <button type="button" className="flex w-full items-center gap-2 rounded px-2 py-1 text-left text-slate-500 hover:bg-slate-100" onClick={() => edit(null)}>
            <Plus className="h-3.5 w-3.5" aria-hidden="true" />{t("pages.db.templates.newTemplate")}
          </button>
        </PopoverContent>
      </Popover>
      {editing !== undefined ? <TemplateDialog db={db} template={editing} onClose={() => setEditing(undefined)} /> : null}
    </div>
  );
};
