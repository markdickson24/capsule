import React, { useState, useRef, useCallback } from 'react';
import {
  View, Text, StyleSheet, TextInput, TouchableOpacity, ScrollView,
  ActivityIndicator, FlatList, Keyboard,
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
import { createGroup, GroupRecurrence, recurrenceLabel, unlockDurationLabel } from '../../lib/groups';
import RecurrenceAnchorPicker from '../../components/RecurrenceAnchorPicker';
import ReminderLeadPicker from '../../components/ReminderLeadPicker';
import { RecurrenceAnchor } from '../../lib/recurrence';
import { useTheme } from '../../context/ThemeContext';
import { AppStackParamList } from '../../types/navigation';

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

function defaultAnchor(): RecurrenceAnchor {
  const now = new Date();
  return {
    weekday: now.getDay(),
    dayOfMonth: now.getDate(),
    month: now.getMonth() + 1,
    day: now.getDate(),
    hour: now.getHours(),
    minute: now.getMinutes(),
  };
}

export default function CreateGroupScreen() {
  const { accentColor } = useTheme();
  const navigation = useNavigation<NavProp>();

  const [name, setName] = useState('');
  const [recurrence, setRecurrence] = useState<GroupRecurrence>('manual');
  const [unlockHours, setUnlockHours] = useState(720);
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
          <View style={styles.optionGrid}>
            {RECURRENCE_OPTIONS.map(opt => {
              const active = recurrence === opt;
              return (
                <TouchableOpacity
                  key={opt}
                  style={[styles.optionChip, active && { backgroundColor: `${accentColor}26`, borderColor: accentColor }]}
                  onPress={() => setRecurrence(opt)}
                >
                  <Text style={[styles.optionChipText, active && { color: accentColor }]}>
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
          <View style={styles.optionGrid}>
            {DURATION_OPTIONS.map(opt => {
              const active = unlockHours === opt.hours;
              return (
                <TouchableOpacity
                  key={opt.hours}
                  style={[styles.optionChip, active && { backgroundColor: `${accentColor}26`, borderColor: accentColor }]}
                  onPress={() => setUnlockHours(opt.hours)}
                >
                  <Text style={[styles.optionChipText, active && { color: accentColor }]}>
                    {opt.label}
                  </Text>
                </TouchableOpacity>
              );
            })}
          </View>
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
  optionGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  optionChip: {
    paddingVertical: 8, paddingHorizontal: 16,
    borderRadius: 20, borderWidth: 1, borderColor: '#2A2A2A',
    backgroundColor: '#1A1A1A',
  },
  optionChipText: { fontSize: 14, fontWeight: '600', color: '#888888' },
  errorText: { fontSize: 14, color: '#FF3B30', textAlign: 'center' },
  createButton: {
    borderRadius: 16, paddingVertical: 16, alignItems: 'center', marginTop: 8,
  },
  createButtonDisabled: { opacity: 0.5 },
  createButtonText: { fontSize: 17, fontWeight: '700', color: '#FFFFFF' },
});
