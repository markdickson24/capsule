# Performance & Core Web Vitals — getcapsuleapp.com

Measured with Lighthouse 12 (headless Chrome), 2026-07-24. Lab data only — **no CrUX field data available** (site has insufficient real-user traffic to generate a field dataset; PageSpeed Insights API returned a quota error, and this domain would almost certainly return "insufficient data" regardless given pre-launch traffic).

## Scores

| Page | Form factor | Perf | LCP | FCP | TBT | CLS | SI |
|---|---|---|---|---|---|---|---|
| `/` (homepage) | **Mobile** | **91** | **3.5 s** ❌ | 0.9 s | 0 ms | 0 | 1.3 s |
| `/` (homepage) | Desktop | 100 | 0.6 s ✅ | 0.2 s | 0 ms | 0 | 0.4 s |
| `/wedding-photo-time-capsule.html` | Mobile | 100 | 0.8 s ✅ | 0.8 s | 0 ms | 0 | — |

Other categories (mobile homepage): Accessibility 96, Best Practices 100, SEO 100.

**Threshold reference:** LCP good ≤2.5s / poor >4.0s · INP good ≤200ms / poor >500ms · CLS good ≤0.1 / poor >0.25.

## What works

- **CLS is a perfect 0 on every page tested.** No layout shift at all, despite images having no `width`/`height` attributes — the CSS reserves space via aspect ratio on the phone frames. This is better than most sites.
- **TBT is 0 ms.** `site.js` is 795 bytes on the wire and does almost nothing at load. INP will be excellent; there is essentially no main-thread JS contention.
- **Brotli compression is on** for all text assets: homepage 5.5 KB on wire (from 22.5 KB), `styles.css` 4.4 KB (from 18 KB), `site.js` 676 B.
- **Netlify edge TTFB is 78 ms.** Hosting is not a bottleneck.
- **Only one render-blocking resource** — `styles.css` at 4.5 KB. Negligible; not worth inlining.
- **No web fonts.** Zero font-related FOIT/FOUT/CLS risk. System font stack.
- Desktop is a clean 100.

## Findings

### [HIGH] Mobile homepage LCP is 3.5 s — 1.0 s over the "good" threshold

**Evidence.** LCP breakdown from the trace:

| Phase | Time | Share |
|---|---|---|
| TTFB | 628 ms | 18% |
| Load Delay | 0 ms | 0% |
| Load Time | 0 ms | 0% |
| **Render Delay** | **2850 ms** | **82%** |

The LCP element is `nav#nav > div.nav-inner > div.nav-links > a.btn` ("Join the waitlist", 145×42px) — a *text* element requiring no download. Its Load Delay and Load Time are both zero. Meanwhile the network waterfall shows **every request complete by 466 ms**:

```
Document     5,820 B    1ms → 117ms
Stylesheet   4,567 B  130ms → 155ms
Image       80,005 B  131ms → 254ms   logo.png
Image      221,089 B  131ms → 277ms   screenshots/home.png
Image      205,348 B  131ms → 256ms   screenshots/create.png
Script         795 B  131ms → 155ms
```

So ~3 seconds elapse between "all bytes arrived" and "largest element painted", with no JS executing (TBT 0 ms) and no web fonts. The cause is **main-thread image decode under Lighthouse's 4× mobile CPU throttle**: three PNGs totalling ~506 KB, two of them 924×1869, are all fetched eagerly at high priority and decoded before paint settles. Desktop — same page, same bytes, no CPU throttle — paints its LCP at 0.6 s, which isolates the variable to decode cost rather than delivery.

**How you'd know this diagnosis is wrong:** if you convert the screenshots to WebP + add `loading="lazy"` and mobile LCP does *not* drop below ~1.5 s, the cause is something else in the render path and the trace should be re-examined (check for a long style-recalc on the `.load-in` animation instead).

**Fix (in order of impact):**
1. Add `loading="lazy" decoding="async"` to both `screenshots/*.png` — they sit in the `#screens` section, well below the fold, so they should never compete with first paint.
2. Convert both screenshots to WebP at the size they're actually displayed. Lighthouse estimates **391 KiB saved** from format conversion and **340 KiB** from correct sizing.
3. Add explicit `width` and `height` attributes to all three `<img>` tags. CLS is currently 0 so this is insurance, not a fix — but it lets the browser skip a layout pass.
4. Add `<link rel="preload">` only if step 1–3 leave LCP above 2.5 s. Don't preload first; removing the contention should be sufficient.

### [HIGH] `logo.png` is a 512×512, 80 KB image displayed at 36×36

`.brand .mark { width: 36px; height: 36px; }` — the file is 512×512 PNG, 79,814 bytes. Lighthouse reports **78.6 KB of 79.8 KB wasted (98%)**. It loads on all 9 pages, on every page view, at high priority in the nav.

**Fix:** export a 72×72 WebP (2× for retina at 36px) — this should land around 2–4 KB, a ~95% reduction. Keep the 512×512 original for `og:image` purposes only (see the Images finding — it needs replacing there too). This one change removes ~76 KB from every single page load sitewide.

### [MEDIUM] All static assets are served with `cache-control: public,max-age=0,must-revalidate`

Verified against live headers for `styles.css`, `site.js`, `logo.png`, `favicon.png`, and both screenshots — every one returns `max-age=0, must-revalidate`. This is Netlify's default for non-fingerprinted filenames.

Consequence: every repeat visit issues a conditional request for all 8 assets and waits for 8 `304 Not Modified` round-trips before rendering. On a mobile network that is real, avoidable latency for returning visitors. ETags are present so bytes aren't re-sent — but the round-trips are.

**Fix:** add a `netlify.toml` (there is currently none in the repo) with hashed filenames or, more simply, long-lived caching on the immutable directories:

```toml
[[headers]]
  for = "/screenshots/*"
  [headers.values]
    Cache-Control = "public, max-age=31536000, immutable"

[[headers]]
  for = "/*.png"
  [headers.values]
    Cache-Control = "public, max-age=604800"
```

Leave HTML on `max-age=0, must-revalidate` — that part is correct for a site you redeploy often. For `styles.css`/`site.js`, either accept the revalidation or move to fingerprinted filenames before adding a long max-age (otherwise a deploy won't reach cached users).

### [LOW] Two favicon requests fire sequentially after first paint

`favicon.png` (280→327 ms) then `favicon.ico` (328→466 ms) — the `.ico` is requested *after* the `.png` completes, extending the tail of the load by ~140 ms. Both are declared:

```html
<link rel="icon" href="/favicon.ico" sizes="any" />
<link rel="icon" type="image/png" href="/favicon.png" />
```

Low impact (post-paint), but the `.ico` at 4.6 KB is only needed for legacy browsers. Harmless to leave; drop the `.ico` if you want the cleanest waterfall.

## Leading indicators to monitor

- Once the site has traffic, watch **CrUX mobile LCP p75** in Search Console's Core Web Vitals report — that is the number that actually counts for ranking, not the lab score above.
- Re-run `npx lighthouse@12 https://getcapsuleapp.com/ --form-factor=mobile --screenEmulation.mobile` after the image work and confirm mobile LCP < 2.5 s.
- Total page weight on the homepage should drop from ~520 KB to under 100 KB. If it doesn't, the image conversion didn't take effect on the deployed build.
