/**
 * Pure helpers for the RevenueCat webhook.
 *
 * Deliberately free of Deno globals (no `Deno.env`, no remote imports) so this
 * file can be imported by BOTH the edge function (Deno) and
 * entitlements.test.ts (Node, via `npx tsx`).
 */

/** The RevenueCat project that owns the Capsule Pro entitlement. */
export const RC_PROJECT_ID = 'proj72b0a2e3';

/**
 * The entitlement's LOOKUP KEY.
 *
 * This is what WEBHOOK PAYLOADS carry in `event.entitlement_ids`.
 * It is NOT what the v2 REST API returns. See PRO_ENTITLEMENT_OBJECT_ID.
 */
export const PRO_ENTITLEMENT_ID = 'Capsule Pro';

/**
 * The entitlement's OBJECT ID.
 *
 * This is what the v2 REST API returns in
 * `active_entitlements[].entitlement_id` (confirmed against the live API,
 * 2026-07-29). It is NOT the lookup key.
 *
 * These are two different strings for the same entitlement. Comparing an API
 * response against PRO_ENTITLEMENT_ID never matches, which would make every
 * verification report "not active" and revoke Pro from every paying customer —
 * strictly worse than the refund bug this exists to fix.
 */
export const PRO_ENTITLEMENT_OBJECT_ID = 'entl2d972407b4';

/**
 * True iff Capsule Pro appears in a v2 `active_entitlements` list.
 *
 * Presence is the whole check. RevenueCat only lists entitlements it considers
 * currently active, so a refunded or expired one is simply absent — no date
 * arithmetic, and no assumption about how a refund is represented.
 *
 * Throws when `items` is not an array. That matters: a malformed response must
 * not be indistinguishable from "no entitlement", or a bad API response would
 * silently revoke a paying customer.
 */
export function isProActive(items: unknown): boolean {
  if (!Array.isArray(items)) {
    throw new TypeError('active_entitlements: expected an items array');
  }
  return items.some(
    (item) =>
      typeof item === 'object' &&
      item !== null &&
      (item as { entitlement_id?: unknown }).entitlement_id === PRO_ENTITLEMENT_OBJECT_ID
  );
}
