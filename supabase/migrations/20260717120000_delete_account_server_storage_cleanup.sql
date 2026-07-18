-- S4 fix: account deletion must not destroy storage before the DB transaction.
--
-- Previously, SettingsScreen's DeleteAccountModal removed capsule-media storage
-- objects (owned-capsule media + optionally the caller's own contributions
-- everywhere) client-side BEFORE calling this RPC. Two failure modes:
--   (a) if the RPC then failed, other users' photos were permanently destroyed
--       while every DB row survived.
--   (b) even on success, capsules this function TRANSFERS to another joined
--       member (instead of deleting) keep their media ROWS but had already
--       lost the underlying storage OBJECTS client-side — a second, latent
--       cross-user data-loss bug.
--
-- Fix: move storage cleanup server-side, computed at the top of the function
-- (before any mutation) so it's independent of the transfer loop's execution
-- order, and scoped to EXACTLY the media rows this call will delete:
--   (a) media in capsules owned by the caller that have no other joined
--       member (these capsules fall through to the existing cascade-delete
--       below — see the ownership safety net loop), and
--   (b) when p_delete_contributions, the caller's own contributed media in
--       ANY capsule (including ones being transferred to someone else, since
--       those media rows for the caller are deleted below regardless of the
--       capsule's fate).
-- Capsules being transferred are otherwise left untouched — their media
-- (including other members' contributions) survives, storage included.
--
-- This is also why client-side storage cleanup can't just be reordered to run
-- after the RPC: once delete_my_account succeeds, the auth user (and the
-- client's JWT) is gone, so a follow-up storage API call would 401.
--
-- Deleting directly from storage.objects (rather than going through the
-- storage API) is the accepted server-side pattern here; any orphaned S3
-- blobs left behind by an edge case are acceptable.
--
-- Signature is unchanged (create or replace, no drop needed). Rewrite is
-- based on the live production definition of public.delete_my_account
-- fetched via pg_get_functiondef immediately before writing this migration,
-- per CLAUDE.md's drift warning — every line below the new storage-cleanup
-- block is preserved verbatim from that live text.

create or replace function public.delete_my_account(p_delete_contributions boolean default true)
 returns void
 language plpgsql
 security definer
 set search_path to ''
as $function$
declare
  v_uid uuid := (select auth.uid());
  v_group record;
  v_capsule record;
  v_new_owner uuid;
  v_storage_keys text[];
begin
  if v_uid is null then
    raise exception 'Not authenticated';
  end if;

  -- Compute the exact set of capsule-media storage keys this call will
  -- orphan in the DB, BEFORE any mutation below runs.
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
  select array_agg(k) filter (where k is not null) into v_storage_keys
    from (
      select storage_key as k from owned_delete_media
      union all select thumbnail_key from owned_delete_media
      union all select alt_storage_key from owned_delete_media
      union all select storage_key from contrib_media
      union all select thumbnail_key from contrib_media
      union all select alt_storage_key from contrib_media
    ) keys;

  if v_storage_keys is not null and array_length(v_storage_keys, 1) > 0 then
    delete from storage.objects
     where bucket_id = 'capsule-media'
       and name = any(v_storage_keys);
  end if;

  -- Avatar cleanup (best effort — matches the fixed upload path).
  delete from storage.objects
   where bucket_id = 'avatars'
     and name = v_uid::text || '/avatar.jpg';

  delete from public.superlative_votes where voter_id = v_uid;
  delete from public.superlative_upvotes where user_id = v_uid;
  delete from public.reactions where user_id = v_uid;

  -- Capsule ownership safety net: hand off to another joined member instead
  -- of letting the capsule cascade-delete out from under everyone else.
  for v_capsule in
    select id from public.capsules where owner_id = v_uid
  loop
    select cm.user_id into v_new_owner
      from public.capsule_members cm
     where cm.capsule_id = v_capsule.id
       and cm.user_id <> v_uid
       and cm.joined_at is not null
     order by cm.joined_at asc
     limit 1;

    if v_new_owner is not null then
      update public.capsules set owner_id = v_new_owner where id = v_capsule.id;
      update public.capsule_members set role = 'owner'
       where capsule_id = v_capsule.id and user_id = v_new_owner;
    end if;
    -- else: no other joined member — falls through to the capsules delete below.
  end loop;

  delete from public.capsule_members where user_id = v_uid;
  delete from public.notifications where user_id = v_uid;

  -- Only sole-member capsules remain owned by v_uid at this point — every
  -- transferable one was reassigned above.
  delete from public.capsules where owner_id = v_uid;

  if p_delete_contributions then
    delete from public.media where uploader_id = v_uid;
  else
    update public.media set uploader_id = null where uploader_id = v_uid;
  end if;

  -- Ownership safety net: transfer groups this user created to another
  -- member instead of letting them cascade-delete for everyone.
  for v_group in
    select id from public.groups where created_by = v_uid
  loop
    select user_id into v_new_owner
      from public.group_members
     where group_id = v_group.id and user_id <> v_uid
     order by joined_at asc
     limit 1;

    if v_new_owner is not null then
      update public.groups set created_by = v_new_owner where id = v_group.id;
    end if;
    -- else: no other member — falls through to the auth.users cascade below.
  end loop;

  delete from auth.users where id = v_uid;
end;
$function$;
