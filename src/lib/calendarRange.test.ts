import assert from 'node:assert/strict';
import { dayRangeRole, defaultUnlockTonight, initialCalendarMonth } from './calendarRange';

const today = new Date(2026, 10, 4, 9, 30); // Nov 4 2026
const oneMonthOut = new Date(2026, 11, 4, 12, 0); // Dec 4 — the Create screen's default unlock

// Create screen, untouched default unlock date → opens on November, not December.
assert.deepEqual(initialCalendarMonth(oneMonthOut, today, true), { year: 2026, month: 10 });
// User already picked Dec 4 (or Edit screen with a saved Dec date) → opens on December.
assert.deepEqual(initialCalendarMonth(oneMonthOut, today, false), { year: 2026, month: 11 });
// Year rollover: default in January viewed from December opens on December.
assert.deepEqual(
  initialCalendarMonth(new Date(2027, 0, 20), new Date(2026, 11, 20), true),
  { year: 2026, month: 11 },
);

const start = new Date(2026, 10, 8, 18, 0);  // Starts Sat Nov 8, 6pm
const unlock = new Date(2026, 10, 12, 9, 0); // Unlocks Wed Nov 12, 9am

// No start date → nothing shaded.
assert.equal(dayRangeRole(new Date(2026, 10, 10), null, unlock), null);
// Start day, end day and days between, regardless of time of day.
assert.equal(dayRangeRole(new Date(2026, 10, 8, 0, 0), start, unlock), 'start');
assert.equal(dayRangeRole(new Date(2026, 10, 10), start, unlock), 'middle');
assert.equal(dayRangeRole(new Date(2026, 10, 12, 23, 59), start, unlock), 'end');
// Days just outside the range.
assert.equal(dayRangeRole(new Date(2026, 10, 7), start, unlock), null);
assert.equal(dayRangeRole(new Date(2026, 10, 13), start, unlock), null);
// Range that spans a month boundary.
assert.equal(dayRangeRole(new Date(2026, 11, 1), new Date(2026, 10, 28), new Date(2026, 11, 3)), 'middle');
// Start and unlock on the same day → one marked day, no band.
assert.equal(dayRangeRole(new Date(2026, 10, 8), start, new Date(2026, 10, 8, 22, 0)), 'single');
// Start after unlock (invalid, shown as an error on Create) → no shading.
assert.equal(dayRangeRole(new Date(2026, 10, 10), new Date(2026, 10, 20), unlock), null);

// Create screen at 8:10pm Nov 4 → unlock defaults to Nov 4, 11:59pm (today, still in the future).
assert.deepEqual(defaultUnlockTonight(new Date(2026, 10, 4, 20, 10)), new Date(2026, 10, 4, 23, 59));
// Morning → same day.
assert.deepEqual(defaultUnlockTonight(new Date(2026, 10, 4, 7, 0)), new Date(2026, 10, 4, 23, 59));
// 11:30pm → less than an hour left, roll to tomorrow night.
assert.deepEqual(defaultUnlockTonight(new Date(2026, 10, 4, 23, 30)), new Date(2026, 10, 5, 23, 59));
// Month rollover at 11:45pm Nov 30.
assert.deepEqual(defaultUnlockTonight(new Date(2026, 10, 30, 23, 45)), new Date(2026, 11, 1, 23, 59));

console.log('calendarRange: all assertions passed');
