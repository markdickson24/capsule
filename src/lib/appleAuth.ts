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
    // Defensive: never clobber a name the user already has. In practice this
    // only fires once per Apple ID (handle_new_user creates the row with
    // display_name null, and Apple never sends the name again). Single atomic
    // update (not select-then-update) — narrows the window where
    // OnboardingScreen's mount-effect read can race ahead of this write, and
    // doesn't depend on a prior read succeeding.
    await supabase
      .from('users')
      .update({ display_name: fullName })
      .eq('id', data.user.id)
      .is('display_name', null);
  }

  return {};
}
