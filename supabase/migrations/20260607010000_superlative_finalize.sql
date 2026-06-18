-- Superlatives — Phase 5: window-close detection, winners, and cron.
--
-- A capsule's voting window opens when the capsule unlocks (a BEFORE UPDATE
-- trigger stamps unlocked_at and superlative_voting_closes_at the moment
-- status flips to 'unlocked'). After the window closes, a pg_cron job runs
-- finalize_capsule_superlatives() per due capsule:
--   * computes winners per live category (ties = co-winners via rank()),
--   * archives any pending suggestions that never crossed the threshold,
--   * sets superlative_voting_finalized_at,
--   * inserts 'superlative_won' notification rows for winning members and
--     uploaders of winning media.
--
-- Phase 6 will turn those rows into push notifications.

-- ============================================================
-- 1. Allow new notification types ahead of phase 6.
-- ============================================================
alter table public.notifications
  drop constraint if exists notifications_type_check;
alter table public.notifications
  add constraint notifications_type_check
  check (type = any (array[
    'invite',
    'unlock',
    'contribution_nudge',
    'milestone',
    'reaction',
    'superlative_suggested',
    'superlative_closing_soon',
    'superlative_won'
  ]));

-- ============================================================
-- 2. Track when the cron has finalized a capsule.
-- ============================================================
alter table public.capsules
  add column superlative_voting_finalized_at timestamptz;

-- ============================================================
-- 3. superlative_winners — one row per (category, tied-winning target).
-- ============================================================
create table public.superlative_winners (
  id uuid primary key default gen_random_uuid(),
  category_id     uuid not null references public.superlative_categories(id) on delete cascade,
  target_user_id  uuid references public.users(id) on delete set null,
  target_media_id uuid references public.media(id) on delete set null,
  vote_count      integer not null,
  determined_at   timestamptz not null default now(),
  check ((target_user_id is not null)::int + (target_media_id is not null)::int = 1)
);

create index idx_super_winners_category     on public.superlative_winners (category_id);
create index idx_super_winners_target_user  on public.superlative_winners (target_user_id) where target_user_id is not null;
create index idx_super_winners_target_media on public.superlative_winners (target_media_id) where target_media_id is not null;

alter table public.superlative_winners enable row level security;

-- Members of the capsule can read winners. No INSERT/UPDATE/DELETE policy:
-- writes only happen through the SECURITY DEFINER finalize function.
create policy "Members can read winners"
on public.superlative_winners
for select
to authenticated
using (
  category_id in (
    select id from public.superlative_categories
     where capsule_id in (select public.get_my_capsule_ids())
  )
);

-- ============================================================
-- 4. _stamp_unlock_meta — BEFORE UPDATE trigger that fills
--    unlocked_at + superlative_voting_closes_at when a capsule
--    transitions to 'unlocked'. Works for both the time-cron and
--    the proximity check_in path with no caller changes.
-- ============================================================
create or replace function public._stamp_unlock_meta()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if NEW.status = 'unlocked' and OLD.status is distinct from 'unlocked' then
    if NEW.unlocked_at is null then
      NEW.unlocked_at := now();
    end if;
    if NEW.superlative_voting_closes_at is null then
      NEW.superlative_voting_closes_at :=
        NEW.unlocked_at + make_interval(hours => NEW.superlative_voting_hours);
    end if;
  end if;
  return NEW;
end;
$$;

revoke execute on function public._stamp_unlock_meta() from public, anon, authenticated;

create trigger capsules_stamp_unlock_meta
before update on public.capsules
for each row execute function public._stamp_unlock_meta();

-- ============================================================
-- 5. finalize_capsule_superlatives — compute winners for one
--    capsule and mark it finalized. Idempotent.
-- ============================================================
create or replace function public.finalize_capsule_superlatives(p_capsule_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_closes_at    timestamptz;
  v_finalized_at timestamptz;
begin
  select superlative_voting_closes_at, superlative_voting_finalized_at
    into v_closes_at, v_finalized_at
    from public.capsules
   where id = p_capsule_id;

  if v_closes_at is null then return; end if;
  if v_finalized_at is not null then return; end if;
  if now() < v_closes_at then return; end if;

  -- Winners: rank rows per category by vote_count desc, take rank 1 (ties OK).
  insert into public.superlative_winners (category_id, target_user_id, target_media_id, vote_count)
  with tally as (
    select v.category_id, v.target_user_id, v.target_media_id, count(*) as vc
      from public.superlative_votes v
      join public.superlative_categories c on c.id = v.category_id
     where c.capsule_id = p_capsule_id
       and c.status = 'live'
     group by v.category_id, v.target_user_id, v.target_media_id
  ),
  ranked as (
    select category_id, target_user_id, target_media_id, vc,
           rank() over (partition by category_id order by vc desc) as rk
      from tally
  )
  select category_id, target_user_id, target_media_id, vc
    from ranked
   where rk = 1;

  -- Suggestions that never crossed the upvote threshold get archived.
  update public.superlative_categories
     set status = 'archived'
   where capsule_id = p_capsule_id
     and status = 'pending';

  -- Mark finalized so the cron skips next minute.
  update public.capsules
     set superlative_voting_finalized_at = now()
   where id = p_capsule_id;

  -- 'You won' notifications (phase 6 turns these into push pushes).
  insert into public.notifications (user_id, capsule_id, type)
  select distinct
         coalesce(w.target_user_id, m.uploader_id) as user_id,
         p_capsule_id,
         'superlative_won'
    from public.superlative_winners w
    join public.superlative_categories c on c.id = w.category_id
    left join public.media m on m.id = w.target_media_id
   where c.capsule_id = p_capsule_id
     and coalesce(w.target_user_id, m.uploader_id) is not null;
end;
$$;

revoke execute on function public.finalize_capsule_superlatives(uuid) from public, anon, authenticated;

-- ============================================================
-- 6. close_superlative_windows — cron entry point. Finds every
--    capsule whose voting window has lapsed and finalizes it.
-- ============================================================
create or replace function public.close_superlative_windows()
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_id uuid;
begin
  for v_id in
    select id from public.capsules
     where superlative_voting_closes_at is not null
       and superlative_voting_finalized_at is null
       and now() >= superlative_voting_closes_at
  loop
    perform public.finalize_capsule_superlatives(v_id);
  end loop;
end;
$$;

revoke execute on function public.close_superlative_windows() from public, anon, authenticated;

-- ============================================================
-- 7. pg_cron schedule — every minute.
-- ============================================================
select cron.schedule(
  'close-superlative-windows',
  '* * * * *',
  $cron$select public.close_superlative_windows();$cron$
);

-- ============================================================
-- 8. Backfill already-unlocked capsules so they get a voting
--    window from now (existing test capsules can collect votes).
-- ============================================================
update public.capsules
   set unlocked_at = now(),
       superlative_voting_closes_at =
         now() + make_interval(hours => superlative_voting_hours)
 where status = 'unlocked'
   and unlocked_at is null;
