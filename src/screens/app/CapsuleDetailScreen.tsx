import React, { useEffect, useState, useRef } from 'react';
import {
  View, Text, StyleSheet, SafeAreaView, ScrollView,
  TouchableOpacity, ActivityIndicator, Modal, TextInput,
  Share, Image, Platform, Dimensions, Animated, PanResponder, FlatList, Alert,
} from 'react-native';
import { NativeStackScreenProps } from '@react-navigation/native-stack';
import * as ImagePicker from 'expo-image-picker';
import * as FileSystem from 'expo-file-system/legacy';
import * as VideoThumbnails from 'expo-video-thumbnails';
import { useVideoPlayer, VideoView } from 'expo-video';
import { supabase } from '../../lib/supabase';
import { randomUUID } from '../../lib/uuid';
import { Avatar } from './ProfileScreen';
import { Ionicons } from '@expo/vector-icons';
import { Capsule } from '../../types/database';
import { AppStackParamList } from '../../types/navigation';

type Props = NativeStackScreenProps<AppStackParamList, 'CapsuleDetail'>;

type MemberRow = {
  user_id: string;
  role: string;
  joined_at: string | null;
  users: { display_name: string; avatar_url: string | null } | null;
};

type UserResult = { id: string; display_name: string };

type MediaItem = {
  id: string;
  storage_key: string;
  uploader_id: string;
  uploaded_at: string;
  mediaType: 'photo' | 'video';
  signedUrl: string;
  thumbnailUri?: string;
};

const roleIonicon: Record<string, keyof typeof Ionicons.glyphMap> = {
  owner: 'star',
  contributor: 'pencil-outline',
  viewer: 'eye-outline',
};

const roleLabel: Record<string, string> = {
  owner: 'Owner',
  contributor: 'Contributor',
  viewer: 'Viewer',
};

function ProgressRing({ progress, size = 160, stroke = 10, color = '#FF6B35', trackColor = '#2A2A2A' }: {
  progress: number; size?: number; stroke?: number; color?: string; trackColor?: string;
}) {
  const p = Math.min(1, Math.max(0, progress));
  const half = size / 2;
  const deg = p * 360;
  const rightRot = -135 + Math.min(deg, 180);
  const leftRot = -135 + Math.max(deg - 180, 0);
  return (
    <View style={{ width: size, height: size }}>
      <View style={{ position: 'absolute', left: half, width: half, height: size, overflow: 'hidden' }}>
        <View style={{
          position: 'absolute', left: -half, width: size, height: size,
          borderRadius: half, borderWidth: stroke,
          borderTopColor: color, borderRightColor: color,
          borderBottomColor: trackColor, borderLeftColor: trackColor,
          transform: [{ rotate: `${rightRot}deg` }],
        }} />
      </View>
      <View style={{ position: 'absolute', left: 0, width: half, height: size, overflow: 'hidden' }}>
        <View style={{
          position: 'absolute', left: 0, width: size, height: size,
          borderRadius: half, borderWidth: stroke,
          borderTopColor: trackColor, borderRightColor: trackColor,
          borderBottomColor: color, borderLeftColor: color,
          transform: [{ rotate: `${leftRot}deg` }],
        }} />
      </View>
    </View>
  );
}

function CountdownRing({ unlockAt, createdAt }: { unlockAt: string; createdAt?: string | null }) {
  const [now, setNow] = useState(Date.now());

  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 60_000);
    return () => clearInterval(id);
  }, []);

  const unlock = new Date(unlockAt).getTime();
  const created = createdAt
    ? new Date(createdAt).getTime()
    : unlock - 365 * 24 * 60 * 60 * 1000;
  const remaining = Math.max(0, unlock - now);
  const progress = (unlock - created) > 0 ? remaining / (unlock - created) : 0;

  const days = Math.floor(remaining / (1000 * 60 * 60 * 24));
  const hours = Math.floor((remaining % (1000 * 60 * 60 * 24)) / (1000 * 60 * 60));
  const timeStr = remaining <= 0
    ? 'Unlocking soon'
    : days > 0 ? `${days}d ${hours}h left` : `${hours}h left`;

  const unlockDateStr = new Date(unlockAt).toLocaleDateString('en-US', {
    month: 'long', day: 'numeric', year: 'numeric',
  });

  return (
    <View style={cds.wrap}>
      <View style={{ width: 180, height: 180 }}>
        <ProgressRing progress={progress} size={180} stroke={12} />
        <View style={cds.center}>
          <Ionicons name="lock-closed" size={48} color="#FF6B35" />
        </View>
      </View>
      <Text style={cds.title}>Capsule locked</Text>
      <Text style={cds.date}>Unlocks {unlockDateStr}</Text>
      <Text style={cds.left}>{timeStr}</Text>
    </View>
  );
}

const cds = StyleSheet.create({
  wrap: { alignItems: 'center', gap: 10, paddingVertical: 24 },
  center: { position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, alignItems: 'center', justifyContent: 'center' },
  title: { fontSize: 20, fontWeight: '700', color: '#FFFFFF' },
  date: { fontSize: 15, color: '#888888' },
  left: { fontSize: 24, fontWeight: '800', color: '#FF6B35' },
});

function getTimeLeft(unlockAt: string) {
  const diff = new Date(unlockAt).getTime() - Date.now();
  if (diff <= 0) return null;
  const days = Math.floor(diff / (1000 * 60 * 60 * 24));
  const hours = Math.floor((diff % (1000 * 60 * 60 * 24)) / (1000 * 60 * 60));
  return { days, hours };
}

async function sendInviteNotification(userId: string, capsuleTitle: string, inviterName: string) {
  const { data } = await supabase
    .from('users')
    .select('push_token')
    .eq('id', userId)
    .single();
  const token = (data as any)?.push_token;
  if (!token) return;
  fetch('https://exp.host/--/api/v2/push/send', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
    body: JSON.stringify({
      to: token,
      title: 'You were invited to a Capsule!',
      body: `${inviterName} invited you to "${capsuleTitle}"`,
      data: { screen: 'Notifications' },
      sound: 'default',
    }),
  });
}

function InviteModal({
  capsuleId,
  capsuleTitle,
  inviterName,
  existingMemberIds,
  onClose,
  onInvited,
}: {
  capsuleId: string;
  capsuleTitle: string;
  inviterName: string;
  existingMemberIds: string[];
  onClose: () => void;
  onInvited: () => void;
}) {
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<UserResult[]>([]);
  const [inviting, setInviting] = useState<string | null>(null);
  const [invitedIds, setInvitedIds] = useState<string[]>([]);
  const [error, setError] = useState('');
  const debounce = useRef<ReturnType<typeof setTimeout> | null>(null);

  function onSearch(text: string) {
    setQuery(text);
    if (debounce.current) clearTimeout(debounce.current);
    if (text.trim().length < 2) { setResults([]); return; }
    debounce.current = setTimeout(async () => {
      const { data } = await supabase
        .from('users')
        .select('id, display_name')
        .ilike('display_name', `%${text.trim()}%`)
        .limit(8);
      if (data) {
        setResults(
          (data as UserResult[]).filter(
            u => !existingMemberIds.includes(u.id) && !invitedIds.includes(u.id)
          )
        );
      }
    }, 300);
  }

  async function invite(userId: string) {
    setInviting(userId);
    setError('');
    const { error: err } = await supabase.from('capsule_members').insert({
      capsule_id: capsuleId,
      user_id: userId,
      role: 'contributor',
    });
    if (err) {
      setError('Could not send invite. They may already be a member.');
    } else {
      setInvitedIds(prev => [...prev, userId]);
      setResults(prev => prev.filter(u => u.id !== userId));
      onInvited();
      sendInviteNotification(userId, capsuleTitle, inviterName);
    }
    setInviting(null);
  }

  async function shareLink() {
    await Share.share({
      message: `Join my Capsule "${capsuleTitle}"! Tap to join: capsule://join/${capsuleId}`,
    });
  }

  return (
    <Modal visible animationType="slide" presentationStyle="pageSheet" onRequestClose={onClose}>
      <SafeAreaView style={ms.container}>
        <View style={ms.header}>
          <Text style={ms.title}>Invite People</Text>
          <TouchableOpacity onPress={onClose}>
            <Text style={ms.done}>Done</Text>
          </TouchableOpacity>
        </View>

        <TextInput
          style={ms.input}
          placeholder="Search by username…"
          placeholderTextColor="#555555"
          value={query}
          onChangeText={onSearch}
          autoCapitalize="none"
          autoCorrect={false}
          autoFocus
        />

        {error ? <Text style={ms.error}>{error}</Text> : null}

        {results.length > 0 && (
          <View style={ms.results}>
            {results.map(u => (
              <View key={u.id} style={ms.row}>
                <View style={ms.avatar}>
                  <Text style={ms.avatarText}>{u.display_name[0].toUpperCase()}</Text>
                </View>
                <Text style={ms.name}>{u.display_name}</Text>
                <TouchableOpacity
                  style={ms.inviteBtn}
                  onPress={() => invite(u.id)}
                  disabled={inviting === u.id}
                >
                  <Text style={ms.inviteBtnText}>{inviting === u.id ? '…' : 'Invite'}</Text>
                </TouchableOpacity>
              </View>
            ))}
          </View>
        )}

        {invitedIds.length > 0 && (
          <Text style={ms.success}>
            {invitedIds.length} invite{invitedIds.length > 1 ? 's' : ''} sent ✓
          </Text>
        )}

        <View style={ms.sep} />

        <TouchableOpacity style={ms.shareBtn} onPress={shareLink}>
          <Text style={ms.shareBtnText}>Share Invite Link</Text>
        </TouchableOpacity>
      </SafeAreaView>
    </Modal>
  );
}

const SCREEN_WIDTH = Dimensions.get('window').width;
const SCREEN_HEIGHT = Dimensions.get('window').height;

const REACTION_EMOJIS = ['❤️', '😂', '😮', '🔥', '😢', '👏', '🤯'];

type Reaction = { id: string; media_id: string; user_id: string; emoji: string };

function ReactionsBar({
  mediaId,
  reactions,
  currentUserId,
  onAdd,
  onRemove,
}: {
  mediaId: string;
  reactions: Reaction[];
  currentUserId: string;
  onAdd: (mediaId: string, emoji: string) => void;
  onRemove: (reactionId: string) => void;
}) {
  const [showPicker, setShowPicker] = useState(false);

  const groups = REACTION_EMOJIS
    .map(emoji => {
      const matching = reactions.filter(r => r.media_id === mediaId && r.emoji === emoji);
      const mine = matching.find(r => r.user_id === currentUserId);
      return { emoji, count: matching.length, myReactionId: mine?.id ?? null };
    })
    .filter(g => g.count > 0);

  const reactedEmojis = new Set(
    reactions.filter(r => r.media_id === mediaId && r.user_id === currentUserId).map(r => r.emoji)
  );

  return (
    <View style={{ position: 'absolute', bottom: 48, left: 0, right: 0, paddingHorizontal: 16 }}>
      {showPicker && (
        <View style={rs.picker}>
          {REACTION_EMOJIS.filter(e => !reactedEmojis.has(e)).map(emoji => (
            <TouchableOpacity
              key={emoji}
              onPress={() => { onAdd(mediaId, emoji); setShowPicker(false); }}
              style={rs.pickerEmoji}
            >
              <Text style={{ fontSize: 28 }}>{emoji}</Text>
            </TouchableOpacity>
          ))}
        </View>
      )}
      <View style={rs.bar}>
        {groups.map(g => (
          <TouchableOpacity
            key={g.emoji}
            style={[rs.pill, g.myReactionId && rs.pillMine]}
            onPress={() => g.myReactionId ? onRemove(g.myReactionId) : onAdd(mediaId, g.emoji)}
          >
            <Text style={{ fontSize: 16 }}>{g.emoji}</Text>
            <Text style={rs.pillCount}>{g.count}</Text>
          </TouchableOpacity>
        ))}
        <TouchableOpacity
          style={rs.pill}
          onPress={() => setShowPicker(p => !p)}
        >
          <Ionicons name={showPicker ? 'close' : 'add'} size={16} color="#fff" />
        </TouchableOpacity>
      </View>
    </View>
  );
}

const rs = StyleSheet.create({
  bar: { flexDirection: 'row', gap: 8, flexWrap: 'wrap', alignItems: 'center' },
  pill: { flexDirection: 'row', alignItems: 'center', gap: 4, backgroundColor: 'rgba(255,255,255,0.15)', borderRadius: 20, paddingHorizontal: 12, paddingVertical: 7, borderWidth: 1, borderColor: 'transparent' },
  pillMine: { backgroundColor: 'rgba(255,107,53,0.25)', borderColor: '#FF6B35' },
  pillCount: { color: '#fff', fontSize: 13, fontWeight: '700' },
  picker: { flexDirection: 'row', justifyContent: 'center', gap: 8, backgroundColor: 'rgba(20,20,20,0.92)', borderRadius: 24, padding: 12, marginBottom: 10 },
  pickerEmoji: { padding: 4 },
});

function VideoSlide({ item, isActive }: { item: MediaItem; isActive: boolean }) {
  const player = useVideoPlayer(item.signedUrl, p => { p.loop = true; });
  useEffect(() => {
    if (isActive) player.play();
    else player.pause();
  }, [isActive]);
  return (
    <View style={{ width: SCREEN_WIDTH, height: SCREEN_HEIGHT, justifyContent: 'center', backgroundColor: '#000' }}>
      <VideoView player={player} style={{ width: SCREEN_WIDTH, height: SCREEN_HEIGHT }} contentFit="contain" />
    </View>
  );
}

function MediaViewerModal({
  items,
  startIndex,
  onClose,
}: {
  items: MediaItem[];
  startIndex: number;
  onClose: () => void;
}) {
  const currentIndexRef = useRef(startIndex);
  const [currentIndex, setCurrentIndex] = useState(startIndex);
  const [reactions, setReactions] = useState<Reaction[]>([]);
  const [currentUserId, setCurrentUserId] = useState('');

  useEffect(() => {
    loadReactions();
  }, []);

  async function loadReactions() {
    const { data: { session } } = await supabase.auth.getSession();
    setCurrentUserId(session?.user.id ?? '');
    const mediaIds = items.map(i => i.id);
    const { data } = await supabase
      .from('reactions')
      .select('id, media_id, user_id, emoji')
      .in('media_id', mediaIds);
    if (data) setReactions(data as Reaction[]);
  }

  async function addReaction(mediaId: string, emoji: string) {
    const { data: { session } } = await supabase.auth.getSession();
    if (!session) return;
    // Prevent duplicate
    if (reactions.some(r => r.media_id === mediaId && r.emoji === emoji && r.user_id === session.user.id)) return;
    const tempId = `tmp_${Date.now()}`;
    const optimistic = { id: tempId, media_id: mediaId, user_id: session.user.id, emoji };
    setReactions(prev => [...prev, optimistic]);
    const { data, error } = await supabase
      .from('reactions')
      .insert({ media_id: mediaId, emoji, user_id: session.user.id })
      .select('id')
      .single();
    if (error) setReactions(prev => prev.filter(r => r.id !== tempId));
    else if (data) setReactions(prev => prev.map(r => r.id === tempId ? { ...r, id: data.id } : r));
  }

  async function removeReaction(reactionId: string) {
    setReactions(prev => prev.filter(r => r.id !== reactionId));
    await supabase.from('reactions').delete().eq('id', reactionId);
  }

  const translateX = useRef(new Animated.Value(-startIndex * SCREEN_WIDTH)).current;
  const translateY = useRef(new Animated.Value(0)).current;
  const bgOpacity = useRef(new Animated.Value(1)).current;

  // Track which axis this gesture is locked to so we don't move diagonally
  const axis = useRef<'none' | 'h' | 'v'>('none');

  const goToIndex = (index: number) => {
    currentIndexRef.current = index;
    setCurrentIndex(index);
    Animated.spring(translateX, { toValue: -index * SCREEN_WIDTH, useNativeDriver: true, bounciness: 0 }).start();
  };

  const panResponder = useRef(
    PanResponder.create({
      onStartShouldSetPanResponder: () => true,
      onPanResponderGrant: () => { axis.current = 'none'; },
      onPanResponderMove: (_, { dx, dy }) => {
        // Lock axis on first meaningful movement
        if (axis.current === 'none') {
          if (dy > 8 && dy > Math.abs(dx)) axis.current = 'v';
          else if (Math.abs(dx) > 8) axis.current = 'h';
        }
        if (axis.current === 'v' && dy > 0) {
          translateY.setValue(dy);
          bgOpacity.setValue(Math.max(0, 1 - dy / (SCREEN_HEIGHT * 0.45)));
        } else if (axis.current === 'h') {
          translateX.setValue(-currentIndexRef.current * SCREEN_WIDTH + dx);
        }
      },
      onPanResponderRelease: (_, { dx, dy, vx, vy }) => {
        if (axis.current === 'v') {
          if (dy > 120 || vy > 1.5) {
            Animated.timing(translateY, { toValue: SCREEN_HEIGHT, duration: 220, useNativeDriver: true }).start(onClose);
          } else {
            Animated.parallel([
              Animated.spring(translateY, { toValue: 0, useNativeDriver: true, bounciness: 6 }),
              Animated.spring(bgOpacity, { toValue: 1, useNativeDriver: true }),
            ]).start();
          }
        } else {
          const idx = currentIndexRef.current;
          let next = idx;
          if ((dx < -SCREEN_WIDTH * 0.25 || vx < -0.5) && idx < items.length - 1) next = idx + 1;
          else if ((dx > SCREEN_WIDTH * 0.25 || vx > 0.5) && idx > 0) next = idx - 1;
          goToIndex(next);
        }
        axis.current = 'none';
      },
    })
  ).current;

  return (
    <Modal visible animationType="fade" statusBarTranslucent onRequestClose={onClose}>
      <Animated.View style={{ flex: 1, backgroundColor: '#000', opacity: bgOpacity }}>
        <Animated.View
          style={{ flex: 1, transform: [{ translateY }] }}
          {...panResponder.panHandlers}
        >
          {/* Slide row — all items side by side, moved with translateX */}
          <Animated.View style={{ flexDirection: 'row', width: SCREEN_WIDTH * items.length, flex: 1, transform: [{ translateX }] }}>
            {items.map((item, index) =>
              item.mediaType === 'video' ? (
                <VideoSlide key={item.id} item={item} isActive={index === currentIndex} />
              ) : (
                <View key={item.id} style={{ width: SCREEN_WIDTH, height: SCREEN_HEIGHT, justifyContent: 'center', backgroundColor: '#000' }}>
                  <Image source={{ uri: item.signedUrl }} style={{ width: SCREEN_WIDTH, height: SCREEN_HEIGHT }} resizeMode="contain" />
                </View>
              )
            )}
          </Animated.View>

          {/* Reactions */}
          <ReactionsBar
            mediaId={items[currentIndex]?.id ?? ''}
            reactions={reactions}
            currentUserId={currentUserId}
            onAdd={addReaction}
            onRemove={removeReaction}
          />

          {/* Header */}
          <View style={{ position: 'absolute', top: 56, left: 0, right: 0, flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', paddingHorizontal: 20 }}>
            <TouchableOpacity onPress={onClose} style={{ padding: 8 }}>
              <Ionicons name="close" size={24} color="#fff" />
            </TouchableOpacity>
            <Text style={{ color: '#fff', fontSize: 15, fontWeight: '600', opacity: 0.8 }}>
              {currentIndex + 1} / {items.length}
            </Text>
            <View style={{ width: 36 }} />
          </View>
        </Animated.View>
      </Animated.View>
    </Modal>
  );
}

function MediaGalleryModal({
  visible,
  items,
  onClose,
  onSelect,
}: {
  visible: boolean;
  items: MediaItem[];
  onClose: () => void;
  onSelect: (index: number) => void;
}) {
  const thumbSize = (Dimensions.get('window').width - 4) / 3;

  return (
    <Modal visible={visible} animationType="slide" onRequestClose={onClose}>
      <SafeAreaView style={gal.container}>
        <View style={gal.header}>
          <Text style={gal.title}>All Media</Text>
          <Text style={gal.count}>{items.length}</Text>
          <TouchableOpacity onPress={onClose} style={gal.closeBtn}>
            <Ionicons name="close" size={22} color="#888888" />
          </TouchableOpacity>
        </View>
        <FlatList
          data={items}
          numColumns={3}
          keyExtractor={item => item.id}
          renderItem={({ item, index }) => (
            <TouchableOpacity
              style={[gal.thumb, { width: thumbSize, height: thumbSize }]}
              onPress={() => { onClose(); onSelect(index); }}
              activeOpacity={0.8}
            >
              {(item.mediaType === 'photo' || item.thumbnailUri) && (
                <Image
                  source={{ uri: item.mediaType === 'video' ? item.thumbnailUri : item.signedUrl }}
                  style={StyleSheet.absoluteFill}
                  resizeMode="cover"
                />
              )}
              {item.mediaType === 'video' && (
                <View style={gal.playOverlay}>
                  <Ionicons name="play" size={20} color="#fff" />
                </View>
              )}
            </TouchableOpacity>
          )}
          ItemSeparatorComponent={() => <View style={{ height: 2 }} />}
          columnWrapperStyle={{ gap: 2 }}
        />
      </SafeAreaView>
    </Modal>
  );
}

export default function CapsuleDetailScreen({ route, navigation }: Props) {
  const { capsuleId } = route.params;
  const [capsule, setCapsule] = useState<Capsule | null>(null);
  const [members, setMembers] = useState<MemberRow[]>([]);
  const [photos, setPhotos] = useState<MediaItem[]>([]);
  const [activeMediaIndex, setActiveMediaIndex] = useState<number | null>(null);
  const [showGallery, setShowGallery] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [currentUserId, setCurrentUserId] = useState('');
  const [showInvite, setShowInvite] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [uploadCount, setUploadCount] = useState({ done: 0, total: 0 });
  const [showPickerOptions, setShowPickerOptions] = useState(false);
  const [uploadError, setUploadError] = useState('');
  const revealOpacity = useRef(new Animated.Value(0)).current;
  const revealScale = useRef(new Animated.Value(0.8)).current;
  const [showReveal, setShowReveal] = useState(false);

  function triggerReveal() {
    setShowReveal(true);
    Animated.parallel([
      Animated.spring(revealScale, { toValue: 1, useNativeDriver: true }),
      Animated.timing(revealOpacity, { toValue: 1, duration: 400, useNativeDriver: true }),
    ]).start(() => {
      setTimeout(() => {
        Animated.timing(revealOpacity, { toValue: 0, duration: 600, useNativeDriver: true }).start(
          () => setShowReveal(false)
        );
      }, 2500);
    });
  }

  async function fetchPhotos() {
    const { data: mediaData } = await supabase
      .from('media')
      .select('id, storage_key, uploader_id, uploaded_at, media_type')
      .eq('capsule_id', capsuleId)
      .order('uploaded_at', { ascending: false });

    if (!mediaData || mediaData.length === 0) { setPhotos([]); return; }

    const { data: signedData } = await supabase.storage
      .from('capsule-media')
      .createSignedUrls(mediaData.map((m: any) => m.storage_key), 3600);

    const items: MediaItem[] = mediaData.map((m: any, i: number) => ({
      id: m.id,
      storage_key: m.storage_key,
      uploader_id: m.uploader_id,
      uploaded_at: m.uploaded_at,
      mediaType: m.media_type,
      signedUrl: signedData?.[i]?.signedUrl ?? '',
    }));

    setPhotos(items);

    // Generate thumbnails for videos in background
    if (Platform.OS !== 'web') {
      for (const item of items) {
        if (item.mediaType === 'video' && item.signedUrl) {
          VideoThumbnails.getThumbnailAsync(item.signedUrl, { time: 0 })
            .then(({ uri }) => {
              setPhotos(prev => prev.map(p => p.id === item.id ? { ...p, thumbnailUri: uri } : p));
            })
            .catch(() => {});
        }
      }
    }
  }

  async function load() {
    const { data: { user } } = await supabase.auth.getUser();
    setCurrentUserId(user?.id ?? '');

    const [capsuleRes, membersRes] = await Promise.all([
      supabase.from('capsules').select('*').eq('id', capsuleId).single(),
      supabase
        .from('capsule_members')
        .select('user_id, role, joined_at, users(display_name, avatar_url)')
        .eq('capsule_id', capsuleId),
    ]);

    if (capsuleRes.error) {
      setError('Failed to load capsule.');
    } else {
      setCapsule(capsuleRes.data);
    }

    if (membersRes.data) setMembers(membersRes.data as MemberRow[]);

    await fetchPhotos();
    setLoading(false);
  }

  useEffect(() => { load(); }, [capsuleId]);

  useEffect(() => {
    const channel = supabase
      .channel(`capsule-${capsuleId}`)
      .on(
        'postgres_changes',
        { event: 'UPDATE', schema: 'public', table: 'capsules', filter: `id=eq.${capsuleId}` },
        (payload) => {
          const updated = payload.new as Capsule;
          setCapsule(updated);
          if (updated.status === 'unlocked') {
            triggerReveal();
            fetchPhotos();
          }
        }
      )
      .subscribe();

    return () => { supabase.removeChannel(channel); };
  }, [capsuleId]);

  async function uploadPhotos(assets: ImagePicker.ImagePickerAsset[]) {
    setUploading(true);
    setUploadError('');
    setUploadCount({ done: 0, total: assets.length });

    try {
      const { data: { session } } = await supabase.auth.getSession();
      if (!session) { setUploading(false); return; }

      let failed = 0;
      for (let i = 0; i < assets.length; i++) {
        const asset = assets[i];
        const mimeType = asset.mimeType ?? 'image/jpeg';
        const ext = mimeType.split('/').pop()?.replace('jpeg', 'jpg') ?? 'jpg';
        const storageKey = `${capsuleId}/${randomUUID()}.${ext}`;

        try {
          let sizeBytes = 0;

          if (Platform.OS === 'web') {
            const response = await fetch(asset.uri);
            const arrayBuffer = await response.arrayBuffer();
            sizeBytes = arrayBuffer.byteLength;
            const { error: uploadErr } = await supabase.storage
              .from('capsule-media')
              .upload(storageKey, arrayBuffer, { contentType: mimeType });
            if (uploadErr) throw new Error(uploadErr.message);
          } else {
            const fileInfo = await FileSystem.getInfoAsync(asset.uri, { size: true });
            sizeBytes = fileInfo.exists ? (fileInfo as any).size ?? 0 : 0;
            const result = await FileSystem.uploadAsync(
              `${process.env.EXPO_PUBLIC_SUPABASE_URL}/storage/v1/object/capsule-media/${storageKey}`,
              asset.uri,
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
            if (result.status < 200 || result.status >= 300) throw new Error(`${result.status}`);
          }

          await supabase.from('media').insert({
            capsule_id: capsuleId,
            uploader_id: session.user.id,
            storage_key: storageKey,
            media_type: 'photo',
            size_bytes: sizeBytes,
          });
        } catch {
          failed++;
        }

        setUploadCount({ done: i + 1, total: assets.length });
      }

      if (failed > 0) setUploadError(`${failed} photo${failed > 1 ? 's' : ''} failed to upload.`);
    } catch {
      setUploadError('Upload failed. Try again.');
    }

    setUploading(false);
    setShowPickerOptions(false);
    await fetchPhotos();
  }

  async function pickFromLibrary() {
    const { status } = await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (status !== 'granted') {
      setUploadError('Photo library access denied. Enable it in Settings.');
      return;
    }
    const result = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ImagePicker.MediaTypeOptions.Images,
      allowsMultipleSelection: true,
      quality: 0.8,
    });
    if (!result.canceled) await uploadPhotos(result.assets);
  }

  async function pickFromCamera() {
    const { status } = await ImagePicker.requestCameraPermissionsAsync();
    if (status !== 'granted') {
      setUploadError('Camera access denied. Enable it in Settings.');
      return;
    }
    const result = await ImagePicker.launchCameraAsync({
      mediaTypes: ImagePicker.MediaTypeOptions.Images,
      quality: 0.8,
    });
    if (!result.canceled) await uploadPhotos(result.assets);
  }

  if (loading) {
    return (
      <SafeAreaView style={styles.container}>
        <ActivityIndicator color="#FF6B35" style={{ marginTop: 80 }} />
      </SafeAreaView>
    );
  }

  if (error || !capsule) {
    return (
      <SafeAreaView style={styles.container}>
        <TouchableOpacity style={styles.topBar} onPress={() => navigation.goBack()}>
          <Text style={styles.backText}>← Back</Text>
        </TouchableOpacity>
        <Text style={styles.errorText}>{error || 'Capsule not found.'}</Text>
      </SafeAreaView>
    );
  }

  const isLocked = capsule.status !== 'unlocked';
  const timeLeft = isLocked ? getTimeLeft(capsule.unlock_at) : null;
  const unlockDate = new Date(capsule.unlock_at).toLocaleDateString('en-US', {
    month: 'long', day: 'numeric', year: 'numeric',
  });
  const unlockTime = new Date(capsule.unlock_at).toLocaleTimeString('en-US', {
    hour: 'numeric', minute: '2-digit',
  });

  const isOwner = capsule.owner_id === currentUserId;
  const myRole = members.find(m => m.user_id === currentUserId)?.role ?? null;
  const canSeePhotos = !isLocked || isOwner;
  const contributionLocked = capsule.contribution_lock_at
    ? new Date(capsule.contribution_lock_at) <= new Date()
    : false;
  const canUpload = isOwner || (myRole === 'contributor' && !contributionLocked);
  const existingMemberIds = members.map(m => m.user_id);

  return (
    <SafeAreaView style={styles.container}>
      <View style={styles.topBar}>
        <TouchableOpacity onPress={() => navigation.goBack()}>
          <Text style={styles.backText}>← Back</Text>
        </TouchableOpacity>
        {isOwner && isLocked && (
          <TouchableOpacity
            style={styles.editBtn}
            onPress={() => navigation.navigate('EditCapsule', { capsuleId: capsule.id })}
          >
            <Ionicons name="pencil-outline" size={18} color="#FF6B35" />
            <Text style={styles.editBtnText}>Edit</Text>
          </TouchableOpacity>
        )}
      </View>

      <ScrollView contentContainerStyle={styles.scroll} showsVerticalScrollIndicator={false}>
        <View style={styles.hero}>
          <Ionicons
            name={isLocked ? 'time-outline' : 'lock-open-outline'}
            size={40}
            color={isLocked ? '#888888' : '#30D158'}
          />
          <View style={[styles.statusBadge, !isLocked && styles.statusBadgeUnlocked]}>
            <Text style={[styles.statusText, !isLocked && styles.statusTextUnlocked]}>
              {capsule.status.toUpperCase()}
            </Text>
          </View>
        </View>

        <Text style={styles.title}>{capsule.title}</Text>
        {capsule.description ? (
          <Text style={styles.description}>{capsule.description}</Text>
        ) : null}

        {isLocked ? (
          <CountdownRing unlockAt={capsule.unlock_at} createdAt={(capsule as any).created_at} />
        ) : (
          <View style={styles.timeCard}>
            <Text style={styles.timeLabel}>Unlocked</Text>
            <Text style={styles.timeDate}>{unlockDate} at {unlockTime}</Text>
          </View>
        )}

        {/* Members */}
        <View style={styles.sectionRow}>
          <Text style={styles.sectionTitle}>Members</Text>
          {isOwner && (
            <TouchableOpacity style={styles.inviteBtn} onPress={() => setShowInvite(true)}>
              <Text style={styles.inviteBtnText}>+ Invite</Text>
            </TouchableOpacity>
          )}
        </View>

        <View style={styles.membersList}>
          {members.map((m, i) => (
            <TouchableOpacity
              key={i}
              style={styles.memberRow}
              onPress={() => navigation.navigate('PublicProfile', { userId: m.user_id })}
            >
              <Avatar
                url={m.users?.avatar_url ?? null}
                name={m.users?.display_name ?? '?'}
                size={36}
              />
              <View style={styles.memberInfo}>
                <Text style={styles.memberName}>{m.users?.display_name ?? 'Member'}</Text>
                {m.joined_at === null && <Text style={styles.pendingLabel}>pending</Text>}
              </View>
              <View style={styles.roleBadge}>
                <Ionicons name={roleIonicon[m.role] ?? 'person-outline'} size={11} color="#888888" />
                <Text style={styles.roleText}>{roleLabel[m.role]}</Text>
              </View>
            </TouchableOpacity>
          ))}
        </View>

        {/* Media */}
        <View style={styles.sectionRow}>
          <Text style={styles.sectionTitle}>Media</Text>
          {photos.length > 0 && canSeePhotos && (
            <Text style={styles.photoCount}>{photos.length}</Text>
          )}
        </View>

        {canSeePhotos ? (
          photos.length > 0 ? (
            <>
              <View style={styles.photoGrid}>
                {photos.slice(0, 3).map((p, index) => {
                  const isLast = index === 2 && photos.length > 3;
                  return (
                    <TouchableOpacity
                      key={p.id}
                      style={styles.photoThumb}
                      activeOpacity={0.8}
                      onPress={() => isLast ? setShowGallery(true) : setActiveMediaIndex(index)}
                    >
                      {(p.mediaType === 'photo' || p.thumbnailUri) && (
                        <Image
                          source={{ uri: p.mediaType === 'video' ? p.thumbnailUri : p.signedUrl }}
                          style={StyleSheet.absoluteFill}
                          resizeMode="cover"
                        />
                      )}
                      {p.mediaType === 'video' && !isLast && (
                        <View style={styles.playOverlay}>
                          <Ionicons name="play" size={22} color="#fff" />
                        </View>
                      )}
                      {isLast && (
                        <View style={styles.moreOverlay}>
                          <Text style={styles.moreText}>+{photos.length - 2}</Text>
                        </View>
                      )}
                    </TouchableOpacity>
                  );
                })}
              </View>
              {photos.length > 3 && (
                <TouchableOpacity
                  style={styles.viewAllBtn}
                  onPress={() => setShowGallery(true)}
                >
                  <Text style={styles.viewAllText}>See all {photos.length}</Text>
                </TouchableOpacity>
              )}
            </>
          ) : (
            <View style={styles.emptyPhotos}>
              <Ionicons name="camera-outline" size={32} color="#555555" />
              <Text style={styles.emptyPhotosText}>No media yet</Text>
            </View>
          )
        ) : (
          <View style={styles.lockedBox}>
            <Ionicons name="lock-closed-outline" size={32} color="#555555" />
            <Text style={styles.lockedText}>Media reveals on {unlockDate}</Text>
            {photos.length > 0 && (
              <Text style={styles.lockedCount}>{photos.length} {photos.length === 1 ? 'memory' : 'memories'} waiting</Text>
            )}
          </View>
        )}

        {/* Upload controls */}
        {canUpload && (
          <View style={styles.uploadArea}>
            {uploadError ? <Text style={styles.uploadError}>{uploadError}</Text> : null}

            {uploading ? (
              <View style={styles.uploadingRow}>
                <ActivityIndicator color="#FF6B35" size="small" />
                <Text style={styles.uploadingText}>
                  Uploading {uploadCount.done}/{uploadCount.total}…
                </Text>
              </View>
            ) : showPickerOptions ? (
              <View style={styles.pickerOptions}>
                {Platform.OS !== 'web' && (
                  <TouchableOpacity style={styles.pickerBtn} onPress={pickFromCamera}>
                    <Ionicons name="camera-outline" size={18} color="#FFFFFF" />
                    <Text style={styles.pickerBtnText}>Take Photo</Text>
                  </TouchableOpacity>
                )}
                <TouchableOpacity style={styles.pickerBtn} onPress={pickFromLibrary}>
                  <Ionicons name="images-outline" size={18} color="#FFFFFF" />
                  <Text style={styles.pickerBtnText}>Camera Roll</Text>
                </TouchableOpacity>
                <TouchableOpacity
                  style={styles.pickerCancelBtn}
                  onPress={() => setShowPickerOptions(false)}
                >
                  <Text style={styles.pickerCancelText}>Cancel</Text>
                </TouchableOpacity>
              </View>
            ) : (
              <TouchableOpacity
                style={styles.addPhotoBtn}
                onPress={() => { setUploadError(''); setShowPickerOptions(true); }}
              >
                <Text style={styles.addPhotoBtnText}>+ Add Photos</Text>
              </TouchableOpacity>
            )}
          </View>
        )}

        {isOwner && (
          <View style={styles.dangerZone}>
            <Text style={styles.dangerLabel}>Danger Zone</Text>
            <TouchableOpacity
              style={styles.archiveBtn}
              onPress={async () => {
                const isArchived = !!(capsule as any).archived_at;
                if (isArchived) {
                  await supabase.from('capsules').update({ archived_at: null }).eq('id', capsuleId);
                } else {
                  await supabase.from('capsules').update({ archived_at: new Date().toISOString() }).eq('id', capsuleId);
                }
                navigation.reset({ index: 0, routes: [{ name: 'Tabs' }] });
              }}
            >
              <Ionicons name="archive-outline" size={18} color="#888888" />
              <Text style={styles.archiveBtnText}>
                {(capsule as any).archived_at ? 'Restore Capsule' : 'Archive Capsule'}
              </Text>
            </TouchableOpacity>
            <TouchableOpacity
              style={styles.deleteBtn}
              onPress={() => {
                Alert.alert(
                  'Delete Capsule',
                  'This permanently deletes the capsule and all its media. This cannot be undone.',
                  [
                    { text: 'Cancel', style: 'cancel' },
                    {
                      text: 'Delete',
                      style: 'destructive',
                      onPress: async () => {
                        const { data: mediaRows } = await supabase
                          .from('media').select('storage_key, thumbnail_key').eq('capsule_id', capsuleId);
                        const keys = (mediaRows ?? []).flatMap((m: any) =>
                          [m.storage_key, m.thumbnail_key].filter(Boolean)
                        );
                        if (keys.length) await supabase.storage.from('capsule-media').remove(keys);
                        await supabase.from('capsules').delete().eq('id', capsuleId);
                        navigation.reset({ index: 0, routes: [{ name: 'Tabs' }] });
                      },
                    },
                  ]
                );
              }}
            >
              <Ionicons name="trash-outline" size={18} color="#FF3B30" />
              <Text style={styles.deleteBtnText}>Delete Capsule</Text>
            </TouchableOpacity>
          </View>
        )}
      </ScrollView>

      <MediaGalleryModal
        visible={showGallery}
        items={photos}
        onClose={() => setShowGallery(false)}
        onSelect={(index) => setActiveMediaIndex(index)}
      />

      {activeMediaIndex !== null && (
        <MediaViewerModal
          items={photos}
          startIndex={activeMediaIndex}
          onClose={() => setActiveMediaIndex(null)}
        />
      )}

      {showInvite && (
        <InviteModal
          capsuleId={capsuleId}
          capsuleTitle={capsule?.title ?? ''}
          inviterName={members.find(m => m.user_id === currentUserId)?.users?.display_name ?? 'Someone'}
          existingMemberIds={existingMemberIds}
          onClose={() => setShowInvite(false)}
          onInvited={load}
        />
      )}

      {showReveal && (
        <Animated.View
          style={[styles.revealOverlay, { opacity: revealOpacity, transform: [{ scale: revealScale }] }]}
          pointerEvents="none"
        >
          <Ionicons name="lock-open-outline" size={64} color="#30D158" />
          <Text style={styles.revealTitle}>It's time!</Text>
          <Text style={styles.revealSub}>Your capsule is now open</Text>
        </Animated.View>
      )}
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#0A0A0A' },
  topBar: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    paddingHorizontal: 20, paddingTop: 12, paddingBottom: 4,
  },
  backText: { color: '#FF6B35', fontSize: 16, fontWeight: '600' },
  editBtn: { flexDirection: 'row', alignItems: 'center', gap: 4 },
  editBtnText: { color: '#FF6B35', fontSize: 15, fontWeight: '600' },
  scroll: { paddingHorizontal: 24, paddingBottom: 48, gap: 16 },
  hero: { flexDirection: 'row', alignItems: 'center', gap: 12, marginTop: 8 },
  statusBadge: {
    backgroundColor: '#2A2A2A', borderRadius: 8,
    paddingHorizontal: 10, paddingVertical: 4,
  },
  statusBadgeUnlocked: { backgroundColor: '#30D15820' },
  statusText: { fontSize: 12, fontWeight: '700', color: '#888888', letterSpacing: 1 },
  statusTextUnlocked: { color: '#30D158' },
  title: { fontSize: 30, fontWeight: '800', color: '#FFFFFF' },
  description: { fontSize: 16, color: '#888888', lineHeight: 24 },
  timeCard: {
    backgroundColor: '#1A1A1A', borderRadius: 16,
    padding: 20, borderWidth: 1, borderColor: '#2A2A2A', gap: 4,
  },
  timeLabel: { fontSize: 13, color: '#555555', textTransform: 'uppercase', letterSpacing: 0.5 },
  timeDate: { fontSize: 14, color: '#888888' },
  sectionRow: {
    flexDirection: 'row', alignItems: 'center',
    justifyContent: 'space-between', marginTop: 8,
  },
  sectionTitle: { fontSize: 18, fontWeight: '700', color: '#FFFFFF' },
  photoCount: { fontSize: 14, color: '#555555' },
  inviteBtn: {
    backgroundColor: '#FF6B3520', borderRadius: 8,
    paddingHorizontal: 12, paddingVertical: 6,
  },
  inviteBtnText: { color: '#FF6B35', fontWeight: '700', fontSize: 14 },
  membersList: { gap: 8 },
  memberRow: {
    flexDirection: 'row', alignItems: 'center',
    backgroundColor: '#1A1A1A', borderRadius: 12, padding: 14, gap: 12,
  },
  memberInfo: { flex: 1 },
  memberName: { fontSize: 15, fontWeight: '600', color: '#FFFFFF' },
  pendingLabel: { fontSize: 11, color: '#888888', marginTop: 2 },
  roleBadge: { flexDirection: 'row', alignItems: 'center', gap: 4, backgroundColor: '#2A2A2A', borderRadius: 6, paddingHorizontal: 8, paddingVertical: 4 },
  roleText: { fontSize: 12, color: '#888888' },
  photoGrid: { flexDirection: 'row', gap: 2 },
  photoThumb: { flex: 1, aspectRatio: 1, overflow: 'hidden', backgroundColor: '#1A1A1A' },
  playOverlay: { ...StyleSheet.absoluteFillObject, alignItems: 'center', justifyContent: 'center', backgroundColor: 'rgba(0,0,0,0.35)' },
  moreOverlay: { ...StyleSheet.absoluteFillObject, alignItems: 'center', justifyContent: 'center', backgroundColor: 'rgba(0,0,0,0.55)' },
  moreText: { color: '#fff', fontSize: 24, fontWeight: '800' },
  viewAllBtn: { alignSelf: 'flex-end', paddingTop: 6, paddingBottom: 2, paddingHorizontal: 2 },
  viewAllText: { color: '#FF6B35', fontSize: 13, fontWeight: '600' },
  emptyPhotos: {
    backgroundColor: '#1A1A1A', borderRadius: 16,
    padding: 32, alignItems: 'center', gap: 8,
    borderWidth: 1, borderColor: '#2A2A2A',
  },
  emptyPhotosText: { fontSize: 15, color: '#555555' },
  lockedBox: {
    backgroundColor: '#1A1A1A', borderRadius: 16, padding: 32,
    alignItems: 'center', gap: 8, borderWidth: 1, borderColor: '#2A2A2A',
  },
  lockedText: { fontSize: 15, color: '#888888', textAlign: 'center' },
  lockedCount: { fontSize: 13, color: '#FF6B35', fontWeight: '600' },
  uploadArea: { gap: 10 },
  uploadingRow: { flexDirection: 'row', alignItems: 'center', gap: 10, paddingVertical: 4 },
  uploadingText: { color: '#888888', fontSize: 15 },
  uploadError: { color: '#FF3B30', fontSize: 14 },
  pickerOptions: { gap: 10 },
  pickerBtn: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 10,
    backgroundColor: '#1A1A1A', borderRadius: 14,
    paddingVertical: 16, borderWidth: 1, borderColor: '#2A2A2A',
  },
  pickerBtnText: { color: '#FFFFFF', fontWeight: '600', fontSize: 16 },
  pickerCancelBtn: { paddingVertical: 12, alignItems: 'center' },
  pickerCancelText: { color: '#555555', fontSize: 15 },
  addPhotoBtn: {
    backgroundColor: '#FF6B35', borderRadius: 14,
    paddingVertical: 16, alignItems: 'center',
  },
  addPhotoBtnText: { color: '#FFFFFF', fontWeight: '700', fontSize: 16 },
  errorText: { color: '#FF3B30', textAlign: 'center', marginTop: 40, fontSize: 15 },
  dangerZone: { gap: 10, marginTop: 16, paddingTop: 24, borderTopWidth: 1, borderTopColor: '#1A1A1A' },
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
  revealOverlay: {
    position: 'absolute', top: 0, left: 0, right: 0, bottom: 0,
    backgroundColor: '#000000CC', justifyContent: 'center', alignItems: 'center', gap: 12,
  },
  revealTitle: { fontSize: 32, fontWeight: '800', color: '#FFFFFF' },
  revealSub: { fontSize: 16, color: '#888888' },
});

const ms = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#0A0A0A' },
  header: {
    flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center',
    paddingHorizontal: 24, paddingTop: 20, paddingBottom: 16,
  },
  title: { fontSize: 22, fontWeight: '800', color: '#FFFFFF' },
  done: { fontSize: 16, fontWeight: '600', color: '#FF6B35' },
  input: {
    marginHorizontal: 24, backgroundColor: '#1A1A1A', borderRadius: 12,
    paddingHorizontal: 16, paddingVertical: 14, fontSize: 16,
    color: '#FFFFFF', borderWidth: 1, borderColor: '#2A2A2A',
  },
  results: { marginTop: 8, marginHorizontal: 24, gap: 8 },
  row: {
    flexDirection: 'row', alignItems: 'center',
    backgroundColor: '#1A1A1A', borderRadius: 12, padding: 12, gap: 12,
  },
  avatar: {
    width: 36, height: 36, borderRadius: 18,
    backgroundColor: '#FF6B3530', justifyContent: 'center', alignItems: 'center',
  },
  avatarText: { fontSize: 16, fontWeight: '700', color: '#FF6B35' },
  name: { flex: 1, fontSize: 15, fontWeight: '600', color: '#FFFFFF' },
  inviteBtn: {
    backgroundColor: '#FF6B35', borderRadius: 8,
    paddingHorizontal: 14, paddingVertical: 7,
  },
  inviteBtnText: { color: '#FFFFFF', fontWeight: '700', fontSize: 14 },
  error: { color: '#FF3B30', fontSize: 14, marginHorizontal: 24, marginTop: 8 },
  success: { color: '#30D158', fontSize: 14, marginHorizontal: 24, marginTop: 12, fontWeight: '600' },
  sep: { height: 1, backgroundColor: '#1A1A1A', marginHorizontal: 24, marginTop: 24, marginBottom: 20 },
  shareBtn: {
    marginHorizontal: 24, backgroundColor: '#1A1A1A', borderRadius: 14,
    paddingVertical: 16, alignItems: 'center', borderWidth: 1, borderColor: '#2A2A2A',
  },
  shareBtnText: { color: '#FFFFFF', fontWeight: '700', fontSize: 16 },
});

const gal = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#0A0A0A' },
  header: {
    flexDirection: 'row', alignItems: 'center',
    paddingHorizontal: 20, paddingTop: 12, paddingBottom: 16, gap: 8,
  },
  title: { fontSize: 22, fontWeight: '800', color: '#FFFFFF', flex: 1 },
  count: { fontSize: 15, color: '#555555', fontWeight: '600' },
  closeBtn: { padding: 8 },
  closeText: { color: '#FFFFFF', fontSize: 18, fontWeight: '700' },
  thumb: { overflow: 'hidden', backgroundColor: '#1A1A1A' },
  playOverlay: {
    ...StyleSheet.absoluteFillObject,
    alignItems: 'center', justifyContent: 'center',
    backgroundColor: 'rgba(0,0,0,0.35)',
  },
});
