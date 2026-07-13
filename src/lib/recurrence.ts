export type RecurrenceInterval = 'weekly' | 'monthly' | 'yearly' | 'manual';

export interface RecurrenceAnchor {
  weekday?: number;    // 0 (Sun) - 6 (Sat) — required for 'weekly'
  dayOfMonth?: number; // 1-31 — required for 'monthly'
  month?: number;      // 1-12 — required for 'yearly'
  day?: number;        // 1-31 — required for 'yearly'
  // hour/minute are UTC, not local. The Date constructors below interpret
  // hour/minute in whatever timezone runs this code — device-local on the
  // client, UTC in the Deno cron that actually fires the schedule (Supabase's
  // Postgres session is also UTC, confirmed via `show timezone`). Storing and
  // always capturing these as UTC keeps the cron's interpretation stable and
  // correct forever; do not switch this to local time on one side without
  // updating the other (client capture site: CreateGroupScreen.defaultAnchor).
  hour: number;        // 0-23, UTC
  minute: number;      // 0-59, UTC
}

function daysInMonth(year: number, month1to12: number): number {
  return new Date(year, month1to12, 0).getDate();
}

// Clamps `day` to the last valid day of the given month (e.g. day 31 in a
// 30-day month becomes that month's 30th) rather than overflowing into the
// next month.
function clampedDate(year: number, month1to12: number, day: number, hour: number, minute: number): Date {
  const clampedDay = Math.min(day, daysInMonth(year, month1to12));
  return new Date(year, month1to12 - 1, clampedDay, hour, minute, 0, 0);
}

export function computeNextOccurrence(
  interval: RecurrenceInterval,
  anchor: RecurrenceAnchor,
  from: Date,
): Date | null {
  if (interval === 'manual') return null;

  if (interval === 'weekly') {
    if (anchor.weekday === undefined) throw new Error('weekly recurrence requires anchor.weekday');
    const diffToWeekday = (anchor.weekday - from.getDay() + 7) % 7;
    const candidate = new Date(from);
    candidate.setDate(from.getDate() + diffToWeekday);
    candidate.setHours(anchor.hour, anchor.minute, 0, 0);
    if (candidate <= from) candidate.setDate(candidate.getDate() + 7);
    return candidate;
  }

  if (interval === 'monthly') {
    if (anchor.dayOfMonth === undefined) throw new Error('monthly recurrence requires anchor.dayOfMonth');
    let year = from.getFullYear();
    let month = from.getMonth() + 1; // 1-12
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
  const year = from.getFullYear();
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
