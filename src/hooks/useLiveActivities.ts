import { useCallback, useEffect, useRef } from 'react';
import { AppState, Platform } from 'react-native';
import { supabase } from '../lib/supabase';
import { reportError } from '../lib/sentry';
import { useTheme } from '../context/ThemeContext';
import {
  desiredActivities,
  reconcileActivities,
  type LiveActivityCapsuleRow,
} from '../lib/liveActivityPlan';
import {
  isLiveActivitySupported,
  startLiveActivity,
  updateLiveActivity,
  endLiveActivity,
  listActiveLiveActivities,
} from '../../modules/expo-live-activity';

const DEFAULT_ACCENT = '#FC6A5B';

// A reconcile pass is a handful of small round-trips (one capsule list fetch,
// one native listActive(), a count query per in-window capsule) — nowhere
// near uploadQueue's 3-minute file-upload budget, but the same risk applies:
// RN's network primitives don't time out a dead connection on their own, and
// `runningRef` only resets in `finally`. If any single await never settles,
// `finally` never runs, the guard stays stuck `true` for the rest of the app
// session, and every future foreground silently no-ops with nothing in
// Sentry to explain it. Mirrors uploadQueue.ts's `withTimeout`/`TASK_TIMEOUT_MS`
// (not exported there, so duplicated locally rather than growing its surface).
const RECONCILE_TIMEOUT_MS = 30_000;

function withTimeout<T>(promise: Promise<T>, ms: number, message: string): Promise<T> {
  let timer: ReturnType<typeof setTimeout>;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new Error(message)), ms);
  });
  // If `promise` itself later rejects after the timeout has already won the
  // race, nobody else is listening to it — swallow that here so it can't
  // surface as an unhandled promise rejection.
  promise.catch(() => {});
  return Promise.race([promise, timeout]).finally(() => clearTimeout(timer));
}

/**
 * Keeps iOS Live Activities in sync with the capsules that are currently open
 * for photos. Runs a reconcile pass on mount, on every foreground, and
 * whenever the signed-in user changes.
 *
 * There is deliberately no push-to-start: an activity appears the first time
 * the app runs inside a capsule's contribution window. Once started, iOS ticks
 * the countdown itself from the staleDate, so no further work is needed for
 * the countdown to stay correct.
 */
export function useLiveActivities(userId?: string | null) {
  const { accentColor } = useTheme();
  // Read the live accent color inside reconcile without making it a dependency
  // (a color change shouldn't trigger a reconcile pass).
  const accentRef = useRef(accentColor);
  accentRef.current = accentColor;

  const runningRef = useRef(false);
  // Bumped every time a new pass actually begins (i.e. clears the runningRef
  // guard above). `withTimeout` below does not cancel an abandoned `runPass`
  // — RN has no AbortController wired through the Supabase client or the
  // native module, so a timed-out pass keeps running in the background and
  // may still reach its native calls after `finally` has already reset
  // `runningRef` and let a fresh pass start. Two concurrent `start()` calls
  // for the same capsule can both pass the native module's unserialized
  // check-then-act and both create an activity — a duplicate lock-screen
  // card, exactly what `runningRef` exists to prevent. Each pass snapshots
  // the generation at start and re-checks it before every native call inside
  // the loops below; if a newer pass has since taken over, the abandoned
  // pass stops instead of proceeding. Mirrors uploadQueue.ts's
  // `cacheGeneration` guard against its own non-cancelling `withTimeout`.
  const generationRef = useRef(0);

  const reconcile = useCallback(async () => {
    if (Platform.OS !== 'ios') return;
    if (!isLiveActivitySupported()) return;
    // A reconcile pass is a few round-trips; overlapping passes (foreground
    // event landing while the mount pass is still in flight) would double-start.
    if (runningRef.current) return;
    runningRef.current = true;
    const myGeneration = ++generationRef.current;

    const runPass = async () => {
      // No special-cased sign-out branch: with no userId, `rows` simply stays
      // empty, so `desiredActivities` returns [] and `reconcileActivities`
      // routes every currently-running activity into `toEnd` — the exact same
      // code path a normal "nothing desired anymore" pass takes. This is what
      // ends a stale lock-screen card the instant the user signs out, instead
      // of leaving someone else's capsule showing until iOS expires it ~12h
      // later.
      let rows: LiveActivityCapsuleRow[] = [];

      if (userId) {
        // Mirrors HomeScreen's capsule query shape: capsule_members is the
        // membership gate, capsules is embedded. joined_at not null excludes
        // pending invites, which shouldn't put anything on a lock screen.
        const { data, error } = await supabase
          .from('capsule_members')
          .select(
            'live_activity_override, capsules(id, title, status, created_at, contribution_start_at, contribution_lock_at, unlock_at, live_activity_enabled)'
          )
          .eq('user_id', userId)
          .not('joined_at', 'is', null);

        if (error || !data) {
          if (error) reportError(error, { where: 'useLiveActivities.fetch' });
          return;
        }

        rows = data
          .map((r: any) =>
            r.capsules
              ? ({ ...r.capsules, live_activity_override: r.live_activity_override } as LiveActivityCapsuleRow)
              : null
          )
          .filter(Boolean) as LiveActivityCapsuleRow[];
      }

      const desired = desiredActivities(rows, new Date());
      const active = await listActiveLiveActivities();
      const { toStart, toEnd, alreadyRunning } = reconcileActivities(desired, active);

      for (const capsuleId of toEnd) {
        // A newer pass has taken over (this one was abandoned by a timeout) —
        // stop rather than issue a native call a fresher pass may duplicate.
        if (generationRef.current !== myGeneration) return;
        // Each capsule is reconciled independently — one rejection here must
        // not abort every other capsule's teardown/start/update for this pass
        // (previously a single outer try/catch meant one failure stopped the
        // whole loop until the next foreground).
        try {
          await endLiveActivity(capsuleId);
        } catch (err) {
          reportError(err, { where: 'useLiveActivities.end', extra: { capsuleId } });
        }
      }

      // Keyed by id, not object identity — whether a capsule needs start() or
      // update() must not depend on array reference equality surviving.
      const startIds = new Set(toStart.map(d => d.capsuleId));

      for (const d of [...toStart, ...alreadyRunning]) {
        // Same generation bail-out as the toEnd loop above.
        if (generationRef.current !== myGeneration) return;
        try {
          // capsule_media_count is a SECURITY DEFINER RPC — required rather
          // than a media(count) embed, because the media SELECT policy hides
          // rows from everyone (owner included) while a surprise-mode capsule
          // is locked, and an embed would silently read 0.
          const { data: countData, error: countError } = await supabase.rpc('capsule_media_count', {
            p_capsule_id: d.capsuleId,
          });
          if (countError) {
            reportError(countError, {
              where: 'useLiveActivities.count',
              extra: { capsuleId: d.capsuleId },
            });
          }
          const photoCount = typeof countData === 'number' ? countData : 0;

          const { count: memberCount, error: memberError } = await supabase
            .from('capsule_members')
            .select('user_id', { count: 'exact', head: true })
            .eq('capsule_id', d.capsuleId)
            .not('joined_at', 'is', null);
          if (memberError) {
            reportError(memberError, {
              where: 'useLiveActivities.count',
              extra: { capsuleId: d.capsuleId },
            });
          }
          // Best-effort: a failed count query shouldn't cost the user their
          // countdown — proceed with 0 (already reported above) rather than
          // aborting this capsule's start/update.

          // Re-check right before the native call: the two count queries
          // above are awaits during which a newer pass may have taken over.
          if (generationRef.current !== myGeneration) return;

          if (startIds.has(d.capsuleId)) {
            await startLiveActivity({
              capsuleId: d.capsuleId,
              title: d.title,
              accentHex: accentRef.current || DEFAULT_ACCENT,
              windowStartMs: d.windowStart.getTime(),
              deadlineMs: d.deadline.getTime(),
              photoCount,
              memberCount: memberCount ?? 0,
            });
          } else {
            await updateLiveActivity(d.capsuleId, photoCount, memberCount ?? 0);
          }
        } catch (err) {
          reportError(err, { where: 'useLiveActivities.upsert', extra: { capsuleId: d.capsuleId } });
        }
      }
    };

    try {
      await withTimeout(runPass(), RECONCILE_TIMEOUT_MS, 'Live activity reconcile timed out');
    } catch (err) {
      // Ambient decoration — the user never asked for this in the moment, so
      // failures are reported, never toasted.
      reportError(err, { where: 'useLiveActivities.reconcile' });
    } finally {
      runningRef.current = false;
    }
  }, [userId]);

  // Mount + whenever the signed-in user changes.
  useEffect(() => {
    reconcile();
  }, [reconcile]);

  // Foreground: catches a deadline that passed, or a capsule that unlocked,
  // while the app was backgrounded. Same reasoning as CapsuleDetailScreen's
  // AppState listener — realtime events aren't delivered while backgrounded.
  useEffect(() => {
    const sub = AppState.addEventListener('change', state => {
      if (state === 'active') reconcile();
    });
    return () => sub.remove();
  }, [reconcile]);
}
