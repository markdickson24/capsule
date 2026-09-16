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

<!-- Trimmed from the original CLAUDE.md; backstory kept in HTML comments. Loads automatically when Claude reads a file matching `paths`. -->

## Auth Flow

`useAuth` (`src/hooks/useAuth.ts`) listens to `supabase.auth.onAuthStateChange`; `App.tsx` renders `AuthNavigator`/`AppNavigator` by session presence, blocking render until session is confirmed.

**Auth methods:** email/password (`supabase.auth.signInWithPassword`) and Google OAuth (`src/lib/googleAuth.ts`, via `expo-auth-session`/`expo-web-browser`, reads `?code=` off the redirect, calls `supabase.auth.exchangeCodeForSession`). Client is `flowType: 'pkce'` (see "Deep links") — changing it breaks both Google sign-in and password reset.

**Platform split (`src/lib/supabase.ts`):** web uses `localStorage`; native uses `expo-secure-store` via a custom async adapter. Never use the async adapter on web — JWT won't attach to requests.

⚠️ **Native SecureStore writes must use `keychainAccessible: AFTER_FIRST_UNLOCK`**, not the `WHEN_UNLOCKED` default, which is unreadable while the device is locked (throws `User interaction is not allowed`) — exactly when session reads happen most (push tap, Live Activity tap, background `autoRefreshToken`). Confirmed in production: a `getValueWithKeyAsync` failure with `screen: Welcome` in the same Sentry trace. Fix applies only on the next WRITE (sign-in or refresh-while-unlocked), not retroactively. `getItem` catches and returns null instead of throwing, reporting via `reportError`.

**Use `getSession()`, never `getUser()`**, for user ID/token — `getUser()` is a live network call (500ms–2s); `getSession()` reads local storage instantly.

**Email OTP (`SignUpScreen`)** — signup verifies via a **6-digit code**, not a magic link. `data.session === null` from `supabase.auth.signUp` shows a `pendingEmail` state: 6-digit `TextInput` (`textContentType="oneTimeCode"`, auto-submits via `onOtpChange` → `handleVerify`), "Resend code" (`supabase.auth.resend({ type: 'signup', email })`, 60s cooldown), "Use a different email". `handleVerify(code)` calls `supabase.auth.verifyOtp({ email, token: code, type: 'signup' })` — success sets the session, `useAuth` swaps navigators automatically, **no separate Login step**. Requires the "Confirm signup" email template to emit `{{ .Token }}` (default only sends `{{ .ConfirmationURL }}` — keep both for older builds). `AuthStackParamList['Login']` stays `{ email?: string } | undefined` (`LoginScreen` seeds from `route.params?.email`) for "Sign in instead". Errors map through `mapAuthError` (`src/lib/authErrors.ts`).

## Sign-Up Flow

`SignUpScreen` collects only email + password — no display name (collected in Onboarding Step 1, to avoid asking twice).

**`handle_new_user` does NOT leave `display_name` null** — trigger is `coalesce(new.raw_user_meta_data->>'display_name', split_part(coalesce(new.email, new.phone, 'user'), '@', 1))`, falling back to the **email's local part** when no `display_name` key exists (true for email/Google/Apple signup). Harmless for email signup only because nothing reads `users.display_name` before `OnboardingScreen.saveProfile()` overwrites it (local `displayName` state starts blank via `useState('')`). Code reading `users.display_name` before onboarding completes **will** see this fallback — e.g. Apple's private-relay email (`4n66rhjb5j@privaterelay.appleid.com`) yields a random-looking string.
<!-- History: this doc previously wrongly claimed display_name stayed null; caused a real bug in Apple Sign In's name auto-fill. -->

## Web Auth Gotchas

`supabase.auth.getSession()` hangs on web when the stored token is expired and the refresh call is slow/blocked — Supabase's `initializePromise` won't resolve until refresh completes, blocking both `getSession()` and `INITIAL_SESSION`.

**Pattern:**
```ts
// WRONG — hangs on web if token is expired
const { data: { session } } = await supabase.auth.getSession();

// RIGHT — reads cached session set by onAuthStateChange, synchronous
import { sessionStore } from '../../lib/sessionStore';
const session = sessionStore.get();
```

`sessionStore` (`src/lib/sessionStore.ts`) seeds synchronously on web from `sb-<projectRef>-auth-token` in `localStorage` at module load, returning the persisted session before Supabase finishes init.

`useAuth`: web `loading` starts `false`, initial session from `sessionStore`. Native: 1.5s fallback timeout forces `loading` off if SecureStore init lags. `onAuthStateChange` updates state once Supabase catches up.

**Push notifications on web:** `expo-notifications` warns at import time — split via platform files: `usePushNotifications.native.ts` (full impl), `usePushNotifications.web.ts` (no-op), `usePushNotifications.ts` (TS fallback stub).

**Shadow props on web:** `shadowColor`/`shadowOpacity`/`shadowRadius`/`shadowOffset` are deprecated in RN Web — wrap in `Platform.select({ default: { shadow... }, web: {} })`, remove from `StyleSheet.create`.
