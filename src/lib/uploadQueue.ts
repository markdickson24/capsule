import { Platform } from 'react-native';
import * as FileSystem from 'expo-file-system/legacy';
import * as VideoThumbnails from 'expo-video-thumbnails';
import { supabase, getFreshAccessToken } from './supabase';
import { sessionStore } from './sessionStore';
import { randomUUID } from './uuid';
import { cache } from './cache';
import { toast } from './toast';
import { resizeForUpload } from './imageResize';

// Background media-upload queue. The optimistic-UI backbone: callers enqueue
// and navigate away immediately; screens render pending tasks as local-URI
// tiles (via useUploadTasks) while a single sequential worker uploads in the
// background. Failures stay in the list as retryable tiles — success removes
// the task and invalidates the capsule's media caches so the next fetch picks
// up the real row. A batch-completion toast fires when the queue drains
// (ToastHost is global, so it reaches the user wherever they navigated to).

export type UploadTask = {
  id: string;
  capsuleId: string;
  uri: string;
  mediaType: 'photo' | 'video';
  altUri?: string;
  caption?: string;
  mimeType: string;
  status: 'uploading' | 'failed';
};

export type UploadEntry = {
  capsuleId: string;
  uri: string;
  mediaType: 'photo' | 'video';
  altUri?: string;
  caption?: string;
  mimeType?: string;
};

let tasks: UploadTask[] = [];
let working = false;
// Counters for the drain toast; reset each time the queue goes idle→active.
let batchAdded = 0;
let batchFailed = 0;
// Dedup for multi-capsule fan-out (same local file enqueued for N capsules,
// e.g. PreviewScreen's multi-select "Add to Capsule"): keyed by the SOURCE
// local uri, so the real upload only happens once per unique file per batch;
// every later occurrence is a bucket-side storage.copy() instead of
// re-uploading the same bytes. Three separate maps (main photo/video, dual
// alt, video thumbnail) since each is a distinct derived object per source
// uri. Cleared when the queue fully drains (see work()) so a later,
// unrelated batch doesn't copy from a stale/unrelated key.
type CachedUpload = { key: string; size: number; ext: string };
const mainUploadCache = new Map<string, CachedUpload>();
const altUploadCache = new Map<string, CachedUpload>();
const thumbUploadCache = new Map<string, CachedUpload>();
// Per-capsule done/total since that capsule's queue was last empty — drives
// the aggregate progress bar on CapsuleDetail. Cleared when the capsule's
// last task leaves the queue.
const progressByCapsule: Record<string, { done: number; total: number }> = {};

function clearProgressIfDrained(capsuleId: string) {
  if (!tasks.some(t => t.capsuleId === capsuleId)) {
    delete progressByCapsule[capsuleId];
  }
}

const listeners = new Set<() => void>();

function notify() {
  for (const fn of listeners) fn();
}

async function uploadFile(storageKey: string, uri: string, mimeType: string): Promise<number> {
  if (Platform.OS === 'web') {
    const response = await fetch(uri);
    const arrayBuffer = await response.arrayBuffer();
    const { error } = await supabase.storage
      .from('capsule-media')
      .upload(storageKey, arrayBuffer, { contentType: mimeType });
    if (error) throw new Error(error.message);
    return arrayBuffer.byteLength;
  }
  const fileInfo = await FileSystem.getInfoAsync(uri);
  const accessToken = await getFreshAccessToken();
  const result = await FileSystem.uploadAsync(
    `${process.env.EXPO_PUBLIC_SUPABASE_URL}/storage/v1/object/capsule-media/${storageKey}`,
    uri,
    {
      httpMethod: 'POST',
      uploadType: FileSystem.FileSystemUploadType.BINARY_CONTENT,
      headers: {
        Authorization: `Bearer ${accessToken}`,
        apikey: process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY!,
        'Content-Type': mimeType,
      },
    }
  );
  if (result.status < 200 || result.status >= 300) {
    throw new Error(`Storage ${result.status}`);
  }
  return fileInfo.exists ? (fileInfo as any).size ?? 0 : 0;
}

// Library/share-intent photos otherwise upload at full device resolution —
// 5-10x the bytes of the in-app camera path for no visual gain at display
// size. Resize output is always JPEG when it actually runs (ImageManipulator's
// default save format), so the mimeType is bumped alongside the uri; if the
// photo is already small enough, resizeForUpload is a no-op and the original
// mimeType is kept. Video is left untouched (out of scope here).
async function prepareForUpload(
  uri: string, mediaType: 'photo' | 'video', mimeType: string
): Promise<{ uri: string; mimeType: string }> {
  if (mediaType !== 'photo') return { uri, mimeType };
  const resizedUri = await resizeForUpload(uri);
  if (resizedUri === uri) return { uri, mimeType };
  return { uri: resizedUri, mimeType: 'image/jpeg' };
}

// Multi-capsule fan-out shortcut: if `sourceUri` was already uploaded once in
// this batch (tracked in `cacheMap`), duplicate the existing storage object
// with a bucket-side copy — zero device bytes — instead of re-running
// `produce()` (resize + real upload) again. The storage INSERT RLS policy
// validates the destination path's own capsule membership, so a copy is
// permitted for exactly the capsules the caller could upload to directly.
async function copyOrUpload(
  cacheMap: Map<string, CachedUpload>,
  sourceUri: string,
  capsuleId: string,
  produce: () => Promise<{ uri: string; mimeType: string }>,
): Promise<CachedUpload> {
  const cached = cacheMap.get(sourceUri);
  if (cached) {
    const key = `${capsuleId}/${randomUUID()}.${cached.ext}`;
    const { error } = await supabase.storage.from('capsule-media').copy(cached.key, key);
    if (error) throw new Error(error.message);
    return { key, size: cached.size, ext: cached.ext };
  }
  const prepared = await produce();
  const ext = prepared.mimeType.split('/').pop()?.replace('jpeg', 'jpg') ?? 'jpg';
  const key = `${capsuleId}/${randomUUID()}.${ext}`;
  const size = await uploadFile(key, prepared.uri, prepared.mimeType);
  const entry: CachedUpload = { key, size, ext };
  cacheMap.set(sourceUri, entry);
  return entry;
}

async function runTask(task: UploadTask): Promise<void> {
  const session = sessionStore.get();
  if (!session) throw new Error('Not signed in');

  const wantsAlt = !!task.altUri && task.mediaType === 'photo';

  // Main + alt run concurrently — on a cache miss for both, this halves wall
  // time for swappable dual photos; on a cache hit, copies are cheap enough
  // that concurrency costs nothing either way.
  const [main, altEntry] = await Promise.all([
    copyOrUpload(mainUploadCache, task.uri, task.capsuleId, () =>
      prepareForUpload(task.uri, task.mediaType, task.mimeType)
    ),
    wantsAlt
      ? copyOrUpload(altUploadCache, task.altUri!, task.capsuleId, () =>
          prepareForUpload(task.altUri!, 'photo', 'image/jpeg')
        ).catch(() => null) // best-effort: keep the main photo if the alt fails
      : Promise.resolve(null),
  ]);

  const storageKey = main.key;
  const sizeBytes = main.size;
  const altStorageKey = altEntry?.key ?? null;

  // Video thumbnail generated from the LOCAL file (no network) so every
  // member's device doesn't have to download+decode the remote video just to
  // draw a grid cell. Native only — VideoThumbnails has no web implementation.
  // Best-effort: a failure here just means this row falls back to the
  // client-side on-device generation in fetchPhotos, same as pre-existing rows.
  let thumbnailKey: string | null = null;
  if (task.mediaType === 'video' && Platform.OS !== 'web') {
    try {
      const thumbEntry = await copyOrUpload(thumbUploadCache, task.uri, task.capsuleId, async () => {
        const { uri: thumbUri } = await VideoThumbnails.getThumbnailAsync(task.uri, { time: 0 });
        return { uri: thumbUri, mimeType: 'image/jpeg' };
      });
      thumbnailKey = thumbEntry.key;
    } catch {
      thumbnailKey = null;
    }
  }

  const { error } = await supabase.from('media').insert({
    capsule_id: task.capsuleId,
    uploader_id: session.user.id,
    storage_key: storageKey,
    alt_storage_key: altStorageKey,
    thumbnail_key: thumbnailKey,
    media_type: task.mediaType,
    size_bytes: sizeBytes,
    caption: task.caption?.trim() || null,
  });
  if (error) throw new Error(error.message);
}

async function work() {
  if (working) return;
  working = true;

  // eslint-disable-next-line no-constant-condition
  while (true) {
    const task = tasks.find(t => t.status === 'uploading');
    if (!task) break;

    try {
      await runTask(task);
      tasks = tasks.filter(t => t.id !== task.id);
      batchAdded += 1;
      const p = progressByCapsule[task.capsuleId];
      if (p) p.done += 1;
      clearProgressIfDrained(task.capsuleId);
      // Both caches together (see CLAUDE.md): invalidating only the signed
      // URLs while media:${id} still caches the old row list isn't enough.
      cache.invalidate(
        'capsules',
        `capsule:${task.capsuleId}`,
        `media:${task.capsuleId}`,
        `signedUrls:${task.capsuleId}`,
      );
    } catch {
      tasks = tasks.map(t => t.id === task.id ? { ...t, status: 'failed' as const } : t);
      batchFailed += 1;
    }
    notify();
  }

  working = false;

  // Queue drained (failed tiles may remain — they're visible and retryable).
  if (batchAdded > 0) {
    const noun = batchAdded === 1 ? 'item' : 'items';
    toast.show(
      batchFailed > 0
        ? `${batchAdded} ${noun} added · ${batchFailed} failed`
        : `${batchAdded} ${noun} added`
    );
  } else if (batchFailed > 0) {
    toast.show(`Upload failed — tap the item to retry`);
  }
  batchAdded = 0;
  batchFailed = 0;
  // Drop the dedup caches now that the batch is fully done — a later,
  // unrelated upload shouldn't copy from a stale key.
  mainUploadCache.clear();
  altUploadCache.clear();
  thumbUploadCache.clear();
}

export const uploadQueue = {
  /** Add uploads and start the worker. Returns immediately — this is the point. */
  enqueue(entries: UploadEntry[]) {
    if (entries.length === 0) return;
    const next: UploadTask[] = entries.map(e => ({
      id: randomUUID(),
      capsuleId: e.capsuleId,
      uri: e.uri,
      mediaType: e.mediaType,
      altUri: e.altUri,
      caption: e.caption,
      mimeType: e.mimeType ?? (e.mediaType === 'video' ? 'video/mp4' : 'image/jpeg'),
      status: 'uploading',
    }));
    tasks = [...tasks, ...next];
    for (const t of next) {
      const p = (progressByCapsule[t.capsuleId] ??= { done: 0, total: 0 });
      p.total += 1;
    }
    notify();
    work();
  },

  retry(taskId: string) {
    const task = tasks.find(t => t.id === taskId);
    if (!task || task.status !== 'failed') return;
    batchFailed = Math.max(0, batchFailed - 1);
    tasks = tasks.map(t => t.id === taskId ? { ...t, status: 'uploading' as const } : t);
    notify();
    work();
  },

  /** Roll a failed upload back — drop the tile, nothing was persisted. */
  dismiss(taskId: string) {
    const task = tasks.find(t => t.id === taskId);
    tasks = tasks.filter(t => t.id !== taskId);
    if (task) {
      const p = progressByCapsule[task.capsuleId];
      if (p) p.total = Math.max(0, p.total - 1);
      clearProgressIfDrained(task.capsuleId);
    }
    notify();
  },

  getTasks(capsuleId?: string): UploadTask[] {
    return capsuleId ? tasks.filter(t => t.capsuleId === capsuleId) : tasks;
  },

  getProgress(capsuleId: string): { done: number; total: number } {
    return progressByCapsule[capsuleId] ?? { done: 0, total: 0 };
  },

  subscribe(fn: () => void): () => void {
    listeners.add(fn);
    return () => { listeners.delete(fn); };
  },
};
