---
paths:
  - "src/screens/app/OnboardingScreen.tsx"
  - "src/lib/onboardingMoments.ts"
  - "src/context/TourContext.tsx"
  - "src/components/TourOverlay.tsx"
  - "src/lib/tour*"
  - "src/lib/waitForTarget.ts"
  - "src/components/SealedMoment.tsx"
  - "src/navigation/**"
  - "src/screens/app/HomeScreen.tsx"
---

<!-- Moved verbatim from CLAUDE.md. Loads automatically when Claude reads a file matching `paths`. -->

## Onboarding (`OnboardingScreen`)

A 5-step personalized flow ("Onboarding v2" — full design rationale in `designs/ONBOARDING_V2.md`) that runs after new sign-ups. Gated by `users.onboarded_at`:
- AppNavigator first checks a **local flag** (`sessionStore.wasOnboarded(userId)`, an `AsyncStorage` boolean keyed per user — see `markOnboarded`/`wasOnboarded` in `src/lib/sessionStore.ts`). If set, routes straight to `'Tabs'` with **no network round-trip** — this used to block first paint on every launch behind a `users.onboarded_at` query (up to a 5s timeout). The flag is written the moment a `users.onboarded_at` query confirms `true`, and again when the wizard itself completes.
- If the local flag isn't set (first launch, fresh install, or genuinely not yet onboarded), falls back to the original behavior: queries `users.onboarded_at`. If null → `initialRouteName = 'Onboarding'`. Otherwise → `'Tabs'` (and the local flag gets written for next launch). On query error or 5s timeout, falls through to Tabs (don't strand the user).
- `users.onboarded_at` remains the server source of truth — the local flag only exists to skip the round-trip for returning users; nothing in the app currently un-sets `onboarded_at`, so a stale-true local flag isn't a real-world risk.
- `saveProfile()` writes `display_name` + optionally `avatar_url` and stamps `onboarded_at = now()`, then calls `sessionStore.markOnboarded(userId)` followed by `setTourPending()` (arms the new-user coach-mark tour — see "New-User Tour" below). It runs at the end of step 3 (both "Create my capsule" and every skip-to-Home path) — so a user killed mid-wizard before step 3 correctly re-enters it, and one who completed step 3 never does.
- Exits use `navigation.replace('Tabs', …)` (no back stack to the wizard). Bio and accent color are **not** collected here anymore — they live in Edit Profile and Settings.

Steps (state machine inside the one screen; dynamic copy comes from `src/lib/onboardingMoments.ts` — the `MOMENTS` matrix keyed on `OccasionKey`, exporting title seeds, date chips, flavor lines, and invite nudges per occasion):
1. **Name + avatar.** Display name required (max 30). Avatar upload **starts in the background the moment it's picked** (`avatarUrlPromise` ref) so a failure isn't discovered at finish-time; `resolveAvatarUrl()` awaits it, retries once, and degrades to a toast (never blocks completion). A live member-row preview chip renders the name/avatar as they type.
2. **"What are you waiting for?"** Six moment cards (mapping 1:1 to `capsules.occasion`) + an optional 60-char free-text line. Tapping a card advances immediately; typed free text **becomes the capsule title verbatim** (always beats the seed — never rewrite the user's words). Skip → `skipToHome()`.
3. **First capsule, pre-built.** A capsule card with inline-editable title, occasion-aware date chips (first chip pre-selected) + "Pick my own date" (expands the shared `DatePickerField`), and a surprise-mode promise line. "Create my capsule" runs `saveProfile()` then `create_capsule_with_owner(...)` (see "Key RLS Constraints") followed by `set_default_superlatives` best-effort. Always `owner_preview_locked: true`, `unlock_mode: 'time'`, 48h voting.
4. **Notification primer** (forward-only, reached only when a capsule was created). Names the user's capsule + date; "Yes, notify me" calls `requestPushPermission` (the app's only native-prompt call site); "maybe later" sets the `cap_notif_reprime:<userId>` AsyncStorage flag. On web the button is copy-only ("Sounds good").
5. **Sealed ceremony** (forward-only). Lock scale-in + `haptics.success()` + live countdown (30s tick). Actions: **Invite people** (`Share.share` of the `capsule://join/<id>` link; on failure/web falls back to navigating into the capsule where the full invite UI lives), **Add the first photo** (→ Camera tab), or "take me home".

Footer only exists for steps 1–3 (`Back` from 2–3; contextual `Next`/skip). Steps 4–5 render their own primary actions in-body. Don't render placeholder `<View>`s for missing footer buttons or they'll consume row width.

## New-User Tour

A one-time coach-mark walkthrough for new users, run once after onboarding completes. Custom-built (no third-party tour library) so it works identically on web and native with no SVG dependency.

- **`TourProvider`/`useTour`/`useTourTarget`/`measureNode`** (`src/context/TourContext.tsx`) — the engine. Mounted in `App.tsx` inside `ThemeProvider` → `SafeAreaProvider`, as a sibling wrapping the navigator. Holds the current step list + index, a registry of target ids → measure refs, and drives `navigationRef` to switch screens between steps. Elements opt in via `useTourTarget(id)`, a callback ref that registers/unregisters itself with the provider on mount/unmount.
- **`TourOverlay`** (`src/components/TourOverlay.tsx`) — renders four dim panels around a `measureInWindow` rect (top/bottom/left/right of the spotlighted element) plus a tooltip card with title/body/Next/Skip. No SVG mask — just four positioned opaque `View`s, so it's identical on web and native.
- **`buildTourSteps(ctx)`** (`src/lib/tourSteps.ts`) — pure, unit-tested step-list builder (no React/RN imports). Two branches: `hasCapsule` → full walkthrough (`capsule-card` → `CapsuleDetail`'s `capsule-countdown`/`-add-media`/`-invite`/`-awards` → back to Home's `home-scan`/`tab:Camera`/`tab:Notifications`/`tab:Profile` → finish); no capsule → shorter join-first path (`home-scan` → `tab:Create` (optional) → `tab:Camera`/`tab:Notifications`/`tab:Profile` → finish). The in-capsule stops target what a **freshly-created, still-locked** capsule actually shows — no post-unlock `AwardsSection`, since a brand-new user's first capsule is always locked.
- **Target ids** — tab bar: `tab:Camera`, `tab:Create`, `tab:Notifications`, `tab:Profile` (`CustomTabBar` in `AppNavigator.tsx`); Home: `home-scan`, `capsule-card`; CapsuleDetail: `capsule-countdown`, `capsule-add-media`, `capsule-invite`, `capsule-awards`. A target that never mounts/measures (e.g. a screen size where an element is offscreen) auto-skips its step rather than hanging.
- **`waitForTarget`** (`src/lib/waitForTarget.ts`) — pure, unit-tested poll loop the provider uses to wait for a newly-navigated screen's target to register before spotlighting it (handles the cross-screen nav timing, since `navigationRef.navigate()` doesn't resolve when the destination has finished mounting).
- **Trigger + persistence** (`src/lib/tourStorage.ts`, `AsyncStorage`, per-install — mirrors `cap_camera_coach_seen`): `OnboardingScreen.saveProfile()` calls `setTourPending()` right after `sessionStore.markOnboarded(userId)` — the true completion point every exit path (create-capsule and every skip-to-Home) hits. `HomeScreen` consumes the flag once on load (`consumeTourPending()`, read-and-delete) and starts the tour only if `cap_tour_seen` isn't already set. `markTourSeen()` is called on finish (last step's Done) or Skip, so the tour never runs twice for the same install.
