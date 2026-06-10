import { createClient } from '@supabase/supabase-js';
import * as SecureStore from 'expo-secure-store';
import { Platform } from 'react-native';
import { sessionStore } from './sessionStore';
import type { Database } from '../types/supabase';

const supabaseUrl = process.env.EXPO_PUBLIC_SUPABASE_URL!;
const supabaseAnonKey = process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY!;

const authOptions =
  Platform.OS === 'web'
    ? {
        autoRefreshToken: true,
        persistSession: true,
        detectSessionInUrl: false,
      }
    : {
        storage: {
          getItem: (key: string) => SecureStore.getItemAsync(key),
          setItem: (key: string, value: string) => SecureStore.setItemAsync(key, value),
          removeItem: (key: string) => SecureStore.deleteItemAsync(key),
        },
        autoRefreshToken: true,
        persistSession: true,
        detectSessionInUrl: false,
      };

export const supabase = createClient<Database>(supabaseUrl, supabaseAnonKey, {
  auth: authOptions,
});

// On web, the Supabase auth client's internal _initialize() can hang on a stuck
// token-refresh fetch. Because every supabase.from(...)/storage call routes
// through _getAccessToken() → auth.getSession() → initializePromise, that hang
// freezes every data-fetching screen. Override accessToken post-construction so
// _getAccessToken short-circuits to our synchronous sessionStore. Setting it
// here (rather than in the constructor settings) keeps supabase.auth.* working
// — the throwing Proxy is only installed when accessToken is in the settings
// object at construction time.
if (Platform.OS === 'web') {
  (supabase as any).accessToken = async () =>
    sessionStore.get()?.access_token ?? supabaseAnonKey;
}

// Returns a guaranteed-fresh access token for raw native uploads
// (FileSystem.uploadAsync), which attach the bearer manually and therefore
// bypass the JS client's automatic refresh. The cached sessionStore token can
// be stale if the app sat idle/backgrounded past the 1h token lifetime —
// storage-api then rejects the upload with HTTP 400 "jwt expired". On native,
// getSession() refreshes an expired token before returning; do NOT call this on
// web, where getSession() can hang on a stuck refresh (see accessToken override
// above). Web uploads go through supabase.storage, which refreshes on its own.
export async function getFreshAccessToken(): Promise<string> {
  return (await getFreshSession()).accessToken;
}

// Like getFreshAccessToken, but also returns the user id from the SAME session.
// Use this when building a storage path that must match `auth.uid()` (e.g. the
// avatars bucket's RLS check `auth.uid()::text = foldername[1]`). Deriving the
// path's user id from any other source (a cached profile row, etc.) risks a
// mismatch with the bearer token's subject → "new row violates row-level
// security policy". Native only, for the same reason as getFreshAccessToken.
export async function getFreshSession(): Promise<{ accessToken: string; userId: string }> {
  const { data, error } = await supabase.auth.getSession();
  const session = data.session;
  if (error || !session?.access_token) {
    throw new Error('Your session expired. Sign in again to continue.');
  }
  return { accessToken: session.access_token, userId: session.user.id };
}
