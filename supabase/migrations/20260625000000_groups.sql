-- Groups: named member sets with recurrence schedules that auto-create capsules.

-- groups table
create table public.groups (
  id uuid primary key default gen_random_uuid(),
  name text not null check (char_length(name) between 1 and 60),
  created_by uuid not null references public.users(id) on delete cascade,
  recurrence_interval text not null default 'manual'
    check (recurrence_interval in ('weekly', 'monthly', 'yearly', 'manual')),
  unlock_duration_hours int not null default 720
    check (unlock_duration_hours between 1 and 8760),
  next_capsule_at timestamptz,
  last_capsule_at timestamptz,
  created_at timestamptz not null default now()
);

-- group_members table
create table public.group_members (
  id uuid primary key default gen_random_uuid(),
  group_id uuid not null references public.groups(id) on delete cascade,
  user_id uuid not null references public.users(id) on delete cascade,
  joined_at timestamptz not null default now(),
  unique (group_id, user_id)
);
create index on public.group_members (group_id);
create index on public.group_members (user_id);

-- Link capsules to their originating group (nullable)
alter table public.capsules add column group_id uuid references public.groups(id) on delete set null;

-- RLS
alter table public.groups enable row level security;
alter table public.group_members enable row level security;

-- SECURITY DEFINER helper — avoids recursion inside group_members SELECT policy
create or replace function public.get_my_group_ids()
returns setof uuid language sql stable security definer set search_path = public as $$
  select group_id from public.group_members where user_id = (select auth.uid());
$$;
grant execute on function public.get_my_group_ids() to authenticated;

-- groups policies
create policy "Members can view groups" on public.groups
  for select using (id in (select get_my_group_ids()));
create policy "Creator can insert groups" on public.groups
  for insert with check ((select auth.uid()) = created_by);
create policy "Creator can update groups" on public.groups
  for update using ((select auth.uid()) = created_by);
create policy "Creator can delete groups" on public.groups
  for delete using ((select auth.uid()) = created_by);

-- group_members policies
create policy "Members can view group membership" on public.group_members
  for select using (group_id in (select get_my_group_ids()));
create policy "Creator can add members" on public.group_members
  for insert with check (
    (select created_by from public.groups where id = group_id) = (select auth.uid())
    or user_id = (select auth.uid())
  );
create policy "Creator or self can remove members" on public.group_members
  for delete using (
    (select created_by from public.groups where id = group_id) = (select auth.uid())
    or user_id = (select auth.uid())
  );

grant select, insert, update, delete on public.groups to authenticated;
grant select, insert, delete on public.group_members to authenticated;
