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

  // PKCE. The client is configured with `flowType: 'pkce'` (src/lib/supabase.ts),
  // so signInWithOAuth appends a code_challenge and Supabase redirects back with
  // `?code=<auth code>` instead of an `#access_token=` fragment. This flow used to
  // read those tokens and hand them to setSession — that path is now unreachable
  // and has been removed rather than left as a fallback, because accepting bearer
  // tokens straight off a redirect is the exact shape the 2026-07-29 audit closed
  // (H-1, session fixation). Exchanging the code requires the code_verifier THIS
  // device stored when the flow started, so a code observed or injected by anyone
  // else is inert.
  //
  // Note on `url.searchParams` above: React Native globally overrides `URL`, and
  // its host/hostname/pathname getters only match `^https?://` — they return ''
  // for a `capsule://` URL. `protocol`, `search`/`searchParams` and `hash` are
  // scheme-agnostic, which is why reading params here works while ROUTING on
  // pathname would not (see src/lib/deepLinkRoute.ts, which hand-parses instead).
  const code = query.get('code');
  if (!code) {
    return { error: 'Could not get session from Google.' };
  }

  const { error: exchangeError } = await supabase.auth.exchangeCodeForSession(code);

  if (exchangeError) return { error: exchangeError.message };
  return {};
}
