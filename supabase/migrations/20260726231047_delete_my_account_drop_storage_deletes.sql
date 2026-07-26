-- Same root cause as 20260726231008: storage.protect_delete() blocks direct
-- DELETE on storage.objects, so this function raised 42501 and ACCOUNT DELETION
-- WAS ENTIRELY BROKEN — an App Store 5.1.1(v) requirement.
--
-- Both storage DELETEs (the capsule-media keys, and the avatar) are removed. The
-- key-collection CTE and v_storage_keys go with them since nothing else read
-- them. Every other statement is preserved verbatim, including the capsule and
-- group ownership-transfer safety nets.
--
-- Consequence: the S3 blobs remain. They were already remaining before — a
-- storage.objects row delete never removed the underlying object — so this only
-- stops pretending otherwise. The blobs are unreachable through the app once the
-- media/capsule/member rows are gone (storage SELECT is membership-gated), so
-- this is storage waste, not data exposure. A real cleanup needs the Storage API
-- called from the client BEFORE this RPC runs, since the JWT dies with the auth
-- user — plus a DELETE policy on storage.objects, of which there is none.

CREATE OR REPLACE FUNCTION public.delete_my_account(p_delete_contributions boolean DEFAULT true)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_uid uuid := (select auth.uid());
  v_group record;
  v_capsule record;
  v_new_owner uuid;
begin
  if v_uid is null then
    raise exception 'Not authenticated';
  end if;

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

revoke all on function public.delete_my_account(boolean) from public;
grant execute on function public.delete_my_account(boolean) to authenticated;
grant execute on function public.delete_my_account(boolean) to service_role;
