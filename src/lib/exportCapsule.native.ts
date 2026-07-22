import { Platform } from 'react-native';
import * as FileSystem from 'expo-file-system/legacy';
import * as Sharing from 'expo-sharing';

export type ExportItem = { url: string; filename: string };

// react-native-zip-archive is a native module — absent in Expo Go / on web.
// Guard the require so those environments degrade instead of crashing.
let zipFolder: ((source: string, target: string) => Promise<string>) | null = null;
try {
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  zipFolder = require('react-native-zip-archive').zip;
} catch {
  zipFolder = null;
}

export function isExportSupported(): boolean {
  return Platform.OS !== 'web' && zipFolder !== null;
}

// Exported for signature-parity with the web module; unused on native (the web
// test covers the zip round-trip). Kept so callers can import from either side.
export function buildZipBlobParts(_files: { name: string; data: Uint8Array }[]): Uint8Array {
  throw new Error('buildZipBlobParts is web-only');
}

export async function exportCapsule(opts: {
  title: string;
  items: ExportItem[];
  onProgress?: (done: number, total: number) => void;
}): Promise<void> {
  const { title, items, onProgress } = opts;
  if (!zipFolder) throw new Error('Export needs a full build (unavailable here).');

  // Stream each remote file to a temp working dir on disk (never through the JS
  // bridge as one giant buffer — safe for large capsules), then zip the dir.
  const work = `${FileSystem.cacheDirectory}export-${Date.now()}/`;
  await FileSystem.makeDirectoryAsync(work, { intermediates: true });
  try {
    for (let i = 0; i < items.length; i++) {
      const dest = `${work}${items[i].filename}`;
      const { status } = await FileSystem.downloadAsync(items[i].url, dest);
      if (status !== 200) throw new Error(`download failed (${status})`);
      onProgress?.(i + 1, items.length);
    }
    const safe = (title || 'capsule').replace(/[^\w\-. ]+/g, '_').trim() || 'capsule';
    const target = `${FileSystem.cacheDirectory}${safe}.zip`;
    await zipFolder(work, target);
    if (await Sharing.isAvailableAsync()) {
      await Sharing.shareAsync(target, { mimeType: 'application/zip', dialogTitle: `Export ${title}` });
    }
  } finally {
    // Best-effort cleanup of the working dir.
    FileSystem.deleteAsync(work, { idempotent: true }).catch(() => {});
  }
}
