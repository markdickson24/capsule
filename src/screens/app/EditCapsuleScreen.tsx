import React, { useCallback, useEffect, useState } from 'react';
import LoadingBrand from '../../components/LoadingBrand';
import {
  View, Text, StyleSheet, TextInput,
  TouchableOpacity, ScrollView,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { NativeStackScreenProps } from '@react-navigation/native-stack';
import { supabase } from '../../lib/supabase';
import { sessionStore } from '../../lib/sessionStore';
import { Ionicons } from '@expo/vector-icons';
import { AppStackParamList } from '../../types/navigation';
import { UnlockMode } from '../../types/database';
import { useTheme } from '../../context/ThemeContext';
import DatePickerField from '../../components/DatePicker';
import VotingWindowPicker from '../../components/VotingWindowPicker';
import { cache } from '../../lib/cache';
import ConfirmModal from '../../components/ConfirmModal';
import SkeletonBox, { SkeletonFormField } from '../../components/Skeleton';
import RetryPrompt from '../../components/RetryPrompt';
import { useLoadingTimeout } from '../../hooks/useLoadingTimeout';

type Props = NativeStackScreenProps<AppStackParamList, 'EditCapsule'>;

const UNLOCK_MODES: { mode: UnlockMode; label: string }[] = [
  { mode: 'time', label: 'Date' },
  { mode: 'proximity', label: 'Together' },
  { mode: 'both', label: 'Both' },
];

function unlockModeHint(mode: UnlockMode) {
  if (mode === 'time') return 'Opens on the date you set.';
  if (mode === 'proximity') return 'Opens when all members are in the same place.';
  return 'Opens once the date has passed and all members are together.';
}

export default function EditCapsuleScreen({ route, navigation }: Props) {
  const { accentColor } = useTheme();
  const { capsuleId } = route.params;
  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [unlockDate, setUnlockDate] = useState<Date | null>(null);
  const [contribLockDate, setContribLockDate] = useState<Date | null>(null);
  const [unlockMode, setUnlockMode] = useState<UnlockMode>('time');
  const [votingHours, setVotingHours] = useState(48);
  const [fetching, setFetching] = useState(true);
  const [saving, setSaving] = useState(false);
  const [archiving, setArchiving] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);
  const [error, setError] = useState('');

  const loadCapsule = useCallback(async () => {
    const session = sessionStore.get();
    if (!session) { navigation.goBack(); return; }

    const { data, error: err } = await supabase
      .from('capsules')
      .select('id, owner_id, title, description, status, unlock_at, contribution_lock_at, unlock_mode, superlative_voting_hours')
      .eq('id', capsuleId)
      .single();

    if (err || !data) { navigation.goBack(); return; }
    if ((data as any).owner_id !== session.user.id) { navigation.goBack(); return; }
    if ((data as any).status === 'unlocked') { navigation.goBack(); return; }

    setTitle((data as any).title);
    setDescription((data as any).description ?? '');
    setUnlockDate(new Date((data as any).unlock_at));
    setContribLockDate(
      (data as any).contribution_lock_at ? new Date((data as any).contribution_lock_at) : null
    );
    setUnlockMode((data as any).unlock_mode ?? 'time');
    setVotingHours((data as any).superlative_voting_hours ?? 48);
    setFetching(false);
  }, [capsuleId, navigation]);

  useEffect(() => {
    loadCapsule().catch(() => navigation.goBack());
  }, [loadCapsule]);

  const { timedOut, reset: resetTimeout } = useLoadingTimeout(fetching);

  async function handleSave() {
    setError('');
    if (!title.trim()) { setError('Give your capsule a name.'); return; }
    if (title.trim().length > 100) { setError('Name must be 100 characters or less.'); return; }
    if (description.trim().length > 500) { setError('Description must be 500 characters or less.'); return; }
    if (unlockMode !== 'proximity') {
      if (!unlockDate) { setError('Set a valid unlock date.'); return; }
      if (unlockDate <= new Date()) { setError('Unlock date must be in the future.'); return; }
      if (contribLockDate && contribLockDate >= unlockDate) {
        setError('Contribution lock must be before the unlock date.');
        return;
      }
    }
    if (votingHours < 1 || votingHours > 720) {
      setError('Voting window must be between 1 and 720 hours.');
      return;
    }

    setSaving(true);
    const { error: err } = await supabase
      .from('capsules')
      .update({
        title: title.trim(),
        description: description.trim() || null,
        unlock_at: (unlockDate ?? new Date()).toISOString(),
        contribution_lock_at: contribLockDate?.toISOString() ?? null,
        unlock_mode: unlockMode,
        superlative_voting_hours: votingHours,
      })
      .eq('id', capsuleId);
    setSaving(false);

    if (err) { setError('Failed to save changes. Please try again.'); return; }
    cache.invalidate('capsules');
    navigation.goBack();
  }

  async function handleArchive() {
    setArchiving(true);
    await supabase.from('capsules').update({ archived_at: new Date().toISOString() }).eq('id', capsuleId);
    setArchiving(false);
    cache.invalidate('capsules', 'profile');
    navigation.reset({ index: 0, routes: [{ name: 'Tabs' }] });
  }

  async function confirmDelete() {
    setDeleting(true);
    const { data: mediaRows } = await supabase
      .from('media')
      .select('storage_key, thumbnail_key')
      .eq('capsule_id', capsuleId);
    const keys = (mediaRows ?? []).flatMap((m: any) =>
      [m.storage_key, m.thumbnail_key].filter(Boolean)
    );
    if (keys.length) await supabase.storage.from('capsule-media').remove(keys);
    await supabase.from('capsules').delete().eq('id', capsuleId);
    setDeleting(false);
    setShowDeleteConfirm(false);
    cache.invalidate('capsules', 'profile');
    navigation.reset({ index: 0, routes: [{ name: 'Tabs' }] });
  }

  if (fetching) {
    if (timedOut) {
      return (
        <SafeAreaView style={styles.container}>
          <TouchableOpacity style={styles.backBtn} onPress={() => navigation.goBack()}>
            <Text style={[styles.backText, { color: accentColor }]}>← Back</Text>
          </TouchableOpacity>
          <RetryPrompt onRetry={() => { resetTimeout(); loadCapsule().catch(() => navigation.goBack()); }} />
        </SafeAreaView>
      );
    }
    return (
      <SafeAreaView style={styles.container}>
        <View style={styles.backBtn}>
          <SkeletonBox width={60} height={16} borderRadius={6} />
        </View>
        <View style={styles.scroll}>
          <SkeletonBox width={160} height={28} borderRadius={8} />
          <SkeletonBox width={220} height={14} borderRadius={6} style={{ marginTop: 4 }} />
          <SkeletonFormField style={{ marginTop: 24 }} />
          <SkeletonFormField style={{ marginTop: 16 }} />
          <View style={{ gap: 8, marginTop: 16 }}>
            <SkeletonBox width={100} height={12} borderRadius={4} />
            <View style={{ flexDirection: 'row', gap: 8 }}>
              <SkeletonBox height={48} borderRadius={12} style={{ flex: 1 }} />
              <SkeletonBox height={48} borderRadius={12} style={{ flex: 1 }} />
              <SkeletonBox height={48} borderRadius={12} style={{ flex: 1 }} />
            </View>
          </View>
          <SkeletonBox width="100%" height={54} borderRadius={16} style={{ marginTop: 32 }} />
        </View>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={styles.container}>
      <TouchableOpacity style={styles.backBtn} onPress={() => navigation.goBack()}>
        <Text style={[styles.backText, { color: accentColor }]}>← Back</Text>
      </TouchableOpacity>

      <ScrollView contentContainerStyle={styles.scroll} keyboardShouldPersistTaps="handled">
        <Text style={styles.screenTitle}>Edit Capsule</Text>
        <Text style={styles.subtitle}>Only you can see these changes</Text>

        <View style={styles.section}>
          <Text style={styles.label}>Name</Text>
          <TextInput
            style={styles.input}
            placeholder="Capsule name"
            placeholderTextColor="#555"
            value={title}
            onChangeText={setTitle}
            maxLength={100}
          />
        </View>

        <View style={styles.section}>
          <Text style={styles.label}>Description <Text style={styles.optional}>(optional)</Text></Text>
          <TextInput
            style={[styles.input, styles.textarea]}
            placeholder="What's inside this capsule?"
            placeholderTextColor="#555"
            value={description}
            onChangeText={setDescription}
            multiline
            numberOfLines={3}
            maxLength={500}
          />
        </View>

        <View style={styles.section}>
          <Text style={styles.label}>Unlock When</Text>
          <View style={styles.toggle}>
            {UNLOCK_MODES.map(({ mode, label }) => (
              <TouchableOpacity
                key={mode}
                style={[styles.toggleOption, unlockMode === mode && [styles.toggleActive, { borderColor: accentColor, backgroundColor: `${accentColor}22` }]]}
                onPress={() => setUnlockMode(mode)}
              >
                <Text style={[styles.toggleText, unlockMode === mode && [styles.toggleTextActive, { color: accentColor }]]}>{label}</Text>
              </TouchableOpacity>
            ))}
          </View>
          <Text style={styles.modeHint}>{unlockModeHint(unlockMode)}</Text>
        </View>

        {unlockMode !== 'proximity' && (
          <DatePickerField label="Unlock Date" value={unlockDate} onChange={setUnlockDate} contextLabel="Capsule unlocks for everyone" />
        )}
        <DatePickerField label="Uploads Deadline" optional value={contribLockDate} onChange={setContribLockDate} contextLabel="No one can add photos after this date" />

        <VotingWindowPicker value={votingHours} onChange={setVotingHours} />

        {error ? <Text style={styles.error}>{error}</Text> : null}

        <TouchableOpacity style={[styles.saveButton, { backgroundColor: accentColor }]} onPress={handleSave} disabled={saving}>
          {saving ? <LoadingBrand size="small" color="#fff" /> : <Text style={styles.saveButtonText}>Save Changes</Text>}
        </TouchableOpacity>

        <View style={styles.dangerZone}>
          <Text style={styles.dangerLabel}>Danger Zone</Text>
          <TouchableOpacity style={styles.archiveBtn} onPress={handleArchive} disabled={archiving || deleting}>
            {archiving ? <LoadingBrand size="small" color="#888888" /> : (
              <>
                <Ionicons name="archive-outline" size={18} color="#888888" />
                <Text style={styles.archiveBtnText}>Archive Capsule</Text>
              </>
            )}
          </TouchableOpacity>
          <TouchableOpacity style={styles.deleteBtn} onPress={() => setShowDeleteConfirm(true)} disabled={archiving || deleting}>
            {deleting ? <LoadingBrand size="small" color="#FF3B30" /> : (
              <>
                <Ionicons name="trash-outline" size={18} color="#FF3B30" />
                <Text style={styles.deleteBtnText}>Delete Capsule</Text>
              </>
            )}
          </TouchableOpacity>
        </View>
      </ScrollView>

      <ConfirmModal
        visible={showDeleteConfirm}
        title="Delete Capsule"
        message="This permanently deletes the capsule and all its media. This cannot be undone."
        confirmLabel="Delete"
        destructive
        loading={deleting}
        onConfirm={confirmDelete}
        onCancel={() => setShowDeleteConfirm(false)}
      />
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#0A0A0A' },
  backBtn: { paddingHorizontal: 20, paddingTop: 12, paddingBottom: 4 },
  backText: { color: '#FF6B35', fontSize: 16, fontWeight: '600' },
  scroll: { paddingHorizontal: 24, paddingTop: 8, paddingBottom: 120, gap: 24 },
  screenTitle: { fontSize: 28, fontWeight: '800', color: '#FFFFFF' },
  subtitle: { fontSize: 15, color: '#888888', marginTop: -16 },
  section: { gap: 8 },
  label: { fontSize: 14, fontWeight: '600', color: '#AAAAAA', textTransform: 'uppercase', letterSpacing: 0.5 },
  optional: { fontWeight: '400', color: '#555555', textTransform: 'none' },
  input: {
    backgroundColor: '#1A1A1A',
    borderRadius: 12,
    paddingHorizontal: 16,
    paddingVertical: 16,
    color: '#FFFFFF',
    fontSize: 16,
    borderWidth: 1,
    borderColor: '#2A2A2A',
  },
  textarea: { minHeight: 80, textAlignVertical: 'top' },
  toggle: { flexDirection: 'row', gap: 8 },
  toggleOption: {
    flex: 1, paddingVertical: 14, borderRadius: 12,
    borderWidth: 1, borderColor: '#2A2A2A', alignItems: 'center', backgroundColor: '#1A1A1A',
  },
  toggleActive: { borderColor: '#FF6B35', backgroundColor: '#2A1500' },
  toggleText: { color: '#666666', fontWeight: '600', fontSize: 15 },
  toggleTextActive: { color: '#FF6B35' },
  modeHint: { fontSize: 13, color: '#888888' },
  error: { color: '#FF3B30', fontSize: 14, textAlign: 'center' },
  saveButton: {
    backgroundColor: '#FF6B35',
    borderRadius: 16,
    paddingVertical: 18,
    alignItems: 'center',
    marginTop: 8,
  },
  saveButtonText: { color: '#FFFFFF', fontSize: 17, fontWeight: '700' },
  dangerZone: { gap: 10, marginTop: 8, paddingTop: 24, borderTopWidth: 1, borderTopColor: '#1A1A1A' },
  dangerLabel: { fontSize: 12, fontWeight: '600', color: '#444444', textTransform: 'uppercase', letterSpacing: 0.5 },
  archiveBtn: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8,
    borderRadius: 14, paddingVertical: 16,
    backgroundColor: '#1A1A1A', borderWidth: 1, borderColor: '#2A2A2A',
  },
  archiveBtnText: { color: '#888888', fontSize: 16, fontWeight: '600' },
  deleteBtn: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8,
    borderRadius: 14, paddingVertical: 16,
    backgroundColor: '#1A1A1A', borderWidth: 1, borderColor: '#3A1A1A',
  },
  deleteBtnText: { color: '#FF3B30', fontSize: 16, fontWeight: '600' },
});
