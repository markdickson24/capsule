-- Allow any joined member (not just the owner) to archive/restore a capsule.
--
-- The blanket "Owners can update their capsules" UPDATE policy on `capsules`
-- (owner_id = auth.uid(), both USING and the implicit WITH CHECK) covers
-- every column with one all-or-nothing rule — there's no column-level
-- exception for archived_at. Loosening that policy to admit members
-- generally would also open title/unlock_at/etc. to non-owner edits, which
-- isn't wanted. Instead, add a narrow SECURITY DEFINER RPC that only ever
-- touches archived_at and authorizes inline, matching the existing pattern
-- (check_in, set_default_superlatives) for "one specific mutation needs to
-- bypass the general RLS story."
create or replace function public.set_capsule_archived(
  p_capsule_id uuid,
  p_archived   boolean
) returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid   uuid := (select auth.uid());
  v_owner uuid;
begin
  if v_uid is null then
    raise exception 'Not authenticated';
  end if;

  select owner_id into v_owner
    from public.capsules
   where id = p_capsule_id;

  if v_owner is null then
    raise exception 'Capsule not found';
  end if;

  if v_owner is distinct from v_uid and not exists (
    select 1 from public.capsule_members
     where capsule_id = p_capsule_id
       and user_id = v_uid
       and joined_at is not null
  ) then
    raise exception 'Not a member of this capsule';
  end if;

  update public.capsules
     set archived_at = case when p_archived then now() else null end
   where id = p_capsule_id;
end;
$$;

revoke execute on function public.set_capsule_archived(uuid, boolean) from public, anon;
grant  execute on function public.set_capsule_archived(uuid, boolean) to authenticated;
