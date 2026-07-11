-- GROUPS.md #9 — delete_my_account (20260608000000_delete_account.sql)
-- predates groups. groups.created_by references public.users(id) on delete
-- cascade, so deleting the creator's account silently wiped every group they
-- created out from under every other member — including ones with an active
-- recurring schedule and years of history.
--
-- Before the final auth.users delete, reassign each group the caller created
-- to another existing member (oldest-joined, deterministic). A group with no
-- other member is intentionally left untouched: the auth.users cascade below
-- deletes it (and its now-orphaned solo group_members row) exactly as before
-- — "delete only if they were the last one" needs no special-casing, the
-- existing FK cascade already does it once the transfer-if-possible case is
-- handled first.
create or replace function public.delete_my_account(p_delete_contributions boolean DEFAULT true)
returns void
language plpgsql
security definer
set search_path to ''
as $function$
declare
  v_uid uuid := (select auth.uid());
  v_group record;
  v_new_owner uuid;
begin
  if v_uid is null then
    raise exception 'Not authenticated';
  end if;

  delete from public.superlative_votes where voter_id = v_uid;
  delete from public.superlative_upvotes where user_id = v_uid;
  delete from public.reactions where user_id = v_uid;
  delete from public.capsule_members where user_id = v_uid;
  delete from public.notifications where user_id = v_uid;

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
