# Capsule — Backend Security Audit (Supabase)

**Date:** 2026-07-22
**Scope:** RLS policies, SECURITY DEFINER functions, column grants, edge functions, storage bucket policies, triggers — `supabase/migrations/*.sql` cross-checked against the LIVE database (project `ezxxvvmesegegkdeniri`).
**Method:** Read-only. `mcp__supabase__execute_sql` (SELECT only), `get_advisors`, `list_tables`, `get_edge_function`, `pg_policies`/`pg_proc`/`information_schema` inspection, `pg_cron` job listing. No writes, no DDL were executed. One harmless read-only `SELECT public.enforce_member_limit();` was run to empirically confirm a trigger-function-cannot-be-called-directly claim (see BS-6); it raised the expected Postgres error and mutated nothing.

---

## Summary

| Severity | Count |
|---|---|
| Critical | 1 |
| High | 1 |
| Medium | 1 |
| Low | 3 |
| Info (verified safe / hardening) | 1 |

---

## BS-1 — `capsule-media` storage bucket SELECT policy has no capsule-membership check: any authenticated user can enumerate and download every private photo/video in the app

**Severity:** Critical
**Category:** Storage bucket policy / RLS
**Location:** `storage.objects` policies `"Authenticated users can read capsule media"` and `"Authenticated users can read media"` (both live-DB only — no migration file creates either; confirmed absent from `supabase/migrations/*.sql`)
**Confidence:** High (verified directly against live `pg_policies`, live bucket config, and the app's own documented precedent for the same class of bug)

### Description

The `capsule-media` bucket is private (`storage.buckets.public = false`, confirmed live). CLAUDE.md documents `media` table reads as gated by capsule membership + unlock state + surprise-mode, and documents the `storage.objects` **INSERT** policy as mirroring that same membership/lock/start check. But the bucket's **SELECT** policies are:

```sql
-- "Authenticated users can read capsule media"  (SELECT, role authenticated)
qual: (bucket_id = 'capsule-media')

-- "Authenticated users can read media"  (SELECT, role authenticated) — exact duplicate
qual: (bucket_id = 'capsule-media')
```

Neither policy joins to `capsules`/`capsule_members`, checks `unlock_at`/`status`, checks `owner_preview_locked`, or extracts the capsule id from the object path (the way the INSERT policy does via `(storage.foldername(objects.name))[1]`). **The only requirement is being signed in at all.**

Storage-level SELECT RLS in Supabase governs three things: `list()`, direct object download via the user's own JWT, and — critically — **generating a new signed URL** (`createSignedUrl`). All three currently succeed for any authenticated user against any object in this bucket, regardless of which capsule it belongs to, whether that capsule has ever been shared with them, whether it's still locked, or whether it's in surprise mode.

This is exactly the class of bug the codebase already fixed once for the `avatars` bucket: `20260515232248_security_hardening.sql` §7 explicitly drops a too-broad `"Anyone can read avatars"` policy specifically to stop bucket enumeration (`advisor 0025_public_bucket_allows_listing`), reasoning that a *public* bucket doesn't need a SELECT policy at all since object URLs already work without one. That fix was correctly public-bucket-specific — but the equivalent problem in the **private** `capsule-media` bucket was never addressed. No migration in the repo ever created a scoped SELECT policy for `capsule-media`; the two live policies are out-of-band dashboard artifacts (matching the pattern CLAUDE.md warns about elsewhere: "the live DB has drifted from migrations before").

### Impact / exploit scenario

Any signed-up user (email signup is open to anyone) can, using only their own JWT:
1. `storage.list('capsule-media')` at the bucket root — returns every capsule UUID as a top-level folder name (RLS filters *rows*, and every row matches `bucket_id = 'capsule-media'`, so nothing is hidden), enumerating every capsule that has ever had media uploaded.
2. `storage.list('capsule-media/<any-capsule-id>')` — returns every real filename (storage key) inside.
3. `storage.from('capsule-media').download(key)` or `.createSignedUrl(key)` — succeeds for any key, regardless of the caller's membership in that capsule.

This completely bypasses:
- **Capsule privacy** — a user need never be invited to see another user's capsule photos/videos.
- **Time-lock** — locked (`status = 'active'`) capsule media is fully downloadable before unlock.
- **Surprise mode** (`owner_preview_locked`) — the entire point of this feature (owner can't peek pre-unlock) is defeated at the storage layer even though the `media` *table* correctly hides the rows from the owner.
- **Member removal** — a user removed from a capsule (`capsule_members` row deleted) retains full read access to that capsule's media forever, since storage access never depended on the membership row.

The `media` table's own SELECT RLS is correctly scoped (membership + unlock/surprise-mode check) — so this is specifically a storage-layer hole, not a `media`-table hole. But because every legitimate member's own client fetches and displays `storage_key`/`thumbnail_key`/`alt_storage_key` values from the `media` table in order to sign URLs (per CLAUDE.md's `fetchPhotos`/`transformMediaUrl` flow), those keys are trivially visible in that member's own network traffic — meaning the "attacker" doesn't even need write access anywhere; they only need to have been a member of *any* capsule to learn the storage-key naming convention, and any leaked/observed key (their own capsule's, a forwarded link, a former membership) grants standing, unrevocable read access to that object and, per point 1 above, to literally the entire bucket via listing.

### Suggested fix

Replace both policies with a single scoped SELECT policy mirroring the existing INSERT policy's shape:

```sql
drop policy "Authenticated users can read capsule media" on storage.objects;
drop policy "Authenticated users can read media" on storage.objects;

create policy "Members can read their capsule's media"
  on storage.objects
  for select
  to authenticated
  using (
    bucket_id = 'capsule-media'
    and exists (
      select 1 from public.capsules c
      join public.capsule_members cm on cm.capsule_id = c.id
      where (c.id)::text = (storage.foldername(objects.name))[1]
        and cm.user_id = (select auth.uid())
        and cm.joined_at is not null
        and (
          c.status = 'unlocked'
          or (cm.role in ('owner','contributor') and not c.owner_preview_locked)
        )
    )
  );
```

This exactly mirrors the `media` table's own SELECT policy semantics, so a signed URL can only ever be minted for an object the caller could already see the corresponding `media` row for. Also worth revoking after: check whether any legitimate flow (e.g., the join-preview/QR flow) relies on the current broad read and would need re-verification post-fix.

---

## BS-2 — `capsule_members` RLS lets any member (including `role = 'viewer'`) self-escalate their own role, and lets a self-joiner pick any role including `'owner'`

**Severity:** High
**Category:** RLS policy (missing `WITH CHECK`)
**Location:** `public.capsule_members` policies `capsule_members_update` and `capsule_members_insert` (live; corresponds to helpers in `20260515232500_capture_capsule_rls_and_helpers.sql` / `can_insert_capsule_member`)
**Confidence:** High (verified directly against live `pg_policies`; Postgres UPDATE-without-WITH-CHECK semantics confirmed)

### Description

```sql
-- capsule_members_update (UPDATE, role public)
qual:       (user_id = (select auth.uid()))
with_check: null
```

When a `WITH CHECK` clause is omitted on an UPDATE policy, Postgres falls back to using the `USING` clause as the check — but the `USING` clause here only constrains `user_id`. **No column is protected except `user_id`.** In particular, `role` (`owner`/`contributor`/`viewer`), `capsule_id`, `archived_at`, `joined_at`, and the check-in columns are all freely settable by the row's own user via a direct client UPDATE.

Concretely: a member the owner deliberately invited as `role = 'viewer'` (read-only, no contribution) can run
```
supabase.from('capsule_members').update({ role: 'contributor' }).eq('id', myRowId)
```
and it will succeed, because RLS never inspects the new `role` value. This matters because `role` **is** the authorization check used elsewhere:
- `media` INSERT policy: `cm.role = ANY(['owner','contributor'])`
- `storage.objects` INSERT policy (`Contributors can upload to their capsules`): same `cm.role` check

So a viewer can grant themselves upload rights the owner explicitly withheld, and this also silently bypasses `enforce_photo_limit` since that trigger only fires `BEFORE INSERT` on `media`, not on `capsule_members` UPDATE — there's no re-check tied to the role change itself.

Separately (lower confidence this is unintended, since CLAUDE.md documents self-join-by-UUID as an accepted design point): `can_insert_capsule_member(p_capsule_id, p_user_id)` returns true whenever `p_user_id = auth.uid()`, with **no constraint on the `role` value being inserted**. CLAUDE.md's "Deep links"/"QR scan-to-join" sections describe self-join via a known capsule UUID as intentional (join = consent), but only in the context of the app's own UI, which always sends a fixed role. Nothing at the database layer stops a raw client from self-inserting with `role = 'owner'` directly. The practical blast radius of this half is limited, because every genuine owner-gated capability in this codebase (`delete_capsule_with_storage`, `set_default_superlatives`, `EditCapsuleScreen`'s edit gate, `send-invite-push`'s authorization, `capsule_members_delete`'s policy) checks `capsules.owner_id`, not `capsule_members.role` — so an impostor "owner" row doesn't actually grant real ownership. It is, however, one more way `role` can be set to an owner-not-intended value with zero validation.

### Impact / exploit scenario

- A capsule owner adds someone as a read-only `viewer` (e.g. to let a relative browse without letting them post). That person can silently self-promote to `contributor` and start uploading — a documented, deliberate permission tier is bypassed with one REST call.
- Since real owner power is gated separately by `capsules.owner_id`, self-granting `role = 'owner'` in `capsule_members` does not escalate to genuine capsule-owner capability — but it does inject a misleading row that any future feature relying on `capsule_members.role = 'owner'` (instead of `capsules.owner_id`) would trust incorrectly.

### Suggested fix

Add an explicit `WITH CHECK` to `capsule_members_update` that pins `role` (and any other column that shouldn't be self-editable) to its prior value unless the caller is the real capsule owner, e.g.:

```sql
alter policy capsule_members_update on public.capsule_members
  with check (
    user_id = (select auth.uid())
    and role = (select role from public.capsule_members cm2 where cm2.id = capsule_members.id)
  );
```
(or, cleaner: split into a narrow self-service UPDATE for the columns members should legitimately touch — `archived_at`, check-in fields — and route `role` changes only through an owner-authorized SECURITY DEFINER RPC.) For the INSERT side, consider constraining `can_insert_capsule_member` self-joins to a fixed non-owner role, or validating `new.role <> 'owner'` unless the owner is the one performing the insert.

---

## BS-3 — `media` UPDATE policy only protects `uploader_id`; an uploader can reassign their own media into an arbitrary capsule or clear moderation flags

**Severity:** Medium
**Category:** RLS policy (missing `WITH CHECK` column scope)
**Location:** `public.media` policy `"Uploaders can update their own media"` (UPDATE)
**Confidence:** High (verified via live `pg_policies`; confirmed `enforce_photo_limit` trigger is `BEFORE INSERT` only, not `UPDATE`, via `information_schema.triggers`)

### Description

```sql
qual:       (uploader_id = (select auth.uid()))
with_check: (uploader_id = (select auth.uid()))
```

This correctly stops an uploader from reassigning a media row to someone *else's* `uploader_id`, but every other column — `capsule_id`, `storage_key`, `thumbnail_key`, `alt_storage_key`, `media_type`, `is_flagged` — is unconstrained. An uploader can, on their own already-existing media row:
- Set `capsule_id` to a capsule they are not a member of, injecting their (or an arbitrary storage-key-pointed) file into that capsule's grid for its real members to see, entirely bypassing the `media` INSERT policy's membership/lock/start checks and `enforce_photo_limit`'s cap (that trigger only fires on `INSERT`, confirmed via `information_schema.triggers`).
- Set `is_flagged = false` after their content was flagged via the report pipeline, undermining moderation.
- Point `storage_key` at an arbitrary string, effectively swapping which object a `media` row (and therefore capsule grid tile) resolves to.

### Impact / exploit scenario

A user uploads to a capsule they legitimately belong to, then updates that row's `capsule_id` to any other capsule UUID they can learn (e.g. one they were once invited to, or one shared via a public-looking link) — injecting unwanted/spam content into a capsule they have no membership in, with no cap enforcement. Combined with BS-1, this also gives a way to make content from one capsule visible inside another capsule's authorized member view without ever uploading into it directly.

### Suggested fix

Scope the `WITH CHECK` to also pin `capsule_id` (and ideally `storage_key`/`media_type`) to their existing values, only allowing the columns actually meant to be user-editable (e.g. `caption`) to change:

```sql
alter policy "Uploaders can update their own media" on public.media
  with check (
    uploader_id = (select auth.uid())
    and capsule_id = (select capsule_id from public.media m2 where m2.id = media.id)
    and storage_key = (select storage_key from public.media m2 where m2.id = media.id)
  );
```

---

## BS-4 — `_superlative_target_valid` is a directly-callable SECURITY DEFINER RPC that leaks capsule-membership status to non-members

**Severity:** Low
**Category:** SECURITY DEFINER function — missing caller-authorization check
**Location:** `public._superlative_target_valid(p_category_id, p_target_user_id, p_target_media_id)`
**Confidence:** Medium (real gap, but low practical exploitability — requires knowing a `superlative_categories.id` UUID, and the leaked fact is only a boolean)

### Description

This function is used inside the `superlative_votes` INSERT/UPDATE `WITH CHECK` clauses to validate a vote target. It's flagged by the security advisor as `authenticated`-executable via `/rest/v1/rpc/_superlative_target_valid`. Its body never checks that the *caller* is a member of the capsule the `category_id` belongs to — it only checks whether the *target* is. So any authenticated user who has (or guesses) a `category_id` UUID can call it directly to learn whether an arbitrary `target_user_id` is a joined member of the capsule tied to that category, without needing membership themselves.

### Impact

Minor cross-capsule membership-status oracle. `category_id`s aren't exposed publicly/aren't enumerable, so practical exploitability is low; this is really a "should be internal-only" hygiene gap rather than a live exposure.

### Suggested fix

`revoke execute on function public._superlative_target_valid(uuid,uuid,uuid) from public, anon, authenticated;` — the RLS policies that call it internally (as the *evaluating* role during policy checks) are unaffected by revoking the direct PostgREST RPC path, matching the pattern already used for `get_report_digest_admin`/`check_cron_secret`/`claim_contribution_nudge_tier`/`top_contributors` (per `20260718120000_revoke_anon_rpc_execute.sql`).

---

## BS-5 — `anon` role has table-level grants (including SELECT) on all `users` columns, including `email`/`phone`/`push_token`

**Severity:** Low (currently dead due to RLS; hardening recommendation)
**Category:** Column-level grants
**Location:** `information_schema.column_privileges` for `public.users`, `grantee = 'anon'`
**Confidence:** High for the grant existing; Medium for real-world exploitability today

### Description

CLAUDE.md documents that `email`/`phone`/`push_token` were deliberately removed from the **`authenticated`** table-wide SELECT grant at the column level, and the live grants confirm `authenticated` correctly has no SELECT on any of those three columns. However, the **`anon`** role still has full column-level grants on `users` — including `SELECT`, `UPDATE`, and `INSERT` — on every column, `email`/`phone`/`push_token` included. This wasn't part of the documented hardening pass (`20260515232958_restrict_users_pii_columns.sql` / `20260515233603_restrict_users_push_token.sql` only target `authenticated`).

Currently this is not exploitable: `pg_policies` shows the only SELECT policy on `users` (`"Authenticated users can search profiles"`) is scoped `to authenticated`, so with RLS enabled and no permissive policy covering `anon`, an unauthenticated request gets zero rows regardless of the column grant. This is purely a defense-in-depth gap today — but it means the safety net for `anon` is *entirely* the RLS policy set, with none of the column-grant redundancy that protects `authenticated`. If a future SELECT policy is ever added scoped to `public` (rather than `authenticated`) — e.g. to support some anonymous preview flow — the PII columns would be immediately exposed to unauthenticated callers with no additional gate.

### Suggested fix

```sql
revoke select (email, phone, push_token) on public.users from anon;
```
(or more simply, revoke all `anon` grants on `users` outright, since the app has no unauthenticated `users` use case today) to bring `anon` in line with the same column-scoping already applied to `authenticated`.

---

## BS-6 — Trigger-only functions exposed on the PostgREST RPC surface (verified NOT exploitable — hygiene only)

**Severity:** Info / Low
**Category:** SECURITY DEFINER function grants
**Location:** `public.enforce_member_limit()`, `public.enforce_photo_limit()`, `public.guard_group_recurrence()`, `public.guard_subscription_tier()`
**Confidence:** High (empirically verified)

### Description

The security advisor flags these four `RETURNS trigger` functions as callable by `anon`/`authenticated` via `/rest/v1/rpc/<name>`, since `revoke execute ... from public, anon, authenticated` was applied to the earlier trigger functions (`handle_new_user`, `notify_on_invite`, `notify_on_reaction`, per `20260515232248_security_hardening.sql`) but was never extended to these four newer ones (`enforce_member_limit`/`enforce_photo_limit` from `20260721140100_payment_security_gates_b.sql`, `guard_group_recurrence` from the groups-recurrence revamp, `guard_subscription_tier` from the monetization work).

I verified this is **not actually exploitable**: calling any of them directly (`select public.enforce_member_limit();`) raises `ERROR: 0A000: trigger functions can only be called as triggers` — Postgres itself refuses to execute a `RETURNS trigger` function outside trigger context, independent of the EXECUTE grant. So despite the advisor WARN, there is no live bypass path here today; a caller cannot use the RPC surface to invoke these with attacker-controlled `NEW`/`OLD` or to skip the tier-enforcement logic.

### Suggested fix

Purely for hygiene / to clear the advisor noise and stay consistent with the codebase's own established pattern:
```sql
revoke execute on function public.enforce_member_limit()   from public, anon, authenticated;
revoke execute on function public.enforce_photo_limit()    from public, anon, authenticated;
revoke execute on function public.guard_group_recurrence() from public, anon, authenticated;
revoke execute on function public.guard_subscription_tier() from public, anon, authenticated;
```

---

## Areas reviewed and found sound

- **`revenuecat-webhook`** — constant-time secret compare, fails closed on missing/mismatched secret, production-environment-only gate (both in code and via the RevenueCat dashboard integration scope), UUID-shaped `app_user_id` guard against anonymous-id writes, correct GRANT/REVOKE/no-op event-type partitioning. Sound.
- **`send-invite-push`** — verifies caller via JWT, checks `capsule.owner_id === caller`, and independently verifies the invitee is actually a `capsule_members` row before pushing — can't be used to spam arbitrary push tokens. Sound.
- **`unlock-capsules`, `dispatch-capsule-start`, `create-group-capsules`** (spot-checked in full) — consistent `CRON_SECRET`/Vault-backed `check_cron_secret` auth, atomic claim-then-act patterns preventing double-send across overlapping cron ticks, `≤100`-message push chunking. Sound; matches CLAUDE.md's documented behavior exactly.
- **`report-digest`** (undocumented in CLAUDE.md but reviewed here since it's new/live) — `CRON_SECRET` bearer check present; admin id sourced from Vault via `get_report_digest_admin()`, which is correctly **not** granted to `anon`/`authenticated` (confirmed absent from the live `routine_privileges` list). Sound. Worth a CLAUDE.md mention since it's undocumented, but that's a docs gap, not a security one.
- **`get_my_capsule_ids()` / `get_my_group_ids()`** — correctly avoid the recursive-RLS trap by being `SECURITY DEFINER` with `search_path` pinned, doing a plain unfiltered read of the join table keyed to `auth.uid()`. Sound.
- **`create_capsule_with_owner`, `create_group_with_creator`, `delete_capsule_with_storage`, `delete_my_account`, `set_default_superlatives`, `set_capsule_archived`** — all null-safe-check the caller's identity (`is distinct from`, not `<>`), all correctly scope `search_path`, all correctly do their privileged work only after an inline authorization check. Sound.
- **Column-level grants for the `authenticated` role on `users`** — `email`/`phone`/`push_token` correctly excluded from `authenticated`'s SELECT grant, matching CLAUDE.md's documented model exactly. (See BS-5 for the separate `anon`-role gap.)
- **`capsule_join_preview`, `capsule_media_count`** — both correctly re-verify membership/joined-state inline rather than trusting the caller, and return only the minimal fields documented.
- **RLS `USING`/`WITH CHECK` on `friendships`, `blocked_users`, `content_reports`, `superlative_votes`, `superlative_categories`, `groups`** — each of these was checked for the same "missing WITH CHECK column scope" pattern that produced BS-2/BS-3, and all have appropriately scoped checks (e.g. `friendships` UPDATE explicitly checks `status = 'accepted'`; `superlative_votes` INSERT/UPDATE re-validate live status, voting window, and target validity in the `WITH CHECK` itself).
- **Migrations vs. live drift** — spot-checked; the live policy/function definitions for `get_my_capsule_ids`, `can_insert_capsule_member`, `check_cron_secret`, `is_group_creator` match what CLAUDE.md says was captured out-of-band. No new undocumented drift found beyond the two `capsule-media` storage read policies (BS-1), which appear to be the same kind of untracked dashboard artifact CLAUDE.md already warns about elsewhere.

---

## Advisor noise not otherwise covered above

- `contribution_activity_pending` — RLS enabled with zero policies (correct: deny-all to clients by design, documented in CLAUDE.md; only the SECURITY DEFINER trigger and service-role edge functions touch it).
- `auth_leaked_password_protection` disabled — Supabase Auth setting, unrelated to this app's own code; worth enabling in the dashboard but outside this audit's code/DB-policy scope.
