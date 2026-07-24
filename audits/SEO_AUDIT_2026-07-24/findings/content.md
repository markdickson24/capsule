# Content Quality / E-E-A-T Audit — getcapsuleapp.com

Analyzed directly from source: `/Users/markdickson/Desktop/capsule/landing/*.html` (9 pages). Word counts computed by stripping `<script>`, `<style>`, `<svg>`, and all remaining tags, then splitting on whitespace (Python `re`). "Unique prose" counts exclude nav, footer, the templated 3-step "How it works" block, the templated testimonial wrapper, the templated CTA band, and the "More time capsule ideas" link list — i.e. only the H1/eyebrow/lead + "Why X" section + bullet list that actually differs per page.

## Content Quality Score: 43/100

Pulled down almost entirely by the 6 SEO landing pages (67% of the site's pages): near-duplicate templated bodies, content 3-6x thinner than the gate for this page type, and a missing H1 on every one of them. The homepage and legal/support pages are solid and would score 75-80 in isolation.

---

## What works

- **Homepage is substantial and well-structured.** ~888 words of real body content (nav 15 words + footer 23 words excluded), proper single `<h1>`, clean H2→H3 hierarchy, six distinct sections (how it works, screenshots, testimonials, occasions, features, CTA). Clears the 500-word homepage gate comfortably.
- **Honest, non-deceptive marketing** — a genuinely rare positive for a pre-launch app landing page:
  - Testimonials are explicitly labeled: *"Illustrative scenarios based on how people use Capsule during testing — not verified reviews. Capsule is in private beta."* (index.html, repeated verbatim on all 6 landing pages). This is exactly the kind of disclosure Sept 2025 QRG rewards — it would be a major trust violation to present these as real reviews, and the site doesn't.
  - Screenshot placeholders are explicitly labeled as placeholders (`shot-tag: "App Screenshot"`) rather than faked; the 2 real screenshots that do exist have detailed, accurate alt text.
  - Access model is disclosed plainly: *"Capsule isn't on the App Store or Google Play yet. Join the waitlist and we'll email your TestFlight invite as spots open."*
- **Legal/trust content is genuinely thorough for a solo-dev app.** `legal.html` (1,164 words) covers Privacy Policy, Terms of Service, and Community Guidelines with GDPR/CCPA rights language, a CSAM zero-tolerance clause, retention policy, and a dated "Effective June 10, 2026." `support.html` gives a real, working contact email tied to a named person and a same-day response expectation — a concrete trust/experience signal ("built and run by one person... goes straight to me, not a ticket queue").
- **No dark patterns.** No cookies/trackers (explicitly disclosed as none), a real double opt-in style consent checkbox on the waitlist form, honeypot spam field, no fake urgency/scarcity copy.
- **Good crawlability plumbing:** `robots.txt` + `sitemap.xml` present, every page has a canonical tag, unique `<title>`/OG tags per page, and all 6 landing pages are reachable within one click from the homepage via contextual anchor text (not a orphaned/hidden doorway cluster).
- **Distinct search intent per landing page** at the title/H2/meta level — wedding photos, couples, graduation, baby's first year, family reunion, and a generic "how to" guide are six genuinely different queries, not the same keyword repeated. Cannibalization risk at the *query* level is low; the risk is at the *content* level (see Critical #2).

---

## Findings

### CRITICAL

**C1. Every one of the 6 SEO landing pages has no `<h1>`.**
Verified by grepping all heading tags: `index.html`, `support.html`, and `legal.html` correctly use `<h1>` for their page title. All six landing pages — `wedding-photo-time-capsule.html`, `time-capsule-app-for-couples.html`, `graduation-time-capsule-ideas.html`, `how-to-make-a-digital-time-capsule.html`, `babys-first-year-time-capsule.html`, `family-reunion-time-capsule.html` — use `<h2 class="sec-title">` for what is visually and semantically the page's main title:
```html
<h2 class="sec-title">The wedding photo time capsule.</h2>
```
These are exactly the pages built to rank for their target keyword, and they're missing the single strongest on-page relevance signal for that keyword. Fix: change the guide-header title to `<h1>` on all 6 pages (restyle via CSS class, not tag, to keep visual weight matching `.sec-title` elsewhere).

**C2. The 6 SEO landing pages are thin content, ~3-10x under the applicable minimum.**
Total page word counts (including all boilerplate — nav/footer/template/CTA):

| Page | Total words | Unique prose words | Unique ratio |
|---|---|---|---|
| wedding-photo-time-capsule.html | 381 | 149 | 39% |
| time-capsule-app-for-couples.html | 385 | 153 | 40% |
| graduation-time-capsule-ideas.html | 382 | 155 | 41% |
| babys-first-year-time-capsule.html | 392 | 160 | 41% |
| family-reunion-time-capsule.html | 388 | 162 | 42% |
| how-to-make-a-digital-time-capsule.html | 498 | 235 | 47% |

These pages target head-ish informational/commercial queries ("wedding photo time capsule," "how to make a digital time capsule") that should be judged against the blog-post floor (1,500 words) or at minimum the service-page floor (800 words) — they're informational guides, not product/location pages. At 149-235 words of genuinely unique prose, every page fails even the 300-word product-page floor, let alone what's realistically needed to out-cover competing guides (Shutterfly-style blog posts, wikiHow-style walkthroughs) that run 1,500-2,500 words with FAQs, examples, and images. This isn't a "these are topical floors not targets" case — there simply isn't enough unique material here to demonstrate topical coverage at all.

**C3. Near-duplicate content risk across the 5 occasion pages is high and quantifiable.**
Line-level `difflib.SequenceMatcher` similarity between the 5 occasion pages (wedding / couples / graduation / baby / family-reunion — excluding the more-differentiated how-to guide):

```
wedding      vs couples      66%
wedding      vs graduation   66%
wedding      vs baby         67%
wedding      vs family       66%
couples      vs graduation   67%
couples      vs baby         67%
couples      vs family       74%
graduation   vs baby         67%
graduation   vs family       69%
baby         vs family       67%
```
65-74% line-level identity between any two of these pages. Concretely, the "How it works" 3-step block is copied nearly verbatim across all 5 (and the how-to and homepage make it 7 near-identical instances site-wide) with a single word swapped per sentence:

- Step 1 — **byte-identical across all six pages**: *"Pick a name, set the unlock date, and decide who can add."*
- Step 2 template: *"[Everyone / Every friend / Every relative] drops in photos and videos from their own perspective — no one sees a thing until the day."*
- Step 3 template: *"the capsule unlocks for [every member / the whole group / the whole family] at once — [the whole day / a year of milestones / every angle], at one time."*

The testimonial block is also identical scaffolding (*"What opening one feels like" / "The wait makes the opening." / "Illustrative — based on how people use Capsule during testing, not a verified review."*) wrapped around one of the same 4 quotes already used on the homepage — no page has a testimonial unique to its own occasion. The CTA band (*"Lock it in. Unlock together."*) and the "More time capsule ideas" internal-link block are template-identical too.

This is the classic thin-templated-page-cluster pattern the March 2024 core update's merged helpful-content signals specifically target — 6 pages differentiated mainly by swapping a noun (bride/groom → baby → cousins) around an otherwise-identical skeleton, each individually too short to stand alone. The risk isn't that Google can't tell the pages apart (titles/H2s/meta are genuinely distinct), it's that a rater or algorithmic signal sampling any two of these bodies would see ~2/3 identical text and correctly flag it as programmatic-style duplication rather than six independently useful guides.

**Fix priority:** this is the single highest-leverage fix available. Each page needs 400-800 words of content that literally cannot be templated — e.g., 3-5 concrete unlock-date ideas specific to that occasion (the "how-to" guide already models this well with its 5-step structure), a short FAQ (2-4 questions) unique to that occasion, or a "what to include" checklist. Even keeping the shared 3-step mechanic block (it's legitimately reusable UI-pattern copy) but tripling the unique "Why X" section per page and adding an occasion-specific FAQ would fix both C2 and C3 at once.

### HIGH

**H1. No structured data anywhere on the site.** `grep -l "application/ld+json" *.html` returns nothing. There's no `SoftwareApplication`/`MobileApplication` schema on the homepage (a pre-launch app is a legitimate use case — `applicationCategory`, `operatingSystem: iOS`, pricing = free waitlist), no `FAQPage` schema (there's no FAQ content to mark up yet — see H2), and no `HowTo` schema on `how-to-make-a-digital-time-capsule.html` despite it being a genuine 5-step numbered guide (Pick the occasion → Decide who's contributing → Choose an unlock trigger → Collect photos as you go → Seal it and wait). That page is the single best AI-citation/rich-result candidate on the site and currently gets zero structured-data support.

**H2. No FAQ content anywhere.** Zero `<dt>/<dd>`, zero visible Q&A pattern, zero PAA-shaped content across all 9 pages. For query types like "how to make a digital time capsule" or "wedding photo time capsule ideas," FAQ sections are typically what wins People-Also-Ask and AI-Overview citations. This is a clean, low-cost addition (2-4 Qs per landing page) that would simultaneously fix the thin-content problem (C2) and the duplicate-content problem (C3), since FAQ answers are inherently occasion-specific and hard to template.

**H3. Authoritativeness is close to zero, and part of that is self-inflicted.** The footer's Instagram/TikTok/X links are `href="#"` — dead placeholders presented as live social links on every single page (9/9). For a pre-launch solo app with no press and no App Store listing yet, near-zero external authority is expected and not really fixable right now — but shipping fake-looking social links that go nowhere is a small, gratuitous trust hit that's easy to fix immediately: either link them to real (even empty) profiles or remove them until they exist.

### MEDIUM

**M1. Meta descriptions run long on 5 of 7 indexable pages** and will truncate in Google's SERP (~155-160 char practical limit):

| Page | Description length |
|---|---|
| wedding-photo-time-capsule.html | 197 chars |
| time-capsule-app-for-couples.html | 190 chars |
| family-reunion-time-capsule.html | 177 chars |
| how-to-make-a-digital-time-capsule.html | 175 chars |
| graduation-time-capsule-ideas.html | 173 chars |
| index.html | 153 chars ✓ |
| babys-first-year-time-capsule.html | 149 chars ✓ |

Not a content-quality issue per se, but it undercuts the value of writing custom descriptions if Google is going to cut them off mid-sentence or override them with a self-generated snippet from the (also thin) body text.

**M2. No freshness signal anywhere on the marketing/landing content.** `legal.html` has "Last updated — June 10, 2026" (good), but the homepage and all 6 landing pages carry no date, no changelog, no "as of [date]" — meaning there's no way for a rater or crawler to distinguish current, actively maintained pages from stale ones. Low priority pre-launch, but worth adding once the app ships (e.g., a lightweight "Updated for iOS TestFlight, July 2026" line) since app landing pages benefit from visible signs of active maintenance once real users exist.

**M3. Testimonial reuse undercuts the "illustrative" framing slightly.** The disclosure is honest and appropriate, but because the *same four quotes* (Alex H./road trip, Sarah M./baby, Jordan K./wedding, Priya R./graduation) are redistributed across the homepage and all 6 landing pages with no occasion-specific quote ever appearing on its matching page consistently (e.g., the wedding page uses Jordan K.'s wedding quote — fine — but the couples page and family-reunion page both reuse Alex H.'s road-trip quote, which has nothing to do with either occasion), it reads as filler rather than curated social proof. If keeping illustrative quotes, at minimum match the quote's stated context to the page's occasion.

**M4. The 5-step "How to make a digital time capsule" list isn't marked up as a semantic ordered list** — it's a series of `<div class="field-step">` blocks with a visually-styled `01`/`02`/... number, not an `<ol>`/`<li>`. Text is still fully readable to crawlers/LLMs, but it loses list semantics for assistive tech and forfeits an easy `HowTo` schema mapping (see H1).

### LOW

**L1. No `lastmod` in `sitemap.xml`** — all 9 URLs have `changefreq`/`priority` but no `<lastmod>`, so there's no machine-readable freshness signal even for crawlers that respect it.

**L2. `og:image` is the square app logo (`logo.png`) reused identically on all 9 pages** rather than a page-specific 1200x630 social card — fine functionally, but a missed differentiation opportunity once real screenshots exist (the homepage already has 2 real screenshots that could be used).

**L3. Copyright line reads "© 2026 Capsule" with no legal entity name.** Not required for a waitlist-stage site, but worth adding once there's a registered entity, since `legal.html` references "we"/"us"/"our" throughout without ever naming who that is.

---

## E-E-A-T Breakdown (realistic bar for a solo-dev, non-YMYL consumer app landing site)

| Factor | Weight | Score | Basis |
|---|---|---|---|
| Experience | 20% | 45/100 | One genuine signal ("built and run by one person," support.html) but no founder narrative, no build-in-public content, no dated development log. Testimonials are labeled illustrative (correct to do), so they can't count as experience evidence. |
| Expertise | 25% | 40/100 | Legal docs are competently drafted (GDPR/CCPA-aware, CSAM clause, correct terminology) — real baseline competence. But zero demonstrated subject-matter depth on the actual topic (time-capsule traditions, event planning, photo-sharing norms) beyond generic marketing claims. |
| Authoritativeness | 25% | 20/100 | No backlinks, no press, no App Store presence yet, dead social links presented as live. Structurally low for a pre-launch product — not fully fixable yet, but the dead social links (H3) are a self-inflicted drag worth removing now. |
| Trustworthiness | 30% | 75/100 | Strongest factor by far: real named contact, dated and thorough privacy/terms/guidelines, no dark patterns, no deceptive reviews/screenshots, honest pre-launch/TestFlight disclosure, working consent flow. |
| **Weighted composite** | | **47/100** | |

This is a fair E-E-A-T score for where the product actually is (pre-launch, one developer, no users yet) — the trust foundation is genuinely above-average for an indie landing page. The gap between the 47 E-E-A-T composite and the 43 overall content score reflects that the content-depth/duplication problems (C1-C3) are a bigger drag on rankability than the E-E-A-T signals are.

---

## AI Citation Readiness

**What's citable today:**
- The definitional sentence on the how-to guide is genuinely quote-ready: *"A digital time capsule is just a shared photo album that stays locked until a date — or moment — you choose, so opening it together becomes an event instead of another scroll."* Self-contained, answers the implicit "what is X" query directly.
- The 5-step structure (Pick the occasion → Decide who's contributing → Choose an unlock trigger → Collect photos as you go → Seal it and wait) is a clean, quotable step list — but see H1/M4: no schema, no semantic `<ol>`.
- The 4 bullet lists on each occasion page (`<ul class="guide-list">`) are short, factual, self-contained claims about the product (e.g., *"Proximity unlock: the capsule can open the instant you're physically reunited, no date required"*) — reasonably citable as feature facts, though tied to product marketing rather than independent informational value.

**What's missing:**
- No FAQ blocks (H2) — the single highest-value gap for AI Overview/PAA citation.
- No comparison content (time capsule vs. shared album vs. group chat vs. BeReal-style apps) — a natural, currently-absent citation target for "digital time capsule" style queries.
- No HowTo/FAQPage/SoftwareApplication schema (H1) to make the already-good structural content machine-parseable.
- No genuinely unique data/stats/examples per occasion page — everything citable is either generic product description or borrowed from the homepage.

---

## Conversion / Intent Match

For a pre-launch app with only an email waitlist as the conversion goal, the intent match is reasonably good and not a major issue:
- Each landing page answers its stated query in the first 2 sections (H1 + lead + "Why X") *before* any hard sell — a searcher for "baby's first year time capsule" gets an actual explanation of the concept and the specific value prop (family near/far, surprise mode, unlock on first birthday) before hitting the CTA.
- The CTA is honest about state (TestFlight waitlist, not "download now") and appears once, at the bottom, not interstitial/popup — no forced-CTA or intent-mismatch pattern.
- The weakness isn't intent mismatch, it's that the pre-CTA content is too thin (C2) to fully satisfy someone who searched a research-stage query ("how to make a digital time capsule") rather than a product-discovery query — those searchers are more likely to bounce to a longer competing guide before ever reaching the CTA.

---

## Priority Fix List

1. **(Critical)** Add `<h1>` to all 6 landing pages — same-day CSS-only fix.
2. **(Critical)** Write 300-500 words of page-unique content per landing page (FAQ block is the most efficient vehicle — kills C2 and C3 simultaneously, and creates H2/schema material).
3. **(Critical)** Reduce template-block verbatim overlap — vary the "How it works" step copy per occasion beyond single-word swaps, and stop reusing homepage testimonials verbatim without occasion match.
4. **(High)** Add `HowTo` schema to the how-to-make guide; add `SoftwareApplication` schema to the homepage.
5. **(High)** Build a real FAQ section (2-4 Qs) per landing page.
6. **(High)** Fix or remove the dead `href="#"` social links sitewide.
7. **(Medium)** Trim meta descriptions to ≤160 chars on the 5 affected pages.
8. **(Medium)** Match illustrative testimonial context to page occasion, or write one unique quote per occasion.
9. **(Low)** Add `<lastmod>` to sitemap.xml; convert the 5-step guide to semantic `<ol>`.
