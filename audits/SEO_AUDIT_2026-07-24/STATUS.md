# Audit close-out — getcapsuleapp.com

All findings from `FULL-AUDIT-REPORT.md` reconciled against the live site, 2026-07-24.

## Score movement

| Category | Audit | Now |
|---|---|---|
| Technical SEO | 72 | ~95 |
| Content Quality | 43 | ~80 |
| On-Page SEO | 58 | ~98 |
| Schema | **3** | ~90 |
| Performance | 78 | 100 |
| AI Search Readiness | 43 | ~75 |
| Images | 55 | ~95 |
| **Health Score** | **52** | **~90** |

Lighthouse on production, mobile — homepage, a guide page, and support all return **Performance 100 · Accessibility 100 · Best Practices 100 · SEO 100**, LCP 0.9–1.0 s. At audit time the homepage was 91 / 96 / 100 / 100 with a 3.5 s LCP.

Category scores above are my own re-scoring against the original rubric, not a re-run of the audit. Content and AI Search Readiness are held below 90 deliberately — see "Not done" below.

## Done

| Finding | Severity | Where |
|---|---|---|
| No `<h1>` on the six SEO landing pages | Critical | Phase 1 |
| Every page live at two URLs, both 200 | Critical | Phase 1 |
| Zero structured data sitewide | Critical | Phase 2 |
| Thin content, 381–498 words | Critical | Phase 3 |
| 65–72% inter-page duplication | Critical | Phase 3 |
| No entity disambiguation | Critical | Phases 1–3 |
| Mobile LCP 3.5 s | High | Phase 2 |
| No security headers except HSTS | High | Phase 1 |
| Assets served `max-age=0` | High | Phase 1 |
| All images PNG, oversized | High | Phase 2 |
| No lazy loading / dimensions | High | Phase 2 |
| No question-phrased headings (0 sitewide) | High | Phase 3 |
| E-E-A-T: dead social links | High | Phase 1 |
| `og:image` square on a wide card | Medium | Phase 2 |
| `support`/`legal` missing OG tags | Medium | Phase 1 |
| Citable passages too short | Medium | Phase 3 |
| No dates / freshness signals | Medium | Phase 3 |
| Sitemap missing `lastmod` | Medium | Phase 3 |
| Generic screenshot filenames, no image sitemap | Medium | Phase 3 |
| `support.html` a 76-word stub | Low | Phase 3 |
| `og:type` website on content pages | Low | Phase 3 |
| No llms.txt | Low | Phase 3 |
| No IndexNow | Low | Phase 3 |
| WCAG AA contrast failures | — | Post-audit |

**Measured deltas:** guide pages 381–498 → 993–1164 words · duplication 65–72% → 43% mean · question headings 0 → 50 · image payload 494 KB → 71 KB · page transfer ~520 KB → 83 KB · JSON-LD nodes 0 → 20 across 9 pages.

## Deliberately not done

**`favicon.ico` kept** despite the audit flagging the serial request. Google uses `favicon.ico` for SERP favicons; ~140 ms post-paint is a bad trade for that.

**No `HowTo` or `FAQPage` schema.** The how-to page is HowTo-shaped and four separate analyses recommended it, but Google deprecated HowTo rich results in Sept 2023 and retired FAQ rich results for all sites on 7 May 2026. Neither produces a SERP feature.

**No `offers` / `downloadUrl` / `aggregateRating`.** No pricing or App Store link is published on the site and no real reviews exist. Marking any of these up would be structured data with no visible counterpart.

**Contrast fixes scoped to `landing/`.** The same white-on-`#FC6A5B` pairing (2.86:1) exists throughout the React Native app — every primary button. Untouched by explicit choice.

## Strategy call — RESOLVED

The SXO analysis rated three keywords unwinnable at zero authority. That was correct **for the bare head terms** — `graduation time capsule ideas`, `baby's first year time capsule` and `family reunion time capsule` return Pinterest boards, Snapfish, Etsy and parenting-media listicles, and no product page competes there.

Re-running the SERPs against the **qualified** variants returns a completely different competitive set:

| Query | Who actually ranks | Winnable? |
|---|---|---|
| `digital time capsule graduation` | Time Capsule – Memory Vault, TimeCapsules, SnapVault, TimeLock, SocialArchive, Medium | Yes — apps |
| `digital time capsule baby first year` | TimeLock, memoryKPR, woombie | Yes — apps + blogs |
| `shared photo album app family reunion` | Memento, Pix, JoinMyMoment, FamilyAlbum, We – Private Album | Yes — all apps |

So the answer wasn't "drop three pages", it was "they're aimed at the wrong phrasing." All three were retargeted:

- Graduation Time Capsule Ideas → **Digital Time Capsule for Graduation**
- Baby's First Year Time Capsule → **Digital Time Capsule for Baby's First Year**
- Family Reunion Time Capsule → **Shared Photo Album for Family Reunions**

Title, meta description, H1 and schema lead with the qualified term; the original head terms remain in body copy and H2s, so each page keeps a secondary shot at them. The "what should go in a …" idea sections added in Phase 3 are exactly what those listicle SERPs reward, so the pages are no longer structurally mismatched either. Slugs unchanged — renaming would need another redirect round and discard existing crawl history. Sitemap priorities levelled back to 0.8 across all six.

## Blocked on you — one item

**Google Search Console.** This genuinely cannot be done without you: it requires OAuth against your Google account. There are no Google credentials on this machine (`gcloud` absent, no service-account JSON), and the browser extension isn't connected, so there's no automation path either.

**Correction — the "stale Bluehost record" was a false alarm.** A `site:` query through a third-party search API surfaced a Bluehost parked-page record for this domain, and I flagged it as a possible un-recrawled index. Search Console disproved it: Google's last crawl of the homepage was **2026-07-13**, from the live Netlify site, and the homepage reports "URL is on Google." Nothing was wrong with discovery. `site:` through a search API is not a reliable read of Google's index and shouldn't be treated as one.

What Search Console actually revealed is narrower and more useful:

- The homepage is indexed, but its crawled copy is from **2026-07-13** — before every change in this audit. Google is serving the pre-optimisation version until it re-crawls.
- `/wedding-photo-time-capsule` reported **"URL is not on Google"**, confirming the audit's finding that the guide pages are absent from the index despite being linked from an indexed homepage and listed in the sitemap. Discovery isn't the problem; selection is.

Everything that *doesn't* need your account is already done: sitemap valid with all 9 URLs returning 200, no `noindex` or `X-Robots-Tag` anywhere, robots.txt open, full internal linking from the homepage to all six guides, and IndexNow submitted and accepted (Bing/Yandex family — Google does not participate).

**Status: done, 2026-07-24.** Domain property verified via TXT on the apex (confirmed propagated to Google's own resolver before verifying), `sitemap.xml` submitted, Request Indexing run on the guide URLs.

Two gotchas worth recording for next time:
- A **Domain** property's sitemap field needs the **full URL** (`https://getcapsuleapp.com/sitemap.xml`). Only URL-prefix properties accept a relative path — entering `sitemap.xml` returns "Invalid sitemap address".
- The TXT record's Name field in Netlify must be left **empty** for the apex. Entering `@` or the domain produces `getcapsuleapp.com.getcapsuleapp.com`.

Still worth doing: <https://www.bing.com/webmasters>. The IndexNow key is already deployed and submitting, so Bing will show data sooner than Google.

## What to watch now

The measurement loop is finally open. In rough order of when things should move:

| Signal | Where | Expect |
|---|---|---|
| Guide pages leave "not on Google" | URL Inspection / Pages report | days to ~2 weeks |
| Homepage last-crawl date advances past 2026-07-13 | URL Inspection | days |
| Sitemap "Discovered pages: 9" | Sitemaps | immediately |
| First impressions on guide URLs | Performance report | ~2–6 weeks |
| CrUX field CWV appears | Core Web Vitals | only once traffic is sufficient |

**The diagnostic that matters most:** if a guide page settles at **"Crawled – currently not indexed"** rather than "URL is not on Google", that is Google saying it saw the page and declined to index it. That points at content quality or duplication rather than discovery, and would mean the Phase 3 rewrite (381–498 → ~1000+ words, duplication 65–72% → 43%) didn't go far enough. That's the signal to act on, not raw impression counts.

**3. Brand entity.** `sameAs`, `og:site_name`, Organization schema and an llms.txt disambiguation section are all in place. What they cannot fix: "Capsule" collides with trycapsule.com, revealmoment.app, TimeCapsules, Capsula and several App Store apps in this exact niche. The App Store listing, once it exists, will be the strongest entity anchor available.

## How to verify this held

```bash
curl -sI https://getcapsuleapp.com/wedding-photo-time-capsule.html   # 301, not 200
curl -s  https://getcapsuleapp.com/sitemap.xml | grep -c lastmod     # 9
npx lighthouse@12 https://getcapsuleapp.com/ --form-factor=mobile --screenEmulation.mobile
./scripts/indexnow.sh                                                # after content deploys
```

Leading indicators, in order of what should move first: GSC Coverage reaching 9/9 indexed within ~3 weeks → impressions appearing on the guide URLs within ~6 weeks → CrUX mobile LCP p75 under 2.5 s once traffic exists.
