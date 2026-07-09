# Capsule — App Store Review Audit

A simulated App Review pass, done the way a nitpicky reviewer (and the automated
pre-checks before them) would approach the binary and its App Store Connect
listing. Based on `app.json`, `package.json`, the auth/settings/UGC code paths,
and the live DB schema. Nothing here has been fixed — this is a pre-submission
triage list.

Legend: ⛔ Near-certain rejection · 🟠 High risk / reviewer-dependent · 🟡 Nitpick or metadata gap

**Verdict up front:** as it stands the binary would be rejected on the first
pass — #1 (Sign in with Apple) and #3 (dead legal URLs) are mechanical,
no-judgment-required rejections, and #4 (reviewer sees a locked, empty app)
will trigger at minimum a "we were unable to review" bounce. The good news:
account deletion (5.1.1(v)) and report/block (1.2) — the two hardest UGC
requirements — are already built. Most of the rest is a few days of work.

---

## ⛔ 1. No Sign in with Apple — Guideline 4.8 (Login Services)

**Files:** `src/screens/auth/WelcomeScreen.tsx`, `LoginScreen.tsx`, `src/lib/googleAuth.ts`

The app offers **Google OAuth** as a login option. Guideline 4.8: an app that
uses a third-party login service **must also offer** a login option with the
required privacy features — in practice, Sign in with Apple. Email/password
alone does not exempt you; the moment the Google button exists, the requirement
triggers.

`expo-apple-authentication` is not in `package.json`, there is no Apple button
on either auth screen, and no `usesAppleSignIn` in `app.json`. This is one of
the most common — and most reliably enforced — rejections there is.

**Fix:** add `expo-apple-authentication` + `"usesAppleSignIn": true` in
`app.json` `ios`, enable the Apple provider in Supabase Auth, and render the
Apple button **above or equal to** Google on both Welcome and Login (Apple's
HIG asks that it not be visually subordinate). Supabase's
`signInWithIdToken({ provider: 'apple' })` pairs directly with
`AppleAuthentication.signInAsync`. Alternatively, remove Google login entirely
for v1 — email/password-only apps are exempt from 4.8.

---

## ⛔ 2. UGC app with no terms agreement at sign-up — Guideline 1.2

**Files:** `src/screens/auth/SignUpScreen.tsx`, `WelcomeScreen.tsx`

Apple's UGC checklist has four items:

| Requirement | Status |
|---|---|
| Method for filtering objectionable content | 🟡 Partial — see #8 |
| Mechanism to report offensive content | ✅ `ReportModal` (media + users) |
| Ability to block abusive users | ✅ `blocked_users` + client filtering |
| **Published contact information** | ❌ Nowhere in the app |
| *(and)* users must agree to terms (EULA) | ❌ No terms at sign-up |

Sign-up collects email + password and nothing else — no "By continuing you
agree to the Terms of Service" line, no link, no checkbox. CLAUDE.md itself
notes "EULA-at-signup … deferred." For a photo-sharing UGC app the reviewer
will check this specifically, and it costs about an hour: a static line of
linked text under the Sign Up button satisfies it (no checkbox required).

Also add a **support/contact row** in Settings (a `mailto:` to your support
address is enough) — "published contact information so users can easily reach
you" is an explicit 1.2 requirement, and the Settings Legal section is the
natural home.

---

## ⛔ 3. Privacy Policy / Terms URLs are placeholders — Guidelines 5.1.1 & 1.5

**File:** `src/screens/app/SettingsScreen.tsx:21-22`

```ts
const PRIVACY_URL = 'https://capsule.app/privacy';
const TERMS_URL = 'https://capsule.app/terms';
```

Do you own `capsule.app`? It's a premium single-word .app domain — almost
certainly not. A reviewer **will tap these links**. A parked page, a 404, or
someone else's site behind your "Privacy Policy" row is a rejection under
5.1.1 (privacy policy must be functional) and 1.5 (all links must work), and
arguably worse than having no link at all.

Separately, App Store Connect **requires a Privacy Policy URL in the metadata**
before you can even submit — the in-app link and the ASC field should point to
the same live page. A free Notion page, GitHub Pages, or your EAS-hosted domain
all pass; the content matters more than the hosting. There is no shipped
privacy policy document anywhere in this repo — it needs to be written (what
you collect: email, display name, photos/videos, **precise location**, push
tokens, crash data via Sentry; where it lives: Supabase/US; how to delete it:
in-app).

---

## ⛔ 4. The reviewer will experience a locked, empty app — Guideline 2.1 (App Completeness)

This is the structural problem unique to Capsule: **the entire payoff is
time-gated.** A reviewer installs, signs up, creates a capsule that unlocks in
a month, uploads a photo — and then sees a locked screen with a countdown.
Surprise mode (default ON) means they can't even see their own upload. From
their chair, the app's core feature is unverifiable, and "we were unable to
fully review your app" is a standard bounce.

**Fix — all in App Review notes (App Store Connect → App Review Information):**

1. **Provide a demo account** (required anyway for any login-gated app) that is
   pre-seeded with: one **already-unlocked** capsule full of media, awards
   finalized (so Superlatives render), and one capsule set to unlock **a few
   minutes into the future** so the reviewer can watch the unlock + push fire.
2. **Explain the concept in two sentences** at the top of the notes. Reviewers
   read notes when the app confuses them; write yours assuming they will.
3. **Explain proximity unlock explicitly** — a solo reviewer physically cannot
   test a "everyone must be together" unlock. Say so, and note that the demo
   account's capsules are all time-mode. Otherwise you risk a rejection for a
   feature they couldn't exercise.
4. If Supabase **email confirmation** is enabled, the reviewer creating a fresh
   account hits the dead-end flagged in UX.md §1 (no resend, no guidance) —
   either polish that flow or make sure the demo account sidesteps it.

---

## 🟠 5. `expo-media-library` has no config plugin entry — save-to-Photos may crash — Guideline 2.1

**Files:** `app.json` (plugins), `CapsuleDetailScreen.tsx:296` (`handleSaveQR`), `:633` (media download)

`expo-media-library` is in `package.json` but **not in the `plugins` array**,
so no `NSPhotoLibraryAddUsageDescription` is being injected with your copy. If
the final Info.plist lacks that key, tapping **Download** in the media viewer
or **Save QR** kills the app instantly (iOS hard-crashes on undescribed
permission access) — and both of those are buttons a curious reviewer taps. If
autolinking injects the library's default boilerplate string instead, you're
exposed to the 5.1.1 "purpose strings must explain the specific use" nitpick.

Also: `handleSaveQR` (line 296) calls `saveToLibraryAsync` **without ever
calling `requestPermissionsAsync`** — the other save site (line 633) requests
properly. If the user previously denied the permission, Save QR fails into the
generic catch with no path to Settings.

**Fix:** add to `app.json`:

```json
["expo-media-library", {
  "savePhotosPermission": "Capsule saves photos, videos, and QR invite codes you choose to download to your photo library."
}]
```

and mirror line 633's permission request in `handleSaveQR`. Then verify the
built Info.plist (`npx expo prebuild` and inspect) before submitting.

---

## 🟠 6. `supportsTablet: true` means you will be reviewed on an iPad — Guidelines 2.1 / 4.0

**File:** `app.json` → `ios.supportsTablet: true`

App Review famously tests on iPads. Declaring tablet support means every
screen must be *presentable* at iPad dimensions: the phone-designed tab bar,
the camera (dual-cam is iPhone-only and correctly gated, but plain
`CameraView` on iPad has different aspect ratios), modals, and the
portrait-only orientation lock all get judged at 11–13". Nothing in the repo
suggests iPad has ever been run once.

**Fix (pick one):**
- **Set `supportsTablet: false`** — the app still installs on iPad in scaled
  iPhone-compatibility mode, which reviewers accept without holding you to
  iPad layout standards. This is the pragmatic launch answer.
- Or actually test every screen on an iPad simulator before submitting.

Half-measures (keeping `true` because it "probably works") is how you donate a
review cycle to find out.

---

## 🟠 7. Account deletion leaves personal photos in storage — Guideline 5.1.1(v) substance

**Files:** `SettingsScreen.tsx` (`DeleteAccountModal.confirm`), migration `20260608000000_delete_account.sql`

The deletion *flow* exists and is genuinely good (in-app, no support-email
runaround, contribution choice). But the storage cleanup step has the **same
RLS blind spot as BUGS.md #1**: it collects `storage_key`s with client-side
`media` SELECTs, and the live `media` SELECT policy hides pre-unlock rows of
`owner_preview_locked` capsules **even from their owner**. Surprise mode is
the default, so for the typical user deleting their account:

- `ownedMedia` / `contribMedia` come back **missing every photo in every
  still-locked surprise capsule**,
- those files are never removed from the `capsule-media` bucket,
- then `delete_my_account` deletes the DB rows — orphaning the files with no
  remaining reference, under a user ID that no longer exists.

"Delete my account" that quietly retains the user's photos is exactly what
5.1.1(v) ("delete the account **along with their data**") and GDPR erasure are
about. A reviewer won't catch it; a data-subject request or an audit would.

**Fix:** move storage cleanup **into** `delete_my_account` (SECURITY DEFINER
can see everything) or an edge function with the service role — collect keys
server-side *before* the row deletes, then remove from storage. The client
should make one RPC call and no storage calls at all.

---

## 🟠 8. Privacy Nutrition Labels — declare everything, especially precise location

Not code — the App Store Connect privacy questionnaire, which you'll fill out
before first submission and which App Review cross-checks against observed
network behavior. Under-declaring is a metadata rejection (or post-launch
removal). What Capsule actually collects, all "linked to identity":

| Data type | Source |
|---|---|
| Email address | auth + `users.email` |
| Name | `users.display_name` |
| Photos or Videos | the entire product |
| **Precise Location** | `check_in` RPC stores `checkin_lat/lng` on `capsule_members` — this is *collected and stored server-side*, not just used on-device. The one everyone forgets. |
| User ID | Supabase `auth.uid` |
| Device ID / Push token | `users.push_token` |
| Crash data + performance diagnostics | **Sentry** (`@sentry/react-native` is in the plugin list) |
| Coarse location–adjacent content | user bio, capsule titles (User Content) |

None of it appears to be used for tracking across apps, so **no ATT prompt
needed** — answer "no" to tracking, and make sure Sentry's default options stay
that way (no ad IDs). Sentry 7.x ships its own privacy manifest, so the
`PrivacyInfo.xcprivacy` requirement is covered by the SDKs; your own app-level
declarations happen in ASC.

---

## 🟡 9. Share extension will display as "ShareExtension" in the share sheet

**File:** `app.json` → `iosShareExtensionName: "ShareExtension"`

That string is the user-visible label under your icon in the iOS share sheet.
CLAUDE.md says it should be "Capsule". Not a rejection, but it looks unfinished
in the single most public surface the app has outside itself. Set it to
`"Capsule"`.

## 🟡 10. App display name is lowercase "capsule"

**File:** `app.json` → `"name": "capsule"`

`expo.name` is the home-screen display name. Every screenshot, the share
sheet, and Spotlight will say "capsule". If that's intentional branding, fine —
but be consistent with your ASC listing name, or reviewers flag the mismatch
under 2.3 (accurate metadata).

## 🟡 11. Purpose strings are circular

**File:** `app.json` plugins

"Capsule needs camera access for the in-app camera" explains nothing — 5.1.1
asks *what the data is used for*, and reviewers do reject lazy strings. Better:

- Camera: "Capsule uses the camera to capture photos and videos for your time-locked capsules."
- Microphone: "Capsule uses the microphone to record audio when you capture videos."
- Location (already good, keep it): "…to unlock capsules when all members are together."
- Photos (picker string is fine).

## 🟡 12. Invite share message is a dead link for anyone without the app

**File:** `CapsuleDetailScreen.tsx:288` (`shareLink`)

`capsule://join/<id>` is a custom scheme: in iMessage/WhatsApp it renders as
plain text (not tappable) for most recipients, and does nothing for someone
without the app installed. A reviewer poking the Share button sees the app
inviting people via a link that visibly doesn't work — bad 2.1 optics, and
MARKETING.md already makes the growth case for a real HTTPS join page with
universal links. At minimum, reword the message so it doesn't present the URI
as a tappable link.

## 🟡 13. Reports exist, but nothing ever acts on them

**Files:** `content_reports` table, `media.is_flagged` (never written or read by any client code)

1.2 expects objectionable-content reports to be **acted on within 24 hours**
(Apple has emailed developers about this since 2021). Right now reports land
in a table nobody is watching, `is_flagged` is dead schema, and reported media
stays visible to the reporter forever. You don't need a moderation console for
v1, but you do need: (a) a real process — even "daily email digest of new
`content_reports` rows via a cron + manual service-role takedown" counts; (b)
ideally, hide reported media from the *reporter* immediately (client-side
filter, same mechanism as blocks). Have an answer ready if App Review asks how
reports are handled — they sometimes do for UGC apps.

## 🟡 14. Android `permissions` array has every entry duplicated

**File:** `app.json` → `android.permissions`

`RECORD_AUDIO`, `CAMERA`, `ACCESS_COARSE_LOCATION`, `ACCESS_FINE_LOCATION` are
each listed twice. Harmless to the build, but it's the kind of copy-paste
artifact that suggests the manifest was never reviewed. (Google Play, not
Apple — but you'll hit Play's own review eventually, and fine-location
declarations get scrutiny there.)

## 🟡 15. Age rating: answer the UGC questions honestly

ASC questionnaire, not code. Unfiltered/unmoderated UGC pushes ratings up;
with report+block+delete in place you can defensibly land at **12+**
("Infrequent/Mild" user-generated content exposure). Do not answer "None" on
UGC — the reviewer can see it's a photo-sharing app, and a mismatched rating
is a metadata rejection.

## 🟡 16. Review-cycle hygiene

- **ITSAppUsesNonExemptEncryption: false** — ✅ already set, saves a compliance
  question per build.
- **Demo video**: for the proximity-unlock and dual-camera features a reviewer
  can't reproduce, a 30-second screen recording linked in the review notes
  preempts the "feature could not be verified" bounce.
- **First submission of a social app from a new developer account** gets the
  slow, thorough queue. Budget 2–5 business days and at least one rejection
  round-trip into the July 15 plan — which means submitting by ~July 8, i.e.
  now.

---

## Pre-submission checklist (ordered)

1. ⛔ Add Sign in with Apple (or remove Google login) — #1
2. ⛔ Stand up real, live Privacy Policy + Terms pages; fix the two URLs; add the Privacy Policy URL to ASC — #3
3. ⛔ Terms-agreement line on Sign Up + support contact row in Settings — #2
4. ⛔ Demo account seeded with unlocked + about-to-unlock capsules; write thorough App Review notes — #4
5. 🟠 Add the `expo-media-library` plugin with a real purpose string; request permission in `handleSaveQR` — #5
6. 🟠 Set `supportsTablet: false` (or truly test iPad) — #6
7. 🟠 Move account-deletion storage cleanup server-side — #7
8. 🟠 Fill privacy labels including Precise Location + Sentry diagnostics — #8
9. 🟡 `iosShareExtensionName: "Capsule"`, display-name casing, purpose-string wording, dedupe Android permissions — #9–11, #14
10. 🟡 Decide the reports-handling process and be able to describe it — #13
11. 🟡 Age rating 12+ with honest UGC answers — #15
