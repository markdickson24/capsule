import * as WebBrowser from 'expo-web-browser';
import * as AuthSession from 'expo-auth-session';
import { supabase } from './supabase';

WebBrowser.maybeCompleteAuthSession();

export async function signInWithGoogle(): Promise<{ error?: string }> {
  const redirectTo = AuthSession.makeRedirectUri();

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

  if (result.type !== 'success') {
    return result.type === 'cancel' ? {} : { error: 'Sign-in was dismissed.' };
  }

  const url = new URL(result.url);
  const accessToken = url.searchParams.get('access_token') ??
    new URLSearchParams(url.hash.slice(1)).get('access_token');
  const refreshToken = url.searchParams.get('refresh_token') ??
    new URLSearchParams(url.hash.slice(1)).get('refresh_token');

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
