import React, { useEffect, useRef, useState } from 'react';
import LoadingBrand from '../../components/LoadingBrand';
import {
  View, Text, StyleSheet, ScrollView, TextInput, TouchableOpacity,
  Platform, KeyboardAvoidingView, Animated, Share,
} from 'react-native';
import { Image } from 'expo-image';
import { SafeAreaView } from 'react-native-safe-area-context';
import { NativeStackScreenProps } from '@react-navigation/native-stack';
import * as ImagePicker from 'expo-image-picker';
import * as ImageManipulator from 'expo-image-manipulator';
import * as FileSystem from 'expo-file-system/legacy';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { Ionicons } from '@expo/vector-icons';
import { supabase, getFreshSession } from '../../lib/supabase';
import { sessionStore } from '../../lib/sessionStore';
import { useTheme } from '../../context/ThemeContext';
import { AppStackParamList } from '../../types/navigation';
import { MOMENTS, GENERAL_MOMENT, Moment } from '../../lib/onboardingMoments';
import { pickDefaults } from '../../lib/awardPool';
import { cache } from '../../lib/cache';
import { haptics } from '../../lib/haptics';
import { toast } from '../../lib/toast';
import { requestPushPermission } from '../../hooks/usePushNotifications';
import DatePickerField from '../../components/DatePicker';
import type { TablesUpdate } from '../../types/supabase';

type Props = NativeStackScreenProps<AppStackParamList, 'Onboarding'>;

type Step = 1 | 2 | 3 | 4 | 5;

// AsyncStorage flag: user said "maybe later" on the notification primer.
// A future contextual re-ask (e.g. after their first accepted invite) can
// check this to know the native prompt is still unspent.
const NOTIF_REPRIME_PREFIX = 'cap_notif_reprime:';

function formatUnlockDate(d: Date): string {
  return d.toLocaleDateString(undefined, { month: 'long', day: 'numeric', year: 'numeric' });
}

function formatCountdown(d: Date): string {
  const ms = d.getTime() - Date.now();
  if (ms <= 0) return 'any moment now';
  const mins = Math.floor(ms / 60_000);
  const hours = Math.floor(mins / 60);
  const days = Math.floor(hours / 24);
  if (days >= 2) return `in ${days} days`;
  if (days === 1) return 'in 1 day';
  if (hours >= 2) return `in ${hours} hours`;
  if (hours === 1) return 'in 1 hour';
  return `in ${Math.max(1, mins)} minute${mins === 1 ? '' : 's'}`;
}

// Chunk the 6 moment cards into rows of 2 — flex:1 cards inside fixed rows,
// never percentage widths (iOS ScrollView computes those to 0).
const MOMENT_ROWS: Moment[][] = [];
for (let i = 0; i < MOMENTS.length; i += 2) MOMENT_ROWS.push(MOMENTS.slice(i, i + 2));

export default function OnboardingScreen({ navigation }: Props) {
  const { accentColor } = useTheme();
  const [step, setStep] = useState<Step>(1);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  // Screen 1
  const [displayName, setDisplayName] = useState('');
  const [avatarUri, setAvatarUri] = useState<string | null>(null);
  // Upload starts the moment a photo is picked (background), so a failure
  // isn't discovered three screens later at finish-time.
  const avatarUrlPromise = useRef<Promise<string | null> | null>(null);

  // Screen 2
  const [moment, setMoment] = useState<Moment>(GENERAL_MOMENT);
  const [intentText, setIntentText] = useState('');

  // Screen 3
  const [title, setTitle] = useState('');
  const [unlockDate, setUnlockDate] = useState<Date | null>(null);
  const [selectedChip, setSelectedChip] = useState<number | 'custom'>(0);
  const [customDateOpen, setCustomDateOpen] = useState(false);

  // Screens 4–5
  const [createdCapsuleId, setCreatedCapsuleId] = useState<string | null>(null);
  const [countdownText, setCountdownText] = useState('');
  const sealAnim = useRef(new Animated.Value(0)).current;

  // Direction-aware step transition: fade + slide out toward the "leaving"
  // side, swap content, spring in from the "entering" side. Both values are
  // native-driver (opacity/transform only).
  const stepOpacity = useRef(new Animated.Value(1)).current;
  const stepTranslate = useRef(new Animated.Value(0)).current;
  const transitioningRef = useRef(false);

  function transitionToStep(next: Step) {
    if (next === step || transitioningRef.current) return;
    transitioningRef.current = true;
    const dir = next > step ? 1 : -1;
    Animated.parallel([
      Animated.timing(stepOpacity, { toValue: 0, duration: 110, useNativeDriver: true }),
      Animated.timing(stepTranslate, { toValue: -28 * dir, duration: 110, useNativeDriver: true }),
    ]).start(() => {
      setStep(next);
      stepTranslate.setValue(28 * dir);
      Animated.parallel([
        Animated.timing(stepOpacity, { toValue: 1, duration: 200, useNativeDriver: true }),
        Animated.spring(stepTranslate, { toValue: 0, friction: 9, tension: 80, useNativeDriver: true }),
      ]).start(() => { transitioningRef.current = false; });
    });
  }

  const firstName = displayName.trim().split(/\s+/)[0] || '';

  // ── Screen 5: seal ceremony + live countdown ──────────────────────────────
  useEffect(() => {
    if (step !== 5) return;
    haptics.success();
    Animated.spring(sealAnim, { toValue: 1, friction: 5, tension: 60, useNativeDriver: true }).start();
    const tick = () => { if (unlockDate) setCountdownText(formatCountdown(unlockDate)); };
    tick();
    const interval = setInterval(tick, 30_000);
    return () => clearInterval(interval);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [step]);

  // ── Avatar ────────────────────────────────────────────────────────────────
  async function pickAvatar() {
    const result = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ImagePicker.MediaTypeOptions.Images,
      allowsEditing: true,
      aspect: [1, 1],
      quality: 0.9,
    });
    if (result.canceled || !result.assets[0]) return;
    const uri = result.assets[0].uri;
    setAvatarUri(uri);
    avatarUrlPromise.current = uploadAvatar(uri).catch(() => null);
  }

  async function uploadAvatar(uri: string): Promise<string> {
    // Path user id must equal auth.uid() (avatars RLS), so derive it from the
    // live session — never a passed-in / cached id. See ProfileScreen.uploadAvatar.
    let path: string;

    if (Platform.OS === 'web') {
      const session = sessionStore.get();
      if (!session) throw new Error('Not signed in');
      path = `${session.user.id}/avatar.jpg`;
      const resp = await fetch(uri);
      const buf = await resp.arrayBuffer();
      const { error: upErr } = await supabase.storage
        .from('avatars')
        .upload(path, buf, { contentType: 'image/jpeg', upsert: true });
      if (upErr) throw new Error(upErr.message);
    } else {
      const { accessToken, userId } = await getFreshSession();
      path = `${userId}/avatar.jpg`;
      const resized = await ImageManipulator.manipulateAsync(
        uri,
        [{ resize: { width: 400 } }],
        { compress: 0.8, format: ImageManipulator.SaveFormat.JPEG }
      );
      const result = await FileSystem.uploadAsync(
        `${process.env.EXPO_PUBLIC_SUPABASE_URL}/storage/v1/object/avatars/${path}`,
        resized.uri,
        {
          httpMethod: 'POST',
          uploadType: FileSystem.FileSystemUploadType.BINARY_CONTENT,
          headers: {
            Authorization: `Bearer ${accessToken}`,
            apikey: process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY!,
            'Content-Type': 'image/jpeg',
            'x-upsert': 'true',
          },
        }
      );
      if (result.status < 200 || result.status >= 300) {
        throw new Error(`Storage ${result.status}`);
      }
    }

    const { data } = supabase.storage.from('avatars').getPublicUrl(path);
    return `${data.publicUrl}?t=${Date.now()}`;
  }

  /** Await the background upload; retry once if it failed; never block completion. */
  async function resolveAvatarUrl(): Promise<string | null> {
    if (!avatarUri) return null;
    const fromBackground = await (avatarUrlPromise.current ?? Promise.resolve(null));
    if (fromBackground) return fromBackground;
    try {
      return await uploadAvatar(avatarUri);
    } catch {
      toast.show("Couldn't upload your photo — add it later from Profile.");
      return null;
    }
  }

  // ── Profile save (stamps onboarded_at — the exit gate) ────────────────────
  async function saveProfile(): Promise<boolean> {
    const session = sessionStore.get();
    if (!session) { setError('Session lost. Try signing out and in.'); return false; }
    const userId = session.user.id;

    const avatarUrl = await resolveAvatarUrl();
    const updates: TablesUpdate<'users'> = {
      display_name: displayName.trim(),
      onboarded_at: new Date().toISOString(),
    };
    if (avatarUrl) updates.avatar_url = avatarUrl;

    const { error: updateError } = await supabase
      .from('users')
      .update(updates)
      .eq('id', userId);

    if (updateError) {
      setError('Could not save your profile. Please try again.');
      return false;
    }
    sessionStore.markOnboarded(userId);
    return true;
  }

  // ── Step transitions ──────────────────────────────────────────────────────
  function goStep2() {
    if (!displayName.trim()) { setError('Please enter a display name.'); return; }
    if (displayName.trim().length > 30) { setError('Display name must be 30 characters or less.'); return; }
    setError('');
    transitionToStep(2);
  }

  function enterStep3(m: Moment, text: string) {
    setMoment(m);
    setTitle(text.trim() || m.titleSeed);
    const firstChip = m.dateChips[0];
    setUnlockDate(firstChip ? firstChip.resolve() : null);
    setSelectedChip(0);
    setCustomDateOpen(false);
    setError('');
    transitionToStep(3);
  }

  function selectMomentCard(m: Moment) {
    haptics.light();
    enterStep3(m, intentText);
  }

  async function skipToHome() {
    setError('');
    setSaving(true);
    const ok = await saveProfile();
    setSaving(false);
    if (ok) navigation.replace('Tabs', { screen: 'Home' });
  }

  // ── Screen 3: create the capsule ──────────────────────────────────────────
  async function createCapsule() {
    setError('');
    const finalTitle = title.trim() || moment.titleSeed;
    if (finalTitle.length > 100) { setError('Name must be 100 characters or less.'); return; }
    if (!unlockDate) { setError('Pick a date for the unlock.'); return; }
    if (unlockDate <= new Date()) { setError('The unlock date must be in the future.'); return; }

    const session = sessionStore.get();
    const user = session?.user;
    if (!user) { setError('Session lost. Try signing out and in.'); return; }

    setSaving(true);

    const profileOk = await saveProfile();
    if (!profileOk) { setSaving(false); return; }

    // Capsule + owner capsule_members row inserted atomically — see
    // create_capsule_with_owner in CLAUDE.md's Database Schema section.
    const { data: capsuleId, error: capsuleError } = await supabase.rpc('create_capsule_with_owner', {
      p_title: finalTitle,
      p_description: null,
      p_unlock_at: unlockDate.toISOString(),
      p_contribution_lock_at: null,
      p_unlock_mode: 'time',
      p_superlative_voting_hours: 48,
      p_owner_preview_locked: true,
      p_occasion: moment.occasion,
      p_visibility: 'invite',
    });

    if (capsuleError || !capsuleId) {
      setSaving(false);
      setError('Could not create your capsule. Please try again.');
      return;
    }

    try {
      await supabase.rpc('set_default_superlatives', {
        p_capsule_id: capsuleId,
        p_awards: pickDefaults(moment.occasion),
      });
    } catch {
      // Non-fatal — defaults can be seeded from the capsule page pre-unlock.
    }

    cache.invalidate('capsules', 'profile');
    setCreatedCapsuleId(capsuleId);
    setTitle(finalTitle);
    setSaving(false);
    transitionToStep(4);
  }

  // ── Screen 4: notification primer ─────────────────────────────────────────
  async function primerYes() {
    const session = sessionStore.get();
    setSaving(true);
    if (session) {
      // The one intentional native-prompt call in the app (no-op → false on web).
      await requestPushPermission(session.user.id);
    }
    setSaving(false);
    haptics.light();
    transitionToStep(5);
  }

  function primerLater() {
    const session = sessionStore.get();
    if (session) {
      AsyncStorage.setItem(`${NOTIF_REPRIME_PREFIX}${session.user.id}`, '1').catch(() => {});
    }
    transitionToStep(5);
  }

  // ── Screen 5 actions ──────────────────────────────────────────────────────
  async function invitePeople() {
    if (!createdCapsuleId) return;
    try {
      await Share.share({
        message: `Join my Capsule "${title}"! Tap to join: capsule://join/${createdCapsuleId}`,
      });
    } catch {
      // Web (or share unavailable): land them in the capsule, where the full
      // invite UI (QR + search) lives.
      navigation.replace('Tabs', { screen: 'Home' });
      navigation.navigate('CapsuleDetail', { capsuleId: createdCapsuleId });
    }
  }

  function addFirstPhoto() {
    navigation.replace('Tabs', { screen: 'Camera' });
  }

  function goHome() {
    navigation.replace('Tabs', { screen: 'Home' });
  }

  // ── Render ────────────────────────────────────────────────────────────────
  const avatarInitial = firstName ? firstName[0].toUpperCase() : null;

  return (
    <SafeAreaView style={styles.container}>
      <KeyboardAvoidingView
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
        style={{ flex: 1 }}
      >
        {/* Progress dots */}
        <View style={styles.progressRow}>
          {[1, 2, 3, 4, 5].map((n) => (
            <View
              key={n}
              style={[
                styles.progressDot,
                n === step && { backgroundColor: accentColor, width: 24 },
                n < step && { backgroundColor: accentColor },
              ]}
            />
          ))}
        </View>

        <ScrollView
          contentContainerStyle={styles.scroll}
          keyboardShouldPersistTaps="handled"
          showsVerticalScrollIndicator={false}
        >
          {step === 1 && (
            <View style={styles.stepBody}>
              <Text style={styles.heading}>First things first — who are you?</Text>

              <TouchableOpacity style={styles.avatarSlot} onPress={pickAvatar} activeOpacity={0.8}>
                {avatarUri ? (
                  <Image source={avatarUri} style={styles.avatarImg} />
                ) : (
                  <View style={[styles.avatarPlaceholder, { backgroundColor: accentColor }]}>
                    <Ionicons name="camera-outline" size={32} color="#FFFFFF" />
                  </View>
                )}
                <Text style={[styles.avatarHint, { color: accentColor }]}>
                  {avatarUri ? 'Change photo' : 'Add a photo (optional)'}
                </Text>
              </TouchableOpacity>

              <TextInput
                style={styles.input}
                placeholder="Display name"
                placeholderTextColor="#555"
                value={displayName}
                onChangeText={setDisplayName}
                autoCapitalize="words"
                maxLength={30}
              />

              {/* Live member-row preview — the first proof the app reacts to them */}
              <View style={styles.previewCard}>
                {avatarUri ? (
                  <Image source={avatarUri} style={styles.previewAvatar} />
                ) : (
                  <View style={[styles.previewAvatar, styles.previewAvatarFallback, { backgroundColor: accentColor }]}>
                    {avatarInitial
                      ? <Text style={styles.previewInitial}>{avatarInitial}</Text>
                      : <Ionicons name="person-outline" size={16} color="#FFFFFF" />}
                  </View>
                )}
                <View style={{ flex: 1 }}>
                  <Text style={styles.previewName} numberOfLines={1}>
                    {displayName.trim() || 'Your name'}
                  </Text>
                  <Text style={styles.previewMeta}>added 3 photos · just now</Text>
                </View>
              </View>
              <Text style={styles.previewHint}>This is how friends see you inside a capsule.</Text>
            </View>
          )}

          {step === 2 && (
            <View style={styles.stepBody}>
              <Text style={styles.heading}>
                {firstName ? `Nice to meet you, ${firstName}.` : 'Nice to meet you.'}
              </Text>
              <Text style={styles.sub}>What are you waiting for?</Text>

              <View style={styles.momentGrid}>
                {MOMENT_ROWS.map((row, i) => (
                  <View key={i} style={styles.momentRow}>
                    {row.map((m) => (
                      <TouchableOpacity
                        key={m.occasion}
                        style={[styles.momentCard, { borderColor: `${accentColor}40` }]}
                        onPress={() => selectMomentCard(m)}
                        disabled={saving}
                        activeOpacity={0.85}
                      >
                        <View style={[styles.momentIcon, { backgroundColor: `${accentColor}22` }]}>
                          <Ionicons name={m.icon as any} size={20} color={accentColor} />
                        </View>
                        <Text style={styles.momentLabel}>{m.label}</Text>
                      </TouchableOpacity>
                    ))}
                  </View>
                ))}
              </View>

              <TextInput
                style={styles.input}
                placeholder="or tell us in your own words…"
                placeholderTextColor="#555"
                value={intentText}
                onChangeText={setIntentText}
                maxLength={60}
                returnKeyType="done"
                onSubmitEditing={() => {
                  if (intentText.trim()) enterStep3(GENERAL_MOMENT, intentText);
                }}
              />
              {intentText.trim().length > 0 && (
                <Text style={styles.momentTypedHint}>
                  Tap a card above that fits, or continue — “{intentText.trim()}” becomes your capsule.
                </Text>
              )}
            </View>
          )}

          {step === 3 && (
            <View style={styles.stepBody}>
              <Text style={styles.heading}>Let's set up your first capsule.</Text>

              {/* Pre-built capsule card, title inline-editable */}
              <View style={[styles.capsuleCard, { borderColor: `${accentColor}40` }]}>
                <View style={styles.capsuleCardHeader}>
                  <View style={[styles.capsuleLock, { backgroundColor: `${accentColor}22` }]}>
                    <Ionicons name="lock-closed" size={18} color={accentColor} />
                  </View>
                  <View style={{ flex: 1 }}>
                    <TextInput
                      style={styles.capsuleTitleInput}
                      value={title}
                      onChangeText={setTitle}
                      maxLength={100}
                      placeholder={moment.titleSeed}
                      placeholderTextColor="#555"
                    />
                    <Text style={styles.capsuleRenameHint}>
                      <Ionicons name="pencil-outline" size={11} color="#666" /> tap to rename
                    </Text>
                  </View>
                </View>
                <Text style={styles.capsuleOpens}>
                  Opens {unlockDate ? formatUnlockDate(unlockDate) : '— pick a date below'}
                </Text>
              </View>

              <Text style={styles.flavor}>{moment.flavor}</Text>

              {/* Occasion-aware date chips */}
              <View style={styles.chipWrap}>
                {moment.dateChips.map((chip, i) => {
                  const active = selectedChip === i;
                  return (
                    <TouchableOpacity
                      key={chip.label}
                      style={[
                        styles.dateChip,
                        active && { borderColor: accentColor, backgroundColor: `${accentColor}22` },
                      ]}
                      onPress={() => {
                        haptics.light();
                        setSelectedChip(i);
                        setUnlockDate(chip.resolve());
                        setCustomDateOpen(false);
                      }}
                    >
                      <Text style={[styles.dateChipText, active && { color: accentColor }]}>
                        {chip.label}
                      </Text>
                    </TouchableOpacity>
                  );
                })}
                <TouchableOpacity
                  style={[
                    styles.dateChip,
                    selectedChip === 'custom' && { borderColor: accentColor, backgroundColor: `${accentColor}22` },
                  ]}
                  onPress={() => {
                    setSelectedChip('custom');
                    setCustomDateOpen(true);
                  }}
                >
                  <Ionicons
                    name="calendar-outline"
                    size={14}
                    color={selectedChip === 'custom' ? accentColor : '#888888'}
                  />
                  <Text style={[styles.dateChipText, selectedChip === 'custom' && { color: accentColor }]}>
                    Pick my own date
                  </Text>
                </TouchableOpacity>
              </View>

              {customDateOpen && (
                <DatePickerField
                  label="Unlock Date"
                  value={unlockDate}
                  onChange={setUnlockDate}
                  contextLabel="Capsule unlocks for everyone"
                />
              )}

              <View style={styles.surpriseRow}>
                <Ionicons name="eye-off-outline" size={16} color="#888888" />
                <Text style={styles.surpriseText}>
                  It stays locked for everyone — even you — until that day.
                </Text>
              </View>

              <TouchableOpacity
                style={[styles.primaryBtn, { backgroundColor: accentColor }]}
                onPress={createCapsule}
                disabled={saving}
                activeOpacity={0.85}
              >
                {saving
                  ? <LoadingBrand size="small" color="#fff" />
                  : <Text style={styles.primaryBtnText}>Create my capsule</Text>}
              </TouchableOpacity>
            </View>
          )}

          {step === 4 && (
            <View style={[styles.stepBody, styles.centeredBody]}>
              <View style={[styles.bigIconCircle, { backgroundColor: `${accentColor}22` }]}>
                <Ionicons name="notifications-outline" size={40} color={accentColor} />
              </View>
              <Text style={[styles.heading, styles.centerText]}>
                “{title}” opens {unlockDate ? formatUnlockDate(unlockDate) : 'soon'}.
              </Text>
              <Text style={[styles.sub, styles.centerText, { marginTop: 0 }]}>
                Want us to tell you the second it unlocks?{'\n'}
                That's the whole point of Capsule — don't miss it.
              </Text>

              <TouchableOpacity
                style={[styles.primaryBtn, styles.fullWidth, { backgroundColor: accentColor }]}
                onPress={primerYes}
                disabled={saving}
                activeOpacity={0.85}
              >
                {saving
                  ? <LoadingBrand size="small" color="#fff" />
                  : (
                    <Text style={styles.primaryBtnText}>
                      {Platform.OS === 'web' ? "Sounds good" : '🔔 Yes, notify me'}
                    </Text>
                  )}
              </TouchableOpacity>
              <TouchableOpacity onPress={primerLater} disabled={saving}>
                <Text style={styles.quietLink}>maybe later</Text>
              </TouchableOpacity>
            </View>
          )}

          {step === 5 && (
            <View style={[styles.stepBody, styles.centeredBody]}>
              <Animated.View
                style={[
                  styles.sealCircle,
                  { backgroundColor: `${accentColor}22` },
                  {
                    opacity: sealAnim,
                    transform: [{
                      scale: sealAnim.interpolate({ inputRange: [0, 1], outputRange: [0.3, 1] }),
                    }],
                  },
                ]}
              >
                <Ionicons name="lock-closed" size={44} color={accentColor} />
              </Animated.View>

              <Text style={[styles.heading, styles.centerText]}>Sealed.</Text>
              <Text style={[styles.sealSub, styles.centerText]}>
                “{title}” opens {countdownText}.
              </Text>
              <Text style={[styles.sub, styles.centerText, { marginTop: 0 }]}>
                Capsules are better full. {moment.nudge}
              </Text>

              <TouchableOpacity
                style={[styles.primaryBtn, styles.fullWidth, { backgroundColor: accentColor }]}
                onPress={invitePeople}
                activeOpacity={0.85}
              >
                <Text style={styles.primaryBtnText}>Invite people</Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={[styles.secondaryBtn, styles.fullWidth]}
                onPress={addFirstPhoto}
                activeOpacity={0.85}
              >
                <Text style={styles.secondaryBtnText}>Add the first photo</Text>
              </TouchableOpacity>
              <TouchableOpacity onPress={goHome}>
                <Text style={styles.quietLink}>take me home</Text>
              </TouchableOpacity>
            </View>
          )}

          {error ? <Text style={styles.error}>{error}</Text> : null}
        </ScrollView>

        {/* Footer — steps 1–3 only; 4–5 are forward-only ceremonies */}
        {step <= 3 && (
          <View style={styles.footer}>
            {step > 1 && (
              <TouchableOpacity
                onPress={() => { setError(''); transitionToStep((step - 1) as Step); }}
                style={styles.footerSecondary}
                disabled={saving}
              >
                <Text style={[styles.footerSecondaryText, { color: accentColor }]}>Back</Text>
              </TouchableOpacity>
            )}

            {step === 1 && (
              <TouchableOpacity
                style={[styles.footerPrimary, { backgroundColor: accentColor }]}
                onPress={goStep2}
                disabled={saving}
                activeOpacity={0.85}
              >
                <Text style={styles.footerPrimaryText}>Next</Text>
                <Ionicons name="arrow-forward" size={18} color="#FFFFFF" />
              </TouchableOpacity>
            )}

            {step === 2 && (
              intentText.trim() ? (
                <TouchableOpacity
                  style={[styles.footerPrimary, { backgroundColor: accentColor }]}
                  onPress={() => enterStep3(GENERAL_MOMENT, intentText)}
                  disabled={saving}
                  activeOpacity={0.85}
                >
                  <Text style={styles.footerPrimaryText}>Next</Text>
                  <Ionicons name="arrow-forward" size={18} color="#FFFFFF" />
                </TouchableOpacity>
              ) : (
                <TouchableOpacity onPress={skipToHome} style={styles.footerSkip} disabled={saving}>
                  {saving
                    ? <LoadingBrand size="small" color="#888" />
                    : <Text style={styles.footerSkipText}>skip for now</Text>}
                </TouchableOpacity>
              )
            )}

            {step === 3 && (
              <TouchableOpacity onPress={skipToHome} style={styles.footerSkip} disabled={saving}>
                {saving
                  ? <LoadingBrand size="small" color="#888" />
                  : <Text style={styles.footerSkipText}>skip for now</Text>}
              </TouchableOpacity>
            )}
          </View>
        )}
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#0A0A0A' },
  progressRow: { flexDirection: 'row', justifyContent: 'center', gap: 8, paddingTop: 12, paddingBottom: 4 },
  progressDot: { width: 8, height: 8, borderRadius: 4, backgroundColor: '#2A2A2A' },
  scroll: { flexGrow: 1, paddingHorizontal: 24, paddingTop: 16, paddingBottom: 24, gap: 20 },
  stepBody: { gap: 16 },
  centeredBody: { flex: 1, justifyContent: 'center', alignItems: 'center', gap: 18 },
  centerText: { textAlign: 'center' },
  heading: { fontSize: 28, fontWeight: '800', color: '#FFFFFF' },
  sub: { fontSize: 15, color: '#888888', marginTop: -8, lineHeight: 21 },

  avatarSlot: { alignItems: 'center', gap: 10, marginTop: 8 },
  avatarPlaceholder: {
    width: 96, height: 96, borderRadius: 48,
    alignItems: 'center', justifyContent: 'center',
  },
  avatarImg: { width: 96, height: 96, borderRadius: 48, backgroundColor: '#1A1A1A' },
  avatarHint: { fontSize: 14, fontWeight: '600' },
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

  previewCard: {
    flexDirection: 'row', alignItems: 'center', gap: 12,
    backgroundColor: '#1A1A1A',
    borderRadius: 16, padding: 14,
    borderWidth: 1, borderColor: '#2A2A2A',
    marginTop: 4,
  },
  previewAvatar: { width: 36, height: 36, borderRadius: 18, backgroundColor: '#2A2A2A' },
  previewAvatarFallback: { alignItems: 'center', justifyContent: 'center' },
  previewInitial: { color: '#FFFFFF', fontSize: 15, fontWeight: '700' },
  previewName: { color: '#FFFFFF', fontSize: 15, fontWeight: '700' },
  previewMeta: { color: '#666666', fontSize: 12, marginTop: 1 },
  previewHint: { color: '#666666', fontSize: 13, marginTop: -8 },

  momentGrid: { gap: 12, marginTop: 4 },
  momentRow: { flexDirection: 'row', gap: 12 },
  momentCard: {
    flex: 1,
    backgroundColor: '#1A1A1A',
    borderRadius: 16,
    padding: 14,
    borderWidth: 1,
    gap: 8,
  },
  momentIcon: {
    width: 36, height: 36, borderRadius: 18,
    alignItems: 'center', justifyContent: 'center',
  },
  momentLabel: { color: '#FFFFFF', fontSize: 14, fontWeight: '700' },
  momentTypedHint: { color: '#666666', fontSize: 13, marginTop: -8, lineHeight: 18 },

  capsuleCard: {
    backgroundColor: '#1A1A1A',
    borderRadius: 16,
    padding: 16,
    borderWidth: 1,
    gap: 10,
  },
  capsuleCardHeader: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  capsuleLock: {
    width: 40, height: 40, borderRadius: 20,
    alignItems: 'center', justifyContent: 'center',
  },
  capsuleTitleInput: { color: '#FFFFFF', fontSize: 18, fontWeight: '700', padding: 0 },
  capsuleRenameHint: { color: '#666666', fontSize: 11, marginTop: 2 },
  capsuleOpens: { color: '#888888', fontSize: 14 },
  flavor: { color: '#888888', fontSize: 14, fontStyle: 'italic', marginTop: -6 },

  chipWrap: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  dateChip: {
    flexDirection: 'row', alignItems: 'center', gap: 6,
    backgroundColor: '#1A1A1A',
    borderRadius: 10,
    paddingHorizontal: 14, paddingVertical: 10,
    borderWidth: 1, borderColor: '#2A2A2A',
  },
  dateChipText: { color: '#888888', fontSize: 14, fontWeight: '600' },

  surpriseRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  surpriseText: { color: '#888888', fontSize: 13, flex: 1, lineHeight: 18 },

  primaryBtn: {
    borderRadius: 16, paddingVertical: 16,
    alignItems: 'center', justifyContent: 'center',
    marginTop: 4,
  },
  primaryBtnText: { color: '#FFFFFF', fontSize: 16, fontWeight: '700' },
  secondaryBtn: {
    borderRadius: 16, paddingVertical: 16,
    alignItems: 'center', justifyContent: 'center',
    backgroundColor: '#1A1A1A',
    borderWidth: 1, borderColor: '#2A2A2A',
  },
  secondaryBtnText: { color: '#FFFFFF', fontSize: 16, fontWeight: '700' },
  fullWidth: { alignSelf: 'stretch' },
  quietLink: { color: '#666666', fontSize: 14, fontWeight: '600', paddingVertical: 10 },

  bigIconCircle: {
    width: 88, height: 88, borderRadius: 44,
    alignItems: 'center', justifyContent: 'center',
  },
  sealCircle: {
    width: 104, height: 104, borderRadius: 52,
    alignItems: 'center', justifyContent: 'center',
  },
  sealSub: { color: '#FFFFFF', fontSize: 17, fontWeight: '600', marginTop: -6 },

  error: { color: '#FF3B30', fontSize: 14, textAlign: 'center' },
  footer: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 24,
    paddingTop: 12,
    paddingBottom: 20,
    borderTopWidth: 1,
    borderTopColor: '#1E1E1E',
    gap: 12,
  },
  footerSecondary: { paddingVertical: 12, paddingHorizontal: 8, minWidth: 60 },
  footerSecondaryText: { fontSize: 16, fontWeight: '600' },
  footerSkip: { flex: 1, alignItems: 'center', paddingVertical: 12 },
  footerSkipText: { color: '#888888', fontSize: 15, fontWeight: '600' },
  footerPrimary: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    borderRadius: 16,
    paddingVertical: 16,
  },
  footerPrimaryText: { color: '#FFFFFF', fontSize: 16, fontWeight: '700' },
});
