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

<!-- Moved verbatim from CLAUDE.md. Loads automatically when Claude reads a file matching `paths`. -->

## Content Moderation (Report + Block)

UGC compliance for Apple App Store Guideline 1.2. Scope is **report + block**; EULA-at-signup and an admin review console are deferred.

**Tables** (migration `20260609230500_add_reports_and_blocks.sql`):
- `content_reports` — a user files a report against a `media` item or a `user`. RLS: insert as self, read only your own rows. There is **no** client review path — reports are triaged out-of-band with the service role. CHECK constraints enforce exactly-one target matching `target_type` and no self-report.
- `blocked_users` — directional `(blocker_id, blocked_id)` block. Owner-only RLS on all of select/insert/delete, so the blocked party can never tell they were blocked.

**Block enforcement is client-side filtering** (not RLS — chosen for speed; can be hardened later):
- `src/lib/blocks.ts` — `blockStore`: module-level `Set` of blocked IDs with pub/sub, optimistic `block()`/`unblock()` (ignores `23505` duplicate), `refresh()`, `clear()`. `blockStore.has(id)` is the filter primitive; readable synchronously from non-component code (e.g. `fetchPhotos`).
- `src/lib/demoAccounts.ts` — `isDemoAccountId(id)`, a second filter primitive applied **alongside** `blockStore.has(id)` on the people-search surfaces. Production holds fixture users that the `users` `USING (true)` SELECT policy exposes to every real user's `ilike` search: the 12 `facade00-` landing-page marketing accounts and the `facade01-` App Store reviewer accounts (~39% of the searchable directory). The predicate keys on the hex prefix `facade` that those UUIDs deliberately share (a real v4 UUID colliding is 1-in-16.7M, so it cannot practically hide a real user). Applied in exactly four places — `FriendsScreen`'s `FindPeopleModal`, `CreateGroupScreen`, `ManageGroupScreen`, and `CapsuleDetailScreen`'s `InviteModal` **search tab only**.
  ⚠️ **Search surfaces only — never add it to a member/capsule/reaction fetch.** The fixtures must keep rendering everywhere they legitimately appear, or the App Store reviewer's seeded capsules come back half-empty (their member lists, reactions and media are all fixture-authored). `CapsuleDetailScreen` has three other `blockStore.has` sites (`listFriends`, `loadReactions`, `fetchPhotos`) that deliberately do **not** get this filter.
- `src/hooks/useBlockedUsers.ts` — `useBlockedUsers()` returns the reactive set; refreshes on mount, re-renders on any block change.
- `useAuth` warms `blockStore.refresh()` on `SIGNED_IN`/`INITIAL_SESSION` and calls `blockStore.clear()` on `SIGNED_OUT` (alongside `cache.clear()`).
- Filter sites: `CapsuleDetailScreen.fetchPhotos` drops blocked uploaders' media; `MediaViewerModal.loadReactions` drops blocked users' reactions; the `InviteModal` search excludes blocked users. The parent re-runs `fetchPhotos` when `useBlockedUsers()` changes (skipping the first run).

**Report UI** — `src/components/ReportModal.tsx`, a reusable controlled modal (reason radio list + optional ≤500-char details). Entry points: the **flag icon in `MediaViewerModal`'s header** (`targetType="media"`, passes `capsuleId`) and an **overflow `⋯` menu in `PublicProfileScreen`'s nav bar**. The `⋯` opens a small fade-in popup (tap-outside to dismiss) with **Report** and **Block/Unblock**; block goes through `ConfirmModal`. A blocked profile hides the Invite button and shows a notice.

**Blocked-users management** — `BlockedUsersScreen` (`AppStack` route `BlockedUsers`, opened via a "Blocked Users" row in Settings' new "Privacy" section). Previously the *only* way to unblock someone was finding their profile again (impossible if you'd forgotten who, or if search/mutual-capsule paths no longer surface them). Resolves `blockStore`'s ID-only set into `display_name`/`avatar_url` via a `users` select (id-only `blockStore`/`useBlockedUsers` intentionally carry no profile data — this screen is the one place that needs it, so it fetches locally rather than growing the shared store). Unblock is direct (no confirm, mirroring `PublicProfileScreen`'s unblock) — optimistic remove, reinserts + toasts on failure.

## Friends

Explicit friend requests (`friendships` table). Previously "friends" was *derived* from shared capsule membership; it's now an accept/request relationship. Invites to capsules remain open to **anyone** — friends are just a convenience shortcut, not a gate.

- **Data layer** `src/lib/friends.ts` — `getFriendStatus(id)` → `'none' | 'friends' | 'incoming' | 'outgoing'`; `sendFriendRequest` / `acceptFriendRequest` / `removeFriendship` (one delete covers cancel/decline/unfriend); `listFriends` / `listIncomingRequests` / `listOutgoingRequests` (embed the *other* party's profile via the named FK, e.g. `users!friendships_requester_id_fkey`); `countFriends`. The unordered-pair `.or()` filter is `and(requester_id.eq.X,addressee_id.eq.Y),and(requester_id.eq.Y,addressee_id.eq.X)`. 23505 (duplicate pair) is treated as success.
- **`PublicProfileScreen`** — a friend button that adapts to the status (`Add Friend` → `Requested`/tap-to-cancel → `Accept Request` + `Decline` → `Friends`). **Unfriend** lives in the `⋯` overflow menu (alongside Report/Block). Status is fetched on mount.
- **`FriendsScreen`** (`AppStack` route `Friends`, opened by tapping the **Friends stat on `ProfileScreen`**) — a Requests section (Accept/Decline) + a Friends list (row → `PublicProfile`). The Profile `Friends` stat now counts accepted friendships via `countFriends()` (cache key `profile`; invalidate on accept/unfriend). A **Find people** entry (nav-bar `person-add` icon + a button in the empty state) opens an inline `FindPeopleModal`: a debounced `users` `ilike` search (mirrors `CreateGroupScreen`'s), excluding self + blocked, each row → `PublicProfile` (where Add Friend lives) — so the empty state is no longer a dead end.
- **Alerts tab** (`NotificationsScreen`) — `friend_request` rows render with inline **Accept/Decline** (act on `friendships` via `actor_id`, then mark the notification read); `friend_accept` rows tap through to the actor's profile. The notifications query embeds `actor:users!notifications_actor_id_fkey(...)`. A **"Mark all read"** header button (shown when >1 *clearable* card) bulk-marks read via one `.update({ read_at }).is('read_at', null).neq('type','invite').neq('type','friend_request')` — it deliberately **excludes** actionable invite/friend-request cards so it can't orphan a pending invite (the same trap the invite Decline button fixed).
- **Capsule invite search** (`InviteModal` in `CapsuleDetailScreen`) — a **Friends / Search** tab toggle. Friends tab lists accepted friends not already members (and not blocked); Search is the existing username search. Both use the same `invite()`.
- **Not built (deferred):** remote push for friend events — `friend_request`/`friend_accept` create durable in-app notifications only; no Expo push is sent yet.
