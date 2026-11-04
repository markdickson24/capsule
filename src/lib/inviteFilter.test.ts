import assert from 'node:assert/strict';
import { inviteFilterActive, visibleNotifications } from './inviteFilter';

const pending = { 'cap-diego': 'member-1' };
const list = [
  { id: 'a', type: 'unlock_reminder', capsule_id: 'cap-rooftop' },
  { id: 'b', type: 'invite', capsule_id: 'cap-diego' },        // pending → counted by the pill
  { id: 'c', type: 'invite', capsule_id: 'cap-tahoe' },        // already accepted
  { id: 'd', type: 'reaction', capsule_id: 'cap-diego' },
  { id: 'e', type: 'invite', capsule_id: null },
  { id: 'f', type: 'friend_request', capsule_id: null },
];

// Filter off (default, or after a second tap): everything, same order.
assert.deepEqual(visibleNotifications(list, pending, false).map(n => n.id), ['a', 'b', 'c', 'd', 'e', 'f']);

// Filter on: only the still-pending capsule invite — not accepted invites,
// not other notifications about the same capsule, not friend requests.
assert.deepEqual(visibleNotifications(list, pending, true).map(n => n.id), ['b']);

// Two pending invites both show.
assert.deepEqual(
  visibleNotifications(list, { ...pending, 'cap-tahoe': 'member-2' }, true).map(n => n.id),
  ['b', 'c'],
);

// Pill tapped while invites are pending → filter applies.
assert.equal(inviteFilterActive(true, 1), true);
// Last invite accepted while filtered → pill disappears, filter falls back to everything.
assert.equal(inviteFilterActive(true, 0), false);
// Never tapped.
assert.equal(inviteFilterActive(false, 2), false);

console.log('inviteFilter: all assertions passed');
