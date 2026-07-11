import React, { useState } from 'react';
import {
  View, Text, StyleSheet, ScrollView, Animated,
  TouchableOpacity, Modal, Pressable, Linking, Switch,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { NativeStackScreenProps } from '@react-navigation/native-stack';
import Constants from 'expo-constants';
import { Ionicons } from '@expo/vector-icons';
import LoadingBrand from '../../components/LoadingBrand';
import { useTheme } from '../../context/ThemeContext';
import { AppStackParamList } from '../../types/navigation';
import ColorPicker from '../../components/ColorPicker';
import { useSlideUp } from '../../lib/animations';
import { supabase } from '../../lib/supabase';
import { sessionStore } from '../../lib/sessionStore';
import { cache } from '../../lib/cache';

type Props = NativeStackScreenProps<AppStackParamList, 'Settings'>;

const PRIVACY_URL = 'https://capsule.app/privacy';
const TERMS_URL = 'https://capsule.app/terms';

function appVersionLabel(): string {
  const v = Constants.expoConfig?.version ?? Constants.nativeAppVersion ?? '?';
  const b = Constants.nativeBuildVersion ?? '';
  return b ? `v${v} (build ${b})` : `v${v}`;
}

export default function SettingsScreen({ navigation }: Props) {
  const { accentColor, setAccentColor } = useTheme();
  const [pending, setPending] = useState(accentColor);
  const [saving, setSaving] = useState(false);
  const [showDelete, setShowDelete] = useState(false);
  const contentAnim = useSlideUp(0, 400);

  async function handleSaveColor() {
    setSaving(true);
    await setAccentColor(pending);
    setSaving(false);
    navigation.goBack();
  }

  return (
    <SafeAreaView style={styles.container} edges={['top', 'left', 'right']}>
      <TouchableOpacity style={styles.backBtn} onPress={() => navigation.goBack()}>
        <Text style={[styles.backText, { color: accentColor }]}>← Back</Text>
      </TouchableOpacity>

      <ScrollView contentContainerStyle={styles.scroll}>
        <Animated.View style={[{ gap: 24 }, contentAnim]}>
          <View>
            <Text style={styles.title}>Settings</Text>
          </View>

          <View style={styles.section}>
            <Text style={styles.sectionLabel}>Appearance</Text>
            <Text style={styles.helper}>Choose your accent color</Text>
            <ColorPicker value={accentColor} onChange={setPending} originalValue={accentColor} />
            <TouchableOpacity
              style={[styles.primaryBtn, { backgroundColor: pending }]}
              onPress={handleSaveColor}
              disabled={saving}
            >
              {saving
                ? <LoadingBrand size="small" color="#fff" />
                : <Text style={styles.primaryBtnText}>Save Color</Text>
              }
            </TouchableOpacity>
          </View>

          <View style={styles.section}>
            <Text style={styles.sectionLabel}>Privacy</Text>
            <TouchableOpacity style={styles.row} activeOpacity={0.75} onPress={() => navigation.navigate('BlockedUsers')}>
              <Ionicons name="shield-outline" size={18} color="#AAAAAA" />
              <Text style={styles.rowLabel}>Blocked Users</Text>
              <Ionicons name="chevron-forward" size={16} color="#555555" />
            </TouchableOpacity>
          </View>

          <View style={styles.section}>
            <Text style={styles.sectionLabel}>Legal</Text>
            <SettingsRow
              icon="document-text-outline"
              label="Privacy Policy"
              onPress={() => Linking.openURL(PRIVACY_URL)}
            />
            <SettingsRow
              icon="reader-outline"
              label="Terms of Service"
              onPress={() => Linking.openURL(TERMS_URL)}
            />
          </View>

          <View style={styles.section}>
            <Text style={styles.sectionLabel}>Account</Text>
            <TouchableOpacity
              style={styles.destructiveBtn}
              onPress={() => setShowDelete(true)}
            >
              <Ionicons name="trash-outline" size={18} color="#FF3B30" />
              <Text style={styles.destructiveText}>Delete my account</Text>
            </TouchableOpacity>
            <Text style={styles.helper}>
              Permanently deletes your account, the capsules you own, and your votes. Groups you created are
              handed off to another member (or removed if you're the only one). This can't be undone.
            </Text>
          </View>

          <Text style={styles.versionFooter}>{appVersionLabel()}</Text>
        </Animated.View>
      </ScrollView>

      <DeleteAccountModal
        visible={showDelete}
        onClose={() => setShowDelete(false)}
        onDeleted={() => {
          cache.clear();
          sessionStore.markIntentionalSignOut();
          supabase.auth.signOut();
        }}
      />
    </SafeAreaView>
  );
}

function SettingsRow({
  icon, label, onPress,
}: {
  icon: keyof typeof Ionicons.glyphMap;
  label: string;
  onPress: () => void;
}) {
  return (
    <TouchableOpacity style={styles.row} onPress={onPress} activeOpacity={0.75}>
      <Ionicons name={icon} size={18} color="#AAAAAA" />
      <Text style={styles.rowLabel}>{label}</Text>
      <Ionicons name="open-outline" size={16} color="#555555" />
    </TouchableOpacity>
  );
}

function DeleteAccountModal({
  visible, onClose, onDeleted,
}: {
  visible: boolean;
  onClose: () => void;
  onDeleted: () => void;
}) {
  const [deleteContribs, setDeleteContribs] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  async function confirm() {
    const session = sessionStore.get();
    if (!session) { setError('Not signed in.'); return; }
    const userId = session.user.id;

    setBusy(true);
    setError('');

    try {
      // 1. Collect storage_keys to delete — owned capsule media + (optionally) contributed media.
      const keys: string[] = [];

      const { data: ownedMedia } = await supabase
        .from('media')
        .select('storage_key, thumbnail_key, capsules!inner(owner_id)')
        .eq('capsules.owner_id', userId);
      for (const m of (ownedMedia ?? []) as any[]) {
        if (m.storage_key) keys.push(m.storage_key);
        if (m.thumbnail_key) keys.push(m.thumbnail_key);
      }

      if (deleteContribs) {
        const { data: contribMedia } = await supabase
          .from('media')
          .select('storage_key, thumbnail_key')
          .eq('uploader_id', userId);
        for (const m of (contribMedia ?? []) as any[]) {
          if (m.storage_key) keys.push(m.storage_key);
          if (m.thumbnail_key) keys.push(m.thumbnail_key);
        }
      }

      if (keys.length > 0) {
        await supabase.storage.from('capsule-media').remove(keys);
      }

      // 2. Remove avatar (best effort)
      await supabase.storage.from('avatars').remove([`${userId}/avatar.jpg`]);

      // 3. DB cleanup
      const { error: rpcError } = await supabase.rpc('delete_my_account', {
        p_delete_contributions: deleteContribs,
      });
      if (rpcError) throw new Error(rpcError.message);

      setBusy(false);
      onClose();
      onDeleted();
    } catch (e: any) {
      setBusy(false);
      setError(e?.message ?? 'Failed to delete account. Try again.');
    }
  }

  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={busy ? () => {} : onClose} statusBarTranslucent>
      <Pressable style={styles.backdrop} onPress={busy ? () => {} : onClose}>
        <Pressable style={styles.sheet} onPress={() => {}}>
          <View style={styles.handle} />
          <Text style={styles.sheetTitle}>Delete your account?</Text>
          <Text style={styles.sheetBody}>
            This permanently deletes your profile, the capsules you own, your votes, and all related notifications.
            Any groups you created pass to another member (or are removed if you're the only one). This cannot be undone.
          </Text>

          <View style={styles.optionRow}>
            <View style={{ flex: 1 }}>
              <Text style={styles.optionTitle}>Also delete my contributions</Text>
              <Text style={styles.optionSubtitle}>
                Photos and videos you uploaded to other people's capsules will be removed.
              </Text>
            </View>
            <Switch
              value={deleteContribs}
              onValueChange={setDeleteContribs}
              disabled={busy}
              trackColor={{ false: '#444', true: '#FF3B30' }}
              thumbColor="#FFFFFF"
            />
          </View>

          {!deleteContribs && (
            <Text style={styles.altNote}>
              They'll stay in those capsules but your name will be removed.
            </Text>
          )}

          {error ? <Text style={styles.sheetError}>{error}</Text> : null}

          <TouchableOpacity style={styles.destructConfirm} onPress={confirm} disabled={busy}>
            {busy ? <LoadingBrand size="small" color="#FFFFFF" /> : (
              <Text style={styles.destructConfirmText}>Delete my account</Text>
            )}
          </TouchableOpacity>
          <TouchableOpacity style={styles.cancelBtn} onPress={onClose} disabled={busy}>
            <Text style={styles.cancelText}>Cancel</Text>
          </TouchableOpacity>
        </Pressable>
      </Pressable>
    </Modal>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#0A0A0A' },
  backBtn: { paddingHorizontal: 20, paddingTop: 12, paddingBottom: 4 },
  backText: { fontSize: 16, fontWeight: '600' },
  scroll: { paddingHorizontal: 24, paddingTop: 8, paddingBottom: 48, gap: 24 },
  title: { fontSize: 28, fontWeight: '800', color: '#FFFFFF' },
  section: { gap: 12 },
  sectionLabel: {
    fontSize: 12, fontWeight: '700',
    color: '#666', textTransform: 'uppercase', letterSpacing: 0.7,
  },
  helper: { color: '#888888', fontSize: 13, lineHeight: 18 },
  primaryBtn: {
    borderRadius: 14, paddingVertical: 16,
    alignItems: 'center', marginTop: 6,
  },
  primaryBtnText: { color: '#FFFFFF', fontSize: 16, fontWeight: '700' },
  row: {
    flexDirection: 'row', alignItems: 'center', gap: 12,
    backgroundColor: '#1A1A1A',
    borderRadius: 12, paddingHorizontal: 16, paddingVertical: 14,
    borderWidth: 1, borderColor: '#2A2A2A',
  },
  rowLabel: { flex: 1, color: '#FFFFFF', fontSize: 15, fontWeight: '600' },
  destructiveBtn: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8,
    borderRadius: 14, paddingVertical: 16,
    backgroundColor: '#1A1A1A',
    borderWidth: 1, borderColor: '#3A1A1A',
  },
  destructiveText: { color: '#FF3B30', fontSize: 15, fontWeight: '700' },
  versionFooter: {
    color: '#444',
    fontSize: 12,
    textAlign: 'center',
    marginTop: 16,
  },
  backdrop: { flex: 1, backgroundColor: 'rgba(0,0,0,0.65)', justifyContent: 'flex-end' },
  sheet: {
    backgroundColor: '#1A1A1A',
    borderTopLeftRadius: 20, borderTopRightRadius: 20,
    paddingHorizontal: 24, paddingTop: 12, paddingBottom: 40, gap: 14,
  },
  handle: { width: 36, height: 4, borderRadius: 2, backgroundColor: '#444', alignSelf: 'center', marginBottom: 8 },
  sheetTitle: { fontSize: 20, fontWeight: '800', color: '#FFFFFF' },
  sheetBody: { color: '#AAAAAA', fontSize: 14, lineHeight: 20 },
  optionRow: {
    flexDirection: 'row', alignItems: 'center', gap: 12,
    paddingVertical: 8,
  },
  optionTitle: { color: '#FFFFFF', fontSize: 15, fontWeight: '700' },
  optionSubtitle: { color: '#888888', fontSize: 12, marginTop: 2 },
  altNote: { color: '#888888', fontSize: 12, fontStyle: 'italic' },
  sheetError: { color: '#FF3B30', fontSize: 13, textAlign: 'center' },
  destructConfirm: {
    backgroundColor: '#FF3B30',
    borderRadius: 14,
    paddingVertical: 16, alignItems: 'center',
    marginTop: 6,
  },
  destructConfirmText: { color: '#FFFFFF', fontSize: 16, fontWeight: '800' },
  cancelBtn: { paddingVertical: 12, alignItems: 'center' },
  cancelText: { color: '#888888', fontSize: 15, fontWeight: '600' },
});
