import React, { useState } from 'react';
import LoadingBrand from '../../components/LoadingBrand';
import {
  View, Text, StyleSheet, ScrollView, TextInput,
  TouchableOpacity, Platform, KeyboardAvoidingView,
} from 'react-native';
import { Image } from 'expo-image';
import { SafeAreaView } from 'react-native-safe-area-context';
import { NativeStackScreenProps } from '@react-navigation/native-stack';
import * as ImagePicker from 'expo-image-picker';
import * as ImageManipulator from 'expo-image-manipulator';
import * as FileSystem from 'expo-file-system/legacy';
import { Ionicons } from '@expo/vector-icons';
import { supabase, getFreshSession } from '../../lib/supabase';
import { sessionStore } from '../../lib/sessionStore';
import { useTheme } from '../../context/ThemeContext';
import ColorPicker from '../../components/ColorPicker';
import { AppStackParamList } from '../../types/navigation';
import type { TablesUpdate } from '../../types/supabase';

type Props = NativeStackScreenProps<AppStackParamList, 'Onboarding'>;

const PRESETS: { title: string; description: string; icon: keyof typeof Ionicons.glyphMap }[] = [
  { title: 'Vacation memories',  description: 'Photos from the trip, opened when we get home.', icon: 'airplane-outline' },
  { title: "Baby's first year",  description: 'Every milestone, locked until their first birthday.', icon: 'happy-outline' },
  { title: 'Wedding day',        description: 'Everyone shares their angle — opened on the honeymoon.', icon: 'heart-outline' },
  { title: 'Year in review',     description: 'A year of moments, opened on New Year\'s Eve.', icon: 'calendar-outline' },
];

const DEFAULT_ACCENT = '#FF6B35';

export default function OnboardingScreen({ navigation }: Props) {
  const { accentColor, setAccentColor } = useTheme();
  const [step, setStep] = useState<1 | 2 | 3 | 4>(1);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  // Step 1
  const [displayName, setDisplayName] = useState('');
  const [avatarUri, setAvatarUri] = useState<string | null>(null);

  // Step 2 — bound to ColorPicker
  const [pendingColor, setPendingColor] = useState(accentColor || DEFAULT_ACCENT);

  // Step 3
  const [bio, setBio] = useState('');

  async function pickAvatar() {
    const result = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ImagePicker.MediaTypeOptions.Images,
      allowsEditing: true,
      aspect: [1, 1],
      quality: 0.9,
    });
    if (result.canceled || !result.assets[0]) return;
    setAvatarUri(result.assets[0].uri);
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
      const { error } = await supabase.storage
        .from('avatars')
        .upload(path, buf, { contentType: 'image/jpeg', upsert: true });
      if (error) throw new Error(error.message);
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
        throw new Error(`Storage ${result.status}: ${result.body?.slice(0, 200) ?? 'no body'}`);
      }
    }

    const { data } = supabase.storage.from('avatars').getPublicUrl(path);
    return `${data.publicUrl}?t=${Date.now()}`;
  }

  async function finish(opts: { preset?: typeof PRESETS[number] } = {}) {
    setError('');
    const session = sessionStore.get();
    if (!session) { setError('Session lost. Try signing out and in.'); return; }
    const userId = session.user.id;

    setSaving(true);

    let avatarUrl: string | null = null;
    if (avatarUri) {
      try {
        avatarUrl = await uploadAvatar(avatarUri);
      } catch (e: any) {
        setSaving(false);
        setError(`Avatar upload failed: ${e?.message ?? 'unknown error'}`);
        return;
      }
    }

    const updates: TablesUpdate<'users'> = {
      display_name: displayName.trim(),
      accent_color: pendingColor,
      bio: bio.trim() || null,
      onboarded_at: new Date().toISOString(),
    };
    if (avatarUrl) updates.avatar_url = avatarUrl;

    const { error: updateError } = await supabase
      .from('users')
      .update(updates)
      .eq('id', userId);

    if (updateError) {
      setSaving(false);
      setError('Could not save your profile. Please try again.');
      return;
    }

    sessionStore.markOnboarded(userId);

    // Persist accent color in theme context too
    if (pendingColor !== accentColor) {
      await setAccentColor(pendingColor);
    }

    setSaving(false);

    if (opts.preset) {
      navigation.replace('Tabs', {
        screen: 'Create',
        params: { presetTitle: opts.preset.title, presetDescription: opts.preset.description },
      });
    } else {
      navigation.replace('Tabs', { screen: 'Home' });
    }
  }

  function next() {
    if (step === 1) {
      if (!displayName.trim()) { setError('Please enter a display name.'); return; }
      if (displayName.trim().length > 30) { setError('Display name must be 30 characters or less.'); return; }
      setError('');
      setStep(2);
    } else if (step === 2) {
      setError('');
      setStep(3);
    } else if (step === 3) {
      setError('');
      setStep(4);
    }
  }

  function back() {
    if (step > 1) setStep((s) => (s - 1) as 1 | 2 | 3);
  }

  return (
    <SafeAreaView style={styles.container}>
      <KeyboardAvoidingView
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
        style={{ flex: 1 }}
      >
        {/* Progress dots */}
        <View style={styles.progressRow}>
          {[1, 2, 3, 4].map((n) => (
            <View
              key={n}
              style={[
                styles.progressDot,
                n === step && { backgroundColor: pendingColor, width: 24 },
                n < step && { backgroundColor: pendingColor },
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
              <Text style={styles.heading}>What should we call you?</Text>
              <Text style={styles.sub}>This is how friends will see you in capsules.</Text>

              <TouchableOpacity style={styles.avatarSlot} onPress={pickAvatar} activeOpacity={0.8}>
                {avatarUri ? (
                  <Image source={avatarUri} style={styles.avatarImg} />
                ) : (
                  <View style={[styles.avatarPlaceholder, { backgroundColor: pendingColor }]}>
                    <Ionicons name="camera-outline" size={32} color="#FFFFFF" />
                  </View>
                )}
                <Text style={[styles.avatarHint, { color: pendingColor }]}>
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
            </View>
          )}

          {step === 2 && (
            <View style={styles.stepBody}>
              <Text style={styles.heading}>Pick your color</Text>
              <Text style={styles.sub}>It'll tint buttons, accents, and the camera button.</Text>
              <ColorPicker value={pendingColor} onChange={setPendingColor} />
            </View>
          )}

          {step === 3 && (
            <View style={styles.stepBody}>
              <Text style={styles.heading}>Tell us a little</Text>
              <Text style={styles.sub}>A short bio shown on your profile. 80 characters max.</Text>
              <TextInput
                style={[styles.input, styles.textarea]}
                placeholder="e.g. Photographer. Dog dad. Always packing snacks."
                placeholderTextColor="#555"
                value={bio}
                onChangeText={setBio}
                maxLength={80}
                multiline
              />
              <Text style={styles.charCount}>{bio.length}/80</Text>
            </View>
          )}

          {step === 4 && (
            <View style={styles.stepBody}>
              <Text style={styles.heading}>Start your first capsule</Text>
              <Text style={styles.sub}>Pick a starting point — you can change everything later.</Text>

              <View style={styles.presetGrid}>
                {PRESETS.map((p) => (
                  <TouchableOpacity
                    key={p.title}
                    style={[styles.presetCard, { borderColor: `${pendingColor}40` }]}
                    onPress={() => finish({ preset: p })}
                    disabled={saving}
                    activeOpacity={0.85}
                  >
                    <View style={[styles.presetIcon, { backgroundColor: `${pendingColor}22` }]}>
                      <Ionicons name={p.icon} size={22} color={pendingColor} />
                    </View>
                    <Text style={styles.presetTitle}>{p.title}</Text>
                    <Text style={styles.presetDesc} numberOfLines={2}>{p.description}</Text>
                  </TouchableOpacity>
                ))}
              </View>
            </View>
          )}

          {error ? <Text style={styles.error}>{error}</Text> : null}
        </ScrollView>

        {/* Footer */}
        <View style={styles.footer}>
          {step > 1 ? (
            <TouchableOpacity onPress={back} style={styles.footerSecondary} disabled={saving}>
              <Text style={[styles.footerSecondaryText, { color: pendingColor }]}>Back</Text>
            </TouchableOpacity>
          ) : null}

          {step < 4 && step > 1 ? (
            <TouchableOpacity onPress={() => { setError(''); setStep((s) => Math.min(4, s + 1) as 1 | 2 | 3 | 4); }} style={styles.footerSecondary} disabled={saving}>
              <Text style={[styles.footerSecondaryText, { color: '#888888' }]}>Skip</Text>
            </TouchableOpacity>
          ) : null}

          {step < 4 ? (
            <TouchableOpacity
              style={[styles.footerPrimary, { backgroundColor: pendingColor }]}
              onPress={next}
              disabled={saving}
              activeOpacity={0.85}
            >
              <Text style={styles.footerPrimaryText}>Next</Text>
              <Ionicons name="arrow-forward" size={18} color="#FFFFFF" />
            </TouchableOpacity>
          ) : (
            <TouchableOpacity
              style={[styles.footerPrimary, { backgroundColor: pendingColor }]}
              onPress={() => finish()}
              disabled={saving}
              activeOpacity={0.85}
            >
              {saving
                ? <LoadingBrand size="small" color="#fff" />
                : <Text style={styles.footerPrimaryText}>Skip & finish</Text>
              }
            </TouchableOpacity>
          )}
        </View>
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
  heading: { fontSize: 28, fontWeight: '800', color: '#FFFFFF' },
  sub: { fontSize: 15, color: '#888888', marginTop: -8 },
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
  textarea: { minHeight: 90, textAlignVertical: 'top' },
  charCount: { color: '#555555', fontSize: 12, textAlign: 'right', marginTop: -10 },
  presetGrid: { gap: 12, marginTop: 4 },
  presetCard: {
    backgroundColor: '#1A1A1A',
    borderRadius: 16,
    padding: 16,
    borderWidth: 1,
    gap: 8,
  },
  presetIcon: {
    width: 40, height: 40, borderRadius: 20,
    alignItems: 'center', justifyContent: 'center',
  },
  presetTitle: { color: '#FFFFFF', fontSize: 16, fontWeight: '700' },
  presetDesc: { color: '#888888', fontSize: 13, lineHeight: 18 },
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
