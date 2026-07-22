import { Platform, NativeModules, TurboModuleRegistry } from 'react-native';
import * as FileSystem from 'expo-file-system/legacy';
import * as Sharing from 'expo-sharing';

export type ExportItem = { url: string; filename: string };

// react-native-zip-archive is a native module — absent in Expo Go / on web.
// require() alone does NOT prove it's linked: the JS wrapper resolves the native
// module lazily (TurboModuleRegistry/NativeModules) at call time, so a bare
// require succeeds even when unlinked. Probe the native module eagerly, mirroring
// the library's own resolution order, so isExportSupported() is truthful (same
// intent as the eager-probe pattern in modules/expo-dual-camera/index.ts).
function nativeZipLinked(): boolean {
  try {
    if (TurboModuleRegistry?.get?.('RNZipArchive') != null) return true;
    if ((NativeModules as any)?.RNZipArchive != null) return true;
  } catch {}
  return false;
}

let zipFolder: ((source: string, target: string) => Promise<string>) | null = null;
try {
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  zipFolder = require('react-native-zip-archive').zip;
} catch {
  zipFolder = null;
}

export function isExportSupported(): boolean {
  return Platform.OS !== 'web' && zipFolder !== null && nativeZipLinked();
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
    if (!(await Sharing.isAvailableAsync())) {
      throw new Error('Sharing is not available on this device.');
    }
    await Sharing.shareAsync(target, { mimeType: 'application/zip', dialogTitle: `Export ${title}` });
  } finally {
    // Best-effort cleanup of the working dir.
    FileSystem.deleteAsync(work, { idempotent: true }).catch(() => {});
  }
}
