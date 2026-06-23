import * as WebBrowser from 'expo-web-browser';
import * as AuthSession from 'expo-auth-session';
import { supabase } from './supabase';

WebBrowser.maybeCompleteAuthSession();

export async function signInWithGoogle(): Promise<{ error?: string }> {
  // Pin the scheme explicitly. The iOS Info.plist registers two URL schemes
  // (`capsule` and `com.markdickson.capsule`); without this, makeRedirectUri()
  // can pick either, and a mismatch with the Supabase Redirect URL allow-list
  // makes Supabase silently drop the redirect (browser closes, no session).
  const redirectTo = AuthSession.makeRedirectUri({ scheme: 'capsule' });

  const { data, error } = await supabase.auth.signInWithOAuth({
    provider: 'google',
    options: {
      redirectTo,
      skipBrowserRedirect: true,
    },
  });

  if (error || !data.url) {
    return { error: error?.message ?? 'Could not start Google sign-in.' };
  }

  const result = await WebBrowser.openAuthSessionAsync(data.url, redirectTo);

  if (__DEV__) {
    console.log('[googleAuth] redirectTo:', redirectTo);
    console.log('[googleAuth] result.type:', result.type);
    if (result.type === 'success') console.log('[googleAuth] result.url:', result.url);
  }

  if (result.type !== 'success') {
    return result.type === 'cancel' ? {} : { error: 'Sign-in was dismissed.' };
  }

  const url = new URL(result.url);
  const query = url.searchParams;
  const hash = new URLSearchParams(url.hash.slice(1));

  // Surface the real failure instead of swallowing it. When Supabase can't honor
  // the redirect (provider disabled, redirect not allow-listed, etc.) it returns
  // here with `error`/`error_description` rather than tokens — without this the
  // user just bounces back to login with no idea why.
  const oauthError = query.get('error_description') ?? query.get('error') ??
    hash.get('error_description') ?? hash.get('error');
  if (oauthError) {
    return { error: decodeURIComponent(oauthError.replace(/\+/g, ' ')) };
  }

  const accessToken = query.get('access_token') ?? hash.get('access_token');
  const refreshToken = query.get('refresh_token') ?? hash.get('refresh_token');

  if (!accessToken || !refreshToken) {
    return { error: 'Could not get session from Google.' };
  }

  const { error: sessionError } = await supabase.auth.setSession({
    access_token: accessToken,
    refresh_token: refreshToken,
  });

  if (sessionError) return { error: sessionError.message };
  return {};
}
