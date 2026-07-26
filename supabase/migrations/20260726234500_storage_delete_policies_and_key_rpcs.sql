-- storage.protect_delete() blocks direct DELETE on storage.objects, so the only
-- way to actually remove a blob is the Storage API — which is RLS-gated, and
-- there was NO delete policy on storage.objects for any role. Deleting a capsule
-- or an account therefore left every file behind (see 20260726231008 /
-- 20260726231047, which removed the SQL deletes that had stopped working).
--
-- Two pieces are needed: policies letting the client remove the right objects,
-- and definer RPCs telling it which keys those are — the media SELECT policy
-- hides rows while a capsule is locked in surprise mode, so the client cannot
-- list them itself. That blind spot is the original bug this whole path exists
-- to fix (BUGS.md #1), so the key list must never come from a client query.

-- Deliberately narrow: the CAPSULE OWNER only, matching who may delete the
-- capsule. NOT extended to uploaders deleting their own objects — that would let
-- someone remove a blob while its media row survives, leaving a broken image
-- with no flow to repair it.
create policy "Owners can delete their capsule media"
  on storage.objects for delete
  to authenticated
  using (
    bucket_id = 'capsule-media'
    and exists (
      select 1 from public.capsules c
       where c.id::text = (storage.foldername(name))[1]
         and c.owner_id = (select auth.uid())
    )
  );

-- Mirrors the existing avatar insert/update policies.
create policy "Users can delete their own avatar"
  on storage.objects for delete
  to authenticated
  using (
    bucket_id = 'avatars'
    and (select auth.uid())::text = (storage.foldername(name))[1]
  );

-- Keys for a capsule the caller owns. SECURITY DEFINER so it sees media rows
-- that owner_preview_locked hides from the owner's own client.
create or replace function public.capsule_storage_keys(p_capsule_id uuid)
returns text[]
language plpgsql
stable
security definer
set search_path to ''
as $function$
declare
  v_owner uuid;
  v_keys  text[];
begin
  select owner_id into v_owner from public.capsules where id = p_capsule_id;
  if v_owner is null then
    raise exception 'Capsule not found';
  end if;
  if v_owner is distinct from (select auth.uid()) then
    raise exception 'Only the capsule owner can list this capsule''s storage keys';
  end if;

  select array_agg(k) filter (where k is not null) into v_keys
    from (
      select storage_key   as k from public.media where capsule_id = p_capsule_id
      union all
      select thumbnail_key      from public.media where capsule_id = p_capsule_id
      union all
      select alt_storage_key    from public.media where capsule_id = p_capsule_id
    ) keys;

  return coalesce(v_keys, '{}');
end;
$function$;

-- The exact key set delete_my_account(p_delete_contributions) would orphan.
-- Must be called BEFORE that RPC: it destroys the auth user, so the JWT dies
-- with it and no later storage call can authenticate. Mirrors the computation
-- the RPC used to do internally, so the two agree by construction — notably it
-- EXCLUDES capsules that get transferred to another member, whose media rows
-- survive on purpose.
create or replace function public.my_account_storage_keys(p_delete_contributions boolean default true)
returns text[]
language plpgsql
stable
security definer
set search_path to ''
as $function$
declare
  v_uid  uuid := (select auth.uid());
  v_keys text[];
begin
  if v_uid is null then
    raise exception 'Not authenticated';
  end if;

  with owned_delete_media as (
    select m.storage_key, m.thumbnail_key, m.alt_storage_key
      from public.media m
      join public.capsules c on c.id = m.capsule_id
     where c.owner_id = v_uid
       and not exists (
         select 1 from public.capsule_members cm
          where cm.capsule_id = c.id
            and cm.user_id <> v_uid
            and cm.joined_at is not null
       )
  ),
  contrib_media as (
    select m.storage_key, m.thumbnail_key, m.alt_storage_key
      from public.media m
     where p_delete_contributions and m.uploader_id = v_uid
  )
  select array_agg(k) filter (where k is not null) into v_keys
    from (
      select storage_key as k from owned_delete_media
      union all select thumbnail_key from owned_delete_media
      union all select alt_storage_key from owned_delete_media
      union all select storage_key from contrib_media
      union all select thumbnail_key from contrib_media
      union all select alt_storage_key from contrib_media
    ) keys;

  return coalesce(v_keys, '{}');
end;
$function$;

revoke all on function public.capsule_storage_keys(uuid) from public;
grant execute on function public.capsule_storage_keys(uuid) to authenticated, service_role;
revoke all on function public.my_account_storage_keys(boolean) from public;
grant execute on function public.my_account_storage_keys(boolean) to authenticated, service_role;
