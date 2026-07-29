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
| `REFUND_REVERSED` | unhandled | **verify** |
| `INITIAL_PURCHASE`, `RENEWAL`, `UNCANCELLATION`, `PRODUCT_CHANGE`, `NON_RENEWING_PURCHASE`, `SUBSCRIPTION_EXTENDED` | grant | unchanged |
| `SUBSCRIPTION_PAUSED` | blind revoke | unchanged — see below |
| `TRANSFER`, `TEST`, auth, environment filter, entitlement filter | — | unchanged |

Verifying *all* `CANCELLATION` rather than only
`cancellation_reason === 'CUSTOMER_SUPPORT'` is simpler and safer: a plain
auto-renew-off cancellation verifies as still-active and correctly changes
nothing.

`REFUND_REVERSED` is the one verified event that moves in the *grant*
direction. It is verified rather than fast-pathed because it is rare, arrives
only after a prior revocation, and carries no reliable signal about whether the
reversal actually restored entitlement — the API answers that directly.

One secondary bug falls out of the same rule: `EXPIRATION` currently revokes
blind, so a resubscribe whose old `EXPIRATION` lands after the new
`INITIAL_PURCHASE` wrongly strips a paying customer until the next `RENEWAL`.

### `SUBSCRIPTION_PAUSED` is deliberately left alone

It is **Google Play only** — RevenueCat's event table marks it ✅ Google Play,
❌ App Store, ❌ Amazon, ❌ Stripe, ❌ Promo, ❌ Roku, ❌ RevenueCat Billing.
Apple has no consumer subscription-pause feature; its off-ramp is the
cancellation retention offer, already configured in Customer Center. Capsule is
iOS-only with no Play Store submission, so **this event cannot fire today.**

It stays in `REVOKE` as a blind revoke. That is knowingly wrong for Google Play
— a pause is only *scheduled* at the event, and the customer keeps access until
the current period actually ends — but it is unreachable code here, and this
change stays scoped to the refund hole rather than pre-building for a platform
that hasn't shipped.

**For the Android phase:** move `SUBSCRIPTION_PAUSED` from `REVOKE` into the
verified set. This is a deliberate deferral, not an oversight.

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

Pro is active iff an item with `entitlement_id === 'entl2d972407b4'` is present.

### ⚠️ The two surfaces use different identifiers for the same entitlement

Confirmed live (probe, 2026-07-29) — v2 `active_entitlements` returns the
RevenueCat **object id**, not the lookup key:

```json
{"items":[{"entitlement_id":"entl2d972407b4",
           "expires_at":1785339831934,
           "object":"customer.active_entitlement"}]}
```

| Surface | Identifier | Value |
|---|---|---|
| Webhook payload `event.entitlement_ids` | lookup key | `Capsule Pro` |
| v2 REST `active_entitlements[].entitlement_id` | object id | `entl2d972407b4` |

The existing `PRO_ENTITLEMENT_ID = 'Capsule Pro'` is correct for the webhook
filter and **must not** be reused for the API check. Comparing the API response
against `'Capsule Pro'` never matches, so every verification would report
"not active" and every `CANCELLATION` and `EXPIRATION` would revoke Pro from
**every paying customer** — strictly worse than the bug being fixed, and
undetectable in this project today because it has no purchases to test against.

Therefore a second, separately-named constant:

```ts
const PRO_ENTITLEMENT_ID = 'Capsule Pro';        // webhook payloads (existing)
const PRO_ENTITLEMENT_OBJECT_ID = 'entl2d972407b4'; // v2 REST responses (new)
const RC_PROJECT_ID = 'proj72b0a2e3';
```

All three are hardcoded constants, matching how `PRO_ENTITLEMENT_ID` is already
handled in this function.

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
   **Must include a regression test asserting the lookup key `'Capsule Pro'`
   does _not_ match** — that is the failure mode described above, and it is the
   one bug in this change that would be invisible in production until the first
   refund of the first real sale.
2. ~~**Response-shape confirmation**~~ — **done 2026-07-29.** Granted
   `Capsule Pro` to the anonymous customer
   `$RCAnonymousID:0ce84de92b2f4314ad2448afe4e1bd2a` with a 10-minute
   `expires_at`, read the shape back, confirmed the object-id finding above.
   An anonymous id was chosen deliberately: it fails the function's existing
   `UUID_RE` guard, so `setTier` cannot write to Supabase *by construction*
   rather than by luck. No revoke endpoint exists at
   `/customers/{id}/entitlements/{eid}/actions/revoke` (404 on every variant
   tried), so cleanup relied on the short `expires_at`; confirmed afterwards
   that the customer's `active_entitlements` is `[]` again.
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

1. ~~Create the V2 read-only key.~~ **Done 2026-07-29** — key issued and
   verified: `200` on
   `GET /v2/projects/proj72b0a2e3/customers/{id}/active_entitlements`, and
   `403 authorization_error` on an attempted entitlement write, confirming it
   carries `customer_information:customers:read` and nothing more.
2. Set it as the Supabase secret `REVENUECAT_API_KEY` **before** deploying —
   the function fails loud (500) when the key is absent.
