import React, { useState, useCallback } from 'react';
import {
  View, Text, StyleSheet, TouchableOpacity, ActivityIndicator,
  Dimensions, Platform,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { CameraView, useCameraPermissions } from 'expo-camera';
import { useNavigation } from '@react-navigation/native';
import { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { Ionicons } from '@expo/vector-icons';
import { Image } from 'expo-image';
import { supabase } from '../../lib/supabase';
import { transformAvatarUrl } from '../../lib/avatarUrl';
import { sessionStore } from '../../lib/sessionStore';
import { haptics } from '../../lib/haptics';
import { toast } from '../../lib/toast';
import { cache } from '../../lib/cache';
import { AppStackParamList } from '../../types/navigation';

type Nav = NativeStackNavigationProp<AppStackParamList>;

type CapsulePreview = {
  id: string;
  title: string;
  ownerName: string;
  ownerAvatar: string | null;
  memberCount: number;
  alreadyMember: boolean;
};

const { width: SW, height: SH } = Dimensions.get('window');
const FINDER_SIZE = Math.min(SW, SH) * 0.64;

export default function QRScannerScreen() {
  const navigation = useNavigation<Nav>();
  const [permission, requestPermission] = useCameraPermissions();
  const [scanned, setScanned] = useState(false);
  const [preview, setPreview] = useState<CapsulePreview | null>(null);
  const [loading, setLoading] = useState(false);
  const [joining, setJoining] = useState(false);
  const [scanError, setScanError] = useState('');

  // On error paths where no confirmation sheet renders, `scanned` would
  // otherwise stay true forever — onBarcodeScanned becomes undefined and the
  // camera can never scan again, despite the hint text inviting a retry.
  // Re-arm after a couple seconds so "Try again" is actually true.
  function rearmAfterError() {
    setLoading(false);
    setTimeout(() => {
      setScanned(prev => (prev ? false : prev));
    }, 2000);
  }

  const handleScan = useCallback(async ({ data }: { data: string }) => {
    if (scanned) return;
    setScanned(true);
    haptics.selection();

    const match = data.match(/(?:capsule:\/\/join\/|https:\/\/getcapsuleapp\.com\/join\/)([a-zA-Z0-9-]+)/);
    if (!match) {
      setScanError('Not a valid Capsule invite. Try again.');
      rearmAfterError();
      return;
    }

    const capsuleId = match[1];
    const session = sessionStore.get();
    if (!session) return;

    setLoading(true);
    try {
      // A user scanning to join is not yet a member, and the capsules SELECT
      // policy is membership-gated — so read the preview via a SECURITY DEFINER
      // RPC that returns only minimal, non-sensitive fields.
      const { data, error } = await supabase.rpc('capsule_join_preview', { p_capsule_id: capsuleId });
      const row = (data as any)?.[0];

      if (error || !row) {
        setScanError("This capsule doesn't exist or the invite has expired.");
        rearmAfterError();
        return;
      }

      setPreview({
        id: row.id,
        title: row.title,
        ownerName: row.owner_name ?? 'Unknown',
        ownerAvatar: row.owner_avatar ?? null,
        memberCount: Number(row.member_count) || 0,
        alreadyMember: !!row.already_member,
      });
      setLoading(false);
    } catch {
      setScanError('Something went wrong. Please try again.');
      rearmAfterError();
    }
  }, [scanned]);

  async function joinCapsule() {
    if (!preview) return;
    const session = sessionStore.get();
    if (!session) return;

    setJoining(true);
    try {
      if (!preview.alreadyMember) {
        // Scanning a QR in person IS the consent act — join immediately
        // (joined_at set), don't leave a pending invite the user has to
        // accept a second time from Alerts. The notify_on_invite trigger
        // already fires off this insert; no client-side notifications
        // insert is needed (and it has no INSERT policy — it always errors).
        const { error } = await supabase.from('capsule_members').insert({
          capsule_id: preview.id,
          user_id: session.user.id,
          role: 'contributor',
          joined_at: new Date().toISOString(),
        });
        if (error) throw error;
        cache.invalidate('capsules', 'profile');
      }
      haptics.success();
      navigation.replace('CapsuleDetail', { capsuleId: preview.id });
    } catch {
      setScanError('Could not join. Please try again.');
      toast.show("Couldn't join — try again.");
      setJoining(false);
    }
  }

  function dismissSheet() {
    setPreview(null);
    setScanError('');
    setScanned(false);
  }

  if (!permission) return <View style={s.bg} />;

  if (!permission.granted) {
    return (
      <View style={s.bg}>
        <SafeAreaView style={s.permBox} edges={['top', 'bottom']}>
          <TouchableOpacity style={s.closeBtn} onPress={() => navigation.goBack()} accessibilityRole="button" accessibilityLabel="Close">
            <Ionicons name="close" size={26} color="#fff" />
          </TouchableOpacity>
          <Ionicons name="camera-outline" size={52} color="#666" />
          <Text style={s.permTitle}>Camera access needed</Text>
          <Text style={s.permSub}>Allow camera access to scan Capsule QR codes.</Text>
          <TouchableOpacity style={s.permBtn} onPress={requestPermission}>
            <Text style={s.permBtnText}>Grant access</Text>
          </TouchableOpacity>
        </SafeAreaView>
      </View>
    );
  }

  const hintText = loading
    ? 'Looking up capsule…'
    : scanError
    ? scanError
    : 'Point at a Capsule QR code';

  return (
    <View style={s.bg}>
      <CameraView
        style={StyleSheet.absoluteFill}
        barcodeScannerSettings={{ barcodeTypes: ['qr'] }}
        onBarcodeScanned={!scanned ? handleScan : undefined}
      />

      {/* Viewfinder overlay — 4 dark sections around a clear finder */}
      <View style={s.overlayTop} pointerEvents="none" />
      <View style={s.overlayMid} pointerEvents="none">
        <View style={s.overlaySide} />
        <View style={s.finder}>
          <View style={[s.corner, s.cTL]} /><View style={[s.corner, s.cTR]} />
          <View style={[s.corner, s.cBL]} /><View style={[s.corner, s.cBR]} />
        </View>
        <View style={s.overlaySide} />
      </View>
      <View style={s.overlayBot} pointerEvents="none" />

      {/* Header */}
      <SafeAreaView style={s.header} edges={['top']} pointerEvents="box-none">
        <TouchableOpacity style={s.closeBtn} onPress={() => navigation.goBack()} hitSlop={8} accessibilityRole="button" accessibilityLabel="Close scanner">
          <Ionicons name="close" size={26} color="#fff" />
        </TouchableOpacity>
        <Text style={s.headerTitle}>Scan to Join</Text>
        <View style={{ width: 44 }} />
      </SafeAreaView>

      {/* Hint */}
      <View style={s.hintRow} pointerEvents="none">
        {loading
          ? <ActivityIndicator color="#fff" size="small" />
          : <Text style={[s.hint, scanError ? s.hintErr : null]}>{hintText}</Text>
        }
      </View>

      {/* Confirmation sheet */}
      {preview && (
        <View style={s.sheetBg} onStartShouldSetResponder={() => true}>
          <View style={s.sheet}>
            <View style={s.handle} />
            {preview.alreadyMember ? (
              <>
                <Text style={s.sheetTitle}>Already a member</Text>
                <Text style={s.capsuleTitle}>{preview.title}</Text>
              </>
            ) : (
              <>
                <Text style={s.sheetLabel}>You've been invited to join</Text>
                <Text style={s.capsuleTitle}>{preview.title}</Text>
                <View style={s.ownerRow}>
                  {preview.ownerAvatar ? (
                    <Image source={transformAvatarUrl(preview.ownerAvatar, 28)} style={s.ownerAv} contentFit="cover" />
                  ) : (
                    <View style={[s.ownerAv, s.ownerAvFallback]}>
                      <Text style={s.ownerInitial}>{(preview.ownerName[0] ?? '?').toUpperCase()}</Text>
                    </View>
                  )}
                  <Text style={s.ownerName}>by {preview.ownerName}</Text>
                  <Text style={s.memberCount}> · {preview.memberCount} member{preview.memberCount !== 1 ? 's' : ''}</Text>
                </View>
              </>
            )}

            {scanError ? <Text style={s.sheetErr}>{scanError}</Text> : null}

            <View style={s.sheetBtns}>
              {!preview.alreadyMember && (
                <TouchableOpacity style={s.acceptBtn} onPress={joinCapsule} disabled={joining}>
                  {joining
                    ? <ActivityIndicator color="#0a0a0a" />
                    : <Text style={s.acceptText}>Accept Invite</Text>
                  }
                </TouchableOpacity>
              )}
              <TouchableOpacity style={s.cancelBtn} onPress={dismissSheet}>
                <Text style={s.cancelText}>{preview.alreadyMember ? 'Done' : 'Cancel'}</Text>
              </TouchableOpacity>
            </View>
          </View>
        </View>
      )}
    </View>
  );
}

const OVERLAY_V = (SH - FINDER_SIZE) / 2;
const CORNER = 22;
const BORDER_W = 3;

const s = StyleSheet.create({
  bg: { flex: 1, backgroundColor: '#000' },

  // Overlay
  overlayTop:  { position: 'absolute', top: 0, left: 0, right: 0, height: OVERLAY_V, backgroundColor: 'rgba(0,0,0,0.62)' },
  overlayMid:  { position: 'absolute', top: OVERLAY_V, left: 0, right: 0, height: FINDER_SIZE, flexDirection: 'row' },
  overlaySide: { flex: 1, backgroundColor: 'rgba(0,0,0,0.62)' },
  overlayBot:  { position: 'absolute', bottom: 0, left: 0, right: 0, top: OVERLAY_V + FINDER_SIZE, backgroundColor: 'rgba(0,0,0,0.62)' },
  finder:      { width: FINDER_SIZE, height: FINDER_SIZE },

  // Corner brackets
  corner: { position: 'absolute', width: CORNER, height: CORNER },
  cTL: { top: 0, left: 0,   borderTopWidth: BORDER_W, borderLeftWidth: BORDER_W,   borderColor: '#fff', borderTopLeftRadius: 4 },
  cTR: { top: 0, right: 0,  borderTopWidth: BORDER_W, borderRightWidth: BORDER_W,  borderColor: '#fff', borderTopRightRadius: 4 },
  cBL: { bottom: 0, left: 0,  borderBottomWidth: BORDER_W, borderLeftWidth: BORDER_W,  borderColor: '#fff', borderBottomLeftRadius: 4 },
  cBR: { bottom: 0, right: 0, borderBottomWidth: BORDER_W, borderRightWidth: BORDER_W, borderColor: '#fff', borderBottomRightRadius: 4 },

  // Header
  header: { position: 'absolute', top: 0, left: 0, right: 0, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 16, paddingTop: 8, zIndex: 10 },
  closeBtn: { width: 44, height: 44, alignItems: 'center', justifyContent: 'center', backgroundColor: 'rgba(0,0,0,0.45)', borderRadius: 22 },
  headerTitle: { color: '#fff', fontSize: 17, fontWeight: '600' },

  // Hint
  hintRow: { position: 'absolute', left: 0, right: 0, top: OVERLAY_V + FINDER_SIZE + 20, alignItems: 'center' },
  hint: { color: 'rgba(255,255,255,0.8)', fontSize: 15, textAlign: 'center', paddingHorizontal: 32 },
  hintErr: { color: '#FF6B6B' },

  // Confirmation sheet
  sheetBg: { position: 'absolute', bottom: 0, left: 0, right: 0, backgroundColor: 'rgba(0,0,0,0.5)' },
  sheet: { backgroundColor: '#1A1A1A', borderTopLeftRadius: 24, borderTopRightRadius: 24, padding: 28, paddingBottom: 40 },
  handle: { width: 36, height: 4, backgroundColor: '#3A3A3A', borderRadius: 2, alignSelf: 'center', marginBottom: 24 },
  sheetLabel: { fontSize: 14, color: '#888', fontWeight: '500', marginBottom: 6 },
  sheetTitle: { fontSize: 22, fontWeight: '700', color: '#fff', marginBottom: 4 },
  capsuleTitle: { fontSize: 22, fontWeight: '700', color: '#fff', marginBottom: 16 },
  ownerRow: { flexDirection: 'row', alignItems: 'center', marginBottom: 24, gap: 8 },
  ownerAv: { width: 28, height: 28, borderRadius: 14 },
  ownerAvFallback: { backgroundColor: '#333', alignItems: 'center', justifyContent: 'center' },
  ownerInitial: { color: '#fff', fontSize: 12, fontWeight: '700' },
  ownerName: { color: '#aaa', fontSize: 14, fontWeight: '500' },
  memberCount: { color: '#666', fontSize: 14 },
  sheetErr: { color: '#FF6B6B', fontSize: 13, marginBottom: 12 },
  sheetBtns: { gap: 10 },
  acceptBtn: { backgroundColor: '#fff', borderRadius: 14, paddingVertical: 16, alignItems: 'center' },
  acceptText: { color: '#0a0a0a', fontSize: 16, fontWeight: '700' },
  cancelBtn: { backgroundColor: '#2A2A2A', borderRadius: 14, paddingVertical: 16, alignItems: 'center' },
  cancelText: { color: '#aaa', fontSize: 16, fontWeight: '600' },

  // Permission
  permBox: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: 32, gap: 16 },
  permTitle: { color: '#fff', fontSize: 20, fontWeight: '700', textAlign: 'center' },
  permSub: { color: '#888', fontSize: 15, textAlign: 'center', lineHeight: 22 },
  permBtn: { backgroundColor: '#fff', borderRadius: 14, paddingVertical: 14, paddingHorizontal: 32, marginTop: 8 },
  permBtnText: { color: '#0a0a0a', fontSize: 16, fontWeight: '700' },
});
