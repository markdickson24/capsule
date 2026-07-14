import React, { useState, useRef, useCallback, useMemo } from 'react';
import {
  View, Text, StyleSheet, TextInput, TouchableOpacity, ScrollView,
  ActivityIndicator, FlatList, Keyboard, Platform, LayoutAnimation, UIManager,
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
import { toast } from '../../lib/toast';
import { haptics } from '../../lib/haptics';
import { blockStore } from '../../lib/blocks';
import { createGroup, GroupRecurrence, recurrenceLabel, unlockDurationLabel } from '../../lib/groups';
import RecurrenceAnchorPicker, { describeAnchor } from '../../components/RecurrenceAnchorPicker';
import ReminderLeadPicker from '../../components/ReminderLeadPicker';
import DatePickerField, { QuickOption } from '../../components/DatePicker';
import { RecurrenceAnchor } from '../../lib/recurrence';
import { useTheme } from '../../context/ThemeContext';
import { AppStackParamList } from '../../types/navigation';

// Same LayoutAnimation setup as RecurrenceAnchorPicker/DatePicker — idempotent
// to call again here.
if (Platform.OS === 'android' && UIManager.setLayoutAnimationEnabledExperimental) {
  UIManager.setLayoutAnimationEnabledExperimental(true);
}
const SPRING = { duration: 220, update: { type: 'easeInEaseOut' as const }, delete: { type: 'easeInEaseOut' as const } };

const REMINDER_LABELS: Record<number, string> = { 24: '1 day', 72: '3 days', 168: '1 week' };
function reminderSummary(hours: number | null): string {
  if (hours == null) return 'no reminder';
  return `remind ${REMINDER_LABELS[hours] ?? `${hours}h`} before`;
}

const SCHEDULE_HINTS: Record<GroupRecurrence, string> = {
  manual: 'No schedule — anyone in the group can start a capsule anytime.',
  weekly: 'A new capsule is created automatically every week.',
  monthly: 'A new capsule is created automatically every month.',
  yearly: 'A new capsule is created automatically every year.',
};

type NavProp = NativeStackNavigationProp<AppStackParamList>;

interface UserResult {
  id: string;
  display_name: string | null;
  avatar_url: string | null;
}

const RECURRENCE_OPTIONS: GroupRecurrence[] = ['manual', 'weekly', 'monthly', 'yearly'];

function addDaysFromNow(days: number): Date {
  const d = new Date();
  d.setDate(d.getDate() + days);
  return d;
}

// Longer-range presets than DatePickerField's capsule-unlock-date default
// (Tomorrow/1 week/1 month/3 months) — a group's default duration between
// capsules skews much longer than a single capsule's typical unlock wait.
const GROUP_DURATION_QUICK_OPTIONS: QuickOption[] = [
  { label: '1 week', icon: 'calendar-outline', getDate: () => addDaysFromNow(7) },
  { label: '1 month', icon: 'calendar-number-outline', getDate: () => addDaysFromNow(30) },
  { label: '3 months', icon: 'time-outline', getDate: () => addDaysFromNow(90) },
  { label: '1 year', icon: 'hourglass-outline', getDate: () => addDaysFromNow(365) },
];

// Matches the DB CHECK constraint (unlock_duration_hours between 1 and 8760).
const MIN_DURATION_HOURS = 1;
const MAX_DURATION_HOURS = 8760;

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
  // Anchor point for translating unlockHours (a pure duration) into a Date
  // DatePickerField can display/edit — captured once so the previewed date
  // doesn't drift on unrelated re-renders while unlockHours stays fixed.
  const unlockBaseNow = useRef(Date.now()).current;
  const unlockPreviewDate = useMemo(
    () => new Date(unlockBaseNow + unlockHours * 3_600_000),
    [unlockBaseNow, unlockHours],
  );
  const [anchor, setAnchor] = useState<RecurrenceAnchor>(defaultAnchor);
  const [reminderLeadHours, setReminderLeadHours] = useState<number | null>(24);
  const [selectedMembers, setSelectedMembers] = useState<UserResult[]>([]);
  const [search, setSearch] = useState('');
  const [searchResults, setSearchResults] = useState<UserResult[]>([]);
  const [searching, setSearching] = useState(false);
  const [creating, setCreating] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [nameError, setNameError] = useState<string | null>(null);
  const [detailsOpen, setDetailsOpen] = useState(false);
  const searchDebounce = useRef<ReturnType<typeof setTimeout> | null>(null);

  const myId = sessionStore.get()?.user?.id ?? null;
  const selectedIds = new Set(selectedMembers.map(m => m.id));

  const handleSearchChange = useCallback((text: string) => {
    setSearch(text);
    if (searchDebounce.current) clearTimeout(searchDebounce.current);
    if (text.trim().length < 2) {
      setSearchResults([]);
      setSearching(false);
      return;
    }
    // Set immediately (not inside the timeout) so the "No one found" state
    // — gated on `!searching` — can't flash true during the 300ms debounce
    // window before the actual query has even started.
    setSearching(true);
    searchDebounce.current = setTimeout(async () => {
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

  function handleUnlockDateChange(date: Date | null) {
    if (!date) return;
    const hours = Math.round((date.getTime() - unlockBaseNow) / 3_600_000);
    setUnlockHours(Math.max(MIN_DURATION_HOURS, Math.min(MAX_DURATION_HOURS, hours)));
  }

  function selectRecurrence(opt: GroupRecurrence) {
    haptics.selection();
    LayoutAnimation.configureNext(SPRING);
    setRecurrence(opt);
  }

  function toggleDetails() {
    haptics.selection();
    LayoutAnimation.configureNext(SPRING);
    setDetailsOpen(v => !v);
  }

  async function handleCreate() {
    const trimmedName = name.trim();
    if (!trimmedName) { setNameError('Give your group a name.'); return; }
    setNameError(null);
    setError(null);
    setCreating(true);
    const { groupId, error: err, memberError } = await createGroup({
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
    if (memberError) toast.show("Couldn't add some members — add them from the group page.");
    haptics.success();
    cache.invalidate('groups');
    navigation.replace('GroupDetail', { groupId, justCreated: true });
  }

  return (
    <SafeAreaView style={styles.container} edges={['top', 'left', 'right']}>
      <View style={styles.header}>
        <TouchableOpacity onPress={() => navigation.goBack()} hitSlop={8} accessibilityRole="button" accessibilityLabel="Close">
          <Ionicons name="close" size={24} color="#FFFFFF" />
        </TouchableOpacity>
        <Text style={styles.headerTitle}>New Group</Text>
        <View style={{ width: 24 }} />
      </View>

      <ScrollView style={styles.scroll} keyboardShouldPersistTaps="handled" contentContainerStyle={styles.content}>
        <View style={styles.section}>
          <Text style={styles.sectionLabel}>Group Name</Text>
          <TextInput
            style={[styles.nameInput, nameError && styles.inputError]}
            value={name}
            onChangeText={text => { setName(text.slice(0, 60)); setNameError(null); }}
            placeholder="e.g. College Friends, Family, Work Team"
            placeholderTextColor="#444444"
            maxLength={60}
            returnKeyType="done"
          />
          <View style={styles.nameFooter}>
            {nameError ? <Text style={styles.fieldError}>{nameError}</Text> : <View />}
            <Text style={styles.charCount}>{name.length}/60</Text>
          </View>
        </View>

        <View style={styles.section}>
          <Text style={styles.sectionLabel}>Add Members</Text>
          <Text style={styles.sectionHint}>Optional — you can always add people later.</Text>
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

          {!searching && search.trim().length >= 2 && searchResults.length === 0 && (
            <Text style={styles.noResultsText}>No one found — try a different name.</Text>
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
                  <TouchableOpacity
                    onPress={() => removeMember(m.id)}
                    hitSlop={10}
                    accessibilityRole="button"
                    accessibilityLabel={`Remove ${m.display_name ?? 'member'}`}
                  >
                    <Ionicons name="close-circle" size={16} color="#555555" />
                  </TouchableOpacity>
                </View>
              ))}
            </View>
          )}
        </View>

        <View style={styles.section}>
          <Text style={styles.sectionLabel}>Schedule</Text>
          <View style={styles.recurrenceRow}>
            {RECURRENCE_OPTIONS.map(opt => {
              const active = recurrence === opt;
              return (
                <TouchableOpacity
                  key={opt}
                  style={[styles.recurrenceChip, active && { backgroundColor: `${accentColor}26`, borderColor: accentColor }]}
                  onPress={() => selectRecurrence(opt)}
                >
                  <Text style={[styles.recurrenceChipText, active && { color: accentColor }]} numberOfLines={1}>
                    {recurrenceLabel(opt)}
                  </Text>
                </TouchableOpacity>
              );
            })}
          </View>
          <Text style={styles.sectionHint}>{SCHEDULE_HINTS[recurrence]}</Text>

          {recurrence !== 'manual' && (
            <View style={styles.detailsCard}>
              <TouchableOpacity
                style={styles.detailsToggle}
                onPress={toggleDetails}
                activeOpacity={0.7}
                accessibilityRole="button"
                accessibilityLabel={detailsOpen ? 'Collapse schedule details' : 'Expand schedule details'}
              >
                <View style={styles.detailsToggleTextWrap}>
                  <Text style={styles.detailsToggleLabel}>Schedule details</Text>
                  {!detailsOpen && (
                    <Text style={styles.detailsSummary} numberOfLines={1}>
                      {describeAnchor(recurrence, anchor).compact} · unlocks after {unlockDurationLabel(unlockHours)} · {reminderSummary(reminderLeadHours)}
                    </Text>
                  )}
                </View>
                <Ionicons name={detailsOpen ? 'chevron-up' : 'chevron-down'} size={18} color="#888888" />
              </TouchableOpacity>

              {detailsOpen && (
                <View style={styles.detailsBody}>
                  <RecurrenceAnchorPicker interval={recurrence} anchor={anchor} onChange={setAnchor} />

                  <DatePickerField
                    label="Default Unlock Duration"
                    value={unlockPreviewDate}
                    onChange={handleUnlockDateChange}
                    quickOptions={GROUP_DURATION_QUICK_OPTIONS}
                    contextLabel="How long each capsule stays locked after it's created"
                  />

                  <View>
                    <Text style={styles.sectionLabel}>Remind Members</Text>
                    <Text style={styles.sectionHint}>Heads-up before the next capsule is auto-created.</Text>
                    <ReminderLeadPicker value={reminderLeadHours} onChange={setReminderLeadHours} />
                  </View>
                </View>
              )}
            </View>
          )}
        </View>

        {error ? <Text style={styles.errorText}>{error}</Text> : null}

        <TouchableOpacity
          style={[styles.createButton, { backgroundColor: accentColor }, creating && styles.createButtonDisabled]}
          onPress={handleCreate}
          disabled={creating}
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
  scroll: { flex: 1 },
  content: { padding: 24, gap: 28, paddingBottom: 48 },
  section: { gap: 10 },
  sectionLabel: { fontSize: 13, fontWeight: '600', color: '#555555', textTransform: 'uppercase', letterSpacing: 0.5 },
  sectionHint: { fontSize: 13, color: '#888888', marginTop: -4 },
  nameInput: {
    backgroundColor: '#1A1A1A', borderRadius: 12, paddingHorizontal: 16, paddingVertical: 14,
    fontSize: 16, color: '#FFFFFF', borderWidth: 1, borderColor: '#2A2A2A',
  },
  inputError: { borderColor: '#FF3B30' },
  nameFooter: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginTop: -4 },
  fieldError: { fontSize: 12, color: '#FF3B30', flex: 1 },
  charCount: { fontSize: 12, color: '#444444' },
  noResultsText: { fontSize: 13, color: '#888888' },
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
  // Recurrence chips: always exactly 4 fixed options — same single-line-via-flex
  // treatment as the reminder/weekday rows, so nothing wraps onto its own row.
  recurrenceRow: { flexDirection: 'row', gap: 8 },
  recurrenceChip: {
    flex: 1, alignItems: 'center', paddingVertical: 8, paddingHorizontal: 4,
    borderRadius: 20, borderWidth: 1, borderColor: '#2A2A2A', backgroundColor: '#1A1A1A',
  },
  recurrenceChipText: { fontSize: 13, fontWeight: '600', color: '#888888' },
  // Collapsed-by-default "Schedule details" disclosure — mirrors CreateScreen's
  // "More options" pattern: only the recurrence choice itself stays always
  // visible, everything pre-defaulted (anchor, unlock duration, reminder)
  // collapses behind one toggle with a one-line summary.
  detailsCard: {
    backgroundColor: '#111111', borderRadius: 16, borderWidth: 1, borderColor: '#1E1E1E', overflow: 'hidden',
  },
  detailsToggle: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    paddingHorizontal: 16, paddingVertical: 14, gap: 12,
  },
  detailsToggleTextWrap: { flex: 1, gap: 2 },
  detailsToggleLabel: { fontSize: 15, fontWeight: '600', color: '#FFFFFF' },
  detailsSummary: { fontSize: 12, color: '#888888' },
  detailsBody: { paddingHorizontal: 14, paddingBottom: 14, gap: 24 },
  errorText: { fontSize: 14, color: '#FF3B30', textAlign: 'center' },
  createButton: {
    borderRadius: 16, paddingVertical: 16, alignItems: 'center', marginTop: 8,
  },
  createButtonDisabled: { opacity: 0.5 },
  createButtonText: { fontSize: 17, fontWeight: '700', color: '#FFFFFF' },
});
