import React, { useState, useCallback } from 'react';
import {
  View, Text, StyleSheet, SafeAreaView, ScrollView,
  TouchableOpacity, ActivityIndicator, RefreshControl,
} from 'react-native';
import { useFocusEffect, useNavigation } from '@react-navigation/native';
import { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { supabase } from '../../lib/supabase';
import { sessionStore } from '../../lib/sessionStore';
import { Ionicons } from '@expo/vector-icons';
import { AppStackParamList } from '../../types/navigation';
import { useTheme } from '../../context/ThemeContext';

type NotificationRow = {
  id: string;
  capsule_id: string;
  type: 'invite' | 'unlock' | 'reaction';
  sent_at: string;
  read_at: string | null;
  capsules: { title: string } | null;
};

type DisplayNotification = NotificationRow & { reactionCount?: number };

type PendingMember = {
  id: string;
  capsule_id: string;
};

export default function NotificationsScreen() {
  const { accentColor } = useTheme();
  const navigation = useNavigation<NativeStackNavigationProp<AppStackParamList>>();
  const [notifications, setNotifications] = useState<DisplayNotification[]>([]);
  const [pendingMap, setPendingMap] = useState<Record<string, string>>({}); // capsule_id → member row id
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [accepting, setAccepting] = useState<string | null>(null);

  async function fetchAll() {
    const session = sessionStore.get();
    const userId = session?.user?.id;
    if (!userId) return;

    const [notifsRes, pendingRes] = await Promise.all([
      supabase
        .from('notifications')
        .select('id, capsule_id, type, sent_at, read_at, capsules(title)')
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

    if (notifsRes.data) {
      const raw = notifsRes.data as NotificationRow[];
      const display: DisplayNotification[] = [];
      const reactionGroups: Record<string, { latest: NotificationRow; count: number }> = {};

      for (const n of raw) {
        if (n.type === 'reaction') {
          if (!reactionGroups[n.capsule_id]) {
            reactionGroups[n.capsule_id] = { latest: n, count: 0 };
          }
          reactionGroups[n.capsule_id].count++;
          if (n.sent_at > reactionGroups[n.capsule_id].latest.sent_at) {
            reactionGroups[n.capsule_id].latest = n;
          }
        } else {
          display.push(n);
        }
      }

      for (const group of Object.values(reactionGroups)) {
        display.push({ ...group.latest, reactionCount: group.count });
      }

      display.sort((a, b) => (a.sent_at < b.sent_at ? 1 : -1));
      setNotifications(display);
    }

    const map: Record<string, string> = {};
    for (const m of (pendingRes.data ?? []) as PendingMember[]) {
      map[m.capsule_id] = m.id;
    }
    setPendingMap(map);
  }

  useFocusEffect(useCallback(() => {
    setLoading(true);
    fetchAll().finally(() => setLoading(false));
  }, []));

  function dismiss(item: DisplayNotification) {
    // Optimistic remove
    if (item.type === 'reaction') {
      setNotifications(prev => prev.filter(n => !(n.type === 'reaction' && n.capsule_id === item.capsule_id)));
    } else {
      setNotifications(prev => prev.filter(n => n.id !== item.id));
    }
    // Persist read_at in background
    const session = sessionStore.get();
    if (!session) return;
    const now = new Date().toISOString();
    if (item.type === 'reaction') {
      supabase.from('notifications')
        .update({ read_at: now })
        .eq('user_id', session.user.id)
        .eq('capsule_id', item.capsule_id)
        .eq('type', 'reaction');
    } else {
      supabase.from('notifications').update({ read_at: now }).eq('id', item.id);
    }
  }

  async function accept(notif: DisplayNotification) {
    const memberId = pendingMap[notif.capsule_id];
    if (!memberId) return;
    setAccepting(notif.id);
    const { error } = await supabase
      .from('capsule_members')
      .update({ joined_at: new Date().toISOString() })
      .eq('id', memberId);

    if (!error) {
      dismiss(notif);
      setPendingMap(prev => {
        const next = { ...prev };
        delete next[notif.capsule_id];
        return next;
      });
      navigation.navigate('CapsuleDetail', { capsuleId: notif.capsule_id });
    }
    setAccepting(null);
  }

  async function onRefresh() {
    setRefreshing(true);
    await fetchAll();
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
        <ActivityIndicator color={accentColor} style={{ marginTop: 80 }} />
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
        <View style={styles.header}>
          <Text style={styles.title}>Notifications</Text>
          {pendingCount > 0 && (
            <View style={[styles.badge, { backgroundColor: accentColor }]}>
              <Text style={styles.badgeText}>{pendingCount}</Text>
            </View>
          )}
        </View>
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
          {notifications.map(item => {
            const isPending = item.type === 'invite' && !!pendingMap[item.capsule_id];
            const isAccepted = item.type === 'invite' && !pendingMap[item.capsule_id];
            const key = item.type === 'reaction' ? `reaction-${item.capsule_id}` : item.id;

            return (
              <TouchableOpacity
                key={key}
                style={styles.card}
                activeOpacity={0.7}
                onPress={() => {
                  if (item.type === 'unlock' || item.type === 'reaction') {
                    dismiss(item);
                    navigation.navigate('CapsuleDetail', { capsuleId: item.capsule_id });
                  } else if (item.type === 'invite' && !pendingMap[item.capsule_id]) {
                    // accepted invite — tap to open capsule and dismiss
                    dismiss(item);
                    navigation.navigate('CapsuleDetail', { capsuleId: item.capsule_id });
                  }
                }}
              >
                <Ionicons
                  name={
                    item.type === 'unlock' ? 'lock-open-outline'
                    : item.type === 'reaction' ? 'heart-outline'
                    : 'cube-outline'
                  }
                  size={28}
                  color={
                    item.type === 'unlock' ? '#30D158'
                    : item.type === 'reaction' ? accentColor
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
                    ) : item.type === 'reaction' ? (
                      <>
                        {(item.reactionCount ?? 1) > 1
                          ? `${item.reactionCount} people reacted to your photos in `
                          : 'Someone reacted to your photo in '}
                        <Text style={styles.cardCapsuleTitle}>{item.capsules?.title ?? 'a capsule'}</Text>
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

                {(item.type === 'unlock' || item.type === 'reaction') && (
                  <Ionicons name="chevron-forward" size={18} color="#555555" />
                )}
              </TouchableOpacity>
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
});
