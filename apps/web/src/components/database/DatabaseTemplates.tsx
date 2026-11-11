import { useEffect, useRef, useState, type ReactNode } from "react";
import { useTranslation } from "react-i18next";
import { Check, ChevronDown, Copy, FileText, Flag, MoreHorizontal, Pencil, Plus, Repeat, Smile, Trash2 } from "lucide-react";
import { EditorContent, useEditor } from "@tiptap/react";
import {
  COMPUTED_PROPERTY_TYPES,
  createPonderDocumentExtensions,
  defaultSchedule,
  docToMarkdown,
  markdownToDoc,
  presetOfSchedule,
  SCHEDULE_PRESETS,
  type Schedule,
  type DatabasePropertyValue,
  type DatabaseRow,
  type DatabaseTemplate,
} from "@ponder/shared";
import { createPonderMathematics } from "@ponder/shared/mathematics";
import { PageBlockAttributes } from "@ponder/shared/page-color";
import { Dialog, DialogContent, DialogTitle } from "@/components/ui/dialog";
import { Popover, PopoverContainer, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";
import { DatabaseCell } from "./DatabaseCell";
import { formatNextRun, localTimeZone, ScheduleEditor } from "./ScheduleEditor";
import type { DatabaseHandle } from "./useDatabase";

const SAVE_DELAY_MS = 600;

/** A stand-in row so the template page can reuse the database's own cell editors. */
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

/** The template's page body, edited with the same blocks as a row's page and kept as Markdown. */
const TemplateBody = ({ content, onChange }: { content: string; onChange: (markdown: string) => void }) => {
  const { t } = useTranslation();
  const changeRef = useRef(onChange);
  changeRef.current = onChange;
  const editor = useEditor({
    extensions: [
      ...createPonderDocumentExtensions({
        mathematics: createPonderMathematics({ onInlineClick: () => undefined, onBlockClick: () => undefined }),
        markdown: true,
      }),
      PageBlockAttributes,
    ],
    content: markdownToDoc(content),
    onUpdate: ({ editor: current }) => changeRef.current(docToMarkdown(current.getJSON())),
  });
  const [empty, setEmpty] = useState(() => !content.trim());
  useEffect(() => {
    if (!editor) return;
    const sync = () => setEmpty(editor.isEmpty);
    editor.on("update", sync);
    return () => { editor.off("update", sync); };
  }, [editor]);
  return (
    <div className="relative">
      {empty ? <p className="pointer-events-none absolute left-0 top-0 text-slate-400" aria-hidden="true">{t("pages.db.templates.bodyPlaceholder")}</p> : null}
      <EditorContent
        editor={editor}
        className="min-h-40 outline-none [&_.ProseMirror]:min-h-40 [&_.ProseMirror]:outline-none"
        aria-label={t("pages.db.templates.body")}
        data-template-body
      />
    </div>
  );
};

/**
 * A template opens as a page, like in Notion: a yellow banner says it is a template, and the title, icon,
 * property values and body are edited in place and saved as you go.
 */
const TemplatePage = ({ db, template, onClose }: { db: DatabaseHandle; template: DatabaseTemplate; onClose: () => void }) => {
  const { t } = useTranslation();
  const [values, setValues] = useState(template.properties);
  const [content, setContent] = useState<HTMLDivElement | null>(null);
  const [iconOpen, setIconOpen] = useState(false);
  const pendingBody = useRef<string | null>(null);
  const timer = useRef(0);
  // Files belong to a row's own page, so a template can't hold them; computed values can't be set at all.
  const editable = db.database.schema.properties.filter((property) => !COMPUTED_PROPERTY_TYPES.has(property.type) && property.type !== "files" && property.type !== "title");
  const row = templateRow(values);

  const flushBody = () => {
    window.clearTimeout(timer.current);
    if (pendingBody.current === null) return;
    const body = pendingBody.current;
    pendingBody.current = null;
    void db.saveTemplate(template.id, { content: body });
  };
  const flushRef = useRef(flushBody);
  flushRef.current = flushBody;
  useEffect(() => () => flushRef.current(), []);

  const saveTitle = (value: string) => {
    const title = value.trim();
    if (title === template.title && title === template.name) return;
    // In Notion the template's title is both its name in the menu and the title of pages made from it.
    void db.saveTemplate(template.id, { name: title.slice(0, 120), title: title.slice(0, 160) });
  };
  const saveIcon = (value: string) => {
    const icon = value.trim() || null;
    if (icon !== template.icon) void db.saveTemplate(template.id, { icon });
  };

  return (
    <Dialog open onOpenChange={(open) => { if (!open) { flushBody(); onClose(); } }}>
      <DialogContent ref={setContent} className="flex max-h-[85vh] max-w-3xl flex-col gap-0 overflow-hidden p-0" data-template-editor>
        <PopoverContainer.Provider value={content}>
          <div className="shrink-0 bg-[#FBF3DB] px-12 py-2 pr-14 text-center text-sm text-[#8A6A1F] dark:bg-[#4D3F17] dark:text-[#F0CF7E]" data-template-banner>
            <DialogTitle className="inline text-sm font-normal">
              {t("pages.db.templates.banner", { name: db.database.title || t("common.untitledMemo") })}
            </DialogTitle>
            <RepeatMenu db={db} template={template} variant="banner" />
          </div>
          <div className="min-h-0 flex-1 overflow-y-auto px-12 pb-16 pt-8 max-md:px-5">
            {template.icon || iconOpen ? (
              <input
                autoFocus={iconOpen}
                className="mb-1 w-14 bg-transparent text-4xl outline-none"
                defaultValue={template.icon ?? ""}
                maxLength={8}
                aria-label={t("pages.db.templates.icon")}
                onBlur={(event) => { saveIcon(event.target.value); setIconOpen(false); }}
                onKeyDown={(event) => { if (event.key === "Enter") event.currentTarget.blur(); }}
              />
            ) : (
              <button type="button" className="mb-2 flex items-center gap-1 rounded px-1.5 py-0.5 text-sm text-slate-400 hover:bg-slate-100 hover:text-slate-600" onClick={() => setIconOpen(true)}>
                <Smile className="h-3.5 w-3.5" aria-hidden="true" />{t("pages.db.templates.addIcon")}
              </button>
            )}
            <input
              autoFocus={!template.title}
              className="w-full bg-transparent text-3xl font-bold text-slate-900 outline-none placeholder:text-slate-300"
              defaultValue={template.title || template.name}
              maxLength={160}
              placeholder={t("pages.db.templates.titlePlaceholder")}
              aria-label={t("pages.db.templates.name")}
              onBlur={(event) => saveTitle(event.target.value)}
              onKeyDown={(event) => { if (event.key === "Enter") event.currentTarget.blur(); }}
            />
            {editable.length > 0 ? (
              <div className="mt-4 space-y-0.5">
                {editable.map((property) => (
                  <div key={property.id} className="flex min-h-8 items-start gap-2 text-sm">
                    <span className="w-36 shrink-0 truncate py-1 text-slate-500">{property.name}</span>
                    <div className="min-w-0 flex-1 rounded px-1 py-1 hover:bg-slate-100">
                      <DatabaseCell
                        db={db}
                        row={row}
                        property={property}
                        onChange={(value) => {
                          const next = { ...values, [property.id]: value };
                          setValues(next);
                          void db.saveTemplate(template.id, { properties: next });
                        }}
                      />
                    </div>
                  </div>
                ))}
              </div>
            ) : null}
            <hr className="my-4 border-slate-200" />
            <TemplateBody
              content={template.content}
              onChange={(markdown) => {
                pendingBody.current = markdown;
                window.clearTimeout(timer.current);
                timer.current = window.setTimeout(() => flushRef.current(), SAVE_DELAY_MS);
              }}
            />
          </div>
        </PopoverContainer.Provider>
      </DialogContent>
    </Dialog>
  );
};

const menuItem = "flex w-full items-center gap-2 rounded px-2 py-1 text-left hover:bg-slate-100";

/** "week", "2 weeks", "weekday": what a repeat is called in "Duplicate every …". */
const useRepeatUnit = () => {
  const { t } = useTranslation();
  return (repeat: Schedule) => {
    const preset = presetOfSchedule(repeat);
    if (preset && preset !== "day" && preset !== "week" && preset !== "month" && preset !== "year" && preset !== "weekday") {
      return t(`pages.db.templates.presets.${preset}`).toLowerCase();
    }
    const unit = t(`pages.db.templates.unitsLower.${repeat.unit}`);
    return repeat.interval > 1 && repeat.unit !== "weekday" ? `${repeat.interval} ${unit}s` : unit;
  };
};

/**
 * Notion's "Duplicate every…": a list of cadences, "Edit cadence" for the details and "Cancel recurrence".
 * Shown in the template editor's banner and in each template's ⋯ menu.
 */
const RepeatMenu = ({ db, template, variant }: { db: DatabaseHandle; template: DatabaseTemplate; variant: "banner" | "menu" }) => {
  const { t, i18n } = useTranslation();
  const unitOf = useRepeatUnit();
  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState<Schedule | null>(null);
  const repeat = template.repeat;
  const current = repeat ? presetOfSchedule(repeat) : null;
  const save = (next: Schedule | null) => {
    setOpen(false);
    setEditing(null);
    void db.saveTemplate(template.id, { repeat: next });
  };
  const choose = (presetId: (typeof SCHEDULE_PRESETS)[number]["id"]) => {
    const preset = SCHEDULE_PRESETS.find((item) => item.id === presetId)!;
    const base = repeat ?? defaultSchedule(preset.unit, preset.interval, new Date(), localTimeZone());
    const fresh = defaultSchedule(preset.unit, preset.interval, new Date(), base.timezone);
    save({ ...fresh, time: base.time, startDate: base.startDate, end: base.end, weekdays: preset.unit === "week" ? (base.weekdays?.length ? base.weekdays : fresh.weekdays) : undefined });
  };
  const label = repeat ? t("pages.db.templates.repeating", { unit: unitOf(repeat) }) : t("pages.db.templates.repeat");
  return (
    <Popover open={open} onOpenChange={(next) => { setOpen(next); if (!next) setEditing(null); }}>
      <PopoverTrigger asChild>
        {variant === "banner" ? (
          <button type="button" className="ml-2 inline-flex items-center gap-1 rounded px-1.5 py-0.5 font-medium hover:bg-black/5 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#8A6A1F]" data-repeat-banner>
            {repeat ? <Repeat className="h-3.5 w-3.5" aria-hidden="true" /> : null}{label}<ChevronDown className="h-3 w-3" aria-hidden="true" />
          </button>
        ) : (
          <button type="button" className={`${menuItem} justify-between`} data-repeat-menu>
            <span className="flex items-center gap-2"><Repeat className="h-3.5 w-3.5" aria-hidden="true" />{t("pages.db.templates.repeat")}</span>
            <span className="flex items-center gap-0.5 text-xs text-slate-500">{repeat ? t(`pages.db.templates.presets.${current ?? repeat.unit}`, { defaultValue: unitOf(repeat) }) : null}<ChevronDown className="h-3 w-3" aria-hidden="true" /></span>
          </button>
        )}
      </PopoverTrigger>
      <PopoverContent align={variant === "banner" ? "center" : "start"} side={variant === "banner" ? "bottom" : "right"} className={cn("p-1 text-sm", editing ? "w-80 p-3" : "w-56")} data-repeat-options>
        {editing ? (
          <div className="space-y-3">
            <div className="flex items-center justify-between">
              <span className="text-sm font-semibold">{t("pages.db.templates.cadence")}</span>
              <button type="button" className="rounded bg-[#2383e2] px-2.5 py-1 text-xs font-medium text-white hover:bg-[#0077d4] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#2383e2] focus-visible:ring-offset-1" onClick={() => save(editing)} data-save-cadence>
                {t("pages.db.templates.save")}
              </button>
            </div>
            <ScheduleEditor schedule={editing} onChange={setEditing} />
            {repeat ? (
              <button type="button" className="w-full rounded px-2 py-1 text-left text-red-600 hover:bg-red-50" onClick={() => save(null)}>{t("pages.db.templates.cancelRecurrence")}</button>
            ) : null}
          </div>
        ) : (
          <>
            <p className="px-2 py-1 text-xs text-slate-500">{t("pages.db.templates.repeatHint")}</p>
            {SCHEDULE_PRESETS.map((preset) => (
              <button key={preset.id} type="button" className={`${menuItem} justify-between`} aria-pressed={current === preset.id} onClick={() => choose(preset.id)}>
                {t(`pages.db.templates.presets.${preset.id}`)}
                {current === preset.id ? <Check className="h-3.5 w-3.5 text-[#2383e2]" aria-hidden="true" /> : null}
              </button>
            ))}
            <div className="my-1 border-t border-slate-100" />
            <button
              type="button"
              className={menuItem}
              onClick={() => setEditing(repeat ?? { ...defaultSchedule("week", 1, new Date(), localTimeZone()) })}
            >
              <Pencil className="h-3.5 w-3.5" aria-hidden="true" />{t("pages.db.templates.cadence")}
            </button>
            {repeat ? (
              <>
                <button type="button" className={`${menuItem} text-red-600`} onClick={() => save(null)}>
                  <Trash2 className="h-3.5 w-3.5" aria-hidden="true" />{t("pages.db.templates.cancelRecurrence")}
                </button>
                <p className="px-2 py-1 text-xs text-slate-500">
                  {template.repeatNextAt
                    ? t("pages.db.templates.nextOccurrence", { time: formatNextRun(template.repeatNextAt, repeat.timezone, i18n.language) })
                    : t("pages.db.templates.noNext")}
                </p>
              </>
            ) : null}
          </>
        )}
      </PopoverContent>
    </Popover>
  );
};

const TemplateItem = ({ name, icon, isDefault, onUse, actions, extra, repeatLabel }: {
  name: string;
  icon: string | null;
  isDefault: boolean;
  onUse: () => void;
  actions: { label: string; icon: typeof Pencil; danger?: boolean; run: () => void }[];
  /** At the top of the ⋯ menu: "Duplicate every…". */
  extra?: ReactNode;
  /** Set when the template repeats; shown as Notion's blue repeat icon. */
  repeatLabel?: string | null;
}) => {
  const { t } = useTranslation();
  const [open, setOpen] = useState(false);
  return (
    <div className="group/template flex items-center rounded hover:bg-slate-100" data-template-item>
      <button type="button" className="flex min-w-0 flex-1 items-center gap-2 px-2 py-1 text-left" onClick={onUse}>
        <span aria-hidden="true" className="w-4 shrink-0 text-center">{icon ?? <FileText className="h-3.5 w-3.5 text-slate-500" />}</span>
        <span className="truncate">{name}</span>
        {isDefault ? <span className="ml-auto shrink-0 text-xs text-slate-500">{t("pages.db.templates.isDefault")}</span> : null}
      </button>
        {repeatLabel ? (
          <TooltipProvider delayDuration={200}>
            <Tooltip>
              <TooltipTrigger asChild>
                <span tabIndex={0} aria-label={repeatLabel} className="mr-1 shrink-0 rounded text-[#2383e2] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#2383e2]" data-repeat-icon>
                  <Repeat className="h-3.5 w-3.5" aria-hidden="true" />
                </span>
              </TooltipTrigger>
              <TooltipContent>{repeatLabel}</TooltipContent>
            </Tooltip>
          </TooltipProvider>
        ) : null}
      {actions.length > 0 ? <Popover open={open} onOpenChange={setOpen}>
        <PopoverTrigger asChild>
          <button type="button" className="mr-1 rounded p-0.5 text-slate-500 opacity-0 hover:bg-slate-200 focus-visible:opacity-100 group-hover/template:opacity-100 max-lg:opacity-100" aria-label={t("pages.db.templates.options", { name })}>
            <MoreHorizontal className="h-3.5 w-3.5" aria-hidden="true" />
          </button>
        </PopoverTrigger>
        <PopoverContent align="start" side="right" className={cn("p-1 text-sm", extra ? "w-64" : "w-44")}>
          {extra ? <>{extra}<div className="my-1 border-t border-slate-100" /></> : null}
          {actions.map((action) => (
            <button
              key={action.label}
              type="button"
              className={menuItem}
              onClick={() => { setOpen(false); action.run(); }}
            >
              <action.icon className="h-3.5 w-3.5" aria-hidden="true" />{action.label}
            </button>
          ))}
        </PopoverContent>
      </Popover> : <span className="mr-1 w-[18px]" aria-hidden="true" />}
    </div>
  );
};

/** Notion's blue "New" button: a click uses the default template, the arrow picks another or edits them. */
export const NewRowButton = ({ db }: { db: DatabaseHandle }) => {
  const { t } = useTranslation();
  const [menuOpen, setMenuOpen] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const templates = db.database.templates;
  const fallback = templates.find((template) => template.isDefault);
  const editing = templates.find((template) => template.id === editingId) ?? null;
  const untitled = t("common.untitledMemo");
  const unitOf = useRepeatUnit();

  const use = (templateId?: string) => {
    setMenuOpen(false);
    void db.addRow(templateId ? { templateId } : undefined);
  };
  const edit = (templateId: string) => {
    setMenuOpen(false);
    setEditingId(templateId);
  };
  const create = async () => {
    setMenuOpen(false);
    const template = await db.saveTemplate(null, { name: "", title: "", isDefault: false });
    if (template) setEditingId(template.id);
  };
  const duplicate = (template: DatabaseTemplate) => void db.saveTemplate(null, {
    name: template.name,
    title: template.title,
    icon: template.icon,
    properties: template.properties,
    content: template.content,
    isDefault: false,
  });

  return (
    <div className="ml-1 flex h-7 items-stretch overflow-hidden rounded-md bg-[#2383e2] text-sm text-white">
      <button type="button" className="px-2.5 hover:bg-[#0077d4]" onClick={() => use(fallback?.id)}>{t("pages.db.new")}</button>
      <Popover open={menuOpen} onOpenChange={setMenuOpen}>
        <PopoverTrigger asChild>
          <button type="button" className="border-l border-white/30 px-1 hover:bg-[#0077d4]" aria-label={t("pages.db.templates.menuButton")}>
            <ChevronDown className="h-3.5 w-3.5" aria-hidden="true" />
          </button>
        </PopoverTrigger>
        <PopoverContent align="end" className="w-72 p-1 text-sm" data-template-menu>
          <p className="truncate px-2 py-1 text-xs font-medium text-slate-500">
            {t("pages.db.templates.menu", { name: db.database.title || untitled })}
          </p>
          {templates.length === 0 ? <p className="px-2 pb-1 text-xs text-slate-400">{t("pages.db.templates.hint")}</p> : null}
          {templates.map((template) => (
            <TemplateItem
              key={template.id}
              name={template.name || untitled}
              icon={template.icon}
              isDefault={template.isDefault}
              onUse={() => use(template.id)}
              repeatLabel={template.repeat ? t("pages.db.templates.repeatIcon", { unit: unitOf(template.repeat) }) : null}
              extra={<RepeatMenu db={db} template={template} variant="menu" />}
              actions={[
                ...(template.isDefault ? [] : [{ label: t("pages.db.templates.setDefault"), icon: Flag, run: () => void db.saveTemplate(template.id, { isDefault: true }) }]),
                { label: t("pages.db.templates.edit"), icon: Pencil, run: () => edit(template.id) },
                { label: t("pages.db.templates.duplicate"), icon: Copy, run: () => duplicate(template) },
                { label: t("pages.db.templates.delete"), icon: Trash2, danger: true, run: () => void db.deleteTemplate(template.id) },
              ]}
            />
          ))}
          {templates.length > 0 ? (
            <TemplateItem
              name={t("pages.db.templates.empty")}
              icon={null}
              isDefault={!fallback}
              onUse={() => use()}
              actions={fallback ? [{ label: t("pages.db.templates.setDefault"), icon: Flag, run: () => void db.saveTemplate(fallback.id, { isDefault: false }) }] : []}
            />
          ) : null}
          <div className="my-1 border-t border-slate-100" />
          <button type="button" className={`${menuItem} text-slate-600`} onClick={() => void create()}>
            <Plus className="h-3.5 w-3.5" aria-hidden="true" />{t("pages.db.templates.newTemplate")}
          </button>
        </PopoverContent>
      </Popover>
      {editing ? <TemplatePage key={editing.id} db={db} template={editing} onClose={() => setEditingId(null)} /> : null}
    </div>
  );
};
