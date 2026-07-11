# Capsule — Groups Feature Review

A full in-depth review of the Groups feature: schema + RLS (`20260625000000_groups.sql`),
the recurrence cron + edge function (`create-group-capsules`), the data layer
(`src/lib/groups.ts`), and every client surface (`CreateGroupScreen`, `GroupDetailScreen`,
`HomeScreen` groups section, `CreateScreen`'s group branch). Cross-checked against the
repo's known conventions (RLS patterns, push chunking, toast-on-failure rule,
blocked-user filter sites, a11y labels) and the generated live-schema types
(`src/types/supabase.ts`). **No code has been changed.**

> Live-DB verification (pg_policies, trigger bodies, cron.job) could not be run this
> session — the Supabase MCP connection is unauthorized. Items that need a live check
> are marked **[verify live]**. Reviewed at `main` = `a7caa63` (2026-07-10).

Legend: 🔴 Breaks the feature / security · 🟠 Wrong or missing behavior · 🟡 Polish / edge case

---

## How it works today (baseline)

- `groups` (name, `created_by`, `recurrence_interval` weekly/monthly/yearly/manual,
  `unlock_duration_hours`, `next_capsule_at`, `last_capsule_at`) + `group_members`
  (unique `(group_id, user_id)`), both RLS'd via `get_my_group_ids()` SECURITY DEFINER.
  `capsules.group_id` (nullable, `on delete set null`) links capsules back.
- **Creation** (`CreateGroupScreen` → `createGroup`): insert group → insert creator
  member → insert other members. Members picked via a user search.
- **Scheduled capsules**: a per-minute cron (EXISTS-gated since PERFORMANCE #4) hits the
  `create-group-capsules` edge function, which finds groups with
  `next_capsule_at <= now()`, creates a capsule owned by `created_by` (title
  `"{name} — {Month Year}"`, unlock = now + duration, surprise mode on), inserts **all**
  group members as *joined* `capsule_members`, inserts `invite` notifications
  (`pushed_at` pre-stamped), advances `next_capsule_at`, and sends Expo pushes.
- **Manual capsules**: any group member taps "Start New Capsule" in `GroupDetail` →
  `CreateScreen` with `groupId` → capsule created with *them* as owner, other group
  members inserted as **pending** invites + `send-invite-push` per member.
- **Home**: horizontal group cards (`useCachedFetch('groups')`, embedded member count).
- **GroupDetail**: member avatars, recurrence/next badges, capsule list (scoped to
  capsules the viewer actually joined), creator-only Delete, member Leave.

---

## 🔴 Critical

### 1. Anyone holding a group's UUID can add themselves to the group (RLS self-insert arm)
**File:** `supabase/migrations/20260625000000_groups.sql` (~line 55)

The `group_members` INSERT policy is:

```sql
(select created_by from public.groups where id = group_id) = (select auth.uid())
or user_id = (select auth.uid())   -- ← anyone can insert THEMSELVES into ANY group
```

The second arm was presumably copied from `capsule_members`' self-join pattern — but
capsules have a deliberate join flow (QR / `capsule://join` link, where possessing the
unguessable UUID *is* the invite). **Groups have no join/share flow at all**; no client
code self-inserts into `group_members`. The arm is pure attack surface.

And the group UUID is *not* private: `capsules.group_id` is a plain selectable column on
every group-created capsule, and `get_my_capsule_ids()` includes **pending** memberships
(no `joined_at` filter — verified in `20260515232500_capture_capsule_rls_and_helpers.sql`).
So anyone merely *invited* to a single group capsule — e.g. via the capsule's InviteModal
by any member — can read `group_id` off the capsule row, insert themselves into
`group_members`, and from then on: appear in the member list, see the group's full
capsule history metadata, and **be auto-joined into every future recurring capsule**
(the cron adds all `group_members` unconditionally).

**Fix:** drop the `or user_id = (select auth.uid())` arm until a real group-invite flow
exists (then reintroduce behind an invitation token/RPC, like `capsule_join_preview`).
Creator-adds-members is the only flow the client actually performs today.

### 2. The cron has no idempotency claim — duplicate or silently-lost cycles
**File:** `supabase/functions/create-group-capsules/index.ts` (`processGroup`)

`next_capsule_at` is only advanced at the **end** of `processGroup`, after the capsule
insert, a members select, a members insert, and a notifications insert. Two failure
shapes fall through:

- **Duplicates:** the per-minute cron's `net.http_post` is fire-and-forget; if one
  invocation is slow (cold start + several groups) and overlaps the next tick, both read
  the same due group and both create a capsule. Contrast `unlock-capsules`, which is
  naturally idempotent (`.eq('status','active')` filter), and `dispatchReminders`, which
  does an atomic claim-and-stamp `update … .is(sent_at, null) … .select()`. This
  function has neither.
- **Lost cycles:** conversely, if the function crashes *after* the capsule insert but
  the capsule ends up unusable (see #3), `next_capsule_at` still advances — that
  recurrence period's capsule is silently gone; nothing retries.

**Fix:** claim first, atomically —
`update groups set next_capsule_at = <next>, last_capsule_at = now() where id = X and next_capsule_at <= now() … select` —
and only proceed to create the capsule for rows the update actually claimed. A crash
after the claim loses at most one cycle (already true today) but can never duplicate.

### 3. Unchecked inserts can orphan a capsule nobody can see — including its owner
**File:** `create-group-capsules/index.ts` (~lines 76–95)

The `capsule_members` insert result is never checked. If it fails (transient error,
constraint), the capsule row exists but has **zero member rows** — and the `capsules`
SELECT policy is membership-gated via `get_my_capsule_ids()`, with **no owner_id
fallback**. Result: a capsule invisible to every member *and to its owner*, unreachable
and undeletable from the client, while `next_capsule_at` advances as if the cycle
succeeded. The notifications insert is equally unchecked (members join silently with no
alert). Same class of issue in the client: `createGroup`'s other-members insert
(`groups.ts` ~line 107) is unchecked — a partial failure yields a "group" containing
only the creator with no error surfaced. And if the *creator-member* insert fails
(line 98), the group row is never rolled back: an orphan group invisible even to its
creator (`groups` SELECT requires membership), cleanable only by raw id.

**Fix:** check every insert; on `capsule_members` failure delete the just-created
capsule row (service role can) and **don't** advance the schedule so the next tick
retries. In `createGroup`, delete the group row if the creator-member insert fails.

### 4. Push send isn't chunked to ≤100 — the fix that went to the other two senders missed this one
**File:** `create-group-capsules/index.ts` (`sendPushes`)

PERFORMANCE.md #10 established that Expo rejects a request with >100 messages — the
**whole batch** fails — and both `unlock-capsules` and `send-superlative-pushes` were
routed through a chunking `sendExpoPush()` helper. `create-group-capsules` still POSTs
the entire `messages` array in one `fetch` (and omits the `Accept: application/json`
header the other two send). A 100+ member group's "new capsule" pushes silently all
drop. **Fix:** copy the same ≤100-chunk helper here.

---

## 🟠 Missing behavior / wrong behavior

### 5. A group is frozen at creation: no edit, no add-member, no remove-member UI
**Files:** `src/lib/groups.ts`, `GroupDetailScreen.tsx`

`updateGroup()` and `addGroupMember()` have **zero callers** — they're dead code. There
is no UI anywhere to: rename a group, change its recurrence, change its unlock duration,
add a member after creation, or (as creator) remove a member. `removeGroupMember()` is
only ever called as self-leave. If you typo the name or forget a person at creation,
your only option is delete-and-recreate — which detaches all existing capsules
(`group_id` set null) and loses the history view. The capsule equivalent
(`ManageMembersScreen`, `EditCapsuleScreen`) exists; groups got the data layer but never
the screens.

**Recommend:** an Edit Group screen (or inline sheet in GroupDetail) wiring up the two
dead functions + creator-removes-member rows, mirroring ManageMembers. Note when adding
members later: decide explicitly whether they join currently-active group capsules
(see #13) — today they'd only be included in future ones.

### 6. Manual vs cron capsules disagree on membership semantics (BUGS.md #9 — still open)
**Files:** `CreateScreen.tsx` (~line 219), `create-group-capsules/index.ts` (~line 80)

Manual "Start New Capsule": other members inserted `joined_at: null` (pending — must
Accept from Alerts). Cron: everyone inserted `joined_at: now()` (auto-joined), plus an
`invite`-type notification that renders in Alerts as "You were invited to X" with a
**"Joined" badge** — an invite card for something you never accepted. Same group, two
different consent models depending on who created the capsule.

**Recommend:** pick one. Group membership arguably *is* standing consent (you joined the
group to share capsules) — so auto-join in both paths and change the cron's notification
copy/type to a dedicated `group_capsule` type ("New capsule started in {group}") instead
of reusing `invite`. If instead pending-invite is the model, the cron should insert
pending rows — but then a recurring capsule could unlock with zero joined members.

### 7. Silent failures throughout the group data layer (violates the toast rule)
**Files:** `src/lib/groups.ts`, `GroupDetailScreen.tsx`

The repo-wide rule (CLAUDE.md, UX.md 7.1, shipped in PR #18) is *any user-initiated
mutation that fails must toast*. Groups predate it and were missed:

- `deleteGroup()` / `removeGroupMember()` return `void`, errors discarded.
  `handleDelete`/`handleLeave` then `cache.invalidate('groups')` + `goBack()`
  unconditionally — a failed delete/leave looks successful until the group reappears.
- `getGroup`/`listMyGroups`/`getGroupMembers` destructure `data` without checking
  `error` — a transient network failure renders **"Group not found"** (GroupDetail's
  empty state) rather than a retry affordance, and Home's groups section silently shows
  nothing.

**Fix:** return `{ error }` from the mutations, toast + skip navigation on failure;
distinguish error-vs-empty in the fetchers (throw so `useCachedFetch`'s
loading/retry path handles it).

### 8. Cron capsules never get default awards; manual ones do
**Files:** `create-group-capsules/index.ts`, `CreateScreen.tsx` (~line 197)

A manually-started group capsule goes through `CreateScreen`, which seeds 4 default
superlatives via `set_default_superlatives`. The cron's `processGroup` never calls it —
recurring capsules unlock with an empty Awards section unless members suggested
categories themselves. `occasion` is also unset (defaults `'general'`), and there's no
per-group occasion setting to drive a theme. **Fix:** call `set_default_superlatives`
(service role passes the owner check? — it doesn't: the RPC authorizes
`auth.uid() = owner_id`, which is null for service role. **[verify live]** — the RPC's
`is distinct from` check means null uid ≠ owner → it would *refuse*. The function would
need a service-role bypass or the insert done directly with `is_default: true`).

### 9. Creator is a single point of failure: no ownership transfer, cascade on account deletion
**Files:** `20260625000000_groups.sql` (line 7), `20260608000000_delete_account.sql`

- `groups.created_by references users(id) on delete cascade` — when the creator deletes
  their account (`delete_my_account` predates groups and was never updated), every group
  they created **vanishes for all members** with no warning, no notification, and no
  mention in the delete-account confirmation sheet ("deletes … the capsules you own, and
  your votes" — groups unlisted).
- The creator also cannot *leave* a group (UI offers only Delete), and there is no
  transfer-ownership path. All admin power (edit/delete/add — once those exist) dies
  with the creator.

**Recommend:** at minimum list groups in the delete-account sheet copy; better, add
ownership transfer (or promote-eldest-member on creator deletion) before launch.

### 10. `check_cron_secret` exists only in the live DB — never captured in a migration
**File:** `create-group-capsules/index.ts` (~line 28)

The function authorizes via `supabase.rpc('check_cron_secret', { provided })` — an RPC
that appears in the generated types (`src/types/supabase.ts:805`, so it *is* live) but
in **no migration file**. This is the exact out-of-band-object failure mode CLAUDE.md
warns about (`get_my_capsule_ids` history, `home_layout` grant): a restore-from-
migrations would silently 401 every cron tick and **groups would stop producing capsules
with no visible error**. It's also a third auth mechanism (vs. the other two functions'
`CRON_SECRET` env var) for no documented reason. **Fix:** capture the function body in a
migration (**[verify live]** — pull the definition via `pg_get_functiondef` first) and
note the divergent auth style in CLAUDE.md, or converge on the env-var approach.

### 11. Blocked-users filtering skips every group surface
**Files:** `CreateGroupScreen.tsx` (search), `GroupDetailScreen.tsx` (member list)

CLAUDE.md's block-enforcement contract lists the filter sites (media, reactions,
InviteModal search) — groups were added later and never wired in: the CreateGroup member
search happily returns users you've blocked (InviteModal excludes them), the GroupDetail
member list renders them, and the cron will co-mingle blocker and blocked in every
recurring capsule. The last is arguably inherent to shared groups (same as capsules),
but the **search parity** is a straightforward miss. **Fix:** `blockStore.has()` filter
in `handleSearchChange`, matching InviteModal.

### 12. Manual capsule creation doesn't interact with the schedule
**Files:** `CreateScreen.tsx` group branch, `create-group-capsules/index.ts`

"Start New Capsule" never touches `next_capsule_at`/`last_capsule_at`, so a scheduled
group can get a manual capsule today and the cron's capsule tomorrow — two near-identical
capsules in quick succession with no guard, warning, or "skip this cycle" option. Also:
**any** member can start a manual capsule and becomes its owner — the group *creator*
lands as a pending contributor in their own group's capsule. Legal, but nothing in the
UI explains the ownership asymmetry. **Recommend:** decide whether manual creation
should push `next_capsule_at` out one interval (probably yes for weekly), or at least
show "next auto-capsule in N days" on the create flow.

---

## 🟡 Polish / edge cases

### 13. Late-joining members and active capsules — under-specified
A member added after a capsule was created (only possible via the cron reading current
membership, or future add-member UI) is not backfilled into active group capsules —
GroupDetail's capsule list correctly hides capsules they're not in, so different members
see different history lengths with no explanation. Fine as a decision; undocumented as
one.

### 14. Monthly recurrence drifts
`calcNextAt` uses `setMonth(+1)` from **processing time**, not the scheduled time:
Jan 31 → Mar 3 (JS date overflow), and each cycle re-anchors to whenever the cron
actually ran, so a "monthly on the 15th" group slowly walks forward. Weekly/yearly are
safe from overflow but still drift by processing latency. **Fix:** compute from the
*previous* `next_capsule_at`, not `now()`, and clamp day-of-month.

### 15. Title collisions and UTC month
Titles are `"{name} — {Month Year}"` — a **weekly** group produces four identical
"Friends — July 2026" capsules per month; the month is computed in server UTC so
capsules created near month boundaries can be labeled with the "wrong" month for every
member. Include the day (or ISO week) for weekly groups.

### 16. Solo/inactive groups generate content forever
A group with one member (creation allows zero invitees) on a weekly schedule creates 52
capsules/year indefinitely — no member-count floor, no auto-pause after N unopened
capsules, no way to pause a schedule short of switching to `manual` (which requires the
missing edit UI — see #5).

### 17. Cron capsule settings are hardcoded
`owner_preview_locked: true`, no `contribution_lock_at`, `superlative_voting_hours`
defaulting (48) — none configurable per group. The group's one knob is unlock duration.
Fine for v1; worth a line in CLAUDE.md so it reads as a decision, not an omission.

### 18. `unlockDurationLabel` is broken and unused
Imported by CreateGroupScreen but never called (options carry their own labels). Its
math also mislabels: 4380h ("6 months" in `DURATION_OPTIONS`) → falls through to
`"183d"`. Delete it or fix the divisor logic before someone wires it in.

### 19. GroupDetail missed the a11y sweep
The back arrow, creator trash icon, and leave (exit) icon are icon-only touchables with
no `accessibilityLabel`/`accessibilityRole` — the app-wide pass (PR #18) didn't touch
this screen. Member bubbles also don't indicate who the creator is (no crown/badge), so
non-creators can't tell who can delete the group.

### 20. Stale caches after cron activity
When the cron creates a capsule there's no push-driven cache invalidation —
`groups`/`group-capsules:{id}`/`capsules` caches serve stale data until TTL expiry or
pull-to-refresh. The push notification's tap handler routes to the new capsule (fine),
but Home's group card and GroupDetail won't reflect it if the user navigates in
manually. Acceptable; note that the notification tap is the *only* fresh path.

### 21. `notify_on_invite` trigger interplay is unverified **[verify live]**
The trigger's body exists only in the live DB (referenced by
`20260515232248_security_hardening.sql`, defined nowhere in the repo). Two paths depend
on its exact firing condition:
- If it fires on **all** `capsule_members` inserts, the cron's explicit notifications
  insert produces **duplicate** invite cards per member per cycle.
- If it fires only for `joined_at IS NULL` rows, the cron path is single-notification
  (consistent with BUGS.md #9's observation) — but then PR #12's QR/deep-link self-join
  comment ("the trigger already covers it") is wrong, harmlessly (a self-join doesn't
  need a notification).
Pull `pg_get_functiondef('public.notify_on_invite'::regproc)` and capture it in a
migration either way.

### 22. CLAUDE.md has no Groups section
The entire feature — schema, RLS helpers, cron, edge function auth, the two dead data-
layer functions, manual-vs-cron semantics — is documented only as a one-line cache-keys
note. Every comparably-sized feature (Superlatives, Proximity, Surprise Mode, Friends,
Moderation) has a dedicated section. Write one when the fixes above land.

---

## What's solid (keep)

- `get_my_group_ids()` SECURITY DEFINER helper correctly avoids the self-referential
  policy recursion the capsule tables once had.
- Creator-then-others insert ordering in `createGroup` (so RLS checks resolve) is
  correct and documented in-code.
- GroupDetail's capsule query (`capsule_members!inner` + `joined_at not null` filter,
  server-side `group_id` filter) is both correct and efficient.
- The embedded `group_members(count)` aggregate (PERFORMANCE #6) — one round-trip.
- `capsules.group_id on delete set null` + accurate delete-confirm copy ("won't delete
  any existing capsules").
- The cron's EXISTS gate (PERFORMANCE #4) covers this job.
- Leave-group semantics (stay in existing capsules, excluded from future ones) match
  the confirm-modal copy exactly.

---

## Suggested order of attack

1. **#1 RLS self-insert arm** — one-line policy change, real privilege escalation. Ship first.
2. **#2 + #3 cron claim + insert checks** — data integrity of the core loop; one function.
3. **#4 push chunking** — copy the existing helper; trivial.
4. **#10 capture `check_cron_secret`** + **#21 trigger verification** — restore-safety, needs live DB access.
5. **#7 toast/error sweep in groups.ts** — brings groups up to the app-wide rule.
6. **#5 Edit Group + member management UI** — the biggest missing feature surface.
7. **#6 membership-semantics decision** (with #8 default awards, #12 schedule interplay) — one coherent "recurring capsule" behavior pass.
8. **#9 ownership transfer / delete-account copy** — before launch.
9. Remainder (#11, #13–#20, #22) as a polish wave.
