import type { CustomerInfo, PurchasesOffering, PurchasesPackage } from 'react-native-purchases';

/**
 * Web stub for the RevenueCat integration. `react-native-purchases` is
 * native-only, so on web everything no-ops and the user is treated as not-Pro.
 * Signatures mirror purchases.native.ts exactly. (Web billing / web2app is a
 * separate later phase and would use RevenueCat's web SDK, not this module.)
 */

export const PRO_ENTITLEMENT_ID = 'Capsule Pro';

export function configurePurchases(): void {}
export async function identifyUser(_userId: string): Promise<boolean> { return false; }
export async function resetUser(): Promise<void> {}
export function isProActive(_info: CustomerInfo | null): boolean {
  return false;
}
export async function getCustomerInfo(): Promise<CustomerInfo | null> {
  return null;
}
export async function getIsProNow(): Promise<boolean> {
  return false;
}
export function subscribeCustomerInfo(_cb: (info: CustomerInfo) => void): () => void {
  return () => {};
}
export async function presentPaywall(): Promise<boolean> {
  return false;
}
export async function presentProPaywallIfNeeded(): Promise<boolean> {
  return false;
}
export async function presentCustomerCenter(): Promise<void> {}
export async function getProOffering(): Promise<PurchasesOffering | null> {
  return null;
}

export type PurchaseOutcome =
  | { status: 'purchased'; isPro: boolean }
  | { status: 'cancelled' }
  | { status: 'error'; message: string };

export async function purchasePackage(_pkg: PurchasesPackage): Promise<PurchaseOutcome> {
  return { status: 'error', message: 'Purchases are not available on web' };
}
export async function restorePurchases(): Promise<boolean> {
  return false;
}
