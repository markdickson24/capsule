import assert from 'node:assert/strict';
import { computeNextOccurrence, computeUpcomingOccurrences, RecurrenceAnchor } from './recurrence';

// All `from` instants below are built with Date.UTC(...) (an absolute
// instant, independent of the runtime's timezone) and all assertions check
// UTC getters / toISOString() (also timezone-independent). This file is run
// under both TZ=UTC and TZ=America/New_York (see the verification command in
// the task) — every assertion must produce the identical result under both,
// since computeNextOccurrence is documented to be UTC-only and
// timezone-independent (see the RecurrenceAnchor doc comment in
// src/lib/recurrence.ts).

// Weekly: from a Wednesday, anchor Sunday 09:00 UTC -> the coming Sunday
{
  const from = new Date(Date.UTC(2026, 6, 15, 14, 0)); // Wed Jul 15 2026, 14:00 UTC
  const anchor: RecurrenceAnchor = { weekday: 0, hour: 9, minute: 0 };
  const next = computeNextOccurrence('weekly', anchor, from);
  assert.ok(next);
  assert.equal(next!.getUTCDay(), 0);
  assert.equal(next!.getUTCDate(), 19); // Sunday Jul 19 2026
  assert.equal(next!.getUTCHours(), 9);
  assert.equal(next!.toISOString(), '2026-07-19T09:00:00.000Z');
}

// Weekly: `from` is the anchor weekday but before the anchor time -> same day
{
  const from = new Date(Date.UTC(2026, 6, 19, 3, 0)); // Sun Jul 19 2026, 3:00am UTC
  const anchor: RecurrenceAnchor = { weekday: 0, hour: 9, minute: 0 };
  const next = computeNextOccurrence('weekly', anchor, from);
  assert.ok(next);
  assert.equal(next!.getUTCDate(), 19);
  assert.equal(next!.getUTCHours(), 9);
  assert.equal(next!.toISOString(), '2026-07-19T09:00:00.000Z');
}

// Weekly: `from` is the anchor weekday but after the anchor time -> next week
{
  const from = new Date(Date.UTC(2026, 6, 19, 15, 0)); // Sun Jul 19 2026, 3:00pm UTC
  const anchor: RecurrenceAnchor = { weekday: 0, hour: 9, minute: 0 };
  const next = computeNextOccurrence('weekly', anchor, from);
  assert.ok(next);
  assert.equal(next!.getUTCDate(), 26); // next Sunday, Jul 26 2026
  assert.equal(next!.toISOString(), '2026-07-26T09:00:00.000Z');
}

// Monthly: anchor day 31 in April clamps to Apr 30
{
  const from = new Date(Date.UTC(2026, 3, 1, 0, 0)); // Apr 1 2026 UTC
  const anchor: RecurrenceAnchor = { dayOfMonth: 31, hour: 9, minute: 0 };
  const next = computeNextOccurrence('monthly', anchor, from);
  assert.ok(next);
  assert.equal(next!.getUTCMonth(), 3); // April (0-indexed)
  assert.equal(next!.getUTCDate(), 30);
  assert.equal(next!.toISOString(), '2026-04-30T09:00:00.000Z');
}

// Monthly: the cycle after a clamped April occurrence correctly lands on
// May 31 (the clamp doesn't stick to 30 forever)
{
  const from = new Date(Date.UTC(2026, 3, 30, 9, 0)); // the clamped Apr 30 2026 occurrence itself, UTC
  const anchor: RecurrenceAnchor = { dayOfMonth: 31, hour: 9, minute: 0 };
  const next = computeNextOccurrence('monthly', anchor, from);
  assert.ok(next);
  assert.equal(next!.getUTCMonth(), 4); // May
  assert.equal(next!.getUTCDate(), 31);
  assert.equal(next!.toISOString(), '2026-05-31T09:00:00.000Z');
}

// Yearly: Feb 29 anchor clamps to Feb 28 in a non-leap year (2027)
{
  const from = new Date(Date.UTC(2027, 0, 1)); // Jan 1 2027 UTC
  const anchor: RecurrenceAnchor = { month: 2, day: 29, hour: 9, minute: 0 };
  const next = computeNextOccurrence('yearly', anchor, from);
  assert.ok(next);
  assert.equal(next!.getUTCFullYear(), 2027);
  assert.equal(next!.getUTCMonth(), 1); // February
  assert.equal(next!.getUTCDate(), 28);
  assert.equal(next!.toISOString(), '2027-02-28T09:00:00.000Z');
}

// Yearly: Feb 29 anchor uses the real Feb 29 in the next leap year (2028)
{
  const from = new Date(Date.UTC(2027, 11, 1)); // Dec 1 2027 UTC
  const anchor: RecurrenceAnchor = { month: 2, day: 29, hour: 9, minute: 0 };
  const next = computeNextOccurrence('yearly', anchor, from);
  assert.ok(next);
  assert.equal(next!.getUTCFullYear(), 2028);
  assert.equal(next!.getUTCDate(), 29);
  assert.equal(next!.toISOString(), '2028-02-29T09:00:00.000Z');
}

// Manual returns null
{
  const next = computeNextOccurrence('manual', { hour: 9, minute: 0 }, new Date());
  assert.equal(next, null);
}

// computeUpcomingOccurrences returns `count` strictly-increasing dates, one
// week apart for a weekly anchor
{
  const from = new Date(Date.UTC(2026, 0, 1)); // Jan 1 2026 UTC (Thursday)
  const anchor: RecurrenceAnchor = { weekday: 1, hour: 9, minute: 0 }; // Monday
  const upcoming = computeUpcomingOccurrences('weekly', anchor, from, 3);
  assert.equal(upcoming.length, 3);
  assert.ok(upcoming[0] < upcoming[1]);
  assert.ok(upcoming[1] < upcoming[2]);
  const diffDays = (upcoming[1].getTime() - upcoming[0].getTime()) / 86_400_000;
  assert.equal(diffDays, 7);
  assert.equal(upcoming[0].toISOString(), '2026-01-05T09:00:00.000Z');
}

// computeUpcomingOccurrences returns [] for manual
{
  assert.deepEqual(computeUpcomingOccurrences('manual', { hour: 9, minute: 0 }, new Date(), 3), []);
}

// --- Cross-timezone parity: instants where the LOCAL calendar day/month/year
// differs from the UTC one (i.e. within a few hours of local midnight in
// America/New_York). A local-time implementation would compute a different
// result depending on which TZ the process runs under; a correct UTC-only
// implementation produces the exact same absolute instant either way. These
// are the cases that would have caught the original bug.

// Weekly boundary: Jul 17 2026 02:00 UTC is Jul 16 (Thursday) 22:00 in
// America/New_York (EDT, UTC-4) — a different calendar day than the UTC one
// (Friday). A local getDay()/getDate() implementation would disagree with
// the UTC-only one here.
{
  const from = new Date(Date.UTC(2026, 6, 17, 2, 0)); // Fri Jul 17 2026, 02:00 UTC
  const anchor: RecurrenceAnchor = { weekday: 5, hour: 9, minute: 0 }; // Friday
  const next = computeNextOccurrence('weekly', anchor, from);
  assert.ok(next);
  assert.equal(next!.toISOString(), '2026-07-17T09:00:00.000Z');
}

// Monthly boundary: Feb 1 2026 02:00 UTC is Jan 31 2026 21:00 in
// America/New_York (EST, UTC-5) — a different *month* than the UTC one.
{
  const from = new Date(Date.UTC(2026, 1, 1, 2, 0)); // Sun Feb 1 2026, 02:00 UTC
  const anchor: RecurrenceAnchor = { dayOfMonth: 15, hour: 9, minute: 0 };
  const next = computeNextOccurrence('monthly', anchor, from);
  assert.ok(next);
  assert.equal(next!.toISOString(), '2026-02-15T09:00:00.000Z');
}

// Yearly boundary: Jan 1 2026 02:00 UTC is Dec 31 2025 21:00 in
// America/New_York (EST, UTC-5) — a different *year* than the UTC one.
{
  const from = new Date(Date.UTC(2026, 0, 1, 2, 0)); // Thu Jan 1 2026, 02:00 UTC
  const anchor: RecurrenceAnchor = { month: 1, day: 1, hour: 9, minute: 0 };
  const next = computeNextOccurrence('yearly', anchor, from);
  assert.ok(next);
  assert.equal(next!.toISOString(), '2026-01-01T09:00:00.000Z');
}

console.log('recurrence.test.ts: all assertions passed');
