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
import { sessionStore } from '../../lib/sessionStore';
import { cache } from '../../lib/cache';
import { useCachedFetch } from '../../hooks/useCachedFetch';
import { useTheme } from '../../context/ThemeContext';
import ConfirmModal from '../../components/ConfirmModal';
import {
  getGroup, getGroupMembers, deleteGroup, removeGroupMember,
  GroupRow, GroupMemberProfile, recurrenceLabel,
} from '../../lib/groups';
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

function MemberBubble({ avatarUrl, displayName }: { avatarUrl: string | null; displayName: string | null }) {
  return (
    <View style={styles.memberBubble}>
      {avatarUrl ? (
        <Image source={`${avatarUrl}?t=1`} style={styles.memberAvatar} contentFit="cover" />
      ) : (
        <View style={styles.memberAvatarFallback}>
          <Text style={styles.memberAvatarInitial}>
            {(displayName ?? '?')[0].toUpperCase()}
          </Text>
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

  const { data: group, loading: groupLoading, refresh: refreshGroup } = useCachedFetch<GroupRow | null>(
    `group:${groupId}`,
    () => getGroup(groupId),
  );

  const { data: members, refresh: refreshMembers } = useCachedFetch<GroupMemberProfile[]>(
    `group-members:${groupId}`,
    () => getGroupMembers(groupId),
  );

  const { data: capsules, loading: capsulesLoading, refresh: refreshCapsules } = useCachedFetch<GroupCapsule[]>(
    `group-capsules:${groupId}`,
    async () => {
      const session = sessionStore.get();
      if (!session) return [];
      const { data } = await supabase
        .from('capsule_members')
        .select('capsule_id, capsules(id, title, status, unlock_at, owner_id, group_id)')
        .eq('user_id', session.user.id)
        .not('joined_at', 'is', null);
      if (!data) return [];
      return data
        .map((r: any) => r.capsules)
        .filter((c: any) => c && c.group_id === groupId)
        .sort((a: GroupCapsule, b: GroupCapsule) =>
          new Date(b.unlock_at).getTime() - new Date(a.unlock_at).getTime()
        );
    },
  );

  const onRefresh = useCallback(async () => {
    setRefreshing(true);
    await Promise.all([refreshGroup(), refreshMembers(), refreshCapsules()]);
    setRefreshing(false);
  }, [refreshGroup, refreshMembers, refreshCapsules]);

  async function handleDelete() {
    setDeleting(true);
    await deleteGroup(groupId);
    cache.invalidate('groups');
    setDeleting(false);
    setShowDeleteConfirm(false);
    navigation.goBack();
  }

  async function handleLeave() {
    if (!userId) return;
    setLeaving(true);
    await removeGroupMember(groupId, userId);
    cache.invalidate('groups');
    setLeaving(false);
    setShowLeaveConfirm(false);
    navigation.goBack();
  }

  const isCreator = group?.created_by === userId;

  if (groupLoading && !group) {
    return (
      <SafeAreaView style={styles.container} edges={['top', 'left', 'right']}>
        <View style={styles.header}>
          <TouchableOpacity onPress={() => navigation.goBack()} hitSlop={8}>
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
          <TouchableOpacity onPress={() => navigation.goBack()} hitSlop={8}>
            <Ionicons name="arrow-back" size={24} color="#FFFFFF" />
          </TouchableOpacity>
        </View>
        <View style={styles.empty}>
          <Text style={styles.emptyText}>Group not found</Text>
        </View>
      </SafeAreaView>
    );
  }

  const nextDate = group.next_capsule_at ? new Date(group.next_capsule_at) : null;
  const memberList = members ?? [];

  return (
    <SafeAreaView style={styles.container} edges={['top', 'left', 'right']}>
      <View style={styles.header}>
        <TouchableOpacity onPress={() => navigation.goBack()} hitSlop={8}>
          <Ionicons name="arrow-back" size={24} color="#FFFFFF" />
        </TouchableOpacity>
        <Text style={styles.headerTitle} numberOfLines={1}>{group.name}</Text>
        {isCreator ? (
          <TouchableOpacity onPress={() => setShowDeleteConfirm(true)} hitSlop={8}>
            <Ionicons name="trash-outline" size={22} color="#FF3B30" />
          </TouchableOpacity>
        ) : (
          <TouchableOpacity onPress={() => setShowLeaveConfirm(true)} hitSlop={8}>
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
            <View style={styles.meta}>
              <View style={styles.metaRow}>
                <View style={styles.memberRow}>
                  {memberList.slice(0, 5).map(m => (
                    <MemberBubble
                      key={m.user_id}
                      avatarUrl={m.users?.avatar_url ?? null}
                      displayName={m.users?.display_name ?? null}
                    />
                  ))}
                  {memberList.length > 5 && (
                    <View style={styles.memberOverflow}>
                      <Text style={styles.memberOverflowText}>+{memberList.length - 5}</Text>
                    </View>
                  )}
                </View>
                <Text style={styles.memberCount}>{memberList.length} member{memberList.length !== 1 ? 's' : ''}</Text>
              </View>
              <View style={styles.badges}>
                <View style={styles.badge}>
                  <Ionicons name="repeat-outline" size={13} color="#888888" />
                  <Text style={styles.badgeText}>{recurrenceLabel(group.recurrence_interval)}</Text>
                </View>
                {nextDate && (
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
              onPress={() => navigation.navigate('Tabs', {
                screen: 'Create',
                params: { groupId, groupUnlockHours: group.unlock_duration_hours },
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
              <Text style={styles.emptySubtext}>Start a new capsule to capture memories with this group.</Text>
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
  meta: {
    marginHorizontal: 20, marginTop: 8, marginBottom: 16,
    backgroundColor: '#1A1A1A', borderRadius: 16, padding: 16, gap: 12,
    borderWidth: 1, borderColor: '#2A2A2A',
  },
  metaRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  memberRow: { flexDirection: 'row', alignItems: 'center' },
  memberBubble: { marginRight: -8 },
  memberAvatar: { width: 32, height: 32, borderRadius: 16, borderWidth: 2, borderColor: '#1A1A1A' },
  memberAvatarFallback: {
    width: 32, height: 32, borderRadius: 16,
    backgroundColor: '#333333', alignItems: 'center', justifyContent: 'center',
    borderWidth: 2, borderColor: '#1A1A1A',
  },
  memberAvatarInitial: { fontSize: 13, fontWeight: '700', color: '#FFFFFF' },
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
  emptyText: { fontSize: 17, fontWeight: '700', color: '#555555', textAlign: 'center' },
  emptySubtext: { fontSize: 14, color: '#444444', textAlign: 'center', lineHeight: 20 },
});
