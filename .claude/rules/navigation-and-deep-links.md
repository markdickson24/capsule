---
paths:
  - "src/navigation/**"
  - "src/types/navigation.ts"
  - "src/hooks/useDeepLinks.ts"
  - "src/lib/deepLinkRoute.ts"
  - "src/lib/navigationRef.ts"
  - "src/lib/pendingJoinStash.ts"
  - "src/lib/pendingOpenStash.ts"
  - "src/components/JoinCapsuleConfirm.tsx"
  - "src/screens/app/QRScannerScreen.tsx"
  - "src/screens/app/CreateScreen.tsx"
  - "netlify/**"
  - "App.tsx"
---

<!-- Trimmed from the original CLAUDE.md; backstory kept in HTML comments. Loads automatically when Claude reads a file matching `paths`. -->

## Navigation Structure

`AppNavigator` reads `users.onboarded_at` on mount → `initialRouteName` is `Onboarding` (null) or `Tabs` (set). Existing users backfilled to `now()`, so only new sign-ups hit the wizard.

```
RootNavigator (App.tsx)
  AuthNavigator  →  Welcome, Login, SignUp
  AppNavigator
    Onboarding      ← initial route if users.onboarded_at IS NULL
    Tabs (CustomTabBar)
      Home
      Create
      Camera          ← large center button, translates up 10px
      Notifications   ← labeled "Alerts"
      Profile
    CapsuleDetail     { capsuleId: string }
    PublicProfile     { userId: string }
    Preview           { uri: string; mediaType: 'photo'|'video'; facing?: 'front'|'back' }
                      (animation: 'none')
    ResetPassword     (no params — session set via deep link before navigating here)
    EditCapsule       { capsuleId: string }
    ManageMembers     { capsuleId: string }
    Settings          (no params — accent color picker, animation: 'slide_from_bottom')
    Onboarding        (no params — 4-step wizard, animation: 'fade')
```

Tab `Create` takes optional `{ presetTitle, presetDescription, pendingMedia }` route params (`presetTitle`/`presetDescription` from Onboarding step 4; `pendingMedia: PendingMedia[]` from `PreviewScreen`'s camera/share new-capsule flow, enqueued onto `uploadQueue` right after capsule creation so it shows the usual pending tiles / `Uploading n/N` / drain toast, retryable per item). `CapsuleDetail` opens with `justCreated: true` for the post-create invite nudge.

**`CreateScreen` progressive disclosure** — only **Name and Unlock date** show above "Lock Capsule"; Description, Unlock-When mode, Uploads Deadline, Voting window, Occasion, Surprise toggle live behind **"More options"** (collapsed, pre-defaulted `time`/48h/`general`/surprise-on), summarized when collapsed as e.g. `General · 48h voting · Surprise on`. `DefaultAwardsCard` is **not** on this screen — occasion is just a chip row selecting the pool for `pickDefaults(occasion)` → `set_default_superlatives` at submit (non-fatal), reviewed later via `<DefaultAwardsCard mode="manage">`. Unlock date is gated on `unlockMode !== 'proximity'` (mode toggle lives in "More options"). Validation is per-field (`errors: { title?, description?, unlockDate?, contribLockDate?, votingHours?, general? }`, red `inputError` border on the `TextInput` + inline text); on failing submit, `scrollToField` auto-expands "More options" if the invalid field is inside it, then scrolls to it. `general` is a bottom-of-form slot for account/system-level failures only.

**`navigationRef`** (`src/lib/navigationRef.ts`) — a `NavigationContainerRef` for imperative nav outside components (push tap, deep link handlers). Poll `navigationRef.isReady()` before `.navigate()`.

## Deep Links

Owned by `useDeepLinks` (`src/hooks/useDeepLinks.ts`), called from `RootNavigator` in `App.tsx`. Two routes:

- **`capsule://join/<capsuleId>`** — shows a confirmation sheet; **never writes membership on its own.** Custom schemes fire with no user gesture, so auto-joining on arrival was a forced-enrollment CSRF: `getcapsuleapp.com/join/<id>` auto-navigated on load, letting any page silently enroll a signed-in visitor into an attacker's capsule. <!-- History: exposed the visitor's profile to the attacker's member list, gave a push channel, auto-accepted a deliberately-pending invite, and chained with capsule://capsule/<id>/camera could preselect the camera. --> Both ends now gated: the web page requires a click (QR scan-to-join below), and the app routes through **`joinCapsuleConfirm`/`JoinCapsuleConfirmHost` (`src/components/JoinCapsuleConfirm.tsx`)** — module-level pub/sub, same idiom as `toast`/`limitSheet`, mounted beside `ToastHost`/`LimitSheetHost`. Fetches `capsule_join_preview`; mirrors `QRScannerScreen`'s three states: `already_member` → open only; `is_pending` → **UPDATE** `joined_at` (never INSERT, per `UNIQUE (capsule_id,user_id)`); neither → INSERT. `capsule_members` write happens only inside "Accept Invite". Signed-out taps stash to `pendingJoinStash`; drain opens the sheet, doesn't auto-join. No client-side `notifications` insert (no INSERT policy); `notify_on_invite` trigger fires off the `capsule_members` insert. `useDeepLinks(session)` writes the pending id to `src/lib/pendingJoinStash.ts` (idiom shared with `shareIntentStash`); a `useEffect` on session presence drains it post-sign-in.
- **`capsule://reset-password?code=<pkce code>`** — `supabase.auth.exchangeCodeForSession(code)`, then navigate to `ResetPassword`.

⚠️ **Client runs `flowType: 'pkce'` (`src/lib/supabase.ts`, both platforms); the implicit-token path is GONE — never reintroduce it.** Old shape was `capsule://reset-password#access_token=...&refresh_token=...` fed to `supabase.auth.setSession()`, `handleUrl` matching via `url.includes('reset-password')`. Custom schemes are unauthenticated — any site can fire `capsule://…` — so that let a malicious page hand the app its own tokens and sign the victim into the attacker's account (2026-07-29 audit, H-1, CWE-384). `exchangeCodeForSession` only succeeds when *this device* holds the `code_verifier` from the reset request, so an injected code is inert.

Consequences: reset links are **single-device by design** ("invalid or expired" elsewhere is the security property, not a bug); Supabase's "Reset Password" template **must emit `{{ .ConfirmationURL }}`** (a raw token link breaks reset for everyone); `googleAuth.ts` **depends on PKCE too** (`signInWithOAuth` returns `?code=` not `#access_token=`, so flipping `flowType` back breaks Google sign-in as well).

**Routing lives in `src/lib/deepLinkRoute.ts`** (pure, unit-tested `parseDeepLink`), not the hook. Strips the fragment **before** parsing (the `reset` variant can only carry a `code`, type-enforced) and matches exact path segments, never `.includes()`.

⚠️ **Never use the global `URL` class here.** RN's `URL` polyfill (`Libraries/Blob/URL.js`, via `Libraries/Core/setUpXHR.js`) regexes `host`/`hostname`/`pathname`/`origin` against `^https?://` — for `capsule://join/<id>` these return `''`/`'/'` on-device, and the constructor never throws on garbage (`try/catch` isn't a validity check). Breaks every deep link silently: type-checks clean (tsconfig's `lib: ["DOM"]` types the browser URL) and a Node test would pass (Node's `URL` is spec-correct). `parseDeepLink` hand-parses for this reason. (`protocol`/`search`/`searchParams`/`hash` *are* scheme-agnostic in the polyfill — why `googleAuth.ts` can still read params off its callback URL.)

Scheme `capsule://` is registered in `app.json`. **Custom schemes only work in native builds, not Expo Go.**

⚠️ **`NavigationContainer` has NO `linking` prop — don't add one.** `useDeepLinks` owns every `capsule://` URL via `Linking.addEventListener` + `getInitialURL`, routed through `navigationRef`. A `linking={{ prefixes: ['capsule://'] }}` prop makes React Navigation a second consumer; with no `config` it auto-derives screen names from path segments, so `capsule://capsule/<id>/camera` navigates to a screen literally named `capsule` (dev-only warning only; `useDeepLinks` still worked underneath). A `config` would fix the parse but leave two navigators reacting to one tap — one owner is the point.

## QR scan-to-join

Owners show a QR of **`https://getcapsuleapp.com/join/<id>`** (`InviteModal` in `CapsuleDetailScreen`), served by `/join/*` (`netlify/edge-functions/join.ts`) — OG tags for unfurls, then a script bouncing to `capsule://join/<id>`. Same URL used by CapsuleDetail's share sheet and Onboarding's share, so this function fails *open* (generic-copy redirect) on any data-fetch failure, 404s only on a genuine miss.

⚠️ **`netlify/edge-functions/join.ts` is public/unauthenticated, `capsule_join_preview` is SECURITY DEFINER with no membership check — every input it renders is attacker-supplied.** Four load-bearing rules (`20260802` wave):
- **Never auto-fire `capsule://join/<id>` on load** — renders a "Join <title>" button; the link fires only from the click handler.
- **`owner_avatar` (`users.avatar_url`, client-writable to any string) must never be fetched unvalidated** — `fetchAvatarDataUri` requires `https:` **and** an exact hostname match against the project's Supabase host, `redirect: "manual"` (else blind SSRF via Netlify's egress). Falls back to the initial-letter badge on failure.
- **Cap the avatar body at 512KB** via a streaming reader (not `content-length`, spoofable), base64'd in chunks (the old per-byte `binary +=` rope held ~25x the payload, could OOM the isolate and take co-tenant requests with it).
- **Clamp `title` before wrapping** — `capsules.title` has only a client-side 100-char cap and `wrapTitle`'s old shrink loop was O(n²); a CHECK constraint backstops length server-side but the clamp stays. Scanner regex accepts both https and `capsule://` forms; `QRScannerScreen` (Home → Scan QR) scans it. Preview data **must** come from `capsule_join_preview(p_capsule_id)` (SECURITY DEFINER), **not** a direct `capsules` select — that SELECT policy is membership-gated, so a non-member reads nothing. The RPC returns minimal fields, gated by possession of the unguessable UUID.

⚠️ **Reports three membership states, not two** — `already_member` (joined) and `is_pending` (invited, unaccepted) are mutually exclusive (previously a bare `exists` check with no `joined_at` filter dead-ended pending invitees). **`capsule_members` has `UNIQUE (capsule_id, user_id)`, so accepting a pending invite is an `UPDATE` of `joined_at`, never an `INSERT`** (23505 otherwise) — both `QRScannerScreen.joinCapsule` and `useDeepLinks.joinAndNavigate` branch on this. That fix needed DROP+CREATE (signature change), which silently reset the ACL — **`grant execute to authenticated, service_role` is load-bearing.** Self-join INSERT is allowed via `can_insert_capsule_member` (true when `p_user_id = auth.uid()`). "Accept Invite" joins immediately and navigates into the capsule, not Notifications. An invalid/empty lookup renders no sheet, so the scanner re-arms (`setScanned(false)` after ~2s) — else `onBarcodeScanned` stays `undefined` forever.

⚠️ **That re-grant itself omitted `anon` — the only role `join.ts` can authenticate as** (a public, signed-out page; calls `capsule_join_preview` with the anon key when no service-role key is configured — the intended path). `20260718120000_revoke_anon_rpc_execute.sql` had already stripped anon's PUBLIC grant project-wide on the wrong-for-this-function assumption that no RPC is ever called signed-out — every anonymous fetch of the join URL, including chat-app link-preview fetches, got permission-denied for weeks, and `fetchPreview()` degraded to generic copy (`<owner>` invited you to *'a Capsule'*). Fixed by `20260805030000_grant_join_preview_anon_execute.sql` (`grant execute on function public.capsule_join_preview(uuid) to anon`) — safe, since the RPC is gated only by UUID possession. **Lesson: re-grant to every role a function actually needs on a signature-change DROP+CREATE**, not just what the old grant list said.
