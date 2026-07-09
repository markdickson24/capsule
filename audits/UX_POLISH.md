# Capsule — UX Smoothness Audit

A polish-focused pass: friction, feedback, popups, progress, and pacing. This
is the companion to `UX.md` (which covers broken/confusing *paths*) — nothing
here is broken; it's everything that would make the app feel effortless instead
of merely functional. Findings are grounded in the current code, not
hypotheticals; where UX.md already covers something, it's cross-referenced, not
repeated.

Legend: 🔥 Big smoothness win · 🟠 Worth doing · 🟡 Polish · ✂️ Move or remove

---

## What's already smooth (don't touch)

Credit first, because a lot of polish is already in place and future work
should match this bar:

- **Toast system** (`src/lib/toast.ts` + ToastHost) — module-level pub/sub that
  survives post-upload navigation. Used for "N photos added" confirmations.
- **Skeleton loaders + 8s retry prompts** on every fetching screen; cache-first
  rendering so warm navigation is instant.
- **Camera gesture education** — persistent "Tap for photo · Hold for video"
  hint, contextual "Release to stop · Slide ▶ to lock" while recording,
  "Double tap to flip" label, and an `InfoTooltip` explaining Dual mode.
- **Empty states with art and a CTA** — Home's layered-icon empty state,
  Notifications' "You're all caught up," Friends' explainer.
- **Haptics** wired through a central no-op-safe wrapper on all key touches.
- **Pull-to-refresh** on Home, Notifications, CapsuleDetail, GroupDetail, Friends.
- **Onboarding progress dots** that fill with the user's chosen accent color —
  a genuinely nice touch (the product teaches personalization by *doing* it).

---

## 🔥 1. The notification permission prompt fires mid-onboarding, cold

**Files:** `App.tsx` → `usePushNotifications(userId)`, `usePushNotifications.native.ts:68-72`

`registerToken` runs in a `useEffect` the moment a session exists. For a fresh
sign-up that is **while Onboarding step 1 is on screen** — the iOS system
permission dialog stacks on top of "What should we call you?" The user has
invested nothing, has no idea why Capsule wants notifications, and iOS gives
you exactly **one** shot at the native prompt. Cold, unexplained prompts get
denied ~50–60% of the time; a primed, contextual ask lands 70%+ — and for
Capsule, push *is* the product (the unlock moment).

**Fix:**
1. Gate `registerToken` behind `getPermissionsAsync()` — only auto-register
   users who already granted (returning users). Never call
   `requestPermissionsAsync` on launch.
2. Ask at the first moment the value is self-evident, with a primer screen
   *before* the system dialog: right after the user's first capsule is created
   ("Want to know the second this unlocks? 🔓") or when they accept their first
   invite. A soft primer also preserves the native prompt for a later retry if
   they say "not now."
3. Natural home: replace Onboarding's bio step (see #2) with this primer, or
   trigger it from the post-create success moment (see #4).

Effort: half a day. Impact: this single change probably determines whether
unlock-day pushes reach half your users or nearly all of them.

---

## 🔥 2. Onboarding is four steps; two of them are homework

**File:** `OnboardingScreen.tsx`

Current flow: name+avatar → accent color → bio → first-capsule preset. Steps 2
and 3 ask the user to *decorate a product they haven't used yet*. Every extra
onboarding screen costs real completion percentage, and both of these already
have permanent homes (Settings → color; Edit Profile → bio). Nobody's aha
moment is writing an 80-character bio.

**Recommended shape:**
- **Step 1:** name + avatar (keep exactly as is — it's required data).
- **Step 2:** first-capsule presets (current step 4 — this is the actual
  activation step and the presets are well-written).
- Color and bio: cut from the wizard entirely. Optionally surface a one-time
  "Make it yours" hint on Profile later.
- If you keep a middle step at all, make it the **notification primer** (#1) —
  it's the only interstitial that pays rent.

**Two mechanics worth fixing regardless of length:**
- **Avatar upload is deferred to `finish()`** — picked on step 1, uploaded at
  step 4. If the upload fails, the user gets "Avatar upload failed" three
  screens after the action that caused it, and the retry costs re-doing
  nothing but still blocks completion. Start the upload in the background the
  moment it's picked; `finish()` just awaits the in-flight promise.
- **Preset cards give no pressed feedback while saving** — `disabled={saving}`
  with no spinner on the tapped card. Show a spinner in the tapped card so the
  ~1–2s of profile-save + navigation doesn't feel dead.

---

## 🔥 3. The Create form asks nine questions when two would do

**File:** `CreateScreen.tsx`

The highest-traffic form in the app currently front-loads: name, description,
unlock mode (3 options), unlock date, contribution lock date, voting window,
occasion (6 chips), a live default-awards preview card, and the surprise
toggle. That's a settings page wearing a creation flow's clothes. UX.md flagged
this; here's the concrete split:

**Above the fold (the whole form for 90% of users):**
- Name
- Unlock date (with the existing quick presets)
- Create button

**Collapsed "More options" section:**
- Description, unlock mode, contribution lock, voting window, surprise toggle

**Remove from Create entirely (✂️):**
- **Occasion chips + DefaultAwardsCard preview.** `DefaultAwardsCard
  mode="manage"` *already lives on CapsuleDetailScreen* pre-unlock — the owner
  gets a better version of this exact UI one screen later, with the capsule
  actually existing. The Create-screen preview duplicates it at the worst
  possible moment. Keep `occasion` as a single chip row inside "More options"
  (it seeds the theme) and let the detail screen own award management. This
  deletes the two visually heaviest components from the form.

Smart defaults already exist for everything (48h voting, general occasion,
surprise on, time mode) — the form just doesn't *act* like it trusts them.

---

## 🔥 4. Sealing a capsule — the product's signature moment — has no moment

**Files:** `CreateScreen.handleCreate`, `CapsuleDetailScreen`

After Create succeeds, the user is deposited on the capsule detail screen like
they just saved a spreadsheet. This app's entire emotional premise is *sealing
something away* — the unlock gets a reveal animation, but the **lock** gets
nothing. A 1.5-second full-screen "Sealed 🔒 — opens June 30, 2026" animation
(scale-in lock + success haptic, auto-dismiss) would:

- create the emotional beat the product is named after,
- be the perfect anchor for the two highest-value follow-ons: the **invite
  prompt** (UX.md §"post-create loneliness" / MARKETING.md's #1 experiment)
  and the **notification primer** (#1 above).

One screen, three problems solved, and it's the moment users will screen-record
and share.

---

## 🟠 5. Upload progress is a text counter; make it a bar, and stop blocking

**Files:** `PreviewScreen.tsx:373`, `CapsuleDetailScreen.tsx:1713`

Both upload sites render "Uploading 3/7…" as text. The `done/total` state
already exists — drawing a determinate progress bar from it is a 20-minute
change, and determinate progress reads dramatically faster than text (users
judge waits by visible motion). Two deeper layers, in order of ambition:

1. **Bar now:** thin accent-colored fill under the counter. Trivial.
2. **Per-item states:** in PreviewScreen's multi-item carousel, badge each
   page-dot/thumbnail with pending/done/failed. Right now a mid-batch failure
   is indistinguishable from success unless the count stalls — decide and
   *show* what happens to item 5 of 7 when it fails (skip + report, or retry).
3. **Stop blocking (eventually):** the user stares at the spinner for the whole
   `capsules × media` loop. The toast system already survives navigation — let
   uploads continue while the user browses, and toast on completion. This is
   the single biggest *perceived* speed win available (and pairs with
   PERFORMANCE.md #1/#3, which make the actual uploads smaller and non-repeated).

---

## 🟠 6. Auth inputs are missing table-stakes affordances

**Files:** `LoginScreen.tsx:90`, `SignUpScreen.tsx:75`

- **No password visibility toggle** — `secureTextEntry` with no eye icon on
  either screen. On mobile, typo-blind password entry is a real login-failure
  driver.
- **No autofill hints** — add `textContentType="username"` /
  `textContentType="password"` (login) and `textContentType="newPassword"`
  (sign-up) plus matching `autoComplete` props. This lights up iOS keychain /
  Google password-manager integration and the iOS strong-password suggestion —
  effectively free sign-up friction removal, and it makes the *next* login
  one tap.
- While there: `returnKeyType="next"`/`"go"` with field-to-field focus chaining
  so the keyboard's action button drives the form.

An hour of props, and the auth screens go from "hand-rolled" to "native-grade."

---

## 🟠 7. Pull-to-refresh is on every list screen except Profile

**File:** `ProfileScreen.tsx` (no `RefreshControl`)

Home, Notifications, CapsuleDetail, GroupDetail, and Friends all have it —
Profile is the odd one out, and it displays exactly the kind of derived data
(stats, friend count) that goes stale from actions taken elsewhere. Users who
learn the gesture on four screens will try it on the fifth. Consistency is the
feature; add it even though the cache usually makes it unnecessary.

---

## 🟠 8. Notifications: no "mark all read"

**File:** `NotificationsScreen.tsx`

Rows are dismissed one at a time. After an unlock day (reaction spam + award
results + unlock alerts all land at once), clearing the tab is a tap-per-row
chore, and the unread badge nags until it's done. A small "Mark all read"
text button in the header, shown only when unread count > 1, matches the
existing soft-delete model (`read_at`) with a single `.update()`.

(The badge's 60s staleness is BUGS.md #10 — fixing both makes the Alerts tab
feel instant.)

---

## 🟡 9. Small polish, batched

- **Friends empty state is a dead end** — "Add friends from their profile"
  names a place with no path from this screen. Add a "Find people" button
  (reuse the InviteModal search UI) or at least deep-link to a capsule's
  member list. An empty state should always contain its own exit.
- **Camera hint could earn its retirement** — the persistent "Tap for photo ·
  Hold for video" line is great for run one, chrome by run fifty. Fade it out
  permanently after ~3 successful captures (one AsyncStorage counter), the way
  the hands-free-lock hint already only appears contextually.
- **`InviteModal.handleSaveQR` success message routes through `setError`**
  (`CapsuleDetailScreen.tsx:297` — "QR code saved to camera roll ✓" rendered
  in the error slot). You have a toast system now; use it, and reserve the
  error style for errors.
- **Group-create banner is good** ("All group members will be added
  automatically") — same pattern would help the surprise toggle: one line of
  consequence-copy ("You won't see photos either until it unlocks") under the
  switch, since it's the single most surprising default in the app.
- **DatePicker still calls `expo-haptics` directly** (noted in CLAUDE.md) —
  migrate to the `haptics` wrapper so web never has to think about it.

---

## ✂️ 10. The move/remove list, consolidated

| Item | Verdict | Where it goes |
|---|---|---|
| Onboarding step 2 (color) | Remove from wizard | Settings (already exists) |
| Onboarding step 3 (bio) | Remove from wizard | Edit Profile (already exists); slot becomes the notification primer |
| Occasion chips on Create | Demote | Inside "More options" |
| DefaultAwardsCard preview on Create | Remove | CapsuleDetail's existing `mode="manage"` card |
| Contribution lock, voting window, unlock mode, description | Demote | Collapsed "More options" |
| Launch-time `requestPermissionsAsync` | Remove | Contextual primer post-first-capsule (#1) |
| Persistent camera hint | Expire | Hide after 3 successful captures |
| "Saved ✓" messages in error slots | Replace | `toast.show()` |

---

## Suggested order of attack

1. **#1 notification priming** — before any beta wave; you only get one prompt per user.
2. **#3 Create-form split + #2 onboarding cut** — both are subtraction, not construction; fastest wins in the doc.
3. **#4 sealed moment** — small build, outsized emotional + growth payoff (carries the invite prompt).
4. **#6 auth affordances + #5 progress bar** — an afternoon combined.
5. **#7, #8, #9** — batch into a polish day before TestFlight wave two.
