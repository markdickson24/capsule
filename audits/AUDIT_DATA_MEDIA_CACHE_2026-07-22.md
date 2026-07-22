# Data Integrity / Media / Upload / Cache Audit — 2026-07-22

Scope: `src/lib/uploadQueue.ts`, `src/lib/cache.ts`, `src/hooks/useCachedFetch.ts`,
`src/lib/mediaUrl.ts`, `src/lib/avatarUrl.ts`, `src/types/database.ts`, and the
consuming screens (`CapsuleDetailScreen`, `HomeScreen`, `PreviewScreen`,
`ManageMembersScreen`, `EditCapsuleScreen`, `CreateScreen`, `CameraScreen`),
plus the relevant storage-cleanup migrations.

**Methodology note:** the repository's actual checked-out branch at audit time
was `chore/sentry-setup` (HEAD `813fc09`), not the `feat/capsule-link-preview`
branch named in this session's initial context (that context snapshot is
explicitly documented as stale). All findings below are against the code
actually on disk. DM-4 specifically concerns a discrepancy between CLAUDE.md
and this checked-out branch that may be a branch/merge-timing artifact rather
than a true shipped regression — flagged for verification against whatever
branch actually ships.

---

## DM-1 — Severity: High
**Category:** Storage cleanup / orphaned data
**Location:** `src/lib/uploadQueue.ts:132-215` (`copyOrUpload`, `runTask`), `:347-370` (`retry`, `dismiss`)

**Description:** When `runTask` succeeds at uploading a file (main photo/video,
dual `altUri`, and/or video thumbnail all go through `uploadFile`/`copyOrUpload`)
but the subsequent `media` table insert fails (line 205-215: `if (error) throw
new Error(error.message)`), the already-uploaded storage object(s) are never
cleaned up. The task is marked `status: 'failed'` and stays in the queue as a
retryable tile, but:
- `copyOrUpload`'s cache-hit path (line 138-144) **always** creates a **new**
  destination key via `storage.copy(cached.key, key)` — it never reuses
  `cached.key` directly, even when retrying the exact same task for the exact
  same capsule. So a `retry()` on this failed task uploads nothing new (cache
  hit) but still mints a fresh key and a fresh copy; the original key from the
  first (failed) attempt is left behind, referenced by nothing.
- `dismiss(taskId)` (line 357-370) only removes the task from the in-memory
  list — it never calls `storage.remove()` on anything. Dismissing a failed
  task after a successful upload-but-failed-insert permanently orphans the
  object with no further recovery path.
- There is no periodic/GC job anywhere in `supabase/functions` or
  `supabase/migrations` that sweeps `storage.objects` rows with no matching
  `media` row (verified via grep for "orphan"/"garbage"/"cleanup" — the only
  hits are the capsule/account delete-time cleanups, which only run at
  delete-time for capsules/accounts that still exist).

**Impact:** This is not a rare edge case — the server-side backstop triggers
CLAUDE.md documents as the authoritative gate (`enforce_photo_limit`,
`enforce_member_limit`-style triggers on `media`) are exactly the kind of
insert-time rejection that would trigger this: two members uploading
concurrently can both pass the client's `capsule_media_count` pre-check, then
lose the race at the DB trigger. Any transient RLS/network hiccup on the
`media.insert` call after a successful `FileSystem.uploadAsync`/storage
`.upload()` has the same effect. Each occurrence leaks one (or two–three, for
dual photos with a thumbnail) permanent, unreferenced object in the
`capsule-media` bucket — a real, unbounded storage-cost leak with no cleanup
path, the same class of bug BUGS.md #1 (documented in CLAUDE.md) fixed for
capsule deletion.

**Suggested fix:** On a `media.insert` failure inside `runTask`, delete the
just-uploaded key(s) (`storageKey`, `altStorageKey`, `thumbnailKey`) from
`storage.objects` before re-throwing — but only when this task did the real
upload for that generation (i.e., don't delete on a `copy()`-sourced key that
another task/capsule might still need). Simplest correct fix: track whether
this specific task was the *first* writer for each cache entry (own the
cleanup only for keys it uploaded itself, not copied), or alternatively make
`copyOrUpload`'s cache-hit path reuse `cached.key` directly for a retry of the
*same* capsule + sourceUri instead of always copying to a new key, and clean
up via a lightweight periodic orphan sweep (`storage.objects` anti-joined
against `media.storage_key`/`alt_storage_key`/`thumbnail_key`) as a backstop.

**Confidence:** High — confirmed by direct code reading; no compensating
cleanup exists anywhere in the codebase.

---

## DM-2 — Severity: Medium-High
**Category:** Optimistic updates / silent data loss
**Location:** `src/screens/app/CapsuleDetailScreen.tsx:715-738` (`saveCaption`, inside `MediaViewerModal`)

**Description:**
```ts
async function saveCaption() {
  const item = items[currentIndex];
  if (!item) return;
  const trimmed = captionDraft.trim() || null;
  await supabase.from('media').update({ caption: trimmed }).eq('id', item.id);
  onCaptionSave(item.id, trimmed);
  setEditingCaption(false);
  // ... patches the media:${capsuleId} cache unconditionally ...
```
The result of the `supabase.from('media').update(...)` call is discarded — no
`{ error }` destructured, no check. `onCaptionSave` (which sets `photos` state
in the parent, `CapsuleDetailScreen.tsx:2304`) and the `media:${capsuleId}`
cache patch both run **unconditionally**, regardless of whether the update
actually succeeded server-side.

**Impact:** If the update fails (RLS edge case, network blip, offline), the
UI shows the new caption as saved with zero indication of failure — violating
the codebase's own stated rule ("any user-initiated mutation that fails must
toast," `toast.ts` section of CLAUDE.md). Worse, the code comment directly
above this function explains the cache-patch exists specifically so a
subsequent `fetchPhotos()` within the 3-minute `MEDIA_CACHE_TTL` window
"doesn't silently revert the caption the user just saw save" — but that
reasoning assumes the update succeeded. If it didn't, the *opposite* happens:
the false-success state survives for up to 3 minutes (or until the cache key
is invalidated by another trigger), then silently reverts once a real fetch
finally reads the true (unchanged) server value, with the user having long
since moved on believing the edit was saved.

**Suggested fix:** Destructure `{ error }`, early-return with `toast.show(...)`
on failure (leave `editingCaption` open or restore the draft), and only call
`onCaptionSave`/patch the cache on success — mirroring the rollback pattern
already used correctly by `addReaction` three functions above it in the same
component.

**Confidence:** High.

---

## DM-3 — Severity: Low-Medium
**Category:** Optimistic updates
**Location:** `src/screens/app/CapsuleDetailScreen.tsx:667-670` (`removeReaction`)

**Description:**
```ts
async function removeReaction(reactionId: string) {
  setReactions(prev => prev.filter(r => r.id !== reactionId));
  await supabase.from('reactions').delete().eq('id', reactionId);
}
```
Optimistically removes the reaction from local state, then fires the delete
with no error check, no rollback, and no toast — inconsistent with
`addReaction` immediately above it (lines 644-665), which correctly rolls
back the optimistic insert on error.

**Impact:** A failed delete (network/RLS) leaves the UI showing the reaction
removed while it still exists server-side; the next `loadReactions()` call
(e.g. re-opening the viewer) brings it back, which reads as an unexplained
"my reaction un-deleted itself" glitch rather than a clear failure the user
could retry. Low severity since reactions are low-stakes and self-healing on
next load, but it's a real deviation from the documented pattern and from the
sibling function's own correct handling.

**Suggested fix:** Check `{ error }`; on failure, re-insert the removed
reaction into local state and `toast.show(...)`.

**Confidence:** High (code is unambiguous); severity judgment is Low-Medium
given reactions are non-critical and self-correct on reload.

---

## DM-4 — Severity: Medium (branch-state caveat — see note above)
**Category:** Upload / tier enforcement (media path)
**Location:** `src/screens/app/PreviewScreen.tsx` (whole file), `src/screens/app/CreateScreen.tsx:302-319`, `src/screens/app/CameraScreen.tsx:126-158`, absence of `src/lib/mediaDuration.ts`

**Description:** CLAUDE.md's "Monetization → Tier enforcement → Video length"
section describes, in detail, a shipped feature: the camera records up to a
flat 120s cap for everyone regardless of tier ("no free-tier hard-stop; a
moment is never cut off mid-capture"), `PendingMedia.durationMs` carries the
real clip length from camera/library/share-intent, and `PreviewScreen`'s "Add
to Capsule" step gates any over-cap video behind a limit sheet offering
Trim/Upgrade/Skip/Cancel, backed by `src/lib/mediaDuration.ts` and
`modules/expo-video-stitcher`'s `trimVideo()`.

None of this exists in the current working tree:
- `src/lib/mediaDuration.ts` does not exist on disk.
- `PendingMedia` (`src/types/navigation.ts:7-16`) has no `durationMs` field.
- `PreviewScreen.tsx`'s `upload()` function has a photo-count cap check (via
  `capsule_media_count`) but **no video-length check of any kind** — grepped
  for `trim`, `videoSeconds`, `durationMs`, `limitSheet` in this file; only
  the unrelated photo-cap `proGateHit` call is present.
- `CreateScreen.tsx`'s `pendingMedia` direct-enqueue path (line 302-319, the
  path CLAUDE.md specifically calls out as needing its own trim-on-enqueue
  logic) enqueues every item as-is with no length check or trim.
- `CameraScreen.tsx` (line 126-158) still hard-stops recording at the
  **host's own tier cap** (`maxSeconds = limitsForTier(tier).videoSeconds`,
  i.e. 30s for a free host) — the exact "cut off mid-capture" behavior
  CLAUDE.md's current design explicitly says was replaced by a flat 120s cap
  for everyone.
- Git history shows the implementing commits (`875d13d "Carry video
  durationMs..."`, `6087e48 "Close video-length fail-open holes..."`) exist
  but are reachable only from `remotes/origin/fix/payment-security-gates` and
  `remotes/origin/feat/capsule-link-preview` — neither is an ancestor of the
  currently checked-out `chore/sentry-setup` branch (which does include the
  rest of the monetization work via the merged `feat/capsule-pro-features`
  PR #57).

**Impact:** On the code as currently checked out, a free-tier host's video
recording is still cut off mid-capture at 30 seconds (a real UX regression
relative to CLAUDE.md's documented design), and there is no gate at all on
over-length videos arriving via the library picker, share-intent, or a
newly-created capsule's `pendingMedia` path — those simply upload at full
length regardless of tier, silently bypassing the intended cap (accepted by
CLAUDE.md itself as "client-only, bypassable," but the current state is *no*
enforcement at all, not merely a bypassable one).

**Suggested fix:** Confirm whether `fix/payment-security-gates` /
`feat/capsule-link-preview` are meant to merge into whatever branch ships
next; if so this resolves itself on merge. If `chore/sentry-setup` (or
whatever it's based on) is the actual shipping line, the video-length work
needs to be cherry-picked/re-merged in before release — otherwise CLAUDE.md
overstates what's live in production.

**Confidence:** High on the code-state facts (absence confirmed by direct
read + grep); Medium on whether this constitutes a "bug" vs. an in-flight
merge — flagged accordingly.

---

## DM-5 — Severity: Low
**Category:** Data model consistency
**Location:** `src/types/database.ts:16-24` (`NotificationType`)

**Description:** The `NotificationType` union in `database.ts` lists only 8
values (`invite`, `unlock`, `contribution_nudge`, `milestone`, `reaction`,
`superlative_suggested`, `superlative_closing_soon`, `superlative_won`) and is
missing 7 types that are live in the DB check constraint and actively
rendered by `NotificationsScreen.tsx`: `unlock_reminder`, `friend_request`,
`friend_accept`, `group_capsule`, `group_capsule_upcoming`,
`contribution_activity`, `capsule_started`.

**Impact:** Currently low — `NotificationsScreen.tsx` defines and uses its
own local, complete type union rather than importing `Notification`/
`NotificationType` from `database.ts` (confirmed via grep: no non-comment
reference to the database.ts export exists anywhere in `src/`), so nothing is
broken today. But `database.ts`'s own header comment states it's "the Public
type surface used throughout the app" — any future code that reasonably
reaches for this shared type (rather than duplicating `NotificationsScreen`'s
local one) will get a stale, narrower union and either a type error or a
silently-widened `as any` cast at the call site.

**Suggested fix:** Sync `NotificationType` in `database.ts` with the actual
`notifications_type_check` constraint / `NotificationsScreen`'s local union,
or have `NotificationsScreen` import from `database.ts` instead of
maintaining a parallel copy, so there's one source of truth.

**Confidence:** High.

---

## DM-6 — Severity: Low / Informational
**Category:** Signed URLs / media (image transforms)
**Location:** `src/lib/avatarUrl.ts` (uncommitted working-tree change)

**Description:** The working tree has an uncommitted change (`git diff`
confirms) to `transformAvatarUrl()`: it now returns the input URL unchanged
instead of rewriting it to Supabase's `/render/image/public/` endpoint with
resize params, per a new comment explaining this was a deliberate cost
optimization (Storage Image Transformations bills per distinct origin image;
avatars alone were exhausting the Pro quota). This directly contradicts
CLAUDE.md's "Image Transforms" section, which still documents the old
rewrite-and-resize behavior as current (including the "must pass both width
AND height" squash-bug warning, which no longer applies since no transform is
requested at all).

**Impact:** Not a functional bug — avatars are already capped ≤400px at
upload time (per the new comment), so serving them as-is has minor bandwidth
impact. This is purely a documentation-sync gap: CLAUDE.md's Image Transforms
section will mislead the next reader/session about what `transformAvatarUrl`
actually does today.

**Suggested fix:** Once this change is committed, update CLAUDE.md's "Image
Transforms" section to reflect the passthrough behavior and the cost
rationale (the `update-claude-md` skill is designed for exactly this).

**Confidence:** High (directly confirmed via `git diff`).

---

## Sound areas (reviewed, no issues found)

- **`src/lib/cache.ts`** — `get`/`set`/`invalidate`/`subscribe`/`clear` are all
  correct: TTL check on read, wholesale key delete + listener fan-out on
  invalidate, no leaks in the `Map<string, Set<Listener>>` subscribe pattern
  (returns a proper unsubscribe closure).
- **`src/hooks/useCachedFetch.ts`** — the module-level in-flight dedup
  registry, the `callId` ref guarding against a superseded slow response
  clobbering a newer one, and the `force`-driven identity-guarded cache write
  in `fetchOnce` are all correctly implemented and consistent with the
  documented design.
- **`src/lib/mediaUrl.ts`** — `transformMediaUrl` correctly preserves the
  `?token=` signing param, correctly rewrites only the `/object/sign/` path
  segment, and passes non-Supabase URLs through unchanged.
- **`CapsuleDetailScreen.fetchPhotos`** — the `createSignedUrls` batch/index
  mapping, the `MEDIA_CACHE_TTL`/`URL_TTL` layering, the surprise-mode
  `capsule_media_count` RPC fallback for the ambiguous zero-rows case, and the
  video-thumbnail fallback-with-memoization are all implemented exactly as
  CLAUDE.md describes, with no bugs found.
- **`uploadQueue.ts`'s dedup-cache generation guard** — the
  `cacheGeneration` counter correctly prevents a late-resolving upload that
  straddles a drain-clear from repopulating a cleared cache; verified the
  snapshot-before/compare-after logic in `copyOrUpload` is race-safe for a
  single-threaded JS event loop.
- **`delete_capsule_with_storage` / `delete_my_account`'s storage-cleanup
  block** (migrations `20260718090000` / `20260717120000`) — both correctly
  collect storage keys via `SECURITY DEFINER` (bypassing the
  `owner_preview_locked` RLS gate that caused the original orphan bug),
  delete from `storage.objects` before the row deletes, and the account-delete
  transfer-vs-delete split matches CLAUDE.md's documented behavior exactly.
- **`ManageMembersScreen.confirmRemove`** — textbook correct optimistic
  pattern: snapshot the removed row, apply immediately, roll back to the
  exact row (not a stale whole-list snapshot) with a toast on failure, and
  invalidates `capsule:${capsuleId}` on success so a still-mounted
  `CapsuleDetailScreen` picks up the change on its next focus-triggered
  refetch.
- **`EditCapsuleScreen.handleSave`** only invalidates the `capsules` cache
  key, not `capsule:${capsuleId}` — looked like a possible staleness bug, but
  is not: `CapsuleDetailScreen` deliberately does **not** subscribe to that
  cache key (documented in its own comment, `CapsuleDetailScreen.tsx:1514-1520`)
  and instead unconditionally re-fetches on every focus after the first, so
  navigating back from Edit always shows fresh data regardless of cache
  invalidation.

---

## Summary

| ID | Severity | Category |
|---|---|---|
| DM-1 | High | Storage cleanup / orphaned data |
| DM-2 | Medium-High | Optimistic updates / silent data loss |
| DM-3 | Low-Medium | Optimistic updates |
| DM-4 | Medium | Upload / tier enforcement (branch-state caveat) |
| DM-5 | Low | Data model consistency |
| DM-6 | Low / Informational | Signed URLs / media (doc sync only) |
