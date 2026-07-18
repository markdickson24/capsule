import React, { useState, useCallback } from 'react';
import {
  View, Text, StyleSheet, FlatList, TouchableOpacity,
  RefreshControl, ActivityIndicator, Alert,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useNavigation, useRoute, RouteProp } from '@react-navigation/native';
import { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { Ionicons } from '@expo/vector-icons';
import { Image } from 'expo-image';
import { supabase } from '../../lib/supabase';
import { transformAvatarUrl } from '../../lib/avatarUrl';
import { sessionStore } from '../../lib/sessionStore';
import { cache } from '../../lib/cache';
import { toast } from '../../lib/toast';
import { useCachedFetch } from '../../hooks/useCachedFetch';
import { useLoadingTimeout } from '../../hooks/useLoadingTimeout';
import { useBlockedUsers } from '../../hooks/useBlockedUsers';
import { useTheme } from '../../context/ThemeContext';
import ConfirmModal from '../../components/ConfirmModal';
import RetryPrompt from '../../components/RetryPrompt';
import {
  getGroup, getGroupMembers, deleteGroup, removeGroupMember,
  GroupRow, GroupMemberProfile, recurrenceLabel, anchorFromGroup,
} from '../../lib/groups';
import { computeUpcomingOccurrences } from '../../lib/recurrence';
import { AppStackParamList } from '../../types/navigation';

type NavProp = NativeStackNavigationProp<AppStackParamList>;
type RoutePropType = RouteProp<AppStackParamList, 'GroupDetail'>;

interface GroupCapsule {
  id: string;
  title: string;
  status: string;
  unlock_at: string;
  owner_id: string;
}

function CapsuleRow({ item, onPress }: { item: GroupCapsule; onPress: () => void }) {
  const { accentColor } = useTheme();
  const isUnlocked = item.status === 'unlocked';
  return (
    <TouchableOpacity style={styles.capsuleRow} onPress={onPress}>
      <View style={styles.capsuleRowIcon}>
        <Ionicons
          name={isUnlocked ? 'lock-open-outline' : 'time-outline'}
          size={20}
          color={isUnlocked ? '#30D158' : '#666666'}
        />
      </View>
      <View style={styles.capsuleRowText}>
        <Text style={styles.capsuleRowTitle} numberOfLines={1}>{item.title}</Text>
        <Text style={styles.capsuleRowDate}>
          {isUnlocked ? 'Unlocked' : 'Unlocks'}{' '}
          {new Date(item.unlock_at).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })}
        </Text>
      </View>
      <Ionicons name="chevron-forward" size={16} color="#444444" />
    </TouchableOpacity>
  );
}

function MemberBubble({
  avatarUrl, displayName, isCreator, accentColor,
}: {
  avatarUrl: string | null; displayName: string | null; isCreator: boolean; accentColor: string;
}) {
  return (
    <View style={styles.memberBubble}>
      {avatarUrl ? (
        <Image source={transformAvatarUrl(avatarUrl, 32)} style={styles.memberAvatar} contentFit="cover" />
      ) : (
        <View style={styles.memberAvatarFallback}>
          <Text style={styles.memberAvatarInitial}>
            {(displayName ?? '?')[0].toUpperCase()}
          </Text>
        </View>
      )}
      {isCreator && (
        <View
          style={[styles.creatorBadge, { backgroundColor: accentColor }]}
          accessible
          accessibilityLabel={`${displayName ?? 'Member'} is the group creator`}
        >
          <Ionicons name="star" size={9} color="#FFFFFF" />
        </View>
      )}
    </View>
  );
}

export default function GroupDetailScreen() {
  const { accentColor } = useTheme();
  const navigation = useNavigation<NavProp>();
  const route = useRoute<RoutePropType>();
  const { groupId } = route.params;

  const userId = sessionStore.get()?.user?.id ?? null;
  const [refreshing, setRefreshing] = useState(false);
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [showLeaveConfirm, setShowLeaveConfirm] = useState(false);
  const [leaving, setLeaving] = useState(false);
  // Not persisted — route param + local state only (matches CapsuleDetailScreen's
  // invite nudge). Gone forever once dismissed or once a second member joins.
  const [nudgeDismissed, setNudgeDismissed] = useState(false);

  const { data: group, loading: groupLoading, refresh: refreshGroup } = useCachedFetch<GroupRow | null>(
    `group:${groupId}`,
    () => getGroup(groupId),
  );

  const { data: members, refresh: refreshMembers } = useCachedFetch<GroupMemberProfile[]>(
    `group-members:${groupId}`,
    () => getGroupMembers(groupId),
  );
  // Reactive so unblocking someone updates the bubble list live, without a
  // manual refresh — matches the other block-filter sites (InviteModal, etc).
  const blockedIds = useBlockedUsers();

  const { data: capsules, loading: capsulesLoading, refresh: refreshCapsules } = useCachedFetch<GroupCapsule[]>(
    `group-capsules:${groupId}`,
    async () => {
      const session = sessionStore.get();
      if (!session) return [];
      // Filtered server-side by group_id (rather than fetching every capsule
      // the user belongs to and filtering client-side) — capsules RLS still
      // independently restricts to the user's own capsules; the inner join
      // here additionally excludes pending (not yet joined) invites.
      const { data } = await supabase
        .from('capsules')
        .select('id, title, status, unlock_at, owner_id, group_id, capsule_members!inner(joined_at)')
        .eq('group_id', groupId)
        .eq('capsule_members.user_id', session.user.id)
        .not('capsule_members.joined_at', 'is', null)
        .order('unlock_at', { ascending: false });
      return (data ?? []) as unknown as GroupCapsule[];
    },
  );

  const onRefresh = useCallback(async () => {
    setRefreshing(true);
    await Promise.all([refreshGroup(), refreshMembers(), refreshCapsules()]);
    setRefreshing(false);
  }, [refreshGroup, refreshMembers, refreshCapsules]);

  async function handleDelete() {
    setDeleting(true);
    // Only navigate/invalidate on success — a failed delete used to look like
    // it worked (goBack) until the group reappeared.
    const { error } = await deleteGroup(groupId);
    setDeleting(false);
    if (error) {
      setShowDeleteConfirm(false);
      toast.show("Couldn't delete the group — try again.");
      return;
    }
    cache.invalidate('groups');
    setShowDeleteConfirm(false);
    navigation.goBack();
  }

  async function handleLeave() {
    if (!userId) return;
    setLeaving(true);
    const { error } = await removeGroupMember(groupId, userId);
    setLeaving(false);
    if (error) {
      setShowLeaveConfirm(false);
      toast.show("Couldn't leave the group — try again.");
      return;
    }
    cache.invalidate('groups');
    setShowLeaveConfirm(false);
    navigation.goBack();
  }

  const isCreator = group?.created_by === userId;

  const { timedOut, reset: resetTimeout } = useLoadingTimeout(groupLoading && !group);

  if (groupLoading && !group) {
    if (timedOut) {
      return (
        <SafeAreaView style={styles.container} edges={['top', 'left', 'right']}>
          <View style={styles.header}>
            <TouchableOpacity onPress={() => navigation.goBack()} hitSlop={8} accessibilityRole="button" accessibilityLabel="Back">
              <Ionicons name="arrow-back" size={24} color="#FFFFFF" />
            </TouchableOpacity>
          </View>
          <RetryPrompt onRetry={() => { resetTimeout(); refreshGroup(true); }} />
        </SafeAreaView>
      );
    }
    return (
      <SafeAreaView style={styles.container} edges={['top', 'left', 'right']}>
        <View style={styles.header}>
          <TouchableOpacity onPress={() => navigation.goBack()} hitSlop={8} accessibilityRole="button" accessibilityLabel="Back">
            <Ionicons name="arrow-back" size={24} color="#FFFFFF" />
          </TouchableOpacity>
        </View>
        <ActivityIndicator color={accentColor} style={{ marginTop: 40 }} />
      </SafeAreaView>
    );
  }

  if (!group) {
    return (
      <SafeAreaView style={styles.container} edges={['top', 'left', 'right']}>
        <View style={styles.header}>
          <TouchableOpacity onPress={() => navigation.goBack()} hitSlop={8} accessibilityRole="button" accessibilityLabel="Back">
            <Ionicons name="arrow-back" size={24} color="#FFFFFF" />
          </TouchableOpacity>
        </View>
        <View style={styles.empty}>
          <Text style={styles.emptyText}>Group not found</Text>
        </View>
      </SafeAreaView>
    );
  }

  const isPaused = group.recurrence_paused_at !== null;
  const nextDate = !isPaused && group.recurrence_interval !== 'manual'
    ? computeUpcomingOccurrences(group.recurrence_interval, anchorFromGroup(group), new Date(), 1)[0] ?? null
    : null;
  const memberList = members ?? [];
  // Blocked members are hidden from the bubble list — same client-side
  // filtering as InviteModal/ManageGroupScreen search (CLAUDE.md "Content
  // Moderation" — block enforcement is client-side, not RLS). The member
  // count text below is derived from this same filtered array so it never
  // disagrees with what's actually rendered.
  const visibleMembers = memberList.filter(m => !blockedIds.has(m.user_id));

  return (
    <SafeAreaView style={styles.container} edges={['top', 'left', 'right']}>
      <View style={styles.header}>
        <TouchableOpacity onPress={() => navigation.goBack()} hitSlop={8} accessibilityRole="button" accessibilityLabel="Back">
          <Ionicons name="arrow-back" size={24} color="#FFFFFF" />
        </TouchableOpacity>
        <Text style={styles.headerTitle} numberOfLines={1}>{group.name}</Text>
        {isCreator ? (
          <View style={styles.headerActions}>
            <TouchableOpacity
              onPress={() => navigation.navigate('ManageGroup', { groupId })}
              hitSlop={8}
              accessibilityRole="button"
              accessibilityLabel="Manage group"
            >
              <Ionicons name="settings-outline" size={22} color={accentColor} />
            </TouchableOpacity>
            <TouchableOpacity
              onPress={() => setShowDeleteConfirm(true)}
              hitSlop={8}
              accessibilityRole="button"
              accessibilityLabel="Delete group"
            >
              <Ionicons name="trash-outline" size={22} color="#FF3B30" />
            </TouchableOpacity>
          </View>
        ) : (
          <TouchableOpacity
            onPress={() => setShowLeaveConfirm(true)}
            hitSlop={8}
            accessibilityRole="button"
            accessibilityLabel="Leave group"
          >
            <Ionicons name="exit-outline" size={22} color="#FF3B30" />
          </TouchableOpacity>
        )}
      </View>

      <FlatList
        data={capsules ?? []}
        keyExtractor={item => item.id}
        renderItem={({ item }) => (
          <CapsuleRow
            item={item}
            onPress={() => navigation.navigate('CapsuleDetail', { capsuleId: item.id })}
          />
        )}
        contentContainerStyle={styles.listContent}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={accentColor} />}
        ListHeaderComponent={
          <View>
            {/* Gate on the UNFILTERED roster (memberList, not visibleMembers):
                the nudge is about actual group size — a group whose only other
                member is blocked is still a 2-person group, not one that needs
                the "add members" prompt. */}
            {route.params.justCreated && !nudgeDismissed && memberList.length === 1 && (
              <View style={[styles.inviteNudge, { borderColor: `${accentColor}40`, backgroundColor: `${accentColor}10` }]}>
                <Ionicons name="person-add-outline" size={22} color={accentColor} />
                <View style={styles.inviteNudgeTextWrap}>
                  <Text style={styles.inviteNudgeTitle}>Add members</Text>
                  <Text style={styles.inviteNudgeSub}>Groups are better together — everyone joins each new capsule automatically.</Text>
                </View>
                <TouchableOpacity
                  style={[styles.inviteNudgeBtn, { backgroundColor: accentColor }]}
                  onPress={() => navigation.navigate('ManageGroup', { groupId })}
                >
                  <Text style={styles.inviteNudgeBtnText}>Add</Text>
                </TouchableOpacity>
                <TouchableOpacity
                  style={styles.inviteNudgeClose}
                  onPress={() => setNudgeDismissed(true)}
                  accessibilityRole="button"
                  accessibilityLabel="Dismiss add members prompt"
                  hitSlop={8}
                >
                  <Ionicons name="close" size={16} color="#888888" />
                </TouchableOpacity>
              </View>
            )}

            <View style={styles.meta}>
              <View style={styles.metaRow}>
                <View style={styles.memberRow}>
                  {visibleMembers.slice(0, 5).map(m => (
                    <MemberBubble
                      key={m.user_id}
                      avatarUrl={m.users?.avatar_url ?? null}
                      displayName={m.users?.display_name ?? null}
                      isCreator={m.user_id === group.created_by}
                      accentColor={accentColor}
                    />
                  ))}
                  {visibleMembers.length > 5 && (
                    <View style={styles.memberOverflow}>
                      <Text style={styles.memberOverflowText}>+{visibleMembers.length - 5}</Text>
                    </View>
                  )}
                </View>
                <Text style={styles.memberCount}>{visibleMembers.length} member{visibleMembers.length !== 1 ? 's' : ''}</Text>
              </View>
              <View style={styles.badges}>
                <View style={styles.badge}>
                  <Ionicons name="repeat-outline" size={13} color="#888888" />
                  <Text style={styles.badgeText}>{recurrenceLabel(group.recurrence_interval)}</Text>
                </View>
                {isPaused ? (
                  <View style={styles.badge}>
                    <Ionicons name="pause-circle-outline" size={13} color="#888888" />
                    <Text style={styles.badgeText}>Paused</Text>
                  </View>
                ) : nextDate && (
                  <View style={styles.badge}>
                    <Ionicons name="calendar-outline" size={13} color="#888888" />
                    <Text style={styles.badgeText}>
                      Next {nextDate.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}
                    </Text>
                  </View>
                )}
              </View>
            </View>

            <TouchableOpacity
              style={[styles.newCapsuleBtn, { backgroundColor: accentColor }]}
              onPress={() => navigation.navigate('CreateCapsule', {
                groupId,
                groupUnlockHours: group.unlock_duration_hours,
              })}
            >
              <Ionicons name="add" size={20} color="#FFFFFF" />
              <Text style={styles.newCapsuleBtnText}>Start New Capsule</Text>
            </TouchableOpacity>

            <Text style={styles.sectionLabel}>Capsules</Text>
          </View>
        }
        ListEmptyComponent={
          capsulesLoading ? (
            <ActivityIndicator color={accentColor} style={{ marginTop: 24 }} />
          ) : (
            <View style={styles.empty}>
              <Ionicons name="time-outline" size={40} color="#333333" />
              <Text style={styles.emptyText}>No capsules yet</Text>
              <Text style={styles.emptySubtext}>
                {nextDate
                  ? `Your first capsule arrives ${nextDate.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })} — or start one now.`
                  : 'Start a new capsule to capture memories with this group.'}
              </Text>
            </View>
          )
        }
      />

      <ConfirmModal
        visible={showDeleteConfirm}
        title="Delete Group"
        message={`Delete "${group.name}"? This won't delete any existing capsules.`}
        confirmLabel="Delete"
        destructive
        loading={deleting}
        onConfirm={handleDelete}
        onCancel={() => setShowDeleteConfirm(false)}
      />
      <ConfirmModal
        visible={showLeaveConfirm}
        title="Leave Group"
        message={`Leave "${group.name}"? You'll no longer see new capsules created for this group.`}
        confirmLabel="Leave"
        destructive
        loading={leaving}
        onConfirm={handleLeave}
        onCancel={() => setShowLeaveConfirm(false)}
      />
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#0A0A0A' },
  header: {
    flexDirection: 'row', alignItems: 'center', gap: 12,
    paddingHorizontal: 20, paddingVertical: 12,
  },
  headerTitle: { flex: 1, fontSize: 20, fontWeight: '700', color: '#FFFFFF' },
  headerActions: { flexDirection: 'row', alignItems: 'center', gap: 18 },
  meta: {
    marginHorizontal: 20, marginTop: 8, marginBottom: 16,
    backgroundColor: '#1A1A1A', borderRadius: 16, padding: 16, gap: 12,
    borderWidth: 1, borderColor: '#2A2A2A',
  },
  metaRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  memberRow: { flexDirection: 'row', alignItems: 'center' },
  memberBubble: { marginRight: -8, position: 'relative' },
  memberAvatar: { width: 32, height: 32, borderRadius: 16, borderWidth: 2, borderColor: '#1A1A1A' },
  memberAvatarFallback: {
    width: 32, height: 32, borderRadius: 16,
    backgroundColor: '#333333', alignItems: 'center', justifyContent: 'center',
    borderWidth: 2, borderColor: '#1A1A1A',
  },
  memberAvatarInitial: { fontSize: 13, fontWeight: '700', color: '#FFFFFF' },
  creatorBadge: {
    position: 'absolute', bottom: -2, right: -2,
    width: 14, height: 14, borderRadius: 7,
    alignItems: 'center', justifyContent: 'center',
    borderWidth: 1.5, borderColor: '#1A1A1A',
  },
  memberOverflow: {
    width: 32, height: 32, borderRadius: 16,
    backgroundColor: '#2A2A2A', alignItems: 'center', justifyContent: 'center',
    borderWidth: 2, borderColor: '#1A1A1A', marginRight: -8,
  },
  memberOverflowText: { fontSize: 11, fontWeight: '700', color: '#888888' },
  memberCount: { fontSize: 13, color: '#666666' },
  badges: { flexDirection: 'row', gap: 8, flexWrap: 'wrap' },
  badge: {
    flexDirection: 'row', alignItems: 'center', gap: 4,
    backgroundColor: '#111111', borderRadius: 8, paddingVertical: 4, paddingHorizontal: 8,
    borderWidth: 1, borderColor: '#2A2A2A',
  },
  badgeText: { fontSize: 12, color: '#888888' },
  newCapsuleBtn: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8,
    marginHorizontal: 20, marginBottom: 24,
    borderRadius: 16, paddingVertical: 14,
  },
  newCapsuleBtnText: { color: '#FFFFFF', fontWeight: '700', fontSize: 16 },
  sectionLabel: {
    fontSize: 13, fontWeight: '600', color: '#555555',
    paddingHorizontal: 20, marginBottom: 8, textTransform: 'uppercase', letterSpacing: 0.5,
  },
  listContent: { paddingBottom: 40 },
  capsuleRow: {
    flexDirection: 'row', alignItems: 'center', gap: 14,
    paddingHorizontal: 20, paddingVertical: 14,
    borderBottomWidth: 1, borderBottomColor: '#1A1A1A',
  },
  capsuleRowIcon: {
    width: 36, height: 36, borderRadius: 10,
    backgroundColor: '#1A1A1A', alignItems: 'center', justifyContent: 'center',
  },
  capsuleRowText: { flex: 1, gap: 2 },
  capsuleRowTitle: { fontSize: 15, fontWeight: '600', color: '#FFFFFF' },
  capsuleRowDate: { fontSize: 12, color: '#666666' },
  empty: { alignItems: 'center', paddingTop: 48, paddingHorizontal: 40, gap: 12 },
  emptyText: { fontSize: 17, fontWeight: '700', color: '#888888', textAlign: 'center' },
  emptySubtext: { fontSize: 14, color: '#888888', textAlign: 'center', lineHeight: 20 },
  inviteNudge: {
    flexDirection: 'row', alignItems: 'center', gap: 12,
    borderRadius: 14, borderWidth: 1, padding: 14,
    marginHorizontal: 20, marginTop: 8,
  },
  inviteNudgeTextWrap: { flex: 1, gap: 2 },
  inviteNudgeTitle: { fontSize: 15, fontWeight: '700', color: '#FFFFFF' },
  inviteNudgeSub: { fontSize: 12, color: '#AAAAAA', lineHeight: 16 },
  inviteNudgeBtn: { borderRadius: 10, paddingHorizontal: 14, paddingVertical: 9 },
  inviteNudgeBtnText: { color: '#FFFFFF', fontWeight: '700', fontSize: 13 },
  inviteNudgeClose: { padding: 2 },
});
