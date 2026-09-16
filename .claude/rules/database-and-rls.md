---
paths:
  - "supabase/**"
  - "src/types/database.ts"
  - "supabase-schema.sql"
  - "src/lib/*Grants*.test.ts"
  - "src/lib/*Trigger*.test.ts"
---

<!-- Trimmed from the original CLAUDE.md; backstory kept in HTML comments. Loads automatically when Claude reads a file matching `paths`. -->

## Key RLS Constraints

**Capsule insert goes through the `create_capsule_with_owner(...)` RPC** (`20260711160000_atomic_capsule_create.sql`), not a direct client insert. `CreateScreen`/`OnboardingScreen` used to insert the capsule (no `.select()` — the SELECT policy checks `capsule_members` membership, which doesn't exist yet) then the owner's `capsule_members` row separately; a failed second request left a **zero-member capsule permanently invisible to everyone including its owner** (no owner fallback in the `capsules` SELECT policy). <!-- History: confirmed in production — 10 of 21 capsules had this shape. --> The RPC (`security definer`, since the caller isn't a member yet when the capsule inserts) does both in one PL/pgSQL body — Postgres rolls back the whole function if either raises. Generates + returns the capsule UUID server-side (`returns uuid`); callers no longer `randomUUID()` client-side. Takes an optional `p_group_id` too (`CreateScreen`'s group flow passes it at creation instead of a follow-up `.update()`).

**`capsule_members` policies use security definer functions** to avoid infinite recursion:
- SELECT: `get_my_capsule_ids()` — capsule IDs the user belongs to
- INSERT: `can_insert_capsule_member(capsule_id, user_id)` — checks ownership via `capsules`

**Never query `capsule_members` inside a `capsule_members` policy.** Always go through a security definer function or the `capsules` table directly.

⚠️ **Removing a member is only durable because of a tombstone — `can_insert_capsule_member`'s self-insert arm is otherwise unconditional.** It returns true for *any* `capsule_id` whenever `user_id = auth.uid()` (deliberate — possession of the unguessable capsule UUID **is** the consent act for QR scan-to-join / `capsule://join`), which let `ManageMembersScreen`'s plain-DELETE remove be undone by the removed user re-inserting themselves. `20260802120000_security_authz_fixes.sql` adds **`capsule_member_revocations`** (owner-only RLS, PK `(capsule_id, user_id)`): self-insert now also requires no tombstone row; owner-insert *deletes* one so re-inviting works. `capsule_member_removal_tombstone` (AFTER DELETE) writes it, exempting `auth.uid() = old.user_id` (voluntary leave). **`capsule_members_insert` also pins a self-inserted `role` to `'contributor'`** (owner-inserted rows unrestricted) — lives in the policy, not a function param, since a signature change resets the ACL. **A new self-join flow needing another role must update that policy too.**

⚠️ **`create_capsule_with_owner` validates `p_group_id` and takes a per-caller advisory lock.** An unvalidated `p_group_id` let a capsule be stamped with any group's UUID (readable by anyone ever invited to one of that group's capsules), letting `notify_on_invite`/`send-invite-push` push the victim a notification pointing at the attacker's capsule — now requires a `group_members` row for the caller (`GROUP_MEMBERSHIP_REQUIRED`). Also: the free-tier capsule cap was check-then-act on an unsynchronized `count(*)` (concurrent calls all inserted); now `pg_advisory_xact_lock` keyed on the caller. `enforce_member_limit`/`enforce_photo_limit` had the identical race, locked on the capsule instead (`20260802120100_security_hardening.sql`).

**Client UPDATE on `capsule_members` and `media` is column-grant-scoped** (`20260722120000_audit_rls_hardening.sql`) — both UPDATE policies previously lacked column-level `WITH CHECK` (a `viewer` could self-promote `role`; an uploader could reassign `media.capsule_id`, bypassing the photo cap, or clear `is_flagged`). Fixed by revoking table-wide UPDATE from `authenticated`/`anon` and granting back **only** `capsule_members(joined_at)` (accept-invite) and `media(caption)` (`saveCaption`); everything else — `role`, `capsule_id`, `storage_key`, `is_flagged` — is client-unwritable (role changes only via SECURITY DEFINER RPCs, e.g. `delete_my_account`'s owner transfer). **A new client UPDATE need means a new `grant update (col)`** (table-wide grant is gone). Low-severity follow-ups staged in `20260722130000_audit_hygiene_revokes.sql`.

⚠️ **A function called from inside an RLS policy must be EXECUTE-granted to the role doing the query.** Policies evaluate as the **querying role**, not the table owner — revoking `execute … from authenticated` on a policy helper silently breaks every statement that policy guards, with `42501: permission denied for function …`. (`20260722183609_audit_hygiene_revokes` revoked `_superlative_target_valid`'s EXECUTE from `authenticated` on exactly this mistake, killing all superlative voting for four days unnoticed; restored `20260726000000`.)
<!-- History: the revoke's own comment claimed "RLS-internal use is unaffected" — the opposite of true. It went unnoticed because the only votes still landing were service_role-seeded demo fixtures, which bypass RLS entirely. -->

Before revoking EXECUTE on anything, check whether a policy references it:

```sql
select c.relname, p.polname from pg_policy p join pg_class c on c.oid = p.polrelid
where coalesce(pg_get_expr(p.polqual,p.polrelid),'') || coalesce(pg_get_expr(p.polwithcheck,p.polrelid),'')
      like '%your_function_name(%';
```

Revoking from `anon` alone is safe. A policy helper living in the PostgREST-exposed `public` schema can't be both hidden from the RPC surface and usable by a policy, without moving it to a non-exposed schema and repointing the policies.

All RLS policies use `(select auth.uid())` not `auth.uid()` directly — avoids query planner issues. `get_my_capsule_ids()`, `can_insert_capsule_member()`, and the `capsules`/`capsule_members` policies were live on production for an unknown period with no migration (an out-of-band dashboard/MCP change, captured in `20260515232500_capture_capsule_rls_and_helpers.sql`). **If a live RLS policy or function doesn't match what `mcp__supabase__execute_sql` shows is actually live, assume the live DB is correct and the migration is stale** — verify with `pg_policies`/`pg_get_functiondef` before changing behavior.

**Contribution lock — AND the mirror-image start date — are enforced at TWO layers** (both must allow):
1. `media` INSERT policy: `(c.contribution_lock_at IS NULL OR now() < c.contribution_lock_at) AND (c.contribution_start_at IS NULL OR now() >= c.contribution_start_at)` (joins `capsule_members` for membership + role).
2. `storage.objects` INSERT policy for `capsule-media` (`Contributors can upload to their capsules`) does the **same check**, extracting capsule_id from `(storage.foldername(name))[1]` — previously wide open, closing a hole where storage could be spammed without ever inserting the linking `media` row.

`contribution_start_at` added in `20260716120000_capsule_start_date.sql`. **Unlike the lock, the start gate has no owner exemption** — plain `role in ('owner','contributor')`. Both policies were drop+recreated rather than altered in place.

## Database Schema

Defined in `supabase-schema.sql`.

| Table | Key columns |
|---|---|
| `users` | id, email, display_name, bio (≤80 chars), avatar_url, push_token, auth_provider, subscription_tier, accent_color (default '#FC6A5B'; was '#FF6B35', un-migrated), accent_gradient (nullable `"#a,#b"`, null = solid, Pro-only), home_layout (list/grid, default 'list'), onboarded_at (null = needs wizard), created_at |
| `capsules` | id, owner_id, title, description, unlock_at, contribution_lock_at, status (draft/active/unlocked), visibility (private/invite), created_at, archived_at (null = active), unlock_mode (time/proximity/both), proximity_radius_m (default 100), unlocked_at, superlative_voting_hours (default 48), superlative_voting_closes_at, superlative_voting_finalized_at, superlative_closing_soon_sent_at, owner_preview_locked (default true — surprise mode), occasion (wedding/vacation/party/baby/milestone/general, default 'general'), contribution_start_at (nullable mirror of contribution_lock_at; nobody, owner included, uploads before it), contribution_start_notified_at (dedupe stamp), live_activity_enabled (default true, backfilled false on existing capsules), unlock_notified_at (dedupe stamp for the unlock push, claimed independently of who flipped status) |
| `capsule_member_revocations` | capsule_id + user_id (composite PK), revoked_at, revoked_by — owner-removal tombstone; blocks the removed user's self-insert |
| `capsule_members` | id, capsule_id, user_id, role (owner/contributor/viewer), invited_at, joined_at (null = pending), invite_pushed_at (service-role-written, no client UPDATE grant), archived_at (per-member feed-hide flag), checkin_lat, checkin_lng, checkin_at, contribution_nudge_7d_sent_at / _3d_sent_at / _1d_sent_at (per-tier dedupe stamps), live_activity_override (null = inherit capsule default) |
| `media` | id, capsule_id, uploader_id, storage_key, media_type (photo/video), size_bytes, thumbnail_key, uploaded_at, is_flagged |
| `reactions` | id, media_id, user_id, emoji, created_at — unique (media_id, user_id) |
| `notifications` | id, user_id, capsule_id (nullable, null for friend events), actor_id (nullable), type (invite/unlock/reaction/contribution_nudge/contribution_activity/capsule_started/milestone/superlative_suggested/superlative_closing_soon/superlative_won/friend_request/friend_accept), count (nullable int), sent_at, read_at, pushed_at (null = unpushed) |
| `contribution_activity_pending` | capsule_id + uploader_id (composite PK), photo_count, last_upload_at — debounce staging table |
| `superlative_categories` | id, capsule_id, suggested_by, label (3–80 chars), target_type (person/media), status (pending/live/archived), promoted_at, created_at, is_default (default false) |
| `superlative_upvotes` | category_id + user_id (composite PK), created_at — drives auto-promote trigger |
| `superlative_votes` | category_id + voter_id (composite PK), target_user_id XOR target_media_id, created_at, updated_at — anonymous; clients read own row only |
| `superlative_winners` | id, category_id, target_user_id XOR target_media_id, vote_count, determined_at — written only by finalize RPC |
| `content_reports` | id, reporter_id, target_type (media/user), reported_media_id XOR reported_user_id, capsule_id, reason (spam/harassment/nudity/violence/hate/self_harm/other), details (≤500), status (pending/reviewed/actioned/dismissed), created_at — insert+read-own RLS |
| `blocked_users` | blocker_id + blocked_id (composite PK), created_at — directional; owner-only RLS |
| `friendships` | id, requester_id, addressee_id, status (pending/accepted), created_at, responded_at — one row per unordered pair (unique index on least/greatest); RLS: read-own, insert-as-requester, update-to-accepted-by-addressee, delete-by-either |

**`users` column privileges:** SELECT is `USING (true)` (every signed-in user reads every profile — needed for search/public profiles). `email`, `phone`, `push_token` are removed from the `authenticated` SELECT grant at the **column level**. Never `select('email')` / `select('phone')` / `select('push_token')` / `select('*')` on `users` — it fails. Current user's email is on the auth session (`session.user.email`). Reading another user's `push_token` is server-only (`send-invite-push`).

> ⚠️ **Adding a new client-readable column to `users`?** Because the grant is column-level, a new column via `ALTER TABLE ADD COLUMN` gets **no** SELECT grant by default — any query selecting it fails with `42501 permission denied` for the **entire query**, not just that column. **Always `grant select (...)` the new column to `authenticated` in the same migration.** This bit `home_layout` (added `20260610020000`, granted `20260610210000_grant_home_layout_select.sql`): the missing grant made `ThemeContext`'s `select('accent_color, home_layout')` 403, resetting accent color to default every sign-in. `accent_gradient` (`20260721150000_accent_gradient.sql`) did it right the first time — `grant select (accent_gradient)` and `grant update (accent_gradient)` both live in the same migration as the `ALTER TABLE`.

**Indexes for actual query shapes** (`20260709120000_perf_indexes.sql`, PERFORMANCE.md #9):
- `idx_notifications_unread` — partial `(user_id, sent_at desc) where read_at is null` — Alerts list + tab-badge
- `idx_capsules_unlock_due` — partial `(unlock_at) where status='active' and unlock_mode='time'` — `unlock-capsules` cron filter
- `idx_capsules_group_id` — plain `(group_id)` — group capsule list + `create-group-capsules` cron
- `idx_media_capsule_uploaded` — composite `(capsule_id, uploaded_at desc)`, replaces dropped `idx_media_capsule_id` — so `CapsuleDetailScreen.fetchPhotos`'s `capsule_id = ? order by uploaded_at desc` doesn't sort separately each call

**Triggers:**
- `handle_new_user()` — auto-creates `users` row on `auth.users` insert
- `notify_on_reaction()` — inserts reaction notification (not to self)
- `notify_on_superlative_suggested()` — fan-out on `superlative_categories` insert to every other joined member
- `_promote_superlative()` — on `superlative_upvotes` insert, flips pending→`live` once upvotes hit `ceil(joined/2)`
- `_stamp_unlock_meta()` — BEFORE UPDATE `capsules`; on status→'unlocked' stamps `unlocked_at = now()` and `superlative_voting_closes_at = unlocked_at + voting_hours` (unlock cron + proximity `check_in` both inherit this)
- `_touch_superlative_vote_updated_at()` — bumps `updated_at` on vote change
- `notify_on_friend_request()` — AFTER INSERT `friendships` (pending); `friend_request` notification for the addressee
- `notify_on_friend_accept()` — BEFORE UPDATE `friendships`; pending→accepted stamps `responded_at`, inserts `friend_accept` for the requester
- `notify_contribution_activity()` — AFTER INSERT `media`; upserts a per-(capsule, uploader) row into `contribution_activity_pending`
- `guard_subscription_tier()` — BEFORE INSERT/UPDATE `users`; a client (`auth.role() in ('authenticated','anon')`) setting `subscription_tier` is rejected (`TIER_READONLY`) — only `service_role` may write it
- `guard_group_recurrence()` — BEFORE UPDATE `groups`; blocks a free creator's direct UPDATE to a real recurrence (`GROUP_RECURRENCE_PRO`); cron (`service_role`) exempt, only bumps `next_capsule_at`
- `enforce_member_limit()` — BEFORE INSERT `capsule_members`; owner-tier-keyed cap (10 free / 50 pro), owner's row exempt (`MEMBER_LIMIT_REACHED`)
- `enforce_photo_limit()` — BEFORE INSERT `media`; owner-tier-keyed cap (20 free / 1000 pro) (`PHOTO_LIMIT_REACHED`); all four `guard_*`/`enforce_*` exempt `service_role`/definer/cron paths
- `capsule_member_removal_tombstone()` — AFTER DELETE `capsule_members`; writes `capsule_member_revocations` on owner removal, skips voluntary leave (`auth.uid() = old.user_id`)

**Permission model:** by default only owners preview media before unlock; contributors/viewers see a locked state until `status = 'unlocked'`. Use `isOwner` (`capsule.owner_id === currentUserId`) — works even without a `capsule_members` row. **Surprise mode (`capsules.owner_preview_locked`)** overrides this — see "Surprise Mode".

**Pending invites:** `joined_at IS NULL` on `capsule_members` = not yet accepted (pushed invites via `InviteModal`). QR scan / `capsule://join` set `joined_at` immediately (opening the link is the consent act). `NotificationsScreen` renders pending invites with **Accept** (sets `joined_at`, navigates in) and **Decline** (deletes the row) — declining is the only way to clear one; a plain dismiss would orphan it.

**Notifications are soft-deleted** via `read_at`. Queries filter `.is('read_at', null)`. `NotificationsScreen`'s main query is capped at `.limit(100)` — unread rows accumulate for passive users.
