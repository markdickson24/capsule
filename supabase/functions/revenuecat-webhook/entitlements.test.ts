import assert from 'node:assert/strict';
import {
  isProActive,
  PRO_ENTITLEMENT_ID,
  PRO_ENTITLEMENT_OBJECT_ID,
} from './entitlements.ts';

// The two identifiers are genuinely different strings. If these ever become
// equal, the regression test below stops testing anything.
assert.notEqual(PRO_ENTITLEMENT_ID, PRO_ENTITLEMENT_OBJECT_ID);

// Pro present -> active. Shape copied verbatim from a live probe of
// GET /v2/projects/proj72b0a2e3/customers/{id}/active_entitlements.
assert.equal(
  isProActive([
    { entitlement_id: 'entl2d972407b4', expires_at: 1785339831934, object: 'customer.active_entitlement' },
  ]),
  true
);

// A lifetime grant has no expiry. Presence alone must still be enough —
// isProActive must not do any date arithmetic.
assert.equal(
  isProActive([{ entitlement_id: 'entl2d972407b4', expires_at: null, object: 'customer.active_entitlement' }]),
  true
);

// Empty list -> not active. This is the refund case: RevenueCat only lists
// entitlements it considers currently active, so a refunded one is absent.
assert.equal(isProActive([]), false);

// A different entitlement does not count.
assert.equal(isProActive([{ entitlement_id: 'entl_somethingelse' }]), false);

// Pro alongside others -> active.
assert.equal(
  isProActive([{ entitlement_id: 'entl_other' }, { entitlement_id: 'entl2d972407b4' }]),
  true
);

// REGRESSION: the v2 API returns the OBJECT ID, never the lookup key.
// If isProActive were written against PRO_ENTITLEMENT_ID ('Capsule Pro'),
// every real response would read as "not active" and every CANCELLATION /
// EXPIRATION would revoke Pro from every paying customer.
assert.equal(isProActive([{ entitlement_id: PRO_ENTITLEMENT_ID }]), false);
assert.equal(isProActive([{ entitlement_id: 'Capsule Pro' }]), false);

// Junk elements must not throw — only a non-array `items` does.
assert.equal(isProActive([null, undefined, 'nope', 42]), false);
assert.equal(isProActive([null, { entitlement_id: 'entl2d972407b4' }]), true);

// A malformed body must NOT read as "no entitlement". Returning false here
// would revoke a paying customer on a bad response; throwing lets the caller
// turn it into a 500 and let RevenueCat retry.
assert.throws(() => isProActive(undefined), TypeError);
assert.throws(() => isProActive(null), TypeError);
assert.throws(() => isProActive({ items: [] }), TypeError);
assert.throws(() => isProActive('items'), TypeError);

console.log('entitlements.test.ts: all assertions passed');
