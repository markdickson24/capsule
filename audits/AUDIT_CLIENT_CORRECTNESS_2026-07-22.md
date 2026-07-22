# Client Correctness Audit — 2026-07-22

Scope: React/RN correctness across `src/screens/app/*`, `src/hooks/*`,
`src/context/*`, `src/components/*`. Read-only review — Rules of Hooks,
`useEffect` deps/cleanup, realtime channel lifecycle, memory leaks,
setState-after-unmount, race conditions, and swallowed errors on
user-initiated mutations.

Method: read CLAUDE.md's documented patterns (animation `hasAnimatedRef`
guard, members-sheet gesture, realtime channel-per-mount naming, the
optimistic-action + toast-on-failure convention, `useLoadingTimeout`
wiring), then grepped every `setInterval`/`setTimeout`/`.channel(`/`.subscribe(`/
`catch {}` site across the four directories and read the surrounding code.

## Summary

| Severity | Count |
|---|---|
| High | 0 |
| Medium | 2 |
| Low | 2 |
| Sound areas noted | 1 section |

No Rules-of-Hooks violations, no unremoved realtime channels, and no
uncontrolled setState-after-unmount crashes were found. The codebase is
unusually disciplined about this class of bug (documented `cancelled` guards,
`callId`-guarded async races in `useCachedFetch`, channel names suffixed with
`randomUUID()` per mount). Findings below are the real gaps that remain.

---

### CC-1 — Medium — Memory leak — `usePushNotifications.native.ts:56-62`

**Location:** `src/hooks/usePushNotifications.native.ts`, inside the
`Notifications.getLastNotificationResponseAsync().then(...)` handler in the
tap-routing `useEffect` (deps `[]`).

**Description:** When the app is cold-launched from a tapped push
notification and `navigationRef.isReady()` is still `false`, the code starts
an unbounded `setInterval(..., 100)` that polls until the ref becomes ready,
then calls `clearInterval`. This interval is **not** stored in a ref and is
**not** cleared by the effect's own cleanup function (`return () =>
sub.remove()` only removes the notification-response listener). If
`navigationRef` never becomes ready — e.g. a `NavigationContainer` mount
failure, or (in dev) a Fast Refresh that remounts this top-level hook while
the old interval is still polling — the interval runs forever with no way to
stop it, each tick re-checking `navigationRef.isReady()` and closing over the
original `data` payload.

**Impact:** Low likelihood in production (this hook is mounted once at the
app root and `navigationRef` normally becomes ready within a frame or two),
but it's a genuine unbounded-leak code path with no cap and no cleanup
registration — the one timer in the codebase that doesn't follow the
ref-cleanup pattern used everywhere else (`CameraScreen`, `ColorPicker`,
`ToastHost`, etc. all clear their timers in `useEffect` cleanups).

**Suggested fix:** Store the interval id in a variable captured by the
effect's cleanup, and/or cap the number of polls (mirrors
`navigateUntilRouteActive`'s `attempts` parameter in `useDeepLinks.ts`, which
already solves this exact problem correctly).

**Confidence:** Medium (real gap by inspection; low real-world trigger rate).

---

### CC-2 — Medium — Race / missing focus-based cleanup — `CameraScreen.tsx`

**Location:** `src/screens/app/CameraScreen.tsx` — `isFocused` (from
`useIsFocused()`) only gates two things: clearing `targetCapsuleId` on blur
(lines 81-86) and which native view renders (lines 686, 697: `CameraView` /
`DualCameraView` conditionally render on `isFocused`). There is no effect
that stops an in-progress recording when the screen loses focus.

**Description:** `Camera` is a bottom-tab screen; React Navigation's default
tab navigator does not unmount screens on tab switch (confirmed —
`AppNavigator.tsx`'s `Tab.Screen` entries have no `unmountOnBlur`), so
`CameraScreen` itself stays mounted when the user switches tabs. If the user
is mid-recording (`isRecordingRef.current === true`, the `startRecording`
segment loop at line ~378 `while (isRecordingRef.current) { ... await
cameraRef.current!.recordAsync(...) ... }` is still running) and swipes to
another tab, `isFocused` flips false and the conditional at line 686 unmounts
the native `CameraView`. The async loop is still awaiting/about to call
`cameraRef.current!.recordAsync(...)` on a ref that native-unmount will null
out. The next loop iteration's `cameraRef.current!.recordAsync(...)` throws
(caught by the surrounding `try { } catch { break; }`, so no hard JS crash),
but:
- The user gets no feedback that navigating away interrupted their recording.
- `isRecording`/timer state (`recordInterval`, `maxDurationTimer`,
  `shutterAnim`) is only cleaned up once the loop exits and
  `cleanupRecording()` runs at the end of `startRecording()` — there's a
  window where React state (`isRecording: true`) and the actually-torn-down
  native camera disagree, and returning to the Camera tab could show a
  stale "recording" shutter state until the async function finally resolves.
- Dual-camera recording (`startDualRecording`, ~line 455) has the same gap:
  `dualRef.current` is nulled on unmount but nothing calls
  `stopDualRecording()`/`cleanupRecording()` on blur.

**Impact:** Not a hard crash (the `try/catch` in the segment loop absorbs the
null-ref throw), but a real UX/correctness gap: a recording started, then
abandoned by switching tabs, is not explicitly stopped, its segments may be
silently lost or an unexpected multi-item Preview navigation could fire after
the user has already navigated to a different tab (goToPreview calls
`navigation.navigate('Preview', …)` from inside the async loop with no guard
against the screen no longer being the active one).

**Suggested fix:** Add a `useEffect` on `isFocused` that calls
`cleanupRecording()` (and stops any active `recordAsync`/`dualRef` recording)
when focus is lost while `isRecordingRef.current` is true, mirroring the
existing `targetCapsuleId`-clearing blur effect right above it.

**Confidence:** Medium (verified structurally against the tab-navigator
config and the recording loop's ref usage; not exercised on-device).

---

### CC-3 — Low — Debounced search timers never cancelled on unmount

**Locations (four instances, same pattern):**
- `src/screens/app/CapsuleDetailScreen.tsx` — `InviteModal`'s `onSearch`
  (~lines 245, 258-276)
- `src/screens/app/FriendsScreen.tsx` — `FindPeopleModal`'s
  `handleSearchChange` (~lines 211, 214-229)
- `src/screens/app/CreateGroupScreen.tsx` — `handleSearchChange` (~lines 113,
  118-142)
- `src/screens/app/ManageGroupScreen.tsx` — `handleSearchChange` (~lines 90,
  229-245)

**Description:** Each stores its debounce timer in a `useRef` and clears it
on the *next keystroke* (`if (debounce.current) clearTimeout(...)`), but none
register a `useEffect(() => () => clearTimeout(debounce.current), [])`
cleanup for unmount. If the user types 2+ characters and then immediately
closes the modal / navigates away before the 300ms debounce fires, the
`setTimeout` callback still runs after unmount and calls
`setResults`/`setSearchResults` on a component that's gone — a dev-mode React
warning today, and (for `InviteModal`/`FindPeopleModal`, which are `Modal`
components that unmount on close rather than just hide) a real no-op-but-
wasted network call plus a discarded state update every time.

**Impact:** No crash, no data corruption — purely a lingering warning +
wasted request. Grouped as one finding since it's a single repeated
copy-paste pattern across four sites, not four independent bugs.

**Suggested fix:** Add `useEffect(() => () => { if (debounce.current)
clearTimeout(debounce.current); }, [])` in each of the four components (or
factor the debounce into a small shared hook that does this once).

**Confidence:** High (confirmed absent in all four call sites by direct
inspection).

---

### CC-4 — Low — `MediaViewerModal` reactions effect has a stale-closure gap

**Location:** `src/screens/app/CapsuleDetailScreen.tsx`,
`MediaViewerModal`, `useEffect(() => { loadReactions(); }, [])` (~line 630).

**Description:** `loadReactions()` fetches reactions for `items.map(i =>
i.id)`, but the effect's dependency array is `[]`, so it only runs once at
mount and closes over the `items` prop as it was at that moment. The
component already has documented, careful handling for `items` being
replaced out from under it while open (the long comment above the
`currentItemId` resync effect at ~line 748 explains this happens routinely —
e.g. a background upload completing while the viewer is open causes
`fetchPhotos()` to replace the parent's `photos` array). If a new photo is
appended to `items` while the viewer is open and the user swipes to it, its
reactions were never fetched (the `reactions` state has no rows for that
`media_id`), so it silently renders as "no reactions" until the modal is
closed and reopened — even if reactions genuinely exist by the time it's
viewed.

**Impact:** Stale/incomplete UI, not a crash — reaction counts under-render
for a newly-surfaced item during an already-open viewing session, self-heals
on reopen.

**Suggested fix:** Add `items` (or a stable `items.map(i => i.id).join(',')`)
to the effect's deps, or refetch reactions inside the same "items changed"
effect that already resyncs `currentItemId` at ~line 754.

**Confidence:** Medium (real gap by inspection; only observable in the
edit-window between a background upload landing and the viewer being closed).

---

## Sound areas worth noting

- **`useCachedFetch`** (`src/hooks/useCachedFetch.ts`) — the in-flight
  request dedup (module-level `Map`), the `callId`-guarded async race
  protection in `doFetch`, and the `force`-discards-stale-entry retry path
  are all correctly implemented and cross-checked against their documented
  intent in CLAUDE.md.
- **Realtime channels** — both `CapsuleDetailScreen` (`capsule-${id}-${uuid}`)
  and `AwardsSection` (`awards-${id}-${uuid}`) suffix the channel name with
  `randomUUID()` per mount (documented rationale: avoids the
  "cannot add postgres_changes callbacks after subscribe()" crash from
  supabase-js's channel-reuse-by-topic behavior) and both correctly
  `supabase.removeChannel(channel)` in their cleanup.
- **`useEntitlements`**, **`useShareIntent.native`**, **`useDeepLinks`**,
  **CameraScreen's `targetOwnerInfo` fetch** — all use a `cancelled`/`mounted`
  boolean guard correctly around async work that resolves after a possible
  unmount.
- **Rules of Hooks** — every screen with an `if (loading) return …` /
  `if (error) return …` early-return pattern (HomeScreen, CapsuleDetailScreen,
  ProfileScreen, PublicProfileScreen, FriendsScreen, GroupDetailScreen,
  NotificationsScreen, EditCapsuleScreen, ManageMembersScreen,
  BlockedUsersScreen) was checked and has all its hooks declared before the
  conditional return.
- **Optimistic-update rollback + toast-on-failure** — consistently applied
  (per CLAUDE.md's documented convention) across
  `NotificationsScreen`(accept/decline/friend actions), `HomeScreen`
  (archive/restore), `ManageMembersScreen`/`ManageGroupScreen` (remove
  member), `GroupDetailScreen` (delete/leave), `ThemeContext`
  (color/layout/gradient save). No silent-failure mutation sites were found
  in the reviewed files.
