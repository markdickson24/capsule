import React, { useState } from 'react';
import {
  View, Text, StyleSheet, TextInput, Modal, Pressable, TouchableOpacity, ActivityIndicator,
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

export default function SuggestCategoryModal({ visible, capsuleId, onClose, onSuggested }: Props) {
  const { accentColor } = useTheme();
  const [label, setLabel] = useState('');
  const [targetType, setTargetType] = useState<SuperlativeTargetType>('person');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState('');

  const trimmed = label.trim();
  const valid = trimmed.length >= MIN_LEN && trimmed.length <= MAX_LEN;

  function reset() {
    setLabel('');
    setTargetType('person');
    setError('');
    setSubmitting(false);
  }

  function handleClose() {
    if (submitting) return;
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
    onClose();
  }

  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={handleClose}>
      <Pressable style={styles.backdrop} onPress={handleClose}>
        <Pressable style={styles.sheet} onPress={() => {}}>
          <View style={styles.handle} />
          <Text style={styles.title}>Suggest a category</Text>
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
              <ActivityIndicator color="#FFFFFF" size="small" />
            ) : (
              <Text style={styles.submitBtnText}>Add suggestion</Text>
            )}
          </TouchableOpacity>
          <TouchableOpacity style={styles.cancelBtn} onPress={handleClose} disabled={submitting}>
            <Text style={styles.cancelText}>Cancel</Text>
          </TouchableOpacity>
        </Pressable>
      </Pressable>
    </Modal>
  );
}

const styles = StyleSheet.create({
  backdrop: { flex: 1, backgroundColor: 'rgba(0,0,0,0.6)', justifyContent: 'flex-end' },
  sheet: {
    backgroundColor: '#1A1A1A',
    borderTopLeftRadius: 20, borderTopRightRadius: 20,
    paddingHorizontal: 24, paddingTop: 12, paddingBottom: 40, gap: 12,
  },
  handle: { width: 36, height: 4, borderRadius: 2, backgroundColor: '#444', alignSelf: 'center', marginBottom: 8 },
  title: { fontSize: 20, fontWeight: '800', color: '#FFFFFF' },
  subtitle: { fontSize: 14, color: '#888888', lineHeight: 19 },
  label: { fontSize: 13, fontWeight: '600', color: '#AAAAAA', textTransform: 'uppercase', letterSpacing: 0.5, marginTop: 8 },
  input: {
    backgroundColor: '#0A0A0A',
    borderRadius: 12, paddingHorizontal: 16, paddingVertical: 14,
    color: '#FFFFFF', fontSize: 16,
    borderWidth: 1, borderColor: '#2A2A2A',
  },
  charCount: { fontSize: 11, color: '#555', textAlign: 'right' },
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
  cancelBtn: { paddingVertical: 12, alignItems: 'center' },
  cancelText: { color: '#888888', fontWeight: '600', fontSize: 15 },
});
