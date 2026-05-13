import { useEffect } from 'react';
import { Linking } from 'react-native';
import { supabase } from '../lib/supabase';
import { navigationRef } from '../lib/navigationRef';

function navigateWhenReady(fn: () => void) {
  if (navigationRef.isReady()) {
    fn();
  } else {
    setTimeout(() => navigateWhenReady(fn), 100);
  }
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
    navigateWhenReady(() => {
      (navigationRef as any).navigate('ResetPassword');
    });
    return;
  }

  const match = url.match(/capsule:\/\/join\/([a-zA-Z0-9-]+)/);
  if (!match) return;
  const capsuleId = match[1];

  const { data: { session } } = await supabase.auth.getSession();
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
    await supabase.from('capsule_members').insert({
      capsule_id: capsuleId,
      user_id: userId,
      role: 'contributor',
    });
    await supabase.from('notifications').insert({
      user_id: userId,
      capsule_id: capsuleId,
      type: 'invite',
    });
  }

  navigateWhenReady(() => {
    (navigationRef as any).navigate('Tabs', { screen: 'Notifications' });
  });
}

export function useDeepLinks() {
  useEffect(() => {
    Linking.getInitialURL().then(handleUrl);
    const sub = Linking.addEventListener('url', ({ url }) => handleUrl(url));
    return () => sub.remove();
  }, []);
}
