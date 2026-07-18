# App Store Launch Plan — final scan, 2026-07-18

Scan basis: `audits/APP_STORE_REVIEW.md` re-verified line-by-line this week
(`AUDIT_SWEEP_2026-07-17.md`), waves A–C + library video upload now merged to
main, live production DB checked for the demo-content items, and current
app.json / landing / native-dir state inspected today.

## ✅ Done and verified — the hard requirements are in

| Requirement | State |
|---|---|
| Sign in with Apple (4.8) | Shipped, **TestFlight-proven end-to-end**. `expo-apple-authentication` plugin injects the entitlement at EAS prebuild (local `ios/` dir is gitignored + stale — irrelevant to EAS builds). |
| Account deletion incl. storage (5.1.1(v)) | Server-side `delete_my_account` cleanup, live + e2e-verified. |
| Report + block mechanisms (1.2) | Built (flag in viewer, profile overflow, blocked-users screen). |
| Terms consent at signup + Support contact (1.2) | Wave B — consent line + Settings support row (`mark.dickson0824@gmail.com`). |
| Legal links point at a real domain (5.1.1/1.5) | Wave B — `getcapsuleapp.com/legal.html#privacy` / `#terms`. |
| Config hygiene (2.1/4.0) | Wave B — name "Capsule", `supportsTablet: false`, media-library plugin + save-permission string, non-circular purpose strings, deduped Android permissions, share-sheet name, `ITSAppUsesNonExemptEncryption: false`. |
| Email-confirmation dead-end (2.1) | Resolved (pendingEmail state + resend + sign-in handoff). |
| Save-to-photos crash path | Wave B — permission requested on both QR-save and viewer download. |
| Video from library | PR #43 — merged. |

## Live production verification (run via Supabase MCP, 2026-07-18)

- **Backend fully healthy:** all 7 edge functions ACTIVE at the expected
  versions (incl. this week's unlock-capsules v12 / create-group-capsules v6);
  all 6 cron jobs active; buckets correct (`capsule-media` private, `avatars`
  public); all migrations recorded.
- **getcapsuleapp.com is LIVE** — `/` and `/legal.html` both return 200, so
  Settings' legal links already resolve. But the deployed privacy policy is
  the waitlist-only version (11 "waitlist" mentions, no location/push-token
  coverage) — blocker 1 below stands; blocker 2 is now just "redeploy after
  the rewrite."
- **Demo capsules re-confirmed empty** (0 media on all three; two locked
  surprise-ON, unlocking mid/late August) — blocker 3 stands.
- **⚠️ One pending `content_report` (media / "nudity") has sat unactioned
  since 2026-07-08** — ten days. Even if it's a dev-test report, it proves
  the moderation-loop gap: triage it, and stand up the daily digest before
  a reviewer files one.
- **Security advisors:** (1) WARN — **leaked-password protection is disabled**
  (one dashboard toggle: Auth → enable HaveIBeenPwned check — do this before
  launch); (2) WARN — several SECURITY DEFINER RPCs are executable by `anon`
  (create_capsule_with_owner, check_in, capsule_join_preview, the id-helper
  functions). Every one has inline auth (`auth.uid()` checks), so none is an
  actual vulnerability, but the app never calls RPCs signed-out — a one-file
  hardening migration revoking anon execute across public RPCs is cheap
  insurance; (3) INFO — `contribution_activity_pending` deny-all RLS is
  deliberate (documented).

## 🚫 Blockers — do these before tapping Submit

**1. Privacy policy must cover the app, not just the waitlist.** (content, ~1–2h)
The live `legal.html` privacy section still enumerates only waitlist email +
request metadata (verified today). App Review reads this against the nutrition
labels; as written it fails 5.1.1's "accurate" bar. Add an app section
covering: photos/videos you upload, precise location (proximity check-in —
stored on your member row, used only to unlock), email + display name, push
tokens, bio/titles, account deletion (in-app, immediate, storage included),
and that nothing is sold/shared with third parties.

**2. Deploy the landing site** — the reworked landing + legal pages are still
uncommitted local files. Commit, deploy to `getcapsuleapp.com`, verify
`legal.html#privacy` resolves (Settings and the ASC field both point there).

**3. Seed the reviewer experience.** (needs your own photos — rights matter)
Live check: all three `facade00-` demo capsules have **zero media**, the two
active ones are surprise-mode-ON and unlock ~a month out. A reviewer sees a
locked, empty app → "unable to review" bounce. Fix in the demo account:
- One **unlocked** capsule with 15–25 real photos/videos and **finalized
  awards** (backdate `unlock_at`, let the cron finalize, or set the voting
  window to 1h and let it run).
- One **active** capsule, surprise **OFF**, `unlock_at` a few hours after your
  submission time (so the reviewer can watch a countdown AND you can re-arm it
  if review takes days — note in review notes that you'll keep it fresh).
- Demo credentials (email+password of the demo account) in App Review notes.
- Short screen-recorded **demo video** of proximity unlock + dual camera
  (needs two phones / a friend) — attach the link in review notes; reviewers
  can't exercise multi-device flows alone.

**4. Fresh EAS production build + TestFlight smoke pass.**
The Wave B config only takes effect in a new build (`eas build --platform ios
--profile production`; EAS preruns prebuild — nothing manual needed). Then on
device: Apple sign-in **name autofill retest** (needs a revoked authorization
or fresh Apple ID), Add Media video pick (≤2min + >2min skip toast), sealed
ceremony, QR-save permission prompt, hold-to-record through the mic prompt,
password reset + email confirmation end-to-end, dual camera (still
device-unverified per project notes — if it misbehaves, hide the Dual option
for v1 rather than block launch).

**5. App Store Connect metadata.** (one sitting, ~1–2h)
- **Privacy nutrition labels:** Email, Name, Photos/Videos, **Precise
  Location**, User ID, Device ID (push token), User Content — all "linked to
  identity", none used for tracking → no ATT prompt.
- **Age rating questionnaire:** answer UGC questions honestly (report/block/
  delete all exist) → expect 12+ / Infrequent-Mild UGC.
- Privacy Policy URL → `https://getcapsuleapp.com/legal.html#privacy`;
  Support URL → landing page; screenshots (6.7" set minimum — you have the
  `LANDING_SCREENSHOTS.md` shot list + demo data doing double duty);
  description/keywords/subtitle; App Review notes from item 3.

## 🟡 Strongly recommended, not strictly blocking

- **Crash telemetry decision:** your uncommitted changes removed Sentry — the
  app currently launches blind. Recommend re-adding it (or a deliberate,
  written decision to launch without). If re-added, declare "Crash Data" in
  the nutrition labels.
- **Moderation loop (audit #13):** reports land in `content_reports` and
  nothing watches them. Minimal viable pre-launch: a daily digest (tiny cron →
  email/push to you) or a calendar reminder + saved SQL query, so a
  reviewer-filed test report gets acted on within 24h. `media.is_flagged` can
  stay dead schema for v1.
- **Monetization:** launch **free v1** (per the existing GTM plan — RevenueCat
  /tiers come later). Adding IAP now would add review surface for zero launch
  users.

## Deliberately post-launch (documented backlog)

Upload limits/quotas, universal HTTPS join links + web preview, pagination,
offline persistence, analytics, notification preferences, force-update
switch, bulk export, pinch-zoom, ownership transfer, leave-capsule,
delete-own-uploads (all in `AUDIT_SWEEP_2026-07-17.md`'s held section).

## Suggested order (at ~10 hrs/week)

1. **Session 1:** privacy-policy rewrite → commit + deploy landing → kick off
   EAS build → start demo-content seeding.
2. **Session 2:** finish seeding (photos, awards finalized, near-term capsule),
   record demo video, TestFlight smoke pass on the new build.
3. **Session 3:** ASC metadata + screenshots + review notes → **Submit**.
   Re-arm the demo countdown capsule if review stretches past its unlock.

Realistic submit date: within ~a week; Apple review typically 1–5 days.
