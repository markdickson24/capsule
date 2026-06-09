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
