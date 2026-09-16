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

<!-- Moved verbatim from CLAUDE.md. Loads automatically when Claude reads a file matching `paths`. -->

## Navigation Structure

`AppNavigator` reads `users.onboarded_at` on mount and sets `initialRouteName` to `Onboarding` (if null) or `Tabs` (if set). Existing users were backfilled to `now()`, so only new sign-ups hit the wizard.

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

Tab `Create` accepts optional `{ presetTitle, presetDescription, pendingMedia }` route params. `presetTitle`/`presetDescription` are used by Onboarding step 4 preset cards. `pendingMedia` is a `PendingMedia[]` set by `PreviewScreen` when creating a new capsule from the camera/share flow — enqueued onto the background `uploadQueue` (see "Background Upload Queue") right after the capsule row is created, so the new capsule's screen shows the same pending tiles / `Uploading n/N` / truthful drain toast as any other upload, and a per-item failure is retryable instead of silently swallowed. `CapsuleDetail` is opened with `justCreated: true` in this navigation so it can show the post-create invite nudge (below).

**`CreateScreen` progressive disclosure** — only **Name and the Unlock date** are always visible above the "Lock Capsule" button. **Description, Unlock-When mode, Uploads Deadline, Voting window, Occasion, and the Surprise toggle** all live behind a **"More options"** disclosure (collapsed by default), showing a one-line summary of current values (e.g. `General · 48h voting · Surprise on`) when collapsed. Everything collapsed is pre-defaulted (`time` mode, 48h voting, `general` occasion, surprise on), so leaving it closed costs a new user nothing. **The default-awards preview (`DefaultAwardsCard`) is NOT on this screen** — the occasion is just a chip row; the 4 themed awards are seeded from it at submit time (`pickDefaults(occasion)` → `set_default_superlatives`, non-fatal on error) and the owner reviews/regenerates them on the capsule's own `<DefaultAwardsCard mode="manage">` (pre-unlock) — a better version one screen later, with the capsule actually existing. The above-the-fold Unlock date field is gated on `unlockMode !== 'proximity'`, and the mode toggle now lives inside "More options", so switching to proximity there hides the top date field (accepted — proximity is a power path). Validation is per-field (`errors: { title?, description?, unlockDate?, contribLockDate?, votingHours?, general? }`, an `inputError` red border on the failing `TextInput`, inline text under the field) rather than one message at the bottom — on a failing submit, `scrollToField` auto-expands "More options" first if the invalid field lives there (title/unlockDate are above the fold; description/contribLockDate/votingHours are inside), then scrolls it into view. `general` is still a single bottom-of-form slot, reserved for account/system-level failures (not signed in, capsule insert failed) that aren't tied to one input.

**`navigationRef`** (`src/lib/navigationRef.ts`) — a `NavigationContainerRef` used for imperative navigation from outside components (e.g. push notification tap handler, deep link handler). Poll `navigationRef.isReady()` before calling `.navigate()`.

**Deep links** — handled by `useDeepLinks` (`src/hooks/useDeepLinks.ts`), called from `RootNavigator` in `App.tsx`. Two routes:
- `capsule://join/<capsuleId>` — **shows a confirmation sheet; it does NOT write membership on its own.** ⚠️ It used to insert a joined `capsule_members` row (and silently accept a pending invite) the instant the URL arrived, on the reasoning that opening the link is the consent act. That reasoning fails for a *custom URL scheme*, which any web page can fire with no gesture: `getcapsuleapp.com/join/<id>` auto-navigated to it on load, so a cross-origin page could silently enroll any signed-in visitor into an attacker's capsule — exposing their profile to the attacker's member list, handing the attacker a push channel, auto-accepting an invite the user had deliberately left pending, and (chained with `capsule://capsule/<id>/camera`) opening their camera preselected to the attacker's capsule. **Both ends are now gated:** the web page requires a click (see "QR scan-to-join"), and the app routes through **`joinCapsuleConfirm`/`JoinCapsuleConfirmHost` (`src/components/JoinCapsuleConfirm.tsx`)** — a module-level pub/sub sheet in the same idiom as `toast`/`limitSheet`, mounted once in `App.tsx` beside `ToastHost`/`LimitSheetHost`. It fetches `capsule_join_preview` and mirrors `QRScannerScreen`'s three membership states (`already_member` → open only; `is_pending` → **UPDATE** `joined_at`, never INSERT, per the `UNIQUE (capsule_id,user_id)` note below; neither → INSERT). The `capsule_members` write happens only inside the "Accept Invite" press. Signed-out taps still stash to `pendingJoinStash`, but the drain now opens the sheet rather than auto-joining. No client-side `notifications` insert (there's no INSERT policy for it — always errored silently); the `notify_on_invite` trigger already fires off the `capsule_members` insert. **Signed-out taps are stashed, not dropped**: `useDeepLinks(session)` (the hook takes the session from `App.tsx`) writes the pending capsule id to `src/lib/pendingJoinStash.ts` (same module-level idiom as `shareIntentStash`) and a `useEffect` on session presence drains it after sign-in, running the same join+navigate.
- `capsule://reset-password?code=<pkce code>` — calls `supabase.auth.exchangeCodeForSession(code)`, then navigates to `ResetPassword`.

⚠️ **The client runs `flowType: 'pkce'` (`src/lib/supabase.ts`, BOTH platform branches) and the implicit-token path is GONE. Do not reintroduce it.** This link used to be `capsule://reset-password#access_token=...&refresh_token=...` fed straight into `supabase.auth.setSession()`, and `handleUrl` routed on `url.includes('reset-password')` — a substring match on the whole URL. iOS custom URL schemes are **unauthenticated**: any website can fire `capsule://…`, so a malicious page could hand the app its own tokens and silently sign the victim into the **attacker's** account, after which every photo they added uploaded into the attacker's capsules (2026-07-29 audit, H-1, CWE-384). `exchangeCodeForSession` only succeeds when *this device* holds the `code_verifier` stored when the reset was requested, so an injected code is inert.

Consequences worth knowing before changing anything here:
- **Reset links are single-device by design.** Request on one phone, open the email on another → "invalid or expired". That is the security property, not a bug.
- **The Supabase "Reset Password" email template must emit `{{ .ConfirmationURL }}`.** If it's ever customised to a raw token link, reset breaks for every user.
- **`googleAuth.ts` depends on this too.** Under PKCE, `signInWithOAuth` returns `?code=` instead of `#access_token=`, so that file exchanges the code as well. Flipping `flowType` back would break Google sign-in, not just reset.

**Routing lives in `src/lib/deepLinkRoute.ts`** (pure, unit-tested `parseDeepLink`), not inline in the hook. It strips the URL fragment **before** query/path parsing, so a token cannot structurally reach a route — the returned `reset` variant can only carry a `code`, enforced by the type — and routes on exact path-segment equality, never `.includes()`.

⚠️ **Do NOT use the global `URL` class to route these.** React Native replaces `URL` with its own polyfill (`Libraries/Blob/URL.js`, installed by `Libraries/Core/setUpXHR.js`) whose `host`/`hostname`/`pathname`/`origin` getters regex against `^https?://` — for `capsule://join/<id>` they return `''`/`'/'` on-device, and the constructor doesn't throw on garbage, so `try/catch` isn't a validity check. It would silently break **every** deep link while type-checking perfectly clean (tsconfig has `lib: ["DOM"]`, which types the *browser* URL), and a Node-based test would validate Node's correct WHATWG `URL` rather than the polyfill that actually ships. `parseDeepLink` hand-parses strings for this reason. (`protocol`, `search`/`searchParams` and `hash` *are* scheme-agnostic in the polyfill — which is why `googleAuth.ts` can still read params off its callback URL.)

The scheme `capsule://` is registered in `app.json`. **Custom URL schemes only work in native builds, not Expo Go.**

⚠️ **`NavigationContainer` deliberately has NO `linking` prop — don't add one.** `useDeepLinks` owns every `capsule://` URL through its own `Linking.addEventListener` + `getInitialURL`, routing via `navigationRef`. It used to also carry `linking={{ prefixes: ['capsule://'] }}`, which made React Navigation a *second* consumer of the same URLs; with no `config`, React Navigation auto-derives screen names from path segments, so `capsule://capsule/<id>/camera` became a navigate to a screen literally named `capsule`:

```
The action 'NAVIGATE' with payload {"name":"capsule","params":{"screen":"<uuid>", ...}}
was not handled by any navigator. Do you have a screen named 'capsule'?
```

Every shape hit this (`join/<id>`, `reset-password`, `capsule/<id>`) — it stayed unnoticed because it's a dev-only warning and `useDeepLinks` still navigated correctly underneath. Adding a `config` would fix the parse but leave two navigators reacting to one tap; one owner is the point.

**QR scan-to-join** — owners show a QR encoding **`https://getcapsuleapp.com/join/<id>`** (InviteModal in `CapsuleDetailScreen`), which is served by the `/join/*` Netlify Edge Function (`netlify/edge-functions/join.ts`) — real OG tags for unfurls, then an inline script bouncing to `capsule://join/<id>`. The same https URL is used by CapsuleDetail's share sheet and Onboarding's share, so a failure there takes out **every** invite path at once; the function therefore fails *open* (renders the redirect with generic copy) on any data-fetch failure, and 404s only on a genuine miss.

⚠️ **`netlify/edge-functions/join.ts` is fully public and unauthenticated, and `capsule_join_preview` is SECURITY DEFINER with no membership check — so every input it renders is attacker-supplied.** Four hardening rules there, all load-bearing (`20260802` security wave):
- **The page must never auto-fire `capsule://join/<id>`.** It renders a "Join <title>" **button**; the deep link navigates only from the click handler. Auto-firing on load was the web half of the forced-enrollment CSRF above.
- **`owner_avatar` is `users.avatar_url`, a column any user writes to an arbitrary string — never fetch it unvalidated.** `fetchAvatarDataUri` requires `https:` **and** an exact hostname match against the project's own Supabase host, with `redirect: "manual"`. Without this it was a blind SSRF from Netlify's egress: internal host/port probing via the 2s-timeout oracle, redirects followed. Anything failing validation falls back to the initial-letter badge.
- **Cap the avatar body.** 512KB, enforced by a streaming reader (not just `content-length`, which a hostile origin can lie about), and base64 in chunks — the old per-byte `binary +=` rope held ~25x the payload and could OOM the isolate, taking co-tenant `/join/*` requests with it.
- **Clamp `title` before wrapping.** `capsules.title` has only a *client-side* 100-char cap, and `wrapTitle`'s old shrink loop was O(n²). A CHECK constraint now backstops the length server-side, but the clamp stays. The scanner's regex accepts both the https and `capsule://` forms; `QRScannerScreen` (Home → Scan QR) scans it. The pre-join preview (title/owner/member-count) **must** come from the `capsule_join_preview(p_capsule_id)` SECURITY DEFINER RPC, **not** a direct `capsules` select — the `capsules` SELECT policy is membership-gated, so a non-member (i.e. anyone scanning to join) can't read the row directly and the scanner would wrongly report "doesn't exist or expired." The RPC returns only minimal non-sensitive fields, gated by possession of the (unguessable) capsule UUID.

⚠️ **It reports three membership states, not two** — `already_member` (joined for real) and `is_pending` (invited, never accepted) are mutually exclusive. `already_member` used to be a bare `exists` over `capsule_members` with no `joined_at` filter, so a pending invite read as "already a member" and the scanner dead-ended with only a Done button — reachable just by inviting someone *and* showing them the QR. **`capsule_members` has `UNIQUE (capsule_id, user_id)`, so accepting a pending invite is an `UPDATE` of `joined_at`, never an `INSERT`** (23505 otherwise). Both join paths — `QRScannerScreen.joinCapsule` and `useDeepLinks.joinAndNavigate` — branch on this. ⚠️ That fix was a signature change, so it needed DROP + CREATE, **which silently resets the function ACL** — the `grant execute to authenticated, service_role` is load-bearing, not decorative. The join INSERT itself is allowed for self-join (`can_insert_capsule_member` returns true when `p_user_id = auth.uid()`). Tapping "Accept Invite" joins immediately (`joined_at` set, same reasoning as the deep-link case above) and navigates into the capsule — not to Notifications. On an invalid/unrecognized QR or a lookup that comes back empty, no confirmation sheet renders, so the scanner explicitly re-arms itself (`setScanned(false)` after ~2s) — otherwise `onBarcodeScanned` stays `undefined` forever and the camera can never scan again despite the "Try again" copy.

⚠️ **That re-grant list (`authenticated, service_role`) was itself wrong — it omitted `anon`, which is the ONLY role `netlify/edge-functions/join.ts` can ever authenticate as.** The edge function has no user session (it's a public, signed-out unfurl page), so it calls `capsule_join_preview` with the Supabase **anon** key whenever no service-role key is configured in Netlify's Edge Functions env scope — the documented, intended path ("Service role is preferred, but the anon key is enough," per the RPC's original migration comment). A separate `20260718120000_revoke_anon_rpc_execute.sql` hardening pass had already stripped anon's implicit PUBLIC grant project-wide on the (generally correct, but wrong for this one function) reasoning that "the app never calls any RPC signed-out." Net effect, live in production for weeks: every anonymous fetch of `https://getcapsuleapp.com/join/<id>` — critically, the rich-link-preview fetch iMessage/WhatsApp/Slack/etc. make when a capsule invite is shared — got a permission-denied error from PostgREST, and `join.ts`'s `fetchPreview()` degraded to generic copy: "`<owner>` invited you to *'a Capsule'*" instead of the real title. Fixed by `20260805030000_grant_join_preview_anon_execute.sql` (`grant execute on function public.capsule_join_preview(uuid) to anon`) — safe to grant, since the RPC's whole design is "gated only by possession of the (unguessable) capsule UUID," the same trust model as this page already uses. **Lesson for next time a signature change forces a DROP+CREATE:** re-grant to every role that function *actually* needs, not just whatever the previous grant list happened to say — the previous list can itself be the bug.
