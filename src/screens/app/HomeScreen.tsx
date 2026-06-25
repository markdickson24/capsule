import React, { useEffect, useState, useCallback } from 'react';
import {
  View, Text, StyleSheet, FlatList, Animated,
  TouchableOpacity, RefreshControl,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { haptics } from '../../lib/haptics';
import { useNavigation } from '@react-navigation/native';
import { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { supabase } from '../../lib/supabase';
import { sessionStore } from '../../lib/sessionStore';
import { Ionicons } from '@expo/vector-icons';
import { Image } from 'expo-image';
import { Capsule } from '../../types/database';
import { AppStackParamList } from '../../types/navigation';
import { useTheme, type HomeLayout } from '../../context/ThemeContext';
import { SkeletonCard } from '../../components/Skeleton';
import { useCachedFetch } from '../../hooks/useCachedFetch';
import { useListItemEntrance, useFadeIn } from '../../lib/animations';
import { listMyGroups, GroupRow, recurrenceLabel } from '../../lib/groups';

type CapsuleWithCountdown = Capsule;

function getTimeLeft(unlockAt: string) {
  const diff = new Date(unlockAt).getTime() - Date.now();
  if (diff <= 0) return { daysLeft: 0, hoursLeft: 0 };
  const daysLeft = Math.floor(diff / (1000 * 60 * 60 * 24));
  const hoursLeft = Math.floor((diff % (1000 * 60 * 60 * 24)) / (1000 * 60 * 60));
  return { daysLeft, hoursLeft };
}

function CountdownBadge({ unlockAt, status }: { unlockAt: string; status: string }) {
  const { accentColor } = useTheme();
  const [timeLeft, setTimeLeft] = useState(() => getTimeLeft(unlockAt));

  useEffect(() => {
    if (status === 'unlocked') return;
    const id = setInterval(() => setTimeLeft(getTimeLeft(unlockAt)), 60_000);
    return () => clearInterval(id);
  }, [unlockAt, status]);

  if (status === 'unlocked') return (
    <View style={styles.unlockedBadge}>
      <Ionicons name="lock-open-outline" size={13} color="#30D158" />
      <Text style={styles.unlockedBadgeText}> Unlocked</Text>
    </View>
  );
  const { daysLeft, hoursLeft } = timeLeft;
  if (daysLeft > 0) return <Text style={[styles.countdownText, { color: accentColor }]}>{daysLeft}d {hoursLeft}h left</Text>;
  return <Text style={[styles.countdownText, { color: accentColor }]}>{hoursLeft}h left</Text>;
}

function CapsuleCard({ capsule, onPress, onLongPress, index, variant = 'list' }: { capsule: CapsuleWithCountdown; onPress: () => void; onLongPress?: () => void; index: number; variant?: HomeLayout }) {
  const { accentColor } = useTheme();
  const isLocked = capsule.status !== 'unlocked';
  const entrance = useListItemEntrance(index);
  const isGrid = variant === 'grid';
  return (
    <Animated.View style={[entrance, isGrid && styles.gridCell]}>
      <TouchableOpacity
        style={[styles.card, isGrid && styles.cardGrid, !isLocked && { borderColor: `${accentColor}40` }]}
        onPress={onPress}
        onLongPress={onLongPress}
        delayLongPress={400}
      >
        <View style={styles.cardTop}>
          <Ionicons
            name={isLocked ? 'time-outline' : 'lock-open-outline'}
            size={isGrid ? 20 : 24}
            color={isLocked ? '#888888' : '#30D158'}
          />
          <CountdownBadge unlockAt={capsule.unlock_at} status={capsule.status} />
        </View>
        <Text style={[styles.cardTitle, isGrid && styles.cardTitleGrid]} numberOfLines={isGrid ? 2 : undefined}>{capsule.title}</Text>
        {!isGrid && capsule.description ? <Text style={styles.cardDesc} numberOfLines={2}>{capsule.description}</Text> : null}
        <Text style={styles.cardDate}>
          {isLocked ? 'Unlocks' : 'Unlocked'} {new Date(capsule.unlock_at).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })}
        </Text>
      </TouchableOpacity>
    </Animated.View>
  );
}

function ArchivedCard({ capsule, onPress, onRestore }: { capsule: CapsuleWithCountdown; onPress: () => void; onRestore: () => void }) {
  return (
    <TouchableOpacity style={styles.archivedCard} onPress={onPress}>
      <View style={styles.archivedCardInner}>
        <Ionicons name="archive-outline" size={18} color="#555555" />
        <View style={styles.archivedCardText}>
          <Text style={styles.archivedTitle} numberOfLines={1}>{capsule.title}</Text>
          <Text style={styles.archivedDate}>
            {new Date(capsule.unlock_at).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })}
          </Text>
        </View>
        <TouchableOpacity style={styles.restoreBtn} onPress={onRestore}>
          <Text style={styles.restoreBtnText}>Restore</Text>
        </TouchableOpacity>
      </View>
    </TouchableOpacity>
  );
}

function GroupCard({ group, onPress }: { group: GroupRow; onPress: () => void }) {
  const { accentColor } = useTheme();
  return (
    <TouchableOpacity style={styles.groupCard} onPress={onPress}>
      <Text style={styles.groupCardName} numberOfLines={1}>{group.name}</Text>
      <View style={styles.groupCardMeta}>
        <View style={[styles.groupCardBadge, { backgroundColor: `${accentColor}20` }]}>
          <Text style={[styles.groupCardBadgeText, { color: accentColor }]}>{recurrenceLabel(group.recurrence_interval)}</Text>
        </View>
        <Text style={styles.groupCardCount}>{group.memberCount} member{group.memberCount !== 1 ? 's' : ''}</Text>
      </View>
    </TouchableOpacity>
  );
}

function GroupsSection({ groups, onCreatePress, onGroupPress }: {
  groups: GroupRow[] | null;
  onCreatePress: () => void;
  onGroupPress: (id: string) => void;
}) {
  const { accentColor } = useTheme();
  const hasGroups = groups && groups.length > 0;
  return (
    <View style={styles.groupsSection}>
      <View style={styles.groupsHeader}>
        <Text style={styles.groupsTitle}>Groups</Text>
        <TouchableOpacity onPress={onCreatePress} hitSlop={8} style={styles.groupsAddBtn}>
          <Ionicons name="add" size={16} color={accentColor} />
          <Text style={[styles.groupsAddText, { color: accentColor }]}>New</Text>
        </TouchableOpacity>
      </View>
      {hasGroups ? (
        <FlatList
          horizontal
          data={groups}
          keyExtractor={g => g.id}
          renderItem={({ item }) => (
            <GroupCard group={item} onPress={() => onGroupPress(item.id)} />
          )}
          showsHorizontalScrollIndicator={false}
          contentContainerStyle={styles.groupsList}
        />
      ) : (
        <TouchableOpacity style={styles.groupsEmptyPrompt} onPress={onCreatePress}>
          <Ionicons name="people-outline" size={18} color="#444444" />
          <Text style={styles.groupsEmptyText}>Create a group for recurring capsules</Text>
          <Ionicons name="chevron-forward" size={14} color="#444444" />
        </TouchableOpacity>
      )}
    </View>
  );
}

export default function HomeScreen() {
  const { accentColor, homeLayout, setHomeLayout } = useTheme();
  const navigation = useNavigation<NativeStackNavigationProp<AppStackParamList>>();
  const [refreshing, setRefreshing] = useState(false);
  const [showArchived, setShowArchived] = useState(false);
  const headerAnim = useFadeIn(0, 250);

  const userId = sessionStore.get()?.user?.id ?? null;

  const { data: groups, refresh: refreshGroups } = useCachedFetch<(GroupRow & { memberCount: number })[]>(
    'groups',
    listMyGroups,
  );

  const { data: allCapsules, loading, refresh } = useCachedFetch<CapsuleWithCountdown[]>(
    'capsules',
    async () => {
      const session = sessionStore.get();
      if (!session) return [];

      const { data, error } = await supabase
        .from('capsule_members')
        .select('capsule_id, capsules(id, owner_id, title, description, status, unlock_at, archived_at)')
        .eq('user_id', session.user.id)
        .not('joined_at', 'is', null);

      if (error || !data) return [];

      return data.map((row: any) => row.capsules).filter(Boolean);
    },
  );

  const capsules = (allCapsules ?? []).filter(c => !c.archived_at);
  const archivedCapsules = (allCapsules ?? []).filter(c => c.archived_at && c.owner_id === userId);

  async function onRefresh() {
    setRefreshing(true);
    await Promise.all([refresh(), refreshGroups()]);
    setRefreshing(false);
  }

  async function restoreCapsule(capsuleId: string) {
    await supabase.from('capsules').update({ archived_at: null }).eq('id', capsuleId);
    await refresh();
  }

  if (loading) {
    return (
      <SafeAreaView style={styles.container} edges={['top', 'left', 'right']}>
        <View style={styles.header}>
          <View style={{ width: 160, height: 28, borderRadius: 8, backgroundColor: '#1A1A1A' }} />
        </View>
        <View style={styles.list}>
          <SkeletonCard />
          <SkeletonCard />
          <SkeletonCard />
        </View>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={styles.container} edges={['top', 'left', 'right']}>
      <Animated.View style={[styles.header, headerAnim]}>
        <Text style={styles.title}>My Capsules</Text>
        {capsules.length > 0 && <Text style={styles.count}>{capsules.length} total</Text>}
        <View style={styles.headerRight}>
          {capsules.length > 0 && (
            <View style={styles.layoutToggle}>
              {(['list', 'grid'] as const).map(opt => {
                const active = homeLayout === opt;
                return (
                  <TouchableOpacity
                    key={opt}
                    style={[styles.layoutBtn, active && { backgroundColor: `${accentColor}26` }]}
                    onPress={() => { haptics.selection(); setHomeLayout(opt); }}
                    hitSlop={6}
                  >
                    <Ionicons
                      name={opt === 'list' ? 'reorder-four-outline' : 'grid-outline'}
                      size={18}
                      color={active ? accentColor : '#666666'}
                    />
                  </TouchableOpacity>
                );
              })}
            </View>
          )}
          <TouchableOpacity
            onPress={() => navigation.navigate('QRScanner')}
            hitSlop={8}
            style={styles.scanBtn}
          >
            <Ionicons name="qr-code-outline" size={22} color="#666666" />
          </TouchableOpacity>
        </View>
      </Animated.View>

      {capsules.length === 0 && archivedCapsules.length === 0 ? (
        <View style={styles.emptyOuter}>
          <GroupsSection
            groups={groups ?? null}
            onCreatePress={() => navigation.navigate('CreateGroup')}
            onGroupPress={id => navigation.navigate('GroupDetail', { groupId: id })}
          />
          <View style={styles.empty}>
            <View style={styles.emptyArt}>
              <View style={styles.emptyArtBack}><Ionicons name="camera-outline" size={52} color="#FFFFFF" /></View>
              <View style={styles.emptyArtMid}><Ionicons name="sparkles-outline" size={52} color="#FFFFFF" /></View>
              <View style={styles.emptyArtFront}><Ionicons name="time-outline" size={64} color="#FFFFFF" /></View>
            </View>
            <Text style={styles.emptyText}>Create your first capsule</Text>
            <Text style={styles.emptySubtext}>
              Lock photos and videos in time.{'\n'}Open them together when the moment arrives.
            </Text>
            <TouchableOpacity
              style={[styles.emptyBtn, { backgroundColor: accentColor }]}
              onPress={() => navigation.navigate('Tabs', { screen: 'Create' })}
            >
              <Text style={styles.emptyBtnText}>Create a Capsule</Text>
            </TouchableOpacity>
          </View>
        </View>
      ) : (
        <FlatList
          key={homeLayout}
          data={capsules}
          keyExtractor={(item) => item.id}
          numColumns={homeLayout === 'grid' ? 2 : 1}
          columnWrapperStyle={homeLayout === 'grid' ? styles.gridRow : undefined}
          renderItem={({ item, index }) => (
            <CapsuleCard
              capsule={item}
              index={index}
              variant={homeLayout}
              onPress={() => navigation.navigate('CapsuleDetail', { capsuleId: item.id })}
              onLongPress={
                item.owner_id === userId && item.status !== 'unlocked'
                  ? () => navigation.navigate('EditCapsule', { capsuleId: item.id })
                  : undefined
              }
            />
          )}
          contentContainerStyle={styles.list}
          refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={accentColor} />}
          ListHeaderComponent={
            <GroupsSection
              groups={groups ?? null}
              onCreatePress={() => navigation.navigate('CreateGroup')}
              onGroupPress={id => navigation.navigate('GroupDetail', { groupId: id })}
            />
          }
          ListFooterComponent={
            archivedCapsules.length > 0 ? (
              <View style={styles.archivedSection}>
                <TouchableOpacity style={styles.archivedHeader} onPress={() => setShowArchived(v => !v)}>
                  <Ionicons name="archive-outline" size={16} color="#555555" />
                  <Text style={styles.archivedHeaderText}>Archived ({archivedCapsules.length})</Text>
                  <Ionicons name={showArchived ? 'chevron-up' : 'chevron-down'} size={16} color="#555555" />
                </TouchableOpacity>
                {showArchived && archivedCapsules.map(c => (
                  <ArchivedCard
                    key={c.id}
                    capsule={c}
                    onPress={() => navigation.navigate('CapsuleDetail', { capsuleId: c.id })}
                    onRestore={() => restoreCapsule(c.id)}
                  />
                ))}
              </View>
            ) : null
          }
        />
      )}
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#0A0A0A' },
  header: { paddingHorizontal: 24, paddingTop: 16, paddingBottom: 8, flexDirection: 'row', alignItems: 'center', gap: 8 },
  headerRight: { flexDirection: 'row', alignItems: 'center', gap: 8, marginLeft: 'auto' },
  scanBtn: { width: 36, height: 36, alignItems: 'center', justifyContent: 'center' },
  title: { fontSize: 28, fontWeight: '800', color: '#FFFFFF' },
  count: { fontSize: 14, color: '#555555' },
  layoutToggle: { flexDirection: 'row', gap: 2, backgroundColor: '#1A1A1A', borderRadius: 10, padding: 3 },
  layoutBtn: { padding: 6, borderRadius: 8 },
  empty: { flex: 1, justifyContent: 'center', alignItems: 'center', gap: 16, paddingHorizontal: 40 },
  emptyArt: { flexDirection: 'row', marginBottom: 8 },
  emptyArtBack: { transform: [{ rotate: '-12deg' }, { translateX: 18 }, { translateY: 8 }], opacity: 0.5 },
  emptyArtMid: { transform: [{ rotate: '6deg' }], opacity: 0.7, zIndex: 1 },
  emptyArtFront: { transform: [{ rotate: '-4deg' }, { translateX: -12 }], zIndex: 2 },
  emptyText: { fontSize: 22, fontWeight: '800', color: '#FFFFFF', textAlign: 'center' },
  emptySubtext: { fontSize: 15, color: '#888888', textAlign: 'center', lineHeight: 22 },
  emptyBtn: { marginTop: 8, backgroundColor: '#FF6B35', borderRadius: 14, paddingVertical: 14, paddingHorizontal: 32 },
  emptyBtnText: { color: '#FFFFFF', fontWeight: '700', fontSize: 16 },
  list: { paddingHorizontal: 16, paddingBottom: 32, gap: 12 },
  card: {
    backgroundColor: '#1A1A1A',
    borderRadius: 16,
    padding: 20,
    gap: 8,
    borderWidth: 1,
    borderColor: '#2A2A2A',
  },
  cardGrid: { flex: 1, padding: 14, gap: 6, minHeight: 116 },
  gridCell: { flex: 1 },
  gridRow: { gap: 12 },
  cardTitleGrid: { fontSize: 15 },
  cardTop: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  countdownText: { fontSize: 13, fontWeight: '700', color: '#FF6B35' },
  unlockedBadge: { flexDirection: 'row', alignItems: 'center' },
  unlockedBadgeText: { fontSize: 13, fontWeight: '700', color: '#30D158' },
  cardTitle: { fontSize: 18, fontWeight: '700', color: '#FFFFFF' },
  cardDesc: { fontSize: 14, color: '#888888', lineHeight: 20 },
  cardDate: { fontSize: 12, color: '#555555', marginTop: 4 },
  emptyOuter: { flex: 1 },
  groupsSection: { marginBottom: 8, paddingHorizontal: 0 },
  groupsHeader: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    paddingHorizontal: 16, marginBottom: 10,
  },
  groupsTitle: { fontSize: 18, fontWeight: '700', color: '#FFFFFF' },
  groupsAddBtn: { flexDirection: 'row', alignItems: 'center', gap: 4 },
  groupsAddText: { fontSize: 14, fontWeight: '600' },
  groupsList: { gap: 10, paddingHorizontal: 16 },
  groupsEmptyPrompt: {
    flexDirection: 'row', alignItems: 'center', gap: 10,
    marginHorizontal: 16, paddingVertical: 14, paddingHorizontal: 16,
    backgroundColor: '#111111', borderRadius: 12,
    borderWidth: 1, borderColor: '#1E1E1E',
  },
  groupsEmptyText: { flex: 1, fontSize: 14, color: '#555555' },
  groupCard: {
    width: 140, backgroundColor: '#1A1A1A',
    borderRadius: 14, padding: 14, gap: 8,
    borderWidth: 1, borderColor: '#2A2A2A',
  },
  groupCardName: { fontSize: 14, fontWeight: '700', color: '#FFFFFF' },
  groupCardMeta: { gap: 4 },
  groupCardBadge: { alignSelf: 'flex-start', borderRadius: 6, paddingVertical: 2, paddingHorizontal: 6 },
  groupCardBadgeText: { fontSize: 11, fontWeight: '700' },
  groupCardCount: { fontSize: 11, color: '#555555' },
  archivedSection: { marginTop: 8, marginHorizontal: 0 },
  archivedHeader: {
    flexDirection: 'row', alignItems: 'center', gap: 8,
    paddingVertical: 12, paddingHorizontal: 4,
  },
  archivedHeaderText: { flex: 1, fontSize: 14, color: '#555555', fontWeight: '600' },
  archivedCard: {
    backgroundColor: '#111111',
    borderRadius: 12,
    borderWidth: 1,
    borderColor: '#1E1E1E',
    marginBottom: 8,
  },
  archivedCardInner: { flexDirection: 'row', alignItems: 'center', padding: 14, gap: 12 },
  archivedCardText: { flex: 1, gap: 2 },
  archivedTitle: { fontSize: 15, fontWeight: '600', color: '#666666' },
  archivedDate: { fontSize: 12, color: '#444444' },
  restoreBtn: {
    backgroundColor: '#1A1A1A',
    borderRadius: 8,
    paddingVertical: 6,
    paddingHorizontal: 12,
    borderWidth: 1,
    borderColor: '#2A2A2A',
  },
  restoreBtnText: { color: '#AAAAAA', fontSize: 13, fontWeight: '600' },
});
