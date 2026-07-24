# Image SEO — getcapsuleapp.com

Total images on the site: **3 unique files** (`logo.png`, `screenshots/home.png`, `screenshots/create.png`) plus favicons. Small surface, so this category is easy to get to 100%.

## What works

- **Alt text is excellent — genuinely above average.** The screenshot alts are specific and descriptive rather than keyword-stuffed:
  > `alt="Home screen showing My Capsules with three capsules — Weekend Getaway and Cape Cod Summer unlocked, Outer Banks Trip starting in 11 days — plus a College Summer group"`

  > `alt="New Capsule screen: Mountain Weekend 2026, starting Nov 5 2026, unlocking Nov 8 2026, with vacation occasion, 48-hour voting, and surprise mode on"`

  These describe the actual UI state, which is exactly right for accessibility *and* gives image search real content to index. `logo.png` correctly uses `alt="Capsule logo"`.
- **No missing alt attributes anywhere.** 100% coverage.
- **CLS is 0** despite no dimension attributes — the CSS reserves space via the phone-frame containers.
- Images are served over HTTP/2 with brotli-capable Netlify edge and correct `content-type`.

## Findings

### [HIGH] All images are PNG; no WebP/AVIF anywhere

| File | Dimensions | Size | Displayed at | Waste |
|---|---|---|---|---|
| `logo.png` | 512×512 | 79.8 KB | **36×36** | 78.6 KB (98%) |
| `screenshots/home.png` | 924×1869 | 220.9 KB | ~half width | 139.7 KB oversized |
| `screenshots/create.png` | 924×1869 | 205.1 KB | ~half width | 129.7 KB oversized |

Lighthouse: **391 KiB** recoverable from next-gen formats, **340 KiB** from correct sizing, **442 KiB** total from the image-delivery insight. Current image payload is ~506 KB — roughly 97% of the homepage's total weight.

**Fix.**
```bash
cd landing
# Logo: 72px covers 36px at 2x DPR
sips -Z 72 logo.png --out logo-72.png
cwebp -q 82 logo-72.png -o logo.webp          # expect ~2-4 KB

# Screenshots: 2x the largest rendered width
cwebp -q 80 -resize 740 0 screenshots/home.png -o screenshots/home.webp
cwebp -q 80 -resize 740 0 screenshots/create.png -o screenshots/create.webp
```
Then serve with a `<picture>` fallback, or just swap to `.webp` directly — WebP is supported by ~97% of browsers and every crawler that matters.

This is the single biggest performance lever on the site and directly fixes the mobile LCP finding (see `performance.md`).

### [HIGH] No `loading="lazy"`, no `decoding="async"`, no `width`/`height` on any `<img>`

Every image tag on the site, in full:
```html
<img class="mark" src="logo.png" alt="Capsule logo" />
<img src="screenshots/home.png" alt="Home screen showing..." />
<img src="screenshots/create.png" alt="New Capsule screen..." />
```

Both screenshots live in the `#screens` section, **below the fold**, yet both are fetched eagerly at high priority starting at 131 ms — competing with first paint. The network trace shows them arriving in the first wave alongside the stylesheet.

**Fix:**
```html
<img src="screenshots/home.webp" width="924" height="1869"
     loading="lazy" decoding="async"
     alt="Home screen showing My Capsules with three capsules — ..." />
```
Keep the nav logo **eager** (it's above the fold) but add `width`/`height` and `decoding="async"`.

### [MEDIUM] `og:image` uses the square logo against a `summary_large_image` card

Cross-referenced in `onpage.md`. Restating here because the fix is an image deliverable: produce a **1200×630** OG image. A square 512×512 logo in a 1.91:1 card renders as a small centred mark with large empty bars — a weak preview for the primary sharing surface of a pre-launch app.

Ideally produce 7 variants (1 homepage + 6 occasion pages) using the existing app screenshots as source material. This is a design task, not a code task, and it's arguably higher ROI for a waitlist-stage product than most of the technical fixes on this list.

### [MEDIUM] No image sitemap entries and no descriptive filenames for the screenshots

`home.png` and `create.png` are generic. For image search — which matters for queries like "time capsule app screenshot" — rename to something like `capsule-app-home-screen-locked-albums.webp` and `capsule-app-create-time-capsule-screen.webp`.

Optionally add `<image:image>` entries to `sitemap.xml`. Low priority at 3 images, but free.

### [LOW] Two favicon formats requested serially

`favicon.ico` (4.6 KB) is fetched *after* `favicon.png` (9.6 KB) completes, adding ~140 ms to the load tail. Post-paint, so negligible — noted for completeness. The `.ico` is only needed for quite old browsers.

### [INFO] No decorative images needing `alt=""`

All three images are informative and correctly described. Nothing to suppress from the accessibility tree.
