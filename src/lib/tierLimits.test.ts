// Run with: npx tsx src/lib/tierLimits.test.ts
// Mirrors the src/lib/recurrence.test.ts precedent (no jest in this repo).
import assert from 'node:assert/strict';
import {
  entitlementsResolved,
  limitsForTier,
  resolveIsPro,
  tierFromIsPro,
  TIER_LIMITS,
} from './tierLimits';

assert.equal(limitsForTier('free').activeCapsules, 3);
assert.equal(limitsForTier('pro').activeCapsules, Infinity);
assert.equal(limitsForTier('free').videoSeconds, 30);
assert.equal(limitsForTier('pro').videoSeconds, 120);
// fail-safe: unknown/null → free
assert.deepEqual(limitsForTier(undefined), TIER_LIMITS.free);
assert.deepEqual(limitsForTier(null), TIER_LIMITS.free);
assert.deepEqual(limitsForTier('premium'), TIER_LIMITS.free);
assert.equal(tierFromIsPro(true), 'pro');
assert.equal(tierFromIsPro(false), 'free');

// resolveIsPro: either source alone is sufficient. The two can legitimately
// disagree — a server-granted tier has no RevenueCat purchase behind it, and a
// fresh purchase beats the webhook to the DB — so neither may veto the other.
assert.equal(resolveIsPro(true, 'pro'), true);
assert.equal(resolveIsPro(true, 'free'), true);   // purchase not yet mirrored by the webhook
assert.equal(resolveIsPro(false, 'pro'), true);   // server-granted, or RevenueCat unreachable
assert.equal(resolveIsPro(false, 'free'), false);
// fail-safe: an unresolved or unrecognised tier must not by itself grant Pro
assert.equal(resolveIsPro(false, null), false);
assert.equal(resolveIsPro(false, undefined), false);
assert.equal(resolveIsPro(false, 'premium'), false);
// ...but it must not revoke a live RevenueCat entitlement either
assert.equal(resolveIsPro(true, null), true);

// entitlementsResolved: may a gate act on the current isPro value yet?
// Both answered — decide.
assert.equal(entitlementsResolved('known', 'known'), true);
// One answered, the other can't. One definite answer is enough to decide.
assert.equal(entitlementsResolved('known', 'unavailable'), true);
assert.equal(entitlementsResolved('unavailable', 'known'), true);
// Web: the SDK stub never has an opinion, so the DB alone decides.
assert.equal(entitlementsResolved('unavailable', 'known'), true);
// Still waiting — acting now is what false-gates a Pro user mid-fetch.
assert.equal(entitlementsResolved('pending', 'pending'), false);
assert.equal(entitlementsResolved('pending', 'known'), false);
assert.equal(entitlementsResolved('known', 'pending'), false);
assert.equal(entitlementsResolved('pending', 'unavailable'), false);
// NEITHER source could answer: isPro is false only because we know nothing.
// Acting on that would paywall a paying user, so this must never read resolved.
assert.equal(entitlementsResolved('unavailable', 'unavailable'), false);

console.log('tierLimits.test.ts: all assertions passed');
