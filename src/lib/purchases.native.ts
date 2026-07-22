import { Platform } from 'react-native';
import Purchases, {
  LOG_LEVEL,
  type CustomerInfo,
  type PurchasesOffering,
  type PurchasesPackage,
} from 'react-native-purchases';
import RevenueCatUI, { PAYWALL_RESULT } from 'react-native-purchases-ui';

/**
 * RevenueCat integration (native only — see purchases.web.ts for the web stub
 * and purchases.ts for the TS-resolution fallback, same split as
 * usePushNotifications). Everything the app touches goes through this module so
 * the SDK is configured exactly once and the entitlement id lives in one place.
 *
 * SECURITY NOTE: this client-side entitlement check is for *UI* only (what to
 * show, when to present the paywall). The real gate is server-side — a
 * RevenueCat webhook mirrors the entitlement into `users.subscription_tier`,
 * which the RLS policies read. Never trust `isProActive()` for anything a
 * malicious client could bypass.
 */

// The entitlement identifier as configured in the RevenueCat dashboard.
// ⚠️ Must match EXACTLY (case-sensitive) — a mismatch means isPro is always
// false and the paywall never dismisses on purchase. Change this here if you
// rename the entitlement, e.g. to 'pro'.
export const PRO_ENTITLEMENT_ID = 'Capsule Pro';

function apiKey(): string | undefined {
  return Platform.select({
    ios: process.env.EXPO_PUBLIC_REVENUECAT_IOS_KEY,
    android: process.env.EXPO_PUBLIC_REVENUECAT_ANDROID_KEY,
    default: undefined,
  });
}

let configured = false;

/** Configure the SDK once. Idempotent — safe to call on every launch/effect. */
export function configurePurchases(): void {
  if (configured) return;
  const key = apiKey();
  if (!key) {
    // Fail closed: never silently run on a shared Test Store key in a release
    // build (that would grant real Pro for free). Purchases are simply disabled
    // when no real key is configured.
    console.warn('[Purchases] no RevenueCat key set — purchases disabled');
    return;
  }
  try {
    if (__DEV__) Purchases.setLogLevel(LOG_LEVEL.DEBUG);
    // Configure anonymously; identifyUser() aliases to the Supabase id once the
    // session resolves (auth restore is async, so we rarely have the id here).
    Purchases.configure({ apiKey: key });
    configured = true;
  } catch (e) {
    console.warn('[Purchases] configure failed:', e);
  }
}

function ensureConfigured(): void {
  if (!configured) configurePurchases();
}

/**
 * Tie the RevenueCat app-user to the Supabase user id. This is what lets the
 * webhook map purchases back to `users.subscription_tier`, and lets a user's
 * Pro follow them across devices/reinstalls. logIn merges the prior anonymous
 * user into the identified one.
 */
export async function identifyUser(userId: string): Promise<boolean> {
  ensureConfigured();
  if (!configured) return false;
  try {
    await Purchases.logIn(userId);
    return true;
  } catch (e) {
    console.warn('[Purchases] logIn failed, retrying once:', e);
    try {
      await Purchases.logIn(userId);
      return true;
    } catch (e2) {
      console.warn('[Purchases] logIn retry failed:', e2);
      return false;
    }
  }
}

/** Reset to an anonymous user on sign-out. No-op (not an error) if never identified. */
export async function resetUser(): Promise<void> {
  if (!configured) return;
  try {
    await Purchases.logOut();
  } catch {
    // logOut throws if the current user is already anonymous — expected, ignore.
  }
}

/** True when the Capsule Pro entitlement is active on this CustomerInfo. */
export function isProActive(info: CustomerInfo | null): boolean {
  return !!info && info.entitlements.active[PRO_ENTITLEMENT_ID] !== undefined;
}

/** Fetch the latest CustomerInfo (null on failure — callers treat null as "not Pro"). */
export async function getCustomerInfo(): Promise<CustomerInfo | null> {
  ensureConfigured();
  try {
    return await Purchases.getCustomerInfo();
  } catch (e) {
    console.warn('[Purchases] getCustomerInfo failed:', e);
    return null;
  }
}

/** Convenience: is the current user Pro right now? */
export async function getIsProNow(): Promise<boolean> {
  return isProActive(await getCustomerInfo());
}

/**
 * Subscribe to CustomerInfo changes (fires after any purchase/restore/renewal,
 * on every platform event). Returns an unsubscribe fn. Powers useEntitlements.
 */
export function subscribeCustomerInfo(cb: (info: CustomerInfo) => void): () => void {
  Purchases.addCustomerInfoUpdateListener(cb);
  return () => Purchases.removeCustomerInfoUpdateListener(cb);
}

/**
 * Present the RevenueCat-hosted paywall for the current offering.
 * Returns true if the user came out entitled (purchased or restored).
 *
 * Requires a Paywall to be configured on the offering in the RevenueCat
 * dashboard (Paywalls tab). Without one, this resolves NOT_PRESENTED.
 */
export async function presentPaywall(): Promise<boolean> {
  ensureConfigured();
  try {
    const result = await RevenueCatUI.presentPaywall();
    return result === PAYWALL_RESULT.PURCHASED || result === PAYWALL_RESULT.RESTORED;
  } catch (e) {
    console.warn('[Purchases] presentPaywall failed:', e);
    return false;
  }
}

/**
 * Present the paywall only if the user is NOT already Pro — the right call for
 * gating a Pro action (tap "unlimited capsules" → this → proceed if it returns
 * true). Returns true when the user is entitled afterwards (already had it,
 * purchased, or restored).
 */
export async function presentProPaywallIfNeeded(): Promise<boolean> {
  ensureConfigured();
  try {
    const result = await RevenueCatUI.presentPaywallIfNeeded({
      requiredEntitlementIdentifier: PRO_ENTITLEMENT_ID,
    });
    return (
      result === PAYWALL_RESULT.NOT_PRESENTED || // already entitled
      result === PAYWALL_RESULT.PURCHASED ||
      result === PAYWALL_RESULT.RESTORED
    );
  } catch (e) {
    console.warn('[Purchases] presentPaywallIfNeeded failed:', e);
    return false;
  }
}

/**
 * Present the RevenueCat Customer Center — the drop-in "manage my subscription"
 * UI (cancel, change plan, restore, refund requests, support). Wire this to a
 * "Manage Capsule Pro" row in Settings.
 */
export async function presentCustomerCenter(): Promise<void> {
  ensureConfigured();
  try {
    await RevenueCatUI.presentCustomerCenter();
  } catch (e) {
    console.warn('[Purchases] presentCustomerCenter failed:', e);
  }
}

/** The current default offering (lifetime/yearly/monthly packages), or null. */
export async function getProOffering(): Promise<PurchasesOffering | null> {
  ensureConfigured();
  try {
    const offerings = await Purchases.getOfferings();
    return offerings.current;
  } catch (e) {
    console.warn('[Purchases] getOfferings failed:', e);
    return null;
  }
}

export type PurchaseOutcome =
  | { status: 'purchased'; isPro: boolean }
  | { status: 'cancelled' }
  | { status: 'error'; message: string };

/**
 * Manual purchase of a specific package — the escape hatch for a fully custom
 * paywall UI. For the standard flow, prefer the hosted paywall above.
 * `userCancelled` is surfaced as its own status so callers don't toast an error
 * when the user simply backed out.
 */
export async function purchasePackage(pkg: PurchasesPackage): Promise<PurchaseOutcome> {
  ensureConfigured();
  try {
    const { customerInfo } = await Purchases.purchasePackage(pkg);
    return { status: 'purchased', isPro: isProActive(customerInfo) };
  } catch (e: any) {
    if (e?.userCancelled) return { status: 'cancelled' };
    console.warn('[Purchases] purchasePackage failed:', e);
    return { status: 'error', message: e?.message ?? 'Purchase failed' };
  }
}

/** Restore prior purchases (required by Apple — wire a "Restore Purchases" button). */
export async function restorePurchases(): Promise<boolean> {
  ensureConfigured();
  try {
    const info = await Purchases.restorePurchases();
    return isProActive(info);
  } catch (e) {
    console.warn('[Purchases] restorePurchases failed:', e);
    return false;
  }
}
