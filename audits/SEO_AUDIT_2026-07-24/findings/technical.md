# Technical SEO Audit — getcapsuleapp.com
Audited 2026-07-24. Static 9-page Netlify site, source at `/Users/markdickson/Desktop/capsule/landing/`.

## Technical Score: 72/100

Solid foundation (clean crawlable HTML, correct robots/sitemap, HSTS, brotli compression, no JS-rendering dependency, Lighthouse SEO 100) undercut by one real indexation conflict (pretty-URL vs canonical mismatch), a sitewide missing-security-headers gap, an H1 omission on every SEO landing page, and a caching-header miss on immutable static assets.

---

## What Works

- **robots.txt** is minimal and correct: `User-agent: * / Allow: /` + sitemap reference. No accidental disallows.
- **sitemap.xml** lists all 9 real pages, valid XML, reachable, `content-type: application/xml`, 200 OK.
- **No JS-rendering dependency.** All content is server-rendered static HTML; `site.js` (1.7KB, 676B on the wire) is pure progressive enhancement (scroll-state nav class, waitlist form submit, `?invited_by=` query-param banner). A crawler with JS disabled sees 100% of the content.
- **HTTPS/HSTS correct**: `strict-transport-security: max-age=31536000` on every response; `http://` and `www.` both 301 to canonical `https://getcapsuleapp.com/` (verified in prior pass, not re-tested here).
- **Compression enabled (brotli)**: homepage 5.5KB wire (22.5KB raw), styles.css 4.4KB wire (18KB raw), site.js 676B wire. Not a bottleneck.
- **Indexability**: no `noindex` meta or `X-Robots-Tag` anywhere; no `www`/`http` duplicate host issue; no duplicate `id` attributes found in a scan of index.html.
- **Metadata hygiene**: every page has a unique, descriptive `<title>` and `<meta name="description">`; all under reasonable length; Open Graph (`og:type/url/title/description/image`) present on the 7 marketing pages; `twitter:card=summary_large_image` on the homepage.
- **Mobile viewport**: `<meta name="viewport" content="width=device-width, initial-scale=1.0">` present and identical on all 9 pages. No horizontal-scroll or percentage-width traps found in a source scan.
- **Single language, correctly declared**: `<html lang="en">` on all 9 pages, one language variant of each URL exists — **hreflang is correctly not implemented** (nothing to mark up; no cross-language duplicates to worry about).
- **Lighthouse (mobile)**: Performance 91, Accessibility 96, Best Practices 100, **SEO 100**. Content/landing subpages score Performance 100, LCP 0.8s — only the homepage is dragged down (see High #1 below).
- **404 handling**: unmapped paths correctly return HTTP 404 (not a soft-404 200).

---

## Critical

### C1. Canonical tag and internal links point to two different URL forms for every page — active duplicate-content signal
**Evidence:**
- Netlify's Pretty URLs post-processor is ON. Source HTML (e.g. `index.html` line 227) writes `href="wedding-photo-time-capsule.html"`, but the served page rewrites this to `href='/wedding-photo-time-capsule'` (confirmed via `curl`, note the switched quote style from Netlify's rewriter — every internal nav link across every page is affected):
  ```
  href='/babys-first-year-time-capsule'
  href='/family-reunion-time-capsule'
  href='/graduation-time-capsule-ideas'
  href='/how-to-make-a-digital-time-capsule'
  href='/support'
  href='/time-capsule-app-for-couples'
  href='/wedding-photo-time-capsule'
  ```
- Meanwhile every page's `<link rel="canonical">` and every `sitemap.xml` `<loc>` declare the **`.html`** form, e.g. `https://getcapsuleapp.com/wedding-photo-time-capsule.html`.
- Both URL forms return **HTTP 200 with no redirect**, confirmed site-wide (not just the one previously-known wedding page):
  ```
  family-reunion-time-capsule.html -> 200
  family-reunion-time-capsule     -> 200
  support.html -> 200   support -> 200   legal.html -> 200   legal -> 200
  ```
- There is **no `netlify.toml`, no `_redirects`, no `_headers` file anywhere in the repo** (`git ls-files` and `find . -iname` both empty) — confirmed, this is entirely Netlify's default Pretty URLs behavior with zero custom redirect/canonicalization logic layered on top.

**Impact:** Google is being told two contradictory things simultaneously: (a) every internal link and 100% of actual crawl-discovery traffic points at the extensionless URL, which is what accumulates internal PageRank/link signals and is what gets clicked/shared; (b) the canonical tag and sitemap insist the `.html` URL is authoritative. Google usually resolves canonical conflicts like this by picking its own signal (often the version with the most internal links — i.e., the opposite of the declared canonical), which means indexing/ranking behavior here is effectively undefined and could flip. At minimum this dilutes link equity across two URLs instead of consolidating it, and risks the `.html` URLs (the ones actually in your sitemap) being demoted in favor of URLs your sitemap never mentions.

**Fix — pick ONE, don't layer them:**

**Recommended: Option A — make the extensionless URL canonical (matches what Pretty URLs already serves and what every internal link already uses; zero template changes).**
1. Add a `netlify.toml` with a hard 301 from `.html` → extensionless, so the losing URL stops returning 200:
   ```toml
   [[redirects]]
     from = "/*.html"
     to = "/:splat"
     status = 301
     force = true
   ```
   (Netlify's Pretty URLs rewrite happens at serve time on the extensionless request; this redirect only needs to catch the literal `.html` request path.)
2. Update the 9 `<link rel="canonical">` tags in the source HTML to drop `.html` (e.g. `https://getcapsuleapp.com/wedding-photo-time-capsule`).
3. Update `sitemap.xml`'s 9 `<loc>` entries to drop `.html` to match.

**Alternative: Option B — keep `.html` canonical (less work on templates, but fights the platform default).**
1. Turn off Pretty URLs isn't a real toggle for post-processing rewrites in `netlify.toml`; instead add an explicit 301 the other direction:
   ```toml
   [[redirects]]
     from = "/wedding-photo-time-capsule"
     to = "/wedding-photo-time-capsule.html"
     status = 301
   ```
   repeated per extensionless path (7 rules) — more brittle than Option A's single wildcard rule, since it doesn't generalize, and it fights Netlify's own link rewriter, which will keep emitting extensionless internal links on every future page unless you also stop using Pretty URLs. **Not recommended** for this reason — Option A works with the platform instead of against it.

Either way: **do not leave both forms live at 200 with no redirect.** That's the actual defect, independent of which form wins.

---

## High

### H1. No security headers except HSTS — sitewide
**Evidence:** `curl -sI` on `/`, `/styles.css`, `/site.js`, `/logo.png`, `/sitemap.xml`, `/robots.txt` all return only:
```
strict-transport-security: max-age=31536000
```
Absent on every single response, HTML and static assets alike: `content-security-policy`, `x-content-type-options`, `x-frame-options`, `referrer-policy`, `permissions-policy`.
**Impact:** Not a direct ranking factor, but Google's security/UX signals (and any future Core Web Vitals-adjacent "best practices" crawl checks) increasingly fold in header hygiene; more concretely this is a real clickjacking (`X-Frame-Options`/`frame-ancestors`) and MIME-sniffing (`X-Content-Type-Options`) gap on a page with a live lead-gen form (`#waitlist`). Lighthouse Best Practices already scores 100 only because it doesn't penalize this combination on a static site — a manual/PSI audit or a security scanner would flag it.
**Fix:** Add a `netlify.toml` `[[headers]]` block (can combine with the C1 fix in the same file):
```toml
[[headers]]
  for = "/*"
  [headers.values]
    X-Content-Type-Options = "nosniff"
    X-Frame-Options = "DENY"
    Referrer-Policy = "strict-origin-when-cross-origin"
    Permissions-Policy = "geolocation=(), camera=(), microphone=()"
    Content-Security-Policy = "default-src 'self'; img-src 'self' data:; style-src 'self' 'unsafe-inline'; script-src 'self'; form-action 'self' https://getcapsuleapp.com"
```
Test the CSP against the waitlist form's actual submit target (`site.js`'s `wl.action` — a Netlify Forms POST to the same origin, so `form-action 'self'` should hold, but verify before shipping since a wrong CSP will silently break the waitlist submit).

### H2. All 6 SEO landing pages are missing an `<h1>` entirely
**Evidence:** `grep -c '<h1' *.html`:
```
babys-first-year-time-capsule.html:        0
family-reunion-time-capsule.html:          0
graduation-time-capsule-ideas.html:        0
how-to-make-a-digital-time-capsule.html:   0
time-capsule-app-for-couples.html:         0
wedding-photo-time-capsule.html:           0
```
On `wedding-photo-time-capsule.html` (representative of all 6), the highest-level heading is `<h2 class="sec-title">The wedding photo time capsule.</h2>` at line 38 — there is no `<h1>` above it. Only `index.html`, `support.html`, `legal.html` have exactly one `<h1>`.
**Impact:** These 6 pages are precisely the long-tail content/SEO pages (wedding, couples, graduation, baby's-first-year, family reunion, how-to guide) — the ones whose entire purpose is ranking for their target long-tail query. Missing H1 removes the single strongest on-page semantic signal for "what is this page about," and demotes it to an H2 nested under a generic `<header class="guide-header">` wrapper. This is a template-level bug, not content-specific — fix once in the shared page header partial/pattern and it fixes all 6.
**Fix:** Change each page's first `sec-title` heading (or add a dedicated one) from `<h2>` to `<h1>`, keeping the visual style via the existing `.sec-title` class rather than relying on tag-implied styling. Renumber the subsequent headings so `<h2>` is used once per major section and `<h3>` for sub-points (currently structurally fine below the missing top level — `<h3>Start a capsule</h3>` etc. under the 3-step section are appropriately nested).

### H3. Immutable static assets served with `max-age=0, must-revalidate` — no cache-busting filenames
**Evidence:** Every response (HTML **and** CSS/JS/PNG) carries the same header:
```
cache-control: public,max-age=0,must-revalidate
```
confirmed on `/`, `/styles.css`, `/site.js`, `/logo.png`. None of `styles.css`, `site.js`, `logo.png`, `apple-touch-icon.png`, `favicon.ico/png`, or the two screenshot PNGs have a content-hash/fingerprint in the filename (plain `styles.css`, `logo.png`, etc.) — so there's currently no safe way to cache them long-term even if you wanted to, since a deploy that changes `styles.css` would be masked by a stale long-lived cache.
**Impact:** Every repeat page view and every internal navigation forces a conditional GET (304 round-trip via ETag) for CSS/JS/logo/icons that essentially never change between deploys. This is pure avoidable latency stacked on top of the render-delay-dominated LCP already identified (H4) — it's not the LCP's root cause, but it's added tax on every subsequent navigation a user or crawler takes across the 9 pages.
**Fix — two parts, since a real fix requires cache-busting, not just a header change:**
1. Add versioned/hashed filenames for CSS/JS/logo (simplest low-effort version: append a query-string or literal version suffix you bump by hand on each change, e.g. `styles.css?v=3`, or rename to `styles.v3.css` at deploy time) so a long `max-age` is actually safe.
2. Add `netlify.toml` header overrides scoped to the static-asset paths only (leave HTML on Netlify's default so content edits go live immediately without needing a filename bump):
   ```toml
   [[headers]]
     for = "/*.css"
     [headers.values]
       Cache-Control = "public, max-age=31536000, immutable"

   [[headers]]
     for = "/*.js"
     [headers.values]
       Cache-Control = "public, max-age=31536000, immutable"

   [[headers]]
     for = "/*.png"
     [headers.values]
       Cache-Control = "public, max-age=31536000, immutable"

   [[headers]]
     for = "/favicon.ico"
     [headers.values]
       Cache-Control = "public, max-age=31536000, immutable"
   ```
   If you don't want to do cache-busting yet, use a shorter safe `max-age` (e.g. `86400`) instead of `immutable` until fingerprinting is in place — otherwise a genuine CSS/logo change won't reach returning visitors for a year.

### H4. Homepage LCP 3.5s (Needs Improvement, threshold is ≤2.5s Good) — driven by main-thread image decode, not network
**Evidence (Lighthouse mobile, homepage):** Perf 91, LCP 3.5s, 82% of that (2850ms) is render delay, while all network activity completes by 466ms. Root cause: 3 eagerly-loaded, oversized PNGs decoding on the main thread —
- `logo.png`: source is **512×512** (79.8KB) but displayed at **36×36** CSS px (`.brand .mark { width: 36px; height: 36px }` in `styles.css` line 79) — appears **twice per page load** (header + footer) — a ~14x oversized asset for its display size, and it's not even the LCP element, but it competes for the same main-thread decode budget ahead of the actual LCP candidate.
- `screenshots/home.png` and `screenshots/create.png`: both 924×1869 (221KB / 205KB), no `width`/`height` attributes, no `loading="lazy"`.
- None of the 4 `<img>` tags sitewide have `width`/`height` attributes, so there's also latent CLS risk on slower connections even though Lighthouse didn't flag it this run.
- Landing/content subpages (which don't embed the screenshots) score Perf 100 / LCP 0.8s — confirming the screenshots + oversized logo are the specific cause, not general site weight.
**Impact:** LCP is a Core Web Vital field/ranking signal; 3.5s sits in "Needs Improvement," one bad connection away from "Poor" (>4s). This is squarely fixable without infrastructure changes.
**Fix:**
1. Resize `logo.png` from 512×512 down to ~72×72 (2x retina for a 36×36 display) — cuts an ~80KB asset to a few KB and removes it as main-thread decode competition.
2. Resize/compress `screenshots/home.png` and `screenshots/create.png` to their actual max display width (check the `.screens`/carousel CSS for the rendered width — almost certainly well under 924px on mobile) and convert to WebP/AVIF if the design system allows a format change.
3. Add explicit `width`/`height` (or `aspect-ratio` in CSS) to all 4 `<img>` tags to eliminate CLS risk and let the browser reserve layout space before decode.
4. Add `loading="lazy"` to the two screenshot images (they're in a `#screens` section, below the fold on first paint) so they don't compete with above-the-fold decode at all.

---

## Medium

### M1. Zero structured data (JSON-LD) sitewide
**Evidence:** `grep -c 'application/ld+json'` returns `0` on all 9 pages.
**Impact:** No rich-result eligibility (sitelinks search box, software-application rich card, breadcrumbs, FAQ rich results) despite this being exactly the kind of small marketing site that benefits most from cheap structured-data wins. Not a ranking factor directly, but a real missed SERP-appearance opportunity.
**Fix:**
- Homepage: `Organization` + `SoftwareApplication` (or `MobileApplication`) JSON-LD — name, url, logo, `applicationCategory: "LifestyleApplication"` or similar, `operatingSystem: "iOS"`, and (once public) `offers`/aggregateRating once TestFlight/App Store data exists. Given the app is pre-launch, omit `aggregateRating`/`offers` rather than fabricate them.
- 6 landing pages: `Article` or `HowTo` JSON-LD (the how-to-make-a-digital-time-capsule.html page is a literal step-by-step guide — a strong `HowTo` candidate) with `headline`/`description`/`datePublished` if available.
- `legal.html`: consider `WebPage` at minimum; not a priority.

### M2. `support.html` and `legal.html` have no Open Graph or Twitter Card tags
**Evidence:** confirmed zero `og:`/`twitter:` meta tags on both pages (all 7 other pages have full OG sets).
**Impact:** Low-traffic pages, low priority, but if either is ever shared (e.g. a support link in an email or a legal link in an App Store listing) it'll render as a bare link with no preview card.
**Fix:** Add the same `og:type/url/title/description/image` block used on the other 7 pages; trivial copy-paste from `support.html`'s existing `<title>`/description.

### M3. `og:image` is a 512×512 square logo, not a 1200×630 social card
**Evidence:** `og:image` on every page (where present) points at `logo.png` (512×512, square). `twitter:card` is set to `summary_large_image`, which expects/prefers a ~1.91:1 landscape image (Twitter's own minimum is 300×157; ideal ~1200×630).
**Impact:** Low — link previews on Twitter/X, Slack, iMessage, etc. will center-crop a square image into a landscape card, likely losing the edges of the logo/wordmark. Cosmetic, not a crawlability/indexability issue.
**Fix:** Create a dedicated 1200×630 OG/social card image (product screenshot + wordmark, not just the app icon) and point `og:image`/`twitter:image` at it instead of reusing `logo.png`.

### M4. Sitemap has no `<lastmod>`
**Evidence:** `sitemap.xml` entries have only `<loc>`, `<changefreq>`, `<priority>` — no `<lastmod>` on any of the 9 `<url>` entries.
**Impact:** Minor. `changefreq`/`priority` are largely ignored by Google anyway; `lastmod` (when accurate) is the one sitemap signal Google still weights for recrawl prioritization. Low priority for a 9-page site that recrawls fast regardless.
**Fix:** Add `<lastmod>` per URL, ideally generated from file mtime or git log at build/deploy time rather than hand-maintained (hand-maintained `lastmod` that doesn't actually change on edits is worse than omitting it, since Google has been known to distrust sitemaps with inaccurate `lastmod`).

---

## Low

### L1. No IndexNow implementation
**Evidence:** No `indexnow.txt` or similarly-named key file (`/indexnow.txt` → 404); no IndexNow submission code anywhere in the repo.
**Impact:** IndexNow (Bing/Yandex/Naver) is opt-in and low-effort for a site that publishes rarely (9 static pages, infrequent updates) — the ROI here is small since this isn't a high-churn content site, but it's a same-day win whenever a new landing page ships.
**Fix:** Generate an IndexNow key, host `<key>.txt` at the root containing the key, and add a one-line `curl`/fetch POST to `https://api.indexnow.org/indexnow` in the deploy pipeline (e.g. a Netlify build-plugin or post-deploy hook) whenever `sitemap.xml`'s URL set changes. Not urgent given publishing cadence.

### L2. Thin content on the 6 landing pages (~380–500 words each)
**Evidence:** Word counts (script-extracted, tags/scripts/styles stripped): wedding 381, couples 385, graduation 382, how-to 498, baby's-first-year 392, family-reunion 388.
**Impact:** Not thin enough to be a quality-signal risk on its own (these are focused, conversion-oriented landing pages, not blog posts, and Lighthouse SEO is 100), but it does cap how competitively these pages can rank against longer-form guides targeting the same long-tail keywords (e.g. "how to make a digital time capsule" competing against 1500+ word guides). Worth knowing, not urgent to fix.
**Fix:** If organic long-tail traffic becomes a priority, expand the how-to guide specifically (it's the most "informational intent" page and already the longest) with a real step-by-step structure (pairs well with the `HowTo` schema recommendation in M1) and consider adding an FAQ section (pairs with `FAQPage` schema) to 1–2 of the highest-intent occasion pages (wedding, baby's-first-year look like the strongest candidates based on likely search volume).

### L3. No `netlify.toml` at all — every header/redirect decision is currently an unconfigured Netlify default
**Evidence:** Confirmed via `git ls-files` and `find . -iname "netlify.toml" -o -iname "_redirects" -o -iname "_headers"` — no matches anywhere in the repo.
**Impact:** This is the root cause tying together C1, H1, and H3 above — there's currently zero explicit control over redirects, security headers, or cache policy; the site is 100% riding Netlify's defaults (which is why Pretty URLs silently rewrites links without also managing canonicalization, and why no security/cache headers exist). Listed separately here as a process note: **all three fixes above belong in one `netlify.toml` file**, not three separate changes.
**Fix:** Create a single `netlify.toml` combining the `[[redirects]]` block from C1 and the `[[headers]]` blocks from H1/H3. Example skeleton:
```toml
[[redirects]]
  from = "/*.html"
  to = "/:splat"
  status = 301
  force = true

[[headers]]
  for = "/*"
  [headers.values]
    X-Content-Type-Options = "nosniff"
    X-Frame-Options = "DENY"
    Referrer-Policy = "strict-origin-when-cross-origin"
    Permissions-Policy = "geolocation=(), camera=(), microphone=()"

[[headers]]
  for = "/*.css"
  [headers.values]
    Cache-Control = "public, max-age=31536000, immutable"

[[headers]]
  for = "/*.js"
  [headers.values]
    Cache-Control = "public, max-age=31536000, immutable"

[[headers]]
  for = "/*.png"
  [headers.values]
    Cache-Control = "public, max-age=31536000, immutable"
```
(CSP omitted from the combined skeleton — add it separately after verifying it doesn't break the Netlify Forms waitlist submit, per H1.)

---

## Not applicable / confirmed non-issues
- **hreflang**: single-language site, no cross-language duplicates exist — correctly absent. No action.
- **Mobile viewport**: correct and consistent across all 9 pages.
- **JS-rendering requirement**: none — fully static, crawlable without executing `site.js`.
- **Redirect chains / www / http**: already verified clean 301s (out of scope for re-verification per audit brief).
- **robots.txt / sitemap reachability**: both 200, correctly formatted, correctly linked from robots.txt.
