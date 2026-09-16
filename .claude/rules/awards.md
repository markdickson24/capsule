---
paths:
  - "src/components/AwardsSection.tsx"
  - "src/components/VoteSheet.tsx"
  - "src/components/SuggestCategoryModal.tsx"
  - "src/components/VotingWindowPicker.tsx"
  - "src/components/DefaultAwardsCard.tsx"
  - "src/lib/award*"
  - "supabase/functions/send-superlative-pushes/**"
  - "supabase/migrations/**"
---

<!-- Trimmed from the original CLAUDE.md; backstory kept in HTML comments. Loads automatically when Claude reads a file matching `paths`. -->

## Superlatives (Awards)

Per-capsule, yearbook-style awards. Members suggest categories; enough upvotes auto-promotes to `live`; voting opens at unlock for an owner-configured window; winners revealed at close.

### Lifecycle
- **suggest** — joined member INSERTs `superlative_categories` (label 3–80 chars, `target_type ∈ {'person','media'}`); RLS: `suggested_by = auth.uid()`, membership, `status = 'pending'`. AFTER INSERT trigger `notify_on_superlative_suggested` notifies every other joined member.
- **upvote** — INSERT `superlative_upvotes`; `_promote_superlative` trigger flips status to `live` at `count >= ceil(joined/2)` (SECURITY DEFINER, bypasses the owner-only UPDATE policy).
- **vote** — upsert `superlative_votes`, PK `(category_id, voter_id)`; RLS: self, no self-vote (`target_user_id <> auth.uid()`), category `live`, window open, target matches capsule + `target_type` (via `_superlative_target_valid`). Update/delete own row until close.
- **finalize** — at `now() >= superlative_voting_closes_at`, `close_superlative_windows()` cron calls `finalize_capsule_superlatives()`: winners via `rank() = 1` (ties = co-winners), archives suggestions below threshold, sets `superlative_voting_finalized_at`, inserts `superlative_won` notifications for winning members/uploaders.

### Voting window
`capsules.superlative_voting_hours` (1–720, default 48) — owner picks via `<VotingWindowPicker>` on Create/Edit. `_stamp_unlock_meta` BEFORE UPDATE trigger stamps `superlative_voting_closes_at = unlocked_at + voting_hours` on unlock (time-cron and proximity `check_in` paths alike). 2 hours before close, `dispatch_superlative_closing_soon()` fans out `superlative_closing_soon` notifications and stamps `superlative_closing_soon_sent_at` (fires once).

### RLS + anonymity
`superlative_categories` — members read/insert (pending only); owner update/delete. `superlative_upvotes` — members read + upvote pending, can remove own upvote. `superlative_votes` — **voter reads only their own rows**; aggregates come from `tally_superlatives(capsule_id)` (SECURITY DEFINER, returns `(category_id, target_*, vote_count)` only after `now() >= voting_closes_at`) — server-enforces "tallies hidden during voting". `superlative_winners` — read-only for members, written only by `finalize_capsule_superlatives`; reveal UI reads it directly, not `tally_superlatives`.

### Notifications + push
Types `superlative_suggested`/`superlative_closing_soon`/`superlative_won` are inserted by a trigger or the finalize/dispatch functions (durable, read by `NotificationsScreen`), delivered by `send-superlative-pushes` (cron-pinged every minute via `net.http_post`): pulls `pushed_at IS NULL AND type IN (...)`, builds per-type Expo payloads with `data.capsuleId`, posts to `exp.host` (chunked ≤100/request), stamps `pushed_at` so retries can't double-send. ⚠️ **The `users` embed MUST be FK-qualified (`users!notifications_user_id_fkey(push_token)`)** — `notifications` has two FKs to `users` (`user_id`, `actor_id`), so a bare `users(...)` embed is ambiguous and PostgREST errors (silent 500 every minute under the EXISTS-gated cron, backlog never clears). New `notifications`→`users` embeds must pick the FK the same way (`NotificationsScreen` uses `actor:users!notifications_actor_id_fkey`). Tap routing: native push handler and `NotificationsScreen` both route `data.capsuleId` to `CapsuleDetail`. The unlock push body doubles as the "voting opens" cue — no separate notification.

### Cron job
`close-superlative-windows` runs `* * * * *`, three statements each minute:
```sql
select public.dispatch_superlative_closing_soon();
select public.close_superlative_windows();
select net.http_post(... send-superlative-pushes ...);
```
Uses the same Vault secret (`cron_unlock_capsules_secret`) as the unlock cron; `CRON_SECRET` is a project-wide Edge Function secret, read automatically once set anywhere.

### Client integration
- `<AwardsSection>` — in `CapsuleDetailScreen` under the media grid, unlocked only. Branches on `voting_closes_at`/`voting_finalized_at`: **open** (pending cards w/ upvote + progress bar to threshold, live cards w/ Vote/Change pill); **closed pre-finalize** (`"Tallying votes…"`); **finalized** (staggered `WinnerCard` reveals — avatar for person, thumbnail for media, tied co-winners side by side). A winning **media** thumbnail is tappable via `onOpenMedia(mediaId)` (threaded to `WinnerEntry`, wired to `setActiveMediaIndex` → the same `MediaViewerModal` as the grid; vote-picker grid unaffected).
- Realtime on `superlative_categories` drives upvote/auto-promote; on `superlative_winners` INSERTs drives finalize → reveal. Parent's `capsules` UPDATE channel catches `superlative_voting_finalized_at` flipping and re-renders with new props.

### Gotchas
- Voter's own vote IS client-readable ("Your vote: X"); anonymity is about *other* voters only.
- `finalize_capsule_superlatives()` is idempotent (`if v_finalized_at is not null then return`) — safe for the cron to hit repeatedly.
- Parent's `capsule` state (`votingClosesAt`, `votingFinalizedAt`) must be passed as props — the section can't subscribe to capsule changes itself.
- Auto-promote trigger checks `status = 'pending'` before flipping — concurrent upvotes can't double-promote.
- **`isClosed` self-advances live at the `votingClosesAt` boundary** via a `nowTick` state (not a bare `Date.now()` read) plus a one-shot `setTimeout` (capped ~23 days, dodging 32-bit signed-int overflow since windows run up to 720h) that bumps `nowTick` right at close — a user on-screen sees "voting open" flip to "Tallying…" with no other trigger needed.

### Default Awards

A second, parallel path to `live`: up to **4 predetermined ("default") awards**, themed by `occasion`, inserted already `status = 'live'` — no suggest/upvote gauntlet. Coexists with member suggestions.

- **`capsules.occasion`** (`wedding`/`vacation`/`party`/`baby`/`milestone`/`general`, default `'general'`) — chip row on `CreateScreen` (no equivalent in `EditCapsuleScreen` — creation-only, like `owner_preview_locked`); selects the themed pool in `src/lib/awardPool.ts`, no other behavior.
- **`src/lib/awardPool.ts`** — pure client module, no network: `AWARD_POOL: Record<OccasionKey, PresetAward[]>` (~10/occasion, mixed person/media, themed), `pickDefaults(occasion, count=4, exclude=[])` (shuffle+sample, tops up with repeats only if the pool minus exclusions is too small), `pickReplacement(occasion, currentLabels)` (single-slot swap, excludes other current labels).
- **`set_default_superlatives(p_capsule_id, p_awards jsonb)` RPC** (`security definer`) — the only path a default award reaches `status = 'live'` (suggest-INSERT RLS still forces `pending`, so this can't be done through a plain `.insert()`). Authorizes inline: caller must be `capsules.owner_id` (checked via `is distinct from`, not `<>`, so a null `auth.uid()` can't silently bypass), capsule not `status = 'unlocked'`. **Full-replace, not incremental**: deletes existing `is_default` rows, re-inserts the given array (safe pre-unlock — no votes can exist yet). Caps the array at 4, re-validates label length (3–80) and `target_type` server-side.
- `notify_on_superlative_suggested` early-returns when `NEW.is_default` — seeding/reshuffling defaults never fans out `superlative_suggested` notifications the way a real member suggestion does.
- **`src/components/DefaultAwardsCard.tsx`** — one component, two modes via a `mode` prop. `mode="preview"` (`CreateScreen`): fully controlled, parent owns the `awards` array (seeded via `pickDefaults(occasion)`, re-seeded on occasion change) + `onChange`, nothing persists until capsule creation. `mode="manage"` (`CapsuleDetailScreen`, pre-unlock only): owns its own state, fetches current `is_default` rows on mount, every shuffle/swap/remove calls `set_default_superlatives` directly (optimistic, rolls back on error). Both render 4 award chips w/ per-slot swap (↻) + remove (×) + a "Shuffle all" button. **Collapsed by default** (disclosure, same convention as `CreateScreen`'s "More options"/`CreateGroupScreen`'s "Schedule details"); header row is the toggle, collapsed shows a one-line summary from **`summarizeAwards`** (`src/lib/awardSummary.ts`, unit-tested — `"4 awards · Label, Label…"`, `numberOfLines={1}`), open state not persisted. "Shuffle all" only renders while open (a blind tap replaces every award). A failed `set_default_superlatives` also toasts (the inline `error` line lives in the collapsed-away body — without a toast the summary just silently reverts).
- **`CreateScreen.handleCreate`** calls the RPC once, right after the owner `capsule_members` insert succeeds (non-fatal on error — the capsule is already usable).
- **`CapsuleDetailScreen`** renders `<DefaultAwardsCard mode="manage">` only when `isOwner && isLocked` — the owner's only chance to review/regenerate (`<AwardsSection>` is unlocked-only and the RPC refuses changes post-unlock). Once unlocked, default awards are indistinguishable from member-suggested ones in `AwardsSection` — just ordinary `live` categories with `is_default = true`.
- **`fetchAwardsData`** (`src/lib/awardsData.ts`) selects `is_default` alongside the other category columns for future UI, though `AwardsSection` doesn't currently render on it.
