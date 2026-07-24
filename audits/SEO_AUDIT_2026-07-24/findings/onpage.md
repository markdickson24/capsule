# On-Page SEO — getcapsuleapp.com

## What works

- **Every page has a unique, well-written title and meta description.** No duplicates, no truncation problems, all descriptive rather than keyword-stuffed. Descriptions read like human sentences and would earn clicks.
- **Canonicals are present and self-referential on all 9 pages.**
- **Internal linking is genuinely strong** — the 6 SEO landing pages form a complete mesh (each links to all 5 siblings plus the homepage), and the homepage links down to all 6. Every page is 1 click from the homepage. This is better internal linking than most sites this size have.
- `lang="en"` set on every page; correct `viewport` meta everywhere.
- Descriptive, keyword-relevant, human-readable URL slugs.
- Homepage heading hierarchy is clean: one `<h1>`, then a logical H2/H3 tree.

## Findings

### [CRITICAL] All 6 SEO landing pages have no `<h1>` at all

Verified across every file. The hero heading on each of the six money pages is marked up as `<h2>`:

```html
<header class="guide-header">
  <div class="wrap"><div class="wrap-in">
    <div class="sec-eyebrow">Weddings</div>
    <h2 class="sec-title">The wedding photo time capsule.</h2>
```

Heading outline per page (`wedding-photo-time-capsule.html`, and identically for the other five):
`h2 h2 h2 h3 h3 h3 h2 h2` — **zero H1s.**

For comparison, the pages that *aren't* trying to rank get it right: `index.html` → `h1 h2 h3...`, `legal.html` → `h1 ...`, `support.html` → `h1`.

These six pages are the entire organic-search strategy of the site. They are the only pages targeting non-brand queries, and each one is missing the single strongest on-page relevance signal. The H1 is also what many AI answer engines and social/preview scrapers use to identify a page's subject.

**Fix.** Change `<h2 class="sec-title">` to `<h1 class="sec-title">` inside `<header class="guide-header">` on all six pages. Check `styles.css` — `.sec-title` is styled by class, not by tag, so **this is a pure markup change with zero visual difference.** Then demote the following `<h2>`s only if the resulting outline skips a level.

While editing, tighten each H1 to lead with the target phrase. Current: *"The wedding photo time capsule."* → better: *"Wedding Photo Time Capsule"* as the H1 with the current sentence as the lead paragraph, or *"How to make a wedding photo time capsule"* if you take the SXO advice to reformat toward the informational intent.

**Falsifiability:** if these pages are already ranking well for their targets without an H1, this matters less than stated — check Search Console impressions per page before and 4 weeks after. Given zero current authority, expect impressions from near-zero, so the leading indicator is *any* impression growth on those URLs.

### [CRITICAL] Every page is reachable at two URLs with no redirect between them

Both forms return HTTP 200 with identical content:
- `https://getcapsuleapp.com/wedding-photo-time-capsule` → 200
- `https://getcapsuleapp.com/wedding-photo-time-capsule.html` → 200

This is Netlify's "Pretty URLs" post-processing, which also **rewrites the internal links in the deployed HTML**. Confirmed by diffing live HTML against the repo source — the local file says `href="wedding-photo-time-capsule.html"` but the live page serves `href='/wedding-photo-time-capsule'`.

The result is a three-way inconsistency:

| Signal | Points to |
|---|---|
| `<link rel="canonical">` | `/wedding-photo-time-capsule.html` |
| `sitemap.xml` | `/wedding-photo-time-capsule.html` |
| **Every internal link on the live site** | `/wedding-photo-time-capsule` (extensionless) |
| `og:url` | `.html` |

So Google crawls the site, follows only extensionless links, and every page it discovers via internal linking declares a canonical pointing at a URL that appears nowhere in the site's own link graph. Both versions are independently crawlable and indexable. This splits crawl budget and any link equity across duplicate pairs, and creates exactly the ambiguity canonicals exist to prevent.

It is not catastrophic — the canonical tag will most likely be respected and consolidate the pair — but it is unforced and trivially fixable.

**Fix — pick the extensionless form** (it's what the site actually links to, and it's the cleaner URL). Three coordinated edits:
1. Change all `<link rel="canonical">` and `og:url` values to drop `.html`.
2. Update `sitemap.xml` to list extensionless URLs.
3. Add a `netlify.toml` with 301s so the `.html` form redirects rather than 200s:

```toml
[[redirects]]
  from = "/:page.html"
  to = "/:page"
  status = 301
  force = true
```

Verify after deploy with `curl -sI https://getcapsuleapp.com/wedding-photo-time-capsule.html` — you want `301`, not `200`.

### [MEDIUM] `support.html` and `legal.html` have zero Open Graph and Twitter tags

`og:` count = 0, `twitter:` count = 0 on both. Every other page has 5 OG tags plus `twitter:card`. When someone shares a support or privacy link, it renders as a bare URL with no title, description, or image.

**Fix:** copy the OG/Twitter block from any landing page, swapping title/description/url. 5 minutes.

### [MEDIUM] `og:image` is a 512×512 square logo but the card type is `summary_large_image`

Every page declares:
```html
<meta property="og:image" content="https://getcapsuleapp.com/logo.png" />
<meta name="twitter:card" content="summary_large_image" />
```

`logo.png` is 512×512. `summary_large_image` expects a **1.91:1** ratio (1200×630). Twitter/X, LinkedIn, and Slack will letterbox or centre-crop the square logo into a wide frame, wasting most of the card and producing a weak preview — for a pre-launch consumer app, the social share card is a primary acquisition surface.

Additionally: **all 9 pages share the same OG image.** Six of them are occasion-specific pages where a tailored card would meaningfully improve share CTR.

**Fix:** create a 1200×630 OG image (app screenshot + tagline + logo). At minimum one sitewide; ideally one per occasion page. Add `og:image:width` / `og:image:height` so scrapers don't need to fetch to measure. Add `og:site_name` and `og:locale` while you're in there.

### [MEDIUM] `support.html` has a single `<h1>` and nothing else

Heading outline is just `h1`. At 2,990 bytes of raw HTML (mostly nav/footer), this page has almost no content. It's `priority: 0.3` in the sitemap and isn't a ranking target, so this is minor — but "Support" pages do pick up branded long-tail queries ("capsule app support", "capsule app not working") and a few H2-delimited answers would capture those cheaply.

### [LOW] `og:type` is `website` on the six content pages

They're closer to `article`. Very low impact — no Google ranking effect — but `article` with `article:published_time` would let you surface freshness, which the content currently has no signal for at all (no dates anywhere on the six pages).
