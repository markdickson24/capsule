import { Platform } from 'react-native';
import * as FileSystem from 'expo-file-system/legacy';
import { supabase, getFreshAccessToken } from './supabase';
import { sessionStore } from './sessionStore';
import { randomUUID } from './uuid';
import { cache } from './cache';
import { toast } from './toast';

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

async function runTask(task: UploadTask): Promise<void> {
  const session = sessionStore.get();
  if (!session) throw new Error('Not signed in');

  const ext = task.mimeType.split('/').pop()?.replace('jpeg', 'jpg') ?? 'jpg';
  const storageKey = `${task.capsuleId}/${randomUUID()}.${ext}`;
  const sizeBytes = await uploadFile(storageKey, task.uri, task.mimeType);

  // Dual (PiP) swap variant — best-effort: if it fails, keep the main photo.
  let altStorageKey: string | null = null;
  if (task.altUri && task.mediaType === 'photo') {
    const key = `${task.capsuleId}/${randomUUID()}.jpg`;
    try {
      await uploadFile(key, task.altUri, 'image/jpeg');
      altStorageKey = key;
    } catch {
      altStorageKey = null;
    }
  }

  const { error } = await supabase.from('media').insert({
    capsule_id: task.capsuleId,
    uploader_id: session.user.id,
    storage_key: storageKey,
    alt_storage_key: altStorageKey,
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
