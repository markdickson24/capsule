import { useEffect } from 'react';
import { Session } from '@supabase/supabase-js';
import { useShareIntentContext } from 'expo-share-intent';
import { navigationRef } from '../lib/navigationRef';
import { shareIntentStash } from '../lib/shareIntentStash';
import { PendingMedia } from '../types/navigation';

function navigateWhenReady(fn: () => void, attemptsLeft = 50) {
  if (navigationRef.isReady()) {
    fn();
    return;
  }
  if (attemptsLeft <= 0) return;
  setTimeout(() => navigateWhenReady(fn, attemptsLeft - 1), 100);
}

type ShareFile = { path?: string; mimeType?: string };

function filesToMedia(files: ShareFile[] | undefined | null): PendingMedia[] {
  if (!files) return [];
  return files.reduce<PendingMedia[]>((acc, f) => {
    if (!f?.path || !f.mimeType) return acc;
    if (f.mimeType.startsWith('image/')) acc.push({ uri: f.path, mediaType: 'photo' });
    else if (f.mimeType.startsWith('video/')) acc.push({ uri: f.path, mediaType: 'video' });
    return acc;
  }, []);
}

export function useShareIntent(session: Session | null) {
  const { hasShareIntent, shareIntent, resetShareIntent } = useShareIntentContext();

  useEffect(() => {
    if (!hasShareIntent) return;
    const media = filesToMedia(shareIntent?.files as ShareFile[] | undefined);
    if (media.length === 0) {
      resetShareIntent();
      return;
    }
    if (session) {
      navigateWhenReady(() => {
        (navigationRef as any).navigate('Preview', { media, source: 'share' });
      });
    } else {
      shareIntentStash.set(media);
    }
    resetShareIntent();
  }, [hasShareIntent, shareIntent, session, resetShareIntent]);

  useEffect(() => {
    if (!session) return;
    if (!shareIntentStash.get()?.length) return;
    // Clear INSIDE the callback, not before it: navigateWhenReady gives up
    // silently if the navigator never becomes ready, and clearing up front
    // would lose the media with no way to retry. The re-read + clear inside
    // also makes a double-fired effect idempotent (second run sees null).
    navigateWhenReady(() => {
      const stashed = shareIntentStash.get();
      if (!stashed || stashed.length === 0) return;
      shareIntentStash.clear();
      (navigationRef as any).navigate('Preview', { media: stashed, source: 'share' });
    });
  }, [session]);
}
