// Run with: npx tsx src/lib/tombstoneTriggerCascadeDelete.test.ts
// Mirrors the src/lib/recurrence.test.ts precedent (no jest in this repo).
//
// This is a Postgres-behavior regression test, not a pure-function one: the
// bug lives entirely inside supabase/migrations SQL (a trigger + an FK), with
// no JS decision logic to extract. Rather than hand-transcribe the trigger
// into a mock, this spins up a real throwaway Postgres 18 cluster (initdb'd
// under the OS temp dir, torn down at the end — the project DB is never
// touched), loads the ACTUAL SQL text straight out of the migration files
// (not retyped), and exercises it exactly as `delete_capsule_with_storage`
// does: `delete from public.capsules where id = ...` on a capsule that has
// another member row.
//
// Bug: capsule_members.capsule_id is `on delete cascade` to capsules(id)
// (supabase-schema.sql:34). Deleting a capsule cascades into deleting its
// capsule_members rows, which fires the AFTER DELETE trigger
// trg_capsule_member_removal_tombstone (20260802120000_security_authz_fixes.sql:213-216)
// for every cascaded row, including ones belonging to someone other than the
// deleter. That trigger's body (line 204) inserts into
// capsule_member_revocations(capsule_id, ...) — a column that is ITSELF
// `on delete cascade` to capsules(id) (20260802120000:47) with an immediate
// (non-deferrable) FK — and the parent capsules row is already gone from the
// FK-check snapshot mid-cascade, so the insert raises 23503 and rolls back
// the whole DELETE. See supabase/migrations/20260914120000_fix_tombstone_trigger_cascade_delete.sql
// for the full reachability writeup (delete_capsule_with_storage, delete_my_account).
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, readdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const MIGRATIONS_DIR = join(__dirname, '..', '..', 'supabase', 'migrations');

function findPgBinDir(): string {
  const candidates = [
    '', // already on PATH
    '/Library/PostgreSQL/18/bin',
    '/Library/PostgreSQL/17/bin',
    '/Library/PostgreSQL/16/bin',
    '/opt/homebrew/opt/postgresql@18/bin',
    '/opt/homebrew/opt/postgresql@17/bin',
    '/opt/homebrew/opt/postgresql/bin',
    '/usr/local/opt/postgresql/bin',
    '/usr/lib/postgresql/18/bin',
    '/usr/lib/postgresql/16/bin',
  ];
  for (const dir of candidates) {
    try {
      execFileSync(dir ? join(dir, 'initdb') : 'initdb', ['--version'], { stdio: 'pipe' });
      return dir;
    } catch {
      // try next
    }
  }
  throw new Error(
    'No local Postgres install found (initdb not on PATH or in known install dirs). ' +
      'This test needs a real Postgres binary to exercise the actual trigger/FK ' +
      'interaction — see the file header for why a mock would not do.'
  );
}

// Pulls the literal `create or replace function public.capsule_member_removal_tombstone() ... $$;`
// block out of a migration file's text, verbatim — never hand-retyped.
function extractTombstoneFunctionDef(sql: string): string | null {
  const marker = 'create or replace function public.capsule_member_removal_tombstone()';
  const start = sql.indexOf(marker);
  if (start === -1) return null;
  const end = sql.indexOf('$$;', start);
  if (end === -1) throw new Error(`found "${marker}" but no terminating "$$;" after it`);
  return sql.slice(start, end + 3);
}

function extractBlock(sql: string, startMarker: string, endMarker: string): string {
  const start = sql.indexOf(startMarker);
  if (start === -1) throw new Error(`marker not found: ${startMarker}`);
  const end = sql.indexOf(endMarker, start);
  if (end === -1) throw new Error(`end marker not found after start: ${endMarker}`);
  return sql.slice(start, end + endMarker.length);
}

const binDir = findPgBinDir();
function bin(name: string): string {
  return binDir ? join(binDir, name) : name;
}

const dataDir = mkdtempSync(join(tmpdir(), 'capsule-pgtest-data-'));
// Unix socket paths have a ~103 byte OS limit — os.tmpdir() plus a
// descriptive prefix can exceed that, so this one deliberately lives
// directly under /tmp with a short name rather than reusing tmpdir().
const sockDir = mkdtempSync('/tmp/cpgsock-');
const port = '55432';
let dbUp = false;

function pgCtl(...args: string[]) {
  return execFileSync(bin('pg_ctl'), ['-D', dataDir, ...args], { stdio: 'pipe', encoding: 'utf8' });
}

function runSql(sql: string, db = 'capsuletest'): string {
  return execFileSync(
    bin('psql'),
    ['-h', sockDir, '-p', port, '-U', 'postgres', '-d', db, '-v', 'ON_ERROR_STOP=1', '-t', '-A', '-f', '-'],
    { input: sql, encoding: 'utf8', stdio: ['pipe', 'pipe', 'pipe'] }
  );
}

function setUpCluster() {
  execFileSync(bin('initdb'), ['-D', dataDir, '--auth=trust', '--no-locale', '-U', 'postgres'], {
    stdio: 'pipe',
  });
  pgCtl(
    '-o',
    `-c unix_socket_directories=${sockDir} -c listen_addresses='' -c port=${port}`,
    '-w',
    '-l',
    join(dataDir, 'server.log'),
    'start'
  );
  dbUp = true;
  execFileSync(bin('createdb'), ['-h', sockDir, '-p', port, '-U', 'postgres', 'capsuletest'], {
    stdio: 'pipe',
  });
}

function tearDownCluster() {
  if (dbUp) {
    try {
      pgCtl('-m', 'fast', 'stop');
    } catch {
      // best-effort
    }
  }
  rmSync(dataDir, { recursive: true, force: true });
  rmSync(sockDir, { recursive: true, force: true });
}

// Minimal stand-in schema mirroring the real FK shapes this bug depends on:
//   capsule_members.capsule_id -> capsules(id) ON DELETE CASCADE  (supabase-schema.sql:34)
// The capsule_member_revocations table + trigger themselves are loaded
// verbatim from the migration file below, not reproduced here.
const BASE_SCHEMA_SQL = `
create schema auth;
create or replace function auth.uid() returns uuid
language sql stable
as $$
  select nullif(current_setting('app.current_uid', true), '')::uuid
$$;

create table public.users (
  id uuid primary key
);

create table public.capsules (
  id uuid primary key,
  owner_id uuid not null references public.users(id)
);

create table public.capsule_members (
  id uuid primary key,
  capsule_id uuid not null references public.capsules(id) on delete cascade,
  user_id uuid not null references public.users(id)
);
`;

const OWNER = '11111111-1111-1111-1111-111111111111';
const OTHER_MEMBER = '22222222-2222-2222-2222-222222222222';
const CAPSULE = '33333333-3333-3333-3333-333333333333';
const OWNER_MEMBER_ROW = '44444444-4444-4444-4444-444444444444';
const OTHER_MEMBER_ROW = '55555555-5555-5555-5555-555555555555';

// `select set_config(..., false)` is session-scoped, and each runSql() call
// is its own psql process (its own connection) — so the seed and the action
// that depends on auth.uid() must run in the SAME runSql() call, or the
// setting is silently gone by the time the action statement runs.
const SEED_SQL = `
  insert into public.users (id) values ('${OWNER}'), ('${OTHER_MEMBER}');
  insert into public.capsules (id, owner_id) values ('${CAPSULE}', '${OWNER}');
  insert into public.capsule_members (id, capsule_id, user_id) values
    ('${OWNER_MEMBER_ROW}', '${CAPSULE}', '${OWNER}'),
    ('${OTHER_MEMBER_ROW}', '${CAPSULE}', '${OTHER_MEMBER}');
  select set_config('app.current_uid', '${OWNER}', false);
`;

function resetDb() {
  execFileSync(bin('dropdb'), ['-h', sockDir, '-p', port, '-U', 'postgres', 'capsuletest'], {
    stdio: 'pipe',
  });
  execFileSync(bin('createdb'), ['-h', sockDir, '-p', port, '-U', 'postgres', 'capsuletest'], {
    stdio: 'pipe',
  });
  runSql(BASE_SCHEMA_SQL);
}

// Loads the actual `capsule_member_revocations` table + the trigger-wiring
// statement (both defined once, in the migration that introduces them) plus
// every migration's version of the tombstone function body, applied in
// filename (== chronological) order — i.e. replays exactly what production
// migration deploy does, using the real repo files as the source of truth.
function loadTombstoneTriggerFromMigrations() {
  const files = readdirSync(MIGRATIONS_DIR)
    .filter((f) => f.endsWith('.sql'))
    .sort();

  let tableSql: string | null = null;
  let triggerSql: string | null = null;
  const functionDefsInOrder: string[] = [];

  for (const file of files) {
    const text = readFileSync(join(MIGRATIONS_DIR, file), 'utf8');

    if (tableSql === null && text.includes('create table if not exists public.capsule_member_revocations')) {
      tableSql = extractBlock(
        text,
        'create table if not exists public.capsule_member_revocations',
        ');'
      );
      triggerSql = extractBlock(
        text,
        'create trigger trg_capsule_member_removal_tombstone',
        'execute function public.capsule_member_removal_tombstone();'
      );
    }

    const fn = extractTombstoneFunctionDef(text);
    if (fn) functionDefsInOrder.push(fn);
  }

  assert.ok(tableSql, 'capsule_member_revocations table definition not found in any migration');
  assert.ok(triggerSql, 'trg_capsule_member_removal_tombstone trigger creation not found in any migration');
  assert.ok(
    functionDefsInOrder.length > 0,
    'capsule_member_removal_tombstone() function definition not found in any migration'
  );

  runSql(tableSql!);
  for (const fn of functionDefsInOrder) runSql(fn);
  runSql(triggerSql!);
}

try {
  setUpCluster();

  // --- The regression case -------------------------------------------------
  resetDb();
  loadTombstoneTriggerFromMigrations();

  // This is exactly delete_capsule_with_storage's own statement
  // (20260726231008_drop_direct_storage_deletes_from_rpcs.sql:48), called by
  // the owner on a capsule that has another (joined or pending) member.
  assert.doesNotThrow(() => {
    runSql(`${SEED_SQL}\ndelete from public.capsules where id = '${CAPSULE}';`);
  }, 'capsule delete must succeed even when another member row is present — see supabase/migrations/20260914120000_fix_tombstone_trigger_cascade_delete.sql');

  const remainingCapsules = runSql(`select count(*) from public.capsules;`).trim();
  const remainingMembers = runSql(`select count(*) from public.capsule_members;`).trim();
  const remainingRevocations = runSql(`select count(*) from public.capsule_member_revocations;`).trim();
  assert.equal(remainingCapsules, '0', 'capsule row should be gone after delete');
  assert.equal(remainingMembers, '0', 'capsule_members rows should have cascaded');
  assert.equal(
    remainingRevocations,
    '0',
    'no tombstone should be written for a member removed via cascade delete of the capsule itself'
  );

  // --- Control: the actual security feature must still work ----------------
  // A plain owner-initiated removal of one member (ManageMembersScreen's
  // trash icon) — the capsule itself is untouched — must still write a
  // durable tombstone so the removed member can't self-rejoin via QR/deep
  // link. This is what the fix must NOT break.
  resetDb();
  loadTombstoneTriggerFromMigrations();
  runSql(`${SEED_SQL}\ndelete from public.capsule_members where id = '${OTHER_MEMBER_ROW}';`);

  const tombstone = runSql(
    `select capsule_id || ',' || user_id || ',' || revoked_by from public.capsule_member_revocations;`
  ).trim();
  assert.equal(
    tombstone,
    `${CAPSULE},${OTHER_MEMBER},${OWNER}`,
    'a direct (non-cascade) member removal must still tombstone the removed member'
  );

  console.log('tombstoneTriggerCascadeDelete.test.ts: all assertions passed');
} finally {
  tearDownCluster();
}
