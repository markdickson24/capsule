import React from 'react';
import { View, ViewStyle, StyleProp } from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import { useTheme } from '../context/ThemeContext';

/**
 * A surface tinted by the user's accent. Renders a LinearGradient when the user
 * (Pro) has a gradient theme set, otherwise a solid View backed by accentColor.
 * Drop-in replacement for an accent-colored View — same style/children props.
 * Used only on the three "premium showcase" surfaces (profile hero glow, camera
 * tab button, Settings save button); the rest of the app uses the solid
 * accentColor token directly.
 */
export default function AccentSurface({
  style,
  children,
  start = { x: 0, y: 0 },
  end = { x: 1, y: 1 },
}: {
  style?: StyleProp<ViewStyle>;
  children?: React.ReactNode;
  start?: { x: number; y: number };
  end?: { x: number; y: number };
}) {
  const { accentColor, accentGradient } = useTheme();
  if (accentGradient) {
    return (
      <LinearGradient colors={accentGradient} start={start} end={end} style={style}>
        {children}
      </LinearGradient>
    );
  }
  return <View style={[style, { backgroundColor: accentColor }]}>{children}</View>;
}
