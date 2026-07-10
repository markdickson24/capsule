import React, { useEffect, useState, useCallback } from 'react';
import { toast } from '../../lib/toast';
import {
  View, Text, StyleSheet, FlatList,
  TouchableOpacity,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { NativeStackScreenProps } from '@react-navigation/native-stack';
import { useFocusEffect } from '@react-navigation/native';
import { supabase } from '../../lib/supabase';
import { sessionStore } from '../../lib/sessionStore';
import { Ionicons } from '@expo/vector-icons';
import { AppStackParamList } from '../../types/navigation';
import { Avatar } from './ProfileScreen';
import { useTheme } from '../../context/ThemeContext';
import { SkeletonMemberRow } from '../../components/Skeleton';
import RetryPrompt from '../../components/RetryPrompt';
import { useLoadingTimeout } from '../../hooks/useLoadingTimeout';
import ConfirmModal from '../../components/ConfirmModal';

type Props = NativeStackScreenProps<AppStackParamList, 'ManageMembers'>;

type MemberRow = {
  user_id: string;
  role: string;
  joined_at: string | null;
  users: { display_name: string; avatar_url: string | null } | null;
};

const roleLabel: Record<string, string> = {
  owner: 'Owner',
  contributor: 'Contributor',
  viewer: 'Viewer',
};

export default function ManageMembersScreen({ route, navigation }: Props) {
  const { accentColor } = useTheme();
  const { capsuleId } = route.params;
  const [members, setMembers] = useState<MemberRow[]>([]);
  const [currentUserId, setCurrentUserId] = useState('');
  const [loading, setLoading] = useState(true);
  const [pendingRemoval, setPendingRemoval] = useState<{ userId: string; displayName: string } | null>(null);
  const { timedOut, reset: resetTimeout } = useLoadingTimeout(loading);

  async function fetchMembers() {
    const session = sessionStore.get();
    if (!session) { navigation.goBack(); return; }
    setCurrentUserId(session.user.id);

    const { data } = await supabase
      .from('capsule_members')
      .select('user_id, role, joined_at, users(display_name, avatar_url)')
      .eq('capsule_id', capsuleId)
      .order('joined_at', { ascending: true });

    setMembers((data ?? []) as MemberRow[]);
  }

  useFocusEffect(useCallback(() => {
    setLoading(true);
    fetchMembers().finally(() => setLoading(false));
  }, [capsuleId]));

  function requestRemove(userId: string, displayName: string) {
    setPendingRemoval({ userId, displayName });
  }

  // Optimistic: the row disappears the moment the owner confirms; the delete
  // runs in the background and the row is restored (with a toast) on failure.
  // Reinserts just the removed row rather than restoring a whole-list
  // snapshot — with two removals in flight at once, restoring a stale
  // pre-both-removals snapshot would silently undo the OTHER one's
  // already-successful delete.
  function confirmRemove() {
    if (!pendingRemoval) return;
    const { userId, displayName } = pendingRemoval;
    const removedMember = members.find(m => m.user_id === userId) ?? null;
    setMembers(prev => prev.filter(m => m.user_id !== userId));
    setPendingRemoval(null);
    supabase
      .from('capsule_members')
      .delete()
      .eq('capsule_id', capsuleId)
      .eq('user_id', userId)
      .then(({ error }) => {
        if (error) {
          if (removedMember) {
            setMembers(prev =>
              prev.some(m => m.user_id === userId)
                ? prev
                : [...prev, removedMember].sort((a, b) =>
                    (a.joined_at ?? '') < (b.joined_at ?? '') ? -1 : 1
                  )
            );
          }
          toast.show(`Couldn't remove ${displayName} — try again.`);
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
          <RetryPrompt onRetry={() => { resetTimeout(); fetchMembers().finally(() => setLoading(false)); }} />
        </SafeAreaView>
      );
    }
    return (
      <SafeAreaView style={styles.container}>
        <View style={styles.backBtn}>
          <View style={{ width: 60, height: 16, borderRadius: 6, backgroundColor: '#1A1A1A' }} />
        </View>
        <View style={{ width: 120, height: 28, borderRadius: 8, backgroundColor: '#1A1A1A', marginLeft: 24, marginTop: 8 }} />
        <View style={{ width: 180, height: 14, borderRadius: 6, backgroundColor: '#1A1A1A', marginLeft: 24, marginTop: 8, marginBottom: 16 }} />
        <View style={styles.list}>
          <SkeletonMemberRow />
          <View style={styles.sep} />
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

      <Text style={styles.title}>Members</Text>
      <Text style={styles.subtitle}>{members.length} people in this capsule</Text>

      <FlatList
        data={members}
        keyExtractor={(item) => item.user_id}
        contentContainerStyle={styles.list}
        renderItem={({ item }) => {
          const isOwner = item.role === 'owner';
          const isSelf = item.user_id === currentUserId;
          const displayName = item.users?.display_name ?? 'Member';
          const isPending = item.joined_at === null;

          return (
            <View style={styles.row}>
              <Avatar url={item.users?.avatar_url ?? null} name={displayName} size={40} />
              <View style={styles.info}>
                <Text style={styles.name}>{displayName}</Text>
                <View style={styles.badges}>
                  <View style={[styles.roleBadge, isOwner && [styles.roleBadgeOwner, { borderColor: `${accentColor}50` }]]}>
                    <Text style={[styles.roleText, isOwner && [styles.roleTextOwner, { color: accentColor }]]}>
                      {roleLabel[item.role] ?? item.role}
                    </Text>
                  </View>
                  {isPending && (
                    <View style={styles.pendingBadge}>
                      <Text style={styles.pendingText}>Pending</Text>
                    </View>
                  )}
                </View>
              </View>
              {!isOwner && !isSelf ? (
                <TouchableOpacity
                  style={styles.removeBtn}
                  onPress={() => requestRemove(item.user_id, displayName)}
                  hitSlop={{ top: 12, bottom: 12, left: 12, right: 12 }}
                >
                  <Ionicons name="person-remove-outline" size={20} color="#FF3B30" />
                </TouchableOpacity>
              ) : (
                <View style={styles.removeBtnPlaceholder} />
              )}
            </View>
          );
        }}
        ItemSeparatorComponent={() => <View style={styles.sep} />}
      />

      <ConfirmModal
        visible={pendingRemoval !== null}
        title="Remove member?"
        message={
          pendingRemoval
            ? `Remove ${pendingRemoval.displayName} from this capsule? They lose access immediately.`
            : ''
        }
        confirmLabel="Remove"
        destructive
        onConfirm={confirmRemove}
        onCancel={() => setPendingRemoval(null)}
      />
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#0A0A0A' },
  backBtn: { paddingHorizontal: 20, paddingTop: 12, paddingBottom: 4 },
  backText: { color: '#FF6B35', fontSize: 16, fontWeight: '600' },
  title: { fontSize: 28, fontWeight: '800', color: '#FFFFFF', paddingHorizontal: 24, marginTop: 8 },
  subtitle: { fontSize: 14, color: '#888888', paddingHorizontal: 24, marginTop: 4, marginBottom: 16 },
  list: { paddingHorizontal: 20, paddingBottom: 40 },
  row: {
    flexDirection: 'row', alignItems: 'center', gap: 12,
    paddingVertical: 12,
  },
  info: { flex: 1, gap: 4 },
  name: { fontSize: 16, fontWeight: '600', color: '#FFFFFF' },
  badges: { flexDirection: 'row', gap: 6 },
  roleBadge: {
    backgroundColor: '#1A1A1A', borderRadius: 6,
    paddingHorizontal: 8, paddingVertical: 3,
    borderWidth: 1, borderColor: '#2A2A2A',
  },
  roleBadgeOwner: { borderColor: '#FF6B3550' },
  roleText: { fontSize: 11, color: '#666666', fontWeight: '600' },
  roleTextOwner: { color: '#FF6B35' },
  pendingBadge: {
    backgroundColor: '#1A1A1A', borderRadius: 6,
    paddingHorizontal: 8, paddingVertical: 3,
    borderWidth: 1, borderColor: '#2A2A2A',
  },
  pendingText: { fontSize: 11, color: '#888888', fontWeight: '600' },
  removeBtn: { padding: 4 },
  removeBtnPlaceholder: { width: 28 },
  sep: { height: 1, backgroundColor: '#1A1A1A' },
});
