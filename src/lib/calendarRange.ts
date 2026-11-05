// Pure date math for the DatePicker calendar (src/components/DatePicker.tsx):
// which month it opens on, and how each day is drawn when a start date is
// shown as a shaded range up to the selected (unlock) date.

export type MonthView = { year: number; month: number };

/**
 * Month the calendar opens on. A value the user never picked (the "one month
 * from now" default, or a just-toggled-on optional field) opens on today's
 * month, so the calendar doesn't start a month ahead. A real choice (picked
 * this session, or a saved date on Edit) opens on that date's month.
 */
export function initialCalendarMonth(selected: Date, today: Date, showingDefault: boolean): MonthView {
  const d = showingDefault ? today : selected;
  return { year: d.getFullYear(), month: d.getMonth() };
}

/** Local-calendar-day number, so times of day don't affect comparisons. */
export function dayKey(d: Date): number {
  return d.getFullYear() * 10000 + d.getMonth() * 100 + d.getDate();
}

/**
 * 'start'  – the range's first day (left half unshaded)
 * 'end'    – the selected unlock day (right half unshaded)
 * 'middle' – fully shaded
 * 'single' – start and end on the same day (no band)
 * null     – outside the range, or no valid range (no start, or start after end)
 */
export type RangeRole = 'start' | 'end' | 'middle' | 'single' | null;

export function dayRangeRole(day: Date, start: Date | null | undefined, end: Date): RangeRole {
  if (!start) return null;
  const s = dayKey(start), e = dayKey(end), k = dayKey(day);
  if (s > e) return null;
  if (s === e) return k === s ? 'single' : null;
  if (k === s) return 'start';
  if (k === e) return 'end';
  if (k > s && k < e) return 'middle';
  return null;
}

/**
 * Create screen's default unlock date: tonight at 11:59 PM, so the date shown
 * is today but still in the future. Within an hour of midnight it rolls to
 * tomorrow night, so the default never fails "must be in the future".
 */
export function defaultUnlockTonight(now: Date): Date {
  const d = new Date(now);
  d.setHours(23, 59, 0, 0);
  if (d.getTime() - now.getTime() < 60 * 60_000) d.setDate(d.getDate() + 1);
  return d;
}
