# Capsule — Onboarding v2: "Tell us about your moment"

A design spec, not an implementation. Layouts, copy, branching, and data
mapping for a replacement onboarding flow. Builds on `audits/UX_POLISH.md` #1–#4
(cut color/bio, prime notifications contextually, give sealing a moment).

---

## The design principle

The current wizard asks users to **configure a product** (name, color, bio).
People don't bond with configuration — they bond with being understood. Capsule
has an unfair advantage here that almost no app has: **every new user arrives
with a specific moment already in their head** — a wedding, a trip, a baby, a
graduation. They downloaded the app *because of that moment*.

So the redesign has one rule: **every screen is about their moment, and every
screen visibly reacts to what they said on the previous one.** The user's own
words appear in the UI within seconds of typing them. That's what "feeling
heard" mechanically is — playback.

Secondary rule: **shorter than v1.** Feeling heard comes from responsiveness,
not questionnaire length. Five screens, but three of them are one-tap.

---

## Flow map

```
Screen 1          Screen 2              Screen 3               Screen 4            Screen 5
"Who are you?"    "What's the moment?"  "When does it open?"   "Don't miss it"     "Sealed"
name + avatar  →  occasion intent    →  date + title seed   →  notif primer    →   ceremony +
                  (6 chips + text)      (pre-filled from 2)    (uses their        invite prompt
                                                               capsule's name)
     │                  │                     │                     │
     └── every later screen echoes name ──────┴── echoes their moment/title ──────┘

Skip at any point after Screen 1 → Home (never trap; never guilt).
```

Total required input: **one text field, two taps, one date.** Everything else
is optional or pre-filled.

---

## Screen 1 — "Who are you?" (kept from v1, warmed up)

```
┌─────────────────────────────────┐
│  ● ○ ○ ○ ○                      │   progress dots (accent-tinted, as today)
│                                 │
│  First things first —           │
│  who are you?                   │   heading, 28pt bold
│                                 │
│        ┌─────────┐              │
│        │  photo  │  + camera    │   avatar slot (optional, as today)
│        └─────────┘              │
│                                 │
│  ┌───────────────────────────┐  │
│  │ Display name              │  │
│  └───────────────────────────┘  │
│                                 │
│  ╭───────────────────────────╮  │
│  │ ◉ Sarah   ·  just now     │  │   ← LIVE PREVIEW: a real member-row
│  │   added 3 photos          │  │      chip that renders their name +
│  ╰───────────────────────────╯  │      avatar AS THEY TYPE
│  This is how friends see you    │
│  inside a capsule.              │
│                                 │
│              [ Next ]           │
└─────────────────────────────────┘
```

**What's new:** the live member-row preview. Instead of *telling* them "this is
how friends will see you," show the actual UI component with their name
rendering keystroke-by-keystroke. It's the first proof that the app reacts to
them. (Reuses the existing member-row styles — no new visual language.)

**Mechanics:** avatar upload starts in the background the moment it's picked
(fixes the deferred-failure problem from UX_POLISH #2). Name required, 30 chars,
same validation as today.

---

## Screen 2 — "What's the moment?" (the heart of the redesign)

```
┌─────────────────────────────────┐
│  ● ● ○ ○ ○                      │
│                                 │
│  Nice to meet you, Sarah.       │   ← echo #1: their name, immediately
│  What are you waiting for?      │
│                                 │
│  ┌────────────┐ ┌────────────┐  │
│  │ 💍 A       │ │ ✈️ A trip   │  │
│  │  wedding   │ │            │  │
│  ├────────────┤ ├────────────┤  │   6 tappable intent cards
│  │ 👶 A baby's│ │ 🎓 A big   │  │   (map 1:1 to `capsules.occasion`:
│  │  first year│ │  milestone │  │    wedding / vacation / baby /
│  ├────────────┤ ├────────────┤  │    milestone / party / general)
│  │ 🎉 A party │ │ ✨ Just    │  │
│  │  or event  │ │  memories  │  │
│  └────────────┘ └────────────┘  │
│                                 │
│  ┌───────────────────────────┐  │
│  │ or tell us in your words… │  │   ← optional free-text (1 line, 60 chars)
│  └───────────────────────────┘  │
│                                 │
│         skip for now            │   quiet text link, bottom
└─────────────────────────────────┘
```

**Why this works:** it's the question a *friend* would ask, and it's the only
onboarding question in the flow that isn't about the app. The free-text field
is the authenticity move — "our senior year" / "deployment homecoming" /
"grandma's 90th" — and whatever they type becomes the **suggested capsule
title** on the next screen, verbatim. Users who type here are naming the thing
they care about; handing it back to them un-mangled is the single strongest
"they heard me" beat available.

**Data captured:** `occasion` (chip) and an optional intent string (free text —
held in memory for Screen 3's title seed; not a DB column, no schema change).

**Skip path:** occasion defaults to `general`; Screen 3 falls back to generic
copy. Skipping is never punished — the link stays quiet and un-nagging.

---

## Screen 3 — "When does it open?" (their first capsule, pre-built)

```
┌─────────────────────────────────┐
│  ● ● ● ○ ○                      │
│                                 │
│  Let's set up your first        │
│  capsule.                       │
│                                 │
│  ╭───────────────────────────╮  │
│  │ 🔒  Sarah & Tom's Wedding │  │   ← capsule card mock, PRE-FILLED:
│  │     ✎ tap to rename       │  │     title from their free text, or the
│  │                           │  │     occasion default ("The Wedding
│  │  Opens: [ pick a date ▾ ] │  │     Capsule", "Summer Trip 2026", …)
│  ╰───────────────────────────╯  │
│                                 │
│  📅 Occasion-aware date chips:  │
│  ┌──────────┐ ┌─────────────┐   │
│  │ After the│ │ Our first   │   │   ← wedding: honeymoon return /
│  │ honeymoon│ │ anniversary │   │      anniversary. trip: "when we're
│  └──────────┘ └─────────────┘   │      home". baby: "their 1st birthday".
│  ┌──────────────────────────┐   │      NYE for "just memories". etc.
│  │ 📆 pick my own date       │   │
│  └──────────────────────────┘   │
│                                 │
│  It stays locked for everyone — │
│  even you — until that day. 🤫  │   ← surprise-mode default, stated as
│                                 │      a promise, not a settings toggle
│    [ Create my capsule ]        │
│         skip for now            │
└─────────────────────────────────┘
```

**Why this works:** v1's step 4 handed users a preset *label* and dropped them
into a nine-field form (UX_POLISH #3). Here the capsule is **already built
from their answers** — they see their own words as the title of a rendered
capsule card. The only real decision left is the date, and even that is themed
to what they said ("After the honeymoon" is a warmer button than a calendar).

Renaming is inline on the card (tap the title), not a form field. The
occasion's themed default awards get seeded silently — they'll discover them
on the detail screen, which already has the manage card.

**Data captured:** on "Create my capsule" — a real `capsules` insert (title,
`unlock_at`, `occasion`, `owner_preview_locked: true`, all other defaults) +
owner membership + default awards RPC. On skip — nothing; Home's empty state
takes over.

---

## Screen 4 — "Don't miss it" (the notification primer, earned)

Shown **only** if Screen 3 created a capsule (otherwise skipped entirely —
a primer without a capsule has nothing to promise).

```
┌─────────────────────────────────┐
│  ● ● ● ● ○                      │
│                                 │
│         ╭─────────╮             │
│         │   🔔    │             │   soft illustration, accent-tinted
│         ╰─────────╯             │
│                                 │
│  "Sarah & Tom's Wedding"        │   ← echo #2: THEIR capsule title,
│  opens June 30, 2027.           │      THEIR date
│                                 │
│  Want us to tell you the        │
│  second it unlocks?             │
│                                 │
│  That's the whole point of      │
│  Capsule — don't miss it.       │
│                                 │
│   [ 🔔 Yes, notify me ]         │   → triggers the ONE iOS system prompt
│                                 │
│      maybe later                │   → no system prompt; native ask is
│                                 │     preserved for a future retry
└─────────────────────────────────┘
```

**Why this works:** this is UX_POLISH #1's primer, but supercharged by
context — it names *their* capsule and *their* date. The permission stops
being "an app wants to send you notifications" and becomes "do you want to
know when your wedding photos open." Primed, self-referential asks are how you
get grant rates in the 70–80% range instead of a cold ~50%.

**Mechanics:** "Yes" → `requestPermissionsAsync` (first and only launch-path
call to it — the on-launch auto-request is removed per UX_POLISH #1). "Maybe
later" → mark a flag; re-prime once, after their first invite is accepted.

---

## Screen 5 — "Sealed" (the ceremony + the loop)

```
┌─────────────────────────────────┐
│                                 │
│                                 │
│           ╭───────╮             │
│           │  🔒   │             │   lock scales in + success haptic
│           ╰───────╯             │   (the UX_POLISH #4 "sealed moment")
│                                 │
│   Sealed.                       │
│                                 │
│   "Sarah & Tom's Wedding"       │   ← echo #3
│   opens in 358 days.            │   ← live countdown, ticking
│                                 │
│   Capsules are better full.     │
│   Who else was there?           │
│                                 │
│   [ 📤 Invite people ]          │   → existing share/QR sheet
│                                 │
│   [ 📷 Add the first photo ]    │   → camera, pre-targeted to this capsule
│                                 │
│      take me home               │
└─────────────────────────────────┘
```

**Why this works:** it closes the emotional arc the flow opened ("what are you
waiting for?" → *here it is, locked, counting down*) and converts the peak
moment into the two actions that determine retention: an invite (the growth
loop) or a first photo (the habit loop). The ticking countdown makes the
promise feel alive. If they skipped capsule creation, this screen is skipped
too — they land on Home.

---

## The personalization matrix

One table drives all the dynamic copy — no AI, no server, just a lookup keyed
on the Screen 2 answer:

| Occasion | Title seed | Date chips | Screen 3 flavor line | Screen 5 nudge |
|---|---|---|---|---|
| 💍 wedding | "The Wedding Capsule" | After the honeymoon (+3w) · First anniversary (+1y) | "Every guest's photos, opened when the chaos settles." | "Who's in the wedding party?" |
| ✈️ vacation | "Summer Trip 2026" | When we're home (+2w) · One year later (+1y) | "Shoot now, relive it on the couch." | "Who's coming on the trip?" |
| 👶 baby | "Baby's First Year" | Their 1st birthday (+1y) | "Every milestone, sealed until the candles." | "Grandparents love this part." |
| 🎓 milestone | "Senior Year" | Graduation day · One year from today | "Lock it now. Open it when you've made it." | "Who's graduating with you?" |
| 🎉 party | "The Big Night" | Tomorrow morning (+1d) · Next weekend | "Everyone's angle of the same night." | "Who else was there?" |
| ✨ general | "Our Capsule" | New Year's Eve · One year from today | "Photos are better with a little patience." | "Who should be in this?" |
| *(free text)* | **their words, verbatim** | occasion chips of whichever card they also tapped, else general | — | — |

Free text always wins the title seed. Never rewrite, title-case, or "improve"
what they typed — verbatim is the point.

---

## What got cut from v1, and where it went

| v1 step | Fate | Rationale |
|---|---|---|
| Step 2: accent color | Cut → Settings (already exists) | Decorating before using; UX_POLISH #2. A one-time "Make it yours" hint chip on Profile after day 2 replaces it. |
| Step 3: bio | Cut → Edit Profile (already exists) | Nobody's aha moment is a bio. Slot's emotional budget went to Screen 2's intent question. |
| Step 4: preset cards → empty Create form | Replaced by Screens 2+3 | Presets asked users to pick *marketing copy*; v2 asks about *their life* and builds the capsule for them. |
| On-launch push permission | Replaced by Screen 4 | UX_POLISH #1. |

Net screen count: 4→5, but required decisions drop from ~6 (name, color, bio,
preset, then the full Create form) to **3** (name, one chip, one date), and the
user exits onboarding with a real capsule, a countdown, and a pending invite —
instead of a themed blank form.

---

## Edge cases & rules

- **Skip is always available after Screen 1** (name is required — the product
  needs it). Skipping 2 → generic Screen 3. Skipping 3 → straight to Home
  (Screens 4–5 auto-skip; no capsule, nothing to promise).
- **Back navigation** works 1↔2↔3. Screens 4–5 are forward-only (the capsule
  exists; the prompt was answered).
- **Interruption/kill mid-flow:** `onboarded_at` is stamped at the end of
  Screen 3 (or on any skip-to-Home), so a killed app never re-traps a user in
  the wizard; a capsule created on 3 survives regardless.
- **Web:** identical flow; Screen 4 still shows but "Yes, notify me" is a
  no-op-with-copy ("We'll remind you in the app") since web push isn't wired.
- **Share-intent arrivals** (signed out → stash → login): if a stash exists,
  onboarding compresses to Screen 1 only, then routes to the existing Preview
  flow — those users arrived holding photos; don't make them talk about their
  feelings first.
- **Tone guardrails:** no exclamation-point pileups, no "🎉 Awesome!!" — the
  app's voice is warm but dry (matches existing copy like "Always packing
  snacks."). Never guilt a skip ("are you sure??" is banned).

---

## How to know it worked

- **Completion:** % reaching Home (target: ≥ v1, despite the extra screen —
  fewer decisions should beat fewer screens).
- **Activation:** % exiting onboarding with a created capsule (v1 equivalent:
  preset-tap rate). This is the number the redesign exists to move.
- **Heard-ness proxy:** % who tap a Screen 5 action (invite or first photo)
  vs. "take me home."
- **Push grant rate** on Screen 4 vs. the current cold prompt — expect +20–30pts.
- **Free-text usage** on Screen 2 — if >25% type something, the intent question
  is earning its screen; their words are also your best marketing copy
  (aggregate, anonymized) for MARKETING.md's content engine.
