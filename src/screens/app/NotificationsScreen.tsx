import React, { useState, useCallback } from 'react';
import {
  View, Text, StyleSheet, SafeAreaView, FlatList,
  TouchableOpacity, ActivityIndicator, RefreshControl,
} from 'react-native';
import { useFocusEffect, useNavigation } from '@react-navigation/native';
import { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { supabase } from '../../lib/supabase';
import { AppStackParamList } from '../../types/navigation';

type NotificationRow = {
  id: string;
  capsule_id: string;
  type: 'invite' | 'unlock';
  sent_at: string;
  read_at: string | null;
  capsules: { title: string } | null;
};

type PendingMember = {
  id: string;
  capsule_id: string;
};

export default function NotificationsScreen() {
  const navigation = useNavigation<NativeStackNavigationProp<AppStackParamList>>();
  const [notifications, setNotifications] = useState<NotificationRow[]>([]);
  const [pendingMap, setPendingMap] = useState<Record<string, string>>({}); // capsule_id → member row id
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [accepting, setAccepting] = useState<string | null>(null);

  async function fetchAll() {
    const { data: { session } } = await supabase.auth.getSession();
    const userId = session?.user?.id;
    if (!userId) return;

    const [notifsRes, pendingRes] = await Promise.all([
      supabase
        .from('notifications')
        .select('id, capsule_id, type, sent_at, read_at, capsules(title)')
        .eq('user_id', userId)
        .order('sent_at', { ascending: false }),
      supabase
        .from('capsule_members')
        .select('id, capsule_id')
        .eq('user_id', userId)
        .is('joined_at', null)
        .neq('role', 'owner'),
    ]);

    if (notifsRes.data) setNotifications(notifsRes.data as NotificationRow[]);

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

  async function accept(notif: NotificationRow) {
    const memberId = pendingMap[notif.capsule_id];
    if (!memberId) return;
    setAccepting(notif.id);
    const { error } = await supabase
      .from('capsule_members')
      .update({ joined_at: new Date().toISOString() })
      .eq('id', memberId);

    if (!error) {
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
        <ActivityIndicator color="#FF6B35" style={{ marginTop: 80 }} />
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={styles.container}>
      <View style={styles.header}>
        <Text style={styles.title}>Notifications</Text>
        {pendingCount > 0 && (
          <View style={styles.badge}>
            <Text style={styles.badgeText}>{pendingCount}</Text>
          </View>
        )}
      </View>

      {notifications.length === 0 ? (
        <View style={styles.empty}>
          <View style={styles.emptyIconWrap}>
            <Text style={styles.emptyIconBg}>🔔</Text>
            <Text style={styles.emptyIconCheck}>✓</Text>
          </View>
          <Text style={styles.emptyText}>You're all caught up</Text>
          <Text style={styles.emptySubtext}>
            Invites and unlocks will show up here.
          </Text>
        </View>
      ) : (
        <FlatList
          data={notifications}
          keyExtractor={item => item.id}
          contentContainerStyle={styles.list}
          refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor="#FF6B35" />}
          renderItem={({ item }) => {
            const isPending = item.type === 'invite' && !!pendingMap[item.capsule_id];
            const isAccepted = item.type === 'invite' && !pendingMap[item.capsule_id];

            return (
              <TouchableOpacity
                style={styles.card}
                activeOpacity={item.type === 'unlock' ? 0.7 : 1}
                onPress={() => {
                  if (item.type === 'unlock') {
                    navigation.navigate('CapsuleDetail', { capsuleId: item.capsule_id });
                  }
                }}
              >
                <Text style={styles.cardIcon}>
                  {item.type === 'unlock' ? '🔓' : '📦'}
                </Text>
                <View style={styles.cardBody}>
                  <Text style={styles.cardText}>
                    {item.type === 'unlock' ? (
                      <>
                        <Text style={styles.cardCapsuleTitle}>{item.capsules?.title ?? 'A capsule'}</Text>
                        {' '}just unlocked!
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
                    style={styles.acceptBtn}
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

                {item.type === 'unlock' && (
                  <Text style={styles.chevron}>›</Text>
                )}
              </TouchableOpacity>
            );
          }}
        />
      )}
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
  empty: { flex: 1, justifyContent: 'center', alignItems: 'center', gap: 16, paddingHorizontal: 40 },
  emptyIconWrap: {
    width: 88, height: 88, borderRadius: 44, backgroundColor: '#1A1A1A',
    alignItems: 'center', justifyContent: 'center', marginBottom: 8,
  },
  emptyIconBg: { fontSize: 40 },
  emptyIconCheck: { position: 'absolute', bottom: 8, right: 8, fontSize: 18, color: '#30D158', fontWeight: '900' },
  emptyText: { fontSize: 22, fontWeight: '800', color: '#FFFFFF', textAlign: 'center' },
  emptySubtext: { fontSize: 15, color: '#888888', textAlign: 'center', lineHeight: 22 },
  list: { paddingHorizontal: 16, paddingBottom: 32, gap: 12 },
  card: {
    flexDirection: 'row', alignItems: 'center',
    backgroundColor: '#1A1A1A', borderRadius: 16,
    padding: 16, gap: 14, borderWidth: 1, borderColor: '#2A2A2A',
  },
  cardIcon: { fontSize: 28 },
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
  chevron: { color: '#555555', fontSize: 22, fontWeight: '300' },
});
