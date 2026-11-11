import { useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { ChevronDown, Copy, FileText, Flag, MoreHorizontal, Pencil, Plus, Smile, Trash2 } from "lucide-react";
import { EditorContent, useEditor } from "@tiptap/react";
import {
  COMPUTED_PROPERTY_TYPES,
  createPonderDocumentExtensions,
  docToMarkdown,
  markdownToDoc,
  type DatabasePropertyValue,
  type DatabaseRow,
  type DatabaseTemplate,
} from "@ponder/shared";
import { createPonderMathematics } from "@ponder/shared/mathematics";
import { PageBlockAttributes } from "@ponder/shared/page-color";
import { Dialog, DialogContent, DialogTitle } from "@/components/ui/dialog";
import { Popover, PopoverContainer, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { DatabaseCell } from "./DatabaseCell";
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
            <DialogTitle className="text-sm font-normal">
              {t("pages.db.templates.banner", { name: db.database.title || t("common.untitledMemo") })}
            </DialogTitle>
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

const TemplateItem = ({ name, icon, isDefault, onUse, actions }: {
  name: string;
  icon: string | null;
  isDefault: boolean;
  onUse: () => void;
  actions: { label: string; icon: typeof Pencil; danger?: boolean; run: () => void }[];
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
      {actions.length > 0 ? <Popover open={open} onOpenChange={setOpen}>
        <PopoverTrigger asChild>
          <button type="button" className="mr-1 rounded p-0.5 text-slate-500 opacity-0 hover:bg-slate-200 focus-visible:opacity-100 group-hover/template:opacity-100 max-lg:opacity-100" aria-label={t("pages.db.templates.options", { name })}>
            <MoreHorizontal className="h-3.5 w-3.5" aria-hidden="true" />
          </button>
        </PopoverTrigger>
        <PopoverContent align="start" side="right" className="w-44 p-1 text-sm">
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
