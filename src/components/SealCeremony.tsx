import React, { useEffect, useRef, useState } from 'react';
import { View, Text, StyleSheet, Animated, TouchableOpacity, Modal } from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { Ionicons } from '@expo/vector-icons';
import { useTheme } from '../context/ThemeContext';
import { haptics } from '../lib/haptics';
import { requestPushPermission, getPushPermissionStatus } from '../hooks/usePushNotifications';

// The product is named after sealing something away — the unlock gets a reveal
// animation, so the lock deserves a moment too. Shown full-screen right after a
// standalone capsule create (Onboarding has its own inline step-5 ceremony).
// A ~1.5s "Sealed 🔒 — opens {when}" beat, then — only for users who haven't
// yet decided on push — a soft primer before the OS dialog, so the native
// prompt is spent contextually rather than cold. Either way it ends in onDone.

const SEAL_HOLD_MS = 1500;
const PRIMER_SEEN_KEY = 'cap_seal_primer_seen';

type Phase = 'seal' | 'primer';

export default function SealCeremony({
  subtitle,
  userId,
  onDone,
}: {
  /** e.g. "opens Jun 30, 2026" or "opens when you're all together". */
  subtitle: string;
  userId: string;
  onDone: () => void;
}) {
  const { accentColor } = useTheme();
  const [phase, setPhase] = useState<Phase>('seal');
  const sealAnim = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    haptics.success();
    Animated.spring(sealAnim, { toValue: 1, friction: 5, tension: 60, useNativeDriver: true }).start();

    let cancelled = false;
    const timer = setTimeout(async () => {
      // Show the soft primer only when push is genuinely undecided AND we've
      // never shown this create-flow primer before — so it lands once, for
      // users who skipped/deferred the onboarding primer, and never nags.
      let showPrimer = false;
      try {
        const seen = await AsyncStorage.getItem(PRIMER_SEEN_KEY);
        if (!seen) {
          const status = await getPushPermissionStatus();
          showPrimer = status === 'undetermined';
        }
      } catch {
        showPrimer = false;
      }
      if (cancelled) return;
      if (showPrimer) setPhase('primer');
      else onDone();
    }, SEAL_HOLD_MS);

    return () => { cancelled = true; clearTimeout(timer); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function primerYes() {
    try { await AsyncStorage.setItem(PRIMER_SEEN_KEY, '1'); } catch {}
    try { await requestPushPermission(userId); } catch {}
    onDone();
  }

  async function primerLater() {
    try { await AsyncStorage.setItem(PRIMER_SEEN_KEY, '1'); } catch {}
    onDone();
  }

  return (
    <Modal visible transparent animationType="fade" statusBarTranslucent onRequestClose={() => {}}>
      <View style={styles.container}>
        <Animated.View
          style={[
            styles.sealCircle,
            { backgroundColor: `${accentColor}22` },
            {
              opacity: sealAnim,
              transform: [{ scale: sealAnim.interpolate({ inputRange: [0, 1], outputRange: [0.3, 1] }) }],
            },
          ]}
        >
          <Ionicons name="lock-closed" size={44} color={accentColor} />
        </Animated.View>

        <Text style={styles.title}>Sealed.</Text>
        <Text style={styles.subtitle}>{subtitle}</Text>

        {phase === 'primer' && (
          <View style={styles.primer}>
            <Text style={styles.primerTitle}>Know the second it unlocks?</Text>
            <Text style={styles.primerBody}>We'll send one notification the moment it opens — nothing else.</Text>
            <TouchableOpacity
              style={[styles.primaryBtn, { backgroundColor: accentColor }]}
              onPress={primerYes}
              activeOpacity={0.85}
            >
              <Text style={styles.primaryBtnText}>Notify me</Text>
            </TouchableOpacity>
            <TouchableOpacity onPress={primerLater} activeOpacity={0.7}>
              <Text style={styles.quietLink}>Not now</Text>
            </TouchableOpacity>
          </View>
        )}
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#0A0A0A',
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 40,
  },
  sealCircle: {
    width: 108, height: 108, borderRadius: 54,
    alignItems: 'center', justifyContent: 'center',
    marginBottom: 24,
  },
  title: { fontSize: 32, fontWeight: '800', color: '#FFFFFF' },
  subtitle: { fontSize: 17, fontWeight: '600', color: '#888888', marginTop: 8, textAlign: 'center' },
  primer: { alignItems: 'center', marginTop: 40, gap: 10, alignSelf: 'stretch' },
  primerTitle: { fontSize: 20, fontWeight: '700', color: '#FFFFFF', textAlign: 'center' },
  primerBody: { fontSize: 14, color: '#888888', textAlign: 'center', lineHeight: 20, marginBottom: 10 },
  primaryBtn: { borderRadius: 16, paddingVertical: 16, alignItems: 'center', alignSelf: 'stretch' },
  primaryBtnText: { color: '#FFFFFF', fontSize: 16, fontWeight: '700' },
  quietLink: { color: '#666666', fontSize: 15, fontWeight: '600', paddingVertical: 10 },
});
