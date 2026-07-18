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
import { Ionicons } from '@expo/vector-icons';
import { AppStackParamList, AppTabParamList, PendingMedia } from '../../types/navigation';
import { UnlockMode } from '../../types/database';
import { useTheme } from '../../context/ThemeContext';
import DatePickerField, { START_DATE_QUICK_OPTIONS } from '../../components/DatePicker';
import VotingWindowPicker from '../../components/VotingWindowPicker';
import { cache } from '../../lib/cache';
import { toast } from '../../lib/toast';
import { uploadQueue } from '../../lib/uploadQueue';
import { useSlideUp, useFadeIn } from '../../lib/animations';
import { getGroup, getGroupMembers, updateGroup } from '../../lib/groups';
import { OCCASIONS, OccasionKey, pickDefaults } from '../../lib/awardPool';
import SealedMoment from '../../components/SealedMoment';

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
  const [startDate, setStartDate] = useState<Date | null>(null);
  const [unlockMode, setUnlockMode] = useState<UnlockMode>('time');
  const [votingHours, setVotingHours] = useState(48);
  const [hideFromMe, setHideFromMe] = useState(true);
  const [occasion, setOccasion] = useState<OccasionKey>('general');
  const [loading, setLoading] = useState(false);
  // UX_POLISH.md #4 — shown after a successful create, before navigating in.
  const [sealedVisible, setSealedVisible] = useState(false);
  const [sealedCapsuleId, setSealedCapsuleId] = useState<string | null>(null);
  // Everything except Name and the unlock date is pre-defaulted and editable
  // later, so it all collapses behind "More options" — a new user only faces
  // two decisions before "Lock Capsule". Default awards are seeded from the
  // occasion at submit time (see handleCreate) and managed post-create on the
  // capsule's own DefaultAwardsCard(mode="manage"), so there's no live preview
  // to hold state for here.
  const [advancedOpen, setAdvancedOpen] = useState(false);
  type FieldErrors = {
    title?: string; description?: string; unlockDate?: string; startDate?: string;
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

  const occasionLabel = OCCASIONS.find(o => o.key === occasion)?.label ?? 'General';
  const advancedSummary = `${occasionLabel} · ${votingHours}h voting · Surprise ${hideFromMe ? 'on' : 'off'}`;

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
      setAdvancedOpen(true);
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
      if (startDate && startDate >= unlockDate) {
        setErrors({ startDate: 'Start date must be before the unlock date.' });
        scrollToField('startDate');
        return;
      }
      if (contribLockDate && contribLockDate >= unlockDate) {
        setAdvancedOpen(true);
        setErrors({ contribLockDate: 'Uploads deadline must be before the unlock date.' });
        scrollToField('contribLockDate');
        return;
      }
    }
    // Independent of unlock_mode: unlock_at is just a placeholder in
    // proximity mode, but the start/deadline RLS gates apply regardless of
    // mode, so this must always run or a proximity capsule can end up with
    // Starts after the Uploads Deadline and never receive a single upload.
    if (startDate && contribLockDate && startDate >= contribLockDate) {
      setAdvancedOpen(true);
      setErrors({ startDate: 'Start date must be before the uploads deadline.' });
      scrollToField('startDate');
      return;
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

    // Capsule + owner capsule_members row are inserted atomically inside the
    // RPC — if either insert fails, Postgres rolls back the whole function
    // call, so this can never leave behind a members-less orphan capsule
    // (the old two-request flow could, and did: 10 orphans found in
    // production, invisible forever since the capsules SELECT policy has no
    // owner fallback).
    const { data: capsuleId, error: capsuleError } = await supabase.rpc('create_capsule_with_owner', {
      p_title: title.trim(),
      p_description: description.trim() || null,
      p_unlock_at: (unlockDate ?? defaultUnlockDate()).toISOString(),
      p_contribution_lock_at: contribLockDate?.toISOString() ?? null,
      p_unlock_mode: unlockMode,
      p_superlative_voting_hours: votingHours,
      p_owner_preview_locked: hideFromMe,
      p_occasion: occasion,
      p_visibility: 'invite',
      p_group_id: groupId ?? null,
      p_contribution_start_at: startDate?.toISOString() ?? null,
    });

    if (capsuleError || !capsuleId) {
      setLoading(false);
      setErrors({ general: 'Failed to create capsule. Please try again.' });
      return;
    }

    // Seed the 4 themed default awards from the chosen occasion. Computed here
    // (not held as live-preview state) since the owner reviews/regenerates them
    // on the capsule's own DefaultAwardsCard(mode="manage") pre-unlock.
    const defaultAwards = pickDefaults(occasion);
    if (defaultAwards.length > 0) {
      try {
        const { error: awardsError } = await supabase.rpc('set_default_superlatives', {
          p_capsule_id: capsuleId,
          p_awards: defaultAwards,
        });
        if (awardsError) throw awardsError;
      } catch {
        // Non-fatal — the capsule is already created and usable; the owner
        // can still seed/regenerate defaults from the capsule page pre-unlock.
        // Still worth a toast: a silently-empty awards section otherwise
        // looks like a bug rather than a one-off write failure to retry.
        toast.show("Couldn't set up default awards — you can add them from the capsule.");
      }
    }

    if (groupId) {
      // group_id was already set in the create_capsule_with_owner call above.
      const groupMembers = await getGroupMembers(groupId);
      const otherMembers = groupMembers.filter(m => m.user_id !== user.id);
      if (otherMembers.length > 0) {
        // Membership in a group is standing consent to its capsules (GROUPS.md
        // #6) — joined_at is set immediately, same as the cron path, instead
        // of leaving these as pending invites nobody actually needs to accept.
        // This also routes notify_on_invite to its `group_capsule` branch
        // rather than a fake pending "invite" card.
        await supabase.from('capsule_members').insert(
          otherMembers.map(m => ({
            capsule_id: capsuleId,
            user_id: m.user_id,
            role: 'contributor',
            joined_at: new Date().toISOString(),
          }))
        );
        let notifyFailures = 0;
        for (const m of otherMembers) {
          try {
            const { error: pushError } = await supabase.functions.invoke('send-invite-push', {
              body: { capsuleId, inviteeId: m.user_id },
            });
            if (pushError) throw pushError;
          } catch {
            notifyFailures += 1; // best-effort — membership itself is unaffected
          }
        }
        if (notifyFailures > 0) {
          toast.show(
            notifyFailures === otherMembers.length
              ? "Couldn't notify group members — they'll still see it in the app."
              : `Couldn't notify ${notifyFailures} group member${notifyFailures === 1 ? '' : 's'} — they'll still see it in the app.`
          );
        }
      }

      // GROUPS.md #12 — a manually-started capsule for a scheduled group
      // shouldn't leave the cron free to also fire one an interval later on
      // the group's old schedule. Push next_capsule_at out from now. Silent
      // best-effort: worst case is one extra capsule next cycle, not worth
      // alarming the user over on their own "Lock Capsule" tap.
      const group = await getGroup(groupId);
      if (group && group.recurrence_interval !== 'manual') {
        await updateGroup(groupId, { recurrence: group.recurrence_interval });
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

    cache.invalidate('capsules', 'profile');
    // Sealed-moment ceremony (UX_POLISH.md #4) plays before the nav — onDone
    // below does the actual navigate that used to happen immediately here.
    // `loading` deliberately stays true until onDone: the Lock Capsule button
    // is still mounted under the overlay, and visual occlusion alone doesn't
    // stop keyboard (web) or screen-reader activation — a second tap would
    // create a duplicate capsule.
    setSealedCapsuleId(capsuleId);
    setSealedVisible(true);
  }

  function handleSealedDone() {
    setSealedVisible(false);
    setLoading(false);
    if (sealedCapsuleId) {
      navigation.navigate('CapsuleDetail', { capsuleId: sealedCapsuleId, justCreated: true });
    }
  }

  const headerAnim = useFadeIn(0, 300);
  const formAnim = useSlideUp(80, 350);

  return (
    <SafeAreaView style={styles.container} edges={['top', 'left', 'right']}>
      <SealedMoment
        visible={sealedVisible}
        title={title.trim()}
        unlockMode={unlockMode}
        unlockDate={unlockDate}
        onDone={handleSealedDone}
      />
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

        <View onLayout={recordFieldY('startDate')}>
          <DatePickerField
            label="Starts"
            optional
            value={startDate}
            onChange={setStartDate}
            contextLabel="No one can add photos until this date"
            quickOptions={START_DATE_QUICK_OPTIONS}
            tooltip={{
              title: 'Start Date',
              body: 'Nobody — including you — can add photos or videos until this date arrives. Useful for planning a capsule ahead of an event or trip that hasn\'t happened yet.\n\nLeave it off to let people start adding photos right away.',
            }}
          />
          {errors.startDate ? <Text style={styles.fieldError}>{errors.startDate}</Text> : null}
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
            accessibilityLabel={advancedOpen ? 'Collapse more options' : 'Expand more options'}
          >
            <View style={{ flex: 1 }}>
              <Text style={styles.label}>More options</Text>
              {!advancedOpen && <Text style={styles.advancedSummary}>{advancedSummary}</Text>}
            </View>
            <Ionicons name={advancedOpen ? 'chevron-up' : 'chevron-down'} size={20} color="#888888" />
          </TouchableOpacity>

          {advancedOpen && (
            <View style={{ gap: 24, marginTop: 20 }}>
              <View onLayout={recordFieldY('description')}>
                <Text style={styles.label}>Description <Text style={styles.optional}>(optional)</Text></Text>
                <TextInput
                  style={[styles.input, styles.textarea, errors.description && styles.inputError, { marginTop: 8 }]}
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
                    body={"Picks the theme for this capsule's 4 automatic awards — e.g. sentimental for a wedding, playful for a trip. You can review, shuffle, or swap them from the capsule page before it unlocks, and members can still suggest their own after unlock."}
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
                            onPress={() => setOccasion(key)}
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
            </View>
          )}
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
