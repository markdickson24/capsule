# Payments / Notifications / Cron Audit — 2026-07-22

Scope: monetization (client + server tier gates), RevenueCat webhook, notifications,
cron/edge-function correctness. Read-only review.

**Environment note:** the working tree was on branch `chore/sentry-setup` (post
`feat/capsule-pro-features` merge, PR #57) at audit time — the branch changed
underneath this session mid-task (started on `feat/capsule-link-preview`). The
on-disk `CLAUDE.md` on this branch documents an *earlier* state of monetization
(client-only members/photos/video gates, no `limitSheet.ts`/`ProBadge`/export-ZIP
docs match what's actually present — some of those files/features **do** exist on
disk even though this branch's CLAUDE.md doesn't mention them yet, e.g. `ProBadge`,
capsule export). All findings below are against the actual code/live-DB state at
audit time, verified directly (live Postgres via `execute_sql`, live RevenueCat
config via the RevenueCat API) rather than trusted from either CLAUDE.md snapshot.
Server-side hard gates (`create_capsule_with_owner`, `create_group_with_creator`,
`guard_subscription_tier`, `guard_group_recurrence`, `enforce_member_limit`,
`enforce_photo_limit`) are all live, enabled, and match `src/lib/tierLimits.ts`'s
values (3 active / 10 members / 20 photos free; ∞/50/1000 pro) — these are sound
and were verified against `pg_get_functiondef`/`pg_trigger`, not assumed.

---

## PN-1 — Recurring-group cron permanently bypasses BOTH the active-capsule cap and the members-per-capsule cap for lapsed/downgraded Pro hosts

**Severity:** High
**Category:** Monetization / tier enforcement (server)
**Location:** `supabase/functions/create-group-capsules/index.ts` (`processGroup`, lines ~169–277); `enforce_member_limit()` trigger (live DB); `create_capsule_with_owner` RPC (live DB)

**Description:** Recurring groups (weekly/monthly/yearly) are correctly gated
Pro-only *at creation time* — both `create_group_with_creator` (raises
`GROUP_RECURRENCE_PRO`) and the `guard_group_recurrence` BEFORE UPDATE trigger
block a **free** creator from setting/changing to a real recurrence. Verified live:

```
guard_group_recurrence(): if new.recurrence_interval <> 'manual'
   and new.recurrence_interval is distinct from old.recurrence_interval
   and (select subscription_tier from users where id = old.created_by) = 'free'
then raise exception 'GROUP_RECURRENCE_PRO';
```

This only fires on an *explicit change* to `recurrence_interval`. It does **not**
re-validate on every cron tick. The `create-group-capsules` cron
(`processGroup`) creates the recurring capsule and populates its membership using
the **service-role** client, with no tier check at all:

- No check of the owner's *current* `subscription_tier` before creating the
  capsule — unlike `create_capsule_with_owner`'s `CAPSULE_LIMIT_REACHED` check,
  there is no equivalent "does this owner already have ≥3 (free-cap) active
  capsules" guard anywhere in the cron path.
- The `capsule_members` bulk insert (`processGroup`, line ~245) goes through
  `enforce_member_limit`, but that trigger explicitly exempts non-`authenticated`/`anon`
  callers:
  ```
  if coalesce((select auth.role()), '') not in ('authenticated', 'anon') then
    return new;
  end if;
  ```
  A service-role insert (which is what the cron always uses) always takes this
  early return, so the cap is **never enforced** for cron-created group capsules,
  regardless of how many members the group has.
- `group_members` itself (the group's roster, separate from `capsule_members`)
  has **no row-count trigger or cap at all** — verified via `pg_trigger`/`pg_policies`
  on `public.group_members`: only an `is_group_creator()`-gated INSERT policy,
  no limit. A group can grow to any size regardless of the creator's tier.

**Impact/exploit:** A user subscribes to Capsule Pro, creates one recurring group
(e.g. weekly) with as many members as they like (no cap on group size), lets it
run — then cancels/lets Pro lapse. The RevenueCat webhook correctly flips
`users.subscription_tier` back to `'free'` on `EXPIRATION`, but nothing ever
touches `groups.recurrence_interval` or pauses the schedule. The cron keeps
creating a new capsule every cycle forever, each with **unlimited members**
(no 10-member free cap) and with **no cap on total active capsules** (no
3-active-capsule free cap) — the two most valuable Pro-tier limits are both
fully bypassed, indefinitely, with zero further client action. This is a
straightforward "pay once, keep the recurring engine running for free forever"
path — more severe than a client-side bypass because it requires no ongoing
attacker action at all.

**Suggested fix:** In `processGroup` (or `check_cron_secret`'s caller), before
creating a capsule: (a) check the group creator's live `subscription_tier`; if
`free`, either skip the cycle and set `recurrence_paused_at` (with a
notification explaining why), or downgrade to `manual` and stop auto-creating.
(b) Cap the `capsule_members` insert size to `limitsForTier(ownerTier).membersPerCapsule`
(e.g. truncate/insert only the first N by `joined_at`, matching the free/pro cap)
rather than relying on `enforce_member_limit`, which is designed to be
service-role-exempt by convention. (c) Consider also checking the owner's active
non-unlocked capsule count against `activeCapsules` before creating one more.

**Confidence:** High — verified against live trigger/function definitions and
the actual edge function source; no other mechanism (webhook, additional
trigger, or cron logic) re-asserts these caps anywhere in the recurring-group
path.

---

## PN-2 — RevenueCat webhook has no code-level production/entitlement filter for TRANSFER events; relies entirely on dashboard scoping with no defense-in-depth

**Severity:** Medium
**Category:** Monetization / RevenueCat webhook
**Location:** `supabase/functions/revenuecat-webhook/index.ts` lines 94–116

**Description:** Two related gaps in the webhook handler:

1. **No `event.environment` check anywhere in the code.** Every event type is
   processed regardless of whether it's `SANDBOX` or `PRODUCTION`. The only
   thing preventing a sandbox/Test-Store purchase from flipping a real user to
   `'pro'` is the **RevenueCat dashboard's webhook integration configuration**
   (verified live via the RevenueCat API: `whintgrfc186311f2` is scoped to
   `app_id: app7b40141214` [the real App Store app] and `environment: production`
   only — Test Store app `app3febbe6182` events physically never reach this URL).
   This is real protection today, but the function itself has **zero backstop**:
   if the webhook integration is ever reconfigured, duplicated (e.g. for a
   second RevenueCat app when Android is added — `EXPO_PUBLIC_REVENUECAT_ANDROID_KEY`
   is already a documented near-term addition), or accidentally widened to
   "all environments," there is nothing in the code to catch it.
2. **The `TRANSFER` branch (line 102–112) ignores `touchesPro`/`entitlement_ids`
   entirely** — every other branch (`GRANT`/`REVOKE`) checks `touchesPro` before
   acting, but `TRANSFER` is handled *before* that check and unconditionally
   grants the destination id(s) `'pro'` / revokes the origin id(s) to `'free'`,
   regardless of which entitlement transferred. With only one entitlement
   (`Capsule Pro`) today this is harmless, but the moment a second entitlement
   is added (the monetization roadmap mentions a future `Premium` tier), a
   TRANSFER of the *unrelated* entitlement would incorrectly write
   `subscription_tier` for `Capsule Pro`.

**Impact/exploit:** Not currently exploitable (dashboard scoping + single
entitlement both hold), but both gaps are pure "one misconfiguration or one
new feature away from a real bypass" — the exact kind of hole the "constant-time
compare" / "production-only" hardening elsewhere in this file is meant to close,
and the code doesn't actually implement either check itself.

**Suggested fix:** Add `if (event.environment && event.environment !== 'PRODUCTION') return json({ ok: true, handled: 'ignored (sandbox)' });` near the top (before any branch), and gate the `TRANSFER` branch on `touchesPro` the same way `GRANT`/`REVOKE` already are.

**Confidence:** High on the code gap itself; the exploitability is currently
mitigated by verified dashboard config (checked live, not assumed).

---

## PN-3 — Webhook secret comparison is not constant-time

**Severity:** Low
**Category:** Monetization / RevenueCat webhook
**Location:** `supabase/functions/revenuecat-webhook/index.ts` line 84

**Description:** `if (!expected || provided !== expected) return json({ error: 'Unauthorized' }, 401);` — a plain JS `!==` string comparison, which short-circuits on the first mismatched byte. This is a timing side-channel on the shared webhook secret.

**Impact/exploit:** Timing attacks over a real network HTTP round-trip (plus Deno/V8 JIT noise) are hard to exploit in practice, especially against a UUID-length-plus secret, but it's a trivial fix and the secret is the only thing standing between the internet and forging `subscription_tier` writes for arbitrary users.

**Suggested fix:** Use a constant-time compare (e.g. hash both sides with HMAC/timingSafeEqual equivalent, or `crypto.subtle.timingSafeEqual` via a Web Crypto shim) instead of `!==`.

**Confidence:** High (code is plainly non-constant-time); severity is low because of practical exploitability, not because the pattern is fine.

---

## PN-4 — RevenueCat Test Store key silently used when the production key env var is unset (fail-open, not fail-closed)

**Severity:** Medium
**Category:** Monetization / client purchases module
**Location:** `src/lib/purchases.native.ts` lines 38–47

**Description:**
```ts
const FALLBACK_TEST_KEY = 'test_xwBdHgppptaUJEOdTaPTrluawct';
function apiKey(): string {
  const key = Platform.select({ ios: process.env.EXPO_PUBLIC_REVENUECAT_IOS_KEY, ... });
  return key || FALLBACK_TEST_KEY;
}
```
If `EXPO_PUBLIC_REVENUECAT_IOS_KEY` is unset at build time (misconfigured EAS
secret, forgotten `.env`, etc.), `configurePurchases()` silently configures the
SDK against the **Test Store** app instead of refusing to configure or
surfacing the misconfiguration loudly. Because the RevenueCat webhook
integration is scoped to the production App Store app only (see PN-2), Test
Store "purchases" made this way **never reach the webhook**, so
`users.subscription_tier` never flips to `'pro'` server-side — but the client's
own `isProActive()`/`useEntitlements()` reads Test Store `CustomerInfo` locally
and *would* report `isPro: true`. Any UI that trusts the client value alone
(cosmetic Pro badges, "you're on Pro" copy) would show the user as Pro while
every server-hard gate (active capsules, group recurrence) still treats them as
free — a confusing "I paid and the app says I'm Pro but capsule creation still
says I hit my limit" support ticket, in a shipped production build, with no
error surfaced anywhere except a `console.warn`.

**Impact/exploit:** Not a privilege-escalation vector (thanks to the webhook's
app-scoping — see PN-2), but a real silent-misconfiguration/business-integrity
risk: a production build can ship fully "working" from a QA smoke-test
perspective (paywall renders, "purchase" appears to succeed, `isPro` flips
client-side) while actually running on fake StoreKit-less purchases for every
user, with no build-time or runtime signal beyond a swallowed console warning.

**Suggested fix:** Fail closed instead: if no real key is present, log a loud
warning and skip `Purchases.configure()` entirely (so `isProActive()` and
`presentPaywall()` predictably no-op) rather than silently substituting the
Test Store key. Reserve the Test Store key for explicit local
`EXPO_PUBLIC_REVENUECAT_IOS_KEY=test_...` opt-in, not as a fallback.

**Confidence:** High that the code does this; medium on real-world likelihood
(requires an EAS/env misconfiguration to trigger) — flagged because the
project's own `docs/monetization-strategy.md`/prior audit notes describe
exactly this fallback as something that should fail closed.

---

## PN-5 — `send-superlative-pushes` can duplicate pushes on partial Expo failure (stamps `pushed_at` only after send, not before)

**Severity:** Low
**Category:** Cron / push correctness
**Location:** `supabase/functions/send-superlative-pushes/index.ts` lines 82–107

**Description:** Unlike `unlock-capsules`/`dispatch-capsule-start`/`dispatch-contribution-activity`
(all of which insert their durable `notifications` rows with `pushed_at` already
set *before* attempting the Expo push, so a push failure never causes
re-processing), `send-superlative-pushes` fetches up to 200 **already-existing**
unpushed notification rows, attempts `sendExpoPush(messages)` (no
try/catch, and chunked into ≤100-message requests with no per-chunk error
handling), and only *afterward* runs `.update({ pushed_at })` over all fetched
row ids. If `sendExpoPush` throws partway through (e.g. chunk 2 of 2 fails on a
transient network error after chunk 1 already posted successfully to Expo), the
function's unhandled exception aborts before the `pushed_at` update ever runs.
The next cron tick re-fetches the same rows (still `pushed_at IS NULL`) and
re-sends **all** of them, including the ones from the chunk that already
succeeded — duplicate push notifications for those users.

**Impact/exploit:** Not a security issue — worst case is a user getting the
same "🏆 New award category" / "you won an award" push twice. Annoying, not
harmful.

**Suggested fix:** Wrap `sendExpoPush` in try/catch (matching the other four
cron functions' pattern) and/or stamp `pushed_at` per-chunk immediately after
each successful `fetch`, rather than once at the end for the whole batch.

**Confidence:** High (straightforward code-path read); frequency depends on
transient network failures, which are rare but not implausible over a cron
running every minute indefinitely.

---

## Sound areas (verified, no issues found)

- **`create_capsule_with_owner` / `create_group_with_creator` RPCs** — both
  correctly check the caller's live `subscription_tier` server-side
  (`CAPSULE_LIMIT_REACHED` / `GROUP_RECURRENCE_PRO`), both `SECURITY DEFINER`
  with `search_path = ''`, both do capsule/group + membership insert in one
  transaction (no orphan-row risk). Verified live via `pg_get_functiondef`.
- **`guard_subscription_tier` trigger** — correctly blocks any `authenticated`/`anon`
  write to `users.subscription_tier` on both INSERT and UPDATE (`TIER_READONLY`,
  `42501`), service-role (the webhook) exempted. No client-side path to
  self-grant Pro.
- **Direct `capsules`/`groups` INSERT is impossible** — confirmed zero INSERT
  policies exist on either table (`pg_policies`), so RLS default-deny means the
  RPCs are the *only* creation path; the caps inside them can't be
  side-stepped by a raw insert.
- **`enforce_member_limit` / `enforce_photo_limit` triggers** — correctly
  owner-tier-keyed, correctly `>=` cap comparisons, correctly service-role
  exempt (by design, for the crons that legitimately need to bypass — though
  see PN-1 for where that design choice becomes a real hole for one specific
  cron).
- **`useEntitlements()` loading-state discipline** — `CreateScreen`,
  `CreateGroupScreen` both correctly gate on `!entitlementsLoading && !isPro`
  before firing a client pre-check, avoiding false-gating a genuine Pro user
  on cold start. `CapsuleDetailScreen`'s member/photo/video gates key off a
  fetched `ownerTier` (not the current user's own loading `isPro`), which has
  no equivalent race.
- **Owner-vs-guest gating (`proGateHit`)** — consistently wired: every
  guest-capable gate passes `currentUserIsHost: isOwner`; guests get a toast,
  never a paywall (correct — a guest upgrading can't lift a host-based cap).
- **`PreviewScreen`'s per-capsule photo cap** correctly uses the
  `capsule_media_count` RPC (not a `media(count)` embed, which would read 0
  under surprise-mode RLS and silently defeat the cap) — verified in source.
- **Cron chunking** — `unlock-capsules`, `create-group-capsules`,
  `dispatch-contribution-activity`, `contribution-nudges`, `dispatch-capsule-start`
  all correctly slice Expo push payloads to ≤100 messages per request.
- **Atomic claim-and-stamp idempotency** — verified race-safe (via
  `UPDATE ... WHERE ... IS NULL ... RETURNING` / `DELETE ... RETURNING`
  patterns) in `unlock-capsules` (unlock + all 3 reminder tiers),
  `dispatch-capsule-start`, `dispatch-contribution-activity`,
  `contribution-nudges` (via `claim_contribution_nudge_tier` RPC, confirmed
  `service_role`-only execute grant), and `create-group-capsules`' both the
  capsule-creation claim and the reminder claim (with correct rollback of the
  claim on a downstream insert failure — verified `releaseClaim` restores the
  pre-claim `next_capsule_at`/`last_capsule_at`/`next_reminder_sent_at`).
- **`send-superlative-pushes`' FK-qualified embed** — correctly uses
  `users!notifications_user_id_fkey(push_token)`, avoiding the two-FK
  ambiguity bug the codebase has previously hit (and documented).
- **All pg_cron jobs** — correctly `EXISTS`-gated (verified live via
  `cron.job`), correctly Vault-backed `Authorization` header, correct target
  URLs for all 6 functions in scope.
- **`notifications_type_check` constraint** — live constraint includes every
  type used by every function in scope (`unlock_reminder`, `group_capsule`,
  `group_capsule_upcoming`, `contribution_activity`, `contribution_nudge`,
  `capsule_started`, the three `superlative_*` types, `friend_request`/`friend_accept`) —
  no insert-time constraint-violation risk found.
- **`NotificationsScreen`'s "mark all read"** — correctly excludes `invite`
  and `friend_request` types (`.neq('type','invite').neq('type','friend_request')`),
  so it can't orphan a pending invite/request, matching documented behavior.
- **Push-token protection** — all six edge functions in scope use the
  service-role client to read `users.push_token`; no client-reachable path
  reads another user's token (column-level grant revocation confirmed
  unaffected by this audit's changes).

---

## Summary of caveats

- This audit was conducted against whatever was checked out on disk at the
  time each file was read (`chore/sentry-setup`), cross-verified against the
  **live** Supabase project (`ezxxvvmesegegkdeniri`) and the **live** RevenueCat
  project (`proj72b0a2e3`) rather than either CLAUDE.md snapshot, since the
  two snapshots available during this session (system-prompt vs. on-disk)
  described materially different implementations of the same features. Findings
  reflect the actual deployed/checked-out state, not a specific branch's docs.
