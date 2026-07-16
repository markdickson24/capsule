import assert from 'node:assert/strict';
import { computeNextOccurrence, computeUpcomingOccurrences, RecurrenceAnchor } from './recurrence';

// Weekly: from a Wednesday, anchor Sunday 09:00 -> the coming Sunday
{
  const from = new Date(2026, 6, 15, 14, 0); // Wed Jul 15 2026, 2:00pm
  const anchor: RecurrenceAnchor = { weekday: 0, hour: 9, minute: 0 };
  const next = computeNextOccurrence('weekly', anchor, from);
  assert.ok(next);
  assert.equal(next!.getDay(), 0);
  assert.equal(next!.getDate(), 19); // Sunday Jul 19 2026
  assert.equal(next!.getHours(), 9);
}

// Weekly: `from` is the anchor weekday but before the anchor time -> same day
{
  const from = new Date(2026, 6, 19, 3, 0); // Sun Jul 19 2026, 3:00am
  const anchor: RecurrenceAnchor = { weekday: 0, hour: 9, minute: 0 };
  const next = computeNextOccurrence('weekly', anchor, from);
  assert.ok(next);
  assert.equal(next!.getDate(), 19);
  assert.equal(next!.getHours(), 9);
}

// Weekly: `from` is the anchor weekday but after the anchor time -> next week
{
  const from = new Date(2026, 6, 19, 15, 0); // Sun Jul 19 2026, 3:00pm
  const anchor: RecurrenceAnchor = { weekday: 0, hour: 9, minute: 0 };
  const next = computeNextOccurrence('weekly', anchor, from);
  assert.ok(next);
  assert.equal(next!.getDate(), 26); // next Sunday, Jul 26 2026
}

// Monthly: anchor day 31 in April clamps to Apr 30
{
  const from = new Date(2026, 3, 1, 0, 0); // Apr 1 2026
  const anchor: RecurrenceAnchor = { dayOfMonth: 31, hour: 9, minute: 0 };
  const next = computeNextOccurrence('monthly', anchor, from);
  assert.ok(next);
  assert.equal(next!.getMonth(), 3); // April (0-indexed)
  assert.equal(next!.getDate(), 30);
}

// Monthly: the cycle after a clamped April occurrence correctly lands on
// May 31 (the clamp doesn't stick to 30 forever)
{
  const from = new Date(2026, 3, 30, 9, 0); // the clamped Apr 30 2026 occurrence itself
  const anchor: RecurrenceAnchor = { dayOfMonth: 31, hour: 9, minute: 0 };
  const next = computeNextOccurrence('monthly', anchor, from);
  assert.ok(next);
  assert.equal(next!.getMonth(), 4); // May
  assert.equal(next!.getDate(), 31);
}

// Yearly: Feb 29 anchor clamps to Feb 28 in a non-leap year (2027)
{
  const from = new Date(2027, 0, 1); // Jan 1 2027
  const anchor: RecurrenceAnchor = { month: 2, day: 29, hour: 9, minute: 0 };
  const next = computeNextOccurrence('yearly', anchor, from);
  assert.ok(next);
  assert.equal(next!.getFullYear(), 2027);
  assert.equal(next!.getMonth(), 1); // February
  assert.equal(next!.getDate(), 28);
}

// Yearly: Feb 29 anchor uses the real Feb 29 in the next leap year (2028)
{
  const from = new Date(2027, 11, 1); // Dec 1 2027
  const anchor: RecurrenceAnchor = { month: 2, day: 29, hour: 9, minute: 0 };
  const next = computeNextOccurrence('yearly', anchor, from);
  assert.ok(next);
  assert.equal(next!.getFullYear(), 2028);
  assert.equal(next!.getDate(), 29);
}

// Manual returns null
{
  const next = computeNextOccurrence('manual', { hour: 9, minute: 0 }, new Date());
  assert.equal(next, null);
}

// computeUpcomingOccurrences returns `count` strictly-increasing dates, one
// week apart for a weekly anchor
{
  const from = new Date(2026, 0, 1);
  const anchor: RecurrenceAnchor = { weekday: 1, hour: 9, minute: 0 }; // Monday
  const upcoming = computeUpcomingOccurrences('weekly', anchor, from, 3);
  assert.equal(upcoming.length, 3);
  assert.ok(upcoming[0] < upcoming[1]);
  assert.ok(upcoming[1] < upcoming[2]);
  const diffDays = (upcoming[1].getTime() - upcoming[0].getTime()) / 86_400_000;
  assert.equal(diffDays, 7);
}

// computeUpcomingOccurrences returns [] for manual
{
  assert.deepEqual(computeUpcomingOccurrences('manual', { hour: 9, minute: 0 }, new Date(), 3), []);
}

console.log('recurrence.test.ts: all assertions passed');
