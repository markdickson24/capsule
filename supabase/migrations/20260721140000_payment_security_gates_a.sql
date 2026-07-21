-- Payment-security gates (A): make subscription_tier un-forgeable (C1), remove
-- the direct-create RLS bypass of the create RPCs (C3), and gate group
-- recurrence edits for free creators (C3). See
-- docs/superpowers/specs/2026-07-21-payment-security-remediation-design.md.

-- C1: only service_role (the RevenueCat webhook) may change subscription_tier.
-- A client (authenticated/anon) attempting to set/change it is rejected. Reads
-- the JWT role, which SECURITY DEFINER does not alter.
create or replace function public.guard_subscription_tier()
returns trigger language plpgsql security definer set search_path to '' as $$
begin
  if coalesce((select auth.role()), '') not in ('authenticated', 'anon') then
    return new;  -- webhook (service_role), migrations, definer paths: allowed
  end if;
  if tg_op = 'UPDATE' and new.subscription_tier is distinct from old.subscription_tier then
    raise exception 'TIER_READONLY' using errcode = '42501';
  end if;
  if tg_op = 'INSERT' and coalesce(new.subscription_tier, 'free') <> 'free' then
    raise exception 'TIER_READONLY' using errcode = '42501';
  end if;
  return new;
end $$;

drop trigger if exists guard_subscription_tier on public.users;
create trigger guard_subscription_tier
  before insert or update on public.users
  for each row execute function public.guard_subscription_tier();

-- C3a: creation must go through create_capsule_with_owner /
-- create_group_with_creator (SECURITY DEFINER, RLS-exempt), whose cap gates are
-- the only create path once these client INSERT policies are gone. Verified: no
-- client code inserts these tables directly.
drop policy if exists "Owners can insert capsules" on public.capsules;
drop policy if exists "Creator can insert groups" on public.groups;

-- C3b: a free creator cannot switch a group to a real recurrence via a direct
-- UPDATE (ManageGroupScreen). Mirrors create_group_with_creator's error string
-- so the existing client handler catches it. The cron only bumps
-- next_capsule_at (service_role), never recurrence_interval.
create or replace function public.guard_group_recurrence()
returns trigger language plpgsql security definer set search_path to '' as $$
begin
  if coalesce((select auth.role()), '') not in ('authenticated', 'anon') then
    return new;
  end if;
  if new.recurrence_interval <> 'manual'
     and new.recurrence_interval is distinct from old.recurrence_interval
     and (select subscription_tier from public.users where id = old.created_by) = 'free'
  then
    raise exception 'GROUP_RECURRENCE_PRO';
  end if;
  return new;
end $$;

drop trigger if exists guard_group_recurrence on public.groups;
create trigger guard_group_recurrence
  before update on public.groups
  for each row execute function public.guard_group_recurrence();
