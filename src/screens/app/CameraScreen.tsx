import React, { useRef, useState } from 'react';
import {
  View, Text, StyleSheet, TouchableOpacity,
  Pressable, Animated,
} from 'react-native';
import { CameraView, useCameraPermissions, useMicrophonePermissions } from 'expo-camera';
import { useIsFocused, useNavigation } from '@react-navigation/native';
import { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { SafeAreaView } from 'react-native-safe-area-context';
import { AppStackParamList } from '../../types/navigation';

const MAX_RECORD_SECONDS = 30;

export default function CameraScreen() {
  const navigation = useNavigation<NativeStackNavigationProp<AppStackParamList>>();
  const isFocused = useIsFocused();
  const [cameraPermission, requestCameraPermission] = useCameraPermissions();
  const [micPermission, requestMicPermission] = useMicrophonePermissions();
  const [facing, setFacing] = useState<'front' | 'back'>('back');
  const [flash, setFlash] = useState<'on' | 'off'>('off');
  const [isRecording, setIsRecording] = useState(false);
  const [recordSeconds, setRecordSeconds] = useState(0);

  const cameraRef = useRef<CameraView>(null);
  const isRecordingRef = useRef(false);
  const recordInterval = useRef<ReturnType<typeof setInterval> | null>(null);
  const maxDurationTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Animated shutter button
  const shutterAnim = useRef(new Animated.Value(0)).current;

  function animateShutter(toValue: number) {
    Animated.timing(shutterAnim, {
      toValue,
      duration: 150,
      useNativeDriver: false,
    }).start();
  }

  const innerSize = shutterAnim.interpolate({ inputRange: [0, 1], outputRange: [64, 26] });
  const innerRadius = shutterAnim.interpolate({ inputRange: [0, 1], outputRange: [32, 6] });
  const innerColor = shutterAnim.interpolate({
    inputRange: [0, 1],
    outputRange: ['#FFFFFF', '#FF3B30'],
  });
  const outerBorderColor = shutterAnim.interpolate({
    inputRange: [0, 1],
    outputRange: ['rgba(255,255,255,0.9)', '#FF3B30'],
  });

  async function takePhoto() {
    if (!cameraRef.current) return;
    try {
      const photo = await cameraRef.current.takePictureAsync({ quality: 0.85 });
      if (photo?.uri) {
        navigation.navigate('Preview', { uri: photo.uri, mediaType: 'photo' });
      }
    } catch {}
  }

  async function startRecording() {
    if (!cameraRef.current || isRecordingRef.current) return;
    if (!micPermission?.granted) {
      await requestMicPermission();
      return;
    }

    isRecordingRef.current = true;
    setIsRecording(true);
    setRecordSeconds(0);
    animateShutter(1);

    recordInterval.current = setInterval(() => {
      setRecordSeconds(s => s + 1);
    }, 1000);

    maxDurationTimer.current = setTimeout(stopRecording, MAX_RECORD_SECONDS * 1000);

    try {
      const video = await cameraRef.current.recordAsync({ maxDuration: MAX_RECORD_SECONDS });
      if (video?.uri) {
        navigation.navigate('Preview', { uri: video.uri, mediaType: 'video' });
      }
    } catch {}

    cleanupRecording();
  }

  function stopRecording() {
    cameraRef.current?.stopRecording();
    cleanupRecording();
  }

  function cleanupRecording() {
    isRecordingRef.current = false;
    setIsRecording(false);
    setRecordSeconds(0);
    animateShutter(0);
    if (recordInterval.current) { clearInterval(recordInterval.current); recordInterval.current = null; }
    if (maxDurationTimer.current) { clearTimeout(maxDurationTimer.current); maxDurationTimer.current = null; }
  }

  function onPressOut() {
    if (isRecordingRef.current) stopRecording();
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
        />
      )}

      {/* Top bar */}
      <SafeAreaView edges={['top']} style={styles.topBar}>
        <TouchableOpacity
          style={styles.iconBtn}
          onPress={() => setFlash(f => f === 'off' ? 'on' : 'off')}
        >
          <Text style={styles.iconText}>{flash === 'on' ? '⚡' : '🔦'}</Text>
        </TouchableOpacity>

        {isRecording && (
          <View style={styles.recBadge}>
            <View style={styles.recDot} />
            <Text style={styles.recTime}>{formatTime(recordSeconds)}</Text>
          </View>
        )}

        <TouchableOpacity
          style={styles.iconBtn}
          onPress={() => setFacing(f => f === 'back' ? 'front' : 'back')}
        >
          <Text style={styles.iconText}>🔄</Text>
        </TouchableOpacity>
      </SafeAreaView>

      {/* Bottom controls */}
      <SafeAreaView edges={['bottom']} style={styles.bottomBar}>
        <Text style={styles.hint}>
          {isRecording ? 'Release to stop' : 'Tap for photo · Hold for video'}
        </Text>

        <Pressable
          onPress={takePhoto}
          onLongPress={startRecording}
          onPressOut={onPressOut}
          delayLongPress={300}
        >
          <Animated.View style={[styles.shutterOuter, { borderColor: outerBorderColor }]}>
            <Animated.View
              style={[
                styles.shutterInner,
                {
                  width: innerSize,
                  height: innerSize,
                  borderRadius: innerRadius,
                  backgroundColor: innerColor,
                },
              ]}
            />
          </Animated.View>
        </Pressable>
      </SafeAreaView>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#000000' },
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
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingHorizontal: 16,
    paddingTop: 8,
  },
  iconBtn: { padding: 10 },
  iconText: { fontSize: 26 },
  recBadge: {
    flexDirection: 'row', alignItems: 'center', gap: 6,
    backgroundColor: 'rgba(0,0,0,0.5)', borderRadius: 12,
    paddingHorizontal: 12, paddingVertical: 5,
  },
  recDot: { width: 8, height: 8, borderRadius: 4, backgroundColor: '#FF3B30' },
  recTime: { color: '#FFFFFF', fontWeight: '700', fontSize: 14 },
  bottomBar: {
    position: 'absolute', bottom: 0, left: 0, right: 0,
    alignItems: 'center', gap: 20, paddingBottom: 20, paddingTop: 8,
  },
  hint: { color: 'rgba(255,255,255,0.65)', fontSize: 13 },
  shutterOuter: {
    width: 84, height: 84, borderRadius: 42,
    borderWidth: 4, justifyContent: 'center', alignItems: 'center',
  },
  shutterInner: { width: 64, height: 64, borderRadius: 32, backgroundColor: '#FFFFFF' },
});
