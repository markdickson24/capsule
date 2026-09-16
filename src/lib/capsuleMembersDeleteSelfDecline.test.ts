// Run with: npx tsx src/lib/capsuleMembersDeleteSelfDecline.test.ts
// Same Tier 0 shape as src/lib/capsulesUpdateColumnGrants.test.ts and
// src/lib/tombstoneTriggerCascadeDelete.test.ts: this is a Postgres-behavior
// regression test, not a pure-function one — the bug and its fix both live
// entirely in supabase/migrations SQL (an RLS policy), with no JS decision
// logic to extract. Spins up a real throwaway Postgres 18 cluster, loads the
// ACTUAL SQL text straight out of the migration files (not retyped), and
// exercises it as a client (`authenticated` role) would via PostgREST.
//
// Bug: NotificationsScreen.declineInvite() deletes the invitee's own pending
// capsule_members row to decline an invite. The original
// "capsule_members_delete" policy
// (20260515232500_capture_capsule_rls_and_helpers.sql:91-94) only allowed the
// CAPSULE OWNER to delete rows, so the invitee's delete matched zero rows and
// silently no-opped under RLS (see NotificationsScreen.tsx's client-side fix
// for the other half of this bug — trusting `.select()` instead of `error`
// alone). See
// supabase/migrations/20260915130000_capsule_members_delete_self_decline.sql
// for the fix: extend the DELETE policy so a member can also delete their
// OWN row while it is still pending (joined_at is null).
//
// This test exercises the POLICY side directly (four cases): the invitee CAN
// delete their own pending row; a joined member CANNOT self-remove (that
// stays owner-only, unchanged); an unrelated user CANNOT delete someone
// else's pending row; and the owner can still delete any row (pending or
// joined) — the pre-existing behavior must not regress.
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
      'This test needs a real Postgres binary to exercise the actual RLS ' +
      'interaction — see the file header for why a mock would not do.'
  );
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
// directly under /tmp with a short name rather than reusing tmpdir(). Its
// own port + socket dir prefix (distinct from the other two Tier 0 Postgres
// tests) so `npm run test:lib` can run all three without colliding.
const sockDir = mkdtempSync('/tmp/cpgsock3-');
const port = '55434';
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

// Like runSql, but returns { ok, output } instead of throwing — used for the
// statements whose whole point is to verify they're REJECTED (matches zero
// rows under RLS, which for a DELETE is not itself an error — see the
// assertion helper below).
function tryDeleteAndCount(sql: string, db = 'capsuletest'): { ok: boolean; output: string } {
  try {
    const output = runSql(sql, db);
    return { ok: true, output };
  } catch (e: any) {
    return { ok: false, output: String(e.stderr ?? e.message ?? e) };
  }
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

// Minimal stand-in schema: `auth.uid()` (session-GUC-backed, same idiom as
// the other two Tier 0 RLS/trigger tests), the `authenticated` role, and
// `capsules`/`capsule_members` carrying just the columns this policy reads
// (`owner_id`, `capsule_id`/`user_id`/`joined_at`). Row-visibility SELECT
// policies are included because a DELETE needs SELECT-policy visibility on
// the target row to find it at all — mirroring the real
// "capsule_members_select"/"Members can view capsules..." policies (Postgres
// evaluates USING on the SELECT policy before the DELETE policy's own USING
// clause, so without it every delete below would look like a zero-row no-op
// regardless of the DELETE policy under test). The capsules SELECT policy is
// simplified to owner-only here (same simplification
// capsulesUpdateColumnGrants.test.ts makes) rather than the real
// membership-via-capsule_members version: the real version's capsules policy
// would query capsule_members while capsule_members' own DELETE policy
// queries capsules, and Postgres detects that mutual reference as infinite
// recursion within the one statement being planned. Production avoids this
// with the get_my_capsule_ids() SECURITY DEFINER helper (see CLAUDE.md's
// "Never query capsule_members inside a capsule_members policy"), which
// isn't needed here since general membership visibility isn't what this bug
// is about — the capsule_members_select policy below grants each user
// visibility into their own row directly.
const BASE_SCHEMA_SQL = `
create schema if not exists auth;
create or replace function auth.uid() returns uuid
language sql stable
as $$
  select nullif(current_setting('app.current_uid', true), '')::uuid
$$;
grant usage on schema auth to public;
grant execute on function auth.uid() to public;

do $$
begin
  if not exists (select 1 from pg_roles where rolname = 'authenticated') then
    create role authenticated nologin;
  end if;
end
$$;

create table public.users (
  id uuid primary key
);

create table public.capsules (
  id uuid primary key,
  owner_id uuid not null references public.users(id)
);
alter table public.capsules enable row level security;

create table public.capsule_members (
  id uuid primary key,
  capsule_id uuid not null references public.capsules(id) on delete cascade,
  user_id uuid not null references public.users(id),
  joined_at timestamptz
);
alter table public.capsule_members enable row level security;

grant usage on schema public to authenticated;
grant select, insert, update, delete on public.capsules to authenticated;
grant select, insert, update, delete on public.capsule_members to authenticated;

create policy "Owner can view their capsules"
  on public.capsules for select using ((select auth.uid()) = owner_id);

create policy "capsule_members_select"
  on public.capsule_members for select using (
    capsule_id in (select id from public.capsules where owner_id = (select auth.uid()))
    or user_id = (select auth.uid())
  );
`;

const OWNER = '11111111-1111-1111-1111-111111111111';
const INVITEE = '22222222-2222-2222-2222-222222222222';
const JOINED_MEMBER = '33333333-3333-3333-3333-333333333333';
const STRANGER = '44444444-4444-4444-4444-444444444444';
const CAPSULE = '55555555-5555-5555-5555-555555555555';
const PENDING_ROW = '66666666-6666-6666-6666-666666666666';
const JOINED_ROW = '77777777-7777-7777-7777-777777777777';

// `select set_config(..., false)` and `set role` are both session-scoped, so
// the seed + `set role authenticated` + the action under test must run in
// the SAME runSql()/tryDeleteAndCount() call (one psql process = one
// session), or the settings are gone by the time the action statement runs.
const SEED_SQL = `
  insert into public.users (id) values ('${OWNER}'), ('${INVITEE}'), ('${JOINED_MEMBER}'), ('${STRANGER}');
  insert into public.capsules (id, owner_id) values ('${CAPSULE}', '${OWNER}');
  insert into public.capsule_members (id, capsule_id, user_id, joined_at) values
    ('${PENDING_ROW}', '${CAPSULE}', '${INVITEE}', null),
    ('${JOINED_ROW}', '${CAPSULE}', '${JOINED_MEMBER}', now());
`;

function asUser(uid: string): string {
  return `select set_config('app.current_uid', '${uid}', false);\nset role authenticated;`;
}

function resetDb() {
  execFileSync(bin('dropdb'), ['-h', sockDir, '-p', port, '-U', 'postgres', 'capsuletest'], {
    stdio: 'pipe',
  });
  execFileSync(bin('createdb'), ['-h', sockDir, '-p', port, '-U', 'postgres', 'capsuletest'], {
    stdio: 'pipe',
  });
  runSql(BASE_SCHEMA_SQL);
  runSql(SEED_SQL);
}

function rowCount(id: string): string {
  return runSql(`select count(*) from public.capsule_members where id = '${id}';`).trim();
}

// Loads the actual "capsule_members_delete" policy, verbatim and in filename
// (== chronological) order, straight out of the real migration files — the
// original owner-only version from
// 20260515232500_capture_capsule_rls_and_helpers.sql, then the self-decline
// extension from
// 20260915130000_capsule_members_delete_self_decline.sql if that migration
// exists yet (a later `create policy` of the same name replaces the earlier
// one, matching how `supabase db push` applies migrations in order).
function loadCapsuleMembersDeletePolicyFromMigrations(): { fixMigrationPresent: boolean } {
  const files = readdirSync(MIGRATIONS_DIR)
    .filter((f) => f.endsWith('.sql'))
    .sort();

  // The `create policy "capsule_members_delete"` statement itself (not the
  // `drop policy` line) is the START marker: the base migration groups all
  // four capsule_members `drop policy` statements together above all four
  // `create policy` statements, so anchoring on the drop line would capture
  // the unrelated select/insert/update policies sitting in between it and
  // this one's own create statement. The drop is simple enough (and
  // sufficiently pinned to this exact policy name) to issue literally rather
  // than extract.
  const DROP_SQL = 'drop policy if exists "capsule_members_delete" on public.capsule_members;';
  const CREATE_START = 'create policy "capsule_members_delete" on public.capsule_members';
  const BASE_END =
    'capsule_id in (select id from public.capsules where owner_id = (select auth.uid()))\n  );';
  const FIX_END = 'or (user_id = (select auth.uid()) and joined_at is null)\n  );';

  let baseCreateSql: string | null = null;
  let fixCreateSql: string | null = null;

  for (const file of files) {
    const text = readFileSync(join(MIGRATIONS_DIR, file), 'utf8');
    if (!text.includes(CREATE_START)) continue;
    if (baseCreateSql === null && text.includes(BASE_END)) {
      baseCreateSql = extractBlock(text, CREATE_START, BASE_END);
    }
    if (fixCreateSql === null && text.includes(FIX_END)) {
      fixCreateSql = extractBlock(text, CREATE_START, FIX_END);
    }
  }

  assert.ok(baseCreateSql, '"capsule_members_delete" (original, owner-only) policy not found in any migration');
  runSql(`${DROP_SQL}\n${baseCreateSql}`);

  if (fixCreateSql) runSql(`${DROP_SQL}\n${fixCreateSql}`);
  return { fixMigrationPresent: fixCreateSql !== null };
}

try {
  setUpCluster();
  resetDb();
  const { fixMigrationPresent } = loadCapsuleMembersDeletePolicyFromMigrations();
  console.log(
    `fix migration ${fixMigrationPresent ? 'found' : 'NOT found'} (20260915130000_capsule_members_delete_self_decline.sql)`
  );
  assert.ok(
    fixMigrationPresent,
    'this test targets the self-decline fix — without it, the invitee-can-decline case below would (correctly) fail'
  );

  // --- Case 1: the invitee CAN delete their own PENDING row (the fix) ------
  runSql(`${asUser(INVITEE)}\ndelete from public.capsule_members where id = '${PENDING_ROW}';`);
  assert.equal(rowCount(PENDING_ROW), '0', 'invitee must be able to delete their own pending invite row');

  // --- Case 2: a JOINED member CANNOT self-remove (unchanged, owner-only) --
  resetDb();
  loadCapsuleMembersDeletePolicyFromMigrations();
  runSql(`${asUser(JOINED_MEMBER)}\ndelete from public.capsule_members where id = '${JOINED_ROW}';`);
  assert.equal(
    rowCount(JOINED_ROW),
    '1',
    'a JOINED member must NOT be able to delete their own row — self-removal after joining stays owner-only ' +
      '(matches ManageMembersScreen semantics); the fix must be scoped to joined_at IS NULL only'
  );

  // --- Case 3: an unrelated STRANGER cannot delete someone else's pending --
  resetDb();
  loadCapsuleMembersDeletePolicyFromMigrations();
  const strangerAttempt = tryDeleteAndCount(
    `${asUser(STRANGER)}\ndelete from public.capsule_members where id = '${PENDING_ROW}';`
  );
  // A stranger has no SELECT-policy visibility into this row at all, so the
  // delete matches zero rows without even reaching the DELETE policy's own
  // USING clause — either outcome (silently affects 0 rows, or an error) is
  // an acceptable "did nothing"; only the row surviving is a failure.
  void strangerAttempt;
  assert.equal(rowCount(PENDING_ROW), '1', 'an unrelated user must NOT be able to delete someone else\'s pending row');

  // --- Case 4: the OWNER can still delete ANY row (pending or joined) ------
  resetDb();
  loadCapsuleMembersDeletePolicyFromMigrations();
  runSql(
    `${asUser(OWNER)}\ndelete from public.capsule_members where id in ('${PENDING_ROW}', '${JOINED_ROW}');`
  );
  assert.equal(rowCount(PENDING_ROW), '0', 'owner must still be able to delete a pending member row (invite removal)');
  assert.equal(rowCount(JOINED_ROW), '0', 'owner must still be able to delete a joined member row (ManageMembers remove)');

  console.log('capsuleMembersDeleteSelfDecline.test.ts: all assertions passed');
} finally {
  tearDownCluster();
}
