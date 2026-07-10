# Capsule — Capability Gap Audit ("what ties the app down")

The other audits cover what's broken (BUGS), slow (PERFORMANCE), or rough
(UX/UX_POLISH). This one covers what's **missing** — capabilities users will
assume exist, whose absence caps growth, retention, or trust. Every item was
verified against the code, not assumed. Cross-references point at the audit
that owns the fix when one already does.

Legend: 🔴 Actively constrains the core loop · 🟠 Will bite at scale or in a key persona's flow · 🟡 Expected-but-absent polish

---

## Getting content IN

### 🔴 1. You cannot upload a video from your photo library

**Evidence:** both pickers in `CapsuleDetailScreen` (`pickFromLibrary` ~1367,
`pickFromCamera` ~1381) use `MediaTypeOptions.Images`, and `uploadPhotos`
hardcodes `mediaType: 'photo'`. The only routes for video into a capsule are
the in-app camera (30-second cap) and the iOS share sheet.

**Why it ties the app down:** the flagship personas are the exact people whose
videos already live in their camera roll — wedding guests with clips of the
first dance, parents with months of baby videos. They will open "Add Photos,"
see no videos in the picker, and conclude Capsule doesn't do video, even
though the entire pipeline (upload, storage, viewer, thumbnails) already
supports it. This is a one-line picker change (`MediaTypeOptions.All`) plus
carrying the asset's real `mediaType`/`mimeType` through `uploadPhotos` — the
upload queue already handles video mime types. Rename the button while at it.
**Effort: hours. The highest capability-per-effort item in this document.**

### 🟠 2. No upload limits of any kind

**Evidence:** no client-side size check anywhere; `size_bytes` is recorded on
the `media` row but never enforced; no per-capsule or per-user quota in the DB
or storage policies. A guest can share ten multi-hundred-MB videos from the
share sheet in one go.

**Why it ties the app down:** two ways. (1) Your storage bill is uncapped and
in strangers' hands — one wedding with a keen videographer costs real money
under the free tier. (2) The monetization plan is *built on* storage/quality
tiers — you can't sell an upgrade to a limit that doesn't exist. Enforce
server-side (a media-INSERT policy or trigger checking capsule totals), report
usage in the UI, and gate politely in the client. Do it before launch: adding
limits *after* users have unlimited habits is a downgrade; launching with them
is just the product.

### 🟡 3. Videos have no thumbnails on web

**Evidence:** `fetchPhotos` generates video thumbnails via
`expo-video-thumbnails` behind `Platform.OS !== 'web'`; `media.thumbnail_key`
exists in the schema but is never written. On web, video tiles render as blank
dark squares with a play icon.

**Fix owned by:** PERFORMANCE.md #2 (upload-time thumbnail generation fixes
web display *and* kills the every-device-downloads-the-whole-video problem in
one move).

---

## Getting content (and people) OUT

### 🔴 4. Links to Capsule lead nowhere

**Evidence:** every share surface emits `capsule://join/<id>` (invite share in
`CapsuleDetailScreen`, Onboarding's sealed screen). There is no web landing
page, no universal links / App Links, no OG tags, no App Store fallback for
recipients without the app.

**Why it ties the app down:** this is the growth ceiling. In iMessage the
invite renders as plain text — not tappable for most recipients, and
meaningless to anyone without the app installed. The product's whole
distribution model is "member invites member," and the invite artifact is a
dead string. A minimal `join.capsule-app.example/<id>` page (title + owner via
the existing `capsule_join_preview` RPC, OG tags, store badge, deep link if
installed) converts every shared link into an acquisition surface.
**Owned by:** MARKETING.md experiment #3 and UX.md §3 — listed here because
it's not just growth polish; without it, link sharing as a *capability*
doesn't exist.

### 🟠 5. No way to get your memories out in bulk

**Evidence:** download exists per-item only (`MediaViewerModal`'s save
button). No "download all," no export archive, no share-to-Photos batch.

**Why it ties the app down:** the product asks users to trust it with
irreplaceable memories, then offers them back one tap at a time — a 300-photo
wedding is 300 round trips. "Can I get my stuff out?" is a trust question, and
right now the honest answer is "technically." A zip-per-capsule edge function
(service role reads keys, streams an archive) or a client-side sequential
saver with progress would do. This also softens account-deletion anxiety and
is the kind of thing App Review and privacy-minded users poke at.

### 🟡 6. No pinch-to-zoom in the media viewer

**Evidence:** no zoom/pinch handling anywhere in `MediaViewerModal` — swipe
axes are locked for paging/dismissal only.

Photos of group moments get zoomed — finding yourself in the crowd shot is
half the fun of an unlock. Every native photo surface on iOS zooms;
its absence makes the viewer feel like a web view. Medium effort with plain
`Animated` + `PanResponder` (pinch scale + pan + double-tap-to-zoom).

---

## Account lifecycle

### 🔴 7. Account recovery only works if you already have the app working

**Evidence:** `resetPasswordForEmail` (LoginScreen ~48) sends a link that
redirects to `capsule://reset-password` — a custom scheme that only resolves
on a device with the native app installed; clicked from a desktop inbox it
does nothing. There is no change-password or change-email anywhere in
Settings, and no "resend confirmation" for the sign-up dead end (UX.md §1).

**Why it ties the app down:** locked-out users have literally no path back on
web, and a confused sign-up (unconfirmed email) has no path forward at all.
Every user lost here is lost silently. Fixes: point the reset redirect at a
tiny web page (pairs with #4's domain), add Change Password to Settings
(`supabase.auth.updateUser` — the ResetPassword screen already proves the
call works), and a resend button on the confirmation dead end.

### 🟠 8. Capsule ownership is a single point of failure

**Evidence:** no ownership-transfer path exists. `delete_my_account` deletes
every capsule the user owns — **including all other members' contributions**
(the modal copy says so, but members were never asked).

**Why it ties the app down:** the wedding capsule is owned by whoever created
it — often a maid of honor, not the couple. If that person deletes their
account, everyone's memories cascade away. For a product whose promise is
"your memories are safe until the date," one person's exit vaporizing a
group's shared archive is a broken promise. Add "Transfer ownership" in
ManageMembers (an `UPDATE capsules SET owner_id` RPC + role swap), and
consider making account-deletion orphan-with-warning (or offer transfer)
for capsules with other joined members instead of silently cascading.

### 🟠 9. Members can't leave a capsule

**Evidence:** `GroupDetailScreen` has `handleLeave`; capsules have nothing —
the only self-removal is declining the invite before accepting. Once joined,
you're in until the owner removes you.

Being trapped in a group space is a well-known dark pattern (and a blocked
user still shares capsules with their blocker — the block hides content but
not co-membership). A "Leave capsule" row in the members sheet — a
self-delete on `capsule_members`, which RLS likely already permits via the
delete policy (verify) — plus the same optimistic pattern used everywhere
else. Pairs naturally with #8.

### 🟠 10. Users can't delete their own uploads

**Evidence:** no client code path deletes a `media` row — the only media
deletion is capsule-delete and account-delete. Uploaded the wrong photo to
the wrong capsule? It's there until the capsule dies, and in surprise mode
you can't even see it to confirm what you sent.

Regret-deletion of your own content is a baseline UGC expectation (and
adjacent to the App Store 1.2 posture: users should control their own
content). Add uploader-delete in the viewer (`DELETE` on own `media` row +
storage key removal — the media DELETE RLS needs checking/adding), and a
"remove last upload" affordance for surprise-mode capsules where the grid is
hidden.

---

## Scale & resilience

### 🟠 11. Every list is an unbounded full fetch

**Evidence:** no `.range()`/`.limit()` on any main query — capsule media,
notifications, home capsules all fetch entire result sets; only user-search
uses limits. A 500-item wedding capsule means 500 media rows + one 500-key
`createSignedUrls` call + 500 grid cells on open.

Fine at beta scale, quadratically un-fine exactly when a capsule succeeds.
The event-pass persona (100+ guests) hits this first. Paginate the gallery
(the grid already has a "See all" boundary that's a natural page seam) and
cap notifications fetch at ~50. **Crossref:** PERFORMANCE.md's signing/index
items make the same queries cheaper; this makes them bounded.

### 🟠 12. Nothing survives a process kill or works offline

**Evidence:** `cache.ts` is in-memory by design ("lost on cold start");
the new upload queue is module-level memory; no persisted query cache. Cold
start with no network = skeletons → retry prompts, everywhere.

The core moments (wedding venues, parties, trips — see the persona list) are
precisely where connectivity is worst. The two highest-value slices, in
order: (1) persist the upload queue (AsyncStorage journal of pending local
URIs, resumed on launch) so "I added the photos" is never a lie; (2) persist
a last-known snapshot of `capsules` + per-capsule media lists so the app
opens to content instead of skeletons. Full offline sync is not needed;
"don't open blank, don't lose uploads" is.

### 🟡 13. No force-update or kill-switch mechanism

**Evidence:** no minimum-version check, no remote config, nothing gating an
old client from a newer schema.

The `home_layout` column-grant incident (CLAUDE.md) already demonstrated how
a server-side change silently breaks shipped clients. Once real users hold
old binaries, you have no lever: no way to say "this version must update."
A single `app_config` row (min_version, message) checked at launch is an
hour of work and buys you the ability to ever make a breaking change again.

---

## Operating blind

### 🔴 14. Zero product analytics

**Evidence:** `@sentry/react-native` is the only telemetry — crashes and
performance, no events. No analytics SDK, no event table, nothing.

**Why it ties the app down:** every number the marketing plan runs on —
activation rate, invites per capsule, join conversion, unlock attendance,
the north-star "weekly sealed group capsules" — is currently unmeasurable.
You cannot iterate on a funnel you can't see, and the ICE-scored experiments
in MARKETING.md all assume a measurement layer that doesn't exist. Lightest
viable version: a Supabase `events` table + a 20-line `track()` helper
(insert-only RLS), queryable with SQL you already know. A real SDK (PostHog
et al.) can come later; *something* must exist before the first beta wave,
or those users' behavior is data lost forever.

### 🟡 15. No notification preferences

**Evidence:** no per-capsule mute, no per-type toggles, no settings surface
for notifications at all — every reaction/suggestion/unlock in every capsule
pushes and lands in Alerts.

Unlock day for a 30-person capsule means a reaction-spam firehose with no
volume knob, and iOS users respond to un-mutable apps by revoking
notifications entirely — which kills the one push that matters (the unlock).
A `capsule_members.muted_at` column checked by the edge functions + a mute
row in the capsule detail sheet covers 80% of it.

---

## Platform asymmetries (known, listed for completeness)

- **Android:** dual camera unsupported (by design), mid-recording flip
  stitching has the documented rotation bug, no Play Store release motion
  yet — August campus timing (MARKETING.md) is the deadline that makes this
  matter.
- **Web:** no push (durable in-app rows only), no share intent, no video
  thumbnails (#3), camera degraded. Acceptable if web is explicitly the
  "view and react" tier — but nothing in the UI communicates that today.
- **iPad:** `supportsTablet: true` with phone-only layouts — owned by
  APP_STORE_REVIEW.md #6.

---

## Order of attack

| # | Item | Effort | Unlocks |
|---|---|---|---|
| 1 | Library video upload (#1) | Hours | The wedding/baby personas' actual media |
| 2 | Analytics events (#14) | 1 day | Every metric in the marketing plan |
| 3 | Join link web page (#4) | 2–3 days | Link sharing as a capability; growth loop |
| 4 | Password/email recovery paths (#7) | 1 day | Stops silent user loss |
| 5 | Upload quotas (#2) | 1–2 days | Cost safety + the thing the paid tier sells |
| 6 | Own-upload delete + leave capsule (#9, #10) | 1–2 days | Baseline UGC trust |
| 7 | Ownership transfer (#8) | 1 day | Group-memory safety |
| 8 | Pagination (#11) + persisted upload queue (#12) | 2–3 days | Survives success |
| 9 | Mute (#15), zoom (#6), bulk export (#5), kill switch (#13) | As capacity allows | Polish that compounds |
