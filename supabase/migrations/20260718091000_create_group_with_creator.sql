-- Atomic group creation.
--
-- GROUPS.md #3: createGroup() (src/lib/groups.ts) did a `groups` insert
-- followed by the creator's `group_members` insert as two separate client
-- requests. If the second insert failed, the `groups` row was left behind
-- with zero members — and since the groups SELECT policy
-- ("Members can view groups") goes through get_my_group_ids(), which is
-- membership-based, that orphaned group became permanently invisible to
-- everyone, including its own creator. Same class of bug as the production
-- orphan-capsule incident that create_capsule_with_owner
-- (20260711160000_atomic_capsule_create.sql) fixed for capsules.
--
-- create_group_with_creator does both inserts inside one PL/pgSQL function
-- body. Postgres rolls back a function's entire effect if it raises partway
-- through, so a group_members failure now undoes the groups insert too — no
-- orphan can be created via this path. SECURITY DEFINER for the same reason
-- create_capsule_with_owner needs it: the caller isn't a group_members row
-- yet when the group itself is inserted, and the groups INSERT policy
-- ("Creator can insert groups") only checks auth.uid() = created_by, which
-- this function satisfies directly rather than relying on RLS timing.

create or replace function public.create_group_with_creator(
  p_name text,
  p_recurrence_interval text,
  p_unlock_duration_hours int,
  p_next_capsule_at timestamptz default null,
  p_anchor_weekday int default null,
  p_anchor_day_of_month int default null,
  p_anchor_month int default null,
  p_anchor_day int default null,
  p_anchor_hour int default null,
  p_anchor_minute int default null,
  p_reminder_lead_hours int default null
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := (select auth.uid());
  v_group_id uuid := gen_random_uuid();
begin
  if v_uid is null then
    raise exception 'Not signed in';
  end if;

  insert into public.groups (
    id, name, created_by, recurrence_interval, unlock_duration_hours,
    next_capsule_at, anchor_weekday, anchor_day_of_month, anchor_month,
    anchor_day, anchor_hour, anchor_minute, reminder_lead_hours
  ) values (
    v_group_id, p_name, v_uid, p_recurrence_interval, p_unlock_duration_hours,
    p_next_capsule_at, p_anchor_weekday, p_anchor_day_of_month, p_anchor_month,
    p_anchor_day, p_anchor_hour, p_anchor_minute, p_reminder_lead_hours
  );

  insert into public.group_members (group_id, user_id)
  values (v_group_id, v_uid);

  return v_group_id;
end;
$$;

-- Supabase's default privileges grant EXECUTE on newly created functions to
-- PUBLIC (which includes anon), so revoking from public alone would still
-- leave anon able to call this. Revoke both explicitly, then grant only to
-- authenticated.
revoke all on function public.create_group_with_creator(
  text, text, int, timestamptz, int, int, int, int, int, int, int
) from public;
revoke execute on function public.create_group_with_creator(
  text, text, int, timestamptz, int, int, int, int, int, int, int
) from anon;
grant execute on function public.create_group_with_creator(
  text, text, int, timestamptz, int, int, int, int, int, int, int
) to authenticated;
