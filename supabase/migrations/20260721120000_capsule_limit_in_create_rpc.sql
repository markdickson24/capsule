-- Enforce the free-tier active-capsule cap (3) inside create_capsule_with_owner.
-- Server-side hard gate: a free host may own at most 3 non-unlocked capsules;
-- Capsule Pro removes the cap. Client pre-checks and shows the paywall, but this
-- is the un-bypassable gate. Signature is UNCHANGED (11 params) so create or
-- replace does not create a second overload — see CLAUDE.md "Key RLS Constraints"
-- on the overload hazard. Base body is the live definition (fetched via
-- pg_get_functiondef) with a single guard added after the auth check.
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
  p_contribution_start_at timestamp with time zone default null::timestamp with time zone
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

  -- Free hosts may own at most 3 non-unlocked capsules (Capsule Pro removes
  -- this cap). This number mirrors TIER_LIMITS.free.activeCapsules in
  -- src/lib/tierLimits.ts — keep both in sync. Do NOT filter on
  -- capsules.archived_at (retired column; archive is per-member now).
  if (select subscription_tier from public.users where id = v_uid) = 'free'
     and (select count(*) from public.capsules
          where owner_id = v_uid and status <> 'unlocked') >= 3 then
    raise exception 'CAPSULE_LIMIT_REACHED';
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

-- Re-assert least-privilege grants (create or replace preserves ACL, but keep
-- this explicit and idempotent, matching the established migration pattern).
revoke all on function public.create_capsule_with_owner(
  text, text, timestamptz, timestamptz, text, integer, boolean, text, text, uuid, timestamptz
) from public, anon;
grant execute on function public.create_capsule_with_owner(
  text, text, timestamptz, timestamptz, text, integer, boolean, text, text, uuid, timestamptz
) to authenticated;
