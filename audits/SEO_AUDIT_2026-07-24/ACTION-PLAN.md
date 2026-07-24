# Action Plan — getcapsuleapp.com

Ordered by dependency, not just severity. Health score today: **52/100**.

The sequencing principle: **six pages aren't indexed yet, so get them indexed before polishing them.** Then fix the things that make an indexed page rank. Then decide whether the content strategy is worth continuing at all — the SXO findings say three of the six pages are structurally unwinnable, and that decision should come *before* anyone writes another 1,000 words.

---

## Phase 0 — Prerequisite (do this first, today)

### 0.1 Connect Google Search Console · 15 min · **blocks everything**
Verify the domain, submit `sitemap.xml`, and use URL Inspection → Request Indexing on all six landing pages.

This audit contains **zero first-party data** — no impressions, clicks, positions, or indexation status — because no GSC, GA4, or backlink credentials exist. Every recommendation below is currently unmeasurable. This single step turns the rest of the plan from guesswork into something you can verify.

**Leading indicator:** Coverage report shows 9/9 pages indexed within 2–3 weeks.

---

## Phase 1 — Critical fixes (Week 1, ~2 hours total)

### 1.1 Add `<h1>` to all six landing pages · 5 min · **highest impact-per-minute on this list**
Change `<h2 class="sec-title">` → `<h1 class="sec-title">` inside `<header class="guide-header">` in:
`wedding-photo-time-capsule.html`, `time-capsule-app-for-couples.html`, `graduation-time-capsule-ideas.html`, `how-to-make-a-digital-time-capsule.html`, `babys-first-year-time-capsule.html`, `family-reunion-time-capsule.html`

`.sec-title` is styled by class, not tag — **zero visual change**. While in there, lead each H1 with the target phrase.

### 1.2 Resolve the dual-URL duplication · 30 min · needs care
Deploy `landing/_redirects` **and in the same commit**:
- drop `.html` from all 9 `<link rel="canonical">` values
- drop `.html` from all 9 `og:url` values
- drop `.html` from all 9 `<loc>` entries in `sitemap.xml`

⚠️ Shipping the redirect without the canonical/sitemap edits makes things **worse** — the canonical would point at a URL that 301s away.

**Implemented via `landing/_redirects` + `landing/_headers`, not `netlify.toml`.** Those files live inside the publish directory and are read from the deploy root, so they require no build-config change — avoiding the risk of declaring a wrong `publish` path and 404-ing the site.

**Verify:** `curl -sI https://getcapsuleapp.com/wedding-photo-time-capsule.html` → expect `301`, not `200`. Then submit the waitlist form once.

### 1.3 Fix the three dead footer social links · 5 min
Replace `href="#"` with the real URLs, which already exist in `src/lib/communityLinks.ts`:
`https://instagram.com/app.capsule` · `https://tiktok.com/@capsule.photo`
There is no X/Twitter URL in that file — create the account or **remove the link** rather than shipping a third dead one. Consider adding the Discord link too.

### 1.4 Add OG/Twitter tags to `support.html` and `legal.html` · 10 min
Both currently have zero. Copy the block from any landing page and swap title/description/url.

---

## Phase 2 — High-impact improvements (Weeks 2–3, ~4 hours)

### 2.1 Image optimization · 45 min · fixes mobile LCP *and* the Images score
```bash
cd landing
sips -Z 72 logo.png --out logo-72.png && cwebp -q 82 logo-72.png -o logo.webp
cwebp -q 80 -resize 740 0 screenshots/home.png   -o screenshots/home.webp
cwebp -q 80 -resize 740 0 screenshots/create.png -o screenshots/create.webp
```
Then on every `<img>`: add `width`, `height`, `decoding="async"`, and `loading="lazy"` on the two below-fold screenshots (keep the nav logo eager). `logo.png` is 512×512/80 KB rendered at 36×36, twice per page, on all 9 pages — this alone removes ~76 KB from every pageview.

**Verify:** `npx lighthouse@12 https://getcapsuleapp.com/ --form-factor=mobile --screenEmulation.mobile` → mobile LCP under 2.5 s (currently 3.5 s). If it doesn't drop below ~1.5 s, the decode diagnosis was wrong — re-read the trace for a style-recalc on the `.load-in` hero animation.

### 2.2 Deploy structured data · 1 hour
Copy the ready-made JSON-LD from `findings/schema.md` in this order:
1. `Organization` + `WebSite` on `index.html` — everything else references these. Include `sameAs` with the now-live social URLs from 1.3.
2. `WebPage` + `BreadcrumbList` on the six landing pages
3. `ContactPage` on support, `WebPage` on legal
4. Minimal `SoftwareApplication` on the homepage

**Do NOT add** `HowTo` schema (Google deprecated the rich result in Sept 2023) or `FAQPage` (Google retired FAQ rich results for all sites on 7 May 2026). Several sources will suggest both — neither produces a SERP feature anymore.
**Hold** `offers` until pricing appears on the page, `downloadUrl` until the App Store link exists, `aggregateRating` until real reviews exist.

**Verify:** Google Rich Results Test on each page type.

### 2.3 Produce a proper OG image · 1 hour (design)
Current `og:image` is the 512×512 square logo against a `summary_large_image` card, which expects **1.91:1**. Build one 1200×630 image minimum; ideally one per occasion page. Add `og:image:width`/`og:image:height` and `og:site_name` (currently absent sitewide, and it's a real entity signal).

For a pre-launch waitlist product, the share card is a primary acquisition surface — this is arguably higher ROI than several technical items above it.

---

## Phase 3 — Content strategy decision (Month 2)

**Make the decision before writing anything.** The SXO analysis found three of the six pages are structurally mismatched, not merely thin:

| Keyword | SERP wants | Decision |
|---|---|---|
| `time capsule app for couples` | Competitor app pages | **Invest** — type already matches |
| `how to make a digital time capsule` | How-to guides (Dropbox, ForKeeps, Klokbox rank this way) | **Invest** — shape already right, needs depth |
| `wedding photo time capsule` | Wedding-vendor planning guides | **Invest** — already ranks #3, best traction on the site |
| `graduation time capsule ideas` | Pinterest galleries, numbered listicles | **Deprioritize** |
| `baby's first year time capsule` | Parenting-media listicles | **Deprioritize** |
| `family reunion time capsule` | Snapfish, Family Tree Magazine, Etsy, Pinterest | **Deprioritize** |

### 3.1 Deepen the three winnable pages · 3–4 hours each
Take each from ~400 words to 900–1,200 words of genuinely unique content. The constraint isn't length — it's that 53–61% of each page is currently shared boilerplate (line-level similarity between the occasion pages measures **65–74%**; step 1 of "How it works" is byte-identical across all six). Cut the duplicated block down or vary it substantially.

Add, on every deepened page:
- **Question-phrased H2/H3s.** There are currently **zero** question headings across all 9 pages. This is the cheapest AI-citability fix available.
- A 134–167 word self-contained answer passage near the top that names the product explicitly ("Capsule is an iOS app that…") rather than defining the category generically.
- Real screenshots — the landing pages currently have **no images at all** except the nav logo.
- A visible date/last-updated line. Nothing outside `/legal` has any freshness signal.

### 3.2 Leave the three deprioritized pages in place, but don't invest
They're not harming anything now that they'll have H1s and canonicals. Revisit only if domain authority grows substantially.

### 3.3 Entity disambiguation · ongoing
Adopt one consistent descriptor that always travels with the name ("Capsule — the time-locked photo album"). Use it verbatim in `<title>`, the App Store name field, `Organization.name`/`alternateName`, and every social bio. Target the **uncontested differentiators** — *surprise mode* (the owner locked out of their own album) and *awards/superlatives voting at unlock* — rather than the crowded "time capsule" head term. No competitor found in this audit markets either feature.

---

## Phase 4 — Monitoring (ongoing)

| Check | Cadence | Signal that something's wrong |
|---|---|---|
| GSC Coverage | Weekly | Fewer than 9 pages indexed after 3 weeks |
| GSC Performance, per-page impressions | Weekly | The three invested pages show no impression growth after 6 weeks |
| CrUX mobile LCP p75 (once traffic exists) | Monthly | Above 2.5 s — lab fix didn't hold in the field |
| `curl -sI …/*.html` | After each deploy | Returns 200 instead of 301 — Pretty URLs regressed |
| Rich Results Test | After schema changes | New validation errors |
| Search "Capsule time capsule app" | Quarterly | trycapsule.com still outranks you after 3 months of entity work → the name itself is the constraint, and renaming deserves genuine reconsideration |

---

## What I'd do with only two hours

Phase 0.1 (GSC) + 1.1 (H1s) + 1.3 (social links) + 2.1 (images). That's the indexation unblock, the single biggest on-page relevance signal, the cheapest entity signals, and the only failing Core Web Vital — roughly 90 minutes of work against the four highest-leverage findings in the audit.
