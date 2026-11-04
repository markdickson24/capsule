// Run with: npx tsx src/lib/notificationGrouping.test.ts
// Regression test for: the App Store reviewer's Alerts tab showed three
// identical "Summer Rooftop Party is unlocking soon" cards — one per
// unlock-reminder tier (1d / 1h / 10m), since each tier writes its own row
// and the rows carry no tier info.
import assert from 'node:assert/strict';
import {
  groupNotifications,
  notificationKey,
  isGroupedPerCapsule,
  unlockReminderText,
} from './notificationGrouping';

type Row = { id: string; type: string; capsule_id: string | null; sent_at: string };
const row = (id: string, type: string, capsule_id: string | null, sent_at: string): Row =>
  ({ id, type, capsule_id, sent_at });

// The reviewer's real Nov 2 rows: 1d, 1h and 10m tiers for one capsule,
// fetched newest-first like the screen's query.
const rooftop = [
  row('r10m', 'unlock_reminder', 'rooftop', '2026-11-02T19:34:01Z'),
  row('r1h', 'unlock_reminder', 'rooftop', '2026-11-02T18:44:02Z'),
  row('r1d', 'unlock_reminder', 'rooftop', '2026-11-02T16:44:03Z'),
];

// 1. Three tier rows for one capsule collapse into one card, represented by
//    the newest (10m) row so the dismiss sweep (sent_at <= newest) covers all.
const collapsed = groupNotifications(rooftop);
assert.equal(collapsed.length, 1);
assert.equal(collapsed[0].id, 'r10m');
assert.equal(collapsed[0].groupCount, 3);
// Reminder groups don't pretend to be reactions.
assert.equal(collapsed[0].reactionCount, undefined);

// 2. Input order doesn't matter: oldest-first still picks the newest row.
assert.equal(groupNotifications([...rooftop].reverse())[0].id, 'r10m');

// 3. Old rows from earlier re-arms of the reviewer countdown capsule fold into
//    the same card, not separate July/August cards.
const rearmed = groupNotifications([
  ...rooftop,
  row('july', 'unlock_reminder', 'rooftop', '2026-07-24T17:26:01Z'),
]);
assert.equal(rearmed.length, 1);
assert.equal(rearmed[0].groupCount, 4);

// 4. Two different capsules' reminders stay separate cards, newest first.
const twoCapsules = groupNotifications([
  ...rooftop,
  row('w1', 'unlock_reminder', 'wedding', '2026-11-03T10:00:00Z'),
]);
assert.deepEqual(twoCapsules.map(n => n.id), ['w1', 'r10m']);

// 5. Reactions keep their existing per-capsule grouping and count, and a
//    reaction group never merges with a reminder group for the same capsule.
const mixed = groupNotifications([
  row('x1', 'reaction', 'rooftop', '2026-11-02T20:00:00Z'),
  row('x2', 'reaction', 'rooftop', '2026-11-02T21:00:00Z'),
  ...rooftop,
]);
assert.equal(mixed.length, 2);
assert.equal(mixed[0].id, 'x2');
assert.equal(mixed[0].reactionCount, 2);
assert.equal(mixed[1].id, 'r10m');

// 6. Other types (e.g. the actual unlock alert, invites) are never collapsed.
const others = groupNotifications([
  row('u1', 'unlock', 'rooftop', '2026-11-02T19:44:00Z'),
  row('u2', 'unlock', 'rooftop', '2026-11-02T19:45:00Z'),
  row('i1', 'invite', 'rooftop', '2026-11-01T00:00:00Z'),
]);
assert.deepEqual(others.map(n => n.id), ['u2', 'u1', 'i1']);

// 7. A reminder row with no capsule (capsule gone) isn't grouped under a
//    shared "null" key.
assert.equal(isGroupedPerCapsule({ type: 'unlock_reminder', capsule_id: null }), false);
assert.equal(groupNotifications([
  row('n1', 'unlock_reminder', null, '2026-11-02T00:00:00Z'),
  row('n2', 'unlock_reminder', null, '2026-11-02T01:00:00Z'),
]).length, 2);

// 8. List keys: one stable key per group (so a refetch picking a newer
//    representative doesn't remount), the row id otherwise.
assert.equal(notificationKey(collapsed[0]), 'unlock_reminder-rooftop');
assert.equal(notificationKey(mixed[0]), 'reaction-rooftop');
assert.equal(notificationKey(others[0]), 'u2');

// 9. Card copy follows the capsule's current unlock_at.
const unlockAt = '2026-11-02T19:43:04Z';
const at = (iso: string) => new Date(iso).getTime();
// Unlock already happened (the reviewer's card on Nov 4).
assert.equal(unlockReminderText(unlockAt, at('2026-11-04T12:00:00Z')), 'has unlocked');
// 10m tier.
assert.equal(unlockReminderText(unlockAt, at('2026-11-02T19:34:01Z')), 'unlocks in 9 minutes');
// 1h tier.
assert.equal(unlockReminderText(unlockAt, at('2026-11-02T18:44:01Z')), 'unlocks in about an hour');
// Reviewer re-arm lands ~3h out, so the "1 day" tier fires with 3h left.
assert.equal(unlockReminderText(unlockAt, at('2026-11-02T16:44:02Z')), 'unlocks in about 3 hours');
// Normal 1d tier.
assert.equal(unlockReminderText(unlockAt, at('2026-11-01T19:43:04Z')), 'unlocks tomorrow');
// Re-armed far into the future while an old row is still unread.
assert.equal(unlockReminderText(unlockAt, at('2026-10-30T19:43:04Z')), 'unlocks in 3 days');
// Last-moment.
assert.equal(unlockReminderText(unlockAt, at('2026-11-02T19:42:30Z')), 'unlocks in moments');
// Capsule embed missing (RLS/tombstone) or garbage: fall back to old copy.
assert.equal(unlockReminderText(null, Date.now()), 'is unlocking soon');
assert.equal(unlockReminderText('not a date', Date.now()), 'is unlocking soon');

console.log('notificationGrouping: all assertions passed');
