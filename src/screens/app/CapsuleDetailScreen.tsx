import React, { useEffect, useState, useRef } from 'react';
import LoadingBrand from '../../components/LoadingBrand';
import ProgressBar from '../../components/ProgressBar';
import { uploadQueue } from '../../lib/uploadQueue';
import { toast } from '../../lib/toast';
import { useUploadTasks } from '../../hooks/useUploadTasks';
import {
  View, Text, StyleSheet, ScrollView, RefreshControl,
  TouchableOpacity, Modal, TextInput, KeyboardAvoidingView,
  Share, Platform, Dimensions, Animated, PanResponder, FlatList,
} from 'react-native';
import QRCode from 'react-native-qrcode-svg';
import ViewShot from 'react-native-view-shot';
import { Image } from 'expo-image';
import { SafeAreaView, SafeAreaProvider } from 'react-native-safe-area-context';
import { NativeStackScreenProps } from '@react-navigation/native-stack';
import * as ImagePicker from 'expo-image-picker';
import * as FileSystem from 'expo-file-system/legacy';
import * as VideoThumbnails from 'expo-video-thumbnails';
import * as MediaLibrary from 'expo-media-library';
import * as Location from 'expo-location';
import { LinearGradient } from 'expo-linear-gradient';
import { useVideoPlayer, VideoView } from 'expo-video';
import { supabase } from '../../lib/supabase';
import { sessionStore } from '../../lib/sessionStore';
import { randomUUID } from '../../lib/uuid';
import { transformMediaUrl } from '../../lib/mediaUrl';
import { Avatar } from './ProfileScreen';
import { Ionicons } from '@expo/vector-icons';
import { Capsule } from '../../types/database';
import { AppStackParamList } from '../../types/navigation';
import { useTheme } from '../../context/ThemeContext';
import ConfirmModal from '../../components/ConfirmModal';
import ReportModal from '../../components/ReportModal';
import AwardsSection from '../../components/AwardsSection';
import DefaultAwardsCard from '../../components/DefaultAwardsCard';
import InfoTooltip from '../../components/InfoTooltip';
import { blockStore } from '../../lib/blocks';
import { useBlockedUsers } from '../../hooks/useBlockedUsers';
import { listFriends, type FriendProfile } from '../../lib/friends';
import SkeletonBox, { SkeletonCircle, SkeletonText, SkeletonMemberRow, SkeletonMediaGrid } from '../../components/Skeleton';
import RetryPrompt from '../../components/RetryPrompt';
import { useLoadingTimeout } from '../../hooks/useLoadingTimeout';
import { cache } from '../../lib/cache';
import { fetchAwardsData } from '../../lib/awardsData';
import { haptics } from '../../lib/haptics';
import { useSlideUp, useFadeIn } from '../../lib/animations';

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
  /** Resized signed URL for grid/preview thumbnails — full-res signedUrl is for the viewer only. */
  thumbSignedUrl?: string;
  thumbnailUri?: string;
  /** Dual (PiP) photos: signed URL of the swapped composite, for tap-to-swap in the viewer. */
  altSignedUrl?: string;
  /** Storage path of the swap composite — stable cacheKey for the alt image. */
  altStorageKey?: string;
  caption?: string | null;
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
  const { accentColor } = useTheme();
  const [now, setNow] = useState(Date.now());

  const ONE_DAY = 1000 * 60 * 60 * 24;

  useEffect(() => {
    // Self-rescheduling tick: every second once under a day remains (so the
    // countdown is live to the second), every minute when further out.
    let id: ReturnType<typeof setTimeout>;
    const tick = () => {
      const r = Math.max(0, new Date(unlockAt).getTime() - Date.now());
      setNow(Date.now());
      if (r <= 0) return; // unlocked — stop ticking
      id = setTimeout(tick, r < ONE_DAY ? 1000 : 60_000);
    };
    tick();
    return () => clearTimeout(id);
  }, [unlockAt]);

  const unlock = new Date(unlockAt).getTime();
  const created = createdAt
    ? new Date(createdAt).getTime()
    : unlock - 365 * 24 * 60 * 60 * 1000;
  const remaining = Math.max(0, unlock - now);
  const progress = (unlock - created) > 0 ? remaining / (unlock - created) : 0;

  const days = Math.floor(remaining / ONE_DAY);
  const hours = Math.floor((remaining % ONE_DAY) / (1000 * 60 * 60));
  const minutes = Math.floor((remaining % (1000 * 60 * 60)) / (1000 * 60));
  const seconds = Math.floor((remaining % (1000 * 60)) / 1000);
  let timeStr: string;
  if (remaining <= 0) timeStr = 'Unlocking soon';
  else if (days > 0) timeStr = `${days}d ${hours}h left`;
  else if (hours > 0) timeStr = `${hours}h ${minutes}m ${seconds}s left`;
  else if (minutes > 0) timeStr = `${minutes}m ${seconds}s left`;
  else timeStr = `${seconds}s left`;

  const unlockDateStr = new Date(unlockAt).toLocaleDateString('en-US', {
    month: 'long', day: 'numeric', year: 'numeric',
  });

  return (
    <View style={cds.wrap}>
      <View style={{ width: 180, height: 180 }}>
        <ProgressRing progress={progress} size={180} stroke={12} color={accentColor} />
        <View style={cds.center}>
          <Ionicons name="lock-closed" size={48} color={accentColor} />
        </View>
      </View>
      <Text style={cds.title}>Capsule locked</Text>
      <Text style={cds.date}>Unlocks {unlockDateStr}</Text>
      <Text style={[cds.left, { color: accentColor }]}>{timeStr}</Text>
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

async function sendInviteNotification(capsuleId: string, inviteeId: string) {
  // The push is sent by the send-invite-push edge function, which reads the
  // invitee's push_token server-side (clients have no read access to it).
  // Best-effort — the in-app notification is created by the notify_on_invite
  // DB trigger regardless of whether the push succeeds.
  try {
    await supabase.functions.invoke('send-invite-push', {
      body: { capsuleId, inviteeId },
    });
  } catch {
    // ignore
  }
}

function InviteModal({
  capsuleId,
  capsuleTitle,
  existingMemberIds,
  isOwner,
  onClose,
  onInvited,
}: {
  capsuleId: string;
  capsuleTitle: string;
  existingMemberIds: string[];
  isOwner: boolean;
  onClose: () => void;
  onInvited: () => void;
}) {
  const { accentColor } = useTheme();
  const [tab, setTab] = useState<'friends' | 'search'>('friends');
  const [friends, setFriends] = useState<FriendProfile[]>([]);
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<UserResult[]>([]);
  const [inviting, setInviting] = useState<string | null>(null);
  const [invitedIds, setInvitedIds] = useState<string[]>([]);
  const [error, setError] = useState('');
  const [showQR, setShowQR] = useState(false);
  const debounce = useRef<ReturnType<typeof setTimeout> | null>(null);
  const inviteTimestamps = useRef<number[]>([]);
  const viewShotRef = useRef<any>(null);

  useEffect(() => {
    listFriends().then(fs =>
      setFriends(fs.filter(f => !existingMemberIds.includes(f.id) && !blockStore.has(f.id)))
    );
  }, []);

  // Friends not yet invited this session.
  const friendsToShow = friends.filter(f => !invitedIds.includes(f.id));

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
            u => !existingMemberIds.includes(u.id) && !invitedIds.includes(u.id) && !blockStore.has(u.id)
          )
        );
      }
    }, 300);
  }

  async function invite(userId: string) {
    const now = Date.now();
    inviteTimestamps.current = inviteTimestamps.current.filter(t => now - t < 60_000);
    if (inviteTimestamps.current.length >= 10) {
      setError('Too many invites — please wait a moment before sending more.');
      return;
    }
    inviteTimestamps.current.push(now);
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
      sendInviteNotification(capsuleId, userId);
    }
    setInviting(null);
  }

  async function shareLink() {
    await Share.share({
      message: `Join my Capsule "${capsuleTitle}"! Tap to join: capsule://join/${capsuleId}`,
    });
  }

  async function handleSaveQR() {
    try {
      const uri = await viewShotRef.current?.capture?.();
      if (!uri) return;
      await MediaLibrary.saveToLibraryAsync(uri);
      setError('QR code saved to camera roll ✓');
    } catch {
      setError('Could not save QR code.');
    }
  }

  return (
    <Modal visible animationType="slide" presentationStyle="pageSheet" onRequestClose={onClose}>
      <SafeAreaProvider>
      <SafeAreaView style={ms.container}>
        <View style={ms.header}>
          <Text style={ms.title}>Invite People</Text>
          <TouchableOpacity onPress={onClose}>
            <Text style={[ms.done, { color: accentColor }]}>Done</Text>
          </TouchableOpacity>
        </View>

        <View style={ms.tabs}>
          {(['friends', 'search'] as const).map(t => (
            <TouchableOpacity
              key={t}
              style={[ms.tab, tab === t && { backgroundColor: accentColor }]}
              onPress={() => setTab(t)}
              activeOpacity={0.8}
            >
              <Text style={[ms.tabText, tab === t && ms.tabTextActive]}>
                {t === 'friends' ? 'Friends' : 'Search'}
              </Text>
            </TouchableOpacity>
          ))}
        </View>

        {tab === 'search' ? (
          <>
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
            {results.length > 0 && (
              <View style={ms.results}>
                {results.map(u => (
                  <View key={u.id} style={ms.row}>
                    <View style={[ms.avatar, { backgroundColor: `${accentColor}30` }]}>
                      <Text style={[ms.avatarText, { color: accentColor }]}>{u.display_name[0].toUpperCase()}</Text>
                    </View>
                    <Text style={ms.name}>{u.display_name}</Text>
                    <TouchableOpacity
                      style={[ms.inviteBtn, { backgroundColor: accentColor }]}
                      onPress={() => invite(u.id)}
                      disabled={inviting === u.id}
                    >
                      <Text style={ms.inviteBtnText}>{inviting === u.id ? '…' : 'Invite'}</Text>
                    </TouchableOpacity>
                  </View>
                ))}
              </View>
            )}
          </>
        ) : (
          <View style={ms.results}>
            {friendsToShow.length === 0 ? (
              <Text style={ms.emptyTab}>
                {friends.length === 0
                  ? 'No friends to add yet. Add friends from their profile.'
                  : 'All your friends are already in this capsule.'}
              </Text>
            ) : (
              friendsToShow.map(f => (
                <View key={f.id} style={ms.row}>
                  <View style={[ms.avatar, { backgroundColor: `${accentColor}30` }]}>
                    <Text style={[ms.avatarText, { color: accentColor }]}>{(f.display_name[0] ?? '?').toUpperCase()}</Text>
                  </View>
                  <Text style={ms.name}>{f.display_name}</Text>
                  <TouchableOpacity
                    style={[ms.inviteBtn, { backgroundColor: accentColor }]}
                    onPress={() => invite(f.id)}
                    disabled={inviting === f.id}
                  >
                    <Text style={ms.inviteBtnText}>{inviting === f.id ? '…' : 'Invite'}</Text>
                  </TouchableOpacity>
                </View>
              ))
            )}
          </View>
        )}

        {error ? <Text style={ms.error}>{error}</Text> : null}

        {invitedIds.length > 0 && (
          <Text style={ms.success}>
            {invitedIds.length} invite{invitedIds.length > 1 ? 's' : ''} sent ✓
          </Text>
        )}

        <View style={ms.sep} />

        <TouchableOpacity style={ms.shareBtn} onPress={shareLink}>
          <Text style={ms.shareBtnText}>Share Invite Link</Text>
        </TouchableOpacity>

        {isOwner && (
          <TouchableOpacity style={ms.qrToggleBtn} onPress={() => setShowQR(true)}>
            <Ionicons name="qr-code-outline" size={16} color="#888888" />
            <Text style={ms.qrToggleBtnText}>Show QR Code</Text>
          </TouchableOpacity>
        )}

        {/* QR Code overlay — shown when isOwner taps "Show QR Code" */}
        {showQR && (
          <View style={ms.qrOverlay}>
            <TouchableOpacity style={ms.qrCloseBtn} onPress={() => { setShowQR(false); setError(''); }}>
              <Ionicons name="chevron-down" size={24} color="#ffffff" />
            </TouchableOpacity>
            <Text style={ms.qrHeading}>Scan to join</Text>
            <Text style={ms.qrSub}>{capsuleTitle}</Text>
            <ViewShot ref={viewShotRef} options={{ format: 'png', quality: 1 }}>
              <View style={ms.qrBox}>
                <QRCode
                  value={`capsule://join/${capsuleId}`}
                  size={210}
                  color="#FFFFFF"
                  backgroundColor="#1A1A1A"
                />
              </View>
            </ViewShot>
            {error ? <Text style={ms.qrMsg}>{error}</Text> : null}
            <View style={ms.qrActions}>
              <TouchableOpacity style={ms.qrActionBtn} onPress={shareLink}>
                <Ionicons name="share-outline" size={18} color="#ffffff" />
                <Text style={ms.qrActionText}>Share Link</Text>
              </TouchableOpacity>
              {Platform.OS !== 'web' && (
                <TouchableOpacity style={ms.qrActionBtn} onPress={handleSaveQR}>
                  <Ionicons name="download-outline" size={18} color="#ffffff" />
                  <Text style={ms.qrActionText}>Save QR</Text>
                </TouchableOpacity>
              )}
            </View>
          </View>
        )}
      </SafeAreaView>
      </SafeAreaProvider>
    </Modal>
  );
}

const SCREEN_WIDTH = Dimensions.get('window').width;
const SCREEN_HEIGHT = Dimensions.get('window').height;

// Both the gallery grid (3 columns) and the 3-up detail-screen preview render
// roughly screen-width/3 tiles — one shared thumbnail size covers both so
// fetchPhotos only needs to derive one resized URL per photo.
const GRID_THUMB_PX = Math.ceil(SCREEN_WIDTH / 3);

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
  const { accentColor } = useTheme();
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
              onPress={() => { haptics.light(); onAdd(mediaId, emoji); setShowPicker(false); }}
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
            style={[rs.pill, g.myReactionId && [rs.pillMine, { borderColor: accentColor, backgroundColor: `${accentColor}40` }]]}
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
  capsuleId,
  currentUserId,
  onClose,
  onCaptionSave,
}: {
  items: MediaItem[];
  startIndex: number;
  capsuleId: string;
  currentUserId: string;
  onClose: () => void;
  onCaptionSave: (itemId: string, caption: string | null) => void;
}) {
  const currentIndexRef = useRef(startIndex);
  const [currentIndex, setCurrentIndex] = useState(startIndex);
  const [reactions, setReactions] = useState<Reaction[]>([]);
  const [downloading, setDownloading] = useState(false);
  const [downloadDone, setDownloadDone] = useState(false);
  const [showReport, setShowReport] = useState(false);
  const [editingCaption, setEditingCaption] = useState(false);
  const [captionDraft, setCaptionDraft] = useState('');
  // Dual (PiP) photos: per-item toggle for which lens is the main frame.
  const [swapped, setSwapped] = useState<Record<string, boolean>>({});
  const shownUrl = (item: MediaItem) =>
    swapped[item.id] && item.altSignedUrl ? item.altSignedUrl : item.signedUrl;

  useEffect(() => {
    loadReactions();
  }, []);

  async function loadReactions() {
    const mediaIds = items.map(i => i.id);
    const { data } = await supabase
      .from('reactions')
      .select('id, media_id, user_id, emoji')
      .in('media_id', mediaIds);
    // Hide reactions from users this person has blocked.
    if (data) setReactions((data as Reaction[]).filter(r => !blockStore.has(r.user_id)));
  }

  async function addReaction(mediaId: string, emoji: string) {
    const session = sessionStore.get();
    if (!session) return;
    const userId = session.user.id;
    if (reactions.some(r => r.media_id === mediaId && r.emoji === emoji && r.user_id === userId)) return;

    // Unique constraint is (media_id, user_id) — swap if user already reacted with a different emoji
    const existing = reactions.find(r => r.media_id === mediaId && r.user_id === userId);
    if (existing) {
      setReactions(prev => prev.map(r => r.id === existing.id ? { ...r, emoji } : r));
      await supabase.from('reactions').update({ emoji }).eq('id', existing.id);
      return;
    }

    const newId = randomUUID();
    const optimistic = { id: newId, media_id: mediaId, user_id: userId, emoji };
    setReactions(prev => [...prev, optimistic]);
    const { error } = await supabase
      .from('reactions')
      .insert({ id: newId, media_id: mediaId, emoji, user_id: userId });
    if (error) setReactions(prev => prev.filter(r => r.id !== newId));
  }

  async function removeReaction(reactionId: string) {
    setReactions(prev => prev.filter(r => r.id !== reactionId));
    await supabase.from('reactions').delete().eq('id', reactionId);
  }

  async function downloadCurrent() {
    const item = items[currentIndex];
    // Save whichever view is currently shown (swapped or not) for dual photos.
    const url = shownUrl(item);
    if (!url || downloading) return;
    setDownloading(true);
    setDownloadDone(false);

    try {
      if (Platform.OS === 'web') {
        const a = document.createElement('a');
        a.href = url;
        a.download = `capsule-${item.id}.${item.mediaType === 'video' ? 'mp4' : 'jpg'}`;
        a.click();
      } else {
        const { status } = await MediaLibrary.requestPermissionsAsync();
        if (status !== 'granted') { setDownloading(false); return; }
        const ext = item.mediaType === 'video' ? 'mp4' : 'jpg';
        const localUri = FileSystem.cacheDirectory + `capsule-${item.id}.${ext}`;
        await FileSystem.downloadAsync(url, localUri);
        await MediaLibrary.saveToLibraryAsync(localUri);
      }
      setDownloadDone(true);
      setTimeout(() => setDownloadDone(false), 2000);
    } catch {
      // Silent fail — permission denied or network error
    } finally {
      setDownloading(false);
    }
  }

  const translateX = useRef(new Animated.Value(-startIndex * SCREEN_WIDTH)).current;
  const translateY = useRef(new Animated.Value(0)).current;
  const bgOpacity = useRef(new Animated.Value(1)).current;

  // Track which axis this gesture is locked to so we don't move diagonally
  const axis = useRef<'none' | 'h' | 'v'>('none');

  async function saveCaption() {
    const item = items[currentIndex];
    if (!item) return;
    const trimmed = captionDraft.trim() || null;
    await supabase.from('media').update({ caption: trimmed }).eq('id', item.id);
    onCaptionSave(item.id, trimmed);
    setEditingCaption(false);
  }

  const goToIndex = (index: number) => {
    setEditingCaption(false);
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
                  <Image
                    source={{
                      uri: shownUrl(item),
                      // Stable cacheKey (the storage path, not the signed URL) so
                      // expo-image's disk cache survives re-signing — signed URLs
                      // get a fresh token roughly every 50 minutes, which would
                      // otherwise look like a brand-new image and force a re-download.
                      cacheKey: swapped[item.id] && item.altStorageKey ? item.altStorageKey : item.storage_key,
                    }}
                    style={{ width: SCREEN_WIDTH, height: SCREEN_HEIGHT }}
                    contentFit="contain"
                    transition={150}
                  />
                  {/* Dual (PiP) photo — tap the corner bubble to swap which lens is the main frame. */}
                  {item.altSignedUrl && (
                    <TouchableOpacity
                      style={styles.swapBubble}
                      activeOpacity={0.8}
                      onPress={() => setSwapped(s => ({ ...s, [item.id]: !s[item.id] }))}
                    >
                      <Ionicons name="sync-outline" size={16} color="#FFFFFF" />
                    </TouchableOpacity>
                  )}
                </View>
              )
            )}
          </Animated.View>

          {/* Caption display */}
          {items[currentIndex]?.caption ? (
            <View style={styles.captionBanner} pointerEvents="none">
              <Text style={styles.captionBannerText}>{items[currentIndex].caption}</Text>
            </View>
          ) : null}

          {/* Reactions */}
          <ReactionsBar
            mediaId={items[currentIndex]?.id ?? ''}
            reactions={reactions}
            currentUserId={currentUserId}
            onAdd={addReaction}
            onRemove={removeReaction}
          />

          {/* Header gradient + controls */}
          <LinearGradient
            colors={['rgba(0,0,0,0.6)', 'rgba(0,0,0,0)']}
            style={{ position: 'absolute', top: 0, left: 0, right: 0, height: 120 }}
          >
            <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', paddingHorizontal: 20, marginTop: 56 }}>
              <TouchableOpacity onPress={onClose} style={{ padding: 8 }}>
                <Ionicons name="close" size={24} color="#fff" />
              </TouchableOpacity>
              <View style={{ alignItems: 'center', gap: 2 }}>
                <Text style={{ color: '#fff', fontSize: 15, fontWeight: '600' }}>
                  {currentIndex + 1} / {items.length}
                </Text>
                {items[currentIndex]?.uploaded_at ? (
                  <Text style={{ color: 'rgba(255,255,255,0.55)', fontSize: 12 }}>
                    {new Date(items[currentIndex].uploaded_at).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })}
                  </Text>
                ) : null}
              </View>
              <View style={{ flexDirection: 'row', alignItems: 'center' }}>
                {/* Caption edit — uploader only */}
                {items[currentIndex]?.uploader_id === currentUserId && (
                  <TouchableOpacity
                    onPress={() => {
                      setCaptionDraft(items[currentIndex]?.caption ?? '');
                      setEditingCaption(true);
                    }}
                    style={{ padding: 8 }}
                  >
                    <Ionicons name="pencil-outline" size={22} color="#fff" />
                  </TouchableOpacity>
                )}
                <TouchableOpacity onPress={() => setShowReport(true)} style={{ padding: 8 }}>
                  <Ionicons name="flag-outline" size={22} color="#fff" />
                </TouchableOpacity>
                <TouchableOpacity onPress={downloadCurrent} disabled={downloading} style={{ padding: 8 }}>
                  {downloading ? (
                    <LoadingBrand size="small" color="#fff" />
                  ) : (
                    <Ionicons name={downloadDone ? 'checkmark-circle' : 'download-outline'} size={24} color={downloadDone ? '#30D158' : '#fff'} />
                  )}
                </TouchableOpacity>
              </View>
            </View>
          </LinearGradient>

          {/* Caption edit overlay */}
          {editingCaption && (
            <KeyboardAvoidingView
              behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
              style={styles.captionEditOverlay}
            >
              <View style={styles.captionEditBox}>
                <Text style={styles.captionEditLabel}>Caption</Text>
                <TextInput
                  style={styles.captionEditInput}
                  value={captionDraft}
                  onChangeText={setCaptionDraft}
                  maxLength={150}
                  placeholder="Add a caption…"
                  placeholderTextColor="#555"
                  autoFocus
                  multiline={false}
                  returnKeyType="done"
                  onSubmitEditing={saveCaption}
                />
                <Text style={styles.captionEditCount}>{captionDraft.length}/150</Text>
                <View style={styles.captionEditBtns}>
                  <TouchableOpacity style={styles.captionEditCancel} onPress={() => setEditingCaption(false)}>
                    <Text style={styles.captionEditCancelText}>Cancel</Text>
                  </TouchableOpacity>
                  <TouchableOpacity style={styles.captionEditSave} onPress={saveCaption}>
                    <Text style={styles.captionEditSaveText}>Save</Text>
                  </TouchableOpacity>
                </View>
              </View>
            </KeyboardAvoidingView>
          )}

          <ReportModal
            visible={showReport}
            targetType="media"
            targetId={items[currentIndex]?.id ?? ''}
            capsuleId={capsuleId}
            onClose={() => setShowReport(false)}
          />
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
      <SafeAreaProvider>
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
          initialNumToRender={15}
          maxToRenderPerBatch={12}
          windowSize={5}
          getItemLayout={(_, index) => ({
            length: thumbSize,
            offset: thumbSize * Math.floor(index / 3),
            index,
          })}
          renderItem={({ item, index }) => (
            <TouchableOpacity
              style={[gal.thumb, { width: thumbSize, height: thumbSize }]}
              onPress={() => { onClose(); onSelect(index); }}
              activeOpacity={0.8}
            >
              {(item.mediaType === 'photo' || item.thumbnailUri) && (
                <Image
                  source={{
                    uri: item.mediaType === 'video' ? item.thumbnailUri : (item.thumbSignedUrl ?? item.signedUrl),
                    // Stable cacheKey — same rationale as the viewer above.
                    cacheKey: item.mediaType === 'video' ? undefined : item.storage_key,
                  }}
                  recyclingKey={item.id}
                  style={StyleSheet.absoluteFill}
                  contentFit="cover"
                  transition={150}
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
      </SafeAreaProvider>
    </Modal>
  );
}

function CheckInCard({ capsuleId, accentColor, dateGate, onUnlocked }: {
  capsuleId: string;
  accentColor: string;
  dateGate: boolean;
  onUnlocked: () => void;
}) {
  const [busy, setBusy] = useState(false);
  const [progress, setProgress] = useState<{ checkedIn: number; total: number; inRange: boolean } | null>(null);
  const [error, setError] = useState('');

  async function handleCheckIn() {
    setError('');
    setBusy(true);
    try {
      const { status } = await Location.requestForegroundPermissionsAsync();
      if (status !== 'granted') {
        setError('Location permission is needed to check in.');
        return;
      }
      const pos = await Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.High });
      const { data, error: rpcErr } = await supabase.rpc('check_in', {
        p_capsule_id: capsuleId,
        p_lat: pos.coords.latitude,
        p_lng: pos.coords.longitude,
      });
      if (rpcErr || !data) { setError('Check-in failed. Please try again.'); return; }
      const r = data as { unlocked: boolean; checked_in: number; total: number; within_range: boolean };
      setProgress({ checkedIn: r.checked_in, total: r.total, inRange: r.within_range });
      if (r.unlocked) onUnlocked();
    } catch {
      setError('Could not get your location. Make sure location services are on.');
    } finally {
      setBusy(false);
    }
  }

  const allHere = progress && progress.checkedIn === progress.total;

  return (
    <View style={chk.card}>
      <Ionicons name="location-outline" size={30} color={accentColor} />
      <View style={chk.titleRow}>
        <Text style={chk.title}>Unlocks when everyone's together</Text>
        <InfoTooltip
          title="Proximity Unlock"
          body={"Everyone needs to tap 'Check In' while within about 100 meters of each other.\n\nCheck-ins expire after 10 minutes, so make sure everyone taps around the same time.\n\nThe capsule opens automatically once all joined members have checked in and are in range."}
          size={17}
          color="#555555"
        />
      </View>
      <Text style={chk.sub}>
        {progress
          ? `${progress.checkedIn} of ${progress.total} ${progress.total === 1 ? 'member' : 'members'} here`
          : 'Tap below to share your location with the group.'}
      </Text>
      {allHere && !progress!.inRange ? (
        <Text style={chk.hint}>Everyone's checked in, but you're too far apart.</Text>
      ) : null}
      {dateGate ? <Text style={chk.hint}>Also waiting on the unlock date.</Text> : null}
      {error ? <Text style={chk.error}>{error}</Text> : null}
      <TouchableOpacity
        style={[chk.btn, { backgroundColor: accentColor }]}
        onPress={handleCheckIn}
        disabled={busy}
      >
        {busy
          ? <LoadingBrand size="small" color="#FFFFFF" />
          : <Text style={chk.btnText}>We're here — check in</Text>}
      </TouchableOpacity>
    </View>
  );
}

const chk = StyleSheet.create({
  card: {
    backgroundColor: '#1A1A1A',
    borderRadius: 16,
    borderWidth: 1,
    borderColor: '#2A2A2A',
    padding: 24,
    alignItems: 'center',
    gap: 8,
  },
  titleRow: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  title: { fontSize: 17, fontWeight: '700', color: '#FFFFFF', textAlign: 'center' },
  sub: { fontSize: 14, color: '#888888', textAlign: 'center' },
  hint: { fontSize: 13, color: '#888888', textAlign: 'center' },
  error: { fontSize: 13, color: '#FF3B30', textAlign: 'center' },
  btn: {
    marginTop: 8,
    alignSelf: 'stretch',
    borderRadius: 14,
    paddingVertical: 16,
    alignItems: 'center',
  },
  btnText: { color: '#FFFFFF', fontWeight: '700', fontSize: 16 },
});

export default function CapsuleDetailScreen({ route, navigation }: Props) {
  const { accentColor } = useTheme();
  const { capsuleId } = route.params;
  const [capsule, setCapsule] = useState<Capsule | null>(null);
  const [members, setMembers] = useState<MemberRow[]>([]);
  const [photos, setPhotos] = useState<MediaItem[]>([]);
  const [mediaCount, setMediaCount] = useState(0);
  const [activeMediaIndex, setActiveMediaIndex] = useState<number | null>(null);
  const [showGallery, setShowGallery] = useState(false);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const { timedOut, reset: resetTimeout } = useLoadingTimeout(loading);

  async function onRefresh() {
    setRefreshing(true);
    // force=true — pull-to-refresh must see other members' uploads too,
    // which our own cache.invalidate calls wouldn't know about.
    await Promise.all([load(), fetchPhotos(true)]);
    setRefreshing(false);
  }
  const [error, setError] = useState('');
  const [currentUserId, setCurrentUserId] = useState('');
  const [showInvite, setShowInvite] = useState(false);
  const [showMembersSheet, setShowMembersSheet] = useState(false);
  // Decoupled from showMembersSheet so the swipe-down-to-close animation can
  // finish playing before the Modal actually unmounts — mirrors
  // SuggestCategoryModal's visible/mounted split. animationType is 'none'
  // (not the Modal's built-in 'slide') because we drive the whole open/close
  // transform ourselves via membersSheetTranslateY, so a mid-drag position can
  // continue smoothly into the close animation instead of snapping first.
  const [membersSheetMounted, setMembersSheetMounted] = useState(false);
  // A persistent (component-lifetime) useRef value, unlike MediaViewerModal's
  // which remounts fresh every open — so every animation touching it MUST use
  // useNativeDriver: false. React Native's native driver permanently latches a
  // value the first time useNativeDriver:true runs on it; a later JS-driven
  // .setValue() (our drag) on a native-latched value silently stops updating.
  // Mixing drivers on a value that's only ever created once would work on the
  // first open/close cycle and then regress on the second.
  const membersSheetTranslateY = useRef(new Animated.Value(SCREEN_HEIGHT)).current;
  useEffect(() => {
    if (showMembersSheet) {
      setMembersSheetMounted(true);
      membersSheetTranslateY.setValue(SCREEN_HEIGHT);
      Animated.timing(membersSheetTranslateY, { toValue: 0, duration: 260, useNativeDriver: false }).start();
    } else if (membersSheetMounted) {
      Animated.timing(membersSheetTranslateY, { toValue: SCREEN_HEIGHT, duration: 220, useNativeDriver: false })
        .start(() => setMembersSheetMounted(false));
    }
    // membersSheetMounted intentionally omitted — including it would re-fire
    // this effect right after the close animation's own setMembersSheetMounted(false).
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [showMembersSheet]);
  // Scroll position of the member list, tracked via a ref (not state) so
  // reading it inside the PanResponder callbacks never triggers a re-render.
  const membersScrollY = useRef(0);
  // Swipe-down-to-dismiss, attached to the whole sheet (see the outer
  // Animated.View below) so a downward drag anywhere on it — handle, header,
  // or over the member rows — dismisses it, matching MediaViewerModal.
  //
  // The member list is a vertical ScrollView, so dismiss and scroll share the
  // same axis and can't be split by direction alone (unlike PreviewScreen's
  // outer-vertical vs inner-horizontal swipe). Instead we only claim the
  // gesture for a downward drag once the list is already scrolled to the top —
  // mirroring native iOS overscroll-to-dismiss.
  //
  // We use the *capture* move variant, not the bubble-phase
  // onMoveShouldSetPanResponder: capture is evaluated top-down before the
  // touch reaches the ScrollView's own native scroll recognizer, which is
  // necessary to win against it once it's already scrolling — a bubble-phase
  // callback is asked too late. onStartShouldSetPanResponder stays false (no
  // capture variant is set either) so a stationary touch is never
  // intercepted — only real movement past the threshold escalates into this
  // responder, which is what lets a plain tap still reach the nested close
  // (X) button and each member row's TouchableOpacity.
  const membersSheetPanResponder = useRef(
    PanResponder.create({
      onStartShouldSetPanResponder: () => false,
      onMoveShouldSetPanResponderCapture: (_, g) =>
        membersScrollY.current <= 0 && g.dy > 4 && g.dy > Math.abs(g.dx),
      onPanResponderMove: (_, g) => {
        if (g.dy > 0) membersSheetTranslateY.setValue(g.dy);
      },
      onPanResponderRelease: (_, g) => {
        if (g.dy > 120 || g.vy > 1.5) {
          setShowMembersSheet(false);
        } else {
          Animated.spring(membersSheetTranslateY, { toValue: 0, useNativeDriver: false, bounciness: 6 }).start();
        }
      },
      // Once a dismiss drag is underway, don't let the ScrollView reclaim the
      // responder mid-gesture.
      onPanResponderTerminationRequest: () => false,
    })
  ).current;
  // Optimistic uploads: the background queue owns all upload state. Pending
  // items render as local-URI tiles in the grid; this screen just reflects
  // the queue.
  const uploadTasks = useUploadTasks(capsuleId);
  const uploading = uploadTasks.some(t => t.status === 'uploading');
  const uploadProgress = uploadQueue.getProgress(capsuleId);
  const prevTaskCountRef = useRef(0);
  const [showPickerOptions, setShowPickerOptions] = useState(false);
  const [uploadError, setUploadError] = useState('');
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const heroAnim = useFadeIn(0, 300);

  // Re-filter media when the user's block list changes (e.g. after blocking
  // someone on their profile and returning here). Skips the initial run.
  const blockedIds = useBlockedUsers();
  const firstBlockRun = useRef(true);
  useEffect(() => {
    if (firstBlockRun.current) { firstBlockRun.current = false; return; }
    fetchPhotos();
  }, [blockedIds]);

  async function confirmDelete() {
    setDeleting(true);
    const { data: mediaRows } = await supabase
      .from('media').select('storage_key, thumbnail_key').eq('capsule_id', capsuleId);
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

  async function fetchPhotos(force = false) {
    // True count even when RLS hides the rows (surprise-mode capsules
    // lock the owner out of reading media until unlock).
    supabase
      .rpc('capsule_media_count', { p_capsule_id: capsuleId })
      .then(({ data }) => { if (typeof data === 'number') setMediaCount(data); });

    // Cache the media row list itself (not just the signed URLs derived from
    // it) so a cache hit skips the DB read entirely. Short TTL since new
    // uploads should show up reasonably fast; force=true (pull-to-refresh)
    // always bypasses it, since another member's upload wouldn't trigger our
    // local cache.invalidate.
    const mediaCacheKey = `media:${capsuleId}`;
    const MEDIA_TTL = 3 * 60 * 1000;
    let mediaData = force ? null : cache.get<any[]>(mediaCacheKey, MEDIA_TTL);
    if (!mediaData) {
      const { data } = await supabase
        .from('media')
        .select('id, storage_key, alt_storage_key, uploader_id, uploaded_at, media_type, caption')
        .eq('capsule_id', capsuleId)
        .order('uploaded_at', { ascending: false });
      mediaData = data ?? [];
      cache.set(mediaCacheKey, mediaData);
    }

    if (!mediaData || mediaData.length === 0) { setPhotos([]); return; }

    // Hide media uploaded by users this person has blocked.
    const visibleMedia = mediaData.filter((m: any) => !blockStore.has(m.uploader_id));
    if (visibleMedia.length === 0) { setPhotos([]); return; }

    // Reuse cached signed URLs (valid 1 hour; cache TTL 50 min).
    // Batch main + alt keys in one call to halve round-trips.
    const urlCacheKey = `signedUrls:${capsuleId}`;
    const URL_TTL = 50 * 60 * 1000;
    const mainKeys = visibleMedia.map((m: any) => m.storage_key as string);
    const altKeys = visibleMedia.map((m: any) => m.alt_storage_key as string | null).filter(Boolean) as string[];
    const allKeysToSign = [...mainKeys, ...altKeys];

    let signedUrlMap = cache.get<Record<string, string>>(urlCacheKey, URL_TTL);
    if (!signedUrlMap || allKeysToSign.some(k => !signedUrlMap![k])) {
      const { data: signedData } = await supabase.storage
        .from('capsule-media')
        .createSignedUrls(allKeysToSign, 3600);
      signedUrlMap = {};
      allKeysToSign.forEach((k, i) => {
        const u = signedData?.[i]?.signedUrl;
        if (u) signedUrlMap![k] = u;
      });
      cache.set(urlCacheKey, signedUrlMap);
    }

    const items: MediaItem[] = visibleMedia.map((m: any) => {
      const signedUrl = signedUrlMap![m.storage_key] ?? '';
      return {
        id: m.id,
        storage_key: m.storage_key,
        uploader_id: m.uploader_id,
        uploaded_at: m.uploaded_at,
        mediaType: m.media_type,
        signedUrl,
        // Derived from the already-signed URL — no extra signing round-trip.
        thumbSignedUrl: m.media_type === 'photo' ? (transformMediaUrl(signedUrl, GRID_THUMB_PX) ?? undefined) : undefined,
        altSignedUrl: m.alt_storage_key ? signedUrlMap![m.alt_storage_key] : undefined,
        altStorageKey: m.alt_storage_key ?? undefined,
        caption: m.caption ?? null,
      };
    });

    setPhotos(items);

    // Generate thumbnails for videos in background — memoized per media id so
    // re-entering the screen within the same app session doesn't re-decode
    // every video to grab a frame again.
    if (Platform.OS !== 'web') {
      for (const item of items) {
        if (item.mediaType === 'video' && item.signedUrl) {
          const thumbCacheKey = `videoThumb:${item.id}`;
          // Longer TTL than the default 15min — the generated frame is a
          // local file with no server-side expiry, only OS temp-dir cleanup
          // risk over a long session.
          const cachedThumb = cache.get<string>(thumbCacheKey, 6 * 60 * 60 * 1000);
          if (cachedThumb) {
            setPhotos(prev => prev.map(p => p.id === item.id ? { ...p, thumbnailUri: cachedThumb } : p));
            continue;
          }
          VideoThumbnails.getThumbnailAsync(item.signedUrl, { time: 0 })
            .then(({ uri }) => {
              cache.set(thumbCacheKey, uri);
              setPhotos(prev => prev.map(p => p.id === item.id ? { ...p, thumbnailUri: uri } : p));
            })
            .catch(() => {});
        }
      }
    }
  }

  async function load() {
    setCurrentUserId(sessionStore.get()?.user.id ?? '');

    // fetchPhotos() only needs capsuleId — it has no dependency on the
    // capsule/members result, so run it in the same wave instead of
    // awaiting it afterward.
    const [capsuleRes, membersRes] = await Promise.all([
      supabase.from('capsules').select('id, owner_id, title, description, status, unlock_at, unlock_mode, owner_preview_locked, contribution_lock_at, created_at, archived_at, superlative_voting_closes_at, superlative_voting_finalized_at').eq('id', capsuleId).single(),
      supabase
        .from('capsule_members')
        .select('user_id, role, joined_at, users(display_name, avatar_url)')
        .eq('capsule_id', capsuleId),
      fetchPhotos(),
    ]);

    if (capsuleRes.error) {
      setError('Failed to load capsule.');
    } else {
      setCapsule(capsuleRes.data as Capsule);
    }

    if (membersRes.data) setMembers(membersRes.data as MemberRow[]);

    cache.set(`capsule:${capsuleId}`, {
      capsule: capsuleRes.data,
      members: membersRes.data,
    });
  }

  useEffect(() => {
    setCurrentUserId(sessionStore.get()?.user.id ?? '');
    const userId = sessionStore.get()?.user.id;
    const cached = cache.get<{ capsule: any; members: any }>(`capsule:${capsuleId}`);
    if (cached) {
      if (cached.capsule) setCapsule(cached.capsule);
      if (cached.members) setMembers(cached.members as MemberRow[]);
      setLoading(false);
      load();
      // Warm cache: lock status is known synchronously — skip the prefetch
      // entirely if Awards won't even render for this capsule.
      if (cached.capsule?.status === 'unlocked') {
        fetchAwardsData(capsuleId, userId).catch(() => {});
      }
    } else {
      load().finally(() => setLoading(false));
      // Cold cache: fire Awards' own fetch at t0, in parallel with load(),
      // instead of letting AwardsSection only start it once it finally
      // mounts behind the loading gate above — that stacking is why Awards
      // always took much longer than everything else. Lock status isn't
      // knowable yet here, so this fires speculatively; the underlying
      // queries are cheap (~2ms) and harmless if the capsule turns out
      // locked. Not awaited — must not extend how long the skeleton shows.
      fetchAwardsData(capsuleId, userId).catch(() => {});
    }
  }, [capsuleId]);

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
            // Pre-unlock, surprise-mode owners couldn't read media rows at
            // all (RLS), so a cached "empty" media list must not survive
            // past unlock.
            cache.invalidate(`signedUrls:${capsuleId}`, `media:${capsuleId}`);
            fetchPhotos();
          }
        }
      )
      .subscribe();

    return () => { supabase.removeChannel(channel); };
  }, [capsuleId]);

  // Optimistic: enqueue and return immediately — the picked photos appear in
  // the grid as pending tiles at once, upload in the background, and the
  // task-count effect below refetches as each one lands. Failures stay as
  // retryable tiles (rollback = dismiss).
  function uploadPhotos(assets: ImagePicker.ImagePickerAsset[]) {
    setUploadError('');
    uploadQueue.enqueue(
      assets.map(asset => ({
        capsuleId,
        uri: asset.uri,
        mediaType: 'photo' as const,
        mimeType: asset.mimeType ?? 'image/jpeg',
      }))
    );
    setShowPickerOptions(false);
  }

  // A queue task finishing (success removes it; dismiss too) means there may
  // be a fresh media row — the queue already invalidated this capsule's
  // caches, so fetchPhotos reads through to the DB.
  useEffect(() => {
    if (uploadTasks.length < prevTaskCountRef.current) {
      fetchPhotos();
    }
    prevTaskCountRef.current = uploadTasks.length;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [uploadTasks.length]);

  async function pickFromLibrary() {
    // No permission prompt: launchImageLibraryAsync uses the iOS PHPicker (and the
    // Android Photo Picker), which run out-of-process and return only the items the
    // user explicitly selects — so no library-access dialog is required. Requesting
    // permission first just added a slow, confusing prompt that made it look like you
    // couldn't add photos. (Matches the avatar pickers in Onboarding/Profile.)
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
    if (timedOut) {
      return (
        <SafeAreaView style={styles.container}>
          <TouchableOpacity style={styles.topBar} onPress={() => navigation.goBack()}>
            <Text style={[styles.backText, { color: accentColor }]}>← Back</Text>
          </TouchableOpacity>
          <RetryPrompt onRetry={() => { resetTimeout(); load().finally(() => setLoading(false)); }} />
        </SafeAreaView>
      );
    }
    return (
      <SafeAreaView style={styles.container}>
        <View style={styles.topBar}>
          <SkeletonBox width={60} height={16} borderRadius={6} />
        </View>
        <ScrollView contentContainerStyle={styles.scroll} showsVerticalScrollIndicator={false}>
          {/* Hero */}
          <View style={{ alignItems: 'center', gap: 10, marginBottom: 8 }}>
            <SkeletonBox width={40} height={40} borderRadius={10} />
            <SkeletonBox width={70} height={22} borderRadius={10} />
          </View>
          {/* Title + description */}
          <SkeletonBox width="65%" height={22} borderRadius={8} style={{ alignSelf: 'center' }} />
          <SkeletonText lines={2} lineHeight={14} gap={8} style={{ marginTop: 8, paddingHorizontal: 24 }} />
          {/* Countdown ring placeholder */}
          <View style={{ alignItems: 'center', marginVertical: 20 }}>
            <SkeletonCircle size={160} />
          </View>
          {/* Members section */}
          <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
            <SkeletonBox width={80} height={14} borderRadius={6} />
          </View>
          <SkeletonMemberRow />
          <SkeletonMemberRow />
          {/* Media section */}
          <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginTop: 16, marginBottom: 8 }}>
            <SkeletonBox width={60} height={14} borderRadius={6} />
          </View>
          <SkeletonMediaGrid count={3} />
        </ScrollView>
      </SafeAreaView>
    );
  }

  if (error || !capsule) {
    return (
      <SafeAreaView style={styles.container}>
        <TouchableOpacity style={styles.topBar} onPress={() => navigation.goBack()}>
          <Text style={[styles.backText, { color: accentColor }]}>← Back</Text>
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
  const myMember = members.find(m => m.user_id === currentUserId);
  const myRole = myMember?.role ?? null;
  // Any joined member can archive/restore (not just the owner) — pending
  // invitees (joined_at null) can't, matching set_capsule_archived's own check.
  const canArchive = isOwner || myMember?.joined_at != null;
  // Surprise mode: even the owner is locked out of previewing until unlock.
  const canSeePhotos = !isLocked || (isOwner && !capsule.owner_preview_locked);
  const contributionLocked = capsule.contribution_lock_at
    ? new Date(capsule.contribution_lock_at) <= new Date()
    : false;
  const canUpload = isOwner || (myRole === 'contributor' && !contributionLocked);
  const existingMemberIds = members.map(m => m.user_id);

  return (
    <SafeAreaView style={styles.container}>
      <View style={styles.topBar}>
        <TouchableOpacity onPress={() => navigation.goBack()}>
          <Text style={[styles.backText, { color: accentColor }]}>← Back</Text>
        </TouchableOpacity>
        {isOwner && isLocked && (
          <TouchableOpacity
            style={styles.editBtn}
            onPress={() => navigation.navigate('EditCapsule', { capsuleId: capsule.id })}
          >
            <Ionicons name="pencil-outline" size={18} color={accentColor} />
            <Text style={[styles.editBtnText, { color: accentColor }]}>Edit</Text>
          </TouchableOpacity>
        )}
      </View>

      <ScrollView
        contentContainerStyle={styles.scroll}
        showsVerticalScrollIndicator={false}
        refreshControl={
          <RefreshControl
            refreshing={refreshing}
            onRefresh={onRefresh}
            tintColor={accentColor}
          />
        }
      >
        <Animated.View style={heroAnim}>
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
        </Animated.View>

        {isLocked ? (
          <>
            {capsule.unlock_mode !== 'proximity' && (
              <CountdownRing unlockAt={capsule.unlock_at} createdAt={(capsule as any).created_at} />
            )}
            {capsule.unlock_mode !== 'time' && (
              <CheckInCard
                capsuleId={capsuleId}
                accentColor={accentColor}
                dateGate={capsule.unlock_mode === 'both' && new Date(capsule.unlock_at) > new Date()}
                onUnlocked={load}
              />
            )}
          </>
        ) : (
          <View style={styles.timeCard}>
            <Text style={styles.timeLabel}>Unlocked</Text>
            <Text style={styles.timeDate}>{unlockDate} at {unlockTime}</Text>
          </View>
        )}

        {/* Pre-unlock default-awards management. AwardsSection itself only
            renders post-unlock (defaults become ordinary live categories
            there), so this is the owner's one chance to review/regenerate
            them — the RPC refuses changes once status flips to 'unlocked'. */}
        {isOwner && isLocked && (
          <DefaultAwardsCard
            mode="manage"
            capsuleId={capsule.id}
            occasion={capsule.occasion}
          />
        )}

        {/* Members */}
        <View style={styles.sectionRow}>
          <Text style={styles.sectionTitle}>Members</Text>
          {isOwner && (
            <View style={styles.memberActions}>
              <TouchableOpacity
                style={styles.manageBtn}
                onPress={() => navigation.navigate('ManageMembers', { capsuleId })}
              >
                <Text style={styles.manageBtnText}>Manage</Text>
              </TouchableOpacity>
              <TouchableOpacity style={[styles.inviteBtn, { backgroundColor: `${accentColor}20` }]} onPress={() => setShowInvite(true)}>
                <Text style={[styles.inviteBtnText, { color: accentColor }]}>+ Invite</Text>
              </TouchableOpacity>
            </View>
          )}
        </View>

        {/* Compact avatar cluster — tap to see full list */}
        <TouchableOpacity
          style={styles.memberCluster}
          activeOpacity={0.7}
          onPress={() => setShowMembersSheet(true)}
        >
          <View style={styles.memberAvatarRow}>
            {members.slice(0, 5).map((m, i) => (
              <View
                key={i}
                style={[
                  styles.memberBubbleWrap,
                  { zIndex: 5 - i },
                  m.joined_at === null && styles.memberBubblePending,
                ]}
              >
                <Avatar
                  url={m.users?.avatar_url ?? null}
                  name={m.users?.display_name ?? '?'}
                  size={34}
                />
              </View>
            ))}
            {members.length > 5 && (
              <View style={[styles.memberBubbleWrap, styles.memberOverflow]}>
                <Text style={styles.memberOverflowText}>+{members.length - 5}</Text>
              </View>
            )}
          </View>
          <Text style={styles.memberCountLabel}>
            {members.length} {members.length === 1 ? 'member' : 'members'}
          </Text>
        </TouchableOpacity>

        {/* Media */}
        <View style={styles.sectionRow}>
          <Text style={styles.sectionTitle}>Media</Text>
          {photos.length > 0 && canSeePhotos && (
            <Text style={styles.photoCount}>{photos.length}</Text>
          )}
        </View>

        {canSeePhotos && uploadTasks.length > 0 && (
          <View style={styles.pendingGrid}>
            {uploadTasks.map(t => (
              <View key={t.id} style={styles.pendingThumb}>
                {t.mediaType === 'photo' ? (
                  <Image source={t.uri} style={StyleSheet.absoluteFill} contentFit="cover" />
                ) : (
                  <View style={[StyleSheet.absoluteFill, styles.pendingVideoBg]}>
                    <Ionicons name="videocam" size={20} color="#666666" />
                  </View>
                )}
                {t.status === 'uploading' ? (
                  <View style={styles.pendingOverlay}>
                    <LoadingBrand size="small" color="#FFFFFF" />
                  </View>
                ) : (
                  <View style={[styles.pendingOverlay, styles.failedOverlay]}>
                    <TouchableOpacity
                      style={styles.failedRetry}
                      onPress={() => uploadQueue.retry(t.id)}
                      hitSlop={6}
                    >
                      <Ionicons name="refresh" size={18} color="#FFFFFF" />
                      <Text style={styles.failedRetryText}>Retry</Text>
                    </TouchableOpacity>
                    <TouchableOpacity
                      style={styles.failedDismiss}
                      onPress={() => uploadQueue.dismiss(t.id)}
                      hitSlop={8}
                    >
                      <Ionicons name="close" size={13} color="#FFFFFF" />
                    </TouchableOpacity>
                  </View>
                )}
              </View>
            ))}
          </View>
        )}

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
                          source={{
                            uri: p.mediaType === 'video' ? p.thumbnailUri : (p.thumbSignedUrl ?? p.signedUrl),
                            cacheKey: p.mediaType === 'video' ? undefined : p.storage_key,
                          }}
                          style={StyleSheet.absoluteFill}
                          contentFit="cover"
                          transition={200}
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
                  <Text style={[styles.viewAllText, { color: accentColor }]}>See all {photos.length}</Text>
                </TouchableOpacity>
              )}
            </>
          ) : uploadTasks.length === 0 ? (
            <View style={styles.emptyPhotos}>
              <Ionicons name="camera-outline" size={32} color="#555555" />
              <Text style={styles.emptyPhotosText}>No media yet</Text>
            </View>
          ) : null
        ) : (
          <View style={styles.lockedBox}>
            <Ionicons name="lock-closed-outline" size={32} color="#555555" />
            <Text style={styles.lockedText}>Media reveals on {unlockDate}</Text>
            {isOwner && capsule.owner_preview_locked && (
              <Text style={styles.lockedHint}>Hidden from you too — you chose to keep it a surprise.</Text>
            )}
            {mediaCount > 0 && (
              <Text style={[styles.lockedCount, { color: accentColor }]}>{mediaCount} {mediaCount === 1 ? 'memory' : 'memories'} waiting</Text>
            )}
            {uploadTasks.length > 0 && (
              <Text style={styles.lockedUploading}>
                {uploadTasks.length} uploading…
              </Text>
            )}
          </View>
        )}

        {/* Upload controls */}
        {canUpload && (
          <View style={styles.uploadArea}>
            {uploadError ? <Text style={styles.uploadError}>{uploadError}</Text> : null}

            {uploading ? (
              <View style={styles.uploadingCol}>
                <View style={styles.uploadingRow}>
                  <LoadingBrand size="medium" color={accentColor} />
                  <Text style={styles.uploadingText}>
                    Uploading {uploadProgress.done}/{uploadProgress.total}…
                  </Text>
                </View>
                <ProgressBar
                  progress={uploadProgress.total > 0 ? uploadProgress.done / uploadProgress.total : 0}
                  color={accentColor}
                />
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
                style={[styles.addPhotoBtn, { backgroundColor: accentColor }]}
                onPress={() => { setUploadError(''); setShowPickerOptions(true); }}
              >
                <Text style={styles.addPhotoBtnText}>+ Add Photos</Text>
              </TouchableOpacity>
            )}
          </View>
        )}

        {!isLocked && (
          <AwardsSection
            capsuleId={capsuleId}
            joinedMemberCount={members.filter(m => m.joined_at !== null).length}
            members={members
              .filter(m => m.joined_at !== null && m.users !== null)
              .map(m => ({
                user_id: m.user_id,
                display_name: m.users?.display_name ?? 'Member',
                avatar_url: m.users?.avatar_url ?? null,
              }))}
            media={photos.map(p => ({
              id: p.id,
              mediaType: p.mediaType,
              signedUrl: p.signedUrl,
              thumbSignedUrl: p.thumbSignedUrl,
              thumbnailUri: p.thumbnailUri,
            }))}
            votingClosesAt={(capsule as any).superlative_voting_closes_at ?? null}
            votingFinalizedAt={(capsule as any).superlative_voting_finalized_at ?? null}
          />
        )}

        {canArchive && (
          <View style={styles.dangerZone}>
            <Text style={styles.dangerLabel}>Danger Zone</Text>
            <TouchableOpacity
              style={styles.archiveBtn}
              onPress={() => {
                // Optimistic: leave immediately, archive in the background.
                // On failure the global toast reaches the user on Home.
                const isArchived = !!(capsule as any).archived_at;
                haptics.light();
                navigation.reset({ index: 0, routes: [{ name: 'Tabs' }] });
                supabase.rpc('set_capsule_archived', {
                  p_capsule_id: capsuleId,
                  p_archived: !isArchived,
                }).then(({ error }) => {
                  if (error) {
                    toast.show(isArchived
                      ? "Couldn't restore the capsule — try again."
                      : "Couldn't archive the capsule — try again.");
                  } else {
                    cache.invalidate('capsules', 'profile');
                  }
                });
              }}
            >
              <Ionicons name="archive-outline" size={18} color="#888888" />
              <Text style={styles.archiveBtnText}>
                {(capsule as any).archived_at ? 'Restore Capsule' : 'Archive Capsule'}
              </Text>
            </TouchableOpacity>
            {isOwner && (
              <TouchableOpacity
                style={styles.deleteBtn}
                onPress={() => setShowDeleteConfirm(true)}
              >
                <Ionicons name="trash-outline" size={18} color="#FF3B30" />
                <Text style={styles.deleteBtnText}>Delete Capsule</Text>
              </TouchableOpacity>
            )}
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
          capsuleId={capsuleId}
          currentUserId={currentUserId}
          onClose={() => setActiveMediaIndex(null)}
          onCaptionSave={(itemId, caption) => {
            setPhotos(prev => prev.map(p => p.id === itemId ? { ...p, caption } : p));
          }}
        />
      )}

      {/* Members bottom sheet */}
      {membersSheetMounted && (
      <Modal
        visible={membersSheetMounted}
        transparent
        animationType="none"
        onRequestClose={() => setShowMembersSheet(false)}
      >
        <SafeAreaProvider>
          <TouchableOpacity
            style={styles.sheetBackdrop}
            activeOpacity={1}
            onPress={() => setShowMembersSheet(false)}
          />
          <Animated.View
            style={[styles.sheetContainer, { transform: [{ translateY: membersSheetTranslateY }] }]}
            {...membersSheetPanResponder.panHandlers}
          >
          <SafeAreaView edges={['bottom']}>
            <View style={styles.sheetCard}>
              <View>
                <View style={styles.sheetHandle} />
                <View style={styles.sheetHeader}>
                  <Text style={styles.sheetTitle}>Members</Text>
                  <TouchableOpacity onPress={() => setShowMembersSheet(false)} hitSlop={8}>
                    <Ionicons name="close" size={22} color="#888888" />
                  </TouchableOpacity>
                </View>
              </View>
              <ScrollView
                showsVerticalScrollIndicator={false}
                scrollEventThrottle={16}
                onScroll={(e) => { membersScrollY.current = e.nativeEvent.contentOffset.y; }}
              >
                {members.map((m, i) => (
                  <TouchableOpacity
                    key={i}
                    style={styles.sheetMemberRow}
                    onPress={() => {
                      setShowMembersSheet(false);
                      navigation.navigate('PublicProfile', { userId: m.user_id });
                    }}
                  >
                    <View style={m.joined_at === null ? styles.sheetAvatarPending : undefined}>
                      <Avatar
                        url={m.users?.avatar_url ?? null}
                        name={m.users?.display_name ?? '?'}
                        size={40}
                      />
                    </View>
                    <View style={styles.memberInfo}>
                      <Text style={styles.memberName}>{m.users?.display_name ?? 'Member'}</Text>
                      {m.joined_at === null && <Text style={styles.pendingLabel}>pending invite</Text>}
                    </View>
                    <View style={styles.roleBadge}>
                      <Ionicons name={roleIonicon[m.role] ?? 'person-outline'} size={11} color="#888888" />
                      <Text style={styles.roleText}>{roleLabel[m.role]}</Text>
                    </View>
                  </TouchableOpacity>
                ))}
              </ScrollView>
            </View>
          </SafeAreaView>
          </Animated.View>
        </SafeAreaProvider>
      </Modal>
      )}

      {showInvite && (
        <InviteModal
          capsuleId={capsuleId}
          capsuleTitle={capsule?.title ?? ''}
          existingMemberIds={existingMemberIds}
          isOwner={isOwner}
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
  swapBubble: {
    position: 'absolute',
    top: 100,
    right: 20,
    width: 44,
    height: 44,
    borderRadius: 22,
    backgroundColor: 'rgba(0,0,0,0.55)',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.55)',
    alignItems: 'center',
    justifyContent: 'center',
  },
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
  memberActions: { flexDirection: 'row', gap: 8 },
  manageBtn: {
    backgroundColor: '#1A1A1A', borderRadius: 8,
    paddingHorizontal: 12, paddingVertical: 6,
    borderWidth: 1, borderColor: '#2A2A2A',
  },
  manageBtnText: { color: '#888888', fontWeight: '600', fontSize: 14 },
  inviteBtn: {
    backgroundColor: '#FF6B3520', borderRadius: 8,
    paddingHorizontal: 12, paddingVertical: 6,
  },
  inviteBtnText: { color: '#FF6B35', fontWeight: '700', fontSize: 14 },
  // Compact avatar cluster
  memberCluster: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  memberAvatarRow: { flexDirection: 'row', alignItems: 'center' },
  memberBubbleWrap: {
    marginRight: -10,
    borderRadius: 19,
    borderWidth: 2,
    borderColor: '#0A0A0A',
  },
  memberBubblePending: {
    opacity: 0.45,
    borderColor: '#555555',
    borderStyle: 'dashed',
  },
  memberOverflow: {
    width: 38, height: 38, borderRadius: 19,
    backgroundColor: '#2A2A2A',
    alignItems: 'center', justifyContent: 'center',
    borderColor: '#0A0A0A',
  },
  memberOverflowText: { fontSize: 11, fontWeight: '700', color: '#888888' },
  memberCountLabel: { fontSize: 14, color: '#666666', marginLeft: 18 },
  // Members bottom sheet
  sheetBackdrop: { flex: 1, backgroundColor: 'rgba(0,0,0,0.5)' },
  sheetContainer: { backgroundColor: '#1A1A1A', borderTopLeftRadius: 20, borderTopRightRadius: 20 },
  // paddingTop matters more than it looks: it's what makes the sheet's real
  // touchable/draggable area (the Animated.View that owns the swipe-to-close
  // PanResponder) start meaningfully above the tiny 4px handle pill. Without
  // it, a touch aimed at "the top of the sheet" easily lands a few px high on
  // the backdrop TouchableOpacity instead — a sibling, not an ancestor, of the
  // sheet, so the swipe gesture is never even asked and nothing happens.
  sheetCard: { paddingHorizontal: 20, paddingTop: 14, paddingBottom: 24, maxHeight: 480 },
  sheetHandle: { width: 36, height: 4, backgroundColor: '#3A3A3A', borderRadius: 2, alignSelf: 'center', marginTop: 10, marginBottom: 4 },
  sheetHeader: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingVertical: 14 },
  sheetTitle: { fontSize: 17, fontWeight: '700', color: '#FFFFFF' },
  sheetMemberRow: {
    flexDirection: 'row', alignItems: 'center',
    paddingVertical: 12, gap: 12,
    borderBottomWidth: 1, borderBottomColor: '#2A2A2A',
  },
  sheetAvatarPending: { opacity: 0.45 },
  // Kept for use in sheet
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
  lockedHint: { fontSize: 12, color: '#555555', textAlign: 'center', paddingHorizontal: 12 },
  lockedCount: { fontSize: 13, color: '#FF6B35', fontWeight: '600' },
  uploadArea: { gap: 10 },
  uploadingRow: { flexDirection: 'row', alignItems: 'center', gap: 10, paddingVertical: 4 },
  uploadingCol: { gap: 10, alignSelf: 'stretch' },
  // Optimistic upload tiles — fixed size (not flex thirds) so a row of 1–2
  // pending items doesn't balloon.
  pendingGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: 6 },
  pendingThumb: { width: 92, height: 92, borderRadius: 10, overflow: 'hidden', backgroundColor: '#1A1A1A' },
  pendingVideoBg: { alignItems: 'center', justifyContent: 'center', backgroundColor: '#141414' },
  pendingOverlay: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: 'rgba(0,0,0,0.45)',
    alignItems: 'center', justifyContent: 'center',
  },
  failedOverlay: { backgroundColor: 'rgba(0,0,0,0.65)', borderWidth: 1, borderColor: '#FF3B30', borderRadius: 10 },
  failedRetry: { alignItems: 'center', gap: 2 },
  failedRetryText: { color: '#FFFFFF', fontSize: 11, fontWeight: '700' },
  failedDismiss: {
    position: 'absolute', top: 4, right: 4,
    width: 20, height: 20, borderRadius: 10,
    backgroundColor: 'rgba(255,255,255,0.25)',
    alignItems: 'center', justifyContent: 'center',
  },
  lockedUploading: { color: '#888888', fontSize: 13, marginTop: 2 },
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
  captionBanner: {
    position: 'absolute', bottom: 140, left: 0, right: 0,
    paddingHorizontal: 24, paddingVertical: 10,
    backgroundColor: 'rgba(0,0,0,0.55)',
  },
  captionBannerText: { color: '#FFFFFF', fontSize: 15, lineHeight: 21, textAlign: 'center' },
  captionEditOverlay: {
    position: 'absolute', bottom: 0, left: 0, right: 0, zIndex: 20,
  },
  captionEditBox: {
    backgroundColor: '#1A1A1A', padding: 20, borderTopLeftRadius: 16, borderTopRightRadius: 16,
    borderTopWidth: 1, borderColor: '#2A2A2A', gap: 10,
  },
  captionEditLabel: { color: '#888888', fontSize: 13, fontWeight: '600' },
  captionEditInput: {
    backgroundColor: '#0A0A0A', borderRadius: 10, paddingHorizontal: 14, paddingVertical: 12,
    color: '#FFFFFF', fontSize: 15, borderWidth: 1, borderColor: '#2A2A2A',
  },
  captionEditCount: { color: '#555', fontSize: 12, textAlign: 'right' },
  captionEditBtns: { flexDirection: 'row', gap: 10 },
  captionEditCancel: {
    flex: 1, backgroundColor: '#2A2A2A', borderRadius: 12, paddingVertical: 12, alignItems: 'center',
  },
  captionEditCancelText: { color: '#888888', fontSize: 15, fontWeight: '600' },
  captionEditSave: {
    flex: 1, backgroundColor: '#FFFFFF', borderRadius: 12, paddingVertical: 12, alignItems: 'center',
  },
  captionEditSaveText: { color: '#0A0A0A', fontSize: 15, fontWeight: '700' },
});

const ms = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#0A0A0A' },
  header: {
    flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center',
    paddingHorizontal: 24, paddingTop: 20, paddingBottom: 16,
  },
  title: { fontSize: 22, fontWeight: '800', color: '#FFFFFF' },
  done: { fontSize: 16, fontWeight: '600', color: '#FF6B35' },
  tabs: {
    flexDirection: 'row', gap: 8, marginHorizontal: 24, marginBottom: 12,
    backgroundColor: '#1A1A1A', borderRadius: 12, padding: 4,
  },
  tab: { flex: 1, paddingVertical: 9, borderRadius: 9, alignItems: 'center' },
  tabText: { color: '#888888', fontWeight: '700', fontSize: 14 },
  tabTextActive: { color: '#FFFFFF' },
  emptyTab: { color: '#555555', fontSize: 14, textAlign: 'center', paddingVertical: 24, paddingHorizontal: 16 },
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
  qrToggleBtn: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center',
    gap: 7, marginHorizontal: 24, marginTop: 12, paddingVertical: 12,
  },
  qrToggleBtnText: { color: '#888888', fontSize: 14, fontWeight: '500' },
  qrOverlay: {
    position: 'absolute', inset: 0, backgroundColor: '#0A0A0A',
    alignItems: 'center', justifyContent: 'center', gap: 12,
    borderTopLeftRadius: 10, borderTopRightRadius: 10,
  },
  qrCloseBtn: {
    position: 'absolute', top: 20, left: 20,
    width: 40, height: 40, alignItems: 'center', justifyContent: 'center',
  },
  qrHeading: { fontSize: 22, fontWeight: '700', color: '#FFFFFF' },
  qrSub: { fontSize: 15, color: '#888888', marginBottom: 8 },
  qrBox: { backgroundColor: '#1A1A1A', borderRadius: 20, padding: 20, borderWidth: 1, borderColor: '#2A2A2A' },
  qrMsg: { fontSize: 13, color: '#30D158', fontWeight: '500' },
  qrActions: { flexDirection: 'row', gap: 12, marginTop: 8 },
  qrActionBtn: {
    flexDirection: 'row', alignItems: 'center', gap: 7,
    backgroundColor: '#1A1A1A', borderRadius: 12, paddingVertical: 12, paddingHorizontal: 18,
    borderWidth: 1, borderColor: '#2A2A2A',
  },
  qrActionText: { color: '#FFFFFF', fontSize: 14, fontWeight: '600' },
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
