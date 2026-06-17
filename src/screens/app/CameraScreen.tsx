import React, { useRef, useState } from 'react';
import {
  View, Text, StyleSheet, PanResponder,
  TouchableOpacity, Pressable, Animated, Dimensions, Platform, ActivityIndicator,
} from 'react-native';
import { CameraView, useCameraPermissions, useMicrophonePermissions } from 'expo-camera';
import * as ImageManipulator from 'expo-image-manipulator';
import { haptics } from '../../lib/haptics';
import { useIsFocused, useNavigation } from '@react-navigation/native';
import { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { AppStackParamList } from '../../types/navigation';
import { useTheme } from '../../context/ThemeContext';
import {
  DualCameraView,
  isDualCameraSupported,
  type DualCameraViewRef,
  type DualCameraLayout,
} from '../../../modules/expo-dual-camera';

type CameraMode = 'back' | 'front' | 'dual';

// Live layout options for Dual mode, shown as a switcher over the dual preview.
const DUAL_LAYOUTS: { value: DualCameraLayout; label: string; icon: keyof typeof Ionicons.glyphMap }[] = [
  { value: 'sideBySide', label: 'Split', icon: 'copy-outline' },
  { value: 'pip', label: 'PiP', icon: 'albums-outline' },
];

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
  const { accentColor } = useTheme();
  const navigation = useNavigation<NativeStackNavigationProp<AppStackParamList>>();
  const isFocused = useIsFocused();
  const [cameraPermission, requestCameraPermission] = useCameraPermissions();
  const [micPermission, requestMicPermission] = useMicrophonePermissions();
  const [cameraMode, setCameraMode] = useState<CameraMode>('back');
  const [dualError, setDualError] = useState<string | null>(null);
  const [dualLayout, setDualLayout] = useState<DualCameraLayout>('sideBySide');
  const [flash, setFlash] = useState<'on' | 'off'>('off');
  const [capturing, setCapturing] = useState(false);
  const [isRecording, setIsRecording] = useState(false);
  const [recordSeconds, setRecordSeconds] = useState(0);
  const [zoom, setZoom] = useState(0);

  // The single-camera CameraView only knows front/back; Dual swaps in DualCameraView.
  const facing: 'front' | 'back' = cameraMode === 'front' ? 'front' : 'back';
  const isDual = cameraMode === 'dual';

  const cameraRef = useRef<CameraView>(null);
  const dualRef = useRef<DualCameraViewRef>(null);
  const isRecordingRef = useRef(false);
  const holdStarted = useRef(false);
  const holdTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const recordInterval = useRef<ReturnType<typeof setInterval> | null>(null);
  const maxDurationTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const lastTapRef = useRef(0);
  // Mirror of `isDual` readable inside the single-creation PanResponder closure.
  const isDualRef = useRef(false);
  isDualRef.current = isDual;

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
    if (!cameraRef.current || capturing) return;
    triggerCaptureFlash();
    haptics.medium();
    setCapturing(true);
    try {
      const photo = await cameraRef.current.takePictureAsync({ quality: 0.88, skipProcessing: false });
      if (!photo?.uri) return;
      const processedUri = await processPhoto(photo.uri);
      navigation.navigate('Preview', { uri: processedUri, mediaType: 'photo' });
    } catch {} finally {
      setCapturing(false);
    }
  }

  // Dual mode: fire both lenses, get back the side-by-side composite, then reuse
  // the normal resize/Preview path. Video isn't available in Dual yet (Phase 1).
  async function captureDualPhoto() {
    if (!dualRef.current || capturing) return;
    triggerCaptureFlash();
    haptics.medium();
    setCapturing(true);
    try {
      const res = await dualRef.current.capturePhoto();
      const processedUri = await processPhoto(res.uri);
      navigation.navigate('Preview', { uri: processedUri, mediaType: 'photo' });
    } catch (e: any) {
      setDualError(e?.message ?? 'Dual capture failed. Try again.');
    } finally {
      setCapturing(false);
    }
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
    if (isDual) return; // No hold-to-record in Dual yet — tap-only photo composite.
    holdStarted.current = false;
    holdTimer.current = setTimeout(() => {
      holdStarted.current = true;
      startRecording();
    }, HOLD_THRESHOLD_MS);
  }

  async function onPressOut() {
    if (isDual) { await captureDualPhoto(); return; }
    if (holdTimer.current) { clearTimeout(holdTimer.current); holdTimer.current = null; }
    if (holdStarted.current) {
      stopRecording();
    } else {
      await takePhoto();
    }
  }

  function toggleDual() {
    setDualError(null);
    setCameraMode(m => (m === 'dual' ? 'back' : 'dual'));
  }

  // Handles both pinch-to-zoom and double-tap-to-flip on the viewfinder.
  // All variables referenced inside are refs or stable useState setters — safe for a single-creation PanResponder.
  const viewfinderResponder = useRef(PanResponder.create({
    onStartShouldSetPanResponder: () => true,
    onMoveShouldSetPanResponder: (e) => e.nativeEvent.touches.length >= 2,

    onPanResponderGrant: (e) => {
      if (isDualRef.current) return; // no pinch-zoom in dual
      if (e.nativeEvent.touches.length >= 2) {
        isPinching.current = true;
        lastPinchDistance.current = getPinchDistance(e.nativeEvent.touches);
      }
    },

    onPanResponderMove: (e) => {
      if (isDualRef.current) return; // no pinch-zoom in dual
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
          if (isDualRef.current) {
            // In dual, double-tap flips the view format (split <-> picture-in-picture).
            setDualLayout(l => (l === 'sideBySide' ? 'pip' : 'sideBySide'));
          } else {
            setCameraMode(m => (m === 'back' ? 'front' : 'back'));
          }
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
        <Ionicons name="camera-outline" size={52} color={accentColor} />
        <Text style={styles.permTitle}>Camera access needed</Text>
        <Text style={styles.permSubtext}>Allow Capsule to use your camera</Text>
        <TouchableOpacity style={[styles.permBtn, { backgroundColor: accentColor }]} onPress={requestCameraPermission}>
          <Text style={styles.permBtnText}>Grant Access</Text>
        </TouchableOpacity>
      </SafeAreaView>
    );
  }

  const formatTime = (s: number) => `${Math.floor(s / 60)}:${(s % 60).toString().padStart(2, '0')}`;
  const zoomDisplay = `${(zoom * 4 + 1).toFixed(1)}×`;

  return (
    <View style={styles.container}>
      {isFocused && !isDual && (
        <CameraView
          ref={cameraRef}
          style={StyleSheet.absoluteFill}
          facing={facing}
          flash={flash}
          mode="video"
          zoom={zoom}
          mirror={facing === 'front'}
        />
      )}
      {isFocused && isDual && (
        <DualCameraView
          ref={dualRef}
          style={StyleSheet.absoluteFill}
          layout={dualLayout}
          mirrorFront
          onInitError={(e) => {
            // Hardware/permission failure — fall back to the single back camera.
            setDualError(e.nativeEvent.message);
            setCameraMode('back');
          }}
        />
      )}

      {/* White flash on capture */}
      <Animated.View
        pointerEvents="none"
        style={[StyleSheet.absoluteFill, styles.captureFlash, { opacity: flashOpacity }]}
      />

      {/* Processing overlay — capture + resize take a beat; without this it looks
          like nothing happened. Blocks input so a second tap can't double-fire. */}
      {capturing && (
        <View style={[StyleSheet.absoluteFill, styles.processingOverlay]}>
          <ActivityIndicator size="large" color="#FFFFFF" />
          <Text style={styles.processingText}>Saving…</Text>
        </View>
      )}

      <SafeAreaView edges={['top', 'bottom']} style={styles.layout}>
        {/* Top bar */}
        <View style={styles.topBar}>
          <TouchableOpacity style={styles.iconBtn} onPress={() => setFlash(f => f === 'off' ? 'on' : 'off')}>
            <Ionicons name={flash === 'on' ? 'flash-outline' : 'flash-off-outline'} size={26} color="#FFFFFF" />
          </TouchableOpacity>

          {isRecording ? (
            <View style={styles.recBadge}>
              <View style={styles.recDot} />
              <Text style={styles.recTime}>{formatTime(recordSeconds)}</Text>
            </View>
          ) : (
            <Text style={styles.doubleTapHint}>{isDual ? 'Double tap to switch view' : 'Double tap to flip'}</Text>
          )}

          {isDual ? (
            <View style={styles.iconBtn} />
          ) : (
            <TouchableOpacity style={styles.iconBtn} onPress={() => setCameraMode(m => (m === 'back' ? 'front' : 'back'))}>
              <Ionicons name="camera-reverse-outline" size={26} color="#FFFFFF" />
            </TouchableOpacity>
          )}
        </View>

        {/* Single Dual-camera toggle (only where multi-cam is supported) */}
        {isDualCameraSupported && (
          <View style={styles.modeDropdown}>
            <TouchableOpacity
              style={[styles.modeChip, isDual && { backgroundColor: accentColor }]}
              activeOpacity={0.8}
              onPress={toggleDual}
            >
              <Ionicons name="copy-outline" size={18} color="#FFFFFF" />
              <Text style={styles.modeChipLabel}>{isDual ? 'Dual on' : 'Dual'}</Text>
            </TouchableOpacity>
          </View>
        )}

        {/* Viewfinder — double-tap flips camera (single) or view format (dual); pinch zooms (single only) */}
        <View style={styles.viewfinder} {...viewfinderResponder.panHandlers}>
          {!isDual && (
            <Animated.View style={[styles.zoomBadge, { opacity: zoomOpacity }]}>
              <Text style={styles.zoomText}>{zoomDisplay}</Text>
            </Animated.View>
          )}

          {/* Live layout switcher (Dual mode only) — Split vs Picture-in-Picture */}
          {isDual && (
            <View style={styles.layoutSwitch}>
              {DUAL_LAYOUTS.map(({ value, label, icon }) => {
                const active = value === dualLayout;
                return (
                  <TouchableOpacity
                    key={value}
                    style={[styles.layoutOption, active && { backgroundColor: accentColor }]}
                    activeOpacity={0.85}
                    onPress={() => setDualLayout(value)}
                  >
                    <Ionicons name={icon} size={16} color="#FFFFFF" />
                    <Text style={styles.layoutOptionLabel}>{label}</Text>
                  </TouchableOpacity>
                );
              })}
            </View>
          )}
        </View>

        {/* Bottom shutter — extra padding on web so it clears the tab bar */}
        <View style={[styles.bottomBar, Platform.OS === 'web' && styles.bottomBarWeb]}>
          {dualError && <Text style={styles.dualError}>{dualError}</Text>}
          <Text style={styles.hint}>
            {isDual
              ? 'Tap for a dual photo'
              : isRecording ? 'Release to stop' : 'Tap for photo · Hold for video'}
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
  processingOverlay: {
    backgroundColor: 'rgba(0,0,0,0.55)',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 14,
    zIndex: 20,
  },
  processingText: { color: '#FFFFFF', fontSize: 15, fontWeight: '600' },
  layout: { flex: 1 },
  permContainer: {
    flex: 1, backgroundColor: '#0A0A0A',
    justifyContent: 'center', alignItems: 'center', gap: 12, paddingHorizontal: 40,
  },
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
  doubleTapHint: { color: 'rgba(255,255,255,0.45)', fontSize: 12 },
  modeDropdown: { position: 'absolute', top: 56, left: 16, zIndex: 20 },
  modeChip: {
    flexDirection: 'row', alignItems: 'center', gap: 6,
    backgroundColor: 'rgba(0,0,0,0.55)', borderRadius: 10,
    paddingHorizontal: 12, paddingVertical: 8,
  },
  modeChipLabel: { color: '#FFFFFF', fontWeight: '700', fontSize: 13 },
  modeMenu: {
    marginTop: 6, backgroundColor: 'rgba(0,0,0,0.7)', borderRadius: 10,
    paddingVertical: 4, overflow: 'hidden',
  },
  modeItem: {
    flexDirection: 'row', alignItems: 'center', gap: 8,
    paddingHorizontal: 12, paddingVertical: 9,
  },
  modeItemActive: { backgroundColor: 'rgba(255,255,255,0.08)' },
  modeItemLabel: { color: '#FFFFFF', fontWeight: '600', fontSize: 13 },
  dualError: { color: '#FF3B30', fontSize: 12, textAlign: 'center', paddingHorizontal: 24 },
  recBadge: {
    flexDirection: 'row', alignItems: 'center', gap: 6,
    backgroundColor: 'rgba(0,0,0,0.5)', borderRadius: 12,
    paddingHorizontal: 12, paddingVertical: 5,
  },
  recDot: { width: 8, height: 8, borderRadius: 4, backgroundColor: '#FF3B30' },
  recTime: { color: '#FFFFFF', fontWeight: '700', fontSize: 14 },
  viewfinder: { flex: 1, justifyContent: 'flex-end', alignItems: 'center', paddingBottom: 16 },
  layoutSwitch: {
    flexDirection: 'row', gap: 6, backgroundColor: 'rgba(0,0,0,0.45)',
    borderRadius: 14, padding: 4,
  },
  layoutOption: {
    flexDirection: 'row', alignItems: 'center', gap: 6,
    paddingHorizontal: 14, paddingVertical: 8, borderRadius: 10,
  },
  layoutOptionLabel: { color: '#FFFFFF', fontWeight: '600', fontSize: 13 },
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
