import React, { useEffect, useState } from 'react';
import {
  ActivityIndicator, Modal, Pressable, StyleSheet, Text, View,
} from 'react-native';
import { SafeAreaProvider, SafeAreaView } from 'react-native-safe-area-context';
import { Image } from 'expo-image';
import { useTheme } from '../context/ThemeContext';
import { supabase } from '../lib/supabase';
import { sessionStore } from '../lib/sessionStore';
import { navigationRef } from '../lib/navigationRef';
import { transformAvatarUrl } from '../lib/avatarUrl';
import { haptics } from '../lib/haptics';
import { toast } from '../lib/toast';
import { cache } from '../lib/cache';

// Security fix (F6, CSRF): capsule://join/<id> is an unauthenticated custom
// scheme any web page or app can fire — Linking.addEventListener/getInitialURL
// in useDeepLinks.ts have no way to know a tap was user-intended vs.
// attacker-crafted. Opening the link must therefore be treated as
// navigation-to-a-preview, NOT as consent: no capsule_members INSERT/UPDATE
// runs until the user explicitly taps "Accept Invite" here.
//
// Mirrors QRScannerScreen's confirmation sheet against the same
// capsule_join_preview(...) SECURITY DEFINER RPC — including its three
// membership states (already_member / is_pending / neither) and the
// UPDATE-not-INSERT rule for accepting a pending invite (capsule_members has
// UNIQUE (capsule_id, user_id), so inserting a second row 23505s; accepting
// is an UPDATE of joined_at, the one column clients are granted on this
// table). Kept in sync deliberately — if that screen's join logic changes,
// mirror the change here too.

type CapsulePreview = {
  id: string;
  title: string;
  ownerName: string;
  ownerAvatar: string | null;
  memberCount: number;
  alreadyMember: boolean;
  /** Invited but never accepted. Accepting is an UPDATE, not an INSERT. */
  isPending: boolean;
};

type ConfirmState = {
  visible: boolean;
  loading: boolean;
  preview: CapsulePreview | null;
  error: string;
};

const INITIAL_STATE: ConfirmState = { visible: false, loading: false, preview: null, error: '' };

let state: ConfirmState = INITIAL_STATE;
const listeners = new Set<() => void>();

function setState(patch: Partial<ConfirmState>) {
  state = { ...state, ...patch };
  listeners.forEach(fn => fn());
}

// Same "poll until ready" idiom useDeepLinks.ts uses elsewhere — the sheet
// can be dismissed/accepted before NavigationContainer has finished mounting
// (e.g. a cold-start deep link).
function navigateToCapsule(capsuleId: string) {
  function attempt() {
    if (navigationRef.isReady()) {
      (navigationRef as any).navigate('CapsuleDetail', { capsuleId });
    } else {
      setTimeout(attempt, 100);
    }
  }
  attempt();
}

/**
 * Global imperative API — the only entry point `useDeepLinks.ts` should use
 * for a `capsule://join/<id>` URL. Fetches the join preview and shows the
 * confirm sheet; performs NO membership write on its own.
 */
export const joinCapsuleConfirm = {
  async request(capsuleId: string) {
    setState({ visible: true, loading: true, preview: null, error: '' });
    try {
      const { data, error } = await supabase.rpc('capsule_join_preview', { p_capsule_id: capsuleId });
      const row = (data as any)?.[0];

      if (error || !row) {
        setState({ loading: false, error: "This capsule doesn't exist or the invite has expired." });
        return;
      }

      setState({
        loading: false,
        preview: {
          id: row.id,
          title: row.title,
          ownerName: row.owner_name ?? 'Unknown',
          ownerAvatar: row.owner_avatar ?? null,
          memberCount: Number(row.member_count) || 0,
          alreadyMember: !!row.already_member,
          isPending: !!row.is_pending,
        },
      });
    } catch {
      setState({ loading: false, error: 'Something went wrong. Please try again.' });
    }
  },

  hide() {
    setState(INITIAL_STATE);
  },

  get(): ConfirmState {
    return state;
  },

  subscribe(fn: () => void): () => void {
    listeners.add(fn);
    return () => listeners.delete(fn);
  },
};

/** Mounted once near the app root, alongside <ToastHost/> and <LimitSheetHost/>. */
export function JoinCapsuleConfirmHost() {
  const { accentColor, onAccentColor } = useTheme();
  const [local, setLocal] = useState(state);
  const [joining, setJoining] = useState(false);

  useEffect(() => joinCapsuleConfirm.subscribe(() => setLocal(joinCapsuleConfirm.get())), []);

  if (!local.visible) return null;

  function dismiss() {
    setJoining(false);
    joinCapsuleConfirm.hide();
  }

  function goToCapsule(id: string) {
    joinCapsuleConfirm.hide();
    setJoining(false);
    navigateToCapsule(id);
  }

  async function accept() {
    const preview = local.preview;
    if (!preview) return;
    // The confirm sheet can outlive the session it was opened under (e.g. the
    // user signs out while it's showing) — re-check rather than trusting a
    // captured session.
    const session = sessionStore.get();
    if (!session) {
      dismiss();
      return;
    }

    setJoining(true);
    try {
      if (preview.isPending) {
        const { error } = await supabase
          .from('capsule_members')
          .update({ joined_at: new Date().toISOString() })
          .eq('capsule_id', preview.id)
          .eq('user_id', session.user.id);
        if (error) throw error;
        cache.invalidate('capsules', 'profile', 'notifications');
      } else if (!preview.alreadyMember) {
        // No client-side notifications insert — no INSERT policy, always
        // errors silently; the notify_on_invite trigger already covers this.
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
      goToCapsule(preview.id);
    } catch (e: any) {
      const raw = `${e?.message ?? ''} ${e?.code ?? ''}`;

      // enforce_member_limit fires on every join path, this one included.
      if (raw.includes('MEMBER_LIMIT_REACHED')) {
        setState({ error: 'This capsule is full. Ask the owner to upgrade for more members.' });
        setJoining(false);
        return;
      }
      // 23505 = unique violation: already a member (joined elsewhere, or
      // accepted an invite between preview-fetch and this tap). Treat as
      // success — they're in.
      if (raw.includes('23505') || raw.toLowerCase().includes('duplicate key')) {
        cache.invalidate('capsules', 'profile');
        haptics.success();
        goToCapsule(preview.id);
        return;
      }
      toast.show("Couldn't join this capsule — try the link again.");
      setJoining(false);
    }
  }

  const { loading, preview, error } = local;

  return (
    <Modal visible transparent animationType="fade" onRequestClose={dismiss}>
      {/* A Modal renders in its own native view hierarchy, unreachable by the
          root SafeAreaProvider — see CLAUDE.md "iOS / Web Layout Gotchas". */}
      <SafeAreaProvider>
        <View style={styles.backdrop}>
          <Pressable style={StyleSheet.absoluteFill} onPress={dismiss} accessibilityRole="button" accessibilityLabel="Dismiss" />
          <SafeAreaView edges={['bottom']} style={styles.sheetWrap}>
            <View style={styles.sheet}>
              <View style={styles.handle} />

              {loading ? (
                <View style={styles.loadingBox}>
                  <ActivityIndicator color="#fff" />
                  <Text style={styles.loadingText}>Looking up capsule…</Text>
                </View>
              ) : preview ? (
                <>
                  {preview.alreadyMember && !preview.isPending ? (
                    <>
                      <Text style={styles.sheetLabel}>Already a member</Text>
                      <Text style={styles.capsuleTitle}>{preview.title}</Text>
                    </>
                  ) : (
                    <>
                      <Text style={styles.sheetLabel}>You've been invited to join</Text>
                      <Text style={styles.capsuleTitle}>{preview.title}</Text>
                      <View style={styles.ownerRow}>
                        {preview.ownerAvatar ? (
                          <Image
                            source={transformAvatarUrl(preview.ownerAvatar, 28)}
                            style={styles.ownerAv}
                            contentFit="cover"
                          />
                        ) : (
                          <View style={[styles.ownerAv, styles.ownerAvFallback]}>
                            <Text style={styles.ownerInitial}>{(preview.ownerName[0] ?? '?').toUpperCase()}</Text>
                          </View>
                        )}
                        <Text style={styles.ownerName}>by {preview.ownerName}</Text>
                        <Text style={styles.memberCount}>
                          {' '}· {preview.memberCount} member{preview.memberCount !== 1 ? 's' : ''}
                        </Text>
                      </View>
                    </>
                  )}

                  {error ? <Text style={styles.errorText}>{error}</Text> : null}

                  <View style={styles.btnRow}>
                    {preview.alreadyMember ? (
                      <Pressable
                        style={[styles.acceptBtn, { backgroundColor: accentColor }]}
                        onPress={() => goToCapsule(preview.id)}
                        accessibilityRole="button"
                      >
                        <Text style={[styles.acceptText, { color: onAccentColor }]}>Open capsule</Text>
                      </Pressable>
                    ) : (
                      <Pressable
                        style={[styles.acceptBtn, { backgroundColor: accentColor }]}
                        onPress={accept}
                        disabled={joining}
                        accessibilityRole="button"
                      >
                        {joining ? (
                          <ActivityIndicator color={onAccentColor} />
                        ) : (
                          <Text style={[styles.acceptText, { color: onAccentColor }]}>Accept Invite</Text>
                        )}
                      </Pressable>
                    )}
                    <Pressable style={styles.cancelBtn} onPress={dismiss} disabled={joining} accessibilityRole="button">
                      <Text style={styles.cancelText}>{preview.alreadyMember ? 'Done' : 'Cancel'}</Text>
                    </Pressable>
                  </View>
                </>
              ) : (
                <>
                  <Text style={styles.sheetLabel}>Invite unavailable</Text>
                  {error ? <Text style={styles.errorText}>{error}</Text> : null}
                  <View style={styles.btnRow}>
                    <Pressable style={styles.cancelBtn} onPress={dismiss} accessibilityRole="button">
                      <Text style={styles.cancelText}>Close</Text>
                    </Pressable>
                  </View>
                </>
              )}
            </View>
          </SafeAreaView>
        </View>
      </SafeAreaProvider>
    </Modal>
  );
}

const styles = StyleSheet.create({
  backdrop: {
    flex: 1,
    justifyContent: 'flex-end',
    backgroundColor: 'rgba(0,0,0,0.6)',
  },
  sheetWrap: {
    backgroundColor: '#1A1A1A',
  },
  sheet: {
    backgroundColor: '#1A1A1A',
    borderTopLeftRadius: 24,
    borderTopRightRadius: 24,
    padding: 28,
  },
  handle: {
    width: 36,
    height: 4,
    backgroundColor: '#3A3A3A',
    borderRadius: 2,
    alignSelf: 'center',
    marginBottom: 24,
  },
  loadingBox: {
    alignItems: 'center',
    gap: 12,
    paddingVertical: 20,
  },
  loadingText: {
    color: '#888888',
    fontSize: 15,
  },
  sheetLabel: {
    fontSize: 14,
    color: '#888888',
    fontWeight: '500',
    marginBottom: 6,
  },
  capsuleTitle: {
    fontSize: 22,
    fontWeight: '700',
    color: '#FFFFFF',
    marginBottom: 16,
  },
  ownerRow: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 24,
    gap: 8,
  },
  ownerAv: { width: 28, height: 28, borderRadius: 14 },
  ownerAvFallback: { backgroundColor: '#333333', alignItems: 'center', justifyContent: 'center' },
  ownerInitial: { color: '#FFFFFF', fontSize: 12, fontWeight: '700' },
  ownerName: { color: '#AAAAAA', fontSize: 14, fontWeight: '500' },
  memberCount: { color: '#666666', fontSize: 14 },
  errorText: { color: '#FF6B6B', fontSize: 13, marginBottom: 12 },
  btnRow: { gap: 10 },
  acceptBtn: { borderRadius: 14, paddingVertical: 16, alignItems: 'center' },
  acceptText: { fontSize: 16, fontWeight: '700' },
  cancelBtn: { backgroundColor: '#2A2A2A', borderRadius: 14, paddingVertical: 16, alignItems: 'center' },
  cancelText: { color: '#AAAAAA', fontSize: 16, fontWeight: '600' },
});
