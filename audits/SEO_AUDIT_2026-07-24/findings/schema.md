# Schema.org Audit — getcapsuleapp.com
Audited: 9 static HTML files in `/Users/markdickson/Desktop/capsule/landing/`
Method: direct file read + grep (no Python/render tooling available or needed — site is static HTML, no SPA).

## Detection Results

**Zero structured data on every page.** Confirmed via `grep -c 'application/ld+json' *.html` → 0 for all 9 files, and no Microdata (`itemscope`/`itemtype`) or RDFa (`vocab`/`typeof`) attributes anywhere in the markup. This is a fully clean slate — no conflicting/broken schema to fix, only gaps to fill.

## Ground-Truth Facts Pulled From The Site (used to keep every JSON-LD block honest)

These constrain what I generated below — I did **not** use the pricing/App-Store facts supplied in the task brief where the site itself doesn't state them, per the "only mark up what's visible" rule.

| Fact | Status on site | Source |
|---|---|---|
| App Store / TestFlight public link | **Does not exist.** Confirmed via `grep -in "apps.apple.com\|itunes.apple\|testflight.apple\|play.google"` across all HTML/JS — zero matches. | — |
| Pricing / "Capsule Pro" / free tier | **Never mentioned anywhere on the site.** `grep -il "pro\|pricing\|\$4.99..."` false-positives only on substrings inside unrelated words ("process", "provider", "protect"); no page has a pricing section, a "Free" label, or any dollar amount. | — |
| Platform availability | iOS only, TestFlight-only, explicitly "not on the App Store or Google Play yet," Android "coming later." | index.html CTA band, `#get` section |
| Named person / founder | **No name appears anywhere.** support.html says "built and run by one person" but never names Mark Dickson. Only contact surfaced is an email. | support.html |
| Company/legal entity name | None. legal.html's governing-law clause says only "the operator" — no registered entity name given. | legal.html |
| Social profiles | Instagram/TikTok/X footer links are all `href="#"` **placeholders**, not real URLs, on every page. | footer, all pages |
| Contact email | `mark.dickson0824@gmail.com` | support.html, legal.html (×3) |
| Legal effective/updated date | June 10, 2026 (stated 4× in legal.html) | legal.html |
| FAQ / user Q&A content | None exists on the site at all — no FAQ accordion, no Q&A page. | — |
| H1 tags | index.html, support.html, legal.html each have one `<h1>`. **The 6 SEO landing pages have zero `<h1>` — their visible titles are `<h2 class="sec-title">`.** Not a schema issue, but flagged since it affects what text should be treated as the page's real "headline" (I used it anyway — it's the only page title present). | all 6 `*-time-capsule*.html` / `how-to-*.html` |

**Consequence:** because pricing and the App Store link aren't on the page yet, I did **not** add an `offers` array with the $4.99/$39.99/$79.99 figures, no `downloadUrl`, and no `Person` schema with a founder name — adding any of those now would be Google-guideline-violating markup (structured data must reflect visible page content) and, for the person's name specifically, would fabricate a fact the page doesn't state. I've included a clearly-labeled **"post-launch" appendix block** showing exactly what to add once that content is actually published on the page.

## Per-Page Recommendation Table

| Page | Recommended types | Priority |
|---|---|---|
| `index.html` | `Organization` + `WebSite` (sitewide identity) | **Critical** |
| `index.html` | `WebPage` | High |
| `index.html` | `SoftwareApplication` (minimal, no offers/rating — see notes) | **Info / Hold** — deploy the full version only post-launch |
| `wedding-photo-time-capsule.html` | `WebPage` + `BreadcrumbList` | High |
| `time-capsule-app-for-couples.html` | `WebPage` + `BreadcrumbList` | High |
| `graduation-time-capsule-ideas.html` | `WebPage` + `BreadcrumbList` | High |
| `how-to-make-a-digital-time-capsule.html` | `WebPage` + `BreadcrumbList` (**never** `HowTo` — deprecated Sept 2023, and Google removed the rich result) | High |
| `babys-first-year-time-capsule.html` | `WebPage` + `BreadcrumbList` | High |
| `family-reunion-time-capsule.html` | `WebPage` + `BreadcrumbList` | High |
| `support.html` | `ContactPage` + `BreadcrumbList` | Medium |
| `legal.html` | `WebPage` (dateModified grounded) + `BreadcrumbList` | Medium |
| Any page | `FAQPage` | **N/A — do not add.** No FAQ content exists on the site, and Google retired FAQ rich results for all sites (May 7, 2026) regardless. If a real FAQ section gets built later, it has no Google SERP benefit; only consider it if you accept the AI/GEO benefit is unconfirmed. |
| Any page | `HowTo` | **Never** — deprecated, rich results removed Sept 2023. The 5-step guide on `how-to-make-a-digital-time-capsule.html` and the 3-step "How it works" sequences stay plain HTML. |

I did not include `Article`/`BlogPosting` for the 6 landing pages — they have no visible byline or publish date (only legal.html has a real date), and Article schema without those is weak/fabricated. `WebPage` is the honest fit.

---

## Generated JSON-LD

### 1. `index.html` — Organization + WebSite (sitewide identity)
Insert as a new `<script type="application/ld+json">` just before `</head>` (after the `<link rel="stylesheet" href="styles.css" />` line, line 18).

```html
<script type="application/ld+json">
{
  "@context": "https://schema.org",
  "@graph": [
    {
      "@type": "Organization",
      "@id": "https://getcapsuleapp.com/#organization",
      "name": "Capsule",
      "url": "https://getcapsuleapp.com/",
      "logo": "https://getcapsuleapp.com/logo.png",
      "description": "Capsule is a shared photo album that stays locked until everyone can open it together. Add photos as you go — nobody sees a thing until the date arrives.",
      "contactPoint": {
        "@type": "ContactPoint",
        "email": "mark.dickson0824@gmail.com",
        "contactType": "customer support"
      }
    },
    {
      "@type": "WebSite",
      "@id": "https://getcapsuleapp.com/#website",
      "url": "https://getcapsuleapp.com/",
      "name": "Capsule",
      "description": "Capsule is a shared photo album that stays locked until everyone can open it together. Add photos as you go — nobody sees a thing until the date arrives.",
      "publisher": { "@id": "https://getcapsuleapp.com/#organization" },
      "inLanguage": "en-US"
    },
    {
      "@type": "WebPage",
      "@id": "https://getcapsuleapp.com/#webpage",
      "url": "https://getcapsuleapp.com/",
      "name": "Capsule — Lock your memories. Unlock the moment.",
      "description": "Capsule is a shared photo album that stays locked until everyone can open it together. Add photos as you go — nobody sees a thing until the date arrives.",
      "isPartOf": { "@id": "https://getcapsuleapp.com/#website" },
      "about": { "@id": "https://getcapsuleapp.com/#organization" },
      "inLanguage": "en-US"
    }
  ]
}
</script>
```

Notes:
- No `sameAs` — the Instagram/TikTok/X footer links are all `href="#"` placeholders; adding fake profile URLs would be worse than omitting them. Add `sameAs` the moment those links go live.
- No `founder`/`Person` — no name is published anywhere on the site.
- No `logo` `ImageObject` with fixed dimensions — `logo.png` exists at the given path so the plain URL form is safe; if you want the richer `ImageObject` form later, confirm actual pixel dimensions first rather than guessing.

### 2. `index.html` — SoftwareApplication (minimal, pre-launch-safe version)
Add to the same `@graph` array above, or as its own script block. **Recommended to hold until closer to launch** — see priority note.

```html
<script type="application/ld+json">
{
  "@context": "https://schema.org",
  "@type": "SoftwareApplication",
  "name": "Capsule",
  "url": "https://getcapsuleapp.com/",
  "description": "Capsule is a shared photo album that stays locked until everyone can open it together. Add photos as you go — nobody sees a thing until the date arrives.",
  "applicationCategory": "PhotoAndVideoApplication",
  "operatingSystem": "iOS",
  "image": "https://getcapsuleapp.com/logo.png"
}
</script>
```

Deliberately omitted, and why:
- **`offers`** — no pricing of any kind (free tier, Pro tier, or otherwise) appears anywhere on the site today. Adding the $4.99/mo · $39.99/yr · $79.99 lifetime figures now would be markup with no visible on-page counterpart — against Google's structured-data policy, and misleading since the app isn't purchasable yet.
- **`downloadUrl`** — no App Store link exists on the site (confirmed via grep); the copy explicitly says "Capsule isn't on the App Store or Google Play yet."
- **`aggregateRating`** — must not be added under any circumstances until real App Store/TestFlight reviews exist. This is a hard rule regardless of launch status.

**Post-launch appendix (do NOT deploy yet):** once the app ships and pricing/App Store link are genuinely published as visible copy on the page (e.g., a real pricing section), extend the block to:

```jsonc
{
  "@context": "https://schema.org",
  "@type": "SoftwareApplication",
  "name": "Capsule",
  "url": "https://getcapsuleapp.com/",
  "description": "…",
  "applicationCategory": "PhotoAndVideoApplication",
  "operatingSystem": "iOS",
  "image": "https://getcapsuleapp.com/logo.png",
  "downloadUrl": "https://apps.apple.com/app/idXXXXXXXXX", // real App Store URL once live
  "offers": [
    { "@type": "Offer", "name": "Free", "price": "0", "priceCurrency": "USD" },
    { "@type": "Offer", "name": "Capsule Pro Monthly", "price": "4.99", "priceCurrency": "USD", "category": "subscription" },
    { "@type": "Offer", "name": "Capsule Pro Yearly", "price": "39.99", "priceCurrency": "USD", "category": "subscription" },
    { "@type": "Offer", "name": "Capsule Pro Lifetime", "price": "79.99", "priceCurrency": "USD" }
  ]
  // aggregateRating: add only once real reviews exist — never before.
}
```
This appendix is a template, not a recommendation to ship today — every field in it needs a matching visible sentence on the page first (a pricing section, an App Store badge/link).

---

### 3–8. The six SEO landing pages — WebPage + BreadcrumbList

Same pattern for all six; insert before `</head>` on each file, right after the `<link rel="stylesheet" href="styles.css" />` line (line 18 on every one of these files).

**`wedding-photo-time-capsule.html`**
```html
<script type="application/ld+json">
{
  "@context": "https://schema.org",
  "@graph": [
    {
      "@type": "WebPage",
      "@id": "https://getcapsuleapp.com/wedding-photo-time-capsule.html#webpage",
      "url": "https://getcapsuleapp.com/wedding-photo-time-capsule.html",
      "name": "Wedding Photo Time Capsule — Capsule",
      "description": "Turn wedding guest photos into a time capsule that stays locked until your one-year anniversary (or the morning after). Everyone contributes, no one peeks, and it opens for the whole group at once.",
      "isPartOf": { "@id": "https://getcapsuleapp.com/#website" },
      "about": { "@id": "https://getcapsuleapp.com/#organization" },
      "primaryImageOfPage": "https://getcapsuleapp.com/logo.png",
      "inLanguage": "en-US"
    },
    {
      "@type": "BreadcrumbList",
      "itemListElement": [
        { "@type": "ListItem", "position": 1, "name": "Home", "item": "https://getcapsuleapp.com/" },
        { "@type": "ListItem", "position": 2, "name": "Wedding Photo Time Capsule", "item": "https://getcapsuleapp.com/wedding-photo-time-capsule.html" }
      ]
    }
  ]
}
</script>
```

**`time-capsule-app-for-couples.html`**
```html
<script type="application/ld+json">
{
  "@context": "https://schema.org",
  "@graph": [
    {
      "@type": "WebPage",
      "@id": "https://getcapsuleapp.com/time-capsule-app-for-couples.html#webpage",
      "url": "https://getcapsuleapp.com/time-capsule-app-for-couples.html",
      "name": "Time Capsule App for Couples — Capsule",
      "description": "A time capsule app built for couples — including long-distance ones. Drop in photos as you go, then unlock together on an anniversary, a reunion, or the day you're finally in the same place.",
      "isPartOf": { "@id": "https://getcapsuleapp.com/#website" },
      "about": { "@id": "https://getcapsuleapp.com/#organization" },
      "primaryImageOfPage": "https://getcapsuleapp.com/logo.png",
      "inLanguage": "en-US"
    },
    {
      "@type": "BreadcrumbList",
      "itemListElement": [
        { "@type": "ListItem", "position": 1, "name": "Home", "item": "https://getcapsuleapp.com/" },
        { "@type": "ListItem", "position": 2, "name": "Time Capsule App for Couples", "item": "https://getcapsuleapp.com/time-capsule-app-for-couples.html" }
      ]
    }
  ]
}
</script>
```

**`graduation-time-capsule-ideas.html`**
```html
<script type="application/ld+json">
{
  "@context": "https://schema.org",
  "@graph": [
    {
      "@type": "WebPage",
      "@id": "https://getcapsuleapp.com/graduation-time-capsule-ideas.html#webpage",
      "url": "https://getcapsuleapp.com/graduation-time-capsule-ideas.html",
      "name": "Graduation Time Capsule Ideas — Capsule",
      "description": "Graduation time capsule ideas for the whole friend group — senior year photos, dorm memories, and the summer before everyone scatters, sealed until you're all back together.",
      "isPartOf": { "@id": "https://getcapsuleapp.com/#website" },
      "about": { "@id": "https://getcapsuleapp.com/#organization" },
      "primaryImageOfPage": "https://getcapsuleapp.com/logo.png",
      "inLanguage": "en-US"
    },
    {
      "@type": "BreadcrumbList",
      "itemListElement": [
        { "@type": "ListItem", "position": 1, "name": "Home", "item": "https://getcapsuleapp.com/" },
        { "@type": "ListItem", "position": 2, "name": "Graduation Time Capsule Ideas", "item": "https://getcapsuleapp.com/graduation-time-capsule-ideas.html" }
      ]
    }
  ]
}
</script>
```

**`how-to-make-a-digital-time-capsule.html`** (WebPage, not HowTo — deliberately)
```html
<script type="application/ld+json">
{
  "@context": "https://schema.org",
  "@graph": [
    {
      "@type": "WebPage",
      "@id": "https://getcapsuleapp.com/how-to-make-a-digital-time-capsule.html#webpage",
      "url": "https://getcapsuleapp.com/how-to-make-a-digital-time-capsule.html",
      "name": "How to Make a Digital Time Capsule — Capsule",
      "description": "How to make a digital time capsule: pick an occasion, decide who's contributing, choose an unlock trigger, collect photos and videos, then seal it until the moment you choose.",
      "isPartOf": { "@id": "https://getcapsuleapp.com/#website" },
      "about": { "@id": "https://getcapsuleapp.com/#organization" },
      "primaryImageOfPage": "https://getcapsuleapp.com/logo.png",
      "inLanguage": "en-US"
    },
    {
      "@type": "BreadcrumbList",
      "itemListElement": [
        { "@type": "ListItem", "position": 1, "name": "Home", "item": "https://getcapsuleapp.com/" },
        { "@type": "ListItem", "position": 2, "name": "How to Make a Digital Time Capsule", "item": "https://getcapsuleapp.com/how-to-make-a-digital-time-capsule.html" }
      ]
    }
  ]
}
</script>
```
This page's "Five decisions, one sealed album" numbered list is genuinely HowTo-shaped content, but per the hard rule (`HowTo` rich results were removed Sept 2023) it must stay as `WebPage`, never `HowTo`.

**`babys-first-year-time-capsule.html`**
```html
<script type="application/ld+json">
{
  "@context": "https://schema.org",
  "@graph": [
    {
      "@type": "WebPage",
      "@id": "https://getcapsuleapp.com/babys-first-year-time-capsule.html#webpage",
      "url": "https://getcapsuleapp.com/babys-first-year-time-capsule.html",
      "name": "Baby's First Year Time Capsule — Capsule",
      "description": "A baby's first year time capsule for the whole family — grandparents, aunts, uncles, and friends all drop in photos, sealed until the first birthday.",
      "isPartOf": { "@id": "https://getcapsuleapp.com/#website" },
      "about": { "@id": "https://getcapsuleapp.com/#organization" },
      "primaryImageOfPage": "https://getcapsuleapp.com/logo.png",
      "inLanguage": "en-US"
    },
    {
      "@type": "BreadcrumbList",
      "itemListElement": [
        { "@type": "ListItem", "position": 1, "name": "Home", "item": "https://getcapsuleapp.com/" },
        { "@type": "ListItem", "position": 2, "name": "Baby's First Year Time Capsule", "item": "https://getcapsuleapp.com/babys-first-year-time-capsule.html" }
      ]
    }
  ]
}
</script>
```

**`family-reunion-time-capsule.html`**
```html
<script type="application/ld+json">
{
  "@context": "https://schema.org",
  "@graph": [
    {
      "@type": "WebPage",
      "@id": "https://getcapsuleapp.com/family-reunion-time-capsule.html#webpage",
      "url": "https://getcapsuleapp.com/family-reunion-time-capsule.html",
      "name": "Family Reunion Time Capsule — Capsule",
      "description": "A family reunion time capsule everyone can add to — from the cousins who flew in to the ones who couldn't make it. Sealed until you're ready to relive the whole weekend at once.",
      "isPartOf": { "@id": "https://getcapsuleapp.com/#website" },
      "about": { "@id": "https://getcapsuleapp.com/#organization" },
      "primaryImageOfPage": "https://getcapsuleapp.com/logo.png",
      "inLanguage": "en-US"
    },
    {
      "@type": "BreadcrumbList",
      "itemListElement": [
        { "@type": "ListItem", "position": 1, "name": "Home", "item": "https://getcapsuleapp.com/" },
        { "@type": "ListItem", "position": 2, "name": "Family Reunion Time Capsule", "item": "https://getcapsuleapp.com/family-reunion-time-capsule.html" }
      ]
    }
  ]
}
</script>
```

---

### 9. `support.html` — ContactPage + BreadcrumbList
Insert before `</head>`, after line 12 (`<link rel="stylesheet" .../>`).

```html
<script type="application/ld+json">
{
  "@context": "https://schema.org",
  "@graph": [
    {
      "@type": "ContactPage",
      "@id": "https://getcapsuleapp.com/support.html#webpage",
      "url": "https://getcapsuleapp.com/support.html",
      "name": "Support — Capsule",
      "description": "Get help with Capsule — bugs, feedback, account questions, and anything else. Email goes straight to the person who built it.",
      "isPartOf": { "@id": "https://getcapsuleapp.com/#website" },
      "about": { "@id": "https://getcapsuleapp.com/#organization" },
      "inLanguage": "en-US"
    },
    {
      "@type": "BreadcrumbList",
      "itemListElement": [
        { "@type": "ListItem", "position": 1, "name": "Home", "item": "https://getcapsuleapp.com/" },
        { "@type": "ListItem", "position": 2, "name": "Support", "item": "https://getcapsuleapp.com/support.html" }
      ]
    }
  ]
}
</script>
```

### 10. `legal.html` — WebPage (dateModified grounded) + BreadcrumbList
Insert before `</head>`, after line 12.

```html
<script type="application/ld+json">
{
  "@context": "https://schema.org",
  "@graph": [
    {
      "@type": "WebPage",
      "@id": "https://getcapsuleapp.com/legal.html#webpage",
      "url": "https://getcapsuleapp.com/legal.html",
      "name": "Privacy & Legal — Capsule",
      "description": "Capsule's privacy policy, terms of service, and community guidelines.",
      "dateModified": "2026-06-10",
      "isPartOf": { "@id": "https://getcapsuleapp.com/#website" },
      "about": { "@id": "https://getcapsuleapp.com/#organization" },
      "inLanguage": "en-US"
    },
    {
      "@type": "BreadcrumbList",
      "itemListElement": [
        { "@type": "ListItem", "position": 1, "name": "Home", "item": "https://getcapsuleapp.com/" },
        { "@type": "ListItem", "position": 2, "name": "Privacy & Legal", "item": "https://getcapsuleapp.com/legal.html" }
      ]
    }
  ]
}
</script>
```
`dateModified` uses ISO 8601 (`2026-06-10`), grounded in the visible "Last updated — June 10, 2026" / "Effective June 10, 2026" text repeated four times on the page.

---

## Validation Checklist (applied to every block above)

| Check | Result |
|---|---|
| `@context` is `https://schema.org` (not http) | ✅ all blocks |
| `@type` valid, not deprecated | ✅ — no `HowTo`, no `SpecialAnnouncement`, no `FAQPage` used anywhere |
| Required properties present | ✅ for `WebPage`/`BreadcrumbList`/`Organization`/`WebSite`; `SoftwareApplication`'s normally-expected `offers` is deliberately omitted with a documented reason, not an oversight |
| No placeholder text | ✅ — no `[Business Name]`-style stand-ins; where a fact isn't grounded (founder name, pricing, download URL, social profiles) it's omitted rather than faked |
| URLs absolute | ✅ all `https://getcapsuleapp.com/...` |
| Dates ISO 8601 | ✅ (`2026-06-10` on legal.html; no other page has a groundable date) |

## Site-wide implementation notes
- All 9 pages currently repeat the same hand-written `<head>`/nav/footer markup (no shared template/include), so each block above needs to be pasted into its own file individually — there's no single insertion point that covers the site.
- Every block's `isPartOf`/`about` references (`#website`, `#organization`) only resolve once the Organization+WebSite graph from `index.html` is live — deploy that one first, or the `@id` references on the other 8 pages point at an entity that doesn't exist yet (harmless for validators, but do it in this order for cleanliness).
- Not part of this schema task, but noticed during content extraction: the 6 SEO landing pages (`wedding-`, `couples-`, `graduation-`, `how-to-`, `babys-first-year-`, `family-reunion-`) have **no `<h1>` element** — their titles are `<h2 class="sec-title">`. Worth a heading-level fix independent of structured data.

## Priority Order for Implementation
1. **Organization + WebSite on `index.html`** (Critical) — establishes the entity every other page's schema references.
2. **WebPage + BreadcrumbList on all 6 SEO landing pages** (High) — these are the pages actually meant to rank for long-tail "time capsule" queries; breadcrumbs are the one rich-result-eligible win available on a pre-launch site with no reviews/pricing/downloads yet.
3. **WebPage on `index.html`** (High).
4. **ContactPage + BreadcrumbList on `support.html`, WebPage + BreadcrumbList on `legal.html`** (Medium).
5. **SoftwareApplication on `index.html`, minimal version** (Info) — safe to ship now since every field is grounded, but low urgency since it carries no rich-result upside without offers/ratings.
6. **Hold: SoftwareApplication `offers` + `downloadUrl` + `aggregateRating`** — not implementable until (a) the App Store listing goes live and its URL is added, (b) real pricing copy appears somewhere visible on the page, and (c) genuine reviews exist, respectively.
