import React, { useState, useRef } from 'react';
import InfoTooltip from '../../components/InfoTooltip';
import LoadingBrand from '../../components/LoadingBrand';
import {
  View, Text, StyleSheet, TextInput, Animated,
  TouchableOpacity, ScrollView, Switch,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useNavigation, useRoute, RouteProp } from '@react-navigation/native';
import { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { supabase } from '../../lib/supabase';
import { sessionStore } from '../../lib/sessionStore';
import { randomUUID } from '../../lib/uuid';
import { Ionicons } from '@expo/vector-icons';
import { AppStackParamList, AppTabParamList, PendingMedia } from '../../types/navigation';
import { UnlockMode } from '../../types/database';
import { useTheme } from '../../context/ThemeContext';
import DatePickerField from '../../components/DatePicker';
import VotingWindowPicker from '../../components/VotingWindowPicker';
import DefaultAwardsCard from '../../components/DefaultAwardsCard';
import { cache } from '../../lib/cache';
import { uploadQueue } from '../../lib/uploadQueue';
import { useSlideUp, useFadeIn } from '../../lib/animations';
import { getGroupMembers } from '../../lib/groups';
import { OCCASIONS, OccasionKey, PresetAward, pickDefaults } from '../../lib/awardPool';

const UNLOCK_MODES: { mode: UnlockMode; label: string }[] = [
  { mode: 'time', label: 'Date' },
  { mode: 'proximity', label: 'Together' },
  { mode: 'both', label: 'Both' },
];

function unlockModeHint(mode: UnlockMode) {
  if (mode === 'time') return 'Opens on the date you set.';
  if (mode === 'proximity') return 'Opens when all members are in the same place.';
  return 'Opens once the date has passed and all members are together.';
}

function defaultUnlockDate() {
  const d = new Date();
  d.setMonth(d.getMonth() + 1);
  return d;
}


export default function CreateScreen() {
  const { accentColor } = useTheme();
  const navigation = useNavigation<NativeStackNavigationProp<AppStackParamList>>();
  // Screen is reused for both the Create tab and the CreateCapsule stack route.
  const route = useRoute<any>();
  const params = (route.params ?? {}) as any;
  const pendingMedia: PendingMedia[] | null = params.pendingMedia ?? null;
  const pendingCount = pendingMedia?.length ?? 0;
  const pendingHasVideo = pendingMedia?.some((m: PendingMedia) => m.mediaType === 'video') ?? false;
  const pendingHasPhoto = pendingMedia?.some((m: PendingMedia) => m.mediaType === 'photo') ?? false;
  const groupId: string | null = params.groupId ?? null;
  const groupUnlockHours: number | null = params.groupUnlockHours ?? null;
  const isStackPush = route.name === 'CreateCapsule';
  const [title, setTitle] = useState(route.params?.presetTitle ?? '');
  const [description, setDescription] = useState(route.params?.presetDescription ?? '');
  const [unlockDate, setUnlockDate] = useState<Date | null>(
    groupUnlockHours ? new Date(Date.now() + groupUnlockHours * 3_600_000) : defaultUnlockDate()
  );
  const [contribLockDate, setContribLockDate] = useState<Date | null>(null);
  const [unlockMode, setUnlockMode] = useState<UnlockMode>('time');
  const [votingHours, setVotingHours] = useState(48);
  const [hideFromMe, setHideFromMe] = useState(true);
  const [occasion, setOccasion] = useState<OccasionKey>('general');
  const [defaultAwards, setDefaultAwards] = useState<PresetAward[]>(() => pickDefaults('general'));
  const [loading, setLoading] = useState(false);
  // Uploads deadline / voting window / occasion+awards are all pre-defaulted
  // and editable later (voting window, awards pre-unlock) — collapsing them
  // behind a disclosure costs a new user nothing but removes 3 of the 8
  // decisions from the critical path to "Lock Capsule".
  const [advancedOpen, setAdvancedOpen] = useState(false);
  type FieldErrors = {
    title?: string; description?: string; unlockDate?: string;
    contribLockDate?: string; votingHours?: string; general?: string;
  };
  const [errors, setErrors] = useState<FieldErrors>({});

  const scrollRef = useRef<ScrollView>(null);
  const fieldY = useRef<Partial<Record<keyof FieldErrors, number>>>({});
  function recordFieldY(field: keyof FieldErrors) {
    return (e: { nativeEvent: { layout: { y: number } } }) => {
      fieldY.current[field] = e.nativeEvent.layout.y;
    };
  }
  function scrollToField(field: keyof FieldErrors) {
    const y = fieldY.current[field];
    if (y == null) return;
    // requestAnimationFrame lets the advanced section (if it was just
    // expanded to reveal this field) lay out first, so the offset is current.
    requestAnimationFrame(() => {
      scrollRef.current?.scrollTo({ y: Math.max(0, y - 24), animated: true });
    });
  }

  function selectOccasion(next: OccasionKey) {
    setOccasion(next);
    // Re-seed the preview whenever the occasion changes so the 4 preview
    // chips match the newly-selected theme rather than staying stale.
    setDefaultAwards(pickDefaults(next));
  }

  const occasionLabel = OCCASIONS.find(o => o.key === occasion)?.label ?? 'General';
  const advancedSummary = `${occasionLabel} · ${votingHours}h voting · ${defaultAwards.length} award${defaultAwards.length === 1 ? '' : 's'}`;

  async function handleCreate() {
    setErrors({});

    if (!title.trim()) {
      setErrors({ title: 'Give your capsule a name.' });
      scrollToField('title');
      return;
    }
    if (title.trim().length > 100) {
      setErrors({ title: 'Name must be 100 characters or less.' });
      scrollToField('title');
      return;
    }
    if (description.trim().length > 500) {
      setErrors({ description: 'Description must be 500 characters or less.' });
      scrollToField('description');
      return;
    }
    if (unlockMode !== 'proximity') {
      if (!unlockDate) {
        setErrors({ unlockDate: 'Set a valid unlock date.' });
        scrollToField('unlockDate');
        return;
      }
      if (unlockDate <= new Date()) {
        setErrors({ unlockDate: 'Unlock date must be in the future.' });
        scrollToField('unlockDate');
        return;
      }
      if (contribLockDate && contribLockDate >= unlockDate) {
        setAdvancedOpen(true);
        setErrors({ contribLockDate: 'Uploads deadline must be before the unlock date.' });
        scrollToField('contribLockDate');
        return;
      }
    }
    if (votingHours < 1 || votingHours > 720) {
      setAdvancedOpen(true);
      setErrors({ votingHours: 'Voting window must be between 1 and 720 hours.' });
      scrollToField('votingHours');
      return;
    }

    setLoading(true);

    const session = sessionStore.get();
    const user = session?.user;
    if (!user || !session) { setLoading(false); setErrors({ general: 'Not logged in — try signing out and back in.' }); return; }

    const capsuleId = randomUUID();

    const { error: capsuleError } = await supabase
      .from('capsules')
      .insert({
        id: capsuleId,
        owner_id: user.id,
        title: title.trim(),
        description: description.trim() || null,
        unlock_at: (unlockDate ?? defaultUnlockDate()).toISOString(),
        contribution_lock_at: contribLockDate?.toISOString() ?? null,
        unlock_mode: unlockMode,
        superlative_voting_hours: votingHours,
        owner_preview_locked: hideFromMe,
        occasion,
        status: 'active',
        visibility: 'invite',
      });

    if (capsuleError) {
      setLoading(false);
      setErrors({ general: 'Failed to create capsule. Please try again.' });
      return;
    }

    const { error: memberError } = await supabase.from('capsule_members').insert({
      capsule_id: capsuleId,
      user_id: user.id,
      role: 'owner',
      joined_at: new Date().toISOString(),
    });

    if (memberError) {
      setLoading(false);
      setErrors({ general: 'Capsule created but could not set owner. Please try again.' });
      return;
    }

    if (defaultAwards.length > 0) {
      try {
        await supabase.rpc('set_default_superlatives', {
          p_capsule_id: capsuleId,
          p_awards: defaultAwards,
        });
      } catch {
        // Non-fatal — the capsule is already created and usable; the owner
        // can still seed/regenerate defaults from the capsule page pre-unlock.
      }
    }

    if (groupId) {
      await supabase.from('capsules').update({ group_id: groupId }).eq('id', capsuleId);
      const groupMembers = await getGroupMembers(groupId);
      const otherMembers = groupMembers.filter(m => m.user_id !== user.id);
      if (otherMembers.length > 0) {
        await supabase.from('capsule_members').insert(
          otherMembers.map(m => ({
            capsule_id: capsuleId,
            user_id: m.user_id,
            role: 'contributor',
            joined_at: null,
          }))
        );
        for (const m of otherMembers) {
          try {
            await supabase.functions.invoke('send-invite-push', {
              body: { capsuleId, inviteeId: m.user_id },
            });
          } catch { /* best-effort */ }
        }
      }
      cache.invalidate('groups', `group:${groupId}`, `group-capsules:${groupId}`);
    }

    if (pendingMedia && pendingMedia.length > 0) {
      // Route through the same background upload queue CapsuleDetail renders
      // as pending tiles + a truthful "N added · M failed" drain toast —
      // previously this uploaded sequentially inline with an empty catch per
      // item, so a failed item just vanished while the toast still claimed
      // every item was added. The queue makes failures visible and retryable
      // instead of a silent, unrecoverable loss discovered at unlock months
      // later.
      uploadQueue.enqueue(
        pendingMedia.map(m => ({
          capsuleId,
          uri: m.uri,
          mediaType: m.mediaType,
          altUri: m.altUri,
          caption: m.caption,
        }))
      );
    }

    setLoading(false);
    cache.invalidate('capsules', 'profile');
    navigation.navigate('CapsuleDetail', { capsuleId, justCreated: true });
  }

  const headerAnim = useFadeIn(0, 300);
  const formAnim = useSlideUp(80, 350);

  return (
    <SafeAreaView style={styles.container} edges={['top', 'left', 'right']}>
      {isStackPush && (
        <TouchableOpacity style={styles.backBtn} onPress={() => navigation.goBack()} hitSlop={8}>
          <Ionicons name="arrow-back" size={24} color="#FFFFFF" />
        </TouchableOpacity>
      )}
      <ScrollView ref={scrollRef} contentContainerStyle={styles.scroll} keyboardShouldPersistTaps="handled">
        <Animated.View style={headerAnim}>
          <Text style={styles.title}>New Capsule</Text>
          <Text style={styles.subtitle}>Lock your memories until the moment is right</Text>
        </Animated.View>

        <Animated.View style={[{ gap: 24 }, formAnim]}>
        {groupId && (
          <View style={[styles.pendingBanner, styles.pendingBannerTop, { borderColor: `${accentColor}40`, backgroundColor: `${accentColor}10` }]}>
            <Ionicons name="people-outline" size={18} color={accentColor} style={{ marginTop: 1 }} />
            <Text style={[styles.pendingText, { color: accentColor, flex: 1 }]}>All group members will be added automatically</Text>
          </View>
        )}

        {pendingCount > 0 && (
          <View style={[styles.pendingBanner, { borderColor: `${accentColor}40`, backgroundColor: `${accentColor}10` }]}>
            <Ionicons
              name={pendingHasVideo && !pendingHasPhoto ? 'videocam' : 'images'}
              size={18}
              color={accentColor}
            />
            <Text style={[styles.pendingText, { color: accentColor }]}>
              {pendingCount === 1
                ? `Your ${pendingMedia![0].mediaType} will be added automatically`
                : `${pendingCount} items will be added automatically`}
            </Text>
          </View>
        )}

        <View style={styles.section} onLayout={recordFieldY('title')}>
          <Text style={styles.label}>Name</Text>
          <TextInput
            style={[styles.input, errors.title && styles.inputError]}
            placeholder="e.g. Summer Trip 2026"
            placeholderTextColor="#555"
            value={title}
            onChangeText={(t) => { setTitle(t); if (errors.title) setErrors(e => ({ ...e, title: undefined })); }}
            maxLength={100}
          />
          {errors.title ? <Text style={styles.fieldError}>{errors.title}</Text> : null}
        </View>

        <View style={styles.section} onLayout={recordFieldY('description')}>
          <Text style={styles.label}>Description <Text style={styles.optional}>(optional)</Text></Text>
          <TextInput
            style={[styles.input, styles.textarea, errors.description && styles.inputError]}
            placeholder="What's inside this capsule?"
            placeholderTextColor="#555"
            value={description}
            onChangeText={(t) => { setDescription(t); if (errors.description) setErrors(e => ({ ...e, description: undefined })); }}
            multiline
            numberOfLines={3}
            maxLength={500}
          />
          {errors.description ? <Text style={styles.fieldError}>{errors.description}</Text> : null}
        </View>

        <View style={styles.section}>
          <View style={styles.labelRow}>
            <Text style={styles.label}>Unlock When</Text>
            <InfoTooltip
              title="Unlock Mode"
              body={"Date — opens automatically at the date and time you pick.\n\nTogether — opens when all members tap 'Check In' from the same location (within ~100 meters of each other).\n\nBoth — requires the date to have passed AND everyone to be physically together."}
            />
          </View>
          <View style={styles.toggle}>
            {UNLOCK_MODES.map(({ mode, label }) => (
              <TouchableOpacity
                key={mode}
                style={[styles.toggleOption, unlockMode === mode && [styles.toggleActive, { borderColor: accentColor, backgroundColor: `${accentColor}22` }]]}
                onPress={() => setUnlockMode(mode)}
              >
                <Text style={[styles.toggleText, unlockMode === mode && [styles.toggleTextActive, { color: accentColor }]]}>{label}</Text>
              </TouchableOpacity>
            ))}
          </View>
          <Text style={styles.modeHint}>{unlockModeHint(unlockMode)}</Text>
        </View>

        {unlockMode !== 'proximity' && (
          <View onLayout={recordFieldY('unlockDate')}>
            <DatePickerField label="Unlock Date" value={unlockDate} onChange={setUnlockDate} contextLabel="Capsule unlocks for everyone" />
            {errors.unlockDate ? <Text style={styles.fieldError}>{errors.unlockDate}</Text> : null}
          </View>
        )}

        <View style={styles.section}>
          <TouchableOpacity
            style={styles.advancedToggle}
            onPress={() => setAdvancedOpen(o => !o)}
            accessibilityRole="button"
            accessibilityLabel={advancedOpen ? 'Collapse awards & advanced options' : 'Expand awards & advanced options'}
          >
            <View style={{ flex: 1 }}>
              <Text style={styles.label}>Awards & Advanced</Text>
              {!advancedOpen && <Text style={styles.advancedSummary}>{advancedSummary}</Text>}
            </View>
            <Ionicons name={advancedOpen ? 'chevron-up' : 'chevron-down'} size={20} color="#888888" />
          </TouchableOpacity>

          {advancedOpen && (
            <View style={{ gap: 24, marginTop: 20 }}>
              <View onLayout={recordFieldY('contribLockDate')}>
                <DatePickerField
                  label="Uploads Deadline"
                  optional
                  value={contribLockDate}
                  onChange={setContribLockDate}
                  contextLabel="No one can add photos after this date"
                  tooltip={{
                    title: 'Uploads Deadline',
                    body: 'After this date, no one (including you) can add new photos or videos to the capsule. The contents are then sealed until the unlock date.\n\nLeave it off if you want members to keep uploading right up until unlock.',
                  }}
                />
                {errors.contribLockDate ? <Text style={styles.fieldError}>{errors.contribLockDate}</Text> : null}
              </View>

              <View onLayout={recordFieldY('votingHours')}>
                <VotingWindowPicker value={votingHours} onChange={setVotingHours} />
                {errors.votingHours ? <Text style={styles.fieldError}>{errors.votingHours}</Text> : null}
              </View>

              <View style={{ gap: 8 }}>
                <View style={styles.labelRow}>
                  <Text style={styles.label}>Occasion</Text>
                  <InfoTooltip
                    title="Occasion"
                    body={"Picks the theme for this capsule's 4 automatic awards — e.g. sentimental for a wedding, playful for a trip. You can shuffle, swap, or remove any of them below, and members can still suggest their own after unlock."}
                  />
                </View>
                <View style={styles.occasionGrid}>
                  {[OCCASIONS.slice(0, 3), OCCASIONS.slice(3, 6)].map((row, rowIndex) => (
                    <View key={rowIndex} style={styles.occasionRow}>
                      {row.map(({ key, label, icon }) => {
                        const selected = occasion === key;
                        return (
                          <TouchableOpacity
                            key={key}
                            style={[
                              styles.occasionChip,
                              selected && [styles.occasionChipActive, { borderColor: accentColor, backgroundColor: `${accentColor}22` }],
                            ]}
                            onPress={() => selectOccasion(key)}
                          >
                            <Ionicons name={icon as any} size={18} color={selected ? accentColor : '#888'} />
                            <Text
                              style={[styles.occasionChipText, selected && { color: accentColor }]}
                              numberOfLines={1}
                            >
                              {label}
                            </Text>
                          </TouchableOpacity>
                        );
                      })}
                    </View>
                  ))}
                </View>
                <DefaultAwardsCard
                  mode="preview"
                  occasion={occasion}
                  awards={defaultAwards}
                  onChange={setDefaultAwards}
                />
              </View>
            </View>
          )}
        </View>

        <View style={styles.section}>
          <Text style={styles.label}>Keep it a surprise</Text>
          <View style={styles.surpriseRow}>
            <View style={styles.surpriseTextWrap}>
              <Text style={styles.surpriseTitle}>Hide contents from me too</Text>
              <Text style={styles.surpriseSub}>
                {hideFromMe
                  ? "You won't see any photos — even your own — until it unlocks for everyone."
                  : "You can preview photos as they're added before unlock."}
              </Text>
            </View>
            <Switch
              value={hideFromMe}
              onValueChange={setHideFromMe}
              trackColor={{ false: '#2A2A2A', true: accentColor }}
              thumbColor="#FFFFFF"
              ios_backgroundColor="#2A2A2A"
            />
          </View>
        </View>

        {errors.general ? <Text style={styles.error}>{errors.general}</Text> : null}

        <TouchableOpacity style={[styles.createButton, { backgroundColor: accentColor }]} onPress={handleCreate} disabled={loading}>
          {loading ? <LoadingBrand size="small" color="#fff" /> : (
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
              <Text style={styles.createButtonText}>Lock Capsule</Text>
              <Ionicons name="lock-closed-outline" size={18} color="#FFFFFF" />
            </View>
          )}
        </TouchableOpacity>
        </Animated.View>
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#0A0A0A' },
  scroll: { paddingHorizontal: 24, paddingTop: 16, paddingBottom: 24, gap: 24 },
  title: { fontSize: 28, fontWeight: '800', color: '#FFFFFF' },
  subtitle: { fontSize: 15, color: '#888888', marginTop: 4 },
  section: { gap: 8 },
  labelRow: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  label: { fontSize: 14, fontWeight: '600', color: '#AAAAAA', textTransform: 'uppercase', letterSpacing: 0.5 },
  optional: { fontWeight: '400', color: '#555555', textTransform: 'none' },
  input: {
    backgroundColor: '#1A1A1A',
    borderRadius: 12,
    paddingHorizontal: 16,
    paddingVertical: 16,
    color: '#FFFFFF',
    fontSize: 16,
    borderWidth: 1,
    borderColor: '#2A2A2A',
  },
  textarea: { minHeight: 80, textAlignVertical: 'top' },
  inputError: { borderColor: '#FF3B30' },
  fieldError: { color: '#FF3B30', fontSize: 13, marginTop: 6 },
  advancedToggle: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  advancedSummary: { fontSize: 13, color: '#888888', marginTop: 4, textTransform: 'none' },
  toggle: { flexDirection: 'row', gap: 8 },
  toggleOption: {
    flex: 1, paddingVertical: 14, borderRadius: 12,
    borderWidth: 1, borderColor: '#2A2A2A', alignItems: 'center', backgroundColor: '#1A1A1A',
  },
  toggleActive: { borderColor: '#FF6B35', backgroundColor: '#2A1500' },
  toggleText: { color: '#666666', fontWeight: '600', fontSize: 15 },
  toggleTextActive: { color: '#FF6B35' },
  modeHint: { fontSize: 13, color: '#888888' },
  occasionGrid: { gap: 8 },
  occasionRow: { flexDirection: 'row', gap: 8 },
  occasionChip: {
    flex: 1,
    alignItems: 'center', justifyContent: 'center', gap: 6,
    paddingVertical: 14,
    borderRadius: 12,
    borderWidth: 1, borderColor: '#2A2A2A',
    backgroundColor: '#1A1A1A',
  },
  occasionChipActive: { borderColor: '#FF6B35', backgroundColor: '#2A1500' },
  occasionChipText: { color: '#888888', fontWeight: '600', fontSize: 13 },
  surpriseRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    backgroundColor: '#1A1A1A',
    borderRadius: 12,
    borderWidth: 1,
    borderColor: '#2A2A2A',
    paddingVertical: 14,
    paddingHorizontal: 16,
  },
  surpriseTextWrap: { flex: 1, gap: 3 },
  surpriseTitle: { fontSize: 15, fontWeight: '600', color: '#FFFFFF' },
  surpriseSub: { fontSize: 13, color: '#888888', lineHeight: 18 },
  error: { color: '#FF3B30', fontSize: 14, textAlign: 'center' },
  createButton: {
    backgroundColor: '#FF6B35', borderRadius: 16,
    paddingVertical: 18, alignItems: 'center', marginTop: 8,
  },
  createButtonText: { color: '#FFFFFF', fontSize: 17, fontWeight: '700' },
  backBtn: { paddingHorizontal: 24, paddingTop: 8, paddingBottom: 4 },
  pendingBanner: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    borderRadius: 12,
    borderWidth: 1,
    paddingVertical: 12,
    paddingHorizontal: 16,
  },
  pendingBannerTop: { alignItems: 'flex-start' },
  pendingText: { fontSize: 14, fontWeight: '600' },
});
