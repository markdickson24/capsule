import React, { useState } from 'react';
import {
  View, Text, StyleSheet, TouchableOpacity, Animated,
  TextInput, Modal, Platform,
  ScrollView, KeyboardAvoidingView, Pressable, RefreshControl,
} from 'react-native';
import { Image } from 'expo-image';
import { SafeAreaView, SafeAreaProvider } from 'react-native-safe-area-context';
import * as ImagePicker from 'expo-image-picker';
import * as ImageManipulator from 'expo-image-manipulator';
import * as FileSystem from 'expo-file-system/legacy';
import { useNavigation } from '@react-navigation/native';
import { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { Ionicons } from '@expo/vector-icons';
import { supabase, getFreshSession } from '../../lib/supabase';
import { transformAvatarUrl } from '../../lib/avatarUrl';
import { sessionStore } from '../../lib/sessionStore';
import { useTheme } from '../../context/ThemeContext';
import { AppStackParamList } from '../../types/navigation';
import { SkeletonProfileCard } from '../../components/Skeleton';
import AccentSurface from '../../components/AccentSurface';
import RetryPrompt from '../../components/RetryPrompt';
import { useCachedFetch } from '../../hooks/useCachedFetch';
import { useLoadingTimeout } from '../../hooks/useLoadingTimeout';
import { cache } from '../../lib/cache';
import { countFriends } from '../../lib/friends';
import { useSlideUp } from '../../lib/animations';
import ProBadge from '../../components/ProBadge';
import { useEntitlements } from '../../hooks/useEntitlements';

type Profile = {
  id: string;
  display_name: string;
  bio: string | null;
  avatar_url: string | null;
  created_at: string;
};

type Stats = {
  capsuleCount: number;
  unlockedCount: number;
  friendCount: number;
};

export function Avatar({ url, name, size, accent }: { url: string | null; name: string; size: number; accent?: string }) {
  const { accentColor } = useTheme();
  const bg = accent ?? accentColor;
  if (url) {
    const src = transformAvatarUrl(url, size);
    return (
      <Image
        source={src}
        style={{ width: size, height: size, borderRadius: size / 2, backgroundColor: '#1A1A1A' }}
        transition={200}
      />
    );
  }
  return (
    <View style={{ width: size, height: size, borderRadius: size / 2, backgroundColor: bg, alignItems: 'center', justifyContent: 'center' }}>
      <Text style={{ color: '#fff', fontSize: size * 0.38, fontWeight: '700' }}>
        {(name[0] ?? '?').toUpperCase()}
      </Text>
    </View>
  );
}

async function uploadAvatar(uri: string): Promise<string> {
  // The avatars RLS check is `auth.uid()::text = foldername[1]`, so the path's
  // user id MUST be the authenticated user — never a cached profile.id, which
  // can lag behind the live session and trigger a 403 RLS violation.
  let path: string;

  if (Platform.OS === 'web') {
    const session = sessionStore.get();
    if (!session) throw new Error('Not signed in');
    path = `${session.user.id}/avatar.jpg`;
    const resp = await fetch(uri);
    const buf = await resp.arrayBuffer();
    const { error } = await supabase.storage
      .from('avatars')
      .upload(path, buf, { contentType: 'image/jpeg', upsert: true });
    if (error) {
      console.warn('Avatar upload failed:', error.message);
      throw new Error('Check your connection and try again.');
    }
  } else {
    const { accessToken, userId } = await getFreshSession();
    path = `${userId}/avatar.jpg`;
    const resized = await ImageManipulator.manipulateAsync(
      uri,
      [{ resize: { width: 400 } }],
      { compress: 0.8, format: ImageManipulator.SaveFormat.JPEG }
    );
    const result = await FileSystem.uploadAsync(
      `${process.env.EXPO_PUBLIC_SUPABASE_URL}/storage/v1/object/avatars/${path}`,
      resized.uri,
      {
        httpMethod: 'POST',
        uploadType: FileSystem.FileSystemUploadType.BINARY_CONTENT,
        headers: {
          Authorization: `Bearer ${accessToken}`,
          apikey: process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY!,
          'Content-Type': 'image/jpeg',
          'x-upsert': 'true',
        },
      }
    );
    if (result.status < 200 || result.status >= 300) {
      throw new Error('Check your connection and try again.');
    }
  }

  const { data } = supabase.storage.from('avatars').getPublicUrl(path);
  return `${data.publicUrl}?t=${Date.now()}`;
}

function getMemberSince(createdAt: string): string {
  const created = new Date(createdAt);
  const now = new Date();
  const diffMs = now.getTime() - created.getTime();
  const days = Math.floor(diffMs / (1000 * 60 * 60 * 24));
  if (days < 1) return 'Joined today';
  if (days === 1) return '1 day';
  if (days < 30) return `${days} days`;
  const months = Math.floor(days / 30);
  if (months === 1) return '1 month';
  if (months < 12) return `${months} months`;
  const years = Math.floor(months / 12);
  const rem = months % 12;
  if (rem === 0) return `${years}y`;
  return `${years}y ${rem}mo`;
}

function StatItem({ value, label, icon, accentColor, onPress }: {
  value: string;
  label: string;
  icon: keyof typeof Ionicons.glyphMap;
  accentColor: string;
  onPress?: () => void;
}) {
  const Container: any = onPress ? TouchableOpacity : View;
  return (
    <Container style={styles.statItem} onPress={onPress} activeOpacity={0.7}>
      <View style={[styles.statIconWrap, { backgroundColor: `${accentColor}15` }]}>
        <Ionicons name={icon} size={16} color={accentColor} />
      </View>
      <Text style={styles.statValue}>{value}</Text>
      <Text style={styles.statLabel}>{label}</Text>
    </Container>
  );
}

function EditProfileModal({
  profile,
  onClose,
  onSaved,
}: {
  profile: Profile;
  onClose: () => void;
  onSaved: (updated: Profile) => void;
}) {
  const { accentColor } = useTheme();
  const [displayName, setDisplayName] = useState(profile.display_name);
  const [bio, setBio] = useState(profile.bio ?? '');
  const [avatarUri, setAvatarUri] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  async function pickAvatar() {
    const result = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ImagePicker.MediaTypeOptions.Images,
      allowsEditing: true,
      aspect: [1, 1],
      quality: 0.8,
    });
    if (!result.canceled && result.assets[0]) {
      setAvatarUri(result.assets[0].uri);
    }
  }

  async function save() {
    if (!displayName.trim()) { setError('Display name is required.'); return; }
    setSaving(true);
    setError('');

    let avatar_url = profile.avatar_url;
    if (avatarUri) {
      try {
        avatar_url = await uploadAvatar(avatarUri);
      } catch (e: any) {
        setError(`Avatar upload failed: ${e?.message ?? 'unknown error'}`);
        setSaving(false);
        return;
      }
    }

    const { error: err } = await supabase
      .from('users')
      .update({ display_name: displayName.trim(), bio: bio.trim() || null, avatar_url })
      .eq('id', profile.id);

    if (err) {
      setError('Failed to save. Try again.');
      setSaving(false);
    } else {
      cache.invalidate('profile');
      onSaved({ ...profile, display_name: displayName.trim(), bio: bio.trim() || null, avatar_url });
    }
  }

  const previewUrl = avatarUri ?? profile.avatar_url;

  return (
    <Modal visible animationType="slide" presentationStyle="pageSheet" onRequestClose={onClose}>
      <SafeAreaProvider>
      <SafeAreaView style={es.container}>
        <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined} style={{ flex: 1 }}>
          <View style={es.header}>
            <TouchableOpacity onPress={onClose}>
              <Text style={es.cancel}>Cancel</Text>
            </TouchableOpacity>
            <Text style={es.title}>Edit Profile</Text>
            <TouchableOpacity onPress={save} disabled={saving}>
              <Text style={[es.saveBtn, { color: accentColor }, saving && { opacity: 0.4 }]}>{saving ? 'Saving…' : 'Save'}</Text>
            </TouchableOpacity>
          </View>

          <ScrollView contentContainerStyle={es.body}>
            <TouchableOpacity style={es.avatarWrap} onPress={pickAvatar}>
              <Avatar url={previewUrl} name={displayName || '?'} size={88} />
              <Text style={[es.changePhoto, { color: accentColor }]}>Change Photo</Text>
            </TouchableOpacity>

            <Text style={es.label}>Display Name</Text>
            <TextInput
              style={es.input}
              value={displayName}
              onChangeText={setDisplayName}
              placeholder="Your name"
              placeholderTextColor="#555"
              autoCorrect={false}
              maxLength={30}
            />

            <View style={es.labelRow}>
              <Text style={es.label}>Bio</Text>
              <Text style={es.charCount}>{bio.length}/80</Text>
            </View>
            <TextInput
              style={es.input}
              value={bio}
              onChangeText={t => setBio(t.slice(0, 80))}
              placeholder="A short tagline…"
              placeholderTextColor="#555"
              maxLength={80}
            />

            {error ? <Text style={es.error}>{error}</Text> : null}
          </ScrollView>
        </KeyboardAvoidingView>
      </SafeAreaView>
      </SafeAreaProvider>
    </Modal>
  );
}

type ProfileData = {
  profile: Profile;
  stats: Stats;
};

export default function ProfileScreen() {
  const navigation = useNavigation<NativeStackNavigationProp<AppStackParamList>>();
  const { accentColor } = useTheme();
  const [profile, setProfile] = useState<Profile | null>(null);
  const [stats, setStats] = useState<Stats>({ capsuleCount: 0, unlockedCount: 0, friendCount: 0 });
  const [showEdit, setShowEdit] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const { isPro } = useEntitlements();

  const { loading, refresh } = useCachedFetch<ProfileData>(
    'profile',
    async () => {
      const session = sessionStore.get();
      if (!session) throw new Error('No session');
      const userId = session.user.id;

      // count-only ('exact', head: true) instead of fetching every joined
      // capsule row just to count them — no row payload transferred.
      const [profileRes, capsuleCountRes, unlockedCountRes, friendCount] = await Promise.all([
        supabase
          .from('users')
          .select('id, display_name, bio, avatar_url, created_at')
          .eq('id', userId)
          .single(),
        supabase
          .from('capsule_members')
          .select('id', { count: 'exact', head: true })
          .eq('user_id', userId)
          .not('joined_at', 'is', null),
        supabase
          .from('capsule_members')
          .select('id, capsules!inner(status)', { count: 'exact', head: true })
          .eq('user_id', userId)
          .not('joined_at', 'is', null)
          .eq('capsules.status', 'unlocked'),
        countFriends(),
      ]);

      const prof = profileRes.data as Profile;
      const s: Stats = {
        capsuleCount: capsuleCountRes.count ?? 0,
        unlockedCount: unlockedCountRes.count ?? 0,
        friendCount,
      };

      setProfile(prof);
      setStats(s);
      return { profile: prof, stats: s };
    },
  );

  const { timedOut, reset: resetTimeout } = useLoadingTimeout(loading);

  const heroAnim = useSlideUp(0, 400);
  const actionsAnim = useSlideUp(120, 350);
  const signOutAnim = useSlideUp(200, 300);

  if (loading) {
    if (timedOut) {
      return (
        <SafeAreaView style={styles.container}>
          <RetryPrompt onRetry={() => { resetTimeout(); refresh(true); }} />
        </SafeAreaView>
      );
    }
    return (
      <SafeAreaView style={styles.container}>
        <SkeletonProfileCard />
      </SafeAreaView>
    );
  }

  const memberSince = profile?.created_at ? getMemberSince(profile.created_at) : '';

  async function onRefresh() {
    setRefreshing(true);
    await refresh(true);
    setRefreshing(false);
  }

  return (
    <SafeAreaView style={styles.container}>
      <ScrollView
        contentContainerStyle={styles.scroll}
        showsVerticalScrollIndicator={false}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={accentColor} />}
      >
        {/* Hero Card */}
        <Animated.View style={[styles.heroCard, heroAnim]}>
          <AccentSurface style={styles.heroGlow} start={{ x: 0, y: 0 }} end={{ x: 1, y: 0 }} />
          <View style={styles.heroContent}>
            <View style={[styles.avatarRing, { borderColor: `${accentColor}40` }]}>
              <Avatar url={profile?.avatar_url ?? null} name={profile?.display_name ?? '?'} size={100} />
            </View>
            <View style={styles.nameRow}>
              <Text style={styles.name}>{profile?.display_name}</Text>
              {isPro && <ProBadge size="md" />}
            </View>
            {profile?.bio ? <Text style={styles.bio}>{profile.bio}</Text> : null}
            {memberSince ? (
              <View style={styles.memberSinceRow}>
                <Ionicons name="time-outline" size={12} color="#555" />
                <Text style={styles.memberSince}>{memberSince}</Text>
              </View>
            ) : null}

            {/* Stats */}
            <View style={styles.statsRow}>
              <StatItem
                value={String(stats.capsuleCount)}
                label="Capsules"
                icon="cube-outline"
                accentColor={accentColor}
              />
              <View style={styles.statDivider} />
              <StatItem
                value={String(stats.unlockedCount)}
                label="Unlocked"
                icon="lock-open-outline"
                accentColor={accentColor}
              />
              <View style={styles.statDivider} />
              <StatItem
                value={String(stats.friendCount)}
                label="Friends"
                icon="people-outline"
                accentColor={accentColor}
                onPress={() => navigation.navigate('Friends')}
              />
            </View>
          </View>
        </Animated.View>

        {/* Action Buttons */}
        <Animated.View style={[styles.actions, actionsAnim]}>
          <TouchableOpacity
            style={[styles.actionBtn, { borderColor: `${accentColor}40` }]}
            onPress={() => setShowEdit(true)}
            activeOpacity={0.7}
          >
            <View style={[styles.actionIconWrap, { backgroundColor: `${accentColor}15` }]}>
              <Ionicons name="pencil-outline" size={18} color={accentColor} />
            </View>
            <Text style={styles.actionText}>Edit Profile</Text>
            <Ionicons name="chevron-forward" size={18} color="#444" />
          </TouchableOpacity>

          <TouchableOpacity
            style={[styles.actionBtn, { borderColor: `${accentColor}40` }]}
            onPress={() => navigation.navigate('Settings')}
            activeOpacity={0.7}
          >
            <View style={[styles.actionIconWrap, { backgroundColor: `${accentColor}15` }]}>
              <Ionicons name="settings-outline" size={18} color={accentColor} />
            </View>
            <Text style={styles.actionText}>Settings</Text>
            <Ionicons name="chevron-forward" size={18} color="#444" />
          </TouchableOpacity>
        </Animated.View>

        {/* Sign Out */}
        <Animated.View style={signOutAnim}>
        <TouchableOpacity style={styles.signOutBtn} onPress={() => setConfirming(true)} activeOpacity={0.7}>
          <Ionicons name="log-out-outline" size={18} color="#FF3B30" />
          <Text style={styles.signOutText}>Sign Out</Text>
        </TouchableOpacity>
        </Animated.View>
      </ScrollView>

      {showEdit && profile && (
        <EditProfileModal
          profile={profile}
          onClose={() => setShowEdit(false)}
          onSaved={updated => { setProfile(updated); setShowEdit(false); }}
        />
      )}

      {/* Sign-out confirmation sheet */}
      <Modal
        visible={confirming}
        transparent
        animationType="slide"
        onRequestClose={() => setConfirming(false)}
      >
        <Pressable style={styles.sheetBackdrop} onPress={() => setConfirming(false)}>
          <Pressable style={styles.sheet} onPress={() => {}}>
            <View style={styles.sheetHandle} />
            <Text style={styles.sheetTitle}>Sign out?</Text>
            <Text style={styles.sheetSubtext}>
              You'll need to log back in to access your capsules.
            </Text>
            <TouchableOpacity
              style={styles.destructBtn}
              onPress={() => { sessionStore.markIntentionalSignOut(); supabase.auth.signOut(); }}
            >
              <Text style={styles.destructBtnText}>Sign Out</Text>
            </TouchableOpacity>
            <TouchableOpacity
              style={styles.cancelBtn}
              onPress={() => setConfirming(false)}
            >
              <Text style={styles.cancelBtnText}>Cancel</Text>
            </TouchableOpacity>
          </Pressable>
        </Pressable>
      </Modal>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#0A0A0A' },
  scroll: { paddingHorizontal: 20, paddingTop: 24, paddingBottom: 40, gap: 16 },
  nameRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },

  heroCard: {
    backgroundColor: '#111111',
    borderRadius: 20,
    borderWidth: 1,
    borderColor: '#1E1E1E',
    overflow: 'hidden',
  },
  heroGlow: {
    height: 3,
    opacity: 0.6,
  },
  heroContent: {
    alignItems: 'center',
    paddingTop: 28,
    paddingBottom: 24,
    paddingHorizontal: 24,
  },
  avatarRing: {
    padding: 3,
    borderRadius: 54,
    borderWidth: 2,
  },
  name: {
    fontSize: 24,
    fontWeight: '800',
    color: '#FFFFFF',
    marginTop: 14,
  },
  bio: {
    fontSize: 14,
    color: '#888888',
    textAlign: 'center',
    marginTop: 4,
    lineHeight: 20,
    paddingHorizontal: 16,
  },
  memberSinceRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    marginTop: 8,
  },
  memberSince: {
    fontSize: 12,
    color: '#888888',
  },

  statsRow: {
    flexDirection: 'row',
    alignItems: 'center',
    marginTop: 20,
    paddingTop: 20,
    borderTopWidth: 1,
    borderTopColor: '#1E1E1E',
    alignSelf: 'stretch',
  },
  statItem: {
    flex: 1,
    alignItems: 'center',
    gap: 6,
  },
  statIconWrap: {
    width: 32,
    height: 32,
    borderRadius: 16,
    alignItems: 'center',
    justifyContent: 'center',
  },
  statValue: {
    fontSize: 20,
    fontWeight: '800',
    color: '#FFFFFF',
  },
  statLabel: {
    fontSize: 12,
    color: '#666666',
    fontWeight: '500',
  },
  statDivider: {
    width: 1,
    height: 40,
    backgroundColor: '#1E1E1E',
  },

  actions: {
    gap: 8,
  },
  actionBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#141414',
    borderRadius: 14,
    paddingVertical: 14,
    paddingHorizontal: 16,
    gap: 12,
    borderWidth: 1,
    borderColor: '#1E1E1E',
  },
  actionIconWrap: {
    width: 36,
    height: 36,
    borderRadius: 10,
    alignItems: 'center',
    justifyContent: 'center',
  },
  actionText: {
    flex: 1,
    fontSize: 16,
    fontWeight: '600',
    color: '#FFFFFF',
  },

  signOutBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    paddingVertical: 16,
    marginTop: 8,
  },
  signOutText: {
    color: '#FF3B30',
    fontWeight: '600',
    fontSize: 16,
  },

  sheetBackdrop: { flex: 1, backgroundColor: 'rgba(0,0,0,0.6)', justifyContent: 'flex-end' },
  sheet: {
    backgroundColor: '#1A1A1A', borderTopLeftRadius: 20, borderTopRightRadius: 20,
    paddingHorizontal: 24, paddingTop: 12, paddingBottom: 40, gap: 12,
  },
  sheetHandle: { width: 36, height: 4, borderRadius: 2, backgroundColor: '#444', alignSelf: 'center', marginBottom: 16 },
  sheetTitle: { fontSize: 20, fontWeight: '800', color: '#FFFFFF', textAlign: 'center' },
  sheetSubtext: { fontSize: 14, color: '#888888', textAlign: 'center', lineHeight: 20, marginBottom: 8 },
  destructBtn: { width: '100%', backgroundColor: '#FF3B3015', borderWidth: 1, borderColor: '#FF3B30', borderRadius: 12, paddingVertical: 14, alignItems: 'center' },
  destructBtnText: { color: '#FF3B30', fontWeight: '700', fontSize: 16 },
  cancelBtn: { width: '100%', backgroundColor: '#2A2A2A', borderRadius: 12, paddingVertical: 14, alignItems: 'center' },
  cancelBtnText: { color: '#FFFFFF', fontWeight: '600', fontSize: 16 },
});

const es = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#0A0A0A' },
  header: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 20, paddingVertical: 16, borderBottomWidth: 1, borderBottomColor: '#1A1A1A' },
  title: { fontSize: 17, fontWeight: '700', color: '#FFFFFF' },
  cancel: { fontSize: 16, color: '#888888' },
  saveBtn: { fontSize: 16, fontWeight: '700', color: '#FF6B35' },
  body: { alignItems: 'center', paddingTop: 32, paddingHorizontal: 24, gap: 8, paddingBottom: 40 },
  avatarWrap: { alignItems: 'center', gap: 10, marginBottom: 16 },
  changePhoto: { fontSize: 14, color: '#FF6B35', fontWeight: '600' },
  labelRow: { flexDirection: 'row', justifyContent: 'space-between', alignSelf: 'stretch' },
  label: { fontSize: 13, color: '#888888', fontWeight: '600', textTransform: 'uppercase', letterSpacing: 0.5, alignSelf: 'flex-start' },
  charCount: { fontSize: 13, color: '#888888' },
  input: { alignSelf: 'stretch', borderWidth: 1, borderColor: '#2A2A2A', borderRadius: 10, paddingHorizontal: 14, paddingVertical: 12, color: '#FFFFFF', fontSize: 16, backgroundColor: '#111111' },
  error: { color: '#FF3B30', fontSize: 14, textAlign: 'center' },
});
