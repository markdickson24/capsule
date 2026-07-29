# Capsule — Agent Handoff

_Last updated: 2026-07-29_

For architecture, schema, and per-feature implementation detail, **CLAUDE.md is
the source of truth** — kept current after every major change. `APP_CONTEXT.md`
is a self-contained overview for sharing externally. This file is a **status
snapshot**: what's shipped, what's in flight, and what to pick up first.

---

## Goal & distribution status

Get **Capsule** — a time-locked photo-sharing app — launched on the App Store.
Monetization (Capsule Pro via RevenueCat) is fully wired; the remaining launch
work is mostly **App Store Connect / RevenueCat dashboard steps, not code.**

- **iOS** — on **TestFlight**. ⚠️ The currently-submitted build is **build 24
  (dated 7/19), which is badly stale** — it predates the Live Activity feature
  and *every* production bug fix below. A failed `eas build` already consumed
  25-27, so the next successful one is ~28. App version `1.0.0`.
  ⚠️ **That build must be run INTERACTIVELY once** (`npx eas-cli build --platform
  ios --profile production`, no `--non-interactive`): the Live Activity widget
  extension is a brand-new bundle ID and EAS will not auto-generate its
  provisioning profile in non-interactive mode. It fails at the credentials step
  otherwise. Subsequent builds are fine non-interactively.
- **Android** — builds, but several native features are iOS-only (dual camera,
  video-stitcher orientation). No Play Store submission (later phase).
- **Web** — dev target, works, not marketed.
- Native features (camera, dual camera, share intent, RevenueCat, ZIP export,
  Sentry native) need a real device + dev-client/EAS build — never Expo Go.

---

## Earlier this cycle (pre-2026-07-24)

Core loop (create → invite → contribute → unlock → reveal → award voting) works
end to end. Everything below is merged and on `main`; see "Recently landed" for
the most recent work:

- **Monetization / Capsule Pro (RevenueCat)** — full stack: `purchases.*`
  wrapper, `useRevenueCat`/`useEntitlements`, hosted paywall, and the
  `revenuecat-webhook` edge function that mirrors the entitlement into
  `users.subscription_tier` (the un-forgeable server gate). **Tier enforcement
  is server-hard**: caps live in the create RPCs + `enforce_member_limit` /
  `enforce_photo_limit` triggers + `guard_subscription_tier` (only
  `service_role` can write the tier). Free vs Pro: 3/10/20/30s vs
  ∞/50/1000/120s (capsules/members/photos/video). Pro perks: ZIP export,
  custom color + gradient palettes, `ProBadge`, recurring groups. See
  CLAUDE.md → "Monetization".
- **Error monitoring (Sentry)** — `@sentry/react-native`, release-only,
  user-id-only (no PII), nav tracing, `reportError` helper wired into
  high-value silent-failure paths. All config in `src/lib/sentry.ts`.
- **Email-OTP signup** — 6-digit code instead of a confirmation link;
  `verifyOtp` signs the user straight in → onboarding. Requires the Supabase
  "Confirm signup" template to emit `{{ .Token }}` (see open threads).
- **Duplicate-push fix (deployed to prod)** — `contribution-nudges` and
  `unlock-capsules` reminder tiers had overlapping windows that sent 3
  identical pushes at once; both now dedupe per run.
- **Unlock reliability** — capsules used to need a manual refresh to open
  (realtime events are dropped while backgrounded). Now: `applyCapsule()`
  transition detection + `AppState` foreground refetch + due-time poll on
  CapsuleDetail and Home. Home countdowns tick live (minutes/seconds) and
  auto-flip to "Unlocked".
- **Start-date countdown ring** — CapsuleDetail ring counts to the start date
  first, then flips to the unlock countdown.
- **Caption keyboard fixes** — `KeyboardAvoidingView` is broken under the New
  Architecture; both caption fields now track keyboard height manually and
  animate in sync with the keyboard.
- **Brand color** — default accent changed to **`#FC6A5B`** (reddish-coral,
  matches the website); DB column default migrated; auth screens re-tinted.
  Existing users keep their color.
- **Pro/paywall UI polish**, **community links** (Discord/IG/TikTok in Settings
  + onboarding), **iOS 15.5 deployment target** (via `expo-build-properties`,
  required by the ZIP-export dep), **awards winning-photo tap-to-open**,
  **check-in "You're checked in" state**, **paywall upgrade glitch fix** (limit
  sheet dismisses before presenting the native paywall).

Earlier cycles: Groups (recurring), Friends, moderation (report/block),
account deletion, Superlatives/Awards, dual camera, background upload queue,
onboarding v2 + coach-mark tour, proximity unlock. See CLAUDE.md.

---

## Recently landed (2026-07-24 → 07-29)

### Live Activity countdown — **merged** (PR #91), working on device
Lock-screen / Dynamic Island card counting down to a capsule's uploads deadline,
with a one-tap camera button. Verified rendering on a physical iPhone. Owner sets
`capsules.live_activity_enabled`; each member can override via
`capsule_members.live_activity_override`. Free for all tiers. No server
component — iOS ticks the countdown from `staleDate`. Architecture + seven known
limitations: CLAUDE.md → "Live Activity Countdown".

Post-merge formatting fixes: the expanded Dynamic Island had no countdown at all
(it lived only in the compact pill), the countdown rendered as raw hours
(`742:55:38`) because `Text(timerInterval:)` has no day rollover — now `31d left`
above 24h, ticking `HH:MM:SS` below — and content sat flush against the pill's
rounded corners.

⚠️ **`ios/` must be regenerated with `npx expo prebuild --clean` if it predates
the merge.** `expo run:ios` reuses an existing `ios/` and runs a *non-clean*
prebuild, which updates JS and pods but **will not add a new native target** — so
the app builds and installs with no widget extension and no
`NSSupportsLiveActivities`, and the feature silently does nothing. Pods link
either way, so it looks half-wired.

### Production bug fixes — all live, most need only a rebuild

Found via Sentry and user reports. Full detail in each commit + CLAUDE.md.

- **Superlative voting was dead for four days** (fixed, DB-side, no rebuild
  needed). `audit_hygiene_revokes` revoked EXECUTE on `_superlative_target_valid`
  from `authenticated` reasoning "RLS-internal use is unaffected" — the exact
  opposite of true: **policies evaluate as the querying role**, so both write
  policies denied every vote with `42501`. Hidden because the only votes still
  landing were demo fixtures seeded via `service_role`, which bypasses RLS — the
  row count looked healthy.
- **Capsule + account deletion were both broken** (fixed, DB-side). Two
  independent blockers: Supabase added `storage.protect_delete()`, which rejects
  the direct `storage.objects` DELETE both RPCs did; and `superlative_winners`'
  target FKs were `ON DELETE SET NULL` against an XOR check that makes SET NULL
  unsatisfiable, so any capsule with a finalized media-target winner raised 23514.
  Storage cleanup now runs **client-side and before** the RPC (new owner-only
  delete policies + `capsule_storage_keys` / `my_account_storage_keys`).
- **Invite links and QR codes all 404'd/500'd** — `/join/*` edge function crashed
  on unset env vars. Now fails *open* (renders the redirect with generic copy)
  since the capsule id is in the URL and Supabase is only needed for a pretty
  unfurl. Still `x-join-fn: degraded` until the env vars are scoped — see open
  threads.
- **Silent sign-outs** — SecureStore defaulted to `WHEN_UNLOCKED`, so the session
  was unreadable while the device was locked and the user landed on Welcome. Now
  `AFTER_FIRST_UNLOCK`. ⚠️ **Not retroactive** — accessibility is fixed at write
  time, so existing installs settle only after the next sign-in or unlocked
  refresh.
- **Multi-capsule upload failed** when the first target was a locked
  surprise-mode capsule: the bucket-side copy has to *read* the source, which RLS
  hides. Now falls back to a real upload.
- **Every dual-camera recording reported failure** (`Recording failed: unknown`)
  — `finishWriting`'s completion handler captured the writer `[weak]`, and it was
  the last strong reference. `nil?.status != .completed` → failure branch;
  `nil?.error` → "unknown". Files were probably fine on disk.
- **Camera flip shortened clips** — the record budget was charged wall-clock time
  including the dead lens-switch gap, and Preview was told the inflated duration
  (which feeds the tier trim gate). Some loss is inherent (~0.4-1.5s/flip).
- **QR scanner** — camera permanently dead after a signed-out scan, duplicate
  scans from a state-based guard, and a pending invite reading as "already a
  member" with no way to join (`capsule_join_preview` now reports three states).
- **Deep links all mis-routed** — `NavigationContainer` had a `linking` prop with
  no `config` *and* `useDeepLinks` had its own listener; React Navigation
  auto-derived screen names from path segments, so `capsule://capsule/<id>/camera`
  tried to navigate to a screen named `capsule`. Prop removed; `useDeepLinks` is
  the sole owner.
- **Avatars burned the image-transform quota** — Storage Image Transformations
  bill per *distinct origin image* (100/month on Pro), and avatars alone
  exhausted it for negligible byte savings. `transformAvatarUrl` is now a
  pass-through. Don't "fix" it back.

### Landing site / SEO
Full audit + fixes: mobile Lighthouse **100/100/100/100**, LCP 3.5s → 0.9s, page
weight ~520KB → ~83KB, JSON-LD sitewide, guide pages ~400 → ~1100 words,
WCAG AA contrast fixed. Google Search Console verified, sitemap submitted,
indexing requested. Reports in `audits/SEO_AUDIT_2026-07-24/` and
`audits/QR_SCANNER_AUDIT_2026-07-24.md`.

Brand: background-removed logos (SVG + PNG, transparent) in `assets/brand/` —
**not** app assets; `assets/icon.png` must stay opaque (iOS rejects alpha).

---

## Active open threads (pick up first) — mostly dashboard, not code

### 1. Ship a fresh production build — now the single biggest blocker
Build 24 (7/19) predates the Live Activity feature and **every** bug fix above.
Nothing in "Recently landed" reaches a TestFlight user until this ships, and
Sentry only reports from release builds — so the app is currently both unfixed
and unobserved in the field.

```bash
git checkout main && git pull          # local main went stale repeatedly
npx eas-cli build --platform ios --profile production   # INTERACTIVE — see below
npx eas-cli submit --platform ios --profile production --latest
```

⚠️ **Must be interactive the first time.** The Live Activity widget extension
(`com.markdickson.capsule.liveactivity`) is a new bundle ID; EAS will not
generate its provisioning profile in `--non-interactive` mode and the build dies
at the credentials step. A local `xcodebuild -allowProvisioningUpdates` run has
already created the *development* profile, but the production one still needs
approving once.

### 2. Netlify env vars for the invite-link edge function — 2 minutes
`/join/*` returns `200` with header `x-join-fn: degraded`, meaning invites work
but previews read *"Someone invited you to a Capsule"* instead of the real title
and owner. Set `SUPABASE_URL` and `SUPABASE_SERVICE_ROLE_KEY` (or
`SUPABASE_ANON_KEY`) in Netlify env vars **with the Edge Functions scope
enabled** — a different scope from Functions, which is almost certainly the
original cause. No redeploy needed; `x-join-fn` flips to `ok`. The function logs
exactly which variable is missing.

### 3. Apple's first-IAP submission blocker
The three products (monthly $4.99 / yearly $39.99 / lifetime $79.99) are created
and priced in App Store Connect but show `needs_action`. **Apple requires the
first-ever IAP to be submitted attached to an app version through the ASC UI**
before any purchase can complete — until that's approved, **real purchases fail;
only the Test Store works.** Monthly/Yearly have full ~180-territory pricing;
**Lifetime is priced US-only** and needs international pricing.

### 4. RevenueCat hosted paywall (dashboard, manual)
- **Plan-selection highlight doesn't follow the tapped plan** — the accent is
  hardcoded on the Yearly card instead of bound to the Selected state. Fix in
  the Paywall Builder: each package card's **Selected** state → border
  `#FC6A5B` w2 + bg `#2B1510`; **Default** → `#2A2A2A` w1 + `#1A1A1A`; remove
  Yearly's hardcoded accent. The AI paywall editor **cannot** write these
  state overrides — must be done by hand in the Builder.
- A **copy-fix draft** (removes "original/full quality" claims — every photo is
  1920px for all tiers) is saved but **not published**. Publish it in the same
  pass. Builder preview shows Test Store prices ($9.99) — cosmetic only.

### 5. Confirm the OTP email template
Custom SMTP (**Resend**) is set up behind Supabase Auth. Verify the "Confirm
signup" template includes `{{ .Token }}` (keep the `{{ .ConfirmationURL }}`
link too for older installed builds) or new signups get no code.

### 6. Re-verify the `audits/` docs — they're stale
`audits/APP_STORE_REVIEW.md`, `BUGS.md`, `GAPS.md` predate the monetization +
polish work; **don't trust their old percentages.** Known-resolved since:
legal URLs now point at real pages (`getcapsuleapp.com/legal.html`), Apple
Sign In is implemented, support contact is in Settings, the surprise-mode
storage-orphan bug was fixed via a server-side delete RPC. Re-audit before
acting on any item.

---

### 7. Smaller outstanding items
- **The app's own button contrast is still 2.86:1** — every primary button uses
  white on `#FC6A5B`, the same WCAG AA failure fixed on the website. This is the
  surface App Review actually looks at. Website fix used dark `#0A0A0A` text on
  the unchanged brand coral (6.93:1), which keeps the hue identical.
- **Orphaned storage blobs from before 2026-07-26** — deletions prior to the fix
  left their files behind. A one-off sweep comparing `storage.objects` against
  live `media` keys would reclaim them; it's a bulk delete on production, so it
  wants explicit sign-off.
- **Sentry read access** — the `SENTRY_AUTH_TOKEN` in `.env.local` is
  source-maps-only (403 on every read endpoint). A token with `event:read` +
  `org:read` would let an agent triage issues directly.
- **`_superlative_target_valid` is still callable via PostgREST** — the original
  hardening concern (a cross-capsule membership oracle) is unaddressed, because
  fixing it *and* keeping RLS working means moving the function to a non-exposed
  schema and repointing both policies. Rated Low, "not a live exploit today".

---

## Known gotchas (handoff-critical; full list in CLAUDE.md)

- **New Architecture is ON** (`newArchEnabled: true`). `KeyboardAvoidingView`
  is broken on iOS under it — track keyboard height via `Keyboard.addListener`
  and offset manually (see the caption fields / `LimitSheet`).
- **Stale local `main`** bit us repeatedly: merging a PR on GitHub does **not**
  update local `main` — `git checkout main && git pull` before every build, and
  confirm the top commit.
- **Out-of-band DB drift** — some live functions/policies existed with no
  migration. Verify live definitions via `mcp__supabase__execute_sql`
  (`pg_get_functiondef` / `pg_policies`) before changing any
  trigger/function/policy.
- **A signature-changing `drop` + `create` of an RPC silently resets its ACL.**
  Adding a param to `create_capsule_with_owner` gave the recreated function
  ambient `PUBLIC` EXECUTE, undoing `20260718120000_revoke_anon_rpc_execute.sql`
  — caught only in review. Always reassert `revoke … from public, anon` +
  `grant execute … to authenticated` in the same migration, and verify with
  `has_function_privilege`. Also drop the old overload first, or PostgREST fails
  the pre-existing call with `PGRST203`.
- ⚠️ **A function called from inside an RLS policy must be EXECUTE-granted to
  the querying role.** Policies evaluate as the *caller*, not the table owner, so
  revoking `execute … from authenticated` on a policy helper silently breaks
  every statement that policy guards (`42501`). This killed all voting for four
  days. Before revoking EXECUTE on anything, grep the policy expressions for its
  name (query in CLAUDE.md → Key RLS Constraints). Revoking from `anon` alone is
  safe.
- **Demo fixtures seeded via `service_role` bypass RLS**, so a healthy-looking
  row count can hide a feature that is completely broken for real users. When
  checking whether something works in production, filter out the `facade`-prefixed
  ids.
- **`storage.protect_delete()` now blocks `DELETE FROM storage.objects` in SQL.**
  Server-side storage cleanup inside a definer RPC no longer works — it must go
  through the Storage API from the client, which needs a delete policy *and* must
  run BEFORE the row delete (the policy checks ownership of a row that's about to
  vanish; for account deletion the JWT dies with the user).
- **A `SET NULL` FK against an XOR check constraint is unsatisfiable** and aborts
  the whole cascade with 23514. `superlative_winners` had exactly this.
- **`expo run:ios` will not add a new native target** — it reuses `ios/` with a
  non-clean prebuild. After merging anything that adds a widget extension or
  local module, run `npx expo prebuild --clean --platform ios` or the feature
  silently doesn't exist in the build.
- **Sentry is release-only** (`enabled: !!DSN && !__DEV__`). Nothing from a
  `expo run:ios` Debug build ever reaches it — so "no errors in Sentry" means
  nothing while TestFlight is stale.
- **`capsule_members` has no table-wide UPDATE grant** (the July 2026 audit
  revoked it, granting back only `joined_at`). Any new client-written column
  there needs its own `grant update (col)` in the same migration, or the write
  fails `42501` for the *entire* statement.
- **`grep`ping `ios/Capsule.xcodeproj/project.pbxproj` for a filename proves
  nothing** — the generated project uses synchronized file-system groups, so
  filenames are never enumerated and the grep returns 0 whether the wiring is
  right or wrong. Verify target membership by compiling.
- **RevenueCat AI paywall editor can't write package selected-state overrides
  or raw component styling** — those are manual Builder edits. It edits the
  *published* version into a new draft, so it can clobber an unpublished draft;
  fold all changes into one prompt.
- Custom native modules (dual camera, video stitcher, share intent, ZIP export)
  only work in a dev-client/EAS build; dual camera needs a physical A12+ iPhone.
- Auth/session: never `await supabase.auth.getSession()` in a screen — use
  `sessionStore.get()` (synchronous, never hangs on web).
- `Alert.alert` is unreliable on web — use `<ConfirmModal>` / inline error text.
- All caps key off the **capsule owner's** tier, never the acting user's
  ("monetize the host, guests never pay").

---

## Key files reference

| Area | File |
|---|---|
| App entry / Sentry init / auth routing | `App.tsx` |
| Auth hook / session cache | `src/hooks/useAuth.ts`, `src/lib/sessionStore.ts` |
| Cache + invalidation | `src/lib/cache.ts`, `src/hooks/useCachedFetch.ts` |
| Theme / accent (default `#FC6A5B`) | `src/context/ThemeContext.tsx`, `src/lib/accentPresets.ts` |
| Monetization | `src/lib/purchases.*`, `src/hooks/useEntitlements.ts`, `useRevenueCat.ts`, `src/lib/tierLimits.ts`, `src/lib/proGate.ts`, `src/components/LimitSheet.tsx` |
| Error monitoring | `src/lib/sentry.ts` |
| Capsule export (Pro) | `src/lib/exportCapsule.*`, `src/components/ExportProgressModal.tsx` |
| Background upload queue | `src/lib/uploadQueue.ts` |
| Groups / Friends / Blocks | `src/lib/groups.ts`, `friends.ts`, `blocks.ts` |
| Community links | `src/lib/communityLinks.ts` |
| Capsule detail (~2200 lines) | `src/screens/app/CapsuleDetailScreen.tsx` |
| Camera + native modules | `src/screens/app/CameraScreen.tsx`, `modules/expo-dual-camera/`, `modules/expo-video-stitcher/` |
| Live Activity | `targets/liveactivity/`, `modules/expo-live-activity/`, `src/hooks/useLiveActivities.ts`, `src/lib/liveActivityPlan.ts` |
| Preview (upload staging) | `src/screens/app/PreviewScreen.tsx` |
| Edge functions | `supabase/functions/` (unlock-capsules, revenuecat-webhook, contribution-nudges, create-group-capsules, dispatch-capsule-start, …) |
| DB migrations (schema truth) | `supabase/migrations/` |
| Brand assets (transparent logos) | `assets/brand/` |
| Landing site + invite edge fn | `landing/`, `netlify/edge-functions/join.ts` |
| Full external overview | `APP_CONTEXT.md` |

## Environment

```
EXPO_PUBLIC_SUPABASE_URL=...
EXPO_PUBLIC_SUPABASE_ANON_KEY=...
EXPO_PUBLIC_REVENUECAT_IOS_KEY=...   # appl_... — required; unset = purchases disabled
EXPO_PUBLIC_SENTRY_DSN=...           # unset = Sentry off; set = release-only reporting
```

- Bundle ID: `com.markdickson.capsule` · EAS Project ID: `2e004e6f-2e9d-4309-a172-46b6976eb3d9`
- Supabase ref: `ezxxvvmesegegkdeniri` · RevenueCat project: `proj72b0a2e3` (entitlement "Capsule Pro")
- iOS deployment target: **15.5** (pinned in `app.json` via `expo-build-properties`)
- Deep-link scheme: `capsule://` (native builds only) · No test suite/linter configured (by design)
