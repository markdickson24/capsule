# Capsule Start Date Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking. Per prior user instruction for this project: execution should use an Opus orchestrator dispatching Sonnet subagents per task, reviewing each before advancing.

**Goal:** Add an optional `contribution_start_at` date to capsules — the mirror image of the existing `contribution_lock_at` — so nobody (owner included) can add photos until it arrives, with visible countdown UI, near-term date presets, and a push notification the moment it starts.

**Architecture:** One new nullable pair of columns on `capsules`, enforced at both existing contribution-lock RLS layers (`media` INSERT, `storage.objects` INSERT), a new parameter on the existing `create_capsule_with_owner` RPC, a new self-contained per-minute cron+edge-function (mirroring `dispatch-contribution-activity`'s architecture), and UI changes across four screens.

**Tech Stack:** Postgres (migrations via `mcp__supabase__apply_migration`), Deno edge functions, `pg_cron`/`pg_net`, Expo push, React Native / `CreateScreen.tsx` / `EditCapsuleScreen.tsx` / `CapsuleDetailScreen.tsx` / `HomeScreen.tsx` / `NotificationsScreen.tsx`.

**Spec:** `docs/superpowers/specs/2026-07-16-capsule-start-date-design.md` — read this first.

## Global Constraints

- The user does not know SQL — every SQL statement below is complete and final; own full correctness yourself, verify by execution.
- Never apply a migration to the production Supabase project (`ezxxvvmesegegkdeniri`) without an explicit approval checkpoint (prior incident: a raw-SQL mistake against prod destroyed two live capsules). All schema/RLS/RPC work happens on an ephemeral Supabase branch first; only the final task touches production, and only after explicit user approval.
- **Before writing the `notifications_type_check` update, re-verify the current constraint against the live production DB** (`select conname, pg_get_constraintdef(oid) from pg_constraint where conname = 'notifications_type_check'`), not against git history — this codebase has a confirmed, recurring pattern of the live constraint carrying types not yet present in any committed migration. Reconcile against whatever's actually live.
- Every new SQL function that only a cron/trigger should call ends with `revoke execute on function ... from public, anon, authenticated;` — established convention, don't skip it.
- Every new SQL function body uses `set search_path to ''` with fully-schema-qualified names.
- The new edge function mirrors `dispatch-contribution-activity`'s exact shape: a locally-duplicated `sendExpoPush` helper (≤100/chunk), a `CRON_SECRET` env var check via `if (CRON_SECRET && auth !== \`Bearer ${CRON_SECRET}\`)` — do not import a shared helper, this codebase deliberately duplicates it per function.
- Project ref for all `net.http_post` URLs and Supabase MCP calls: `ezxxvvmesegegkdeniri`. Shared cron auth secret name in Vault: `cron_unlock_capsules_secret`.
- New branch: `feat/capsule-start-date` (already created from `origin/main`). Commit after each task.

---

### Task 1: Database schema, RLS, RPC, and notification type

**Files:**
- Create: `supabase/migrations/20260716120000_capsule_start_date.sql`

**Interfaces:**
- Produces: `capsules.contribution_start_at` (nullable timestamptz), `capsules.contribution_start_notified_at` (nullable timestamptz). `create_capsule_with_owner(...)` RPC gains an optional trailing parameter `p_contribution_start_at timestamptz DEFAULT NULL` — every existing caller (`CreateScreen`, `OnboardingScreen`) is unaffected since PostgREST maps `.rpc()` calls by parameter name, not position, and the new parameter defaults to NULL.

- [ ] **Step 1: Write the migration file**

```sql
-- Capsule start date: the mirror image of contribution_lock_at. Nobody
-- (owner included, deliberately different from contribution_lock_at's
-- existing owner exemption) can add photos before contribution_start_at.
-- See docs/superpowers/specs/2026-07-16-capsule-start-date-design.md.

alter table public.capsules
  add column contribution_start_at timestamptz,
  add column contribution_start_notified_at timestamptz;

-- ---------- media INSERT policy: add the start-date check ----------

drop policy "Contributors can upload media" on public.media;
create policy "Contributors can upload media"
  on public.media
  as permissive
  for insert
  to public
  with check (
    (select auth.uid()) = uploader_id
    and exists (
      select 1 from public.capsules c
      join public.capsule_members cm on cm.capsule_id = c.id
      where c.id = media.capsule_id
        and cm.user_id = (select auth.uid())
        and cm.role = any (array['owner', 'contributor'])
        and (c.contribution_lock_at is null or now() < c.contribution_lock_at)
        and (c.contribution_start_at is null or now() >= c.contribution_start_at)
    )
  );

-- ---------- storage.objects INSERT policy: same check, bucket-level ----------

drop policy "Contributors can upload to their capsules" on storage.objects;
create policy "Contributors can upload to their capsules"
  on storage.objects
  as permissive
  for insert
  to public
  with check (
    bucket_id = 'capsule-media'
    and exists (
      select 1 from public.capsules c
      join public.capsule_members cm on cm.capsule_id = c.id
      where (c.id)::text = (storage.foldername(objects.name))[1]
        and cm.user_id = (select auth.uid())
        and cm.role = any (array['owner', 'contributor'])
        and (c.contribution_lock_at is null or now() < c.contribution_lock_at)
        and (c.contribution_start_at is null or now() >= c.contribution_start_at)
    )
  );

-- ---------- create_capsule_with_owner: new optional parameter ----------

create or replace function public.create_capsule_with_owner(
  p_title text,
  p_description text,
  p_unlock_at timestamp with time zone,
  p_contribution_lock_at timestamp with time zone,
  p_unlock_mode text,
  p_superlative_voting_hours integer,
  p_owner_preview_locked boolean,
  p_occasion text,
  p_visibility text default 'invite'::text,
  p_group_id uuid default null::uuid,
  p_contribution_start_at timestamp with time zone default null
)
returns uuid
language plpgsql
security definer
set search_path to ''
as $function$
declare
  v_uid uuid := (select auth.uid());
  v_capsule_id uuid := gen_random_uuid();
begin
  if v_uid is null then
    raise exception 'Not authenticated';
  end if;

  insert into public.capsules (
    id, owner_id, title, description, unlock_at, contribution_lock_at,
    unlock_mode, superlative_voting_hours, owner_preview_locked, occasion,
    status, visibility, group_id, contribution_start_at
  ) values (
    v_capsule_id, v_uid, p_title, p_description, p_unlock_at, p_contribution_lock_at,
    p_unlock_mode, p_superlative_voting_hours, p_owner_preview_locked, p_occasion,
    'active', p_visibility, p_group_id, p_contribution_start_at
  );

  insert into public.capsule_members (capsule_id, user_id, role, joined_at)
  values (v_capsule_id, v_uid, 'owner', now());

  return v_capsule_id;
end;
$function$;

-- ---------- notifications: new type ----------
-- IMPORTANT: before running this on any real database, re-verify the actual
-- live list via:
--   select pg_get_constraintdef(oid) from pg_constraint where conname = 'notifications_type_check';
-- and reconcile the list below against it if they differ. The list below is
-- accurate as of 2026-07-16 verified against production.

alter table public.notifications drop constraint notifications_type_check;
alter table public.notifications add constraint notifications_type_check
  check (type in (
    'invite', 'unlock', 'contribution_nudge', 'milestone', 'reaction',
    'superlative_suggested', 'superlative_closing_soon', 'superlative_won',
    'friend_request', 'friend_accept', 'unlock_reminder', 'group_capsule',
    'group_capsule_upcoming', 'contribution_activity', 'capsule_started'
  ));
```

- [ ] **Step 2: Create an ephemeral Supabase branch for testing**

Use `mcp__supabase__create_branch` (project_id `ezxxvvmesegegkdeniri`, name `capsule-start-date-test`). Confirm cost if prompted. **Record the returned branch's project ref — every later test step in Tasks 1–2 reuses it.**

- [ ] **Step 3: Apply the migration to the branch**

`mcp__supabase__apply_migration`, `name: "20260716120000_capsule_start_date"`, SQL from Step 1.

- [ ] **Step 4: Verify the constraint and policies landed correctly**

```sql
select conname, pg_get_constraintdef(oid) from pg_constraint where conname = 'notifications_type_check';
select policyname, with_check from pg_policies where tablename = 'media' and policyname = 'Contributors can upload media';
select policyname, with_check from pg_policies where tablename = 'objects' and schemaname = 'storage' and policyname = 'Contributors can upload to their capsules';
```

Expected: the type list includes `capsule_started`; both `with_check` values include `c.contribution_start_at is null or now() >= c.contribution_start_at`.

- [ ] **Step 5: Seed fixtures and verify the RLS gate actually blocks a pre-start upload**

```sql
insert into auth.users (id, email, raw_user_meta_data)
values ('5ca75ca7-0000-4000-8000-000000000001', 'starttest@example.com', '{"display_name":"Start Test"}'::jsonb);

insert into public.capsules (id, owner_id, title, unlock_at, status, unlock_mode, contribution_start_at)
values ('5ca75ca7-c000-4000-8000-000000000001', '5ca75ca7-0000-4000-8000-000000000001',
        'Future Event', now() + interval '10 days', 'active', 'time', now() + interval '4 days');

insert into public.capsule_members (capsule_id, user_id, role, joined_at)
values ('5ca75ca7-c000-4000-8000-000000000001', '5ca75ca7-0000-4000-8000-000000000001', 'owner', now());
```

Then, to actually exercise RLS (not just check the policy text), call the `create_capsule_with_owner` RPC as the real authenticated user and confirm the new field round-trips, and separately confirm the media INSERT policy's WITH CHECK evaluates false for this row via a direct boolean check (RLS itself can only be exercised end-to-end as an authenticated request, not via the service-role `execute_sql` connection, which bypasses RLS entirely — so verify the *logic* directly):

```sql
select exists (
  select 1 from public.capsules c
  join public.capsule_members cm on cm.capsule_id = c.id
  where c.id = '5ca75ca7-c000-4000-8000-000000000001'
    and cm.user_id = '5ca75ca7-0000-4000-8000-000000000001'
    and cm.role = any (array['owner','contributor'])
    and (c.contribution_lock_at is null or now() < c.contribution_lock_at)
    and (c.contribution_start_at is null or now() >= c.contribution_start_at)
) as would_allow_upload;
```

Expected: `false` (contribution_start_at is 4 days out, so `now() >= contribution_start_at` is false). Then:

```sql
update public.capsules set contribution_start_at = now() - interval '1 hour'
where id = '5ca75ca7-c000-4000-8000-000000000001';
```

Re-run the same `would_allow_upload` query — expected: `true`.

- [ ] **Step 6: Verify `create_capsule_with_owner` accepts and stores the new field**

```sql
-- Simulate what the RPC does (can't call it directly as service role since
-- it requires auth.uid() from a real session) — verify the function body's
-- shape is correct by inspecting it, then verify via a real signed-in test
-- in Task 3's manual verification instead. For now, confirm the function
-- compiled and is callable:
select pg_get_functiondef(oid) from pg_proc where proname = 'create_capsule_with_owner';
```

Expected: the definition includes `p_contribution_start_at` and the `insert into public.capsules (...)` column list includes `contribution_start_at`.

- [ ] **Step 7: Commit**

```bash
git add supabase/migrations/20260716120000_capsule_start_date.sql
git commit -m "Add contribution_start_at schema, RLS enforcement, and RPC support"
```

---

### Task 2: Cron registration and `dispatch-capsule-start` edge function

**Files:**
- Create: `supabase/migrations/20260716120100_capsule_start_cron.sql`
- Create: `supabase/functions/dispatch-capsule-start/index.ts`

**Interfaces:**
- Consumes: `capsules.contribution_start_at`/`contribution_start_notified_at` (Task 1).
- Produces: pg_cron job `dispatch-capsule-start`, HTTP endpoint `/functions/v1/dispatch-capsule-start`.

- [ ] **Step 1: Write the edge function**

```ts
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const supabase = createClient(
  Deno.env.get('SUPABASE_URL')!,
  Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
);

const CRON_SECRET = Deno.env.get('CRON_SECRET');

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

Deno.serve(async (req) => {
  const auth = req.headers.get('Authorization');
  if (CRON_SECRET && auth !== `Bearer ${CRON_SECRET}`) {
    return new Response('Unauthorized', { status: 401 });
  }

  // Atomically claim every capsule whose start date has arrived and hasn't
  // been notified yet. UPDATE...RETURNING means an overlapping tick can't
  // double-send — a second call matches zero rows for already-claimed capsules.
  const { data: due, error } = await supabase
    .from('capsules')
    .update({ contribution_start_notified_at: new Date().toISOString() })
    .not('contribution_start_at', 'is', null)
    .lte('contribution_start_at', new Date().toISOString())
    .is('contribution_start_notified_at', null)
    .eq('status', 'active')
    .select('id, title');

  if (error) {
    return new Response(JSON.stringify({ error: 'Internal error' }), { status: 500 });
  }

  const messages: ExpoMessage[] = [];
  let notified = 0;

  for (const capsule of due ?? []) {
    const { data: members } = await supabase
      .from('capsule_members')
      .select('user_id, users(push_token)')
      .eq('capsule_id', capsule.id)
      .not('joined_at', 'is', null);

    const rows = (members ?? []).map((m: any) => ({
      user_id: m.user_id,
      capsule_id: capsule.id,
      type: 'capsule_started',
      pushed_at: new Date().toISOString(),
    }));
    if (rows.length) {
      await supabase.from('notifications').insert(rows);
      notified += rows.length;
    }

    for (const m of (members ?? []) as any[]) {
      const token = m.users?.push_token;
      if (token) {
        messages.push({
          to: token,
          title: '📸 Time to start adding photos',
          body: `"${capsule.title}" is open for photos now!`,
          data: { capsuleId: capsule.id },
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

- [ ] **Step 2: Deploy to the Task 1 branch**

`mcp__supabase__deploy_edge_function`, same branch project as Task 1, `name: "dispatch-capsule-start"`.

- [ ] **Step 3: Write the cron registration migration**

```sql
-- Registers the capsule-start cron (* * * * *, EXISTS-gated per
-- PERFORMANCE.md #4 — same pattern as every other per-minute cron). Auth:
-- CRON_SECRET, project-wide Edge Function secret (confirmed during the
-- contribution-nudges work — no per-function dashboard step needed; the
-- secret is already available to every function in this project).

select cron.schedule(
  'dispatch-capsule-start',
  '* * * * *',
  $cron$
    select net.http_post(
      url := 'https://ezxxvvmesegegkdeniri.supabase.co/functions/v1/dispatch-capsule-start',
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
      select 1 from public.capsules
      where contribution_start_at is not null
        and contribution_start_at <= now()
        and contribution_start_notified_at is null
        and status = 'active'
    );
  $cron$
);
```

- [ ] **Step 4: Apply to the Task 1 branch**

`mcp__supabase__apply_migration`, `name: "20260716120100_capsule_start_cron"`.

- [ ] **Step 5: Verify registration**

```sql
select jobname, schedule, active from cron.job where jobname = 'dispatch-capsule-start';
```

Expected: one row, `schedule = '* * * * *'`, `active = true`.

- [ ] **Step 6: End-to-end test against the Task 1 fixture capsule**

The Task 1, Step 5 fixture capsule already has `contribution_start_at` in the past (set at the end of that step). Invoke directly:

```bash
curl -s -X POST "https://<branch-project-ref>.supabase.co/functions/v1/dispatch-capsule-start"
```

(No `Authorization` header needed on the branch — `CRON_SECRET` is unset there.)

Expected JSON: `{"claimed":1,"notified":1}` (the one fixture owner).

- [ ] **Step 7: Verify the notification row and dedup stamp**

```sql
select user_id, capsule_id, type, pushed_at from public.notifications where type = 'capsule_started';
select contribution_start_notified_at from public.capsules where id = '5ca75ca7-c000-4000-8000-000000000001';
```

Expected: one notification row for the fixture owner; `contribution_start_notified_at` is now set (non-null).

- [ ] **Step 8: Verify idempotency**

```bash
curl -s -X POST "https://<branch-project-ref>.supabase.co/functions/v1/dispatch-capsule-start"
```

Expected: `{"claimed":0,"notified":0}` — the capsule is already stamped.

- [ ] **Step 9: Commit**

```bash
git add supabase/migrations/20260716120100_capsule_start_cron.sql supabase/functions/dispatch-capsule-start/index.ts
git commit -m "Add dispatch-capsule-start cron and edge function"
```

---

### Task 3: `CreateScreen` — Start Date field

**Files:**
- Modify: `src/components/DatePicker.tsx`
- Modify: `src/screens/app/CreateScreen.tsx`

**Interfaces:**
- Produces (consumed by Task 4): `START_DATE_QUICK_OPTIONS: QuickOption[]` exported from `src/components/DatePicker.tsx`.

- [ ] **Step 1: Add the new preset export to `DatePicker.tsx`**

In `src/components/DatePicker.tsx`, immediately after the existing `QUICK_OPTIONS` constant (after the closing `];` around line 43), add:

```ts
// Near-term presets for the capsule Start Date field — the default
// QUICK_OPTIONS above (Tomorrow/1 week/1 month/3 months) skew too far out
// for "this weekend" event-planning use cases.
function nextWeekend(): Date {
  const d = new Date();
  const daysUntilSat = (6 - d.getDay() + 7) % 7;
  d.setDate(d.getDate() + daysUntilSat);
  d.setHours(12, 0, 0, 0);
  return d;
}

export const START_DATE_QUICK_OPTIONS: QuickOption[] = [
  { label: 'Tomorrow', icon: 'sunny-outline', getDate: () => addDays(1) },
  { label: 'This weekend', icon: 'calendar-outline', getDate: nextWeekend },
  { label: 'In 3 days', icon: 'time-outline', getDate: () => addDays(3) },
  { label: '1 week', icon: 'calendar-number-outline', getDate: () => addDays(7) },
];
```

- [ ] **Step 2: Verify `nextWeekend()` logic with a quick manual script**

Run: `cd /Users/markdickson/Desktop/capsule && npx tsx -e "
function nextWeekend(base) {
  const d = new Date(base);
  const daysUntilSat = (6 - d.getDay() + 7) % 7;
  d.setDate(d.getDate() + daysUntilSat);
  return d.getDay();
}
// Every day of the week should map to Saturday (6)
for (let dow = 0; dow < 7; dow++) {
  const base = new Date(2026, 0, 4 + dow); // Jan 4 2026 is a Sunday
  console.log(dow, '->', nextWeekend(base));
}
"`

Expected: every line prints `-> 6` (Saturday), confirming the function always lands on Saturday regardless of the starting weekday, including when the starting day already is Saturday (should map to itself, 0 days added).

- [ ] **Step 3: Add state, imports, and validation to `CreateScreen.tsx`**

Add to the import line for `DatePickerField`:
```ts
import DatePickerField, { START_DATE_QUICK_OPTIONS } from '../../components/DatePicker';
```

Add new state, right after the existing `contribLockDate` state (around line 63):
```ts
  const [contribLockDate, setContribLockDate] = useState<Date | null>(null);
  const [startDate, setStartDate] = useState<Date | null>(null);
```

Extend the `FieldErrors` type (around line 76-79):
```ts
  type FieldErrors = {
    title?: string; description?: string; unlockDate?: string; startDate?: string;
    contribLockDate?: string; votingHours?: string; general?: string;
  };
```

Add validation in `handleCreate`, inside the `if (unlockMode !== 'proximity')` block, right after the existing `unlockDate <= new Date()` check and before the `contribLockDate` check (around line 130):
```ts
      if (unlockDate <= new Date()) {
        setErrors({ unlockDate: 'Unlock date must be in the future.' });
        scrollToField('unlockDate');
        return;
      }
      if (startDate && startDate >= unlockDate) {
        setErrors({ startDate: 'Start date must be before the unlock date.' });
        scrollToField('startDate');
        return;
      }
      if (contribLockDate && contribLockDate >= unlockDate) {
        setAdvancedOpen(true);
        setErrors({ contribLockDate: 'Uploads deadline must be before the unlock date.' });
        scrollToField('contribLockDate');
        return;
      }
      if (startDate && contribLockDate && startDate >= contribLockDate) {
        setAdvancedOpen(true);
        setErrors({ startDate: 'Start date must be before the uploads deadline.' });
        scrollToField('startDate');
        return;
      }
```

Note: `startDate`/`contribLockDate` validation is placed *outside* the `unlockMode !== 'proximity'` gate's dependency on `unlockDate` being non-null where needed — both new checks above are already inside that block (guarded by the surrounding `if (unlockMode !== 'proximity')`), which is correct since `startDate` is independent of `unlockMode` but its comparison against `unlockDate` only makes sense when `unlockDate` exists (proximity capsules don't have a real unlock date to compare against — the field still renders for proximity capsules per Step 4 below, just isn't validated against a date that doesn't functionally exist for that mode).

Thread the new field into the RPC call (around line 158-169):
```ts
    const { data: capsuleId, error: capsuleError } = await supabase.rpc('create_capsule_with_owner', {
      p_title: title.trim(),
      p_description: description.trim() || null,
      p_unlock_at: (unlockDate ?? defaultUnlockDate()).toISOString(),
      p_contribution_lock_at: contribLockDate?.toISOString() ?? null,
      p_unlock_mode: unlockMode,
      p_superlative_voting_hours: votingHours,
      p_owner_preview_locked: hideFromMe,
      p_occasion: occasion,
      p_visibility: 'invite',
      p_group_id: groupId ?? null,
      p_contribution_start_at: startDate?.toISOString() ?? null,
    });
```

- [ ] **Step 4: Add the field to the JSX, above the fold**

Replace:
```tsx
        {unlockMode !== 'proximity' && (
          <View onLayout={recordFieldY('unlockDate')}>
            <DatePickerField label="Unlock Date" value={unlockDate} onChange={setUnlockDate} contextLabel="Capsule unlocks for everyone" />
            {errors.unlockDate ? <Text style={styles.fieldError}>{errors.unlockDate}</Text> : null}
          </View>
        )}
```
with:
```tsx
        <View onLayout={recordFieldY('startDate')}>
          <DatePickerField
            label="Starts"
            optional
            value={startDate}
            onChange={setStartDate}
            contextLabel="No one can add photos until this date"
            quickOptions={START_DATE_QUICK_OPTIONS}
            tooltip={{
              title: 'Start Date',
              body: 'Nobody — including you — can add photos or videos until this date arrives. Useful for planning a capsule ahead of an event or trip that hasn\'t happened yet.\n\nLeave it off to let people start adding photos right away.',
            }}
          />
          {errors.startDate ? <Text style={styles.fieldError}>{errors.startDate}</Text> : null}
        </View>

        {unlockMode !== 'proximity' && (
          <View onLayout={recordFieldY('unlockDate')}>
            <DatePickerField label="Unlock Date" value={unlockDate} onChange={setUnlockDate} contextLabel="Capsule unlocks for everyone" />
            {errors.unlockDate ? <Text style={styles.fieldError}>{errors.unlockDate}</Text> : null}
          </View>
        )}
```

This renders the Start field unconditionally (unlike Unlock Date, which is hidden for `proximity` mode) — `contribution_start_at` is independent of `unlock_mode`, per the spec.

- [ ] **Step 5: Typecheck**

Run: `cd /Users/markdickson/Desktop/capsule && npx tsc --noEmit 2>&1 | grep -E "CreateScreen|DatePicker"`
Expected: no output (no errors in either file). Note: this will show errors if `src/types/supabase.ts` hasn't been regenerated yet to include the new columns — if so, this is expected until Task 1's type regeneration; re-run after confirming `Tables<'capsules'>` includes `contribution_start_at` (see Task 1 note — regenerate via `mcp__supabase__generate_typescript_types` against the Task 1 branch if not already done, and copy the resulting `capsules` type shape into `src/types/supabase.ts` locally, OR run the full regeneration now if it wasn't done as part of Task 1).

- [ ] **Step 6: Commit**

```bash
git add src/components/DatePicker.tsx src/screens/app/CreateScreen.tsx
git commit -m "Add Start Date field to CreateScreen"
```

---

### Task 4: `EditCapsuleScreen` — Start Date field

**Files:**
- Modify: `src/screens/app/EditCapsuleScreen.tsx`

**Interfaces:**
- Consumes: `START_DATE_QUICK_OPTIONS` (Task 3).

- [ ] **Step 1: Add import, state, load, validation, and save logic**

Update the import:
```ts
import DatePickerField, { START_DATE_QUICK_OPTIONS } from '../../components/DatePicker';
```

Add state after `contribLockDate` (around line 44):
```ts
  const [contribLockDate, setContribLockDate] = useState<Date | null>(null);
  const [startDate, setStartDate] = useState<Date | null>(null);
```

Update the select and load logic in `loadCapsule` (around line 60-73):
```ts
    const { data, error: err } = await supabase
      .from('capsules')
      .select('id, owner_id, title, description, status, unlock_at, contribution_lock_at, contribution_start_at, unlock_mode, superlative_voting_hours')
      .eq('id', capsuleId)
      .single();

    if (err || !data) { navigation.goBack(); return; }
    if ((data as any).owner_id !== session.user.id) { navigation.goBack(); return; }
    if ((data as any).status === 'unlocked') { navigation.goBack(); return; }

    setTitle((data as any).title);
    setDescription((data as any).description ?? '');
    setUnlockDate(new Date((data as any).unlock_at));
    setContribLockDate(
      (data as any).contribution_lock_at ? new Date((data as any).contribution_lock_at) : null
    );
    setStartDate(
      (data as any).contribution_start_at ? new Date((data as any).contribution_start_at) : null
    );
```

Add validation in `handleSave`, right after the `unlockDate <= new Date()` check and before the `contribLockDate` check (around line 92):
```ts
      if (unlockDate <= new Date()) { setError('Unlock date must be in the future.'); return; }
      if (startDate && startDate >= unlockDate) {
        setError('Start date must be before the unlock date.');
        return;
      }
      if (contribLockDate && contribLockDate >= unlockDate) {
        setError('Contribution lock must be before the unlock date.');
        return;
      }
      if (startDate && contribLockDate && startDate >= contribLockDate) {
        setError('Start date must be before the uploads deadline.');
        return;
      }
```

Update the `.update()` call (around line 106-113):
```ts
      .update({
        title: title.trim(),
        description: description.trim() || null,
        unlock_at: (unlockDate ?? new Date()).toISOString(),
        contribution_lock_at: contribLockDate?.toISOString() ?? null,
        contribution_start_at: startDate?.toISOString() ?? null,
        unlock_mode: unlockMode,
        superlative_voting_hours: votingHours,
      })
```

- [ ] **Step 2: Add the field to the JSX**

Replace:
```tsx
        {unlockMode !== 'proximity' && (
          <DatePickerField label="Unlock Date" value={unlockDate} onChange={setUnlockDate} contextLabel="Capsule unlocks for everyone" />
        )}
        <DatePickerField label="Uploads Deadline" optional value={contribLockDate} onChange={setContribLockDate} contextLabel="No one can add photos after this date" />
```
with:
```tsx
        <DatePickerField
          label="Starts"
          optional
          value={startDate}
          onChange={setStartDate}
          contextLabel="No one can add photos until this date"
          quickOptions={START_DATE_QUICK_OPTIONS}
        />
        {unlockMode !== 'proximity' && (
          <DatePickerField label="Unlock Date" value={unlockDate} onChange={setUnlockDate} contextLabel="Capsule unlocks for everyone" />
        )}
        <DatePickerField label="Uploads Deadline" optional value={contribLockDate} onChange={setContribLockDate} contextLabel="No one can add photos after this date" />
```

(No `tooltip` here, matching this screen's existing simpler pattern for `contribLockDate` — no tooltip on that field either.)

- [ ] **Step 3: Typecheck**

Run: `npx tsc --noEmit 2>&1 | grep "EditCapsuleScreen"`
Expected: no output.

- [ ] **Step 4: Commit**

```bash
git add src/screens/app/EditCapsuleScreen.tsx
git commit -m "Add Start Date field to EditCapsuleScreen"
```

---

### Task 5: `CapsuleDetailScreen` — pre-start upload gate and card

**Files:**
- Modify: `src/screens/app/CapsuleDetailScreen.tsx`

- [ ] **Step 1: Add `contribution_start_at` to the capsule select query**

Replace (around line 1319):
```ts
      supabase.from('capsules').select('id, owner_id, title, description, status, unlock_at, unlock_mode, owner_preview_locked, contribution_lock_at, created_at, archived_at, occasion, superlative_voting_closes_at, superlative_voting_finalized_at').eq('id', capsuleId).single(),
```
with:
```ts
      supabase.from('capsules').select('id, owner_id, title, description, status, unlock_at, unlock_mode, owner_preview_locked, contribution_lock_at, contribution_start_at, created_at, archived_at, occasion, superlative_voting_closes_at, superlative_voting_finalized_at').eq('id', capsuleId).single(),
```

- [ ] **Step 2: Compute `notStartedYet` and update `canUpload`**

Replace (around line 1520-1523):
```ts
  const contributionLocked = capsule.contribution_lock_at
    ? new Date(capsule.contribution_lock_at) <= new Date()
    : false;
  const canUpload = isOwner || (myRole === 'contributor' && !contributionLocked);
```
with:
```ts
  const contributionLocked = capsule.contribution_lock_at
    ? new Date(capsule.contribution_lock_at) <= new Date()
    : false;
  // Unlike contributionLocked (owner-exempt, by design — see CLAUDE.md),
  // the start-date gate applies to everyone including the owner: the whole
  // premise is that the event hasn't happened yet, so there's nothing real
  // for anyone to upload before then.
  const notStartedYet = capsule.contribution_start_at
    ? new Date(capsule.contribution_start_at) > new Date()
    : false;
  const canUpload = !notStartedYet && (isOwner || (myRole === 'contributor' && !contributionLocked));
```

- [ ] **Step 3: Add the pre-start card, right before the upload area**

Replace (around line 1804-1806):
```tsx
        {/* Upload controls */}
        {canUpload && (
          <View style={styles.uploadArea}>
```
with:
```tsx
        {/* Pre-start card — shown instead of upload controls when the
            capsule's start date hasn't arrived yet. */}
        {notStartedYet && (myRole === 'contributor' || isOwner) && (
          <View style={styles.startsBox}>
            <Ionicons name="calendar-outline" size={28} color="#555555" />
            <Text style={styles.startsText}>
              Capsule starts {new Date(capsule.contribution_start_at!).toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' })}
            </Text>
            <Text style={styles.startsHint}>Photos can be added once it starts</Text>
          </View>
        )}

        {/* Upload controls */}
        {canUpload && (
          <View style={styles.uploadArea}>
```

- [ ] **Step 4: Add the new styles**

In the `StyleSheet.create({...})` block near the bottom of the file, right after the existing `lockedBox`/`lockedText`/`lockedHint`/`lockedCount` style entries (around line 2194-2200), add:
```ts
  startsBox: {
    alignItems: 'center', justifyContent: 'center', gap: 8,
    paddingVertical: 32, paddingHorizontal: 24,
  },
  startsText: { fontSize: 15, color: '#888888', textAlign: 'center', fontWeight: '600' },
  startsHint: { fontSize: 13, color: '#888888', textAlign: 'center' },
```

- [ ] **Step 5: Typecheck**

Run: `npx tsc --noEmit 2>&1 | grep "CapsuleDetailScreen"`
Expected: no output.

- [ ] **Step 6: Commit**

```bash
git add src/screens/app/CapsuleDetailScreen.tsx
git commit -m "Show pre-start card and block uploads before contribution_start_at"
```

---

### Task 6: `HomeScreen` — "Starts in N days" countdown badge

**Files:**
- Modify: `src/screens/app/HomeScreen.tsx`

- [ ] **Step 1: Add `contribution_start_at` to the capsules query**

Replace (around line 207):
```ts
        .select('capsule_id, archived_at, capsules(id, owner_id, title, description, status, unlock_at, unlock_mode)')
```
with:
```ts
        .select('capsule_id, archived_at, capsules(id, owner_id, title, description, status, unlock_at, unlock_mode, contribution_start_at)')
```

- [ ] **Step 2: Extend `CountdownBadge` with the pre-start branch**

Replace (around line 36-45):
```tsx
function CountdownBadge({ unlockAt, status, unlockMode }: { unlockAt: string; status: string; unlockMode?: string }) {
  const { accentColor } = useTheme();
  const [timeLeft, setTimeLeft] = useState(() => getTimeLeft(unlockAt));

  useEffect(() => {
    if (status === 'unlocked') return;
    const id = setInterval(() => setTimeLeft(getTimeLeft(unlockAt)), 60_000);
    return () => clearInterval(id);
  }, [unlockAt, status]);

  if (status === 'unlocked') return (
```
with:
```tsx
function CountdownBadge({ unlockAt, status, unlockMode, contributionStartAt }: { unlockAt: string; status: string; unlockMode?: string; contributionStartAt?: string | null }) {
  const { accentColor } = useTheme();
  const notStartedYet = !!contributionStartAt && status !== 'unlocked' && new Date(contributionStartAt) > new Date();
  // Whichever date is the "active" countdown target right now — reusing one
  // timeLeft/interval pair for both phases (rather than computing the
  // pre-start countdown fresh at every render) keeps it live-ticking the
  // same way the unlock countdown already does, and the `targetDate`
  // dependency below means the moment notStartedYet flips false (start
  // date passes), the effect re-runs and immediately recomputes for the
  // unlock date instead — no stale label in between.
  const targetDate = notStartedYet ? contributionStartAt! : unlockAt;
  const [timeLeft, setTimeLeft] = useState(() => getTimeLeft(targetDate));

  useEffect(() => {
    if (status === 'unlocked') return;
    setTimeLeft(getTimeLeft(targetDate));
    const id = setInterval(() => setTimeLeft(getTimeLeft(targetDate)), 60_000);
    return () => clearInterval(id);
  }, [targetDate, status]);

  if (notStartedYet) {
    const { daysLeft, hoursLeft } = timeLeft;
    const label = daysLeft > 0 ? `Starts in ${daysLeft}d` : `Starts in ${hoursLeft}h`;
    return (
      <View style={styles.togetherBadge}>
        <Ionicons name="calendar-outline" size={13} color={accentColor} />
        <Text style={[styles.togetherBadgeText, { color: accentColor }]} maxFontSizeMultiplier={1.3}> {label}</Text>
      </View>
    );
  }

  if (status === 'unlocked') return (
```

This reuses the existing `togetherBadge`/`togetherBadgeText` styles (already used for the proximity "Unlocks together" badge) rather than adding new styles — same visual treatment, different icon/copy, checked *before* the `status === 'unlocked'` branch since an unlocked capsule can never still be pre-start (if it unlocked, its start date necessarily already passed).

- [ ] **Step 3: Pass the new prop at the call site**

Replace (around line 87):
```tsx
          <CountdownBadge unlockAt={capsule.unlock_at} status={capsule.status} unlockMode={capsule.unlock_mode} />
```
with:
```tsx
          <CountdownBadge unlockAt={capsule.unlock_at} status={capsule.status} unlockMode={capsule.unlock_mode} contributionStartAt={(capsule as any).contribution_start_at} />
```

- [ ] **Step 4: Typecheck**

Run: `npx tsc --noEmit 2>&1 | grep "HomeScreen"`
Expected: no output.

- [ ] **Step 5: Commit**

```bash
git add src/screens/app/HomeScreen.tsx
git commit -m "Show 'Starts in N days' badge on Home before contribution_start_at"
```

---

### Task 7: `NotificationsScreen` — render `capsule_started`

**Files:**
- Modify: `src/screens/app/NotificationsScreen.tsx`

- [ ] **Step 1: Add the new type to the union**

Replace (around line 42-44):
```ts
    | 'group_capsule_upcoming'
    | 'contribution_activity'
    | 'contribution_nudge';
```
with:
```ts
    | 'group_capsule_upcoming'
    | 'contribution_activity'
    | 'contribution_nudge'
    | 'capsule_started';
```

- [ ] **Step 2: Add to `isCapsuleNav`**

Replace (around line 69, the `type === 'contribution_nudge'` line closing the function):
```ts
    type === 'contribution_nudge'
  );
}
```
with:
```ts
    type === 'contribution_nudge' ||
    type === 'capsule_started'
  );
}
```

- [ ] **Step 3: Add icon and color**

Replace (around line 470, the `contribution_nudge` icon line):
```tsx
                    : item.type === 'contribution_nudge' ? 'hourglass-outline'
                    : 'cube-outline'
```
with:
```tsx
                    : item.type === 'contribution_nudge' ? 'hourglass-outline'
                    : item.type === 'capsule_started' ? 'camera-outline'
                    : 'cube-outline'
```

Replace (around line 483, the `contribution_nudge` color line):
```tsx
                    : item.type === 'contribution_nudge' ? accentColor
                    : SUPERLATIVE_TYPES.includes(item.type) ? accentColor
```
with:
```tsx
                    : item.type === 'contribution_nudge' ? accentColor
                    : item.type === 'capsule_started' ? accentColor
                    : SUPERLATIVE_TYPES.includes(item.type) ? accentColor
```

- [ ] **Step 4: Add copy**

Replace (around line 550-558, right before the final `) : (` fallback for the invite copy):
```tsx
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
with:
```tsx
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
                    ) : item.type === 'capsule_started' ? (
                      <>
                        <Text style={styles.cardCapsuleTitle}>{item.capsules?.title ?? 'Your capsule'}</Text>
                        {' is open for photos now'}
                      </>
                    ) : (
```

(Note: the exact surrounding text must be matched from the live file, not assumed — the two curly-quote escapes above are shown as literal `’` here for exact-match safety in this plan document, but the live file uses literal `’` characters directly in the JSX text, as written in Task 5/contribution-nudges' earlier work this session. Match whatever the live file actually contains character-for-character when making this edit — use the Edit tool's exact-string matching against the real file content, not this plan's rendering of it.)

- [ ] **Step 5: Typecheck**

Run: `npx tsc --noEmit 2>&1 | grep "NotificationsScreen"`
Expected: only the pre-existing, unrelated `@expo/vector-icons` module-resolution error (confirmed harmless earlier this session) — no new errors.

- [ ] **Step 6: Commit**

```bash
git add src/screens/app/NotificationsScreen.tsx
git commit -m "Render capsule_started notifications"
```

---

### Task 8: Production rollout, type regeneration, and end-to-end verification

**Files:** `src/types/supabase.ts` (regenerated, not hand-edited) plus `CLAUDE.md`.

- [ ] **Step 1: Stop and get explicit user approval before touching production**

State plainly what will be applied: the Task 1 and Task 2 migrations, and the Task 2 edge function, to the production project `ezxxvvmesegegkdeniri`. Wait for a clear go-ahead — do not proceed on assumption.

- [ ] **Step 2: Apply the two migrations to production, in order**

`mcp__supabase__apply_migration`:
1. `name: "20260716120000_capsule_start_date"` — but first, re-run the live-constraint check from Task 1's caution note against **production** (not the branch) and reconcile the `notifications_type_check` list if it's drifted further since Task 1 was written.
2. `name: "20260716120100_capsule_start_cron"`.

- [ ] **Step 3: Deploy the edge function to production**

`mcp__supabase__deploy_edge_function`, project `ezxxvvmesegegkdeniri`, `name: "dispatch-capsule-start"`.

- [ ] **Step 4: Verify the cron is live**

```sql
select jobname, schedule, active from cron.job where jobname = 'dispatch-capsule-start';
```
Expected: one active row.

- [ ] **Step 5: Verify the new endpoint enforces auth** (mirrors the check already done for the contribution-nudges functions — `CRON_SECRET` is a project-wide Edge Function secret, already available)

```bash
curl -s -o /dev/null -w "%{http_code}\n" -X POST "https://ezxxvvmesegegkdeniri.supabase.co/functions/v1/dispatch-capsule-start" -H "Authorization: Bearer definitely-not-the-real-secret"
```
Expected: `401`.

- [ ] **Step 6: Regenerate TypeScript types from production**

Use `mcp__supabase__generate_typescript_types` against project `ezxxvvmesegegkdeniri`, and write the result to `src/types/supabase.ts` (overwrite the existing generated file — this is a generated artifact, not hand-maintained). Confirm `Tables<'capsules'>` now includes `contribution_start_at` and `contribution_start_notified_at`.

- [ ] **Step 7: Full typecheck**

Run: `npx tsc --noEmit 2>&1 | grep -v "@expo/vector-icons\|Cannot find name 'Deno'\|Cannot find module 'https://esm.sh"`
Expected: no output (all pre-existing, already-confirmed-harmless errors filtered out; zero new errors from this feature across all touched files).

- [ ] **Step 8: Delete the ephemeral test branch**

`mcp__supabase__delete_branch` for the branch created in Task 1, Step 2.

- [ ] **Step 9: End-to-end verification in the running app**

Per the `verify` skill: `npx expo start --web` (or a simulator). Using the demo accounts from the earlier marketing-screenshots work (or any real test account):
1. Create a capsule with a Start Date ~2 minutes in the future and an Unlock Date further out.
2. Confirm the Home card shows "Starts in..." and `CapsuleDetail` shows the pre-start card in place of the upload button (for both owner and a contributor).
3. Wait for the start time to pass; confirm the pre-start card disappears and the "+ Add Photos" button appears.
4. Confirm a `capsule_started` notification arrives (in-app and, if push token is configured, as a push) within a minute of the start time passing.

- [ ] **Step 10: Update CLAUDE.md**

Invoke the `update-claude-md` skill to document `contribution_start_at` alongside the existing `contribution_lock_at` documentation (Key RLS Constraints section), the new `capsule_started` notification type, the `dispatch-capsule-start` cron, and the `CreateScreen`/`EditCapsuleScreen` field additions.

- [ ] **Step 11: Final commit**

```bash
git add src/types/supabase.ts CLAUDE.md
git commit -m "Regenerate Supabase types and document capsule start date in CLAUDE.md"
```
