# Apple Sign In Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add native "Sign in with Apple" on iOS to Welcome and Login screens, satisfying App Store Guideline 4.8, with the same `{ error?: string }` helper pattern as the existing Google sign-in.

**Architecture:** `expo-apple-authentication` (native module) generates a signed identity token via Apple's native auth sheet; `supabase.auth.signInWithIdToken({ provider: 'apple', ... })` exchanges it for a Supabase session. A nonce (raw + SHA-256-hashed via `expo-crypto`) prevents replay. Apple's one-time full-name grant is written straight to `users.display_name` and later read back by `OnboardingScreen` to pre-fill Step 1.

**Tech Stack:** React Native + Expo ~54, `expo-apple-authentication` (new), `expo-crypto` (new), Supabase JS `signInWithIdToken`.

## Global Constraints

- iOS only — every new UI element is gated on `Platform.OS === 'ios'`. No Android/web code paths.
- New auth helper (`src/lib/appleAuth.ts`) returns `Promise<{ error?: string }>`, matching `signInWithGoogle`'s exact shape — screens consume it identically.
- Never overwrite an existing non-null `users.display_name` with Apple's name (defensive guard, even though Apple only ever sends it once).
- No test framework in this repo (deliberate, per CLAUDE.md) — verification is `npx tsc --noEmit` plus manual device/simulator testing (native module, doesn't run in Expo Go).
- Dark theme tokens throughout: background `#0A0A0A`, matching the existing Google button's `borderRadius: 16`.

---

### Task 1: Install dependencies and register the config plugin

**Files:**
- Modify: `package.json`, `package-lock.json` (via `npx expo install`)
- Modify: `app.json:46-97` (plugins array)

**Interfaces:**
- Produces: `expo-apple-authentication` and `expo-crypto` importable from any file in later tasks.

- [ ] **Step 1: Install the packages at Expo-SDK-compatible versions**

```bash
npx expo install expo-apple-authentication expo-crypto
```

Expected: `package.json` gains two new entries under `dependencies` (versions auto-resolved for Expo SDK 54 — do not hand-edit the version strings `expo install` picks).

- [ ] **Step 2: Register the config plugin**

In `app.json`, add `"expo-apple-authentication"` to the `plugins` array (`app.json:46`). It needs no config object — the plugin adds the `com.apple.developer.applesignin` entitlement automatically. Insert it anywhere in the array; alphabetical-ish grouping isn't enforced elsewhere in this file, so just append after `"expo-web-browser"`:

```json
"expo-web-browser",
"expo-apple-authentication",
[
  "expo-share-intent",
```

- [ ] **Step 3: Verify install**

Run: `npx tsc --noEmit`
Expected: no new errors (nothing imports the packages yet).

- [ ] **Step 4: Commit**

```bash
git add package.json package-lock.json app.json
git commit -m "Add expo-apple-authentication and expo-crypto dependencies"
```

---

### Task 2: Create the Apple auth helper

**Files:**
- Create: `src/lib/appleAuth.ts`

**Interfaces:**
- Consumes: `supabase` from `./supabase` (existing client, same instance `googleAuth.ts` uses).
- Produces: `export async function signInWithApple(): Promise<{ error?: string }>` — consumed by `WelcomeScreen` and `LoginScreen` in Tasks 3–4.

- [ ] **Step 1: Write the helper**

```ts
// src/lib/appleAuth.ts
import * as AppleAuthentication from 'expo-apple-authentication';
import * as Crypto from 'expo-crypto';
import { supabase } from './supabase';

// Apple's identity token embeds a hash of the nonce we pass to signInAsync.
// We give Supabase the RAW nonce; it re-hashes and compares to the token's
// claim itself — this is what stops a captured token from being replayed.
function randomNonce(length = 32): string {
  const charset =
    '0123456789ABCDEFGHIJKLMNOPQRSTUVXYZabcdefghijklmnopqrstuvwxyz';
  const bytes = Crypto.getRandomBytes(length);
  let result = '';
  for (let i = 0; i < length; i++) {
    result += charset[bytes[i] % charset.length];
  }
  return result;
}

export async function signInWithApple(): Promise<{ error?: string }> {
  const available = await AppleAuthentication.isAvailableAsync();
  if (!available) {
    return { error: 'Sign in with Apple is not available on this device.' };
  }

  const rawNonce = randomNonce();
  const hashedNonce = await Crypto.digestStringAsync(
    Crypto.CryptoDigestAlgorithm.SHA256,
    rawNonce
  );

  let credential: Awaited<ReturnType<typeof AppleAuthentication.signInAsync>>;
  try {
    credential = await AppleAuthentication.signInAsync({
      requestedScopes: [
        AppleAuthentication.AppleAuthenticationScope.FULL_NAME,
        AppleAuthentication.AppleAuthenticationScope.EMAIL,
      ],
      nonce: hashedNonce,
    });
  } catch (e: any) {
    // User dismissed the native sheet — silent no-op, same convention as
    // signInWithGoogle's result.type === 'cancel'.
    if (e?.code === 'ERR_REQUEST_CANCELED') return {};
    return { error: 'Could not sign in with Apple.' };
  }

  if (!credential.identityToken) {
    return { error: 'Could not get credentials from Apple.' };
  }

  const { data, error } = await supabase.auth.signInWithIdToken({
    provider: 'apple',
    token: credential.identityToken,
    nonce: rawNonce,
  });

  if (error) return { error: error.message };

  // Apple sends fullName ONLY on the very first authorization ever for this
  // Apple ID + app — never again, even on a later sign-out/sign-in. Capture
  // it now or it's gone for good.
  const givenName = credential.fullName?.givenName?.trim();
  const familyName = credential.fullName?.familyName?.trim();
  const fullName = [givenName, familyName].filter(Boolean).join(' ').trim();

  if (fullName && data.user) {
    const { data: existing } = await supabase
      .from('users')
      .select('display_name')
      .eq('id', data.user.id)
      .single();

    // Defensive: never clobber a name the user already has. In practice
    // this only fires once per Apple ID (handle_new_user creates the row
    // with display_name null, and Apple never sends the name again).
    if (existing && !existing.display_name) {
      await supabase
        .from('users')
        .update({ display_name: fullName })
        .eq('id', data.user.id);
    }
  }

  return {};
}
```

- [ ] **Step 2: Verify types**

Run: `npx tsc --noEmit`
Expected: no errors. If `signInWithIdToken` isn't recognized, check the installed `@supabase/supabase-js` version supports it (it has since v2.x — this repo is on `^2.105.3`, so it will).

- [ ] **Step 3: Commit**

```bash
git add src/lib/appleAuth.ts
git commit -m "Add signInWithApple helper (native Sign in with Apple + Supabase exchange)"
```

---

### Task 3: Add the Apple button to WelcomeScreen

**Files:**
- Modify: `src/screens/auth/WelcomeScreen.tsx`

**Interfaces:**
- Consumes: `signInWithApple` from `../../lib/appleAuth` (Task 2).

- [ ] **Step 1: Add imports**

In `src/screens/auth/WelcomeScreen.tsx`, change the react-native import (line 3) to include `Platform`:

```tsx
import { View, Text, StyleSheet, TouchableOpacity, Platform } from 'react-native';
```

Add two new imports after the existing `signInWithGoogle` import (line 8):

```tsx
import { signInWithGoogle } from '../../lib/googleAuth';
import { signInWithApple } from '../../lib/appleAuth';
import * as AppleAuthentication from 'expo-apple-authentication';
```

- [ ] **Step 2: Add state and handler**

After `const [googleLoading, setGoogleLoading] = useState(false);` (line 16), add:

```tsx
const [appleLoading, setAppleLoading] = useState(false);
```

After `handleGoogle` (ends line 30), add:

```tsx
async function handleApple() {
  if (appleLoading) return;
  setAppleLoading(true);
  setError('');
  const { error: err } = await signInWithApple();
  if (err) setError(err);
  setAppleLoading(false);
}
```

- [ ] **Step 3: Render the button**

In the `actions` View, immediately before the existing Google `TouchableOpacity` (line 55), add — Apple's own guidelines call for it to be at least as prominent as other sign-in options, so it renders first:

```tsx
{Platform.OS === 'ios' && (
  <AppleAuthentication.AppleAuthenticationButton
    buttonType={AppleAuthentication.AppleAuthenticationButtonType.SIGN_IN}
    buttonStyle={AppleAuthentication.AppleAuthenticationButtonStyle.WHITE}
    cornerRadius={16}
    style={styles.appleButton}
    onPress={handleApple}
  />
)}

<TouchableOpacity style={styles.googleButton} onPress={handleGoogle} disabled={googleLoading}>
```

(The existing `googleButton` TouchableOpacity and everything inside it is unchanged — only the new block is inserted above it.)

- [ ] **Step 4: Add the style**

In `styles` (the `StyleSheet.create` block), add after `googleButton`/`googleButtonText` (around line 151):

```tsx
appleButton: {
  width: '100%',
  height: 56,
},
```

- [ ] **Step 5: Verify types**

Run: `npx tsc --noEmit`
Expected: no errors.

- [ ] **Step 6: Commit**

```bash
git add src/screens/auth/WelcomeScreen.tsx
git commit -m "Add Sign in with Apple button to WelcomeScreen"
```

---

### Task 4: Add the Apple button to LoginScreen

**Files:**
- Modify: `src/screens/auth/LoginScreen.tsx`

**Interfaces:**
- Consumes: `signInWithApple` from `../../lib/appleAuth` (Task 2). `Platform` is already imported (line 5).

- [ ] **Step 1: Add imports**

After `import { signInWithGoogle } from '../../lib/googleAuth';` (line 12), add:

```tsx
import { signInWithGoogle } from '../../lib/googleAuth';
import { signInWithApple } from '../../lib/appleAuth';
import * as AppleAuthentication from 'expo-apple-authentication';
```

- [ ] **Step 2: Add state and handler**

After `const [googleLoading, setGoogleLoading] = useState(false);` (line 22), add:

```tsx
const [appleLoading, setAppleLoading] = useState(false);
```

After `handleGoogle` (ends line 63), add:

```tsx
async function handleApple() {
  if (appleLoading) return;
  setAppleLoading(true);
  setError('');
  const { error: err } = await signInWithApple();
  if (err) setError(err);
  setAppleLoading(false);
}
```

- [ ] **Step 3: Render the button**

Immediately before the existing Google `TouchableOpacity` (line 160, right after the `divider` View closes), add:

```tsx
{Platform.OS === 'ios' && (
  <AppleAuthentication.AppleAuthenticationButton
    buttonType={AppleAuthentication.AppleAuthenticationButtonType.SIGN_IN}
    buttonStyle={AppleAuthentication.AppleAuthenticationButtonStyle.WHITE}
    cornerRadius={16}
    style={styles.appleButton}
    onPress={handleApple}
  />
)}

<TouchableOpacity style={styles.googleButton} onPress={handleGoogle} disabled={googleLoading}>
```

- [ ] **Step 4: Add the style**

In `styles`, add after `googleButton`/`googleButtonText` (around line 235):

```tsx
appleButton: {
  width: '100%',
  height: 56,
},
```

- [ ] **Step 5: Verify types**

Run: `npx tsc --noEmit`
Expected: no errors.

- [ ] **Step 6: Commit**

```bash
git add src/screens/auth/LoginScreen.tsx
git commit -m "Add Sign in with Apple button to LoginScreen"
```

---

### Task 5: Pre-fill onboarding display name from Apple

**Files:**
- Modify: `src/screens/app/OnboardingScreen.tsx`

**Interfaces:**
- Consumes: `sessionStore.get()` (already imported, line 16), `supabase` (already imported, line 15) — both pre-existing imports, no new ones needed.

- [ ] **Step 1: Add the mount-time fetch**

In `src/screens/app/OnboardingScreen.tsx`, after the `avatarUrlPromise` ref declaration (line 70, right before the `// Screen 2` comment), add:

```tsx
const avatarUrlPromise = useRef<Promise<string | null> | null>(null);

// If the user just signed in via Apple and granted the name scope for the
// first time, signInWithApple() already wrote it to users.display_name —
// read it back so Step 1 opens pre-filled instead of blank. No-op (stays
// blank, required) for every other path: email signup, Google, or a
// returning Apple user who wasn't granted the name this time.
useEffect(() => {
  const session = sessionStore.get();
  if (!session) return;
  supabase
    .from('users')
    .select('display_name')
    .eq('id', session.user.id)
    .single()
    .then(({ data }) => {
      if (data?.display_name) setDisplayName(data.display_name);
    });
}, []);

// Screen 2
```

- [ ] **Step 2: Verify types**

Run: `npx tsc --noEmit`
Expected: no errors.

- [ ] **Step 3: Commit**

```bash
git add src/screens/app/OnboardingScreen.tsx
git commit -m "Pre-fill onboarding display name from Apple's one-time name grant"
```

---

### Task 6: Full verification pass

**Files:** none (verification only)

- [ ] **Step 1: Full typecheck**

Run: `npx tsc --noEmit`
Expected: zero errors across the whole project.

- [ ] **Step 2: Read back all 4 changed/created files in full**

Re-read `src/lib/appleAuth.ts`, `src/screens/auth/WelcomeScreen.tsx`, `src/screens/auth/LoginScreen.tsx`, `src/screens/app/OnboardingScreen.tsx` top-to-bottom. Confirm:
- Both screens' Apple button is inside a `Platform.OS === 'ios'` guard.
- Neither screen's existing Google/email logic was altered — only additions.
- `appleAuth.ts`'s cancel-path returns `{}` (not an error) and the non-null-guard on `display_name` is present before the update call.
- `OnboardingScreen`'s new effect has an empty dependency array (mount-only) and does not touch `saveProfile`, `goStep2`, or any other existing function.

- [ ] **Step 3: Report**

No commit for this task (verification only) — report the typecheck result and confirm the manual EAS-build checklist below to the user.

---

## Manual verification checklist (post-plan, requires a fresh EAS build — native module, won't run in Expo Go)

1. Build: `eas build --platform ios --profile development` (or an existing dev-client build if credentials/capability were just added — may need a fresh build to pick up the new entitlement).
2. On Welcome screen: tap "Sign in with Apple", complete the native sheet with a real or sandbox Apple ID, grant the name if prompted.
3. Confirm the app lands in Onboarding Step 1 with the display name pre-filled and still editable.
4. Complete onboarding, sign out, sign back in with the same Apple ID — confirm no name-grant prompt appears (Apple only asks once) and login still succeeds.
5. On Login screen (a second, different test account): tap "Sign in with Apple", tap Cancel in the native sheet — confirm the screen returns to normal with no error text shown.
6. Confirm the button does not appear at all when running on Android or web.
