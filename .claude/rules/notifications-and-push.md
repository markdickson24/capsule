---
paths:
  - "src/hooks/usePushNotifications*"
  - "src/screens/app/NotificationsScreen.tsx"
  - "supabase/functions/**"
  - "supabase/migrations/**"
---

<!-- Trimmed from the original CLAUDE.md; backstory kept in HTML comments. Loads automatically when Claude reads a file matching `paths`. -->

## Push Notifications (`usePushNotifications.ts`)

- Called from `App.tsx` with `userId` from session.
- Registers Expo push token (native only) into `users.push_token` — **only if permission is already granted**; `registerToken` never calls `requestPermissionsAsync`. The native prompt fires exactly once, from `requestPushPermission(userId)` (same module, no-op `false` on web), called by Onboarding's "Don't miss it" primer after the user's first capsule is created. "Maybe later" writes `cap_notif_reprime:<userId>` to AsyncStorage so a future re-ask knows the prompt is unspent.
- Tap handler reads `data.capsuleId` or `data.screen`, navigates via `navigationRef`.
- Display config: `showAlert`, `playSound`, `showBanner`, `showList` all true.
- Invite pushes sent by the `send-invite-push` edge function (`CapsuleDetailScreen.sendInviteNotification()` via `supabase.functions.invoke()`); verifies caller owns the capsule, reads invitee's `push_token` with service role, posts to Expo.
  - ⚠️ **"Caller owns the capsule + a `capsule_members` row exists" is NOT sufficient authorization** — an owner may insert a member row for *any* `user_id` (`can_insert_capsule_member`), so the caller could manufacture the row the guard checks, making this an unlimited push channel to any known UUID (`users` SELECT is `USING (true)`), with the group branch putting attacker text in the notification **title**. Now requires a genuinely pending invite (`joined_at IS NULL`), or `joined_at IS NOT NULL` for a group capsule (auto-join = standing consent) — a distinction the inviter can't forge since `capsule_members_update` is `USING (user_id = auth.uid())`. Also claims `invite_pushed_at` atomically (`UPDATE … WHERE invite_pushed_at IS NULL … RETURNING`, same idiom as `dispatchReminders`) so each invite pushes once. **Keep user text in the body, never the title.** In-app row created server-side by `notify_on_invite`.
- Reaction notifications created server-side by `notify_on_reaction`.
- **Expo push requests chunked to ≤100 messages** (PERFORMANCE.md #10) — `exp.host` rejects a >100-message request as a whole batch, which would silently drop every push for a 100+ member capsule unlocking. `unlock-capsules` and `send-superlative-pushes` route through a `sendExpoPush()` helper that slices into ≤100-message requests, posted sequentially; byte-identical for ≤100. Both keep `verify_jwt = false` (custom `CRON_SECRET` bearer).

## Contribution Nudges

Two retention-notification types, fully server-side: a batched social-proof ping on upload, and a tiered reminder to non-contributing members as the deadline approaches.

**Schema** (`20260715120000_contribution_nudges.sql`):
- `notifications.count` (nullable int) — photo count for both types.
- `notifications.type` gained `contribution_activity` (`contribution_nudge` was already a reserved-but-unused value in the `notifications_type_check` constraint pre-migration). Verified against production's live constraint before migrating — prod had already drifted to include `group_capsule_upcoming`, so the migration's type list was written as a superset of the live constraint.
- `capsule_members.contribution_nudge_7d_sent_at`/`_3d_sent_at`/`_1d_sent_at` (nullable timestamptz) — per-member, per-tier dedupe stamps.
- `contribution_activity_pending` (`capsule_id`, `uploader_id` composite PK; `photo_count`, `last_upload_at`) — debounce staging table, RLS enabled with **no policies** (deny-all to clients); only the trigger (SECURITY DEFINER) and the edge function touch it.

**Trigger:** `notify_contribution_activity()` (SECURITY DEFINER) fires AFTER INSERT on `media`, upserts the staging row (`on conflict (capsule_id, uploader_id) do update set photo_count = photo_count + 1, last_upload_at = now()`) — collapses an upload burst into one notification.

**RPCs** (both SECURITY DEFINER, execute revoked from `public`/`anon`/`authenticated` — internal-only, matching the established pattern for `dispatch_superlative_closing_soon` etc.):
- `claim_contribution_nudge_tier(p_tier text)` — `p_tier` ∈ `'7d'`/`'3d'`/`'1d'`. One atomic `UPDATE ... RETURNING` per tier: claims joined `owner`/`contributor` members with zero uploads whose effective deadline (`coalesce(contribution_lock_at, unlock_at when unlock_mode in ('time','both'))`) falls in that tier's window, stamping `_sent_at` in the same statement (race-safe, same shape as `unlock-capsules`' `dispatchReminders`). **The three tiers' windows overlap** (each is `<= now() + interval 'Xd'`, not a disjoint band) — a capsule whose deadline is already close can match all three in one tick, which caused duplicate pushes (one per claimed tier).
  <!-- History: confirmed in prod — a fresh capsule with a 20-hour-out deadline stamped 7d/3d/1d in the same cron run, sending 3 duplicate contribution_nudge rows within ~0.5s. -->
  **Fixed in the edge function, not the DB**: `contribution-nudges` dedupes per `(user, capsule)` across the three claims in one run (`nudgedThisRun` Set) — at most one nudge per member per run; all `_sent_at` stamps still commit, a long-lead capsule still gets spread 7d/3d/1d nudges on separate ticks. The copy is identical across tiers anyway (`formatDeadline` reads the real remaining time). `unlock-capsules`' 1d/1h/10m reminder tiers have the identical overlapping shape and got the same per-capsule dedup (`remindedThisRun` Set in `dispatchReminders`).
- `top_contributors(p_capsule_id uuid)` — uploaders ordered by `photo_count desc`, for the "X added N photos, you haven't" comparison copy; a nudge recipient (zero-upload by definition) never appears in it.

**Cron jobs** (`20260715120100_contribution_nudges_cron.sql`) — both `* * * * *`, EXISTS-gated, Vault-backed `CRON_SECRET` via `cron_unlock_capsules_secret` (project-wide):
- **`dispatch-contribution-activity`** → `supabase/functions/dispatch-contribution-activity`. Cron gate and the function's claim (`DELETE ... RETURNING` on `contribution_activity_pending`) both check `last_upload_at <= now() - interval '2 minutes'` (debounce). Filters uploaders the recipient has blocked (`blocked_users`). Inserts one `contribution_activity` notification per non-blocked recipient, pushes inline.
- **`contribution-nudges`** → `supabase/functions/contribution-nudges`. Loops the three tiers, calls `claim_contribution_nudge_tier`, groups claimed members by capsule (`top_contributors` once per capsule), picks the first unblocked top contributor per recipient. Falls back to "nobody's added photos yet" copy (`actor_id: null`, `count: null`) when none.
- Both duplicate a local `sendExpoPush()` chunked ≤100 messages.

**Client rendering** (`NotificationsScreen.tsx`) — both capsule-nav. `contribution_activity`: `images-outline` icon, "`<actor.display_name>` added `<count>` photo(s) to `<capsule title>`". `contribution_nudge`: `hourglass-outline` icon, top-contributor comparison (`actor_id` set) or "nobody's added photos yet" (null). Both `accentColor`.

**Shipped to production** (`ezxxvvmesegegkdeniri`) — both migrations + edge functions `dispatch-contribution-activity` and `contribution-nudges` (`verify_jwt: false`, matching `unlock-capsules`/`send-superlative-pushes`/`create-group-capsules`), verified end-to-end against live data.
