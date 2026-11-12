import { useState } from "react";
import { useTranslation } from "react-i18next";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { ArrowLeft, CalendarClock, CircleAlert, CircleCheck, CircleSlash, FilePlus2, History, MoreHorizontal, PencilLine, Plus, Repeat, Zap } from "lucide-react";
import {
  AUTOMATION_ACTION_TYPES,
  AUTOMATION_TRIGGER_TYPES,
  defaultSchedule,
  type AutomationAction,
  type AutomationTrigger,
  type AutomationTriggerType,
  type DatabaseAutomation,
  type DatabaseSchema,
} from "@ponder/shared";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import {
  DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { api } from "@/lib/api";
import { cn } from "@/lib/utils";
import { ACTION_ICONS, ActionsEditor, ValueEditor } from "./ActionsEditor";
import { formatNextRun, localTimeZone, ScheduleEditor, TimeZoneSelect } from "./ScheduleEditor";
import { automationsKey, useAutomations, type DatabaseHandle } from "./useDatabase";

const runsKey = (databaseId: string, automationId: string | null) => ["database-automation-runs", databaseId, automationId] as const;

const TRIGGER_ICONS: Record<AutomationTriggerType, typeof Zap> = {
  page_added: FilePlus2,
  property_edited: PencilLine,
  date_reached: CalendarClock,
  recurring: Repeat,
};

const WATCHABLE = new Set(["title", "text", "number", "select", "multi_select", "status", "date", "checkbox", "url", "email", "phone", "person", "relation", "files"]);

const errorText = (error: unknown) => (error instanceof Error && error.message ? error.message : "Something went wrong.");

const newTrigger = (type: AutomationTriggerType, schema: DatabaseSchema): AutomationTrigger => {
  const zone = localTimeZone();
  switch (type) {
    case "page_added": return { type };
    case "property_edited": return { type, propertyId: schema.properties.find((property) => property.type === "status")?.id ?? "title" };
    case "date_reached": return { type, propertyId: schema.properties.find((property) => property.type === "date")?.id ?? "", offsetDays: 0, time: "09:00", timezone: zone };
    case "recurring": return { type, schedule: { ...defaultSchedule("week", 1, new Date(), zone), time: "09:00" } };
  }
};

const useTriggerSummary = (schema: DatabaseSchema) => {
  const { t } = useTranslation();
  return (trigger: AutomationTrigger) => {
    const name = (id: string) => schema.properties.find((property) => property.id === id)?.name ?? "?";
    switch (trigger.type) {
      case "page_added": return t("pages.db.automations.triggerSummary.page_added");
      case "property_edited": {
        if (trigger.to === undefined) return t("pages.db.automations.triggerSummary.property_edited", { property: name(trigger.propertyId) });
        const property = schema.properties.find((item) => item.id === trigger.propertyId);
        const id = Array.isArray(trigger.to) ? trigger.to[0] : trigger.to;
        const value = property?.options?.find((option) => option.id === id)?.name ?? (typeof id === "boolean" ? (id ? "✓" : "✗") : String(id ?? ""));
        return t("pages.db.automations.triggerSummary.property_set", { property: name(trigger.propertyId), value });
      }
      case "date_reached":
        return trigger.offsetDays === 0
          ? t("pages.db.automations.triggerSummary.date_reached", { property: name(trigger.propertyId) })
          : t("pages.db.automations.triggerSummary.date_offset", {
            days: Math.abs(trigger.offsetDays), direction: t(trigger.offsetDays < 0 ? "pages.db.automations.before" : "pages.db.automations.after"), property: name(trigger.propertyId),
          });
      case "recurring": {
        const unit = t(`pages.db.templates.unitsLower.${trigger.schedule.unit}`);
        return t("pages.db.automations.triggerSummary.recurring", { schedule: trigger.schedule.interval > 1 ? `${trigger.schedule.interval} ${unit}s` : unit });
      }
    }
  };
};

const Field = ({ label, children }: { label: string; children: React.ReactNode }) => (
  <div className="grid grid-cols-[5.5rem_minmax(0,1fr)] items-center gap-2 text-sm">
    <span className="text-slate-500">{label}</span>
    <div className="flex min-w-0 items-center gap-1.5">{children}</div>
  </div>
);

/** Notion's "When" card. */
const TriggerEditor = ({ trigger, schema, onChange }: { trigger: AutomationTrigger; schema: DatabaseSchema; onChange: (trigger: AutomationTrigger) => void }) => {
  const { t } = useTranslation();
  const Icon = TRIGGER_ICONS[trigger.type];
  const watchable = schema.properties.filter((property) => WATCHABLE.has(property.type));
  const dates = schema.properties.filter((property) => property.type === "date");
  return (
    <div className="space-y-2.5 rounded-lg border border-slate-200 bg-white p-2.5 dark:bg-slate-100" data-trigger-card={trigger.type}>
      <div className="flex items-center gap-2">
        <Icon className="h-4 w-4 text-slate-500" aria-hidden="true" />
        <Select value={trigger.type} onValueChange={(type) => onChange(newTrigger(type as AutomationTriggerType, schema))}>
          <SelectTrigger className="h-8 min-w-0 flex-1 font-medium" aria-label={t("pages.db.automations.when")}><SelectValue /></SelectTrigger>
          <SelectContent>{AUTOMATION_TRIGGER_TYPES.map((type) => <SelectItem key={type} value={type}>{t(`pages.db.automations.triggers.${type}`)}</SelectItem>)}</SelectContent>
        </Select>
      </div>
      {trigger.type === "property_edited" ? (() => {
        const property = schema.properties.find((item) => item.id === trigger.propertyId);
        const canSetTo = property && property.type !== "title" && property.type !== "relation" && property.type !== "files";
        return (
          <>
            <Field label={t("pages.db.automations.property")}>
              <Select value={trigger.propertyId} onValueChange={(propertyId) => onChange({ type: "property_edited", propertyId })}>
                <SelectTrigger className="h-8 min-w-0 flex-1"><SelectValue placeholder={t("pages.db.automations.choose")} /></SelectTrigger>
                <SelectContent>{watchable.map((item) => <SelectItem key={item.id} value={item.id}>{item.name}</SelectItem>)}</SelectContent>
              </Select>
            </Field>
            {canSetTo ? (
              <Field label="">
                <Select
                  value={trigger.to === undefined ? "edited" : "set"}
                  onValueChange={(mode) => onChange(mode === "edited"
                    ? { type: "property_edited", propertyId: trigger.propertyId }
                    : { ...trigger, to: property.options?.[0]?.id ?? (property.type === "checkbox" ? true : "") })}
                >
                  <SelectTrigger className="h-8 w-32"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="edited">{t("pages.db.automations.isEdited")}</SelectItem>
                    <SelectItem value="set">{t("pages.db.automations.isSetTo")}</SelectItem>
                  </SelectContent>
                </Select>
                {trigger.to !== undefined ? (
                  <ValueEditor property={property} value={trigger.to} dynamicDates={false} onChange={(to) => onChange({ ...trigger, to: to ?? null })} />
                ) : null}
              </Field>
            ) : null}
          </>
        );
      })() : null}
      {trigger.type === "date_reached" ? (
        <>
          <Field label={t("pages.db.automations.property")}>
            <Select value={trigger.propertyId || undefined} onValueChange={(propertyId) => onChange({ ...trigger, propertyId })}>
              <SelectTrigger className="h-8 min-w-0 flex-1"><SelectValue placeholder={t("pages.db.automations.choose")} /></SelectTrigger>
              <SelectContent>{dates.map((item) => <SelectItem key={item.id} value={item.id}>{item.name}</SelectItem>)}</SelectContent>
            </Select>
          </Field>
          <Field label="">
            <Select
              value={trigger.offsetDays === 0 ? "on" : trigger.offsetDays < 0 ? "before" : "after"}
              onValueChange={(mode) => onChange({ ...trigger, offsetDays: mode === "on" ? 0 : (mode === "before" ? -1 : 1) * Math.max(1, Math.abs(trigger.offsetDays)) })}
            >
              <SelectTrigger className="h-8 min-w-0 flex-1"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="on">{t("pages.db.automations.onTheDay")}</SelectItem>
                <SelectItem value="before">{t("pages.db.automations.daysBefore")}</SelectItem>
                <SelectItem value="after">{t("pages.db.automations.daysAfter")}</SelectItem>
              </SelectContent>
            </Select>
            {trigger.offsetDays !== 0 ? (
              <Input
                type="number"
                min={1}
                max={365}
                className="h-8 w-16"
                aria-label={t(trigger.offsetDays < 0 ? "pages.db.automations.daysBefore" : "pages.db.automations.daysAfter")}
                value={Math.abs(trigger.offsetDays)}
                onChange={(event) => onChange({ ...trigger, offsetDays: Math.sign(trigger.offsetDays) * Math.min(365, Math.max(1, Math.round(Number(event.target.value) || 1))) })}
              />
            ) : null}
          </Field>
          <Field label={t("pages.db.automations.at")}>
            <Input type="time" className="h-8 w-28" aria-label={t("pages.db.automations.at")} value={trigger.time} onChange={(event) => event.target.value && onChange({ ...trigger, time: event.target.value })} />
          </Field>
          <Field label={t("pages.db.automations.timezone")}>
            <TimeZoneSelect value={trigger.timezone} label={t("pages.db.automations.timezone")} onChange={(timezone) => onChange({ ...trigger, timezone })} />
          </Field>
        </>
      ) : null}
      {trigger.type === "recurring" ? <ScheduleEditor schedule={trigger.schedule} onChange={(schedule) => onChange({ type: "recurring", schedule })} /> : null}
    </div>
  );
};

type Draft = { id: string | null; name: string; enabled: boolean; trigger: AutomationTrigger; actions: AutomationAction[] };

const Editor = ({ db, draft: initial, onDone }: { db: DatabaseHandle; draft: Draft; onDone: () => void }) => {
  const { t } = useTranslation();
  const queryClient = useQueryClient();
  const [draft, setDraft] = useState(initial);
  const [saving, setSaving] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);
  const schema = db.database.schema;
  const noPage = draft.trigger.type === "recurring";
  const allowed = AUTOMATION_ACTION_TYPES.filter((type) => !noPage || (type !== "edit_property" && type !== "add_comment"));
  const save = async () => {
    setSaving(true);
    setProblem(null);
    try {
      const payload = { name: draft.name.trim(), trigger: draft.trigger, actions: draft.actions };
      if (draft.id) await api.updateDatabaseAutomation(db.database.id, draft.id, payload);
      else await api.createDatabaseAutomation(db.database.id, { ...payload, enabled: true });
      await queryClient.invalidateQueries({ queryKey: automationsKey(db.database.id) });
      onDone();
    } catch (error) {
      setProblem(errorText(error));
    } finally {
      setSaving(false);
    }
  };
  return (
    <div className="space-y-3" data-automation-editor>
      <div className="flex items-center gap-2">
        <button type="button" aria-label={t("pages.db.automations.back")} className="rounded p-1 text-slate-500 hover:bg-slate-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#2383e2]" onClick={onDone}>
          <ArrowLeft className="h-4 w-4" aria-hidden="true" />
        </button>
        <Zap className="h-4 w-4 text-slate-500" aria-hidden="true" />
        <Input
          className="h-8 border-transparent px-1 text-base font-semibold shadow-none hover:border-slate-200 focus:border-slate-300"
          value={draft.name}
          placeholder={t("pages.db.automations.namePlaceholder")}
          aria-label={t("pages.db.automations.namePlaceholder")}
          onChange={(event) => setDraft({ ...draft, name: event.target.value })}
        />
      </div>
      <section className="space-y-1.5">
        <h3 className="text-xs font-medium text-slate-500">{t("pages.db.automations.when")}</h3>
        <TriggerEditor
          trigger={draft.trigger}
          schema={schema}
          onChange={(trigger) => setDraft({
            ...draft,
            trigger,
            actions: trigger.type === "recurring" ? draft.actions.filter((action) => action.type !== "edit_property" && action.type !== "add_comment") : draft.actions,
          })}
        />
      </section>
      <section className="space-y-1.5">
        <h3 className="text-xs font-medium text-slate-500">{t("pages.db.automations.do")}</h3>
        {noPage ? <p className="text-xs text-slate-500">{t("pages.db.automations.needsPage")}</p> : null}
        <ActionsEditor actions={draft.actions} onChange={(actions) => setDraft({ ...draft, actions })} allowed={allowed} schema={noPage ? null : schema} databaseId={noPage ? null : db.database.id} />
        <p className="text-xs text-slate-400">{t("pages.db.automations.placeholders", { example: "{{Name}}" })}</p>
      </section>
      {problem ? (
        <Alert variant="destructive" className="py-2"><AlertDescription>{problem}</AlertDescription></Alert>
      ) : null}
      <div className="flex justify-end gap-2">
        <Button type="button" variant="ghost" size="sm" onClick={onDone}>{t("pages.db.automations.cancel")}</Button>
        <Button type="button" size="sm" className="bg-[#2383e2] text-white hover:bg-[#0077d4]" disabled={saving || draft.actions.length === 0} onClick={() => void save()} data-save-automation>
          {draft.id ? t("pages.db.automations.save") : t("pages.db.automations.create")}
        </Button>
      </div>
    </div>
  );
};

const RUN_ICONS = { success: CircleCheck, error: CircleAlert, skipped: CircleSlash } as const;

/** The run log: when each run was, for which page, and what went wrong. */
const RunLog = ({ db, automations, automationId, onBack }: { db: DatabaseHandle; automations: DatabaseAutomation[]; automationId: string | null; onBack: () => void }) => {
  const { t, i18n } = useTranslation();
  const runs = useQuery({ queryKey: runsKey(db.database.id, automationId), queryFn: () => api.listAutomationRuns(db.database.id, automationId ?? undefined) });
  const names = new Map(automations.map((automation) => [automation.id, automation.name || t("pages.db.automations.untitled")]));
  return (
    <div className="space-y-2" data-automation-runs>
      <div className="flex items-center gap-2">
        <button type="button" aria-label={t("pages.db.automations.back")} className="rounded p-1 text-slate-500 hover:bg-slate-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#2383e2]" onClick={onBack}>
          <ArrowLeft className="h-4 w-4" aria-hidden="true" />
        </button>
        <h2 className="text-sm font-semibold">{automationId ? `${names.get(automationId)} · ${t("pages.db.automations.runs")}` : t("pages.db.automations.runs")}</h2>
      </div>
      {runs.data?.runs.length === 0 ? <p className="py-4 text-center text-sm text-slate-500">{t("pages.db.automations.runsEmpty")}</p> : null}
      <ul className="max-h-80 space-y-1 overflow-y-auto">
        {(runs.data?.runs ?? []).map((run) => {
          const Icon = RUN_ICONS[run.status];
          return (
            <li key={run.id} className="rounded-md px-2 py-1.5 text-sm hover:bg-slate-50" data-run-status={run.status}>
              <div className="flex items-center gap-2">
                <Icon className={cn("h-4 w-4 shrink-0", run.status === "success" ? "text-emerald-600" : run.status === "error" ? "text-red-600" : "text-slate-400")} aria-hidden="true" />
                <span className="font-medium">{t(`pages.db.automations.runStatus.${run.status}`)}</span>
                <span className="min-w-0 flex-1 truncate text-slate-600">
                  {automationId ? null : <>{names.get(run.automationId)} · </>}
                  {run.rowId ? run.rowTitle || t("common.untitledMemo") : t("pages.db.automations.noPage")}
                </span>
                <time className="shrink-0 text-xs text-slate-400" dateTime={run.startedAt}>{new Date(run.startedAt).toLocaleString(i18n.language, { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" })}</time>
              </div>
              {run.error ? <p className="ml-6 mt-0.5 text-xs text-red-600">{run.error}</p> : null}
            </li>
          );
        })}
      </ul>
    </div>
  );
};

type Screen = { kind: "list" } | { kind: "edit"; draft: Draft } | { kind: "runs"; automationId: string | null };

const AutomationList = ({ db, onEdit, onRuns, onNew }: { db: DatabaseHandle; onEdit: (automation: DatabaseAutomation) => void; onRuns: (id: string | null) => void; onNew: () => void }) => {
  const { t, i18n } = useTranslation();
  const queryClient = useQueryClient();
  const query = useAutomations(db.database.id);
  const summary = useTriggerSummary(db.database.schema);
  const [problem, setProblem] = useState<string | null>(null);
  const automations = query.data?.automations ?? [];
  const change = async (work: () => Promise<unknown>) => {
    setProblem(null);
    try {
      await work();
    } catch (error) {
      setProblem(errorText(error));
    }
    await queryClient.invalidateQueries({ queryKey: automationsKey(db.database.id) });
  };
  const usesMail = automations.some((automation) => automation.actions.some((action) => action.type === "send_mail"));
  const usesWebhook = automations.some((automation) => automation.actions.some((action) => action.type === "send_webhook"));
  return (
    <div className="space-y-3" data-automation-list>
      <div className="flex items-start gap-2">
        <Zap className="mt-0.5 h-4 w-4 text-slate-500" aria-hidden="true" />
        <div className="min-w-0 flex-1">
          <h2 className="text-sm font-semibold">{t("pages.db.automations.title")}</h2>
          <p className="text-xs text-slate-500">{t("pages.db.automations.intro")}</p>
        </div>
        <TooltipProvider delayDuration={200}>
          <Tooltip>
            <TooltipTrigger asChild>
              <button type="button" aria-label={t("pages.db.automations.runs")} className="rounded p-1 text-slate-500 hover:bg-slate-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#2383e2]" onClick={() => onRuns(null)}>
                <History className="h-4 w-4" aria-hidden="true" />
              </button>
            </TooltipTrigger>
            <TooltipContent>{t("pages.db.automations.runs")}</TooltipContent>
          </Tooltip>
        </TooltipProvider>
      </div>
      {problem ? <Alert variant="destructive" className="py-2"><AlertDescription>{problem}</AlertDescription></Alert> : null}
      {query.isSuccess && automations.length === 0 ? <p className="rounded-md bg-slate-50 py-4 text-center text-sm text-slate-500">{t("pages.db.automations.empty")}</p> : null}
      <ul className="space-y-1">
        {automations.map((automation) => {
          const Icon = TRIGGER_ICONS[automation.trigger.type];
          const timeZone = automation.trigger.type === "recurring" ? automation.trigger.schedule.timezone : automation.trigger.type === "date_reached" ? automation.trigger.timezone : localTimeZone();
          const next = automation.enabled ? formatNextRun(automation.nextRunAt, timeZone, i18n.language) : null;
          const name = automation.name || t("pages.db.automations.untitled");
          return (
            <li key={automation.id} className="group flex items-center gap-2 rounded-md border border-slate-200 px-2 py-2" data-automation={automation.id}>
              <Icon className="h-4 w-4 shrink-0 text-slate-500" aria-hidden="true" />
              <button type="button" className="min-w-0 flex-1 rounded text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#2383e2]" onClick={() => onEdit(automation)}>
                <span className={cn("block truncate text-sm font-medium", !automation.enabled && "text-slate-400")}>{name}</span>
                <span className="flex items-center gap-1 truncate text-xs text-slate-500">
                  {summary(automation.trigger)}
                  <span aria-hidden="true">→</span>
                  {automation.actions.map((action, index) => {
                    const ActionIcon = ACTION_ICONS[action.type];
                    return <ActionIcon key={index} className="h-3 w-3" aria-label={t(`pages.db.automations.actions.${action.type}`)} />;
                  })}
                </span>
                {next ? <span className="block text-xs text-slate-400">{t("pages.db.automations.nextRun", { time: next })}</span> : null}
                {!automation.enabled ? <span className="block text-xs text-slate-400">{t("pages.db.automations.paused")}</span> : null}
              </button>
              <Switch
                checked={automation.enabled}
                aria-label={`${t("pages.db.automations.active")}: ${name}`}
                onCheckedChange={(enabled) => void change(() => api.updateDatabaseAutomation(db.database.id, automation.id, { enabled }))}
              />
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <button type="button" aria-label={t("pages.db.automations.options", { name })} className="rounded p-1 text-slate-400 hover:bg-slate-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#2383e2]">
                    <MoreHorizontal className="h-4 w-4" aria-hidden="true" />
                  </button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end">
                  <DropdownMenuItem onSelect={() => onEdit(automation)}>{t("pages.db.automations.edit")}</DropdownMenuItem>
                  <DropdownMenuItem onSelect={() => void change(() => api.updateDatabaseAutomation(db.database.id, automation.id, { enabled: !automation.enabled }))}>
                    {automation.enabled ? t("pages.db.automations.pause") : t("pages.db.automations.resume")}
                  </DropdownMenuItem>
                  <DropdownMenuItem onSelect={() => onRuns(automation.id)}>{t("pages.db.automations.runs")}</DropdownMenuItem>
                  <DropdownMenuSeparator />
                  <DropdownMenuItem
                    className="text-red-600"
                    onSelect={() => {
                      if (window.confirm(t("pages.db.automations.deleteConfirm"))) void change(() => api.deleteDatabaseAutomation(db.database.id, automation.id));
                    }}
                  >
                    {t("pages.db.automations.delete")}
                  </DropdownMenuItem>
                </DropdownMenuContent>
              </DropdownMenu>
            </li>
          );
        })}
      </ul>
      <button type="button" className="flex items-center gap-1.5 rounded px-1.5 py-1 text-sm text-slate-600 hover:bg-slate-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#2383e2]" onClick={onNew} data-new-automation>
        <Plus className="h-4 w-4" aria-hidden="true" />{t("pages.db.automations.new")}
      </button>
      {usesMail && query.data ? (
        <p className="text-xs text-slate-500">
          {query.data.email.available
            ? query.data.email.limit !== null ? t("pages.db.automations.emailUsage", { sent: query.data.email.sent, limit: query.data.email.limit }) : null
            : t("pages.db.automations.emailUnavailable")}
        </p>
      ) : null}
      {usesWebhook && query.data && !query.data.webhooks ? <p className="text-xs text-slate-500">{t("pages.db.automations.webhooksUnavailable")}</p> : null}
    </div>
  );
};

/** The ⚡ button in a database's toolbar, with Notion's Automations panel. */
export const AutomationsButton = ({ db }: { db: DatabaseHandle }) => {
  const { t } = useTranslation();
  const [open, setOpen] = useState(false);
  const [screen, setScreen] = useState<Screen>({ kind: "list" });
  const query = useAutomations(db.database.id);
  const active = (query.data?.automations ?? []).some((automation) => automation.enabled);
  const schema = db.database.schema;
  return (
    <Popover open={open} onOpenChange={(next) => { setOpen(next); if (!next) setScreen({ kind: "list" }); }}>
      <TooltipProvider delayDuration={200}>
        <Tooltip>
          <TooltipTrigger asChild>
            <PopoverTrigger asChild>
              <button
                type="button"
                aria-label={t("pages.db.automations.open")}
                className={cn("flex h-7 w-7 shrink-0 items-center justify-center rounded text-slate-500 hover:bg-slate-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#2383e2]", active && "text-blue-600")}
                data-automations-button
              >
                <Zap className="h-3.5 w-3.5" aria-hidden="true" />
              </button>
            </PopoverTrigger>
          </TooltipTrigger>
          <TooltipContent side="bottom">{t("pages.db.automations.open")}</TooltipContent>
        </Tooltip>
      </TooltipProvider>
      <PopoverContent align="end" collisionPadding={12} className="max-h-[min(80vh,var(--radix-popover-content-available-height))] w-[440px] max-w-[calc(100vw-2rem)] overflow-y-auto p-3">
        {screen.kind === "list" ? (
          <AutomationList
            db={db}
            onNew={() => setScreen({ kind: "edit", draft: { id: null, name: "", enabled: true, trigger: newTrigger("page_added", schema), actions: [] } })}
            onEdit={(automation) => setScreen({ kind: "edit", draft: { id: automation.id, name: automation.name, enabled: automation.enabled, trigger: automation.trigger, actions: automation.actions } })}
            onRuns={(automationId) => setScreen({ kind: "runs", automationId })}
          />
        ) : null}
        {screen.kind === "edit" ? <Editor db={db} draft={screen.draft} onDone={() => setScreen({ kind: "list" })} /> : null}
        {screen.kind === "runs" ? <RunLog db={db} automations={query.data?.automations ?? []} automationId={screen.automationId} onBack={() => setScreen({ kind: "list" })} /> : null}
      </PopoverContent>
    </Popover>
  );
};
