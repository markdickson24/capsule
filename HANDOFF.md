# Capsule — Agent Handoff

_Last updated: 2026-07-24_

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
  (dated 7/19), which is stale** — it predates all the recent fixes below. The
  immediate next step is a **fresh production build** (`autoIncrement` bumps it
  to 25) + resubmit. App version `1.0.0`.
- **Android** — builds, but several native features are iOS-only (dual camera,
  video-stitcher orientation). No Play Store submission (later phase).
- **Web** — dev target, works, not marketed.
- Native features (camera, dual camera, share intent, RevenueCat, ZIP export,
  Sentry native) need a real device + dev-client/EAS build — never Expo Go.

---

## What's shipped since the last handoff (high level — see CLAUDE.md for how)

Core loop (create → invite → contribute → unlock → reveal → award voting) works
end to end. Major additions this cycle, all merged to `main`:

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

## In flight (not merged)

### Live Activity countdown — **draft PR #91**, needs device verification
Branch `feat/live-activity-countdown` · 28 files, +3.9k · spec and plan in
`docs/superpowers/specs|plans/2026-07-24-live-activity-countdown.*`

A lock-screen / Dynamic Island card counting down to a capsule's **uploads
deadline** (`contribution_lock_at ?? unlock_at`) while it's open for photos,
with a one-tap camera button — modelled on Once's. The owner sets a capsule
default (`capsules.live_activity_enabled`, on for new capsules); each member can
override it for themselves (`capsule_members.live_activity_override`). Free for
all tiers.

- **No server component.** iOS ticks the countdown itself from `staleDate`, so a
  started card stays correct with zero updates from the app. Deliberately **no
  push-to-start**, which means a card only appears once the app has run during
  the window. Adding it later needs an Apple `.p8`, an ES256-signing edge
  function talking to APNs directly (Expo's push service cannot send
  `apns-push-type: liveactivity`), per-device token sync, and iOS 17.2+.
- **Built with `@bacons/apple-targets`** (widget target in `targets/liveactivity/`)
  because the official `expo-widgets` needs **SDK 56+** and we're on 54 —
  upgrading would collide with the RN 0.81.5 patch, `expo-share-intent` 5.1.1,
  and the dual-camera module. Revisit only if we pass SDK 56.
- ⚠️ **The migrations are ALREADY APPLIED to production** — two columns, a column
  grant, and `create_capsule_with_owner`'s 12th param. Backward compatible with
  the shipped build (PostgREST maps by name, the new param defaults), and all 20
  pre-existing capsules were backfilled to *off*, so nothing changes for anyone
  until the new binary ships. Don't be alarmed by columns on prod that aren't in
  `main` yet.
- ⚠️ **Not verified on device.** Needs `eas build --profile development` on a
  physical iPhone (16.2+) — a new native target is invisible to Expo Go and the
  simulator has no real lock screen. PR #91 carries a prioritized 7-step
  checklist; start with the deadline-moment test (a range-precondition crash
  lived exactly there and was fixed late).
- **Before building:** register a provisioning profile for
  `com.markdickson.capsule.liveactivity` in `eas credentials`, alongside the main
  app and `com.markdickson.capsule.share-extension`. A past extension-target
  name collision made EAS sign the main app with the wrong profile.

Full architecture and seven known limitations: CLAUDE.md → "Live Activity
Countdown".

---

## Active open threads (pick up first) — mostly dashboard, not code

### 1. Ship a fresh production build
Build 24 is stale. `eas build --platform ios --profile production` (auto-bumps
to 25, includes everything above) → `eas submit … --latest`. **Pull `main`
first** — local `main` went stale repeatedly this session and builds silently
missed merged fixes. Note this build will **not** contain the Live Activity work
above (still on a branch) — decide whether to land PR #91 first or ship without
it.

### 2. Apple's first-IAP submission blocker
The three products (monthly $4.99 / yearly $39.99 / lifetime $79.99) are created
and priced in App Store Connect but show `needs_action`. **Apple requires the
first-ever IAP to be submitted attached to an app version through the ASC UI**
before any purchase can complete — until that's approved, **real purchases fail;
only the Test Store works.** Monthly/Yearly have full ~180-territory pricing;
**Lifetime is priced US-only** and needs international pricing.

### 3. RevenueCat hosted paywall (dashboard, manual)
- **Plan-selection highlight doesn't follow the tapped plan** — the accent is
  hardcoded on the Yearly card instead of bound to the Selected state. Fix in
  the Paywall Builder: each package card's **Selected** state → border
  `#FC6A5B` w2 + bg `#2B1510`; **Default** → `#2A2A2A` w1 + `#1A1A1A`; remove
  Yearly's hardcoded accent. The AI paywall editor **cannot** write these
  state overrides — must be done by hand in the Builder.
- A **copy-fix draft** (removes "original/full quality" claims — every photo is
  1920px for all tiers) is saved but **not published**. Publish it in the same
  pass. Builder preview shows Test Store prices ($9.99) — cosmetic only.

### 4. Confirm the OTP email template
Custom SMTP (**Resend**) is set up behind Supabase Auth. Verify the "Confirm
signup" template includes `{{ .Token }}` (keep the `{{ .ConfirmationURL }}`
link too for older installed builds) or new signups get no code.

### 5. Re-verify the `audits/` docs — they're stale
`audits/APP_STORE_REVIEW.md`, `BUGS.md`, `GAPS.md` predate the monetization +
polish work; **don't trust their old percentages.** Known-resolved since:
legal URLs now point at real pages (`getcapsuleapp.com/legal.html`), Apple
Sign In is implemented, support contact is in Settings, the surprise-mode
storage-orphan bug was fixed via a server-side delete RPC. Re-audit before
acting on any item.

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
| Live Activity (PR #91, in flight) | `targets/liveactivity/`, `modules/expo-live-activity/`, `src/hooks/useLiveActivities.ts`, `src/lib/liveActivityPlan.ts` |
| Preview (upload staging) | `src/screens/app/PreviewScreen.tsx` |
| Edge functions | `supabase/functions/` (unlock-capsules, revenuecat-webhook, contribution-nudges, create-group-capsules, dispatch-capsule-start, …) |
| DB migrations (schema truth) | `supabase/migrations/` |
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
