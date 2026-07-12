-- Ownership safety net for capsules, mirroring the existing group transfer
-- (20260710030000_delete_account_group_transfer.sql).
--
-- delete_my_account unconditionally ran `delete from public.capsules where
-- owner_id = v_uid` — so deleting your account destroyed every capsule you
-- owned, including its media and every other member's memories, even for a
-- capsule with years of history and several other joined members. There was
-- no warning beyond "the capsules you own" in the confirmation copy, and no
-- attempt to hand ownership off the way groups already do.
--
-- Before the blanket capsule delete, transfer each owned capsule to another
-- existing joined member (oldest-joined, deterministic) if one exists. A
-- capsule with no other joined member needs no special handling — it still
-- gets swept by the existing `delete from capsules where owner_id = v_uid`
-- once the transfer-if-possible case has claimed everything transferable.

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
