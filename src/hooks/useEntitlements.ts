import { useCallback, useEffect, useState } from 'react';
import type { CustomerInfo } from 'react-native-purchases';
import { getCustomerInfo, isProActive, subscribeCustomerInfo } from '../lib/purchases';

/**
 * Reactive Capsule Pro entitlement state. Reads the current CustomerInfo on
 * mount and re-renders on every RevenueCat update (purchase, restore, renewal,
 * expiry) via the SDK's CustomerInfo listener — so a paywall purchase anywhere
 * in the app flips `isPro` here with no manual refetch.
 *
 * Web returns { isPro: false, loading: false } via the no-op stub.
 *
 * Reminder: this is UI-level state. Enforce Pro-gated limits server-side
 * (users.subscription_tier + RLS), not on this value alone.
 */
export function useEntitlements() {
  const [customerInfo, setCustomerInfo] = useState<CustomerInfo | null>(null);
  const [loading, setLoading] = useState(true);

  const refresh = useCallback(async () => {
    const info = await getCustomerInfo();
    setCustomerInfo(info);
    setLoading(false);
  }, []);

  useEffect(() => {
    let mounted = true;

    getCustomerInfo().then(info => {
      if (!mounted) return;
      setCustomerInfo(info);
      setLoading(false);
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
    isPro: isProActive(customerInfo),
    loading,
    customerInfo,
    refresh,
  };
}
