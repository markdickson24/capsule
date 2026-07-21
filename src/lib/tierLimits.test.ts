// Run with: npx tsx src/lib/tierLimits.test.ts
// Mirrors the src/lib/recurrence.test.ts precedent (no jest in this repo).
import assert from 'node:assert/strict';
import { limitsForTier, tierFromIsPro, TIER_LIMITS } from './tierLimits';

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

console.log('tierLimits.test.ts: all assertions passed');
