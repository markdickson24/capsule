# Refund revocation — design

_2026-07-29 · branch `fix/refund-revocation-webhook`_

## Problem

A refunded customer keeps Capsule Pro.

`users.subscription_tier` is the un-forgeable server-side gate for every Pro
limit (`create_capsule_with_owner`, `enforce_member_limit`,
`enforce_photo_limit`). It is written **only** by
`supabase/functions/revenuecat-webhook`. That function treats `CANCELLATION` as
an explicit no-op — and a refund arrives as `CANCELLATION` with
`cancellation_reason: "CUSTOMER_SUPPORT"`.

| Product | On refund today | Result |
|---|---|---|
| Lifetime $79.99 | `CANCELLATION` fires; **no `EXPIRATION` ever exists** for a non-subscription | tier stays `'pro'` **permanently** |
| Yearly $39.99 | `CANCELLATION`, then `EXPIRATION` at term end | keeps Pro up to a year after refund |
| Monthly $4.99 | same | keeps Pro up to a month after refund |
| — | `REFUND_REVERSED` unhandled | Pro never restored after Apple reverses a fraudulent refund |

Lifetime is both the worst case and the most expensive product.

**Nothing has been lost yet.** All 11 RevenueCat customers have zero purchases
and zero subscriptions in both production and sandbox — no sale has ever
completed, because Apple still requires the first IAP to be submitted attached
to an app version (HANDOFF open thread #3). This fix lands before the first
paying customer, not after.

## Already configured — not in scope

The user-facing half is done. Customer Center (`presentCustomerCenter()`, wired
to Settings → Manage Subscription) has a `REFUND_REQUEST` path with
`refund_window: forever` and a "Refunds Retention Discount" preliminary offer,
plus `CANCEL` with a 3-option survey, `CHANGE_PLANS`, and `MISSING_PURCHASE`.
Webhook `whintgrfc186311f2` already delivers **all** event types
(`event_types: null`). The events arrive; the function ignores them.

## Decision

**Never revoke without confirming.** Grant-direction events keep their existing
self-contained fast path. Every event that could *remove* access is verified
against RevenueCat's API first, and the answer is mirrored verbatim.

Asymmetric by design: granting wrongly costs a little revenue, revoking wrongly
costs a paying customer's trust.

| Event | Today | After |
|---|---|---|
| `CANCELLATION` | no-op | **verify** |
| `EXPIRATION` | blind revoke | **verify** |
| `SUBSCRIPTION_PAUSED` | blind revoke | **verify** |
| `REFUND_REVERSED` | unhandled | **verify** |
| `INITIAL_PURCHASE`, `RENEWAL`, `UNCANCELLATION`, `PRODUCT_CHANGE`, `NON_RENEWING_PURCHASE`, `SUBSCRIPTION_EXTENDED` | grant | unchanged |
| `TRANSFER`, `TEST`, auth, environment filter, entitlement filter | — | unchanged |

Verifying *all* `CANCELLATION` rather than only
`cancellation_reason === 'CUSTOMER_SUPPORT'` is simpler and safer: a plain
auto-renew-off cancellation verifies as still-active and correctly changes
nothing.

`REFUND_REVERSED` is the one verified event that moves in the *grant*
direction. It is verified rather than fast-pathed because it is rare, arrives
only after a prior revocation, and carries no reliable signal about whether the
reversal actually restored entitlement — the API answers that directly.

Two secondary bugs fall out of the same rule. `EXPIRATION` currently revokes
blind, so a resubscribe whose old `EXPIRATION` lands after the new
`INITIAL_PURCHASE` wrongly strips a paying customer until the next `RENEWAL`.
`SUBSCRIPTION_PAUSED` revokes the moment a pause is *scheduled*, though the
customer keeps access until the period actually ends.

### Why not verify on every event

RevenueCat recommends calling the API after *any* webhook. Rejected: a
mis-set or rotated key would then break **grants** too — the money-in path.
Keeping grants self-contained means the worst case of an API problem is a
delayed, retried revocation, never "a paying customer didn't get Pro." It also
avoids a round-trip on `RENEWAL`, the highest-volume event. That advice targets
greenfield backends; this mirror already works.

## The verification call

```
GET https://api.revenuecat.com/v2/projects/{project_id}/customers/{customer_id}/active_entitlements
Authorization: Bearer <REVENUECAT_API_KEY>
```

Pro is active iff an item with `entitlement_id === 'Capsule Pro'` is present.

`project_id` is the constant `proj72b0a2e3`, declared alongside the existing
`PRO_ENTITLEMENT_ID` — not an env var, matching how the entitlement id is
already handled in this function.

### Why v2, not the v1 `/subscribers` map

RevenueCat's docs point at v1 `GET /subscribers`, which returns every
entitlement the customer has ever held plus an `expires_date`, leaving the
caller to infer active-ness. A lifetime purchase has `expires_date: null`,
meaning "never expires" — so a refunded lifetime lingering in that map reads as
permanently active. That is the exact bug being fixed, reintroduced inside the
fix.

v2 `active_entitlements` makes RevenueCat decide. If it considers a refunded
lifetime inactive, it is simply absent. Presence is the whole check: no date
arithmetic, no ambiguity, no assumption about how refunds are represented.

Confirmed live: `get-customer` embeds an `active_entitlements` list, empty for a
customer with no purchases.

## Failure handling

On any API failure — non-2xx, network error, malformed body, or unset key —
**do not touch the tier**, `console.error`, and return **500**.

RevenueCat retries any non-200 five times at 5/10/20/40/80 minutes (~2.5h
total), so a transient failure self-heals. Guessing a direction is never
acceptable: defaulting to revoke strips a paying customer on a blip; defaulting
to grant keeps a refunder entitled.

An unset `REVENUECAT_API_KEY` fails loud rather than silently falling back to
today's behavior — a missing secret is a deploy error, and the retry window
gives 2.5h to fix it. **The secret must be set before the function is
deployed.**

Known limitation: if all five retries fail, the tier stays stale with only a
Supabase edge-function log recording it. Edge functions have no Sentry wiring
(`src/lib/sentry.ts` is client-only); adding it is out of scope.

## Security

A new V2 secret key scoped to **`customer_information:customers:read`**, stored
as the Supabase Edge Function secret `REVENUECAT_API_KEY`.

Deliberately *not* the existing `sk_LHebuVWgm…` key from the RevenueCat MCP
config in `~/.claude.json` — that one is full-access (it can create products,
publish paywalls, and grant entitlements). Least privilege: if the Supabase
secret ever leaked, a read-only key exposes customer entitlement reads and
nothing else.

`EXPO_PUBLIC_REVENUECAT_IOS_KEY` in `.env` is the **public SDK key** and is not
a candidate — it ships inside the client bundle.

## Verification plan

No test framework in this repo (by design), so this follows the
`src/lib/recurrence.test.ts` precedent: a pure function tested with
`node:assert/strict` under `npx tsx`.

1. **Unit** — extract the pure decision into
   `supabase/functions/revenuecat-webhook/entitlements.ts` (no Deno globals, so
   `tsx` can import it) and test `isProActive(items)`: entitlement present,
   absent, empty list, a different entitlement, malformed/missing `items`.
2. **Response-shape confirmation** — `entitlement_id` is the one field name not
   yet confirmed against real data, because no customer in the project holds an
   entitlement. Grant `Capsule Pro` via MCP to a throwaway `app_user_id` that
   does **not** exist in Supabase `users`, read the shape back, then revoke. The
   webhook's own write no-ops (the `UPDATE` matches zero rows), so this touches
   no real account.
3. **End-to-end** — create a disposable `users` row at tier `'pro'`, POST a
   crafted `CANCELLATION` to the deployed function with the real webhook secret,
   assert the tier flips to `'free'`, then delete the row.

## Out of scope

- **Backfill** — unnecessary, no purchase has ever completed.
- Customer Center `support.email` (currently `""`), retention-offer copy.
- In-app refund policy copy.
- Any client change. This ships as an edge-function deploy alone — independent
  of the stale-TestFlight blocker (HANDOFF open thread #1).

## Files

| File | Change |
|---|---|
| `supabase/functions/revenuecat-webhook/index.ts` | verify-before-revoke routing, API call, failure handling |
| `supabase/functions/revenuecat-webhook/entitlements.ts` | new — pure `isProActive` |
| `supabase/functions/revenuecat-webhook/entitlements.test.ts` | new — unit tests |
| `CLAUDE.md` | update the Monetization → server-side gate section |

## Manual steps

1. RevenueCat dashboard → Project settings → API keys → **+ New** → V2 →
   permission `customer_information:customers:read` → Generate. (Secret keys
   cannot be minted through the MCP, which exposes public keys only.)
2. Set it as the Supabase secret `REVENUECAT_API_KEY` **before** deploying.
