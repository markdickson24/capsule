import React, { useEffect, useState } from 'react';
import LoadingBrand from '../../components/LoadingBrand';
import {
  View, Text, StyleSheet, TouchableOpacity,
  ScrollView, Modal, Pressable, Platform,
} from 'react-native';
import { SafeAreaView, SafeAreaProvider } from 'react-native-safe-area-context';
import { NativeStackScreenProps } from '@react-navigation/native-stack';
import { supabase } from '../../lib/supabase';
import { sessionStore } from '../../lib/sessionStore';
import { Avatar } from './ProfileScreen';
import { Ionicons } from '@expo/vector-icons';
import { AppStackParamList } from '../../types/navigation';
import { useTheme } from '../../context/ThemeContext';
import { SkeletonCircle } from '../../components/Skeleton';
import SkeletonBox from '../../components/Skeleton';
import ReportModal from '../../components/ReportModal';
import ConfirmModal from '../../components/ConfirmModal';
import { blockStore } from '../../lib/blocks';
import { cache } from '../../lib/cache';
import { useBlockedUsers } from '../../hooks/useBlockedUsers';
import {
  getFriendStatus, sendFriendRequest, acceptFriendRequest, removeFriendship,
  type FriendStatus,
} from '../../lib/friends';

type Props = NativeStackScreenProps<AppStackParamList, 'PublicProfile'>;

type Profile = { id: string; display_name: string; bio: string | null; avatar_url: string | null };
type MutualCapsule = { capsule_id: string; capsules: { id: string; title: string; status: string } };
type OwnedCapsule = { id: string; title: string };

function InviteToCapsuleModal({
  userId,
  onClose,
}: {
  userId: string;
  onClose: () => void;
}) {
  const { accentColor } = useTheme();
  const [capsules, setCapsules] = useState<OwnedCapsule[]>([]);
  const [loading, setLoading] = useState(true);
  const [inviting, setInviting] = useState<string | null>(null);
  const [invitedIds, setInvitedIds] = useState<string[]>([]);
  const [error, setError] = useState('');

  useEffect(() => { loadCapsules(); }, []);

  async function loadCapsules() {
    try {
      const session = sessionStore.get();
      if (!session) return;

      const { data: existing } = await supabase
        .from('capsule_members')
        .select('capsule_id')
        .eq('user_id', userId);

      const excludeIds = (existing ?? []).map((r: any) => r.capsule_id);

      let query = supabase
        .from('capsules')
        .select('id, title')
        .eq('owner_id', session.user.id)
        .eq('status', 'active');

      if (excludeIds.length > 0) {
        query = query.not('id', 'in', `(${excludeIds.join(',')})`);
      }

      const { data } = await query;
      setCapsules((data ?? []) as OwnedCapsule[]);
    } finally {
      setLoading(false);
    }
  }

  async function invite(capsuleId: string) {
    setInviting(capsuleId);
    setError('');
    const { error: err } = await supabase.from('capsule_members').insert({
      capsule_id: capsuleId,
      user_id: userId,
      role: 'contributor',
    });
    if (err) {
      setError('Could not send invite.');
    } else {
      setInvitedIds(prev => [...prev, capsuleId]);
    }
    setInviting(null);
  }

  return (
    <Modal visible animationType="slide" presentationStyle="pageSheet" onRequestClose={onClose}>
      <SafeAreaProvider>
      <SafeAreaView style={is.container}>
        <View style={is.header}>
          <Text style={is.title}>Invite to Capsule</Text>
          <TouchableOpacity onPress={onClose}><Text style={[is.done, { color: accentColor }]}>Done</Text></TouchableOpacity>
        </View>
        {loading ? (
          <LoadingBrand size="medium" color={accentColor} style={{ marginTop: 40 }} />
        ) : capsules.length === 0 ? (
          <Text style={is.empty}>No active capsules to invite them to.</Text>
        ) : (
          <ScrollView>
            {error ? <Text style={is.error}>{error}</Text> : null}
            {capsules.map(c => (
              <View key={c.id} style={is.row}>
                <Text style={is.capsuleTitle}>{c.title}</Text>
                {invitedIds.includes(c.id) ? (
                  <View style={{ flexDirection: 'row', alignItems: 'center', gap: 4 }}>
                    <Ionicons name="checkmark" size={14} color="#30D158" />
                    <Text style={is.sent}>Invited</Text>
                  </View>
                ) : (
                  <TouchableOpacity
                    style={[is.inviteBtn, { backgroundColor: accentColor }]}
                    onPress={() => invite(c.id)}
                    disabled={inviting === c.id}
                  >
                    <Text style={is.inviteBtnText}>{inviting === c.id ? '…' : 'Invite'}</Text>
                  </TouchableOpacity>
                )}
              </View>
            ))}
          </ScrollView>
        )}
      </SafeAreaView>
      </SafeAreaProvider>
    </Modal>
  );
}

export default function PublicProfileScreen({ route, navigation }: Props) {
  const { accentColor } = useTheme();
  const { userId } = route.params;
  const [profile, setProfile] = useState<Profile | null>(null);
  const [mutualCapsules, setMutualCapsules] = useState<MutualCapsule[]>([]);
  const [loading, setLoading] = useState(true);
  const [showInvite, setShowInvite] = useState(false);
  const [showReport, setShowReport] = useState(false);
  const [showBlockConfirm, setShowBlockConfirm] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);
  const [blocking, setBlocking] = useState(false);
  const [currentUserId, setCurrentUserId] = useState('');
  const [friendStatus, setFriendStatus] = useState<FriendStatus>('none');
  const [friendBusy, setFriendBusy] = useState(false);
  const blockedIds = useBlockedUsers();
  const isBlocked = blockedIds.has(userId);

  useEffect(() => {
    getFriendStatus(userId).then(setFriendStatus);
  }, [userId]);

  async function onAddFriend() {
    setFriendBusy(true);
    setFriendStatus('outgoing'); // optimistic
    const { error } = await sendFriendRequest(userId);
    if (error) setFriendStatus('none');
    setFriendBusy(false);
  }

  async function onAcceptFriend() {
    const wasFriends = friendStatus === 'friends';
    setFriendBusy(true);
    setFriendStatus('friends'); // optimistic
    const { error } = await acceptFriendRequest(userId);
    if (error) setFriendStatus('incoming');
    else if (!wasFriends) cache.invalidate('profile');
    setFriendBusy(false);
  }

  async function onRemoveFriend() {
    const prev = friendStatus;
    setFriendBusy(true);
    setFriendStatus('none'); // optimistic — covers cancel / decline / unfriend
    if (prev === 'friends') cache.invalidate('profile');
    const { error } = await removeFriendship(userId);
    if (error) setFriendStatus(prev);
    setFriendBusy(false);
  }

  async function confirmBlock() {
    setBlocking(true);
    await blockStore.block(userId);
    setBlocking(false);
    setShowBlockConfirm(false);
  }

  useEffect(() => { load().finally(() => setLoading(false)); }, [userId]);

  async function load() {
    const session = sessionStore.get();
    const cuid = session?.user.id ?? '';
    setCurrentUserId(cuid);

    const [profileRes, myMembershipsRes] = await Promise.all([
      supabase.from('users').select('id, display_name, bio, avatar_url').eq('id', userId).single(),
      supabase.from('capsule_members').select('capsule_id').eq('user_id', cuid).not('joined_at', 'is', null),
    ]);

    if (profileRes.data) setProfile(profileRes.data as Profile);

    const myCapsuleIds = (myMembershipsRes.data ?? []).map((r: any) => r.capsule_id);

    if (myCapsuleIds.length > 0) {
      const { data: mutual } = await supabase
        .from('capsule_members')
        .select('capsule_id, capsules(id, title, status)')
        .eq('user_id', userId)
        .not('joined_at', 'is', null)
        .in('capsule_id', myCapsuleIds);
      setMutualCapsules((mutual ?? []) as MutualCapsule[]);
    }
  }

  if (loading) {
    return (
      <SafeAreaView style={styles.container}>
        <View style={styles.navBar}>
          <SkeletonBox width={60} height={16} borderRadius={6} />
        </View>
        <View style={styles.body}>
          <SkeletonCircle size={88} />
          <SkeletonBox width={160} height={20} borderRadius={8} style={{ marginTop: 12 }} />
          <SkeletonBox width={220} height={14} borderRadius={6} />
          <SkeletonBox width="100%" height={48} borderRadius={12} style={{ marginTop: 12 }} />
          <View style={{ alignSelf: 'stretch', marginTop: 24, gap: 12 }}>
            <SkeletonBox width={130} height={12} borderRadius={4} />
            <SkeletonBox width="100%" height={48} borderRadius={0} />
            <SkeletonBox width="100%" height={48} borderRadius={0} />
          </View>
        </View>
      </SafeAreaView>
    );
  }

  const isOwnProfile = userId === currentUserId;

  return (
    <SafeAreaView style={styles.container}>
      <View style={styles.navBar}>
        <TouchableOpacity onPress={() => navigation.goBack()}>
          <Text style={[styles.back, { color: accentColor }]}>← Back</Text>
        </TouchableOpacity>
        {!isOwnProfile && (
          <TouchableOpacity onPress={() => setMenuOpen(true)} hitSlop={8} style={styles.menuBtn}>
            <Ionicons name="ellipsis-horizontal" size={22} color="#FFFFFF" />
          </TouchableOpacity>
        )}
      </View>

      <ScrollView contentContainerStyle={styles.body}>
        <Avatar url={profile?.avatar_url ?? null} name={profile?.display_name ?? '?'} size={88} />
        <Text style={styles.name}>{profile?.display_name}</Text>
        {profile?.bio ? <Text style={styles.bio}>{profile.bio}</Text> : null}

        {!isOwnProfile && !isBlocked && (
          <View style={styles.friendBtnWrap}>
            {friendStatus === 'none' && (
              <TouchableOpacity
                style={[styles.friendBtn, { backgroundColor: accentColor }]}
                onPress={onAddFriend}
                disabled={friendBusy}
              >
                <Ionicons name="person-add-outline" size={18} color="#FFFFFF" />
                <Text style={styles.friendBtnText}>Add Friend</Text>
              </TouchableOpacity>
            )}
            {friendStatus === 'outgoing' && (
              <TouchableOpacity style={styles.friendBtnGhost} onPress={onRemoveFriend} disabled={friendBusy}>
                <Ionicons name="time-outline" size={18} color="#888888" />
                <Text style={styles.friendBtnGhostText}>Requested</Text>
              </TouchableOpacity>
            )}
            {friendStatus === 'incoming' && (
              <View style={styles.friendIncomingRow}>
                <TouchableOpacity
                  style={[styles.friendBtn, { backgroundColor: accentColor, flex: 1 }]}
                  onPress={onAcceptFriend}
                  disabled={friendBusy}
                >
                  <Ionicons name="checkmark" size={18} color="#FFFFFF" />
                  <Text style={styles.friendBtnText}>Accept Request</Text>
                </TouchableOpacity>
                <TouchableOpacity style={styles.friendDecline} onPress={onRemoveFriend} disabled={friendBusy}>
                  <Text style={styles.friendDeclineText}>Decline</Text>
                </TouchableOpacity>
              </View>
            )}
            {friendStatus === 'friends' && (
              <View style={styles.friendBtnGhost}>
                <Ionicons name="checkmark-circle" size={18} color="#30D158" />
                <Text style={styles.friendBtnGhostText}>Friends</Text>
              </View>
            )}
          </View>
        )}

        {!isOwnProfile && !isBlocked && (
          <TouchableOpacity style={[styles.inviteBtn, { backgroundColor: accentColor }]} onPress={() => setShowInvite(true)}>
            <Text style={styles.inviteBtnText}>Invite to Capsule</Text>
          </TouchableOpacity>
        )}

        {!isOwnProfile && isBlocked && (
          <View style={styles.blockedNotice}>
            <Ionicons name="ban-outline" size={16} color="#888888" />
            <Text style={styles.blockedNoticeText}>
              You blocked this user. You won't see their photos or reactions.
            </Text>
          </View>
        )}


        {mutualCapsules.length > 0 && (
          <View style={styles.section}>
            <Text style={styles.sectionTitle}>Mutual Capsules</Text>
            {mutualCapsules.map(m => (
              <TouchableOpacity
                key={m.capsule_id}
                style={styles.capsuleRow}
                onPress={() => navigation.navigate('CapsuleDetail', { capsuleId: m.capsule_id })}
              >
                <Text style={styles.capsuleName}>{m.capsules?.title ?? 'Capsule'}</Text>
                <Text style={styles.capsuleStatus}>{m.capsules?.status ?? ''}</Text>
              </TouchableOpacity>
            ))}
          </View>
        )}

        {mutualCapsules.length === 0 && !isOwnProfile && (
          <Text style={styles.empty}>No mutual capsules yet.</Text>
        )}
      </ScrollView>

      {showInvite && (
        <InviteToCapsuleModal userId={userId} onClose={() => setShowInvite(false)} />
      )}

      {/* Overflow menu — tap the ⋯ button to reveal Report / Block */}
      <Modal visible={menuOpen} transparent animationType="fade" onRequestClose={() => setMenuOpen(false)}>
        <Pressable style={styles.menuBackdrop} onPress={() => setMenuOpen(false)}>
          <View style={styles.menu}>
            {friendStatus === 'friends' && (
              <>
                <TouchableOpacity
                  style={styles.menuItem}
                  onPress={() => { setMenuOpen(false); onRemoveFriend(); }}
                >
                  <Ionicons name="person-remove-outline" size={18} color="#888888" />
                  <Text style={[styles.menuItemText, { color: '#FFFFFF' }]}>Unfriend</Text>
                </TouchableOpacity>
                <View style={styles.menuDivider} />
              </>
            )}
            <TouchableOpacity
              style={styles.menuItem}
              onPress={() => { setMenuOpen(false); setShowReport(true); }}
            >
              <Ionicons name="flag-outline" size={18} color="#FF3B30" />
              <Text style={styles.menuItemText}>Report</Text>
            </TouchableOpacity>
            <View style={styles.menuDivider} />
            {isBlocked ? (
              <TouchableOpacity
                style={styles.menuItem}
                onPress={() => { setMenuOpen(false); blockStore.unblock(userId); }}
              >
                <Ionicons name="person-add-outline" size={18} color="#888888" />
                <Text style={[styles.menuItemText, { color: '#FFFFFF' }]}>Unblock</Text>
              </TouchableOpacity>
            ) : (
              <TouchableOpacity
                style={styles.menuItem}
                onPress={() => { setMenuOpen(false); setShowBlockConfirm(true); }}
              >
                <Ionicons name="ban-outline" size={18} color="#FF3B30" />
                <Text style={styles.menuItemText}>Block</Text>
              </TouchableOpacity>
            )}
          </View>
        </Pressable>
      </Modal>

      <ReportModal
        visible={showReport}
        targetType="user"
        targetId={userId}
        onClose={() => setShowReport(false)}
      />

      <ConfirmModal
        visible={showBlockConfirm}
        title="Block this user?"
        message="They won't be able to appear in your invites, and you won't see their photos or reactions. They won't be notified."
        confirmLabel="Block"
        destructive
        loading={blocking}
        onConfirm={confirmBlock}
        onCancel={() => setShowBlockConfirm(false)}
      />
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#0A0A0A' },
  navBar: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 20, paddingVertical: 12 },
  menuBtn: { padding: 4 },
  back: { color: '#FF6B35', fontSize: 16, fontWeight: '600' },
  body: { alignItems: 'center', paddingTop: 24, paddingBottom: 40, paddingHorizontal: 24, gap: 10 },
  name: { fontSize: 22, fontWeight: '800', color: '#FFFFFF', marginTop: 8 },
  bio: { fontSize: 14, color: '#888888', textAlign: 'center' },
  inviteBtn: { marginTop: 8, width: '100%', backgroundColor: '#FF6B35', borderRadius: 12, paddingVertical: 14, alignItems: 'center' },
  inviteBtnText: { color: '#FFFFFF', fontWeight: '700', fontSize: 16 },
  friendBtnWrap: { width: '100%', marginTop: 8 },
  friendBtn: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8,
    borderRadius: 12, paddingVertical: 14,
  },
  friendBtnText: { color: '#FFFFFF', fontWeight: '700', fontSize: 16 },
  friendBtnGhost: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8,
    borderRadius: 12, paddingVertical: 14, borderWidth: 1, borderColor: '#2A2A2A',
  },
  friendBtnGhostText: { color: '#888888', fontWeight: '700', fontSize: 16 },
  friendIncomingRow: { flexDirection: 'row', gap: 10, alignItems: 'stretch' },
  friendDecline: {
    paddingHorizontal: 16, justifyContent: 'center', alignItems: 'center',
    borderRadius: 12, borderWidth: 1, borderColor: '#2A2A2A',
  },
  friendDeclineText: { color: '#888888', fontWeight: '600', fontSize: 15 },
  menuBackdrop: { flex: 1, paddingTop: 52, paddingRight: 16, alignItems: 'flex-end' },
  menu: {
    minWidth: 160, backgroundColor: '#1A1A1A', borderRadius: 14,
    borderWidth: 1, borderColor: '#2A2A2A', paddingVertical: 4,
    ...Platform.select({
      default: { shadowColor: '#000', shadowOpacity: 0.4, shadowRadius: 16, shadowOffset: { width: 0, height: 6 } },
      web: {},
    }),
  },
  menuItem: { flexDirection: 'row', alignItems: 'center', gap: 10, paddingVertical: 11, paddingHorizontal: 14 },
  menuItemText: { color: '#FF3B30', fontWeight: '600', fontSize: 15 },
  menuDivider: { height: 1, backgroundColor: '#2A2A2A', marginHorizontal: 8 },
  blockedNotice: {
    flexDirection: 'row', alignItems: 'center', gap: 8, marginTop: 8,
    backgroundColor: '#1A1A1A', borderRadius: 12, padding: 12, alignSelf: 'stretch',
  },
  blockedNoticeText: { color: '#888888', fontSize: 13, flex: 1 },
  section: { alignSelf: 'stretch', marginTop: 24 },
  sectionTitle: { fontSize: 13, color: '#888888', fontWeight: '600', textTransform: 'uppercase', letterSpacing: 0.5, marginBottom: 10 },
  capsuleRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', paddingVertical: 14, borderBottomWidth: 1, borderBottomColor: '#1A1A1A' },
  capsuleName: { fontSize: 16, color: '#FFFFFF', fontWeight: '600' },
  capsuleStatus: { fontSize: 13, color: '#888888', textTransform: 'capitalize' },
  empty: { fontSize: 14, color: '#555555', marginTop: 32, textAlign: 'center' },
});

const is = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#0A0A0A' },
  header: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', paddingHorizontal: 20, paddingVertical: 16, borderBottomWidth: 1, borderBottomColor: '#1A1A1A' },
  title: { fontSize: 17, fontWeight: '700', color: '#FFFFFF' },
  done: { fontSize: 16, color: '#FF6B35', fontWeight: '600' },
  empty: { color: '#555555', textAlign: 'center', marginTop: 40, fontSize: 15 },
  error: { color: '#FF3B30', fontSize: 14, textAlign: 'center', margin: 16 },
  row: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 20, paddingVertical: 16, borderBottomWidth: 1, borderBottomColor: '#1A1A1A' },
  capsuleTitle: { fontSize: 16, color: '#FFFFFF', fontWeight: '600', flex: 1 },
  inviteBtn: { backgroundColor: '#FF6B35', borderRadius: 8, paddingHorizontal: 16, paddingVertical: 8 },
  inviteBtnText: { color: '#FFFFFF', fontWeight: '700', fontSize: 14 },
  sent: { color: '#30D158', fontSize: 14, fontWeight: '600' },
});
