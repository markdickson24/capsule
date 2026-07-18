import React, { useEffect, useRef } from 'react';
import { Text, StyleSheet, Animated, TouchableOpacity } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useTheme } from '../context/ThemeContext';
import { haptics } from '../lib/haptics';
import { UnlockMode } from '../types/database';

const AUTO_DISMISS_MS = 1800;

// UX_POLISH.md #4 — the sealed-capsule ceremony (lock scale-in + success
// haptic) previously only existed in OnboardingScreen's one-time step 5.
// This is a standalone, lightweight re-implementation for CreateScreen's
// regular (post-onboarding) capsule creation, so every capsule gets the
// moment, not just the very first one. Deliberately NOT extracted from
// OnboardingScreen and shared — that screen's version is entangled with its
// step state machine (transitionToStep, the live 30s countdown re-tick,
// invite/add-photo/skip actions specific to onboarding) and pulling it apart
// would cost more than re-writing the ~20 lines of Animated setup here.
function formatUnlockLine(unlockMode: UnlockMode, unlockDate: Date | null): string {
  if (unlockMode === 'proximity') return "Sealed until you're all together.";
  if (!unlockDate) return 'Sealed.';
  const dateStr = unlockDate.toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' });
  if (unlockMode === 'both') return `Sealed until ${dateStr} — and you're all together.`;
  return `Sealed until ${dateStr}.`;
}

interface SealedMomentProps {
  visible: boolean;
  title: string;
  unlockMode: UnlockMode;
  unlockDate: Date | null;
  onDone: () => void;
}

export default function SealedMoment({ visible, title, unlockMode, unlockDate, onDone }: SealedMomentProps) {
  const { accentColor } = useTheme();
  const overlayOpacity = useRef(new Animated.Value(0)).current;
  const iconAnim = useRef(new Animated.Value(0)).current;
  const dismissedRef = useRef(false);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const onDoneRef = useRef(onDone);
  onDoneRef.current = onDone;

  function dismiss() {
    if (dismissedRef.current) return;
    dismissedRef.current = true;
    // Clear the auto-dismiss timer directly on manual tap (the effect cleanup
    // would also catch it once the parent flips `visible`, but this doesn't
    // depend on the parent hiding us in onDone).
    if (timerRef.current) {
      clearTimeout(timerRef.current);
      timerRef.current = null;
    }
    onDoneRef.current();
  }

  useEffect(() => {
    if (!visible) return;
    dismissedRef.current = false;
    overlayOpacity.setValue(0);
    iconAnim.setValue(0);
    haptics.success();
    Animated.timing(overlayOpacity, { toValue: 1, duration: 200, useNativeDriver: true }).start();
    // Same spring params as OnboardingScreen's step-5 lock scale-in.
    Animated.spring(iconAnim, { toValue: 1, friction: 5, tension: 60, useNativeDriver: true }).start();
    timerRef.current = setTimeout(dismiss, AUTO_DISMISS_MS);
    return () => {
      if (timerRef.current) clearTimeout(timerRef.current);
      timerRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [visible]);

  if (!visible) return null;

  return (
    // accessibilityViewIsModal confines VoiceOver to the overlay so swipe
    // navigation can't reach (and re-activate) the Lock Capsule button
    // underneath. CreateScreen also keeps `loading` true for the overlay's
    // lifetime as the real re-entrancy guard — this is belt and braces.
    <Animated.View style={[styles.scrim, { opacity: overlayOpacity }]} accessibilityViewIsModal>
      <TouchableOpacity
        style={styles.touchArea}
        activeOpacity={1}
        onPress={dismiss}
        accessibilityRole="button"
        accessibilityLabel="Dismiss sealed capsule message"
      >
        <Animated.View
          style={[
            styles.sealCircle,
            {
              backgroundColor: `${accentColor}22`,
              opacity: iconAnim,
              transform: [{
                scale: iconAnim.interpolate({ inputRange: [0, 1], outputRange: [0.3, 1] }),
              }],
            },
          ]}
        >
          <Ionicons name="lock-closed" size={44} color={accentColor} />
        </Animated.View>

        <Text style={styles.heading} maxFontSizeMultiplier={1.3} numberOfLines={2}>
          “{title}”
        </Text>
        <Text style={styles.sub} maxFontSizeMultiplier={1.3}>
          {formatUnlockLine(unlockMode, unlockDate)}
        </Text>
      </TouchableOpacity>
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  scrim: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: 'rgba(10,10,10,0.97)',
    zIndex: 999,
    elevation: 999,
  },
  touchArea: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 12,
    paddingHorizontal: 32,
  },
  sealCircle: {
    width: 104,
    height: 104,
    borderRadius: 52,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 8,
  },
  heading: { fontSize: 24, fontWeight: '800', color: '#FFFFFF', textAlign: 'center' },
  sub: { fontSize: 16, fontWeight: '600', color: '#CCCCCC', textAlign: 'center' },
});
