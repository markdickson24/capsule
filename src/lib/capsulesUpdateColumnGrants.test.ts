// Run with: npx tsx src/lib/capsulesUpdateColumnGrants.test.ts
// Same Tier 0 shape as src/lib/tombstoneTriggerCascadeDelete.test.ts: this is
// a Postgres-behavior regression test, not a pure-function one — the bug
// lives entirely in supabase/migrations SQL (an RLS policy + table
// privileges), with no JS decision logic to extract. Spins up a real
// throwaway Postgres 18 cluster, loads the ACTUAL SQL text straight out of
// the migration files (not retyped), and exercises it as a client
// (`authenticated` role) would via PostgREST.
//
// Bug: "Owners can update their capsules"
// (supabase/migrations/20260515232500_capture_capsule_rls_and_helpers.sql:61-63,
// `for update using ((select auth.uid()) = owner_id)`) has no explicit WITH
// CHECK. Postgres reuses the USING expression as the implicit WITH CHECK for
// an UPDATE policy that defines none of its own, so only `owner_id` is
// constrained post-write — every other column, including `group_id` and
// `status`, is unconstrained. Combined with Supabase's default table-wide
// UPDATE grant to `authenticated`, an owner can UPDATE their own capsule's
// `group_id` to any group's UUID (bypassing create_capsule_with_owner's
// GROUP_MEMBERSHIP_REQUIRED check) or `status` straight to 'unlocked'
// (bypassing the free-tier active-capsule cap and surprise mode) via a plain
// PATCH, with no RPC involved. See
// supabase/migrations/20260915120000_capsules_update_column_grants.sql for
// the full writeup and the fix (column-grant scoping, mirroring
// 20260722120000_audit_rls_hardening.sql's capsule_members/media fix).
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
      'This test needs a real Postgres binary to exercise the actual RLS/grant ' +
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
// directly under /tmp with a short name rather than reusing tmpdir().
const sockDir = mkdtempSync('/tmp/cpgsock2-');
const port = '55433';
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
// statements whose whole point is to verify they're REJECTED.
function tryRunSql(sql: string, db = 'capsuletest'): { ok: boolean; output: string } {
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
// tombstoneTriggerCascadeDelete.test.ts), the `authenticated` role (Postgres
// has no role-cluster equivalent of dropdb/createdb, so it's created
// idempotently — roles are cluster-wide and survive resetDb() below), and a
// `capsules` table carrying every column the real table has that's relevant
// here: the owner-scoping column (`owner_id`), the two columns the bug
// exposes (`group_id`, `status`), and one of the columns the legitimate
// EditCapsuleScreen UPDATE actually writes (`title`) as a control. Also
// grants `authenticated` the table-wide UPDATE Supabase applies by default
// to any new table — the starting point every column-scoping migration in
// this repo (20260722120000_audit_rls_hardening.sql, and this bug's own fix)
// narrows down from.
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
  if not exists (select 1 from pg_roles where rolname = 'anon') then
    create role anon nologin;
  end if;
end
$$;

create table public.users (
  id uuid primary key
);

create table public.groups (
  id uuid primary key
);

create table public.capsules (
  id uuid primary key,
  owner_id uuid not null references public.users(id),
  group_id uuid references public.groups(id),
  status text not null default 'active',
  title text,
  description text,
  unlock_at timestamptz,
  contribution_lock_at timestamptz,
  contribution_start_at timestamptz,
  unlock_mode text not null default 'time',
  superlative_voting_hours int not null default 48,
  live_activity_enabled boolean not null default true
);
alter table public.capsules enable row level security;

grant usage on schema public to authenticated;
grant select, insert, update, delete on public.capsules to authenticated;

-- A row-visibility SELECT policy is required for UPDATE ... WHERE to find
-- its target rows at all (Postgres needs SELECT-policy visibility on the OLD
-- row, distinct from the UPDATE policy's USING/WITH CHECK, which only gate
-- what's writable) — mirrors the real "Members can view capsules they
-- belong to" SELECT policy that coexists with the buggy UPDATE policy in
-- 20260515232500_capture_capsule_rls_and_helpers.sql. Simplified to
-- owner-only here since group/member visibility isn't what this bug is
-- about.
create policy "Owner can view their capsules"
  on public.capsules for select using ((select auth.uid()) = owner_id);
`;

const OWNER = '11111111-1111-1111-1111-111111111111';
const MY_GROUP = '22222222-2222-2222-2222-222222222222';
const VICTIM_GROUP = '33333333-3333-3333-3333-333333333333';
const CAPSULE = '44444444-4444-4444-4444-444444444444';

// `select set_config(..., false)` and `set role` are both session-scoped, so
// the seed + `set role authenticated` + the action under test must run in
// the SAME runSql()/tryRunSql() call (one psql process = one session), or
// the settings are gone by the time the action statement runs.
const SEED_SQL = `
  insert into public.users (id) values ('${OWNER}');
  insert into public.groups (id) values ('${MY_GROUP}'), ('${VICTIM_GROUP}');
  insert into public.capsules (id, owner_id, group_id, status, title)
    values ('${CAPSULE}', '${OWNER}', '${MY_GROUP}', 'active', 'My Capsule');
  select set_config('app.current_uid', '${OWNER}', false);
  set role authenticated;
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

// Loads, verbatim and in filename (== chronological) order, straight out of
// the real migration files:
//  - the "Owners can update their capsules" policy creation
//    (20260515232500_capture_capsule_rls_and_helpers.sql)
//  - the column-grant fix, if its migration file exists yet
//    (20260915120000_capsules_update_column_grants.sql) — this is what makes
//    the test fail pre-fix and pass post-fix, without the test file itself
//    ever changing.
function loadCapsulesUpdatePolicyFromMigrations() {
  const files = readdirSync(MIGRATIONS_DIR)
    .filter((f) => f.endsWith('.sql'))
    .sort();

  const POLICY_START = 'drop policy if exists "Owners can update their capsules" on public.capsules;';
  const POLICY_END = 'on public.capsules for update using ((select auth.uid()) = owner_id);';
  const GRANT_START = 'revoke update on public.capsules from authenticated;';
  const GRANT_END = ') on public.capsules to authenticated;';

  let policySql: string | null = null;
  let grantSql: string | null = null;

  for (const file of files) {
    const text = readFileSync(join(MIGRATIONS_DIR, file), 'utf8');
    if (policySql === null && text.includes(POLICY_START)) {
      policySql = extractBlock(text, POLICY_START, POLICY_END);
    }
    if (grantSql === null && text.includes(GRANT_START)) {
      grantSql = extractBlock(text, GRANT_START, GRANT_END);
    }
  }

  assert.ok(
    policySql,
    '"Owners can update their capsules" policy not found in any migration'
  );
  runSql(policySql!);

  if (grantSql) runSql(grantSql);
  return { fixMigrationPresent: grantSql !== null };
}

try {
  setUpCluster();
  resetDb();
  const { fixMigrationPresent } = loadCapsulesUpdatePolicyFromMigrations();
  console.log(
    `fix migration ${fixMigrationPresent ? 'found' : 'NOT found'} (20260915120000_capsules_update_column_grants.sql)`
  );

  // --- The regression cases -------------------------------------------------
  // As the owning `authenticated` client, a plain UPDATE that touches only
  // `group_id` must be rejected — the owner has no business rebranding their
  // capsule into a group they didn't validate membership for at creation.
  const groupIdAttempt = tryRunSql(
    `${SEED_SQL}\nupdate public.capsules set group_id = '${VICTIM_GROUP}' where id = '${CAPSULE}';`
  );
  assert.equal(
    groupIdAttempt.ok,
    false,
    'owner must NOT be able to UPDATE capsules.group_id directly (F16 group-branding bypass) — ' +
      'see supabase/migrations/20260915120000_capsules_update_column_grants.sql'
  );
  assert.match(
    groupIdAttempt.output,
    /permission denied for table capsules|permission denied for column group_id/,
    `expected a column-privilege rejection, got: ${groupIdAttempt.output}`
  );

  // A plain UPDATE that touches only `status` must likewise be rejected —
  // this is the free-tier-cap / surprise-mode bypass.
  resetDb();
  loadCapsulesUpdatePolicyFromMigrations();
  const statusAttempt = tryRunSql(
    `${SEED_SQL}\nupdate public.capsules set status = 'unlocked' where id = '${CAPSULE}';`
  );
  assert.equal(
    statusAttempt.ok,
    false,
    'owner must NOT be able to UPDATE capsules.status directly (free-tier cap / surprise-mode bypass) — ' +
      'see supabase/migrations/20260915120000_capsules_update_column_grants.sql'
  );
  assert.match(
    statusAttempt.output,
    /permission denied for table capsules|permission denied for column status/,
    `expected a column-privilege rejection, got: ${statusAttempt.output}`
  );

  // --- Control: the legitimate edit path must still work -------------------
  // EditCapsuleScreen's real UPDATE (title, description, unlock_at, etc.)
  // must keep working — the fix must be column-scoped, not a blanket
  // table-wide lockout.
  resetDb();
  loadCapsulesUpdatePolicyFromMigrations();
  runSql(`${SEED_SQL}\nupdate public.capsules set title = 'Renamed' where id = '${CAPSULE}';`);
  const title = runSql(`select title from public.capsules where id = '${CAPSULE}';`).trim();
  assert.equal(title, 'Renamed', 'the legitimate title UPDATE (EditCapsuleScreen) must still succeed');

  console.log('capsulesUpdateColumnGrants.test.ts: all assertions passed');
} finally {
  tearDownCluster();
}
