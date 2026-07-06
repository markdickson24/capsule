import React, { useEffect, useRef, useState } from 'react';
import {
  View, Text, StyleSheet, PanResponder,
  TouchableOpacity, Animated, Dimensions, Platform, ActivityIndicator,
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
import InfoTooltip from '../../components/InfoTooltip';
import { stitchVideos } from '../../../modules/expo-video-stitcher';
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
// Snapchat-style drag-to-zoom: dragging up ~75% of the screen height covers the
// full 1×–5× zoom range while recording.
const ZOOM_DRAG_FACTOR = 0.75;
// Slide the shutter right by this many px while recording to arm the hands-free lock.
const LOCK_DRAG_X = 90;
// Horizontal movement beyond this suppresses vertical zoom to prevent accidental zooming
// while the finger starts a rightward lock-swipe.
const LOCK_DEADZONE_X = 20;

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
  // Hands-free lock: true once the user slides right and releases while recording.
  const [locked, setLocked] = useState(false);
  // lockArmed: finger has slid past LOCK_DRAG_X but hasn't released yet (shows affordance highlight).
  const [lockArmed, setLockArmed] = useState(false);

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
  // Refs for lock state — readable inside single-creation PanResponder closures.
  const lockedRef = useRef(false);
  const willLockRef = useRef(false);
  const hasFiredLockHapticRef = useRef(false);

  // Multi-segment recording (flip during recording).
  const segmentsRef = useRef<string[]>([]);
  // Mirrors recordSeconds for reads inside callbacks without stale closure risk.
  const recordSecondsRef = useRef(0);
  // Set by flipCameraDuringRecording before stopRecording so the segment loop
  // knows to continue rather than finalize.
  const pendingFlipRef = useRef(false);
  // Pre-created by flipCameraDuringRecording so useEffect([facing]) can resolve it
  // regardless of whether the render fires before or after recordAsync resolves.
  const flipPromiseRef = useRef<Promise<void> | null>(null);
  // The resolve callback for flipPromiseRef; null when not waiting for a flip.
  const flipReadyRef = useRef<(() => void) | null>(null);

  // Mirrors `facing` for use inside the single-creation viewfinderResponder.
  const facingRef = useRef<'front' | 'back'>('back');
  facingRef.current = facing;
  // Latest-handler ref so viewfinderResponder can call the current flipCamera closure.
  const flipCameraRef = useRef<() => void>(() => {});

  // Zoom refs — used inside PanResponder closure (no re-render needed for raw tracking)
  const zoomRef = useRef(0);
  const lastPinchDistance = useRef<number | null>(null);
  const isPinching = useRef(false);
  // Zoom level captured when the shutter is pressed, so drag-to-zoom is relative.
  const dragStartZoom = useRef(0);

  const shutterAnim = useRef(new Animated.Value(0)).current;
  const flashOpacity = useRef(new Animated.Value(0)).current;
  const zoomOpacity = useRef(new Animated.Value(0)).current;
  const zoomFadeTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  // Drives the lock-pill scale (0 = idle, 1 = armed/locked). Uses native driver.
  const lockAnim = useRef(new Animated.Value(0)).current;

  // After facing changes (triggered by flipCameraDuringRecording), signal the
  // segment loop that the CameraView has re-rendered with the new camera.
  // The promise is pre-created in flipCameraDuringRecording so flipReadyRef is
  // always set by the time this effect fires — no race condition.
  useEffect(() => {
    if (!pendingFlipRef.current || !flipReadyRef.current) return;
    const resolve = flipReadyRef.current;
    flipReadyRef.current = null;
    // 400ms for native camera hardware to complete the lens switch after React re-render.
    setTimeout(resolve, 400);
  }, [facing]);

  function animateShutter(toValue: number) {
    Animated.timing(shutterAnim, { toValue, duration: 150, useNativeDriver: false }).start();
  }

  // Apply a new zoom level (clamped 0–1) and flash the zoom badge. Only touches
  // refs / stable setters / Animated values, so it's safe to call from the
  // single-creation PanResponders without stale-closure risk.
  function bumpZoom(target: number) {
    const z = Math.min(1, Math.max(0, target));
    zoomRef.current = z;
    setZoom(z);
    zoomOpacity.setValue(1);
    if (zoomFadeTimer.current) clearTimeout(zoomFadeTimer.current);
    zoomFadeTimer.current = setTimeout(() => {
      Animated.timing(zoomOpacity, { toValue: 0, duration: 400, useNativeDriver: true }).start();
    }, 800);
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

  // Dual mode tap: fire both lenses, composite into one JPEG, resize, then Preview.
  async function captureDualPhoto() {
    if (!dualRef.current || capturing) return;
    triggerCaptureFlash();
    haptics.medium();
    setCapturing(true);
    try {
      const res = await dualRef.current.capturePhoto();
      const processedUri = await processPhoto(res.uri);
      // PiP returns a swapped composite too — resize it the same way for tap-to-swap.
      const altUri = res.altUri ? await processPhoto(res.altUri) : undefined;
      navigation.navigate('Preview', { uri: processedUri, mediaType: 'photo', altUri });
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
    segmentsRef.current = [];
    recordSecondsRef.current = 0;
    setIsRecording(true);
    setRecordSeconds(0);
    animateShutter(1);
    recordInterval.current = setInterval(() => {
      setRecordSeconds(s => {
        const next = s + 1;
        recordSecondsRef.current = next;
        return next;
      });
    }, 1000);
    maxDurationTimer.current = setTimeout(stopRecording, MAX_RECORD_SECONDS * 1000);

    // Segment loop: keeps recording across camera flips until the user stops or
    // the 30s total cap is reached.
    while (isRecordingRef.current) {
      const remaining = MAX_RECORD_SECONDS - recordSecondsRef.current;
      if (remaining <= 0) break;
      try {
        const video = await cameraRef.current!.recordAsync({ maxDuration: remaining });
        if (video?.uri) segmentsRef.current.push(video.uri);
      } catch {
        break;
      }

      if (pendingFlipRef.current) {
        // Await the pre-created promise; useEffect resolves it 400ms after the
        // CameraView re-renders with the new facing. Safety timeout at 1.5s.
        if (flipPromiseRef.current) {
          await Promise.race([
            flipPromiseRef.current,
            new Promise<void>(r => setTimeout(r, 1500)),
          ]);
          flipPromiseRef.current = null;
        }
        pendingFlipRef.current = false;
        // Loop continues → starts next segment on the new camera.
      } else {
        break; // User stopped or max-duration hit — done.
      }
    }

    const segments = segmentsRef.current;
    if (segments.length > 0) {
      if (segments.length === 1) {
        navigation.navigate('Preview', { uri: segments[0], mediaType: 'video', facing: facingRef.current });
      } else {
        let stitchedUri: string | null = null;
        try {
          const result = await stitchVideos(segments);
          stitchedUri = result.uri;
        } catch { /* native module not yet built, or stitching failed */ }

        if (stitchedUri) {
          navigation.navigate('Preview', { uri: stitchedUri, mediaType: 'video', facing: facingRef.current });
        } else {
          // Fallback: show all clips as a multi-item Preview so no segment is lost.
          navigation.navigate('Preview', {
            media: segments.map(uri => ({ uri, mediaType: 'video' as const })),
            source: 'camera',
          });
        }
      }
    }
    cleanupRecording();
  }

  function stopRecording() {
    cameraRef.current?.stopRecording();
  }

  // Flip front ↔ back mid-recording. Stops the current segment, switches the camera,
  // and lets the segment loop start a new recordAsync on the new facing.
  function flipCameraDuringRecording() {
    if (!isRecordingRef.current || isDualRef.current) return;
    pendingFlipRef.current = true;
    // Pre-create the promise so useEffect([facing]) can resolve it regardless of
    // whether the render fires before or after recordAsync resolves.
    flipPromiseRef.current = new Promise<void>(resolve => {
      flipReadyRef.current = resolve;
    });
    cameraRef.current?.stopRecording(); // current recordAsync resolves → segment saved
    setCameraMode(m => (m === 'back' ? 'front' : 'back'));
    haptics.light();
  }

  async function startDualRecording() {
    if (!dualRef.current || isRecordingRef.current) return;
    if (!micPermission?.granted) {
      const result = await requestMicPermission();
      if (!result.granted) return;
    }
    isRecordingRef.current = true;
    setIsRecording(true);
    setRecordSeconds(0);
    animateShutter(1);
    recordInterval.current = setInterval(() => setRecordSeconds(s => s + 1), 1000);
    maxDurationTimer.current = setTimeout(stopDualRecording, MAX_RECORD_SECONDS * 1000);
    try {
      const video = await dualRef.current.recordAsync({ maxDuration: MAX_RECORD_SECONDS });
      if (video?.uri) {
        navigation.navigate('Preview', { uri: video.uri, mediaType: 'video' });
      }
    } catch (e: any) {
      setDualError(e?.message ?? 'Recording failed. Try again.');
    }
    cleanupRecording();
  }

  function stopDualRecording() { dualRef.current?.stopRecording(); }

  // Called when the user taps the shutter while recording is locked hands-free.
  function handleLockedStop() {
    if (isDual) stopDualRecording();
    else stopRecording();
  }

  function cleanupRecording() {
    isRecordingRef.current = false;
    lockedRef.current = false;
    willLockRef.current = false;
    hasFiredLockHapticRef.current = false;
    pendingFlipRef.current = false;
    flipPromiseRef.current = null;
    // Unblock any pending flip-wait so the segment loop can exit cleanly.
    if (flipReadyRef.current) {
      const resolve = flipReadyRef.current;
      flipReadyRef.current = null;
      resolve();
    }
    segmentsRef.current = [];
    recordSecondsRef.current = 0;
    setIsRecording(false);
    setLocked(false);
    setLockArmed(false);
    setRecordSeconds(0);
    animateShutter(0);
    Animated.timing(lockAnim, { toValue: 0, duration: 200, useNativeDriver: true }).start();
    if (recordInterval.current) { clearInterval(recordInterval.current); recordInterval.current = null; }
    if (maxDurationTimer.current) { clearTimeout(maxDurationTimer.current); maxDurationTimer.current = null; }
  }

  function onPressIn() {
    holdStarted.current = false;
    holdTimer.current = setTimeout(() => {
      holdStarted.current = true;
      if (isDualRef.current) startDualRecording();
      else startRecording();
    }, HOLD_THRESHOLD_MS);
  }

  async function onPressOut() {
    if (holdTimer.current) { clearTimeout(holdTimer.current); holdTimer.current = null; }
    if (isDual) {
      if (holdStarted.current) stopDualRecording();
      else await captureDualPhoto();
      return;
    }
    if (holdStarted.current) stopRecording();
    else await takePhoto();
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
          bumpZoom(zoomRef.current + delta);
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
          } else if (isRecordingRef.current) {
            // During recording, double-tap flips the camera mid-segment.
            flipCameraRef.current();
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

  // Latest-handler refs so the single-creation PanResponders always invoke the
  // current closures, avoiding stale-closure bugs.
  const onPressInRef = useRef(onPressIn);
  const onPressOutRef = useRef(onPressOut);
  onPressInRef.current = onPressIn;
  onPressOutRef.current = onPressOut;
  flipCameraRef.current = flipCameraDuringRecording;

  // Shutter gesture: press/hold drives photo vs. video (via onPressIn/onPressOut),
  // dragging up/down while recording zooms in/out (Snapchat-style, 1×–5× over 75% screen),
  // and dragging right ≥ LOCK_DRAG_X arms the hands-free lock — releasing while armed
  // locks recording instead of stopping it.
  const shutterResponder = useRef(PanResponder.create({
    onStartShouldSetPanResponder: () => true,
    onMoveShouldSetPanResponder: () => true,
    onPanResponderGrant: () => {
      dragStartZoom.current = zoomRef.current;
      willLockRef.current = false;
      hasFiredLockHapticRef.current = false;
      onPressInRef.current();
    },
    onPanResponderMove: (_e, gesture) => {
      if (!isRecordingRef.current) return;
      // Horizontal right: arm / disarm the lock affordance.
      if (gesture.dx >= LOCK_DRAG_X) {
        if (!willLockRef.current) {
          willLockRef.current = true;
          setLockArmed(true);
          if (!hasFiredLockHapticRef.current) {
            hasFiredLockHapticRef.current = true;
            haptics.selection();
          }
          Animated.timing(lockAnim, { toValue: 1, duration: 150, useNativeDriver: true }).start();
        }
      } else {
        if (willLockRef.current) {
          willLockRef.current = false;
          setLockArmed(false);
          Animated.timing(lockAnim, { toValue: 0, duration: 150, useNativeDriver: true }).start();
        }
        // Vertical drag = zoom, but only when the finger hasn't moved noticeably
        // rightward — prevents accidental zoom while starting a lock swipe.
        if (gesture.dx < LOCK_DEADZONE_X) {
          bumpZoom(dragStartZoom.current - gesture.dy / (SCREEN_H * ZOOM_DRAG_FACTOR));
        }
      }
    },
    onPanResponderRelease: () => {
      if (isRecordingRef.current && willLockRef.current) {
        // Commit the lock: keep recording, switch to hands-free mode.
        lockedRef.current = true;
        setLocked(true);
        willLockRef.current = false;
        setLockArmed(false);
        hasFiredLockHapticRef.current = false;
        haptics.success();
        // lockAnim stays at 1 (locked indicator remains highlighted).
      } else {
        onPressOutRef.current();
      }
    },
    onPanResponderTerminate: () => { onPressOutRef.current(); },
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
            <TouchableOpacity
              style={styles.iconBtn}
              onPress={() => {
                if (isRecording) flipCameraDuringRecording();
                else setCameraMode(m => (m === 'back' ? 'front' : 'back'));
              }}
            >
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
            <InfoTooltip
              title="Dual Camera"
              body={"Captures front and back cameras at the same time — like BeReal or Snapchat's dual-lens mode.\n\nSide-by-side shows both feeds next to each other. PiP (picture-in-picture) puts the front camera in a small bubble over the back camera.\n\nIn PiP mode, tap the swap icon in preview to flip which camera is the main view."}
              size={16}
              color="rgba(255,255,255,0.5)"
            />
          </View>
        )}

        {/* Viewfinder — double-tap flips camera (single) or view format (dual); pinch zooms (single only) */}
        <View style={styles.viewfinder} {...viewfinderResponder.panHandlers}>
          {!isDual && (
            <Animated.View style={[styles.zoomBadge, { opacity: zoomOpacity }]}>
              <Text style={styles.zoomText}>{zoomDisplay}</Text>
            </Animated.View>
          )}

          {/* Live layout switcher (Dual mode only) — disabled during recording */}
          {isDual && (
            <View style={[styles.layoutSwitch, isRecording && { opacity: 0.35 }]}
                  pointerEvents={isRecording ? 'none' : 'auto'}>
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
            {isRecording
              ? (locked ? 'Tap to stop · Locked' : 'Release to stop · Slide ▶ to lock')
              : 'Tap for photo · Hold for video'}
          </Text>

          {/* Shutter row: spacer | shutter | lock pill (spacer keeps shutter centred) */}
          <View style={styles.shutterRow}>
            {/* Left spacer mirrors lock pill width to keep shutter centred */}
            <View style={styles.lockPillSpace} />

            {locked ? (
              /* Locked: tap the red stop button to end recording */
              <TouchableOpacity onPress={handleLockedStop} activeOpacity={0.8}>
                <View style={[styles.shutterOuter, { borderColor: '#FF3B30' }]}>
                  <View style={styles.stopSquare} />
                </View>
              </TouchableOpacity>
            ) : (
              <View {...shutterResponder.panHandlers}>
                <Animated.View style={[styles.shutterOuter, { borderColor: outerBorderColor }]}>
                  <Animated.View
                    style={[styles.shutterInner, {
                      width: innerSize, height: innerSize,
                      borderRadius: innerRadius, backgroundColor: innerColor,
                    }]}
                  />
                </Animated.View>
              </View>
            )}

            {/* Right: lock pill — shown while recording (armed highlight or locked state) */}
            {isRecording ? (
              <Animated.View
                style={[
                  styles.lockPill,
                  {
                    backgroundColor: locked || lockArmed ? accentColor : 'rgba(255,255,255,0.15)',
                    transform: [{ scale: lockAnim.interpolate({ inputRange: [0, 1], outputRange: [1, 1.12] }) }],
                  },
                ]}
              >
                <Ionicons
                  name={locked || lockArmed ? 'lock-closed' : 'lock-open-outline'}
                  size={20}
                  color="#FFFFFF"
                />
              </Animated.View>
            ) : (
              <View style={styles.lockPillSpace} />
            )}
          </View>
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
  modeDropdown: { position: 'absolute', top: 56, left: 16, zIndex: 20, flexDirection: 'row', alignItems: 'center', gap: 8 },
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
  shutterRow: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center',
  },
  shutterOuter: {
    width: 84, height: 84, borderRadius: 42,
    borderWidth: 4, justifyContent: 'center', alignItems: 'center',
  },
  shutterInner: { backgroundColor: '#FFFFFF' },
  stopSquare: { width: 28, height: 28, borderRadius: 6, backgroundColor: '#FF3B30' },
  lockPill: {
    width: 48, height: 48, borderRadius: 24,
    marginLeft: 18,
    justifyContent: 'center', alignItems: 'center',
  },
  lockPillSpace: { width: 48 + 18, height: 48 }, // matches lockPill + marginLeft
});
