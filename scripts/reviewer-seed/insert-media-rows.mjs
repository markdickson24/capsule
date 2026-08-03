#!/usr/bin/env node
/**
 * Inserts the `media` rows for the photos uploaded by upload-media.mjs.
 *
 * Runs as the reviewer user against PostgREST, so every row goes in through the
 * real `media` INSERT policy. That policy pins uploader_id to the caller, so all
 * rows land attributed to the reviewer; seed.sql then spreads uploader_id across
 * the demo members afterwards (as postgres, which the column grants allow).
 *
 * Usage: node scripts/reviewer-seed/insert-media-rows.mjs --env <.env> --manifest <manifest.json>
 */

import { readFileSync } from 'node:fs';

// Captions per capsule, positional. null = no caption, which is the common case
// for real uploads — a fully captioned grid looks staged.
const CAPTIONS = {
  'facade01-c000-4000-8000-000000000001': [
    'Made it.', 'Water was freezing.', null, null, 'Sunrise hike, worth it.',
    null, null, 'Best meal of the trip.', null, null,
    null, 'He fell in. Twice.', null, null, 'Last night at the fire.',
    null, null, null, null, 'Already planning next year.',
  ],
  'facade01-c000-4000-8000-000000000002': [
    'Golden hour.', null, null, 'Someone brought a disco ball.', null, null,
  ],
  'facade01-c000-4000-8000-000000000003': [
    null, 'The first look.', null, null, null, 'Cake situation.', null, null,
  ],
};

// How far back each capsule's uploads are spread, in days.
const SPREAD_DAYS = {
  'facade01-c000-4000-8000-000000000001': { startDaysAgo: 33, spanDays: 5 },
  'facade01-c000-4000-8000-000000000002': { startDaysAgo: 5, spanDays: 4 },
  'facade01-c000-4000-8000-000000000003': { startDaysAgo: 9, spanDays: 7 },
};

function parseArgs() {
  const args = process.argv.slice(2);
  const get = (f) => {
    const i = args.indexOf(f);
    return i === -1 ? null : args[i + 1];
  };
  return { envPath: get('--env'), manifestPath: get('--manifest') };
}

function loadEnv(envPath) {
  const env = {};
  for (const line of readFileSync(envPath, 'utf8').split('\n')) {
    const m = line.match(/^([A-Z0-9_]+)=(.*)$/);
    if (m) env[m[1]] = m[2].trim();
  }
  const url = env.EXPO_PUBLIC_SUPABASE_URL;
  const anonKey = env.EXPO_PUBLIC_SUPABASE_ANON_KEY;

  // Reviewer credentials are NOT read from the seed .env file — they must never be
  // committed to source. Set them in your shell (or a local, gitignored env) before
  // running this script:
  //   REVIEWER_EMAIL=appreview@getcapsuleapp.com REVIEWER_PASSWORD=... node insert-media-rows.mjs --env .env --manifest manifest.json
  const reviewerEmail = process.env.REVIEWER_EMAIL;
  const reviewerPassword = process.env.REVIEWER_PASSWORD;
  if (!reviewerEmail || !reviewerPassword) {
    throw new Error(
      'REVIEWER_EMAIL and REVIEWER_PASSWORD must be set in the environment (not in a committed file). ' +
        'The credential lives in the password manager / App Store Connect review notes — see docs/REVIEWER_ACCOUNT.md.'
    );
  }
  return { url, anonKey, reviewerEmail, reviewerPassword };
}

async function signIn({ url, anonKey, reviewerEmail, reviewerPassword }) {
  const res = await fetch(`${url}/auth/v1/token?grant_type=password`, {
    method: 'POST',
    headers: { apikey: anonKey, 'Content-Type': 'application/json' },
    body: JSON.stringify({ email: reviewerEmail, password: reviewerPassword }),
  });
  const body = await res.json();
  if (!body.access_token) throw new Error(`sign-in failed: ${JSON.stringify(body)}`);
  return { token: body.access_token, userId: body.user.id };
}

async function main() {
  const { envPath, manifestPath } = parseArgs();
  if (!envPath || !manifestPath) throw new Error('--env and --manifest are required');

  const cfg = loadEnv(envPath);
  const { token, userId } = await signIn(cfg);
  const manifest = JSON.parse(readFileSync(manifestPath, 'utf8'));

  const perCapsuleIndex = {};
  const rows = manifest.map((entry) => {
    const i = (perCapsuleIndex[entry.capsuleId] ??= 0);
    perCapsuleIndex[entry.capsuleId]++;

    const { startDaysAgo, spanDays } = SPREAD_DAYS[entry.capsuleId];
    const total = CAPTIONS[entry.capsuleId].length;
    const startMs = Date.now() - startDaysAgo * 86400_000;
    const uploadedAt = new Date(startMs + (i / total) * spanDays * 86400_000);

    return {
      capsule_id: entry.capsuleId,
      uploader_id: userId,
      storage_key: entry.storageKey,
      media_type: 'photo',
      size_bytes: entry.sizeBytes,
      caption: CAPTIONS[entry.capsuleId][i] ?? null,
      uploaded_at: uploadedAt.toISOString(),
    };
  });

  const res = await fetch(`${cfg.url}/rest/v1/media`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${token}`,
      apikey: cfg.anonKey,
      'Content-Type': 'application/json',
      Prefer: 'return=minimal',
    },
    body: JSON.stringify(rows),
  });
  if (!res.ok) throw new Error(`media insert failed (${res.status}): ${await res.text()}`);

  console.error(`inserted ${rows.length} media rows`);
}

main().catch((err) => {
  console.error(err.message);
  process.exit(1);
});
