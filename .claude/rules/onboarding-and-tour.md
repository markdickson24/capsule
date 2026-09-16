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

<!-- Trimmed from the original CLAUDE.md; backstory kept in HTML comments. Loads automatically when Claude reads a file matching `paths`. -->

## Onboarding (`OnboardingScreen`)

A 5-step flow ("Onboarding v2", rationale in `designs/ONBOARDING_V2.md`) after new sign-ups, gated by `users.onboarded_at`:
- `AppNavigator` checks a **local flag** (`sessionStore.wasOnboarded(userId)`, AsyncStorage per user — `markOnboarded`/`wasOnboarded` in `src/lib/sessionStore.ts`) — if set, routes straight to `'Tabs'`, no network round-trip. Written when a `users.onboarded_at` query confirms `true`, and again on wizard completion.
- If unset: queries `users.onboarded_at` — null → `initialRouteName = 'Onboarding'`, else → `'Tabs'` (flag written). Error/5s timeout falls through to Tabs.
- `users.onboarded_at` is the server source of truth; the flag only skips the round-trip.
- `saveProfile()` writes `display_name` + optional `avatar_url`, stamps `onboarded_at = now()`, calls `sessionStore.markOnboarded(userId)` then `setTourPending()` — at the end of step 3, so a user killed earlier re-enters it, one who finished never does.
- Exits via `navigation.replace('Tabs', …)`, no back stack. Bio/accent color live in Edit Profile/Settings, not here.

Steps (copy from `src/lib/onboardingMoments.ts`'s `MOMENTS` matrix, keyed on `OccasionKey` — title seeds, date chips, flavor lines, invite nudges):
1. **Name + avatar.** Display name required (max 30). Avatar upload starts in the background on pick (`avatarUrlPromise` ref); `resolveAvatarUrl()` awaits it, retries once, degrades to a toast. Live preview chip as the user types.
2. **"What are you waiting for?"** Six moment cards (1:1 with `capsules.occasion`) + optional 60-char free text. Tapping advances immediately; typed text becomes the title verbatim. Skip → `skipToHome()`.
3. **First capsule, pre-built.** Inline-editable title, occasion-aware date chips (first pre-selected) + "Pick my own date" (`DatePickerField`), surprise-mode line. "Create my capsule" runs `saveProfile()` → `create_capsule_with_owner(...)` → `set_default_superlatives` (best-effort). Always `owner_preview_locked: true`, `unlock_mode: 'time'`, 48h voting.
4. **Notification primer** (forward-only, only if a capsule was created). "Yes, notify me" → `requestPushPermission` (app's only native-prompt call site); "maybe later" sets `cap_notif_reprime:<userId>`. Web: copy-only.
5. **Sealed ceremony** (forward-only). Lock scale-in + `haptics.success()` + 30s countdown. Actions: Invite people (`Share.share` of `capsule://join/<id>`, falls back to the capsule's invite UI), Add first photo (→ Camera tab), or "take me home".

Footer exists only for steps 1–3 (`Back` from 2–3; contextual `Next`/skip); steps 4–5 render own actions in-body — don't render placeholder `<View>`s for missing footer buttons.

## New-User Tour

One-time coach-mark walkthrough after onboarding completes. Custom-built, identical on web/native, no SVG.

- **`TourProvider`/`useTour`/`useTourTarget`/`measureNode`** (`src/context/TourContext.tsx`) — mounted in `App.tsx` inside `ThemeProvider` → `SafeAreaProvider`, sibling to the navigator; holds step list + index and a target-id → measure-ref registry, drives `navigationRef` between steps. Elements opt in via `useTourTarget(id)` (register/unregister on mount/unmount).
- **`TourOverlay`** (`src/components/TourOverlay.tsx`) — four dim panels around a `measureInWindow` rect + a tooltip card (title/body/Next/Skip); no SVG, just positioned `View`s.
- **`buildTourSteps(ctx)`** (`src/lib/tourSteps.ts`) — pure, unit-tested. `hasCapsule` → full walkthrough (`capsule-card` → CapsuleDetail's `capsule-countdown`/`-add-media`/`-invite`/`-awards` → Home's `home-scan`/`tab:Camera`/`tab:Notifications`/`tab:Profile` → finish); else shorter join-first path (`home-scan` → `tab:Create` (optional) → `tab:Camera`/`tab:Notifications`/`tab:Profile` → finish). In-capsule stops assume a freshly-created, still-locked capsule (no `AwardsSection`).
- **Target ids** — tabs: `tab:Camera`, `tab:Create`, `tab:Notifications`, `tab:Profile` (`CustomTabBar` in `AppNavigator.tsx`); Home: `home-scan`, `capsule-card`; CapsuleDetail: `capsule-countdown`, `capsule-add-media`, `capsule-invite`, `capsule-awards`. A never-mounting target auto-skips its step.
- **`waitForTarget`** (`src/lib/waitForTarget.ts`) — pure, unit-tested poll loop; waits for a newly-navigated screen's target to register before spotlighting (`navigationRef.navigate()` doesn't resolve on mount).
- **Trigger + persistence** (`src/lib/tourStorage.ts`, AsyncStorage, per-install — mirrors `cap_camera_coach_seen`): `OnboardingScreen.saveProfile()` calls `setTourPending()` right after `sessionStore.markOnboarded(userId)`. `HomeScreen` consumes the flag once (`consumeTourPending()`, read-and-delete), starting the tour only if `cap_tour_seen` isn't set. `markTourSeen()` runs on finish or Skip, so the tour never runs twice per install.
