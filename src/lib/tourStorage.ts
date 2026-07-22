import AsyncStorage from '@react-native-async-storage/async-storage';

// One-time flags for the new-user tour, per-install (mirrors cap_camera_coach_seen).
// PENDING is set the moment onboarding completes and consumed (read-and-delete)
// by Home the first time it loads; SEEN is set on finish or skip so the tour
// never runs twice. All best-effort -- failures never block the app.
const SEEN_KEY = 'cap_tour_seen';
const PENDING_KEY = 'cap_tour_pending';

export async function setTourPending(): Promise<void> {
  try { await AsyncStorage.setItem(PENDING_KEY, '1'); } catch {}
}

/** Returns true exactly once after onboarding completes, then clears the flag. */
export async function consumeTourPending(): Promise<boolean> {
  try {
    const v = await AsyncStorage.getItem(PENDING_KEY);
    if (v) { await AsyncStorage.removeItem(PENDING_KEY); return true; }
  } catch {}
  return false;
}

export async function markTourSeen(): Promise<void> {
  try { await AsyncStorage.setItem(SEEN_KEY, '1'); } catch {}
}

export async function tourSeen(): Promise<boolean> {
  try { return (await AsyncStorage.getItem(SEEN_KEY)) === '1'; } catch { return false; }
}
