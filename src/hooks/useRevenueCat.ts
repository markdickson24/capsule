import { useEffect, useRef } from 'react';
import { configurePurchases, identifyUser, resetUser } from '../lib/purchases';

/**
 * App-level RevenueCat lifecycle: configure the SDK once at launch, then keep
 * the RevenueCat app-user id in sync with the signed-in Supabase user. Mirrors
 * usePushNotifications(session?.user.id) — call once from RootNavigator.
 *
 * - configure on mount (idempotent)
 * - logIn when a user id appears / changes
 * - logOut when the user signs out (guarded so we never logOut an anonymous
 *   user, which the SDK treats as an error)
 */
export function useRevenueCat(userId?: string) {
  const identifiedRef = useRef<string | null>(null);

  useEffect(() => {
    configurePurchases();
  }, []);

  useEffect(() => {
    if (userId && identifiedRef.current !== userId) {
      identifiedRef.current = userId;
      identifyUser(userId);
    } else if (!userId && identifiedRef.current) {
      identifiedRef.current = null;
      resetUser();
    }
  }, [userId]);
}
