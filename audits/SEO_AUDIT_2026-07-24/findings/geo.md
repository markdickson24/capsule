# GEO / AI Search Readiness Audit — getcapsuleapp.com

Audited: 2026-07-24. Source read directly from `/Users/markdickson/Desktop/capsule/landing/*.html` (9 pages) plus live SERP checks (DuckDuckGo HTML, since Google's AI Overview isn't fetchable headlessly). No DataForSEO MCP tools were available in this session.

## GEO Readiness Score: 43 / 100

| Dimension | Weight | Score | Weighted |
|---|---|---|---|
| Citability | 25% | 45/100 | 11.3 |
| Structural Readability | 20% | 35/100 | 7.0 |
| Multi-Modal Content | 15% | 40/100 | 6.0 |
| Authority & Brand Signals | 20% | 10/100 | 2.0 |
| Technical Accessibility | 20% | 90/100 | 18.0 |
| **Total** | | | **≈43** |

The site is technically wide open to every AI crawler and reads cleanly as static HTML — that part is close to ideal. Everything else drags the score down, and the single biggest problem is that **"Capsule" is a generic, already-used name with zero on-site or off-site disambiguation**, so even if an LLM crawls this content perfectly, it has no reliable way to attribute it to *this* product when synthesizing an answer.

---

## 1. AI Crawler Accessibility

`robots.txt` (verified, full contents):
```
User-agent: *
Allow: /

Sitemap: https://getcapsuleapp.com/sitemap.xml
```
This is a wildcard allow — **GPTBot, OAI-SearchBot, ClaudeBot, PerplexityBot, Google-Extended, Bingbot, and CCBot are all permitted.** No crawler is named or blocked, so there's no selective allow (fine at this stage — nothing here is worth protecting from training crawlers either).

**No CSR/rendering risk.** Read `site.js` (1.4KB) directly: it only handles (a) a nav scroll-class toggle, (b) the Formspree waitlist submit handler, and (c) an optional `?invited_by=` query-param banner. **Zero content is injected via JS** — every headline, paragraph, list item, and image alt text is present in the raw server-delivered HTML for all 9 pages. A non-rendering crawler (GPTBot, ClaudeBot, most of PerplexityBot's fetches) sees exactly what a browser sees. This is the strongest thing about the site technically.

`sitemap.xml` lists all 9 pages with correct priorities; every page has a self-referential `<link rel="canonical">`. No orphaned or unlisted pages found.

**Verdict: no crawler-access problems exist.** This is not where effort should go next.

## 2. llms.txt

**Confirmed missing.** `GET https://getcapsuleapp.com/llms.txt` → HTTP 404. No file in the repo either (`find . -iname llms.txt` returned nothing).

Honest assessment of value: llms.txt has **no confirmed adoption by any major AI crawler** (OpenAI, Anthropic, Google, Perplexity have not committed to reading it) — it functions more as a curated-context convenience for the small number of tools that opt to fetch it manually, not an indexing signal. **Google ignores it entirely** for AI Overviews. Given that, this is a **Low-priority, low-effort nice-to-have**, not a lever that will move citations. Worth 20 minutes precisely because it's cheap and there's a real, clean use case here: a one-person team with duplicated boilerplate across 6 nearly-identical pages could use it to point any llms.txt-respecting tool straight at the canonical definition and disambiguation paragraph (see §4) rather than making the tool infer it from repeated marketing copy. Don't expect it to move a Google AI Overview or ChatGPT citation.

## 3. Passage-Level Citability

Optimal citable passage length per the brief is 134–167 words with a direct answer in the first 40–60 words. Checked every page's opening definitional paragraph.

**What's citable today:**

- Homepage meta description / opening line (`index.html:10,49`): *"Capsule is a shared photo album that stays locked until everyone can open it together. Add photos as you go — nobody sees a thing until the date arrives."* — 27 words. This is a genuinely good, self-contained, extractable definition sentence. It's the single most citable string on the whole site, and it's used consistently as both the meta description and the H1 sub-line, which is correct. **Problem: it's too short to be a stand-alone AI Overview passage** (well under the 134–167 word sweet spot) and it never restates the brand-disambiguating context (see §4) inside the passage itself, so if an LLM lifts just this sentence, "Capsule" reads as a common noun, not a proper noun.

- `how-to-make-a-digital-time-capsule.html:39`: *"A digital time capsule is just a shared photo album that stays locked until a date — or moment — you choose, so opening it together becomes an event instead of another scroll."* — This is a clean, direct, question-answering definition (answers "what is a digital time capsule") in 31 words, sitting right under an H2. Genuinely good direct-answer material, again too short and with no source/stat attribution.

- The five-step list on that same page (`Pick the occasion → Decide who's contributing → Choose an unlock trigger → Collect photos as you go → Seal it and wait`) is a strong **HowTo-shaped answer** already — numbered, one clear action per step, plain language. This is the best structural raw material on the site and currently has **zero schema markup** wrapping it (see §Structured Data below), so an AI Overview HowTo-rich-result path is closed off entirely even though the content is shaped for it.

**Real gaps:**

- **No page anywhere states a direct, quotable answer to "what is Capsule" that includes disambiguating context** ("Capsule is an iOS app for..." / "unlike a note-taking app also called Capsule..."). Every definition sentence defines the *category* (digital time capsule / shared photo album) well but under-defines the *product*.
- **No FAQ content anywhere on the site.** Zero `<h2>`/`<h3>` phrased as a question ("How does a time capsule app work?", "Is Capsule free?", "When do wedding photos unlock?"). All headings are declarative statements ("Three steps. One unforgettable reveal.", "Guests capture what the couple can't see."). This is a direct, checkable gap against the brief's "question-based H2/H3 headings" signal — grep across all 9 pages for `<h2` / `<h3` returns **zero question-phrased headings**.
- **No statistics, no source attribution, no dates anywhere in body copy.** Every claim is a product-feature assertion, not a sourced fact. There is nothing here an LLM would cite as evidence rather than as a promotional claim.
- **The 6 occasion pages (wedding / couples / graduation / baby / family reunion / how-to) duplicate the same "Three steps" block near-verbatim** (`Start a capsule → [Everyone/Guests/Family/Both of you] add in → Open it together`) — good for a human skimming multiple pages, but from a crawler's perspective this is thin, template-repeated content: each of the 6 pages is only 380–500 words of actual prose (measured by stripping HTML tags and counting), and roughly half of that word count is identical across all six. An LLM synthesizing across pages sees one idea restated six times with the occasion word swapped, not six distinct bodies of evidence.
- **Testimonials are explicitly disclosed as fabricated/illustrative** (*"Illustrative scenarios based on how people use Capsule during testing — not verified reviews. Capsule is in private beta."*) — this is the right honest disclosure and should stay, but it also means this section contributes **zero real-world social-proof signal** an LLM could cite as evidence of adoption. It's marketing color, not citable fact.

## 4. Brand Mention & Entity Establishment — the biggest problem

This is the dimension that most needs attention, and it's a genuine, structural problem, not a copy tweak.

**"Capsule" collides with existing, actively-marketed products in the exact same conceptual space**, confirmed live via search just now:
- A Google Play app literally titled **"Capsule - Time Capsule"** ("Capsule is a digital time capsule app that lets you save photos, videos, audio messages, and heartfelt notes") — ranks on page 1 for "digital time capsule app" *and* again for "wedding photo time capsule app," i.e. directly inside getcapsuleapp.com's target query space.
- **Capsula – Digital Time Capsule** (apps.apple.com, by Primordial LTD) — ranks #1 for "digital time capsule app."
- Outside this niche entirely: Capsule CRM, Capsule Pharmacy, and a pill-organizer app named Capsule are all long-established uses of the identical word.

**On-site disambiguation is effectively zero:**
- No `og:site_name` meta tag on any page (grep confirmed absent across all 9 files) — this is a low-effort, real signal LLM/search entity-resolution pipelines use and it's simply not set.
- No JSON-LD anywhere on the site (`grep -l "application/ld+json" *.html` → no matches). No `Organization`, `WebSite`, `SoftwareApplication`, `FAQPage`, or `HowTo` schema exists at all. There is no machine-readable entity node asserting "Capsule is a [SoftwareApplication] made by [Organization] at [getcapsuleapp.com]."
- No About page, no founder name anywhere in visible copy (the only human identity on the whole site is `mark.dickson0824@gmail.com`, buried in three `mailto:` links on legal/support pages — never a name on-page: "built by one person" on `support.html` doesn't even give that person's name).
- No legal entity name anywhere (Privacy Policy says only "we/us/our," never a company name) — there's nothing for an LLM to anchor a Knowledge-Graph-style entity to beyond the bare word "Capsule."
- **The footer's Instagram / TikTok / X links are literal `href="#"` placeholders** — not broken links to real accounts, but *no accounts at all*. Per the brief's own correlation table, YouTube mentions (~0.737) and Reddit presence are the strongest off-site brand-mention correlates with AI citation, and this brand currently has **no verifiable presence on any of the platforms in that table** — no YouTube, no Reddit, no Wikipedia entity, and the footer's own social links are dead placeholders rather than even a nascent one.
- `site:getcapsuleapp.com` on DuckDuckGo returns only **2 real pages indexed** (homepage + `/legal`) — none of the 6 SEO-targeted occasion pages, `support.html`, or the sitemap's other entries showed up. The site's off-site footprint is close to nonexistent at this stage (expected for a private-beta waitlist site, but worth stating plainly: there is currently no entity signal for any AI system to have learned yet).

**Net effect:** even a perfectly-crawled, perfectly-structured page here would still leave an LLM unable to confidently answer "what is Capsule" without either (a) picking one of the several other same-named products, or (b) declining to cite it as a distinct entity at all. This is a naming/entity problem that content structure alone can't fully fix — it needs deliberate on-site disambiguation (a consistently-used longer-form identifier like "Capsule (the photo-sharing app)" or a distinguishing tagline used verbatim everywhere) plus genuine off-site presence-building, not just better headings.

## 5. Real Search Results — Does Capsule Actually Surface?

Ran 5 queries a real user would type. Google's rendered AI Overview isn't fetchable headlessly in this environment, so these are organic SERP checks (DuckDuckGo HTML backend), which is a reasonable proxy for what a retrieval-augmented AI answer engine would also be drawing from:

| Query | Capsule present? | Who owns the answer |
|---|---|---|
| "digital time capsule app" | **No** — absent from top 10 | Capsula (App Store), TimeLock, PersonalCapsule, "Capsule - Time Capsule" (Google Play — different app, same name), Time Capsule Creator, reanimationlab.com |
| "app that locks photos until a date" | **No** — absent from top 8 | Photo Time Release, App Lock/Secret Photo Vault, Timer Lock, Keepsafe Photo Vault — note none of these actually match Capsule's *shared-group-unlock* concept; they're single-user vault apps. This is a positioning gap as much as a ranking one. |
| "shared photo album that unlocks later" | **No** — absent from top 8 | **Reveal** (revealmoment.app) ranks #7 with near-identical positioning: *"The album unlocks — for everyone, simultaneously. You see what happened from every angle. Photos and videos you never knew existed."* Fetched revealmoment.app directly to confirm: it's a group-capture, delayed-reveal, multi-perspective app for weddings/events — **conceptually almost the same product as Capsule**, already indexed, with a distinctive non-colliding brand name and a tagline doing real GEO work ("Grab the moment. Reveal it later. Together."). |
| "wedding photo time capsule app" | **Yes — #3** | getcapsuleapp.com's homepage does surface here, immediately followed at #6 by "Capsule -Time Capsule" (Google Play, the unrelated app) — visible proof of the name-collision problem inside a single real result set. |
| `site:getcapsuleapp.com` | 2 pages indexed | Homepage + `/legal` only; the 6 occasion pages and `/support` did not appear. |

**Reading this honestly:** Capsule is not visible for the two broadest, highest-intent queries in this space ("digital time capsule app," "app that locks photos until a date"), *does* appear for one narrower, well-targeted long-tail query ("wedding photo time capsule app") where its dedicated landing page matches search intent closely, and is being out-positioned by **Reveal (revealmoment.app)**, a direct conceptual competitor with a cleaner, non-colliding brand name, for the closest-matching query to Capsule's actual value proposition ("shared photo album that unlocks later"). Reveal is the one competitor worth watching specifically for GEO purposes — its tagline and framing are close enough to Capsule's that it's likely to be the citation an AI answer engine reaches for instead of Capsule in this niche.

## 6. Platform-Specific Notes

- **Google AI Overviews:** Draws heavily from top-ranking organic results and prefers schema-marked, question-answering content. Capsule currently has neither ranking presence for head terms nor any schema. Near-zero likelihood of an AIO citation today for anything but the exact long-tail wedding query, and even there it's competing inside the same result set as a same-named unrelated app.
- **ChatGPT Search / OAI-SearchBot:** Crawler access is fully open (confirmed via robots.txt) and the static HTML is trivially parseable, so indexing isn't the blocker — retrieval relevance and entity confidence are. A generic one-word brand name with no `og:site_name`/schema anchor is a specific, known weak point for ChatGPT's entity grounding.
- **Perplexity:** Tends to favor pages with clear, quotable, sourced statements and recency signals (dates, "last updated"). The site has a real "Last updated — June 10, 2026" date on `/legal` but **no dated content anywhere in the marketing/guide pages** — nothing for Perplexity's freshness weighting to grab onto outside the legal doc.
- **Bing Copilot:** Same static-HTML advantage as ChatGPT; Bing's index (via `site:` checks) currently shows minimal indexation depth, consistent with the DuckDuckGo finding of only 2 pages indexed.

---

## Top 5 Highest-Impact Changes

1. **[Critical, effort: Medium]** Add on-site brand disambiguation. Every page's title/meta/H1 should consistently use a longer identifying string (e.g. "Capsule — the time-locked shared photo album app") rather than the bare word "Capsule," and add one clear disambiguating sentence near the top of the homepage ("Not to be confused with note-taking or CRM apps of the same name — Capsule here refers specifically to..."). This directly addresses the entity-collision problem confirmed live in SERPs (§4, §5).
2. **[Critical, effort: Low]** Add `Organization` + `WebSite` + `SoftwareApplication` JSON-LD to every page, and an `og:site_name` meta tag site-wide. Currently zero structured data exists anywhere (confirmed by grep). This is the cheapest, highest-leverage fix available and gives every AI crawler an explicit machine-readable entity node instead of forcing inference from prose.
3. **[High, effort: Low]** Add `HowTo` schema to `how-to-make-a-digital-time-capsule.html`'s existing 5-step list — the content is already perfectly shaped for it (numbered, one action per step, no schema wrapping today). This is the single best rich-result/AIO opportunity already sitting on the site unused.
4. **[High, effort: Medium]** Convert at least 2–3 headings per page from declarative statements to question form ("How does a time capsule app work?" instead of "Three steps. One unforgettable reveal.") and add a short FAQ block (5-8 Q&As) to the homepage and the how-to guide with `FAQPage` schema. Zero question-phrased headings exist anywhere today (confirmed by grep across all 9 files) — this is a direct, checkable gap against the citability signals the brief specifies.
5. **[High, effort: Low]** Fix the footer's dead social links (`href="#"`) — either point them at real, even nascent Instagram/TikTok/X/YouTube profiles or remove them. Given the brief's own data (YouTube ~0.737, Reddit high correlation with AI citation), a placeholder-only social footprint is actively signaling "no real presence" rather than simply being neutral. This won't move the needle alone, but it's a five-minute fix for something currently working against the brand.

**Not urgent:** llms.txt (§2) and adding an H1 to the 6 occasion pages (currently `<h2 class="sec-title">` is the top-level heading on `wedding-photo-time-capsule.html`, `time-capsule-app-for-couples.html`, `graduation-time-capsule-ideas.html`, `babys-first-year-time-capsule.html`, `family-reunion-time-capsule.html`, and `how-to-make-a-digital-time-capsule.html` — confirmed via `grep -c "<h1"` returning 0 for all six) are both real, easily-fixed technical-SEO gaps worth doing, but neither is what's suppressing citations right now — the entity-collision and thin/duplicated-content problems are.
