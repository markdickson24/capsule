import { useState, useEffect, useCallback, useRef } from 'react';
import { useFocusEffect } from '@react-navigation/native';
import { cache } from '../lib/cache';

// Module-level in-flight request registry, shared across every useCachedFetch
// instance. Collapses N simultaneous callers of the same key (e.g. every
// mounted consumer reacting to one cache.invalidate(key) call) into a single
// network request instead of N duplicate ones.
const inFlight = new Map<string, Promise<unknown>>();

function fetchOnce<T>(key: string, fetcher: () => Promise<T>): Promise<T> {
  const existing = inFlight.get(key);
  if (existing) return existing as Promise<T>;
  const promise = fetcher()
    .then(result => {
      cache.set(key, result);
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
