// One-line summary of a capsule's default awards, shown in DefaultAwardsCard's
// collapsed header — the same "collapsed disclosure shows what's inside"
// pattern as CreateGroupScreen's `describeAnchor(...).compact` schedule line.
//
// Deliberately does NOT truncate: the collapsed <Text> renders with
// numberOfLines={1}, so the platform ellipsizes at whatever width it actually
// gets. Truncating here too would double up at some widths.
import { PresetAward } from './awardPool';

export function summarizeAwards(awards: PresetAward[]): string {
  if (awards.length === 0) return 'No default awards yet';
  const noun = awards.length === 1 ? 'award' : 'awards';
  return `${awards.length} ${noun} · ${awards.map(a => a.label).join(', ')}`;
}
