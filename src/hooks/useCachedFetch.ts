import { useState, useEffect, useCallback, useRef } from 'react';
import { useFocusEffect } from '@react-navigation/native';
import { cache } from '../lib/cache';
import { sessionStore } from '../lib/sessionStore';

// Module-level in-flight request registry, shared across every useCachedFetch
// instance. Collapses N simultaneous callers of the same key (e.g. every
// mounted consumer reacting to one cache.invalidate(key) call) into a single
// network request instead of N duplicate ones.
const inFlight = new Map<string, Promise<unknown>>();

// Clear-on-sign-out half of the shared-device fix (the other half is the
// userId check in fetchOnce below, which is the real defense and holds even
// if this is ever skipped). Called from useAuth's SIGNED_OUT branch
// alongside cache.clear(). None of these keys (`capsules`, `capsule:<id>`,
// `notifications`, `awards:<id>`, ...) are user-scoped, so a request issued
// under the departing user's bearer token that resolves after sign-out must
// not be allowed to write its result back into a shared cache the next
// signed-in user will read as authoritative. Dropping the in-flight entry
// means a late-resolving old promise fails its own identity check
// (`inFlight.get(key) === promise`) in fetchOnce and never writes to cache;
// a fresh fetchOnce call for the same key (from the next screen/user) then
// always starts a genuinely new request instead of being handed the stale
// promise.
export function resetCachedFetchState() {
  inFlight.clear();
}

function fetchOnce<T>(key: string, fetcher: () => Promise<T>): Promise<T> {
  const existing = inFlight.get(key);
  if (existing) return existing as Promise<T>;
  // The real defense: bind this request to whoever is signed in right now,
  // and refuse to let it write into the shared cache if that identity has
  // since changed — this holds even if resetCachedFetchState() above is
  // never called. Without it, a request in flight when the user signs out
  // (e.g. NotificationsScreen's list, or `awards:<id>`'s per-voter
  // `my_vote`/`i_upvoted` flags) can resolve after a different user signs
  // in and silently repopulate the cache with the departed user's data,
  // which useFocusEffect then treats as a fresh, authoritative cache hit
  // and renders with no network call — and thus no RLS check — ever running
  // for the new user.
  const userIdAtStart = sessionStore.get()?.user?.id ?? null;
  const promise: Promise<T> = fetcher()
    .then(result => {
      // Identity-guarded twice: `force` (below) or resetCachedFetchState()
      // may have already discarded this entry in favor of a newer request —
      // a late-resolving old promise must not overwrite fresher data. And
      // even if the entry is still this promise, the signed-in user must
      // still be the one this request was made for.
      if (inFlight.get(key) === promise && sessionStore.get()?.user?.id === userIdAtStart) {
        cache.set(key, result);
      }
      return result;
    })
    .finally(() => {
      // Identity-guarded: if `force` (below) already discarded this entry
      // in favor of a newer request, a late-resolving old promise must not
      // delete the newer one's registry entry.
      if (inFlight.get(key) === promise) inFlight.delete(key);
    });
  inFlight.set(key, promise);
  return promise;
}

export function useCachedFetch<T>(
  key: string,
  fetcher: () => Promise<T>,
  deps: unknown[] = [],
): { data: T | null; loading: boolean; refresh: (force?: boolean) => Promise<void> } {
  const [data, setData] = useState<T | null>(() => cache.get<T>(key));
  const [loading, setLoading] = useState(data === null);
  const fetcherRef = useRef(fetcher);
  fetcherRef.current = fetcher;
  // Bumped on every doFetch call so a slow, superseded response can't
  // clobber a newer one that already resolved for this hook instance.
  const callId = useRef(0);

  const doFetch = useCallback(async (force = false) => {
    const id = ++callId.current;
    // force=true (used by retry-after-timeout) discards a stale in-flight
    // entry so a genuinely hung fetch doesn't just get silently re-awaited —
    // a retry tap must actually start a new request.
    if (force) inFlight.delete(key);
    try {
      const result = await fetchOnce(key, () => fetcherRef.current());
      if (id === callId.current) setData(result);
    } finally {
      if (id === callId.current) setLoading(false);
    }
  }, [key]);

  useFocusEffect(
    useCallback(() => {
      const cached = cache.get<T>(key);
      if (cached !== null) {
        // Fresh cache hit — render instantly and skip the network call.
        // The TTL now actually governs every focus, not just the very
        // first render; a stale/expired entry falls through to doFetch().
        setData(cached);
        setLoading(false);
      } else {
        setLoading(true);
        doFetch();
      }
      // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [key, doFetch, ...deps]),
  );

  useEffect(() => {
    return cache.subscribe(key, () => {
      // Keep showing the current data while refetching — don't blank the
      // screen to a loading state just because something elsewhere
      // invalidated this key.
      doFetch();
    });
  }, [key, doFetch]);

  return { data, loading, refresh: doFetch };
}
