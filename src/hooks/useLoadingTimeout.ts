import { useCallback, useEffect, useRef, useState } from 'react';

// Detects a loading state that's taking too long, so callers can swap a
// spinner/skeleton for a retry affordance. Decoupled from any specific fetch
// mechanism — works for useCachedFetch-driven screens and hand-rolled
// useState-based ones identically.
export function useLoadingTimeout(loading: boolean, timeoutMs = 8000) {
  const [timedOut, setTimedOut] = useState(false);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const clear = useCallback(() => {
    if (timerRef.current) {
      clearTimeout(timerRef.current);
      timerRef.current = null;
    }
  }, []);

  // Re-arms the timer without requiring a loading:false→true edge — a retry
  // tap restarts the fetch under the same `loading: true`, so this is the
  // only way the timeout fires again on a second hang. Every onRetry handler
  // must call this before kicking off the new fetch attempt.
  const reset = useCallback(() => {
    clear();
    setTimedOut(false);
    timerRef.current = setTimeout(() => setTimedOut(true), timeoutMs);
  }, [clear, timeoutMs]);

  useEffect(() => {
    if (loading) {
      timerRef.current = setTimeout(() => setTimedOut(true), timeoutMs);
    } else {
      clear();
      setTimedOut(false);
    }
    return clear;
  }, [loading, timeoutMs, clear]);

  return { timedOut, reset };
}
