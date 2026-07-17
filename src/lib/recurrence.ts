export type RecurrenceInterval = 'weekly' | 'monthly' | 'yearly' | 'manual';

export interface RecurrenceAnchor {
  weekday?: number;    // 0 (Sun) - 6 (Sat), UTC — required for 'weekly'
  dayOfMonth?: number; // 1-31, UTC — required for 'monthly'
  month?: number;      // 1-12, UTC — required for 'yearly'
  day?: number;        // 1-31, UTC — required for 'yearly'
  // All anchor fields — weekday/dayOfMonth/month/day AND hour/minute — are
  // UTC, and every computation in this module is UTC-only (Date.UTC /
  // getUTC*/ setUTC*), so the result is timezone-independent: the same
  // absolute instant regardless of which timezone the runtime is in. This is
  // what keeps the client's computation (device-local runtime) and the Deno
  // cron's computation (UTC runtime; Supabase's Postgres session is also UTC,
  // confirmed via `show timezone`) in agreement. Do not reintroduce any local
  // Date accessor/mutator here (client capture site: CreateGroupScreen.defaultAnchor,
  // which must derive every field from UTC getters too).
  hour: number;        // 0-23, UTC
  minute: number;      // 0-59, UTC
}

function daysInMonth(year: number, month1to12: number): number {
  // Day 0 of the following month = the last day of the target month.
  return new Date(Date.UTC(year, month1to12, 0)).getUTCDate();
}

// Clamps `day` to the last valid day of the given month (e.g. day 31 in a
// 30-day month becomes that month's 30th) rather than overflowing into the
// next month.
function clampedDate(year: number, month1to12: number, day: number, hour: number, minute: number): Date {
  const clampedDay = Math.min(day, daysInMonth(year, month1to12));
  return new Date(Date.UTC(year, month1to12 - 1, clampedDay, hour, minute, 0, 0));
}

export function computeNextOccurrence(
  interval: RecurrenceInterval,
  anchor: RecurrenceAnchor,
  from: Date,
): Date | null {
  if (interval === 'manual') return null;

  if (interval === 'weekly') {
    if (anchor.weekday === undefined) throw new Error('weekly recurrence requires anchor.weekday');
    const diffToWeekday = (anchor.weekday - from.getUTCDay() + 7) % 7;
    const candidate = new Date(from.getTime());
    candidate.setUTCDate(from.getUTCDate() + diffToWeekday);
    candidate.setUTCHours(anchor.hour, anchor.minute, 0, 0);
    if (candidate <= from) candidate.setUTCDate(candidate.getUTCDate() + 7);
    return candidate;
  }

  if (interval === 'monthly') {
    if (anchor.dayOfMonth === undefined) throw new Error('monthly recurrence requires anchor.dayOfMonth');
    let year = from.getUTCFullYear();
    let month = from.getUTCMonth() + 1; // 1-12
    let candidate = clampedDate(year, month, anchor.dayOfMonth, anchor.hour, anchor.minute);
    if (candidate <= from) {
      month += 1;
      if (month > 12) { month = 1; year += 1; }
      candidate = clampedDate(year, month, anchor.dayOfMonth, anchor.hour, anchor.minute);
    }
    return candidate;
  }

  // yearly
  if (anchor.month === undefined || anchor.day === undefined) {
    throw new Error('yearly recurrence requires anchor.month and anchor.day');
  }
  const year = from.getUTCFullYear();
  let candidate = clampedDate(year, anchor.month, anchor.day, anchor.hour, anchor.minute);
  if (candidate <= from) {
    candidate = clampedDate(year + 1, anchor.month, anchor.day, anchor.hour, anchor.minute);
  }
  return candidate;
}

export function computeUpcomingOccurrences(
  interval: RecurrenceInterval,
  anchor: RecurrenceAnchor,
  from: Date,
  count: number,
): Date[] {
  if (interval === 'manual') return [];
  const results: Date[] = [];
  let cursor = from;
  for (let i = 0; i < count; i++) {
    const next = computeNextOccurrence(interval, anchor, cursor);
    if (!next) break;
    results.push(next);
    cursor = next;
  }
  return results;
}
