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

  const reconcile = useCallback(async () => {
    if (Platform.OS !== 'ios') return;
    if (!userId) return;
    if (!isLiveActivitySupported()) return;
    // A reconcile pass is a few round-trips; overlapping passes (foreground
    // event landing while the mount pass is still in flight) would double-start.
    if (runningRef.current) return;
    runningRef.current = true;

    try {
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

      const rows: LiveActivityCapsuleRow[] = data
        .map((r: any) =>
          r.capsules
            ? ({ ...r.capsules, live_activity_override: r.live_activity_override } as LiveActivityCapsuleRow)
            : null
        )
        .filter(Boolean) as LiveActivityCapsuleRow[];

      const desired = desiredActivities(rows, new Date());
      const active = await listActiveLiveActivities();
      const { toStart, toEnd, alreadyRunning } = reconcileActivities(desired, active);

      for (const capsuleId of toEnd) {
        await endLiveActivity(capsuleId);
      }

      // Keyed by id, not object identity — whether a capsule needs start() or
      // update() must not depend on array reference equality surviving.
      const startIds = new Set(toStart.map(d => d.capsuleId));

      for (const d of [...toStart, ...alreadyRunning]) {
        // capsule_media_count is a SECURITY DEFINER RPC — required rather than
        // a media(count) embed, because the media SELECT policy hides rows
        // from everyone (owner included) while a surprise-mode capsule is
        // locked, and an embed would silently read 0.
        const { data: countData } = await supabase.rpc('capsule_media_count', {
          p_capsule_id: d.capsuleId,
        });
        const photoCount = typeof countData === 'number' ? countData : 0;

        const { count: memberCount } = await supabase
          .from('capsule_members')
          .select('user_id', { count: 'exact', head: true })
          .eq('capsule_id', d.capsuleId)
          .not('joined_at', 'is', null);

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
      }
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
