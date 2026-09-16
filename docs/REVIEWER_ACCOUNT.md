# App Store Reviewer Account

The demo account handed to App Review, and the notes that go with it.

Capsule's entire payoff is time-gated, so a reviewer who signs up fresh creates a
capsule that unlocks in a month, uploads a photo they then can't see (surprise mode
defaults ON), and concludes the app doesn't work. That is a textbook Guideline 2.1
"we were unable to fully review your app" bounce. This account exists to make the
core loop visible in the first thirty seconds.

## Credentials

| | |
|---|---|
| **Email** | `appreview@getcapsuleapp.com` |
| **Password** | Not written here. Lives in the password manager and in the App Store Connect review notes for this app. If you need it to run the seed scripts, see "Reproducing / cleaning up" below for how to supply it via environment variables. |
| Display name | Alex |
| Tier | **Pro** (granted server-side — see caveat below) |
| Onboarding | Already completed, so sign-in lands directly on Home |

Sign-in is email + password. The account is pre-confirmed, so it never hits the
6-digit email confirmation flow.

## What the reviewer sees

Four capsules, all **time-mode** — a solo reviewer cannot exercise a proximity
unlock, so nothing here depends on one.

| Capsule | State | Purpose |
|---|---|---|
| **Lake Tahoe Trip** | Unlocked | 20 photos, 5 members, 28 reactions, **4 finalized awards** with winners. The proof the app is complete. |
| **Summer Rooftop Party** | Unlocks ~2h after seeding | Surprise mode OFF, 6 photos the owner can preview. Live countdown the reviewer can watch tick and unlock. |
| **Emma & Noah's Wedding** | Locked, ~3 weeks out | Surprise mode ON. 8 photos exist but even the owner can't see them — shows "memories waiting". The core premise. |
| **Diego's Birthday** | Pending invite | Owned by another member; the reviewer has an unaccepted invite to Accept or Decline. |

The Alerts tab is populated: an actionable invite, reaction notifications, an
unlock reminder and a contribution nudge.

### ⚠️ Re-arm the countdown before each submission

"Summer Rooftop Party" was seeded to unlock **two hours after the seed ran**. That
moment has almost certainly passed by the time review actually begins, which turns
the live-countdown demo into a third unlocked capsule.

Re-arm it immediately before submitting, and again if review drags on:

```sql
update capsules
   set unlock_at = now() + interval '3 hours',
       status = 'active',
       unlocked_at = null,
       unlock_notified_at = null,
       superlative_voting_closes_at = null,
       superlative_voting_finalized_at = null,
       superlative_closing_soon_sent_at = null,
       unlock_reminder_1d_sent_at = null,
       unlock_reminder_1h_sent_at = null,
       unlock_reminder_10m_sent_at = null
 where id = 'facade01-c000-4000-8000-000000000002';
```

Every `null` in that statement is a dedupe stamp, and each one is claim-and-stamp
**once per capsule** — leave any of them set and the corresponding notification
never fires again for this capsule:

- `unlock_notified_at` (added by `supabase/migrations/20260801170000_instant_unlock.sql`)
  is how `unlock-capsules` claims the unlock push itself:
  `.eq('status','unlocked').eq('unlock_mode','time').is('unlock_notified_at', null)`.
  Miss this one and the capsule re-unlocks in total silence — no push to anyone.
- `unlock_reminder_{1d,1h,10m}_sent_at` are the pre-unlock countdown reminders.
- `superlative_closing_soon_sent_at` is the awards "voting closes in 2 hours" ping,
  already stamped by the capsule's previous voting window.

If a new `*_sent_at` / `*_notified_at` stamp column is ever added to `capsules`,
add it to this statement too — that is exactly how `unlock_notified_at` went
missing here for three days.

### ⚠️ Pre-submission checklist

Before each submission:

- [ ] Re-arm "Summer Rooftop Party" (above).
- [ ] Check **"Emma & Noah's Wedding"** (`facade01-c000-4000-8000-000000000003`).
      It was seeded only 21 days out from the seed run, so on any resubmission it
      may already have unlocked — which silently destroys the surprise-mode demo,
      the one capsule that shows the app's core premise. If its `unlock_at` is
      inside the review window (or already past), run the same UPDATE as above
      against **that** id with `unlock_at = now() + interval '21 days'` — the same
      full list of stamp columns applies.
- [ ] Confirm the Supabase **"Confirm signup"** email template still emits
      `{{ .Token }}` (the 6-digit code). The review notes below tell the reviewer
      to create a fresh account to see the paywall; that path dead-ends if the
      template only sends a link.
- [ ] **Rotate the reviewer account's password**, and re-verify `subscription_tier`
      is still `'pro'` for `facade01-0000-4000-8000-000000000001`. Update the stored
      credential in the password manager and the App Store Connect review notes to
      match. (See "App Store reviewer account" in the project memory index — this
      account has drifted out of sync with App Review before.)

## App Review notes (paste into App Store Connect)

> **What Capsule is:** a shared photo album that stays locked until a date the group
> picks. Everyone contributes photos, nobody sees them, and at the unlock moment the
> whole album opens for all members at once.
>
> **Demo account:** `appreview@getcapsuleapp.com` — password is in the App Store
> Connect review notes for this submission (and the password manager).
>
> This account is pre-seeded so the time-locked features are reviewable immediately:
>
> - **"Lake Tahoe Trip"** is already unlocked — open it to see the full photo grid,
>   reactions, and the Awards section with finalized winners.
> - **"Summer Rooftop Party"** was armed to unlock a few hours after this build was
>   submitted. Its countdown is live; leaving the app open through the unlock moment
>   shows the reveal animation. If review begins after that moment has passed it
>   will simply read as a second unlocked album — we can re-arm the countdown on
>   request.
> - **"Emma & Noah's Wedding"** is in surprise mode: photos have been added but
>   nobody, including the album's own creator, can view them until the unlock date.
>   The locked screen showing a count but no images is intended behaviour, not a bug.
> - **"Diego's Birthday"** has a pending invitation on the Alerts tab to accept or
>   decline.
>
> **Proximity unlock** is an alternative unlock mode requiring every member to be
> physically in the same place at the same time. It cannot be exercised by a single
> reviewer on one device, so all demo albums use date-based unlocking instead. A
> screen recording of this flow is available on request.
>
> **Capsule Pro** (in-app purchase) is already granted on this demo account so the
> Pro-only features are reviewable without a purchase. Because the account is
> already Pro, **Settings → Capsule Pro shows "Manage Subscription"** — the
> RevenueCat Customer Center, where change-plan / restore / cancel live — and not
> the purchase buttons.
>
> To exercise the purchase flow and the paywall, sign up for a new account from the
> Welcome screen (signup is open; the email is confirmed with a 6-digit code sent to
> whatever address you enter). New accounts start on the free tier, where
> **Settings → Capsule Pro shows "Upgrade to Capsule Pro"** and **"Restore
> Purchases"**. Nothing about the purchase or restore code path is modified for the
> demo account — the only difference is that its entitlement was granted
> server-side instead of bought.
>
> **User-generated content:** every photo can be reported via the flag icon in the
> full-screen viewer, and any user can be blocked from their profile's ⋯ menu.
> Blocked users are managed in Settings → Privacy → Blocked Users. Account deletion
> is in Settings and removes stored media immediately.

## Reproducing / cleaning up

Seed sources live in `scripts/reviewer-seed/`:

1. `seed.sql` sections 1–3 — accounts, capsules, membership
2. `upload-media.mjs` — fetches photos and uploads them as the reviewer
3. `insert-media-rows.mjs` — inserts the matching `media` rows
4. `seed.sql` sections 4–7 — attribution, awards, reactions, verification

**None of these read the reviewer password from a committed file.** Supply it out
of band, pulled from the password manager / App Store Connect review notes:

- `seed.sql` (step 1) takes it as a psql variable — never paste it into the file:
  ```bash
  psql "$DATABASE_URL" -v reviewer_password='<the real password>' -f scripts/reviewer-seed/seed.sql
  ```
- `upload-media.mjs` and `insert-media-rows.mjs` (steps 2–3) read `REVIEWER_EMAIL`
  and `REVIEWER_PASSWORD` from the process environment, not from the `--env` file
  (that file only supplies the Supabase URL/anon key):
  ```bash
  REVIEWER_EMAIL=appreview@getcapsuleapp.com REVIEWER_PASSWORD='<the real password>' \
    node scripts/reviewer-seed/upload-media.mjs --env .env --out manifest.json
  REVIEWER_EMAIL=appreview@getcapsuleapp.com REVIEWER_PASSWORD='<the real password>' \
    node scripts/reviewer-seed/insert-media-rows.mjs --env .env --manifest manifest.json
  ```
  Both scripts fail fast with a clear error if either variable is unset — they will
  not fall back to any default.

Photos come from [Lorem Picsum](https://picsum.photos), which serves Unsplash
images under the Unsplash license, requested at 1440×1920 so they arrive already
within the app's 1920px cap.

Everything uses the **`facade01-`** UUID prefix, deliberately distinct from the
`facade00-` landing-page marketing fixtures so the two can be cleaned up
independently:

```sql
-- destructive; cascades through capsules, media, awards and notifications
delete from auth.users where id::text like 'facade01%';
```

Storage objects under `capsule-media/facade01-*` are not removed by that cascade
and need deleting separately.
