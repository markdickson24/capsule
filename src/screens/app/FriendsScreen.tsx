import React, { useCallback, useEffect, useRef, useState } from 'react';
import {
  View, Text, StyleSheet, ScrollView, TouchableOpacity, RefreshControl,
  TextInput, Modal, Keyboard, ActivityIndicator,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useFocusEffect } from '@react-navigation/native';
import { NativeStackScreenProps } from '@react-navigation/native-stack';
import { Ionicons } from '@expo/vector-icons';
import { Image } from 'expo-image';
import { Avatar } from './ProfileScreen';
import LoadingBrand from '../../components/LoadingBrand';
import RetryPrompt from '../../components/RetryPrompt';
import { useLoadingTimeout } from '../../hooks/useLoadingTimeout';
import { AppStackParamList } from '../../types/navigation';
import { useTheme } from '../../context/ThemeContext';
import { cache } from '../../lib/cache';
import { toast } from '../../lib/toast';
import { supabase } from '../../lib/supabase';
import { sessionStore } from '../../lib/sessionStore';
import { transformAvatarUrl } from '../../lib/avatarUrl';
import { blockStore } from '../../lib/blocks';
import {
  listFriends, listIncomingRequests, acceptFriendRequest, removeFriendship,
  type FriendProfile,
} from '../../lib/friends';

type UserResult = { id: string; display_name: string | null; avatar_url: string | null };

type Props = NativeStackScreenProps<AppStackParamList, 'Friends'>;

export default function FriendsScreen({ navigation }: Props) {
  const { accentColor } = useTheme();
  const [incoming, setIncoming] = useState<FriendProfile[]>([]);
  const [friends, setFriends] = useState<FriendProfile[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  const [showFind, setShowFind] = useState(false);
  const { timedOut, reset: resetTimeout } = useLoadingTimeout(loading);

  const load = useCallback(async () => {
    const [inc, fr] = await Promise.all([listIncomingRequests(), listFriends()]);
    setIncoming(inc);
    setFriends(fr);
    setLoading(false);
  }, []);

  useFocusEffect(useCallback(() => { load(); }, [load]));

  async function accept(id: string) {
    setBusy(id);
    const { error } = await acceptFriendRequest(id);
    if (error) {
      setBusy(null);
      toast.show("Couldn't accept the request — try again.");
      return;
    }
    cache.invalidate('profile');
    await load();
    setBusy(null);
  }

  async function decline(id: string) {
    setBusy(id);
    const declined = incoming.find(p => p.id === id);
    setIncoming(prev => prev.filter(p => p.id !== id)); // optimistic
    const { error } = await removeFriendship(id);
    setBusy(null);
    if (error && declined) {
      // Reinsert only the declined row — restoring a whole-list snapshot
      // here would resurrect rows a concurrent successful decline already
      // removed from both the list and the server.
      setIncoming(prev => (prev.some(p => p.id === id) ? prev : [declined, ...prev]));
      toast.show("Couldn't decline — try again.");
    }
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
        <TouchableOpacity
          onPress={() => setShowFind(true)}
          hitSlop={8}
          style={{ width: 50, alignItems: 'flex-end' }}
          accessibilityRole="button"
          accessibilityLabel="Find people"
        >
          <Ionicons name="person-add-outline" size={22} color={accentColor} />
        </TouchableOpacity>
      </View>

      {loading ? (
        timedOut ? (
          <RetryPrompt onRetry={() => { resetTimeout(); load(); }} />
        ) : (
          <LoadingBrand size="medium" color={accentColor} style={{ marginTop: 48 }} />
        )
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
                    <TouchableOpacity
                      style={styles.declineBtn}
                      onPress={() => decline(p.id)}
                      disabled={busy === p.id}
                      accessibilityRole="button"
                      accessibilityLabel="Decline friend request"
                    >
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
                <Text style={styles.emptySub}>Search for people to send a friend request.</Text>
                <TouchableOpacity
                  style={[styles.findBtn, { backgroundColor: accentColor }]}
                  onPress={() => setShowFind(true)}
                >
                  <Ionicons name="person-add-outline" size={18} color="#FFFFFF" />
                  <Text style={styles.findBtnText}>Find people</Text>
                </TouchableOpacity>
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

      <FindPeopleModal
        visible={showFind}
        accentColor={accentColor}
        onClose={() => setShowFind(false)}
        onSelect={(id) => { setShowFind(false); openProfile(id); }}
      />
    </SafeAreaView>
  );
}

// Lightweight people search — the empty state (and nav-bar +) both open it, so
// "add friends from their profile" is no longer a dead end with no path to a
// profile. Mirrors CreateGroupScreen's debounced `users` ilike search; a tap
// routes to PublicProfile, where the Add Friend button lives.
function FindPeopleModal({
  visible, accentColor, onClose, onSelect,
}: {
  visible: boolean;
  accentColor: string;
  onClose: () => void;
  onSelect: (userId: string) => void;
}) {
  const [search, setSearch] = useState('');
  const [results, setResults] = useState<UserResult[]>([]);
  const [searching, setSearching] = useState(false);
  const debounce = useRef<ReturnType<typeof setTimeout> | null>(null);
  const myId = sessionStore.get()?.user?.id ?? null;

  useEffect(() => {
    return () => {
      if (debounce.current) clearTimeout(debounce.current);
    };
  }, []);

  function handleSearchChange(text: string) {
    setSearch(text);
    if (debounce.current) clearTimeout(debounce.current);
    if (text.trim().length < 2) { setResults([]); setSearching(false); return; }
    setSearching(true);
    debounce.current = setTimeout(async () => {
      const { data } = await supabase
        .from('users')
        .select('id, display_name, avatar_url')
        .ilike('display_name', `%${text.trim()}%`)
        .neq('id', myId ?? '')
        .limit(15);
      setResults((data ?? []).filter((u: UserResult) => !blockStore.has(u.id)));
      setSearching(false);
    }, 300);
  }

  function close() {
    Keyboard.dismiss();
    setSearch('');
    setResults([]);
    onClose();
  }

  return (
    <Modal visible={visible} animationType="slide" onRequestClose={close}>
      <SafeAreaView style={styles.container}>
        <View style={styles.navBar}>
          <TouchableOpacity onPress={close} hitSlop={8} accessibilityRole="button" accessibilityLabel="Close">
            <Ionicons name="close" size={24} color="#FFFFFF" />
          </TouchableOpacity>
          <Text style={styles.navTitle}>Find people</Text>
          <View style={{ width: 50 }} />
        </View>

        <View style={styles.findBody}>
          <View style={styles.searchBox}>
            <Ionicons name="search-outline" size={16} color="#555555" />
            <TextInput
              style={styles.searchInput}
              value={search}
              onChangeText={handleSearchChange}
              placeholder="Search by name"
              placeholderTextColor="#444444"
              autoFocus
              autoCorrect={false}
            />
            {searching && <ActivityIndicator size="small" color="#555555" />}
          </View>

          <ScrollView keyboardShouldPersistTaps="handled" contentContainerStyle={{ paddingTop: 8 }}>
            {results.map(u => (
              <TouchableOpacity key={u.id} style={styles.row} onPress={() => onSelect(u.id)}>
                <View style={styles.rowMain}>
                  {u.avatar_url ? (
                    <Image source={transformAvatarUrl(u.avatar_url, 44)} style={styles.resultAvatar} contentFit="cover" />
                  ) : (
                    <Avatar url={null} name={u.display_name ?? '?'} size={44} />
                  )}
                  <Text style={styles.name}>{u.display_name ?? 'Unknown'}</Text>
                </View>
                <Ionicons name="chevron-forward" size={18} color="#555555" />
              </TouchableOpacity>
            ))}
            {search.trim().length >= 2 && !searching && results.length === 0 && (
              <Text style={styles.findEmpty}>No one found by that name.</Text>
            )}
          </ScrollView>
        </View>
      </SafeAreaView>
    </Modal>
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
  requestsEmpty: { fontSize: 14, color: '#888888', paddingVertical: 8 },
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
  findBtn: {
    flexDirection: 'row', alignItems: 'center', gap: 8,
    borderRadius: 14, paddingVertical: 12, paddingHorizontal: 20, marginTop: 12,
  },
  findBtnText: { color: '#FFFFFF', fontSize: 15, fontWeight: '700' },
  findBody: { flex: 1, paddingHorizontal: 20 },
  searchBox: {
    flexDirection: 'row', alignItems: 'center', gap: 10,
    backgroundColor: '#1A1A1A', borderRadius: 12, paddingHorizontal: 14, paddingVertical: 12,
    borderWidth: 1, borderColor: '#2A2A2A',
  },
  searchInput: { flex: 1, fontSize: 15, color: '#FFFFFF' },
  resultAvatar: { width: 44, height: 44, borderRadius: 22 },
  findEmpty: { fontSize: 14, color: '#888888', textAlign: 'center', marginTop: 32 },
});
