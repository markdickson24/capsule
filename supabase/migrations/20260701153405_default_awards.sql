-- Predetermined ("default") awards.
--
-- Today every superlative category is born as a member suggestion
-- (status='pending') and only reaches 'live' via the upvote-threshold
-- trigger (_promote_superlative). This adds a second, parallel path: a
-- capsule can be auto-seeded with up to 4 "default" awards, themed by the
-- capsule's occasion, that are inserted already 'live' — no suggest/upvote
-- gauntlet. Owners can regenerate/swap/remove these pre-unlock via the new
-- set_default_superlatives RPC. Member suggestions are unaffected and
-- continue to coexist with the defaults.

-- ============================================================
-- 1. capsules.occasion — drives which themed award pool the
--    client draws defaults from. Client-side concept (src/lib/
--    awardPool.ts) does the actual pool lookup; the DB just
--    stores + validates the chosen value.
-- ============================================================
alter table public.capsules
  add column occasion text not null default 'general'
    check (occasion in ('wedding', 'vacation', 'party', 'baby', 'milestone', 'general'));

-- ============================================================
-- 2. superlative_categories.is_default — distinguishes
--    predetermined awards from member suggestions. Drives:
--    (a) which rows set_default_superlatives replaces on
--        regenerate/swap, (b) suppressing the suggestion
--        notification fan-out for seeded/reshuffled defaults,
--        (c) the pre-unlock owner management UI.
-- ============================================================
alter table public.superlative_categories
  add column is_default boolean not null default false;

create index idx_super_cat_default on public.superlative_categories (capsule_id) where is_default;

-- capsules already has a table-level SELECT grant to authenticated (unlike
-- users, which had it revoked), so occasion is readable with no extra grant.
-- superlative_categories is the same — verified no column-level grant
-- revocation exists on this table — so is_default needs no explicit grant
-- either. (Documented here so a future column addition on THIS table
-- doesn't skip checking, per the users.home_layout lesson in CLAUDE.md.)

-- ============================================================
-- 3. notify_on_superlative_suggested — skip the fan-out when
--    the inserted row is a default award. Seeding/reshuffling
--    defaults happens silently; member-suggested categories
--    still notify as before.
-- ============================================================
create or replace function public.notify_on_superlative_suggested()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if NEW.is_default then
    return null;
  end if;

  insert into public.notifications (user_id, capsule_id, type)
  select cm.user_id, NEW.capsule_id, 'superlative_suggested'
    from public.capsule_members cm
   where cm.capsule_id = NEW.capsule_id
     and cm.joined_at is not null
     and cm.user_id <> NEW.suggested_by;
  return null;
end;
$$;

-- ============================================================
-- 4. set_default_superlatives — full-replace RPC backing both
--    the Create-screen preview seed and the pre-unlock owner
--    regenerate/swap/remove controls. Idempotent: callers always
--    send the complete desired set of (up to 4) default awards;
--    this deletes the capsule's existing is_default rows and
--    re-inserts the new set as 'live'. Safe to full-replace
--    pre-unlock because no votes can exist yet (voting only
--    opens at unlock). security definer because a client cannot
--    insert status='live' directly (the suggest-categories INSERT
--    policy forces status='pending').
-- ============================================================
create or replace function public.set_default_superlatives(
  p_capsule_id uuid,
  p_awards     jsonb
) returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid    uuid := (select auth.uid());
  v_owner  uuid;
  v_status text;
  v_count  integer;
  v_award  record;
begin
  if v_uid is null then
    raise exception 'Not authenticated';
  end if;

  select owner_id, status into v_owner, v_status
    from public.capsules
   where id = p_capsule_id;

  if v_owner is null then
    raise exception 'Capsule not found';
  end if;

  if v_owner is distinct from v_uid then
    raise exception 'Only the capsule owner can set default awards';
  end if;

  if v_status = 'unlocked' then
    raise exception 'Cannot change default awards after unlock';
  end if;

  select count(*) into v_count from jsonb_array_elements(p_awards);
  if v_count > 4 then
    raise exception 'At most 4 default awards are allowed';
  end if;

  delete from public.superlative_categories
   where capsule_id = p_capsule_id
     and is_default;

  for v_award in
    select * from jsonb_to_recordset(p_awards) as x(label text, target_type text)
  loop
    if char_length(trim(v_award.label)) < 3 or char_length(trim(v_award.label)) > 80 then
      raise exception 'Award label must be 3-80 characters';
    end if;
    if v_award.target_type not in ('person', 'media') then
      raise exception 'Invalid target_type';
    end if;

    insert into public.superlative_categories
      (capsule_id, suggested_by, label, target_type, status, is_default, promoted_at)
    values
      (p_capsule_id, v_uid, trim(v_award.label), v_award.target_type, 'live', true, now());
  end loop;
end;
$$;

revoke execute on function public.set_default_superlatives(uuid, jsonb) from public, anon;
grant  execute on function public.set_default_superlatives(uuid, jsonb) to authenticated;
