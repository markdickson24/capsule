import React, { useEffect, useRef } from 'react';
import { View, Text, Animated, StyleSheet, Easing, ViewStyle } from 'react-native';
import { Ionicons } from '@expo/vector-icons';

type Size = 'large' | 'medium' | 'small';

type Props = {
  size?: Size;
  color?: string;
  showText?: boolean;
  style?: ViewStyle | ViewStyle[];
};

const PRESETS: Record<Size, { iconSize: number; fontSize: number; gap: number; defaultShowText: boolean }> = {
  large:  { iconSize: 32, fontSize: 32, gap: 10, defaultShowText: true },
  medium: { iconSize: 22, fontSize: 22, gap: 8,  defaultShowText: true },
  // size="small" is the in-button variant: lock icon only, no wordmark.
  small:  { iconSize: 18, fontSize: 15, gap: 6,  defaultShowText: false },
};

export default function LoadingBrand({
  size = 'large',
  color = '#FFFFFF',
  showText,
  style,
}: Props) {
  const scale = useRef(new Animated.Value(1)).current;
  const opacity = useRef(new Animated.Value(0.9)).current;
  const preset = PRESETS[size];
  const includeText = showText ?? preset.defaultShowText;

  useEffect(() => {
    const loop = Animated.loop(
      Animated.parallel([
        Animated.sequence([
          Animated.timing(scale, { toValue: 1.06, duration: 700, easing: Easing.inOut(Easing.quad), useNativeDriver: true }),
          Animated.timing(scale, { toValue: 1,    duration: 700, easing: Easing.inOut(Easing.quad), useNativeDriver: true }),
        ]),
        Animated.sequence([
          Animated.timing(opacity, { toValue: 1,   duration: 700, easing: Easing.inOut(Easing.quad), useNativeDriver: true }),
          Animated.timing(opacity, { toValue: 0.9, duration: 700, easing: Easing.inOut(Easing.quad), useNativeDriver: true }),
        ]),
      ]),
    );
    loop.start();
    return () => loop.stop();
  }, [opacity, scale]);

  return (
    <Animated.View
      style={[
        styles.row,
        { gap: preset.gap, opacity, transform: [{ scale }] },
        style,
      ]}
    >
      <Ionicons name="lock-closed" size={preset.iconSize} color={color} />
      {includeText && (
        <Text style={[styles.text, { fontSize: preset.fontSize, color }]}>Capsule</Text>
      )}
    </Animated.View>
  );
}

export function LoadingBrandScreen({ color }: { color?: string }) {
  return (
    <View style={styles.fullScreen}>
      <LoadingBrand size="large" color={color} />
    </View>
  );
}

const styles = StyleSheet.create({
  row: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  text: {
    fontWeight: '800',
    letterSpacing: -0.5,
  },
  fullScreen: {
    flex: 1,
    backgroundColor: '#0A0A0A',
    justifyContent: 'center',
    alignItems: 'center',
  },
});
