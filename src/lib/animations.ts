import { useRef, useEffect, useCallback } from 'react';
import { Animated, Easing } from 'react-native';
import { useIsFocused } from '@react-navigation/native';

export function useFadeIn(delay = 0, duration = 300) {
  const opacity = useRef(new Animated.Value(0)).current;
  const focused = useIsFocused();
  const hasAnimatedRef = useRef(false);

  useEffect(() => {
    if (!focused) return;
    if (hasAnimatedRef.current) {
      // Already played once this screen instance — data is likely already
      // cached and instant, so snap straight to the final state instead of
      // replaying the entrance on every tab re-focus.
      opacity.setValue(1);
      return;
    }
    hasAnimatedRef.current = true;
    opacity.setValue(0);
    Animated.timing(opacity, {
      toValue: 1,
      duration,
      delay,
      easing: Easing.out(Easing.cubic),
      useNativeDriver: true,
    }).start();
  }, [focused]);

  return { opacity };
}

export function useSlideUp(delay = 0, duration = 350) {
  const opacity = useRef(new Animated.Value(0)).current;
  const translateY = useRef(new Animated.Value(20)).current;
  const focused = useIsFocused();
  const hasAnimatedRef = useRef(false);

  useEffect(() => {
    if (!focused) return;
    if (hasAnimatedRef.current) {
      opacity.setValue(1);
      translateY.setValue(0);
      return;
    }
    hasAnimatedRef.current = true;
    opacity.setValue(0);
    translateY.setValue(20);
    Animated.parallel([
      Animated.timing(opacity, {
        toValue: 1,
        duration,
        delay,
        easing: Easing.out(Easing.cubic),
        useNativeDriver: true,
      }),
      Animated.timing(translateY, {
        toValue: 0,
        duration,
        delay,
        easing: Easing.out(Easing.cubic),
        useNativeDriver: true,
      }),
    ]).start();
  }, [focused]);

  return { opacity, transform: [{ translateY }] };
}

export function useListItemEntrance(index: number, baseDelay = 0) {
  const opacity = useRef(new Animated.Value(0)).current;
  const translateY = useRef(new Animated.Value(16)).current;
  const focused = useIsFocused();
  const hasAnimatedRef = useRef(false);

  useEffect(() => {
    if (!focused) return;
    if (hasAnimatedRef.current) {
      opacity.setValue(1);
      translateY.setValue(0);
      return;
    }
    hasAnimatedRef.current = true;
    opacity.setValue(0);
    translateY.setValue(16);
    const delay = baseDelay + Math.min(index, 8) * 60;
    Animated.parallel([
      Animated.timing(opacity, {
        toValue: 1,
        duration: 300,
        delay,
        easing: Easing.out(Easing.cubic),
        useNativeDriver: true,
      }),
      Animated.timing(translateY, {
        toValue: 0,
        duration: 300,
        delay,
        easing: Easing.out(Easing.cubic),
        useNativeDriver: true,
      }),
    ]).start();
  }, [focused]);

  return { opacity, transform: [{ translateY }] };
}
