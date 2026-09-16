---
paths:
  - "src/lib/purchases*"
  - "src/lib/tierLimits.ts"
  - "src/lib/proGate.ts"
  - "src/lib/limitSheet.ts"
  - "src/lib/exportCapsule*"
  - "src/hooks/useEntitlements.ts"
  - "src/hooks/useRevenueCat.ts"
  - "src/components/ProBadge.tsx"
  - "src/components/LimitSheet.tsx"
  - "src/components/ExportProgressModal.tsx"
  - "supabase/functions/revenuecat-webhook/**"
  - "supabase/migrations/**"
  - "src/screens/app/SettingsScreen.tsx"
  - "src/screens/app/PreviewScreen.tsx"
  - "src/screens/app/CreateScreen.tsx"
  - "src/screens/app/CreateGroupScreen.tsx"
  - "docs/monetization-strategy.md"
---

<!-- Trimmed from the original CLAUDE.md; backstory kept in HTML comments. Loads automatically when Claude reads a file matching `paths`. -->

## Monetization (RevenueCat)

Full strategy/pricing rationale: `docs/monetization-strategy.md`. This covers the shipped plumbing for the single paid tier, **Capsule Pro** (not the roadmap — Event Pass, Premium, etc. aren't built). **Tier copy never promises full-res/original-quality media or filters** — every photo is resized to 1920px for everyone; Pro adds capacity (caps below) and bulk **download** (ZIP export), never higher per-photo quality.

### Client stack
- **`src/lib/purchases.{native,web,ts}`** — sole module talking to the RevenueCat SDK (same `.native.ts`/`.web.ts`/`.ts` split idiom as `usePushNotifications`/`useShareIntent`). `PRO_ENTITLEMENT_ID = 'Capsule Pro'` must match the RevenueCat dashboard entitlement exactly (case-sensitive) or `isProActive()` is always false.
  - `configurePurchases()` — idempotent, configures SDK anonymously. `identifyUser(userId)`/`resetUser()` — `Purchases.logIn`/`logOut`, ties the RC app-user id to the Supabase user id (needed for the webhook to map purchases, and for Pro to follow across devices).
  - `presentPaywall()`/`presentProPaywallIfNeeded()` — RC-hosted paywall (dashboard Paywall AI Editor, `default` offering). `presentCustomerCenter()` — manage/cancel/restore UI (Settings' "Manage Subscription").
  - `purchasePackage(pkg)`/`restorePurchases()` — unused escape hatches for a custom paywall.
  - **Client-side entitlement checks are UI-only** — the real gate is server-side; never trust `isProActive()`/`isPro` for anything bypassable.
- **`useRevenueCat(userId?)`** (`src/hooks/useRevenueCat.ts`) — called once from `App.tsx` (`useRevenueCat(session?.user.id)`); configures SDK on mount, `identifyUser`/`resetUser` on user id change — mirrors `usePushNotifications`.
- **`useEntitlements()`** (`src/hooks/useEntitlements.ts`) — returns `{ isPro, loading, customerInfo, refresh }`; subscribes to the SDK's update listener so any screen reflects a purchase made elsewhere with no manual refetch.
  - ⚠️ **`isPro` resolves from BOTH RevenueCat AND `users.subscription_tier`** (`resolveIsPro()` in `tierLimits.ts`) — either source alone grants Pro, neither vetoes the other. RC-only reads showed the free UI to genuinely-Pro users whenever the two diverged (comps/support grants, a failed `getCustomerInfo()`, a `logIn()` that never landed, or web where the SDK stub always reports false). DB tier cached under `tier:${userId}` (5min TTL), read via `sessionStore` + single-column select (`users` grant is column-level; `*` would 42501). A null/unreadable tier is "no signal," never a revocation — no weaker than trusting the SDK, since `guard_subscription_tier` makes the column server-writable only.
  - ⚠️ **`loading` means "don't act yet," not just "still fetching."** Stays true while either source is pending or neither could answer — `isPro` can't express "unknown," so a failed fetch must not look like a confirmed free account. Tri-state lives in `entitlementsResolved(rcState, dbState)` (pure, tested). Failures retry with backoff (`RETRY_DELAYS_MS`), re-attempt on `AppState` foreground. `purchasesSupported` (false on web) marks "no opinion" so web resolves on the DB alone without waiting out retries.

### Server-side gate
**`supabase/functions/revenuecat-webhook`** — actual source of truth. Maps `event.type` to a `users.subscription_tier` write (`'free'`|`'pro'`):
- **Auth is a shared secret, not `CRON_SECRET`** — compares the `Authorization` header against `REVENUECAT_WEBHOOK_SECRET` (constant-time), fails closed (401) if either side unset/mismatched. `verify_jwt: false` (RC sends no Supabase JWT).
- **Production-only** — ignores any event with `event.environment` present and not `PRODUCTION` (`ignored (<env>)`); the dashboard webhook integration (`whintgrfc186311f2`) is also scoped to the production App Store app (`app7b40141214`) + `production` env — defense in depth.
- `event.app_user_id` is the Supabase `users.id` UUID (`identifyUser()` always logs in with it); a regex guards against writing to anonymous RC ids (`$RCAnonymousID:...`).
- **GRANT set** (`INITIAL_PURCHASE`, `RENEWAL`, `UNCANCELLATION`, `PRODUCT_CHANGE`, `NON_RENEWING_PURCHASE` [lifetime], `SUBSCRIPTION_EXTENDED`) → `'pro'`, from event type alone, no RC API call. **REVOKE set** (`SUBSCRIPTION_PAUSED`) → `'free'`, also blind.
- **`TRANSFER` is a VERIFY event, not a blind write.** `app_user_id` is entirely client-asserted (`Purchases.logIn(<arbitrary string>)` with the public SDK key in the bundle), so a `TRANSFER` naming a real customer in `transferred_from` isn't evidence they lost anything. Every id on both `transferred_to`/`transferred_from` is checked against the RC API and mirrored; sits below the `touchesPro` filter. Verification failure leaves the tier untouched, returns 500 for retry — never a guess.
  <!-- History: used to grant/revoke blind from the payload, which was forgeable via the public SDK key. -->
- **VERIFY set** (`CANCELLATION`, `EXPIRATION`, `REFUND_REVERSED`) — calls `GET /v2/projects/proj72b0a2e3/customers/{id}/active_entitlements` with the read-only `REVENUECAT_API_KEY` and mirrors what RC reports, rather than inferring from event type. A refund arrives as `CANCELLATION` with `cancellation_reason: CUSTOMER_SUPPORT`; a refunded lifetime purchase has no `EXPIRATION` event, so `EXPIRATION` must verify too (else a resubscribe's late `EXPIRATION` could strip a paying customer). `BILLING_ISSUE` stays a plain no-op (grace period = still entitled).
  <!-- History: treating refund-CANCELLATION as a no-op let refunded customers, including lifetime purchases, keep Pro permanently. -->
- ⚠️ **The two surfaces use different identifiers for the same entitlement.** Webhook payloads carry the lookup key (`'Capsule Pro'`, matched against `event.entitlement_ids`); the v2 REST API returns the object id (`'entl2d972407b4'`) in `active_entitlements[].entitlement_id`. Two constants in `entitlements.ts` — comparing an API response against the lookup key never matches and would revoke Pro from every paying customer.
- ⚠️ **Never delete/recreate the `Capsule Pro` entitlement in the RC dashboard without updating `PRO_ENTITLEMENT_OBJECT_ID`** — a recreated entitlement gets a new object id while the lookup key stays the same; an unnoticed mismatch makes every VERIFY comparison report "not active" and revokes Pro from every paying customer.
- ⚠️ **Never guess a tier.** Any verification failure (unset key, non-2xx, malformed body) leaves `subscription_tier` untouched and returns 500 (RC retries 5x over ~2.5h). `isProActive` throws rather than returning false on a malformed body so it can't be mistaken for "no entitlement."
- ⚠️ **`SUBSCRIPTION_PAUSED` is still a blind revoke** — Google Play only (Apple has no consumer pause), can't fire on iOS. When Android ships, move it to the VERIFY set (a pause is only *scheduled* at the event; access continues until the period ends).
- ⚠️ **Comp grants aren't protected.** A tier set by direct DB write with no purchase behind it (App Store reviewer account, support grants) is revoked if a VERIFY event ever fires for that `app_user_id`. Not reachable without RC purchase/cancellation activity on that account, but comp accounts must never be used as webhook test targets — production holds two comp-Pro accounts by direct DB write, one the App Store reviewer account. **Pre-submission checklist: confirm the reviewer account's `subscription_tier` is still `'pro'`**, alongside re-arming its countdown capsule.
- Feature gates read `users.subscription_tier` (server-side, un-bypassable) for the hard gates; client mirrors the same limits for UX — see "Tier enforcement".

### Post-unlock upsell
`CapsuleDetailScreen` shows a dismissible nudge (not an auto-popped paywall) to a non-Pro owner once their capsule unlocks ("Keep it forever with Pro" → `presentPaywall()`). Dismissal persists per-capsule via AsyncStorage (`cap_pro_nudge_dismissed:<capsuleId>`), native-only.

### Pro status badge
**`<ProBadge size?: 'sm'|'md'>`** (`src/components/ProBadge.tsx`) — decorative "PRO" pill, no data prop. Each call site fetches the subject's own tier and decides whether to render: own `ProfileScreen` (`isPro` from `useEntitlements()`, `size="md"`), `PublicProfileScreen` (`profile.subscription_tier === 'pro'`, `size="md"`), `HomeScreen` cards next to the owner (`capsule.owner.subscription_tier === 'pro'`, via the `owner:users!capsules_owner_id_fkey(...)` embed), `CapsuleDetailScreen`'s members sheet (`m.role === 'owner' && ownerTier === 'pro'`). Canonical "PRO" pill everywhere — e.g. `SettingsScreen`'s locked "Custom color & gradient themes" row renders `<ProBadge>`. Wrapper `View` sets `accessible` so VoiceOver reads "Capsule Pro" as one element.

### Capsule export (ZIP)
Owner-only, owner-Pro, unlocked-capsules-only. Entry point gated on `isOwner && capsule.status === 'unlocked' && isExportSupported() && photos.length > 0`; non-Pro owner tap runs the same `proGateHit` limit-sheet as every other gate.
- **`src/lib/exportCapsule.{native,web,ts}`** — same platform-split idiom. `exportCapsule({ title, items, onProgress, shouldCancel? })` downloads each signed URL and zips. `shouldCancel` polled at each file boundary; returning true throws an error whose message is `EXPORT_CANCELLED` (`'export-cancelled'`), which `CapsuleDetailScreen.handleExport` treats as a cancel (toast "Export canceled.").
  - **Native**: `react-native-zip-archive`, streams each file into a temp `FileSystem.cacheDirectory` dir first (never through the JS bridge as one buffer), zips the dir, then shares the `.zip` via `expo-sharing`. Needs a full dev/EAS build (absent in Expo Go). `isExportSupported()` eagerly probes `TurboModuleRegistry`/`NativeModules` for `RNZipArchive` (a bare `require()` isn't enough — same gotcha as `modules/expo-dual-camera`), so the button is hidden rather than shown-then-crashing when unlinked.
  - **Web**: zips in-memory via `fflate`, triggers a browser download; `buildZipBlobParts` is exported from the native module too for signature parity but throws there.
- **`src/components/ExportProgressModal.tsx`** — `{ visible, done, total, onCancel? }` progress modal; renders a progress bar + `done/total` and a Cancel button wired to `shouldCancel`.

### RevenueCat dashboard configuration
Project `proj72b0a2e3`. Entitlement `entl2d972407b4` (lookup key `Capsule Pro`). Offering `default` (`$rc_monthly`/`$rc_annual`/`$rc_lifetime` packages → products `monthly`/`yearly`/`lifetime`), published dashboard-built paywall attached.

**Two RevenueCat apps, same products/offering/entitlement shared:**
- **Test Store** (`app3febbe6182`) — fake purchases, no real StoreKit. No fallback key baked into `purchases.native.ts` (`FALLBACK_TEST_KEY` removed) — `configurePurchases()` fails closed (warns + disables purchases) when no real key is set, so a release build can't silently run on the shared test key. Use its `test_...` key via `EXPO_PUBLIC_REVENUECAT_IOS_KEY` locally. Webhook is production-only, so Test Store purchases no longer flip `subscription_tier` — verify that pipeline via a real production sandbox purchase or a direct service_role DB write.
- **Capsule iOS** (`app7b40141214`) — real App Store app, connected via an ASC API key (Key ID + Issuer ID + `.p8`, dashboard-only). Public SDK key goes in `EXPO_PUBLIC_REVENUECAT_IOS_KEY` (`.env` locally, EAS production secret via `eas env:create`).

**Real pricing** (monthly $4.99, yearly $39.99, lifetime $79.99, ~180-territory equalization) is live in ASC. ⚠️ **Blocker:** real purchases fail until Apple's one-time rule clears — the first-ever IAP/subscription for an app must be submitted attached to an app version through ASC's UI, not any API (attach `monthly`/`yearly`/`lifetime` on a version → submit for review). Until then only the Test Store key works; after that first approval, all three products are fully manageable via RC's API/dashboard.

- `monthly`/`yearly` are auto-renewable subscriptions inside the "Capsule Membership" group; `lifetime` is a separate non-renewing IAP, not a group member. Apple rejects a new subscription group's first submission unless an auto-renewable subscription from it (`monthly`/`yearly`) is attached to the same version — `lifetime` alone doesn't satisfy this.
- Adding the subscription GROUP to "Items Ready to Submit" ≠ adding a PRODUCT from it (ASC doesn't say so explicitly) — the group can sit there alone with "Unable to Submit for Review" still showing. Fix: expand the collapsed "Subscriptions (N)" row and add `monthly`/`yearly` individually.

### Tier enforcement

Free-tier caps from `docs/monetization-strategy.md`, enforced. All limits in **`src/lib/tierLimits.ts`** — `TIER_LIMITS: Record<Tier, TierLimits>` (`Tier = 'free' | 'pro'`, extensible to `'premium'`), `limitsForTier(tier)` (unknown/null → `free`, fail-safe), `tierFromIsPro(isPro)`. Values — free: `{ activeCapsules: 3, membersPerCapsule: 10, photosPerCapsule: 20, videoSeconds: 30 }`; pro: `{ Infinity, 50, 1000, 120 }`. **Never hardcode a limit elsewhere** — the `3` is also inlined in `create_capsule_with_owner` (SQL can't import TS) with a sync-comment; keep both in step.

**All caps key off the capsule OWNER's tier, never the acting user's** (monetize the host, guests never pay) — a Pro host unlocks video length + higher caps for every member incl. free guests. Owner tier reaches the client via `owner:users!capsules_owner_id_fkey(subscription_tier)` on the capsule fetch (`CapsuleDetailScreen` exposes `ownerTier`; `subscription_tier` is client-readable).

**Owner-vs-guest rule** — centralized in **`src/lib/proGate.ts`**: `proGateHit({ currentUserIsHost, guestMessage, title?, ownerMessage? })` → host sees the limit sheet with "Upgrade to Capsule Pro" (→ `presentPaywall()`) + "Not now"; guest sees the same sheet explain-only ("Got it"), never an upgrade (wouldn't lift a host-based cap). Every guest-capable gate passes `currentUserIsHost: isOwner`; create-time gates (capsules, groups) always pass `true`. Sheet: `src/lib/limitSheet.ts` + `<LimitSheetHost>` (mirrors `toast`/`ToastHost`); `proGateHit` drives it instead of jumping to the native paywall or a bare toast.

**The five gates:**
- **Active capsules** (3 → ∞): server-hard in `create_capsule_with_owner` (`CAPSULE_LIMIT_REACHED` for a free host owning 3 non-unlocked capsules) + client pre-check in `CreateScreen`/`OnboardingScreen`.
- **Recurring groups** (manual-only → any recurrence): server-hard in `create_group_with_creator` (`GROUP_RECURRENCE_PRO`) + client gate in `CreateGroupScreen` (`createGroup` threads the error code out).
- **Members/capsule** (10 → 50): server-hard via `enforce_member_limit` trigger (owner-tier keyed, `MEMBER_LIMIT_REACHED`, covers every join path incl. QR/deep-link) + client pre-check in `InviteModal` (owner→paywall / guest→toast) + `NotificationsScreen` accept path (guest→toast, stays pending; count excludes the accepting user's own pending row to avoid a self-count deadlock).
- **Photos/capsule** (20 → 1000): server-hard via `enforce_photo_limit` trigger (owner-tier keyed, `PHOTO_LIMIT_REACHED`) + client pre-check at upload enqueue. `CapsuleDetailScreen` blocks the whole batch using `mediaCount` (fed by `capsule_media_count` RPC); `PreviewScreen` skips only over-cap targets and **must use `capsule_media_count` per selected capsule, not a `media(count)` embed** — the `media` SELECT RLS hides rows under surprise mode, so an embed count reads 0 and defeats the cap.
- **Video length** (30s → 120s): client-only (duration not stored server-side). Enforced at post time on `PreviewScreen`, not capture — camera records up to the flat 120s max for everyone, library no longer drops over-cap clips; both hand the full clip to Preview via `PendingMedia.durationMs`. At "Add to Capsule", Preview computes the strictest `videoSeconds` across selected targets and for any over-cap video shows the limit sheet: **Trim to first Ns & post** (everyone), **Upgrade** (owner of strictest target only), **Skip these**, or **Cancel** (clip intact). Trim uses `trimVideo()` in `modules/expo-video-stitcher`. Share-intent videos get a real `durationMs` via `probeVideoDurationMs()` (`src/lib/mediaDuration.ts`, `expo-video`) so they're gated too; `CreateScreen`'s `pendingMedia` empty-state path silently trims over-cap videos to the new owner's cap + toasts. Unprobeable `durationMs` stays fail-open.

**Entitlements-loading rule:** `useEntitlements()` starts `{ isPro: false, loading: true }` until genuinely resolved. Any gate reading the current user's own `isPro` must not fire while `loading` — gate on `!entitlementsLoading && !isPro`, never `!isPro` alone, or a genuine Pro user gets false-gated. Gates reading a fetched `ownerTier` have no such race.

**Every current-user gate must honor it, per its failure mode:**

| Site | Guard | Why |
|---|---|---|
| `CreateScreen` capsule-count pre-check | skip the pre-check | falls through to the RPC, which knows the true tier |
| `CreateGroupScreen` recurrence | skip the pre-check | `GROUP_RECURRENCE_PRO` decides |
| `CreateScreen` video trim | fail open to the Pro cap | trimming on a guess is irreversible loss; no server backstop |
| `SettingsScreen` Capsule Pro section | render nothing | would pitch an upgrade to an existing subscriber |
| `SettingsScreen` custom color / gradients | render neither branch | locked row asserts the user lacks Pro; presets stay available |
| `CapsuleDetailScreen` post-unlock upsell | hide the nudge | same mis-sell risk |

⚠️ A new gate reading the current user's own `isPro` must pick one of these — treating `!isPro` as "free" is the bug this table prevents.

**Server-enforced, not cosmetic.** `subscription_tier` is un-forgeable: `guard_subscription_tier` trigger lets only `service_role` write it. Capsule/group creation is RPC-only (direct `"Owners can insert capsules"`/`"Creator can insert groups"` INSERT policies dropped — `20260721140000_payment_security_gates_a.sql`). Members/photos backstopped by `enforce_member_limit`/`enforce_photo_limit` (`20260721140100_payment_security_gates_b.sql`). All migrations verified live on prod with rolled-back fixtures.

**Accepted limitations:** video length stays client-only (bypassable by a modified client); photo/member pre-checks fail-open on a transient count-query error, but the `enforce_*` triggers are the un-bypassable floor underneath.
