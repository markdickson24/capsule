import React, { useEffect, useState } from 'react';
import {
  View, Text, StyleSheet, Image, TouchableOpacity,
  FlatList, ActivityIndicator, Platform,
} from 'react-native';
import { NativeStackScreenProps } from '@react-navigation/native-stack';
import { SafeAreaView } from 'react-native-safe-area-context';
import { supabase } from '../../lib/supabase';
import { AppStackParamList } from '../../types/navigation';

type Props = NativeStackScreenProps<AppStackParamList, 'Preview'>;

type CapsuleOption = {
  capsule_id: string;
  role: string;
  capsules: { id: string; title: string; status: string } | null;
};

export default function PreviewScreen({ route, navigation }: Props) {
  const { uri, mediaType } = route.params;
  const [capsules, setCapsules] = useState<CapsuleOption[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    async function fetchCapsules() {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) return;

      const { data } = await supabase
        .from('capsule_members')
        .select('capsule_id, role, capsules(id, title, status)')
        .eq('user_id', user.id)
        .not('joined_at', 'is', null)
        .in('role', ['owner', 'contributor']);

      if (data) {
        const active = (data as CapsuleOption[]).filter(
          row => row.capsules && row.capsules.status !== 'unlocked'
        );
        setCapsules(active);
        if (active.length === 1) setSelectedId(active[0].capsule_id);
      }
    }
    fetchCapsules();
  }, []);

  async function upload() {
    if (!selectedId) return;
    setUploading(true);
    setError('');

    const { data: { user } } = await supabase.auth.getUser();
    if (!user) { setUploading(false); return; }

    const mimeType = mediaType === 'video' ? 'video/mp4' : 'image/jpeg';
    const ext = mediaType === 'video' ? 'mp4' : 'jpg';
    const storageKey = `${selectedId}/${crypto.randomUUID()}.${ext}`;

    const response = await fetch(uri);
    const blob = await response.blob();

    const { error: uploadErr } = await supabase.storage
      .from('capsule-media')
      .upload(storageKey, blob, { contentType: mimeType });

    if (uploadErr) {
      setError('Upload failed. Try again.');
      setUploading(false);
      return;
    }

    const { error: dbErr } = await supabase.from('media').insert({
      capsule_id: selectedId,
      uploader_id: user.id,
      storage_key: storageKey,
      media_type: mediaType,
      size_bytes: blob.size,
    });

    if (dbErr) {
      setError('Saved to storage but failed to record. Try again.');
      setUploading(false);
      return;
    }

    navigation.replace('CapsuleDetail', { capsuleId: selectedId });
  }

  return (
    <View style={styles.container}>
      {/* Full-screen preview */}
      {mediaType === 'photo' ? (
        <Image source={{ uri }} style={StyleSheet.absoluteFill} resizeMode="cover" />
      ) : (
        <View style={[StyleSheet.absoluteFill, styles.videoPlaceholder]}>
          <Text style={styles.videoIcon}>🎥</Text>
          <Text style={styles.videoLabel}>Video ready</Text>
        </View>
      )}

      {/* Dark gradient overlay at bottom */}
      <View style={styles.overlay} />

      <SafeAreaView edges={['top', 'bottom']} style={styles.ui}>
        {/* Top: discard */}
        <TouchableOpacity style={styles.discardBtn} onPress={() => navigation.goBack()}>
          <Text style={styles.discardText}>✕</Text>
        </TouchableOpacity>

        {/* Bottom panel */}
        <View style={styles.bottomPanel}>
          <Text style={styles.panelTitle}>Add to capsule</Text>

          {capsules.length === 0 ? (
            <Text style={styles.noCapsules}>
              No active capsules. Create one first.
            </Text>
          ) : (
            <FlatList
              data={capsules}
              keyExtractor={item => item.capsule_id}
              horizontal
              showsHorizontalScrollIndicator={false}
              contentContainerStyle={styles.capsuleList}
              renderItem={({ item }) => {
                const selected = selectedId === item.capsule_id;
                return (
                  <TouchableOpacity
                    style={[styles.capsuleChip, selected && styles.capsuleChipSelected]}
                    onPress={() => setSelectedId(item.capsule_id)}
                  >
                    <Text style={[styles.capsuleChipText, selected && styles.capsuleChipTextSelected]}>
                      {item.capsules?.title ?? 'Untitled'}
                    </Text>
                  </TouchableOpacity>
                );
              }}
            />
          )}

          {error ? <Text style={styles.error}>{error}</Text> : null}

          <TouchableOpacity
            style={[styles.addBtn, (!selectedId || uploading) && styles.addBtnDisabled]}
            onPress={upload}
            disabled={!selectedId || uploading}
          >
            {uploading ? (
              <ActivityIndicator color="#FFFFFF" size="small" />
            ) : (
              <Text style={styles.addBtnText}>Add to Capsule</Text>
            )}
          </TouchableOpacity>
        </View>
      </SafeAreaView>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#000000' },
  videoPlaceholder: {
    backgroundColor: '#111111', justifyContent: 'center', alignItems: 'center', gap: 12,
  },
  videoIcon: { fontSize: 56 },
  videoLabel: { fontSize: 18, color: '#888888', fontWeight: '600' },
  overlay: {
    position: 'absolute', bottom: 0, left: 0, right: 0, height: '45%',
    background: 'transparent',
    // gradient-like fade using multiple overlapping views
    backgroundColor: 'rgba(0,0,0,0.65)',
  },
  ui: { flex: 1, justifyContent: 'space-between' },
  discardBtn: {
    alignSelf: 'flex-start', marginTop: 8, marginLeft: 16,
    width: 40, height: 40, borderRadius: 20,
    backgroundColor: 'rgba(0,0,0,0.5)',
    justifyContent: 'center', alignItems: 'center',
  },
  discardText: { color: '#FFFFFF', fontSize: 18, fontWeight: '700' },
  bottomPanel: {
    paddingHorizontal: 24, paddingBottom: 8, gap: 14,
  },
  panelTitle: { fontSize: 18, fontWeight: '700', color: '#FFFFFF' },
  noCapsules: { color: '#888888', fontSize: 14 },
  capsuleList: { gap: 10, paddingBottom: 4 },
  capsuleChip: {
    backgroundColor: 'rgba(255,255,255,0.15)',
    borderRadius: 20, paddingHorizontal: 16, paddingVertical: 8,
    borderWidth: 2, borderColor: 'transparent',
  },
  capsuleChipSelected: {
    backgroundColor: 'rgba(255,107,53,0.25)', borderColor: '#FF6B35',
  },
  capsuleChipText: { color: '#CCCCCC', fontWeight: '600', fontSize: 14 },
  capsuleChipTextSelected: { color: '#FF6B35' },
  error: { color: '#FF3B30', fontSize: 13 },
  addBtn: {
    backgroundColor: '#FF6B35', borderRadius: 14,
    paddingVertical: 16, alignItems: 'center',
  },
  addBtnDisabled: { backgroundColor: '#552010' },
  addBtnText: { color: '#FFFFFF', fontWeight: '700', fontSize: 16 },
});
