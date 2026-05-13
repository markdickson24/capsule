-- Enable UUID extension
create extension if not exists "uuid-ossp";

-- Users table (extends Supabase auth.users)
create table public.users (
  id uuid references auth.users(id) on delete cascade primary key,
  email text,
  phone text,
  display_name text not null,
  avatar_url text,
  auth_provider text not null default 'email',
  subscription_tier text not null default 'free' check (subscription_tier in ('free', 'pro')),
  created_at timestamptz not null default now()
);

-- Capsules table
create table public.capsules (
  id uuid primary key default uuid_generate_v4(),
  owner_id uuid references public.users(id) on delete cascade not null,
  title text not null,
  description text,
  unlock_at timestamptz not null,
  contribution_lock_at timestamptz,
  status text not null default 'draft' check (status in ('draft', 'active', 'unlocked')),
  visibility text not null default 'invite' check (visibility in ('private', 'invite')),
  created_at timestamptz not null default now(),
  archived_at timestamptz
);

-- Capsule members table
create table public.capsule_members (
  id uuid primary key default uuid_generate_v4(),
  capsule_id uuid references public.capsules(id) on delete cascade not null,
  user_id uuid references public.users(id) on delete cascade not null,
  role text not null check (role in ('owner', 'contributor', 'viewer')),
  invited_at timestamptz not null default now(),
  joined_at timestamptz,
  unique(capsule_id, user_id)
);

-- Media table
create table public.media (
  id uuid primary key default uuid_generate_v4(),
  capsule_id uuid references public.capsules(id) on delete cascade not null,
  uploader_id uuid references public.users(id) on delete cascade not null,
  storage_key text not null,
  media_type text not null check (media_type in ('photo', 'video')),
  size_bytes bigint not null,
  thumbnail_key text,
  uploaded_at timestamptz not null default now(),
  is_flagged boolean not null default false
);

-- Reactions table
create table public.reactions (
  id uuid primary key default uuid_generate_v4(),
  media_id uuid references public.media(id) on delete cascade not null,
  user_id uuid references public.users(id) on delete cascade not null,
  emoji text not null,
  created_at timestamptz not null default now(),
  unique(media_id, user_id)
);

-- Notifications table
create table public.notifications (
  id uuid primary key default uuid_generate_v4(),
  user_id uuid references public.users(id) on delete cascade not null,
  capsule_id uuid references public.capsules(id) on delete cascade not null,
  type text not null check (type in ('invite', 'unlock', 'contribution_nudge', 'milestone', 'reaction')),
  sent_at timestamptz not null default now(),
  read_at timestamptz
);

-- =====================
-- ROW LEVEL SECURITY
-- =====================

alter table public.users enable row level security;
alter table public.capsules enable row level security;
alter table public.capsule_members enable row level security;
alter table public.media enable row level security;
alter table public.reactions enable row level security;
alter table public.notifications enable row level security;

-- Users: can only read/update your own profile
create policy "Users can view their own profile"
  on public.users for select using (auth.uid() = id);

create policy "Users can update their own profile"
  on public.users for update using (auth.uid() = id);

create policy "Users can insert their own profile"
  on public.users for insert with check (auth.uid() = id);

-- Capsules: members can view, owners can do everything
create policy "Members can view capsules they belong to"
  on public.capsules for select using (
    exists (
      select 1 from public.capsule_members
      where capsule_id = capsules.id and user_id = auth.uid()
    )
  );

create policy "Owners can insert capsules"
  on public.capsules for insert with check (auth.uid() = owner_id);

create policy "Owners can update their capsules"
  on public.capsules for update using (auth.uid() = owner_id);

create policy "Owners can delete their capsules"
  on public.capsules for delete using (auth.uid() = owner_id);

-- Capsule members: members can view membership, owners can manage
create policy "Members can view capsule membership"
  on public.capsule_members for select using (
    exists (
      select 1 from public.capsule_members cm
      where cm.capsule_id = capsule_members.capsule_id and cm.user_id = auth.uid()
    )
  );

create policy "Owners can manage capsule members"
  on public.capsule_members for all using (
    exists (
      select 1 from public.capsules
      where id = capsule_members.capsule_id and owner_id = auth.uid()
    )
  );

create policy "Users can join capsules they are invited to"
  on public.capsule_members for update using (user_id = auth.uid());

-- Media: members can view unlocked media, contributors can upload
create policy "Members can view media in unlocked capsules"
  on public.media for select using (
    exists (
      select 1 from public.capsules c
      join public.capsule_members cm on cm.capsule_id = c.id
      where c.id = media.capsule_id
        and cm.user_id = auth.uid()
        and (c.status = 'unlocked' or cm.role in ('owner', 'contributor'))
    )
  );

create policy "Contributors can upload media"
  on public.media for insert with check (
    auth.uid() = uploader_id and
    exists (
      select 1 from public.capsules c
      join public.capsule_members cm on cm.capsule_id = c.id
      where c.id = media.capsule_id
        and cm.user_id = auth.uid()
        and cm.role in ('owner', 'contributor')
        and (c.contribution_lock_at is null or now() < c.contribution_lock_at)
    )
  );

-- Reactions: members can react to unlocked capsule media
create policy "Members can view reactions"
  on public.reactions for select using (
    exists (
      select 1 from public.media m
      join public.capsule_members cm on cm.capsule_id = m.capsule_id
      where m.id = reactions.media_id and cm.user_id = auth.uid()
    )
  );

create policy "Members can add reactions"
  on public.reactions for insert with check (
    auth.uid() = user_id and
    exists (
      select 1 from public.media m
      join public.capsules c on c.id = m.capsule_id
      join public.capsule_members cm on cm.capsule_id = c.id
      where m.id = reactions.media_id
        and cm.user_id = auth.uid()
        and c.status = 'unlocked'
    )
  );

create policy "Users can remove their own reactions"
  on public.reactions for delete using (auth.uid() = user_id);

-- Notifications: users can only see their own
create policy "Users can view their own notifications"
  on public.notifications for select using (auth.uid() = user_id);

create policy "Users can mark their notifications as read"
  on public.notifications for update using (auth.uid() = user_id);

-- =====================
-- AUTO-CREATE USER PROFILE ON SIGNUP
-- =====================

create or replace function public.handle_new_user()
returns trigger as $$
begin
  insert into public.users (id, email, phone, display_name, auth_provider)
  values (
    new.id,
    new.email,
    new.phone,
    coalesce(new.raw_user_meta_data->>'display_name', split_part(coalesce(new.email, new.phone, 'user'), '@', 1)),
    coalesce(new.raw_user_meta_data->>'provider', 'email')
  );
  return new;
end;
$$ language plpgsql security definer;

create trigger on_auth_user_created
  after insert on auth.users
  for each row execute procedure public.handle_new_user();

-- =====================
-- REACTION NOTIFICATION TRIGGER
-- =====================

create or replace function notify_on_reaction()
returns trigger as $$
declare
  v_uploader_id uuid;
  v_capsule_id  uuid;
begin
  select m.uploader_id, m.capsule_id
    into v_uploader_id, v_capsule_id
    from public.media m
   where m.id = NEW.media_id;

  if v_uploader_id is not null and v_uploader_id != NEW.user_id then
    insert into public.notifications (user_id, capsule_id, type, sent_at)
    values (v_uploader_id, v_capsule_id, 'reaction', now());
  end if;

  return NEW;
end;
$$ language plpgsql security definer;

create trigger on_reaction_added
  after insert on public.reactions
  for each row execute function notify_on_reaction();
