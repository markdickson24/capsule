-- Live Activity countdown: per-capsule owner default + per-member override.
-- See docs/superpowers/specs/2026-07-24-live-activity-countdown-design.md

-- 1. Capsule-level default. New capsules opt in; every pre-existing capsule
--    opts out, so a currently-live capsule doesn't suddenly start appearing on
--    members' lock screens the moment they install the new build. Same
--    reasoning as owner_preview_locked's backfill in 20260618000000.
alter table public.capsules
  add column if not exists live_activity_enabled boolean not null default true;

update public.capsules set live_activity_enabled = false;

-- 2. Per-member override. null = inherit the capsule default.
alter table public.capsule_members
  add column if not exists live_activity_override boolean;

-- 3. REQUIRED. The July 2026 audit (20260722120000_audit_rls_hardening.sql)
--    revoked table-wide UPDATE on capsule_members from authenticated and
--    granted back only (joined_at). A new column therefore has NO update
--    privilege by default, and a client write would fail 42501 for the whole
--    statement. SELECT/INSERT are still table-wide grants here, so reads need
--    no equivalent line (unlike public.users, where table-wide SELECT is gone).
grant update (live_activity_override) on public.capsule_members to authenticated;

-- 4. create_capsule_with_owner gains a trailing parameter.
--    The old overload MUST be dropped first: adding a parameter changes the
--    type signature, so a bare `create or replace` leaves two overloads
--    coexisting and PostgREST then fails the existing 11-named-arg call with
--    PGRST203 (ambiguous). Same trap as 20260716120000_capsule_start_date.sql.
drop function if exists public.create_capsule_with_owner(
  text, text, timestamptz, timestamptz, text, integer, boolean, text, text, uuid, timestamptz
);

create or replace function public.create_capsule_with_owner(
  p_title text,
  p_description text,
  p_unlock_at timestamptz,
  p_contribution_lock_at timestamptz,
  p_unlock_mode text,
  p_superlative_voting_hours integer,
  p_owner_preview_locked boolean,
  p_occasion text,
  p_visibility text default 'invite',
  p_group_id uuid default null,
  p_contribution_start_at timestamptz default null,
  p_live_activity_enabled boolean default true
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

  -- Free tier cap. Kept in sync with TIER_LIMITS.free.activeCapsules in
  -- src/lib/tierLimits.ts (SQL can't import TS).
  if (select subscription_tier from public.users where id = v_uid) = 'free'
     and (select count(*) from public.capsules
          where owner_id = v_uid and status <> 'unlocked') >= 3 then
    raise exception 'CAPSULE_LIMIT_REACHED';
  end if;

  insert into public.capsules (
    id, owner_id, title, description, unlock_at, contribution_lock_at,
    unlock_mode, superlative_voting_hours, owner_preview_locked, occasion,
    status, visibility, group_id, contribution_start_at, live_activity_enabled
  ) values (
    v_capsule_id, v_uid, p_title, p_description, p_unlock_at, p_contribution_lock_at,
    p_unlock_mode, p_superlative_voting_hours, p_owner_preview_locked, p_occasion,
    'active', p_visibility, p_group_id, p_contribution_start_at, p_live_activity_enabled
  );

  insert into public.capsule_members (capsule_id, user_id, role, joined_at)
  values (v_capsule_id, v_uid, 'owner', now());

  return v_capsule_id;
end;
$function$;
