// Predetermined ("default") award pool — the client-side source of truth
// used to seed/reshuffle a capsule's 4 automatic awards. Purely client-side
// (no network calls) because the Create-screen preview/shuffle happens
// *before* the capsule exists, so there's nothing to query yet. Once a
// capsule exists, the chosen set is persisted via the `set_default_superlatives`
// RPC (src/lib/awardsData.ts callers use it directly) as ordinary
// `superlative_categories` rows with `is_default = true`.

export type OccasionKey = 'wedding' | 'vacation' | 'party' | 'baby' | 'milestone' | 'general';

export type PresetAward = {
  label: string;
  target_type: 'person' | 'media';
};

// Short, single-word labels — these sit in a uniform equal-width grid
// (CreateScreen's occasion picker), so length consistency matters more here
// than in most chip lists. Longer descriptive text lives in the InfoTooltip.
export const OCCASIONS: { key: OccasionKey; label: string; icon: string }[] = [
  { key: 'general', label: 'General', icon: 'sparkles-outline' },
  { key: 'wedding', label: 'Wedding', icon: 'heart-outline' },
  { key: 'vacation', label: 'Vacation', icon: 'airplane-outline' },
  { key: 'party', label: 'Party', icon: 'wine-outline' },
  { key: 'baby', label: 'Baby', icon: 'happy-outline' },
  { key: 'milestone', label: 'Milestone', icon: 'trophy-outline' },
];

export const AWARD_POOL: Record<OccasionKey, PresetAward[]> = {
  wedding: [
    { label: 'Cutest couple moment', target_type: 'media' },
    { label: 'Best dressed', target_type: 'person' },
    { label: 'Most likely to cry happy tears', target_type: 'person' },
    { label: 'Best dance-floor moment', target_type: 'media' },
    { label: 'Life of the party', target_type: 'person' },
    { label: 'Most heartfelt toast', target_type: 'person' },
    { label: 'Best photo of the night', target_type: 'media' },
    { label: 'Biggest hype friend', target_type: 'person' },
    { label: 'Most emotional moment', target_type: 'media' },
    { label: 'Best group photo', target_type: 'media' },
  ],
  vacation: [
    { label: 'Most likely to get lost', target_type: 'person' },
    { label: 'Best view captured', target_type: 'media' },
    { label: 'Biggest adventurer', target_type: 'person' },
    { label: 'Best food pic', target_type: 'media' },
    { label: 'Most likely to oversleep', target_type: 'person' },
    { label: 'Funniest candid', target_type: 'media' },
    { label: 'Human GPS', target_type: 'person' },
    { label: 'Best sunset shot', target_type: 'media' },
    { label: 'Most likely to lose their stuff', target_type: 'person' },
    { label: 'Trip MVP', target_type: 'person' },
  ],
  party: [
    { label: 'Life of the party', target_type: 'person' },
    { label: 'Best dance moves', target_type: 'person' },
    { label: 'Funniest photo', target_type: 'media' },
    { label: 'Last one standing', target_type: 'person' },
    { label: 'Best fit', target_type: 'person' },
    { label: 'Most likely to start the chaos', target_type: 'person' },
    { label: 'Best blurry photo', target_type: 'media' },
    { label: 'Biggest social butterfly', target_type: 'person' },
    { label: 'Most iconic moment', target_type: 'media' },
    { label: 'First on the floor', target_type: 'person' },
  ],
  baby: [
    { label: 'Cutest smile', target_type: 'media' },
    { label: 'Most precious moment', target_type: 'media' },
    { label: 'Best family photo', target_type: 'media' },
    { label: 'Biggest helper', target_type: 'person' },
    { label: 'Most likely to make everyone laugh', target_type: 'person' },
    { label: 'Sweetest candid', target_type: 'media' },
    { label: 'Proudest grandparent', target_type: 'person' },
    { label: 'Tiniest toes', target_type: 'media' },
    { label: 'Most heart-melting moment', target_type: 'media' },
    { label: 'Best caregiver', target_type: 'person' },
  ],
  milestone: [
    { label: 'Glow-up of the year', target_type: 'person' },
    { label: 'Best memory captured', target_type: 'media' },
    { label: 'Most improved', target_type: 'person' },
    { label: 'Biggest achievement', target_type: 'person' },
    { label: 'Funniest moment', target_type: 'media' },
    { label: 'Most likely to succeed', target_type: 'person' },
    { label: 'Best throwback', target_type: 'media' },
    { label: 'Most supportive friend', target_type: 'person' },
    { label: 'Photo that says it all', target_type: 'media' },
    { label: 'Most unforgettable moment', target_type: 'media' },
  ],
  general: [
    { label: 'Best photo', target_type: 'media' },
    { label: 'Funniest moment', target_type: 'media' },
    { label: 'Life of the group', target_type: 'person' },
    { label: 'Best candid', target_type: 'media' },
    { label: 'Most likely to be late', target_type: 'person' },
    { label: 'Biggest jokester', target_type: 'person' },
    { label: 'Best group shot', target_type: 'media' },
    { label: 'Most photogenic', target_type: 'person' },
    { label: 'Most memorable moment', target_type: 'media' },
    { label: 'Best vibe', target_type: 'person' },
  ],
};

function shuffle<T>(arr: T[]): T[] {
  const copy = [...arr];
  for (let i = copy.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [copy[i], copy[j]] = [copy[j], copy[i]];
  }
  return copy;
}

/**
 * Randomly picks `count` awards from the given occasion's pool, skipping any
 * label already in `exclude` (used for single-slot swap and to avoid
 * repeating an award already chosen elsewhere in the set). Falls back to
 * allowing repeats only if the pool minus exclusions is too small to fill
 * `count` — shouldn't happen at count=4 against a 10-award pool, but keeps
 * the function total.
 */
export function pickDefaults(
  occasion: OccasionKey,
  count: number = 4,
  exclude: string[] = [],
): PresetAward[] {
  const pool = AWARD_POOL[occasion] ?? AWARD_POOL.general;
  const excludeSet = new Set(exclude.map(l => l.toLowerCase()));
  const available = shuffle(pool.filter(a => !excludeSet.has(a.label.toLowerCase())));

  if (available.length >= count) return available.slice(0, count);

  // Not enough unique awards left — top up with shuffled repeats from the
  // full pool rather than returning fewer than requested.
  const topUp = shuffle(pool).filter(a => !available.includes(a));
  return [...available, ...topUp].slice(0, count);
}

/** Picks a single replacement award for one slot, excluding the other current labels. */
export function pickReplacement(occasion: OccasionKey, currentLabels: string[]): PresetAward {
  return pickDefaults(occasion, 1, currentLabels)[0];
}
