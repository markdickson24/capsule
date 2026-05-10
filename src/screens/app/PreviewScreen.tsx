import React, { useEffect, useState } from 'react';
import {
  View, Text, StyleSheet, Image, TouchableOpacity,
  FlatList, ActivityIndicator, Platform,
} from 'react-native';
import { useVideoPlayer, VideoView } from 'expo-video';
import * as FileSystem from 'expo-file-system/legacy';
import { NativeStackScreenProps } from '@react-navigation/native-stack';
import { SafeAreaView } from 'react-native-safe-area-context';
import { supabase } from '../../lib/supabase';
import { randomUUID } from '../../lib/uuid';
import { AppStackParamList } from '../../types/navigation';

type Props = NativeStackScreenProps<AppStackParamList, 'Preview'>;

type CapsuleOption = {
  capsule_id: string;
  role: string;
  capsules: { id: string; title: string; status: string } | null;
};

export default function PreviewScreen({ route, navigation }: Props) {
  const { uri, mediaType, facing } = route.params;
  const player = useVideoPlayer(mediaType === 'video' ? uri : null, p => {
    p.loop = true;
    p.play();
  });
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

    try {
      const { data: { session } } = await supabase.auth.getSession();
      if (!session) { setUploading(false); return; }

      const mimeType = mediaType === 'video' ? 'video/mp4' : 'image/jpeg';
      const ext = mediaType === 'video' ? 'mp4' : 'jpg';
      const storageKey = `${selectedId}/${randomUUID()}.${ext}`;

      let sizeBytes = 0;

      if (Platform.OS === 'web') {
        const response = await fetch(uri);
        const arrayBuffer = await response.arrayBuffer();
        sizeBytes = arrayBuffer.byteLength;
        const { error: uploadErr } = await supabase.storage
          .from('capsule-media')
          .upload(storageKey, arrayBuffer, { contentType: mimeType });
        if (uploadErr) throw new Error(uploadErr.message);
      } else {
        const fileInfo = await FileSystem.getInfoAsync(uri, { size: true });
        sizeBytes = fileInfo.exists ? (fileInfo as any).size ?? 0 : 0;
        const uploadResult = await FileSystem.uploadAsync(
          `${process.env.EXPO_PUBLIC_SUPABASE_URL}/storage/v1/object/capsule-media/${storageKey}`,
          uri,
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
        if (uploadResult.status < 200 || uploadResult.status >= 300) {
          throw new Error(`Storage returned ${uploadResult.status}: ${uploadResult.body}`);
        }
      }

      const { error: dbErr } = await supabase.from('media').insert({
        capsule_id: selectedId,
        uploader_id: session.user.id,
        storage_key: storageKey,
        media_type: mediaType,
        size_bytes: sizeBytes,
      });

      if (dbErr) throw new Error(dbErr.message);

      navigation.replace('CapsuleDetail', { capsuleId: selectedId });
    } catch (e: any) {
      setError(e?.message ?? 'Upload failed. Try again.');
      setUploading(false);
    }
  }

  return (
    <View style={styles.container}>
      {/* Full-screen preview */}
      {mediaType === 'photo' ? (
        <Image source={{ uri }} style={StyleSheet.absoluteFill} resizeMode="cover" />
      ) : (
        <VideoView
          player={player}
          style={StyleSheet.absoluteFill}
          contentFit="cover"
          nativeControls={false}
        />
      )}

      {/* Top: discard */}
      <SafeAreaView edges={['top']} style={styles.topBar}>
        <TouchableOpacity style={styles.discardBtn} onPress={() => navigation.goBack()}>
          <Text style={styles.discardText}>✕</Text>
        </TouchableOpacity>
      </SafeAreaView>

      {/* Bottom panel — self-contained dark background */}
      <SafeAreaView edges={['bottom']} style={styles.bottomPanel}>
        <Text style={styles.panelTitle}>Add to capsule</Text>

        {capsules.length === 0 ? (
          <Text style={styles.noCapsules}>No active capsules. Create one first.</Text>
        ) : (
          <FlatList
            data={capsules}
            keyExtractor={item => item.capsule_id}
            horizontal
            showsHorizontalScrollIndicator={false}
            contentContainerStyle={styles.chipList}
            renderItem={({ item }) => {
              const selected = selectedId === item.capsule_id;
              return (
                <TouchableOpacity
                  style={[styles.chip, selected && styles.chipSelected]}
                  onPress={() => setSelectedId(item.capsule_id)}
                >
                  {selected && <Text style={styles.chipCheck}>✓ </Text>}
                  <Text style={[styles.chipText, selected && styles.chipTextSelected]}>
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
      </SafeAreaView>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#000000' },
  topBar: { paddingHorizontal: 16, paddingTop: 8 },
  discardBtn: {
    width: 40, height: 40, borderRadius: 20,
    backgroundColor: 'rgba(0,0,0,0.55)',
    justifyContent: 'center', alignItems: 'center',
  },
  discardText: { color: '#FFFFFF', fontSize: 18, fontWeight: '700' },
  bottomPanel: {
    position: 'absolute', bottom: 0, left: 0, right: 0,
    backgroundColor: 'rgba(0,0,0,0.82)',
    paddingHorizontal: 24, paddingTop: 20, paddingBottom: 8,
    gap: 14,
  },
  panelTitle: { fontSize: 17, fontWeight: '700', color: '#FFFFFF' },
  noCapsules: { color: '#888888', fontSize: 14 },
  chipList: { gap: 10, paddingBottom: 2 },
  chip: {
    flexDirection: 'row', alignItems: 'center',
    backgroundColor: 'rgba(255,255,255,0.12)',
    borderRadius: 20, paddingHorizontal: 16, paddingVertical: 9,
    borderWidth: 2, borderColor: 'transparent',
  },
  chipSelected: {
    backgroundColor: '#FF6B35', borderColor: '#FF6B35',
  },
  chipCheck: { color: '#FFFFFF', fontWeight: '700', fontSize: 14 },
  chipText: { color: '#CCCCCC', fontWeight: '600', fontSize: 14 },
  chipTextSelected: { color: '#FFFFFF', fontWeight: '700' },
  error: { color: '#FF3B30', fontSize: 13 },
  addBtn: {
    backgroundColor: '#FF6B35', borderRadius: 14,
    paddingVertical: 16, alignItems: 'center',
  },
  addBtnDisabled: { backgroundColor: '#552010' },
  addBtnText: { color: '#FFFFFF', fontWeight: '700', fontSize: 16 },
});
