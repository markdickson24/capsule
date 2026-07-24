import assert from 'node:assert/strict';
import {
  effectiveLiveActivityEnabled,
  liveActivityDeadline,
  liveActivityWindowStart,
  desiredActivities,
  reconcileActivities,
  type LiveActivityCapsuleRow,
} from './liveActivityPlan';

// All instants are built with Date.UTC(...) — absolute, timezone-independent —
// so every assertion holds under both TZ=UTC and TZ=America/New_York.

const NOW = new Date(Date.UTC(2026, 6, 24, 12, 0)); // Fri Jul 24 2026 12:00 UTC

function row(over: Partial<LiveActivityCapsuleRow> = {}): LiveActivityCapsuleRow {
  return {
    id: 'c1',
    title: 'Wedding day',
    status: 'active',
    created_at: new Date(Date.UTC(2026, 6, 20, 9, 0)).toISOString(),
    contribution_start_at: null,
    contribution_lock_at: new Date(Date.UTC(2026, 6, 24, 18, 0)).toISOString(),
    unlock_at: new Date(Date.UTC(2026, 7, 1, 9, 0)).toISOString(),
    live_activity_enabled: true,
    live_activity_override: null,
    ...over,
  };
}

// ---- effectiveLiveActivityEnabled: all four combinations ----
assert.equal(effectiveLiveActivityEnabled(row({ live_activity_enabled: true, live_activity_override: null })), true);
assert.equal(effectiveLiveActivityEnabled(row({ live_activity_enabled: false, live_activity_override: null })), false);
// An override wins over the capsule default in BOTH directions.
assert.equal(effectiveLiveActivityEnabled(row({ live_activity_enabled: false, live_activity_override: true })), true);
assert.equal(effectiveLiveActivityEnabled(row({ live_activity_enabled: true, live_activity_override: false })), false);

// ---- liveActivityDeadline: contribution_lock_at wins, unlock_at is fallback ----
assert.equal(
  liveActivityDeadline(row())!.toISOString(),
  '2026-07-24T18:00:00.000Z'
);
assert.equal(
  liveActivityDeadline(row({ contribution_lock_at: null }))!.toISOString(),
  '2026-08-01T09:00:00.000Z'
);
// Garbage date strings must not produce an Invalid Date that silently poisons
// the countdown — they resolve to null and the capsule is skipped.
assert.equal(liveActivityDeadline(row({ contribution_lock_at: 'not-a-date' })), null);

// ---- liveActivityWindowStart: contribution_start_at wins, created_at fallback ----
assert.equal(
  liveActivityWindowStart(row())!.toISOString(),
  '2026-07-20T09:00:00.000Z'
);
assert.equal(
  liveActivityWindowStart(row({ contribution_start_at: new Date(Date.UTC(2026, 6, 24, 8, 0)).toISOString() }))!.toISOString(),
  '2026-07-24T08:00:00.000Z'
);

// ---- desiredActivities ----
// Happy path: inside the window, enabled, active.
{
  const d = desiredActivities([row()], NOW);
  assert.equal(d.length, 1);
  assert.equal(d[0].capsuleId, 'c1');
  assert.equal(d[0].title, 'Wedding day');
  assert.equal(d[0].deadline.toISOString(), '2026-07-24T18:00:00.000Z');
  assert.equal(d[0].windowStart.toISOString(), '2026-07-20T09:00:00.000Z');
}
// Disabled by the capsule default.
assert.equal(desiredActivities([row({ live_activity_enabled: false })], NOW).length, 0);
// Disabled by the member's own override, even though the capsule default is on.
assert.equal(desiredActivities([row({ live_activity_override: false })], NOW).length, 0);
// Deadline already passed.
assert.equal(
  desiredActivities([row({ contribution_lock_at: new Date(Date.UTC(2026, 6, 24, 11, 0)).toISOString() })], NOW).length,
  0
);
// Deadline exactly now counts as over — the countdown would read zero.
assert.equal(
  desiredActivities([row({ contribution_lock_at: NOW.toISOString() })], NOW).length,
  0
);
// Window hasn't opened yet (start date in the future).
assert.equal(
  desiredActivities([row({ contribution_start_at: new Date(Date.UTC(2026, 6, 25, 9, 0)).toISOString() })], NOW).length,
  0
);
// Already unlocked — nothing left to contribute.
assert.equal(desiredActivities([row({ status: 'unlocked' })], NOW).length, 0);
// A row with no usable deadline at all is skipped, not crashed on.
assert.equal(
  desiredActivities([row({ contribution_lock_at: null, unlock_at: 'garbage' })], NOW).length,
  0
);
// Multiple capsules: only the eligible ones come back.
{
  const d = desiredActivities(
    [row({ id: 'a' }), row({ id: 'b', live_activity_enabled: false }), row({ id: 'c' })],
    NOW
  );
  assert.deepEqual(d.map(x => x.capsuleId), ['a', 'c']);
}

// ---- reconcileActivities ----
{
  const desired = desiredActivities([row({ id: 'a' }), row({ id: 'b' })], NOW);
  // 'b' is already running; 'z' is running but no longer desired.
  const r = reconcileActivities(desired, ['b', 'z']);
  assert.deepEqual(r.toStart.map(x => x.capsuleId), ['a']);
  assert.deepEqual(r.toEnd, ['z']);
  assert.deepEqual(r.alreadyRunning.map(x => x.capsuleId), ['b']);
}
// Nothing desired, nothing running -> all empty, no throw.
{
  const r = reconcileActivities([], []);
  assert.deepEqual(r.toStart, []);
  assert.deepEqual(r.toEnd, []);
  assert.deepEqual(r.alreadyRunning, []);
}
// Everything running should stop when nothing is desired.
{
  const r = reconcileActivities([], ['x', 'y']);
  assert.deepEqual(r.toEnd, ['x', 'y']);
  assert.equal(r.toStart.length, 0);
}
// Duplicate active ids (defensive — OS shouldn't, but must not double-end).
{
  const r = reconcileActivities([], ['x', 'x']);
  assert.deepEqual(r.toEnd, ['x']);
}

console.log('liveActivityPlan tests passed');
