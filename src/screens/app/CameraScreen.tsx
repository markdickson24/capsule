import React, { useRef, useState } from 'react';
import {
  View, Text, StyleSheet, PanResponder,
  TouchableOpacity, Pressable, Animated, Dimensions, Platform,
} from 'react-native';
import { CameraView, useCameraPermissions, useMicrophonePermissions } from 'expo-camera';
import * as ImageManipulator from 'expo-image-manipulator';
import { useIsFocused, useNavigation } from '@react-navigation/native';
import { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { SafeAreaView } from 'react-native-safe-area-context';
import { AppStackParamList } from '../../types/navigation';

const MAX_RECORD_SECONDS = 30;
const HOLD_THRESHOLD_MS = 300;
const DOUBLE_TAP_MS = 300;

// Height of the custom tab bar on web (no safe area inset on web)
const WEB_TAB_BAR_HEIGHT = 60;

const { width: SCREEN_W, height: SCREEN_H } = Dimensions.get('screen');
const SCREEN_RATIO = SCREEN_H / SCREEN_W;

function getPinchDistance(touches: ArrayLike<{ pageX: number; pageY: number }>) {
  const t = Array.from(touches);
  const dx = t[0].pageX - t[1].pageX;
  const dy = t[0].pageY - t[1].pageY;
  return Math.sqrt(dx * dx + dy * dy);
}

export default function CameraScreen() {
  const navigation = useNavigation<NativeStackNavigationProp<AppStackParamList>>();
  const isFocused = useIsFocused();
  const [cameraPermission, requestCameraPermission] = useCameraPermissions();
  const [micPermission, requestMicPermission] = useMicrophonePermissions();
  const [facing, setFacing] = useState<'front' | 'back'>('back');
  const [flash, setFlash] = useState<'on' | 'off'>('off');
  const [isRecording, setIsRecording] = useState(false);
  const [recordSeconds, setRecordSeconds] = useState(0);
  const [zoom, setZoom] = useState(0);

  const cameraRef = useRef<CameraView>(null);
  const isRecordingRef = useRef(false);
  const holdStarted = useRef(false);
  const holdTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const recordInterval = useRef<ReturnType<typeof setInterval> | null>(null);
  const maxDurationTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const lastTapRef = useRef(0);

  // Zoom refs — used inside PanResponder closure (no re-render needed for raw tracking)
  const zoomRef = useRef(0);
  const lastPinchDistance = useRef<number | null>(null);
  const isPinching = useRef(false);

  const shutterAnim = useRef(new Animated.Value(0)).current;
  const flashOpacity = useRef(new Animated.Value(0)).current;
  const zoomOpacity = useRef(new Animated.Value(0)).current;
  const zoomFadeTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  function animateShutter(toValue: number) {
    Animated.timing(shutterAnim, { toValue, duration: 150, useNativeDriver: false }).start();
  }

  const innerSize = shutterAnim.interpolate({ inputRange: [0, 1], outputRange: [64, 26] });
  const innerRadius = shutterAnim.interpolate({ inputRange: [0, 1], outputRange: [32, 6] });
  const innerColor = shutterAnim.interpolate({
    inputRange: [0, 1], outputRange: ['#FFFFFF', '#FF3B30'],
  });
  const outerBorderColor = shutterAnim.interpolate({
    inputRange: [0, 1], outputRange: ['rgba(255,255,255,0.9)', '#FF3B30'],
  });

  function triggerCaptureFlash() {
    flashOpacity.setValue(1);
    Animated.timing(flashOpacity, { toValue: 0, duration: 120, useNativeDriver: true }).start();
  }

  async function processPhoto(uri: string): Promise<string> {
    const result = await ImageManipulator.manipulateAsync(
      uri, [{ resize: { width: 1920 } }], { compress: 0.82 }
    );
    return result.uri;
  }

  async function takePhoto() {
    if (!cameraRef.current) return;
    triggerCaptureFlash();
    try {
      const photo = await cameraRef.current.takePictureAsync({ quality: 0.88, skipProcessing: false });
      if (!photo?.uri) return;
      const processedUri = await processPhoto(photo.uri);
      navigation.navigate('Preview', { uri: processedUri, mediaType: 'photo' });
    } catch {}
  }

  async function startRecording() {
    if (!cameraRef.current || isRecordingRef.current) return;
    if (!micPermission?.granted) {
      const result = await requestMicPermission();
      if (!result.granted) return;
    }
    isRecordingRef.current = true;
    setIsRecording(true);
    setRecordSeconds(0);
    animateShutter(1);
    recordInterval.current = setInterval(() => setRecordSeconds(s => s + 1), 1000);
    maxDurationTimer.current = setTimeout(stopRecording, MAX_RECORD_SECONDS * 1000);
    try {
      const video = await cameraRef.current.recordAsync({ maxDuration: MAX_RECORD_SECONDS });
      if (video?.uri) {
        navigation.navigate('Preview', { uri: video.uri, mediaType: 'video', facing });
      }
    } catch {}
    cleanupRecording();
  }

  function stopRecording() { cameraRef.current?.stopRecording(); }

  function cleanupRecording() {
    isRecordingRef.current = false;
    setIsRecording(false);
    setRecordSeconds(0);
    animateShutter(0);
    if (recordInterval.current) { clearInterval(recordInterval.current); recordInterval.current = null; }
    if (maxDurationTimer.current) { clearTimeout(maxDurationTimer.current); maxDurationTimer.current = null; }
  }

  function onPressIn() {
    holdStarted.current = false;
    holdTimer.current = setTimeout(() => {
      holdStarted.current = true;
      startRecording();
    }, HOLD_THRESHOLD_MS);
  }

  async function onPressOut() {
    if (holdTimer.current) { clearTimeout(holdTimer.current); holdTimer.current = null; }
    if (holdStarted.current) {
      stopRecording();
    } else {
      await takePhoto();
    }
  }

  // Handles both pinch-to-zoom and double-tap-to-flip on the viewfinder.
  // All variables referenced inside are refs or stable useState setters — safe for a single-creation PanResponder.
  const viewfinderResponder = useRef(PanResponder.create({
    onStartShouldSetPanResponder: () => true,
    onMoveShouldSetPanResponder: (e) => e.nativeEvent.touches.length >= 2,

    onPanResponderGrant: (e) => {
      if (e.nativeEvent.touches.length >= 2) {
        isPinching.current = true;
        lastPinchDistance.current = getPinchDistance(e.nativeEvent.touches);
      }
    },

    onPanResponderMove: (e) => {
      const { touches } = e.nativeEvent;
      if (touches.length >= 2) {
        isPinching.current = true;
        const dist = getPinchDistance(touches);
        if (lastPinchDistance.current !== null) {
          const delta = (dist - lastPinchDistance.current) / 250;
          const newZoom = Math.min(1, Math.max(0, zoomRef.current + delta));
          zoomRef.current = newZoom;
          setZoom(newZoom);
          // Show zoom badge
          zoomOpacity.setValue(1);
          if (zoomFadeTimer.current) clearTimeout(zoomFadeTimer.current);
          zoomFadeTimer.current = setTimeout(() => {
            Animated.timing(zoomOpacity, { toValue: 0, duration: 400, useNativeDriver: true }).start();
          }, 800);
        }
        lastPinchDistance.current = dist;
      }
    },

    onPanResponderRelease: (_e, gesture) => {
      const wasPinching = isPinching.current;
      isPinching.current = false;
      lastPinchDistance.current = null;
      // Only treat as a tap if no pinch occurred and the finger barely moved
      if (!wasPinching && Math.abs(gesture.dx) < 8 && Math.abs(gesture.dy) < 8) {
        const now = Date.now();
        if (now - lastTapRef.current < DOUBLE_TAP_MS) {
          setFacing(f => f === 'back' ? 'front' : 'back');
          lastTapRef.current = 0;
        } else {
          lastTapRef.current = now;
        }
      }
    },
  })).current;

  if (!cameraPermission) return <View style={styles.container} />;

  if (!cameraPermission.granted) {
    return (
      <SafeAreaView style={styles.permContainer}>
        <Text style={styles.permIcon}>📷</Text>
        <Text style={styles.permTitle}>Camera access needed</Text>
        <Text style={styles.permSubtext}>Allow Capsule to use your camera</Text>
        <TouchableOpacity style={styles.permBtn} onPress={requestCameraPermission}>
          <Text style={styles.permBtnText}>Grant Access</Text>
        </TouchableOpacity>
      </SafeAreaView>
    );
  }

  const formatTime = (s: number) => `${Math.floor(s / 60)}:${(s % 60).toString().padStart(2, '0')}`;
  const zoomDisplay = `${(zoom * 4 + 1).toFixed(1)}×`;

  return (
    <View style={styles.container}>
      {isFocused && (
        <CameraView
          ref={cameraRef}
          style={StyleSheet.absoluteFill}
          facing={facing}
          flash={flash}
          mode="video"
          zoom={zoom}
        />
      )}

      {/* White flash on capture */}
      <Animated.View
        pointerEvents="none"
        style={[StyleSheet.absoluteFill, styles.captureFlash, { opacity: flashOpacity }]}
      />

      <SafeAreaView edges={['top', 'bottom']} style={styles.layout}>
        {/* Top bar */}
        <View style={styles.topBar}>
          <TouchableOpacity style={styles.iconBtn} onPress={() => setFlash(f => f === 'off' ? 'on' : 'off')}>
            <Text style={styles.iconText}>{flash === 'on' ? '⚡' : '🔦'}</Text>
          </TouchableOpacity>

          {isRecording ? (
            <View style={styles.recBadge}>
              <View style={styles.recDot} />
              <Text style={styles.recTime}>{formatTime(recordSeconds)}</Text>
            </View>
          ) : (
            <Text style={styles.doubleTapHint}>Double tap to flip</Text>
          )}

          <TouchableOpacity style={styles.iconBtn} onPress={() => setFacing(f => f === 'back' ? 'front' : 'back')}>
            <Text style={styles.iconText}>🔄</Text>
          </TouchableOpacity>
        </View>

        {/* Viewfinder — double-tap to switch camera, pinch to zoom */}
        <View style={styles.viewfinder} {...viewfinderResponder.panHandlers}>
          <Animated.View style={[styles.zoomBadge, { opacity: zoomOpacity }]}>
            <Text style={styles.zoomText}>{zoomDisplay}</Text>
          </Animated.View>
        </View>

        {/* Bottom shutter — extra padding on web so it clears the tab bar */}
        <View style={[styles.bottomBar, Platform.OS === 'web' && styles.bottomBarWeb]}>
          <Text style={styles.hint}>
            {isRecording ? 'Release to stop' : 'Tap for photo · Hold for video'}
          </Text>
          <Pressable onPressIn={onPressIn} onPressOut={onPressOut}>
            <Animated.View style={[styles.shutterOuter, { borderColor: outerBorderColor }]}>
              <Animated.View
                style={[styles.shutterInner, {
                  width: innerSize, height: innerSize,
                  borderRadius: innerRadius, backgroundColor: innerColor,
                }]}
              />
            </Animated.View>
          </Pressable>
        </View>
      </SafeAreaView>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#000000' },
  captureFlash: { backgroundColor: '#FFFFFF' },
  layout: { flex: 1 },
  permContainer: {
    flex: 1, backgroundColor: '#0A0A0A',
    justifyContent: 'center', alignItems: 'center', gap: 12, paddingHorizontal: 40,
  },
  permIcon: { fontSize: 48 },
  permTitle: { fontSize: 22, fontWeight: '800', color: '#FFFFFF' },
  permSubtext: { fontSize: 15, color: '#888888', textAlign: 'center' },
  permBtn: {
    marginTop: 8, backgroundColor: '#FF6B35', borderRadius: 14,
    paddingHorizontal: 32, paddingVertical: 14,
  },
  permBtnText: { color: '#FFFFFF', fontWeight: '700', fontSize: 16 },
  topBar: {
    flexDirection: 'row', justifyContent: 'space-between',
    alignItems: 'center', paddingHorizontal: 16, paddingVertical: 8,
  },
  iconBtn: { padding: 10 },
  iconText: { fontSize: 26 },
  doubleTapHint: { color: 'rgba(255,255,255,0.45)', fontSize: 12 },
  recBadge: {
    flexDirection: 'row', alignItems: 'center', gap: 6,
    backgroundColor: 'rgba(0,0,0,0.5)', borderRadius: 12,
    paddingHorizontal: 12, paddingVertical: 5,
  },
  recDot: { width: 8, height: 8, borderRadius: 4, backgroundColor: '#FF3B30' },
  recTime: { color: '#FFFFFF', fontWeight: '700', fontSize: 14 },
  viewfinder: { flex: 1, justifyContent: 'flex-end', alignItems: 'center', paddingBottom: 16 },
  zoomBadge: {
    backgroundColor: 'rgba(0,0,0,0.55)', borderRadius: 12,
    paddingHorizontal: 14, paddingVertical: 5,
  },
  zoomText: { color: '#FFFFFF', fontWeight: '600', fontSize: 15, letterSpacing: 0.5 },
  bottomBar: { alignItems: 'center', gap: 16, paddingVertical: 16 },
  bottomBarWeb: { paddingBottom: 16 + WEB_TAB_BAR_HEIGHT },
  hint: { color: 'rgba(255,255,255,0.65)', fontSize: 13 },
  shutterOuter: {
    width: 84, height: 84, borderRadius: 42,
    borderWidth: 4, justifyContent: 'center', alignItems: 'center',
  },
  shutterInner: { backgroundColor: '#FFFFFF' },
});
