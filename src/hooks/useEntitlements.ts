import { useCallback, useEffect, useRef, useState } from 'react';
import { AppState } from 'react-native';
import type { CustomerInfo } from 'react-native-purchases';
import {
  getCustomerInfo,
  isProActive,
  purchasesSupported,
  subscribeCustomerInfo,
} from '../lib/purchases';
import { cache } from '../lib/cache';
import { sessionStore } from '../lib/sessionStore';
import { supabase } from '../lib/supabase';
import { entitlementsResolved, resolveIsPro, type SourceState } from '../lib/tierLimits';

/** Cache key for the signed-in user's mirrored tier. */
export const tierCacheKey = (userId: string) => `tier:${userId}`;

// Short TTL: the DB tier is a mirror, so it should re-sync soon after an expiry
// the webhook has already written. A purchase needs no TTL wait — RevenueCat's
// listener flips isPro immediately.
const TIER_TTL = 5 * 60 * 1000;

// Both sources are network reads that can fail transiently at cold start. Retry
// briefly before declaring a source unavailable — an unavailable source is safe
// (see entitlementsResolved) but leaves gates inert, so it's worth avoiding.
const RETRY_DELAYS_MS = [400, 1500];

const sleep = (ms: number) => new Promise<void>(resolve => setTimeout(resolve, ms));

/**
 * Run `fetchOnce` until it returns a non-null value, up to RETRY_DELAYS_MS.length
 * retries. Returns null once exhausted, or early if the caller unmounted.
 */
async function withRetry<T>(
  fetchOnce: () => Promise<T | null>,
  isAlive: () => boolean,
): Promise<T | null> {
  for (let attempt = 0; ; attempt++) {
    const value = await fetchOnce();
    if (value !== null) return value;
    if (attempt >= RETRY_DELAYS_MS.length || !isAlive()) return null;
    await sleep(RETRY_DELAYS_MS[attempt]);
    if (!isAlive()) return null;
  }
}

/**
 * Read `users.subscription_tier` for the signed-in user.
 *
 * Returns null for "no answer" — signed out, or the read failed. Null never
 * revokes Pro (see resolveIsPro); it means this source has no opinion.
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
 * ⚠️ **`loading` means "don't act yet", not merely "still fetching".** It stays
 * true while either source is pending AND when neither source could answer at
 * all. `isPro` is a boolean and cannot express "we don't know", so a failed
 * fetch would otherwise be indistinguishable from a confirmed free account —
 * which is exactly how a paying customer gets paywalled by a cold-start network
 * blip. Any gate reading the current user's own tier must check
 * `!loading && !isPro`, never `!isPro` alone.
 *
 * Failures are retried with backoff, and an unresolved state re-attempts when
 * the app returns to the foreground, so a transient failure self-heals rather
 * than sticking for the whole session.
 *
 * Reminder: this is UI-level state. Enforce Pro-gated limits server-side
 * (users.subscription_tier + RLS), not on this value alone.
 */
export function useEntitlements() {
  const [customerInfo, setCustomerInfo] = useState<CustomerInfo | null>(null);
  const [dbTier, setDbTier] = useState<string | null>(null);
  // On web the SDK stub never has an opinion, so it starts unavailable rather
  // than pending — otherwise every web screen would wait out the retry backoff
  // for an answer that is never coming.
  const [rcState, setRcState] = useState<SourceState>(
    purchasesSupported ? 'pending' : 'unavailable',
  );
  const [dbState, setDbState] = useState<SourceState>('pending');

  const aliveRef = useRef(true);

  const load = useCallback(async (opts?: { bustCache?: boolean }) => {
    if (opts?.bustCache) {
      const userId = sessionStore.get()?.user?.id;
      if (userId) cache.invalidate(tierCacheKey(userId));
    }

    // Resolved independently rather than behind one Promise.all: a slow or
    // failing source must not hold back one that already answered.
    const rc = purchasesSupported
      ? withRetry(getCustomerInfo, () => aliveRef.current).then(info => {
          if (!aliveRef.current) return;
          setCustomerInfo(info);
          setRcState(info ? 'known' : 'unavailable');
        })
      : Promise.resolve();

    const db = withRetry(fetchDbTier, () => aliveRef.current).then(tier => {
      if (!aliveRef.current) return;
      setDbTier(tier);
      setDbState(tier ? 'known' : 'unavailable');
    });

    await Promise.all([rc, db]);
  }, []);

  const refresh = useCallback(async () => {
    setRcState(purchasesSupported ? 'pending' : 'unavailable');
    setDbState('pending');
    await load({ bustCache: true });
  }, [load]);

  useEffect(() => {
    aliveRef.current = true;
    load();

    const unsubscribe = subscribeCustomerInfo(info => {
      if (!aliveRef.current) return;
      setCustomerInfo(info);
      setRcState('known');
    });

    return () => {
      aliveRef.current = false;
      unsubscribe();
    };
  }, [load]);

  const resolved = entitlementsResolved(rcState, dbState);

  // Retry on foreground while still unresolved. Mirrors the AppState refresh
  // Home and CapsuleDetail use, and covers the common case of a device that was
  // offline at launch and has since reconnected.
  useEffect(() => {
    if (resolved) return;
    const sub = AppState.addEventListener('change', state => {
      if (state === 'active' && aliveRef.current) load({ bustCache: true });
    });
    return () => sub.remove();
  }, [resolved, load]);

  return {
    isPro: resolveIsPro(isProActive(customerInfo), dbTier),
    loading: !resolved,
    customerInfo,
    refresh,
  };
}
