import React, { useEffect, useRef, memo } from 'react';
import {
  View, Animated, StyleSheet, AccessibilityInfo,
  ViewStyle, Platform,
} from 'react-native';

const BASE_COLOR = '#1A1A1A';
const HIGHLIGHT_COLOR = '#252525';

type SkeletonProps = {
  width?: number | string;
  height?: number;
  borderRadius?: number;
  style?: ViewStyle;
};

const SkeletonBox = memo(function SkeletonBox({
  width = '100%',
  height = 16,
  borderRadius = 8,
  style,
}: SkeletonProps) {
  const opacity = useRef(new Animated.Value(0.5)).current;
  const reducedMotion = useRef(false);

  useEffect(() => {
    const sub = AccessibilityInfo.addEventListener(
      'reduceMotionChanged',
      (v) => { reducedMotion.current = v; },
    );
    AccessibilityInfo.isReduceMotionEnabled().then((v) => {
      reducedMotion.current = v;
    });
    return () => sub.remove();
  }, []);

  useEffect(() => {
    const loop = Animated.loop(
      Animated.sequence([
        Animated.timing(opacity, {
          toValue: 1,
          duration: 800,
          useNativeDriver: true,
        }),
        Animated.timing(opacity, {
          toValue: 0.5,
          duration: 800,
          useNativeDriver: true,
        }),
      ]),
    );
    loop.start();
    return () => loop.stop();
  }, [opacity]);

  return (
    <Animated.View
      accessibilityRole="none"
      accessibilityLabel="Loading"
      style={[
        {
          width: width as any,
          height,
          borderRadius,
          backgroundColor: HIGHLIGHT_COLOR,
          opacity,
        },
        style,
      ]}
    />
  );
});

export function SkeletonText({
  lines = 1,
  lastLineWidth = '60%',
  lineHeight = 14,
  gap = 10,
  style,
}: {
  lines?: number;
  lastLineWidth?: number | string;
  lineHeight?: number;
  gap?: number;
  style?: ViewStyle;
}) {
  return (
    <View style={[{ gap }, style]} accessibilityRole="none" accessibilityLabel="Loading text">
      {Array.from({ length: lines }).map((_, i) => (
        <SkeletonBox
          key={i}
          height={lineHeight}
          width={i === lines - 1 && lines > 1 ? lastLineWidth : '100%'}
          borderRadius={6}
        />
      ))}
    </View>
  );
}

export function SkeletonCircle({
  size = 40,
  style,
}: {
  size?: number;
  style?: ViewStyle;
}) {
  return <SkeletonBox width={size} height={size} borderRadius={size / 2} style={style} />;
}

export function SkeletonCard({ style }: { style?: ViewStyle }) {
  return (
    <View
      style={[sk.card, style]}
      accessibilityRole="none"
      accessibilityLabel="Loading card"
    >
      <View style={sk.cardTop}>
        <SkeletonBox width={24} height={24} borderRadius={6} />
        <SkeletonBox width={80} height={14} borderRadius={6} />
      </View>
      <SkeletonBox height={18} width="70%" borderRadius={6} />
      <SkeletonText lines={2} lineHeight={12} gap={8} />
      <SkeletonBox height={12} width="45%" borderRadius={6} />
    </View>
  );
}

export function SkeletonNotificationRow({ style }: { style?: ViewStyle }) {
  return (
    <View style={[sk.notifRow, style]}>
      <SkeletonBox width={28} height={28} borderRadius={8} />
      <View style={sk.notifBody}>
        <SkeletonText lines={2} lineHeight={12} gap={6} lastLineWidth="40%" />
      </View>
      <SkeletonBox width={60} height={32} borderRadius={10} />
    </View>
  );
}

export function SkeletonMemberRow({ style }: { style?: ViewStyle }) {
  return (
    <View style={[sk.memberRow, style]}>
      <SkeletonCircle size={40} />
      <View style={sk.memberInfo}>
        <SkeletonBox height={14} width="55%" borderRadius={6} />
        <SkeletonBox height={10} width={70} borderRadius={4} />
      </View>
      <SkeletonBox width={70} height={22} borderRadius={6} />
    </View>
  );
}

export function SkeletonProfileCard({ style }: { style?: ViewStyle }) {
  return (
    <View
      style={[sk.profileCard, style]}
      accessibilityRole="none"
      accessibilityLabel="Loading profile"
    >
      <SkeletonCircle size={96} />
      <SkeletonBox height={20} width={160} borderRadius={8} style={{ marginTop: 12 }} />
      <SkeletonBox height={14} width={220} borderRadius={6} style={{ marginTop: 4 }} />
      <SkeletonBox height={48} width="100%" borderRadius={12} style={{ marginTop: 20 }} />
      <SkeletonBox height={48} width="100%" borderRadius={12} style={{ marginTop: 8 }} />
    </View>
  );
}

export function SkeletonMediaGrid({ count = 3, style }: { count?: number; style?: ViewStyle }) {
  return (
    <View style={[sk.mediaGrid, style]}>
      {Array.from({ length: count }).map((_, i) => (
        <SkeletonBox key={i} height={0} borderRadius={12} style={{ flex: 1, aspectRatio: 1 }} />
      ))}
    </View>
  );
}

export function SkeletonFormField({ style }: { style?: ViewStyle }) {
  return (
    <View style={[sk.formField, style]}>
      <SkeletonBox height={12} width={80} borderRadius={4} />
      <SkeletonBox height={50} width="100%" borderRadius={12} />
    </View>
  );
}

const sk = StyleSheet.create({
  card: {
    backgroundColor: BASE_COLOR,
    borderRadius: 16,
    padding: 20,
    gap: 10,
    borderWidth: 1,
    borderColor: '#2A2A2A',
  },
  cardTop: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  notifRow: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: BASE_COLOR,
    borderRadius: 16,
    padding: 16,
    gap: 14,
    borderWidth: 1,
    borderColor: '#2A2A2A',
  },
  notifBody: { flex: 1 },
  memberRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    paddingVertical: 12,
  },
  memberInfo: { flex: 1, gap: 6 },
  profileCard: {
    alignItems: 'center',
    paddingTop: 48,
    paddingHorizontal: 32,
    gap: 0,
  },
  mediaGrid: {
    flexDirection: 'row',
    gap: 6,
  },
  formField: {
    gap: 8,
  },
});

export default SkeletonBox;
