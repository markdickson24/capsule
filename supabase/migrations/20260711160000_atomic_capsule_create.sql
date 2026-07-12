-- Atomic capsule creation.
--
-- CreateScreen and OnboardingScreen both did: insert capsules (no .select(),
-- since the SELECT policy is membership-gated and the member row doesn't
-- exist yet), then insert the owner's capsule_members row as a second,
-- separate request. If that second insert failed, the capsule row was left
-- behind with zero members — and because the capsules SELECT policy has no
-- owner fallback, that capsule became permanently invisible to everyone,
-- including its own owner. Confirmed in production: 10 of 21 capsules had
-- zero capsule_members rows.
--
-- create_capsule_with_owner does both inserts inside one PL/pgSQL function
-- body. Postgres rolls back a function's entire effect if it raises partway
-- through, so a capsule_members failure now undoes the capsules insert too —
-- no orphan can be created via this path. SECURITY DEFINER is required for
-- the same reason the old two-step flow needed it implicitly satisfied by
-- RLS timing: the caller isn't a capsule_members row yet when the capsule
-- itself is inserted.

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
  p_group_id uuid default null
)
returns uuid
language plpgsql
security definer
set search_path to ''
as $$
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
    status, visibility, group_id
  ) values (
    v_capsule_id, v_uid, p_title, p_description, p_unlock_at, p_contribution_lock_at,
    p_unlock_mode, p_superlative_voting_hours, p_owner_preview_locked, p_occasion,
    'active', p_visibility, p_group_id
  );

  insert into public.capsule_members (capsule_id, user_id, role, joined_at)
  values (v_capsule_id, v_uid, 'owner', now());

  return v_capsule_id;
end;
$$;
