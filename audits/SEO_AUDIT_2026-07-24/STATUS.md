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

## Blocked on you

**1. Google Search Console — the highest-value remaining action.** At audit time only 2 of 9 pages appeared indexed (homepage + `/legal`); none of the six guide pages were in the index. Everything above optimises pages search engines may not have picked up yet. Verify the domain, submit `sitemap.xml`, and Request Indexing on the six guide URLs. Until this happens there is still **zero first-party data** — no impressions, positions, or indexation status — so none of this work is measurable.

**2. The Phase 3 strategy call.** The SXO analysis found three of the six keywords structurally unwinnable at zero authority — `graduation time capsule ideas`, `baby's first year time capsule` and `family reunion time capsule` return Pinterest galleries, Snapfish and parenting-media listicles. I deepened all six and added idea-list sections that move those pages toward the listicle format the SERPs reward, but that does not overcome an authority gap. Sitemap priorities now reflect the split (0.8 for the three winnable, 0.7 for the rest). Whether to keep investing in the other three is your call.

**3. Brand entity.** `sameAs`, `og:site_name`, Organization schema and an llms.txt disambiguation section are all in place. What they cannot fix: "Capsule" collides with trycapsule.com, revealmoment.app, TimeCapsules, Capsula and several App Store apps in this exact niche. The App Store listing, once it exists, will be the strongest entity anchor available.

## How to verify this held

```bash
curl -sI https://getcapsuleapp.com/wedding-photo-time-capsule.html   # 301, not 200
curl -s  https://getcapsuleapp.com/sitemap.xml | grep -c lastmod     # 9
npx lighthouse@12 https://getcapsuleapp.com/ --form-factor=mobile --screenEmulation.mobile
./scripts/indexnow.sh                                                # after content deploys
```

Leading indicators, in order of what should move first: GSC Coverage reaching 9/9 indexed within ~3 weeks → impressions appearing on the guide URLs within ~6 weeks → CrUX mobile LCP p75 under 2.5 s once traffic exists.
