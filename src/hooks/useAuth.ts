import { useState, useEffect } from 'react';
import { Session } from '@supabase/supabase-js';
import { Platform } from 'react-native';
import { supabase } from '../lib/supabase';
import { sessionStore } from '../lib/sessionStore';

export function useAuth() {
  // On web, `sessionStore` has already done a synchronous localStorage read at
  // module load. Use that as the initial value and skip the loading spinner
  // entirely — Supabase's getSession()/onAuthStateChange can hang on web while
  // _initialize() waits on a token refresh, and the spinner would never clear.
  const initial = sessionStore.get();
  const [session, setSession] = useState<Session | null>(initial);
  const [loading, setLoading] = useState(Platform.OS !== 'web');

  useEffect(() => {
    let settled = Platform.OS === 'web';
    const settle = (s: Session | null) => {
      sessionStore.set(s);
      setSession(s);
      if (!settled) {
        settled = true;
        clearTimeout(timeout);
        setLoading(false);
      }
    };

    // Native safety net: if SecureStore-backed init lags, don't block forever.
    const timeout = setTimeout(() => settle(sessionStore.get()), 1500);

    supabase.auth.getSession()
      .then(({ data: { session } }) => settle(session))
      .catch(() => settle(sessionStore.get()));

    const { data: { subscription } } = supabase.auth.onAuthStateChange((_event, session) => {
      settle(session);
    });

    return () => {
      clearTimeout(timeout);
      subscription.unsubscribe();
    };
  }, []);

  return { session, loading };
}
