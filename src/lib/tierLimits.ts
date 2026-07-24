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

/**
 * Resolve UI-level Pro from BOTH sources of truth.
 *
 * Pro can exist in two places that legitimately disagree:
 *   - the RevenueCat entitlement (what the device's SDK has synced), and
 *   - `users.subscription_tier` (what the webhook wrote, and what every
 *     server-side gate actually enforces).
 *
 * Reading only RevenueCat — which is what this used to do — showed the free UI
 * to genuinely-Pro users whenever the two diverged: a tier granted server-side
 * with no purchase behind it (comps, support grants, the App Store reviewer
 * account), a `getCustomerInfo()` failure at cold start, a `logIn()` that never
 * landed so the entitlement stayed on the anonymous customer, or web, where the
 * SDK stub always reports false. Those users were paywalled out of custom
 * colors, recurring groups, extra capsules and long video.
 *
 * So either source alone grants Pro; neither may veto the other. An unresolved
 * or unrecognised tier is treated as "no signal", never as a revocation.
 *
 * Still UI-only. `guard_subscription_tier` makes that column server-writable
 * only, so this is no weaker than trusting the SDK — but real enforcement stays
 * server-side either way.
 */
export function resolveIsPro(
  rcEntitlementActive: boolean,
  dbTier: string | null | undefined,
): boolean {
  return rcEntitlementActive || dbTier === 'pro';
}
