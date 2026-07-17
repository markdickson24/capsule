import * as AppleAuthentication from 'expo-apple-authentication';
import * as Crypto from 'expo-crypto';
import { supabase } from './supabase';

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
