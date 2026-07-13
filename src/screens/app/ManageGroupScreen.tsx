import React, { useCallback, useRef, useState } from 'react';
import {
  View, Text, StyleSheet, TextInput, TouchableOpacity, ScrollView,
  ActivityIndicator, Keyboard,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useNavigation, useRoute, RouteProp, useFocusEffect } from '@react-navigation/native';
import { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { Ionicons } from '@expo/vector-icons';
import { Image } from 'expo-image';
import { supabase } from '../../lib/supabase';
import { transformAvatarUrl } from '../../lib/avatarUrl';
import { sessionStore } from '../../lib/sessionStore';
import { cache } from '../../lib/cache';
import { toast } from '../../lib/toast';
import { blockStore } from '../../lib/blocks';
import { useTheme } from '../../context/ThemeContext';
import ConfirmModal from '../../components/ConfirmModal';
import { Avatar } from './ProfileScreen';
import {
  getGroup, getGroupMembers, updateGroup, addGroupMember, removeGroupMember,
  pauseGroupRecurrence, resumeGroupRecurrence, anchorFromGroup,
  GroupRecurrence, GroupMemberProfile, recurrenceLabel,
} from '../../lib/groups';
import { computeUpcomingOccurrences, RecurrenceAnchor } from '../../lib/recurrence';
import RecurrenceAnchorPicker from '../../components/RecurrenceAnchorPicker';
import ReminderLeadPicker from '../../components/ReminderLeadPicker';
import { AppStackParamList } from '../../types/navigation';

type NavProp = NativeStackNavigationProp<AppStackParamList>;
type RoutePropType = RouteProp<AppStackParamList, 'ManageGroup'>;

interface UserResult { id: string; display_name: string | null; avatar_url: string | null }

const RECURRENCE_OPTIONS: GroupRecurrence[] = ['manual', 'weekly', 'monthly', 'yearly'];
const DURATION_OPTIONS = [
  { label: '1 week', hours: 168 },
  { label: '1 month', hours: 720 },
  { label: '3 months', hours: 2160 },
  { label: '6 months', hours: 4380 },
  { label: '1 year', hours: 8760 },
];

export default function ManageGroupScreen() {
  const { accentColor } = useTheme();
  const navigation = useNavigation<NavProp>();
  const route = useRoute<RoutePropType>();
  const { groupId } = route.params;
  const myId = sessionStore.get()?.user?.id ?? null;

  const [loading, setLoading] = useState(true);
  const [createdBy, setCreatedBy] = useState<string | null>(null);
  const [name, setName] = useState('');
  const [recurrence, setRecurrence] = useState<GroupRecurrence>('manual');
  const [unlockHours, setUnlockHours] = useState(720);
  const [anchor, setAnchor] = useState<RecurrenceAnchor>({ hour: 9, minute: 0 });
  const [reminderLeadHours, setReminderLeadHours] = useState<number | null>(24);
  const [paused, setPaused] = useState(false);
  const [pausing, setPausing] = useState(false);
  const [members, setMembers] = useState<GroupMemberProfile[]>([]);
  const [saving, setSaving] = useState(false);

  const [search, setSearch] = useState('');
  const [results, setResults] = useState<UserResult[]>([]);
  const [searching, setSearching] = useState(false);
  const debounce = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [pendingRemoval, setPendingRemoval] = useState<{ userId: string; name: string } | null>(null);

  const load = useCallback(async () => {
    const [group, mems] = await Promise.all([getGroup(groupId), getGroupMembers(groupId)]);
    if (!group) { navigation.goBack(); return; }
    // Manage is creator-only — bounce anyone else (matches the RLS, which
    // rejects their updates anyway).
    if (group.created_by !== myId) { navigation.goBack(); return; }
    setCreatedBy(group.created_by);
    setName(group.name);
    setRecurrence(group.recurrence_interval);
    setUnlockHours(group.unlock_duration_hours);
    // Pre-existing groups only have the anchor sub-field for their ORIGINAL
    // recurrence_interval populated (20260713010000_groups_recurrence_revamp.sql
    // backfills just that one field per interval; the rest are null). Fall
    // back to today's date for whichever field wasn't populated — same
    // approach as CreateGroupScreen.defaultAnchor() — so `anchor` always has
    // every calendar sub-field set no matter which interval is currently
    // selected. Without this, switching to a different interval (before the
    // user touches the sub-picker) throws inside computeNextOccurrence, both
    // in the upcoming-preview render and in handleSave's updateGroup call.
    const anchorFromDb = anchorFromGroup(group);
    const now = new Date();
    setAnchor({
      ...anchorFromDb,
      weekday: anchorFromDb.weekday ?? now.getDay(),
      dayOfMonth: anchorFromDb.dayOfMonth ?? now.getDate(),
      month: anchorFromDb.month ?? (now.getMonth() + 1),
      day: anchorFromDb.day ?? now.getDate(),
    });
    setReminderLeadHours(group.reminder_lead_hours);
    setPaused(group.recurrence_paused_at !== null);
    setMembers(mems);
    setLoading(false);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [groupId, myId]);

  useFocusEffect(useCallback(() => { setLoading(true); load(); }, [load]));

  function invalidate() {
    cache.invalidate('groups', `group:${groupId}`, `group-members:${groupId}`);
  }

  async function handleSave() {
    if (!name.trim()) { toast.show('Group name is required.'); return; }
    setSaving(true);
    const { error } = await updateGroup(groupId, {
      name: name.trim(),
      recurrence,
      anchor: recurrence !== 'manual' ? anchor : undefined,
      unlockDurationHours: unlockHours,
      reminderLeadHours: recurrence !== 'manual' ? reminderLeadHours : null,
    });
    setSaving(false);
    if (error) { toast.show("Couldn't save the group — try again."); return; }
    invalidate();
    navigation.goBack();
  }

  async function handleTogglePause() {
    setPausing(true);
    const wasPaused = paused;
    setPaused(!wasPaused); // optimistic
    const { error } = wasPaused
      ? await resumeGroupRecurrence(groupId)
      : await pauseGroupRecurrence(groupId);
    setPausing(false);
    if (error) {
      setPaused(wasPaused);
      toast.show(wasPaused ? "Couldn't resume this group — try again." : "Couldn't pause this group — try again.");
      return;
    }
    invalidate();
  }

  const existingIds = new Set(members.map(m => m.user_id));

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
      // Exclude current members and blocked users (block-enforcement parity).
      setResults((data ?? []).filter((u: UserResult) => !existingIds.has(u.id) && !blockStore.has(u.id)));
      setSearching(false);
    }, 300);
  }

  async function addMember(user: UserResult) {
    Keyboard.dismiss();
    setSearch('');
    setResults([]);
    // Optimistic: show the row immediately; the fetch below reconciles.
    setMembers(prev => [...prev, { user_id: user.id, joined_at: new Date().toISOString(), users: { display_name: user.display_name, avatar_url: user.avatar_url } }]);
    const { error } = await addGroupMember(groupId, user.id);
    if (error) {
      setMembers(prev => prev.filter(m => m.user_id !== user.id));
      toast.show("Couldn't add that member — try again.");
      return;
    }
    invalidate();
  }

  function confirmRemove() {
    if (!pendingRemoval) return;
    const { userId } = pendingRemoval;
    const removed = members.find(m => m.user_id === userId) ?? null;
    setMembers(prev => prev.filter(m => m.user_id !== userId));
    setPendingRemoval(null);
    removeGroupMember(groupId, userId).then(({ error }) => {
      if (error) {
        if (removed) setMembers(prev => prev.some(m => m.user_id === userId) ? prev : [...prev, removed]);
        toast.show("Couldn't remove that member — try again.");
      } else {
        invalidate();
      }
    });
  }

  if (loading) {
    return (
      <SafeAreaView style={styles.container} edges={['top', 'left', 'right']}>
        <View style={styles.header}>
          <TouchableOpacity onPress={() => navigation.goBack()} hitSlop={8} accessibilityRole="button" accessibilityLabel="Close">
            <Ionicons name="close" size={24} color="#FFFFFF" />
          </TouchableOpacity>
          <Text style={styles.headerTitle}>Manage Group</Text>
          <View style={{ width: 50 }} />
        </View>
        <ActivityIndicator color={accentColor} style={{ marginTop: 40 }} />
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={styles.container} edges={['top', 'left', 'right']}>
      <View style={styles.header}>
        <TouchableOpacity onPress={() => navigation.goBack()} hitSlop={8} accessibilityRole="button" accessibilityLabel="Close">
          <Ionicons name="close" size={24} color="#FFFFFF" />
        </TouchableOpacity>
        <Text style={styles.headerTitle}>Manage Group</Text>
        <TouchableOpacity onPress={handleSave} disabled={saving || !name.trim()} hitSlop={8}>
          {saving
            ? <ActivityIndicator color={accentColor} size="small" />
            : <Text style={[styles.saveBtn, !name.trim() && styles.saveBtnDisabled, { color: accentColor }]}>Save</Text>}
        </TouchableOpacity>
      </View>

      <ScrollView style={styles.scroll} keyboardShouldPersistTaps="handled" contentContainerStyle={styles.content}>
        <View style={styles.section}>
          <Text style={styles.sectionLabel}>Group Name</Text>
          <TextInput
            style={styles.nameInput}
            value={name}
            onChangeText={t => setName(t.slice(0, 60))}
            placeholder="Group name"
            placeholderTextColor="#444444"
            maxLength={60}
          />
        </View>

        <View style={styles.section}>
          <Text style={styles.sectionLabel}>Schedule</Text>
          <View style={styles.optionGrid}>
            {RECURRENCE_OPTIONS.map(opt => {
              const active = recurrence === opt;
              return (
                <TouchableOpacity
                  key={opt}
                  style={[styles.optionChip, active && { backgroundColor: `${accentColor}26`, borderColor: accentColor }]}
                  onPress={() => setRecurrence(opt)}
                >
                  <Text style={[styles.optionChipText, active && { color: accentColor }]}>{recurrenceLabel(opt)}</Text>
                </TouchableOpacity>
              );
            })}
          </View>
          <RecurrenceAnchorPicker interval={recurrence} anchor={anchor} onChange={setAnchor} />
        </View>

        {recurrence !== 'manual' && (
          <View style={styles.section}>
            <Text style={styles.sectionLabel}>Remind Members</Text>
            <ReminderLeadPicker value={reminderLeadHours} onChange={setReminderLeadHours} />
          </View>
        )}

        {recurrence !== 'manual' && (
          <View style={styles.section}>
            <Text style={styles.sectionLabel}>Upcoming Capsules</Text>
            {paused ? (
              <Text style={styles.hintText}>Paused — no capsules will be created until resumed.</Text>
            ) : (
              computeUpcomingOccurrences(recurrence, anchor, new Date(), 3).map((d, i) => (
                <Text key={i} style={styles.hintText}>
                  {d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })}
                </Text>
              ))
            )}
            <TouchableOpacity
              style={[styles.pauseBtn, paused && { borderColor: accentColor }]}
              onPress={handleTogglePause}
              disabled={pausing}
              accessibilityRole="button"
              accessibilityLabel={paused ? 'Resume this group\'s schedule' : 'Pause this group\'s schedule'}
            >
              {pausing
                ? <ActivityIndicator color={accentColor} size="small" />
                : <Text style={[styles.pauseBtnText, paused && { color: accentColor }]}>{paused ? 'Resume Schedule' : 'Pause Schedule'}</Text>}
            </TouchableOpacity>
          </View>
        )}

        <View style={styles.section}>
          <Text style={styles.sectionLabel}>Default Unlock Duration</Text>
          <View style={styles.optionGrid}>
            {DURATION_OPTIONS.map(opt => {
              const active = unlockHours === opt.hours;
              return (
                <TouchableOpacity
                  key={opt.hours}
                  style={[styles.optionChip, active && { backgroundColor: `${accentColor}26`, borderColor: accentColor }]}
                  onPress={() => setUnlockHours(opt.hours)}
                >
                  <Text style={[styles.optionChipText, active && { color: accentColor }]}>{opt.label}</Text>
                </TouchableOpacity>
              );
            })}
          </View>
        </View>

        <View style={styles.section}>
          <Text style={styles.sectionLabel}>Members</Text>
          <View style={styles.searchBox}>
            <Ionicons name="search-outline" size={16} color="#555555" />
            <TextInput
              style={styles.searchInput}
              value={search}
              onChangeText={handleSearchChange}
              placeholder="Add by name"
              placeholderTextColor="#444444"
              autoCorrect={false}
            />
            {searching && <ActivityIndicator size="small" color="#555555" />}
          </View>

          {results.length > 0 && (
            <View style={styles.searchResults}>
              {results.map(user => (
                <TouchableOpacity key={user.id} style={styles.searchResultRow} onPress={() => addMember(user)}>
                  {user.avatar_url ? (
                    <Image source={transformAvatarUrl(user.avatar_url, 36)} style={styles.resultAvatar} contentFit="cover" />
                  ) : (
                    <Avatar url={null} name={user.display_name ?? '?'} size={36} />
                  )}
                  <Text style={styles.resultName}>{user.display_name ?? 'Unknown'}</Text>
                  <Ionicons name="add-circle-outline" size={20} color={accentColor} />
                </TouchableOpacity>
              ))}
            </View>
          )}

          <View style={styles.memberList}>
            {members.map(m => {
              const isCreator = m.user_id === createdBy;
              const displayName = m.users?.display_name ?? 'Member';
              return (
                <View key={m.user_id} style={styles.memberRow}>
                  <Avatar url={m.users?.avatar_url ?? null} name={displayName} size={40} />
                  <Text style={styles.memberName}>{displayName}</Text>
                  {isCreator ? (
                    <View style={[styles.ownerBadge, { borderColor: `${accentColor}50` }]}>
                      <Text style={[styles.ownerBadgeText, { color: accentColor }]}>Owner</Text>
                    </View>
                  ) : (
                    <TouchableOpacity
                      style={styles.removeBtn}
                      onPress={() => setPendingRemoval({ userId: m.user_id, name: displayName })}
                      hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
                      accessibilityRole="button"
                      accessibilityLabel={`Remove ${displayName}`}
                    >
                      <Ionicons name="person-remove-outline" size={20} color="#FF3B30" />
                    </TouchableOpacity>
                  )}
                </View>
              );
            })}
          </View>
        </View>
      </ScrollView>

      <ConfirmModal
        visible={pendingRemoval !== null}
        title="Remove member?"
        message={pendingRemoval ? `Remove ${pendingRemoval.name} from this group? They won't be added to future capsules.` : ''}
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
  header: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    paddingHorizontal: 20, paddingVertical: 14,
    borderBottomWidth: 1, borderBottomColor: '#1A1A1A',
  },
  headerTitle: { fontSize: 17, fontWeight: '700', color: '#FFFFFF' },
  saveBtn: { fontSize: 16, fontWeight: '700' },
  saveBtnDisabled: { opacity: 0.4 },
  scroll: { flex: 1 },
  content: { padding: 24, gap: 28, paddingBottom: 48 },
  section: { gap: 10 },
  sectionLabel: { fontSize: 13, fontWeight: '600', color: '#888888', textTransform: 'uppercase', letterSpacing: 0.5 },
  nameInput: {
    backgroundColor: '#1A1A1A', borderRadius: 12, paddingHorizontal: 16, paddingVertical: 14,
    fontSize: 16, color: '#FFFFFF', borderWidth: 1, borderColor: '#2A2A2A',
  },
  optionGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  optionChip: {
    paddingVertical: 8, paddingHorizontal: 16,
    borderRadius: 20, borderWidth: 1, borderColor: '#2A2A2A', backgroundColor: '#1A1A1A',
  },
  optionChipText: { fontSize: 14, fontWeight: '600', color: '#888888' },
  hintText: { fontSize: 13, color: '#888888' },
  pauseBtn: {
    marginTop: 4, paddingVertical: 10, borderRadius: 12, alignItems: 'center',
    borderWidth: 1, borderColor: '#2A2A2A', backgroundColor: '#1A1A1A',
  },
  pauseBtnText: { fontSize: 14, fontWeight: '600', color: '#888888' },
  searchBox: {
    flexDirection: 'row', alignItems: 'center', gap: 10,
    backgroundColor: '#1A1A1A', borderRadius: 12, paddingHorizontal: 14, paddingVertical: 12,
    borderWidth: 1, borderColor: '#2A2A2A',
  },
  searchInput: { flex: 1, fontSize: 15, color: '#FFFFFF' },
  searchResults: { backgroundColor: '#1A1A1A', borderRadius: 12, borderWidth: 1, borderColor: '#2A2A2A', overflow: 'hidden' },
  searchResultRow: {
    flexDirection: 'row', alignItems: 'center', gap: 12,
    paddingHorizontal: 14, paddingVertical: 10, borderBottomWidth: 1, borderBottomColor: '#2A2A2A',
  },
  resultAvatar: { width: 36, height: 36, borderRadius: 18 },
  resultName: { flex: 1, fontSize: 15, color: '#FFFFFF', fontWeight: '500' },
  memberList: { gap: 4, marginTop: 4 },
  memberRow: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingVertical: 10 },
  memberName: { flex: 1, fontSize: 16, fontWeight: '600', color: '#FFFFFF' },
  ownerBadge: {
    backgroundColor: '#1A1A1A', borderRadius: 6, paddingHorizontal: 8, paddingVertical: 3,
    borderWidth: 1, borderColor: '#2A2A2A',
  },
  ownerBadgeText: { fontSize: 11, fontWeight: '600' },
  removeBtn: { padding: 4 },
});
