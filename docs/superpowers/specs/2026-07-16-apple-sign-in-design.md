# Apple Sign In — Design Spec

**Date:** 2026-07-16
**Status:** Approved, ready for implementation plan

## Context

Capsule already supports email/password and Google OAuth sign-in. Apple's App Store Review Guideline 4.8 requires apps that offer any third-party/social login (Google, in this case) to also offer "Sign in with Apple" as an equivalent option, on iOS. This is a compliance requirement ahead of App Store submission, not primarily a UX nice-to-have.

## Goals

- Add a native "Sign in with Apple" option on iOS, satisfying Guideline 4.8.
- Reuse the existing `{ error?: string }` auth-helper pattern (`signInWithGoogle`) so screens integrate it identically.
- Capture the display name Apple provides on first-ever authorization (it's never sent again) and surface it in onboarding rather than losing it.

## Non-goals

- No Android or web support. Apple's requirement is iOS-specific; the native button (`expo-apple-authentication`) has no equivalent on those platforms, and a web-OAuth-redirect fallback (à la Google) would add real complexity for a case Apple doesn't require.
- No account-linking logic beyond what Supabase's `signInWithIdToken` already does. This mirrors the existing Google integration, which has no explicit linking code either.
- No changes to `contribution_lock_at`/other unrelated auth flows.

## Architecture

Google's flow is a web-based OAuth redirect (`expo-auth-session` + `expo-web-browser`, opens a browser tab, parses tokens out of the redirect URL). Apple Sign In instead uses **`expo-apple-authentication`**, a native module wrapping `ASAuthorizationAppleIDProvider` — this is what gets the real native Apple auth sheet and Apple's official branded button, which App Store review expects.

Flow:
1. Generate a random nonce, SHA-256 hash it (`expo-crypto`, new dependency).
2. `AppleAuthentication.signInAsync({ requestedScopes: [FULL_NAME, EMAIL], nonce: hashedNonce })` → returns `{ identityToken, fullName, email }`.
3. `supabase.auth.signInWithIdToken({ provider: 'apple', token: identityToken, nonce: rawNonce })` — Supabase verifies the identity token's signature and nonce, creates/updates the `auth.users` row.
4. If `fullName` is present (first-ever authorization only) and the resulting `users.display_name` is still null, write the name directly to `users.display_name`.

## New file: `src/lib/appleAuth.ts`

```ts
export async function signInWithApple(): Promise<{ error?: string }>
```

Mirrors `googleAuth.ts` exactly in shape and error-surfacing convention. Internals:
- `AppleAuthentication.isAvailableAsync()` guard (false on non-Apple-ID-configured devices/older simulators) — if unavailable, return `{ error: 'Sign in with Apple is not available on this device.' }`.
- User cancel: Apple throws with `code === 'ERR_REQUEST_CANCELED'` — caught and treated as silent no-op (`{}`), same convention as Google's `result.type === 'cancel'`.
- Any other thrown error, or a Supabase `signInWithIdToken` error, surfaces as `{ error: message }`.
- On success: if `credential.fullName` has a `givenName`/`familyName`, join them into a display string; call `.update({ display_name })` on the `users` row scoped to the new session's user id, but only when reading back the just-created row shows `display_name` is still null (avoids ever overwriting a name a returning user has since customized — though in practice Apple only sends this once, so this is a defensive guard, not an expected hit).

## UI placement

Identical spot to the Google button, on the same two screens:
- `WelcomeScreen` — directly alongside the existing Google button (above the "or" divider that leads into email sign-up, same as Google is now).
- `LoginScreen` — directly alongside the existing Google button (below the divider, same position).
- **Not** on `SignUpScreen` — that screen has no Google button either (deliberately email/password only, per existing sign-up design).

Rendered only when `Platform.OS === 'ios'` — no visual gap on Android/web since there's nothing to replace; the Google button and email form just render alone there, as they do today.

Uses `expo-apple-authentication`'s own `<AppleAuthenticationButton>` component:
- `buttonType={AppleAuthenticationButtonType.SIGN_IN}`
- `buttonStyle={AppleAuthenticationButtonStyle.WHITE}` (matches the dark `#0A0A0A` screen background, visually parallel to the solid-color Google button)
- `cornerRadius={16}` (matches `googleButton`'s `borderRadius: 16`)
- `style={{ height: ... }}` sized to match the Google button's `paddingVertical: 18` visual height

No custom loading spinner needed inside the button — `signInAsync` is a modal native sheet, not a background network call users watch a spinner for; the button simply becomes non-interactive for the duration via a local `loading` state disabling `onPress`, matching how `googleLoading` already disables the Google button.

## Onboarding name pre-fill

`OnboardingScreen`'s Step 1 (`src/screens/app/OnboardingScreen.tsx:66`) currently initializes `const [displayName, setDisplayName] = useState('');` with no fetch. Add a mount-time effect that reads the current session's `users.display_name` (single-column select, cheap) and calls `setDisplayName(data.display_name)` if it's non-null and non-empty.

This covers exactly one new case (Apple-provided name, freshly written by `signInWithApple` moments before `OnboardingScreen` mounts) while leaving every other path — email signup, Google, or an Apple user who didn't grant the name scope — showing today's blank, required field. No branching in the step machine; the field stays editable and required exactly as before.

## Infra (manual, outside this codebase)

1. Apple Developer portal: enable "Sign In with Apple" capability on the `com.markdickson.capsule` App ID.
2. Supabase Dashboard → Auth → Providers → Apple: enable, set Client ID to `com.markdickson.capsule`. No Services ID/Secret Key/Team ID needed — those are only required for the web-OAuth-redirect flow, not `signInWithIdToken`.
3. `app.json` needs the `expo-apple-authentication` config plugin added to the `plugins` array (adds the native capability entitlement to the generated Xcode project).
4. Requires a fresh EAS build — `expo-apple-authentication` is a native module and won't function in Expo Go, same caveat as the existing dual-camera and share-intent features.

## Error handling

Same convention as `signInWithGoogle`: `{ error: string }` renders through each screen's existing inline `<Text style={styles.error}>` — no new error UI component needed. `WelcomeScreen`/`LoginScreen` add a `handleApple()` wrapper calling `signInWithApple()`, symmetrical to their existing `handleGoogle()`.

## Testing

No test framework in this repo (per CLAUDE.md, deliberate). Verification is:
1. `npx tsc --noEmit` for type safety after implementation.
2. A fresh EAS dev/simulator build (physical device or simulator signed into a sandbox Apple ID — the iOS Simulator supports Sign In with Apple testing with a signed-in Apple ID as of recent Xcode versions).
3. Manual click-through: tap "Sign in with Apple" on Welcome, complete the native sheet, confirm a `public.users` row is created with `display_name` set from Apple's provided name, confirm onboarding Step 1 shows that name pre-filled and editable, confirm a second sign-in (same Apple ID, existing account) logs in without re-prompting for name and without touching the already-set `display_name`.
4. Cancel path: start the flow and tap Cancel in the native sheet — confirm the screen returns to its normal state with no error text shown.

## Decisions log (from brainstorming)

| Question | Decision |
|---|---|
| Why add this now? | App Store Guideline 4.8 compliance (offering Google login without Apple login blocks review). |
| Platform scope | iOS only — no Android/web OAuth fallback. |
| Name capture vs. onboarding | Pre-fill onboarding Step 1's display-name field with Apple's name if provided; field stays editable. Everyone else sees today's blank-required behavior unchanged. |
| Button component | Apple's own native `AppleAuthenticationButton`, not a custom-styled button — guarantees HIG/App-Store visual compliance. |
| Placement | Mirrors Google exactly: Welcome + Login screens, not SignUp. |
