import { useEffect } from 'react';
import { Linking } from 'react-native';
import { Session } from '@supabase/supabase-js';
import { supabase } from '../lib/supabase';
import { sessionStore } from '../lib/sessionStore';
import { navigationRef } from '../lib/navigationRef';
import { cache } from '../lib/cache';
import { toast } from '../lib/toast';
import { pendingJoinStash } from '../lib/pendingJoinStash';
import { pendingOpenStash } from '../lib/pendingOpenStash';
import { parseDeepLink } from '../lib/deepLinkRoute';

function navigateWhenReady(fn: () => void) {
  if (navigationRef.isReady()) {
    fn();
  } else {
    setTimeout(() => navigateWhenReady(fn), 100);
  }
}

// Like navigateWhenReady, but for routes that only exist in a navigator that
// isn't mounted yet at the moment we want to navigate — e.g. the reset-password
// deep link fires while the user is still signed out (AuthNavigator mounted,
// ResetPassword lives in AppNavigator). navigationRef.isReady() only tells us
// SOME navigator is mounted, not the right one, so a single navigate() call
// can silently no-op if it races the sign-in state change that swaps
// AuthNavigator for AppNavigator. This retries until navigationRef actually
// reports the target route as current, or gives up after `attempts`.
function navigateUntilRouteActive(
  routeName: string,
  navigate: () => void,
  attempts: number = 40,
  intervalMs: number = 250
) {
  if (navigationRef.isReady()) {
    if (navigationRef.getCurrentRoute()?.name === routeName) {
      return; // already there — stop immediately, don't navigate again
    }
    navigate();
    if (navigationRef.getCurrentRoute()?.name === routeName) {
      return; // landed synchronously
    }
  }
  if (attempts <= 1) {
    console.warn(`[useDeepLinks] gave up navigating to ${routeName} after retries`);
    return;
  }
  setTimeout(() => navigateUntilRouteActive(routeName, navigate, attempts - 1, intervalMs), intervalMs);
}

// Shared by both the signed-in-tap path and the drain-after-sign-in path
// (stashed while signed out — see pendingJoinStash). Opening the link IS the
// consent act — join immediately (joined_at set) rather than leaving a
// pending invite the user has to accept a second time from Alerts.
async function joinAndNavigate(capsuleId: string, userId: string) {
  const { data: existing } = await supabase
    .from('capsule_members')
    .select('id, joined_at')
    .eq('capsule_id', capsuleId)
    .eq('user_id', userId)
    .maybeSingle();

  if (existing && !existing.joined_at) {
    // A pending invite already exists. Previously this fell through to the
    // navigate below and left joined_at null — the user landed inside a
    // capsule they had never actually accepted, invisible in member counts.
    // UNIQUE (capsule_id, user_id) means accepting is an UPDATE, not an INSERT.
    const { error } = await supabase
      .from('capsule_members')
      .update({ joined_at: new Date().toISOString() })
      .eq('capsule_id', capsuleId)
      .eq('user_id', userId);
    if (error) {
      toast.show("Couldn't join this capsule — try the link again.");
      return;
    }
  } else if (!existing) {
    // No client-side notifications insert (no INSERT policy — always errors
    // silently); the notify_on_invite trigger already covers this.
    const { error } = await supabase.from('capsule_members').insert({
      capsule_id: capsuleId,
      user_id: userId,
      role: 'contributor',
      joined_at: new Date().toISOString(),
    });
    if (error) {
      // Navigating anyway would land on "Failed to load capsule" (the
      // membership-gated SELECT hides the row) with no hint the JOIN failed.
      toast.show("Couldn't join this capsule — try the link again.");
      return;
    }
    cache.invalidate('capsules', 'profile');
  }

  navigateWhenReady(() => {
    (navigationRef as any).navigate('CapsuleDetail', { capsuleId });
  });
}

// Open an existing capsule from a Live Activity tap. Unlike joinAndNavigate
// there's no membership write — the user is already a member (the activity
// only exists on a member's device).
function openCapsule(capsuleId: string, camera: boolean) {
  navigateWhenReady(() => {
    if (camera) {
      // CameraScreen reads targetCapsuleId and threads it into its Preview
      // navigation, so the capsule arrives preselected.
      (navigationRef as any).navigate('Tabs', {
        screen: 'Camera',
        params: { targetCapsuleId: capsuleId },
      });
    } else {
      (navigationRef as any).navigate('CapsuleDetail', { capsuleId });
    }
  });
}

async function handleUrl(url: string | null) {
  if (!url) return;

  const route = parseDeepLink(url);
  if (!route) return;

  switch (route.kind) {
    case 'reset': {
      // Password reset: capsule://reset-password?code=...
      if (!route.code) {
        // No PKCE code on the link. This is where an attacker-supplied
        // implicit-flow #access_token=...&refresh_token=... fragment now
        // lands — parseDeepLink discards the fragment entirely, so there is
        // no code to redeem and nothing session-establishing happens here.
        toast.show('This password reset link is invalid or expired — request a new one.');
        return;
      }
      // exchangeCodeForSession only succeeds when THIS device holds the
      // code_verifier that was stored locally when the reset was requested
      // (resetPasswordForEmail persists it under PKCE). A code supplied by
      // an attacker over the unauthenticated capsule:// scheme has no
      // matching verifier on the victim's device and is rejected.
      const { error } = await supabase.auth.exchangeCodeForSession(route.code);
      if (error) {
        toast.show('This password reset link is invalid or expired — request a new one.');
        return;
      }
      // Signed-out is the canonical case here — exchangeCodeForSession just
      // triggered a sign-in that swaps AuthNavigator for AppNavigator a tick
      // later, and ResetPassword only exists in the latter. Retry until it's
      // actually the active route (~10s budget) instead of
      // navigateWhenReady's single shot, which drops silently if it fires
      // before the swap.
      navigateUntilRouteActive('ResetPassword', () => {
        (navigationRef as any).navigate('ResetPassword');
      });
      return;
    }

    case 'open': {
      // Live Activity taps: capsule://capsule/<id> and capsule://capsule/<id>/camera
      if (!sessionStore.get()) {
        // Don't drop the tap — drain it after sign-in.
        pendingOpenStash.set({ capsuleId: route.capsuleId, camera: route.camera });
        return;
      }
      openCapsule(route.capsuleId, route.camera);
      return;
    }

    case 'join': {
      const session = sessionStore.get();
      if (!session) {
        // Signed out: stash the id instead of dropping the link. useDeepLinks
        // drains this the moment a session shows up (sign-in / sign-up).
        pendingJoinStash.set(route.capsuleId);
        return;
      }
      await joinAndNavigate(route.capsuleId, session.user.id);
      return;
    }
  }
}

export function useDeepLinks(session?: Session | null) {
  useEffect(() => {
    Linking.getInitialURL().then(handleUrl);
    const sub = Linking.addEventListener('url', ({ url }) => handleUrl(url));
    return () => sub.remove();
  }, []);

  useEffect(() => {
    if (!session) return;

    const stashedCapsuleId = pendingJoinStash.get();
    const stashedOpen = pendingOpenStash.get();

    // Both stashes are drained in the same pass. If both are set (the user
    // tapped a join link AND a Live Activity card while signed out), join
    // wins — it's a membership-changing server write, not just a
    // navigation, so it must not be pre-empted by openCapsule. The losing
    // stash is deliberately DISCARDED here, not left for a later drain: if
    // it survived, a future unrelated sign-in (sign out, then back in) would
    // replay it as a stale, out-of-context navigation. So pendingOpenStash
    // is unconditionally cleared below, whether or not it ends up acted on
    // — don't remove this clear() just because the join branch already
    // returns; that's exactly the bug this guards against.
    pendingOpenStash.clear();

    if (stashedCapsuleId) {
      pendingJoinStash.clear();
      joinAndNavigate(stashedCapsuleId, session.user.id);
      return;
    }

    if (stashedOpen) {
      openCapsule(stashedOpen.capsuleId, stashedOpen.camera);
    }
  }, [session]);
}
