-- App Store reviewer account — database seed.
--
-- Everything here uses the `facade01-` UUID prefix, deliberately distinct from the
-- `facade00-` landing-page marketing fixtures, so the two sets can be inspected and
-- cleaned up independently.
--
-- Run order:
--   1. this file, sections 1-3   (accounts, capsules, membership)
--   2. scripts/reviewer-seed/upload-media.mjs        (photos -> storage)
--   3. scripts/reviewer-seed/insert-media-rows.mjs   (photos -> media rows)
--   4. this file, sections 4-7   (attribution, awards, reactions, cleanup)
--
-- Sections 4-7 depend on the media rows existing, which is why this isn't a single
-- transaction. Run as `postgres` / service_role: the guard_subscription_tier and
-- enforce_* triggers exempt non-authenticated roles, and spreading uploader_id
-- across members is impossible under the client column grants.


-- ---------------------------------------------------------------------------
-- 1. Accounts
-- ---------------------------------------------------------------------------
-- The eight token columns MUST be '' and not NULL. GoTrue's password-login query
-- scans them into Go strings, and a NULL there yields a 500 "Database error
-- querying schema" at sign-in. This bites every hand-inserted auth.users row.

insert into auth.users (
  instance_id, id, aud, role, email, encrypted_password, email_confirmed_at,
  raw_app_meta_data, raw_user_meta_data, created_at, updated_at,
  confirmation_token, recovery_token, email_change_token_new, email_change,
  phone_change, phone_change_token, email_change_token_current, reauthentication_token,
  is_sso_user, is_anonymous
)
values
  ('00000000-0000-0000-0000-000000000000','facade01-0000-4000-8000-000000000001','authenticated','authenticated',
   'appreview@getcapsuleapp.com', extensions.crypt('CapsuleReview2026!', extensions.gen_salt('bf')), now(),
   '{"provider":"email","providers":["email"]}'::jsonb, '{"display_name":"Alex"}'::jsonb, now(), now(),
   '','','','','','','','', false, false),
  -- Supporting members. Random unusable passwords: these exist for FK integrity and
  -- to populate member lists / award votes, and are never logged into.
  ('00000000-0000-0000-0000-000000000000','facade01-0000-4000-8000-000000000101','authenticated','authenticated',
   'review101.demo@example.com', extensions.crypt(gen_random_uuid()::text, extensions.gen_salt('bf')), now(),
   '{"provider":"email","providers":["email"]}'::jsonb, '{"display_name":"Maya Chen"}'::jsonb, now(), now(),
   '','','','','','','','', false, false),
  ('00000000-0000-0000-0000-000000000000','facade01-0000-4000-8000-000000000102','authenticated','authenticated',
   'review102.demo@example.com', extensions.crypt(gen_random_uuid()::text, extensions.gen_salt('bf')), now(),
   '{"provider":"email","providers":["email"]}'::jsonb, '{"display_name":"Diego Ramos"}'::jsonb, now(), now(),
   '','','','','','','','', false, false),
  ('00000000-0000-0000-0000-000000000000','facade01-0000-4000-8000-000000000103','authenticated','authenticated',
   'review103.demo@example.com', extensions.crypt(gen_random_uuid()::text, extensions.gen_salt('bf')), now(),
   '{"provider":"email","providers":["email"]}'::jsonb, '{"display_name":"Priya Iyer"}'::jsonb, now(), now(),
   '','','','','','','','', false, false),
  ('00000000-0000-0000-0000-000000000000','facade01-0000-4000-8000-000000000104','authenticated','authenticated',
   'review104.demo@example.com', extensions.crypt(gen_random_uuid()::text, extensions.gen_salt('bf')), now(),
   '{"provider":"email","providers":["email"]}'::jsonb, '{"display_name":"Marcus Lee"}'::jsonb, now(), now(),
   '','','','','','','','', false, false)
on conflict (id) do nothing;

-- handle_new_user() has created the public.users rows by now.
-- Pro is granted server-side; guard_subscription_tier makes this impossible from a
-- client, which is what keeps the paywall un-forgeable.
update public.users
   set subscription_tier = 'pro',
       onboarded_at = now() - interval '35 days',
       bio = 'Collecting moments, one capsule at a time.'
 where id = 'facade01-0000-4000-8000-000000000001';

-- Onboarded so member lists render a real name rather than an email local-part.
update public.users set onboarded_at = now() - interval '30 days'
 where id::text like 'facade01-0000-4000-8000-0000000001%';


-- ---------------------------------------------------------------------------
-- 2. Capsules
-- ---------------------------------------------------------------------------
-- All time-mode: a solo reviewer physically cannot exercise a proximity unlock.

insert into capsules (id, owner_id, title, description, unlock_at, status, created_at,
  unlock_mode, owner_preview_locked, occasion, superlative_voting_hours,
  unlocked_at, superlative_voting_closes_at)
values
  -- The proof-of-completeness capsule: unlocked, full of media, awards finalized.
  ('facade01-c000-4000-8000-000000000001','facade01-0000-4000-8000-000000000001',
   'Lake Tahoe Trip','Four days at the lake with the crew. No phones out until we''re home.',
   now() - interval '2 days','unlocked', now() - interval '34 days',
   'time', false, 'vacation', 48, now() - interval '2 days', now() - interval '1 day'),
  -- Surprise OFF so the owner can preview its media while it counts down.
  ('facade01-c000-4000-8000-000000000002','facade01-0000-4000-8000-000000000001',
   'Summer Rooftop Party','Everything from the rooftop. Opens tonight.',
   now() + interval '2 hours','active', now() - interval '6 days',
   'time', false, 'party', 48, null, null),
  -- Surprise ON: even the owner is locked out. Demonstrates the core premise.
  ('facade01-c000-4000-8000-000000000003','facade01-0000-4000-8000-000000000001',
   'Emma & Noah''s Wedding','Every guest''s camera roll, sealed until the honeymoon ends.',
   now() + interval '21 days','active', now() - interval '10 days',
   'time', true, 'wedding', 48, null, null),
  -- Owned by a member, so the reviewer has a real pending invite to accept.
  ('facade01-c000-4000-8000-000000000004','facade01-0000-4000-8000-000000000102',
   'Diego''s Birthday','Surprise capsule for the big 3-0.',
   now() + interval '9 days','active', now() - interval '1 day',
   'time', true, 'milestone', 48, null, null)
on conflict (id) do nothing;


-- ---------------------------------------------------------------------------
-- 3. Membership
-- ---------------------------------------------------------------------------

insert into capsule_members (id, capsule_id, user_id, role, invited_at, joined_at)
select gen_random_uuid(), v.cap::uuid, v.usr::uuid, v.role, v.inv, v.joined
from (values
  ('facade01-c000-4000-8000-000000000001','facade01-0000-4000-8000-000000000001','owner',       now()-interval '34 days', now()-interval '34 days'),
  ('facade01-c000-4000-8000-000000000001','facade01-0000-4000-8000-000000000101','contributor', now()-interval '34 days', now()-interval '33 days'),
  ('facade01-c000-4000-8000-000000000001','facade01-0000-4000-8000-000000000102','contributor', now()-interval '34 days', now()-interval '33 days'),
  ('facade01-c000-4000-8000-000000000001','facade01-0000-4000-8000-000000000103','contributor', now()-interval '34 days', now()-interval '32 days'),
  ('facade01-c000-4000-8000-000000000001','facade01-0000-4000-8000-000000000104','contributor', now()-interval '34 days', now()-interval '32 days'),
  ('facade01-c000-4000-8000-000000000002','facade01-0000-4000-8000-000000000001','owner',       now()-interval '6 days',  now()-interval '6 days'),
  ('facade01-c000-4000-8000-000000000002','facade01-0000-4000-8000-000000000101','contributor', now()-interval '6 days',  now()-interval '5 days'),
  ('facade01-c000-4000-8000-000000000002','facade01-0000-4000-8000-000000000102','contributor', now()-interval '6 days',  now()-interval '5 days'),
  ('facade01-c000-4000-8000-000000000002','facade01-0000-4000-8000-000000000103','contributor', now()-interval '6 days',  now()-interval '4 days'),
  ('facade01-c000-4000-8000-000000000003','facade01-0000-4000-8000-000000000001','owner',       now()-interval '10 days', now()-interval '10 days'),
  ('facade01-c000-4000-8000-000000000003','facade01-0000-4000-8000-000000000101','contributor', now()-interval '10 days', now()-interval '9 days'),
  ('facade01-c000-4000-8000-000000000003','facade01-0000-4000-8000-000000000102','contributor', now()-interval '10 days', now()-interval '9 days'),
  ('facade01-c000-4000-8000-000000000003','facade01-0000-4000-8000-000000000103','contributor', now()-interval '10 days', now()-interval '8 days'),
  ('facade01-c000-4000-8000-000000000003','facade01-0000-4000-8000-000000000104','contributor', now()-interval '10 days', now()-interval '8 days'),
  ('facade01-c000-4000-8000-000000000004','facade01-0000-4000-8000-000000000102','owner',       now()-interval '1 day',   now()-interval '1 day'),
  ('facade01-c000-4000-8000-000000000004','facade01-0000-4000-8000-000000000101','contributor', now()-interval '1 day',   now()-interval '20 hours')
) as v(cap, usr, role, inv, joined);

-- Inserted separately and last so notify_on_invite fires with joined_at NULL,
-- producing a genuine actionable invite at the top of the reviewer's Alerts tab.
insert into capsule_members (id, capsule_id, user_id, role, invited_at, joined_at)
values (gen_random_uuid(),'facade01-c000-4000-8000-000000000004',
        'facade01-0000-4000-8000-000000000001','contributor', now()-interval '3 hours', null);


-- ===========================================================================
-- Run the two media scripts now, then continue below.
-- ===========================================================================


-- ---------------------------------------------------------------------------
-- 4. Spread uploads across members
-- ---------------------------------------------------------------------------
-- insert-media-rows.mjs lands every row attributed to the reviewer, because the
-- media INSERT policy pins uploader_id to the authenticated caller. A capsule
-- where one person shot everything defeats the point of a shared capsule, so
-- attribution is redistributed here.

with ordered as (
  select id, capsule_id,
         row_number() over (partition by capsule_id order by uploaded_at) - 1 as n
    from media where capsule_id::text like 'facade01%'
),
rota as (
  select o.id,
    case o.capsule_id::text
      when 'facade01-c000-4000-8000-000000000001' then
        (array['facade01-0000-4000-8000-000000000001','facade01-0000-4000-8000-000000000101',
               'facade01-0000-4000-8000-000000000102','facade01-0000-4000-8000-000000000103',
               'facade01-0000-4000-8000-000000000104'])[(o.n % 5) + 1]
      when 'facade01-c000-4000-8000-000000000002' then
        (array['facade01-0000-4000-8000-000000000001','facade01-0000-4000-8000-000000000101',
               'facade01-0000-4000-8000-000000000102'])[(o.n % 3) + 1]
      else
        (array['facade01-0000-4000-8000-000000000101','facade01-0000-4000-8000-000000000102',
               'facade01-0000-4000-8000-000000000103','facade01-0000-4000-8000-000000000104',
               'facade01-0000-4000-8000-000000000001'])[(o.n % 5) + 1]
    end::uuid as uploader
  from ordered o
)
update media m set uploader_id = r.uploader from rota r where m.id = r.id;

-- notify_contribution_activity() staged one row per (capsule, uploader) during the
-- bulk insert. Left in place, the dispatch cron would push "Alex added 20 photos"
-- for uploads that are backdated weeks. These are seed artifacts, not real activity.
delete from contribution_activity_pending where capsule_id::text like 'facade01%';


-- ---------------------------------------------------------------------------
-- 5. Awards (Lake Tahoe Trip)
-- ---------------------------------------------------------------------------
-- Labels are drawn verbatim from AWARD_POOL.vacation in src/lib/awardPool.ts, so
-- what the reviewer sees matches what the app itself would seed.
-- Inserted directly rather than via set_default_superlatives() because that RPC
-- refuses to touch an already-unlocked capsule.

insert into superlative_categories (id, capsule_id, suggested_by, label, target_type, status, promoted_at, is_default, created_at)
values
 ('facade01-a000-4000-8000-000000000001','facade01-c000-4000-8000-000000000001','facade01-0000-4000-8000-000000000001','Most likely to get lost','person','live', now()-interval '34 days', true, now()-interval '34 days'),
 ('facade01-a000-4000-8000-000000000002','facade01-c000-4000-8000-000000000001','facade01-0000-4000-8000-000000000001','Best view captured','media','live', now()-interval '34 days', true, now()-interval '34 days'),
 ('facade01-a000-4000-8000-000000000003','facade01-c000-4000-8000-000000000001','facade01-0000-4000-8000-000000000001','Biggest adventurer','person','live', now()-interval '34 days', true, now()-interval '34 days'),
 ('facade01-a000-4000-8000-000000000004','facade01-c000-4000-8000-000000000001','facade01-0000-4000-8000-000000000001','Funniest candid','media','live', now()-interval '34 days', true, now()-interval '34 days')
on conflict (id) do nothing;

-- Vote splits are deliberately 3-2 and 4-1 so every category has one clear winner.
-- A tie would render as co-winners, which is correct behaviour but a muddier demo.
insert into superlative_votes (category_id, voter_id, target_user_id, created_at)
values
 ('facade01-a000-4000-8000-000000000001','facade01-0000-4000-8000-000000000001','facade01-0000-4000-8000-000000000104', now()-interval '40 hours'),
 ('facade01-a000-4000-8000-000000000001','facade01-0000-4000-8000-000000000101','facade01-0000-4000-8000-000000000104', now()-interval '39 hours'),
 ('facade01-a000-4000-8000-000000000001','facade01-0000-4000-8000-000000000102','facade01-0000-4000-8000-000000000104', now()-interval '38 hours'),
 ('facade01-a000-4000-8000-000000000001','facade01-0000-4000-8000-000000000103','facade01-0000-4000-8000-000000000102', now()-interval '37 hours'),
 ('facade01-a000-4000-8000-000000000001','facade01-0000-4000-8000-000000000104','facade01-0000-4000-8000-000000000102', now()-interval '36 hours'),
 ('facade01-a000-4000-8000-000000000003','facade01-0000-4000-8000-000000000001','facade01-0000-4000-8000-000000000103', now()-interval '40 hours'),
 ('facade01-a000-4000-8000-000000000003','facade01-0000-4000-8000-000000000101','facade01-0000-4000-8000-000000000103', now()-interval '39 hours'),
 ('facade01-a000-4000-8000-000000000003','facade01-0000-4000-8000-000000000102','facade01-0000-4000-8000-000000000103', now()-interval '38 hours'),
 ('facade01-a000-4000-8000-000000000003','facade01-0000-4000-8000-000000000103','facade01-0000-4000-8000-000000000101', now()-interval '37 hours'),
 ('facade01-a000-4000-8000-000000000003','facade01-0000-4000-8000-000000000104','facade01-0000-4000-8000-000000000101', now()-interval '36 hours')
on conflict do nothing;

insert into superlative_votes (category_id, voter_id, target_media_id, created_at)
select v.cat::uuid, v.voter::uuid,
       (select m.id from media m
         where m.capsule_id='facade01-c000-4000-8000-000000000001' and m.caption = v.cap limit 1),
       now() - (v.h || ' hours')::interval
from (values
 ('facade01-a000-4000-8000-000000000002','facade01-0000-4000-8000-000000000001','Sunrise hike, worth it.','40'),
 ('facade01-a000-4000-8000-000000000002','facade01-0000-4000-8000-000000000101','Sunrise hike, worth it.','39'),
 ('facade01-a000-4000-8000-000000000002','facade01-0000-4000-8000-000000000102','Sunrise hike, worth it.','38'),
 ('facade01-a000-4000-8000-000000000002','facade01-0000-4000-8000-000000000103','Sunrise hike, worth it.','37'),
 ('facade01-a000-4000-8000-000000000002','facade01-0000-4000-8000-000000000104','Last night at the fire.','36'),
 ('facade01-a000-4000-8000-000000000004','facade01-0000-4000-8000-000000000001','He fell in. Twice.','40'),
 ('facade01-a000-4000-8000-000000000004','facade01-0000-4000-8000-000000000101','He fell in. Twice.','39'),
 ('facade01-a000-4000-8000-000000000004','facade01-0000-4000-8000-000000000102','He fell in. Twice.','38'),
 ('facade01-a000-4000-8000-000000000004','facade01-0000-4000-8000-000000000103','Best meal of the trip.','37'),
 ('facade01-a000-4000-8000-000000000004','facade01-0000-4000-8000-000000000104','Best meal of the trip.','36')
) as v(cat, voter, cap, h)
on conflict do nothing;

-- close_superlative_windows() runs every minute and will have already finalized this
-- capsule — with zero winners, since it fired seconds after section 2 created it and
-- long before any category existed. finalize_capsule_superlatives() is idempotent by
-- early-returning on a non-null finalized_at, so that empty result would stick.
-- Clearing the stamp lets the real function re-run against the now-populated votes.
update capsules set superlative_voting_finalized_at = null
 where id = 'facade01-c000-4000-8000-000000000001';

select public.finalize_capsule_superlatives('facade01-c000-4000-8000-000000000001');


-- ---------------------------------------------------------------------------
-- 6. Reactions
-- ---------------------------------------------------------------------------
-- Only on captioned photos (the "highlights"), from every member except the
-- photo's own uploader. notify_on_reaction() turns these into real notifications,
-- which is what populates the reviewer's Alerts tab.

insert into reactions (id, media_id, user_id, emoji, created_at)
select gen_random_uuid(), t.media_id, t.user_id, t.emoji, now() - (t.n || ' hours')::interval
from (
  select m.id as media_id, u.id as user_id,
         (array['❤️','😂','🔥','😮','👏'])[((row_number() over (order by m.uploaded_at, u.id)) % 5) + 1] as emoji,
         (row_number() over (order by m.uploaded_at, u.id)) as n
    from media m
    join capsule_members cm on cm.capsule_id = m.capsule_id and cm.joined_at is not null
    join public.users u on u.id = cm.user_id
   where m.capsule_id = 'facade01-c000-4000-8000-000000000001'
     and u.id <> m.uploader_id
     and m.caption is not null
) t
on conflict do nothing;


-- ---------------------------------------------------------------------------
-- 7. Verification
-- ---------------------------------------------------------------------------

select c.title, c.status, c.unlock_at,
       (select count(*) from media m where m.capsule_id = c.id) as media,
       (select count(*) from capsule_members cm where cm.capsule_id = c.id and cm.joined_at is not null) as members,
       (select count(*) from superlative_winners w
          join superlative_categories sc on sc.id = w.category_id
         where sc.capsule_id = c.id) as winners
  from capsules c
 where c.id::text like 'facade01%'
 order by c.unlock_at;
