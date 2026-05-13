import React, { useState } from 'react';
import {
  View, Text, StyleSheet, SafeAreaView, TextInput,
  TouchableOpacity, ScrollView, ActivityIndicator, Platform, Switch,
} from 'react-native';
import { useNavigation } from '@react-navigation/native';
import { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { supabase } from '../../lib/supabase';
import { randomUUID } from '../../lib/uuid';
import { Ionicons } from '@expo/vector-icons';
import { AppStackParamList } from '../../types/navigation';
import DateTimePicker from '@react-native-community/datetimepicker';
import { useTheme } from '../../context/ThemeContext';

type Permission = 'contributor' | 'viewer';

function formatDate(date: Date) {
  return date.toLocaleDateString('en-US', {
    month: 'long', day: 'numeric', year: 'numeric',
    hour: 'numeric', minute: '2-digit',
  });
}

function defaultUnlockDate() {
  const d = new Date();
  d.setMonth(d.getMonth() + 1);
  return d;
}

function DatePickerField({ label, optional, value, onChange }: {
  label: string;
  optional?: boolean;
  value: Date | null;
  onChange: (date: Date | null) => void;
}) {
  const { accentColor } = useTheme();
  const fallback = defaultUnlockDate();
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
            minimumDate={new Date()}
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

export default function CreateScreen() {
  const { accentColor } = useTheme();
  const navigation = useNavigation<NativeStackNavigationProp<AppStackParamList>>();
  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [unlockDate, setUnlockDate] = useState<Date | null>(defaultUnlockDate());
  const [contribLockDate, setContribLockDate] = useState<Date | null>(null);
  const [defaultRole, setDefaultRole] = useState<Permission>('contributor');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  async function handleCreate() {
    setError('');

    if (!title.trim()) { setError('Give your capsule a name.'); return; }
    if (!unlockDate) { setError('Set a valid unlock date.'); return; }
    if (unlockDate <= new Date()) { setError('Unlock date must be in the future.'); return; }
    if (contribLockDate && contribLockDate >= unlockDate) {
      setError('Contribution lock must be before the unlock date.');
      return;
    }

    setLoading(true);

    const { data: { session } } = await supabase.auth.getSession();
    const user = session?.user;
    if (!user || !session) { setLoading(false); setError('Not logged in — try signing out and back in.'); return; }

    const capsuleId = randomUUID();

    const { error: capsuleError } = await supabase
      .from('capsules')
      .insert({
        id: capsuleId,
        owner_id: user.id,
        title: title.trim(),
        description: description.trim() || null,
        unlock_at: unlockDate.toISOString(),
        contribution_lock_at: contribLockDate?.toISOString() ?? null,
        status: 'active',
        visibility: 'invite',
      });

    if (capsuleError) {
      setLoading(false);
      setError(capsuleError.message);
      return;
    }

    const { error: memberError } = await supabase.from('capsule_members').insert({
      capsule_id: capsuleId,
      user_id: user.id,
      role: 'owner',
      joined_at: new Date().toISOString(),
    });

    if (memberError) {
      setLoading(false);
      setError('Capsule created but failed to set owner: ' + memberError.message);
      return;
    }

    setLoading(false);
    navigation.navigate('CapsuleDetail', { capsuleId });
  }

  return (
    <SafeAreaView style={styles.container}>
      <ScrollView contentContainerStyle={styles.scroll} keyboardShouldPersistTaps="handled">
        <Text style={styles.title}>New Capsule</Text>
        <Text style={styles.subtitle}>Lock your memories until the moment is right</Text>

        <View style={styles.section}>
          <Text style={styles.label}>Name</Text>
          <TextInput
            style={styles.input}
            placeholder="e.g. Summer Trip 2026"
            placeholderTextColor="#555"
            value={title}
            onChangeText={setTitle}
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
          />
        </View>

        <DatePickerField label="Unlock Date" value={unlockDate} onChange={setUnlockDate} />
        <DatePickerField label="Stop Contributions On" optional value={contribLockDate} onChange={setContribLockDate} />

        <View style={styles.section}>
          <Text style={styles.label}>Invited people can</Text>
          <View style={styles.toggle}>
            <TouchableOpacity
              style={[styles.toggleOption, defaultRole === 'contributor' && [styles.toggleActive, { borderColor: accentColor }]]}
              onPress={() => setDefaultRole('contributor')}
            >
              <Text style={[styles.toggleText, defaultRole === 'contributor' && [styles.toggleTextActive, { color: accentColor }]]}>Add photos</Text>
            </TouchableOpacity>
            <TouchableOpacity
              style={[styles.toggleOption, defaultRole === 'viewer' && [styles.toggleActive, { borderColor: accentColor }]]}
              onPress={() => setDefaultRole('viewer')}
            >
              <Text style={[styles.toggleText, defaultRole === 'viewer' && [styles.toggleTextActive, { color: accentColor }]]}>View only</Text>
            </TouchableOpacity>
          </View>
        </View>

        {error ? <Text style={styles.error}>{error}</Text> : null}

        <TouchableOpacity style={[styles.createButton, { backgroundColor: accentColor }]} onPress={handleCreate} disabled={loading}>
          {loading ? <ActivityIndicator color="#fff" /> : (
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
              <Text style={styles.createButtonText}>Lock Capsule</Text>
              <Ionicons name="lock-closed-outline" size={18} color="#FFFFFF" />
            </View>
          )}
        </TouchableOpacity>
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#0A0A0A' },
  scroll: { paddingHorizontal: 24, paddingTop: 16, paddingBottom: 120, gap: 24 },
  title: { fontSize: 28, fontWeight: '800', color: '#FFFFFF' },
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
  toggle: { flexDirection: 'row', gap: 8 },
  toggleOption: {
    flex: 1, paddingVertical: 14, borderRadius: 12,
    borderWidth: 1, borderColor: '#2A2A2A', alignItems: 'center', backgroundColor: '#1A1A1A',
  },
  toggleActive: { borderColor: '#FF6B35', backgroundColor: '#2A1500' },
  toggleText: { color: '#666666', fontWeight: '600', fontSize: 15 },
  toggleTextActive: { color: '#FF6B35' },
  error: { color: '#FF3B30', fontSize: 14, textAlign: 'center' },
  createButton: {
    backgroundColor: '#FF6B35', borderRadius: 16,
    paddingVertical: 18, alignItems: 'center', marginTop: 8,
  },
  createButtonText: { color: '#FFFFFF', fontSize: 17, fontWeight: '700' },
});
