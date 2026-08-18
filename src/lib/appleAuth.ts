import * as AppleAuthentication from 'expo-apple-authentication';
import * as Crypto from 'expo-crypto';
import { supabase } from './supabase';
import { reportError } from './sentry';

// Below this, a "canceled" result cannot be a human dismissing Apple's sheet —
// the sheet takes longer than this just to animate in. Treat it as a failure.
const INSTANT_CANCEL_MS = 1000;

// Shown when Sign in with Apple fails for an environment reason. It names the
// two fixes that actually work and points at the always-available fallback, so
// the button is never a dead end (App Review saw it as one).
const APPLE_UNAVAILABLE_HINT =
  'Sign in with Apple is unavailable on this device. Check that you are signed in to iCloud with two-factor authentication on, or use email instead.';

// Apple's identity token embeds a hash of the nonce we pass to signInAsync.
// We give Supabase the RAW nonce; it re-hashes and compares to the token's
// claim itself — this is what stops a captured token from being replayed.
function randomNonce(length = 32): string {
  const charset =
    '0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz';
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
    reportError(new Error('Apple auth reported unavailable'), {
      where: 'appleAuth.isAvailableAsync',
    });
    return { error: APPLE_UNAVAILABLE_HINT };
  }

  const rawNonce = randomNonce();
  const hashedNonce = await Crypto.digestStringAsync(
    Crypto.CryptoDigestAlgorithm.SHA256,
    rawNonce
  );

  // A real person needs time to read Apple's sheet and dismiss it. iOS reports
  // ASAuthorizationError 1001 (-> ERR_REQUEST_CANCELED) for a genuine cancel
  // AND for environment failures the user never even sees: no iCloud account,
  // two-factor disabled, a managed/restricted Apple ID, Screen Time limits. If
  // 1001 comes back almost instantly, the sheet was never actually presented,
  // so it is a failure — not a choice — and must not be swallowed.
  const startedAt = Date.now();

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
    if (e?.code === 'ERR_REQUEST_CANCELED') {
      const elapsed = Date.now() - startedAt;
      if (elapsed >= INSTANT_CANCEL_MS) return {}; // genuine dismissal
      // App Review 1.0(30) failed here: "Sign in with Apple does not login".
      // The tap produced no error, no session and no server request — the auth
      // logs show zero traffic in the review window — because this branch
      // returned {} and the screen rendered nothing at all.
      reportError(e, {
        where: 'appleAuth.instantCancel',
        extra: { code: e?.code, elapsedMs: elapsed },
      });
      return { error: APPLE_UNAVAILABLE_HINT };
    }
    reportError(e, { where: 'appleAuth.signInAsync', extra: { code: e?.code } });
    return { error: 'Could not sign in with Apple.' };
  }

  if (!credential.identityToken) {
    reportError(new Error('Apple credential had no identityToken'), {
      where: 'appleAuth.identityToken',
    });
    return { error: 'Could not get credentials from Apple.' };
  }

  const { data, error } = await supabase.auth.signInWithIdToken({
    provider: 'apple',
    token: credential.identityToken,
    nonce: rawNonce,
  });

  // This is the step that silently failed App Review 1.0(30) with "Sign in
  // with Apple does not login": the exchange returns a plain error object, so
  // nothing threw and nothing reached Sentry. Report it.
  //
  // The overwhelmingly common cause is server config, not this file: Supabase
  // validates the token's `aud` claim against Authentication -> Providers ->
  // Apple -> "Client IDs", and for NATIVE sign-in that value is the iOS bundle
  // id (com.markdickson.capsule), not the Services ID used by the web flow.
  // Missing it returns "Unacceptable audience in id_token".
  if (error) {
    reportError(error, {
      where: 'appleAuth.signInWithIdToken',
      extra: { status: (error as any)?.status, code: (error as any)?.code },
    });
    return { error: error.message };
  }

  // Apple sends fullName ONLY on the very first authorization ever for this
  // Apple ID + app — never again, even on a later sign-out/sign-in. Capture
  // it now or it's gone for good.
  const givenName = credential.fullName?.givenName?.trim();
  const familyName = credential.fullName?.familyName?.trim();
  const fullName = [givenName, familyName].filter(Boolean).join(' ').trim();

  if (fullName && data.user) {
    // Unconditional overwrite — safe because Apple only ever grants fullName
    // on the very first authorization, which is exactly the moment
    // handle_new_user() just inserted this row. That trigger does NOT leave
    // display_name null: it falls back to the email's local part
    // (split_part(email, '@', 1)), which for Apple's private-relay address
    // is a random-looking string (e.g. "4n66rhjb5j@privaterelay.appleid.com"
    // -> "4n66rhjb5j"). A `.is('display_name', null)` guard here would see
    // that non-null placeholder and silently no-op, leaving the relay-email
    // fragment as the user's name instead of what Apple actually gave us —
    // confirmed happening in production before this fix. There is no
    // scenario where a real user-set name could already exist at this exact
    // instant, so overwriting unconditionally is correct.
    await supabase
      .from('users')
      .update({ display_name: fullName })
      .eq('id', data.user.id);
  }

  return {};
}
