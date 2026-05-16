# Capsule — Agent Handoff

_Last updated: 2026-05-15_

---

## Goal

Ship a TestFlight build of **Capsule** — a time-locked photo-sharing app where groups create albums that unlock for all members simultaneously on a set date.

---

## Current Progress

### Native (iOS/Android) — Working ✓
The app loads and all core features work on device.

### Web (`npx expo start --web`) — Working ✓
The web loading hang is resolved. `sessionStore` now seeds itself synchronously from `localStorage` at module load, so the app never blocks on Supabase's async init. See "Web Auth — Resolved" below.

The core loop (create capsule → invite → contribute → time-lock → simultaneous unlock) works on all three platforms.

---

## Web Auth — Resolved

**Original problem:** `supabase.auth.getSession()` hangs on web when the stored access token is expired — Supabase JS v2 blocks on an internal `initializePromise` waiting for a network refresh, and the `INITIAL_SESSION` event can be blocked on the same promise.

**Fix shipped (commit `7a6eb73`):**
1. `src/lib/sessionStore.ts` — a synchronous module-level session cache. On web it seeds itself at module load by reading Supabase's `sb-<projectRef>-auth-token` entry from `localStorage`, so `sessionStore.get()` returns the persisted session before Supabase finishes async init.
2. `useAuth` (`src/hooks/useAuth.ts`) — on web, `loading` starts as `false` and the initial session comes straight from `sessionStore`, so the root spinner never blocks. On native, a 1.5s fallback timeout forces `loading` off in case SecureStore init lags. `onAuthStateChange` updates state when Supabase catches up.
3. All `getSession()` calls in screens replaced with `sessionStore.get()`.

**Rule going forward:** never call `await supabase.auth.getSession()` inside a screen — use `sessionStore.get()` (synchronous, never hangs). See CLAUDE.md "Web Auth Gotchas".

---

## What's Done Since Last Handoff

- **Web loading hang** — resolved (see above).
- **Server-side contribution lock** — `contribution_lock_at` is now enforced at two layers: the `media` table INSERT policy and the `storage.objects` INSERT policy for the `capsule-media` bucket. Tightening the bucket policy closed a hole where a user could spam storage without inserting the linking `media` row. See CLAUDE.md "Key RLS Constraints".
- **4-step onboarding wizard** (commit `4ba7d90`) — new sign-ups go through name/avatar → accent color → bio → first-capsule preset. Gated by `users.onboarded_at`. See CLAUDE.md "Onboarding".
- **Per-user accent color / theme system** — `ThemeContext`, `ColorPicker` component, `SettingsScreen`. App screens use `useTheme()` instead of hardcoded `#FF6B35`.
- **Owner-only capsule actions** — edit, archive, delete, manage members.
- **Generic user-facing DB error messages** (commit `b30a0af`) — raw DB errors no longer surfaced.
- All previously-staged changes have been committed.

---

## Uncommitted Changes (commit these)

Working tree has two modified files:
- `src/types/database.ts` — `User` interface gained `push_token`, `bio`, `accent_color`, `onboarded_at`; `NotificationType` gained `'reaction'`. Brings the row types in sync with the live DB.
- `CLAUDE.md` — documentation updates.

Suggested commit: `"Sync database.ts row types with DB; update CLAUDE.md"`

---

## Next Steps (prioritized)

### 1. Commit the working-tree changes
See above.

### 2. TestFlight build
`eas build --platform ios --profile production`
- Bundle ID: `com.markdickson.capsule`
- EAS Project ID: `2e004e6f-2e9d-4309-a172-46b6976eb3d9`

### 3. Pre-TestFlight polish (open items)
- No test suite or linter configured yet — consider at least a typecheck step.
- Verify the unlock cron (`unlock-capsules` edge function) is running on the production project and `CRON_SECRET` matches Vault.

---

## Known Gotchas (still relevant)

- `getUser()` makes a live network call every time (500ms–2s). Never use it — use `sessionStore.get()`.
- `getSession()` in screen fetch functions hangs on web when the token is expired. Use `sessionStore.get()`.
- `if (!session) return` early exits without `setLoading(false)` cause stuck spinners. Use try/finally.
- `borderColor: 'transparent'` in ProgressRing — dark artifact on iOS. Set all 4 border colors explicitly.
- `width: '33.33%'` inside a ScrollView on iOS computes to 0. Use `flex: 1` + `aspectRatio`.
- `shadow*` props in `StyleSheet.create` warn on React Native Web. Move to `Platform.select` inline.
- `Alert.alert` is unreliable on web — use inline error state.
- Custom URL schemes (`capsule://`) only work in native builds, not Expo Go.

---

## Key Files Reference

| Area | File |
|---|---|
| App entry / auth routing | `App.tsx` |
| Auth hook (session loading) | `src/hooks/useAuth.ts` |
| Session cache (use this in screens) | `src/lib/sessionStore.ts` |
| Theme / accent color | `src/context/ThemeContext.tsx` |
| Color picker component | `src/components/ColorPicker.tsx` |
| Navigation tree | `src/navigation/AppNavigator.tsx`, `AuthNavigator.tsx` |
| Supabase client | `src/lib/supabase.ts` |
| Deep links | `src/hooks/useDeepLinks.ts` |
| Push notifications (native only) | `src/hooks/usePushNotifications.native.ts` |
| Onboarding wizard | `src/screens/app/OnboardingScreen.tsx` |
| Capsule detail (~1250 lines) | `src/screens/app/CapsuleDetailScreen.tsx` |
| Unlock cron edge function | `supabase/functions/unlock-capsules/index.ts` |
| DB schema | `supabase-schema.sql` |

## Environment

```
EXPO_PUBLIC_SUPABASE_URL=...
EXPO_PUBLIC_SUPABASE_ANON_KEY=...
```

- Bundle ID: `com.markdickson.capsule`
- EAS Project ID: `2e004e6f-2e9d-4309-a172-46b6976eb3d9`
- Deep link scheme: `capsule://` (native builds only)
- No test suite or linter configured yet
