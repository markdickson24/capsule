-- Superlatives — Phase 1: schema, RLS, trigger, and tally RPC.
--
-- Yearbook-style awards per capsule. Members suggest categories; a category
-- auto-promotes from 'pending' to 'live' once upvotes reach ceil(joined/2).
-- Voting opens when the capsule unlocks and runs for the owner-configured
-- window (superlative_voting_hours). Tallies are anonymous and only released
-- after voting_closes_at — enforced by the tally_superlatives RPC.
--
-- Categories target either a capsule member ('person') or a media row
-- ('media'). Votes have exactly one target column populated.

-- ============================================================
-- 1. capsules: new columns
-- ============================================================
alter table public.capsules
  add column unlocked_at timestamptz;

alter table public.capsules
  add column superlative_voting_hours integer not null default 48
    check (superlative_voting_hours between 1 and 720);

alter table public.capsules
  add column superlative_voting_closes_at timestamptz;

-- ============================================================
-- 2. superlative_categories
-- ============================================================
create table public.superlative_categories (
  id uuid primary key default gen_random_uuid(),
  capsule_id uuid not null references public.capsules(id) on delete cascade,
  suggested_by uuid not null references public.users(id) on delete cascade,
  label text not null check (char_length(trim(label)) between 3 and 80),
  target_type text not null check (target_type in ('person', 'media')),
  status text not null default 'pending'
    check (status in ('pending', 'live', 'archived')),
  promoted_at timestamptz,
  created_at timestamptz not null default now()
);

create index idx_super_cat_capsule       on public.superlative_categories (capsule_id);
create index idx_super_cat_suggested_by  on public.superlative_categories (suggested_by);
create index idx_super_cat_status        on public.superlative_categories (capsule_id, status);

alter table public.superlative_categories enable row level security;

-- ============================================================
-- 3. superlative_upvotes
-- ============================================================
create table public.superlative_upvotes (
  category_id uuid not null references public.superlative_categories(id) on delete cascade,
  user_id     uuid not null references public.users(id) on delete cascade,
  created_at  timestamptz not null default now(),
  primary key (category_id, user_id)
);

create index idx_super_upvotes_user on public.superlative_upvotes (user_id);

alter table public.superlative_upvotes enable row level security;

-- ============================================================
-- 4. superlative_votes
-- ============================================================
create table public.superlative_votes (
  category_id     uuid not null references public.superlative_categories(id) on delete cascade,
  voter_id        uuid not null references public.users(id) on delete cascade,
  target_user_id  uuid references public.users(id) on delete cascade,
  target_media_id uuid references public.media(id) on delete cascade,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now(),
  primary key (category_id, voter_id),
  -- Exactly one target column populated
  check ((target_user_id is not null)::int + (target_media_id is not null)::int = 1)
);

create index idx_super_votes_voter        on public.superlative_votes (voter_id);
create index idx_super_votes_target_user  on public.superlative_votes (target_user_id) where target_user_id is not null;
create index idx_super_votes_target_media on public.superlative_votes (target_media_id) where target_media_id is not null;

alter table public.superlative_votes enable row level security;

-- ============================================================
-- 5. _superlative_target_valid — helper used in vote policies
--    Confirms the target row belongs to the category's capsule
--    and matches the category's target_type.
-- ============================================================
create or replace function public._superlative_target_valid(
  p_category_id     uuid,
  p_target_user_id  uuid,
  p_target_media_id uuid
) returns boolean
language plpgsql
security definer
stable
set search_path = ''
as $$
declare
  v_capsule_id  uuid;
  v_target_type text;
begin
  select capsule_id, target_type
    into v_capsule_id, v_target_type
    from public.superlative_categories
   where id = p_category_id;

  if v_capsule_id is null then return false; end if;

  if v_target_type = 'person' then
    if p_target_user_id is null then return false; end if;
    return exists (
      select 1 from public.capsule_members
       where capsule_id = v_capsule_id
         and user_id   = p_target_user_id
         and joined_at is not null
    );
  end if;

  if v_target_type = 'media' then
    if p_target_media_id is null then return false; end if;
    return exists (
      select 1 from public.media
       where id = p_target_media_id
         and capsule_id = v_capsule_id
    );
  end if;

  return false;
end;
$$;

revoke execute on function public._superlative_target_valid(uuid, uuid, uuid) from public, anon, authenticated;
grant  execute on function public._superlative_target_valid(uuid, uuid, uuid) to authenticated;

-- ============================================================
-- 6. _promote_superlative — trigger that flips a pending
--    category to 'live' once upvotes reach ceil(joined/2).
-- ============================================================
create or replace function public._promote_superlative()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_capsule_id uuid;
  v_status     text;
  v_upvotes    integer;
  v_members    integer;
begin
  select capsule_id, status
    into v_capsule_id, v_status
    from public.superlative_categories
   where id = NEW.category_id;

  if v_status is distinct from 'pending' then
    return null;
  end if;

  select count(*) into v_upvotes
    from public.superlative_upvotes
   where category_id = NEW.category_id;

  select count(*) into v_members
    from public.capsule_members
   where capsule_id = v_capsule_id
     and joined_at is not null;

  if v_members > 0
     and v_upvotes >= ceil(v_members::numeric / 2) then
    update public.superlative_categories
       set status = 'live', promoted_at = now()
     where id = NEW.category_id
       and status = 'pending';
  end if;

  return null;
end;
$$;

revoke execute on function public._promote_superlative() from public, anon, authenticated;

create trigger superlative_promote_on_upvote
after insert on public.superlative_upvotes
for each row execute function public._promote_superlative();

-- ============================================================
-- 7. tally_superlatives — anonymous counts, gated on close.
--    Returns one row per (category, target) with vote_count.
--    Returns empty until the capsule's voting window is over.
-- ============================================================
create or replace function public.tally_superlatives(p_capsule_id uuid)
returns table (
  category_id     uuid,
  target_user_id  uuid,
  target_media_id uuid,
  vote_count      bigint
)
language plpgsql
security definer
stable
set search_path = ''
as $$
declare
  v_uid       uuid := (select auth.uid());
  v_closes_at timestamptz;
begin
  if not exists (
    select 1 from public.capsule_members
     where capsule_id = p_capsule_id
       and user_id   = v_uid
       and joined_at is not null
  ) then
    raise exception 'Not a member of this capsule';
  end if;

  select superlative_voting_closes_at
    into v_closes_at
    from public.capsules
   where id = p_capsule_id;

  if v_closes_at is null or now() < v_closes_at then
    return;
  end if;

  return query
    select v.category_id,
           v.target_user_id,
           v.target_media_id,
           count(*)::bigint as vote_count
      from public.superlative_votes v
      join public.superlative_categories c on c.id = v.category_id
     where c.capsule_id = p_capsule_id
       and c.status = 'live'
     group by v.category_id, v.target_user_id, v.target_media_id
     order by v.category_id, count(*) desc;
end;
$$;

revoke execute on function public.tally_superlatives(uuid) from public, anon;
grant  execute on function public.tally_superlatives(uuid) to authenticated;

-- ============================================================
-- 8. RLS policies — superlative_categories
-- ============================================================
create policy "Members can read categories"
on public.superlative_categories
for select
to authenticated
using (
  capsule_id in (select public.get_my_capsule_ids())
);

create policy "Members can suggest categories"
on public.superlative_categories
for insert
to authenticated
with check (
  suggested_by = (select auth.uid())
  and capsule_id in (select public.get_my_capsule_ids())
  and status = 'pending'
);

-- Owner can archive / re-label categories. Promotion is done via the
-- security-definer trigger and bypasses RLS.
create policy "Owner can update categories"
on public.superlative_categories
for update
to authenticated
using (
  exists (
    select 1 from public.capsules
     where id = capsule_id
       and owner_id = (select auth.uid())
  )
)
with check (
  exists (
    select 1 from public.capsules
     where id = capsule_id
       and owner_id = (select auth.uid())
  )
);

create policy "Owner can delete categories"
on public.superlative_categories
for delete
to authenticated
using (
  exists (
    select 1 from public.capsules
     where id = capsule_id
       and owner_id = (select auth.uid())
  )
);

-- ============================================================
-- 9. RLS policies — superlative_upvotes
-- ============================================================
create policy "Members can read upvotes"
on public.superlative_upvotes
for select
to authenticated
using (
  category_id in (
    select id from public.superlative_categories
     where capsule_id in (select public.get_my_capsule_ids())
  )
);

create policy "Members can upvote pending categories"
on public.superlative_upvotes
for insert
to authenticated
with check (
  user_id = (select auth.uid())
  and exists (
    select 1 from public.superlative_categories c
     where c.id = category_id
       and c.status = 'pending'
       and c.capsule_id in (select public.get_my_capsule_ids())
  )
);

create policy "Members can remove their own upvote"
on public.superlative_upvotes
for delete
to authenticated
using (user_id = (select auth.uid()));

-- ============================================================
-- 10. RLS policies — superlative_votes (anonymous, time-gated)
-- ============================================================
-- A voter can read only their own vote rows. Public tallies go through
-- tally_superlatives (which is gated on voting_closes_at).
create policy "Voter can read own votes"
on public.superlative_votes
for select
to authenticated
using (voter_id = (select auth.uid()));

create policy "Members can cast a vote"
on public.superlative_votes
for insert
to authenticated
with check (
  voter_id = (select auth.uid())
  and (target_user_id is null or target_user_id <> (select auth.uid()))
  and exists (
    select 1
      from public.superlative_categories c
      join public.capsules cap on cap.id = c.capsule_id
     where c.id = category_id
       and c.status = 'live'
       and c.capsule_id in (select public.get_my_capsule_ids())
       and cap.superlative_voting_closes_at is not null
       and now() < cap.superlative_voting_closes_at
  )
  and public._superlative_target_valid(category_id, target_user_id, target_media_id)
);

create policy "Members can change their vote"
on public.superlative_votes
for update
to authenticated
using (voter_id = (select auth.uid()))
with check (
  voter_id = (select auth.uid())
  and (target_user_id is null or target_user_id <> (select auth.uid()))
  and exists (
    select 1
      from public.superlative_categories c
      join public.capsules cap on cap.id = c.capsule_id
     where c.id = category_id
       and c.status = 'live'
       and c.capsule_id in (select public.get_my_capsule_ids())
       and cap.superlative_voting_closes_at is not null
       and now() < cap.superlative_voting_closes_at
  )
  and public._superlative_target_valid(category_id, target_user_id, target_media_id)
);

create policy "Members can delete their vote"
on public.superlative_votes
for delete
to authenticated
using (voter_id = (select auth.uid()));

-- ============================================================
-- 11. updated_at maintenance for superlative_votes
-- ============================================================
create or replace function public._touch_superlative_vote_updated_at()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  NEW.updated_at := now();
  return NEW;
end;
$$;

revoke execute on function public._touch_superlative_vote_updated_at() from public, anon, authenticated;

create trigger superlative_votes_touch_updated_at
before update on public.superlative_votes
for each row execute function public._touch_superlative_vote_updated_at();
