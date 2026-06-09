-- Account deletion — Apple requires accounts to be deletable from inside
-- the app. Users get to choose: delete their contributed media in other
-- people's capsules, or leave it (anonymized — uploader_id nulled).

-- ============================================================
-- 1. media.uploader_id must allow NULL so we can anonymize.
-- ============================================================
alter table public.media alter column uploader_id drop not null;

-- ============================================================
-- 2. delete_my_account — deletes the caller's account.
--    Order matters: dependent rows first, then auth.users last.
-- ============================================================
create or replace function public.delete_my_account(p_delete_contributions boolean default true)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := (select auth.uid());
begin
  if v_uid is null then
    raise exception 'Not authenticated';
  end if;

  -- Always-delete: votes, upvotes, reactions, memberships, notifications.
  delete from public.superlative_votes where voter_id = v_uid;
  delete from public.superlative_upvotes where user_id = v_uid;
  delete from public.reactions where user_id = v_uid;
  delete from public.capsule_members where user_id = v_uid;
  delete from public.notifications where user_id = v_uid;

  -- Capsules they own cascade to media, members, reactions, notifications,
  -- superlative_categories/_upvotes/_votes/_winners.
  delete from public.capsules where owner_id = v_uid;

  -- Their media contributed to OTHER people's capsules.
  if p_delete_contributions then
    delete from public.media where uploader_id = v_uid;
  else
    update public.media set uploader_id = null where uploader_id = v_uid;
  end if;

  -- auth.users → cascades to public.users via FK.
  delete from auth.users where id = v_uid;
end;
$$;

revoke execute on function public.delete_my_account(boolean) from public, anon;
grant  execute on function public.delete_my_account(boolean) to authenticated;
