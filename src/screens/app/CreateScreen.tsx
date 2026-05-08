import React, { useRef, useState } from 'react';
import {
  View, Text, StyleSheet, SafeAreaView, TextInput,
  TouchableOpacity, ScrollView, ActivityIndicator,
} from 'react-native';
import { supabase } from '../../lib/supabase';

type Permission = 'contributor' | 'viewer';

interface DateFields {
  month: string;
  day: string;
  year: string;
  hour: string;
  minute: string;
}

function buildDate(fields: DateFields): Date | null {
  const { month, day, year, hour, minute } = fields;
  if (!month || !day || !year) return null;
  const m = parseInt(month), d = parseInt(day), y = parseInt(year);
  const h = parseInt(hour || '0'), min = parseInt(minute || '0');
  if (isNaN(m) || isNaN(d) || isNaN(y)) return null;
  if (m < 1 || m > 12 || d < 1 || d > 31 || y < 2024) return null;
  const date = new Date(y, m - 1, d, h, min);
  return isNaN(date.getTime()) ? null : date;
}

function formatDate(date: Date) {
  return date.toLocaleDateString('en-US', {
    month: 'short', day: 'numeric', year: 'numeric',
    hour: '2-digit', minute: '2-digit',
  });
}

function DatePicker({ label, optional, fields, onChange }: {
  label: string;
  optional?: boolean;
  fields: DateFields;
  onChange: (fields: DateFields) => void;
}) {
  const dayRef = useRef<TextInput>(null);
  const yearRef = useRef<TextInput>(null);
  const hourRef = useRef<TextInput>(null);
  const minuteRef = useRef<TextInput>(null);

  const date = buildDate(fields);

  return (
    <View style={styles.section}>
      <Text style={styles.label}>
        {label}{optional && <Text style={styles.optional}> (optional)</Text>}
      </Text>
      <View style={styles.dateRow}>
        <View style={styles.dateFieldWrap}>
          <TextInput
            style={styles.dateInput}
            placeholder="MM"
            placeholderTextColor="#555"
            value={fields.month}
            onChangeText={(v) => {
              const cleaned = v.replace(/[^0-9]/g, '').slice(0, 2);
              onChange({ ...fields, month: cleaned });
              if (cleaned.length === 2) dayRef.current?.focus();
            }}
            keyboardType="number-pad"
            maxLength={2}
          />
          <Text style={styles.dateLabel}>Month</Text>
        </View>

        <Text style={styles.dateSep}>/</Text>

        <View style={styles.dateFieldWrap}>
          <TextInput
            ref={dayRef}
            style={styles.dateInput}
            placeholder="DD"
            placeholderTextColor="#555"
            value={fields.day}
            onChangeText={(v) => {
              const cleaned = v.replace(/[^0-9]/g, '').slice(0, 2);
              onChange({ ...fields, day: cleaned });
              if (cleaned.length === 2) yearRef.current?.focus();
            }}
            keyboardType="number-pad"
            maxLength={2}
          />
          <Text style={styles.dateLabel}>Day</Text>
        </View>

        <Text style={styles.dateSep}>/</Text>

        <View style={[styles.dateFieldWrap, styles.dateFieldWide]}>
          <TextInput
            ref={yearRef}
            style={styles.dateInput}
            placeholder="YYYY"
            placeholderTextColor="#555"
            value={fields.year}
            onChangeText={(v) => {
              const cleaned = v.replace(/[^0-9]/g, '').slice(0, 4);
              onChange({ ...fields, year: cleaned });
              if (cleaned.length === 4) hourRef.current?.focus();
            }}
            keyboardType="number-pad"
            maxLength={4}
          />
          <Text style={styles.dateLabel}>Year</Text>
        </View>

        <View style={styles.dateFieldWrap}>
          <TextInput
            ref={hourRef}
            style={styles.dateInput}
            placeholder="HH"
            placeholderTextColor="#555"
            value={fields.hour}
            onChangeText={(v) => {
              const cleaned = v.replace(/[^0-9]/g, '').slice(0, 2);
              onChange({ ...fields, hour: cleaned });
              if (cleaned.length === 2) minuteRef.current?.focus();
            }}
            keyboardType="number-pad"
            maxLength={2}
          />
          <Text style={styles.dateLabel}>Hour</Text>
        </View>

        <Text style={styles.dateSep}>:</Text>

        <View style={styles.dateFieldWrap}>
          <TextInput
            ref={minuteRef}
            style={styles.dateInput}
            placeholder="MM"
            placeholderTextColor="#555"
            value={fields.minute}
            onChangeText={(v) => {
              const cleaned = v.replace(/[^0-9]/g, '').slice(0, 2);
              onChange({ ...fields, minute: cleaned });
            }}
            keyboardType="number-pad"
            maxLength={2}
          />
          <Text style={styles.dateLabel}>Min</Text>
        </View>
      </View>

      {date && <Text style={styles.datePreview}>📅 {formatDate(date)}</Text>}
    </View>
  );
}

const emptyDate: DateFields = { month: '', day: '', year: '', hour: '', minute: '' };

export default function CreateScreen() {
  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [unlockFields, setUnlockFields] = useState<DateFields>(emptyDate);
  const [contribFields, setContribFields] = useState<DateFields>(emptyDate);
  const [defaultRole, setDefaultRole] = useState<Permission>('contributor');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');

  const unlockDate = buildDate(unlockFields);
  const contributionLockDate = buildDate(contribFields);

  async function handleCreate() {
    setError('');

    if (!title.trim()) { setError('Give your capsule a name.'); return; }
    if (!unlockDate) { setError('Set a valid unlock date.'); return; }
    if (unlockDate <= new Date()) { setError('Unlock date must be in the future.'); return; }
    if (contributionLockDate && contributionLockDate >= unlockDate) {
      setError('Contribution lock must be before the unlock date.');
      return;
    }

    setLoading(true);

    const { data: { session } } = await supabase.auth.getSession();
    const user = session?.user;
    if (!user || !session) { setLoading(false); setError('Not logged in — try signing out and back in.'); return; }

    const capsuleId = crypto.randomUUID();

    const { error: capsuleError } = await supabase
      .from('capsules')
      .insert({
        id: capsuleId,
        owner_id: user.id,
        title: title.trim(),
        description: description.trim() || null,
        unlock_at: unlockDate.toISOString(),
        contribution_lock_at: contributionLockDate?.toISOString() ?? null,
        status: 'active',
        visibility: 'invite',
      });

    if (capsuleError) {
      setLoading(false);
      setError(capsuleError.message);
      return;
    }

    await supabase.from('capsule_members').insert({
      capsule_id: capsuleId,
      user_id: user.id,
      role: 'owner',
      joined_at: new Date().toISOString(),
    });

    setLoading(false);
    setTitle('');
    setDescription('');
    setUnlockFields(emptyDate);
    setContribFields(emptyDate);
    setSuccess(`Capsule locked! ⏳ "${capsule.title}" unlocks on ${formatDate(unlockDate)}.`);
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

        <DatePicker label="Unlock Date" fields={unlockFields} onChange={setUnlockFields} />
        <DatePicker label="Stop Contributions On" optional fields={contribFields} onChange={setContribFields} />

        <View style={styles.section}>
          <Text style={styles.label}>Invited people can</Text>
          <View style={styles.toggle}>
            <TouchableOpacity
              style={[styles.toggleOption, defaultRole === 'contributor' && styles.toggleActive]}
              onPress={() => setDefaultRole('contributor')}
            >
              <Text style={[styles.toggleText, defaultRole === 'contributor' && styles.toggleTextActive]}>Add photos</Text>
            </TouchableOpacity>
            <TouchableOpacity
              style={[styles.toggleOption, defaultRole === 'viewer' && styles.toggleActive]}
              onPress={() => setDefaultRole('viewer')}
            >
              <Text style={[styles.toggleText, defaultRole === 'viewer' && styles.toggleTextActive]}>View only</Text>
            </TouchableOpacity>
          </View>
        </View>

        {error ? <Text style={styles.error}>{error}</Text> : null}
        {success ? <Text style={styles.success}>{success}</Text> : null}

        <TouchableOpacity style={styles.createButton} onPress={handleCreate} disabled={loading}>
          {loading ? <ActivityIndicator color="#fff" /> : <Text style={styles.createButtonText}>Lock Capsule ⏳</Text>}
        </TouchableOpacity>
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#0A0A0A' },
  scroll: { paddingHorizontal: 24, paddingTop: 16, paddingBottom: 48, gap: 24 },
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
  dateRow: { flexDirection: 'row', alignItems: 'flex-start', gap: 4 },
  dateFieldWrap: { alignItems: 'center', gap: 4 },
  dateFieldWide: { width: 64 },
  dateInput: {
    backgroundColor: '#1A1A1A',
    borderRadius: 10,
    paddingVertical: 14,
    color: '#FFFFFF',
    fontSize: 16,
    borderWidth: 1,
    borderColor: '#2A2A2A',
    width: 48,
    textAlign: 'center',
  },
  dateLabel: { fontSize: 10, color: '#555555', textTransform: 'uppercase', letterSpacing: 0.3 },
  dateSep: { color: '#555555', fontSize: 20, paddingTop: 12 },
  datePreview: { fontSize: 13, color: '#FF6B35', paddingLeft: 4 },
  toggle: { flexDirection: 'row', gap: 8 },
  toggleOption: {
    flex: 1, paddingVertical: 14, borderRadius: 12,
    borderWidth: 1, borderColor: '#2A2A2A', alignItems: 'center', backgroundColor: '#1A1A1A',
  },
  toggleActive: { borderColor: '#FF6B35', backgroundColor: '#2A1500' },
  toggleText: { color: '#666666', fontWeight: '600', fontSize: 15 },
  toggleTextActive: { color: '#FF6B35' },
  error: { color: '#FF3B30', fontSize: 14, textAlign: 'center' },
  success: { color: '#30D158', fontSize: 14, textAlign: 'center' },
  createButton: {
    backgroundColor: '#FF6B35', borderRadius: 16,
    paddingVertical: 18, alignItems: 'center', marginTop: 8,
  },
  createButtonText: { color: '#FFFFFF', fontSize: 17, fontWeight: '700' },
});
