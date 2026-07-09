# Capsule — Bug & Issue Audit

Findings from a full read-through of the codebase (client, Supabase migrations, edge
functions) cross-checked against the **live** database RLS/policies via MCP. Nothing
here has been fixed — this is a triage list, ordered by severity.

Legend: 🔴 High (data loss / broken flow) · 🟠 Medium (wrong behavior) · 🟡 Low (polish / edge case)

---

## 🔴 1. Deleting a locked "surprise-mode" capsule orphans all its media in storage

**Files:** `src/screens/app/CapsuleDetailScreen.tsx` (`confirmDelete`, ~line 1116) and
`src/screens/app/EditCapsuleScreen.tsx` (`confirmDelete`, ~line 129)

Both delete flows fetch the media rows *client-side* to collect storage keys before
removing files:

```ts
const { data: mediaRows } = await supabase
  .from('media').select('storage_key, thumbnail_key').eq('capsule_id', capsuleId);
// ...remove keys from storage, then delete the capsule row
```

But the live `media` SELECT policy is:

```
status = 'unlocked'  OR  (role in ('owner','contributor') AND NOT owner_preview_locked)
```

New capsules default to `owner_preview_locked = true` (surprise mode). While such a
capsule is still locked, **even the owner cannot read its `media` rows.** So
`mediaRows` comes back empty, no storage keys are collected, and
`supabase.storage.from('capsule-media').remove([])` removes nothing. The `capsules`
row delete then cascades the DB rows — but the actual photo/video **files stay in the
bucket forever**, unreferenced and unrecoverable.

Because surprise mode is the default, this affects the *typical* case of deleting a
capsule before it unlocks. Fix: do storage cleanup server-side in a SECURITY DEFINER
RPC (or an edge function) that can see the rows, rather than relying on a client SELECT
that RLS deliberately blocks.

---

## 🟠 2. Manage-mode "default awards" always uses the *general* pool, ignoring the capsule's occasion

**File:** `src/screens/app/CapsuleDetailScreen.tsx` — `load()` select (~line 1251) and
`<DefaultAwardsCard mode="manage" occasion={capsule.occasion} />` (~line 1581)

The capsule fetch selects:

```
id, owner_id, title, description, status, unlock_at, unlock_mode,
owner_preview_locked, contribution_lock_at, created_at, archived_at,
superlative_voting_closes_at, superlative_voting_finalized_at
```

`occasion` is **not** in the list. `capsule.occasion` is therefore `undefined` at
runtime (the TS `Capsule` type declares it, so the compiler doesn't catch it). When the
owner uses "Shuffle all" / swap in the pre-unlock DefaultAwardsCard, `pickDefaults`/
`pickReplacement` fall back to `AWARD_POOL[occasion] ?? AWARD_POOL.general`, so a wedding
or vacation capsule silently reshuffles from the **generic** award pool instead of its
themed one. Fix: add `occasion` to the select.

---

## 🟠 3. QR-scan "Accept Invite" and deep-link join leave the user as a *pending* invite

**Files:** `src/screens/app/QRScannerScreen.tsx` (`joinCapsule`, ~line 84),
`src/hooks/useDeepLinks.ts` (~line 50)

Both insert the membership row **without `joined_at`**, i.e. as a pending invite:

```ts
await supabase.from('capsule_members').insert({
  capsule_id, user_id, role: 'contributor',   // joined_at omitted → NULL → pending
});
```

In the QR flow the button literally says **"Accept Invite"**, and afterward the user is
navigated to the Notifications tab where the `notify_on_invite` trigger's freshly-created
invite card asks them to **Accept again** (that second Accept is what sets `joined_at`).
So a scan-to-join requires two "accepts" and the user isn't actually a joined member
after the first. Same double-step for `capsule://join/<id>` deep links. If the intent of
a scan/deep-link is to *join*, set `joined_at: now()` on insert.

---

## 🟠 4. Client-side `notifications` INSERTs silently fail (no INSERT policy)

**Files:** `src/hooks/useDeepLinks.ts` (~line 55), `src/screens/app/QRScannerScreen.tsx` (~line 97)

Both do `supabase.from('notifications').insert({ ... type: 'invite' })` directly from the
client. Verified against the live DB: `notifications` has RLS **enabled** with only
SELECT and UPDATE policies — **there is no INSERT policy**, so these inserts are rejected.
The error is never checked, so it fails silently.

It happens to be masked because the `notify_on_invite` trigger (SECURITY DEFINER) already
creates the invite notification when the `capsule_members` row is inserted — so the user
still gets exactly one notification. But these two client inserts are dead code that
always errors; if the trigger behavior ever changes they'll produce a "notification never
appears" bug that's hard to trace. Remove them (rely on the trigger) or add a scoped
INSERT policy.

---

## 🟡 5. Proximity/`both` capsules show a bogus countdown on Home and the detail hero

**Files:** `src/screens/app/HomeScreen.tsx` (`CountdownBadge`), `CapsuleDetailScreen` hero

`unlock_at` is `NOT NULL`, so proximity capsules get a placeholder date that is never used
for unlocking. But `HomeScreen`'s card query only selects `unlock_at`/`status` (not
`unlock_mode`), so every locked card renders "Xd Yh left" / "Unlocks <date>" even for
`proximity` capsules that actually unlock by physical check-in. The badge counts down to a
meaningless date. (CapsuleDetail handles this correctly — it hides the ring for
`proximity` — but the Home list can't, because it never fetches `unlock_mode`.) Fetch
`unlock_mode` and show "Unlocks when you're together" instead of a countdown.

---

## 🟡 6. Leftover debug diagnostic leaks JWT `sub` into avatar-upload error strings

**File:** `src/screens/app/ProfileScreen.tsx` — `uploadAvatar` (~lines 88–112)

A "TEMP diagnostic" block decodes the access token (`atob(accessToken.split('.')[1]…)`)
and, on a non-2xx upload, throws an error string containing the token's `sub`, the path
uid, a `match=` boolean, and `expiresIn=…`. This is shown to the user via
`setError('Avatar upload failed: …')`. It's leftover debugging that surfaces auth-token
internals in the UI and should be removed before release.

---

## 🟡 7. Camera front-facing photos may not be horizontally flipped (mismatch with documented behavior)

**File:** `src/screens/app/CameraScreen.tsx` — `processPhoto` / `takePhoto`

CLAUDE.md states "Front camera photos: flipped horizontally via `FlipType.Horizontal`",
but `processPhoto` only resizes:

```ts
ImageManipulator.manipulateAsync(uri, [{ resize: { width: 1920 } }], { compress: 0.82 });
```

There is no `FlipType.Horizontal` step anywhere. The code now relies solely on the
`CameraView mirror={facing === 'front'}` prop to handle mirroring of the *saved* file.
Whether that prop actually mirrors the captured JPEG (vs. only the live preview) is
version-dependent in expo-camera, so front selfies may come out un-mirrored relative to
what the user saw. Worth verifying on-device; at minimum the docs and code disagree.

---

## 🟡 8. Hold-to-record race if the finger lifts during the mic-permission prompt

**File:** `src/screens/app/CameraScreen.tsx` — `onPressIn`/`startRecording`/`onPressOut`

`onPressIn` sets a 300ms hold timer that calls `startRecording`, which `await`s
`requestMicPermission()`. If the user releases during that await, `onPressOut` runs with
`holdStarted.current === true` and calls `stopRecording()` — but `recordAsync` hasn't
started yet. `startRecording` then proceeds, sets `isRecordingRef = true`, and enters the
segment loop with no user gesture left to stop it (only the 30s max-duration timer will).
Edge case, but it can strand the UI in a "recording" state. Guard `startRecording` on a
still-pressed flag before entering the loop.

---

## 🟡 9. Manual vs. automatic group-capsule creation disagree on membership state

**Files:** `src/screens/app/CreateScreen.tsx` (~line 206), `supabase/functions/create-group-capsules/index.ts` (~line 76)

When a capsule is created for a group **manually** (CreateScreen), other group members are
inserted with `joined_at: null` (pending invites). When the **cron** creates the recurring
group capsule, it inserts them with `joined_at: now()` (auto-joined). So the same group
gets two different membership semantics depending on who/what created the capsule, and the
cron path additionally writes an `invite` notification for members who are *already*
joined (renders as an "invited … Joined" card). Pick one model and make both paths match.

---

## 🟡 10. Notifications tab badge can be stale for up to 60s

**File:** `src/navigation/AppNavigator.tsx` — `CustomTabBar`

The unread badge count is fetched at most once per 60s (`lastBadgeFetch` guard) and only
re-evaluates on tab-index change. After the user reads/dismisses notifications, the red
badge can linger for up to a minute, and newly-arrived notifications won't bump it until
the throttle window elapses or the user switches tabs. Consider invalidating the count on
the same `cache.invalidate('notifications')` events the screen already fires.

---

## 🟡 11. `AwardsSection` doesn't self-advance from "voting open" to "Tallying…" when the window closes

**File:** `src/components/AwardsSection.tsx`

`isClosed` is computed once per render from `Date.now()` vs `votingClosesAt`, and nothing
schedules a re-render at the close time. If a user is sitting on the capsule when the
voting window elapses, the UI keeps showing the open-voting cards until some other event
(realtime message, refocus, manual refresh) triggers a re-render. A one-shot timer to the
`votingClosesAt` boundary would make the transition live.

---

## 🟡 12. Minor: array index used as React key for member lists

**File:** `src/screens/app/CapsuleDetailScreen.tsx` — member avatar cluster (`key={i}`,
~line 1611) and the members bottom sheet (`key={i}`, ~line 1862)

Members are keyed by array index rather than `user_id`. Harmless today, but it can cause
avatar/label mismatches or animation glitches if the members list is reordered or a member
is removed while the sheet is open. Use `m.user_id`.

---

## Notes / verified-OK

- **`capsule-media` and `capsule_members` RLS** on the live DB match what CLAUDE.md
  describes (storage INSERT policy re-checks membership/role/lock; `capsule_members`
  policies go through security-definer helpers). No recursion or open-bucket issues found.
- **`notifications_type_check`** on the live DB *does* include `unlock_reminder`,
  `friend_request`, and `friend_accept` (the finalize migration's constraint listed fewer,
  but later migrations extended it — the live constraint is complete).
- The `unlock-capsules` in-memory `lastCallTime` rate-limit is dead on edge cold-starts,
  but the work is idempotent (`.eq('status','active')`), so it's harmless (already noted in
  CLAUDE.md).
- Reaction/vote/upvote inserts correctly avoid chaining `.select()` per the documented RLS
  constraints.
