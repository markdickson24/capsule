// Pure decision extracted from CapsuleDetailScreen's applyCapsule(), which is
// otherwise tangled inside a ~2200-line stateful screen component (channel
// subscriptions, reveal animation, cache invalidation) — see the Tier 2
// convention in CLAUDE.md ("extract the pure decision into a src/lib module").
//
// Run with: npx tsx src/lib/mergeCapsuleUpdate.test.ts
import type { Capsule } from '../types/database';

// `owner` is a PostgREST embed (`owner:users!capsules_owner_id_fkey(subscription_tier)`)
// added on top of the generated `capsules` row type — it only exists on rows
// load() actually fetched with that select, never on a raw `capsules` table row.
export type CapsuleWithOwner = Capsule & { owner?: { subscription_tier: string } | null };

/**
 * Merges a freshly-received capsule row onto the previously-held state.
 *
 * `fresh` can come from three places: load()'s own `.select()` (carries a
 * real `owner` embed), a `postgres_changes` UPDATE payload's `payload.new`
 * (the bare `capsules` table row — a Postgres WAL row structurally CANNOT
 * carry a PostgREST relation), or a local optimistic patch spread off the
 * current `capsule` state (already carries whatever `owner` it started with).
 *
 * A naive wholesale replace (`fresh` as the new state) silently drops the
 * `owner` embed whenever `fresh` is a bare row with no `owner` key — so any
 * realtime UPDATE to the capsules row (title edit, unlock, a live-activity
 * flag flip, anything) would downgrade `ownerTier` to 'free' for the rest of
 * the session, since `ownerTier` is derived fresh from `capsule.owner` on
 * every render. Preserve the previous `owner` whenever `fresh` doesn't carry
 * one of its own; a `fresh` that DOES carry a real `owner` (load()'s rows)
 * simply wins, so this never masks a genuine tier change.
 */
export function mergeCapsuleUpdate(
  prev: CapsuleWithOwner | null,
  fresh: CapsuleWithOwner,
): CapsuleWithOwner {
  return { ...fresh, owner: fresh.owner ?? prev?.owner ?? null };
}
