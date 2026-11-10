const UNITS: Array<[Intl.RelativeTimeFormatUnit, number]> = [
  ["year", 31_536_000],
  ["month", 2_592_000],
  ["day", 86_400],
  ["hour", 3_600],
  ["minute", 60],
];

/** Short wording such as "5 minutes ago"; anything under a minute reads as "now". */
export const formatRelativeTime = (iso: string, locale: string, now = Date.now()) => {
  const time = new Date(iso).getTime();
  if (Number.isNaN(time)) return "";
  const format = new Intl.RelativeTimeFormat(locale, { numeric: "auto" });
  const seconds = Math.round((time - now) / 1000);
  for (const [unit, size] of UNITS) {
    if (Math.abs(seconds) >= size) return format.format(Math.trunc(seconds / size), unit);
  }
  return format.format(0, "second");
};
