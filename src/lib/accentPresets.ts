// Curated accent palette. Free users pick a solid from ACCENT_PRESETS; Pro
// users additionally get the free-form ColorPicker and ACCENT_GRADIENTS.
// Pure data + parsing — no network, importable anywhere (incl. Settings).

export const ACCENT_PRESETS: string[] = [
  '#FC6A5B', // brand reddish-coral (default — matches the website)
  '#FF6B35', // classic orange
  '#FF3B7F', // magenta
  '#F5A623', // amber
  '#30D158', // green
  '#32D0C6', // teal
  '#4C8DFF', // blue
  '#7B61FF', // indigo
  '#B36BFF', // violet
  '#FF5CA8', // pink
];

export const ACCENT_GRADIENTS: [string, string][] = [
  ['#FC6A5B', '#FF3B7F'], // sunset
  ['#FF6B35', '#F5A623'], // ember
  ['#4C8DFF', '#7B61FF'], // dusk
  ['#32D0C6', '#30D158'], // aurora
  ['#B36BFF', '#FF5CA8'], // orchid
  ['#7B61FF', '#4C8DFF'], // twilight
];

const HEX_RE = /^#[0-9a-fA-F]{6}$/;

/** Split a stored "#a,#b" gradient into a tuple; null/invalid → null. */
export function parseGradient(value: string | null | undefined): [string, string] | null {
  if (!value) return null;
  const parts = value.split(',').map((s) => s.trim());
  if (parts.length !== 2) return null;
  if (!HEX_RE.test(parts[0]) || !HEX_RE.test(parts[1])) return null;
  return [parts[0], parts[1]];
}

/** Serialize a gradient tuple to the stored "#a,#b" form. */
export function serializeGradient(g: [string, string]): string {
  return `${g[0]},${g[1]}`;
}
