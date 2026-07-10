import React, { useEffect, useRef, useState } from 'react';
import { Animated, Platform, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { useTheme } from '../context/ThemeContext';
import { toast, Toast } from '../lib/toast';

const VISIBLE_MS = 2500;

// Renders the current global toast as an auto-dismissing pill above the tab bar.
// Mounted once inside NavigationContainer so it persists across screen changes.
export default function ToastHost() {
  const insets = useSafeAreaInsets();
  const { accentColor } = useTheme();
  const [active, setActive] = useState<Toast | null>(toast.get());

  const opacity = useRef(new Animated.Value(0)).current;
  const translateY = useRef(new Animated.Value(24)).current;
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => toast.subscribe(() => setActive(toast.get())), []);

  useEffect(() => {
    if (!active) return;

    opacity.setValue(0);
    translateY.setValue(24);
    Animated.parallel([
      Animated.timing(opacity, { toValue: 1, duration: 220, useNativeDriver: true }),
      Animated.spring(translateY, { toValue: 0, friction: 8, tension: 80, useNativeDriver: true }),
    ]).start();

    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => {
      Animated.parallel([
        Animated.timing(opacity, { toValue: 0, duration: 200, useNativeDriver: true }),
        Animated.timing(translateY, { toValue: 12, duration: 200, useNativeDriver: true }),
      ]).start(() => toast.clear());
    }, VISIBLE_MS);

    return () => {
      if (timer.current) clearTimeout(timer.current);
    };
    // Re-run whenever a new toast (new id) is shown.
  }, [active?.id]);

  if (!active) return null;

  function dismissNow() {
    if (timer.current) clearTimeout(timer.current);
    Animated.parallel([
      Animated.timing(opacity, { toValue: 0, duration: 200, useNativeDriver: true }),
      Animated.timing(translateY, { toValue: 12, duration: 200, useNativeDriver: true }),
    ]).start(() => toast.clear());
  }

  return (
    // box-none: the toast's own footprint shouldn't eat touches on the rest of
    // the screen, but the action button (e.g. "Undo") inside it still needs to be tappable.
    <View pointerEvents="box-none" style={[styles.wrap, { bottom: insets.bottom + 80 }]}>
      <Animated.View
        pointerEvents="box-none"
        style={[
          styles.pill,
          Platform.select({
            default: { shadowColor: '#000', shadowOpacity: 0.4, shadowRadius: 12, shadowOffset: { width: 0, height: 6 } },
            web: {},
          }),
          { opacity, transform: [{ translateY }] },
        ]}
      >
        <Ionicons name="checkmark-circle" size={19} color={accentColor} />
        <Text style={styles.text}>{active.message}</Text>
        {active.action && (
          <TouchableOpacity
            onPress={() => {
              active.action!.onPress();
              dismissNow();
            }}
            hitSlop={8}
          >
            <Text style={[styles.actionText, { color: accentColor }]}>{active.action.label}</Text>
          </TouchableOpacity>
        )}
      </Animated.View>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: {
    position: 'absolute',
    left: 0,
    right: 0,
    alignItems: 'center',
    zIndex: 1000,
  },
  pill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 9,
    backgroundColor: '#1E1E1E',
    borderWidth: 1,
    borderColor: '#2E2E2E',
    borderRadius: 14,
    paddingVertical: 12,
    paddingHorizontal: 16,
    maxWidth: '88%',
    elevation: 8,
  },
  text: {
    color: '#FFFFFF',
    fontSize: 14.5,
    fontWeight: '600',
    flexShrink: 1,
  },
  actionText: {
    fontSize: 14.5,
    fontWeight: '700',
    marginLeft: 4,
  },
});
