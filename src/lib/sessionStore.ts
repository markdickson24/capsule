import { Session } from '@supabase/supabase-js';
import { Platform } from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';

const EXPIRED_KEY = 'cap_session_expired_v1';
const ONBOARDED_KEY_PREFIX = 'cap_onboarded_v1:';
let _intentional = false;

// On web, Supabase persists the session in localStorage under
// `sb-<projectRef>-auth-token`. Read it synchronously at module load so the app
// never has to wait on the Supabase client's internal init promise — which can
// hang on web while it tries to refresh an expired token.
function readWebSessionSync(): Session | null {
  if (Platform.OS !== 'web') return null;
  if (typeof window === 'undefined' || !window.localStorage) return null;
  try {
    const url = process.env.EXPO_PUBLIC_SUPABASE_URL;
    if (!url) return null;
    const ref = new URL(url).hostname.split('.')[0];
    const raw = window.localStorage.getItem(`sb-${ref}-auth-token`);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    if (parsed && typeof parsed === 'object' && parsed.access_token && parsed.refresh_token) {
      return parsed as Session;
    }
    return null;
  } catch {
    return null;
  }
}

let _session: Session | null = readWebSessionSync();

export const sessionStore = {
  get: () => _session,
  set: (s: Session | null) => { _session = s; },

  // Call right before any user-initiated supabase.auth.signOut(). The next
  // SIGNED_OUT auth event will consume this flag and NOT mark the boot as
  // session-expired. Pair with markSessionExpired in useAuth to differentiate
  // "I tapped Sign Out" from "my refresh token died in the background."
  markIntentionalSignOut: () => { _intentional = true; },
  consumeIntentionalSignOut: () => {
    const v = _intentional;
    _intentional = false;
    return v;
  },

  // Persisted flag — survives an app cold-boot so WelcomeScreen can show a
  // "Your session expired" banner regardless of whether the bad auth state
  // hit us while the app was open or while it was backgrounded.
  markSessionExpired: async () => {
    try { await AsyncStorage.setItem(EXPIRED_KEY, '1'); } catch {}
  },
  consumeSessionExpired: async (): Promise<boolean> => {
    try {
      const v = await AsyncStorage.getItem(EXPIRED_KEY);
      if (v) await AsyncStorage.removeItem(EXPIRED_KEY);
      return v === '1';
    } catch {
      return false;
    }
  },

  // Persisted per-user flag set once the server confirms onboarded_at is set.
  // Lets AppNavigator skip the network round-trip that otherwise blocks first
  // paint on every launch for returning users — onboarded_at never un-sets in
  // practice, so a stale-true local flag is not a real-world risk.
  markOnboarded: async (userId: string) => {
    try { await AsyncStorage.setItem(`${ONBOARDED_KEY_PREFIX}${userId}`, '1'); } catch {}
  },
  wasOnboarded: async (userId: string): Promise<boolean> => {
    try { return (await AsyncStorage.getItem(`${ONBOARDED_KEY_PREFIX}${userId}`)) === '1'; } catch { return false; }
  },
};
