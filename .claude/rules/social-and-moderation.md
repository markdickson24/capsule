---
paths:
  - "src/lib/blocks.ts"
  - "src/lib/demoAccounts.ts"
  - "src/lib/friends.ts"
  - "src/hooks/useBlockedUsers.ts"
  - "src/components/ReportModal.tsx"
  - "src/screens/app/PublicProfileScreen.tsx"
  - "src/screens/app/FriendsScreen.tsx"
  - "src/screens/app/BlockedUsersScreen.tsx"
  - "src/screens/app/NotificationsScreen.tsx"
  - "src/screens/app/CapsuleDetailScreen.tsx"
  - "src/screens/app/*Group*"
---

<!-- Trimmed from the original CLAUDE.md; backstory kept in HTML comments. Loads automatically when Claude reads a file matching `paths`. -->

## Content Moderation (Report + Block)

UGC compliance for Apple Guideline 1.2. Scope: report + block; EULA-at-signup and an admin review console are deferred.

**Tables** (`20260609230500_add_reports_and_blocks.sql`):
- `content_reports` — report against a `media` item or `user`. RLS: insert-as-self, read-own only; no client review path (triaged out-of-band via service role). CHECK enforces exactly-one target matching `target_type`, no self-report.
- `blocked_users` — directional `(blocker_id, blocked_id)`. Owner-only RLS on select/insert/delete — blocked party can never tell.

**Block enforcement is client-side filtering** (not RLS — speed, can be hardened later):
- `src/lib/blocks.ts` — `blockStore`: module-level `Set` of blocked IDs, pub/sub, optimistic `block()`/`unblock()` (ignores `23505` duplicate), `refresh()`, `clear()`. `blockStore.has(id)` is the filter primitive, readable synchronously from non-component code (e.g. `fetchPhotos`).
- `src/lib/demoAccounts.ts` — `isDemoAccountId(id)`, applied **alongside** `blockStore.has(id)` on people-search surfaces only. Production holds fixture users (`facade00-` marketing, `facade01-` App Store reviewer accounts, ~39% of the searchable directory) exposed by `users`' `USING (true)` SELECT; predicate keys on the shared `facade` hex prefix (collision odds 1-in-16.7M). Applied in exactly four places: `FriendsScreen`'s `FindPeopleModal`, `CreateGroupScreen`, `ManageGroupScreen`, `CapsuleDetailScreen`'s `InviteModal` search tab only.
  - ⚠️ **Search surfaces only — never add to a member/capsule/reaction fetch**, or the App Store reviewer's seeded capsules come back half-empty (member lists/reactions/media are fixture-authored). `CapsuleDetailScreen`'s other `blockStore.has` sites (`listFriends`, `loadReactions`, `fetchPhotos`) deliberately don't get this filter.
- `src/hooks/useBlockedUsers.ts` — reactive set, refreshes on mount, re-renders on change.
- `useAuth` warms `blockStore.refresh()` on `SIGNED_IN`/`INITIAL_SESSION`, calls `blockStore.clear()` on `SIGNED_OUT` (alongside `cache.clear()`).
- Filter sites: `CapsuleDetailScreen.fetchPhotos` drops blocked uploaders' media; `MediaViewerModal.loadReactions` drops blocked users' reactions; `InviteModal` search excludes blocked users. Parent re-runs `fetchPhotos` when `useBlockedUsers()` changes (skipping the first run).

**Report UI** — `src/components/ReportModal.tsx`, reusable controlled modal (reason radio list + optional ≤500-char details). Entry points: flag icon in `MediaViewerModal`'s header (`targetType="media"`, passes `capsuleId`); overflow `⋯` menu in `PublicProfileScreen`'s nav bar (fade-in popup, tap-outside dismiss; Report + Block/Unblock, block via `ConfirmModal`). Blocked profile hides Invite, shows a notice.

**Blocked-users management** — `BlockedUsersScreen` (`AppStack` route `BlockedUsers`, via Settings' "Privacy" section). Resolves `blockStore`'s ID-only set into `display_name`/`avatar_url` via a `users` select (shared store carries no profile data). Unblock is direct (no confirm) — optimistic remove, reinserts + toasts on failure.

## Friends

Explicit friend requests (`friendships` table), replacing the old capsule-membership-derived model. Capsule invites stay open to anyone; friends are a convenience shortcut, not a gate.

- **Data layer** `src/lib/friends.ts` — `getFriendStatus(id)` → `'none' | 'friends' | 'incoming' | 'outgoing'`; `sendFriendRequest`/`acceptFriendRequest`/`removeFriendship` (one delete covers cancel/decline/unfriend); `listFriends`/`listIncomingRequests`/`listOutgoingRequests` (embed the other party via named FK, e.g. `users!friendships_requester_id_fkey`); `countFriends`. Unordered-pair filter: `.or()` with `and(requester_id.eq.X,addressee_id.eq.Y),and(requester_id.eq.Y,addressee_id.eq.X)`. `23505` (duplicate pair) treated as success.
- **`PublicProfileScreen`** — friend button adapts to status (`Add Friend` → `Requested`/tap-to-cancel → `Accept Request` + `Decline` → `Friends`). Unfriend lives in the `⋯` overflow (with Report/Block). Status fetched on mount.
- **`FriendsScreen`** (`AppStack` route `Friends`, opened from the Friends stat on `ProfileScreen`) — Requests section (Accept/Decline) + Friends list (row → `PublicProfile`). Profile's `Friends` stat counts via `countFriends()` (cache key `profile`; invalidate on accept/unfriend). A **Find people** entry (nav-bar `person-add` icon) opens `FindPeopleModal`: debounced `users` `ilike` search (mirrors `CreateGroupScreen`'s), excludes self + blocked, each row → `PublicProfile`.
- **Alerts tab** (`NotificationsScreen`) — `friend_request` rows render inline Accept/Decline (act on `friendships` via `actor_id`, mark notification read); `friend_accept` rows tap through to the actor's profile. Query embeds `actor:users!notifications_actor_id_fkey(...)`. "Mark all read" (shown when >1 clearable card) bulk-marks via one `.update({ read_at }).is('read_at', null).neq('type','invite').neq('type','friend_request')` — **excludes actionable invite/friend-request cards** so it can't orphan a pending invite.
- **Capsule invite search** (`InviteModal` in `CapsuleDetailScreen`) — Friends/Search tab toggle; Friends lists accepted friends not already members (not blocked); Search is the existing username search. Both use the same `invite()`.
- **Not built (deferred):** remote push for friend events — `friend_request`/`friend_accept` create durable in-app notifications only, no Expo push yet.
