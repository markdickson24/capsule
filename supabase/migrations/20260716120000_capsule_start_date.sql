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
-- NOTE: `create or replace function` only replaces a function with the exact
-- same argument TYPE signature. Adding a new trailing parameter changes the
-- signature, so `create or replace` here would create a SECOND overload
-- (10-arg and 11-arg coexisting) instead of replacing the original — verified
-- by testing this exact migration on the ephemeral branch, where
-- pg_get_functiondef returned two distinct oids after applying without this
-- drop. Two overloads breaks PostgREST's RPC resolution: a call with the
-- original 10 named arguments becomes ambiguous between the two overloads
-- (PGRST203 "Could not choose the best candidate function"), which is exactly
-- the "existing callers unaffected" guarantee this task is supposed to
-- preserve. Drop the old-signature overload first so only the 11-arg version
-- remains.
drop function if exists public.create_capsule_with_owner(
  text, text, timestamp with time zone, timestamp with time zone, text,
  integer, boolean, text, text, uuid
);

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
-- Reconciled against production's live constraint (verified 2026-07-16):
-- production had exactly the brief's 14 values, so this list is those 14
-- plus the one intentional new value, 'capsule_started'.

alter table public.notifications drop constraint notifications_type_check;
alter table public.notifications add constraint notifications_type_check
  check (type in (
    'invite', 'unlock', 'contribution_nudge', 'milestone', 'reaction',
    'superlative_suggested', 'superlative_closing_soon', 'superlative_won',
    'friend_request', 'friend_accept', 'unlock_reminder', 'group_capsule',
    'group_capsule_upcoming', 'contribution_activity', 'capsule_started'
  ));
