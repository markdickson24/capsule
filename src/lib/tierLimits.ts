// Single source of truth for Capsule Pro tier limits. All caps key off the
// capsule OWNER's tier (monetize the host; guests never pay). Extensible to a
// future 'premium' tier by adding one literal below.
//
// ⚠️ The `free.activeCapsules` value (3) is ALSO hardcoded server-side in
// create_capsule_with_owner (migration 20260721120000). Keep both in sync.
export type Tier = 'free' | 'pro';

export interface TierLimits {
  activeCapsules: number;    // max non-unlocked capsules a host may own
  membersPerCapsule: number; // max members (joined + pending) in a host's capsule
  photosPerCapsule: number;  // max media items in a host's capsule
  videoSeconds: number;      // max video clip length in a host's capsule
}

export const TIER_LIMITS: Record<Tier, TierLimits> = {
  free: { activeCapsules: 3, membersPerCapsule: 10, photosPerCapsule: 20, videoSeconds: 30 },
  pro: { activeCapsules: Infinity, membersPerCapsule: 50, photosPerCapsule: 1000, videoSeconds: 120 },
};

/** Limits for a tier string; unknown/null falls back to free (fail safe). */
export function limitsForTier(tier: string | null | undefined): TierLimits {
  return TIER_LIMITS[tier as Tier] ?? TIER_LIMITS.free;
}

export function tierFromIsPro(isPro: boolean): Tier {
  return isPro ? 'pro' : 'free';
}
