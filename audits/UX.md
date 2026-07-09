# Capsule — UX Audit (User Paths)

A walk through each user path in order of how a real user encounters them, with
recommended changes and the reasoning behind each. Cross-references `BUGS.md` where a
UX problem is rooted in a bug already documented there. **No code has been changed.**

Legend: 🔴 Breaks or badly degrades the path · 🟠 Friction worth fixing · 🟡 Polish

---

## Path 1 — First run: Welcome → Sign up → Onboarding

### 🔴 1.1 Email-confirmation is a dead end
**File:** `src/screens/auth/SignUpScreen.tsx` (~line 44)

When `data.session === null`, the screen shows "Check your email — we sent you a
confirmation link" and… stops. The confirmation link opens in the user's *browser*, not
the app; when they switch back, they're still parked on the sign-up form with a filled
password field and a live "Create Account" button (tapping it again yields a confusing
"already registered" error). There's no resend, no "I've confirmed — sign in" action.

**Recommend:** after sign-up, replace the form with a dedicated confirmation state:
the email address shown, a "Resend email" button (with cooldown), and a "I've
confirmed → Sign in" button that routes to Login with the email prefilled.
**Reasoning:** this is the single highest-stakes funnel step — a brand-new user with
zero investment. Any ambiguity here is churn; every competing app resolves this state
explicitly.

### 🟠 1.2 Auth inputs don't cooperate with password managers
**Files:** `SignUpScreen.tsx`, `LoginScreen.tsx`

The email/password `TextInput`s have no `textContentType` / `autoComplete` props, so
iOS won't offer strong-password generation on sign-up or credential autofill on login,
and there's no show/hide-password toggle.

**Recommend:** `textContentType="emailAddress"` + `autoComplete="email"` on email;
`textContentType="newPassword"` (sign-up) / `"password"` (login); an eye toggle on the
password field.
**Reasoning:** one-line props that measurably improve sign-up completion and reduce
"forgot password" volume — autofill users never mistype.

### 🟡 1.3 Raw Supabase error strings surface verbatim
`setError(signUpError.message)` shows API English ("User already registered",
"Password should be at least…"). Map the 3–4 common codes to friendly copy with a
next action ("That email already has an account — Sign in instead?" as a tappable
link). **Reasoning:** error moments are where users decide the app is janky; the
"already registered" case in particular should route to Login, not dead-end.

*(Strength worth keeping: the session-expired banner on Welcome, and Onboarding's
preset-card step that prefills the Create form — both are good activation patterns.)*

---

## Path 2 — Creating a capsule (the core conversion)

### 🔴 2.1 The Create form front-loads eight decisions
**File:** `src/screens/app/CreateScreen.tsx`

Before the primary button, a new user scrolls through: name, description, unlock mode,
unlock date, uploads deadline, voting window, occasion, a 4-award preview with
shuffle/swap/remove controls, and the surprise toggle. Voting windows and award themes
are concepts the user can't evaluate before they've ever opened a capsule.

**Recommend:** progressive disclosure. Keep **Name, Unlock date/mode, and the surprise
toggle** visible; collapse **Uploads deadline, Voting window, Occasion + default
awards** under an "Awards & advanced" disclosure that shows its current values as a
summary line ("General · 48h voting · 4 awards"). All defaults already exist, so
collapsing costs nothing.
**Reasoning:** time-to-first-capsule is the activation metric. Every decision on this
screen is a place to stall; the advanced options are also *editable later* (voting
window, awards pre-unlock), so forcing them at creation buys nothing.

### 🔴 2.2 After "Lock Capsule" the user lands alone in an empty capsule
`handleCreate` navigates to `CapsuleDetail` with exactly one member (you) and no
prompt to invite anyone. The invite affordance is a small "+ Invite" pill mid-screen.

**Recommend:** make invitation part of the creation arc — either auto-open the invite
modal (with QR) on first landing, or show a dismissible full-width "Invite people —
capsules are better together" callout when `members.length === 1`.
**Reasoning:** the product's entire premise is a *shared* unlock. A single-member
capsule is a failed core loop: nothing to anticipate, no reveal moment, no award
voting. This is the app's most important nudge and it currently doesn't exist.

### 🟠 2.3 Validation errors render out of view of the field they refer to
Errors (`'Give your capsule a name.'`) appear in one text slot above the button at the
bottom of a long scroll; the offending field (Name) is at the top and nothing scrolls
to or highlights it.

**Recommend:** inline per-field error text + red border on the failing input, and/or
`scrollTo` the first invalid field on submit.
**Reasoning:** the user's eye is on the button they just tapped; a message that names
a field they can't see forces a hunt. Inline errors also self-clear as the user types.

### 🟠 2.4 Pending-media upload during create is invisible and silently lossy
When arriving from camera/share with `pendingMedia`, `handleCreate` uploads
sequentially with only the button spinner — no "Uploading 2 of 5…" — and each failure
is swallowed by an empty `catch`, then the toast cheerfully reports "5 photos added"
regardless of how many actually made it.

**Recommend:** reuse `CapsuleDetailScreen`'s `Uploading N/M` presentation, count
failures, and make the toast truthful ("4 of 5 added — 1 failed, retry from the
capsule").
**Reasoning:** these are memories users explicitly chose to save; a silent partial
loss discovered at unlock (months later, unfixable) is the worst possible failure
mode in this product.

---

## Path 3 — Joining a capsule (QR / deep link / Alerts)

### 🔴 3.1 An invalid QR scan permanently disables the scanner
**File:** `src/screens/app/QRScannerScreen.tsx` (`handleScan`, ~line 46)

On a non-Capsule QR, `scanned` is set `true`, the hint says "Not a valid Capsule
invite. **Try again.**" — but nothing ever resets `scanned`, and `onBarcodeScanned` is
now `undefined`. The camera will never scan again; the copy invites a retry that is
impossible without leaving and re-opening the screen. (`dismissSheet` re-arms, but it's
only reachable when a preview sheet rendered — which it didn't.)

**Recommend:** on scan errors with no sheet, re-arm after ~2 s (`setScanned(false)`)
or on the next camera frame.
**Reasoning:** the mismatch between the copy ("Try again") and the behavior (frozen)
reads as the app hanging. Trivial fix, total dead end.

### 🔴 3.2 "Accept Invite" doesn't actually join — the user must accept twice
QR scan and `capsule://join` deep links insert a *pending* membership and dump the
user into the **Alerts tab**, where a second Accept on the invite card is what really
joins them (see `BUGS.md` #3 for the data-layer detail).

**Recommend:** a button labeled "Accept Invite" should join (`joined_at: now()`) and
navigate **into the capsule** — the destination the user was promised. Reserve the
pending/accept flow for invites *pushed* to you, where consent hasn't been given yet.
**Reasoning:** scanning a QR in person *is* the consent act. The current flow breaks
the label's contract, adds a step, and lands the user on a screen (Alerts) they didn't
ask for — three violations of expectation in one tap.

### 🔴 3.3 Dismissing an invite notification orphans the invite forever
**File:** `src/screens/app/NotificationsScreen.tsx`

Invite cards have Accept — but the only "no" is the generic dismiss (mark-read). Doing
so removes the card while the pending `capsule_members` row lives on invisibly: the
user can never see or accept that invite again anywhere in the app, and on the owner's
side they linger as a ghost "pending" member in ManageMembers.

**Recommend:** explicit **Accept / Decline** on invite cards (decline deletes the
membership row, like friend requests already do), and don't let plain dismiss orphan a
pending invite — either block dismissal on actionable cards or resurface pending
invites in a persistent location (e.g. a "Pending invites" row on Home).
**Reasoning:** notifications are treated as ephemeral by users; parking the *only*
entry point to a pending state inside one is a trap. Friend requests already model
the correct pattern in this same file.

### 🟠 3.4 Failed accepts fail silently
`accept()` on error just stops the spinner — no message, no retry cue; the user taps
again into the void. Toast the failure ("Couldn't join — try again"). **Reasoning:**
an unacknowledged tap is indistinguishable from a broken button.

---

## Path 4 — Capturing & contributing

### 🟠 4.1 The camera's gesture vocabulary is undiscoverable
**File:** `src/screens/app/CameraScreen.tsx`

Hold-to-record, double-tap flip, slide-right-to-lock recording, pinch zoom, and the
mode dropdown are all invisible until stumbled upon. There is no hint UI of any kind.

**Recommend:** a one-time, dismissible coach overlay on first camera open (three
lines: "Tap for photo · Hold for video · Slide right to lock"), plus a subtle "→ lock"
glyph near the shutter *while recording* the first few times.
**Reasoning:** a feature users can't find doesn't exist. Hold-to-record is table
stakes (Snapchat trained everyone), but slide-to-lock and double-tap-flip-while-
recording are genuinely differentiating and currently invisible.

### 🟡 4.2 Library/detail-screen uploads can't have captions; camera/share uploads can
`PreviewScreen` supports per-item captions; the "+ Add Photos" flow in
`CapsuleDetailScreen` does not. Users won't understand why some photos have captions
and theirs can't. **Recommend:** route detail-screen picks through the same Preview
carousel (also unifies the resize pipeline flagged in `PERFORMANCE.md` #1).

---

## Path 5 — Waiting, unlock, and the reveal

### 🟠 5.1 Proximity capsules advertise a countdown to a meaningless date
Home cards show "23d 4h left" for capsules that actually unlock when members gather
(`BUGS.md` #5 has the data-layer detail). **Recommend:** fetch `unlock_mode` and show
"Unlocks when you're together" with a people icon instead of the countdown.
**Reasoning:** the countdown makes a promise the app will break — the capsule won't
open on that date, and users will plan around it.

### 🟠 5.2 Archive teleports the user with no confirmation, explanation, or undo
**File:** `CapsuleDetailScreen.tsx` danger zone (~line 1776)

Tapping "Archive Capsule" immediately archives and `navigation.reset`s to Home. The
capsule vanishes (the Archived section is collapsed by default), there's no toast, no
undo, and the whole nav stack is wiped.

**Recommend:** `goBack()` instead of `reset`, plus a toast with **Undo** ("Archived —
Undo") using the same `set_capsule_archived` RPC to reverse. And since archive is
reversible, move it *out* of "Danger Zone" — that label should be reserved for
Delete.
**Reasoning:** reversible actions shouldn't require confirmation, but they must
announce what happened and offer a way back (undo > confirm). The current combination
— instant, silent, teleporting — reads as "my capsule disappeared."

### 🟡 5.3 The award-voting window can lapse on screen without the UI noticing
`AwardsSection`'s open/tallying state only re-evaluates on re-render (`BUGS.md` #11).
A one-shot timer to `votingClosesAt` makes the transition live. **Reasoning:** the
2-hours-left push deliberately drives users to this screen near the boundary — the
exact moment the stale state is most likely to be visible.

### 🟡 5.4 Alerts tab badge lags reality by up to a minute
(`BUGS.md` #10.) Derive the badge from the already-cached notifications data instead
of a throttled independent query. **Reasoning:** a badge that stays lit after you've
cleared everything trains users to ignore it.

---

## Path 6 — Profile & settings

### 🟠 6.1 "Settings" is just a color picker — and there's no account deletion
**Files:** `ProfileScreen.tsx` (action row), `SettingsScreen.tsx`

The row labeled **Settings** opens a screen containing only the accent-color picker.
Users expecting notification preferences, blocked-users management, or account
actions find none. More importantly: **there is no in-app account deletion anywhere**,
which App Store Guideline 5.1.1(v) requires for apps with account creation — a
rejection risk at review time, not just a UX gap.

**Recommend:** either rename the row "Appearance" (honest, cheap) or build Settings
into a real hub: Appearance, Blocked users (the block list currently has *no*
management UI — you can only unblock from a profile you can still find), and Account
(sign out, delete account).
**Reasoning:** mislabeled navigation erodes trust in every other label; the deletion
requirement will block the TestFlight→App Store step regardless.

### 🟡 6.2 Avatar-upload errors dump auth-token internals on the user
(`BUGS.md` #6.) The "TEMP diagnostic" string (`tokenSub=… match=… expiresIn=…`)
renders in the edit-profile error slot. Replace with "Upload failed — check your
connection and try again." **Reasoning:** beyond the info-leak, jargon errors at a
personal moment (setting your own face) is the wrong place to look broken.

---

## Cross-cutting

### 🟠 7.1 Silent failure is the default failure mode
A recurring pattern: fire-and-forget awaits with no user feedback on error —
`restoreCapsule` (Home), archive/restore RPC (detail), `persistRead`,
`setAccentColor`'s background persist, group-invite pushes, `declineFriend`. The
`toast` infrastructure already exists. **Recommend:** adopt a rule — *any user-
initiated mutation that fails must toast* — and sweep the ~8 call sites.
**Reasoning:** each silent failure becomes a mystery bug report ("my restore didn't
work") that can't be reproduced; a toast converts it into a self-explanatory retry.

### 🟠 7.2 Accessibility pass: icon-only buttons and low-contrast text
- Icon-only touchables have no `accessibilityLabel`/`accessibilityRole`: QR scan
  button, layout toggle, all close ✕'s, camera controls, notification dismiss, the
  `⋯` overflow. VoiceOver users get "button" with no name.
- Muted text `#555555` on `#0A0A0A` is ≈2.5:1 contrast — well below WCAG AA (4.5:1
  for body text). It's used for real content (dates, member counts, empty-state copy),
  not just decoration. `#888888` (≈5:1) passes; consider making that the floor for
  informational text and reserving `#555` for true decoration.
- Font sizes are fixed; at minimum verify layouts tolerate iOS Dynamic Type via
  `maxFontSizeMultiplier` rather than clipping.

**Reasoning:** cheap now, expensive later; also App Review increasingly probes basic
VoiceOver operability.

### 🟡 7.3 Hidden long-press affordance on Home cards
Owner long-press opens EditCapsule — undiscoverable and owner-only with no visual
differentiation. Edit is reachable from the detail screen anyway, so either drop the
gesture or surface it (a context menu on long-press for *all* cards: Open / Edit /
Archive would make the gesture worth learning).

---

## What's already strong (keep these patterns)

- **Skeletons + 8s retry** everywhere data loads — the app never hangs on a spinner.
- **Cache-first rendering** — returning to any screen feels instant.
- **Empty states teach** (Home's "Create your first capsule" with art; Alerts'
  "all caught up"; Preview's create-capsule fallback keeps captured media alive
  instead of discarding it).
- **Surprise-mode copy** ("Hidden from you too — you chose to keep it a surprise")
  turns a potentially confusing lockout into a delightful reminder.
- **The InfoTooltip pattern** on Unlock Mode / Uploads Deadline / Occasion — the right
  way to explain novel concepts without cluttering the form.
- **Haptics wiring** (tab taps, shutter, reactions, accept/decline) is consistent and
  restrained.
- **ConfirmModal for destructive actions** (delete) with loading states — correct
  cross-platform choice.

---

## Suggested order of attack

1. **3.1 QR re-arm + 3.2 single-tap join** — the join path is the app's growth loop
   and both are small changes.
2. **2.2 post-create invite nudge** — biggest activation lever in the file.
3. **1.1 email-confirmation state** — top-of-funnel churn stopper.
4. **3.3 invite Accept/Decline** + **7.1 toast-on-error sweep** — trust and
   comprehension.
5. **6.1 Settings/account-deletion** — required for App Store submission anyway;
   schedule before launch.
6. **2.1 form disclosure, 5.2 archive undo, 4.1 camera coach, 7.2 a11y** as the
   polish wave.
