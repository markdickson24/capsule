import { useState, useEffect } from 'react';
import { Session } from '@supabase/supabase-js';
import { Platform } from 'react-native';
import { supabase } from '../lib/supabase';
import { sessionStore } from '../lib/sessionStore';
import { cache } from '../lib/cache';
import { blockStore } from '../lib/blocks';
import { pendingJoinStash } from '../lib/pendingJoinStash';
import { shareIntentStash } from '../lib/shareIntentStash';
import { setSentryUser } from '../lib/sentry';
import { uploadQueue } from '../lib/uploadQueue';
import { resetCachedFetchState } from './useCachedFetch';

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
      // Attach the user (id only) to Sentry so events are grouped per user;
      // cleared to null on sign-out. Runs on every real session update.
      setSentryUser(s?.user.id ?? null);
      if (!settled) {
        settled = true;
        clearTimeout(timeout);
        setLoading(false);
      }
    };

    // Native safety net: if SecureStore-backed init lags, don't block forever.
    // This only releases the loading spinner — it must NOT write a null
    // session (via setSession/sessionStore.set), or a signed-in user whose
    // restore is merely slow gets flashed to the Welcome/Auth screen. The
    // still-in-flight getSession() call and/or onAuthStateChange below keep
    // calling `settle` with the real session once it lands; `settle` always
    // applies session state regardless of `settled`, so late arrival still
    // swaps AuthNavigator for AppNavigator — only the loading-flip is guarded.
    const settleLoadingOnly = () => {
      if (!settled) {
        settled = true;
        clearTimeout(timeout);
        setLoading(false);
      }
    };

    const timeout = setTimeout(settleLoadingOnly, 1500);

    supabase.auth.getSession()
      .then(({ data: { session } }) => settle(session))
      .catch(() => settle(sessionStore.get()));

    const { data: { subscription } } = supabase.auth.onAuthStateChange((event, session) => {
      settle(session);
      if (event === 'SIGNED_IN' || event === 'INITIAL_SESSION') {
        // Warm the block list so content is filtered before screens mount.
        if (session) blockStore.refresh();
      }
      if (event === 'SIGNED_OUT') {
        cache.clear();
        blockStore.clear();
        // A shared/handed-off device: don't let the next signed-in user drain
        // this user's stashed capsule-join or shared-media intent.
        pendingJoinStash.clear();
        shareIntentStash.clear();
        // Same shared-device concern as the stashes above, for two more
        // pieces of module-level state that don't scope themselves to a
        // session on their own — see the "real defense" identity checks in
        // each module (uploadQueue.runTask's userId check, useCachedFetch's
        // fetchOnce userId check) for why this clearing is defense-in-depth
        // rather than the only thing standing between users' data. Clears
        // this user's queued/failed upload tiles + dedup caches, and drops
        // any in-flight useCachedFetch request so it can't write this
        // user's data into the (not user-scoped) shared cache after the
        // next user has already signed in.
        uploadQueue.reset();
        resetCachedFetchState();
        // If the user didn't trigger this (Sign Out button / account deletion),
        // mark the boot so WelcomeScreen can show a "session expired" banner.
        if (!sessionStore.consumeIntentionalSignOut()) {
          sessionStore.markSessionExpired();
        }
      }
    });

    return () => {
      clearTimeout(timeout);
      subscription.unsubscribe();
    };
  }, []);

  return { session, loading };
}
