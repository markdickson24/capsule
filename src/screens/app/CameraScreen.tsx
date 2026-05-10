import React, { useRef, useState } from 'react';
import {
  View, Text, StyleSheet, TouchableWithoutFeedback,
  TouchableOpacity, Pressable, Animated, Dimensions,
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

const { width: SCREEN_W, height: SCREEN_H } = Dimensions.get('screen');
const SCREEN_RATIO = SCREEN_H / SCREEN_W;

export default function CameraScreen() {
  const navigation = useNavigation<NativeStackNavigationProp<AppStackParamList>>();
  const isFocused = useIsFocused();
  const [cameraPermission, requestCameraPermission] = useCameraPermissions();
  const [micPermission, requestMicPermission] = useMicrophonePermissions();
  const [facing, setFacing] = useState<'front' | 'back'>('back');
  const [flash, setFlash] = useState<'on' | 'off'>('off');
  const [isRecording, setIsRecording] = useState(false);
  const [recordSeconds, setRecordSeconds] = useState(0);
  const [captureFlash, setCaptureFlash] = useState(false);

  const cameraRef = useRef<CameraView>(null);
  const isRecordingRef = useRef(false);
  const holdStarted = useRef(false);
  const holdTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const recordInterval = useRef<ReturnType<typeof setInterval> | null>(null);
  const maxDurationTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const lastTapRef = useRef(0);

  const shutterAnim = useRef(new Animated.Value(0)).current;
  const flashOpacity = useRef(new Animated.Value(0)).current;

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
    Animated.timing(flashOpacity, {
      toValue: 0, duration: 120, useNativeDriver: true,
    }).start();
  }

  async function cropToScreen(uri: string, photoWidth: number, photoHeight: number, flipH: boolean) {
    const photoRatio = photoHeight / photoWidth;
    let actions: ImageManipulator.Action[] = [];

    if (photoRatio > SCREEN_RATIO) {
      const targetH = Math.round(photoWidth * SCREEN_RATIO);
      const originY = Math.round((photoHeight - targetH) / 2);
      actions.push({ crop: { originX: 0, originY, width: photoWidth, height: targetH } });
    } else {
      const targetW = Math.round(photoHeight / SCREEN_RATIO);
      const originX = Math.round((photoWidth - targetW) / 2);
      actions.push({ crop: { originX, originY: 0, width: targetW, height: photoHeight } });
    }

    if (flipH) actions.push({ flip: ImageManipulator.FlipType.Horizontal });

    const result = await ImageManipulator.manipulateAsync(uri, actions, { compress: 0.88 });
    return result.uri;
  }

  async function takePhoto() {
    if (!cameraRef.current) return;
    triggerCaptureFlash();
    try {
      const photo = await cameraRef.current.takePictureAsync({ quality: 0.88, skipProcessing: false });
      if (!photo?.uri) return;
      const croppedUri = await cropToScreen(photo.uri, photo.width, photo.height, facing === 'front');
      navigation.navigate('Preview', { uri: croppedUri, mediaType: 'photo' });
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

  function handleViewfinderTap() {
    const now = Date.now();
    if (now - lastTapRef.current < DOUBLE_TAP_MS) {
      setFacing(f => f === 'back' ? 'front' : 'back');
      lastTapRef.current = 0;
    } else {
      lastTapRef.current = now;
    }
  }

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

  return (
    <View style={styles.container}>
      {isFocused && (
        <CameraView
          ref={cameraRef}
          style={StyleSheet.absoluteFill}
          facing={facing}
          flash={flash}
          mode="video"
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

        {/* Viewfinder — double tap to switch camera */}
        <TouchableWithoutFeedback onPress={handleViewfinderTap}>
          <View style={styles.viewfinder} />
        </TouchableWithoutFeedback>

        {/* Bottom shutter */}
        <View style={styles.bottomBar}>
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
  viewfinder: { flex: 1 },
  bottomBar: { alignItems: 'center', gap: 16, paddingVertical: 16 },
  hint: { color: 'rgba(255,255,255,0.65)', fontSize: 13 },
  shutterOuter: {
    width: 84, height: 84, borderRadius: 42,
    borderWidth: 4, justifyContent: 'center', alignItems: 'center',
  },
  shutterInner: { backgroundColor: '#FFFFFF' },
});
