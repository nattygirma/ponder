/*
 * Adapted from AppFlowy-Web (https://github.com/AppFlowy-IO/AppFlowy-Web), Copyright AppFlowy, AGPL-3.0.
 * Source: src/components/editor/components/leaf/mention/MentionDatePicker.tsx (the date input above a
 * calendar that keeps the time of day when another day is picked, the Include time switch that drops a
 * reminder needing a time, and the Remind submenu listing the options for the date with a check on the
 * chosen one). Layout and wording follow Notion's date picker, whose rows have no icons.
 */
import { useEffect, useMemo, useState } from "react";
import { Check, ChevronRight } from "lucide-react";
import {
  getFilteredReminderOptions,
  getReminderLabel,
  parseMentionDate,
  REMINDER_OPTIONS,
  toMentionDay,
} from "@ponder/shared";
import { Calendar } from "@/components/ui/calendar";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Switch } from "@/components/ui/switch";
import { cn } from "@/lib/utils";
import { parseTypedDate } from "./mention-panel-items";

export type MentionDatePickerLabels = {
  includeTime: string;
  remind: string;
  clear: string;
  today: string;
  previousMonth: string;
  nextMonth: string;
  dateInput: string;
  timeInput: string;
};

export type MentionDateValue = { date: string; includeTime: boolean; remind: string };

const pad = (value: number) => String(value).padStart(2, "0");
const inputDate = (date: Date) => new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric", year: "numeric" }).format(date);
const inputTime = (date: Date) => `${pad(date.getHours())}:${pad(date.getMinutes())}`;

/** The stored date for a day and, with a time, the hour and minute in the viewer's time zone. */
const toStoredDate = (day: Date, includeTime: boolean, time: { hours: number; minutes: number }) =>
  includeTime
    ? new Date(day.getFullYear(), day.getMonth(), day.getDate(), time.hours, time.minutes).toISOString()
    : toMentionDay(day);

/**
 * Keeps a reminder meaningful when the time is switched: a date without a time can't remind
 * "15 minutes before", and one with a time reminds at the time rather than at 9:00 AM.
 */
export const reminderForTimeChange = (remind: string, includeTime: boolean) => {
  if (!remind || remind === "none") return remind;
  const option = REMINDER_OPTIONS.find((item) => item.name === remind);
  if (!includeTime && option?.requiresTime) return "onDayOfEvent";
  if (includeTime && option?.dateOnly) return "atTimeOfEvent";
  return remind;
};

export function MentionDatePicker({
  value,
  labels,
  canRemind,
  onChange,
  onClear,
}: {
  value: MentionDateValue;
  labels: MentionDatePickerLabels;
  /** False for viewers who can't be reminded (signed out or a public page). */
  canRemind: boolean;
  onChange: (value: MentionDateValue) => void;
  onClear: () => void;
}) {
  const date = useMemo(() => parseMentionDate(value.date) ?? new Date(), [value.date]);
  const [month, setMonth] = useState(date);
  const [draft, setDraft] = useState(inputDate(date));
  const [remindOpen, setRemindOpen] = useState(false);
  useEffect(() => {
    setMonth(date);
    setDraft(inputDate(date));
  }, [date]);
  const time = { hours: value.includeTime ? date.getHours() : 9, minutes: value.includeTime ? date.getMinutes() : 0 };

  const commitDraft = () => {
    const typed = parseTypedDate(draft) ?? (Number.isNaN(Date.parse(draft)) ? null : new Date(Date.parse(draft)));
    if (!typed) {
      setDraft(inputDate(date));
      return;
    }
    onChange({ ...value, date: toStoredDate(typed, value.includeTime, time) });
  };

  const remindOptions = getFilteredReminderOptions(value.includeTime);
  const remind = value.remind || "none";
  const row = "flex h-8 w-full items-center gap-2 rounded-md px-2 text-left text-sm text-slate-700 hover:bg-slate-100";

  return (
    <div className="ponder-mention-date-picker flex w-[288px] flex-col gap-1 p-1.5" onMouseDown={(event) => event.stopPropagation()}>
      <div className="flex gap-1.5 px-0.5">
        <input
          aria-label={labels.dateInput}
          className="h-8 min-w-0 flex-1 rounded-md border border-slate-200 bg-slate-50 px-2 text-sm text-slate-800 outline-none focus:border-[var(--accent,#2383e2)]"
          value={draft}
          onChange={(event) => setDraft(event.target.value)}
          onBlur={commitDraft}
          onKeyDown={(event) => {
            if (event.key === "Enter") {
              event.preventDefault();
              commitDraft();
            }
          }}
        />
        {value.includeTime && (
          <input
            type="time"
            aria-label={labels.timeInput}
            className="h-8 w-[6.5rem] rounded-md border border-slate-200 bg-slate-50 px-2 text-sm text-slate-800 outline-none"
            value={inputTime(date)}
            onChange={(event) => {
              const [hours, minutes] = event.target.value.split(":").map(Number);
              if (Number.isFinite(hours) && Number.isFinite(minutes)) onChange({ ...value, date: toStoredDate(date, true, { hours, minutes }) });
            }}
          />
        )}
      </div>
      <Calendar
        className="px-1"
        selected={date}
        month={month}
        onMonthChange={setMonth}
        // Another day keeps the time of day, as in AppFlowy's picker.
        onSelect={(day) => onChange({ ...value, date: toStoredDate(day, value.includeTime, time) })}
        todayLabel={labels.today}
        previousLabel={labels.previousMonth}
        nextLabel={labels.nextMonth}
      />
      <div className="my-0.5 border-t border-slate-100" />
      <label className={cn(row, "cursor-pointer")}>
        <span className="flex-1">{labels.includeTime}</span>
        <Switch
          checked={value.includeTime}
          onCheckedChange={(includeTime) => onChange({
            date: toStoredDate(date, includeTime, time),
            includeTime,
            remind: reminderForTimeChange(value.remind, includeTime),
          })}
        />
      </label>
      {canRemind && (
        <Popover open={remindOpen} onOpenChange={setRemindOpen}>
          <PopoverTrigger asChild>
            <button type="button" className={row}>
              <span className="flex-1">{labels.remind}</span>
              <span className="truncate text-xs text-slate-400">{getReminderLabel(remind).replace(/ \(9:00 AM\)$/, "")}</span>
              <ChevronRight className="h-3.5 w-3.5 text-slate-400" aria-hidden="true" />
            </button>
          </PopoverTrigger>
          <PopoverContent side="right" align="start" sideOffset={6} collisionPadding={8} className="w-60 p-1">
            {remindOptions.map((option) => (
              <button
                key={option.name}
                type="button"
                aria-pressed={option.name === remind}
                className={row}
                onClick={() => {
                  onChange({ ...value, remind: option.name === "none" ? "" : option.name });
                  setRemindOpen(false);
                }}
              >
                <span className="flex-1">{option.label}</span>
                {option.name === remind && <Check className="h-4 w-4 text-slate-600" aria-hidden="true" />}
              </button>
            ))}
          </PopoverContent>
        </Popover>
      )}
      <div className="my-0.5 border-t border-slate-100" />
      <button type="button" className={row} onClick={onClear}>{labels.clear}</button>
    </div>
  );
}
