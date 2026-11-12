import { useState, type ReactNode } from "react";
import { useTranslation } from "react-i18next";
import { useQuery } from "@tanstack/react-query";
import {
  Bell, ChevronDown, ExternalLink, FilePlus2, Mail, MessageSquare, MessageSquareWarning, MoreHorizontal, PencilLine, Plus, Webhook, X,
} from "lucide-react";
import {
  AUTOMATION_NOTIFY_LIMIT,
  type AutomationAction,
  type AutomationActionType,
  type DatabaseProperty,
  type DatabasePropertyValue,
  type DatabaseSchema,
} from "@ponder/shared";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import {
  DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { useWorkspaceMembers } from "@/components/comments/PageComments";
import { usePages } from "@/components/pages/PagesProvider";
import { api } from "@/lib/api";
import { databaseKey } from "./useDatabase";

export const ACTION_ICONS: Record<AutomationActionType, typeof Bell> = {
  edit_property: PencilLine,
  add_page: FilePlus2,
  add_comment: MessageSquare,
  send_notification: Bell,
  send_mail: Mail,
  send_webhook: Webhook,
  show_confirmation: MessageSquareWarning,
  open_url: ExternalLink,
};

/** Properties an action can set; computed ones, files and relations can't be. */
const SETTABLE = new Set(["title", "text", "number", "select", "multi_select", "status", "date", "checkbox", "url", "email", "phone", "person"]);
export const settableProperties = (schema: DatabaseSchema | null | undefined) => (schema?.properties ?? []).filter((property) => SETTABLE.has(property.type));

export const newAction = (type: AutomationActionType, databaseId: string | null): AutomationAction => {
  switch (type) {
    case "edit_property": return { type, values: {} };
    case "add_page": return { type, databaseId: databaseId ?? "", title: "", values: {} };
    case "add_comment": return { type, body: "" };
    case "send_notification": return { type, recipients: { kind: "people", userIds: [] }, message: "" };
    case "send_mail": return { type, to: { kind: "emails", emails: [] }, subject: "", body: "" };
    case "send_webhook": return { type };
    case "show_confirmation": return { type, message: "" };
    case "open_url": return { type, url: "" };
  }
};

const EXAMPLE = { example: "{{Name}}" };

/** One property's value in an action. Dates can be "today" or "now", worked out when the action runs. */
export const ValueEditor = ({ property, value, onChange, dynamicDates = true }: {
  property: DatabaseProperty;
  value: DatabasePropertyValue | undefined;
  onChange: (value: DatabasePropertyValue) => void;
  dynamicDates?: boolean;
}) => {
  const { t } = useTranslation();
  const members = useWorkspaceMembers(property.type === "person");
  const label = t("pages.db.automations.setTo", { property: property.name });
  const trigger = "h-8 min-w-0 flex-1";
  switch (property.type) {
    case "select":
    case "status":
    case "multi_select": {
      const current = Array.isArray(value) ? value[0] : value;
      return (
        <Select value={typeof current === "string" && current ? current : "__empty"} onValueChange={(id) => onChange(id === "__empty" ? (property.type === "multi_select" ? [] : null) : property.type === "multi_select" ? [id] : id)}>
          <SelectTrigger className={trigger} aria-label={label}><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value="__empty">{t("pages.db.automations.empty_value")}</SelectItem>
            {(property.options ?? []).map((option) => <SelectItem key={option.id} value={option.id}>{option.name}</SelectItem>)}
          </SelectContent>
        </Select>
      );
    }
    case "checkbox":
      return (
        <Select value={value === true ? "yes" : "no"} onValueChange={(next) => onChange(next === "yes")}>
          <SelectTrigger className={trigger} aria-label={label}><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value="yes">{t("pages.db.automations.checked")}</SelectItem>
            <SelectItem value="no">{t("pages.db.automations.unchecked")}</SelectItem>
          </SelectContent>
        </Select>
      );
    case "person": {
      const current = Array.isArray(value) && typeof value[0] === "string" ? value[0] : "__empty";
      return (
        <Select value={current} onValueChange={(id) => onChange(id === "__empty" ? [] : [id])}>
          <SelectTrigger className={trigger} aria-label={label}><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value="__empty">{t("pages.db.automations.empty_value")}</SelectItem>
            {(members.data ?? []).map((member) => <SelectItem key={member.id} value={member.id}>{member.displayName || member.username}</SelectItem>)}
          </SelectContent>
        </Select>
      );
    }
    case "date": {
      const start = value && typeof value === "object" && !Array.isArray(value) && "start" in value ? String(value.start) : "";
      const mode = start === "@today" ? "today" : start === "@now" ? "now" : start ? "date" : "empty";
      return (
        <>
          <Select
            value={mode}
            onValueChange={(next) => onChange(
              next === "today" ? { start: "@today" } : next === "now" ? { start: "@now" } : next === "date" ? { start: new Date().toISOString().slice(0, 10) } : null,
            )}
          >
            <SelectTrigger className={trigger} aria-label={label}><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="empty">{t("pages.db.automations.empty_value")}</SelectItem>
              {dynamicDates ? <SelectItem value="today">{t("pages.db.automations.today")}</SelectItem> : null}
              {dynamicDates ? <SelectItem value="now">{t("pages.db.automations.now")}</SelectItem> : null}
              <SelectItem value="date">{t("pages.db.automations.specificDate")}</SelectItem>
            </SelectContent>
          </Select>
          {mode === "date" ? (
            <Input type="date" className="h-8 w-36" aria-label={label} value={start.slice(0, 10)} onChange={(event) => event.target.value && onChange({ start: event.target.value })} />
          ) : null}
        </>
      );
    }
    case "number":
      return (
        <Input
          type="number"
          className="h-8 min-w-0 flex-1"
          aria-label={label}
          value={typeof value === "number" ? value : ""}
          onChange={(event) => onChange(event.target.value === "" ? null : Number(event.target.value))}
        />
      );
    default:
      return (
        <Input
          className="h-8 min-w-0 flex-1"
          aria-label={label}
          value={typeof value === "string" ? value : ""}
          placeholder={t("pages.db.automations.empty_value")}
          onChange={(event) => onChange(event.target.value)}
        />
      );
  }
};

/** Property rows ("Status ▾ | Done ▾") and Notion's "Edit property ▾" to add one. */
const ValuesEditor = ({ schema, values, onChange }: {
  schema: DatabaseSchema | null | undefined;
  values: Record<string, DatabasePropertyValue>;
  onChange: (values: Record<string, DatabasePropertyValue>) => void;
}) => {
  const { t } = useTranslation();
  const [open, setOpen] = useState(false);
  const properties = settableProperties(schema);
  const chosen = properties.filter((property) => property.id in values);
  const unused = properties.filter((property) => !(property.id in values));
  return (
    <div className="space-y-1.5">
      {chosen.map((property) => (
        <div key={property.id} className="flex min-w-0 items-center gap-1.5">
          <span className="w-28 shrink-0 truncate rounded bg-slate-100 px-2 py-1 text-xs text-slate-700">{property.name}</span>
          <ValueEditor property={property} value={values[property.id]} onChange={(value) => onChange({ ...values, [property.id]: value })} />
          <button
            type="button"
            aria-label={t("pages.db.automations.removeValue", { property: property.name })}
            className="rounded p-1 text-slate-400 hover:bg-slate-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#2383e2]"
            onClick={() => {
              const { [property.id]: _removed, ...rest } = values;
              onChange(rest);
            }}
          >
            <X className="h-3.5 w-3.5" aria-hidden="true" />
          </button>
        </div>
      ))}
      {unused.length ? (
        <Popover open={open} onOpenChange={setOpen}>
          <PopoverTrigger asChild>
            <button type="button" className="flex items-center gap-1 rounded px-1.5 py-1 text-xs text-slate-500 hover:bg-slate-100">
              {t("pages.db.automations.editProperty")}<ChevronDown className="h-3 w-3" aria-hidden="true" />
            </button>
          </PopoverTrigger>
          <PopoverContent align="start" className="max-h-72 w-56 overflow-y-auto p-1">
            {unused.map((property) => (
              <button
                key={property.id}
                type="button"
                className="flex w-full rounded px-2 py-1 text-left text-sm hover:bg-slate-100"
                onClick={() => {
                  setOpen(false);
                  onChange({ ...values, [property.id]: property.type === "multi_select" || property.type === "person" ? [] : property.type === "checkbox" ? true : property.type === "title" ? "" : null });
                }}
              >
                {property.name}
              </button>
            ))}
          </PopoverContent>
        </Popover>
      ) : null}
    </div>
  );
};

const AddPageFields = ({ action, onChange }: { action: Extract<AutomationAction, { type: "add_page" }>; onChange: (action: AutomationAction) => void }) => {
  const { t } = useTranslation();
  const pages = usePages();
  const databases = (pages?.nodes ?? []).filter((node) => node.databaseId);
  const target = useQuery({
    queryKey: databaseKey(action.databaseId),
    queryFn: async () => (await api.getDatabase(action.databaseId)).database,
    enabled: Boolean(action.databaseId),
  });
  return (
    <div className="space-y-1.5">
      <Select value={action.databaseId || undefined} onValueChange={(databaseId) => onChange({ ...action, databaseId, values: {} })}>
        <SelectTrigger className="h-8" aria-label={t("pages.db.automations.selectDatabase")}><SelectValue placeholder={t("pages.db.automations.selectDatabase")} /></SelectTrigger>
        <SelectContent>
          {databases.map((node) => <SelectItem key={node.databaseId} value={node.databaseId!}>{node.title || t("common.untitledMemo")}</SelectItem>)}
        </SelectContent>
      </Select>
      {action.databaseId ? (
        <>
          <div className="flex items-center gap-1.5">
            <span className="w-28 shrink-0 truncate rounded bg-slate-100 px-2 py-1 text-xs text-slate-700">{t("pages.db.automations.pageTitle")}</span>
            <Input className="h-8" value={action.title} placeholder={t("pages.db.automations.pageTitlePlaceholder")} aria-label={t("pages.db.automations.pageTitle")} onChange={(event) => onChange({ ...action, title: event.target.value })} />
          </div>
          <ValuesEditor
            schema={target.data ? { ...target.data.schema, properties: target.data.schema.properties.filter((property) => property.type !== "title") } : null}
            values={action.values}
            onChange={(values) => onChange({ ...action, values })}
          />
        </>
      ) : null}
    </div>
  );
};

const PEOPLE_TYPES = new Set(["person", "created_by", "last_edited_by"]);

const NotificationFields = ({ action, schema, onChange }: {
  action: Extract<AutomationAction, { type: "send_notification" }>;
  schema: DatabaseSchema | null | undefined;
  onChange: (action: AutomationAction) => void;
}) => {
  const { t } = useTranslation();
  const members = useWorkspaceMembers();
  const personProperties = (schema?.properties ?? []).filter((property) => PEOPLE_TYPES.has(property.type));
  const recipients = action.recipients;
  return (
    <div className="space-y-1.5">
      <Select
        value={recipients.kind === "people" ? "people" : `prop:${recipients.propertyId}`}
        onValueChange={(next) => onChange({
          ...action,
          recipients: next === "people" ? { kind: "people", userIds: [] } : { kind: "property", propertyId: next.slice(5) },
        })}
      >
        <SelectTrigger className="h-8" aria-label={t("pages.db.automations.actions.send_notification")}><SelectValue /></SelectTrigger>
        <SelectContent>
          <SelectItem value="people">{t("pages.db.automations.specificPeople")}</SelectItem>
          {personProperties.map((property) => <SelectItem key={property.id} value={`prop:${property.id}`}>{property.name}</SelectItem>)}
        </SelectContent>
      </Select>
      {recipients.kind === "people" ? (
        <div className="flex flex-wrap gap-1" role="group" aria-label={t("pages.db.automations.selectPeople")}>
          {(members.data ?? []).map((member) => {
            const on = recipients.userIds.includes(member.id);
            return (
              <button
                key={member.id}
                type="button"
                aria-pressed={on}
                disabled={!on && recipients.userIds.length >= AUTOMATION_NOTIFY_LIMIT}
                className={`rounded-full border px-2 py-0.5 text-xs focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#2383e2] ${on ? "border-[#2383e2] bg-blue-50 text-[#2383e2]" : "border-slate-200 text-slate-600 hover:bg-slate-50"}`}
                onClick={() => onChange({
                  ...action,
                  recipients: { kind: "people", userIds: on ? recipients.userIds.filter((id) => id !== member.id) : [...recipients.userIds, member.id] },
                })}
              >
                {member.displayName || member.username}
              </button>
            );
          })}
        </div>
      ) : null}
      <Textarea
        rows={2}
        className="text-sm"
        aria-label={t("pages.db.automations.message")}
        placeholder={t("pages.db.automations.messagePlaceholder", EXAMPLE)}
        value={action.message}
        onChange={(event) => onChange({ ...action, message: event.target.value })}
      />
    </div>
  );
};

const MailFields = ({ action, schema, onChange }: {
  action: Extract<AutomationAction, { type: "send_mail" }>;
  schema: DatabaseSchema | null | undefined;
  onChange: (action: AutomationAction) => void;
}) => {
  const { t } = useTranslation();
  const [draft, setDraft] = useState(action.to.kind === "emails" ? action.to.emails.join(", ") : "");
  const properties = (schema?.properties ?? []).filter((property) => PEOPLE_TYPES.has(property.type) || property.type === "email");
  return (
    <div className="space-y-1.5">
      <Select
        value={action.to.kind === "emails" ? "emails" : `prop:${action.to.propertyId}`}
        onValueChange={(next) => onChange({ ...action, to: next === "emails" ? { kind: "emails", emails: [] } : { kind: "property", propertyId: next.slice(5) } })}
      >
        <SelectTrigger className="h-8" aria-label={t("pages.db.automations.actions.send_mail")}><SelectValue /></SelectTrigger>
        <SelectContent>
          <SelectItem value="emails">{t("pages.db.automations.emailAddresses")}</SelectItem>
          {properties.map((property) => <SelectItem key={property.id} value={`prop:${property.id}`}>{property.name}</SelectItem>)}
        </SelectContent>
      </Select>
      {action.to.kind === "emails" ? (
        <Input
          className="h-8"
          aria-label={t("pages.db.automations.emailAddresses")}
          placeholder={t("pages.db.automations.emailAddressesPlaceholder")}
          value={draft}
          onChange={(event) => {
            setDraft(event.target.value);
            const emails = event.target.value.split(/[\s,;]+/).map((item) => item.trim()).filter((item) => item.includes("@")).slice(0, AUTOMATION_NOTIFY_LIMIT);
            onChange({ ...action, to: { kind: "emails", emails } });
          }}
        />
      ) : null}
      <Input className="h-8" aria-label={t("pages.db.automations.subject")} placeholder={t("pages.db.automations.subject")} value={action.subject} onChange={(event) => onChange({ ...action, subject: event.target.value })} />
      <Textarea rows={3} className="text-sm" aria-label={t("pages.db.automations.body")} placeholder={t("pages.db.automations.messagePlaceholder", EXAMPLE)} value={action.body} onChange={(event) => onChange({ ...action, body: event.target.value })} />
    </div>
  );
};

const ActionCard = ({ action, index, count, schema, databaseId, onChange, onMove, onDuplicate, onDelete }: {
  action: AutomationAction;
  index: number;
  count: number;
  schema: DatabaseSchema | null | undefined;
  databaseId: string | null;
  onChange: (action: AutomationAction) => void;
  onMove: (delta: number) => void;
  onDuplicate: () => void;
  onDelete: () => void;
}) => {
  const { t } = useTranslation();
  const Icon = ACTION_ICONS[action.type];
  let body: ReactNode = null;
  switch (action.type) {
    case "edit_property":
      body = <ValuesEditor schema={schema} values={action.values} onChange={(values) => onChange({ ...action, values })} />;
      break;
    case "add_page":
      body = <AddPageFields action={action} onChange={onChange} />;
      break;
    case "add_comment":
      body = (
        <Textarea rows={2} className="text-sm" aria-label={t("pages.db.automations.actions.add_comment")} placeholder={t("pages.db.automations.commentPlaceholder", EXAMPLE)} value={action.body} onChange={(event) => onChange({ ...action, body: event.target.value })} />
      );
      break;
    case "send_notification":
      body = <NotificationFields action={action} schema={schema} onChange={onChange} />;
      break;
    case "send_mail":
      body = <MailFields action={action} schema={schema} onChange={onChange} />;
      break;
    case "send_webhook":
      body = <p className="text-xs text-slate-500">{t("pages.db.automations.webhookHelp")}</p>;
      break;
    case "show_confirmation":
      body = <Input className="h-8" aria-label={t("pages.db.automations.actions.show_confirmation")} placeholder={t("pages.db.automations.confirmationPlaceholder")} value={action.message} onChange={(event) => onChange({ ...action, message: event.target.value })} />;
      break;
    case "open_url":
      body = <Input className="h-8" aria-label={t("pages.db.automations.actions.open_url")} placeholder={t("pages.db.automations.urlPlaceholder")} value={action.url} onChange={(event) => onChange({ ...action, url: event.target.value })} />;
      break;
  }
  return (
    <div className="rounded-lg border border-slate-200 bg-white p-2.5 dark:bg-slate-100" data-action-card={action.type}>
      <div className="mb-2 flex items-center gap-2 text-sm font-medium text-slate-700">
        <Icon className="h-4 w-4 text-slate-500" aria-hidden="true" />
        <span className="min-w-0 flex-1 truncate">
          {t(`pages.db.automations.actions.${action.type}`)}
          {action.type === "edit_property" && databaseId ? <span className="ml-1.5 rounded bg-slate-100 px-1.5 py-0.5 text-xs font-normal text-slate-600">{t("pages.db.automations.thisPage")}</span> : null}
        </span>
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <button type="button" aria-label={t("pages.db.automations.actionOptions")} className="rounded p-1 text-slate-400 hover:bg-slate-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#2383e2]">
              <MoreHorizontal className="h-4 w-4" aria-hidden="true" />
            </button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end">
            <DropdownMenuItem disabled={index === 0} onSelect={() => onMove(-1)}>{t("pages.db.automations.moveUp")}</DropdownMenuItem>
            <DropdownMenuItem disabled={index === count - 1} onSelect={() => onMove(1)}>{t("pages.db.automations.moveDown")}</DropdownMenuItem>
            <DropdownMenuItem onSelect={onDuplicate}>{t("pages.db.automations.duplicate")}</DropdownMenuItem>
            <DropdownMenuSeparator />
            <DropdownMenuItem className="text-red-600" onSelect={onDelete}>{t("pages.db.automations.deleteAction")}</DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>
      {body}
    </div>
  );
};

/** Notion's "Do" list: action cards and "+ New action". Shared by automations, Button properties and /button blocks. */
export const ActionsEditor = ({ actions, onChange, allowed, schema, databaseId }: {
  actions: AutomationAction[];
  onChange: (actions: AutomationAction[]) => void;
  allowed: AutomationActionType[];
  /** The database whose page the actions act on ("This page"), if any. */
  schema: DatabaseSchema | null | undefined;
  databaseId: string | null;
}) => {
  const { t } = useTranslation();
  const replace = (index: number, action: AutomationAction) => onChange(actions.map((item, position) => (position === index ? action : item)));
  return (
    <div className="space-y-2" data-actions-editor>
      {actions.map((action, index) => (
        <ActionCard
          // Actions have no ids; their position is stable while editing.
          key={`${index}-${action.type}`}
          action={action}
          index={index}
          count={actions.length}
          schema={schema}
          databaseId={databaseId}
          onChange={(next) => replace(index, next)}
          onMove={(delta) => {
            const next = [...actions];
            const [moved] = next.splice(index, 1);
            next.splice(index + delta, 0, moved!);
            onChange(next);
          }}
          onDuplicate={() => onChange([...actions.slice(0, index + 1), structuredClone(action), ...actions.slice(index + 1)])}
          onDelete={() => onChange(actions.filter((_, position) => position !== index))}
        />
      ))}
      {actions.length < 20 ? (
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <button type="button" className="flex items-center gap-1.5 rounded px-1.5 py-1 text-sm text-slate-500 hover:bg-slate-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#2383e2]" data-new-action>
              <Plus className="h-4 w-4" aria-hidden="true" />{t("pages.db.automations.newAction")}
            </button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="start" className="w-60">
            {allowed.map((type) => {
              const Icon = ACTION_ICONS[type];
              return (
                <DropdownMenuItem key={type} onSelect={() => onChange([...actions, newAction(type, databaseId)])}>
                  <Icon className="mr-2 h-4 w-4 text-slate-500" aria-hidden="true" />{t(`pages.db.automations.actions.${type}`)}
                </DropdownMenuItem>
              );
            })}
          </DropdownMenuContent>
        </DropdownMenu>
      ) : null}
    </div>
  );
};
