import { useEffect } from 'react';
import { Session } from '@supabase/supabase-js';
import { useShareIntentContext } from 'expo-share-intent';
import { navigationRef } from '../lib/navigationRef';
import { shareIntentStash } from '../lib/shareIntentStash';
import { PendingMedia } from '../types/navigation';
import { probeVideoDurationMs } from '../lib/mediaDuration';

function navigateWhenReady(fn: () => void, attemptsLeft = 50) {
  if (navigationRef.isReady()) {
    fn();
    return;
  }
  if (attemptsLeft <= 0) return;
  setTimeout(() => navigateWhenReady(fn, attemptsLeft - 1), 100);
}

type ShareFile = { path?: string; mimeType?: string };

async function filesToMedia(files: ShareFile[] | undefined | null): Promise<PendingMedia[]> {
  if (!files) return [];
  const out: PendingMedia[] = [];
  for (const f of files) {
    if (!f?.path || !f.mimeType) continue;
    if (f.mimeType.startsWith('image/')) {
      out.push({ uri: f.path, mediaType: 'photo', mimeType: f.mimeType });
    } else if (f.mimeType.startsWith('video/')) {
      const durationMs = await probeVideoDurationMs(f.path);
      out.push({ uri: f.path, mediaType: 'video', mimeType: f.mimeType, durationMs });
    }
  }
  return out;
}

export function useShareIntent(session: Session | null) {
  const { hasShareIntent, shareIntent, resetShareIntent } = useShareIntentContext();

  useEffect(() => {
    if (!hasShareIntent) return;
    let cancelled = false;
    (async () => {
      const media = await filesToMedia(shareIntent?.files as ShareFile[] | undefined);
      if (cancelled) return;
      if (media.length === 0) { resetShareIntent(); return; }
      if (session) {
        navigateWhenReady(() => {
          (navigationRef as any).navigate('Preview', { media, source: 'share' });
        });
      } else {
        shareIntentStash.set(media);
      }
      resetShareIntent();
    })();
    return () => { cancelled = true; };
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
