-- GROUPS.md #1 — close the group_members self-insert privilege escalation.
--
-- The original INSERT policy (20260625000000_groups.sql) allowed two paths:
--   (a) the group creator adding anyone, OR
--   (b) `user_id = auth.uid()` — i.e. ANYONE adding THEMSELVES to ANY group.
--
-- Arm (b) was copied from capsule_members' self-join pattern, but groups have
-- no join/share flow — no client code self-inserts into group_members. And the
-- group UUID is not secret: capsules.group_id is a plain selectable column on
-- every group-created capsule, and get_my_capsule_ids() includes PENDING
-- memberships, so anyone merely invited to a single group capsule could read
-- the group_id, self-insert into the group, and thereafter be auto-joined into
-- every future recurring capsule. Drop arm (b); creator-adds-members is the
-- only flow the app performs.

-- Uses is_group_creator() (an out-of-band helper already live on this table's
-- other policies — captured verbatim in this migration since it existed in no
-- prior migration file) rather than the raw correlated subquery, so this
-- policy's style matches its siblings.
drop policy if exists "Creator can add members" on public.group_members;

create or replace function public.is_group_creator(p_group_id uuid)
returns boolean
language sql
stable
security definer
set search_path to 'public'
as $function$
  select exists(
    select 1 from groups where id = p_group_id and created_by = (select auth.uid())
  );
$function$;

create policy "Creator can add members" on public.group_members
  for insert with check (is_group_creator(group_id));
