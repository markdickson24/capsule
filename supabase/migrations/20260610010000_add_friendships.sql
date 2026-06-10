-- Real friendships with friend requests. Previously "friends" was derived from
-- shared capsule membership; now it's an explicit request/accept relationship.

create table if not exists public.friendships (
  id uuid primary key default gen_random_uuid(),
  requester_id uuid not null references public.users(id) on delete cascade,
  addressee_id uuid not null references public.users(id) on delete cascade,
  status text not null default 'pending' check (status in ('pending', 'accepted')),
  created_at timestamptz not null default now(),
  responded_at timestamptz,
  constraint friendships_no_self check (requester_id <> addressee_id)
);

-- One relationship per unordered pair (blocks A→B and B→A duplicates).
create unique index if not exists friendships_pair_uniq
  on public.friendships (least(requester_id, addressee_id), greatest(requester_id, addressee_id));
create index if not exists friendships_addressee_idx on public.friendships (addressee_id, status);
create index if not exists friendships_requester_idx on public.friendships (requester_id, status);

alter table public.friendships enable row level security;

-- Either party can see the relationship.
create policy "Read own friendships" on public.friendships for select to authenticated
using ((select auth.uid()) = requester_id or (select auth.uid()) = addressee_id);

-- Only the requester can create the (pending) request as themselves.
create policy "Send friend request" on public.friendships for insert to authenticated
with check ((select auth.uid()) = requester_id);

-- Only the addressee can accept, and the only allowed transition is -> accepted.
create policy "Accept friend request" on public.friendships for update to authenticated
using ((select auth.uid()) = addressee_id)
with check ((select auth.uid()) = addressee_id and status = 'accepted');

-- Either party can delete: cancel a sent request, decline a received one, or unfriend.
create policy "Remove friendship" on public.friendships for delete to authenticated
using ((select auth.uid()) = requester_id or (select auth.uid()) = addressee_id);

-- --------------------------------------------------------------------------
-- Notifications: allow capsule-less, actor-based friend events.
-- --------------------------------------------------------------------------
alter table public.notifications alter column capsule_id drop not null;
alter table public.notifications add column if not exists actor_id uuid references public.users(id) on delete cascade;

alter table public.notifications drop constraint if exists notifications_type_check;
alter table public.notifications add constraint notifications_type_check
  check (type in (
    'invite', 'unlock', 'contribution_nudge', 'milestone', 'reaction',
    'superlative_suggested', 'superlative_closing_soon', 'superlative_won',
    'friend_request', 'friend_accept'
  ));

-- Notify the addressee when a request is sent.
create or replace function public.notify_on_friend_request()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if new.status = 'pending' then
    insert into public.notifications (user_id, actor_id, type, capsule_id)
    values (new.addressee_id, new.requester_id, 'friend_request', null);
  end if;
  return new;
end;
$$;

drop trigger if exists trg_notify_friend_request on public.friendships;
create trigger trg_notify_friend_request
after insert on public.friendships
for each row execute function public.notify_on_friend_request();

-- Notify the requester when their request is accepted, and stamp responded_at.
create or replace function public.notify_on_friend_accept()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if new.status = 'accepted' and old.status = 'pending' then
    new.responded_at = now();
    insert into public.notifications (user_id, actor_id, type, capsule_id)
    values (new.requester_id, new.addressee_id, 'friend_accept', null);
  end if;
  return new;
end;
$$;

drop trigger if exists trg_notify_friend_accept on public.friendships;
create trigger trg_notify_friend_accept
before update on public.friendships
for each row execute function public.notify_on_friend_accept();
