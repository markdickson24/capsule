-- ============================================================
-- "Surprise mode": let the creator be locked out of viewing a
-- capsule's contents until it unlocks, exactly like everyone else.
--
-- New capsules default to locked (owner_preview_locked = true).
-- Existing capsules keep today's behavior — their owners created
-- them under the old contract (owner can always preview), so we
-- backfill them to false rather than retroactively locking them.
--
-- This is a CREATION-ONLY setting: there is intentionally no UPDATE
-- path in the app that flips it, so an owner can't disable it right
-- before unlock to peek. (RLS still allows the column to change at
-- the DB level via the existing owner UPDATE policy; the client just
-- never exposes a control for it.)
-- ============================================================

alter table public.capsules
  add column if not exists owner_preview_locked boolean not null default true;

-- Preserve current behavior for pre-existing capsules.
update public.capsules set owner_preview_locked = false;

-- ============================================================
-- Tighten the media SELECT policy: when a capsule is locked AND
-- owner_preview_locked is on, NO ONE may read its media (not even
-- the owner or contributors) until status flips to 'unlocked'.
-- When owner_preview_locked is off, the old behavior holds (owner +
-- contributors can preview before unlock).
-- ============================================================
alter policy "Members can view media in unlocked capsules" on public.media
  using (
    exists (
      select 1 from public.capsules c
      join public.capsule_members cm on cm.capsule_id = c.id
      where c.id = media.capsule_id
        and cm.user_id = (select auth.uid())
        and (
          c.status = 'unlocked'
          or (cm.role in ('owner', 'contributor') and not c.owner_preview_locked)
        )
    )
  );

-- ============================================================
-- capsule_media_count: a joined member can learn HOW MANY media a
-- capsule holds without being able to read the rows (storage_keys).
-- This powers the "N memories waiting" line on the locked screen for
-- surprise-mode capsules, where RLS now hides the rows themselves.
-- SECURITY DEFINER so it bypasses the media SELECT policy, but it
-- authorizes inline: only joined members get a real count; everyone
-- else gets 0.
-- ============================================================
create or replace function public.capsule_media_count(p_capsule_id uuid)
returns integer
language sql
security definer
set search_path = public
stable
as $$
  select count(*)::int
  from public.media m
  where m.capsule_id = p_capsule_id
    and exists (
      select 1 from public.capsule_members cm
      where cm.capsule_id = p_capsule_id
        and cm.user_id = (select auth.uid())
        and cm.joined_at is not null
    );
$$;

revoke execute on function public.capsule_media_count(uuid) from public, anon;
grant execute on function public.capsule_media_count(uuid) to authenticated;
