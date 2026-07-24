import { useCallback, useEffect, useState } from 'react';
import type { CustomerInfo } from 'react-native-purchases';
import { getCustomerInfo, isProActive, subscribeCustomerInfo } from '../lib/purchases';
import { cache } from '../lib/cache';
import { sessionStore } from '../lib/sessionStore';
import { supabase } from '../lib/supabase';
import { resolveIsPro } from '../lib/tierLimits';

/** Cache key for the signed-in user's mirrored tier. */
export const tierCacheKey = (userId: string) => `tier:${userId}`;

// Short TTL: the DB tier is a mirror, so it should re-sync soon after an expiry
// the webhook has already written. A purchase needs no TTL wait — RevenueCat's
// listener flips isPro immediately.
const TIER_TTL = 5 * 60 * 1000;

/**
 * Read `users.subscription_tier` for the signed-in user.
 *
 * Returns null for "no signal" — signed out, or the read failed. Null never
 * revokes Pro (see resolveIsPro); it just means this source has no opinion and
 * RevenueCat decides alone, which is the previous behaviour.
 */
async function fetchDbTier(): Promise<string | null> {
  // sessionStore is the synchronous cache; supabase.auth.getSession() can hang
  // on web when the stored token is expired.
  const userId = sessionStore.get()?.user?.id;
  if (!userId) return null;

  const cached = cache.get<string>(tierCacheKey(userId), TIER_TTL);
  if (cached) return cached;

  // Select the single column deliberately: `users` has a column-level SELECT
  // grant, and widening this to '*' would 42501 the whole query.
  const { data, error } = await supabase
    .from('users')
    .select('subscription_tier')
    .eq('id', userId)
    .single();

  if (error || !data?.subscription_tier) return null;
  cache.set(tierCacheKey(userId), data.subscription_tier);
  return data.subscription_tier;
}

/**
 * Reactive Capsule Pro entitlement state, resolved from the RevenueCat SDK and
 * the mirrored `users.subscription_tier` together — either one grants Pro. See
 * resolveIsPro() for why reading RevenueCat alone paywalled real Pro users.
 *
 * Re-renders on every RevenueCat update (purchase, restore, renewal, expiry) via
 * the SDK's CustomerInfo listener, so a paywall purchase anywhere in the app
 * flips `isPro` here with no manual refetch.
 *
 * `loading` stays true until BOTH sources settle. Gates reading the current
 * user's own tier must respect it (`!loading && !isPro`) — acting while either
 * source is unresolved is what false-gates a Pro user.
 *
 * Reminder: this is UI-level state. Enforce Pro-gated limits server-side
 * (users.subscription_tier + RLS), not on this value alone.
 */
export function useEntitlements() {
  const [customerInfo, setCustomerInfo] = useState<CustomerInfo | null>(null);
  const [dbTier, setDbTier] = useState<string | null>(null);
  const [rcSettled, setRcSettled] = useState(false);
  const [dbSettled, setDbSettled] = useState(false);

  const refresh = useCallback(async () => {
    const userId = sessionStore.get()?.user?.id;
    if (userId) cache.invalidate(tierCacheKey(userId));
    const [info, tier] = await Promise.all([getCustomerInfo(), fetchDbTier()]);
    setCustomerInfo(info);
    setDbTier(tier);
    setRcSettled(true);
    setDbSettled(true);
  }, []);

  useEffect(() => {
    let mounted = true;

    // Settled independently rather than behind one Promise.all: a slow DB read
    // must not hold back an already-resolved RevenueCat entitlement, or vice
    // versa, since `loading` blocks the gates that depend on this.
    getCustomerInfo().then(info => {
      if (!mounted) return;
      setCustomerInfo(info);
      setRcSettled(true);
    });

    fetchDbTier().then(tier => {
      if (!mounted) return;
      setDbTier(tier);
      setDbSettled(true);
    });

    const unsubscribe = subscribeCustomerInfo(info => {
      if (mounted) setCustomerInfo(info);
    });

    return () => {
      mounted = false;
      unsubscribe();
    };
  }, []);

  return {
    isPro: resolveIsPro(isProActive(customerInfo), dbTier),
    loading: !rcSettled || !dbSettled,
    customerInfo,
    refresh,
  };
}
