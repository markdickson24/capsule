# Brand assets

Background-removed versions of the Capsule mark, for design tools (Figma), press,
and anywhere the logo needs to sit on something other than black.

**These are not app assets.** The app icon is `assets/icon.png`, the adaptive icon
is `assets/adaptive-icon.png`, and the site uses `landing/logo.png` (72×72 nav
mark) and `landing/logo-512.png` (Organization schema). Don't repoint any of
those at this folder — the app icon in particular *must* keep its opaque
background, since iOS rejects icons with alpha.

| File | Use |
|---|---|
| `capsule-logo-currentcolor.svg` | **Start here for Figma.** Real vector path, `fill="currentColor"` so it recolours in one click. |
| `capsule-logo-white.svg` | Same path, white hard-coded. |
| `capsule-logo-{white,black,coral}-1024.png` | Raster with alpha, 1024×1024. |
| `capsule-logo-{white,black,coral}-512.png` | Same at 512×512. |

Colours: white `#FFFFFF` · black `#0A0A0A` (the Background token, not pure black,
so it matches the app) · coral `#FC6A5B` (the brand accent).

## How the transparency works

The source (`assets/icon.png`) is a white mark on solid black with no alpha
channel, so **luminance is the mask**: white mark → opaque, black background →
transparent, and the anti-aliased grey edge pixels become partial alpha, which
keeps the C's curve smooth instead of jagged.

⚠️ **The C's counter and the keyhole are negative space, not black shapes.** They
are transparent here, deliberately. A knockout that fills them black looks
correct on the app's dark UI and breaks the moment the logo lands on anything
else — that's the whole reason these files exist.

The SVG is a **trace** of the bitmap (potrace), not a hand-drawn vector. At normal
sizes it's indistinguishable from the source, but it is curve-fitted rather than
mathematically exact — if you zoom past ~800% you may see the difference. For a
truly exact vector, the C and lock would need redrawing from primitives.

## Regenerating

Not wired into any build; these are static and only change if `assets/icon.png`
does. To rebuild, run a script that reads `assets/icon.png`, sets
`alpha = Rec.709 luma` with the RGB replaced by the target colour, and traces the
same source with potrace (`blackOnWhite: false`, since the mark is the white
region). Any equivalent tool works — the only thing that matters is that
luminance drives alpha, so the negative space stays open.
