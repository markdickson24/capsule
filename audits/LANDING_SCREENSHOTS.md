# Capsule — Landing Page Screenshot Brief

Exact shot list for the 7 placeholder tiles added to `landing/index.html` in the
landing-page redesign (see `landing/styles.css`'s `.shot-frame` component). Every
tile currently renders as a dashed frame labeled "APP SCREENSHOT" with a one-line
caption — this doc specifies precisely what real screenshot replaces each one,
including exact demo data (names, dates, member counts, photo content) so the
result is internally consistent across tiles, rather than 7 disconnected shots
with mismatched names, dates, and member counts.

**Do not use stock photos, AI-generated faces, or images you don't have the rights
to.** Seed the demo account with real photos you personally own the rights to
(your own trips/events, or friends/family who've agreed to appear on the
marketing site) — the whole positioning of this app is "real people's real
memories," and stock-photo people in the screenshots would undercut that on sight.
If you don't have enough real material for one of the scenarios below, swap the
occasion/story to match photos you actually have rather than inventing content.

---

## 1. The demo dataset (seed this once, reuse across every shot)

To keep the 7 screenshots feeling like one coherent app instead of 7 disconnected
mockups, seed **one recurring "hero" capsule** used in 4 of the 7 tiles, plus **3
supporting capsules** that only need to exist for the Home-screen list. All data
below is meant to be created for real in a test/demo Supabase account (or your own
account) — it should be genuinely functional data, not photoshopped labels.

### 1.1 Hero capsule — used in tiles #1 (hero), #5, #6, #7

| Field | Value |
|---|---|
| Title | **Amelia & Jonah's Wedding** |
| Occasion | `wedding` |
| Owner | Amelia Cross |
| Unlock mode | `time` |
| Wedding date (in-world) | Saturday, October 3, 2026 |
| Unlock date (`unlock_at`) | **Sunday, October 3, 2027 · 6:00 PM** (their first anniversary) |
| Contribution lock date | October 17, 2026 (guests can keep adding for 2 weeks after the wedding) |
| Surprise mode | **ON** (`owner_preview_locked = true`) — even Amelia can't preview it |
| Superlative voting window | 48 hours |
| Members | **8 joined** (owner + 7 contributors) — see below |
| Media at unlock | **142 photos, 21 videos** (163 total) |

**Members (exact names + roles):**

| Name | Role |
|---|---|
| Amelia Cross | Owner |
| Jonah Reyes | Contributor |
| Priya Nair | Contributor |
| Marcus Webb | Contributor |
| Dana Whitfield | Contributor |
| Theo Brandt | Contributor |
| Lily Sun | Contributor |
| Carmen Ruiz | Contributor |

**The 4 default awards on this capsule** (occasion = wedding, so seed exactly 4 —
matches the app's real cap on default awards):

| Category | Target type |
|---|---|
| Best Toast | Person |
| Best Dance Move | Person |
| Best Candid Shot | Media |
| Most Likely to Host the Reunion | Person |

### 1.2 Supporting capsules — used only in tile #2 (Home screen list)

| Title | Occasion | Unlock mode | State | Members |
|---|---|---|---|---|
| Baja Road Trip | `vacation` | `time` | Unlocked | 5 (Alex Bishop – owner, + 4 contributors) |
| Baby Theo's First Year | `baby` | `time` | Locked, unlocks in **64d 11h** | 6 (Sarah/Marcus Delgado – owner, + 5 contributors) |
| Senior Year Crew | `general` | `proximity` | Locked, "Unlocks together" (no date) | 7 (Priya Nair – owner, + 6 contributors) |

Reusing **Priya Nair** as a member of both the wedding capsule and Senior Year Crew
is intentional — it's realistic (people overlap across capsules) and means you only
need to create one extra demo user, not a fresh cast for every capsule.

---

## 2. The 7 shots, in exact detail

### Tile 1 — Hero (`.hero-visual`)
**Caption in code:** "Capsule detail — locked countdown to unlock"

- **Screen:** `CapsuleDetailScreen`, locked state, for **Amelia & Jonah's Wedding**.
- **Capture ~12 days before the unlock date** so the `CountdownRing` reads roughly
  **"12d 4h left."**
- Must show: the lock icon + countdown ring, capsule title, the 8-member avatar
  stack, and the surprise-mode locked box reading **"142 memories waiting"** (not
  a media grid — surprise mode means even Amelia sees the locked box here).
- This is the single most important shot on the page — it's the first thing a
  visitor sees. Crop tight to the phone's safe area, no status bar clutter.

### Tile 2 — Home screen (`#screens` gallery, "Home")
**Caption in code:** "Home — capsule list"

- **Screen:** `HomeScreen`, list layout (not grid), signed in as **Amelia Cross**.
- Must show **all 4 capsules** from §1 in one scroll-visible view:
  1. Amelia & Jonah's Wedding — countdown badge
  2. Baja Road Trip — unlocked state
  3. Baby Theo's First Year — countdown badge
  4. Senior Year Crew — "Unlocks together" badge (proximity)
- This is the tile that sells "you'll actually have more than one of these going
  at once" — variety of states matters more than any single card.

### Tile 3 — Create a capsule
**Caption in code:** "Create a capsule — date, occasion & surprise mode"

- **Screen:** `CreateScreen`, **mid-fill, not yet submitted.**
- Exact field values to enter:
  - Title: **"Thanksgiving at the Lake"**
  - Unlock date: **November 28, 2026 · 5:00 PM**
  - "More options" expanded, showing:
    - Occasion chip: **Milestone** selected
    - Surprise mode toggle: **ON**
    - Voting window: **48h**
- Capture with the keyboard dismissed and the "Lock Capsule" button visible at
  the bottom so it reads as a real, ready-to-submit form.

### Tile 4 — Dual camera
**Caption in code:** "Camera — dual front & back capture"

- **Screen:** `CameraScreen` in **Dual** mode, **Split (side-by-side) layout**
  (not PiP — Split is the more legible, more "wow" layout at thumbnail size).
- Subject matter: capture this one live, don't restage a photo. Ideal setup —
  back lens on a genuinely lit scene (golden-hour outdoor, a small group, a
  bonfire, a table full of food — anything with visible depth and multiple
  people), front lens catching the photographer's real unguarded reaction
  (laughing, mid-sentence — not a posed grin at the lens).
- Needs a real multi-cam iPhone and a dev/EAS build — **does not run in
  Simulator or Expo Go** (see CLAUDE.md "Dual Camera").

### Tile 5 — Unlock reveal
**Caption in code:** "Unlock reveal — the whole story at once"

- **Screen:** `CapsuleDetailScreen`, captured **mid-reveal-animation** (or the
  first settled frame right after) for **Amelia & Jonah's Wedding**, at the real
  unlock moment (`unlock_at` reached).
- Exact photo mix to have seeded into the 142/21 count so the visible grid reads
  as a real wedding, not a generic photo dump:
  - Getting-ready shots (Amelia in her dress, bridesmaids)
  - Ceremony aisle walk
  - Vows / ring exchange close-up
  - First kiss
  - Reception entrance
  - Cake cutting
  - First dance
  - Candid dance-floor shots from guests (Theo, Carmen)
  - A dual-camera shot: dance floor + a guest's reaction, side-by-side
  - Golden-hour couple portrait
  - A toast/speech shot
  - A table/decor detail shot
  - A late-night exit shot
- The point of this tile is **visible variety of angles from different people** —
  don't use 15 photos that all look like they came from the same photographer.

### Tile 6 — Awards
**Caption in code:** "Awards — yearbook-style voting"

- **Screen:** `AwardsSection` inside `CapsuleDetailScreen`, **voting open**, for
  **Amelia & Jonah's Wedding**, captured with **~6 hours left** in the 48-hour
  voting window (so the countdown reads naturally, not "47h 58m").
- Must show all 4 categories from §1.1 as **live** cards with Vote/Change pills —
  **not vote counts or tallies** (those are hidden until the window closes; this
  is real app behavior, not a stylistic choice — showing tallies here would
  misrepresent the feature).
- Cast at least one real vote (e.g. Best Dance Move → Theo Brandt) before
  capturing, so the "Your vote: Theo Brandt" state is visible on one card —
  otherwise every card looks identical.

### Tile 7 — Capsule detail (unlocked)
**Caption in code:** "Capsule detail — everyone's photos, unlocked"

- **Screen:** `CapsuleDetailScreen`, **fully unlocked and settled** (animation
  finished, scrolled past the header) for **Amelia & Jonah's Wedding** — same
  capsule as Tile 5, captured a few minutes later once the grid has stopped
  animating.
- Must show: the 3-up media grid mid-scroll, the member avatar cluster, and
  ideally the top of the `<DefaultAwardsCard>` or `<AwardsSection>` peeking in
  at the bottom of frame so it reads as "there's more below."

---

## 3. Capture specs

- **Device:** physical iPhone (for the dual-camera shot, this is mandatory —
  see Tile 4) or the iPhone 15 Pro / 6.7" simulator for everything else.
- **Resolution:** native device resolution (3x), PNG, no compression artifacts.
- **Aspect ratio:** the placeholder frames are `aspect-ratio: 9 / 18.4` — a
  standard modern iPhone screenshot already matches this closely; don't letterbox
  or pad.
- **Chrome:** crop out the status bar/notch area if it looks noisy at thumbnail
  size; keep it if it reads as authentically "this is a real phone screen."
- **Consistency:** capture all 4 hero-capsule tiles (#1, #5, #6, #7) in the same
  session/theme so the accent color, member avatars, and photo thumbnails match
  across tiles — a visitor may notice if "Amelia & Jonah's Wedding" looks
  different between the hero and the gallery.

---

## 4. Wiring screenshots into the page once captured

Drop files into a new `landing/screenshots/` folder using these exact names, then
replace each `.shot-frame`'s inner markup with an `<img>` (keep the outer frame
div and its border-radius so the crop looks intentional; drop the dashed border
and placeholder icon/text):

| File | Tile |
|---|---|
| `screenshots/hero-locked.png` | Tile 1 |
| `screenshots/home.png` | Tile 2 |
| `screenshots/create.png` | Tile 3 |
| `screenshots/dual-camera.png` | Tile 4 |
| `screenshots/unlock-reveal.png` | Tile 5 |
| `screenshots/awards.png` | Tile 6 |
| `screenshots/capsule-detail.png` | Tile 7 |

Example swap (Tile 1):

```html
<!-- before -->
<div class="shot-frame" role="img" aria-label="App screenshot placeholder: capsule detail screen showing the locked countdown">
  <svg class="shot-icon">...</svg>
  <div class="shot-tag">App Screenshot</div>
  <div class="shot-desc">Capsule detail — locked countdown to unlock</div>
</div>

<!-- after -->
<div class="shot-frame shot-frame--filled">
  <img src="screenshots/hero-locked.png" alt="Capsule detail screen showing the locked countdown, 12 days left, for Amelia & Jonah's Wedding" />
</div>
```

Add a `.shot-frame--filled img { width:100%; height:100%; object-fit:cover; border-radius:inherit; }`
rule (and drop the dashed border / hash background on that variant) when you do
the swap — not needed until real images exist.
