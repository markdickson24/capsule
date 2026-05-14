import { Session } from '@supabase/supabase-js';
import { Platform } from 'react-native';

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
};
