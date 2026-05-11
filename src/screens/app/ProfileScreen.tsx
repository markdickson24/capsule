import React, { useEffect, useState } from 'react';
import {
  View, Text, StyleSheet, SafeAreaView, TouchableOpacity,
  TextInput, Modal, Image, ActivityIndicator, Platform,
  ScrollView, KeyboardAvoidingView,
} from 'react-native';
import * as ImagePicker from 'expo-image-picker';
import * as ImageManipulator from 'expo-image-manipulator';
import * as FileSystem from 'expo-file-system/legacy';
import { supabase } from '../../lib/supabase';

type Profile = {
  id: string;
  display_name: string;
  bio: string | null;
  avatar_url: string | null;
};

export function Avatar({ url, name, size }: { url: string | null; name: string; size: number }) {
  if (url) {
    return (
      <Image
        source={{ uri: url }}
        style={{ width: size, height: size, borderRadius: size / 2, backgroundColor: '#1A1A1A' }}
      />
    );
  }
  return (
    <View style={{ width: size, height: size, borderRadius: size / 2, backgroundColor: '#FF6B35', alignItems: 'center', justifyContent: 'center' }}>
      <Text style={{ color: '#fff', fontSize: size * 0.38, fontWeight: '700' }}>
        {(name[0] ?? '?').toUpperCase()}
      </Text>
    </View>
  );
}

async function uploadAvatar(uri: string, userId: string): Promise<string | null> {
  const { data: { session } } = await supabase.auth.getSession();
  if (!session) return null;

  const path = `${userId}/avatar.jpg`;

  if (Platform.OS === 'web') {
    const resp = await fetch(uri);
    const buf = await resp.arrayBuffer();
    const { error } = await supabase.storage
      .from('avatars')
      .upload(path, buf, { contentType: 'image/jpeg', upsert: true });
    if (error) return null;
  } else {
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
        headers: {
          Authorization: `Bearer ${session.access_token}`,
          apikey: process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY!,
          'Content-Type': 'image/jpeg',
          'x-upsert': 'true',
        },
      }
    );
    if (result.status >= 400) return null;
  }

  const { data } = supabase.storage.from('avatars').getPublicUrl(path);
  return `${data.publicUrl}?t=${Date.now()}`;
}

function EditProfileModal({
  profile,
  onClose,
  onSaved,
}: {
  profile: Profile;
  onClose: () => void;
  onSaved: (updated: Profile) => void;
}) {
  const [displayName, setDisplayName] = useState(profile.display_name);
  const [bio, setBio] = useState(profile.bio ?? '');
  const [avatarUri, setAvatarUri] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  async function pickAvatar() {
    const result = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ImagePicker.MediaTypeOptions.Images,
      allowsEditing: true,
      aspect: [1, 1],
      quality: 0.8,
    });
    if (!result.canceled && result.assets[0]) {
      setAvatarUri(result.assets[0].uri);
    }
  }

  async function save() {
    if (!displayName.trim()) { setError('Display name is required.'); return; }
    setSaving(true);
    setError('');

    let avatar_url = profile.avatar_url;
    if (avatarUri) {
      const uploaded = await uploadAvatar(avatarUri, profile.id);
      if (uploaded) avatar_url = uploaded;
      else { setError('Avatar upload failed. Try again.'); setSaving(false); return; }
    }

    const { error: err } = await supabase
      .from('users')
      .update({ display_name: displayName.trim(), bio: bio.trim() || null, avatar_url })
      .eq('id', profile.id);

    if (err) {
      setError('Failed to save. Try again.');
      setSaving(false);
    } else {
      onSaved({ ...profile, display_name: displayName.trim(), bio: bio.trim() || null, avatar_url });
    }
  }

  const previewUrl = avatarUri ?? profile.avatar_url;

  return (
    <Modal visible animationType="slide" presentationStyle="pageSheet" onRequestClose={onClose}>
      <SafeAreaView style={es.container}>
        <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined} style={{ flex: 1 }}>
          <View style={es.header}>
            <TouchableOpacity onPress={onClose}>
              <Text style={es.cancel}>Cancel</Text>
            </TouchableOpacity>
            <Text style={es.title}>Edit Profile</Text>
            <TouchableOpacity onPress={save} disabled={saving}>
              <Text style={[es.saveBtn, saving && { opacity: 0.4 }]}>{saving ? 'Saving…' : 'Save'}</Text>
            </TouchableOpacity>
          </View>

          <ScrollView contentContainerStyle={es.body}>
            <TouchableOpacity style={es.avatarWrap} onPress={pickAvatar}>
              <Avatar url={previewUrl} name={displayName || '?'} size={88} />
              <Text style={es.changePhoto}>Change Photo</Text>
            </TouchableOpacity>

            <Text style={es.label}>Display Name</Text>
            <TextInput
              style={es.input}
              value={displayName}
              onChangeText={setDisplayName}
              placeholder="Your name"
              placeholderTextColor="#555"
              autoCorrect={false}
              maxLength={30}
            />

            <View style={es.labelRow}>
              <Text style={es.label}>Bio</Text>
              <Text style={es.charCount}>{bio.length}/80</Text>
            </View>
            <TextInput
              style={es.input}
              value={bio}
              onChangeText={t => setBio(t.slice(0, 80))}
              placeholder="A short tagline…"
              placeholderTextColor="#555"
              maxLength={80}
            />

            {error ? <Text style={es.error}>{error}</Text> : null}
          </ScrollView>
        </KeyboardAvoidingView>
      </SafeAreaView>
    </Modal>
  );
}

export default function ProfileScreen() {
  const [profile, setProfile] = useState<Profile | null>(null);
  const [loading, setLoading] = useState(true);
  const [showEdit, setShowEdit] = useState(false);
  const [confirming, setConfirming] = useState(false);

  useEffect(() => { loadProfile(); }, []);

  async function loadProfile() {
    const { data: { session } } = await supabase.auth.getSession();
    if (!session) return;
    const { data } = await supabase
      .from('users')
      .select('id, display_name, bio, avatar_url')
      .eq('id', session.user.id)
      .single();
    if (data) setProfile(data as Profile);
    setLoading(false);
  }

  if (loading) {
    return <SafeAreaView style={styles.center}><ActivityIndicator color="#FF6B35" /></SafeAreaView>;
  }

  if (confirming) {
    return (
      <SafeAreaView style={styles.center}>
        <Text style={styles.name}>Sign out?</Text>
        <Text style={styles.bio}>You'll need to log back in to access your capsules.</Text>
        <View style={styles.row}>
          <TouchableOpacity style={styles.outlineBtn} onPress={() => setConfirming(false)}>
            <Text style={styles.outlineBtnText}>Cancel</Text>
          </TouchableOpacity>
          <TouchableOpacity style={styles.destructBtn} onPress={() => supabase.auth.signOut()}>
            <Text style={styles.destructBtnText}>Sign Out</Text>
          </TouchableOpacity>
        </View>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={styles.container}>
      <ScrollView contentContainerStyle={styles.body}>
        <Avatar url={profile?.avatar_url ?? null} name={profile?.display_name ?? '?'} size={96} />
        <Text style={styles.name}>{profile?.display_name}</Text>
        {profile?.bio ? <Text style={styles.bio}>{profile.bio}</Text> : null}

        <TouchableOpacity style={styles.editBtn} onPress={() => setShowEdit(true)}>
          <Text style={styles.editBtnText}>Edit Profile</Text>
        </TouchableOpacity>

        <TouchableOpacity style={styles.destructBtn} onPress={() => setConfirming(true)}>
          <Text style={styles.destructBtnText}>Sign Out</Text>
        </TouchableOpacity>
      </ScrollView>

      {showEdit && profile && (
        <EditProfileModal
          profile={profile}
          onClose={() => setShowEdit(false)}
          onSaved={updated => { setProfile(updated); setShowEdit(false); }}
        />
      )}
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#0A0A0A' },
  center: { flex: 1, backgroundColor: '#0A0A0A', alignItems: 'center', justifyContent: 'center', gap: 20, paddingHorizontal: 32 },
  body: { alignItems: 'center', paddingTop: 48, paddingBottom: 40, gap: 12, paddingHorizontal: 32 },
  name: { fontSize: 22, fontWeight: '800', color: '#FFFFFF', marginTop: 8 },
  bio: { fontSize: 14, color: '#888888', textAlign: 'center' },
  row: { flexDirection: 'row', gap: 12, marginTop: 8 },
  editBtn: { marginTop: 16, width: '100%', borderWidth: 1, borderColor: '#FF6B35', borderRadius: 12, paddingVertical: 14, alignItems: 'center' },
  editBtnText: { color: '#FF6B35', fontWeight: '600', fontSize: 16 },
  outlineBtn: { flex: 1, borderWidth: 1, borderColor: '#333', borderRadius: 12, paddingVertical: 14, alignItems: 'center' },
  outlineBtnText: { color: '#FFFFFF', fontWeight: '600', fontSize: 16 },
  destructBtn: { width: '100%', borderWidth: 1, borderColor: '#FF3B30', borderRadius: 12, paddingVertical: 14, alignItems: 'center' },
  destructBtnText: { color: '#FF3B30', fontWeight: '600', fontSize: 16 },
});

const es = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#0A0A0A' },
  header: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 20, paddingVertical: 16, borderBottomWidth: 1, borderBottomColor: '#1A1A1A' },
  title: { fontSize: 17, fontWeight: '700', color: '#FFFFFF' },
  cancel: { fontSize: 16, color: '#888888' },
  saveBtn: { fontSize: 16, fontWeight: '700', color: '#FF6B35' },
  body: { alignItems: 'center', paddingTop: 32, paddingHorizontal: 24, gap: 8, paddingBottom: 40 },
  avatarWrap: { alignItems: 'center', gap: 10, marginBottom: 16 },
  changePhoto: { fontSize: 14, color: '#FF6B35', fontWeight: '600' },
  labelRow: { flexDirection: 'row', justifyContent: 'space-between', alignSelf: 'stretch' },
  label: { fontSize: 13, color: '#888888', fontWeight: '600', textTransform: 'uppercase', letterSpacing: 0.5, alignSelf: 'flex-start' },
  charCount: { fontSize: 13, color: '#555555' },
  input: { alignSelf: 'stretch', borderWidth: 1, borderColor: '#2A2A2A', borderRadius: 10, paddingHorizontal: 14, paddingVertical: 12, color: '#FFFFFF', fontSize: 16, backgroundColor: '#111111' },
  error: { color: '#FF3B30', fontSize: 14, textAlign: 'center' },
});
