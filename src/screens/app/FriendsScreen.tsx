import React, { useCallback, useState } from 'react';
import {
  View, Text, StyleSheet, ScrollView, TouchableOpacity, RefreshControl,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useFocusEffect } from '@react-navigation/native';
import { NativeStackScreenProps } from '@react-navigation/native-stack';
import { Ionicons } from '@expo/vector-icons';
import { Avatar } from './ProfileScreen';
import LoadingBrand from '../../components/LoadingBrand';
import { AppStackParamList } from '../../types/navigation';
import { useTheme } from '../../context/ThemeContext';
import { cache } from '../../lib/cache';
import {
  listFriends, listIncomingRequests, acceptFriendRequest, removeFriendship,
  type FriendProfile,
} from '../../lib/friends';

type Props = NativeStackScreenProps<AppStackParamList, 'Friends'>;

export default function FriendsScreen({ navigation }: Props) {
  const { accentColor } = useTheme();
  const [incoming, setIncoming] = useState<FriendProfile[]>([]);
  const [friends, setFriends] = useState<FriendProfile[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);

  const load = useCallback(async () => {
    const [inc, fr] = await Promise.all([listIncomingRequests(), listFriends()]);
    setIncoming(inc);
    setFriends(fr);
    setLoading(false);
  }, []);

  useFocusEffect(useCallback(() => { load(); }, [load]));

  async function accept(id: string) {
    setBusy(id);
    await acceptFriendRequest(id);
    cache.invalidate('profile');
    await load();
    setBusy(null);
  }

  async function decline(id: string) {
    setBusy(id);
    setIncoming(prev => prev.filter(p => p.id !== id)); // optimistic
    await removeFriendship(id);
    setBusy(null);
  }

  async function onRefresh() {
    setRefreshing(true);
    await load();
    setRefreshing(false);
  }

  function openProfile(id: string) {
    navigation.navigate('PublicProfile', { userId: id });
  }

  return (
    <SafeAreaView style={styles.container}>
      <View style={styles.navBar}>
        <TouchableOpacity onPress={() => navigation.goBack()}>
          <Text style={[styles.back, { color: accentColor }]}>← Back</Text>
        </TouchableOpacity>
        <Text style={styles.navTitle}>Friends</Text>
        <View style={{ width: 50 }} />
      </View>

      {loading ? (
        <LoadingBrand size="medium" color={accentColor} style={{ marginTop: 48 }} />
      ) : (
        <ScrollView
          contentContainerStyle={styles.body}
          refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={accentColor} />}
        >
          <View style={styles.section}>
            <Text style={styles.sectionTitle}>
              {incoming.length > 0 ? `Requests (${incoming.length})` : 'Requests'}
            </Text>
            {incoming.length === 0 ? (
              <Text style={styles.requestsEmpty}>No pending requests</Text>
            ) : (
              incoming.map(p => (
                <View key={p.id} style={styles.row}>
                  <TouchableOpacity style={styles.rowMain} onPress={() => openProfile(p.id)}>
                    <Avatar url={p.avatar_url} name={p.display_name} size={44} />
                    <Text style={styles.name}>{p.display_name}</Text>
                  </TouchableOpacity>
                  <View style={styles.requestActions}>
                    <TouchableOpacity
                      style={[styles.acceptBtn, { backgroundColor: accentColor }]}
                      onPress={() => accept(p.id)}
                      disabled={busy === p.id}
                    >
                      <Text style={styles.acceptText}>{busy === p.id ? '…' : 'Accept'}</Text>
                    </TouchableOpacity>
                    <TouchableOpacity style={styles.declineBtn} onPress={() => decline(p.id)} disabled={busy === p.id}>
                      <Ionicons name="close" size={20} color="#888888" />
                    </TouchableOpacity>
                  </View>
                </View>
              ))
            )}
          </View>

          <View style={styles.section}>
            <Text style={styles.sectionTitle}>
              {friends.length > 0 ? `${friends.length} Friend${friends.length === 1 ? '' : 's'}` : 'Friends'}
            </Text>
            {friends.length === 0 ? (
              <View style={styles.empty}>
                <Ionicons name="people-outline" size={40} color="#555555" />
                <Text style={styles.emptyText}>No friends yet</Text>
                <Text style={styles.emptySub}>Add friends from their profile to see them here.</Text>
              </View>
            ) : (
              friends.map(p => (
                <TouchableOpacity key={p.id} style={styles.row} onPress={() => openProfile(p.id)}>
                  <View style={styles.rowMain}>
                    <Avatar url={p.avatar_url} name={p.display_name} size={44} />
                    <Text style={styles.name}>{p.display_name}</Text>
                  </View>
                  <Ionicons name="chevron-forward" size={18} color="#555555" />
                </TouchableOpacity>
              ))
            )}
          </View>
        </ScrollView>
      )}
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#0A0A0A' },
  navBar: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    paddingHorizontal: 20, paddingVertical: 12,
  },
  back: { fontSize: 16, fontWeight: '600' },
  navTitle: { fontSize: 17, fontWeight: '700', color: '#FFFFFF' },
  body: { paddingHorizontal: 20, paddingBottom: 40 },
  section: { marginTop: 20 },
  sectionTitle: {
    fontSize: 13, color: '#888888', fontWeight: '600', textTransform: 'uppercase',
    letterSpacing: 0.5, marginBottom: 8,
  },
  row: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    paddingVertical: 10, borderBottomWidth: 1, borderBottomColor: '#1A1A1A',
  },
  rowMain: { flexDirection: 'row', alignItems: 'center', gap: 12, flex: 1 },
  name: { fontSize: 16, color: '#FFFFFF', fontWeight: '600' },
  requestsEmpty: { fontSize: 14, color: '#555555', paddingVertical: 8 },
  requestActions: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  acceptBtn: { borderRadius: 10, paddingHorizontal: 16, paddingVertical: 8 },
  acceptText: { color: '#FFFFFF', fontWeight: '700', fontSize: 14 },
  declineBtn: {
    width: 36, height: 36, borderRadius: 10, borderWidth: 1, borderColor: '#2A2A2A',
    alignItems: 'center', justifyContent: 'center',
  },
  empty: { alignItems: 'center', gap: 8, paddingVertical: 40 },
  emptyText: { fontSize: 18, fontWeight: '700', color: '#FFFFFF', marginTop: 4 },
  emptySub: { fontSize: 14, color: '#888888', textAlign: 'center' },
});
