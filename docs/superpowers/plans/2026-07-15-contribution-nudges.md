# Contribution Nudges Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking. **Per explicit user instruction, execution should use an Opus orchestrator that dispatches Sonnet subagents per task and reviews their reports before advancing** — wire this into whichever of the two sub-skills above is chosen.

**Goal:** Activate two retention-notification types — a batched "Sarah added 3 photos" social-proof ping on upload, and a tiered (7d/3d/1d) reminder to non-contributing members as a capsule's contribution deadline approaches.

**Architecture:** Fully server-side. A `SECURITY DEFINER` trigger on `media` INSERT stages activity into a small debounce table; two new per-minute `pg_cron`-driven edge functions (mirroring the existing `unlock-capsules` structure exactly: claim + DB insert + push, all in one self-contained tick) drain that table and dispatch the tiered reminders respectively. No client code changes are needed to *detect* anything — only to *render* the two new notification types.

**Tech Stack:** Postgres (migrations via `mcp__supabase__apply_migration`), Deno edge functions (Supabase), `pg_cron` + `pg_net`, Expo push (`exp.host`), React Native / `NotificationsScreen.tsx`.

**Spec:** `docs/superpowers/specs/2026-07-15-contribution-nudges-design.md` — read this first; this plan implements it exactly, decisions are not re-litigated here.

## Global Constraints

- The user does not know SQL — every SQL statement in this plan is complete and final; do not leave any SQL for a reviewer to "check the syntax of."
- **Never apply a migration to the production Supabase project without an explicit approval checkpoint** (per prior incident: a raw-SQL mistake against prod killed two live capsules). All schema/function work in Tasks 1–5 happens on an ephemeral Supabase branch; Task 6 is the single, explicit, user-approved point where anything touches production.
- Every new SQL function that only a cron/trigger should call must end with `revoke execute on function ... from public, anon, authenticated;` — this is the established pattern for every internal-only function in this codebase (`dispatch_superlative_closing_soon`, `close_superlative_windows`, `notify_on_reaction`, etc.). Do not skip it.
- Every SQL function body uses `set search_path to ''` with fully-schema-qualified names (`public.media`, `public.users`, ...) — established convention throughout `supabase/migrations/`.
- Edge functions follow the existing `unlock-capsules` shape: a top-level `Deno.serve`, a `CRON_SECRET` env var checked via `if (CRON_SECRET && auth !== \`Bearer ${CRON_SECRET}\`)`, and a locally-duplicated `sendExpoPush` helper chunking at ≤100 messages (do not import a shared helper — this codebase deliberately duplicates this small helper per function).
- Project ref for all `net.http_post` URLs and Supabase MCP calls: `ezxxvvmesegegkdeniri`. Shared cron auth secret name in Vault: `cron_unlock_capsules_secret`.
- Branch: all work happens on `feat/contribution-nudges` (already created from `origin/main`). Commit after each task.

---

### Task 1: Database schema, trigger, and RPCs

**Files:**
- Create: `supabase/migrations/20260715120000_contribution_nudges.sql`

**Interfaces:**
- Produces (consumed by Tasks 3 & 4's edge functions via `supabase.rpc(...)` / `.from(...)`):
  - Table `contribution_activity_pending(capsule_id uuid, uploader_id uuid, photo_count int, last_upload_at timestamptz)`, PK `(capsule_id, uploader_id)`.
  - `notifications.count int` (nullable), `notifications.type` now accepts `'contribution_activity'`.
  - `capsule_members.contribution_nudge_7d_sent_at / _3d_sent_at / _1d_sent_at` (nullable timestamptz).
  - RPC `claim_contribution_nudge_tier(p_tier text) returns table(user_id uuid, capsule_id uuid, capsule_title text, effective_deadline timestamptz)` — `p_tier` must be `'7d'`, `'3d'`, or `'1d'`.
  - RPC `top_contributors(p_capsule_id uuid) returns table(user_id uuid, display_name text, photo_count int)` — all contributors, ordered by `photo_count desc`.

- [ ] **Step 1: Write the migration file**

```sql
-- Contribution nudges (phase 1 of retention notifications):
-- 1) contribution_activity — batched social-proof ping when a member uploads
--    photos, delivered to other joined members via dispatch-contribution-activity.
-- 2) contribution_nudge — tiered (7d/3d/1d) reminder to joined owner/contributor
--    members who haven't uploaded anything yet as a capsule's effective
--    contribution deadline approaches, delivered via contribution-nudges.
-- See docs/superpowers/specs/2026-07-15-contribution-nudges-design.md.

-- ---------- notifications: generic count column + extended type enum ----------

alter table public.notifications add column count int;

alter table public.notifications drop constraint notifications_type_check;
alter table public.notifications add constraint notifications_type_check
  check (type in (
    'invite', 'unlock', 'contribution_nudge', 'milestone', 'reaction',
    'superlative_suggested', 'superlative_closing_soon', 'superlative_won',
    'friend_request', 'friend_accept', 'unlock_reminder', 'group_capsule',
    'contribution_activity'
  ));

-- ---------- capsule_members: per-member, per-tier nudge dedupe stamps ----------

alter table public.capsule_members
  add column contribution_nudge_7d_sent_at timestamptz,
  add column contribution_nudge_3d_sent_at timestamptz,
  add column contribution_nudge_1d_sent_at timestamptz;

-- ---------- staging table for debounced activity batching ----------

create table public.contribution_activity_pending (
  capsule_id uuid not null references public.capsules(id) on delete cascade,
  uploader_id uuid not null references public.users(id) on delete cascade,
  photo_count int not null default 0,
  last_upload_at timestamptz not null default now(),
  primary key (capsule_id, uploader_id)
);

alter table public.contribution_activity_pending enable row level security;
-- No policies added — deny-all to clients. Only the SECURITY DEFINER trigger
-- below and the service-role edge function (Task 3) touch this table.

-- ---------- trigger: stage activity on every media insert ----------

create or replace function public.notify_contribution_activity()
returns trigger
language plpgsql
security definer
set search_path to ''
as $$
begin
  insert into public.contribution_activity_pending as cap
    (capsule_id, uploader_id, photo_count, last_upload_at)
  values (new.capsule_id, new.uploader_id, 1, now())
  on conflict (capsule_id, uploader_id) do update
    set photo_count = cap.photo_count + 1,
        last_upload_at = now();
  return new;
end;
$$;

revoke execute on function public.notify_contribution_activity() from public, anon, authenticated;

create trigger on_media_insert_contribution_activity
  after insert on public.media
  for each row execute function public.notify_contribution_activity();

-- ---------- RPC: claim a nudge tier (called by the contribution-nudges cron, Task 4) ----------
-- One atomic UPDATE ... RETURNING per tier means an overlapping cron tick can't
-- double-send: a second call matches zero rows for members already stamped.

create or replace function public.claim_contribution_nudge_tier(p_tier text)
returns table (user_id uuid, capsule_id uuid, capsule_title text, effective_deadline timestamptz)
language plpgsql
security definer
set search_path to ''
as $$
begin
  if p_tier = '7d' then
    return query
      update public.capsule_members cm
      set contribution_nudge_7d_sent_at = now()
      from public.capsules c
      where cm.capsule_id = c.id
        and cm.joined_at is not null
        and cm.role in ('owner', 'contributor')
        and cm.contribution_nudge_7d_sent_at is null
        and c.status = 'active'
        and coalesce(c.contribution_lock_at, case when c.unlock_mode in ('time', 'both') then c.unlock_at end) is not null
        and now() < coalesce(c.contribution_lock_at, case when c.unlock_mode in ('time', 'both') then c.unlock_at end)
        and coalesce(c.contribution_lock_at, case when c.unlock_mode in ('time', 'both') then c.unlock_at end) <= now() + interval '7 days'
        and not exists (select 1 from public.media m where m.capsule_id = c.id and m.uploader_id = cm.user_id)
      returning cm.user_id, cm.capsule_id, c.title,
        coalesce(c.contribution_lock_at, case when c.unlock_mode in ('time', 'both') then c.unlock_at end);
  elsif p_tier = '3d' then
    return query
      update public.capsule_members cm
      set contribution_nudge_3d_sent_at = now()
      from public.capsules c
      where cm.capsule_id = c.id
        and cm.joined_at is not null
        and cm.role in ('owner', 'contributor')
        and cm.contribution_nudge_3d_sent_at is null
        and c.status = 'active'
        and coalesce(c.contribution_lock_at, case when c.unlock_mode in ('time', 'both') then c.unlock_at end) is not null
        and now() < coalesce(c.contribution_lock_at, case when c.unlock_mode in ('time', 'both') then c.unlock_at end)
        and coalesce(c.contribution_lock_at, case when c.unlock_mode in ('time', 'both') then c.unlock_at end) <= now() + interval '3 days'
        and not exists (select 1 from public.media m where m.capsule_id = c.id and m.uploader_id = cm.user_id)
      returning cm.user_id, cm.capsule_id, c.title,
        coalesce(c.contribution_lock_at, case when c.unlock_mode in ('time', 'both') then c.unlock_at end);
  elsif p_tier = '1d' then
    return query
      update public.capsule_members cm
      set contribution_nudge_1d_sent_at = now()
      from public.capsules c
      where cm.capsule_id = c.id
        and cm.joined_at is not null
        and cm.role in ('owner', 'contributor')
        and cm.contribution_nudge_1d_sent_at is null
        and c.status = 'active'
        and coalesce(c.contribution_lock_at, case when c.unlock_mode in ('time', 'both') then c.unlock_at end) is not null
        and now() < coalesce(c.contribution_lock_at, case when c.unlock_mode in ('time', 'both') then c.unlock_at end)
        and coalesce(c.contribution_lock_at, case when c.unlock_mode in ('time', 'both') then c.unlock_at end) <= now() + interval '1 day'
        and not exists (select 1 from public.media m where m.capsule_id = c.id and m.uploader_id = cm.user_id)
      returning cm.user_id, cm.capsule_id, c.title,
        coalesce(c.contribution_lock_at, case when c.unlock_mode in ('time', 'both') then c.unlock_at end);
  else
    raise exception 'claim_contribution_nudge_tier: invalid tier %', p_tier;
  end if;
end;
$$;

revoke execute on function public.claim_contribution_nudge_tier(text) from public, anon, authenticated;

-- ---------- RPC: top contributors for a capsule (called by the contribution-nudges cron) ----------
-- Returns every uploader who has contributed, ordered by photo count desc, so
-- the caller can pick the first one not blocked by a given recipient (a
-- recipient can never appear in this list themselves, since nudge recipients
-- are by definition members with zero uploads).

create or replace function public.top_contributors(p_capsule_id uuid)
returns table (user_id uuid, display_name text, photo_count int)
language sql
security definer
set search_path to ''
stable
as $$
  select m.uploader_id, u.display_name, count(*)::int as photo_count
  from public.media m
  join public.users u on u.id = m.uploader_id
  where m.capsule_id = p_capsule_id
  group by m.uploader_id, u.display_name
  order by count(*) desc;
$$;

revoke execute on function public.top_contributors(uuid) from public, anon, authenticated;
```

- [ ] **Step 2: Create an ephemeral Supabase branch for testing**

Use `mcp__supabase__create_branch` (project_id `ezxxvvmesegegkdeniri`, name e.g. `contribution-nudges-test`). If it invokes `mcp__supabase__confirm_cost` first, confirm — this is a short-lived test branch, deleted in Task 6. **Record the returned branch's `project_id` (or equivalent ref) — every later test step in Tasks 1–5 reuses this same branch.**

- [ ] **Step 3: Apply the migration to the branch**

Use `mcp__supabase__apply_migration` against the branch project with `name: "20260715120000_contribution_nudges"` and the SQL from Step 1.

- [ ] **Step 4: Seed fixture data and verify the trigger**

Via `mcp__supabase__execute_sql` on the branch, run:

```sql
-- Fixture: one capsule, one owner, one uploader (contributor), no media yet.
-- public.users.id has a foreign key to auth.users(id), and the
-- on_auth_user_created trigger (handle_new_user) auto-creates the matching
-- public.users row — so fixtures insert into auth.users, never directly into
-- public.users. Verified against the live schema: auth.users has exactly one
-- NOT NULL column with no default (`id`); everything else, including
-- `email` and `raw_user_meta_data`, is nullable or defaulted, so this
-- minimal insert is sufficient.
insert into auth.users (id, email, raw_user_meta_data)
values
  ('11111111-1111-1111-1111-111111111111', 'owner@test.dev', '{"display_name":"Owner Test"}'::jsonb),
  ('22222222-2222-2222-2222-222222222222', 'uploader@test.dev', '{"display_name":"Uploader Test"}'::jsonb);

insert into public.capsules (id, owner_id, title, unlock_at, status, unlock_mode)
values ('33333333-3333-3333-3333-333333333333', '11111111-1111-1111-1111-111111111111',
        'Test Capsule', now() + interval '30 days', 'active', 'time');

insert into public.capsule_members (id, capsule_id, user_id, role, joined_at)
values
  ('44444444-4444-4444-4444-444444444444', '33333333-3333-3333-3333-333333333333',
   '11111111-1111-1111-1111-111111111111', 'owner', now()),
  ('55555555-5555-5555-5555-555555555555', '33333333-3333-3333-3333-333333333333',
   '22222222-2222-2222-2222-222222222222', 'contributor', now());

-- Insert two media rows from the same uploader — the trigger should upsert
-- the staging row to photo_count = 2, not create two rows.
-- size_bytes is NOT NULL with no default (verified against the live schema)
-- — an arbitrary placeholder value is fine, nothing reads it in these tests.
insert into public.media (id, capsule_id, uploader_id, storage_key, media_type, size_bytes)
values
  ('66666666-6666-6666-6666-666666666666', '33333333-3333-3333-3333-333333333333',
   '22222222-2222-2222-2222-222222222222', 'test/1.jpg', 'photo', 100000),
  ('77777777-7777-7777-7777-777777777777', '33333333-3333-3333-3333-333333333333',
   '22222222-2222-2222-2222-222222222222', 'test/2.jpg', 'photo', 100000);

select capsule_id, uploader_id, photo_count from public.contribution_activity_pending;
```

Expected: one row, `photo_count = 2`, `capsule_id = '33333333-3333-3333-3333-333333333333'`, `uploader_id = '22222222-2222-2222-2222-222222222222'`.

- [ ] **Step 5: Verify `top_contributors`**

```sql
select * from public.top_contributors('33333333-3333-3333-3333-333333333333');
```

Expected: one row — `user_id = '22222222-2222-2222-2222-222222222222'`, `display_name = 'Uploader Test'`, `photo_count = 2`.

- [ ] **Step 6: Verify `claim_contribution_nudge_tier` — positive case**

The owner has zero uploads and the capsule unlocks in 30 days (well within the 7-day-tier window doesn't apply yet — adjust the fixture capsule's deadline first so it actually falls inside the 7d window):

```sql
update public.capsules set unlock_at = now() + interval '5 days'
where id = '33333333-3333-3333-3333-333333333333';

select * from public.claim_contribution_nudge_tier('7d');
```

Expected: one row for `user_id = '11111111-1111-1111-1111-111111111111'` (the owner — zero uploads), capsule_id/title match, `effective_deadline` ≈ `now() + interval '5 days'`. The uploader (contributor with 2 uploads) must NOT appear.

- [ ] **Step 7: Verify idempotency — calling the same tier again returns nothing**

```sql
select * from public.claim_contribution_nudge_tier('7d');
```

Expected: zero rows (the owner's `contribution_nudge_7d_sent_at` is now stamped from Step 6).

- [ ] **Step 8: Verify the proximity-with-no-lock exclusion**

```sql
insert into public.capsules (id, owner_id, title, unlock_at, status, unlock_mode)
values ('88888888-8888-8888-8888-888888888888', '11111111-1111-1111-1111-111111111111',
        'Proximity Capsule', now() + interval '1 day', 'active', 'proximity');

insert into public.capsule_members (id, capsule_id, user_id, role, joined_at)
values ('99999999-9999-9999-9999-999999999999', '88888888-8888-8888-8888-888888888888',
        '11111111-1111-1111-1111-111111111111', 'owner', now());

select * from public.claim_contribution_nudge_tier('1d');
```

Expected: zero rows for the proximity capsule (its `unlock_at` is a placeholder and `contribution_lock_at` is null, so `effective_deadline` evaluates to null and the `is not null` guard excludes it) — confirm no row with `capsule_id = '88888888-8888-8888-8888-888888888888'` is returned.

- [ ] **Step 9: Confirm both functions are locked down**

```sql
select proname, proacl from pg_proc
where proname in ('claim_contribution_nudge_tier', 'top_contributors', 'notify_contribution_activity');
```

Expected: `proacl` shows no `authenticated=X` or `anon=X` entries (execute revoked from both).

- [ ] **Step 10: Commit**

```bash
git add supabase/migrations/20260715120000_contribution_nudges.sql
git commit -m "Add contribution-nudges schema, trigger, and RPCs"
```

---

### Task 2: Cron registration migration

**Files:**
- Create: `supabase/migrations/20260715120100_contribution_nudges_cron.sql`

**Interfaces:**
- Consumes: nothing new from Task 1's SQL objects directly (the cron SQL only reads `contribution_activity_pending`, `capsule_members`, `capsules`, `media` — all defined by Task 1 or earlier migrations).
- Produces: two `pg_cron` jobs, `dispatch-contribution-activity` and `contribution-nudges`, each firing every minute and calling the edge functions built in Tasks 3 & 4 (whose URLs are hardcoded now — the functions don't need to exist yet for this migration to apply cleanly, since `net.http_post` only fires when the `EXISTS` gate is true, and it won't be true until Task 1's fixtures or real data exist).

- [ ] **Step 1: Write the migration file**

```sql
-- Registers the two phase-1 contribution-nudge crons (both * * * * *,
-- EXISTS-gated per PERFORMANCE.md #4 — same pattern as the four existing
-- per-minute crons). Auth: CRON_SECRET env var on each function (set
-- manually in the Supabase dashboard — see Task 6), sourced here from the
-- same 'cron_unlock_capsules_secret' Vault entry every other cron reads.

select cron.schedule(
  'dispatch-contribution-activity',
  '* * * * *',
  $cron$
    select net.http_post(
      url := 'https://ezxxvvmesegegkdeniri.supabase.co/functions/v1/dispatch-contribution-activity',
      headers := jsonb_build_object(
        'Content-Type', 'application/json',
        'Authorization', 'Bearer ' || (
          select decrypted_secret
            from vault.decrypted_secrets
           where name = 'cron_unlock_capsules_secret'
        )
      ),
      body := '{}'::jsonb
    )
    where exists (
      select 1 from public.contribution_activity_pending
      where last_upload_at <= now() - interval '2 minutes'
    );
  $cron$
);

select cron.schedule(
  'contribution-nudges',
  '* * * * *',
  $cron$
    select net.http_post(
      url := 'https://ezxxvvmesegegkdeniri.supabase.co/functions/v1/contribution-nudges',
      headers := jsonb_build_object(
        'Content-Type', 'application/json',
        'Authorization', 'Bearer ' || (
          select decrypted_secret
            from vault.decrypted_secrets
           where name = 'cron_unlock_capsules_secret'
        )
      ),
      body := '{}'::jsonb
    )
    where exists (
      select 1
      from public.capsule_members cm
      join public.capsules c on c.id = cm.capsule_id
      where cm.joined_at is not null
        and cm.role in ('owner', 'contributor')
        and c.status = 'active'
        and (
          cm.contribution_nudge_7d_sent_at is null
          or cm.contribution_nudge_3d_sent_at is null
          or cm.contribution_nudge_1d_sent_at is null
        )
        and coalesce(c.contribution_lock_at, case when c.unlock_mode in ('time', 'both') then c.unlock_at end) is not null
        and now() < coalesce(c.contribution_lock_at, case when c.unlock_mode in ('time', 'both') then c.unlock_at end)
        and coalesce(c.contribution_lock_at, case when c.unlock_mode in ('time', 'both') then c.unlock_at end) <= now() + interval '7 days'
        and not exists (select 1 from public.media m where m.capsule_id = c.id and m.uploader_id = cm.user_id)
    );
  $cron$
);
```

- [ ] **Step 2: Apply to the same test branch from Task 1**

`mcp__supabase__apply_migration` against the Task 1 branch, `name: "20260715120100_contribution_nudges_cron"`.

- [ ] **Step 3: Verify job registration**

```sql
select jobname, schedule, active from cron.job
where jobname in ('dispatch-contribution-activity', 'contribution-nudges');
```

Expected: two rows, both `schedule = '* * * * *'`, both `active = true`.

- [ ] **Step 4: Verify the `contribution-nudges` EXISTS predicate fires on the seeded fixture**

The Task 1 fixtures left the owner's `contribution_nudge_7d_sent_at` stamped (Step 6/7) but the `88888888-...` proximity capsule and any remaining nulls should NOT satisfy the predicate (proximity capsule's `effective_deadline` is null). Confirm directly:

```sql
select exists (
  select 1
  from public.capsule_members cm
  join public.capsules c on c.id = cm.capsule_id
  where cm.joined_at is not null
    and cm.role in ('owner', 'contributor')
    and c.status = 'active'
    and (
      cm.contribution_nudge_7d_sent_at is null
      or cm.contribution_nudge_3d_sent_at is null
      or cm.contribution_nudge_1d_sent_at is null
    )
    and coalesce(c.contribution_lock_at, case when c.unlock_mode in ('time', 'both') then c.unlock_at end) is not null
    and now() < coalesce(c.contribution_lock_at, case when c.unlock_mode in ('time', 'both') then c.unlock_at end)
    and coalesce(c.contribution_lock_at, case when c.unlock_mode in ('time', 'both') then c.unlock_at end) <= now() + interval '7 days'
    and not exists (select 1 from public.media m where m.capsule_id = c.id and m.uploader_id = cm.user_id)
) as would_fire;
```

Expected: `true` — the Task 1 owner's `_3d_sent_at`/`_1d_sent_at` are still null, so they're still due for a later tier.

- [ ] **Step 5: Commit**

```bash
git add supabase/migrations/20260715120100_contribution_nudges_cron.sql
git commit -m "Register contribution-nudge cron jobs"
```

---

### Task 3: `dispatch-contribution-activity` edge function

**Files:**
- Create: `supabase/functions/dispatch-contribution-activity/index.ts`

**Interfaces:**
- Consumes: `contribution_activity_pending` table, `top_contributors`/`claim_contribution_nudge_tier` NOT used here (those are Task 4's). Uses `blocked_users`, `capsule_members`, `capsules`, `users`, `notifications` tables directly via the Supabase JS client (service role — bypasses RLS).
- Produces: HTTP endpoint at `/functions/v1/dispatch-contribution-activity`, invoked by the Task 2 cron. Returns `{ claimed: number, notified: number }`.

- [ ] **Step 1: Write the function**

```ts
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const supabase = createClient(
  Deno.env.get('SUPABASE_URL')!,
  Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
);

const CRON_SECRET = Deno.env.get('CRON_SECRET');
const DEBOUNCE_MS = 2 * 60 * 1000;

type ExpoMessage = {
  to: string;
  title: string;
  body: string;
  data: Record<string, unknown>;
  sound: 'default';
};

// Expo rejects a request carrying >100 messages and drops the WHOLE batch —
// slice into ≤100-message requests, posted sequentially (matches
// unlock-capsules / create-group-capsules' sendExpoPush).
async function sendExpoPush(messages: ExpoMessage[]): Promise<void> {
  for (let i = 0; i < messages.length; i += 100) {
    await fetch('https://exp.host/--/api/v2/push/send', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
      body: JSON.stringify(messages.slice(i, i + 100)),
    });
  }
}

Deno.serve(async (req) => {
  const auth = req.headers.get('Authorization');
  if (CRON_SECRET && auth !== `Bearer ${CRON_SECRET}`) {
    return new Response('Unauthorized', { status: 401 });
  }

  // Atomically claim every pending row whose debounce window has elapsed.
  // A DELETE...RETURNING can't be claimed twice by an overlapping tick.
  const cutoff = new Date(Date.now() - DEBOUNCE_MS).toISOString();
  const { data: due, error } = await supabase
    .from('contribution_activity_pending')
    .delete()
    .lte('last_upload_at', cutoff)
    .select('capsule_id, uploader_id, photo_count');

  if (error) {
    return new Response(JSON.stringify({ error: 'Internal error' }), { status: 500 });
  }

  const messages: ExpoMessage[] = [];
  let notified = 0;

  for (const row of due ?? []) {
    const { data: capsule } = await supabase
      .from('capsules')
      .select('title')
      .eq('id', row.capsule_id)
      .single();
    if (!capsule) continue;

    const { data: uploader } = await supabase
      .from('users')
      .select('display_name')
      .eq('id', row.uploader_id)
      .single();
    const uploaderName = uploader?.display_name ?? 'Someone';

    const { data: members } = await supabase
      .from('capsule_members')
      .select('user_id, users(push_token)')
      .eq('capsule_id', row.capsule_id)
      .not('joined_at', 'is', null)
      .neq('user_id', row.uploader_id);

    // Never tell a recipient about activity from someone they've blocked.
    const { data: blockedBy } = await supabase
      .from('blocked_users')
      .select('blocker_id')
      .eq('blocked_id', row.uploader_id);
    const blockedByIds = new Set((blockedBy ?? []).map((b: any) => b.blocker_id));
    const recipients = (members ?? []).filter((m: any) => !blockedByIds.has(m.user_id));
    if (recipients.length === 0) continue;

    const photoWord = row.photo_count === 1 ? 'photo' : 'photos';
    const body = `${uploaderName} added ${row.photo_count} ${photoWord} to "${capsule.title}"`;

    const rows = recipients.map((m: any) => ({
      user_id: m.user_id,
      capsule_id: row.capsule_id,
      actor_id: row.uploader_id,
      type: 'contribution_activity',
      count: row.photo_count,
      pushed_at: new Date().toISOString(),
    }));
    await supabase.from('notifications').insert(rows);
    notified += rows.length;

    for (const m of recipients as any[]) {
      const token = m.users?.push_token;
      if (token) {
        messages.push({
          to: token,
          title: '📸 New photos added',
          body,
          data: { capsuleId: row.capsule_id },
          sound: 'default',
        });
      }
    }
  }

  if (messages.length) {
    await sendExpoPush(messages);
  }

  return new Response(JSON.stringify({ claimed: due?.length ?? 0, notified }));
});
```

- [ ] **Step 2: Deploy to the test branch**

Use `mcp__supabase__deploy_edge_function` against the Task 1 branch project, `name: "dispatch-contribution-activity"`, with the file content from Step 1.

- [ ] **Step 3: Seed a fresh debounced-and-due fixture on the branch**

```sql
insert into public.contribution_activity_pending (capsule_id, uploader_id, photo_count, last_upload_at)
values ('33333333-3333-3333-3333-333333333333', '22222222-2222-2222-2222-222222222222',
        3, now() - interval '3 minutes')
on conflict (capsule_id, uploader_id) do update
  set photo_count = 3, last_upload_at = now() - interval '3 minutes';
```

(Reuses the Task 1 fixture capsule/uploader — the owner, `11111111-...`, is still a joined member and will be the recipient.)

- [ ] **Step 4: Invoke the function directly and inspect the result**

```bash
curl -s -X POST "https://<branch-project-ref>.supabase.co/functions/v1/dispatch-contribution-activity"
```

(No `Authorization` header needed on the test branch — `CRON_SECRET` is unset there, so the function's `if (CRON_SECRET && ...)` check is skipped entirely, same fallback behavior as `unlock-capsules` in an unconfigured environment.)

Expected JSON: `{"claimed":1,"notified":1}`.

- [ ] **Step 5: Verify the notification row**

```sql
select user_id, capsule_id, actor_id, type, count, pushed_at from public.notifications
where type = 'contribution_activity';
```

Expected: one row, `user_id = '11111111-1111-1111-1111-111111111111'` (owner), `actor_id = '22222222-2222-2222-2222-222222222222'` (uploader), `count = 3`, `pushed_at` set.

- [ ] **Step 6: Verify the staging row was consumed**

```sql
select count(*) from public.contribution_activity_pending;
```

Expected: `0`.

- [ ] **Step 7: Commit**

```bash
git add supabase/functions/dispatch-contribution-activity/index.ts
git commit -m "Add dispatch-contribution-activity edge function"
```

---

### Task 4: `contribution-nudges` edge function

**Files:**
- Create: `supabase/functions/contribution-nudges/index.ts`

**Interfaces:**
- Consumes: `claim_contribution_nudge_tier(p_tier text)` and `top_contributors(p_capsule_id uuid)` RPCs from Task 1 (exact signatures above).
- Produces: HTTP endpoint at `/functions/v1/contribution-nudges`, invoked by the Task 2 cron. Returns `{ reminded: number }`.

- [ ] **Step 1: Write the function**

```ts
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const supabase = createClient(
  Deno.env.get('SUPABASE_URL')!,
  Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
);

const CRON_SECRET = Deno.env.get('CRON_SECRET');
const TIERS = ['7d', '3d', '1d'] as const;

type ExpoMessage = {
  to: string;
  title: string;
  body: string;
  data: Record<string, unknown>;
  sound: 'default';
};

async function sendExpoPush(messages: ExpoMessage[]): Promise<void> {
  for (let i = 0; i < messages.length; i += 100) {
    await fetch('https://exp.host/--/api/v2/push/send', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
      body: JSON.stringify(messages.slice(i, i + 100)),
    });
  }
}

// Phrase the deadline from the actual remaining ms, so the copy is correct
// regardless of exactly which minute the tier fired (mirrors unlock-capsules'
// formatRemaining).
function formatDeadline(iso: string): string {
  const ms = new Date(iso).getTime() - Date.now();
  const days = Math.round(ms / (24 * 60 * 60 * 1000));
  if (days <= 1) return 'tomorrow';
  return `in ${days} days`;
}

Deno.serve(async (req) => {
  const auth = req.headers.get('Authorization');
  if (CRON_SECRET && auth !== `Bearer ${CRON_SECRET}`) {
    return new Response('Unauthorized', { status: 401 });
  }

  const messages: ExpoMessage[] = [];
  let reminded = 0;

  for (const tier of TIERS) {
    const { data: claimed, error } = await supabase.rpc('claim_contribution_nudge_tier', { p_tier: tier });
    if (error || !claimed?.length) continue;

    // Group claimed members by capsule so top_contributors is fetched once
    // per capsule, not once per member.
    const byCapsule = new Map<string, { capsuleTitle: string; effectiveDeadline: string; userIds: string[] }>();
    for (const row of claimed as any[]) {
      const entry = byCapsule.get(row.capsule_id) ?? {
        capsuleTitle: row.capsule_title,
        effectiveDeadline: row.effective_deadline,
        userIds: [],
      };
      entry.userIds.push(row.user_id);
      byCapsule.set(row.capsule_id, entry);
    }

    for (const [capsuleId, entry] of byCapsule) {
      const { data: topContributors } = await supabase.rpc('top_contributors', { p_capsule_id: capsuleId });
      const deadlinePhrase = formatDeadline(entry.effectiveDeadline);

      const { data: userRows } = await supabase
        .from('users')
        .select('id, push_token')
        .in('id', entry.userIds);
      const pushTokenById = new Map((userRows ?? []).map((u: any) => [u.id, u.push_token]));

      // Never compare a recipient against a top contributor they've blocked.
      const { data: blockedByRows } = await supabase
        .from('blocked_users')
        .select('blocker_id, blocked_id')
        .in('blocker_id', entry.userIds);
      const blockedByRecipient = new Map<string, Set<string>>();
      for (const b of (blockedByRows ?? []) as any[]) {
        if (!blockedByRecipient.has(b.blocker_id)) blockedByRecipient.set(b.blocker_id, new Set());
        blockedByRecipient.get(b.blocker_id)!.add(b.blocked_id);
      }

      const rows: any[] = [];
      for (const userId of entry.userIds) {
        const blockedIds = blockedByRecipient.get(userId) ?? new Set<string>();
        const top = (topContributors ?? []).find((c: any) => !blockedIds.has(c.user_id));

        let title: string;
        let body: string;
        if (top) {
          const topPhotoWord = top.photo_count === 1 ? 'photo' : 'photos';
          title = "⏰ Don't be left out";
          body = `${top.display_name} added ${top.photo_count} ${topPhotoWord} to "${entry.capsuleTitle}" — you haven't added any yet. Locks ${deadlinePhrase}.`;
        } else {
          title = '⏰ Add your photos';
          body = `Nobody's added photos to "${entry.capsuleTitle}" yet — don't be the one holding it up! Locks ${deadlinePhrase}.`;
        }

        rows.push({
          user_id: userId,
          capsule_id: capsuleId,
          actor_id: top?.user_id ?? null,
          type: 'contribution_nudge',
          count: top?.photo_count ?? null,
          pushed_at: new Date().toISOString(),
        });

        const token = pushTokenById.get(userId);
        if (token) {
          messages.push({ to: token, title, body, data: { capsuleId }, sound: 'default' });
        }
      }
      await supabase.from('notifications').insert(rows);
      reminded += rows.length;
    }
  }

  if (messages.length) {
    await sendExpoPush(messages);
  }

  return new Response(JSON.stringify({ reminded }));
});
```

- [ ] **Step 2: Deploy to the test branch**

`mcp__supabase__deploy_edge_function`, same branch project as Task 3, `name: "contribution-nudges"`.

- [ ] **Step 3: Reset a fixture member back to "due" and invoke**

The Task 1 owner already got a `7d` reminder in Step 6/7 of Task 1. Reset it and invoke:

```sql
update public.capsule_members set contribution_nudge_7d_sent_at = null
where id = '44444444-4444-4444-4444-444444444444';
```

```bash
curl -s -X POST "https://<branch-project-ref>.supabase.co/functions/v1/contribution-nudges"
```

Expected JSON: `{"reminded":1}`.

- [ ] **Step 4: Verify the notification row includes the top-contributor comparison**

```sql
select user_id, capsule_id, actor_id, type, count from public.notifications
where type = 'contribution_nudge';
```

Expected: one row, `user_id = '11111111-1111-1111-1111-111111111111'` (owner), `actor_id = '22222222-2222-2222-2222-222222222222'` (the uploader from Task 1, who has 2 photos — Task 3's test added a 3rd on the pending table but that row was already consumed and doesn't add real `media` rows, so `top_contributors` still reports 2), `count = 2`.

- [ ] **Step 5: Verify the "nobody's contributed yet" branch**

The three tiers use overlapping windows (`<= now() + interval 'Xd'`, not disjoint bands) — this is the same shape as `unlock-capsules`' existing 1d/1h/10m reminder tiers, and it's accepted there for the same reason: a capsule whose deadline is already very close the first time the cron ever evaluates it can legitimately match multiple tiers at once in a single tick (arguably correct — if there was never an earlier tick to catch the wider tier, better to send it late than never). To keep this test step isolated to the single behavior it's meant to demonstrate (the null-top-contributor copy branch), pick a deadline that falls inside only the 7-day window, not the 3-day or 1-day ones:

```sql
insert into public.capsule_members (id, capsule_id, user_id, role, joined_at)
values ('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', '88888888-8888-8888-8888-888888888888',
        '22222222-2222-2222-2222-222222222222', 'contributor', now());

update public.capsules set contribution_lock_at = now() + interval '6 days'
where id = '88888888-8888-8888-8888-888888888888';
```

```bash
curl -s -X POST "https://<branch-project-ref>.supabase.co/functions/v1/contribution-nudges"
```

Then:

```sql
select user_id, actor_id, count from public.notifications
where type = 'contribution_nudge' and capsule_id = '88888888-8888-8888-8888-888888888888';
```

Expected: two rows (owner and the newly-added contributor, both zero uploads on this capsule), both with `actor_id is null` and `count is null`.

- [ ] **Step 6: Commit**

```bash
git add supabase/functions/contribution-nudges/index.ts
git commit -m "Add contribution-nudges edge function"
```

---

### Task 5: Client rendering — `NotificationsScreen.tsx`

**Files:**
- Modify: `src/screens/app/NotificationsScreen.tsx`

**Interfaces:**
- Consumes: `notifications.type` values `'contribution_activity'` and `'contribution_nudge'` (Task 1), `notifications.count` column (Task 1), existing `actor:users!notifications_actor_id_fkey(id, display_name, avatar_url)` embed (already selected).
- No changes to `src/types/database.ts` — its `NotificationType` export has zero importers anywhere in `src/` (verified via grep) and is already stale relative to the live DB (missing `friend_request`/`friend_accept`/`unlock_reminder`/`group_capsule`); extending it here would be dead-code maintenance with no runtime effect, so it's left alone.

- [ ] **Step 1: Extend the `NotificationRow` type**

In `src/screens/app/NotificationsScreen.tsx`, replace:

```ts
type NotificationRow = {
  id: string;
  capsule_id: string | null;
  actor_id: string | null;
  type:
    | 'invite'
    | 'unlock'
    | 'unlock_reminder'
    | 'reaction'
    | 'superlative_suggested'
    | 'superlative_closing_soon'
    | 'superlative_won'
    | 'friend_request'
    | 'friend_accept'
    | 'group_capsule';
  sent_at: string;
  read_at: string | null;
  capsules: { title: string } | null;
  actor: Actor | null;
};
```

with:

```ts
type NotificationRow = {
  id: string;
  capsule_id: string | null;
  actor_id: string | null;
  type:
    | 'invite'
    | 'unlock'
    | 'unlock_reminder'
    | 'reaction'
    | 'superlative_suggested'
    | 'superlative_closing_soon'
    | 'superlative_won'
    | 'friend_request'
    | 'friend_accept'
    | 'group_capsule'
    | 'contribution_activity'
    | 'contribution_nudge';
  sent_at: string;
  read_at: string | null;
  count: number | null;
  capsules: { title: string } | null;
  actor: Actor | null;
};
```

- [ ] **Step 2: Include `count` in the fetch query and mark both new types as capsule-nav**

Replace:

```ts
          .select('id, capsule_id, actor_id, type, sent_at, read_at, capsules(title), actor:users!notifications_actor_id_fkey(id, display_name, avatar_url)')
```

with:

```ts
          .select('id, capsule_id, actor_id, type, sent_at, read_at, count, capsules(title), actor:users!notifications_actor_id_fkey(id, display_name, avatar_url)')
```

Replace:

```ts
function isCapsuleNav(type: NotificationRow['type']) {
  return (
    type === 'unlock' ||
    type === 'unlock_reminder' ||
    type === 'reaction' ||
    type === 'superlative_suggested' ||
    type === 'superlative_closing_soon' ||
    type === 'superlative_won' ||
    type === 'group_capsule'
  );
}
```

with:

```ts
function isCapsuleNav(type: NotificationRow['type']) {
  return (
    type === 'unlock' ||
    type === 'unlock_reminder' ||
    type === 'reaction' ||
    type === 'superlative_suggested' ||
    type === 'superlative_closing_soon' ||
    type === 'superlative_won' ||
    type === 'group_capsule' ||
    type === 'contribution_activity' ||
    type === 'contribution_nudge'
  );
}
```

- [ ] **Step 3: Add icon + color cases**

Replace the `Ionicons name={...}` ternary chain:

```tsx
                  name={
                    item.type === 'unlock' ? 'lock-open-outline'
                    : item.type === 'unlock_reminder' ? 'hourglass-outline'
                    : item.type === 'reaction' ? 'heart-outline'
                    : item.type === 'superlative_won' ? 'trophy'
                    : item.type === 'superlative_closing_soon' ? 'time-outline'
                    : item.type === 'superlative_suggested' ? 'sparkles-outline'
                    : item.type === 'friend_request' ? 'person-add-outline'
                    : item.type === 'friend_accept' ? 'people'
                    : item.type === 'group_capsule' ? 'people-circle-outline'
                    : 'cube-outline'
                  }
```

with:

```tsx
                  name={
                    item.type === 'unlock' ? 'lock-open-outline'
                    : item.type === 'unlock_reminder' ? 'hourglass-outline'
                    : item.type === 'reaction' ? 'heart-outline'
                    : item.type === 'superlative_won' ? 'trophy'
                    : item.type === 'superlative_closing_soon' ? 'time-outline'
                    : item.type === 'superlative_suggested' ? 'sparkles-outline'
                    : item.type === 'friend_request' ? 'person-add-outline'
                    : item.type === 'friend_accept' ? 'people'
                    : item.type === 'group_capsule' ? 'people-circle-outline'
                    : item.type === 'contribution_activity' ? 'images-outline'
                    : item.type === 'contribution_nudge' ? 'hourglass-outline'
                    : 'cube-outline'
                  }
```

Replace the `color={...}` ternary chain:

```tsx
                  color={
                    item.type === 'unlock' ? '#30D158'
                    : item.type === 'unlock_reminder' ? accentColor
                    : item.type === 'friend_accept' ? '#30D158'
                    : item.type === 'reaction' ? accentColor
                    : item.type === 'friend_request' ? accentColor
                    : item.type === 'group_capsule' ? accentColor
                    : SUPERLATIVE_TYPES.includes(item.type) ? accentColor
                    : '#888888'
                  }
```

with:

```tsx
                  color={
                    item.type === 'unlock' ? '#30D158'
                    : item.type === 'unlock_reminder' ? accentColor
                    : item.type === 'friend_accept' ? '#30D158'
                    : item.type === 'reaction' ? accentColor
                    : item.type === 'friend_request' ? accentColor
                    : item.type === 'group_capsule' ? accentColor
                    : item.type === 'contribution_activity' ? accentColor
                    : item.type === 'contribution_nudge' ? accentColor
                    : SUPERLATIVE_TYPES.includes(item.type) ? accentColor
                    : '#888888'
                  }
```

- [ ] **Step 4: Add copy cases**

Replace:

```tsx
                    ) : item.type === 'group_capsule' ? (
                      <>
                        A new capsule was started in{' '}
                        <Text style={styles.cardCapsuleTitle}>{item.capsules?.title ?? 'your group'}</Text>
                      </>
                    ) : (
```

with:

```tsx
                    ) : item.type === 'group_capsule' ? (
                      <>
                        A new capsule was started in{' '}
                        <Text style={styles.cardCapsuleTitle}>{item.capsules?.title ?? 'your group'}</Text>
                      </>
                    ) : item.type === 'contribution_activity' ? (
                      <>
                        <Text style={styles.cardCapsuleTitle}>{item.actor?.display_name ?? 'Someone'}</Text>
                        {` added ${item.count ?? 0} ${item.count === 1 ? 'photo' : 'photos'} to `}
                        <Text style={styles.cardCapsuleTitle}>{item.capsules?.title ?? 'your capsule'}</Text>
                      </>
                    ) : item.type === 'contribution_nudge' ? (
                      item.actor ? (
                        <>
                          <Text style={styles.cardCapsuleTitle}>{item.actor.display_name}</Text>
                          {` has added ${item.count ?? 0} ${item.count === 1 ? 'photo' : 'photos'} to `}
                          <Text style={styles.cardCapsuleTitle}>{item.capsules?.title ?? 'a capsule'}</Text>
                          {' — you haven’t added any yet'}
                        </>
                      ) : (
                        <>
                          {'Don’t forget to add your photos to '}
                          <Text style={styles.cardCapsuleTitle}>{item.capsules?.title ?? 'a capsule'}</Text>
                        </>
                      )
                    ) : (
```

- [ ] **Step 5: Typecheck**

Run: `cd /Users/markdickson/Desktop/capsule && npx tsc --noEmit`
Expected: no new errors referencing `NotificationsScreen.tsx` (pre-existing unrelated errors elsewhere, if any, are out of scope).

- [ ] **Step 6: Commit**

```bash
git add src/screens/app/NotificationsScreen.tsx
git commit -m "Render contribution_activity and contribution_nudge notifications"
```

---

### Task 6: Production rollout and end-to-end verification

**Files:** none new — this task applies the artifacts from Tasks 1–4 to the production Supabase project and manually verifies the full flow in the running app.

**Interfaces:** none (integration/deployment task).

- [ ] **Step 1: Stop and get explicit user approval before touching production**

Per this repo's DB-delete-incident history, do not proceed past this step without the user explicitly confirming they want the migrations and functions applied to the **production** project (`ezxxvvmesegegkdeniri`), not just the test branch. State plainly what will be applied: the Task 1 and Task 2 migrations, and the Task 3/4 edge functions. Wait for a clear go-ahead.

- [ ] **Step 2: Apply the two migrations to production**

`mcp__supabase__apply_migration` against project `ezxxvvmesegegkdeniri`, in order:
1. `name: "20260715120000_contribution_nudges"` — the Task 1 SQL.
2. `name: "20260715120100_contribution_nudges_cron"` — the Task 2 SQL.

- [ ] **Step 3: Deploy both edge functions to production**

`mcp__supabase__deploy_edge_function` against project `ezxxvvmesegegkdeniri` for `dispatch-contribution-activity` (Task 3 file) and `contribution-nudges` (Task 4 file).

- [ ] **Step 4: Set `CRON_SECRET` on both new functions (manual dashboard step)**

Tell the user: go to Supabase Dashboard → Functions → `dispatch-contribution-activity` → Secrets, and set `CRON_SECRET` to the same plaintext value already configured for `unlock-capsules`. Repeat for `contribution-nudges`. This cannot be done via MCP tools (per CLAUDE.md's documented pattern for `unlock-capsules`' own secret) — wait for the user to confirm this is done before continuing, since without it the two new endpoints are unauthenticated in production.

- [ ] **Step 5: Verify both cron jobs are live**

```sql
select jobname, schedule, active from cron.job
where jobname in ('dispatch-contribution-activity', 'contribution-nudges');
```
(via `mcp__supabase__execute_sql` against production)

Expected: two active rows.

- [ ] **Step 6: Delete the test branch**

`mcp__supabase__delete_branch` for the branch created in Task 1, Step 2 — it's no longer needed now that production has the real thing.

- [ ] **Step 7: End-to-end verification — activity ping**

Using two real (or test) accounts that are both joined members of the same capsule:
1. From account A, upload 2–3 photos to the capsule in quick succession via the running app (`npx expo start --web` or a simulator, per this repo's dev commands).
2. Wait ~2–3 minutes.
3. Confirm account B receives a push (or, at minimum, sees a new `contribution_activity` card in the Alerts tab reading "`<A's name>` added N photos to `<capsule>`") without needing another manual refresh trigger beyond normal app usage.

- [ ] **Step 8: End-to-end verification — deadline nudge**

Via `mcp__supabase__execute_sql` against production, on a disposable test capsule (not a real user's data):
1. Set a test capsule's `contribution_lock_at` to `now() + interval '20 hours'` (inside the 1-day tier window) and confirm a joined, zero-upload test member's `contribution_nudge_1d_sent_at` is null.
2. Wait up to a minute for the cron tick.
3. Confirm a `contribution_nudge` notification row appears for that member (`select * from notifications where type = 'contribution_nudge' order by sent_at desc limit 5;`) and that `contribution_nudge_1d_sent_at` is now stamped on their `capsule_members` row.

- [ ] **Step 9: Update CLAUDE.md**

Invoke the `update-claude-md` skill to document this feature (new notification types, the two new crons/edge functions, the `contribution_activity_pending` table, and the new `capsule_members`/`notifications` columns) under a new "Contribution Nudges" section, following the existing style of the "Groups" / "Content Moderation" sections.

- [ ] **Step 10: Final commit**

```bash
git add CLAUDE.md
git commit -m "Document contribution-nudge notifications in CLAUDE.md"
```
