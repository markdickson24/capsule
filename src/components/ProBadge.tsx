import React from 'react';
import { View, Text, StyleSheet } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useTheme } from '../context/ThemeContext';

/**
 * Small "PRO" pill marking a Capsule Pro user. The caller decides whether to
 * render it (based on the subject's subscription_tier / isPro); this component
 * only draws the pill. Not a touchable — decorative status marker.
 */
export default function ProBadge({ size = 'sm' }: { size?: 'sm' | 'md' }) {
  const { accentColor } = useTheme();
  const md = size === 'md';
  return (
    <View
      style={[
        styles.badge,
        { backgroundColor: `${accentColor}22`, borderColor: `${accentColor}55` },
        md && styles.badgeMd,
      ]}
      accessible
      accessibilityLabel="Capsule Pro"
    >
      <Ionicons name="sparkles" size={md ? 12 : 10} color={accentColor} />
      <Text
        style={[styles.text, { color: accentColor }, md && styles.textMd]}
        maxFontSizeMultiplier={1.3}
      >
        PRO
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  badge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 3,
    paddingHorizontal: 6,
    paddingVertical: 2,
    borderRadius: 6,
    borderWidth: 1,
  },
  badgeMd: { paddingHorizontal: 8, paddingVertical: 3, borderRadius: 8, gap: 4 },
  text: { fontSize: 9, fontWeight: '800', letterSpacing: 0.5 },
  textMd: { fontSize: 11 },
});
