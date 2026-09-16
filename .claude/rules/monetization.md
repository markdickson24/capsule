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

<!-- Moved verbatim from CLAUDE.md. Loads automatically when Claude reads a file matching `paths`. -->

## Monetization (RevenueCat)

Full strategy/pricing rationale lives in `docs/monetization-strategy.md`. This section covers the shipped plumbing — a single paid tier, **Capsule Pro** — not the roadmap (Event Pass, Premium, etc. are not built). **Tier copy never promises full-res/original-quality media or filters** — every photo is resized to 1920px for everyone regardless of tier (see "Image Loading"/upload pipeline); what Pro actually adds around media is capacity (caps below) and bulk **download** (ZIP export, below), never higher per-photo quality.

### Client stack
- **`src/lib/purchases.{native,web,ts}`** — the only module that talks to the RevenueCat SDK; every call site goes through it so the SDK is configured exactly once and the entitlement id lives in one place. Same platform-split idiom as `usePushNotifications`/`useShareIntent` (`.native.ts` real impl, `.web.ts` no-op stub, bare `.ts` re-exports the web stub for TS resolution). `PRO_ENTITLEMENT_ID = 'Capsule Pro'` — must match the RevenueCat dashboard entitlement **exactly** (case-sensitive) or `isProActive()` is always false.
  - `configurePurchases()` — idempotent, configures the SDK anonymously. `identifyUser(userId)` / `resetUser()` — `Purchases.logIn`/`logOut`, tie the RevenueCat app-user id to the Supabase user id (needed for the webhook below to map purchases back to a row, and for Pro to follow a user across devices/reinstalls).
  - `presentPaywall()` / `presentProPaywallIfNeeded()` — the RevenueCat-hosted paywall (built in the dashboard's Paywall AI Editor, attached to the `default` offering). `presentCustomerCenter()` — the drop-in manage/cancel/restore UI, wired to Settings' "Manage Subscription" row.
  - `purchasePackage(pkg)` / `restorePurchases()` — escape hatches for a fully custom paywall; not currently used (the hosted paywall covers both screens that need it).
  - **Client-side entitlement checks are UI-only.** The real gate is server-side (see webhook below) — never trust `isProActive()`/`isPro` for anything a malicious client could bypass.
- **`useRevenueCat(userId?)`** (`src/hooks/useRevenueCat.ts`) — called once from `App.tsx` (`useRevenueCat(session?.user.id)`, alongside `usePushNotifications`). Configures the SDK on mount, then `identifyUser`/`resetUser` whenever the signed-in user id appears/changes/disappears — mirrors `usePushNotifications`'s lifecycle exactly.
- **`useEntitlements()`** (`src/hooks/useEntitlements.ts`) — returns `{ isPro, loading, customerInfo, refresh }`. Reads `CustomerInfo` on mount and subscribes to the SDK's update listener (fires on purchase/restore/renewal/expiry), so any screen using this hook reflects a paywall purchase made anywhere else in the app with no manual refetch.
  ⚠️ **`isPro` resolves from BOTH RevenueCat AND `users.subscription_tier`** (`resolveIsPro()` in `tierLimits.ts`) — **either source alone grants Pro; neither may veto the other.** Reading only RevenueCat (the original behavior) showed the *free* UI to genuinely-Pro users whenever the two diverged, paywalling them out of custom colors, recurring groups, extra capsules and long video. Divergence is normal, not exotic: a tier granted server-side with no purchase behind it (comps, support grants, the App Store reviewer account), a `getCustomerInfo()` failure at cold start, a `logIn()` that never landed so the entitlement stayed on the anonymous customer, or **web**, where the SDK stub always reports false. The DB tier is cached under `tier:${userId}` (5min TTL) and read with `sessionStore` + a single-column select (`users` has a column-level SELECT grant — widening to `*` would 42501 the whole query). A null/unreadable tier is "no signal", never a revocation. Trusting the column client-side is no weaker than trusting the SDK: `guard_subscription_tier` makes it server-writable only, and this is UI-only either way.
  ⚠️ **`loading` means "don't act yet", not merely "still fetching".** It stays true while either source is pending **and** when neither source could answer at all. `isPro` is a boolean and can't express "we don't know", so a failed fetch would otherwise be indistinguishable from a confirmed free account — which is exactly how a cold-start network blip paywalls a paying customer. The tri-state lives in `entitlementsResolved(rcState, dbState)` (pure, tested): nothing pending, and at least one source actually answered. Failures retry with backoff (`RETRY_DELAYS_MS`), and an unresolved state re-attempts on `AppState` foreground, so a transient failure self-heals instead of sticking for the session. `purchasesSupported` (false on web) marks the SDK as having *no opinion* rather than having failed, so web resolves on the DB alone without waiting out the retries.

### Server-side gate
**`supabase/functions/revenuecat-webhook`** — the actual source of truth. RevenueCat POSTs entitlement lifecycle events here; the function maps `event.type` to a `users.subscription_tier` write (`'free'` | `'pro'`, the pre-existing column — see Database Schema):
- **Auth is a shared secret**, not `CRON_SECRET` — RevenueCat sends the value configured as the webhook's "Authorization header" verbatim; the function compares it against the `REVENUECAT_WEBHOOK_SECRET` Edge Function secret (**constant-time compare**) and fails closed (401) if either side is unset/mismatched. Deployed with `verify_jwt: false` (RevenueCat doesn't send a Supabase JWT).
- **Production-only.** The function ignores any event whose `event.environment` is present and not `PRODUCTION` (returns `ignored (<env>)`), so a Test Store / sandbox purchase can never mirror real Pro. The dashboard webhook integration (`whintgrfc186311f2`) is *also* scoped to the production App Store app (`app7b40141214`) + `production` environment, so those events don't even reach the function — defense-in-depth on top of the code filter.
- `event.app_user_id` is the Supabase `users.id` UUID, because `identifyUser()` always logs the client in with that id — a regex guards against writing to anonymous RevenueCat ids (`$RCAnonymousID:...`) if one ever leaks through.
- **GRANT set** (`INITIAL_PURCHASE`, `RENEWAL`, `UNCANCELLATION`, `PRODUCT_CHANGE`, `NON_RENEWING_PURCHASE` [lifetime], `SUBSCRIPTION_EXTENDED`) → `'pro'`, interpreted from the event type alone — no RC API call. **REVOKE set** (`SUBSCRIPTION_PAUSED`) → `'free'`, also blind. **`TRANSFER` is a VERIFY event, not a blind write.** ⚠️ It used to grant every id in `transferred_to` and revoke every id in `transferred_from` straight from the payload. But `app_user_id` is **entirely client-asserted** — `identifyUser` is `Purchases.logIn(<arbitrary string>)` with the public SDK key shipped in the bundle — so a `TRANSFER` naming a real customer in `transferred_from` is not evidence that customer lost anything, and `subscription_tier` is the un-forgeable server gate behind the capsule/member/photo/recurrence caps. Every id on **both** sides is now checked against the RevenueCat API and the answer mirrored, and the branch sits below the `touchesPro` filter. A verification failure leaves the tier untouched and returns 500 for retry — never a guess.
- **VERIFY set** (`CANCELLATION`, `EXPIRATION`, `REFUND_REVERSED`) does not infer
  anything from the event type: it calls
  `GET /v2/projects/proj72b0a2e3/customers/{id}/active_entitlements` with the
  read-only `REVENUECAT_API_KEY` secret and mirrors whatever RevenueCat reports.
  A **refund** arrives as `CANCELLATION` with `cancellation_reason:
  CUSTOMER_SUPPORT`; treating that as a no-op meant a refunded customer kept Pro,
  and a refunded **lifetime** purchase has **no `EXPIRATION` event** to ever
  clean it up, so it kept Pro *permanently*. `EXPIRATION` verifies too, so a
  resubscribe whose old `EXPIRATION` lands after the new `INITIAL_PURCHASE`
  can't strip a paying customer. `BILLING_ISSUE` is still a plain no-op (grace
  period = still entitled).
  ⚠️ **The two surfaces use different identifiers for the same entitlement.**
  Webhook payloads carry the **lookup key** (`'Capsule Pro'`, matched against
  `event.entitlement_ids`); the v2 REST API returns the **object id**
  (`'entl2d972407b4'`) in `active_entitlements[].entitlement_id`. Hence two
  constants in `entitlements.ts`. Comparing an API response against the lookup
  key never matches, so every verification would report "not active" and revoke
  Pro from **every paying customer** — strictly worse than the bug this fixed,
  and invisible in a project with no purchases to test against.
  ⚠️ **Never delete/recreate the `Capsule Pro` entitlement in the RevenueCat
  dashboard without updating `PRO_ENTITLEMENT_OBJECT_ID`.** A recreated
  entitlement gets a new object id — the lookup key (`'Capsule Pro'`) can stay
  identical while the object id silently changes underneath it. The existing
  regression test only guards against the lookup-key-vs-object-id mixup above;
  it does not catch a changed object id, since that's an external RevenueCat
  state change, not a code change. If it happens unnoticed, every VERIFY
  comparison reports "not active" and every `CANCELLATION`/`EXPIRATION` revokes
  Pro from every paying customer — the same failure mode as the mismatch above,
  triggered externally instead of in code.
  ⚠️ **Never guess a tier.** Any verification failure (unset key, non-2xx,
  malformed body) leaves `subscription_tier` untouched and returns **500** so
  RevenueCat retries (5 attempts over ~2.5h). `isProActive` *throws* rather than
  returning false on a malformed body precisely so a bad response can't be
  mistaken for "no entitlement" and silently revoke a paying customer.
  ⚠️ **`SUBSCRIPTION_PAUSED` is still a blind revoke** — it's **Google Play only**
  (Apple has no consumer pause), so it can't fire on iOS. When Android ships,
  move it into the VERIFY set: a pause is only *scheduled* at the event and the
  customer keeps access until the period actually ends.
  ⚠️ **Comp grants are not protected — and this change widened that surface.**
  A tier set by direct DB write with no purchase behind it (the App Store
  reviewer account, support grants) would be revoked if a VERIFY event ever
  fired for that `app_user_id`, since RevenueCat correctly reports no
  entitlement. Before this change, only `EXPIRATION` (a subscription-only
  event) could do that; verifying `CANCELLATION` too means a comp account with
  *any* RevenueCat purchase/cancellation activity is now exposed to this on the
  cancellation path as well, not just at term end. Not reachable without
  RevenueCat purchase activity on that account, but it's why comp accounts
  must never be used as webhook test targets, and why production currently
  holds two comp-Pro accounts by direct DB write, one of which is the App
  Store reviewer account — **the pre-submission checklist should confirm the
  reviewer account's `subscription_tier` is still `'pro'`** before each
  submission, alongside re-arming its countdown capsule.
- Any code that gates a feature by subscription tier reads `users.subscription_tier` (server-side, un-bypassable) for the two hard gates, and the client mirrors the same limits for UX — see "Tier enforcement" below.

### Post-unlock upsell
`CapsuleDetailScreen` shows a dismissible nudge — not an auto-popped paywall, which would step on the reveal moment — to a non-Pro owner once their capsule has unlocked ("Keep it forever with Pro" → `presentPaywall()`). Same visual/dismissal pattern as the existing post-create invite nudge: dismissal persists per-capsule via AsyncStorage (`cap_pro_nudge_dismissed:<capsuleId>`), native-only.

### Pro status badge
**`<ProBadge size?: 'sm'|'md'>`** (`src/components/ProBadge.tsx`) — a small decorative "PRO" pill; it takes no data prop, just `size`. Every call site fetches the *subject's* own tier and decides whether to render it, not the badge itself: own `ProfileScreen` (`isPro` from `useEntitlements()`, `size="md"`), `PublicProfileScreen` (`profile.subscription_tier === 'pro'`, `size="md"`), `HomeScreen` capsule cards next to the **owner** (`capsule.owner.subscription_tier === 'pro'`, via the same `owner:users!capsules_owner_id_fkey(...)` embed the tier gates use), and `CapsuleDetailScreen`'s members sheet next to an owner row (`m.role === 'owner' && ownerTier === 'pro'`). It is also the **canonical "PRO" pill** — `SettingsScreen`'s locked "Custom color & gradient themes" row renders `<ProBadge>` rather than an inline pill, so there's one pill treatment (sparkles + "PRO") everywhere. The wrapper `View` sets `accessible` so VoiceOver reads "Capsule Pro" as one element.

### Capsule export (ZIP)
Owner-only, owner-**Pro**, unlocked-capsules-only — "download your whole capsule" (the actual Pro perk; not a quality upgrade, see the note above). Entry point is an "Export" affordance in `CapsuleDetailScreen`'s Media header, gated on `isOwner && capsule.status === 'unlocked' && isExportSupported() && photos.length > 0`; a non-Pro owner's tap runs the same `proGateHit` limit-sheet pattern as every other tier gate (never jumps straight to the paywall).
- **`src/lib/exportCapsule.{native,web,ts}`** — same platform-split idiom as `usePushNotifications`/`purchases` (`.native`/`.web` real impls, bare `.ts` TS-resolution fallback). `exportCapsule({ title, items, onProgress, shouldCancel? })` downloads each item's signed URL and zips the result. `shouldCancel` is polled at each file boundary (downloads dominate the time); when it returns true the fn throws an error whose message is `EXPORT_CANCELLED` (`'export-cancelled'`), which `CapsuleDetailScreen.handleExport` treats as a user cancel (toasts "Export canceled." instead of a failure).
  - **Native** zips to disk via `react-native-zip-archive`: streams each remote file into a temp `FileSystem.cacheDirectory` working dir first (never through the JS bridge as one buffer — safe for large capsules), zips the dir, then shares the `.zip` via `expo-sharing`. **Needs a full dev/EAS build — the native module is absent in Expo Go.** `isExportSupported()` eagerly probes `TurboModuleRegistry`/`NativeModules` for `RNZipArchive` (a bare `require()` isn't enough proof — the JS wrapper resolves the native module lazily at call time, same gotcha as `modules/expo-dual-camera`'s eager-probe pattern), so the Export button is hidden rather than shown-then-crashing when unlinked.
  - **Web** zips in-memory via `fflate` and triggers a browser download; `buildZipBlobParts` is exported from the native module too (for signature parity) but throws — the native path never needs it.
- **`src/components/ExportProgressModal.tsx`** — a `{ visible, done, total, onCancel? }` progress modal shown while `exportCapsule` runs; renders a progress bar + `done/total` and a **Cancel** button (wired to `shouldCancel` above so a long export is interruptible).

### RevenueCat dashboard configuration
Project `proj72b0a2e3`. Entitlement `entl2d972407b4` (lookup key `Capsule Pro`). Offering `default` (`$rc_monthly` / `$rc_annual` / `$rc_lifetime` packages → products `monthly` / `yearly` / `lifetime`), with a published dashboard-built paywall attached.

**Two RevenueCat apps exist, same products/offering/entitlement shared across both:**
- **Test Store** (`app3febbe6182`) — a separate app for fake purchases with no real StoreKit. **Its key is no longer baked into `purchases.native.ts`** — the `FALLBACK_TEST_KEY` fallback was removed (C2a); `configurePurchases()` now fails closed (warns + disables purchases) when no real key is set, so a release build can never silently run on the shared test key and grant free real Pro. To use the Test Store, put its `test_...` key in `EXPO_PUBLIC_REVENUECAT_IOS_KEY` locally. (Note: the webhook is now scoped to production only, so Test Store purchases no longer flip `subscription_tier` — that pipeline check must use a real production sandbox purchase or a direct service_role DB write.)
- **Capsule iOS** (`app7b40141214`) — the real App Store app, connected to App Store Connect via an ASC API key (Key ID + Issuer ID + `.p8`, configured in the RevenueCat dashboard — not exposed through any RevenueCat API, dashboard-only). Its public SDK key goes in `EXPO_PUBLIC_REVENUECAT_IOS_KEY` (set in `.env` for local dev and as an EAS production secret via `eas env:create`).

**Real product pricing** (monthly $4.99, yearly $39.99, lifetime $79.99, full ~180-territory equalization from the US price) is live in App Store Connect for all three products. **⚠️ Known blocker:** real purchases will fail until Apple's one-time rule clears — *the first-ever In-App Purchase/subscription for an app must be submitted attached to an app version through App Store Connect's UI*, not via any API. Until someone does that (App Store Connect → app version → "In-App Purchases and Subscriptions" → attach `monthly`/`yearly`/`lifetime` → submit the version for review), only the Test Store key produces working purchases. After that first approval, all three products (and any future ones) become fully manageable via RevenueCat's API/dashboard with no further app-version dependency.

⚠️ **`monthly`/`yearly` are auto-renewable subscriptions inside the "Capsule Membership" subscription group; `lifetime` is a separate non-renewing IAP, not a group member.** Apple rejects the first submission of a new subscription group ("New subscription groups must be submitted with an auto-renewable subscription from within that group") unless at least one auto-renewable subscription from that group — `monthly` and/or `yearly` — is attached to the same version submission. Attaching only `lifetime` does not satisfy this; `lifetime` has no such constraint and can ship in the same submission or a later one.

⚠️ **Adding the subscription GROUP to "Items Ready to Submit" is not the same as adding a subscription PRODUCT from it, and ASC doesn't say so explicitly.** The group can sit in the ready-to-submit list on its own with the "Unable to Submit for Review" warning still showing — the group row is a container, not a stand-in for `monthly`/`yearly`. Fix: on the submission screen, expand the collapsed **"Subscriptions (N)"** row (separate from the group row) and add `monthly` and/or `yearly` from there individually. The warning clears once an actual subscription product — not just the group — appears in Items Ready to Submit alongside it.

### Tier enforcement

The free-tier caps from `docs/monetization-strategy.md` are enforced. All limits live in one config, **`src/lib/tierLimits.ts`** — `TIER_LIMITS: Record<Tier, TierLimits>` (`Tier = 'free' | 'pro'`, extensible to `'premium'`), with `limitsForTier(tier)` (unknown/null → `free`, fail-safe) and `tierFromIsPro(isPro)`. Current values — free: `{ activeCapsules: 3, membersPerCapsule: 10, photosPerCapsule: 20, videoSeconds: 30 }`; pro: `{ Infinity, 50, 1000, 120 }`. **Never hardcode a limit elsewhere.** The `3` is also inlined in the `create_capsule_with_owner` RPC (SQL can't import TS) with a sync-comment — keep both in step.

**All caps key off the capsule OWNER's tier, never the acting user's** ("monetize the host, guests never pay"): a Pro host unlocks video length + higher caps for every member of their capsule including free guests. The owner's tier reaches the client via an `owner:users!capsules_owner_id_fkey(subscription_tier)` embed on the capsule fetch (`CapsuleDetailScreen` exposes `ownerTier` in render scope; `subscription_tier` is a client-readable `users` column).

**Owner-vs-guest rule** — centralized in **`src/lib/proGate.ts`**: `proGateHit({ currentUserIsHost, guestMessage, title?, ownerMessage? })` → host sees the smooth **limit sheet** with an "Upgrade to Capsule Pro" action (→ `presentPaywall()`, upgrading lifts the cap) + "Not now"; a **guest** sees the same sheet explain-only ("Got it"), **never an upgrade** (a guest upgrading wouldn't lift a host-based cap). Every guest-capable gate passes `currentUserIsHost: isOwner`; create-time gates (capsules, groups) always pass `true` (the current user is the prospective owner). The sheet itself is `src/lib/limitSheet.ts` + `<LimitSheetHost>` (a global imperative sheet mirroring `toast`/`ToastHost` — see Utilities); `proGateHit` drives it instead of jumping straight to the native paywall or a bare toast.

**The five gates:**
- **Active capsules** (3 → ∞): server-hard in `create_capsule_with_owner` (raises `CAPSULE_LIMIT_REACHED` for a free host owning 3 non-unlocked capsules) + client pre-check in `CreateScreen`/`OnboardingScreen` that shows the paywall and maps that error string.
- **Recurring groups** (manual-only → any recurrence): server-hard in `create_group_with_creator` (raises `GROUP_RECURRENCE_PRO`) + client gate in `CreateGroupScreen` (`createGroup` threads the error code out).
- **Members/capsule** (10 → 50): **server-hard** via the `enforce_member_limit` trigger (owner-tier keyed, `MEMBER_LIMIT_REACHED`, covers every join path incl. QR/deep-link self-join) + client pre-check in `InviteModal` (owner→paywall / guest→toast) + `NotificationsScreen` accept path (guest→toast, stays pending; the count **excludes the accepting user's own pending row** to avoid a self-count deadlock at the boundary).
- **Photos/capsule** (20 → 1000): **server-hard** via the `enforce_photo_limit` trigger (owner-tier keyed, `PHOTO_LIMIT_REACHED`) + client pre-check at upload enqueue. `CapsuleDetailScreen` blocks the whole batch using its `mediaCount` (fed by the `capsule_media_count` RPC); `PreviewScreen` skips only the over-cap targets and **must use `capsule_media_count` per selected capsule, not a `media(count)` embed** — the `media` SELECT RLS hides rows under surprise mode (the default), so an embed count reads 0 and silently defeats the cap. (A backstopped insert rejected after the storage upload orphans that blob — accepted, matches existing cleanup tradeoffs.)
- **Video length** (30s → 120s): client only (duration isn't stored server-side). **Enforced at post time on `PreviewScreen`, not at capture** — the camera records up to the app's flat 120s max for everyone (no free-tier hard-stop; a moment is never cut off mid-capture) and the library no longer drops over-cap clips; both hand the full clip to Preview carrying `PendingMedia.durationMs`. At "Add to Capsule", Preview computes the strictest `videoSeconds` across selected targets and, for any over-cap video, shows the limit sheet with **Trim to first Ns & post** (offered to *everyone* — trimming complies with the host cap, it doesn't bypass it), **Upgrade** (owner of the strictest target only), **Skip these**, or **Cancel** (dismiss → stays on Preview, clip intact — nothing is ever silently discarded). Trim uses the native **`trimVideo()`** in `modules/expo-video-stitcher`. Two other paths also enforce it now: **share-intent videos** get a real `durationMs` via `probeVideoDurationMs()` (`src/lib/mediaDuration.ts`, backed by `expo-video`) so they're gated on Preview instead of fail-open; and the **`CreateScreen` `pendingMedia`** empty-state path (which enqueues directly, bypassing Preview) silently trims over-cap videos to the new capsule owner's cap + toasts. A `durationMs` that's still unknown after probing (genuinely unprobeable) stays fail-open.

**Entitlements-loading rule:** `useEntitlements()` starts `{ isPro: false, loading: true }` and stays that way until the tier is genuinely resolved (see the tri-state above — including the "neither source could answer" case). Any client gate that reads the current user's own `isPro` must **not** fire while `loading` — gate on `!entitlementsLoading && !isPro`, never on `!isPro` alone. Otherwise a genuine Pro user is false-gated. Gates that read a fetched `ownerTier` (members, photos, Preview's video cap) have no such race.

**Every current-user gate now honors it, and each does so in the way its failure mode demands:**

| Site | Guard | Why that shape |
|---|---|---|
| `CreateScreen` capsule-count pre-check | skip the pre-check | falls through to the RPC, which knows the true tier |
| `CreateGroupScreen` recurrence | skip the pre-check | same — `GROUP_RECURRENCE_PRO` decides |
| `CreateScreen` video trim | **fail open to the Pro cap** | trimming on a guess is irreversible loss for a paying user; video length has no server backstop, so the worst case is one long clip from a free user |
| `SettingsScreen` Capsule Pro section | render nothing | would otherwise pitch an upgrade — and open the paywall on tap — to an existing subscriber |
| `SettingsScreen` custom color / gradients | render neither branch | the locked row *asserts* the user lacks Pro; presets stay available so the section is never empty |
| `CapsuleDetailScreen` post-unlock upsell | hide the nudge | same mis-sell risk |

⚠️ **A new gate reading the current user's own `isPro` must pick one of these.** The wrong default — treating `!isPro` as "free" — is what shipped the bug this table exists to prevent.

**Server-enforced, not cosmetic.** `subscription_tier` is the un-forgeable source of truth: the `guard_subscription_tier` trigger lets only `service_role` (the webhook) write it, so a client can no longer self-grant Pro. Capsule creation is RPC-only (the direct `"Owners can insert capsules"` / `"Creator can insert groups"` INSERT policies were **dropped** — migration `20260721140000_payment_security_gates_a.sql`), so the create-RPC cap gates can't be side-stepped by a direct insert. Members and photos have server-side backstop triggers (`enforce_member_limit` / `enforce_photo_limit`, migration `20260721140100_payment_security_gates_b.sql`). All migrations verified live on prod with rolled-back fixtures.

**Accepted limitations:** **video length** stays client-only (duration isn't stored server-side) — bypassable by a modified client; the client photo/member pre-checks are fail-open on a transient count-query error, but the `enforce_*` triggers are the un-bypassable floor underneath them.
