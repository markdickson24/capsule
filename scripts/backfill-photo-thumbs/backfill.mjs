// One-off: give every photo uploaded before upload-time thumbnails existed a
// `media.thumbnail_key`, so the grid stops falling back to the full-size image.
// Resizes locally with macOS `sips`, so it never touches Supabase's render API
// (which bills per distinct origin image — the cost this whole change removes).
//
// Usage (macOS):
//   SUPABASE_URL=https://<ref>.supabase.co SUPABASE_SERVICE_ROLE_KEY=... \
//     node scripts/backfill-photo-thumbs/backfill.mjs [--dry-run] [--limit N]
//
// Safe to re-run: it only picks rows whose thumbnail_key is still null.
// Service role bypasses RLS, so surprise-mode capsules are covered too.

import { createClient } from '@supabase/supabase-js';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, writeFileSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';

const THUMB_PX = 480; // keep in sync with GRID_THUMB_PX in src/lib/thumbSize.ts
const BUCKET = 'capsule-media';

const url = process.env.SUPABASE_URL;
const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!url || !key) {
  console.error('Set SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY.');
  process.exit(1);
}
const dryRun = process.argv.includes('--dry-run');
const limitArg = process.argv.indexOf('--limit');
const limit = limitArg > -1 ? Number(process.argv[limitArg + 1]) : Infinity;

const supabase = createClient(url, key, { auth: { persistSession: false } });
const work = mkdtempSync(join(tmpdir(), 'capsule-thumbs-'));

function sipsDim(file, prop) {
  const out = execFileSync('sips', ['-g', prop, file], { encoding: 'utf8' });
  return Number(out.match(new RegExp(`${prop}: (\\d+)`))?.[1]);
}

async function makeThumb(storageKey) {
  const { data, error } = await supabase.storage.from(BUCKET).download(storageKey);
  if (error) throw new Error(`download: ${error.message}`);
  const src = join(work, 'src');
  const out = join(work, 'thumb.jpg');
  writeFileSync(src, Buffer.from(await data.arrayBuffer()));
  const w = sipsDim(src, 'pixelWidth');
  const h = sipsDim(src, 'pixelHeight');
  const args = ['-s', 'format', 'jpeg', '-s', 'formatOptions', '70'];
  // Short side down to THUMB_PX, never upscale (mirrors thumbResize).
  if (Math.min(w, h) > THUMB_PX) {
    args.push(w <= h ? '--resampleWidth' : '--resampleHeight', String(THUMB_PX));
  }
  execFileSync('sips', [...args, src, '--out', out], { stdio: 'ignore' });
  return readFileSync(out);
}

const { data: rows, error } = await supabase
  .from('media')
  .select('id, capsule_id, storage_key')
  .eq('media_type', 'photo')
  .is('thumbnail_key', null)
  .order('uploaded_at', { ascending: false });
if (error) {
  console.error(error.message);
  process.exit(1);
}

const todo = rows.slice(0, limit);
console.log(`${rows.length} photos without a thumbnail; processing ${todo.length}${dryRun ? ' (dry run)' : ''}.`);

let done = 0;
let failed = 0;
for (const row of todo) {
  try {
    const bytes = await makeThumb(row.storage_key);
    const thumbKey = `${row.capsule_id}/${randomUUID()}_thumb.jpg`;
    if (dryRun) {
      console.log(`would write ${thumbKey} (${Math.round(bytes.length / 1024)} KB)`);
    } else {
      const up = await supabase.storage.from(BUCKET).upload(thumbKey, bytes, { contentType: 'image/jpeg' });
      if (up.error) throw new Error(`upload: ${up.error.message}`);
      // Guarded on still-null so a concurrent run can't overwrite (and orphan) another's thumbnail.
      const { data: updated, error: updErr } = await supabase
        .from('media')
        .update({ thumbnail_key: thumbKey })
        .eq('id', row.id)
        .is('thumbnail_key', null)
        .select('id');
      if (updErr || !updated?.length) {
        await supabase.storage.from(BUCKET).remove([thumbKey]);
        if (updErr) throw new Error(`update: ${updErr.message}`);
        continue;
      }
    }
    done++;
  } catch (e) {
    failed++;
    console.error(`${row.id}: ${e.message}`);
  }
}

rmSync(work, { recursive: true, force: true });
console.log(`done: ${done}, failed: ${failed}`);
