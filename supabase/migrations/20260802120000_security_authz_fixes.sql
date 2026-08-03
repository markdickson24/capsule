-- Security scan (2026-08-02) — authorization fixes for F3, F16, F17.
-- This migration is SQL-only, written and reviewed without a live database
-- connection: every function/policy body below that is being re-created was
-- copied verbatim from its source migration (cited per-section) and then
-- given the smallest possible diff. No GRANT/REVOKE statements are included
-- anywhere in this file by design — a sibling migration in this same batch
-- (20260802120100_security_hardening.sql) owns grants/locking, and every
-- function touched here is re-created with an UNCHANGED signature via
-- `create or replace`, which — per the Live Activity migration lesson in
-- CLAUDE.md ("Migration lesson (worth re-reading before touching
-- create_capsule_with_owner again)") — preserves the existing ACL. A
-- signature CHANGE would silently reset it; nothing here changes a
-- signature. The one new table gets no explicit grants either, matching the
-- existing convention for freshly-created tables in this codebase (e.g.
-- `contribution_activity_pending` in 20260715120000_contribution_nudges.sql)
-- — Supabase's project-level default privileges already cover it, and RLS
-- policies (below) are what actually govern access.


-- ============================================================================
-- F3 (improper authorization, MEDIUM) — member removal is not durably
-- enforceable, because can_insert_capsule_member's self-insert arm lets any
-- removed member simply re-insert their own capsule_members row.
-- ============================================================================
--
-- IMPORTANT — what this migration deliberately does NOT change:
-- "Possession of the capsule UUID is the consent act" for self-join is an
-- intentional, documented, load-bearing design — QR scan-to-join
-- (QRScannerScreen.joinCapsule) and the capsule://join/<id> deep link
-- (useDeepLinks.joinAndNavigate) both rely on can_insert_capsule_member's
-- `p_user_id = auth.uid()` branch to let a signed-in user insert their own
-- membership row with no owner action required. That branch is NOT removed
-- here. The actual defect is narrower: once an owner has removed a member
-- (ManageMembersScreen's delete), that member can trivially undo the removal
-- by hitting the same self-insert branch again — nothing ever recorded that
-- they were removed. This migration adds a durable "was removed" tombstone
-- and teaches the self-insert branch to honor it. Revocation durability
-- only — not a change to who may self-join a capsule they were never
-- removed from.

-- --------------------------------------------------------------------------
-- 1. Tombstone table. One row per (capsule, user) that the OWNER has
--    explicitly removed. Row presence blocks that user's self-insert;
--    row absence (the common case) changes nothing about today's behavior.
-- --------------------------------------------------------------------------
create table if not exists public.capsule_member_revocations (
  capsule_id uuid not null references public.capsules(id) on delete cascade,
  user_id uuid not null references public.users(id) on delete cascade,
  revoked_at timestamptz not null default now(),
  -- Informational only (who removed them) — on delete set null rather than
  -- cascade/no-action, so a since-deleted owner's account can still be
  -- deleted (delete_my_account) without a leftover tombstone row blocking
  -- the FK. Losing this attribution on account deletion is an acceptable
  -- trade — the tombstone itself (which is what actually matters for
  -- enforcement) is unaffected.
  revoked_by uuid references public.users(id) on delete set null,
  primary key (capsule_id, user_id)
);

alter table public.capsule_member_revocations enable row level security;

-- Owner-only read/write on rows scoped to capsules they own. No policy lets
-- a non-owner (including the revoked user themselves) see or touch these
-- rows — a removed member should not be able to tell they were tombstoned
-- versus just never having been invited.
drop policy if exists "Owners can view revocations for their capsules" on public.capsule_member_revocations;
create policy "Owners can view revocations for their capsules"
  on public.capsule_member_revocations
  for select
  using (
    exists (
      select 1 from public.capsules
      where id = capsule_member_revocations.capsule_id
        and owner_id = (select auth.uid())
    )
  );

drop policy if exists "Owners can insert revocations for their capsules" on public.capsule_member_revocations;
create policy "Owners can insert revocations for their capsules"
  on public.capsule_member_revocations
  for insert
  with check (
    exists (
      select 1 from public.capsules
      where id = capsule_member_revocations.capsule_id
        and owner_id = (select auth.uid())
    )
  );

drop policy if exists "Owners can delete revocations for their capsules" on public.capsule_member_revocations;
create policy "Owners can delete revocations for their capsules"
  on public.capsule_member_revocations
  for delete
  using (
    exists (
      select 1 from public.capsules
      where id = capsule_member_revocations.capsule_id
        and owner_id = (select auth.uid())
    )
  );

-- --------------------------------------------------------------------------
-- 2. can_insert_capsule_member — SAME 2-argument signature as the original
--    in 20260515232500_capture_capsule_rls_and_helpers.sql (reproduced
--    below verbatim except for the two marked additions), so this
--    `create or replace` preserves the existing ACL (grant execute to
--    authenticated; revoke from public/anon in
--    20260718120000_revoke_anon_rpc_execute.sql) with no grant statements
--    needed here.
--
--    Judgment call: role-pinning for the self-insert branch (see F3's task
--    description) is enforced in the RLS POLICY below, not inside this
--    function — that avoids adding a third parameter, which would change
--    the signature and reset the ACL (the exact regression documented in
--    CLAUDE.md for create_capsule_with_owner). Verified both self-join call
--    sites (QRScannerScreen.joinCapsule, useDeepLinks.joinAndNavigate) only
--    ever insert `role: 'contributor'` for a self-row — see the policy
--    below for the pin.
-- --------------------------------------------------------------------------
create or replace function public.can_insert_capsule_member(p_capsule_id uuid, p_user_id uuid)
returns boolean language plpgsql security definer set search_path = 'public' as $$
begin
  if p_user_id = (select auth.uid()) then
    -- Self-insert (QR / capsule://join). Unchanged authorization — the
    -- caller may always insert their own membership row — EXCEPT this user
    -- must not have been explicitly removed from this capsule by its owner.
    return not exists (
      select 1 from capsule_member_revocations
      where capsule_id = p_capsule_id and user_id = p_user_id
    );
  end if;

  if exists (
    select 1 from capsules
    where id = p_capsule_id and owner_id = (select auth.uid())
  ) then
    -- Owner-insert (invite). Unchanged authorization — the owner may insert
    -- a row for anyone. NEW: clear any tombstone for this user so a
    -- previously-removed member the owner is now re-inviting isn't blocked
    -- by their own past removal.
    delete from capsule_member_revocations
      where capsule_id = p_capsule_id and user_id = p_user_id;
    return true;
  end if;

  return false;
end;
$$;

-- Role pin, added to the POLICY rather than the function (see judgment call
-- above): a self-inserted row (user_id = the inserting user) may only ever
-- be 'contributor' — the only role either self-join call site inserts. This
-- closes off a user granting themselves 'owner' (or any other role) via a
-- direct insert with user_id = auth.uid(). Owner-inserted rows (invites) are
-- unrestricted on role, matching existing behavior — the owner is already
-- the trusted party for assigning roles to members they add.
drop policy if exists "capsule_members_insert" on public.capsule_members;
create policy "capsule_members_insert" on public.capsule_members
  for insert with check (
    public.can_insert_capsule_member(capsule_id, user_id)
    and (
      user_id <> (select auth.uid())
      or role = 'contributor'
    )
  );

-- --------------------------------------------------------------------------
-- 3. Tombstone-writing trigger. AFTER DELETE on capsule_members: when the
--    row deleted belongs to someone OTHER than the user who performed the
--    delete, record a tombstone. When a user deletes their OWN row (a
--    voluntary "leave"), no tombstone is written — leaving must not
--    permanently block a later, legitimate self-rejoin via QR/deep-link.
--
--    Today, capsule_members' DELETE policy (capsule_members_delete, from
--    20260515232500) only permits the capsule's OWNER to delete rows at
--    all — there is no client "leave capsule" feature yet (confirmed:
--    ManageMembersScreen's trash-icon removal, owner-only per CLAUDE.md's
--    "Owner-Only Capsule Actions", is the only capsule_members DELETE call
--    site in the app). So in practice every DELETE that reaches this
--    trigger today is an owner-performed removal of a member row, and the
--    `old.user_id = auth.uid()` check below is a forward-looking guard
--    (matching the task's explicit instruction to distinguish the two
--    cases) rather than something currently reachable — it costs nothing
--    and protects against a future self-leave feature landing without
--    someone remembering this trigger exists.
-- --------------------------------------------------------------------------
create or replace function public.capsule_member_removal_tombstone()
returns trigger
language plpgsql
security definer
set search_path = 'public'
as $$
begin
  if (select auth.uid()) = old.user_id then
    -- Self-leave: no tombstone. The member must still be able to rejoin via
    -- QR / capsule://join later — that is the intentional, documented
    -- self-insert design this migration does not touch.
    return old;
  end if;

  -- Owner-performed removal of someone else. Record/refresh a tombstone so
  -- their self-insert (QR/deep-link) is durably blocked until the owner
  -- re-invites them, which clears it (see can_insert_capsule_member above).
  insert into capsule_member_revocations (capsule_id, user_id, revoked_by)
  values (old.capsule_id, old.user_id, (select auth.uid()))
  on conflict (capsule_id, user_id)
  do update set revoked_at = now(), revoked_by = excluded.revoked_by;

  return old;
end;
$$;

drop trigger if exists trg_capsule_member_removal_tombstone on public.capsule_members;
create trigger trg_capsule_member_removal_tombstone
  after delete on public.capsule_members
  for each row execute function public.capsule_member_removal_tombstone();


-- ============================================================================
-- F16 (improper input validation, LOW) — create_capsule_with_owner inserts
-- the client-supplied p_group_id into capsules.group_id with no check that
-- the caller actually belongs to that group, letting an attacker brand
-- their own capsule with a victim's real group name (surfaced downstream by
-- notify_on_invite / send-invite-push, which read groups(name) for the
-- notification/push copy).
-- ============================================================================
--
-- Signature is UNCHANGED (still the 12-arg form from
-- 20260724120000_live_activity_countdown.sql) — this is a same-signature
-- `create or replace`, so per the migration-lesson comment already in that
-- file, the ACL is preserved and no grant/revoke statements are needed here
-- (20260724120100_live_activity_reassert_rpc_grants.sql's revoke-from-
-- public/anon + grant-to-authenticated stays intact).
--
-- Body is copied verbatim from 20260724120000_live_activity_countdown.sql
-- with exactly one addition: when p_group_id is provided, the caller must
-- be a member of that group (public.group_members), or the function raises.
-- This mirrors the free-tier capsule-count check immediately above it in
-- the original body (raise on violation, before any insert).
create or replace function public.create_capsule_with_owner(
  p_title text,
  p_description text,
  p_unlock_at timestamptz,
  p_contribution_lock_at timestamptz,
  p_unlock_mode text,
  p_superlative_voting_hours integer,
  p_owner_preview_locked boolean,
  p_occasion text,
  p_visibility text default 'invite',
  p_group_id uuid default null,
  p_contribution_start_at timestamptz default null,
  p_live_activity_enabled boolean default true
)
returns uuid
language plpgsql
security definer
set search_path to ''
as $function$
declare
  v_uid uuid := (select auth.uid());
  v_capsule_id uuid := gen_random_uuid();
begin
  if v_uid is null then
    raise exception 'Not authenticated';
  end if;

  -- F19: the cap below is a check-then-act on an unsynchronized count. Under
  -- READ COMMITTED, N concurrent calls by the same caller each read the
  -- pre-insert count, all see < 3, and all insert — so a free user could fire
  -- 50 simultaneous requests and end up with 50 active capsules. Serialize
  -- per-caller before counting; the lock is transaction-scoped and released
  -- at commit/rollback. Keyed on the user (not the capsule, which does not
  -- exist yet). Mirrors the same fix applied to enforce_member_limit /
  -- enforce_photo_limit in 20260802120100_security_hardening.sql.
  perform pg_advisory_xact_lock(hashtextextended('create_capsule_with_owner:' || v_uid::text, 0));

  -- Free tier cap. Kept in sync with TIER_LIMITS.free.activeCapsules in
  -- src/lib/tierLimits.ts (SQL can't import TS).
  if (select subscription_tier from public.users where id = v_uid) = 'free'
     and (select count(*) from public.capsules
          where owner_id = v_uid and status <> 'unlocked') >= 3 then
    raise exception 'CAPSULE_LIMIT_REACHED';
  end if;

  -- NEW (F16): a client-supplied group_id must actually belong to the
  -- caller. Without this, capsules.group_id — a plain readable column on
  -- every capsule — could be branded with any group's UUID, and
  -- notify_on_invite / send-invite-push would notify/push every member of
  -- the resulting capsule using that group's real name, pointing at a
  -- capsule the group never created.
  if p_group_id is not null
     and not exists (
       select 1 from public.group_members
       where group_id = p_group_id and user_id = v_uid
     ) then
    raise exception 'GROUP_MEMBERSHIP_REQUIRED';
  end if;

  insert into public.capsules (
    id, owner_id, title, description, unlock_at, contribution_lock_at,
    unlock_mode, superlative_voting_hours, owner_preview_locked, occasion,
    status, visibility, group_id, contribution_start_at, live_activity_enabled
  ) values (
    v_capsule_id, v_uid, p_title, p_description, p_unlock_at, p_contribution_lock_at,
    p_unlock_mode, p_superlative_voting_hours, p_owner_preview_locked, p_occasion,
    'active', p_visibility, p_group_id, p_contribution_start_at, p_live_activity_enabled
  );

  insert into public.capsule_members (capsule_id, user_id, role, joined_at)
  values (v_capsule_id, v_uid, 'owner', now());

  return v_capsule_id;
end;
$function$;


-- ============================================================================
-- F17 (improper authorization, LOW) — the media SELECT policy tests
-- cm.user_id = auth.uid() with no cm.joined_at is not null filter, so an
-- invited-but-never-accepted user (a pending invite, joined_at still null)
-- can read every media row of the capsule: captions, uploader ids, upload
-- times, and raw storage_key/alt_storage_key/thumbnail_key values.
-- ============================================================================
--
-- Same policy, same USING-only shape as its last edit
-- (20260618000000_owner_preview_lock.sql) — reproduced verbatim with one
-- added clause (`and cm.joined_at is not null`) so it matches the
-- joined-member convention used everywhere else in the codebase (the
-- capsule-media storage SELECT policy, capsule_media_count, etc.).
-- `alter policy ... using (...)` only replaces the USING clause of the
-- existing "Members can view media in unlocked capsules" policy — it is not
-- a drop+create, so nothing about the policy's identity changes.
alter policy "Members can view media in unlocked capsules" on public.media
  using (
    exists (
      select 1 from public.capsules c
      join public.capsule_members cm on cm.capsule_id = c.id
      where c.id = media.capsule_id
        and cm.user_id = (select auth.uid())
        and cm.joined_at is not null
        and (
          c.status = 'unlocked'
          or (cm.role in ('owner', 'contributor') and not c.owner_preview_locked)
        )
    )
  );
