# Auth / Session / Platform-Split Audit — 2026-07-22

Scope: `src/hooks/useAuth.ts`, `App.tsx`, `AuthNavigator`/`AppNavigator`, `LoginScreen`/`SignUpScreen`/`WelcomeScreen`/`ResetPasswordScreen`, `src/lib/authErrors.ts`, `src/lib/sessionStore.ts`, `src/lib/supabase.ts`, `src/lib/googleAuth.ts`, `src/lib/appleAuth.ts`, `src/hooks/useDeepLinks.ts`, `src/lib/pendingJoinStash.ts` / `shareIntentStash.ts`, and every `.native.ts`/`.web.ts`/bare-`.ts` platform-split pair (`usePushNotifications`, `useShareIntent`, `purchases`, `ShareIntentProvider`, `exportCapsule`).

Branch under review: `feat/capsule-link-preview` (current HEAD `813fc09`).

---

## Findings

### AP-1 — Severity: High
**Category:** Platform-split / Monetization security
**Location:** `src/lib/purchases.native.ts:38,46` (`FALLBACK_TEST_KEY`, `apiKey()`, `configurePurchases()`)

**Description:** CLAUDE.md's "Monetization" section states as already-shipped fact: *"Its key is no longer baked into `purchases.native.ts` — the `FALLBACK_TEST_KEY` fallback was removed (C2a); `configurePurchases()` now fails closed (warns + disables purchases) when no real key is set."* The actual file on this branch still has the original, un-fixed code:

```ts
const FALLBACK_TEST_KEY = 'test_xwBdHgppptaUJEOdTaPTrluawct';

function apiKey(): string {
  const key = Platform.select({
    ios: process.env.EXPO_PUBLIC_REVENUECAT_IOS_KEY,
    android: process.env.EXPO_PUBLIC_REVENUECAT_ANDROID_KEY,
    default: undefined,
  });
  return key || FALLBACK_TEST_KEY;   // <-- still falls back
}
```
`configurePurchases()` unconditionally calls `Purchases.configure({ apiKey: apiKey() })` with no "fail closed" branch. I confirmed via `git log --all` that the fix genuinely exists — commit `1d1009f "Drop Test Store fallback key + fix logIn-failure payer gap (C2a, H4)"` on `remotes/origin/fix/payment-security-gates` — but `git merge-base --is-ancestor 1d1009f HEAD` returns false: **that commit was never merged into this branch/main.** The doc was written to describe a fix that only exists on an unmerged sibling branch.

**Impact:** If `EXPO_PUBLIC_REVENUECAT_IOS_KEY` is ever unset on a built binary (missing/misconfigured EAS secret — plausible operational failure, not just a theoretical one, since the Environment section literally says "REQUIRED" but nothing enforces it at build time), the app silently configures RevenueCat against the shared **Test Store** key instead of refusing to run. A user could then complete a fake Test Store "purchase" and have the client believe `isPro: true`. The real server-side gate (`users.subscription_tier` via the production-only webhook) would stay `'free'`, so the hard-capped limits (capsules/members/photos) are safe — but the **video-length gate is client-only by accepted design** (documented in "Tier enforcement → Accepted limitations"), so a Test-Store-faked Pro would genuinely unlock the 120s video cap for free on any build that shipped without the key. It also produces a confusing false "you're Pro" UI state.

**Suggested fix:** Merge `1d1009f` (or re-apply the same diff) into this branch: drop `FALLBACK_TEST_KEY`, make `apiKey()` return `string | undefined`, and have `configurePurchases()` warn + return early when no key is present. Separately, treat this as a signal to re-check CLAUDE.md against actual branch state before trusting "already fixed" claims for security-relevant items — grep working tree, don't just read the doc.

**Confidence:** High (verified by reading the file directly and cross-checking git history; the unmerged fix commit is unambiguous).

---

### AP-2 — Severity: Medium
**Category:** Deep links / session handling
**Location:** `src/lib/pendingJoinStash.ts` (whole file), `src/lib/shareIntentStash.ts` (whole file), `src/hooks/useDeepLinks.ts:122-136`, `src/hooks/useShareIntent.native.ts:49-62`

**Description:** Both stashes are bare module-level variables with no concept of *which* signed-out visitor stashed the data. `useDeepLinks`'s drain effect:
```ts
useEffect(() => {
  if (!session) return;
  const stashedCapsuleId = pendingJoinStash.get();
  if (!stashedCapsuleId) return;
  pendingJoinStash.clear();
  joinAndNavigate(stashedCapsuleId, session.user.id);
}, [session]);
```
fires for **whatever session next becomes truthy**, not necessarily the same person who tapped the `capsule://join/<id>` link. Neither stash is cleared on `SIGNED_OUT` (checked `useAuth.ts`'s `SIGNED_OUT` branch — it clears `cache` and `blockStore`, not these stashes) or tied to a device/browser fingerprint of the original tap.

**Impact:** On a shared or handed-off device (family tablet, a friend borrowing a phone, a demo device at a kiosk): person A, signed out, taps a `capsule://join/<id>` link and backgrounds the app before signing in. Person B then picks up the same device (app process still alive) and signs into **their own, different** account. B's sign-in silently drains the stash and joins **B** to the private capsule A intended to join — B becomes a real, permanent `capsule_members` row (`joined_at` set) and can see A's private capsule contents, without B ever having tapped anything or seen a confirmation screen. This directly contradicts the documented design premise ("Opening the link IS the consent act") — the act of *opening* was A's, but the *consent-equivalent join* is attributed to B. The `shareIntentStash` case is milder (B just finds A's shared photos pre-loaded into the Preview/capsule-picker screen, requiring an extra tap to actually upload), but is the same root cause.

**Suggested fix:** Either (a) clear both stashes on `SIGNED_OUT` (cheap, but loses the "resume after login" convenience for the *same* user's own sign-up-after-tap flow — the common case this was built for), or (b) bind the stash to a lightweight anonymous marker (e.g., a random token written to the stash at tap time and required to still be "fresh," combined with clearing on `SIGNED_OUT`) so a completed sign-in only drains a stash that was set in the *same* signed-out session. At minimum, clearing on `SIGNED_OUT` closes the cross-account handoff window without much cost, since the same physical user re-tapping the link after signing in as themselves still works fine via `Linking.getInitialURL()`/deep-link redelivery in most OS flows, or the user can just re-tap the original link/notification.

**Confidence:** Medium (logic is verified directly in code; real-world likelihood depends on shared-device usage patterns, which I can't observe from the codebase alone).

---

### AP-3 — Severity: Medium
**Category:** Deep links / error handling
**Location:** `src/hooks/useDeepLinks.ts:88-105` (`handleUrl`'s `reset-password` branch)

**Description:**
```ts
if (url.includes('reset-password')) {
  const fragment = url.includes('#') ? url.split('#')[1] : url.split('?')[1];
  if (!fragment) return;
  const params = new URLSearchParams(fragment);
  const access_token = params.get('access_token');
  const refresh_token = params.get('refresh_token');
  if (!access_token || !refresh_token) return;
  await supabase.auth.setSession({ access_token, refresh_token });   // <-- return value discarded
  navigateUntilRouteActive('ResetPassword', () => {
    (navigationRef as any).navigate('ResetPassword');
  });
  return;
}
```
`supabase.auth.setSession()` returns `{ data, error }`; the `error` is never inspected. If the recovery token is expired or already used (a very ordinary case — reset links are single-use and time-limited), `setSession` fails, no session is established, `AppNavigator`/`ResetPassword` never mounts (it's gated behind `session` being truthy in `RootNavigator`), and `navigateUntilRouteActive` silently retries for up to `40 * 250ms ≈ 10s` before giving up with only a `console.warn` — which no production user will ever see.

**Impact:** A user tapping an expired/already-used/invalid password-reset link gets total silence: the app just sits on Welcome/Login with no indication the link failed, no prompt to request a new one. This is a real, reproducible support-ticket generator ("the reset link doesn't do anything"), not a security hole, but it's a genuine deviation from graceful error handling that the rest of the auth flow (`mapAuthError`, inline `<Text>` errors) otherwise follows carefully.

**Suggested fix:** Capture `{ error }` from `setSession`; on failure, either toast (`toast.show(...)`, already used elsewhere in this codebase for background-write failures) or stash a flag consumed by `WelcomeScreen` (mirroring the existing `sessionStore.markSessionExpired()`/`consumeSessionExpired()` pattern) so the user lands somewhere with "That reset link has expired — request a new one."

**Confidence:** High (the missing error check is unambiguous in the code; the downstream silent-retry-then-give-up behavior is also directly traceable through `navigateUntilRouteActive`).

---

### AP-4 — Severity: Low
**Category:** Error-message handling / consistency
**Location:** `src/screens/auth/LoginScreen.tsx:56` (`handleForgot`), `src/screens/app/ResetPasswordScreen.tsx:32` (`handleReset`)

**Description:** Both handlers show the raw Supabase error string directly:
```ts
if (err) { setError(err.message); return; }
```
instead of routing through `mapAuthError()` the way `handleLogin`/`handleSignUp`/`handleGoogle`/`handleApple` all do elsewhere in the same files. This means "Password should be at least 6 characters" (Supabase's default copy, which conflicts with this app's client-enforced 8-char minimum) or other raw API strings could reach the user verbatim, inconsistent with the deliberate friendly-copy mapping the rest of the auth flow uses.

**Impact:** Cosmetic/UX inconsistency and minor internal-detail leakage (e.g., Supabase's exact rate-limit wording, which reveals implementation details like "you can only request this once every 60 seconds"). Not independently exploitable — Supabase's `resetPasswordForEmail` doesn't leak account-existence via its error/success shape, so this isn't an enumeration vector on its own.

**Suggested fix:** Route both through `mapAuthError(err.message).message` for consistency, or add reset/update-password-specific entries to `authErrors.ts` if the copy needs to differ from login/signup copy.

**Confidence:** High (directly visible in both files) on the code fact; Low severity is a judgment call given limited real impact.

---

### AP-5 — Severity: Informational
**Category:** OAuth / logging hygiene
**Location:** `src/lib/googleAuth.ts:28-32`

**Description:**
```ts
if (__DEV__) {
  console.log('[googleAuth] redirectTo:', redirectTo);
  console.log('[googleAuth] result.type:', result.type);
  if (result.type === 'success') console.log('[googleAuth] result.url:', result.url);
}
```
`result.url` is the full OAuth callback URL, which contains `access_token`/`refresh_token` in its query/fragment. This is gated behind `__DEV__` so it never ships in a production/TestFlight/release build, but it will appear in Metro/device logs during any local development session, and in screen recordings/screenshots of a dev console.

**Impact:** Low — dev-only, and anyone with access to a dev machine's console already has broader access. Noting for hygiene since token material in any log stream is worth minimizing on principle, and `appleAuth.ts` has no equivalent logging (worth keeping consistent).

**Suggested fix:** Redact the token portions before logging (e.g., log `url.split('#')[0]` or a boolean "tokens present") if this log line needs to stay for redirect-mismatch debugging.

**Confidence:** High on the fact; severity is inherently minor.

---

## Areas reviewed and found sound

- **`useAuth.ts` / `sessionStore.ts` / `supabase.ts` web-hang mitigation** — the documented web `getSession()`-hang trap is correctly avoided everywhere: `sessionStore.get()` is used synchronously in `AppNavigator`, `ProfileScreen`, `OnboardingScreen` (web branch), and the `accessToken` override in `supabase.ts` matches the documented pattern exactly. No stray `supabase.auth.getSession()` or `.getUser()` calls exist anywhere outside the two documented, deliberate call sites (`useAuth.ts`'s mount-time call, `supabase.ts`'s `getFreshSession()`).
- **Native upload token freshness** — every `getFreshAccessToken()`/`getFreshSession()` call site (`ProfileScreen`, `OnboardingScreen`, `uploadQueue.ts`) is correctly gated to the native (`Platform.OS !== 'web'`) branch, with the web branch using `supabase.storage`/`sessionStore.get()` as documented.
- **Sign-out / account-deletion intentionality flag** — both real sign-out call sites (`ProfileScreen.tsx:466`, `SettingsScreen.tsx:270-271`) and the delete-account flow correctly call `sessionStore.markIntentionalSignOut()` immediately before `supabase.auth.signOut()`, so the "session expired" banner on `WelcomeScreen` won't misfire for user-initiated sign-outs.
- **Apple Sign In (`appleAuth.ts`)** — raw/hashed nonce split is correct (raw nonce sent to Supabase, hashed nonce sent to Apple) and matches the standard replay-protection pattern; `fullName` capture-once-and-overwrite logic is deliberate and well-reasoned given `handle_new_user()`'s email-local-part fallback (matches CLAUDE.md's "Sign-Up Flow" section). Apple button is correctly gated to `Platform.OS === 'ios'` in both `WelcomeScreen` and `LoginScreen`.
- **Platform-split hygiene** — every `.native`/`.web`/bare-`.ts` trio checked (`usePushNotifications`, `useShareIntent`, `ShareIntentProvider`, `purchases`, `exportCapsule`) has a web stub with matching signatures and no native-only import leaking into the web bundle, and vice versa. `usePushNotifications.native.ts` correctly guards `Notifications.setNotificationHandler` behind `Platform.OS !== 'web'` at module scope.
- **No `Alert.alert` usage** anywhere in `src/` — the documented web-no-op trap has not been reintroduced.
- **`SafeAreaView`** is imported from `react-native-safe-area-context` in every screen checked (Login/SignUp/Welcome/ResetPassword) — no `react-native` import found.
- **Deep-link join flow (happy path)** — `capsule://join/<id>` correctly no-ops when already a member (`.maybeSingle()` existence check before insert), surfaces a toast on insert failure instead of navigating to a broken screen, and invalidates `capsules`/`profile` cache on success.

---

## Summary

| ID | Severity | One-liner |
|---|---|---|
| AP-1 | High | `purchases.native.ts` still ships the hardcoded Test Store fallback key CLAUDE.md claims was removed — the real fix sits unmerged on `origin/fix/payment-security-gates` |
| AP-2 | Medium | `pendingJoinStash`/`shareIntentStash` aren't cleared on sign-out or scoped per-tap, so a shared-device account handoff can silently join the wrong (second) user to a private capsule |
| AP-3 | Medium | `useDeepLinks`'s reset-password handler discards `setSession()`'s error, so expired/invalid recovery links fail completely silently |
| AP-4 | Low | `LoginScreen.handleForgot` / `ResetPasswordScreen.handleReset` show raw Supabase error text instead of routing through `mapAuthError` |
| AP-5 | Informational | `googleAuth.ts` dev-only logs the full OAuth callback URL (contains tokens) behind `__DEV__` |
