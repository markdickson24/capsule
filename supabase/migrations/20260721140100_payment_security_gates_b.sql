-- Payment-security gates (B): server backstops for the member (H1) and photo
-- (H2) caps. Client pre-checks stay for UX; these are the un-bypassable floor
-- against self-join paths, races, and modified clients. Caps key off the
-- capsule OWNER's tier ("monetize the host"). See
-- docs/superpowers/specs/2026-07-21-payment-security-remediation-design.md.

-- H1: member cap. Owner's own row is never capped. Counts all rows (joined +
-- pending), matching the client's count semantics.
create or replace function public.enforce_member_limit()
returns trigger language plpgsql security definer set search_path to '' as $$
declare
  v_owner uuid;
  v_tier text;
  v_cap int;
  v_count int;
begin
  if coalesce((select auth.role()), '') not in ('authenticated', 'anon') then
    return new;  -- service_role/cron/definer: trusted
  end if;
  select owner_id into v_owner from public.capsules where id = new.capsule_id;
  if new.user_id = v_owner then
    return new;  -- the host's own membership is never capped
  end if;
  select subscription_tier into v_tier from public.users where id = v_owner;
  v_cap := case when v_tier = 'free' then 10 else 50 end;  -- keep in sync with src/lib/tierLimits.ts
  select count(*) into v_count from public.capsule_members where capsule_id = new.capsule_id;
  if v_count >= v_cap then
    raise exception 'MEMBER_LIMIT_REACHED';
  end if;
  return new;
end $$;

drop trigger if exists enforce_member_limit on public.capsule_members;
create trigger enforce_member_limit
  before insert on public.capsule_members
  for each row execute function public.enforce_member_limit();

-- H2: photo cap. Backstops the client pre-check. A rejected insert after the
-- storage upload orphans that blob — accepted, matches existing cleanup
-- tradeoffs.
create or replace function public.enforce_photo_limit()
returns trigger language plpgsql security definer set search_path to '' as $$
declare
  v_tier text;
  v_cap int;
  v_count int;
begin
  if coalesce((select auth.role()), '') not in ('authenticated', 'anon') then
    return new;
  end if;
  select u.subscription_tier into v_tier
    from public.capsules c join public.users u on u.id = c.owner_id
    where c.id = new.capsule_id;
  v_cap := case when v_tier = 'free' then 20 else 1000 end;  -- keep in sync with src/lib/tierLimits.ts
  select count(*) into v_count from public.media where capsule_id = new.capsule_id;
  if v_count >= v_cap then
    raise exception 'PHOTO_LIMIT_REACHED';
  end if;
  return new;
end $$;

drop trigger if exists enforce_photo_limit on public.media;
create trigger enforce_photo_limit
  before insert on public.media
  for each row execute function public.enforce_photo_limit();
