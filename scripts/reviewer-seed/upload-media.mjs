#!/usr/bin/env node
/**
 * Uploads demo photos into the App Store reviewer account's capsules.
 *
 * Runs as the reviewer user (real password login, anon key) so every upload goes
 * through the same RLS-governed storage path a real device uses — no service-role
 * key is needed or wanted here.
 *
 * Photos come from Lorem Picsum (https://picsum.photos), which serves Unsplash
 * images under the Unsplash license. Requested at 1440x1920 so they arrive already
 * within the app's 1920px upload cap and need no local resize.
 *
 * Emits a JSON manifest on stdout ({ capsuleId, storageKey, sizeBytes } per file).
 * The matching `media` rows are inserted by seed.sql, which spreads uploader_id
 * across the demo members — something this script can't do, since the media INSERT
 * policy pins uploader_id to the authenticated caller.
 *
 * Usage: node scripts/reviewer-seed/upload-media.mjs --env /path/to/.env [--out manifest.json]
 */

import { randomUUID } from 'node:crypto';
import { readFileSync, writeFileSync } from 'node:fs';

const REVIEWER_EMAIL = 'appreview@getcapsuleapp.com';
const REVIEWER_PASSWORD = 'CapsuleReview2026!';

// capsuleId -> { count, seedPrefix }. seedPrefix keeps picsum deterministic, so a
// re-run of this script fetches the same images rather than a fresh random set.
const PLAN = [
  { capsuleId: 'facade01-c000-4000-8000-000000000001', count: 20, seedPrefix: 'tahoe' },
  { capsuleId: 'facade01-c000-4000-8000-000000000002', count: 6, seedPrefix: 'rooftop' },
  { capsuleId: 'facade01-c000-4000-8000-000000000003', count: 8, seedPrefix: 'wedding' },
];

function parseArgs() {
  const args = process.argv.slice(2);
  const get = (flag) => {
    const i = args.indexOf(flag);
    return i === -1 ? null : args[i + 1];
  };
  return { envPath: get('--env'), outPath: get('--out') };
}

function loadEnv(envPath) {
  const text = readFileSync(envPath, 'utf8');
  const env = {};
  for (const line of text.split('\n')) {
    const m = line.match(/^([A-Z0-9_]+)=(.*)$/);
    if (m) env[m[1]] = m[2].trim();
  }
  const url = env.EXPO_PUBLIC_SUPABASE_URL;
  const anonKey = env.EXPO_PUBLIC_SUPABASE_ANON_KEY;
  if (!url || !anonKey) throw new Error(`missing Supabase url/anon key in ${envPath}`);
  return { url, anonKey };
}

async function signIn({ url, anonKey }) {
  const res = await fetch(`${url}/auth/v1/token?grant_type=password`, {
    method: 'POST',
    headers: { apikey: anonKey, 'Content-Type': 'application/json' },
    body: JSON.stringify({ email: REVIEWER_EMAIL, password: REVIEWER_PASSWORD }),
  });
  const body = await res.json();
  if (!res.ok || !body.access_token) {
    throw new Error(`sign-in failed (${res.status}): ${JSON.stringify(body)}`);
  }
  return body.access_token;
}

async function fetchPhoto(seed) {
  // Deterministic per-seed image, portrait, already under the 1920px cap.
  const res = await fetch(`https://picsum.photos/seed/${seed}/1440/1920`, { redirect: 'follow' });
  if (!res.ok) throw new Error(`picsum ${seed} failed: ${res.status}`);
  const buf = Buffer.from(await res.arrayBuffer());
  if (buf.length < 1024) throw new Error(`picsum ${seed} returned ${buf.length} bytes`);
  return buf;
}

async function upload({ url, anonKey, token }, capsuleId, bytes) {
  const storageKey = `${capsuleId}/${randomUUID()}.jpg`;
  const res = await fetch(`${url}/storage/v1/object/capsule-media/${storageKey}`, {
    method: 'POST',
    headers: {
      // Raw REST uploads need BOTH headers — the JS client adds them for you.
      Authorization: `Bearer ${token}`,
      apikey: anonKey,
      'Content-Type': 'image/jpeg',
    },
    body: bytes,
  });
  if (!res.ok) {
    throw new Error(`storage upload ${storageKey} failed (${res.status}): ${await res.text()}`);
  }
  return { capsuleId, storageKey, sizeBytes: bytes.length };
}

async function main() {
  const { envPath, outPath } = parseArgs();
  if (!envPath) throw new Error('--env <path to .env> is required');

  const cfg = loadEnv(envPath);
  const token = await signIn(cfg);
  console.error(`signed in as ${REVIEWER_EMAIL}`);

  const manifest = [];
  for (const { capsuleId, count, seedPrefix } of PLAN) {
    for (let i = 0; i < count; i++) {
      const bytes = await fetchPhoto(`${seedPrefix}-${i}`);
      const entry = await upload({ ...cfg, token }, capsuleId, bytes);
      manifest.push(entry);
      console.error(`  ${seedPrefix}-${i} -> ${entry.storageKey} (${entry.sizeBytes} bytes)`);
    }
  }

  const json = JSON.stringify(manifest, null, 2);
  if (outPath) writeFileSync(outPath, json);
  else console.log(json);
  console.error(`uploaded ${manifest.length} photos`);
}

main().catch((err) => {
  console.error(err.message);
  process.exit(1);
});
