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
| Tier | **Free** — must stay free, see "Never comp this account to Pro" below |
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

### ⚠️ Re-arm the demo before each submission

**Run [`scripts/reviewer-seed/pre-submission-rearm.sql`](../scripts/reviewer-seed/pre-submission-rearm.sql)
immediately before submitting, and again if review drags on.** It is idempotent
and ends with a verification query.

Every state in the table above decays on its own as real time passes, because
three of the four capsules are defined by a *future* unlock date. By the first
submission all four had drifted to `unlocked` — the live-countdown demo and the
surprise-mode demo were both silently demonstrating nothing, and the pending
invite had been consumed. The script resets:

- **the tier back to `free`** (see below — this is the important one),
- Summer Rooftop Party to ~3h out, Emma & Noah's Wedding to ~21d out with
  surprise mode on, Diego's Birthday to ~9d out,
- the reviewer's Diego's Birthday membership back to a pending invite,
- award winners/votes on the three re-armed capsules (a re-locked capsule must
  not still show decided awards). Lake Tahoe Trip is deliberately left alone —
  its finalized awards are the whole point of that capsule.

Clearing the `unlock_reminder_*` stamps matters: each tier is claim-and-stamp
once per capsule, so without clearing them the reviewer gets no countdown push.
`unlock_notified_at` is the same story for the unlock push itself.

### ⚠️ Never comp this account to Pro

**`subscription_tier` must be `'free'` on this account, and must be re-checked
before every submission.** This is the opposite of what this doc said before the
first submission, and getting it wrong cost a full review cycle.

On the first submission the account was comped to `'pro'`. Apple **approved the
binary and rejected all three in-app purchases** — because a Pro account has no
reachable purchase path anywhere in the app:

| Paywall entry point | Gate | What a Pro account sees |
|---|---|---|
| Settings → "Upgrade to Capsule Pro" | `isPro ? … : …` | "Manage Subscription" instead |
| Settings → "Custom color & gradient themes" locked row | `!isPro` | the unlocked picker instead |
| CapsuleDetail post-unlock upsell nudge | `!isPro` | hidden |
| The five tier gates (capsules, groups, members, photos, video) | free-tier caps | never fire |

`useEntitlements()` resolves Pro from **either** RevenueCat **or**
`users.subscription_tier` (`resolveIsPro()` in `src/lib/tierLimits.ts`), so the
comped column alone was enough to hide the entire paywall from App Review. The
"Manage Subscription" row it left behind opens the RevenueCat Customer Center,
which on an account with no real purchase behind it is empty — so the one Pro
surface the reviewer *could* reach also looked broken.

Verify before each submission:

```sql
select id, subscription_tier from public.users
 where id = 'facade01-0000-4000-8000-000000000001';  -- expect 'free'
```

Nothing in the seeded content depends on the tier: the caps are enforced on
INSERT and the seed runs as `service_role`, so the pre-seeded capsules, members
and media all render identically on the free tier.

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
> **In-app purchases.** This account is on the free tier, so every purchase entry
> point is live. To reach the Capsule Pro paywall:
>
> 1. Tap the **Profile** tab (bottom right) → **Appearance** → the **Capsule Pro**
>    section → **"Upgrade to Capsule Pro"**. Monthly, Yearly and Lifetime are all
>    presented there, with price, billing period, Restore Purchases, and links to
>    the Terms of Service and Privacy Policy.
>
> The same paywall is also reachable from several in-context prompts, any of which
> can be used instead:
>
> - **Profile → Appearance → "Custom color & gradient themes"** (the locked row).
> - **Open "Lake Tahoe Trip" → Media header → Export** — bulk capsule download is a
>   Pro feature.
> - Creating a 4th active album, inviting an 11th member, adding a 21st photo to one
>   album, posting a video longer than 30 seconds, or setting a repeating schedule on
>   a group each surface the same upgrade prompt.
>
> **Restore Purchases** is at Profile → Appearance → Capsule Pro → Restore Purchases.
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
