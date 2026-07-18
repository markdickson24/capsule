import React, { useCallback, useState } from 'react';
import { View, Text, StyleSheet, FlatList, TouchableOpacity } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useFocusEffect } from '@react-navigation/native';
import { NativeStackScreenProps } from '@react-navigation/native-stack';
import { Ionicons } from '@expo/vector-icons';
import { supabase } from '../../lib/supabase';
import { blockStore } from '../../lib/blocks';
import { useBlockedUsers } from '../../hooks/useBlockedUsers';
import { useTheme } from '../../context/ThemeContext';
import { toast } from '../../lib/toast';
import { AppStackParamList } from '../../types/navigation';
import { Avatar } from './ProfileScreen';
import { SkeletonMemberRow } from '../../components/Skeleton';
import RetryPrompt from '../../components/RetryPrompt';
import { useLoadingTimeout } from '../../hooks/useLoadingTimeout';

type Props = NativeStackScreenProps<AppStackParamList, 'BlockedUsers'>;

type BlockedProfile = { id: string; display_name: string; avatar_url: string | null };

export default function BlockedUsersScreen({ navigation }: Props) {
  const { accentColor } = useTheme();
  // blockStore only tracks IDs — resolve display_name/avatar for the list here.
  const blockedIds = useBlockedUsers();
  const [profiles, setProfiles] = useState<BlockedProfile[]>([]);
  const [loading, setLoading] = useState(true);
  const [unblockingIds, setUnblockingIds] = useState<Set<string>>(new Set());
  const { timedOut, reset: resetTimeout } = useLoadingTimeout(loading);

  // Stable string of the actual blocked ids (not just the count) — a same-size
  // swap (unblock A, block C between visits) must still invalidate `load`'s
  // memoized closure, or it keeps serving the stale pre-swap id list.
  const blockedKey = Array.from(blockedIds).sort().join(',');

  const load = useCallback(async () => {
    const ids = blockedKey ? blockedKey.split(',') : [];
    if (ids.length === 0) {
      setProfiles([]);
      setLoading(false);
      return;
    }
    const { data } = await supabase
      .from('users')
      .select('id, display_name, avatar_url')
      .in('id', ids);
    setProfiles((data ?? []) as BlockedProfile[]);
    setLoading(false);
  }, [blockedKey]);

  useFocusEffect(useCallback(() => {
    setLoading(true);
    load();
  }, [load]));

  function unblock(profile: BlockedProfile) {
    setUnblockingIds(prev => new Set(prev).add(profile.id));
    setProfiles(prev => prev.filter(p => p.id !== profile.id));
    blockStore.unblock(profile.id).then(({ error }) => {
      setUnblockingIds(prev => {
        const next = new Set(prev);
        next.delete(profile.id);
        return next;
      });
      if (error) {
        setProfiles(prev => prev.some(p => p.id === profile.id) ? prev : [...prev, profile]);
        toast.show("Couldn't unblock — try again.");
      }
    });
  }

  if (loading) {
    if (timedOut) {
      return (
        <SafeAreaView style={styles.container}>
          <TouchableOpacity style={styles.backBtn} onPress={() => navigation.goBack()}>
            <Text style={[styles.backText, { color: accentColor }]}>← Back</Text>
          </TouchableOpacity>
          <RetryPrompt onRetry={() => { resetTimeout(); setLoading(true); load(); }} />
        </SafeAreaView>
      );
    }
    return (
      <SafeAreaView style={styles.container}>
        <TouchableOpacity style={styles.backBtn} onPress={() => navigation.goBack()}>
          <Text style={[styles.backText, { color: accentColor }]}>← Back</Text>
        </TouchableOpacity>
        <Text style={styles.title}>Blocked Users</Text>
        <View style={styles.list}>
          <SkeletonMemberRow />
          <View style={styles.sep} />
          <SkeletonMemberRow />
        </View>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={styles.container}>
      <TouchableOpacity style={styles.backBtn} onPress={() => navigation.goBack()}>
        <Text style={[styles.backText, { color: accentColor }]}>← Back</Text>
      </TouchableOpacity>

      <Text style={styles.title}>Blocked Users</Text>
      <Text style={styles.subtitle}>
        Blocked users are never notified — you won't see their photos or reactions anywhere in the app.
      </Text>

      {profiles.length === 0 ? (
        <View style={styles.empty}>
          <Ionicons name="shield-checkmark-outline" size={40} color="#555555" />
          <Text style={styles.emptyText}>No blocked users</Text>
        </View>
      ) : (
        <FlatList
          data={profiles}
          keyExtractor={(item) => item.id}
          contentContainerStyle={styles.list}
          ItemSeparatorComponent={() => <View style={styles.sep} />}
          renderItem={({ item }) => (
            <View style={styles.row}>
              <Avatar url={item.avatar_url} name={item.display_name ?? '?'} size={40} />
              <Text style={styles.name}>{item.display_name ?? 'Member'}</Text>
              <TouchableOpacity
                style={styles.unblockBtn}
                onPress={() => unblock(item)}
                disabled={unblockingIds.has(item.id)}
              >
                <Text style={[styles.unblockBtnText, { color: accentColor }]}>Unblock</Text>
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
  backBtn: { paddingHorizontal: 20, paddingTop: 12, paddingBottom: 4 },
  backText: { fontSize: 16, fontWeight: '600' },
  title: { fontSize: 28, fontWeight: '800', color: '#FFFFFF', paddingHorizontal: 24, marginTop: 8 },
  subtitle: { fontSize: 13, color: '#888888', paddingHorizontal: 24, marginTop: 6, marginBottom: 16, lineHeight: 18 },
  list: { paddingHorizontal: 20, paddingBottom: 40 },
  sep: { height: 1, backgroundColor: '#1A1A1A' },
  row: {
    flexDirection: 'row', alignItems: 'center', gap: 12,
    paddingVertical: 12,
  },
  name: { flex: 1, fontSize: 16, fontWeight: '600', color: '#FFFFFF' },
  unblockBtn: {
    borderRadius: 10, paddingHorizontal: 14, paddingVertical: 8,
    backgroundColor: '#1A1A1A', borderWidth: 1, borderColor: '#2A2A2A',
  },
  unblockBtnText: { fontSize: 13, fontWeight: '700' },
  empty: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: 12, paddingBottom: 80 },
  emptyText: { fontSize: 16, color: '#555555', fontWeight: '600' },
});
