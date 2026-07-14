import React, { useState, useRef, useCallback } from 'react';
import {
  View, Text, StyleSheet, TextInput, TouchableOpacity, ScrollView,
  ActivityIndicator, FlatList, Keyboard, LayoutAnimation,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useNavigation } from '@react-navigation/native';
import { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { Ionicons } from '@expo/vector-icons';
import { Image } from 'expo-image';
import { supabase } from '../../lib/supabase';
import { transformAvatarUrl } from '../../lib/avatarUrl';
import { sessionStore } from '../../lib/sessionStore';
import { cache } from '../../lib/cache';
import { blockStore } from '../../lib/blocks';
import { haptics } from '../../lib/haptics';
import { createGroup, GroupRecurrence, recurrenceLabel, unlockDurationLabel } from '../../lib/groups';
import RecurrenceAnchorPicker from '../../components/RecurrenceAnchorPicker';
import ReminderLeadPicker from '../../components/ReminderLeadPicker';
import { RecurrenceAnchor } from '../../lib/recurrence';
import { useTheme } from '../../context/ThemeContext';
import { AppStackParamList } from '../../types/navigation';

// Android LayoutAnimation is already enabled as a side effect of importing
// RecurrenceAnchorPicker above — no need to re-enable it here.
const SPRING = { duration: 220, update: { type: 'easeInEaseOut' as const }, delete: { type: 'easeInEaseOut' as const } };

type NavProp = NativeStackNavigationProp<AppStackParamList>;

interface UserResult {
  id: string;
  display_name: string | null;
  avatar_url: string | null;
}

const RECURRENCE_OPTIONS: GroupRecurrence[] = ['manual', 'weekly', 'monthly', 'yearly'];
const DURATION_OPTIONS = [
  { label: '1 week', hours: 168 },
  { label: '1 month', hours: 720 },
  { label: '3 months', hours: 2160 },
  { label: '6 months', hours: 4380 },
  { label: '1 year', hours: 8760 },
];
// Matches the DB CHECK constraint (unlock_duration_hours between 1 and 8760).
const MIN_CUSTOM_DAYS = 1;
const MAX_CUSTOM_DAYS = 365;

function defaultAnchor(): RecurrenceAnchor {
  const now = new Date();
  return {
    weekday: now.getDay(),
    dayOfMonth: now.getDate(),
    month: now.getMonth() + 1,
    day: now.getDate(),
    // UTC, not local — computeNextOccurrence's Date constructor is interpreted
    // in whatever timezone runs it (device-local here, UTC in the Deno cron
    // that actually fires this schedule). Storing a UTC hour/minute means the
    // cron's own interpretation of anchor_hour/anchor_minute stays correct and
    // stable forever, since UTC is a fixed reference rather than "local to
    // whoever's reading it." The calendar day fields above stay local, since
    // that's what the user sees as "today" when picking a default.
    hour: now.getUTCHours(),
    minute: now.getUTCMinutes(),
  };
}

export default function CreateGroupScreen() {
  const { accentColor } = useTheme();
  const navigation = useNavigation<NavProp>();

  const [name, setName] = useState('');
  const [recurrence, setRecurrence] = useState<GroupRecurrence>('manual');
  const [unlockHours, setUnlockHours] = useState(720);
  const [customUnlockSelected, setCustomUnlockSelected] = useState(false);
  const [customUnlockDays, setCustomUnlockDays] = useState('30');
  const [anchor, setAnchor] = useState<RecurrenceAnchor>(defaultAnchor);
  const [reminderLeadHours, setReminderLeadHours] = useState<number | null>(24);
  const [selectedMembers, setSelectedMembers] = useState<UserResult[]>([]);
  const [search, setSearch] = useState('');
  const [searchResults, setSearchResults] = useState<UserResult[]>([]);
  const [searching, setSearching] = useState(false);
  const [creating, setCreating] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const searchDebounce = useRef<ReturnType<typeof setTimeout> | null>(null);

  const myId = sessionStore.get()?.user?.id ?? null;
  const selectedIds = new Set(selectedMembers.map(m => m.id));

  const handleSearchChange = useCallback((text: string) => {
    setSearch(text);
    if (searchDebounce.current) clearTimeout(searchDebounce.current);
    if (text.trim().length < 2) {
      setSearchResults([]);
      return;
    }
    searchDebounce.current = setTimeout(async () => {
      setSearching(true);
      const { data } = await supabase
        .from('users')
        .select('id, display_name, avatar_url')
        .ilike('display_name', `%${text.trim()}%`)
        .neq('id', myId ?? '')
        .limit(10);
      // Exclude already-selected and blocked users (block-enforcement parity
      // with InviteModal's search).
      setSearchResults((data ?? []).filter((u: UserResult) => !selectedIds.has(u.id) && !blockStore.has(u.id)));
      setSearching(false);
    }, 300);
  }, [myId, selectedIds]);

  function addMember(user: UserResult) {
    setSelectedMembers(prev => [...prev, user]);
    setSearch('');
    setSearchResults([]);
    Keyboard.dismiss();
  }

  function removeMember(userId: string) {
    setSelectedMembers(prev => prev.filter(m => m.id !== userId));
  }

  function selectDurationPreset(hours: number) {
    haptics.selection();
    LayoutAnimation.configureNext(SPRING);
    setCustomUnlockSelected(false);
    setUnlockHours(hours);
  }

  function selectCustomDuration() {
    haptics.selection();
    LayoutAnimation.configureNext(SPRING);
    setCustomUnlockSelected(true);
    setCustomUnlockDays(String(Math.max(MIN_CUSTOM_DAYS, Math.round(unlockHours / 24))));
  }

  function handleCustomDurationChange(text: string) {
    setCustomUnlockDays(text);
    const days = parseInt(text, 10);
    if (!Number.isNaN(days) && days >= MIN_CUSTOM_DAYS && days <= MAX_CUSTOM_DAYS) {
      setUnlockHours(days * 24);
    }
  }

  async function handleCreate() {
    const trimmedName = name.trim();
    if (!trimmedName) { setError('Group name is required.'); return; }
    setError(null);
    setCreating(true);
    const { groupId, error: err } = await createGroup({
      name: trimmedName,
      memberIds: selectedMembers.map(m => m.id),
      recurrence,
      anchor: recurrence !== 'manual' ? anchor : undefined,
      unlockDurationHours: unlockHours,
      reminderLeadHours: recurrence !== 'manual' ? reminderLeadHours : null,
    });
    setCreating(false);
    if (err || !groupId) {
      setError(err ?? 'Could not create group.');
      return;
    }
    cache.invalidate('groups');
    navigation.replace('GroupDetail', { groupId });
  }

  return (
    <SafeAreaView style={styles.container} edges={['top', 'left', 'right']}>
      <View style={styles.header}>
        <TouchableOpacity onPress={() => navigation.goBack()} hitSlop={8} accessibilityRole="button" accessibilityLabel="Close">
          <Ionicons name="close" size={24} color="#FFFFFF" />
        </TouchableOpacity>
        <Text style={styles.headerTitle}>New Group</Text>
        <TouchableOpacity
          onPress={handleCreate}
          disabled={creating || !name.trim()}
          hitSlop={8}
        >
          {creating ? (
            <ActivityIndicator color={accentColor} size="small" />
          ) : (
            <Text style={[styles.createBtn, !name.trim() && styles.createBtnDisabled, { color: accentColor }]}>
              Create
            </Text>
          )}
        </TouchableOpacity>
      </View>

      <ScrollView style={styles.scroll} keyboardShouldPersistTaps="handled" contentContainerStyle={styles.content}>
        <View style={styles.section}>
          <Text style={styles.sectionLabel}>Group Name</Text>
          <TextInput
            style={styles.nameInput}
            value={name}
            onChangeText={text => { setName(text.slice(0, 60)); setError(null); }}
            placeholder="e.g. College Friends, Family, Work Team"
            placeholderTextColor="#444444"
            maxLength={60}
            returnKeyType="done"
            autoFocus
          />
          <Text style={styles.charCount}>{name.length}/60</Text>
        </View>

        <View style={styles.section}>
          <Text style={styles.sectionLabel}>Add Members</Text>
          <View style={styles.searchBox}>
            <Ionicons name="search-outline" size={16} color="#555555" />
            <TextInput
              style={styles.searchInput}
              value={search}
              onChangeText={handleSearchChange}
              placeholder="Search by name"
              placeholderTextColor="#444444"
              autoCorrect={false}
            />
            {searching && <ActivityIndicator size="small" color="#555555" />}
          </View>

          {searchResults.length > 0 && (
            <View style={styles.searchResults}>
              {searchResults.map(user => (
                <TouchableOpacity
                  key={user.id}
                  style={styles.searchResultRow}
                  onPress={() => addMember(user)}
                >
                  {user.avatar_url ? (
                    <Image source={transformAvatarUrl(user.avatar_url, 36)} style={styles.resultAvatar} contentFit="cover" />
                  ) : (
                    <View style={styles.resultAvatarFallback}>
                      <Text style={styles.resultAvatarInitial}>
                        {(user.display_name ?? '?')[0].toUpperCase()}
                      </Text>
                    </View>
                  )}
                  <Text style={styles.resultName}>{user.display_name ?? 'Unknown'}</Text>
                  <Ionicons name="add-circle-outline" size={20} color={accentColor} />
                </TouchableOpacity>
              ))}
            </View>
          )}

          {selectedMembers.length > 0 && (
            <View style={styles.selectedChips}>
              {selectedMembers.map(m => (
                <View key={m.id} style={styles.chip}>
                  {m.avatar_url ? (
                    <Image source={transformAvatarUrl(m.avatar_url, 22)} style={styles.chipAvatar} contentFit="cover" />
                  ) : (
                    <View style={styles.chipAvatarFallback}>
                      <Text style={styles.chipAvatarInitial}>
                        {(m.display_name ?? '?')[0].toUpperCase()}
                      </Text>
                    </View>
                  )}
                  <Text style={styles.chipName} numberOfLines={1}>{m.display_name ?? 'Unknown'}</Text>
                  <TouchableOpacity onPress={() => removeMember(m.id)} hitSlop={4}>
                    <Ionicons name="close-circle" size={16} color="#555555" />
                  </TouchableOpacity>
                </View>
              ))}
            </View>
          )}
        </View>

        <View style={styles.section}>
          <Text style={styles.sectionLabel}>Schedule</Text>
          <Text style={styles.sectionHint}>Auto-create a capsule for this group on a schedule.</Text>
          <View style={styles.recurrenceRow}>
            {RECURRENCE_OPTIONS.map(opt => {
              const active = recurrence === opt;
              return (
                <TouchableOpacity
                  key={opt}
                  style={[styles.recurrenceChip, active && { backgroundColor: `${accentColor}26`, borderColor: accentColor }]}
                  onPress={() => setRecurrence(opt)}
                >
                  <Text style={[styles.recurrenceChipText, active && { color: accentColor }]} numberOfLines={1}>
                    {recurrenceLabel(opt)}
                  </Text>
                </TouchableOpacity>
              );
            })}
          </View>
          <RecurrenceAnchorPicker interval={recurrence} anchor={anchor} onChange={setAnchor} />
        </View>

        <View style={styles.section}>
          <Text style={styles.sectionLabel}>Default Unlock Duration</Text>
          <Text style={styles.sectionHint}>How long until each capsule opens.</Text>
          <View style={styles.durationGrid}>
            <View style={styles.durationGridRow}>
              {DURATION_OPTIONS.slice(0, 3).map(opt => {
                const active = !customUnlockSelected && unlockHours === opt.hours;
                return (
                  <TouchableOpacity
                    key={opt.hours}
                    style={[styles.durationChip, active && { backgroundColor: `${accentColor}26`, borderColor: accentColor }]}
                    onPress={() => selectDurationPreset(opt.hours)}
                  >
                    <Text style={[styles.durationChipText, active && { color: accentColor }]} numberOfLines={1}>
                      {opt.label}
                    </Text>
                  </TouchableOpacity>
                );
              })}
            </View>
            <View style={styles.durationGridRow}>
              {DURATION_OPTIONS.slice(3).map(opt => {
                const active = !customUnlockSelected && unlockHours === opt.hours;
                return (
                  <TouchableOpacity
                    key={opt.hours}
                    style={[styles.durationChip, active && { backgroundColor: `${accentColor}26`, borderColor: accentColor }]}
                    onPress={() => selectDurationPreset(opt.hours)}
                  >
                    <Text style={[styles.durationChipText, active && { color: accentColor }]} numberOfLines={1}>
                      {opt.label}
                    </Text>
                  </TouchableOpacity>
                );
              })}
              <TouchableOpacity
                style={[styles.durationChip, customUnlockSelected && { backgroundColor: `${accentColor}26`, borderColor: accentColor }]}
                onPress={selectCustomDuration}
              >
                <Text style={[styles.durationChipText, customUnlockSelected && { color: accentColor }]} numberOfLines={1}>Custom</Text>
              </TouchableOpacity>
            </View>
          </View>
          {customUnlockSelected && (
            <View style={styles.customRow}>
              <TextInput
                style={styles.customInput}
                value={customUnlockDays}
                onChangeText={handleCustomDurationChange}
                keyboardType="number-pad"
                maxLength={3}
                placeholder="30"
                placeholderTextColor="#555"
              />
              <Text style={styles.customLabel}>days</Text>
            </View>
          )}
        </View>

        {recurrence !== 'manual' && (
          <View style={styles.section}>
            <Text style={styles.sectionLabel}>Remind Members</Text>
            <Text style={styles.sectionHint}>Heads-up before the next capsule is auto-created.</Text>
            <ReminderLeadPicker value={reminderLeadHours} onChange={setReminderLeadHours} />
          </View>
        )}

        {error ? <Text style={styles.errorText}>{error}</Text> : null}

        <TouchableOpacity
          style={[styles.createButton, { backgroundColor: accentColor }, (!name.trim() || creating) && styles.createButtonDisabled]}
          onPress={handleCreate}
          disabled={creating || !name.trim()}
        >
          {creating ? (
            <ActivityIndicator color="#FFFFFF" />
          ) : (
            <Text style={styles.createButtonText}>Create Group</Text>
          )}
        </TouchableOpacity>
      </ScrollView>
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
  createBtn: { fontSize: 16, fontWeight: '700' },
  createBtnDisabled: { opacity: 0.4 },
  scroll: { flex: 1 },
  content: { padding: 24, gap: 28, paddingBottom: 48 },
  section: { gap: 10 },
  sectionLabel: { fontSize: 13, fontWeight: '600', color: '#555555', textTransform: 'uppercase', letterSpacing: 0.5 },
  sectionHint: { fontSize: 13, color: '#888888', marginTop: -4 },
  nameInput: {
    backgroundColor: '#1A1A1A', borderRadius: 12, paddingHorizontal: 16, paddingVertical: 14,
    fontSize: 16, color: '#FFFFFF', borderWidth: 1, borderColor: '#2A2A2A',
  },
  charCount: { fontSize: 12, color: '#444444', alignSelf: 'flex-end', marginTop: -4 },
  searchBox: {
    flexDirection: 'row', alignItems: 'center', gap: 10,
    backgroundColor: '#1A1A1A', borderRadius: 12, paddingHorizontal: 14, paddingVertical: 12,
    borderWidth: 1, borderColor: '#2A2A2A',
  },
  searchInput: { flex: 1, fontSize: 15, color: '#FFFFFF' },
  searchResults: {
    backgroundColor: '#1A1A1A', borderRadius: 12, borderWidth: 1, borderColor: '#2A2A2A', overflow: 'hidden',
  },
  searchResultRow: {
    flexDirection: 'row', alignItems: 'center', gap: 12,
    paddingHorizontal: 14, paddingVertical: 10,
    borderBottomWidth: 1, borderBottomColor: '#2A2A2A',
  },
  resultAvatar: { width: 36, height: 36, borderRadius: 18 },
  resultAvatarFallback: {
    width: 36, height: 36, borderRadius: 18,
    backgroundColor: '#2A2A2A', alignItems: 'center', justifyContent: 'center',
  },
  resultAvatarInitial: { fontSize: 15, fontWeight: '700', color: '#FFFFFF' },
  resultName: { flex: 1, fontSize: 15, color: '#FFFFFF', fontWeight: '500' },
  selectedChips: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  chip: {
    flexDirection: 'row', alignItems: 'center', gap: 6,
    backgroundColor: '#1A1A1A', borderRadius: 20, paddingVertical: 6, paddingHorizontal: 10,
    borderWidth: 1, borderColor: '#2A2A2A', maxWidth: 160,
  },
  chipAvatar: { width: 22, height: 22, borderRadius: 11 },
  chipAvatarFallback: {
    width: 22, height: 22, borderRadius: 11,
    backgroundColor: '#2A2A2A', alignItems: 'center', justifyContent: 'center',
  },
  chipAvatarInitial: { fontSize: 10, fontWeight: '700', color: '#FFFFFF' },
  chipName: { flex: 1, fontSize: 13, color: '#DDDDDD', fontWeight: '500' },
  // 5 presets + Custom = exactly 6 — a clean 3-column x 2-row grid (mirrors
  // RecurrenceAnchorPicker's month grid) where each chip takes an equal flex
  // share, so both rows fill the full row width edge to edge instead of
  // wrapping to whatever width each chip's own text happens to need.
  durationGrid: { gap: 8 },
  durationGridRow: { flexDirection: 'row', gap: 8 },
  durationChip: {
    // paddingVertical 12 (not 8) so the tappable height clears the 44pt
    // minimum touch target once combined with the 13px text — the 5
    // presets + Custom are real actions, not decorative labels.
    flex: 1, alignItems: 'center', paddingVertical: 12, paddingHorizontal: 4,
    borderRadius: 20, borderWidth: 1, borderColor: '#2A2A2A',
    backgroundColor: '#1A1A1A',
  },
  durationChipText: { fontSize: 13, fontWeight: '600', color: '#888888' },
  customRow: { flexDirection: 'row', alignItems: 'center', gap: 12, marginTop: 2 },
  customInput: {
    backgroundColor: '#1A1A1A', borderRadius: 12, paddingHorizontal: 16, paddingVertical: 13,
    color: '#FFFFFF', fontSize: 16, borderWidth: 1, borderColor: '#2A2A2A',
    width: 90, textAlign: 'center',
  },
  customLabel: { color: '#888888', fontSize: 15 },
  // Distinct from optionGrid/optionChip (used by the 5-item Duration row,
  // which still wraps) — this row always has exactly 4 items and must fit
  // on one line, so each chip takes an equal flex share instead of sizing to
  // its own text and wrapping onto a second row.
  recurrenceRow: { flexDirection: 'row', gap: 8 },
  recurrenceChip: {
    flex: 1, alignItems: 'center', paddingVertical: 8, paddingHorizontal: 4,
    borderRadius: 20, borderWidth: 1, borderColor: '#2A2A2A', backgroundColor: '#1A1A1A',
  },
  recurrenceChipText: { fontSize: 13, fontWeight: '600', color: '#888888' },
  errorText: { fontSize: 14, color: '#FF3B30', textAlign: 'center' },
  createButton: {
    borderRadius: 16, paddingVertical: 16, alignItems: 'center', marginTop: 8,
  },
  createButtonDisabled: { opacity: 0.5 },
  createButtonText: { fontSize: 17, fontWeight: '700', color: '#FFFFFF' },
});
