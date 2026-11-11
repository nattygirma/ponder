import { useMemo } from "react";
import { useTranslation } from "react-i18next";
import { nextScheduleRun, SCHEDULE_UNITS, type Schedule, type ScheduleUnit } from "@ponder/shared";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { cn } from "@/lib/utils";

/** The browser's time zone, which new schedules start in, as Notion's do. */
export const localTimeZone = () => {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC";
  } catch {
    return "UTC";
  }
};

export const timeZones = () => {
  try {
    const zones = (Intl as unknown as { supportedValuesOf?: (key: string) => string[] }).supportedValuesOf?.("timeZone") ?? [];
    return zones.includes("UTC") ? zones : ["UTC", ...zones];
  } catch {
    return ["UTC"];
  }
};

export const TimeZoneSelect = ({ value, onChange, label }: { value: string; onChange: (zone: string) => void; label: string }) => {
  const zones = useMemo(() => {
    const all = timeZones();
    return all.includes(value) ? all : [value, ...all];
  }, [value]);
  return (
    <Select value={value} onValueChange={onChange}>
      <SelectTrigger className="h-8" aria-label={label}><SelectValue /></SelectTrigger>
      <SelectContent className="max-h-72">{zones.map((zone) => <SelectItem key={zone} value={zone}>{zone.replace(/_/g, " ")}</SelectItem>)}</SelectContent>
    </Select>
  );
};

/** When a schedule next runs, in its own time zone, or null when it has ended. */
export const formatNextRun = (iso: string | Date | null, timeZone: string, locale?: string) => {
  if (!iso) return null;
  const date = typeof iso === "string" ? new Date(iso) : iso;
  try {
    return new Intl.DateTimeFormat(locale, { timeZone, weekday: "short", month: "short", day: "numeric", hour: "numeric", minute: "2-digit" }).format(date);
  } catch {
    return date.toLocaleString();
  }
};

const Row = ({ label, children }: { label: string; children: React.ReactNode }) => (
  <div className="grid grid-cols-[5.5rem_minmax(0,1fr)] items-center gap-2 text-sm">
    <span className="text-slate-500">{label}</span>
    <div className="flex min-w-0 items-center gap-1.5">{children}</div>
  </div>
);

/** Notion's "Edit cadence": every N units, on which days, at what time, from when, until when, in which time zone. */
export const ScheduleEditor = ({ schedule, onChange }: { schedule: Schedule; onChange: (next: Schedule) => void }) => {
  const { t, i18n } = useTranslation();
  const set = (patch: Partial<Schedule>) => onChange({ ...schedule, ...patch });
  const next = nextScheduleRun(schedule, new Date());
  const weekdays = schedule.weekdays ?? [];
  const toggleDay = (day: number) => {
    const chosen = weekdays.includes(day) ? weekdays.filter((item) => item !== day) : [...weekdays, day].sort();
    if (chosen.length > 0) set({ weekdays: chosen });
  };
  return (
    <div className="space-y-2.5" data-schedule-editor>
      <Row label={t("pages.db.templates.every")}>
        {schedule.unit === "weekday" ? null : (
          <Input
            type="number"
            min={1}
            max={365}
            className="h-8 w-16"
            aria-label={t("pages.db.templates.every")}
            value={schedule.interval}
            onChange={(event) => {
              const interval = Math.min(365, Math.max(1, Math.round(Number(event.target.value) || 1)));
              set({ interval });
            }}
          />
        )}
        <Select
          value={schedule.unit}
          onValueChange={(unit) => {
            const start = new Date(`${schedule.startDate}T00:00:00Z`).getUTCDay();
            set({ unit: unit as ScheduleUnit, interval: unit === "weekday" ? 1 : schedule.interval, weekdays: unit === "week" ? (weekdays.length ? weekdays : [start]) : undefined });
          }}
        >
          <SelectTrigger className="h-8 min-w-0 flex-1"><SelectValue /></SelectTrigger>
          <SelectContent>{SCHEDULE_UNITS.map((unit) => <SelectItem key={unit} value={unit}>{t(`pages.db.templates.units.${unit}`)}</SelectItem>)}</SelectContent>
        </Select>
      </Row>
      {schedule.unit === "week" ? (
        <Row label={t("pages.db.templates.on")}>
          <div className="flex flex-wrap gap-1" role="group" aria-label={t("pages.db.templates.on")}>
            {[1, 2, 3, 4, 5, 6, 0].map((day) => (
              <button
                key={day}
                type="button"
                aria-pressed={weekdays.includes(day)}
                className={cn(
                  "h-7 w-7 rounded-full border text-xs font-medium focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#2383e2]",
                  weekdays.includes(day) ? "border-[#2383e2] bg-[#2383e2] text-white" : "border-slate-200 text-slate-600 hover:bg-slate-50",
                )}
                onClick={() => toggleDay(day)}
              >
                {t(`pages.db.templates.weekdays.${day}`)}
              </button>
            ))}
          </div>
        </Row>
      ) : null}
      <Row label={t("pages.db.templates.at")}>
        <Select value={schedule.time === null ? "midnight" : "time"} onValueChange={(mode) => set({ time: mode === "midnight" ? null : schedule.time ?? "09:00" })}>
          <SelectTrigger className="h-8 min-w-0 flex-1"><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value="midnight">{t("pages.db.templates.aroundMidnight")}</SelectItem>
            <SelectItem value="time">{schedule.time ?? "09:00"}</SelectItem>
          </SelectContent>
        </Select>
        {schedule.time === null ? null : (
          <Input type="time" className="h-8 w-28" aria-label={t("pages.db.templates.at")} value={schedule.time} onChange={(event) => event.target.value && set({ time: event.target.value })} />
        )}
      </Row>
      <Row label={t("pages.db.templates.starting")}>
        <Input type="date" className="h-8" aria-label={t("pages.db.templates.starting")} value={schedule.startDate} onChange={(event) => event.target.value && set({ startDate: event.target.value })} />
      </Row>
      <Row label={t("pages.db.templates.ending")}>
        <Select
          value={schedule.end.kind}
          onValueChange={(kind) => set({
            end: kind === "runs" ? { kind: "runs", count: 10 } : kind === "date" ? { kind: "date", date: schedule.startDate } : { kind: "never" },
          })}
        >
          <SelectTrigger className="h-8 min-w-0 flex-1"><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value="never">{t("pages.db.templates.never")}</SelectItem>
            <SelectItem value="runs">{t("pages.db.templates.numberOfRuns")}</SelectItem>
            <SelectItem value="date">{t("pages.db.templates.specificDate")}</SelectItem>
          </SelectContent>
        </Select>
        {schedule.end.kind === "runs" ? (
          <Input
            type="number"
            min={1}
            max={1000}
            className="h-8 w-20"
            aria-label={t("pages.db.templates.numberOfRuns")}
            value={schedule.end.count}
            onChange={(event) => set({ end: { kind: "runs", count: Math.min(1000, Math.max(1, Math.round(Number(event.target.value) || 1))) } })}
          />
        ) : null}
        {schedule.end.kind === "date" ? (
          <Input type="date" className="h-8 w-36" aria-label={t("pages.db.templates.specificDate")} value={schedule.end.date} onChange={(event) => event.target.value && set({ end: { kind: "date", date: event.target.value } })} />
        ) : null}
      </Row>
      <Row label={t("pages.db.templates.timezone")}>
        <TimeZoneSelect value={schedule.timezone} label={t("pages.db.templates.timezone")} onChange={(timezone) => set({ timezone })} />
      </Row>
      <p className="text-xs text-slate-500" role="status">
        {next ? t("pages.db.templates.nextOccurrence", { time: formatNextRun(next, schedule.timezone, i18n.language) }) : t("pages.db.templates.noNext")}
      </p>
    </div>
  );
};
