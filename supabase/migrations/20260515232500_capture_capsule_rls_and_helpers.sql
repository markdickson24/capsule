-- Captures an undocumented out-of-band redesign of the capsules/capsule_members
-- RLS policies, along with the two security-definer functions backing it
-- (get_my_capsule_ids, can_insert_capsule_member) — neither was ever
-- committed to a migration. Live production already runs this exact state —
-- confirmed via pg_policies and get_advisors (zero auth_rls_initplan
-- warnings on these tables) before writing this migration. A fresh restore-
-- from-migrations was missing it entirely, which would have left
-- capsule_members on the original self-referential per-row policy from
-- supabase-schema.sql — exactly the "query capsule_members inside a
-- capsule_members policy" recursion risk CLAUDE.md's RLS section warns
-- against. get_my_capsule_ids() is also a dependency of the superlatives
-- policies (20260607000000_superlatives.sql onward), so this is
-- intentionally timestamped well before that.
--
-- Slotted right after 20260515232248_security_hardening.sql, which wrapped
-- auth.uid() for media/reactions/notifications/users but explicitly did not
-- touch capsules/capsule_members — this migration is the missing piece for
-- those two tables.

-- SECURITY DEFINER helper backing capsule_members_select below, and reused
-- by the superlatives RLS policies to avoid per-row joins.
create or replace function public.get_my_capsule_ids()
returns setof uuid language sql stable security definer set search_path = 'public' as $$
  select capsule_id from public.capsule_members where user_id = (select auth.uid());
$$;
grant execute on function public.get_my_capsule_ids() to authenticated;

-- SECURITY DEFINER helper backing capsule_members_insert below. Lets a
-- capsule owner add a member (invite) or a user insert their own row
-- (self-join via QR/deep-link) without the WITH CHECK clause needing to
-- query capsule_members itself.
create or replace function public.can_insert_capsule_member(p_capsule_id uuid, p_user_id uuid)
returns boolean language plpgsql security definer set search_path = 'public' as $$
begin
  return (
    p_user_id = (select auth.uid())
    or exists (
      select 1 from capsules
      where id = p_capsule_id and owner_id = (select auth.uid())
    )
  );
end;
$$;
grant execute on function public.can_insert_capsule_member(uuid, uuid) to authenticated;

-- capsules: same policy names as the supabase-schema.sql baseline, just with
-- auth.uid() wrapped as (select auth.uid()) for the initplan optimization.
drop policy if exists "Members can view capsules they belong to" on public.capsules;
create policy "Members can view capsules they belong to"
  on public.capsules for select using (
    exists (
      select 1 from public.capsule_members
      where capsule_id = capsules.id and user_id = (select auth.uid())
    )
  );

drop policy if exists "Owners can insert capsules" on public.capsules;
create policy "Owners can insert capsules"
  on public.capsules for insert with check ((select auth.uid()) = owner_id);

drop policy if exists "Owners can update their capsules" on public.capsules;
create policy "Owners can update their capsules"
  on public.capsules for update using ((select auth.uid()) = owner_id);

drop policy if exists "Owners can delete their capsules" on public.capsules;
create policy "Owners can delete their capsules"
  on public.capsules for delete using ((select auth.uid()) = owner_id);

-- capsule_members: the original 3 policies (one of which queried
-- capsule_members from within a capsule_members policy — a recursion risk)
-- were replaced with 4 per-command policies backed by security-definer
-- helpers. Drop both the old and current names so this converges to the
-- correct state regardless of which generation a given database is on.
drop policy if exists "Members can view capsule membership" on public.capsule_members;
drop policy if exists "Owners can manage capsule members" on public.capsule_members;
drop policy if exists "Users can join capsules they are invited to" on public.capsule_members;
drop policy if exists "capsule_members_select" on public.capsule_members;
drop policy if exists "capsule_members_insert" on public.capsule_members;
drop policy if exists "capsule_members_update" on public.capsule_members;
drop policy if exists "capsule_members_delete" on public.capsule_members;

create policy "capsule_members_select" on public.capsule_members
  for select using (capsule_id in (select public.get_my_capsule_ids()));

create policy "capsule_members_insert" on public.capsule_members
  for insert with check (public.can_insert_capsule_member(capsule_id, user_id));

create policy "capsule_members_update" on public.capsule_members
  for update using (user_id = (select auth.uid()));

create policy "capsule_members_delete" on public.capsule_members
  for delete using (
    capsule_id in (select id from public.capsules where owner_id = (select auth.uid()))
  );
