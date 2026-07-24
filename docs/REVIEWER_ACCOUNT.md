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
| **Password** | `CapsuleReview2026!` |
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
       superlative_voting_closes_at = null,
       superlative_voting_finalized_at = null,
       unlock_reminder_1d_sent_at = null,
       unlock_reminder_1h_sent_at = null,
       unlock_reminder_10m_sent_at = null
 where id = 'facade01-c000-4000-8000-000000000002';
```

Clearing the three `unlock_reminder_*` stamps matters: each tier is claim-and-stamp
once per capsule, so without clearing them the reviewer gets no countdown push.

## App Review notes (paste into App Store Connect)

> **What Capsule is:** a shared photo album that stays locked until a date the group
> picks. Everyone contributes photos, nobody sees them, and at the unlock moment the
> whole album opens for all members at once.
>
> **Demo account:** `appreview@getcapsuleapp.com` / `CapsuleReview2026!`
>
> This account is pre-seeded so the time-locked features are reviewable immediately:
>
> - **"Lake Tahoe Trip"** is already unlocked — open it to see the full photo grid,
>   reactions, and the Awards section with finalized winners.
> - **"Summer Rooftop Party"** unlocks a few hours from now. Its countdown is live;
>   leaving the app open through the unlock moment shows the reveal animation.
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
> **Capsule Pro** (in-app purchase) is pre-granted on this account so its features
> are reviewable without a purchase. The purchase and restore flows themselves are
> unmodified and reachable from Settings → Capsule Pro.
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
