# New-User Coach-Mark Tour — Design Spec

**Date:** 2026-07-22
**Status:** Approved (design), pending spec review
**Scope:** A guided, multi-screen coach-mark ("spotlight") tour that runs once for a genuinely new user right after they finish the existing onboarding wizard, teaching the real app UI by highlighting actual elements.

## Goal

New users land on Home after the 5-step `OnboardingScreen` wizard with no idea what the tabs, a capsule, or the join flow do. Give them a **skippable, one-time walkthrough** that spotlights real UI elements (dim the screen except a hole around the target + a tooltip + Back/Next/Skip), drives navigation across screens, and adapts to whether they created a capsule.

**Explicit product decision:** joining an existing capsule is a **first-class path**, not an afterthought. A user may have signed up only to join a friend's capsule right now. The tour must surface the **Scan-QR / invite-link join** path prominently and must **not pressure** them to create a capsule — it *explains how* to create one, framed as optional.

## Non-goals (YAGNI)
- No welcome-slides carousel, no per-screen scattered tooltips (rejected during brainstorming — coach-marks chosen).
- No server-side "tour seen" column; no change to the `users` table.
- No "replay tour" entry point in v1 (can be added later if wanted).
- No new native modules, no new third-party dependency (custom engine, per approach decision).
- No change to *what* the onboarding wizard does (only a one-line flag write on completion).

---

## Architecture

A small custom coach-mark engine, mounted once near the app root. Four new modules + targeted edits to five existing files.

### New files
- **`src/context/TourContext.tsx`** — `TourProvider`, `useTour()`, `useTourTarget(id)`.
  - **Target registry:** a `Map<string, () => Promise<Rect | null>>` of measure functions, mutated via `registerTarget(id, fn)` / `unregisterTarget(id)`.
  - **Tour state:** `{ active: boolean; stepIndex: number; steps: TourStep[]; currentRect: Rect | null }`.
  - **Controller:** `startTour(steps)`, `next()`, `back()`, `skip()`, `finish()`.
  - Renders `<TourOverlay>` as its final child (so it paints above the navigator) only when `active`.
  - `Rect = { x: number; y: number; width: number; height: number }`.
- **`src/components/TourOverlay.tsx`** — the visual layer. Given `currentRect`, renders **four dim panels** (`rgba(0,0,0,0.72)`) framing the rect — top/bottom span full width, left/right fill the gap at the rect's vertical band — leaving a transparent "spotlight" hole (no SVG mask; identical on web + native). When `currentRect` is null (finish card / unmeasurable), it dims the whole screen. Renders a **tooltip card** (surface `#1A1A1A`, radius 16) auto-placed **below** the rect if the rect is in the top ~60% of the screen, else **above** it; the finish card is centered. Card contains: title, body (`#888888`), a progress row (dots, current = `accentColor`), and buttons: **Skip** (text, left), **Back** (only when `stepIndex > 0`), **Next** / **Done** (accent-filled, right). Dim-panel taps are swallowed (no accidental dismiss). `accessibilityViewIsModal`; every control has `accessibilityRole="button"` + label.
- **`src/lib/tourSteps.ts`** — `TourStep` type + `buildTourSteps(ctx: { hasCapsule: boolean; capsuleId: string | null }): TourStep[]`, plus all copy. Pure (no React/RN imports beyond the type), unit-testable.
- **`src/lib/tourStorage.ts`** — the two one-time flags with the same AsyncStorage idiom as `cap_camera_coach_seen`: `TOUR_SEEN_KEY = 'cap_tour_seen'`, `TOUR_PENDING_KEY = 'cap_tour_pending'`; helpers `markTourSeen()`, `tourSeen()`, `setTourPending()`, `consumeTourPending()` (reads then deletes), all best-effort (swallow errors).

### `TourStep` shape
```ts
type TourScreen = 'Home' | 'CapsuleDetail';
type TourStep = {
  id: string;                 // stable step id (for keys/telemetry)
  targetId: string | null;    // registry id to spotlight; null = centered card (finish)
  screen: TourScreen;         // screen this step lives on
  params?: Record<string, unknown>; // nav params (e.g. { capsuleId } for CapsuleDetail)
  title: string;
  body: string;
};
```

### Registration API
- **`useTourTarget(id: string)`** returns a **stable callback ref** to drop on any element: `ref={useTourTarget('capsule-card')}`. On mount it registers `() => measureInWindow(node)`; on unmount it unregisters. (`measureInWindow` resolves `{x,y,width,height}`; resolves `null` if the node is gone or measures to zero size / fully off-screen.)
- For the mapped tab bar, `useTour()` exposes raw `registerTarget`/`unregisterTarget`; `CustomTabBar` builds a per-tab callback ref inline (`ref={makeTabRef('tab:Camera')}`) — callback refs are loop-safe, hooks are not.

### Controller flow (per step) — `goToStep(i)`
1. If `steps[i].screen` ≠ the current route, `navigationRef.navigate(screen, params)`.
2. **`waitForTarget(targetId, { timeout: 2500, interval: 150 })`** — polls the registry, calling the measure fn each tick; resolves the first valid on-screen `Rect`, or `null` on timeout. (A `null` `targetId` — the finish card — skips measuring and uses `currentRect = null`.)
3. If `waitForTarget` returns `null` (screen didn't mount / element absent / off-screen) → **skip this step**: `goToStep(i+1)`. If no steps remain, `finish()`. A guard caps consecutive auto-skips so it can never loop forever — it just ends the tour.
4. Otherwise set `currentRect` + `stepIndex = i` and render the overlay.

Navigation is **tour-driven**: `next()`/`back()` call `goToStep`, which performs the `navigate`/`goBack` itself. The tour never requires the user to tap the real element, which is what makes the multi-screen walkthrough robust. On the last content step of Branch A (preset-awards, on `CapsuleDetail`), advancing to the first Home tab-stop triggers `navigate('Home')` (equivalent to popping back to Tabs) before measuring.

### Mount point
`<TourProvider>` wraps the navigator **inside `ThemeProvider`** (it needs `accentColor`) in `App.tsx`. The overlay is a plain absolutely-positioned full-screen `View` at high elevation — **not** a React Native `<Modal>` — which is correct because every tour target lives on a plain screen (Home / CapsuleDetail), never over a native modal. `navigationRef` (the existing module singleton) drives cross-screen navigation.

---

## Step lists + copy

Copy is warm and concrete; tunable. The tour picks a branch from whether the user has any capsule (Home already knows this).

### Branch A — a capsule exists (common case)
The onboarding wizard just created a **locked, surprise-mode** capsule, so in-capsule stops target only what a fresh *locked* capsule actually renders (the post-unlock `AwardsSection` does **not** exist yet — its preset precursor, the owner+locked `DefaultAwardsCard`, does).

| # | screen | targetId | title | body |
|---|---|---|---|---|
| 1 | Home | `capsule-card` | Your first capsule | It's sealed until its unlock date. Let's look inside. |
| 2 | CapsuleDetail | `capsule-countdown` | Everyone unlocks together | The photos reveal for everyone the moment this countdown hits zero. |
| 3 | CapsuleDetail | `capsule-add-media` | Add your photos | Drop in photos and videos here — they stay hidden until it unlocks. |
| 4 | CapsuleDetail | `capsule-invite` | Better with people | Invite your crew. They add their photos too, and everyone reveals together. |
| 5 | CapsuleDetail | `capsule-awards` | Fun awards | After it unlocks, everyone votes on these. Tweak them now if you like. |
| 6 | Home | `home-scan` | Joining a friend's capsule | Got an invite? Scan their QR code or open their link to jump into a capsule too — no setup needed. |
| 7 | Home | `tab:Camera` | Capture anytime | Tap the camera to shoot straight into a capsule. |
| 8 | Home | `tab:Notifications` | Your alerts | Invites and unlock alerts land here. |
| 9 | Home | `tab:Profile` | You | Profile, friends, and settings live here. |
| 10 | Home | `null` | You're all set 🎉 | That's the tour. Go make some memories. |

Step 5's target exists only for an owner on a locked capsule (it always does for a just-created one); if for any reason it's absent, step 5 auto-skips per the controller rule. After step 5, advancing navigates back to Home for the tab/scan stops (the bottom tab bar isn't rendered on the pushed `CapsuleDetail` screen).

### Branch B — no capsule (they skipped creation)
Leads with joining (first-class), explains creating as optional.

| # | screen | targetId | title | body |
|---|---|---|---|---|
| 1 | Home | `home-scan` | Joining is the fastest start | Got an invite? Scan a friend's QR code or open their link to jump straight into their capsule. |
| 2 | Home | `tab:Create` | Or start your own | Whenever you're ready, tap Create to make your own time-locked capsule. |
| 3 | Home | `tab:Camera` | Capture anytime | Tap the camera to shoot a photo or video — it flows into a capsule. |
| 4 | Home | `tab:Notifications` | Your alerts | Invites and unlock alerts land here. |
| 5 | Home | `tab:Profile` | You | Profile, friends, and settings live here. |
| 6 | Home | `null` | You're all set 🎉 | That's the tour. Join a capsule or start your own whenever you like. |

Target ids for tab buttons use the route names (`tab:Create`, `tab:Camera`, `tab:Notifications`, `tab:Profile`). `home-scan` is the existing Home-header QR button (`HomeScreen.tsx` `scanBtn`, `navigate('QRScanner')`). `capsule-card` is the first `CapsuleCard`.

---

## Trigger & persistence

- **`OnboardingScreen.saveProfile()`** — the wizard's true completion point (stamps `onboarded_at` + `markOnboarded`, runs on every real exit path) — additionally calls `setTourPending()`. One line; changes nothing else about onboarding.
- **`HomeScreen`**, on focus (once its capsule list has loaded): if `consumeTourPending()` returns true **and** `!(await tourSeen())`, build the branch from `capsules.length > 0` (using the newest capsule's id for `CapsuleDetail`) and `startTour(...)`. `consumeTourPending()` deletes the flag as it reads, so the tour can't retrigger; `markTourSeen()` runs on **finish or skip**.
- **Net behavior:** only a genuinely-new user who just completed onboarding sees it; pre-existing users never do; an abandoned tour (app killed mid-way) neither resumes nor re-nags (pending already consumed, seen never set → no retrigger). Per-install, mirroring the camera coach. No server write.

---

## Edge cases & error handling
- **Unmeasurable target** (screen slow to mount, element absent, off-screen) → step auto-skips; a consecutive-skip guard ends the tour rather than looping. A brand-new capsule is short, so its stops fit without scrolling.
- **User can't wander:** dim panels swallow touches; only Back/Next/Skip act. The tour drives its own navigation.
- **Web:** `measureInWindow`, `navigationRef`, and the four-panel dim all work on React Native Web — the tour runs on web too.
- **Accessibility:** overlay is `accessibilityViewIsModal`; all controls labeled; tooltip text uses AA-contrast tokens (`#888888`+).
- **Theme:** overlay reads `accentColor`; no hardcoded `#FF6B35`.

## Testing
- `src/lib/tourSteps.test.ts` (`npx tsx`): asserts `buildTourSteps` returns the has-capsule branch (with the capsule id threaded into `CapsuleDetail` steps) vs the no-capsule branch, correct lengths, and that a `null`-target finish step is last in both.
- A small pure `waitForTarget`-style polling helper (extracted so it takes an injected registry getter + clock) gets a `tsx` test for the resolve-on-hit and resolve-null-on-timeout paths.
- Overlay/registry/provider wiring verified by `npx tsc --noEmit` (no NEW errors in touched files) + read. Honest posture: no RN component test harness exists in this repo.

## Files
**New:** `src/context/TourContext.tsx`, `src/components/TourOverlay.tsx`, `src/lib/tourSteps.ts`, `src/lib/tourStorage.ts`, `src/lib/tourSteps.test.ts` (+ the polling-helper test).
**Edited:** `App.tsx` (mount `TourProvider` inside `ThemeProvider`), `src/navigation/AppNavigator.tsx` (`CustomTabBar` tab target refs), `src/screens/app/HomeScreen.tsx` (`capsule-card` + `home-scan` refs, trigger effect), `src/screens/app/CapsuleDetailScreen.tsx` (`capsule-countdown`/`-add-media`/`-invite`/`-awards` refs), `src/screens/app/OnboardingScreen.tsx` (`setTourPending()` in `saveProfile`). **CLAUDE.md** updated at the end.

## Global constraints (bind implementation)
- Dark-theme tokens; accent via `useTheme().accentColor` (never hardcode `#FF6B35`). Muted `#555555` decoration-only.
- Icon-only touchables need `accessibilityRole="button"` + `accessibilityLabel`.
- Platform: must work on web + native (no native-only APIs without a `Platform` guard; `measureInWindow` is cross-platform).
- Match existing one-time-flag idiom (`cap_*` AsyncStorage keys, best-effort).
- No new dependencies. No `users`/DB change.
- CLAUDE.md updated in the same body of work (project convention).
