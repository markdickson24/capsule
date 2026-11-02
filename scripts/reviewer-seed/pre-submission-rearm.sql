-- ===========================================================================
-- Pre-submission re-arm for the App Store reviewer account
-- ===========================================================================
--
-- Run this immediately before EVERY App Store submission, and again if review
-- drags on for more than a couple of days.
--
-- Run as `postgres` / service_role (Supabase SQL editor is fine).
-- `guard_subscription_tier` blocks the tier write from any client role, which
-- is deliberate — it is what makes the paywall un-forgeable.
--
-- Why this exists: the demo account's whole value is that its capsules are in
-- *different* states — one unlocked, one counting down, one sealed. Those
-- states decay on their own as real time passes. By the first submission all
-- four capsules had drifted to `unlocked`, so the countdown demo and the
-- surprise-mode demo both silently stopped demonstrating anything.
--
-- See docs/REVIEWER_ACCOUNT.md for what the reviewer is meant to see.
-- ---------------------------------------------------------------------------

begin;

-- ---------------------------------------------------------------------------
-- 1. Tier — MUST be 'free'.
-- ---------------------------------------------------------------------------
-- A comped 'pro' here hides every purchase entry point in the app (they are all
-- gated on `!isPro`, and `resolveIsPro` grants Pro from this column alone).
-- That is what got all three IAPs rejected on the first submission while the
-- binary itself was approved. Do not "fix" a reviewer's Pro-feature question by
-- comping this account — answer it in the review notes instead.
update public.users
   set subscription_tier = 'free'
 where id = 'facade01-0000-4000-8000-000000000001';


-- ---------------------------------------------------------------------------
-- 2. "Summer Rooftop Party" — the live countdown, ~3h out, surprise OFF.
-- ---------------------------------------------------------------------------
-- Clearing the three unlock_reminder_* stamps matters: each tier is
-- claim-and-stamp once per capsule, so without clearing them the reviewer gets
-- no countdown push. unlock_notified_at is the same story for the unlock push
-- itself (see "Instant Unlock" in CLAUDE.md).
update capsules
   set unlock_at                        = now() + interval '3 hours',
       status                           = 'active',
       unlocked_at                      = null,
       contribution_lock_at             = null,
       contribution_start_at            = null,
       contribution_start_notified_at   = null,
       superlative_voting_closes_at     = null,
       superlative_voting_finalized_at  = null,
       superlative_closing_soon_sent_at = null,
       unlock_reminder_1d_sent_at       = null,
       unlock_reminder_1h_sent_at       = null,
       unlock_reminder_10m_sent_at      = null,
       unlock_notified_at               = null
 where id = 'facade01-c000-4000-8000-000000000002';


-- ---------------------------------------------------------------------------
-- 3. "Emma & Noah's Wedding" — sealed, ~3 weeks out, surprise ON.
-- ---------------------------------------------------------------------------
-- This is the one that demonstrates the core premise: media exists but even the
-- owner cannot see it. owner_preview_locked must be true or the demo is dead.
update capsules
   set unlock_at                        = now() + interval '21 days',
       status                           = 'active',
       owner_preview_locked             = true,
       unlocked_at                      = null,
       contribution_lock_at             = null,
       contribution_start_at            = null,
       contribution_start_notified_at   = null,
       superlative_voting_closes_at     = null,
       superlative_voting_finalized_at  = null,
       superlative_closing_soon_sent_at = null,
       unlock_reminder_1d_sent_at       = null,
       unlock_reminder_1h_sent_at       = null,
       unlock_reminder_10m_sent_at      = null,
       unlock_notified_at               = null
 where id = 'facade01-c000-4000-8000-000000000003';


-- ---------------------------------------------------------------------------
-- 4. "Diego's Birthday" — owned by another member, ~9 days out.
-- ---------------------------------------------------------------------------
update capsules
   set unlock_at                        = now() + interval '9 days',
       status                           = 'active',
       unlocked_at                      = null,
       contribution_lock_at             = null,
       contribution_start_at            = null,
       contribution_start_notified_at   = null,
       superlative_voting_closes_at     = null,
       superlative_voting_finalized_at  = null,
       superlative_closing_soon_sent_at = null,
       unlock_reminder_1d_sent_at       = null,
       unlock_reminder_1h_sent_at       = null,
       unlock_reminder_10m_sent_at      = null,
       unlock_notified_at               = null
 where id = 'facade01-c000-4000-8000-000000000004';

-- ...and the reviewer's invitation to it must be pending again, so the Alerts
-- tab has a real Accept / Decline card. capsule_members is UNIQUE on
-- (capsule_id, user_id), so this is an UPDATE, never an INSERT.
update capsule_members
   set joined_at = null
 where capsule_id = 'facade01-c000-4000-8000-000000000004'
   and user_id    = 'facade01-0000-4000-8000-000000000001';

-- The matching notification row, unread.
update notifications
   set read_at = null
 where capsule_id = 'facade01-c000-4000-8000-000000000004'
   and user_id    = 'facade01-0000-4000-8000-000000000001'
   and type       = 'invite';


-- ---------------------------------------------------------------------------
-- 5. Clear award state on the three re-armed capsules.
-- ---------------------------------------------------------------------------
-- Voting cannot be open on a locked capsule, and finalize_capsule_superlatives
-- may already have written winners while they were unlocked. Leaving those rows
-- behind shows a re-locked capsule with awards already decided.
--
-- "Lake Tahoe Trip" (…0001) is deliberately NOT touched — its finalized awards
-- are the point of that capsule.
delete from superlative_winners w
 using superlative_categories c
 where w.category_id = c.id
   and c.capsule_id in ('facade01-c000-4000-8000-000000000002',
                        'facade01-c000-4000-8000-000000000003',
                        'facade01-c000-4000-8000-000000000004');

delete from superlative_votes v
 using superlative_categories c
 where v.category_id = c.id
   and c.capsule_id in ('facade01-c000-4000-8000-000000000002',
                        'facade01-c000-4000-8000-000000000003',
                        'facade01-c000-4000-8000-000000000004');

commit;


-- ---------------------------------------------------------------------------
-- Verify — run after committing. Every row should match the Expected column.
-- ---------------------------------------------------------------------------
--   tier                    -> free
--   Lake Tahoe Trip         -> unlocked
--   Summer Rooftop Party    -> active, ~3h out,  surprise false
--   Emma & Noah's Wedding   -> active, ~21d out, surprise true
--   Diego's Birthday        -> active, ~9d out
--   pending invite          -> 1 row
select 'tier' as check, subscription_tier as value, null::timestamptz as unlock_at
  from public.users where id = 'facade01-0000-4000-8000-000000000001'
union all
select title, status || case when owner_preview_locked then ' / surprise' else '' end, unlock_at
  from capsules where id::text like 'facade01-c000%'
union all
select 'pending invite', count(*)::text, null
  from capsule_members
 where capsule_id = 'facade01-c000-4000-8000-000000000004'
   and user_id    = 'facade01-0000-4000-8000-000000000001'
   and joined_at is null;
