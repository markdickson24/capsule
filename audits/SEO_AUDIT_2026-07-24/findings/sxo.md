# SXO Audit — getcapsuleapp.com (6 landing pages)

Site state confirmed from source: pre-launch waitlist site (`robots.txt` allows all, `sitemap.xml` lists all 9 pages incl. 6 target pages). `index.html` references "TestFlight" (2x) and "waitlist" (8x) but "App Store" only once in passing copy — **no live App Store link**. All 6 target pages: no `<h1>` (hero is `<h2 class="sec-title">`, confirmed per brief), no JSON-LD/schema anywhere on the site (`grep -l ld+json *.html` → zero matches), 2 `<img>` tags per page (logo + nav mark only — zero content imagery, zero screenshots, zero infographics), 382–498 words of body copy, template-identical structure (eyebrow → h2 hero → 3–4 short sections → fake/"illustrative" testimonial → CTA → "more ideas" internal links → footer).

## 1–2. SERP Analysis + Page-Type Mismatch (per keyword)

### "wedding photo time capsule"
**SERP:** wedding-photographer blog posts (french-touch-photography, bydesign wedding films), wedding-venue blog (Salvatore's Chicago), wedding-vendor blogs (njweddingpros, kwillt.com — itself a time-capsule product sold through content marketing), 1 Pinterest board, 1 general blog (make-history.com).
**Dominant page type:** Vendor/blog long-form guide ("what to include," "when to open it"), content-marketing format. Intent: informational/inspirational, written by wedding-industry businesses using the topic as top-of-funnel content, not by apps.
**Capsule's page:** 385-word product pitch, no "what to include" list, no physical-capsule ideas, no photos of real capsules.
**Mismatch: HIGH.** The page answers "why use Capsule" when the SERP answers "what do I put in my capsule and when do I open it." Kwillt proves a product can rank here — but only by publishing genuine guide content around the product, which Capsule's page doesn't do.

### "time capsule app for couples"
**SERP:** direct competitor apps — LuvDiary (App Store), TimeLock (product site + a TimeLock blog post ranking a second time), Flamme (dedicated "for long-distance couples" landing page), Lovepons, a Google Play "Time Capsule" app, Usie (App Store).
**Dominant page type:** App landing pages / App Store listings. Intent: transactional/app-discovery — users are already looking for an app, not ideas.
**Capsule's page:** Also an app landing page — **this is the one keyword where Capsule's format is structurally correct.** On-page copy already mirrors what wins (long-distance framing, "both partners add privately," 3-step mechanic) — closer to Flamme's segmented LDR page than to a blog post.
**Mismatch: ALIGNED (format), MEDIUM (depth/trust).** The gap isn't page type, it's that competitors are live, reviewed apps with App Store ratings and Flamme/TimeLock have supporting blog content; Capsule is pre-launch with a waitlist CTA and no proof it works.

### "graduation time capsule ideas"
**SERP:** two Pinterest results (top 8), Celestis blog (memorial/spaceflight company content marketing), Marshall Parthenon (student newspaper), StageClip blog, TeachersPayTeachers (worksheet marketplace), inallyoudo.net personal blog.
**Dominant page type:** Pinterest boards + idea-listicle blog posts. Zero product/app/tool results in the entire result set.
**Capsule's page:** 382-word single pitch with no numbered ideas list, no images.
**Mismatch: CRITICAL.** The "ideas" modifier signals a visual/gallery/listicle intent Google already satisfies with Pinterest — no page format Capsule could plausibly build (app or otherwise) beats a Pinterest board for a pure ideas query, and there is no app-seeking intent present anywhere in this SERP to intercept.

### "how to make a digital time capsule"
**SERP:** Dropbox (major-brand content marketing), two funeral-home/senior-living sites (Tharp Funeral Home, Bethesda Gardens — legacy-planning angle), ForKeeps (direct competitor product), Klokbox (direct competitor product/tool).
**Dominant page type:** Step-by-step how-to guide format. Intent: informational how-to, but **two of five results are competitor products ranking via how-to content** — proof an app company can rank here with the right format.
**Capsule's page:** Already the closest structural match of the six — a genuine "5 decisions, one sealed album" numbered step sequence exists (`field-steps` divs, not semantic `<ol>`/schema). Still only 498 words, no HowTo schema, no images per step, no comparison to DIY (folder + calendar reminder) is elaborated beyond one line.
**Mismatch: MEDIUM.** Format is directionally right; execution is thin next to Dropbox/ForKeeps/Klokbox's likely 800–1500-word guides with images and (for Dropbox) domain authority.

### "baby's first year time capsule"
**SERP:** parenting-blog listicles almost exclusively — FirstCry (major parenting media site), Classpop (class marketplace blog), mommyonpurpose ("32 ideas"), tulamama, mamasbuzz, strawberryandhearts — plus one TimeLock blog post (competitor content, not their product page).
**Dominant page type:** Numbered parenting-blog listicle ("32 Time Capsule Ideas for Baby's First Year," "13 ... Ideas"). Intent: informational/inspirational, container + physical-keepsake focused (lock of hair, footprint, newspaper clipping) — mostly non-digital.
**Capsule's page:** 392-word pitch, zero idea list, zero physical/digital hybrid framing.
**Mismatch: CRITICAL.** Same shape as graduation ideas — the query wants a long enumerable list of concrete keepsake ideas (most of them physical objects a photo app is irrelevant to), not a product pitch. Even the one competitor that ranks here (TimeLock) does it with a listicle-style blog post, not their app page.

### "family reunion time capsule"
**SERP:** Family Tree Magazine (major genealogy media brand), Snapfish (major photo-printing brand — high DA), lovelyluckylife (blog), familyreunionhelper (niche but established), legacyproject.org (nonprofit), millerfhc.com (funeral home content marketing), an Etsy printable-kit listing, a Pinterest board.
**Dominant page type:** High-authority media/brand content + a commercial physical-product listing (Etsy) + Pinterest. Zero app/software results.
**Capsule's page:** 388-word pitch with no reunion-specific mechanics beyond "cousins who flew in vs. couldn't make it."
**Mismatch: CRITICAL.** Highest-authority incumbents of all six SERPs (Snapfish, Family Tree Magazine) plus zero evidence Google or users want a software solution for this query at all.

## 3. Winnability Ranking (zero-authority site, realistic)

| Rank | Keyword | Winnability | Why |
|---|---|---|---|
| 1 | **time capsule app for couples** | Best shot | Only SERP where page TYPE already matches (app landing pages). Competitors (Flamme, TimeLock, Lovepons) are established but not massive-DA brands. Gap is trust/proof + depth, not format — a fixable, non-authority-dependent gap. |
| 2 | **how to make a digital time capsule** | Moderate | Informational how-to format is buildable without backlinks; two competitor *products* (ForKeeps, Klokbox) already rank here via content, proving the path exists. Dropbox is the one high-authority outlier to accept losing to. |
| 3 | **wedding photo time capsule** | Moderate-low | Competitors are small-to-mid wedding-industry blogs/vendors, not massive brands — theoretically reachable with a real guide, but requires becoming a *content* page (what to include/when to open), which is a bigger lift than couples/how-to. |
| 4 | **baby's first year time capsule** | Low | Dominated by established parenting-media listicles (FirstCry) with deep, physical-object-heavy idea lists; near-zero app-seeking intent observed. |
| 5 | **family reunion time capsule** | Essentially unwinnable | Highest-authority incumbents observed across all six SERPs (Snapfish, Family Tree Magazine) plus a paid Etsy listing and Pinterest; zero software intent in the SERP. |
| 6 | **graduation time capsule ideas** | Essentially unwinnable | "Ideas" queries are Pinterest/listicle territory by observed SERP composition (2 Pinterest results in top 8); no product-type result appeared at all. |

**Recommendation:** Don't spend more effort trying to rank #4–#6 as currently scoped. Better long-tail targets, chosen for closer intent match and lower incumbent authority than what was actually observed above:
- "digital time capsule app" / "shared photo album that unlocks on a date" (rewrites #6/#5 toward the app-seeking intent that actually exists, dropping the "ideas"/"reunion" framing that pulls in Pinterest/media brands)
- "long distance couple photo app" / "anniversary time capsule app" (narrower cuts of #2's winnable territory)
- "wedding guest photo album app" (a transactional rewrite of #1 that sidesteps the vendor-blog SERP entirely)
- Branded/comparison terms once competitors are named in copy: "TimeLock alternative," "Flamme alternative" — low volume but zero-authority-friendly, and directly commercial
- Defer #4/#5-style "ideas" and "reunion" content entirely until there's a live App Store listing — pre-launch, a waitlist CTA cannot compete with Pinterest/Snapfish/Family Tree Magazine for top-of-funnel inspiration traffic anyway.

## 4. User Stories (winnable keywords only) vs. current page

### "time capsule app for couples"
- **US1** (from Flamme's dedicated LDR landing page + TimeLock's "first year together to golden anniversary" framing): *"As a long-distance partner, I want to see this is built specifically for distance/military situations, not a generic photo app, before I trust it with private photos."* — **Page score: PARTIAL.** Copy does address LDR directly ("Not every couple lives in the same city," proximity unlock) — the one page of the six that's genuinely on-target for its SERP. Missing: no mention of military families beyond one clause, no visual proof.
- **US2** (from TimeLock/Flamme/Lovepons all detailing lock mechanics, group vs. pair, goal-tracking): *"As someone comparing apps, I want specifics — is this just 2 people or can I add others, is it free, how exactly does the unlock trigger work — before installing anything."* — **Page score: WEAK.** 3-step summary exists but no pricing, no explicit "just the two of you or more" clarification, no comparison table.
- **US3** (every competitor is a live, installable, reviewed app): *"As a user, I want proof this app is real and safe before I hand over my photos."* — **Page score: FAIL.** No App Store badge/link, no reviews, no screenshots beyond nav logo, waitlist-only CTA. This is the single biggest gap on the most winnable keyword.

### "how to make a digital time capsule"
- **US1** (Dropbox/ForKeeps/funeral-home guides all structured as literal step lists): *"As someone who's never done this, I want a clear numbered process I can follow right now, with or without an app."* — **Page score: GOOD structurally, THIN in execution.** The 5-step `field-steps` sequence is the right shape but each step is 1–2 sentences with no example, no image, no semantic list/schema markup for a HowTo rich result.
- **US2** (funeral-home entries show a "legacy/for future generations" angle Capsule's page doesn't touch): *"As someone preserving memories for someone who may not be around later, I want reassurance the format will still be accessible in 10–20 years."* — **Page score: FAIL.** No mention of longevity/data preservation at all.
- **US3** (ForKeeps/Klokbox rank as products inside how-to content, not as pitches): *"As a reader who found this via a Google how-to search, I want the tool recommendation to feel earned by the guide, not to feel like an ad interrupting the guide."* — **Page score: WEAK.** Structure is guide-then-pitch ("Or skip the DIY route entirely") which is directionally right, but the guide half is too short to have "earned" the pitch.

### "wedding photo time capsule"
- **US1** (every vendor blog answers "what goes in it"): *"As a bride, I want to know exactly what to put in a wedding time capsule and when other couples open theirs, before I decide how to run mine."* — **Page score: FAIL.** Zero "what to include" content; jumps straight to app pitch.
- **US2** (kwillt.com ranks as a product used *inside* a how-to post): *"As someone planning, I want the tool to slot into a process I already understand (letters, mementos, photos), not replace my whole plan."* — **Page score: WEAK.** Page frames Capsule as the entire solution rather than one piece of a broader wedding-capsule tradition.

## 5. Persona Scoring — "does the page answer the actual question before asking for an email?"

All 6 pages share one CTA: **"Join the waitlist"** — no App Store link, no free preview, no email-gate-free content. Scored against the page that best represents each persona's most-relevant keyword.

| Persona | Relevant keyword | Answers their real question before the ask? | Verdict |
|---|---|---|---|
| **Bride planning a wedding** | wedding photo time capsule | No — page never says what to include, when other couples open theirs, or how this fits alongside physical mementos (ribbon, invite, notes) every vendor blog covers. Goes straight from "why weddings" to "join waitlist." | **FAIL** |
| **New parent** | baby's first year time capsule | No — no keepsake ideas (footprint, lock of hair, milestone cards), no container/preservation guidance, nothing matching the observed FirstCry/mommyonpurpose listicle content. | **FAIL** |
| **College senior** | graduation time capsule ideas | No — no ideas list at all (concert tickets, tassels, letters to future self — all observed in the SERP snippet), and the query is inherently visual/list-driven, which this page format can't satisfy regardless of copy quality. | **FAIL** |
| **Long-distance partner** | time capsule app for couples | Partially — this is the one persona whose core question ("is this built for my situation?") is actually answered on-page (LDR + proximity-unlock framing). Still fails the trust question: no App Store link, no reviews, no proof the app exists beyond a waitlist form. | **PARTIAL** |

**Pattern:** every persona hits a waitlist CTA before their informational question is answered, and 3 of 4 never get their question answered at all. The waitlist gate is premature relative to the SERP's informational intent on 5 of 6 keywords — competitors give the answer for free and monetize via their own installed app/product, not via an email capture.

## 6. Recommended Page Archetype Per Keyword (structural, not "more words")

| Keyword | Current archetype | Correct archetype (per observed SERP) |
|---|---|---|
| time capsule app for couples | Thin app-pitch landing page | **Segmented app landing page** (keep this shape) + add: App Store/TestFlight badge or "Join the beta" reframed as concrete access, screenshots of the actual unlock/reveal UI, a short FAQ (pricing, group size, data retention) — mirror Flamme's LDR-specific landing page depth, not a blog. |
| how to make a digital time capsule | App-pitch page with a step list bolted on | **HowTo guide page**: semantic `<ol>` + `HowTo` schema, each of the 5 steps expanded to a real paragraph with an example, a screenshot per step, an explicit "why this beats a shared folder + calendar reminder" comparison section, then the product pitch as the guide's natural conclusion (not an interruption). |
| wedding photo time capsule | App-pitch page | **Vendor-style planning guide**: "What to put in a wedding time capsule" (letters, decor scrap, guest notes, digital copies — content already exists in the SERP snippets, just needs to be written), "When to open it" (1st/10th/25th anniversary options), *then* position Capsule as the modern digital-collection layer on top of that tradition — same pattern kwillt.com uses. |
| baby's first year time capsule | App-pitch page | **Idea listicle** ("25 things to include in your baby's first-year time capsule") mixing physical (footprint, hospital bracelet, milestone cards) and digital (photos from every relative) items, with Capsule positioned as the way to collect the digital/photo half from a distributed family — not a full replacement pitch. Lower priority given authority ceiling. |
| family reunion time capsule | App-pitch page | Not recommended to build out further — even a perfect listicle/guide is unlikely to outrank Snapfish/Family Tree Magazine/Etsy. If kept for internal linking only, no additional investment. |
| graduation time capsule ideas | App-pitch page | Not recommended to build out further — "ideas" intent is Pinterest/gallery territory a text page structurally cannot win regardless of authority. Consider retiring or merging into a broader "time capsule ideas" resource used only for internal linking, not as a standalone SEO target. |

## Limitations
- WebSearch results reflect Google's algorithm/personalization at query time (2026-07-24); not verified via a dedicated SERP-tracking tool, so exact ranking positions and any SERP features (featured snippets, PAA, AI Overview presence) beyond the organic link list are not confirmed — only the organic result set and its page types were assessed.
- Competitor page depth (word count, schema, images) was inferred from search-result snippets and general knowledge of the listed domains, not fetched/rendered directly (fetching was out of scope per instructions — file reads and search only).
- Backlink/domain-authority claims (e.g., "Snapfish/Dropbox are high-DA") are qualitative judgments based on brand recognition, not pulled from an authority-metrics tool.
- No rendering/mobile-SERP check performed; analysis is desktop-organic-result based only.
