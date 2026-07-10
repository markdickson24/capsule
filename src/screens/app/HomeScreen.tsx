import React, { useEffect, useState, useCallback } from 'react';
import {
  View, Text, StyleSheet, FlatList, Animated,
  TouchableOpacity, RefreshControl, Modal, Pressable,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { haptics } from '../../lib/haptics';
import { toast } from '../../lib/toast';
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
import RetryPrompt from '../../components/RetryPrompt';
import { useCachedFetch } from '../../hooks/useCachedFetch';
import { useLoadingTimeout } from '../../hooks/useLoadingTimeout';
import { cache } from '../../lib/cache';
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

function CountdownBadge({ unlockAt, status, unlockMode }: { unlockAt: string; status: string; unlockMode?: string }) {
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
      <Text style={styles.unlockedBadgeText} maxFontSizeMultiplier={1.3}> Unlocked</Text>
    </View>
  );
  // `unlock_at` is a placeholder for proximity capsules (never used to
  // unlock them — see CLAUDE.md), so a countdown to it is a promise the app
  // will break. `both` keeps the countdown since its date is real.
  if (unlockMode === 'proximity') {
    return (
      <View style={styles.togetherBadge}>
        <Ionicons name="people-outline" size={13} color={accentColor} />
        <Text style={[styles.togetherBadgeText, { color: accentColor }]}> Unlocks together</Text>
      </View>
    );
  }
  const { daysLeft, hoursLeft } = timeLeft;
  if (daysLeft > 0) return <Text style={[styles.countdownText, { color: accentColor }]} maxFontSizeMultiplier={1.3}>{daysLeft}d {hoursLeft}h left</Text>;
  return <Text style={[styles.countdownText, { color: accentColor }]} maxFontSizeMultiplier={1.3}>{hoursLeft}h left</Text>;
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
          <CountdownBadge unlockAt={capsule.unlock_at} status={capsule.status} unlockMode={capsule.unlock_mode} />
        </View>
        <Text style={[styles.cardTitle, isGrid && styles.cardTitleGrid]} numberOfLines={isGrid ? 2 : undefined}>{capsule.title}</Text>
        {!isGrid && capsule.description ? <Text style={styles.cardDesc} numberOfLines={2}>{capsule.description}</Text> : null}
        {isLocked && capsule.unlock_mode === 'proximity' ? (
          <Text style={styles.cardDate}>Unlocks when you're all together</Text>
        ) : (
          <Text style={styles.cardDate}>
            {isLocked ? 'Unlocks' : 'Unlocked'} {new Date(capsule.unlock_at).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })}
          </Text>
        )}
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
  // Capsules optimistically hidden from the Archived section while their
  // restore RPC is in flight — re-shown (with a toast) if it fails.
  const [restoringIds, setRestoringIds] = useState<Set<string>>(new Set());
  // Long-press context menu (Open / Edit / Archive) — was previously a
  // hidden, owner-only-with-no-affordance long-press straight to EditCapsule.
  // Any card can open it now; Edit only shows for the owner pre-unlock.
  const [menuCapsule, setMenuCapsule] = useState<CapsuleWithCountdown | null>(null);
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
        .select('capsule_id, capsules(id, owner_id, title, description, status, unlock_at, unlock_mode, archived_at)')
        .eq('user_id', session.user.id)
        .not('joined_at', 'is', null);

      if (error || !data) return [];

      return data.map((row: any) => row.capsules).filter(Boolean);
    },
  );

  const capsules = (allCapsules ?? []).filter(c => !c.archived_at);
  // allCapsules is already scoped to joined membership (the query above
  // filters on joined_at is not null), so any archived capsule here is one
  // this user can see regardless of ownership — any joined member can
  // archive/restore now, not just the owner.
  const archivedCapsules = (allCapsules ?? []).filter(c => c.archived_at && !restoringIds.has(c.id));

  const { timedOut, reset: resetTimeout } = useLoadingTimeout(loading);

  async function onRefresh() {
    setRefreshing(true);
    await Promise.all([refresh(), refreshGroups()]);
    setRefreshing(false);
  }

  // Optimistic: the card leaves the Archived section instantly (hidden
  // locally), the RPC runs in the background, and refresh() moves it into the
  // active list for real. On failure the card reappears with a toast.
  // Any joined member can restore, not just the owner — a direct .update()
  // would be rejected by RLS for non-owners, so this goes through the same
  // security-definer RPC CapsuleDetailScreen uses.
  // Every capsule in this list is already scoped to joined membership (the
  // underlying query filters joined_at is not null), so canArchive's
  // `isOwner || joined_at != null` is satisfied for any card shown here —
  // no extra ownership check needed before offering Archive.
  function archiveCapsule(capsuleId: string) {
    setMenuCapsule(null);
    haptics.light();
    supabase
      .rpc('set_capsule_archived', { p_capsule_id: capsuleId, p_archived: true })
      .then(async ({ error }) => {
        if (error) {
          toast.show("Couldn't archive the capsule — try again.");
        } else {
          cache.invalidate('capsules', 'profile');
          await refresh();
        }
      });
  }

  function restoreCapsule(capsuleId: string) {
    haptics.light();
    setRestoringIds(prev => new Set(prev).add(capsuleId));
    supabase
      .rpc('set_capsule_archived', { p_capsule_id: capsuleId, p_archived: false })
      .then(async ({ error }) => {
        if (error) {
          toast.show("Couldn't restore the capsule — try again.");
        } else {
          await refresh();
        }
        setRestoringIds(prev => {
          const next = new Set(prev);
          next.delete(capsuleId);
          return next;
        });
      });
  }

  if (loading) {
    if (timedOut) {
      return (
        <SafeAreaView style={styles.container} edges={['top', 'left', 'right']}>
          <RetryPrompt onRetry={() => { resetTimeout(); refresh(true); }} />
        </SafeAreaView>
      );
    }
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
                    accessibilityRole="button"
                    accessibilityLabel={opt === 'list' ? 'List view' : 'Grid view'}
                    accessibilityState={{ selected: active }}
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
            accessibilityRole="button"
            accessibilityLabel="Scan QR code to join a capsule"
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
              onLongPress={() => { haptics.light(); setMenuCapsule(item); }}
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

      <Modal visible={!!menuCapsule} transparent animationType="fade" onRequestClose={() => setMenuCapsule(null)}>
        <Pressable style={styles.menuBackdrop} onPress={() => setMenuCapsule(null)}>
          <Pressable style={styles.menuSheet} onPress={() => {}}>
            {menuCapsule && (
              <>
                <Text style={styles.menuTitle} numberOfLines={1}>{menuCapsule.title}</Text>
                <TouchableOpacity
                  style={styles.menuItem}
                  onPress={() => {
                    const id = menuCapsule.id;
                    setMenuCapsule(null);
                    navigation.navigate('CapsuleDetail', { capsuleId: id });
                  }}
                >
                  <Ionicons name="open-outline" size={20} color="#FFFFFF" />
                  <Text style={styles.menuItemText}>Open</Text>
                </TouchableOpacity>
                {menuCapsule.owner_id === userId && menuCapsule.status !== 'unlocked' && (
                  <TouchableOpacity
                    style={styles.menuItem}
                    onPress={() => {
                      const id = menuCapsule.id;
                      setMenuCapsule(null);
                      navigation.navigate('EditCapsule', { capsuleId: id });
                    }}
                  >
                    <Ionicons name="create-outline" size={20} color="#FFFFFF" />
                    <Text style={styles.menuItemText}>Edit</Text>
                  </TouchableOpacity>
                )}
                <TouchableOpacity
                  style={styles.menuItem}
                  onPress={() => archiveCapsule(menuCapsule.id)}
                >
                  <Ionicons name="archive-outline" size={20} color="#FFFFFF" />
                  <Text style={styles.menuItemText}>Archive</Text>
                </TouchableOpacity>
                <TouchableOpacity style={styles.menuCancel} onPress={() => setMenuCapsule(null)}>
                  <Text style={styles.menuCancelText}>Cancel</Text>
                </TouchableOpacity>
              </>
            )}
          </Pressable>
        </Pressable>
      </Modal>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#0A0A0A' },
  header: { paddingHorizontal: 24, paddingTop: 16, paddingBottom: 8, flexDirection: 'row', alignItems: 'center', gap: 8 },
  headerRight: { flexDirection: 'row', alignItems: 'center', gap: 8, marginLeft: 'auto' },
  scanBtn: { width: 36, height: 36, alignItems: 'center', justifyContent: 'center' },
  title: { fontSize: 28, fontWeight: '800', color: '#FFFFFF' },
  count: { fontSize: 14, color: '#888888' },
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
  togetherBadge: { flexDirection: 'row', alignItems: 'center' },
  togetherBadgeText: { fontSize: 13, fontWeight: '700' },
  cardTitle: { fontSize: 18, fontWeight: '700', color: '#FFFFFF' },
  cardDesc: { fontSize: 14, color: '#888888', lineHeight: 20 },
  cardDate: { fontSize: 12, color: '#888888', marginTop: 4 },
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
  groupsEmptyText: { flex: 1, fontSize: 14, color: '#888888' },
  groupCard: {
    width: 140, backgroundColor: '#1A1A1A',
    borderRadius: 14, padding: 14, gap: 8,
    borderWidth: 1, borderColor: '#2A2A2A',
  },
  groupCardName: { fontSize: 14, fontWeight: '700', color: '#FFFFFF' },
  groupCardMeta: { gap: 4 },
  groupCardBadge: { alignSelf: 'flex-start', borderRadius: 6, paddingVertical: 2, paddingHorizontal: 6 },
  groupCardBadgeText: { fontSize: 11, fontWeight: '700' },
  groupCardCount: { fontSize: 11, color: '#888888' },
  archivedSection: { marginTop: 8, marginHorizontal: 0 },
  archivedHeader: {
    flexDirection: 'row', alignItems: 'center', gap: 8,
    paddingVertical: 12, paddingHorizontal: 4,
  },
  archivedHeaderText: { flex: 1, fontSize: 14, color: '#888888', fontWeight: '600' },
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
  menuBackdrop: { flex: 1, backgroundColor: 'rgba(0,0,0,0.5)', justifyContent: 'flex-end' },
  menuSheet: {
    backgroundColor: '#1A1A1A', borderTopLeftRadius: 20, borderTopRightRadius: 20,
    paddingHorizontal: 20, paddingTop: 16, paddingBottom: 36, gap: 4,
  },
  menuTitle: {
    fontSize: 13, color: '#888888', fontWeight: '600',
    marginBottom: 8, paddingHorizontal: 4,
  },
  menuItem: {
    flexDirection: 'row', alignItems: 'center', gap: 14,
    paddingVertical: 14, paddingHorizontal: 4,
  },
  menuItemText: { color: '#FFFFFF', fontSize: 16, fontWeight: '600' },
  menuCancel: { paddingVertical: 14, alignItems: 'center', marginTop: 8 },
  menuCancelText: { color: '#888888', fontSize: 16, fontWeight: '600' },
});
