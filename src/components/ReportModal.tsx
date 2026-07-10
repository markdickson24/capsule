import React, { useState } from 'react';
import {
  View, Text, StyleSheet, Modal, TouchableOpacity, TextInput, ScrollView,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import LoadingBrand from './LoadingBrand';
import { supabase } from '../lib/supabase';
import { sessionStore } from '../lib/sessionStore';
import { useTheme } from '../context/ThemeContext';

export type ReportTargetType = 'media' | 'user';

const REASONS: { value: string; label: string }[] = [
  { value: 'spam', label: 'Spam or scam' },
  { value: 'harassment', label: 'Harassment or bullying' },
  { value: 'nudity', label: 'Nudity or sexual content' },
  { value: 'violence', label: 'Violence or threats' },
  { value: 'hate', label: 'Hate speech or symbols' },
  { value: 'self_harm', label: 'Self-harm' },
  { value: 'other', label: 'Something else' },
];

interface ReportModalProps {
  visible: boolean;
  targetType: ReportTargetType;
  /** media id when targetType is 'media', user id when 'user'. */
  targetId: string;
  /** Optional capsule context recorded with the report. */
  capsuleId?: string;
  onClose: () => void;
}

/**
 * Cross-platform "Report" sheet for objectionable content or users (Apple 1.2).
 * Inserts a row into `content_reports` for out-of-band review. Reusable for both
 * media reports (from the viewer) and user reports (from a profile).
 */
export default function ReportModal({
  visible, targetType, targetId, capsuleId, onClose,
}: ReportModalProps) {
  const { accentColor } = useTheme();
  const [reason, setReason] = useState<string | null>(null);
  const [details, setDetails] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [done, setDone] = useState(false);
  const [error, setError] = useState('');

  function reset() {
    setReason(null); setDetails(''); setSubmitting(false); setDone(false); setError('');
  }

  function handleClose() {
    if (submitting) return;
    reset();
    onClose();
  }

  async function submit() {
    if (!reason || submitting) return;
    const uid = sessionStore.get()?.user?.id;
    if (!uid) { setError('You need to be signed in to report.'); return; }
    setSubmitting(true);
    setError('');
    const { error: err } = await supabase.from('content_reports').insert({
      reporter_id: uid,
      target_type: targetType,
      reported_media_id: targetType === 'media' ? targetId : null,
      reported_user_id: targetType === 'user' ? targetId : null,
      capsule_id: capsuleId ?? null,
      reason,
      details: details.trim() ? details.trim() : null,
    });
    if (err) {
      setSubmitting(false);
      setError('Could not submit your report. Please try again.');
      return;
    }
    setSubmitting(false);
    setDone(true);
    setTimeout(handleClose, 1400);
  }

  const title = targetType === 'media' ? 'Report this content' : 'Report this user';

  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={handleClose}>
      <View style={styles.backdrop}>
        <View style={styles.card}>
          {done ? (
            <View style={styles.doneWrap}>
              <Ionicons name="checkmark-circle" size={40} color="#30D158" />
              <Text style={styles.doneTitle}>Report submitted</Text>
              <Text style={styles.doneMsg}>Thanks — our team will review this.</Text>
            </View>
          ) : (
            <>
              <View style={styles.header}>
                <Text style={styles.title}>{title}</Text>
                <TouchableOpacity onPress={handleClose} disabled={submitting} hitSlop={8} accessibilityRole="button" accessibilityLabel="Close">
                  <Ionicons name="close" size={22} color="#888888" />
                </TouchableOpacity>
              </View>
              <Text style={styles.subtitle}>Why are you reporting this?</Text>

              <ScrollView style={styles.reasons} keyboardShouldPersistTaps="handled">
                {REASONS.map(r => {
                  const active = reason === r.value;
                  return (
                    <TouchableOpacity
                      key={r.value}
                      style={[styles.reasonRow, active && { borderColor: accentColor }]}
                      onPress={() => setReason(r.value)}
                      activeOpacity={0.8}
                    >
                      <Text style={styles.reasonText}>{r.label}</Text>
                      <Ionicons
                        name={active ? 'radio-button-on' : 'radio-button-off'}
                        size={20}
                        color={active ? accentColor : '#555555'}
                      />
                    </TouchableOpacity>
                  );
                })}
              </ScrollView>

              <TextInput
                style={styles.details}
                placeholder="Add details (optional)"
                placeholderTextColor="#555"
                value={details}
                onChangeText={setDetails}
                multiline
                maxLength={500}
              />

              {error ? <Text style={styles.error}>{error}</Text> : null}

              <TouchableOpacity
                style={[
                  styles.submit,
                  { backgroundColor: reason ? accentColor : '#2A2A2A' },
                ]}
                onPress={submit}
                disabled={!reason || submitting}
                activeOpacity={0.85}
              >
                {submitting ? (
                  <LoadingBrand size="small" color="#FFFFFF" />
                ) : (
                  <Text style={styles.submitText}>Submit report</Text>
                )}
              </TouchableOpacity>
            </>
          )}
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  backdrop: {
    flex: 1, backgroundColor: 'rgba(0,0,0,0.7)',
    justifyContent: 'center', alignItems: 'center', padding: 24,
  },
  card: {
    width: '100%', maxWidth: 380, backgroundColor: '#1A1A1A',
    borderRadius: 16, borderWidth: 1, borderColor: '#2A2A2A', padding: 20,
  },
  header: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  title: { fontSize: 18, fontWeight: '700', color: '#FFFFFF' },
  subtitle: { fontSize: 14, color: '#888888', marginTop: 8, marginBottom: 12 },
  reasons: { maxHeight: 260 },
  reasonRow: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    paddingVertical: 13, paddingHorizontal: 14, borderRadius: 12,
    borderWidth: 1, borderColor: '#2A2A2A', marginBottom: 8,
  },
  reasonText: { fontSize: 15, color: '#FFFFFF', fontWeight: '500' },
  details: {
    backgroundColor: '#0F0F0F', borderRadius: 12, borderWidth: 1, borderColor: '#2A2A2A',
    color: '#FFFFFF', fontSize: 15, padding: 12, minHeight: 64, marginTop: 4,
    textAlignVertical: 'top',
  },
  error: { color: '#FF3B30', fontSize: 13, marginTop: 10 },
  submit: { borderRadius: 12, paddingVertical: 14, alignItems: 'center', marginTop: 14 },
  submitText: { color: '#FFFFFF', fontSize: 16, fontWeight: '700' },
  doneWrap: { alignItems: 'center', paddingVertical: 16, gap: 8 },
  doneTitle: { fontSize: 18, fontWeight: '700', color: '#FFFFFF', marginTop: 4 },
  doneMsg: { fontSize: 14, color: '#888888', textAlign: 'center' },
});
