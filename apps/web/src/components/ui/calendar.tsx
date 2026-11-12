import { ChevronLeft, ChevronRight } from "lucide-react";
import { DayPicker } from "react-day-picker";
import { cn } from "@/lib/utils";

type CalendarProps = {
  className?: string;
  selected: Date | undefined;
  onSelect: (date: Date) => void;
  month: Date;
  onMonthChange: (month: Date) => void;
  todayLabel: string;
  previousLabel: string;
  nextLabel: string;
};

/**
 * A one-month calendar laid out as Notion's date picker: "Nov 2026" on the left, "Today" and the
 * month arrows on the right, two-letter weekdays, today in a red circle and the chosen day in blue.
 */
export function Calendar({ selected, onSelect, month, onMonthChange, todayLabel, previousLabel, nextLabel, className }: CalendarProps) {
  const shift = (months: number) => onMonthChange(new Date(month.getFullYear(), month.getMonth() + months, 1));
  const navButton = "flex h-6 items-center justify-center rounded px-1 text-slate-500 hover:bg-slate-100";
  return (
    <div className={cn("ponder-calendar select-none", className)}>
      <div className="flex items-center justify-between px-1 pb-1 pt-0.5">
        <span className="text-sm font-medium text-slate-800">
          {new Intl.DateTimeFormat("en-US", { month: "short", year: "numeric" }).format(month)}
        </span>
        <div className="flex items-center gap-0.5">
          <button type="button" className={cn(navButton, "px-1.5 text-xs")} onClick={() => onMonthChange(new Date())}>{todayLabel}</button>
          <button type="button" className={navButton} aria-label={previousLabel} onClick={() => shift(-1)}><ChevronLeft className="h-4 w-4" /></button>
          <button type="button" className={navButton} aria-label={nextLabel} onClick={() => shift(1)}><ChevronRight className="h-4 w-4" /></button>
        </div>
      </div>
      <DayPicker
        mode="single"
        required
        selected={selected}
        onSelect={(date: Date | undefined) => date && onSelect(date)}
        month={month}
        onMonthChange={onMonthChange}
        hideNavigation
        showOutsideDays
        formatters={{ formatWeekdayName: (date) => new Intl.DateTimeFormat("en-US", { weekday: "short" }).format(date).slice(0, 2) }}
        classNames={{
          root: "w-full",
          months: "w-full",
          month: "w-full",
          month_caption: "hidden",
          month_grid: "w-full border-collapse",
          weekdays: "",
          weekday: "h-7 w-8 text-center text-xs font-normal text-slate-400",
          week: "",
          day: "ponder-calendar-day h-8 w-8 p-0 text-center",
          day_button: "mx-auto flex h-7 w-7 items-center justify-center rounded-md text-sm text-slate-800 hover:bg-slate-100",
          selected: "is-selected",
          today: "is-today",
          outside: "is-outside",
          disabled: "opacity-40",
          hidden: "invisible",
        }}
      />
    </div>
  );
}
