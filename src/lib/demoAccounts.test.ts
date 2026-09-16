import assert from 'node:assert/strict';
import { isDemoAccountId } from './demoAccounts';

// The two real fixture prefixes in production.
assert.equal(isDemoAccountId('facade00-0000-4000-8000-000000000001'), true);
assert.equal(isDemoAccountId('facade01-0000-4000-8000-000000000001'), true);
assert.equal(isDemoAccountId('facade01-c000-4000-8000-000000000002'), true);
// Uppercase, in case a caller ever hands us a non-lowercased uuid.
assert.equal(isDemoAccountId('FACADE01-0000-4000-8000-000000000001'), true);

// Real accounts must never be hidden.
assert.equal(isDemoAccountId('7f3c1e2a-9b4d-4c8e-a1f5-2d6b0e9c4a11'), false);
assert.equal(isDemoAccountId('fac0de00-0000-4000-8000-000000000001'), false);
assert.equal(isDemoAccountId('facad-not-a-uuid'), false);

// Null-safe: search rows always carry an id, but a filter must never throw.
assert.equal(isDemoAccountId(null), false);
assert.equal(isDemoAccountId(undefined), false);
assert.equal(isDemoAccountId(''), false);

console.log('demoAccounts.test.ts: all assertions passed');
