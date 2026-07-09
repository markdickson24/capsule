import React, { useEffect, useRef, useState } from 'react';
import { Animated, StyleSheet, View, ViewStyle } from 'react-native';

/**
 * Determinate progress bar. The fill is a full-width layer translated left
 * inside an overflow-hidden track, so the animation runs on the native driver
 * (transform only — no width layout thrash). Track width comes from onLayout,
 * never percentage widths (iOS ScrollView computes those to 0).
 */
export default function ProgressBar({
  progress,
  color,
  height = 4,
  trackColor = 'rgba(255,255,255,0.18)',
  style,
}: {
  /** 0..1 */
  progress: number;
  color: string;
  height?: number;
  trackColor?: string;
  style?: ViewStyle;
}) {
  const [trackWidth, setTrackWidth] = useState(0);
  const anim = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    Animated.timing(anim, {
      toValue: Math.max(0, Math.min(1, progress)),
      duration: 250,
      useNativeDriver: true,
    }).start();
  }, [progress, anim]);

  return (
    <View
      style={[
        { height, borderRadius: height / 2, backgroundColor: trackColor, overflow: 'hidden' },
        style,
      ]}
      onLayout={e => setTrackWidth(e.nativeEvent.layout.width)}
    >
      {trackWidth > 0 && (
        <Animated.View
          style={{
            ...StyleSheet.absoluteFillObject,
            borderRadius: height / 2,
            backgroundColor: color,
            transform: [{
              translateX: anim.interpolate({
                inputRange: [0, 1],
                outputRange: [-trackWidth, 0],
              }),
            }],
          }}
        />
      )}
    </View>
  );
}
