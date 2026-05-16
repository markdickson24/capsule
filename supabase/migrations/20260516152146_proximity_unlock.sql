-- GPS proximity unlock — Phase 1: schema + check-in RPC.
--
-- A capsule can unlock by date ('time'), by all members being physically
-- together ('proximity'), or both. Proximity capsules unlock when every
-- joined member checks in their location within a short window and they
-- are all within the capsule's radius of each other.

-- capsules: per-capsule unlock mode + proximity radius (metres)
alter table public.capsules
  add column unlock_mode text not null default 'time'
    check (unlock_mode in ('time', 'proximity', 'both'));
alter table public.capsules
  add column proximity_radius_m integer not null default 100;

-- capsule_members: each member's most recent location check-in
alter table public.capsule_members add column checkin_lat double precision;
alter table public.capsule_members add column checkin_lng double precision;
alter table public.capsule_members add column checkin_at  timestamptz;

-- Haversine distance in metres between two lat/lng points.
create or replace function public._haversine_m(
  lat1 double precision, lng1 double precision,
  lat2 double precision, lng2 double precision
) returns double precision
language sql
immutable
set search_path = ''
as $$
  select 2 * 6371000 * asin(sqrt(
    power(sin(radians(lat2 - lat1) / 2), 2) +
    cos(radians(lat1)) * cos(radians(lat2)) *
    power(sin(radians(lng2 - lng1) / 2), 2)
  ));
$$;

-- Records the caller's location check-in for a capsule, then unlocks the
-- capsule if every joined member has checked in within the last 10 minutes
-- and they are all within the capsule's proximity radius of each other.
-- For unlock_mode = 'both', unlock_at must also have passed.
-- SECURITY DEFINER: any joined member can trigger the unlock, not just the
-- owner — authorization is enforced inline (caller must be a joined member).
create or replace function public.check_in(
  p_capsule_id uuid,
  p_lat double precision,
  p_lng double precision
) returns json
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid          uuid := (select auth.uid());
  v_capsule      public.capsules%rowtype;
  v_total        integer;
  v_fresh        integer;
  v_max_dist     double precision;
  v_in_range     boolean;
  v_unlocked     boolean := false;
  v_fresh_cutoff timestamptz := now() - interval '10 minutes';
begin
  if not exists (
    select 1 from public.capsule_members
    where capsule_id = p_capsule_id and user_id = v_uid and joined_at is not null
  ) then
    raise exception 'Not a member of this capsule';
  end if;

  update public.capsule_members
    set checkin_lat = p_lat, checkin_lng = p_lng, checkin_at = now()
    where capsule_id = p_capsule_id and user_id = v_uid;

  select * into v_capsule from public.capsules where id = p_capsule_id;

  select count(*) into v_total
    from public.capsule_members
    where capsule_id = p_capsule_id and joined_at is not null;

  select count(*) into v_fresh
    from public.capsule_members
    where capsule_id = p_capsule_id and joined_at is not null
      and checkin_at is not null and checkin_at >= v_fresh_cutoff;

  -- largest distance between any two fresh check-ins
  select coalesce(max(public._haversine_m(
           a.checkin_lat, a.checkin_lng, b.checkin_lat, b.checkin_lng)), 0)
    into v_max_dist
    from public.capsule_members a
    join public.capsule_members b on a.capsule_id = b.capsule_id
    where a.capsule_id = p_capsule_id
      and a.joined_at is not null and b.joined_at is not null
      and a.checkin_at >= v_fresh_cutoff and b.checkin_at >= v_fresh_cutoff;

  v_in_range := v_total > 0 and v_fresh = v_total
                and v_max_dist <= v_capsule.proximity_radius_m;

  if v_capsule.status = 'active'
     and v_capsule.unlock_mode in ('proximity', 'both')
     and v_in_range
     and (v_capsule.unlock_mode <> 'both' or now() >= v_capsule.unlock_at)
  then
    update public.capsules set status = 'unlocked'
      where id = p_capsule_id and status = 'active';
    v_unlocked := true;
  end if;

  return json_build_object(
    'unlocked',     v_unlocked,
    'checked_in',   v_fresh,
    'total',        v_total,
    'within_range', v_in_range
  );
end;
$$;

revoke execute on function public.check_in(uuid, double precision, double precision) from public;
grant  execute on function public.check_in(uuid, double precision, double precision) to authenticated;
