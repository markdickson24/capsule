# QR scan-to-join audit — 2026-07-24

Scope: `QRScannerScreen`, the `capsule_join_preview` RPC, the QR/invite URL, and the `/join/*` Netlify Edge Function that URL resolves to.

**Verdict: the in-app scanner works. Everything outside the app is broken.**

---

## P0 — RESOLVED. `/join/*` now returns 200 and invites work.

> **Outcome:** `/join/<id>` → `200`, `x-join-fn: degraded`, page contains the
> `capsule://join/<id>` redirect. `/join/<id>/image` → `302` to the static OG
> image. QR codes and shared invite links open the app again.
>
> **What the delay actually was:** Netlify build credits were exhausted, so three
> successive commits never deployed. Two rounds of fixes appeared to change
> nothing because neither shipped — not because the diagnosis was wrong. Once
> credits were restored the first deploy confirmed both fixes work. The
> `X-Join-Fn` header exists to make "not deployed" and "still broken"
> distinguishable next time; it was added a round too late to help here.
>
> **Still outstanding:** `degraded` means the edge function still can't read
> Supabase, so previews say *"Someone invited you to a Capsule"* rather than the
> real title and owner. The invite itself is unaffected. Set `SUPABASE_URL` and
> `SUPABASE_SERVICE_ROLE_KEY` (or `SUPABASE_ANON_KEY`) in Netlify env vars **with
> the Edge Functions scope enabled** — the function now logs exactly which are
> missing. `x-join-fn` flips to `ok` when it's right.
>
> Genuinely-missing capsules currently return 200 rather than 404, which is
> correct while the data source is unreachable: without it, "missing" and
> "can't ask" are indistinguishable, and failing open protects the invite. That
> reverts to a proper 404 once the env vars land.

### Original finding

`/join/*` returned HTTP 500. Every invite link and QR code was dead.

```
$ curl -s -o /dev/null -w "%{http_code}" https://getcapsuleapp.com/join/<any-id>
500
$ curl -s https://getcapsuleapp.com/join/abc
uncaught exception during edge function invocation
```

This is not QR-specific. That URL is generated in **three** places, all currently landing on a 500:

| Call site | What breaks |
|---|---|
| `CapsuleDetailScreen.tsx:498` | the QR code owners show in person |
| `CapsuleDetailScreen.tsx:355` | the "Invite people" share-sheet message |
| `OnboardingScreen.tsx:375` | the share at the end of onboarding |

So: anyone who points their **phone camera** at the QR (which is what people actually do), or taps a shared invite link, gets a Netlify error page. The app never opens. This is the entire invite-acquisition funnel outside of in-app push invites.

**Why it's crashing.** All three routes fail identically — including `/join/not-a-uuid`, which should short-circuit to a 404. That rules out the RPC and the SVG rasteriser, and points at the only code that runs before any branching or error handling:

```ts
const supabase = createClient(
  Netlify.env.get("SUPABASE_URL")!,
  Netlify.env.get("SUPABASE_SERVICE_ROLE_KEY")!
);
```

With those unset, `createClient(undefined, undefined)` throws, `fetchPreview` has no try/catch, and the request 500s. Both remote imports (`esm.sh/@supabase/supabase-js@2`, `deno.land/x/resvg_wasm@0.2.0`) return 200, so it isn't a dependency failure.

`docs/superpowers/plans/2026-07-20-capsule-link-preview.md` says these are set "in the Netlify dashboard UI (Site configuration → Environment variables → **Functions scope**)". Netlify scopes environment variables separately, and **Edge Functions** are not the same scope as Functions. Either the variables were never set, or they're set at a scope the edge runtime can't read.

**Fix (needs Netlify dashboard access — I'm not logged in):** Site configuration → Environment variables → confirm `SUPABASE_URL` and `SUPABASE_SERVICE_ROLE_KEY` exist and that their scope includes **Edge Functions**. Redeploy.

**Verify:** `curl -sI https://getcapsuleapp.com/join/07f45265-f122-4ef9-82ac-b8c60895fe5d` → expect `200`, and the body should contain `capsule://join/`.

**Hardening worth doing regardless:** `fetchPreview` should fail closed rather than throw — a missing env var should render a "something went wrong" page, not a raw 500. Right now a config mistake takes down every invite link with no graceful degradation.

---

## P1 — A pending invite makes the QR unusable (still open, needs a decision)

`capsule_join_preview` computes:

```sql
already_member := exists (
  select 1 from capsule_members m2
  where m2.capsule_id = c.id and m2.user_id = auth.uid()
)
```

No `joined_at` filter — so a **pending** invite counts as "already a member". The same function's `member_count` *does* filter `joined_at is not null`, so it contradicts itself.

**The broken flow, which is a natural one:** an owner invites you from InviteModal (creates a pending row) *and* shows you the QR at the event. You scan → "Already a member" → the only action is Done. You cannot join, and nothing explains why. You're stuck until you find the invite in Alerts.

**Why the fix isn't a one-liner.** `capsule_members` has `UNIQUE (capsule_id, user_id)`. If the RPC simply excluded pending rows, the scanner would show "Accept Invite" → `INSERT` → 23505 unique violation. The correct handling is an **UPDATE** setting `joined_at` (the client is granted exactly that column — see CLAUDE.md's column-grant note), which means the RPC needs to report three states, not two: not a member / pending / joined.

That's a return-signature change, so `CREATE OR REPLACE` won't do — it needs DROP + CREATE, and per CLAUDE.md **a signature-changing drop+create silently resets the function ACL**, so `grant execute to authenticated, service_role` must ship in the same migration or every caller breaks.

Given that, and given this touches a live function the edge function also calls, I've left it for your call rather than applying it. Say the word and I'll write the migration.

---

## Fixed in `1627f98`

| Issue | Detail |
|---|---|
| **Camera permanently dead** | `handleScan` bailed with a bare `return` when there was no session, leaving the scan guard set. `onBarcodeScanned` then stays `undefined` for the rest of the screen's life — no message, no recovery, while the hint still says "Try again". |
| **Duplicate scans** | The guard was React state. `onBarcodeScanned` fires per camera frame; two frames in one tick both read `false`, firing two preview RPCs and potentially two join inserts. Replaced with a `useRef` that flips synchronously. |
| **Stale error in the success sheet** | `scanError` was never cleared on a new scan, so a bad scan followed by a good one rendered the confirmation sheet with the old error inside it. |
| **"Please try again" on a full capsule** | `enforce_member_limit` raises `MEMBER_LIMIT_REACHED` here like every join path, but the user saw a generic retry message against a cap that will never move. Now named. |
| **23505 treated as failure** | Already-a-member (preview went stale — joined on another device, or accepted an invite between scan and tap) showed an error instead of just opening the capsule. |
| **Already-member dead-end** | Sheet offered only "Done". Added "Open capsule". |
| **Leaked timer** | The 2s re-arm timer could fire after unmount. Now cleared. |

Also added a `/join/*` CSP override in `landing/_headers`. The join page is an inline `<script>` that bounces to `capsule://join/<id>`, and the sitewide `script-src 'self'` I added during the SEO work would block it — silently killing every invite link the moment the 500 is fixed. Pre-emptive; couldn't be observed while the route 500s.

---

## Correction to the SEO audit

`audits/SEO_AUDIT_2026-07-24/` states there is no `netlify.toml` in the repo. **That is wrong** — one has existed at the repo root since 2026-07-20 (`d0d3728`), declaring `publish = "landing"`, a deploy-skip `ignore` rule, and the `/join/*` edge function binding.

No damage: it declares no `[[redirects]]` or `[[headers]]`, so the `landing/_redirects` and `landing/_headers` files I shipped merge cleanly with it — verified live (301s and security headers are both working). But the reasoning in that audit ("I can't verify the publish directory") was based on a false premise; the answer was in the file the whole time.

---

## Confirmed working

- **In-app scanning is unaffected by the 500.** The scanner regex-parses the URL locally and calls `capsule_join_preview` over the Supabase client — it never fetches `getcapsuleapp.com`. Scanning from inside the app works today.
- The regex accepts both `capsule://join/<id>` and `https://getcapsuleapp.com/join/<id>`, so old and new QR codes both scan.
- `capsule_join_preview` is `SECURITY DEFINER`, `STABLE`, `SET search_path = public`, and `EXECUTE` is granted to `authenticated` and `service_role`. Correct — the caller is by definition not yet a member, and the `capsules` SELECT policy is membership-gated, so a direct select would wrongly report "doesn't exist".
- Camera permission handling has a proper denied state with a grant button.
- Joining sets `joined_at` immediately rather than creating a second pending invite — correct, since scanning in person *is* the consent act.

## Not covered

Universal Links are not configured — no `apple-app-site-association` (404 at both well-known and root paths) and no `associatedDomains` in `app.json`. The flow deliberately uses a scheme redirect from an HTML page instead, with a 1200 ms fallback to the landing page carrying `?invited_by=`, which `landing/site.js` renders as a banner. That's a reasonable design and not a defect — but it does mean the Safari flash is expected, and it can't be removed without adding Universal Links.
