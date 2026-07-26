-- Supabase added storage.protect_delete(), a BEFORE DELETE FOR EACH STATEMENT
-- trigger on storage.objects that raises:
--   42501: Direct deletion from storage tables is not allowed. Use the Storage
--          API instead.
--
-- Both delete_capsule_with_storage() and delete_my_account() issued exactly that
-- DELETE, so the raise aborted the whole function and NEITHER capsule deletion
-- nor account deletion worked. Reported as "not being allowed to delete my
-- unlocked capsule"; account deletion was broken the same way and unreported.
--
-- Removing the storage DELETE loses less than it appears: deleting a
-- storage.objects row never deleted the underlying S3 object — that asymmetry is
-- the whole reason Supabase added the guard. The previous code was already
-- orphaning blobs in the bucket; it just also dropped the rows that tracked them,
-- making the orphans invisible and unreclaimable. Keeping the rows is strictly
-- better: the objects stay enumerable for a real cleanup pass later.
--
-- Proper cleanup needs the Storage API (which does delete the blob), called from
-- the client — and that additionally needs a DELETE policy on storage.objects for
-- capsule-media, of which there is currently NONE for any role. Deliberately not
-- bundled into this fix.

create or replace function public.delete_capsule_with_storage(p_capsule_id uuid)
returns void
language plpgsql
security definer
set search_path to ''
as $function$
declare
  v_owner uuid;
begin
  select owner_id into v_owner
    from public.capsules
   where id = p_capsule_id;

  if v_owner is null then
    raise exception 'Capsule not found';
  end if;

  -- Null-safe: `is distinct from` (not `<>`) so a null auth.uid() can never
  -- silently pass this check.
  if v_owner is distinct from (select auth.uid()) then
    raise exception 'Only the capsule owner can delete this capsule';
  end if;

  -- Storage cleanup intentionally removed — see the header. Cascades to
  -- capsule_members, media, reactions, notifications, superlative_categories.
  delete from public.capsules where id = p_capsule_id;
end;
$function$;

revoke all on function public.delete_capsule_with_storage(uuid) from public;
grant execute on function public.delete_capsule_with_storage(uuid) to authenticated;
grant execute on function public.delete_capsule_with_storage(uuid) to service_role;
