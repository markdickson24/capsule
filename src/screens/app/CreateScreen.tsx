import React, { useState } from 'react';
import LoadingBrand from '../../components/LoadingBrand';
import {
  View, Text, StyleSheet, TextInput, Animated,
  TouchableOpacity, ScrollView, Platform,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useNavigation, useRoute, RouteProp } from '@react-navigation/native';
import { NativeStackNavigationProp } from '@react-navigation/native-stack';
import * as FileSystem from 'expo-file-system/legacy';
import { supabase } from '../../lib/supabase';
import { sessionStore } from '../../lib/sessionStore';
import { randomUUID } from '../../lib/uuid';
import { Ionicons } from '@expo/vector-icons';
import { AppStackParamList, AppTabParamList, PendingMedia } from '../../types/navigation';
import { UnlockMode } from '../../types/database';
import { useTheme } from '../../context/ThemeContext';
import DatePickerField from '../../components/DatePicker';
import VotingWindowPicker from '../../components/VotingWindowPicker';
import { cache } from '../../lib/cache';
import { useSlideUp, useFadeIn } from '../../lib/animations';

type Permission = 'contributor' | 'viewer';

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

function defaultUnlockDate() {
  const d = new Date();
  d.setMonth(d.getMonth() + 1);
  return d;
}


async function uploadMedia(capsuleId: string, media: PendingMedia): Promise<void> {
  const session = sessionStore.get();
  if (!session) return;

  const mimeType = media.mediaType === 'video' ? 'video/mp4' : 'image/jpeg';
  const ext = media.mediaType === 'video' ? 'mp4' : 'jpg';
  const storageKey = `${capsuleId}/${randomUUID()}.${ext}`;
  let sizeBytes = 0;

  if (Platform.OS === 'web') {
    const response = await fetch(media.uri);
    const arrayBuffer = await response.arrayBuffer();
    sizeBytes = arrayBuffer.byteLength;
    await supabase.storage
      .from('capsule-media')
      .upload(storageKey, arrayBuffer, { contentType: mimeType });
  } else {
    const fileInfo = await FileSystem.getInfoAsync(media.uri, { size: true });
    sizeBytes = fileInfo.exists ? (fileInfo as any).size ?? 0 : 0;
    await FileSystem.uploadAsync(
      `${process.env.EXPO_PUBLIC_SUPABASE_URL}/storage/v1/object/capsule-media/${storageKey}`,
      media.uri,
      {
        httpMethod: 'POST',
        uploadType: FileSystem.FileSystemUploadType.BINARY_CONTENT,
        headers: {
          Authorization: `Bearer ${session.access_token}`,
          apikey: process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY!,
          'Content-Type': mimeType,
        },
      }
    );
  }

  await supabase.from('media').insert({
    capsule_id: capsuleId,
    uploader_id: session.user.id,
    storage_key: storageKey,
    media_type: media.mediaType,
    size_bytes: sizeBytes,
  });
}

export default function CreateScreen() {
  const { accentColor } = useTheme();
  const navigation = useNavigation<NativeStackNavigationProp<AppStackParamList>>();
  const route = useRoute<RouteProp<AppTabParamList, 'Create'>>();
  const pendingMedia = route.params?.pendingMedia ?? null;
  const pendingCount = pendingMedia?.length ?? 0;
  const pendingHasVideo = pendingMedia?.some(m => m.mediaType === 'video') ?? false;
  const pendingHasPhoto = pendingMedia?.some(m => m.mediaType === 'photo') ?? false;
  const [title, setTitle] = useState(route.params?.presetTitle ?? '');
  const [description, setDescription] = useState(route.params?.presetDescription ?? '');
  const [unlockDate, setUnlockDate] = useState<Date | null>(defaultUnlockDate());
  const [contribLockDate, setContribLockDate] = useState<Date | null>(null);
  const [defaultRole, setDefaultRole] = useState<Permission>('contributor');
  const [unlockMode, setUnlockMode] = useState<UnlockMode>('time');
  const [votingHours, setVotingHours] = useState(48);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  async function handleCreate() {
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

    setLoading(true);

    const session = sessionStore.get();
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
        unlock_at: (unlockDate ?? defaultUnlockDate()).toISOString(),
        contribution_lock_at: contribLockDate?.toISOString() ?? null,
        unlock_mode: unlockMode,
        superlative_voting_hours: votingHours,
        status: 'active',
        visibility: 'invite',
      });

    if (capsuleError) {
      setLoading(false);
      setError('Failed to create capsule. Please try again.');
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
      setError('Capsule created but could not set owner. Please try again.');
      return;
    }

    if (pendingMedia && pendingMedia.length > 0) {
      for (const media of pendingMedia) {
        try {
          await uploadMedia(capsuleId, media);
        } catch {
          // Capsule created successfully — keep going so partial success is preserved
        }
      }
    }

    setLoading(false);
    cache.invalidate('capsules', 'profile');
    navigation.navigate('CapsuleDetail', { capsuleId });
  }

  const headerAnim = useFadeIn(0, 300);
  const formAnim = useSlideUp(80, 350);

  return (
    <SafeAreaView style={styles.container} edges={['top', 'left', 'right']}>
      <ScrollView contentContainerStyle={styles.scroll} keyboardShouldPersistTaps="handled">
        <Animated.View style={headerAnim}>
          <Text style={styles.title}>New Capsule</Text>
          <Text style={styles.subtitle}>Lock your memories until the moment is right</Text>
        </Animated.View>

        <Animated.View style={[{ gap: 24 }, formAnim]}>
        {pendingCount > 0 && (
          <View style={[styles.pendingBanner, { borderColor: `${accentColor}40`, backgroundColor: `${accentColor}10` }]}>
            <Ionicons
              name={pendingHasVideo && !pendingHasPhoto ? 'videocam' : 'images'}
              size={18}
              color={accentColor}
            />
            <Text style={[styles.pendingText, { color: accentColor }]}>
              {pendingCount === 1
                ? `Your ${pendingMedia![0].mediaType} will be added automatically`
                : `${pendingCount} items will be added automatically`}
            </Text>
          </View>
        )}

        <View style={styles.section}>
          <Text style={styles.label}>Name</Text>
          <TextInput
            style={styles.input}
            placeholder="e.g. Summer Trip 2026"
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

        <View style={styles.section}>
          <Text style={styles.label}>Invited people can</Text>
          <View style={styles.toggle}>
            <TouchableOpacity
              style={[styles.toggleOption, defaultRole === 'contributor' && [styles.toggleActive, { borderColor: accentColor, backgroundColor: `${accentColor}22` }]]}
              onPress={() => setDefaultRole('contributor')}
            >
              <Text style={[styles.toggleText, defaultRole === 'contributor' && [styles.toggleTextActive, { color: accentColor }]]}>Add photos</Text>
            </TouchableOpacity>
            <TouchableOpacity
              style={[styles.toggleOption, defaultRole === 'viewer' && [styles.toggleActive, { borderColor: accentColor, backgroundColor: `${accentColor}22` }]]}
              onPress={() => setDefaultRole('viewer')}
            >
              <Text style={[styles.toggleText, defaultRole === 'viewer' && [styles.toggleTextActive, { color: accentColor }]]}>View only</Text>
            </TouchableOpacity>
          </View>
        </View>

        {error ? <Text style={styles.error}>{error}</Text> : null}

        <TouchableOpacity style={[styles.createButton, { backgroundColor: accentColor }]} onPress={handleCreate} disabled={loading}>
          {loading ? <LoadingBrand size="small" color="#fff" /> : (
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
              <Text style={styles.createButtonText}>Lock Capsule</Text>
              <Ionicons name="lock-closed-outline" size={18} color="#FFFFFF" />
            </View>
          )}
        </TouchableOpacity>
        </Animated.View>
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#0A0A0A' },
  scroll: { paddingHorizontal: 24, paddingTop: 16, paddingBottom: 24, gap: 24 },
  title: { fontSize: 28, fontWeight: '800', color: '#FFFFFF' },
  subtitle: { fontSize: 15, color: '#888888', marginTop: 4 },
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
  createButton: {
    backgroundColor: '#FF6B35', borderRadius: 16,
    paddingVertical: 18, alignItems: 'center', marginTop: 8,
  },
  createButtonText: { color: '#FFFFFF', fontSize: 17, fontWeight: '700' },
  pendingBanner: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    borderRadius: 12,
    borderWidth: 1,
    paddingVertical: 12,
    paddingHorizontal: 16,
  },
  pendingText: { fontSize: 14, fontWeight: '600' },
});
