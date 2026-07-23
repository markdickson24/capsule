import React, { useState } from 'react';
import {
  View, Text, StyleSheet, ScrollView, Animated,
  TouchableOpacity, Modal, Pressable, Linking, Switch, Platform,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { NativeStackScreenProps } from '@react-navigation/native-stack';
import Constants from 'expo-constants';
import { Ionicons } from '@expo/vector-icons';
import { LinearGradient } from 'expo-linear-gradient';
import LoadingBrand from '../../components/LoadingBrand';
import { useTheme } from '../../context/ThemeContext';
import { AppStackParamList } from '../../types/navigation';
import ColorPicker from '../../components/ColorPicker';
import { useSlideUp } from '../../lib/animations';
import { supabase } from '../../lib/supabase';
import { sessionStore } from '../../lib/sessionStore';
import { cache } from '../../lib/cache';
import { toast } from '../../lib/toast';
import { useEntitlements } from '../../hooks/useEntitlements';
import { presentPaywall, presentCustomerCenter, restorePurchases } from '../../lib/purchases';
import { PRIVACY_URL, TERMS_URL } from '../../lib/legalLinks';
import { ACCENT_PRESETS, ACCENT_GRADIENTS } from '../../lib/accentPresets';
import { proGateHit } from '../../lib/proGate';
import { reportError } from '../../lib/sentry';

type Props = NativeStackScreenProps<AppStackParamList, 'Settings'>;

// Published contact info, required by App Review's UGC checklist (Guideline 1.2).
const SUPPORT_EMAIL = 'mark.dickson0824@gmail.com';
const SUPPORT_URL = `mailto:${SUPPORT_EMAIL}?subject=Capsule%20Support`;

function appVersionLabel(): string {
  const v = Constants.expoConfig?.version ?? Constants.nativeAppVersion ?? '?';
  const b = Constants.nativeBuildVersion ?? '';
  return b ? `v${v} (build ${b})` : `v${v}`;
}

export default function SettingsScreen({ navigation }: Props) {
  const { accentColor, setAccentColor, accentGradient, setAccentGradient } = useTheme();
  const { isPro, loading: entitlementsLoading } = useEntitlements();
  const [pending, setPending] = useState(accentColor);
  const [saving, setSaving] = useState(false);
  const [showDelete, setShowDelete] = useState(false);
  const [restoring, setRestoring] = useState(false);
  const contentAnim = useSlideUp(0, 400);

  async function handleSaveColor() {
    // A gradient is already persisted the moment it's tapped (and sets
    // pending=g[0]). If the user hasn't since picked a different solid, "Save"
    // must NOT clear the gradient — just leave. Picking any solid preset/custom
    // color moves `pending` off accentColor, which re-enables a real solid save
    // (setAccentColor clears the gradient, as intended for a solid choice).
    if (accentGradient && pending === accentColor) {
      navigation.goBack();
      return;
    }
    setSaving(true);
    await setAccentColor(pending);
    setSaving(false);
    navigation.goBack();
  }

  // Present the RevenueCat-hosted paywall. useEntitlements' CustomerInfo
  // listener flips `isPro` automatically on a successful purchase — no refetch.
  async function handleUpgrade() {
    await presentPaywall();
  }

  async function handleRestore() {
    setRestoring(true);
    const ok = await restorePurchases();
    setRestoring(false);
    toast.show(ok ? 'Purchases restored.' : 'No purchases to restore.');
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

          {/* Native-only: react-native-purchases doesn't run on web, and web
              isn't a marketed purchase surface. */}
          {Platform.OS !== 'web' && (
            <View style={styles.section}>
              <Text style={styles.sectionLabel}>Capsule Pro</Text>
              {isPro ? (
                <>
                  <TouchableOpacity
                    style={styles.row}
                    activeOpacity={0.75}
                    onPress={presentCustomerCenter}
                  >
                    <Ionicons name="star" size={18} color={accentColor} />
                    <Text style={styles.rowLabel}>Manage Subscription</Text>
                    <Ionicons name="chevron-forward" size={16} color="#555555" />
                  </TouchableOpacity>
                  <Text style={styles.helper}>
                    You're on Capsule Pro — thanks for the support. Change plan, restore, or cancel anytime.
                  </Text>
                </>
              ) : (
                <>
                  <TouchableOpacity
                    style={[styles.primaryBtn, { backgroundColor: accentColor }]}
                    onPress={handleUpgrade}
                  >
                    <Text style={styles.primaryBtnText}>Upgrade to Capsule Pro</Text>
                  </TouchableOpacity>
                  <Text style={styles.helper}>
                    Unlimited capsules, longer videos, recurring groups, bigger capsules, and one-tap capsule export.
                  </Text>
                  <TouchableOpacity
                    style={styles.row}
                    activeOpacity={0.75}
                    onPress={handleRestore}
                    disabled={restoring}
                  >
                    <Ionicons name="refresh-outline" size={18} color="#AAAAAA" />
                    <Text style={styles.rowLabel}>Restore Purchases</Text>
                    {restoring && <LoadingBrand size="small" color="#888888" />}
                  </TouchableOpacity>
                </>
              )}
            </View>
          )}

          <View style={styles.section}>
            <Text style={styles.sectionLabel}>Appearance</Text>
            <Text style={styles.helper}>Choose your accent color</Text>

            {/* Preset swatches — available to everyone. */}
            <View style={styles.swatchGrid}>
              {ACCENT_PRESETS.map((hex) => {
                const selected = !accentGradient && pending.toLowerCase() === hex.toLowerCase();
                return (
                  <TouchableOpacity
                    key={hex}
                    style={[styles.swatch, { backgroundColor: hex }, selected && styles.swatchSelected]}
                    onPress={() => { setPending(hex); }}
                    accessibilityRole="button"
                    accessibilityLabel={`Accent color ${hex}`}
                  >
                    {selected && <Ionicons name="checkmark" size={16} color="#fff" />}
                  </TouchableOpacity>
                );
              })}
            </View>

            {/* Pro: custom picker + gradients. Free: a locked upsell row.
                The free row is disabled while entitlements load so a real Pro
                user (briefly isPro=false) can't trigger the paywall before the
                listener resolves. */}
            {isPro ? (
              <>
                <Text style={styles.helper}>Custom color</Text>
                <ColorPicker value={pending} onChange={setPending} originalValue={accentColor} />
                <Text style={styles.helper}>Gradient themes</Text>
                <View style={styles.swatchGrid}>
                  {ACCENT_GRADIENTS.map((g) => {
                    const isSel = !!accentGradient && accentGradient[0] === g[0] && accentGradient[1] === g[1];
                    return (
                      <TouchableOpacity
                        key={g.join('')}
                        onPress={() => { setAccentGradient(g); setPending(g[0]); }}
                        accessibilityRole="button"
                        accessibilityLabel={`Gradient theme ${g[0]} to ${g[1]}`}
                        style={[styles.gradSwatchWrap, isSel && styles.swatchSelected]}
                      >
                        <LinearGradient colors={g} start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }} style={styles.gradSwatch}>
                          {isSel && <Ionicons name="checkmark" size={16} color="#fff" />}
                        </LinearGradient>
                      </TouchableOpacity>
                    );
                  })}
                </View>
              </>
            ) : (
              <TouchableOpacity
                style={styles.lockedRow}
                activeOpacity={0.75}
                disabled={entitlementsLoading}
                onPress={() => proGateHit({
                  currentUserIsHost: true,
                  title: 'Custom colors & gradients',
                  ownerMessage: 'Upgrade to Capsule Pro for a custom color picker and gradient themes.',
                  guestMessage: '',
                })}
                accessibilityRole="button"
                accessibilityLabel="Unlock custom colors and gradients with Capsule Pro"
              >
                <Ionicons name="sparkles" size={18} color={accentColor} />
                <Text style={styles.lockedRowLabel}>Custom color & gradient themes</Text>
                <View style={[styles.proTag, { backgroundColor: `${accentColor}22`, borderColor: `${accentColor}55` }]}>
                  <Text style={[styles.proTagText, { color: accentColor }]}>PRO</Text>
                </View>
              </TouchableOpacity>
            )}

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
            <Text style={styles.sectionLabel}>Support &amp; Legal</Text>
            <SettingsRow
              icon="mail-outline"
              label="Contact Support"
              onPress={() => Linking.openURL(SUPPORT_URL)}
            />
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
              Permanently deletes your account and your votes. Capsules and groups you created are handed off
              to another member if one exists (or removed if you're the only one). This can't be undone.
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

    setBusy(true);
    setError('');

    try {
      // Storage cleanup (capsule media + avatar) happens server-side inside
      // delete_my_account itself — see the migration that added it. Doing it
      // client-side first was the bug: a failed RPC left other users' photos
      // destroyed with all DB rows intact, and even on success it also wiped
      // storage for capsules the RPC TRANSFERS to another member (whose media
      // rows survive on purpose). Client-side cleanup also can't simply run
      // AFTER the RPC instead — once the account is deleted the JWT is dead
      // and any follow-up storage call would 401.
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
      reportError(e, { where: 'SettingsScreen.deleteAccount' });
    }
  }

  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={busy ? () => {} : onClose} statusBarTranslucent>
      <Pressable style={styles.backdrop} onPress={busy ? () => {} : onClose}>
        <Pressable style={styles.sheet} onPress={() => {}}>
          <View style={styles.handle} />
          <Text style={styles.sheetTitle}>Delete your account?</Text>
          <Text style={styles.sheetBody}>
            This permanently deletes your profile, your votes, and all related notifications. Any capsules or
            groups you created pass to another member if one exists (or are removed if you're the only one).
            This cannot be undone.
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
  swatchGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: 12, marginVertical: 8 },
  swatch: { width: 44, height: 44, borderRadius: 22, alignItems: 'center', justifyContent: 'center', borderWidth: 2, borderColor: 'transparent' },
  swatchSelected: { borderColor: '#FFFFFF' },
  gradSwatchWrap: { width: 44, height: 44, borderRadius: 22, borderWidth: 2, borderColor: 'transparent', overflow: 'hidden' },
  gradSwatch: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  lockedRow: { flexDirection: 'row', alignItems: 'center', gap: 10, paddingVertical: 12, paddingHorizontal: 4 },
  lockedRowLabel: { color: '#FFFFFF', fontSize: 15, flex: 1 },
  proTag: { paddingHorizontal: 8, paddingVertical: 3, borderRadius: 8, borderWidth: 1 },
  proTagText: { fontSize: 11, fontWeight: '800', letterSpacing: 0.5 },
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
