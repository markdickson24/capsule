import * as Haptics from 'expo-haptics';
import { Platform } from 'react-native';

// Central haptics helper. No-ops on web and swallows errors, so call sites stay
// one-liners (e.g. haptics.light()) without platform guards. Use:
//   light/medium/heavy — taps & button presses (impact)
//   selection          — moving through options/toggles
//   success/warning/error — outcome of an action (notification feedback)

const on = Platform.OS !== 'web';

export const haptics = {
  light: () => { if (on) Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light).catch(() => {}); },
  medium: () => { if (on) Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium).catch(() => {}); },
  heavy: () => { if (on) Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Heavy).catch(() => {}); },
  selection: () => { if (on) Haptics.selectionAsync().catch(() => {}); },
  success: () => { if (on) Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(() => {}); },
  warning: () => { if (on) Haptics.notificationAsync(Haptics.NotificationFeedbackType.Warning).catch(() => {}); },
  error: () => { if (on) Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error).catch(() => {}); },
};
