---
paths:
  - "src/hooks/useAuth.ts"
  - "src/lib/supabase.ts"
  - "src/lib/sessionStore.ts"
  - "src/lib/googleAuth.ts"
  - "src/lib/appleAuth.ts"
  - "src/lib/authErrors.ts"
  - "src/screens/auth/**"
  - "src/screens/app/ResetPasswordScreen.tsx"
  - "App.tsx"
---

<!-- Moved verbatim from CLAUDE.md. Loads automatically when Claude reads a file matching `paths`. -->

## Auth Flow

`useAuth` (`src/hooks/useAuth.ts`) listens to `supabase.auth.onAuthStateChange`. `App.tsx` renders `AuthNavigator` or `AppNavigator` based on session presence. Loading state blocks rendering until session is confirmed (Supabase session restore is async).

**Auth methods:** email/password (`supabase.auth.signInWithPassword`) and Google OAuth (`src/lib/googleAuth.ts` — uses `expo-auth-session` + `expo-web-browser`, reads `?code=` off the redirect URL and calls `supabase.auth.exchangeCodeForSession`). **The client is configured `flowType: 'pkce'`** — see "Deep links" for why, and for the one-line change that would break both Google sign-in and password reset at once.

**Platform split in `src/lib/supabase.ts`:** on web, Supabase uses `localStorage` (default). On native, `expo-secure-store` is used via a custom async adapter. Do not use the async adapter on web — it causes the JWT to not be attached to requests.

⚠️ **The native SecureStore adapter writes with `keychainAccessible: AFTER_FIRST_UNLOCK`, and must keep doing so.** expo-secure-store defaults to `WHEN_UNLOCKED`, which makes the keychain item unreadable **while the device is locked** — SecureStore throws `User interaction is not allowed`, the auth client sees no stored session, and the user lands on Welcome as if signed out. Confirmed in production: a `getValueWithKeyAsync` failure with `screen: Welcome` in the same Sentry trace. The app reads the session precisely when the device tends to be locked — a push tap, a Live Activity tap from the lock screen, and the background `autoRefreshToken` timer. ⚠️ **Accessibility is fixed when the item is WRITTEN**, so this is not retroactive: an install that stored its session under `WHEN_UNLOCKED` keeps that until the session is next written (sign-in, or a refresh while unlocked). `getItem` also catches and returns null rather than throwing, so a failed read degrades to "signed out" instead of an unhandled exception, and reports through `reportError`.


**Always use `getSession()` instead of `getUser()`** when you just need the user ID or token. `getUser()` makes a live network request on every call (500ms–2s latency). `getSession()` reads from local storage instantly.

**Email OTP confirmation (`SignUpScreen`)** — signup verifies the email with a **6-digit code**, not a magic link. When `supabase.auth.signUp` succeeds with `data.session === null` (email confirmation required), the screen replaces the whole form with a `pendingEmail` code-entry state: shows the email, a **6-digit `TextInput`** (`textContentType="oneTimeCode"`, auto-submits at 6 digits via `onOtpChange` → `handleVerify`), a "Verify & continue" button, a "Resend code" button (`supabase.auth.resend({ type: 'signup', email })`, 60s cooldown), and a "Use a different email" link that resets to the form. `handleVerify(code)` calls **`supabase.auth.verifyOtp({ email, token: code, type: 'signup' })`** — on success this sets the session, so `useAuth`'s `onAuthStateChange` swaps `AuthNavigator` → `AppNavigator` → Onboarding automatically, with **no separate Login step** (the old flow required tapping an emailed link in a browser, then manually signing in). A wrong/expired code shows an inline error and clears the input. **This requires the Supabase "Confirm signup" email template to emit `{{ .Token }}`** (the code) — the default template only sends `{{ .ConfirmationURL }}` (a link); keep both in the template so already-installed older app builds (which expected a link) still work during rollout. `AuthStackParamList['Login']` is still `{ email?: string } | undefined` (`LoginScreen` seeds its email from `route.params?.email`) — used by the "already registered → Sign in instead" path. Auth error strings are mapped through `mapAuthError` (`src/lib/authErrors.ts`); "already registered" renders a tappable "Sign in instead" link.

## Sign-Up Flow

`SignUpScreen` collects only email and password — **no display name**. Display name is collected in Onboarding Step 1 (the first screen after sign-up). This avoids asking for the name twice.

**`handle_new_user` does NOT leave `display_name` null** — this doc previously claimed it did, which was wrong and caused a real bug (see "Apple Sign In" → name auto-fill). The live trigger is `coalesce(new.raw_user_meta_data->>'display_name', split_part(coalesce(new.email, new.phone, 'user'), '@', 1))` — with no `display_name` key in `raw_user_meta_data` (true for email signup, Google, and Apple), it falls back to the **local part of the email**. For a normal email signup this is harmless today only because nothing reads `users.display_name` back before `OnboardingScreen`'s own `saveProfile()` overwrites it — the local `displayName` state starts blank (`useState('')`) regardless of what's in the DB. Any new code that reads `users.display_name` before onboarding completes (like Apple Sign In's pre-fill) **will** see this fallback value, not null. For Apple's private-relay email (`4n66rhjb5j@privaterelay.appleid.com`) that fallback is a random-looking string — exactly what a real user saw in production before this was fixed.

## Web Auth Gotchas

`supabase.auth.getSession()` on web hangs indefinitely when the stored access token is expired and the refresh network call is slow or blocked. The Supabase internal `initializePromise` does not resolve until the refresh completes, so both `getSession()` and the `INITIAL_SESSION` auth event can be blocked simultaneously.

**Pattern to use everywhere:**
```ts
// WRONG — hangs on web if token is expired
const { data: { session } } = await supabase.auth.getSession();

// RIGHT — reads cached session set by onAuthStateChange, synchronous
import { sessionStore } from '../../lib/sessionStore';
const session = sessionStore.get();
```

`sessionStore` (`src/lib/sessionStore.ts`) seeds itself synchronously on web by reading Supabase's `sb-<projectRef>-auth-token` entry from `localStorage` at module load. This means `sessionStore.get()` returns the persisted session before Supabase has finished its async init — so the app never has to wait on `initializePromise`.

`useAuth` (`src/hooks/useAuth.ts`) uses that synchronous seed: on web, `loading` starts as `false` and the initial `session` comes straight from `sessionStore`, so the root spinner never blocks. On native, a 1.5s fallback timeout forces `loading` off in case SecureStore-backed init lags. `onAuthStateChange` then updates state when Supabase eventually catches up.

**Push notifications on web:** `expo-notifications` triggers side effects at import time that warn on web. Solved with platform-specific files:
- `usePushNotifications.native.ts` — full implementation (native only)
- `usePushNotifications.web.ts` — no-op stub (web)
- `usePushNotifications.ts` — no-op stub (TypeScript resolution fallback)

**Shadow props on web:** `shadowColor`, `shadowOpacity`, `shadowRadius`, `shadowOffset` are deprecated in React Native Web. Wrap in `Platform.select({ default: { shadow... }, web: {} })` applied as an inline style override, and remove from `StyleSheet.create`.
