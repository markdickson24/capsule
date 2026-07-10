import React, { useEffect, useRef, useState } from 'react';
import LoadingBrand from './LoadingBrand';
import {
  View, Text, StyleSheet, TextInput, Modal, Pressable, TouchableOpacity,
  KeyboardAvoidingView, Platform, Animated, Dimensions, Keyboard, Easing,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { supabase } from '../lib/supabase';
import { sessionStore } from '../lib/sessionStore';
import { useTheme } from '../context/ThemeContext';
import { SuperlativeTargetType } from '../types/database';

type Props = {
  visible: boolean;
  capsuleId: string;
  onClose: () => void;
  onSuggested: () => void;
};

const MIN_LEN = 3;
const MAX_LEN = 80;
const SCREEN_HEIGHT = Dimensions.get('window').height;
const BACKDROP_MAX = 0.65;

// Apple's standard sheet curves — feels native.
const PRESENT_EASING = Easing.bezier(0.32, 0.72, 0, 1);
const DISMISS_EASING = Easing.bezier(0.4, 0, 1, 1);
const PRESENT_MS = 360;
const DISMISS_MS = 260;

export default function SuggestCategoryModal({ visible, capsuleId, onClose, onSuggested }: Props) {
  const { accentColor } = useTheme();
  const [label, setLabel] = useState('');
  const [targetType, setTargetType] = useState<SuperlativeTargetType>('person');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState('');
  const [mounted, setMounted] = useState(visible);

  // Single source of truth for the slide animation. Backdrop opacity is
  // interpolated off the same value so the dimming tracks the sheet exactly.
  const translateY = useRef(new Animated.Value(SCREEN_HEIGHT)).current;
  const backdropOpacity = translateY.interpolate({
    inputRange: [0, SCREEN_HEIGHT],
    outputRange: [BACKDROP_MAX, 0],
    extrapolate: 'clamp',
  });

  const trimmed = label.trim();
  const valid = trimmed.length >= MIN_LEN && trimmed.length <= MAX_LEN;

  function reset() {
    setLabel('');
    setTargetType('person');
    setError('');
    setSubmitting(false);
  }

  useEffect(() => {
    if (visible) {
      setMounted(true);
      translateY.setValue(SCREEN_HEIGHT);
      Animated.timing(translateY, {
        toValue: 0,
        duration: PRESENT_MS,
        easing: PRESENT_EASING,
        useNativeDriver: true,
      }).start();
    } else if (mounted) {
      Animated.timing(translateY, {
        toValue: SCREEN_HEIGHT,
        duration: DISMISS_MS,
        easing: DISMISS_EASING,
        useNativeDriver: true,
      }).start(() => setMounted(false));
    }
  }, [visible]);

  function requestClose() {
    if (submitting) return;
    Keyboard.dismiss();
    reset();
    onClose();
  }

  async function submit() {
    if (!valid) {
      setError(`Category must be ${MIN_LEN}–${MAX_LEN} characters.`);
      return;
    }
    const session = sessionStore.get();
    if (!session) { setError('Not signed in.'); return; }

    setSubmitting(true);
    setError('');

    const { error: insertError } = await supabase
      .from('superlative_categories')
      .insert({
        capsule_id: capsuleId,
        suggested_by: session.user.id,
        label: trimmed,
        target_type: targetType,
      });

    if (insertError) {
      setSubmitting(false);
      setError('Could not add the category. Please try again.');
      return;
    }

    reset();
    onSuggested();
    Keyboard.dismiss();
    onClose();
  }

  if (!mounted) return null;

  return (
    <Modal visible={mounted} transparent animationType="none" onRequestClose={requestClose} statusBarTranslucent>
      <KeyboardAvoidingView
        style={styles.kav}
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      >
        <Animated.View style={[StyleSheet.absoluteFill, styles.backdrop, { opacity: backdropOpacity }]}>
          <Pressable style={StyleSheet.absoluteFill} onPress={requestClose} />
        </Animated.View>

        <View style={styles.container} pointerEvents="box-none">
          <Animated.View style={[styles.sheet, { transform: [{ translateY }] }]}>
            <View style={styles.headerRow}>
              <View style={{ flex: 1 }}>
                <Text style={styles.title}>Suggest a category</Text>
              </View>
              <TouchableOpacity
                style={styles.closeBtn}
                onPress={requestClose}
                disabled={submitting}
                hitSlop={{ top: 12, bottom: 12, left: 12, right: 12 }}
                accessibilityRole="button"
                accessibilityLabel="Close"
              >
                <Ionicons name="close" size={20} color="#FFFFFF" />
              </TouchableOpacity>
            </View>
            <Text style={styles.subtitle}>
              Members upvote suggestions; once enough people upvote, voting opens.
            </Text>

            <Text style={styles.label}>Category</Text>
            <TextInput
              style={styles.input}
              value={label}
              onChangeText={setLabel}
              placeholder="e.g. Best dance moves"
              placeholderTextColor="#555"
              maxLength={MAX_LEN}
              autoFocus
            />
            <Text style={styles.charCount}>{trimmed.length}/{MAX_LEN}</Text>

            <Text style={styles.label}>Award goes to a…</Text>
            <View style={styles.toggle}>
              <TouchableOpacity
                style={[styles.toggleBtn, targetType === 'person' && [styles.toggleActive, { borderColor: accentColor, backgroundColor: `${accentColor}22` }]]}
                onPress={() => setTargetType('person')}
              >
                <Ionicons name="person-outline" size={16} color={targetType === 'person' ? accentColor : '#888'} />
                <Text style={[styles.toggleText, targetType === 'person' && { color: accentColor }]}>Person</Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={[styles.toggleBtn, targetType === 'media' && [styles.toggleActive, { borderColor: accentColor, backgroundColor: `${accentColor}22` }]]}
                onPress={() => setTargetType('media')}
              >
                <Ionicons name="images-outline" size={16} color={targetType === 'media' ? accentColor : '#888'} />
                <Text style={[styles.toggleText, targetType === 'media' && { color: accentColor }]}>Photo/Video</Text>
              </TouchableOpacity>
            </View>

            {error ? <Text style={styles.error}>{error}</Text> : null}

            <TouchableOpacity
              style={[styles.submitBtn, { backgroundColor: accentColor }, (!valid || submitting) && styles.submitBtnDisabled]}
              onPress={submit}
              disabled={!valid || submitting}
            >
              {submitting ? (
                <LoadingBrand size="small" color="#FFFFFF" />
              ) : (
                <Text style={styles.submitBtnText}>Add suggestion</Text>
              )}
            </TouchableOpacity>
          </Animated.View>
        </View>
      </KeyboardAvoidingView>
    </Modal>
  );
}

const styles = StyleSheet.create({
  kav: { flex: 1 },
  backdrop: { backgroundColor: '#000' },
  container: { flex: 1, justifyContent: 'flex-end' },
  sheet: {
    backgroundColor: '#1A1A1A',
    borderTopLeftRadius: 22, borderTopRightRadius: 22,
    paddingHorizontal: 24, paddingTop: 18, paddingBottom: 40, gap: 12,
  },
  headerRow: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  title: { fontSize: 20, fontWeight: '800', color: '#FFFFFF' },
  closeBtn: {
    width: 32, height: 32, borderRadius: 16,
    backgroundColor: '#2A2A2A',
    alignItems: 'center', justifyContent: 'center',
  },
  subtitle: { fontSize: 14, color: '#888888', lineHeight: 19 },
  label: { fontSize: 13, fontWeight: '600', color: '#AAAAAA', textTransform: 'uppercase', letterSpacing: 0.5, marginTop: 8 },
  input: {
    backgroundColor: '#0A0A0A',
    borderRadius: 12, paddingHorizontal: 16, paddingVertical: 14,
    color: '#FFFFFF', fontSize: 16,
    borderWidth: 1, borderColor: '#2A2A2A',
  },
  charCount: { fontSize: 11, color: '#888888', textAlign: 'right' },
  toggle: { flexDirection: 'row', gap: 8 },
  toggleBtn: {
    flex: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6,
    paddingVertical: 14, borderRadius: 12,
    borderWidth: 1, borderColor: '#2A2A2A', backgroundColor: '#0A0A0A',
  },
  toggleActive: { borderColor: '#FF6B35', backgroundColor: '#2A1500' },
  toggleText: { color: '#888', fontWeight: '600', fontSize: 14 },
  error: { color: '#FF3B30', fontSize: 13, textAlign: 'center' },
  submitBtn: {
    backgroundColor: '#FF6B35',
    borderRadius: 14,
    paddingVertical: 16, alignItems: 'center',
    marginTop: 6,
  },
  submitBtnDisabled: { opacity: 0.5 },
  submitBtnText: { color: '#FFFFFF', fontWeight: '700', fontSize: 16 },
});
