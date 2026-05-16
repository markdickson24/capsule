-- Security & performance hardening — clears the Supabase advisor warnings.
-- See: get_advisors (security + performance) run 2026-05-15.

-- ============================================================
-- 1. Functions: pin search_path on the trigger functions
--    (advisor 0011_function_search_path_mutable)
--    Bodies are fully schema-qualified, so an empty search_path is safe.
-- ============================================================
alter function public.handle_new_user()   set search_path = '';
alter function public.notify_on_invite()   set search_path = '';
alter function public.notify_on_reaction() set search_path = '';

-- ============================================================
-- 2. Drop the leftover debug helper (not referenced anywhere)
-- ============================================================
drop function if exists public.debug_uid();

-- ============================================================
-- 3. Remove trigger functions from the PostgREST RPC surface
--    (advisors 0028 / 0029). Triggers still fire — trigger
--    execution does not check EXECUTE privilege on the caller.
-- ============================================================
revoke execute on function public.handle_new_user()   from public, anon, authenticated;
revoke execute on function public.notify_on_invite()   from public, anon, authenticated;
revoke execute on function public.notify_on_reaction() from public, anon, authenticated;

-- ============================================================
-- 4. Cover foreign keys with indexes
--    (advisor 0001_unindexed_foreign_keys)
-- ============================================================
create index if not exists idx_capsule_members_user_id on public.capsule_members (user_id);
create index if not exists idx_capsules_owner_id        on public.capsules (owner_id);
create index if not exists idx_media_capsule_id         on public.media (capsule_id);
create index if not exists idx_media_uploader_id        on public.media (uploader_id);
create index if not exists idx_notifications_capsule_id on public.notifications (capsule_id);
create index if not exists idx_notifications_user_id    on public.notifications (user_id);
create index if not exists idx_reactions_user_id        on public.reactions (user_id);

-- ============================================================
-- 5. RLS: wrap auth.uid() in (select ...) so it is evaluated
--    once per query instead of once per row
--    (advisor 0003_auth_rls_initplan)
-- ============================================================
alter policy "Members can view media in unlocked capsules" on public.media
  using (
    exists (
      select 1 from public.capsules c
      join public.capsule_members cm on cm.capsule_id = c.id
      where c.id = media.capsule_id
        and cm.user_id = (select auth.uid())
        and (c.status = 'unlocked' or cm.role in ('owner', 'contributor'))
    )
  );

alter policy "Contributors can upload media" on public.media
  with check (
    (select auth.uid()) = uploader_id
    and exists (
      select 1 from public.capsules c
      join public.capsule_members cm on cm.capsule_id = c.id
      where c.id = media.capsule_id
        and cm.user_id = (select auth.uid())
        and cm.role in ('owner', 'contributor')
        and (c.contribution_lock_at is null or now() < c.contribution_lock_at)
    )
  );

alter policy "Users can view their own notifications" on public.notifications
  using ((select auth.uid()) = user_id);

alter policy "Users can mark their notifications as read" on public.notifications
  using ((select auth.uid()) = user_id);

alter policy "Members can view reactions" on public.reactions
  using (
    exists (
      select 1 from public.media m
      join public.capsule_members cm on cm.capsule_id = m.capsule_id
      where m.id = reactions.media_id and cm.user_id = (select auth.uid())
    )
  );

alter policy "Members can add reactions" on public.reactions
  with check (
    (select auth.uid()) = user_id
    and exists (
      select 1 from public.media m
      join public.capsules c on c.id = m.capsule_id
      join public.capsule_members cm on cm.capsule_id = c.id
      where m.id = reactions.media_id
        and cm.user_id = (select auth.uid())
        and c.status = 'unlocked'
    )
  );

alter policy "Users can remove their own reactions" on public.reactions
  using ((select auth.uid()) = user_id);

alter policy "Users can insert their own profile" on public.users
  with check ((select auth.uid()) = id);

alter policy "Users can update their own profile" on public.users
  using ((select auth.uid()) = id);

-- ============================================================
-- 6. users: drop the redundant own-profile SELECT policy.
--    "Authenticated users can search profiles" already grants
--    SELECT with USING (true), which fully covers it. Removing
--    it also clears advisor 0006_multiple_permissive_policies.
-- ============================================================
drop policy if exists "Users can view their own profile" on public.users;

-- ============================================================
-- 7. avatars bucket: drop the broad SELECT policy so clients
--    cannot enumerate the bucket. The avatars bucket is public,
--    so object URLs keep working without any SELECT policy.
--    (advisor 0025_public_bucket_allows_listing)
-- ============================================================
drop policy if exists "Anyone can read avatars" on storage.objects;
