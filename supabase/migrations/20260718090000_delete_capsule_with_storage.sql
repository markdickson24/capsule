-- BUGS.md #1: deleting a locked surprise-mode capsule orphans its storage.
--
-- The live `media` SELECT policy is:
--   status = 'unlocked' OR (role in ('owner','contributor') AND NOT owner_preview_locked)
-- For a locked capsule with owner_preview_locked = true (the default for every
-- new capsule — see "Surprise Mode" in CLAUDE.md), the owner's own client
-- cannot read media rows before unlock. CapsuleDetailScreen.confirmDelete /
-- EditCapsuleScreen.confirmDelete both used to select storage_key/
-- alt_storage_key/thumbnail_key from `media` client-side BEFORE deleting the
-- capsule row (media cascades on capsule delete) — under the lock that select
-- returns zero rows, so `keys` is empty, `storage.remove()` is never called,
-- and every file for that capsule is left in the capsule-media bucket
-- forever with no DB row left to ever find it again.
--
-- Fix: move key collection + storage cleanup + the capsule delete itself
-- server-side into one SECURITY DEFINER RPC, mirroring the accepted pattern
-- in 20260717120000_delete_account_server_storage_cleanup.sql (direct
-- `delete from storage.objects` rather than the storage API — SECURITY
-- DEFINER bypasses the media SELECT policy's owner_preview_locked gate, so
-- key collection here sees every row regardless of lock state).
create or replace function public.delete_capsule_with_storage(p_capsule_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_owner uuid;
  v_keys  text[];
begin
  select owner_id into v_owner
    from public.capsules
   where id = p_capsule_id;

  if v_owner is null then
    raise exception 'Capsule not found';
  end if;

  -- Null-safe: `is distinct from` (not `<>`) so a null auth.uid() can never
  -- silently pass this check — same reasoning as set_default_superlatives.
  if v_owner is distinct from (select auth.uid()) then
    raise exception 'Only the capsule owner can delete this capsule';
  end if;

  -- Collect every non-null storage key referenced by this capsule's media,
  -- BEFORE deleting anything. SECURITY DEFINER means this read is not
  -- subject to the media SELECT policy's owner_preview_locked gate, so it
  -- sees rows the owner's own client couldn't while the capsule is locked.
  select array_agg(k) filter (where k is not null) into v_keys
    from (
      select storage_key as k from public.media where capsule_id = p_capsule_id
      union all
      select thumbnail_key from public.media where capsule_id = p_capsule_id
      union all
      select alt_storage_key from public.media where capsule_id = p_capsule_id
    ) keys;

  if v_keys is not null and array_length(v_keys, 1) > 0 then
    delete from storage.objects
     where bucket_id = 'capsule-media'
       and name = any(v_keys);
  end if;

  -- Cascades to capsule_members, media, reactions, notifications.
  delete from public.capsules where id = p_capsule_id;
end;
$$;

revoke all on function public.delete_capsule_with_storage(uuid) from public;
grant execute on function public.delete_capsule_with_storage(uuid) to authenticated;

-- Supabase default privileges grant execute on new functions to anon/authenticated/
-- service_role explicitly, so the revoke-from-public above does not strip anon.
revoke execute on function public.delete_capsule_with_storage(uuid) from anon;
