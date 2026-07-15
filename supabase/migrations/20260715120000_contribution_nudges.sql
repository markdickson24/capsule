-- Contribution nudges (phase 1 of retention notifications):
-- 1) contribution_activity — batched social-proof ping when a member uploads
--    photos, delivered to other joined members via dispatch-contribution-activity.
-- 2) contribution_nudge — tiered (7d/3d/1d) reminder to joined owner/contributor
--    members who haven't uploaded anything yet as a capsule's effective
--    contribution deadline approaches, delivered via contribution-nudges.
-- See docs/superpowers/specs/2026-07-15-contribution-nudges-design.md.

-- ---------- notifications: generic count column + extended type enum ----------

alter table public.notifications add column count int;

alter table public.notifications drop constraint notifications_type_check;
alter table public.notifications add constraint notifications_type_check
  check (type in (
    'invite', 'unlock', 'contribution_nudge', 'milestone', 'reaction',
    'superlative_suggested', 'superlative_closing_soon', 'superlative_won',
    'friend_request', 'friend_accept', 'unlock_reminder', 'group_capsule',
    'group_capsule_upcoming', 'contribution_activity'
  ));

-- ---------- capsule_members: per-member, per-tier nudge dedupe stamps ----------

alter table public.capsule_members
  add column contribution_nudge_7d_sent_at timestamptz,
  add column contribution_nudge_3d_sent_at timestamptz,
  add column contribution_nudge_1d_sent_at timestamptz;

-- ---------- staging table for debounced activity batching ----------

create table public.contribution_activity_pending (
  capsule_id uuid not null references public.capsules(id) on delete cascade,
  uploader_id uuid not null references public.users(id) on delete cascade,
  photo_count int not null default 0,
  last_upload_at timestamptz not null default now(),
  primary key (capsule_id, uploader_id)
);

alter table public.contribution_activity_pending enable row level security;
-- No policies added — deny-all to clients. Only the SECURITY DEFINER trigger
-- below and the service-role edge function (Task 3) touch this table.

-- ---------- trigger: stage activity on every media insert ----------

create or replace function public.notify_contribution_activity()
returns trigger
language plpgsql
security definer
set search_path to ''
as $$
begin
  insert into public.contribution_activity_pending as cap
    (capsule_id, uploader_id, photo_count, last_upload_at)
  values (new.capsule_id, new.uploader_id, 1, now())
  on conflict (capsule_id, uploader_id) do update
    set photo_count = cap.photo_count + 1,
        last_upload_at = now();
  return new;
end;
$$;

revoke execute on function public.notify_contribution_activity() from public, anon, authenticated;

create trigger on_media_insert_contribution_activity
  after insert on public.media
  for each row execute function public.notify_contribution_activity();

-- ---------- RPC: claim a nudge tier (called by the contribution-nudges cron, Task 4) ----------
-- One atomic UPDATE ... RETURNING per tier means an overlapping cron tick can't
-- double-send: a second call matches zero rows for members already stamped.

create or replace function public.claim_contribution_nudge_tier(p_tier text)
returns table (user_id uuid, capsule_id uuid, capsule_title text, effective_deadline timestamptz)
language plpgsql
security definer
set search_path to ''
as $$
begin
  if p_tier = '7d' then
    return query
      update public.capsule_members cm
      set contribution_nudge_7d_sent_at = now()
      from public.capsules c
      where cm.capsule_id = c.id
        and cm.joined_at is not null
        and cm.role in ('owner', 'contributor')
        and cm.contribution_nudge_7d_sent_at is null
        and c.status = 'active'
        and coalesce(c.contribution_lock_at, case when c.unlock_mode in ('time', 'both') then c.unlock_at end) is not null
        and now() < coalesce(c.contribution_lock_at, case when c.unlock_mode in ('time', 'both') then c.unlock_at end)
        and coalesce(c.contribution_lock_at, case when c.unlock_mode in ('time', 'both') then c.unlock_at end) <= now() + interval '7 days'
        and not exists (select 1 from public.media m where m.capsule_id = c.id and m.uploader_id = cm.user_id)
      returning cm.user_id, cm.capsule_id, c.title,
        coalesce(c.contribution_lock_at, case when c.unlock_mode in ('time', 'both') then c.unlock_at end);
  elsif p_tier = '3d' then
    return query
      update public.capsule_members cm
      set contribution_nudge_3d_sent_at = now()
      from public.capsules c
      where cm.capsule_id = c.id
        and cm.joined_at is not null
        and cm.role in ('owner', 'contributor')
        and cm.contribution_nudge_3d_sent_at is null
        and c.status = 'active'
        and coalesce(c.contribution_lock_at, case when c.unlock_mode in ('time', 'both') then c.unlock_at end) is not null
        and now() < coalesce(c.contribution_lock_at, case when c.unlock_mode in ('time', 'both') then c.unlock_at end)
        and coalesce(c.contribution_lock_at, case when c.unlock_mode in ('time', 'both') then c.unlock_at end) <= now() + interval '3 days'
        and not exists (select 1 from public.media m where m.capsule_id = c.id and m.uploader_id = cm.user_id)
      returning cm.user_id, cm.capsule_id, c.title,
        coalesce(c.contribution_lock_at, case when c.unlock_mode in ('time', 'both') then c.unlock_at end);
  elsif p_tier = '1d' then
    return query
      update public.capsule_members cm
      set contribution_nudge_1d_sent_at = now()
      from public.capsules c
      where cm.capsule_id = c.id
        and cm.joined_at is not null
        and cm.role in ('owner', 'contributor')
        and cm.contribution_nudge_1d_sent_at is null
        and c.status = 'active'
        and coalesce(c.contribution_lock_at, case when c.unlock_mode in ('time', 'both') then c.unlock_at end) is not null
        and now() < coalesce(c.contribution_lock_at, case when c.unlock_mode in ('time', 'both') then c.unlock_at end)
        and coalesce(c.contribution_lock_at, case when c.unlock_mode in ('time', 'both') then c.unlock_at end) <= now() + interval '1 day'
        and not exists (select 1 from public.media m where m.capsule_id = c.id and m.uploader_id = cm.user_id)
      returning cm.user_id, cm.capsule_id, c.title,
        coalesce(c.contribution_lock_at, case when c.unlock_mode in ('time', 'both') then c.unlock_at end);
  else
    raise exception 'claim_contribution_nudge_tier: invalid tier %', p_tier;
  end if;
end;
$$;

revoke execute on function public.claim_contribution_nudge_tier(text) from public, anon, authenticated;

-- ---------- RPC: top contributors for a capsule (called by the contribution-nudges cron) ----------
-- Returns every uploader who has contributed, ordered by photo count desc, so
-- the caller can pick the first one not blocked by a given recipient (a
-- recipient can never appear in this list themselves, since nudge recipients
-- are by definition members with zero uploads).

create or replace function public.top_contributors(p_capsule_id uuid)
returns table (user_id uuid, display_name text, photo_count int)
language sql
security definer
set search_path to ''
stable
as $$
  select m.uploader_id, u.display_name, count(*)::int as photo_count
  from public.media m
  join public.users u on u.id = m.uploader_id
  where m.capsule_id = p_capsule_id
  group by m.uploader_id, u.display_name
  order by count(*) desc;
$$;

revoke execute on function public.top_contributors(uuid) from public, anon, authenticated;
