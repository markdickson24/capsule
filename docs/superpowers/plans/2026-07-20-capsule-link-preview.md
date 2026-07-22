# Capsule Invite Link Preview Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking. **Task 5 is manual/dashboard-only and cannot be executed by a subagent** — it needs a human with Netlify login access.

**Goal:** Sharing a capsule (share sheet, QR code, onboarding invite) produces a rich preview card with a personalized image in messaging apps, and tapping the link opens the app if installed or falls back to the landing page with context.

**Architecture:** One Netlify Edge Function (`netlify/edge-functions/join.ts`) at `https://getcapsuleapp.com/join/<id>`, branching internally on whether the request path ends in `/image`. The page branch renders HTML with Open Graph tags and a JS redirect into `capsule://join/<id>`; the image branch builds an SVG card and rasterizes it to PNG via `resvg_wasm`. Both branches fetch capsule data via the `capsule_join_preview` RPC, called server-side with the Supabase service-role key (a Netlify env var, Functions scope). Four existing client call sites switch from `capsule://join/<id>` to the new `https://` URL; the QR *scanner* accepts both formats.

**Tech Stack:** Netlify Edge Functions (Deno), `@supabase/supabase-js` via esm.sh, `resvg_wasm` via deno.land/x, no new npm dependencies in the RN app.

## Global Constraints

- Edge function file: `netlify/edge-functions/join.ts`; registered name `join` in `netlify.toml` — the two must match exactly.
- Path pattern: `/join/*`. **One function handles both `/join/<id>` and `/join/<id>/image`** via an internal `isImage` branch — never split into two registered edge functions (wildcard path overlap between two functions is ambiguous; see the design doc's rationale).
- `netlify.toml` uses `publish = "landing"` with **no `base` key** — the edge function must live at repo-root `netlify/edge-functions/`, never inside `landing/` (that directory is the publish root; anything under it is served as a static file).
- resvg import pinned at exactly `https://deno.land/x/resvg_wasm@0.2.0/mod.ts` — no unpinned `mod.ts` import.
- Card image is exactly 1200×630px. Accent color in the generated SVG is `#FC6A5B` (must match `landing/styles.css`'s `--accent` — there is no shared source between the two; if the site's accent color ever changes again, this hex must be updated here too).
- Secrets (`SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`) are read via `Netlify.env.get(...)` and are set **only** in the Netlify dashboard UI (Site configuration → Environment variables → Functions scope) — never written into `netlify.toml` or any committed file.
- `src/hooks/useDeepLinks.ts` is not modified by this plan — it only ever receives `capsule://` URLs from the OS and needs no changes.
- The `/join/*` pages are never added to `landing/sitemap.xml` and must carry `<meta name="robots" content="noindex">` — they're private invite links, not public content.
- Redirect timeout (custom-scheme attempt → landing-page fallback): 1200ms.

---

### Task 1: Edge function routing, OG page, and redirect (static placeholder image)

**Files:**
- Modify: `netlify.toml`
- Create: `netlify/edge-functions/join.ts`

**Interfaces:**
- Produces: `join.ts` exports nothing (it's an edge function, default-exported handler + none else needed by other tasks), but Task 2 modifies this same file's `isImage` branch and imports/adds `buildCardSvg`/`wrapTitle`/`fetchAvatarDataUri`/`escapeXml` alongside the existing `fetchPreview`/`escapeHtml`/`renderPage` functions defined here. Keep those existing function names exactly as below so Task 2's diff applies against the same file cleanly.

- [ ] **Step 1: Replace `netlify.toml` in full**

```toml
# Landing page + capsule invite-link previews.
#
# Static site (landing/) + one Netlify Edge Function (netlify/edge-functions/,
# repo root — deliberately OUTSIDE publish so its source is never served as a
# static file; Netlify resolves the edge-functions directory relative to
# `base` when one is set, which would have put it inside the publish dir).
[build]
  publish = "landing"

  # Skip the deploy entirely when a commit doesn't touch either the landing
  # page or the edge function — most commits in this repo are app-side.
  ignore = "git diff --quiet $CACHED_COMMIT_REF $COMMIT_REF -- landing netlify"

[[edge_functions]]
  path = "/join/*"
  function = "join"
```

- [ ] **Step 2: Create `netlify/edge-functions/join.ts`**

```ts
import type { Config, Context } from "@netlify/edge-functions";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

interface JoinPreview {
  id: string;
  title: string;
  owner_name: string;
  owner_avatar: string | null;
  member_count: number;
  already_member: boolean;
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

async function fetchPreview(capsuleId: string): Promise<JoinPreview | null> {
  const supabase = createClient(
    Netlify.env.get("SUPABASE_URL")!,
    Netlify.env.get("SUPABASE_SERVICE_ROLE_KEY")!
  );
  const { data, error } = await supabase.rpc("capsule_join_preview", {
    p_capsule_id: capsuleId,
  });
  if (error || !data || !data[0]) return null;
  return data[0] as JoinPreview;
}

function formatDescription(memberCount: number): string {
  const subject = memberCount === 1 ? "1 person is" : `${memberCount} people are`;
  return `${subject} already in. Add your photos before it locks.`;
}

function renderPage(capsuleId: string, preview: JoinPreview): string {
  const title = escapeHtml(preview.title);
  const owner = escapeHtml(preview.owner_name);
  const description = formatDescription(preview.member_count);
  const pageUrl = `https://getcapsuleapp.com/join/${capsuleId}`;
  const imageUrl = `https://getcapsuleapp.com/join/${capsuleId}/image`;
  const appUrl = `capsule://join/${capsuleId}`;
  const fallbackUrl = `https://getcapsuleapp.com/?invited_by=${encodeURIComponent(preview.owner_name)}&capsule=${encodeURIComponent(preview.title)}`;

  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8" />
<meta name="viewport" content="width=device-width, initial-scale=1.0" />
<title>${owner} invited you to "${title}" — Capsule</title>
<meta name="robots" content="noindex" />
<meta name="description" content="${escapeHtml(description)}" />
<meta property="og:type" content="website" />
<meta property="og:url" content="${pageUrl}" />
<meta property="og:title" content="${owner} invited you to &quot;${title}&quot;" />
<meta property="og:description" content="${escapeHtml(description)}" />
<meta property="og:image" content="${imageUrl}" />
<meta property="og:image:width" content="1200" />
<meta property="og:image:height" content="630" />
<meta name="twitter:card" content="summary_large_image" />
<style>body{background:#0A0A0A;color:#fff;font-family:-apple-system,sans-serif;display:flex;align-items:center;justify-content:center;height:100vh;margin:0;}</style>
</head>
<body>
<p>Opening Capsule…</p>
<script>
  window.location.href = ${JSON.stringify(appUrl)};
  setTimeout(function () {
    window.location.href = ${JSON.stringify(fallbackUrl)};
  }, 1200);
</script>
</body>
</html>`;
}

export default async (req: Request, _context: Context) => {
  const url = new URL(req.url);
  const parts = url.pathname.split("/").filter(Boolean); // ["join", "<id>"] or ["join", "<id>", "image"]
  const capsuleId = parts[1];
  const isImage = parts[2] === "image";

  if (!capsuleId) {
    return new Response("Not found", { status: 404 });
  }

  const preview = await fetchPreview(capsuleId);
  if (!preview) {
    return new Response("This capsule doesn't exist or the invite has expired.", {
      status: 404,
      headers: { "Content-Type": "text/plain" },
    });
  }

  if (isImage) {
    // Task 2 replaces this stub with a real generated PNG.
    return Response.redirect("https://getcapsuleapp.com/logo.png", 302);
  }

  return new Response(renderPage(capsuleId, preview), {
    status: 200,
    headers: {
      "Content-Type": "text/html; charset=utf-8",
      "Cache-Control": "public, max-age=300",
    },
  });
};

export const config: Config = {
  path: "/join/*",
};
```

Note: `path` is declared both in `netlify.toml` and this file's `export const config`. Netlify accepts either mechanism — declaring it in `netlify.toml` is this repo's existing convention (matches how the rest of Netlify config is centralized there), so the inline `config` export exists only because Netlify requires *some* `Config` type usage to satisfy the `@netlify/edge-functions` type import in strict environments; if a later verification step shows it's genuinely redundant and causes a "path declared twice" warning in Netlify's build log, remove the `netlify.toml` `[[edge_functions]]` block instead of this one (keeping declarations file-local is easier to keep correct long-term) — call this out in the task's self-review rather than silently picking one now, since it can't be verified without an actual deploy.

- [ ] **Step 3: Commit**

```bash
git add netlify.toml netlify/edge-functions/join.ts
git commit -m "Add /join/<id> edge function: OG tags + redirect (static image stub)"
```

---

### Task 2: Dynamic personalized PNG image

**Files:**
- Modify: `netlify/edge-functions/join.ts`

**Interfaces:**
- Consumes: `JoinPreview` interface and `fetchPreview`/`escapeHtml` from Task 1 (unchanged).
- Produces: `wrapTitle(title, maxCharsPerLine, maxLines): string[]`, `buildCardSvg(preview, avatarDataUri): string`, `fetchAvatarDataUri(url): Promise<string|null>` — none consumed outside this file, but named exactly this way in case a future task needs them.

- [ ] **Step 1: Add the SVG/PNG generation functions**, inserting them after `formatDescription` and before `renderPage`:

```ts
const CARD_WIDTH = 1200;
const CARD_HEIGHT = 630;
const ACCENT = "#FC6A5B"; // must match landing/styles.css --accent

function escapeXml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}

// Greedy word-wrap into at most `maxLines` lines of at most `maxCharsPerLine`
// characters each. SVG <text> has no auto-wrap, so this runs before the SVG
// is built. If words remain after filling maxLines, the last line is
// truncated with an ellipsis rather than overflowing the card.
function wrapTitle(title: string, maxCharsPerLine: number, maxLines: number): string[] {
  const words = title.split(/\s+/).filter(Boolean);
  const lines: string[] = [];
  let current = "";
  let wordIndex = 0;

  while (wordIndex < words.length && lines.length < maxLines) {
    const word = words[wordIndex];
    const candidate = current ? `${current} ${word}` : word;
    if (candidate.length > maxCharsPerLine && current) {
      lines.push(current);
      current = "";
      continue; // retry this word on a new line
    }
    current = candidate;
    wordIndex++;
  }
  if (current && lines.length < maxLines) {
    lines.push(current);
  }

  const consumedAllWords = wordIndex >= words.length;
  if (!consumedAllWords && lines.length === maxLines) {
    const lastIndex = lines.length - 1;
    let last = lines[lastIndex];
    while (last.length > maxCharsPerLine - 1) last = last.slice(0, -1);
    lines[lastIndex] = last.replace(/\s+$/, "") + "…";
  }
  return lines;
}

// Best-effort: a slow or failing avatar fetch must never block the image
// response. Returns null on any failure, in which case buildCardSvg falls
// back to a plain initial-letter badge.
async function fetchAvatarDataUri(url: string | null): Promise<string | null> {
  if (!url) return null;
  try {
    const res = await fetch(url, { signal: AbortSignal.timeout(2000) });
    if (!res.ok) return null;
    const contentType = res.headers.get("content-type") ?? "image/jpeg";
    const bytes = new Uint8Array(await res.arrayBuffer());
    let binary = "";
    for (let i = 0; i < bytes.length; i++) binary += String.fromCharCode(bytes[i]);
    return `data:${contentType};base64,${btoa(binary)}`;
  } catch {
    return null;
  }
}

function buildCardSvg(preview: JoinPreview, avatarDataUri: string | null): string {
  const titleLines = wrapTitle(preview.title, 22, 2);
  const titleSvg = titleLines
    .map((line, i) => `<tspan x="80" dy="${i === 0 ? 0 : 64}">${escapeXml(line)}</tspan>`)
    .join("");

  const memberWord = preview.member_count === 1 ? "person" : "people";
  const subtitle = `${preview.member_count} ${memberWord} already in`;

  const avatarMarkup = avatarDataUri
    ? `<clipPath id="avatarClip"><circle cx="120" cy="120" r="40"/></clipPath>
       <image href="${avatarDataUri}" x="80" y="80" width="80" height="80" clip-path="url(#avatarClip)" preserveAspectRatio="xMidYMid slice"/>`
    : `<circle cx="120" cy="120" r="40" fill="${ACCENT}" fill-opacity="0.2"/>
       <text x="120" y="132" font-size="32" font-weight="700" fill="${ACCENT}" text-anchor="middle">${escapeXml(preview.owner_name.charAt(0).toUpperCase())}</text>`;

  return `<svg width="${CARD_WIDTH}" height="${CARD_HEIGHT}" viewBox="0 0 ${CARD_WIDTH} ${CARD_HEIGHT}" xmlns="http://www.w3.org/2000/svg">
  <defs>
    <radialGradient id="glow" cx="50%" cy="0%" r="80%">
      <stop offset="0%" stop-color="${ACCENT}" stop-opacity="0.25"/>
      <stop offset="100%" stop-color="${ACCENT}" stop-opacity="0"/>
    </radialGradient>
  </defs>
  <rect width="${CARD_WIDTH}" height="${CARD_HEIGHT}" fill="#0A0A0A"/>
  <rect width="${CARD_WIDTH}" height="${CARD_HEIGHT}" fill="url(#glow)"/>
  <g transform="translate(80,220)" stroke="${ACCENT}" stroke-width="6" fill="none" stroke-linecap="round" stroke-linejoin="round">
    <rect x="0" y="28" width="64" height="48" rx="8"/>
    <path d="M12 28V16a20 20 0 0 1 40 0v12"/>
  </g>
  <text x="80" y="400" font-size="56" font-weight="700" fill="#FFFFFF">${titleSvg}</text>
  ${avatarMarkup}
  <text x="176" y="112" font-size="28" font-weight="600" fill="${ACCENT}">${escapeXml(preview.owner_name)} invited you</text>
  <text x="176" y="146" font-size="24" fill="#888888">${escapeXml(subtitle)}</text>
</svg>`;
}
```

- [ ] **Step 2: Add the resvg import** at the top of the file, alongside the existing imports:

```ts
import { render as renderSvgToPng } from "https://deno.land/x/resvg_wasm@0.2.0/mod.ts";
```

- [ ] **Step 3: Replace the stub `isImage` branch** in the default-exported handler:

```ts
  if (isImage) {
    const avatarDataUri = await fetchAvatarDataUri(preview.owner_avatar);
    const svg = buildCardSvg(preview, avatarDataUri);
    const png = await renderSvgToPng(svg);
    return new Response(png, {
      status: 200,
      headers: {
        "Content-Type": "image/png",
        "Cache-Control": "public, max-age=300",
      },
    });
  }
```

(this replaces the two-line `// Task 2 replaces this stub...` / `return Response.redirect(...)` block from Task 1)

**Note on local typechecking:** this repo has no local Deno toolchain, so `npx tsc` cannot check this file end-to-end (it's not part of the RN app's TS project, and Node's `typescript` package checking Deno code against `lib.dom.d.ts` produces a false-positive `Uint8Array<ArrayBufferLike>` vs `BodyInit`/`BlobPart` mismatch on `new Response(png, ...)` under TS 5.7+'s stricter typed-array generics — verified by reassembling this exact code and running it through `tsc` directly). `new Response(<Uint8Array>, ...)` is the standard, widely-used pattern for binary edge-function responses in Deno and is expected to work correctly at runtime; if Netlify's own build-time typecheck (which uses Deno's type definitions, not Node's) flags something different, trust that over any local check.

- [ ] **Step 4: Commit**

```bash
git add netlify/edge-functions/join.ts
git commit -m "Generate a personalized PNG card for /join/<id>/image via resvg"
```

---

### Task 3: Switch all client share/scan sites to the new URL

**Files:**
- Modify: `src/screens/app/CapsuleDetailScreen.tsx`
- Modify: `src/screens/app/OnboardingScreen.tsx`
- Modify: `src/screens/app/QRScannerScreen.tsx`

- [ ] **Step 1: `CapsuleDetailScreen.tsx` — `shareLink()`**

Find:
```ts
  async function shareLink() {
    await Share.share({
      message: `Join my Capsule "${capsuleTitle}" — add your photos before it locks! Open this link on your phone with Capsule installed: capsule://join/${capsuleId}`,
    });
  }
```
Replace with:
```ts
  async function shareLink() {
    await Share.share({
      message: `Join my Capsule "${capsuleTitle}" — add your photos before it locks! https://getcapsuleapp.com/join/${capsuleId}`,
    });
  }
```

- [ ] **Step 2: `CapsuleDetailScreen.tsx` — QR code value**

Find:
```tsx
                <QRCode
                  value={`capsule://join/${capsuleId}`}
```
Replace with:
```tsx
                <QRCode
                  value={`https://getcapsuleapp.com/join/${capsuleId}`}
```

- [ ] **Step 3: `OnboardingScreen.tsx` — step-5 invite share**

Find:
```ts
      await Share.share({
        message: `Join my Capsule "${title}" — add your photos before it locks! Open this link on your phone with Capsule installed: capsule://join/${createdCapsuleId}`,
```
Replace with:
```ts
      await Share.share({
        message: `Join my Capsule "${title}" — add your photos before it locks! https://getcapsuleapp.com/join/${createdCapsuleId}`,
```

- [ ] **Step 4: `QRScannerScreen.tsx` — accept both link formats**

Find:
```ts
    const match = data.match(/capsule:\/\/join\/([a-zA-Z0-9-]+)/);
```
Replace with:
```ts
    const match = data.match(/(?:capsule:\/\/join\/|https:\/\/getcapsuleapp\.com\/join\/)([a-zA-Z0-9-]+)/);
```

- [ ] **Step 5: Typecheck**

Run: `npx tsc --noEmit`
Expected: no new errors introduced in the four touched files (pre-existing unrelated errors elsewhere are fine).

- [ ] **Step 6: Commit**

```bash
git add src/screens/app/CapsuleDetailScreen.tsx src/screens/app/OnboardingScreen.tsx src/screens/app/QRScannerScreen.tsx
git commit -m "Switch invite share/QR links to https://getcapsuleapp.com/join/<id>"
```

---

### Task 4: Landing page "you were invited" fallback banner

**Files:**
- Modify: `landing/index.html`
- Modify: `landing/site.js`

- [ ] **Step 1: Add the hidden banner markup to `landing/index.html`**, immediately after `</nav>` and before `<a id="top"></a>`:

Find:
```html
</nav>

<a id="top"></a>
```
Replace with:
```html
</nav>

<div class="wrap"><div id="invite-banner" class="access-note" style="display:none; max-width:600px; margin:16px auto 0;">
  <svg class="ic" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M22 12h-6l-2 3h-4l-2-3H2"/><path d="M5.45 5.11L2 12v6a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2v-6l-3.45-6.89A2 2 0 0 0 16.76 4H7.24a2 2 0 0 0-1.79 1.11z"/></svg>
  <div>
    <b id="invite-banner-title">You were invited</b>
    <span>Join the waitlist below for early access.</span>
  </div>
</div></div>

<a id="top"></a>
```

- [ ] **Step 2: Add the query-param banner logic to `landing/site.js`**, appended at the end of the file:

```js
const params = new URLSearchParams(window.location.search);
const invitedBy = params.get('invited_by');
if (invitedBy) {
  const banner = document.getElementById('invite-banner');
  const title = document.getElementById('invite-banner-title');
  if (banner && title) {
    const capsuleName = params.get('capsule');
    title.textContent = capsuleName
      ? `${invitedBy} invited you to "${capsuleName}"`
      : `${invitedBy} invited you to a Capsule`;
    banner.style.display = 'flex';
  }
}
```

- [ ] **Step 3: Verify locally**

```bash
python3 -m http.server 8799 --directory landing
```
Open `http://localhost:8799/index.html?invited_by=Mark&capsule=Mountain%20Weekend` in a browser. Expected: the banner appears below the nav reading `Mark invited you to "Mountain Weekend"`; visiting without the query params shows no banner.

- [ ] **Step 4: Commit**

```bash
git add landing/index.html landing/site.js
git commit -m "Show a contextual banner on the landing page for invite-link fallbacks"
```

---

### Task 5: Manual — Netlify secrets, deploy, and end-to-end verification

**This task cannot be executed by a subagent.** It requires Netlify dashboard access and sending real messages in real apps.

- [ ] **Step 1: Set the two secrets** — Netlify dashboard → Site configuration → Environment variables → Add a variable, scope **Functions** only, for both:
  - `SUPABASE_URL` = the project URL (same value as `EXPO_PUBLIC_SUPABASE_URL` in the app's env)
  - `SUPABASE_SERVICE_ROLE_KEY` = the project's service role key (Supabase dashboard → Project Settings → API)

- [ ] **Step 2: Merge the PR(s) from Tasks 1–4, then trigger a new deploy** (env vars set after linking only take effect on the next deploy, per Netlify's own docs).

- [ ] **Step 3: Curl-verify the page and image directly**

```bash
curl -s https://getcapsuleapp.com/join/<a-real-capsule-id> | grep -o 'og:[a-z:]*'
curl -sI https://getcapsuleapp.com/join/<a-real-capsule-id>/image | grep -i content-type
```
Expected: all `og:*` tags present in the first, `content-type: image/png` in the second.

- [ ] **Step 4: Run the URL through a generic OG-tag debugger** (e.g. a Twitter/X card validator or metatags.io) to sanity-check parsing.

- [ ] **Step 5: Send the real link to yourself** in iMessage, WhatsApp, and Slack (or whichever apps you use) and confirm the card renders with the correct title, description, and image.

- [ ] **Step 6: Confirm the redirect** — tap the link on a phone with the app installed (should open the app directly); tap it on a phone without the app, or with Capsule force-quit and its scheme unregistered if that's feasible to simulate, and confirm it lands on the landing page with the invite banner from Task 4.

- [ ] **Step 7: If any messaging app mishandles the image** (some crawlers are stricter about PNG profiles/dimensions), note which one and revisit only the SVG/render pipeline in Task 2 — the routing/redirect architecture from Tasks 1 and 3–4 does not change.
