import React, { useState, useCallback } from 'react';
import {
  View, Text, StyleSheet, SafeAreaView, FlatList,
  TouchableOpacity, ActivityIndicator, RefreshControl,
} from 'react-native';
import { useFocusEffect, useNavigation } from '@react-navigation/native';
import { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { supabase } from '../../lib/supabase';
import { AppStackParamList } from '../../types/navigation';

type PendingInvite = {
  id: string;
  capsule_id: string;
  invited_at: string;
  capsules: { title: string } | null;
};

export default function NotificationsScreen() {
  const navigation = useNavigation<NativeStackNavigationProp<AppStackParamList>>();
  const [invites, setInvites] = useState<PendingInvite[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [accepting, setAccepting] = useState<string | null>(null);

  async function fetchInvites() {
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return;

    const { data } = await supabase
      .from('capsule_members')
      .select('id, capsule_id, invited_at, capsules(title)')
      .eq('user_id', user.id)
      .is('joined_at', null)
      .neq('role', 'owner');

    if (data) setInvites(data as PendingInvite[]);
  }

  useFocusEffect(useCallback(() => {
    setLoading(true);
    fetchInvites().finally(() => setLoading(false));
  }, []));

  async function accept(invite: PendingInvite) {
    setAccepting(invite.id);
    const { error } = await supabase
      .from('capsule_members')
      .update({ joined_at: new Date().toISOString() })
      .eq('id', invite.id);

    if (!error) {
      setInvites(prev => prev.filter(i => i.id !== invite.id));
      navigation.navigate('CapsuleDetail', { capsuleId: invite.capsule_id });
    }
    setAccepting(null);
  }

  async function onRefresh() {
    setRefreshing(true);
    await fetchInvites();
    setRefreshing(false);
  }

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
        {invites.length > 0 && (
          <View style={styles.badge}>
            <Text style={styles.badgeText}>{invites.length}</Text>
          </View>
        )}
      </View>

      {invites.length === 0 ? (
        <View style={styles.empty}>
          <Text style={styles.emptyIcon}>🔔</Text>
          <Text style={styles.emptyText}>No pending invites</Text>
          <Text style={styles.emptySubtext}>Capsule invites will appear here</Text>
        </View>
      ) : (
        <FlatList
          data={invites}
          keyExtractor={item => item.id}
          contentContainerStyle={styles.list}
          refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor="#FF6B35" />}
          renderItem={({ item }) => (
            <View style={styles.card}>
              <Text style={styles.cardIcon}>📦</Text>
              <View style={styles.cardBody}>
                <Text style={styles.cardText}>
                  You're invited to{' '}
                  <Text style={styles.cardCapsuleTitle}>
                    {item.capsules?.title ?? 'a capsule'}
                  </Text>
                </Text>
                <Text style={styles.cardDate}>
                  {new Date(item.invited_at).toLocaleDateString('en-US', {
                    month: 'short', day: 'numeric', year: 'numeric',
                  })}
                </Text>
              </View>
              <TouchableOpacity
                style={styles.acceptBtn}
                onPress={() => accept(item)}
                disabled={accepting === item.id}
              >
                <Text style={styles.acceptBtnText}>
                  {accepting === item.id ? '…' : 'Accept'}
                </Text>
              </TouchableOpacity>
            </View>
          )}
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
  empty: { flex: 1, justifyContent: 'center', alignItems: 'center', gap: 8 },
  emptyIcon: { fontSize: 48 },
  emptyText: { fontSize: 20, fontWeight: '700', color: '#FFFFFF' },
  emptySubtext: { fontSize: 15, color: '#888888' },
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
});
