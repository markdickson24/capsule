// Run with: npx tsx src/lib/mergeCapsuleUpdate.test.ts
// Regression test for: realtime `capsules` UPDATE payloads carry the bare
// table row (no `owner` embed), and CapsuleDetailScreen's applyCapsule() used
// to do a wholesale `setCapsule(fresh)` replace — silently downgrading a Pro
// owner's `ownerTier` to 'free' (photo cap, member cap, export gate, owner
// ProBadge all read `capsule.owner?.subscription_tier`) on ANY realtime
// UPDATE to that capsule's row, not just ones touching the owner.
import assert from 'node:assert/strict';
import { mergeCapsuleUpdate, CapsuleWithOwner } from './mergeCapsuleUpdate';

const proOwnerRow = { id: 'c1', status: 'active', title: 'Trip' } as unknown as CapsuleWithOwner;
const prevWithProOwner: CapsuleWithOwner = {
  ...proOwnerRow,
  owner: { subscription_tier: 'pro' },
};

// A realtime `postgres_changes` UPDATE payload's `payload.new` — e.g. after a
// title edit or an unlock — is the bare `capsules` row: it has no `owner` key
// at all (not `owner: undefined`, the key is structurally absent).
const bareRealtimeRow: CapsuleWithOwner = {
  ...proOwnerRow,
  title: 'Trip (edited)',
};
assert.ok(!('owner' in bareRealtimeRow), 'fixture must not carry an owner key');

// 1. The core regression: a bare realtime row must not erase a previously
//    known owner tier.
const afterRealtimeUpdate = mergeCapsuleUpdate(prevWithProOwner, bareRealtimeRow);
assert.equal(
  afterRealtimeUpdate.owner?.subscription_tier,
  'pro',
  'realtime UPDATE with no owner embed must preserve the previously-fetched owner tier',
);
// The rest of the fresh row (the actual point of the UPDATE) must still win.
assert.equal(afterRealtimeUpdate.title, 'Trip (edited)');

// 2. load()'s own fetch DOES carry a real owner embed — it must win over
//    whatever was previously cached (a genuine tier change must show up).
const freshFromLoad: CapsuleWithOwner = {
  ...proOwnerRow,
  owner: { subscription_tier: 'free' },
};
const afterLoad = mergeCapsuleUpdate(prevWithProOwner, freshFromLoad);
assert.equal(afterLoad.owner?.subscription_tier, 'free');

// 3. First-ever apply (prev is null, e.g. initial mount) — no owner to
//    inherit, so a bare fresh row just has no owner (not a crash).
const firstApply = mergeCapsuleUpdate(null, bareRealtimeRow);
assert.equal(firstApply.owner, null);

console.log('mergeCapsuleUpdate.test.ts: all assertions passed');
