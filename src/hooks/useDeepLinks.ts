import { useEffect } from 'react';
import { Linking } from 'react-native';
import { supabase } from '../lib/supabase';
import { sessionStore } from '../lib/sessionStore';
import { navigationRef } from '../lib/navigationRef';
import { cache } from '../lib/cache';

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

async function handleUrl(url: string | null) {
  if (!url) return;

  // Password reset: capsule://reset-password#access_token=...&refresh_token=...
  if (url.includes('reset-password')) {
    const fragment = url.includes('#') ? url.split('#')[1] : url.split('?')[1];
    if (!fragment) return;
    const params = new URLSearchParams(fragment);
    const access_token = params.get('access_token');
    const refresh_token = params.get('refresh_token');
    if (!access_token || !refresh_token) return;
    await supabase.auth.setSession({ access_token, refresh_token });
    // Signed-out is the canonical case here — setSession just triggered a
    // sign-in that swaps AuthNavigator for AppNavigator a tick later, and
    // ResetPassword only exists in the latter. Retry until it's actually
    // the active route (~10s budget) instead of navigateWhenReady's single
    // shot, which drops silently if it fires before the swap.
    navigateUntilRouteActive('ResetPassword', () => {
      (navigationRef as any).navigate('ResetPassword');
    });
    return;
  }

  const match = url.match(/capsule:\/\/join\/([a-zA-Z0-9-]+)/);
  if (!match) return;
  const capsuleId = match[1];

  const session = sessionStore.get();
  if (!session) return;
  const userId = session.user.id;

  // Check if already a member (pending or joined)
  const { data: existing } = await supabase
    .from('capsule_members')
    .select('id')
    .eq('capsule_id', capsuleId)
    .eq('user_id', userId)
    .maybeSingle();

  if (!existing) {
    // Opening the link IS the consent act — join immediately (joined_at set)
    // rather than leaving a pending invite the user has to accept a second
    // time from Alerts. No client-side notifications insert (no INSERT
    // policy — always errors silently); the notify_on_invite trigger already
    // covers this.
    await supabase.from('capsule_members').insert({
      capsule_id: capsuleId,
      user_id: userId,
      role: 'contributor',
      joined_at: new Date().toISOString(),
    });
    cache.invalidate('capsules', 'profile');
  }

  navigateWhenReady(() => {
    (navigationRef as any).navigate('CapsuleDetail', { capsuleId });
  });
}

export function useDeepLinks() {
  useEffect(() => {
    Linking.getInitialURL().then(handleUrl);
    const sub = Linking.addEventListener('url', ({ url }) => handleUrl(url));
    return () => sub.remove();
  }, []);
}
