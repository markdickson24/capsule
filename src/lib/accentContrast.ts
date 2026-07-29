// Picks a readable text/icon color to sit ON the user's accent color.
//
// Pure data + math — no React, no network, importable anywhere.
//
// WHY THIS EXISTS
// ---------------
// Every accent-backed surface used to hardcode white text. That fails badly:
// white on the shipped palette measures 1.91–4.20:1, and Pro users can pick an
// arbitrary custom color, so a pale accent produced effectively invisible
// labels (white on #FFF9C4 is 1.07:1).
//
// WHY 0.38 AND NOT 0.179
// ----------------------
// The widely-copied constant for this decision is 0.179 — the luminance at
// which contrast-with-black equals contrast-with-white, so it *maximizes the
// WCAG ratio*. That is a different goal than legibility, and it is the wrong
// one here: at 0.179 seven of the ten shipped presets flip to dark text,
// including the brand coral, changing the appearance of every primary button
// in the app.
//
// Andrew Somers (Myndex) — author of APCA and lead of WCAG 3's contrast work —
// published a note specifically to correct that constant:
//
//   "our human perception of lightness/darkness and of contrast is not linear.
//    For a self illuminated display, it so happens that 0.38 Y is about middle
//    contrast for TEXT under averaged, typical conditions."
//   https://gist.github.com/Myndex/e1025706436736166561d339fd667493
//
// At 0.38 exactly the three unreadable presets (amber, green, teal) flip, every
// pale custom color flips, and dark custom colors correctly KEEP white — which
// a naive "always use dark text" fix would have broken.
//
// The luminance below uses the simple 2.2 gamma from that note rather than
// WCAG's piecewise sRGB curve, because 0.38 is calibrated against it. For real
// colors the two agree to ~0.005 anyway; the threshold is what matters.
//
// NOT DONE HERE: Material 3 solves the same problem by never putting text on a
// raw brand color at all — it maps the seed into a tonal palette and pairs
// fixed roles (primary/on-primary). That guarantees contrast, but it recolors
// the accent the user chose, which is not an acceptable trade for a paid
// custom-color feature.

/** Text/icon color for content on a DARK accent. */
export const ON_ACCENT_LIGHT = '#FFFFFF';

/**
 * Text/icon color for content on a LIGHT accent. Near-black rather than pure
 * black, matching the app's Background token and the website's dark-on-coral
 * treatment.
 */
export const ON_ACCENT_DARK = '#0A0A0A';

/** Perceptual middle-contrast luminance for text on a self-illuminated display. */
export const TEXT_FLIP_LUMINANCE = 0.38;

const HEX6_RE = /^#?[0-9a-f]{6}$/i;

/**
 * Relative luminance (Y) of a hex color, 0 (black) to 1 (white).
 * Returns null for anything unparseable so callers can decide the fallback.
 */
function luminanceOrNull(hex: string | null | undefined): number | null {
  if (!hex || !HEX6_RE.test(hex)) return null;
  const h = hex.startsWith('#') ? hex.slice(1) : hex;
  const r = parseInt(h.slice(0, 2), 16) / 255;
  const g = parseInt(h.slice(2, 4), 16) / 255;
  const b = parseInt(h.slice(4, 6), 16) / 255;
  return r ** 2.2 * 0.2126 + g ** 2.2 * 0.7152 + b ** 2.2 * 0.0722;
}

/** Relative luminance of an accent color, 0–1. Unparseable input returns 0. */
export function accentLuminance(hex: string | null | undefined): number {
  return luminanceOrNull(hex) ?? 0;
}

/**
 * The readable text/icon color to place on `hex`.
 *
 * Unparseable input falls back to white — the pre-fix behavior, so a bad value
 * can never render worse than it did before this module existed.
 */
export function onAccent(hex: string | null | undefined): string {
  const y = luminanceOrNull(hex);
  if (y === null) return ON_ACCENT_LIGHT;
  return y < TEXT_FLIP_LUMINANCE ? ON_ACCENT_LIGHT : ON_ACCENT_DARK;
}

/**
 * The readable text/icon color for a two-stop gradient.
 *
 * Decided on the LIGHTER stop: text has to stay readable at the accent's
 * lightest point, not at its average.
 */
export function onAccentForGradient(
  gradient: readonly [string, string] | null | undefined
): string {
  if (!gradient) return ON_ACCENT_LIGHT;
  const a = luminanceOrNull(gradient[0]);
  const b = luminanceOrNull(gradient[1]);
  if (a === null && b === null) return ON_ACCENT_LIGHT;
  const lightest = Math.max(a ?? 0, b ?? 0);
  return lightest < TEXT_FLIP_LUMINANCE ? ON_ACCENT_LIGHT : ON_ACCENT_DARK;
}

// --- WCAG 2.x contrast, for tests and reporting only -----------------------
// Deliberately the piecewise sRGB curve, since a contrast RATIO is a WCAG
// quantity and must be computed WCAG's way even though the flip point above is
// not. Not used to make the flip decision.

function wcagChannel(c: number): number {
  const s = c / 255;
  return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
}

function wcagLuminance(hex: string): number | null {
  if (!HEX6_RE.test(hex)) return null;
  const h = hex.startsWith('#') ? hex.slice(1) : hex;
  return (
    0.2126 * wcagChannel(parseInt(h.slice(0, 2), 16)) +
    0.7152 * wcagChannel(parseInt(h.slice(2, 4), 16)) +
    0.0722 * wcagChannel(parseInt(h.slice(4, 6), 16))
  );
}

/** WCAG 2.x contrast ratio between two hex colors, 1–21. Unparseable → 1. */
export function contrastRatio(a: string, b: string): number {
  const la = wcagLuminance(a);
  const lb = wcagLuminance(b);
  if (la === null || lb === null) return 1;
  const hi = Math.max(la, lb);
  const lo = Math.min(la, lb);
  return (hi + 0.05) / (lo + 0.05);
}
