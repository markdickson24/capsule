-- UGC moderation primitives (Apple App Store Guideline 1.2): let users report
-- objectionable content/users and block abusive users.
--
-- Scope here is report + block only. Admin review tooling and EULA-at-signup are
-- deferred; reports land in `content_reports` for out-of-band review via the
-- service role.

-- ---------------------------------------------------------------------------
-- content_reports — one row per report filed by a user against media OR a user.
-- ---------------------------------------------------------------------------
create table if not exists public.content_reports (
  id uuid primary key default gen_random_uuid(),
  reporter_id uuid not null references public.users(id) on delete cascade,
  target_type text not null check (target_type in ('media', 'user')),
  reported_media_id uuid references public.media(id) on delete cascade,
  reported_user_id uuid references public.users(id) on delete cascade,
  capsule_id uuid references public.capsules(id) on delete set null,
  reason text not null check (reason in ('spam', 'harassment', 'nudity', 'violence', 'hate', 'self_harm', 'other')),
  details text check (char_length(details) <= 500),
  status text not null default 'pending' check (status in ('pending', 'reviewed', 'actioned', 'dismissed')),
  created_at timestamptz not null default now(),
  -- Exactly one target, matching target_type.
  constraint content_reports_target_chk check (
    (target_type = 'media' and reported_media_id is not null and reported_user_id is null)
    or (target_type = 'user' and reported_user_id is not null and reported_media_id is null)
  ),
  -- Can't report yourself.
  constraint content_reports_no_self check (reported_user_id is null or reported_user_id <> reporter_id)
);

create index if not exists content_reports_status_idx on public.content_reports (status, created_at desc);
create index if not exists content_reports_reporter_idx on public.content_reports (reporter_id);

alter table public.content_reports enable row level security;

-- A user can file a report as themselves.
create policy "Users can file reports"
on public.content_reports for insert to authenticated
with check ((select auth.uid()) = reporter_id);

-- A user can read back only their own reports (so the UI can confirm submission).
-- Review of all reports happens server-side with the service role.
create policy "Users can read their own reports"
on public.content_reports for select to authenticated
using ((select auth.uid()) = reporter_id);

-- ---------------------------------------------------------------------------
-- blocked_users — directional block. blocker stops seeing blocked's content.
-- ---------------------------------------------------------------------------
create table if not exists public.blocked_users (
  blocker_id uuid not null references public.users(id) on delete cascade,
  blocked_id uuid not null references public.users(id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (blocker_id, blocked_id),
  constraint blocked_users_no_self check (blocker_id <> blocked_id)
);

alter table public.blocked_users enable row level security;

-- A user fully manages their OWN block list, and can only see their own rows
-- (the blocked party must not be able to tell they were blocked).
create policy "Users can read their own blocks"
on public.blocked_users for select to authenticated
using ((select auth.uid()) = blocker_id);

create policy "Users can add their own blocks"
on public.blocked_users for insert to authenticated
with check ((select auth.uid()) = blocker_id);

create policy "Users can remove their own blocks"
on public.blocked_users for delete to authenticated
using ((select auth.uid()) = blocker_id);
