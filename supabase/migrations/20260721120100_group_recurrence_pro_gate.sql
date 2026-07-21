-- Gate recurring group creation behind Capsule Pro inside create_group_with_creator.
-- A free creator may only make 'manual' groups; any real recurrence
-- (weekly/monthly/yearly) requires Pro. Server-side hard gate; the client also
-- pre-checks and shows the paywall. Signature UNCHANGED (11 params) so create or
-- replace adds no overload. Base body is the live definition with one guard added.
create or replace function public.create_group_with_creator(
  p_name text,
  p_recurrence_interval text,
  p_unlock_duration_hours integer,
  p_next_capsule_at timestamp with time zone default null::timestamp with time zone,
  p_anchor_weekday integer default null::integer,
  p_anchor_day_of_month integer default null::integer,
  p_anchor_month integer default null::integer,
  p_anchor_day integer default null::integer,
  p_anchor_hour integer default null::integer,
  p_anchor_minute integer default null::integer,
  p_reminder_lead_hours integer default null::integer
)
returns uuid
language plpgsql
security definer
set search_path to ''
as $function$
declare
  v_uid uuid := (select auth.uid());
  v_group_id uuid := gen_random_uuid();
begin
  if v_uid is null then
    raise exception 'Not signed in';
  end if;

  -- Recurring groups (auto-creating capsules on a schedule) are a Capsule Pro
  -- feature; 'manual' groups stay free. Keep in sync with the client gate in
  -- CreateGroupScreen and src/lib/tierLimits.ts.
  if p_recurrence_interval <> 'manual'
     and (select subscription_tier from public.users where id = v_uid) = 'free' then
    raise exception 'GROUP_RECURRENCE_PRO';
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
$function$;

-- Re-assert least-privilege grants (idempotent; matches the established pattern).
revoke all on function public.create_group_with_creator(
  text, text, int, timestamptz, int, int, int, int, int, int, int
) from public, anon;
grant execute on function public.create_group_with_creator(
  text, text, int, timestamptz, int, int, int, int, int, int, int
) to authenticated;
