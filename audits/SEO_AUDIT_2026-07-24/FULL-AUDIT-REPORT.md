# SEO Audit — getcapsuleapp.com

**Date:** 2026-07-24 · **Pages audited:** 9 (entire site) · **Business type:** Consumer mobile app (pre-launch iOS, private beta / waitlist)

## SEO Health Score: 52 / 100

| Category | Weight | Score | Weighted |
|---|---|---|---|
| Technical SEO | 22% | 72 | 15.84 |
| Content Quality | 23% | 43 | 9.89 |
| On-Page SEO | 20% | 58 | 11.60 |
| Schema / Structured Data | 10% | **3** | 0.30 |
| Performance (CWV) | 10% | 78 | 7.80 |
| AI Search Readiness | 10% | 43 | 4.30 |
| Images | 5% | 55 | 2.75 |
| **Total** | | | **52** |

The engineering is sound. The site is fast, clean, fully static, honestly written, and has better internal linking and alt text than most sites its size. What holds the score down is that the six pages built to earn search traffic are missing the basics (no H1, ~380 words, half of it duplicated across all six), there is no structured data anywhere, and the brand name is contested by several established products in the same niche.

---

## Executive Summary

### Top 5 critical issues

1. **All 6 SEO landing pages have no `<h1>`.** Their hero heading is `<h2 class="sec-title">`. These are the only pages targeting non-brand queries. `index.html`, `legal.html`, and `support.html` — the pages that *aren't* trying to rank — all use `<h1>` correctly.
2. **Every page resolves at two URLs, both returning 200.** `/wedding-photo-time-capsule` and `/wedding-photo-time-capsule.html` are both live with no redirect. Canonicals and the sitemap point at the `.html` form; every internal link on the live site points at the extensionless form. Confirmed sitewide.
3. **Zero structured data across all 9 pages.** No `Organization`, `WebSite`, `SoftwareApplication`, or `BreadcrumbList`. For a product with a generic name, this removes the main machine-readable way to assert what the entity is.
4. **Severe thin/duplicate content on the 6 landing pages.** 381–498 words each, with only 149–235 words genuinely unique (39–47%). Line-level similarity between the five occasion pages measures **65–74%**. Step 1 of "How it works" is byte-identical on all six.
5. **Only 2 of 9 pages appear to be indexed.** A `site:getcapsuleapp.com` check returns the homepage and `/legal` — **none of the six SEO landing pages**. Everything else in this audit optimizes pages that search engines have not yet put in the index, which makes indexation the first thing to fix, not the last.

Also strategically critical: **"Capsule" collides with multiple active products in this exact niche** — including *TimeCapsules* (App Store), which offers time unlock, group unlock, and 100 m proximity unlock: the same three modes this app implements. Plus *trycapsule.com* and *revealmoment.app*. See the brand section below.

### Top 5 quick wins

| Fix | Effort | Impact |
|---|---|---|
| `<h2 class="sec-title">` → `<h1>` on 6 pages | **5 min** — styled by class, zero visual change | High |
| Point 3 dead footer social links at the real URLs already in `src/lib/communityLinks.ts` | **5 min** | Medium (entity signals) |
| Add OG/Twitter tags to `support.html` + `legal.html` (currently zero) | **10 min** | Medium |
| Resize `logo.png` — 512×512/80 KB served for a 36×36 slot, on all 9 pages, twice per page | **10 min** | High (~76 KB off every pageview) |
| Add `loading="lazy"` + WebP to the two below-fold screenshots | **20 min** | High (fixes mobile LCP) |

---

## Technical SEO — 72/100

**Works:** clean robots.txt and sitemap · brotli compression (homepage 5.5 KB on wire) · Netlify edge TTFB 78 ms · HSTS · correct www→apex and http→https 301s · working 404 · fully static, zero JS-rendering dependency · `lang="en"` on every page · correct single-language setup (hreflang properly absent) · Lighthouse SEO 100 / Best Practices 100.

**Critical — dual-URL duplication.** Netlify's Pretty URLs serves `/foo` for `/foo.html` *and* rewrites internal links in the deployed HTML, but never redirects. Result: canonical says `.html`, sitemap says `.html`, every crawlable link says extensionless. Verified on all 9 pages. There is no `netlify.toml`, `_redirects`, or `_headers` file in the repo — which is the shared root cause of this and the two items below.

**High — no security headers except HSTS.** No CSP, `X-Content-Type-Options`, `X-Frame-Options`, `Referrer-Policy`, or `Permissions-Policy`. The site runs a live Formspree waitlist that POSTs email addresses.

**High — all assets served `cache-control: public,max-age=0,must-revalidate`**, including immutable PNGs, with no filename fingerprinting. Every repeat visit costs 8 conditional round-trips.

All three are resolved by `landing/_redirects` and `landing/_headers` (shipped in the Phase 1 commit). These file-based configs live inside the publish directory and are read from the deploy root, so no build-config change is needed — unlike `netlify.toml`, which would require declaring a `publish` path that cannot be verified from outside the Netlify UI.

**Medium:** sitemap has no `<lastmod>`. **Low:** no IndexNow (low ROI at this publishing cadence).

Full detail: `findings/technical.md`

## Content Quality — 43/100

Measured word counts (visible text, tags stripped):

| Page | Words | Unique prose | Verdict |
|---|---|---|---|
| `index.html` | 944 | — | Solid |
| `legal.html` | 1,164 | — | Solid |
| `how-to-make-a-digital-time-capsule` | 498 | ~235 | Thin |
| `babys-first-year-time-capsule` | 392 | ~180 | Thin |
| `family-reunion-time-capsule` | 388 | ~175 | Thin |
| `time-capsule-app-for-couples` | 385 | ~170 | Thin |
| `graduation-time-capsule-ideas` | 382 | ~165 | Thin |
| `wedding-photo-time-capsule` | 381 | ~149 | Thin |
| `support.html` | 76 | — | Stub |

The six landing pages target informational queries where ranking content runs 800–1,500 words. They are 2–4× short, and 53–61% of what's there is shared boilerplate. Step 1 is identical on all six; steps 2–3 differ by one swapped noun (*Everyone / Every friend / Every relative*).

**E-E-A-T composite 47/100** — Trustworthiness is the standout at 75: real named contact email, dated policies, no dark patterns, and unusually honest disclosure (testimonials explicitly labelled *"Illustrative — not a verified review"*; TestFlight-not-App-Store status stated plainly). Authoritativeness is near-zero, which is structurally normal pre-launch but worsened by the dead social links.

Full detail: `findings/content.md`

> **Note on two recommendations in that file I'm overriding:** it flags missing `HowTo` and `FAQPage` schema as gaps. Don't act on either. Google **deprecated HowTo rich results in September 2023**, and **retired FAQ rich results for all sites on May 7, 2026**. Neither will produce a SERP feature. (Three of the specialist agents suggested HowTo schema for the how-to page — it's an intuitive fit for the content, but the rich result no longer exists.) Mark that page up as `WebPage` and keep the steps in a semantic `<ol>` for readability and passage extraction.

## On-Page SEO — 58/100

**Works:** unique, well-written, human-sounding titles and meta descriptions on all 9 pages, none truncated · self-referential canonicals everywhere · **genuinely strong internal linking** — the six landing pages form a complete mesh and every page is one click from the homepage · clean descriptive URL slugs · correct homepage heading hierarchy.

**Critical:** no `<h1>` on the six money pages (outline is `h2 h2 h2 h3 h3 h3 h2 h2`). **Critical:** the dual-URL/canonical conflict above. **Medium:** `support.html` and `legal.html` have zero OG/Twitter tags. **Medium:** `og:image` is the 512×512 square logo while `twitter:card` is `summary_large_image`, which expects 1.91:1 — social cards will letterbox; all 9 pages share one image.

Full detail: `findings/onpage.md`

## Schema / Structured Data — 3/100

Zero JSON-LD, Microdata, and RDFa sitewide. The score isn't a quality problem — it's that nothing exists yet, which makes it the cleanest win on this list.

Copy-pasteable, content-grounded JSON-LD for every page is in `findings/schema.md`, with insertion points. Implementation order: **Organization + WebSite** on the homepage → **WebPage + BreadcrumbList** on the six landing pages → **ContactPage** on support, **WebPage** on legal → minimal **SoftwareApplication**.

Three deliberate holds, all correct: no `offers` (pricing appears nowhere on the site — marking up prices with no visible counterpart violates Google's guidelines), no `downloadUrl` (no App Store link exists yet), no `aggregateRating` (no real reviews). Also no `Person`/founder schema — no name appears anywhere on the site — and no `sameAs`, because the social links are placeholders. Fixing those links unblocks `sameAs`.

## Performance — 78/100

| Page | Device | Perf | LCP | TBT | CLS |
|---|---|---|---|---|---|
| `/` | **Mobile** | 91 | **3.5 s** ❌ | 0 ms | 0 |
| `/` | Desktop | 100 | 0.6 s | 0 ms | 0 |
| `/wedding-photo-time-capsule` | Mobile | 100 | 0.8 s | 0 ms | 0 |

Lab data only — no CrUX field data exists for this domain yet (insufficient traffic).

**CLS is 0 everywhere and TBT is 0 everywhere.** INP will be excellent; there's essentially no JS.

The one problem is mobile homepage LCP at 3.5 s, of which **2,850 ms (82%) is render delay** — yet the network waterfall shows every request complete by **466 ms**. No web fonts, no blocking JS. The cause is main-thread decode of three eagerly-fetched PNGs (506 KB total, two of them 924×1869) under mobile CPU throttling. Desktop, same bytes without the throttle, paints at 0.6 s — which isolates the variable to decode cost, not delivery. The landing pages, which carry no screenshots, hit LCP 0.8 s.

*If the image fixes don't drop mobile LCP below ~1.5 s, this diagnosis is wrong and the trace should be re-read for a style-recalc on the `.load-in` hero animation.*

Full detail: `findings/performance.md`

## Images — 55/100

**Alt text is excellent** — specific, descriptive, no stuffing, 100% coverage. The screenshot alts describe actual UI state, which serves both accessibility and image search.

Everything else needs work: all PNG, no WebP/AVIF · `logo.png` is 512×512/80 KB displayed at **36×36** (98% waste) and appears **twice on every page** · both screenshots 924×1869 · no `loading="lazy"`, no `decoding="async"`, no `width`/`height` on any `<img>` · Lighthouse: **442 KiB** recoverable. Images are ~97% of homepage weight.

Full detail: `findings/images.md`

## AI Search Readiness — 43/100

| Dimension | Score |
|---|---|
| Technical accessibility | 90 |
| Citability | 45 |
| Multi-modal content | 40 |
| Structural readability | 35 |
| Authority & brand signals | **10** |

**Technically wide open and ideal**: wildcard `Allow: /` permits GPTBot, ClaudeBot, PerplexityBot, Google-Extended, CCBot, Bingbot. Critically, **zero content is JS-injected** — `site.js` only does a nav scroll toggle, the Formspree handler, and an `?invited_by=` banner. A non-rendering crawler sees the full page. This is the site's strongest technical property and needs no work.

The problems are content and entity shaped:
- **No question-phrased headings anywhere** on any of the 9 pages — all declarative ("Three steps. One unforgettable reveal."). Nothing matches how people phrase queries.
- **No stats, sources, or dates** in any body copy. Nothing an LLM would cite as evidence rather than as a marketing claim.
- The best citable passages are strong but too short (27 and 31 words vs. the ~134–167 word passage sweet spot), and neither restates disambiguating context — lifted alone, "Capsule" reads as a common noun.
- `site:getcapsuleapp.com` returns only **2 pages indexed** (homepage + `/legal`). None of the six SEO pages are in the index yet.
- No `og:site_name`, no About page, no founder name on-page, no legal entity name, no Wikipedia/Reddit/YouTube presence, dead social links.

**llms.txt is absent.** Honest read: no major AI crawler has committed to reading it and Google ignores it entirely for AI Overviews. It's a cheap 20-minute nice-to-have, not a lever.

Full detail: `findings/geo.md`

## Brand & Category Collision — strategic constraint

Recorded separately because it bounds what everything above can achieve. Confirmed via live search:

- **TimeCapsules** (App Store `id6755395078`) — photos/video/audio unlocked by time, by location **within 100 m**, or by friends, with shared capsules that unlock together. That is the same three-mode unlock model this app implements, at the same default proximity radius.
- **trycapsule.com — "Capsule"** — a wedding photo-sharing app, same brand name, overlapping wedding niche (not time-locked).
- **revealmoment.app — "Reveal"** — group capture with delayed simultaneous reveal for weddings and events. Positioning is nearly identical ("Grab the moment. Reveal it later. Together.") with a cleaner, uncontested name. It ranks for *"shared photo album that unlocks later"*, where Capsule does not appear at all.
- Also live: SnapVault: Photo Time Capsule, Time Capsule – Memory Vault, TimeCaps, TimeLock, Capsula, and a Google Play "Capsule - Time Capsule".
- `facebook.com/getcapsuleapp` exists on the exact handle, associated in search with a c. 2014 app for "keeping track of a list of places".

**One genuine bright spot:** Capsule already ranks **#3 for "wedding photo time capsule app"** — with the unrelated same-named Google Play app at #6, making the collision visible inside a single live SERP. That page is the one landing page with demonstrated traction, which is a reason to invest in it ahead of the five others.

Branded search is therefore not a safe harbour, and every AI answer engine inherits the ambiguity. The recommendation is **not** to rename — the name is embedded in the bundle ID, App Store submission, RevenueCat config, and deep-link scheme — but to stop treating "Capsule" as the searchable token: adopt a consistent disambiguating descriptor everywhere, fix the `sameAs` signals, treat the App Store listing as the canonical entity anchor, and target the genuinely uncontested differentiators (**surprise mode**, **awards/superlatives voting**) rather than the crowded "time capsule" category head.

Full detail: `findings/brand-collision.md`

## Search Experience (SXO) — keyword winnability

From live SERP inspection of all six target keywords:

| Keyword | SERP reality | Verdict |
|---|---|---|
| `time capsule app for couples` | Competitor apps (LuvDiary, TimeLock, Flamme, Lovepons) | **Winnable** — page type already matches |
| `how to make a digital time capsule` | Dropbox + ForKeeps + Klokbox ranking via how-to content | **Winnable** — proven path, page shape already right |
| `wedding photo time capsule` | Small/mid wedding-vendor blogs, photographers, venues | **Marginal** — needs to become a real planning guide |
| `graduation time capsule ideas` | 2 Pinterest results in top 8, zero app results | **Unwinnable** — pure gallery/listicle intent |
| `baby's first year time capsule` | Established parenting-media listicles (FirstCry) | **Unwinnable** at current authority |
| `family reunion time capsule` | Snapfish, Family Tree Magazine, Etsy, Pinterest | **Unwinnable** — highest-authority incumbents of the six |

Three of the six pages are **structurally** mismatched, not merely thin — those SERPs want numbered idea listicles or Pinterest galleries, and no amount of word count turns a 400-word app pitch into that. Effort should concentrate on the two winnable keywords rather than spreading evenly across six.

Full detail: `findings/sxo.md`

---

## Coverage notes

- The bundled `claude-seo` Python tooling was unavailable (`claude-seo doctor` → `ready: false`, managed environment missing). Run `/seo setup` to provision it. All findings here were produced with Lighthouse 12, curl, live SERP checks, and direct source reads — no analysis was skipped, but PDF report generation via `google_report.py` is unavailable until setup runs.
- PageSpeed Insights API returned a quota error (no API key configured), so Lighthouse was run locally instead. No CrUX field data exists for this domain regardless — the site has insufficient real-user traffic.
- No Google Search Console, GA4, Moz, or DataForSEO credentials were detected, so there is **no first-party data in this audit**: no impressions, clicks, positions, indexation status, or backlink profile. Connecting Search Console is the single highest-value next step for measurement — most recommendations here have no baseline to measure against without it.
