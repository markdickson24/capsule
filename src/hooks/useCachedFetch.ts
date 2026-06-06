import { useState, useEffect, useCallback, useRef } from 'react';
import { useFocusEffect } from '@react-navigation/native';
import { cache } from '../lib/cache';

export function useCachedFetch<T>(
  key: string,
  fetcher: () => Promise<T>,
  deps: unknown[] = [],
): { data: T | null; loading: boolean; refresh: () => Promise<void> } {
  const [data, setData] = useState<T | null>(() => cache.get<T>(key));
  const [loading, setLoading] = useState(data === null);
  const fetcherRef = useRef(fetcher);
  fetcherRef.current = fetcher;

  const doFetch = useCallback(async () => {
    try {
      const result = await fetcherRef.current();
      cache.set(key, result);
      setData(result);
    } finally {
      setLoading(false);
    }
  }, [key]);

  useFocusEffect(
    useCallback(() => {
      const cached = cache.get<T>(key);
      if (cached !== null) {
        setData(cached);
        setLoading(false);
        doFetch();
      } else {
        setLoading(true);
        doFetch();
      }
    }, [key, doFetch, ...deps]),
  );

  useEffect(() => {
    return cache.subscribe(key, () => {
      setData(null);
      setLoading(true);
      doFetch();
    });
  }, [key, doFetch]);

  return { data, loading, refresh: doFetch };
}
