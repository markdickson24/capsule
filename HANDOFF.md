# Capsule — Agent Handoff

_Last updated: 2026-05-14_

---

## Goal

Ship a TestFlight build of **Capsule** — a time-locked photo-sharing app where groups create albums that unlock for all members simultaneously on a set date.

---

## Current Progress

### Native (iOS/Android) — Working ✓
The app loads and all core features work on device.

### Web (`npx expo start --web`) — Still loading ✗
The app still hangs on the loading spinner when run in a browser. Root cause is diagnosed but not yet fully resolved (see below).

---

## Root Cause: `supabase.auth.getSession()` Hangs on Web

When the stored access token is expired, Supabase JS v2 blocks `getSession()` on an internal `initializePromise` that waits for a network token refresh. On web this refresh can hang indefinitely. In some Supabase versions, the `INITIAL_SESSION` auth event also waits on the same promise — so both the `getSession()` call and the auth state listener can be blocked simultaneously.

**What was done:**
1. `useAuth` now uses `onAuthStateChange` + a 5-second fallback timeout via a `settle()` pattern — whichever fires first clears `loading`. This unblocked the initial spinner on native.
2. Created `src/lib/sessionStore.ts` — a module-level cache updated by `onAuthStateChange`. All 18+ `getSession()` calls across screens were replaced with `sessionStore.get()` (synchronous, never hangs).
3. The web bundle compiles cleanly (`npx expo export --platform web` succeeds).

**Still failing on web:** Despite the above, the web app still doesn't load. The exact failure point is unknown — it needs fresh console logging to determine whether:
- `useAuth` loading clears but HomeScreen/AppNavigator crashes
- `onAuthStateChange` isn't firing on web (both paths blocked)
- The user is not logged in on web (session in native SecureStore ≠ session in web localStorage)
- Supabase project is paused/unreachable from the browser

---

## What Worked

- `onAuthStateChange` fires early on web with `SIGNED_IN` even before `getSession()` resolves (confirmed in diagnostic logs)
- `useFocusEffect(...).finally(() => setLoading(false))` pattern safely clears per-screen spinners even on error
- Platform-specific files for `usePushNotifications` (`.native.ts` / `.web.ts`) stop expo-notifications web warnings at import time
- `sessionStore.get()` is the correct replacement for `getSession()` in all non-auth screens

## What Didn't Work / Gotchas

- `getUser()` — makes a live network call every time (500ms–2s). Never use it; use `sessionStore.get()` instead.
- `getSession()` in screen fetch functions — hangs on web when token is expired. Replaced everywhere with `sessionStore.get()`.
- `if (!session) return` early exits without calling `setLoading(false)` — causes stuck spinners. Always use try/finally.
- `borderColor: 'transparent'` in ProgressRing — dark artifact on iOS. Set all 4 border colors explicitly.
- `width: '33.33%'` inside ScrollView on iOS — computes to 0. Use `flex: 1` + `aspectRatio`.
- `shadow*` style props in `StyleSheet.create` — deprecated warning on React Native Web. Move to `Platform.select` inline.

---

## Next Steps (prioritized)

### 1. Diagnose the web loading failure — add temporary logging to `useAuth`

Add these logs back to narrow down which path is actually running on web:

```ts
console.log('[useAuth] starting');
// in settle(): console.log('[useAuth] settled via', source, 'session:', s ? 'found' : 'null');
// in timeout: console.log('[useAuth] timeout fired');
```

Then open the browser, check the console, and report which line appears. Possible outcomes:
- `settled via onAuthStateChange` → auth cleared, bug is in HomeScreen/AppNavigator
- `timeout fired` → both `getSession()` and `onAuthStateChange` are blocked; Supabase init is hanging
- Nothing after `starting` → something crashes before the effect runs

### 2. If timeout is firing — the Supabase init promise is fully blocked

Try replacing the Supabase client on web with `detectSessionInUrl: true` and test whether that unblocks init. Also check whether the Supabase project is paused (dashboard → project → wake it up).

### 3. If `settled via onAuthStateChange` fires but app still doesn't render

Something in `AppNavigator` or its eagerly-imported screens is crashing on web. Wrap `<AppNavigator />` and `<AuthNavigator />` in error boundaries to catch and surface the crash.

### 4. Check: is the user actually logged in on web?

Session on native is stored in `expo-secure-store`. Session on web is in `localStorage`. They are completely independent. If the user has never logged in via a browser, `onAuthStateChange` fires with `null` — the app should show `AuthNavigator` (login screen). If the user IS seeing the login screen and calling it "not loading," this is expected behavior, not a bug.

### 5. Commit all current changes

There are uncommitted staged changes across many files. Commit with message:
`"Fix web loading: sessionStore cache, onAuthStateChange settle pattern, shadow/notification web warnings"`

### 6. Server-side contribution lock enforcement (pre-TestFlight)

`contribution_lock_at` is only enforced client-side. Add a Postgres RLS policy or trigger on the `media` table that rejects inserts when `now() > contribution_lock_at`.

### 7. TestFlight build

`eas build --platform ios --profile production`. Bundle ID: `com.markdickson.capsule`, EAS Project ID: `2e004e6f-2e9d-4309-a172-46b6976eb3d9`.

---

## Key Files Reference

| Area | File |
|---|---|
| App entry / auth routing | `App.tsx` |
| Auth hook (session loading) | `src/hooks/useAuth.ts` |
| Session cache (use this in screens) | `src/lib/sessionStore.ts` |
| Theme / accent color | `src/context/ThemeContext.tsx` |
| Navigation tree | `src/navigation/AppNavigator.tsx`, `AuthNavigator.tsx` |
| Supabase client | `src/lib/supabase.ts` |
| Deep links | `src/hooks/useDeepLinks.ts` |
| Push notifications (native only) | `src/hooks/usePushNotifications.native.ts` |
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
