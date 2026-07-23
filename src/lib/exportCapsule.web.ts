import { zipSync } from 'fflate';

export type ExportItem = { url: string; filename: string };

export function isExportSupported(): boolean {
  return typeof document !== 'undefined';
}

/** Assemble a zip (store, no compression — media is already compressed). */
export function buildZipBlobParts(files: { name: string; data: Uint8Array }[]): Uint8Array {
  const record: Record<string, [Uint8Array, { level: 0 }]> = {};
  for (const f of files) record[f.name] = [f.data, { level: 0 }];
  return zipSync(record);
}

// Thrown when the caller's shouldCancel() returns true (mirror of the native side).
export const EXPORT_CANCELLED = 'export-cancelled';

export async function exportCapsule(opts: {
  title: string;
  items: ExportItem[];
  onProgress?: (done: number, total: number) => void;
  shouldCancel?: () => boolean;
}): Promise<void> {
  const { title, items, onProgress, shouldCancel } = opts;
  const files: { name: string; data: Uint8Array }[] = [];
  for (let i = 0; i < items.length; i++) {
    if (shouldCancel?.()) throw new Error(EXPORT_CANCELLED);
    const res = await fetch(items[i].url);
    if (!res.ok) throw new Error(`download failed (${res.status})`);
    const buf = new Uint8Array(await res.arrayBuffer());
    files.push({ name: items[i].filename, data: buf });
    onProgress?.(i + 1, items.length);
  }
  if (shouldCancel?.()) throw new Error(EXPORT_CANCELLED);
  const zip = buildZipBlobParts(files);
  // Browser download via an anchor element.
  const blob = new Blob([zip as BlobPart], { type: 'application/zip' });
  const href = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = href;
  a.download = `${sanitize(title)}.zip`;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(href);
}

function sanitize(name: string): string {
  return (name || 'capsule').replace(/[^\w\-. ]+/g, '_').trim() || 'capsule';
}
