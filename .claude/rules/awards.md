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

<!-- Moved verbatim from CLAUDE.md. Loads automatically when Claude reads a file matching `paths`. -->

## Superlatives (Awards)

Per-capsule, yearbook-style awards. Members suggest categories; once enough upvote a suggestion it auto-promotes to live; voting opens when the capsule unlocks and runs for an owner-configured window; winners are revealed when the window closes.

### Lifecycle
- **suggest** — any joined member calls INSERT on `superlative_categories` with a label (3–80 chars) and `target_type ∈ {'person','media'}`. RLS verifies `suggested_by = auth.uid()`, capsule membership, and `status = 'pending'`. An AFTER INSERT trigger (`notify_on_superlative_suggested`) inserts `superlative_suggested` notification rows for every other joined member.
- **upvote** — members INSERT into `superlative_upvotes`. The `_promote_superlative` trigger reads the current upvote count + joined-member count; if `count >= ceil(joined/2)` it flips the category's status to `live`. SECURITY DEFINER bypasses the "owner only" UPDATE policy.
- **vote** — members upsert into `superlative_votes` keyed on the composite PK `(category_id, voter_id)`. RLS enforces: voter is self, no self-vote (`target_user_id <> auth.uid()`), category is `live`, voting window is open, and the target row belongs to the category's capsule + matches its `target_type` (checked via the `_superlative_target_valid` helper). Voters can update or delete their own row until the window closes.
- **finalize** — when `now() >= superlative_voting_closes_at` the `close_superlative_windows()` cron picks up the capsule and calls `finalize_capsule_superlatives()`: computes winners with `rank() = 1` (ties = co-winners), archives any pending suggestions that never crossed the threshold, sets `superlative_voting_finalized_at`, and inserts `superlative_won` notification rows for winning members (and uploaders of winning media).

### Voting window
- `capsules.superlative_voting_hours` (1–720, default 48) — owner picks this on Create / Edit via `<VotingWindowPicker>`.
- `_stamp_unlock_meta` BEFORE UPDATE trigger stamps `superlative_voting_closes_at = unlocked_at + voting_hours` the moment status flips to `unlocked`. Works for both the time-cron and the proximity `check_in` path.
- 2 hours before close, `dispatch_superlative_closing_soon()` fans out `superlative_closing_soon` notifications and stamps `superlative_closing_soon_sent_at` so it fires once.

### RLS + anonymity
- `superlative_categories` — members read; members insert (only `status = 'pending'`); owner can update / delete.
- `superlative_upvotes` — members read and upvote pending categories; voters can remove their own upvote.
- `superlative_votes` — **the voter can only read their own rows**. Aggregated counts come from `tally_superlatives(capsule_id)` — a SECURITY DEFINER RPC that returns `(category_id, target_*, vote_count)` rows but only after `now() >= voting_closes_at`. This is what makes the "tallies hidden during voting" rule enforceable on the server.
- `superlative_winners` — read-only for members; writes happen only via `finalize_capsule_superlatives`. The reveal UI reads from this table directly, not from `tally_superlatives`.

### Notifications + push
Three new notification types: `superlative_suggested`, `superlative_closing_soon`, `superlative_won`. All three:
1. Are inserted by a trigger or by the finalize/dispatch functions (rows are durable; the in-app `NotificationsScreen` reads them).
2. Are delivered as Expo pushes by the `send-superlative-pushes` edge function, which the cron pings every minute via `net.http_post`. The function pulls notifications where `pushed_at IS NULL AND type IN (...)`, builds per-type Expo payloads with `data.capsuleId`, posts to `exp.host` (chunked ≤100/request — see Push Notifications), and stamps `pushed_at` so retries can't double-send. **The `users` embed in its select MUST be FK-qualified (`users!notifications_user_id_fkey(push_token)`)**: `notifications` has two FKs to `users` (`user_id` and `actor_id`, the latter added by the friends feature), so a bare `users(...)` embed is ambiguous and PostgREST errors — which surfaces as a silent 500 that, combined with the EXISTS-gated cron, made the function 500 every minute and never clear its backlog. Any new server-side `notifications`→`users` embed must pick the FK the same way (`NotificationsScreen` already does, via `actor:users!notifications_actor_id_fkey`).
3. Tap routing: the native push handler already routes any `data.capsuleId` to `CapsuleDetail`; `NotificationsScreen` does the same on tap.

The unlock push body is intentionally worded to double as the "voting opens" cue — no separate notification is sent for that moment.

### Cron job
`close-superlative-windows` runs `* * * * *` and executes three statements in sequence each minute:
```sql
select public.dispatch_superlative_closing_soon();
select public.close_superlative_windows();
select net.http_post(... send-superlative-pushes ...);
```
The HTTP call uses the same Vault secret (`cron_unlock_capsules_secret`) as the unlock cron. `CRON_SECRET` is a project-wide Edge Function secret (see "Unlock Cron" → Auth), so both functions read it automatically once it's set anywhere in the project — no separate per-function setup.

### Client integration
- `<AwardsSection>` lives in `CapsuleDetailScreen` under the media grid, only on unlocked capsules. It branches on `voting_closes_at` / `voting_finalized_at`:
  - **voting open** — pending cards with upvote button + progress bar to threshold, live cards with Vote / Change pill
  - **voting closed, pre-finalize** — `"Tallying votes…"` placeholder
  - **finalized** — staggered `WinnerCard` reveals (avatar for person, thumbnail for media; tied co-winners side by side). A winning **media** thumbnail is tappable — `AwardsSection`'s optional `onOpenMedia(mediaId)` prop (threaded to `WinnerEntry`) is wired by `CapsuleDetailScreen` to `setActiveMediaIndex`, opening the same full-screen `MediaViewerModal` as the grid. Only active once the item has loaded; the vote-picker grid is unaffected (tap there still casts a vote).
- Realtime subscription on `superlative_categories` (filtered to capsule) drives upvote / auto-promote updates. A second subscription on `superlative_winners` INSERTs drives the finalize → reveal transition.
- The parent's existing realtime channel on `capsules` UPDATEs catches `superlative_voting_finalized_at` flipping and re-renders the section with the new props.

### Gotchas
- The voter's own vote IS readable client-side (so "Your vote: X" works). Anonymity is about *other* voters — tallies for them route through the time-gated RPC or the winners table.
- `finalize_capsule_superlatives()` is idempotent: `if v_finalized_at is not null then return`. The cron can hit a capsule multiple times safely.
- When tying capsules' realtime to the section, the parent's `capsule` state must be passed as props (`votingClosesAt`, `votingFinalizedAt`) — the section can't subscribe to capsule changes itself because that's the parent's responsibility.
- The auto-promote trigger checks `status = 'pending'` before flipping, so concurrent upvotes can't promote twice.
- **`isClosed` self-advances live at the `votingClosesAt` boundary.** It derives from a `nowTick` state (not a bare `Date.now()` read at render time), and a one-shot `setTimeout` (capped at ~23 days to dodge `setTimeout`'s 32-bit signed-int overflow, since the voting window can be up to 720h) bumps `nowTick` right when the window closes — so a user sitting on the screen sees "voting open" flip to "Tallying…" without needing some other event (realtime message, refocus, manual refresh) to trigger a re-render first.

### Default Awards

A second, parallel path to `live` alongside the suggest→upvote flow above: every capsule can have up to **4 predetermined ("default") awards**, themed by the capsule's `occasion`, inserted already `status = 'live'` — no suggest/upvote gauntlet. Member suggestions still work exactly as described above and coexist with the defaults.

- **`capsules.occasion`** (`wedding` / `vacation` / `party` / `baby` / `milestone` / `general`, default `'general'`) — picked via a chip row on `CreateScreen` (no equivalent in `EditCapsuleScreen` — occasion is creation-only, like `owner_preview_locked`). Chosen purely to select which themed pool `src/lib/awardPool.ts` draws from; carries no other behavior.
- **`src/lib/awardPool.ts`** — pure client-side module (no network calls, since the Create-screen preview happens before the capsule exists): `AWARD_POOL: Record<OccasionKey, PresetAward[]>` (~10 awards per occasion, mixed person/media, themed — sentimental for wedding/baby, playful for vacation/party, reflective for milestone), `pickDefaults(occasion, count=4, exclude=[])` (shuffles + samples, tops up with repeats only if the pool minus exclusions is too small), `pickReplacement(occasion, currentLabels)` (single-slot swap, excludes the other current labels).
- **`set_default_superlatives(p_capsule_id, p_awards jsonb)` RPC** (`security definer`) — the only way a default award reaches `status = 'live'` (the suggest-INSERT RLS policy still forces `status = 'pending'` for client inserts, so this can't be done through a plain `.insert()`). Authorizes inline: caller must be `capsules.owner_id` (checked with `is distinct from`, not `<>` — a null `auth.uid()` must not silently bypass the check) and the capsule must not be `status = 'unlocked'`. **Full-replace, not incremental**: every call deletes the capsule's existing `is_default` rows and re-inserts the given array — safe pre-unlock since no votes can exist yet. Caps the array at 4, re-validates label length (3–80) and `target_type` server-side even though the client already validates.
- **`notify_on_superlative_suggested`** early-returns when `NEW.is_default` — seeding/reshuffling defaults never fans out `superlative_suggested` notifications the way a real member suggestion does.
- **`src/components/DefaultAwardsCard.tsx`** — one presentational component, two modes, discriminated by a `mode` prop:
  - `mode="preview"` (`CreateScreen`) — fully controlled; the parent owns the `awards` array (seeded via `pickDefaults(occasion)`, re-seeded whenever the occasion chip changes) and passes `onChange`. Nothing is persisted until the capsule itself is created.
  - `mode="manage"` (`CapsuleDetailScreen`, pre-unlock only) — owns its own state: fetches the capsule's current `is_default` rows on mount, and every shuffle/swap/remove calls `set_default_superlatives` directly (optimistic update, rolls back on error).
  - Both modes render the same 4 award chips with per-slot swap (↻) and remove (×) controls plus a "Shuffle all" button.
  - **Collapsed by default** — the card is a disclosure, following the same convention as `CreateScreen`'s "More options" and `CreateGroupScreen`'s "Schedule details" (pre-seeded values that are fine to leave alone, so the closed state costs the owner nothing). The whole header row is the toggle; collapsed it shows a one-line summary from **`summarizeAwards`** (`src/lib/awardSummary.ts`, unit-tested — `"4 awards · Label, Label…"`, ellipsized by `numberOfLines={1}` rather than pre-truncated), expanded it shows the subtitle + chips. Open state is **not** persisted (every visit starts collapsed), matching those two screens. "Shuffle all" is a nested touchable that only renders while open — a blind tap on it silently replaces every award. Because the inline `error` line lives in the collapsed-away body, a failed `set_default_superlatives` also toasts (per the "any user-initiated mutation that fails must toast" rule) — otherwise the summary just silently reverts.
- **`CreateScreen.handleCreate`** calls the RPC once, right after the owner `capsule_members` insert succeeds (non-fatal on error — the capsule is already usable, and the owner can still seed defaults from the capsule page).
- **`CapsuleDetailScreen`** renders `<DefaultAwardsCard mode="manage">` only when `isOwner && isLocked` — this is the owner's only chance to review/regenerate the defaults, since `<AwardsSection>` itself is unlocked-only and the RPC refuses changes post-unlock. Once unlocked, default awards are indistinguishable from member-suggested ones in `AwardsSection` — they're just ordinary `live` categories that happen to have `is_default = true`.
- **`fetchAwardsData`** (`src/lib/awardsData.ts`) selects `is_default` alongside the other category columns so it's available to any future UI that wants to badge defaults differently, though `AwardsSection` doesn't currently render on it.
