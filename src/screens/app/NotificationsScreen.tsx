import React, { useState, useCallback } from 'react';
import {
  View, Text, StyleSheet, ScrollView, Animated,
  TouchableOpacity, RefreshControl,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useNavigation } from '@react-navigation/native';
import { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { supabase } from '../../lib/supabase';
import { sessionStore } from '../../lib/sessionStore';
import { Ionicons } from '@expo/vector-icons';
import { AppStackParamList } from '../../types/navigation';
import { useTheme } from '../../context/ThemeContext';
import { SkeletonNotificationRow } from '../../components/Skeleton';
import { useCachedFetch } from '../../hooks/useCachedFetch';
import { cache } from '../../lib/cache';
import { acceptFriendRequest, removeFriendship } from '../../lib/friends';
import { haptics } from '../../lib/haptics';
import { useListItemEntrance, useFadeIn } from '../../lib/animations';

type Actor = { id: string; display_name: string; avatar_url: string | null };

type NotificationRow = {
  id: string;
  capsule_id: string | null;
  actor_id: string | null;
  type:
    | 'invite'
    | 'unlock'
    | 'unlock_reminder'
    | 'reaction'
    | 'superlative_suggested'
    | 'superlative_closing_soon'
    | 'superlative_won'
    | 'friend_request'
    | 'friend_accept';
  sent_at: string;
  read_at: string | null;
  capsules: { title: string } | null;
  actor: Actor | null;
};

const SUPERLATIVE_TYPES: NotificationRow['type'][] = [
  'superlative_suggested',
  'superlative_closing_soon',
  'superlative_won',
];

function isCapsuleNav(type: NotificationRow['type']) {
  return (
    type === 'unlock' ||
    type === 'unlock_reminder' ||
    type === 'reaction' ||
    type === 'superlative_suggested' ||
    type === 'superlative_closing_soon' ||
    type === 'superlative_won'
  );
}

type DisplayNotification = NotificationRow & { reactionCount?: number };

type PendingMember = {
  id: string;
  capsule_id: string;
};

type NotifData = {
  notifications: DisplayNotification[];
  pendingMap: Record<string, string>;
};

function processNotifications(raw: NotificationRow[]): DisplayNotification[] {
  const display: DisplayNotification[] = [];
  const reactionGroups: Record<string, { latest: NotificationRow; count: number }> = {};

  for (const n of raw) {
    if (n.type === 'reaction' && n.capsule_id) {
      const cid = n.capsule_id;
      if (!reactionGroups[cid]) {
        reactionGroups[cid] = { latest: n, count: 0 };
      }
      reactionGroups[cid].count++;
      if (n.sent_at > reactionGroups[cid].latest.sent_at) {
        reactionGroups[cid].latest = n;
      }
    } else {
      display.push(n);
    }
  }

  for (const group of Object.values(reactionGroups)) {
    display.push({ ...group.latest, reactionCount: group.count });
  }

  display.sort((a, b) => (a.sent_at < b.sent_at ? 1 : -1));
  return display;
}

function AnimatedNotificationCard({ index, children }: { index: number; children: React.ReactNode }) {
  const entrance = useListItemEntrance(index);
  return <Animated.View style={entrance}>{children}</Animated.View>;
}

export default function NotificationsScreen() {
  const { accentColor } = useTheme();
  const navigation = useNavigation<NativeStackNavigationProp<AppStackParamList>>();
  const [notifications, setNotifications] = useState<DisplayNotification[]>([]);
  const [pendingMap, setPendingMap] = useState<Record<string, string>>({});
  const [refreshing, setRefreshing] = useState(false);
  const [accepting, setAccepting] = useState<string | null>(null);
  const headerAnim = useFadeIn(0, 250);

  const { loading } = useCachedFetch<NotifData>(
    'notifications',
    async () => {
      const session = sessionStore.get();
      const userId = session?.user?.id;
      if (!userId) return { notifications: [], pendingMap: {} };

      const [notifsRes, pendingRes] = await Promise.all([
        supabase
          .from('notifications')
          .select('id, capsule_id, actor_id, type, sent_at, read_at, capsules(title), actor:users!notifications_actor_id_fkey(id, display_name, avatar_url)')
          .eq('user_id', userId)
          .is('read_at', null)
          .order('sent_at', { ascending: false }),
        supabase
          .from('capsule_members')
          .select('id, capsule_id')
          .eq('user_id', userId)
          .is('joined_at', null)
          .neq('role', 'owner'),
      ]);

      const notifs = processNotifications((notifsRes.data ?? []) as NotificationRow[]);
      const map: Record<string, string> = {};
      for (const m of (pendingRes.data ?? []) as PendingMember[]) {
        map[m.capsule_id] = m.id;
      }

      setNotifications(notifs);
      setPendingMap(map);
      return { notifications: notifs, pendingMap: map };
    },
  );

  function dismiss(item: DisplayNotification) {
    // Optimistic remove
    if (item.type === 'reaction') {
      setNotifications(prev => prev.filter(n => !(n.type === 'reaction' && n.capsule_id === item.capsule_id)));
    } else {
      setNotifications(prev => prev.filter(n => n.id !== item.id));
    }
    void persistRead(item);
  }

  // Persist read_at. IMPORTANT: a supabase query only runs when it is awaited /
  // then'd — a bare `supabase...update()` expression is a silent no-op, which is
  // why dismissed notifications (e.g. an accepted friend request) kept reappearing
  // after a tab switch. We await, then invalidate the cache *after* the write
  // commits so a focus-refetch can't resurrect the row from the still-unread DB state.
  async function persistRead(item: DisplayNotification) {
    const session = sessionStore.get();
    if (!session) return;
    const now = new Date().toISOString();
    const query = item.type === 'reaction' && item.capsule_id
      ? supabase.from('notifications')
          .update({ read_at: now })
          .eq('user_id', session.user.id)
          .eq('capsule_id', item.capsule_id)
          .eq('type', 'reaction')
      : supabase.from('notifications').update({ read_at: now }).eq('id', item.id);
    const { error } = await query;
    if (error) {
      console.warn('Failed to mark notification read:', error.message);
      return;
    }
    cache.invalidate('notifications');
  }

  async function accept(notif: DisplayNotification) {
    const capsuleId = notif.capsule_id;
    if (!capsuleId) return;
    const memberId = pendingMap[capsuleId];
    if (!memberId) return;
    setAccepting(notif.id);
    const { error } = await supabase
      .from('capsule_members')
      .update({ joined_at: new Date().toISOString() })
      .eq('id', memberId);

    if (!error) {
      haptics.success();
      dismiss(notif);
      setPendingMap(prev => {
        const next = { ...prev };
        delete next[capsuleId];
        return next;
      });
      cache.invalidate('capsules', 'profile');
      navigation.navigate('CapsuleDetail', { capsuleId });
    }
    setAccepting(null);
  }

  async function acceptFriend(item: DisplayNotification) {
    if (!item.actor_id) return;
    setAccepting(item.id);
    const { error } = await acceptFriendRequest(item.actor_id);
    if (!error) {
      haptics.success();
      dismiss(item);
      cache.invalidate('profile');
    }
    setAccepting(null);
  }

  function declineFriend(item: DisplayNotification) {
    if (!item.actor_id) return;
    haptics.light();
    removeFriendship(item.actor_id);
    dismiss(item);
  }

  async function onRefresh() {
    setRefreshing(true);
    cache.invalidate('notifications');
    setRefreshing(false);
  }

  function formatDate(iso: string) {
    return new Date(iso).toLocaleDateString('en-US', {
      month: 'short', day: 'numeric', year: 'numeric',
    });
  }

  const pendingCount = Object.keys(pendingMap).length;

  if (loading) {
    return (
      <SafeAreaView style={styles.container}>
        <View style={styles.header}>
          <View style={{ width: 180, height: 28, borderRadius: 8, backgroundColor: '#1A1A1A' }} />
        </View>
        <View style={styles.list}>
          <SkeletonNotificationRow />
          <SkeletonNotificationRow />
          <SkeletonNotificationRow />
          <SkeletonNotificationRow />
        </View>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={styles.container}>
      <ScrollView
        style={styles.fill}
        contentContainerStyle={styles.scrollContent}
        alwaysBounceVertical
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={accentColor} />}
      >
        <Animated.View style={[styles.header, headerAnim]}>
          <Text style={styles.title}>Notifications</Text>
          {pendingCount > 0 && (
            <View style={[styles.badge, { backgroundColor: accentColor }]}>
              <Text style={styles.badgeText}>{pendingCount}</Text>
            </View>
          )}
        </Animated.View>
        {notifications.length === 0 ? (
          <View style={styles.empty}>
            <View style={styles.emptyIconWrap}>
              <Ionicons name="notifications-outline" size={40} color="#555555" />
              <View style={styles.emptyIconCheck}>
                <Ionicons name="checkmark-circle" size={22} color="#30D158" />
              </View>
            </View>
            <Text style={styles.emptyText}>You're all caught up</Text>
            <Text style={styles.emptySubtext}>
              Invites, unlocks, and reactions will show up here.
            </Text>
          </View>
        ) : (
          <View style={styles.list}>
          {notifications.map((item, idx) => {
            const isPending = item.type === 'invite' && !!item.capsule_id && !!pendingMap[item.capsule_id];
            const isAccepted = item.type === 'invite' && (!item.capsule_id || !pendingMap[item.capsule_id]);
            const key = item.type === 'reaction' ? `reaction-${item.capsule_id}` : item.id;

            return (
              <AnimatedNotificationCard key={key} index={idx}>
              <TouchableOpacity
                style={styles.card}
                activeOpacity={0.7}
                onPress={() => {
                  if (isCapsuleNav(item.type) && item.capsule_id) {
                    dismiss(item);
                    navigation.navigate('CapsuleDetail', { capsuleId: item.capsule_id });
                  } else if (item.type === 'invite' && item.capsule_id && !pendingMap[item.capsule_id]) {
                    // accepted invite — tap to open capsule and dismiss
                    dismiss(item);
                    navigation.navigate('CapsuleDetail', { capsuleId: item.capsule_id });
                  } else if (item.type === 'friend_accept' && item.actor_id) {
                    dismiss(item);
                    navigation.navigate('PublicProfile', { userId: item.actor_id });
                  }
                }}
              >
                <Ionicons
                  name={
                    item.type === 'unlock' ? 'lock-open-outline'
                    : item.type === 'unlock_reminder' ? 'hourglass-outline'
                    : item.type === 'reaction' ? 'heart-outline'
                    : item.type === 'superlative_won' ? 'trophy'
                    : item.type === 'superlative_closing_soon' ? 'time-outline'
                    : item.type === 'superlative_suggested' ? 'sparkles-outline'
                    : item.type === 'friend_request' ? 'person-add-outline'
                    : item.type === 'friend_accept' ? 'people'
                    : 'cube-outline'
                  }
                  size={28}
                  color={
                    item.type === 'unlock' ? '#30D158'
                    : item.type === 'unlock_reminder' ? accentColor
                    : item.type === 'friend_accept' ? '#30D158'
                    : item.type === 'reaction' ? accentColor
                    : item.type === 'friend_request' ? accentColor
                    : SUPERLATIVE_TYPES.includes(item.type) ? accentColor
                    : '#888888'
                  }
                />
                <View style={styles.cardBody}>
                  <Text style={styles.cardText}>
                    {item.type === 'unlock' ? (
                      <>
                        <Text style={styles.cardCapsuleTitle}>{item.capsules?.title ?? 'A capsule'}</Text>
                        {' '}just unlocked!
                      </>
                    ) : item.type === 'unlock_reminder' ? (
                      <>
                        <Text style={styles.cardCapsuleTitle}>{item.capsules?.title ?? 'A capsule'}</Text>
                        {' '}is unlocking soon
                      </>
                    ) : item.type === 'reaction' ? (
                      <>
                        {(item.reactionCount ?? 1) > 1
                          ? `${item.reactionCount} people reacted to your photos in `
                          : 'Someone reacted to your photo in '}
                        <Text style={styles.cardCapsuleTitle}>{item.capsules?.title ?? 'a capsule'}</Text>
                      </>
                    ) : item.type === 'superlative_won' ? (
                      <>
                        You won an award in{' '}
                        <Text style={styles.cardCapsuleTitle}>{item.capsules?.title ?? 'a capsule'}</Text>
                        {' '}🎉
                      </>
                    ) : item.type === 'superlative_closing_soon' ? (
                      <>
                        Voting closes in 2 hours in{' '}
                        <Text style={styles.cardCapsuleTitle}>{item.capsules?.title ?? 'a capsule'}</Text>
                      </>
                    ) : item.type === 'superlative_suggested' ? (
                      <>
                        A new award category was suggested in{' '}
                        <Text style={styles.cardCapsuleTitle}>{item.capsules?.title ?? 'a capsule'}</Text>
                      </>
                    ) : item.type === 'friend_request' ? (
                      <>
                        <Text style={styles.cardCapsuleTitle}>{item.actor?.display_name ?? 'Someone'}</Text>
                        {' '}sent you a friend request
                      </>
                    ) : item.type === 'friend_accept' ? (
                      <>
                        <Text style={styles.cardCapsuleTitle}>{item.actor?.display_name ?? 'Someone'}</Text>
                        {' '}accepted your friend request
                      </>
                    ) : (
                      <>
                        You were invited to{' '}
                        <Text style={styles.cardCapsuleTitle}>{item.capsules?.title ?? 'a capsule'}</Text>
                      </>
                    )}
                  </Text>
                  <Text style={styles.cardDate}>{formatDate(item.sent_at)}</Text>
                </View>

                {item.type === 'invite' && isPending && (
                  <TouchableOpacity
                    style={[styles.acceptBtn, { backgroundColor: accentColor }]}
                    onPress={() => accept(item)}
                    disabled={accepting === item.id}
                  >
                    <Text style={styles.acceptBtnText}>
                      {accepting === item.id ? '…' : 'Accept'}
                    </Text>
                  </TouchableOpacity>
                )}

                {item.type === 'invite' && isAccepted && (
                  <View style={styles.joinedBadge}>
                    <Text style={styles.joinedText}>Joined</Text>
                  </View>
                )}

                {item.type === 'friend_request' && (
                  <View style={styles.friendActions}>
                    <TouchableOpacity
                      style={[styles.acceptBtn, { backgroundColor: accentColor }]}
                      onPress={() => acceptFriend(item)}
                      disabled={accepting === item.id}
                    >
                      <Text style={styles.acceptBtnText}>{accepting === item.id ? '…' : 'Accept'}</Text>
                    </TouchableOpacity>
                    <TouchableOpacity style={styles.declineBtn} onPress={() => declineFriend(item)}>
                      <Ionicons name="close" size={18} color="#888888" />
                    </TouchableOpacity>
                  </View>
                )}

                {isCapsuleNav(item.type) && (
                  <Ionicons name="chevron-forward" size={18} color="#555555" />
                )}
              </TouchableOpacity>
              </AnimatedNotificationCard>
            );
          })}
          </View>
        )}
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#0A0A0A' },
  header: {
    paddingHorizontal: 24, paddingTop: 16, paddingBottom: 8,
    flexDirection: 'row', alignItems: 'center', gap: 10,
  },
  title: { fontSize: 28, fontWeight: '800', color: '#FFFFFF' },
  badge: {
    backgroundColor: '#FF6B35', borderRadius: 10,
    paddingHorizontal: 8, paddingVertical: 2,
  },
  badgeText: { color: '#FFFFFF', fontWeight: '700', fontSize: 13 },
  empty: { flex: 1, justifyContent: 'center', alignItems: 'center', gap: 16, paddingHorizontal: 40, paddingBottom: 80 },
  emptyIconWrap: {
    width: 88, height: 88, borderRadius: 44, backgroundColor: '#1A1A1A',
    alignItems: 'center', justifyContent: 'center', marginBottom: 8,
  },
  emptyIconCheck: { position: 'absolute', bottom: 6, right: 6 },
  emptyText: { fontSize: 22, fontWeight: '800', color: '#FFFFFF', textAlign: 'center' },
  emptySubtext: { fontSize: 15, color: '#888888', textAlign: 'center', lineHeight: 22 },
  fill: { flex: 1 },
  scrollContent: { flexGrow: 1 },
  list: { paddingHorizontal: 16, paddingBottom: 32, gap: 12 },
  card: {
    flexDirection: 'row', alignItems: 'center',
    backgroundColor: '#1A1A1A', borderRadius: 16,
    padding: 16, gap: 14, borderWidth: 1, borderColor: '#2A2A2A',
  },
  cardBody: { flex: 1, gap: 4 },
  cardText: { fontSize: 14, color: '#CCCCCC', lineHeight: 20 },
  cardCapsuleTitle: { color: '#FFFFFF', fontWeight: '700' },
  cardDate: { fontSize: 12, color: '#555555' },
  acceptBtn: {
    backgroundColor: '#FF6B35', borderRadius: 10,
    paddingHorizontal: 16, paddingVertical: 9,
  },
  acceptBtnText: { color: '#FFFFFF', fontWeight: '700', fontSize: 14 },
  joinedBadge: {
    backgroundColor: '#30D15820', borderRadius: 10,
    paddingHorizontal: 12, paddingVertical: 7,
  },
  joinedText: { color: '#30D158', fontWeight: '700', fontSize: 13 },
  friendActions: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  declineBtn: {
    width: 34, height: 34, borderRadius: 10, borderWidth: 1, borderColor: '#2A2A2A',
    alignItems: 'center', justifyContent: 'center',
  },
});
