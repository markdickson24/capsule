-- Security fixes for live-verified vulnerabilities found in the 2026-07-22 full
-- audit. See audits/FULL_AUDIT_2026-07-22.md (BS-1 Critical, BS-2 High, BS-3).
-- All three were confirmed live on production via pg_policies. Additive/reversible.

-- ── BS-1 (Critical) ─────────────────────────────────────────────────────────
-- The private `capsule-media` bucket had TWO SELECT policies, both
-- `USING (bucket_id = 'capsule-media')` with NO membership check — so any
-- authenticated user could list/download/sign every capsule's private media,
-- bypassing membership, time-locks, surprise mode, and member removal. These
-- were out-of-band dashboard artifacts (no migration ever created them).
-- Replace with one policy that mirrors the `media` table's own SELECT policy
-- exactly, so a signed URL can only be minted for an object whose `media` row
-- the caller can already see.
drop policy if exists "Authenticated users can read capsule media" on storage.objects;
drop policy if exists "Authenticated users can read media" on storage.objects;

create policy "Members can read their capsule media"
  on storage.objects
  for select
  to authenticated
  using (
    bucket_id = 'capsule-media'
    and exists (
      select 1
      from public.capsules c
      join public.capsule_members cm on cm.capsule_id = c.id
      where (c.id)::text = (storage.foldername(objects.name))[1]
        and cm.user_id = (select auth.uid())
        and cm.joined_at is not null
        and (
          c.status = 'unlocked'
          or (cm.role in ('owner', 'contributor') and not c.owner_preview_locked)
        )
    )
  );

-- ── BS-2 (High) ─────────────────────────────────────────────────────────────
-- `capsule_members` UPDATE had no WITH CHECK / column scope, so a member (even a
-- read-only `viewer`) could self-promote their `role` to contributor/owner and
-- gain upload rights the owner withheld. The ONLY legitimate direct client
-- UPDATE is accept-invite setting `joined_at` (NotificationsScreen). Restrict
-- client UPDATE to that one column via column-level grants — role/capsule_id/etc
-- become un-writable by clients. Legit role changes go only through SECURITY
-- DEFINER RPCs (e.g. delete_my_account's owner transfer), which run as the
-- function owner and are unaffected by these grants.
revoke update on public.capsule_members from authenticated;
revoke update on public.capsule_members from anon;
grant update (joined_at) on public.capsule_members to authenticated;

-- ── BS-3 (Medium) ───────────────────────────────────────────────────────────
-- `media` UPDATE's WITH CHECK only pinned `uploader_id`, so an uploader could
-- reassign their row's `capsule_id` (cross-capsule injection, bypassing the
-- INSERT membership/lock checks and enforce_photo_limit) or clear `is_flagged`
-- (defeating moderation). The only legitimate client UPDATE is `caption`
-- (saveCaption); the upload queue sets storage_key/thumbnail_key/alt_storage_key
-- at INSERT time, never via UPDATE. Restrict client UPDATE to `caption`.
revoke update on public.media from authenticated;
revoke update on public.media from anon;
grant update (caption) on public.media to authenticated;
