import React, { useEffect, useState } from 'react';
import {
  View, Text, StyleSheet, SafeAreaView, TextInput,
  TouchableOpacity, ScrollView, ActivityIndicator, Platform, Switch,
} from 'react-native';
import { NativeStackScreenProps } from '@react-navigation/native-stack';
import { supabase } from '../../lib/supabase';
import { sessionStore } from '../../lib/sessionStore';
import { Ionicons } from '@expo/vector-icons';
import { AppStackParamList } from '../../types/navigation';
import DateTimePicker from '@react-native-community/datetimepicker';
import { useTheme } from '../../context/ThemeContext';
import ConfirmModal from '../../components/ConfirmModal';

type Props = NativeStackScreenProps<AppStackParamList, 'EditCapsule'>;

function formatDate(date: Date) {
  return date.toLocaleDateString('en-US', {
    month: 'long', day: 'numeric', year: 'numeric',
    hour: 'numeric', minute: '2-digit',
  });
}

function DatePickerField({ label, optional, value, onChange }: {
  label: string;
  optional?: boolean;
  value: Date | null;
  onChange: (date: Date | null) => void;
}) {
  const { accentColor } = useTheme();
  const fallback = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000);
  const isEnabled = !optional || value !== null;
  const selected = value ?? fallback;

  return (
    <View style={styles.section}>
      <View style={styles.dateHeader}>
        <Text style={styles.label}>{label}</Text>
        {optional ? (
          <Switch
            value={isEnabled}
            onValueChange={(on) => onChange(on ? fallback : null)}
            trackColor={{ false: '#2A2A2A', true: accentColor }}
            thumbColor="#FFFFFF"
          />
        ) : (
          <Ionicons name="calendar-outline" size={18} color="#888888" />
        )}
      </View>

      {isEnabled && (
        <>
          <View style={styles.dateDisplayBox}>
            <Text style={styles.dateDisplayText}>{formatDate(selected)}</Text>
          </View>
          <DateTimePicker
            value={selected}
            mode="date"
            display={Platform.OS === 'web' ? 'default' : 'spinner'}
            onChange={(_, date) => {
              if (!date) return;
              const merged = new Date(selected);
              merged.setFullYear(date.getFullYear(), date.getMonth(), date.getDate());
              onChange(merged);
            }}
            themeVariant="dark"
            style={styles.spinner}
          />
          <DateTimePicker
            value={selected}
            mode="time"
            display={Platform.OS === 'web' ? 'default' : 'spinner'}
            onChange={(_, date) => {
              if (!date) return;
              const merged = new Date(selected);
              merged.setHours(date.getHours(), date.getMinutes());
              onChange(merged);
            }}
            themeVariant="dark"
            style={styles.spinner}
          />
        </>
      )}
    </View>
  );
}

export default function EditCapsuleScreen({ route, navigation }: Props) {
  const { accentColor } = useTheme();
  const { capsuleId } = route.params;
  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [unlockDate, setUnlockDate] = useState<Date | null>(null);
  const [contribLockDate, setContribLockDate] = useState<Date | null>(null);
  const [fetching, setFetching] = useState(true);
  const [saving, setSaving] = useState(false);
  const [archiving, setArchiving] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    async function load() {
      const session = sessionStore.get();
      if (!session) { navigation.goBack(); return; }

      const { data, error: err } = await supabase
        .from('capsules')
        .select('*')
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
      setFetching(false);
    }
    load().catch(() => navigation.goBack());
  }, [capsuleId]);

  async function handleSave() {
    setError('');
    if (!title.trim()) { setError('Give your capsule a name.'); return; }
    if (title.trim().length > 100) { setError('Name must be 100 characters or less.'); return; }
    if (description.trim().length > 500) { setError('Description must be 500 characters or less.'); return; }
    if (!unlockDate) { setError('Set a valid unlock date.'); return; }
    if (unlockDate <= new Date()) { setError('Unlock date must be in the future.'); return; }
    if (contribLockDate && contribLockDate >= unlockDate) {
      setError('Contribution lock must be before the unlock date.');
      return;
    }

    setSaving(true);
    const { error: err } = await supabase
      .from('capsules')
      .update({
        title: title.trim(),
        description: description.trim() || null,
        unlock_at: unlockDate.toISOString(),
        contribution_lock_at: contribLockDate?.toISOString() ?? null,
      })
      .eq('id', capsuleId);
    setSaving(false);

    if (err) { setError('Failed to save changes. Please try again.'); return; }
    navigation.goBack();
  }

  async function handleArchive() {
    setArchiving(true);
    await supabase.from('capsules').update({ archived_at: new Date().toISOString() }).eq('id', capsuleId);
    setArchiving(false);
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
    navigation.reset({ index: 0, routes: [{ name: 'Tabs' }] });
  }

  if (fetching) {
    return (
      <SafeAreaView style={styles.container}>
        <ActivityIndicator color={accentColor} style={{ marginTop: 80 }} />
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

        <DatePickerField label="Unlock Date" value={unlockDate} onChange={setUnlockDate} />
        <DatePickerField label="Stop Contributions On" optional value={contribLockDate} onChange={setContribLockDate} />

        {error ? <Text style={styles.error}>{error}</Text> : null}

        <TouchableOpacity style={[styles.saveButton, { backgroundColor: accentColor }]} onPress={handleSave} disabled={saving}>
          {saving ? <ActivityIndicator color="#fff" /> : <Text style={styles.saveButtonText}>Save Changes</Text>}
        </TouchableOpacity>

        <View style={styles.dangerZone}>
          <Text style={styles.dangerLabel}>Danger Zone</Text>
          <TouchableOpacity style={styles.archiveBtn} onPress={handleArchive} disabled={archiving || deleting}>
            {archiving ? <ActivityIndicator color="#888888" size="small" /> : (
              <>
                <Ionicons name="archive-outline" size={18} color="#888888" />
                <Text style={styles.archiveBtnText}>Archive Capsule</Text>
              </>
            )}
          </TouchableOpacity>
          <TouchableOpacity style={styles.deleteBtn} onPress={() => setShowDeleteConfirm(true)} disabled={archiving || deleting}>
            {deleting ? <ActivityIndicator color="#FF3B30" size="small" /> : (
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
  dateHeader: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  dateDisplayBox: {
    backgroundColor: '#1A1A1A',
    borderRadius: 12,
    paddingHorizontal: 16,
    paddingVertical: 14,
    borderWidth: 1,
    borderColor: '#2A2A2A',
  },
  dateDisplayText: { color: '#FFFFFF', fontSize: 18, fontWeight: '600' },
  spinner: { marginTop: -8 },
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
