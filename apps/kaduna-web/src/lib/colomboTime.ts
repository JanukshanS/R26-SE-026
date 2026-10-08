const COLOMBO = new Intl.DateTimeFormat("en-CA", {
  timeZone: "Asia/Colombo",
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
  hour: "2-digit",
  hourCycle: "h23",
  weekday: "short",
});
const WEEKDAY: Record<string, number> = { Mon: 0, Tue: 1, Wed: 2, Thu: 3, Fri: 4, Sat: 5, Sun: 6 };

/**
 * Hour, model day of week (Mon=0..Sun=6) and calendar date of an instant in
 * Colombo, whatever the browser's own timezone. All three must come from the
 * same clock: between 00:00 and 05:30 Colombo the UTC date is still yesterday.
 */
export function colomboTime(at: Date): { hour: number; dayOfWeek: number; date: string } {
  const p = Object.fromEntries(COLOMBO.formatToParts(at).map((x) => [x.type, x.value]));
  return {
    hour: Number(p.hour),
    dayOfWeek: WEEKDAY[p.weekday],
    date: `${p.year}-${p.month}-${p.day}`,
  };
}
