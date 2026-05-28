# Capsule — Agent Handoff

_Last updated: 2026-05-27_

---

## Goal

Get **Capsule** into the hands of beta testers, then ship. Capsule is a
time-locked photo-sharing app where groups create albums that unlock for all
members simultaneously on a set date.

**Distribution status:**
- **iOS / TestFlight** — blocked on the paid Apple Developer Program ($99/yr),
  not yet purchased. Needed for TestFlight *and* ad-hoc device installs.
- **Android** — unblocked. `eas build --profile preview` produces an installable
  APK that can be shared directly with testers, no paid account required.
- A simulator/`expo start` build is **not** enough for remote testers — they
  need a standalone build (the JS bundle baked in). `expo start` is only a dev
  server. The hosted backend (Supabase) runs 24/7 regardless of your machine.

---

## Current Progress

The core loop works on iOS, Android, and web: create capsule → invite →
contribute → time-lock → simultaneous unlock.

- **Native (iOS/Android)** — working.
- **Web (`npx expo start --web`)** — working. The old loading hang is resolved;
  `sessionStore` seeds synchronously from `localStorage` so the app never blocks
  on Supabase's async init. See CLAUDE.md "Web Auth Gotchas".

---

## What's Been Done (recent → older)

### Proximity unlock
- Three unlock modes: `time` (original), `proximity` (GPS-based), `both`.
- `check_in` RPC (`SECURITY DEFINER`) records a member's GPS location, unlocks the
  capsule when every joined member is within `proximity_radius_m` and checked in
  within the last 10 minutes. Distance via `_haversine_m` helper.
- `CheckInCard` UI in `CapsuleDetailScreen` — requests foreground location via
  `expo-location`, shows `N of M here` progress, realtime channel fires the reveal
  animation when the last check-in flips status.
- Unlock-mode picker added to `CreateScreen` and `EditCapsuleScreen` (Date /
  Together / Both). The cron only acts on `unlock_mode = 'time'`.
- Migration: `20260516152146_proximity_unlock.sql`.

### EAS build improvements
- iOS production profile auto-increments `buildNumber` on each build
  (`eas.json` → `autoIncrement: true`).

### Security & data hardening
- **Supabase advisor sweep** — one migration cleared 11 of 16 security warnings
  and all 19 performance warnings: pinned `search_path` on trigger functions,
  revoked their RPC `EXECUTE`, dropped the leftover `debug_uid`, added covering
  indexes for every foreign key, rewrote 10 RLS policies to `(select auth.uid())`,
  removed the broad `avatars` bucket listing policy.
- **`users` PII lockdown** — the `users` SELECT policy is `USING (true)` (needed
  for search / public profiles), which exposed every user's `email`, `phone`,
  and `push_token` to all signed-in users. Fixed with **column-level grants**:
  `authenticated` can now SELECT only 9 non-sensitive columns.
- **Server-side invite push** — the `send-invite-push` edge function now sends
  invite notifications, reading the invitee's `push_token` with the service role.
  Clients no longer need read access to it.
- **Server-side contribution lock** — `contribution_lock_at` enforced at both the
  `media` INSERT policy and the `capsule-media` storage bucket policy.

### Features & UX
- 4-step onboarding wizard for new sign-ups (gated by `users.onboarded_at`).
- Per-user accent color / theme system (`ThemeContext`, `ColorPicker`, Settings).
- Owner-only capsule actions: edit, archive, delete, manage members.
- `ConfirmModal` — cross-platform confirm dialog (replaces `Alert.alert`, which
  silently no-ops on web — that had made "Delete Capsule" do nothing in-browser).
- Generic user-facing DB error messages (no raw DB errors surfaced).

### Fixes
- Themed every screen — removed hardcoded `#FF6B35` fills that ignored the
  accent color (role toggle, reaction pill, disabled buttons).
- `SafeAreaView` now imported from `react-native-safe-area-context` everywhere
  (the `react-native` one is deprecated). Modals wrap their content in a
  `<SafeAreaProvider>` — a `<Modal>` is a separate native hierarchy the outer
  provider can't reach.

### Open advisor items (non-blocking)
- 2 warnings remain: `can_insert_capsule_member` / `get_my_capsule_ids` are
  RPC-callable. They're used inside RLS policies so `EXECUTE` can't be revoked;
  fully clearing them means moving them to a non-exposed `private` schema. They
  leak nothing meaningful (own capsule IDs / a boolean).
- Leaked-password protection is off — a Supabase dashboard toggle (Auth →
  Providers → Password).

---

## Next Steps

1. **Apple Developer Program** — still needed for TestFlight and ad-hoc iOS
   distribution. Once purchased: `eas build --platform ios --profile production`.
2. **Beta test** — `eas build --profile preview` for Android testers now;
   iOS testers wait on step 1.
3. **Watch Supabase free-tier usage during the beta** — 1 GB storage, 5 GB/mo
   egress. Egress (every photo *view*) is the likely first limit. Dashboard →
   Reports → Usage. Videos eat storage far faster than photos.
4. **No test suite or linter** — `npx tsc --noEmit` has pre-existing errors
   (`@expo/vector-icons` resolution, a few Supabase `as` casts). Worth a real
   typecheck pass before a public launch.

---

## Known Gotchas

- **Auth/session:** never `await supabase.auth.getSession()` in a screen — it
  hangs on web with an expired token. Use `sessionStore.get()` (synchronous).
  Never use `getUser()` (live network call every time).
- `if (!session) return` without `setLoading(false)` → stuck spinner. Use try/finally.
- **`SafeAreaView`** — import from `react-native-safe-area-context`. Inside a
  `<Modal>` it needs its own `<SafeAreaProvider>` or insets come back zero.
- **`Alert.alert`** is unreliable on web — use `<ConfirmModal>` for confirms and
  inline `<Text>` for errors.
- **Theme colors** — never hardcode `#FF6B35` as a *rendered* value in app
  screens; keep it only as a StyleSheet fallback and override inline with
  `accentColor` from `useTheme()`. Auth screens intentionally stay static.
- `borderColor: 'transparent'` in ProgressRing → dark artifact on iOS. Set all 4.
- `width: '33.33%'` inside a ScrollView on iOS computes to 0. Use `flex: 1` + `aspectRatio`.
- `shadow*` props in `StyleSheet.create` warn on React Native Web — `Platform.select` inline.
- Custom URL schemes (`capsule://`) only work in native builds, not Expo Go.
- Never `select('email' | 'phone' | 'push_token' | '*')` on `users` from client
  code — those columns are revoked from `authenticated`; it will fail.
- **`expo-location`** is native-only — guard with `Platform.OS !== 'web'` if
  referencing it. Used by `CheckInCard` for proximity check-in GPS.

---

## Key Files Reference

| Area | File |
|---|---|
| App entry / auth routing | `App.tsx` |
| Auth hook (session loading) | `src/hooks/useAuth.ts` |
| Session cache (use in screens) | `src/lib/sessionStore.ts` |
| Theme / accent color | `src/context/ThemeContext.tsx` |
| Color picker / confirm dialog | `src/components/ColorPicker.tsx`, `ConfirmModal.tsx` |
| Navigation tree | `src/navigation/AppNavigator.tsx`, `AuthNavigator.tsx` |
| Supabase client | `src/lib/supabase.ts` |
| Deep links | `src/hooks/useDeepLinks.ts` |
| Push notifications (native only) | `src/hooks/usePushNotifications.native.ts` |
| Onboarding wizard | `src/screens/app/OnboardingScreen.tsx` |
| Capsule detail (~1400 lines) | `src/screens/app/CapsuleDetailScreen.tsx` |
| Proximity check-in RPC | `check_in` (in `20260516152146_proximity_unlock.sql`) |
| Edge functions | `supabase/functions/unlock-capsules/`, `send-invite-push/` |
| DB migrations (source of truth) | `supabase/migrations/` |
| DB schema (original, has drifted) | `supabase-schema.sql` |

## Environment

```
EXPO_PUBLIC_SUPABASE_URL=...
EXPO_PUBLIC_SUPABASE_ANON_KEY=...
```

- Bundle ID: `com.markdickson.capsule`
- EAS Project ID: `2e004e6f-2e9d-4309-a172-46b6976eb3d9`
- Supabase project ref: `ezxxvvmesegegkdeniri`
- Deep link scheme: `capsule://` (native builds only)
- No test suite or linter configured yet
