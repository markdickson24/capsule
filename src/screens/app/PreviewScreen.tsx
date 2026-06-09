import React, { useEffect, useMemo, useRef, useState } from 'react';
import LoadingBrand from '../../components/LoadingBrand';
import {
  View, Text, StyleSheet, TouchableOpacity,
  FlatList, Platform,
  Animated, PanResponder, Modal, Pressable, Dimensions,
} from 'react-native';
import { Image } from 'expo-image';
import { useVideoPlayer, VideoView } from 'expo-video';
import * as FileSystem from 'expo-file-system/legacy';
import { NativeStackScreenProps } from '@react-navigation/native-stack';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { supabase, getFreshAccessToken } from '../../lib/supabase';
import { sessionStore } from '../../lib/sessionStore';
import { randomUUID } from '../../lib/uuid';
import { AppStackParamList, PendingMedia } from '../../types/navigation';
import { useTheme } from '../../context/ThemeContext';
import { cache } from '../../lib/cache';

type Props = NativeStackScreenProps<AppStackParamList, 'Preview'>;

type CapsuleOption = {
  capsule_id: string;
  role: string;
  capsules: { id: string; title: string; status: string } | null;
};

const SCREEN_WIDTH = Dimensions.get('window').width;

async function uploadToSingle(
  capsuleId: string,
  uri: string,
  mediaType: 'photo' | 'video',
): Promise<void> {
  const session = sessionStore.get();
  if (!session) throw new Error('Not signed in');

  const mimeType = mediaType === 'video' ? 'video/mp4' : 'image/jpeg';
  const ext = mediaType === 'video' ? 'mp4' : 'jpg';
  const storageKey = `${capsuleId}/${randomUUID()}.${ext}`;

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
    const fileInfo = await FileSystem.getInfoAsync(uri);
    sizeBytes = fileInfo.exists ? (fileInfo as any).size ?? 0 : 0;
    const accessToken = await getFreshAccessToken();
    const uploadResult = await FileSystem.uploadAsync(
      `${process.env.EXPO_PUBLIC_SUPABASE_URL}/storage/v1/object/capsule-media/${storageKey}`,
      uri,
      {
        httpMethod: 'POST',
        uploadType: FileSystem.FileSystemUploadType.BINARY_CONTENT,
        headers: {
          Authorization: `Bearer ${accessToken}`,
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
    capsule_id: capsuleId,
    uploader_id: session.user.id,
    storage_key: storageKey,
    media_type: mediaType,
    size_bytes: sizeBytes,
  });

  if (dbErr) throw new Error(dbErr.message);
}

export default function PreviewScreen({ route, navigation }: Props) {
  const { accentColor } = useTheme();

  const items: PendingMedia[] = useMemo(() => {
    const params: any = route.params;
    if (Array.isArray(params?.media)) return params.media;
    if (params?.uri && params?.mediaType) {
      return [{ uri: params.uri, mediaType: params.mediaType }];
    }
    return [];
  }, [route.params]);

  const [currentIndex, setCurrentIndex] = useState(0);
  const currentItem = items[currentIndex];

  const player = useVideoPlayer(
    currentItem?.mediaType === 'video' ? currentItem.uri : null,
    p => { p.loop = true; p.play(); }
  );

  const [capsules, setCapsules] = useState<CapsuleOption[]>([]);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [uploading, setUploading] = useState(false);
  const [uploadProgress, setUploadProgress] = useState({ done: 0, total: 0 });
  const [error, setError] = useState('');
  const [showDiscard, setShowDiscard] = useState(false);

  const translateY = useRef(new Animated.Value(0)).current;
  const SWIPE_THRESHOLD = 100;

  const swipeResponder = useRef(PanResponder.create({
    onStartShouldSetPanResponder: () => false,
    onMoveShouldSetPanResponder: (_, g) => g.dy > 10 && g.dy > Math.abs(g.dx),
    onPanResponderMove: (_, g) => {
      if (g.dy > 0) translateY.setValue(g.dy);
    },
    onPanResponderRelease: (_, g) => {
      if (g.dy > SWIPE_THRESHOLD) {
        setShowDiscard(true);
      }
      Animated.spring(translateY, { toValue: 0, useNativeDriver: true, tension: 80, friction: 10 }).start();
    },
  })).current;

  useEffect(() => {
    async function fetchCapsules() {
      const session = sessionStore.get();
      if (!session) return;
      const { data } = await supabase
        .from('capsule_members')
        .select('capsule_id, role, capsules(id, title, status)')
        .eq('user_id', session.user.id)
        .not('joined_at', 'is', null)
        .in('role', ['owner', 'contributor']);

      if (data) {
        const active = (data as CapsuleOption[]).filter(
          row => row.capsules && row.capsules.status !== 'unlocked'
        );
        setCapsules(active);
        if (active.length === 1) setSelectedIds(new Set([active[0].capsule_id]));
      }
    }
    fetchCapsules();
  }, []);

  function toggleCapsule(id: string) {
    setSelectedIds(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  async function upload() {
    if (selectedIds.size === 0 || items.length === 0) return;
    setUploading(true);
    setError('');

    const ids = Array.from(selectedIds);
    const total = ids.length * items.length;
    setUploadProgress({ done: 0, total });

    try {
      let done = 0;
      for (const id of ids) {
        for (const item of items) {
          await uploadToSingle(id, item.uri, item.mediaType);
          done += 1;
          setUploadProgress({ done, total });
        }
      }

      cache.invalidate('capsules');
      for (const id of ids) cache.invalidate(`capsule:${id}`);

      if (ids.length === 1) {
        navigation.replace('CapsuleDetail', { capsuleId: ids[0] });
      } else {
        navigation.replace('Tabs', { screen: 'Home' });
      }
    } catch (e: any) {
      setError(e?.message ?? 'Upload failed. Try again.');
      setUploading(false);
    }
  }

  function goCreateCapsule() {
    navigation.replace('Tabs', {
      screen: 'Create',
      params: { pendingMedia: items },
    });
  }

  const hasSelection = selectedIds.size > 0;
  const itemCount = items.length;
  const itemLabel = itemCount > 1
    ? `${itemCount} items`
    : currentItem?.mediaType === 'video' ? 'video' : 'photo';

  return (
    <View style={styles.container}>
      <Animated.View
        style={[StyleSheet.absoluteFill, { transform: [{ translateY }] }]}
        {...swipeResponder.panHandlers}
      >
        {itemCount === 0 ? (
          <View style={[StyleSheet.absoluteFill, styles.emptyMedia]}>
            <Text style={styles.emptyMediaText}>Nothing to preview</Text>
          </View>
        ) : (
          <FlatList
            data={items}
            keyExtractor={(_, i) => String(i)}
            horizontal
            pagingEnabled
            showsHorizontalScrollIndicator={false}
            scrollEnabled={itemCount > 1}
            onMomentumScrollEnd={e => {
              const idx = Math.round(e.nativeEvent.contentOffset.x / SCREEN_WIDTH);
              if (idx !== currentIndex) setCurrentIndex(idx);
            }}
            getItemLayout={(_, i) => ({ length: SCREEN_WIDTH, offset: SCREEN_WIDTH * i, index: i })}
            renderItem={({ item, index }) => (
              <View style={styles.slide}>
                {item.mediaType === 'photo' ? (
                  <Image source={item.uri} style={StyleSheet.absoluteFill} contentFit="cover" />
                ) : index === currentIndex ? (
                  <VideoView
                    player={player}
                    style={StyleSheet.absoluteFill}
                    contentFit="cover"
                    nativeControls={false}
                  />
                ) : (
                  <View style={[StyleSheet.absoluteFill, styles.videoPlaceholder]}>
                    <Ionicons name="play-circle" size={56} color="rgba(255,255,255,0.4)" />
                  </View>
                )}
              </View>
            )}
          />
        )}

        <SafeAreaView edges={['top']} style={styles.topBar}>
          <TouchableOpacity style={styles.discardBtn} onPress={() => setShowDiscard(true)}>
            <Ionicons name="close" size={20} color="#FFFFFF" />
          </TouchableOpacity>
          {itemCount > 1 ? (
            <View style={styles.counterPill}>
              <Text style={styles.counterText}>{currentIndex + 1} / {itemCount}</Text>
            </View>
          ) : (
            <Text style={styles.swipeHint}>Swipe down to discard</Text>
          )}
        </SafeAreaView>

        {itemCount > 1 && (
          <View style={styles.dotsRow} pointerEvents="none">
            {items.map((_, i) => (
              <View
                key={i}
                style={[
                  styles.dot,
                  i === currentIndex && [styles.dotActive, { backgroundColor: '#FFFFFF' }],
                ]}
              />
            ))}
          </View>
        )}

        <SafeAreaView edges={['bottom']} style={styles.bottomPanel}>
          <Text style={styles.panelTitle}>
            {itemCount > 1 ? `Add ${itemCount} items to capsule` : 'Add to capsule'}
          </Text>

          {capsules.length === 0 ? (
            <View style={styles.emptyState}>
              <Ionicons name="cube-outline" size={24} color="#666" />
              <Text style={styles.emptyText}>No active capsules yet</Text>
            </View>
          ) : (
            <FlatList
              data={capsules}
              keyExtractor={item => item.capsule_id}
              horizontal
              showsHorizontalScrollIndicator={false}
              contentContainerStyle={styles.chipList}
              renderItem={({ item }) => {
                const selected = selectedIds.has(item.capsule_id);
                return (
                  <TouchableOpacity
                    style={[styles.chip, selected && [styles.chipSelected, { backgroundColor: accentColor, borderColor: accentColor }]]}
                    onPress={() => toggleCapsule(item.capsule_id)}
                    disabled={uploading}
                  >
                    {selected && <Ionicons name="checkmark" size={14} color="#FFFFFF" />}
                    <Text style={[styles.chipText, selected && styles.chipTextSelected]}>
                      {item.capsules?.title ?? 'Untitled'}
                    </Text>
                  </TouchableOpacity>
                );
              }}
            />
          )}

          {error ? <Text style={styles.error}>{error}</Text> : null}

          {capsules.length === 0 ? (
            <TouchableOpacity
              style={[styles.addBtn, { backgroundColor: accentColor }]}
              onPress={goCreateCapsule}
            >
              <Ionicons name="add" size={20} color="#FFFFFF" />
              <Text style={styles.addBtnText}>Create Capsule</Text>
            </TouchableOpacity>
          ) : (
            <TouchableOpacity
              style={[styles.addBtn, { backgroundColor: accentColor }, (!hasSelection || uploading) && styles.addBtnDisabled]}
              onPress={upload}
              disabled={!hasSelection || uploading}
            >
              {uploading ? (
                <View style={styles.uploadingRow}>
                  <LoadingBrand size="small" color="#FFFFFF" />
                  <Text style={styles.addBtnText}>
                    {uploadProgress.total > 1
                      ? `Uploading ${uploadProgress.done}/${uploadProgress.total}…`
                      : 'Uploading…'}
                  </Text>
                </View>
              ) : (
                <Text style={styles.addBtnText}>
                  {selectedIds.size > 1
                    ? `Add to ${selectedIds.size} Capsules`
                    : 'Add to Capsule'}
                </Text>
              )}
            </TouchableOpacity>
          )}
        </SafeAreaView>
      </Animated.View>

      <Modal
        visible={showDiscard}
        transparent
        animationType="slide"
        onRequestClose={() => setShowDiscard(false)}
      >
        <Pressable style={styles.sheetBackdrop} onPress={() => setShowDiscard(false)}>
          <Pressable style={styles.sheet} onPress={() => {}}>
            <View style={styles.sheetHandle} />
            <Text style={styles.sheetTitle}>Discard this?</Text>
            <Text style={styles.sheetSubtext}>
              {itemCount > 1
                ? `These ${itemCount} items won't be saved to any capsule.`
                : `This ${itemLabel} won't be saved to any capsule.`}
            </Text>
            <TouchableOpacity style={styles.destructBtn} onPress={() => navigation.goBack()}>
              <Text style={styles.destructBtnText}>Discard</Text>
            </TouchableOpacity>
            <TouchableOpacity style={styles.cancelBtn} onPress={() => setShowDiscard(false)}>
              <Text style={styles.cancelBtnText}>Keep</Text>
            </TouchableOpacity>
          </Pressable>
        </Pressable>
      </Modal>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#000000' },
  slide: { width: SCREEN_WIDTH, height: '100%' },
  videoPlaceholder: { backgroundColor: '#000', justifyContent: 'center', alignItems: 'center' },
  emptyMedia: { backgroundColor: '#000', justifyContent: 'center', alignItems: 'center' },
  emptyMediaText: { color: '#666', fontSize: 15 },
  topBar: { paddingHorizontal: 16, paddingTop: 8, flexDirection: 'row', alignItems: 'center', gap: 12 },
  discardBtn: {
    width: 40, height: 40, borderRadius: 20,
    backgroundColor: 'rgba(0,0,0,0.55)',
    justifyContent: 'center', alignItems: 'center',
  },
  swipeHint: { color: 'rgba(255,255,255,0.45)', fontSize: 12 },
  counterPill: {
    backgroundColor: 'rgba(0,0,0,0.55)',
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 14,
  },
  counterText: { color: '#FFFFFF', fontSize: 13, fontWeight: '600' },
  dotsRow: {
    position: 'absolute',
    top: 0, left: 0, right: 0,
    flexDirection: 'row',
    justifyContent: 'center',
    gap: 6,
    paddingTop: 110,
  },
  dot: {
    width: 6, height: 6, borderRadius: 3,
    backgroundColor: 'rgba(255,255,255,0.35)',
  },
  dotActive: { width: 18 },
  sheetBackdrop: { flex: 1, backgroundColor: 'rgba(0,0,0,0.6)', justifyContent: 'flex-end' },
  sheet: {
    backgroundColor: '#1A1A1A', borderTopLeftRadius: 20, borderTopRightRadius: 20,
    paddingHorizontal: 24, paddingTop: 12, paddingBottom: 40, gap: 12,
  },
  sheetHandle: { width: 36, height: 4, borderRadius: 2, backgroundColor: '#444', alignSelf: 'center', marginBottom: 16 },
  sheetTitle: { fontSize: 20, fontWeight: '800', color: '#FFFFFF', textAlign: 'center' },
  sheetSubtext: { fontSize: 14, color: '#888888', textAlign: 'center', lineHeight: 20, marginBottom: 8 },
  destructBtn: {
    width: '100%', backgroundColor: '#FF3B3015', borderWidth: 1, borderColor: '#FF3B30',
    borderRadius: 12, paddingVertical: 14, alignItems: 'center',
  },
  destructBtnText: { color: '#FF3B30', fontWeight: '700', fontSize: 16 },
  cancelBtn: { width: '100%', backgroundColor: '#2A2A2A', borderRadius: 12, paddingVertical: 14, alignItems: 'center' },
  cancelBtnText: { color: '#FFFFFF', fontWeight: '600', fontSize: 16 },
  bottomPanel: {
    position: 'absolute', bottom: 0, left: 0, right: 0,
    backgroundColor: 'rgba(0,0,0,0.82)',
    paddingHorizontal: 24, paddingTop: 20, paddingBottom: 8,
    gap: 14,
  },
  panelTitle: { fontSize: 17, fontWeight: '700', color: '#FFFFFF' },
  emptyState: {
    flexDirection: 'row', alignItems: 'center', gap: 10,
    paddingVertical: 8,
  },
  emptyText: { color: '#888888', fontSize: 14 },
  chipList: { gap: 10, paddingBottom: 2 },
  chip: {
    flexDirection: 'row', alignItems: 'center', gap: 6,
    backgroundColor: 'rgba(255,255,255,0.12)',
    borderRadius: 20, paddingHorizontal: 16, paddingVertical: 9,
    borderWidth: 2, borderColor: 'transparent',
  },
  chipSelected: {
    backgroundColor: '#FF6B35', borderColor: '#FF6B35',
  },
  chipText: { color: '#CCCCCC', fontWeight: '600', fontSize: 14 },
  chipTextSelected: { color: '#FFFFFF', fontWeight: '700' },
  error: { color: '#FF3B30', fontSize: 13 },
  addBtn: {
    flexDirection: 'row',
    backgroundColor: '#FF6B35', borderRadius: 14,
    paddingVertical: 16, alignItems: 'center', justifyContent: 'center',
    gap: 8,
  },
  addBtnDisabled: { backgroundColor: '#2A2A2A' },
  addBtnText: { color: '#FFFFFF', fontWeight: '700', fontSize: 16 },
  uploadingRow: { flexDirection: 'row', alignItems: 'center', gap: 10 },
});
