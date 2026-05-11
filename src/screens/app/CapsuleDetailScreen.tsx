import React, { useEffect, useState, useRef } from 'react';
import {
  View, Text, StyleSheet, SafeAreaView, ScrollView,
  TouchableOpacity, ActivityIndicator, Modal, TextInput,
  Share, Image, Platform, Dimensions, Animated,
} from 'react-native';
import { NativeStackScreenProps } from '@react-navigation/native-stack';
import * as ImagePicker from 'expo-image-picker';
import * as FileSystem from 'expo-file-system/legacy';
import { supabase } from '../../lib/supabase';
import { randomUUID } from '../../lib/uuid';
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

type PhotoItem = {
  id: string;
  storage_key: string;
  uploader_id: string;
  uploaded_at: string;
  signedUrl: string;
};

const roleIcon: Record<string, string> = {
  owner: '👑',
  contributor: '✏️',
  viewer: '👁',
};

const roleLabel: Record<string, string> = {
  owner: 'Owner',
  contributor: 'Contributor',
  viewer: 'Viewer',
};

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
    await Share.share({ message: `Join my Capsule! Use this invite code: ${capsuleId}` });
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

export default function CapsuleDetailScreen({ route, navigation }: Props) {
  const { capsuleId } = route.params;
  const [capsule, setCapsule] = useState<Capsule | null>(null);
  const [members, setMembers] = useState<MemberRow[]>([]);
  const [photos, setPhotos] = useState<PhotoItem[]>([]);
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
      .select('id, storage_key, uploader_id, uploaded_at')
      .eq('capsule_id', capsuleId)
      .eq('media_type', 'photo')
      .order('uploaded_at', { ascending: false });

    if (!mediaData || mediaData.length === 0) { setPhotos([]); return; }

    const { data: signedData, error: signedErr } = await supabase.storage
      .from('capsule-media')
      .createSignedUrls(mediaData.map((m: any) => m.storage_key), 3600);




    setPhotos(mediaData.map((m: any, i: number) => ({
      id: m.id,
      storage_key: m.storage_key,
      uploader_id: m.uploader_id,
      uploaded_at: m.uploaded_at,
      signedUrl: signedData?.[i]?.signedUrl ?? '',
    })));
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
        <TouchableOpacity style={styles.backBtn} onPress={() => navigation.goBack()}>
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
      <TouchableOpacity style={styles.backBtn} onPress={() => navigation.goBack()}>
        <Text style={styles.backText}>← Back</Text>
      </TouchableOpacity>

      <ScrollView contentContainerStyle={styles.scroll} showsVerticalScrollIndicator={false}>
        <View style={styles.hero}>
          <Text style={styles.heroEmoji}>{isLocked ? '⏳' : '🔓'}</Text>
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

        <View style={styles.timeCard}>
          {isLocked && timeLeft ? (
            <>
              <Text style={styles.timeLabel}>Time remaining</Text>
              <Text style={styles.timeValue}>
                {timeLeft.days > 0 ? `${timeLeft.days}d ${timeLeft.hours}h` : `${timeLeft.hours}h`}
              </Text>
            </>
          ) : (
            <Text style={styles.timeLabel}>{isLocked ? 'Unlocking soon' : 'Unlocked'}</Text>
          )}
          <Text style={styles.timeDate}>{unlockDate} at {unlockTime}</Text>
        </View>

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
              <View style={styles.avatar}>
                <Text style={styles.avatarText}>
                  {(m.users?.display_name ?? '?')[0].toUpperCase()}
                </Text>
              </View>
              <View style={styles.memberInfo}>
                <Text style={styles.memberName}>{m.users?.display_name ?? 'Member'}</Text>
                {m.joined_at === null && <Text style={styles.pendingLabel}>pending</Text>}
              </View>
              <View style={styles.roleBadge}>
                <Text style={styles.roleText}>{roleIcon[m.role]} {roleLabel[m.role]}</Text>
              </View>
            </TouchableOpacity>
          ))}
        </View>

        {/* Photos */}
        <View style={styles.sectionRow}>
          <Text style={styles.sectionTitle}>Photos</Text>
          {photos.length > 0 && canSeePhotos && (
            <Text style={styles.photoCount}>{photos.length}</Text>
          )}
        </View>

        {canSeePhotos ? (
          photos.length > 0 ? (
            <View style={styles.photoGrid}>
              {photos.map(p => (
                <Image
                  key={p.id}
                  source={{ uri: p.signedUrl }}
                  style={styles.photoThumb}
                  resizeMode="cover"
                />
              ))}
            </View>
          ) : (
            <View style={styles.emptyPhotos}>
              <Text style={styles.emptyPhotosIcon}>📷</Text>
              <Text style={styles.emptyPhotosText}>No photos yet</Text>
            </View>
          )
        ) : (
          <View style={styles.lockedBox}>
            <Text style={styles.lockedIcon}>🔒</Text>
            <Text style={styles.lockedText}>Photos reveal on {unlockDate}</Text>
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
                    <Text style={styles.pickerBtnText}>📷  Take Photo</Text>
                  </TouchableOpacity>
                )}
                <TouchableOpacity style={styles.pickerBtn} onPress={pickFromLibrary}>
                  <Text style={styles.pickerBtnText}>🖼  Camera Roll</Text>
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
      </ScrollView>

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
          <Text style={styles.revealEmoji}>🔓</Text>
          <Text style={styles.revealTitle}>It's time!</Text>
          <Text style={styles.revealSub}>Your capsule is now open</Text>
        </Animated.View>
      )}
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#0A0A0A' },
  backBtn: { paddingHorizontal: 20, paddingTop: 12, paddingBottom: 4 },
  backText: { color: '#FF6B35', fontSize: 16, fontWeight: '600' },
  scroll: { paddingHorizontal: 24, paddingBottom: 48, gap: 16 },
  hero: { flexDirection: 'row', alignItems: 'center', gap: 12, marginTop: 8 },
  heroEmoji: { fontSize: 40 },
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
  timeValue: { fontSize: 32, fontWeight: '800', color: '#FF6B35' },
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
  avatar: {
    width: 36, height: 36, borderRadius: 18,
    backgroundColor: '#FF6B3530', justifyContent: 'center', alignItems: 'center',
  },
  avatarText: { fontSize: 16, fontWeight: '700', color: '#FF6B35' },
  memberInfo: { flex: 1 },
  memberName: { fontSize: 15, fontWeight: '600', color: '#FFFFFF' },
  pendingLabel: { fontSize: 11, color: '#888888', marginTop: 2 },
  roleBadge: { backgroundColor: '#2A2A2A', borderRadius: 6, paddingHorizontal: 8, paddingVertical: 3 },
  roleText: { fontSize: 12, color: '#888888' },
  photoGrid: { flexDirection: 'row', flexWrap: 'wrap' },
  photoThumb: { width: Dimensions.get('window').width / 3, height: Dimensions.get('window').width / 3 },
  emptyPhotos: {
    backgroundColor: '#1A1A1A', borderRadius: 16,
    padding: 32, alignItems: 'center', gap: 8,
    borderWidth: 1, borderColor: '#2A2A2A',
  },
  emptyPhotosIcon: { fontSize: 32 },
  emptyPhotosText: { fontSize: 15, color: '#555555' },
  lockedBox: {
    backgroundColor: '#1A1A1A', borderRadius: 16, padding: 32,
    alignItems: 'center', gap: 8, borderWidth: 1, borderColor: '#2A2A2A',
  },
  lockedIcon: { fontSize: 32 },
  lockedText: { fontSize: 15, color: '#888888', textAlign: 'center' },
  lockedCount: { fontSize: 13, color: '#FF6B35', fontWeight: '600' },
  uploadArea: { gap: 10 },
  uploadingRow: { flexDirection: 'row', alignItems: 'center', gap: 10, paddingVertical: 4 },
  uploadingText: { color: '#888888', fontSize: 15 },
  uploadError: { color: '#FF3B30', fontSize: 14 },
  pickerOptions: { gap: 10 },
  pickerBtn: {
    backgroundColor: '#1A1A1A', borderRadius: 14,
    paddingVertical: 16, alignItems: 'center',
    borderWidth: 1, borderColor: '#2A2A2A',
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
  revealOverlay: {
    position: 'absolute', top: 0, left: 0, right: 0, bottom: 0,
    backgroundColor: '#000000CC', justifyContent: 'center', alignItems: 'center', gap: 12,
  },
  revealEmoji: { fontSize: 64 },
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
