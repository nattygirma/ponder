import { useEffect, useRef, useState, type ReactNode } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import {
  ArrowDown, ArrowLeft, ArrowUp, Asterisk, AtSign, Calendar, CheckSquare, ChevronRight, CircleDot, Eye, Hash, Link as LinkIcon,
  Bell, KeyRound, ListChecks, Lock, Paperclip, UserCircle, UserX, Phone, Plus, RefreshCw, Settings2, Text, Trash2, Type, X, type LucideIcon,
} from "lucide-react";
import {
  DATABASE_OPTION_COLORS,
  FORM_NEW_QUESTION_TYPES,
  formQuestionLabel,
  isFormQuestionType,
  toPublicFormQuestions,
  type DatabaseForm,
  type DatabaseFormAccess,
  type DatabaseFormQuestion,
  type DatabaseFormUpdate,
  type DatabaseProperty,
  type DatabasePropertyType,
  type DatabaseView,
  type FormQuestionType,
  type PublicDatabaseForm,
} from "@ponder/shared";
import { api, getPublicBaseUrl } from "@/lib/api";
import { copyTextToClipboard } from "@/lib/clipboard";
import { cn } from "@/lib/utils";
import { Dialog, DialogContent, DialogTitle } from "@/components/ui/dialog";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuLabel, DropdownMenuSeparator, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { Popover, PopoverAnchor, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import { FormFill } from "./FormFill";
import type { DatabaseHandle } from "./useDatabase";

export const databaseFormKey = (databaseId: string, viewId: string) => ["database-form", databaseId, viewId] as const;

export const formLink = (token: string) => `${getPublicBaseUrl().replace(/\/$/, "")}/f/${encodeURIComponent(token)}`;

const TYPE_ICONS: Record<FormQuestionType, LucideIcon> = {
  title: Type, text: Text, number: Hash, select: CircleDot, multi_select: ListChecks, status: CircleDot, date: Calendar,
  checkbox: CheckSquare, url: LinkIcon, email: AtSign, phone: Phone, files: Paperclip,
};

const newId = () => crypto.randomUUID().replace(/-/g, "").slice(0, 12);

/** The form behind a form view, saved a change at a time and shown straight away. */
const useDatabaseForm = (databaseId: string, viewId: string) => {
  const queryClient = useQueryClient();
  const key = databaseFormKey(databaseId, viewId);
  const query = useQuery({ queryKey: key, queryFn: async () => (await api.getDatabaseForm(databaseId, viewId)).form, staleTime: 15_000 });
  const [error, setError] = useState<string | null>(null);
  const [password, setPassword] = useState<string | null>(null);
  const mutation = useMutation({
    mutationFn: (patch: DatabaseFormUpdate) => api.updateDatabaseForm(databaseId, viewId, patch),
    onMutate: async (patch) => {
      await queryClient.cancelQueries({ queryKey: key });
      const previous = queryClient.getQueryData<DatabaseForm>(key);
      if (previous) {
        const { rotatePassword: _rotate, ...visible } = patch;
        queryClient.setQueryData<DatabaseForm>(key, { ...previous, ...visible });
      }
      return { previous };
    },
    onError: (reason: Error, _patch, context) => {
      if (context?.previous) queryClient.setQueryData(key, context.previous);
      setError(reason.message);
    },
    onSuccess: ({ form }) => {
      setError(null);
      if (form.password) setPassword(form.password);
      queryClient.setQueryData(key, { ...form, password: undefined });
    },
  });
  return { form: query.data, isLoading: query.isLoading, failed: query.isError, retry: query.refetch, update: mutation.mutate, error, clearError: () => setError(null), password };
};

type FormState = ReturnType<typeof useDatabaseForm>;

const IconButton = ({ label, onClick, children, className }: { label: string; onClick?: () => void; children: ReactNode; className?: string }) => (
  <Tooltip>
    <TooltipTrigger asChild>
      <button type="button" aria-label={label} onClick={onClick} className={cn("flex h-7 w-7 shrink-0 items-center justify-center rounded text-slate-500 hover:bg-slate-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#2383e2]", className)}>
        {children}
      </button>
    </TooltipTrigger>
    <TooltipContent side="bottom">{label}</TooltipContent>
  </Tooltip>
);

const Row = ({ icon: Icon, label, children, onClick }: { icon?: LucideIcon; label: string; children?: ReactNode; onClick?: () => void }) => {
  const body = (
    <>
      {Icon ? <Icon className="h-4 w-4 shrink-0 text-slate-500" aria-hidden="true" /> : <span className="w-4" />}
      <span className="min-w-0 flex-1 truncate text-left">{label}</span>
      {children}
    </>
  );
  return onClick ? (
    <button type="button" className="flex min-h-8 w-full items-center gap-2 rounded px-2 text-sm text-slate-800 hover:bg-slate-100" onClick={onClick}>{body}</button>
  ) : (
    <label className="flex min-h-8 w-full items-center gap-2 rounded px-2 text-sm text-slate-800">{body}</label>
  );
};

const answerable = (properties: DatabaseProperty[]) => properties.filter((property) => isFormQuestionType(property.type));

/** Notion's "Share form" popover: who can fill it out, anonymous responses, and the link. */
const SharePanel = ({ state, form }: { state: FormState; form: DatabaseForm }) => {
  const { t } = useTranslation();
  const [copied, setCopied] = useState(false);
  const link = formLink(form.token);
  return (
    <div className="space-y-1" data-form-share>
      <Row icon={UserCircle} label={t("pages.form.whoCanFill")}>
        <Select value={form.access} onValueChange={(access) => state.update({ access: access as DatabaseFormAccess })}>
          <SelectTrigger className="h-8 w-auto shrink-0 gap-1 whitespace-nowrap border-0 bg-transparent px-1 text-sm text-slate-500 shadow-none" aria-label={t("pages.form.whoCanFill")}><SelectValue /></SelectTrigger>
          <SelectContent align="end">
            {(["workspace", "public", "closed"] as const).map((value) => (
              <SelectItem key={value} value={value}>
                <span className="flex items-center gap-2">
                  {t(`pages.form.access.${value}`)}
                  {value === "public" ? <span className="rounded bg-amber-100 px-1 text-[11px] text-amber-800">{t("pages.form.publicBadge")}</span> : null}
                  {value === "closed" ? <span className="rounded bg-slate-100 px-1 text-[11px] text-slate-600">{t("pages.form.closedBadge")}</span> : null}
                </span>
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </Row>
      <Row icon={UserX} label={t("pages.form.anonymous")}>
        <Switch checked={form.anonymous} onCheckedChange={(anonymous) => state.update({ anonymous })} aria-label={t("pages.form.anonymous")} />
      </Row>
      {form.access === "public" ? (
        <>
          <Row icon={KeyRound} label={t("pages.form.password")}>
            <Switch checked={form.passwordProtected} onCheckedChange={(passwordProtected) => state.update({ passwordProtected })} aria-label={t("pages.form.password")} />
          </Row>
          {form.passwordProtected ? (
            <div className="space-y-1 px-2 pb-1 text-xs text-slate-500">
              {state.password ? <p className="select-all rounded bg-slate-50 px-2 py-1 font-mono text-slate-800" role="status">{t("pages.form.passwordOnce", { password: state.password })}</p> : <p>{t("pages.form.passwordHelp")}</p>}
              <button type="button" className="flex items-center gap-1 text-[#2383e2] hover:underline" onClick={() => state.update({ passwordProtected: true, rotatePassword: true })}>
                <RefreshCw className="h-3 w-3" aria-hidden="true" />{t("pages.form.newPassword")}
              </button>
            </div>
          ) : null}
        </>
      ) : null}
      <Row icon={Bell} label={t("pages.form.notify")}>
        <Switch checked={form.notify} onCheckedChange={(notify) => state.update({ notify })} aria-label={t("pages.form.notify")} />
      </Row>
      <div className="flex items-stretch overflow-hidden rounded-md border border-slate-200">
        <input readOnly value={link} aria-label={t("pages.form.link")} className="min-w-0 flex-1 bg-slate-50 px-2 py-1.5 text-xs text-slate-600 outline-none" onFocus={(event) => event.currentTarget.select()} />
        <button
          type="button"
          className="flex shrink-0 items-center gap-1.5 border-l border-slate-200 px-2.5 text-sm font-medium text-slate-800 hover:bg-slate-100"
          onClick={async () => { if (await copyTextToClipboard(link)) { setCopied(true); window.setTimeout(() => setCopied(false), 1500); } }}
        >
          <LinkIcon className="h-3.5 w-3.5" aria-hidden="true" />{copied ? t("pages.form.copied") : t("pages.form.copyLink")}
        </button>
      </div>
      <p className="px-2 pt-1 text-xs text-slate-500">{t("pages.form.responses", { count: form.responseCount })}</p>
    </div>
  );
};

/** Notion's "Form settings": the view's name, a new question, the submit screen, and deleting the form. */
const SettingsPanel = ({ db, view, state, form, addQuestion }: { db: DatabaseHandle; view: DatabaseView; state: FormState; form: DatabaseForm; addQuestion: (type: FormQuestionType) => void }) => {
  const { t } = useTranslation();
  const [panel, setPanel] = useState<"main" | "submit">("main");
  if (panel === "submit") {
    return (
      <div className="space-y-2" data-form-submit-screen>
        <div className="flex items-center gap-1">
          <IconButton label={t("pages.form.back")} onClick={() => setPanel("main")}><ArrowLeft className="h-4 w-4" aria-hidden="true" /></IconButton>
          <span className="font-semibold">{t("pages.form.submitScreen")}</span>
        </div>
        <p className="px-1 text-xs font-medium text-slate-500">{t("pages.form.submitButton")}</p>
        <label className="flex items-center gap-2 px-1 text-sm">
          <span className="w-16 text-slate-500">{t("pages.form.buttonText")}</span>
          <input key={form.submitLabel} defaultValue={form.submitLabel} placeholder={t("pages.form.submit")} maxLength={60} className="min-w-0 flex-1 rounded border border-slate-200 bg-transparent px-2 py-1 outline-none focus:border-[#2383e2]"
            onBlur={(event) => { if (event.target.value.trim() !== form.submitLabel) state.update({ submitLabel: event.target.value.trim() }); }} />
        </label>
        <label className="block space-y-1 px-1 text-xs font-medium text-slate-500">
          {t("pages.form.confirmationTitle")}
          <input key={form.confirmationTitle} defaultValue={form.confirmationTitle} placeholder={t("pages.form.thanks")} maxLength={200} className="w-full rounded border border-slate-200 bg-transparent px-2 py-1 text-sm font-normal text-slate-900 outline-none focus:border-[#2383e2]"
            onBlur={(event) => { if (event.target.value.trim() !== form.confirmationTitle) state.update({ confirmationTitle: event.target.value.trim() }); }} />
        </label>
        <label className="block space-y-1 px-1 text-xs font-medium text-slate-500">
          {t("pages.form.confirmationBody")}
          <textarea key={form.confirmationMessage} defaultValue={form.confirmationMessage} placeholder={t("pages.form.submitted")} rows={3} maxLength={2000} className="w-full resize-y rounded border border-slate-200 bg-transparent px-2 py-1 text-sm font-normal text-slate-900 outline-none focus:border-[#2383e2]"
            onBlur={(event) => { if (event.target.value !== form.confirmationMessage) state.update({ confirmationMessage: event.target.value }); }} />
        </label>
        <p className="border-t border-slate-100 px-1 pt-2 text-xs font-medium text-slate-500">{t("pages.form.moreButtons")}</p>
        <Row label={t("pages.form.submitAnother")}>
          <Switch checked={form.submitAnother} onCheckedChange={(submitAnother) => state.update({ submitAnother })} aria-label={t("pages.form.submitAnother")} />
        </Row>
      </div>
    );
  }
  return (
    <div className="space-y-1" data-form-settings>
      <p className="px-2 pb-1 font-semibold">{t("pages.form.settings")}</p>
      <input
        key={view.name}
        defaultValue={view.name}
        aria-label={t("pages.form.viewName")}
        className="mb-1 w-full rounded border border-slate-200 bg-slate-50 px-2 py-1.5 text-sm outline-none focus:border-[#2383e2]"
        onBlur={(event) => { const name = event.target.value.trim(); if (name && name !== view.name) void db.updateView(view.id, { name }); }}
        onKeyDown={(event) => { if (event.key === "Enter") event.currentTarget.blur(); }}
      />
      <Row icon={Plus} label={t("pages.form.newQuestion")} onClick={() => addQuestion("text")} />
      <Row icon={Settings2} label={t("pages.form.submitScreen")} onClick={() => setPanel("submit")}><ChevronRight className="h-4 w-4 text-slate-400" aria-hidden="true" /></Row>
      {db.database.views.length > 1 ? (
        <>
          <div className="my-1 border-t border-slate-100" />
          <Row icon={Trash2} label={t("pages.form.deleteForm")} onClick={() => void db.deleteView(view.id)} />
        </>
      ) : null}
    </div>
  );
};

/** The right side of the view bar for a form: settings, Preview and Share form, as in Notion. */
export const FormTools = ({ db, view, shareOpen, onShareOpenChange }: { db: DatabaseHandle; view: DatabaseView; shareOpen: boolean; onShareOpenChange: (open: boolean) => void }) => {
  const { t } = useTranslation();
  const state = useDatabaseForm(db.database.id, view.id);
  const [previewOpen, setPreviewOpen] = useState(false);
  const form = state.form;
  if (!form) return null;
  const preview: PublicDatabaseForm = {
    passwordRequired: false,
    title: form.title || db.database.title || "",
    description: form.description,
    submitLabel: form.submitLabel,
    confirmationTitle: form.confirmationTitle,
    confirmationMessage: form.confirmationMessage,
    submitAnother: form.submitAnother,
    respondent: null,
    questions: toPublicFormQuestions(form.questions, db.database.schema.properties),
  };
  return (
    <TooltipProvider delayDuration={200}>
      <div className="flex items-center gap-1" data-form-tools>
        <Popover>
          <Tooltip>
            <TooltipTrigger asChild>
              <PopoverTrigger asChild>
                <button type="button" aria-label={t("pages.form.settings")} className="flex h-7 w-7 items-center justify-center rounded text-slate-500 hover:bg-slate-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#2383e2]">
                  <Settings2 className="h-3.5 w-3.5" aria-hidden="true" />
                </button>
              </PopoverTrigger>
            </TooltipTrigger>
            <TooltipContent side="bottom">{t("pages.form.settings")}</TooltipContent>
          </Tooltip>
          <PopoverContent align="end" className="w-80">
            <SettingsPanel db={db} view={view} state={state} form={form} addQuestion={(type) => void addFormQuestion(db, state, form, type)} />
          </PopoverContent>
        </Popover>
        <button type="button" className="flex h-7 items-center gap-1.5 rounded-md border border-slate-200 px-2.5 text-sm text-slate-800 hover:bg-slate-50" onClick={() => setPreviewOpen(true)}>
          <Eye className="h-3.5 w-3.5" aria-hidden="true" />{t("pages.form.preview")}
        </button>
        <Popover open={shareOpen} onOpenChange={onShareOpenChange}>
          <PopoverTrigger asChild>
            <button type="button" className="h-7 rounded-md bg-[#2383e2] px-2.5 text-sm font-medium text-white hover:bg-[#0077d4]">{t("pages.form.share")}</button>
          </PopoverTrigger>
          <PopoverContent align="end" className="w-[28rem] max-w-[calc(100vw-1.5rem)]">
            <SharePanel state={state} form={form} />
          </PopoverContent>
        </Popover>
      </div>
      <Dialog open={previewOpen} onOpenChange={setPreviewOpen}>
        <DialogContent className="max-h-[90dvh] max-w-3xl overflow-y-auto p-0">
          <DialogTitle className="sr-only">{t("pages.form.preview")}</DialogTitle>
          {/* A new key each time it opens, so the preview starts empty. */}
          {previewOpen ? <FormFill form={preview} token={form.token} className="pt-10" /> : null}
        </DialogContent>
      </Dialog>
    </TooltipProvider>
  );
};

const defaultOptions = () => [1, 2, 3].map((number, index) => ({ id: newId(), name: `Option ${number}`, color: DATABASE_OPTION_COLORS[(index + 4) % DATABASE_OPTION_COLORS.length]! }));

/** "+ Add question": a new property of that type, linked to a new question at the end, as Notion does. */
const addFormQuestion = async (db: DatabaseHandle, state: FormState, form: DatabaseForm, type: FormQuestionType, existing?: DatabaseProperty) => {
  if (existing) {
    state.update({ questions: [...form.questions, { propertyId: existing.id, syncName: true }] });
    return;
  }
  const properties = db.database.schema.properties;
  let number = form.questions.length + 1;
  while (properties.some((property) => property.name === `Question ${number}`)) number += 1;
  const property: DatabaseProperty = {
    id: newId(),
    name: `Question ${number}`,
    type,
    ...(type === "select" || type === "multi_select" ? { options: defaultOptions() } : {}),
  };
  await db.updateSchema({ properties: [...properties, property] });
  state.update({ questions: [...form.questions, { propertyId: property.id, syncName: true }] });
};

const AddQuestion = ({ db, state, form }: { db: DatabaseHandle; state: FormState; form: DatabaseForm }) => {
  const { t } = useTranslation();
  const used = new Set(form.questions.map((question) => question.propertyId));
  const unused = answerable(db.database.schema.properties).filter((property) => !used.has(property.id));
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button type="button" className="flex h-9 items-center gap-1.5 rounded-md px-2 text-sm text-slate-500 hover:bg-slate-100 hover:text-slate-800">
          <Plus className="h-4 w-4" aria-hidden="true" />{t("pages.form.addQuestion")}
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" className="max-h-[60vh] w-60 overflow-y-auto">
        {FORM_NEW_QUESTION_TYPES.map((type) => {
          const Icon = TYPE_ICONS[type];
          return (
            <DropdownMenuItem key={type} onSelect={() => void addFormQuestion(db, state, form, type)}>
              <Icon className="h-4 w-4" aria-hidden="true" />{t(`pages.db.types.${type}`)}
            </DropdownMenuItem>
          );
        })}
        {unused.length ? (
          <>
            <DropdownMenuSeparator />
            <DropdownMenuLabel className="text-xs text-slate-500">{t("pages.form.existingProperties")}</DropdownMenuLabel>
            {unused.map((property) => {
              const Icon = TYPE_ICONS[property.type as FormQuestionType];
              return (
                <DropdownMenuItem key={property.id} onSelect={() => void addFormQuestion(db, state, form, property.type as FormQuestionType, property)}>
                  <Icon className="h-4 w-4" aria-hidden="true" /><span className="truncate">{property.name}</span>
                </DropdownMenuItem>
              );
            })}
          </>
        ) : null}
      </DropdownMenuContent>
    </DropdownMenu>
  );
};

const AnswerPreview = ({ db, property, longAnswer }: { db: DatabaseHandle; property: DatabaseProperty; longAnswer: boolean }) => {
  const { t } = useTranslation();
  const [adding, setAdding] = useState("");
  if (property.type === "select" || property.type === "multi_select" || property.type === "status") {
    const round = property.type !== "multi_select";
    const addOption = () => {
      const name = adding.trim();
      setAdding("");
      if (!name || property.options?.some((option) => option.name === name)) return;
      const color = DATABASE_OPTION_COLORS[(property.options?.length ?? 0) % DATABASE_OPTION_COLORS.length]!;
      void db.updateSchema({
        properties: db.database.schema.properties.map((item) => (item.id === property.id ? { ...item, options: [...(item.options ?? []), { id: newId(), name, color }] } : item)),
      });
    };
    return (
      <div className="space-y-1.5 text-base text-slate-700">
        <p className="text-sm text-slate-500">{t(round ? "pages.form.selectOne" : "pages.form.selectMany")}</p>
        {(property.options ?? []).map((option) => (
          <div key={option.id} className="flex items-center gap-3">
            <span className={cn("h-[18px] w-[18px] shrink-0 border border-slate-400", round ? "rounded-full" : "rounded")} aria-hidden="true" />
            <span className="truncate">{option.name}</span>
          </div>
        ))}
        {property.type !== "status" ? (
          <div className="flex items-center gap-3">
            <span className={cn("h-[18px] w-[18px] shrink-0 border border-dashed border-slate-300", round ? "rounded-full" : "rounded")} aria-hidden="true" />
            <input
              value={adding}
              placeholder={t("pages.form.addOption")}
              aria-label={t("pages.form.addOption")}
              className="min-w-0 flex-1 bg-transparent text-base outline-none placeholder:text-slate-400"
              onChange={(event) => setAdding(event.target.value)}
              onBlur={addOption}
              onKeyDown={(event) => { if (event.key === "Enter") { event.preventDefault(); addOption(); } }}
            />
          </div>
        ) : null}
      </div>
    );
  }
  if (property.type === "checkbox") {
    return <div className="flex items-center gap-3 text-base text-slate-700"><span className="h-[18px] w-[18px] rounded border border-slate-400" aria-hidden="true" />{t("pages.form.checkboxLabel")}</div>;
  }
  if (property.type === "files") {
    return <div className="flex items-center gap-2 rounded-md border border-dashed border-slate-300 px-3 py-2.5 text-sm text-slate-500"><Paperclip className="h-4 w-4" aria-hidden="true" />{t("pages.form.uploadPreview")}</div>;
  }
  return <div className={cn("rounded-md border border-slate-200 px-3 py-2 text-base text-slate-400", longAnswer && "min-h-20")}>{t("pages.form.respondentAnswer")}</div>;
};

/** "Question options", Notion's panel beside the selected question. */
const QuestionOptions = ({ db, form, state, index, onClose }: { db: DatabaseHandle; form: DatabaseForm; state: FormState; index: number; onClose: () => void }) => {
  const { t } = useTranslation();
  const question = form.questions[index]!;
  const properties = db.database.schema.properties;
  const property = properties.find((item) => item.id === question.propertyId);
  const used = new Set(form.questions.map((item) => item.propertyId));
  const linkable = answerable(properties).filter((item) => item.id === question.propertyId || !used.has(item.id));
  const patch = (next: Partial<DatabaseFormQuestion>) => state.update({ questions: form.questions.map((item, position) => (position === index ? { ...item, ...next } : item)) });
  const move = (offset: number) => {
    const target = index + offset;
    if (target < 0 || target >= form.questions.length) return;
    const next = [...form.questions];
    [next[index], next[target]] = [next[target]!, next[index]!];
    state.update({ questions: next });
  };
  const textual = property?.type === "text" || property?.type === "title";
  return (
    <div className="space-y-0.5" data-form-question-options>
      <div className="flex items-center justify-between px-2 pb-1">
        <span className="font-semibold">{t("pages.form.questionOptions")}</span>
        <IconButton label={t("pages.form.close")} onClick={onClose}><X className="h-4 w-4" aria-hidden="true" /></IconButton>
      </div>
      <Row icon={Asterisk} label={t("pages.form.required")}><Switch checked={question.required === true} onCheckedChange={(required) => patch({ required })} aria-label={t("pages.form.required")} /></Row>
      <Row icon={Text} label={t("pages.form.description")}><Switch checked={question.description !== undefined} onCheckedChange={(on) => patch({ description: on ? "" : undefined })} aria-label={t("pages.form.description")} /></Row>
      {textual ? <Row icon={Type} label={t("pages.form.longAnswer")}><Switch checked={question.longAnswer === true} onCheckedChange={(longAnswer) => patch({ longAnswer })} aria-label={t("pages.form.longAnswer")} /></Row> : null}
      <div className="my-1 border-t border-slate-100" />
      <Row label={t("pages.form.questionType")}>
        {property && property.type !== "title" ? (
          <Select
            value={property.type}
            onValueChange={(type) => void db.updateSchema({
              properties: properties.map((item) => (item.id === property.id
                ? { ...item, type: type as DatabasePropertyType, ...((type === "select" || type === "multi_select") && !item.options?.length ? { options: defaultOptions() } : {}) }
                : item)),
            })}
          >
            <SelectTrigger className="h-7 w-auto border-0 bg-transparent text-xs text-slate-500 shadow-none" aria-label={t("pages.form.questionType")}><SelectValue /></SelectTrigger>
            <SelectContent align="end">
              {[...new Set<FormQuestionType>([property.type as FormQuestionType, ...FORM_NEW_QUESTION_TYPES])].map((type) => <SelectItem key={type} value={type}>{t(`pages.db.types.${type}`)}</SelectItem>)}
            </SelectContent>
          </Select>
        ) : <span className="text-xs text-slate-500">{t("pages.form.titleType")}</span>}
      </Row>
      <Row label={t("pages.form.linkedProperty")}>
        <Select value={question.propertyId} onValueChange={(propertyId) => patch({ propertyId })}>
          <SelectTrigger className="h-7 w-auto max-w-[9rem] border-0 bg-transparent text-xs text-slate-500 shadow-none" aria-label={t("pages.form.linkedProperty")}><SelectValue /></SelectTrigger>
          <SelectContent align="end">{linkable.map((item) => <SelectItem key={item.id} value={item.id}>{item.name}</SelectItem>)}</SelectContent>
        </Select>
      </Row>
      <Row icon={RefreshCw} label={t("pages.form.syncName")}>
        <Switch
          checked={question.syncName !== false}
          onCheckedChange={(on) => patch(on ? { syncName: true, label: undefined } : { syncName: false, label: property?.name ?? "" })}
          aria-label={t("pages.form.syncName")}
        />
      </Row>
      <div className="my-1 border-t border-slate-100" />
      {index > 0 ? <Row icon={ArrowUp} label={t("pages.form.moveUp")} onClick={() => move(-1)} /> : null}
      {index < form.questions.length - 1 ? <Row icon={ArrowDown} label={t("pages.form.moveDown")} onClick={() => move(1)} /> : null}
      <Row icon={Trash2} label={t("pages.form.deleteQuestion")} onClick={() => { onClose(); state.update({ questions: form.questions.filter((_, position) => position !== index) }); }} />
    </div>
  );
};

const QuestionCard = ({ db, form, state, index, selected, onSelect }: {
  db: DatabaseHandle;
  form: DatabaseForm;
  state: FormState;
  index: number;
  selected: boolean;
  onSelect: (selected: boolean) => void;
}) => {
  const { t } = useTranslation();
  const cardRef = useRef<HTMLDivElement>(null);
  const question = form.questions[index]!;
  const property = db.database.schema.properties.find((item) => item.id === question.propertyId);
  // Notion opens a question's options to the right of the card; where there's no room (a narrow window), below it.
  const roomOnRight = !cardRef.current || window.innerWidth - cardRef.current.getBoundingClientRect().right >= 300;
  if (!property || !isFormQuestionType(property.type)) return null;
  const label = formQuestionLabel(question, property);
  const saveLabel = (value: string) => {
    const next = value.trim();
    if (!next || next === label) return;
    if (question.syncName === false) {
      state.update({ questions: form.questions.map((item, position) => (position === index ? { ...item, label: next } : item)) });
    } else {
      // Synced: the question title is the property's name, so renaming one renames the other.
      void db.updateSchema({ properties: db.database.schema.properties.map((item) => (item.id === property.id ? { ...item, name: next } : item)) });
    }
  };
  return (
    <Popover open={selected} onOpenChange={(open) => { if (!open) onSelect(false); }}>
      <PopoverAnchor asChild>
        <div
          ref={cardRef}
          className={cn("rounded-xl border px-5 py-4 transition-colors sm:px-6", selected ? "border-[#2383e2] ring-1 ring-[#2383e2]" : "border-slate-200 hover:border-slate-300")}
          onClick={() => onSelect(true)}
          data-form-question-card={property.type}
        >
          <div className="flex items-start gap-1">
            <input
              key={label}
              defaultValue={label}
              aria-label={t("pages.form.questionTitle")}
              className="min-w-0 max-w-full bg-transparent [field-sizing:content] text-xl font-semibold text-slate-900 outline-none sm:text-2xl"
              onFocus={() => onSelect(true)}
              onBlur={(event) => saveLabel(event.target.value)}
              onKeyDown={(event) => { if (event.key === "Enter") event.currentTarget.blur(); }}
            />
            {question.required ? <span className="pt-1 text-xl text-slate-400" aria-hidden="true">*</span> : null}
          </div>
          {question.description !== undefined ? (
            <input
              key={`d-${question.description}`}
              defaultValue={question.description}
              placeholder={t("pages.form.addDescription")}
              aria-label={t("pages.form.description")}
              className="mt-1 w-full bg-transparent text-sm text-slate-600 outline-none placeholder:text-slate-400"
              onBlur={(event) => {
                if (event.target.value !== question.description) {
                  state.update({ questions: form.questions.map((item, position) => (position === index ? { ...item, description: event.target.value } : item)) });
                }
              }}
            />
          ) : null}
          <div className="mt-3"><AnswerPreview db={db} property={property} longAnswer={question.longAnswer === true} /></div>
        </div>
      </PopoverAnchor>
      <PopoverContent side={roomOnRight ? "right" : "bottom"} align={roomOnRight ? "start" : "end"} sideOffset={roomOnRight ? 12 : 6} collisionPadding={12} className="w-72" onOpenAutoFocus={(event) => event.preventDefault()}>
        <QuestionOptions db={db} form={form} state={state} index={index} onClose={() => onSelect(false)} />
      </PopoverContent>
    </Popover>
  );
};

/** The form builder: the form as visitors will see it, edited in place, like Notion's. */
export const FormBuilder = ({ db, view, onChangeAccess }: { db: DatabaseHandle; view: DatabaseView; onChangeAccess: () => void }) => {
  const { t } = useTranslation();
  const state = useDatabaseForm(db.database.id, view.id);
  const [selected, setSelected] = useState<number | null>(null);
  const description = useRef<HTMLTextAreaElement>(null);
  const form = state.form;

  useEffect(() => {
    const element = description.current;
    if (!element) return;
    element.style.height = "auto";
    element.style.height = `${element.scrollHeight}px`;
  }, [form?.description]);

  if (state.isLoading) return <div className="py-6 text-sm text-slate-400">{t("pages.db.loading")}</div>;
  if (state.failed || !form) {
    return (
      <div className="rounded border border-slate-200 p-4 text-sm text-slate-500" role="alert">
        {t("pages.form.loadFailed")} <button type="button" className="underline" onClick={() => void state.retry()}>{t("pages.db.retry")}</button>
      </div>
    );
  }
  const AccessIcon = Lock;
  return (
    <TooltipProvider delayDuration={200}>
      <div className="mx-auto w-full max-w-[640px] pb-16 pt-6" data-form-builder>
        {state.error ? (
          <p className="mb-3 flex items-center justify-between gap-2 rounded bg-red-50 px-3 py-2 text-sm text-red-700" role="alert">
            {state.error}
            <button type="button" aria-label={t("pages.db.dismiss")} onClick={state.clearError}><X className="h-3.5 w-3.5" aria-hidden="true" /></button>
          </p>
        ) : null}
        <input
          key={`t-${form.title}`}
          defaultValue={form.title}
          placeholder={t("pages.form.titlePlaceholder")}
          aria-label={t("pages.form.titlePlaceholder")}
          maxLength={200}
          className="w-full bg-transparent px-1 text-[2.5rem] font-bold leading-tight text-slate-900 outline-none placeholder:text-slate-300"
          onBlur={(event) => { if (event.target.value !== form.title) state.update({ title: event.target.value }); }}
          onKeyDown={(event) => { if (event.key === "Enter") event.currentTarget.blur(); }}
        />
        <textarea
          ref={description}
          key={`d-${form.description}`}
          defaultValue={form.description}
          placeholder={t("pages.form.descriptionPlaceholder")}
          aria-label={t("pages.form.descriptionPlaceholder")}
          rows={1}
          maxLength={2000}
          className="mt-2 w-full resize-none overflow-hidden bg-transparent px-1 text-base text-slate-800 outline-none placeholder:text-slate-400"
          onInput={(event) => { event.currentTarget.style.height = "auto"; event.currentTarget.style.height = `${event.currentTarget.scrollHeight}px`; }}
          onBlur={(event) => { if (event.target.value !== form.description) state.update({ description: event.target.value }); }}
        />
        <div className="mt-5 flex items-center gap-3 rounded-lg bg-slate-50 px-4 py-3 text-sm text-slate-600" data-form-access-banner>
          <AccessIcon className="h-4 w-4 shrink-0" aria-hidden="true" />
          <span className="min-w-0 flex-1">{t(`pages.form.banner.${form.access}`)}</span>
          <button type="button" className="shrink-0 rounded px-2 py-1 font-medium text-slate-700 hover:bg-slate-200" onClick={onChangeAccess}>{t("pages.form.change")}</button>
        </div>
        <div className="mt-6 space-y-4">
          {form.questions.length === 0 ? <p className="px-1 text-sm text-slate-500">{t("pages.form.noQuestions")}</p> : null}
          {form.questions.map((question, index) => (
            <QuestionCard
              key={question.propertyId}
              db={db}
              form={form}
              state={state}
              index={index}
              selected={selected === index}
              onSelect={(on) => setSelected(on ? index : null)}
            />
          ))}
        </div>
        <div className="mt-4"><AddQuestion db={db} state={state} form={form} /></div>
      </div>
    </TooltipProvider>
  );
};
