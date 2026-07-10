import { OccasionKey } from './awardPool';

// The onboarding personalization matrix (designs/ONBOARDING_V2.md).
// One lookup keyed on the "What are you waiting for?" answer drives every
// dynamic string in the flow — no server, no schema change. Free text typed
// by the user always beats titleSeed, verbatim (never rewrite their words).

export type MomentDateChip = {
  label: string;
  /** Resolved lazily so the date is relative to when the user taps, not module load. */
  resolve: () => Date;
};

export type Moment = {
  occasion: OccasionKey;
  icon: string; // Ionicons glyph name
  label: string;
  titleSeed: string;
  /** Screen 3 flavor line under the capsule card. */
  flavor: string;
  /** Screen 5 invite nudge. */
  nudge: string;
  dateChips: MomentDateChip[];
};

function daysFromNow(days: number, hour = 18): Date {
  const d = new Date();
  d.setDate(d.getDate() + days);
  d.setHours(hour, 0, 0, 0);
  return d;
}

function yearsFromNow(years: number): Date {
  const d = new Date();
  d.setFullYear(d.getFullYear() + years);
  d.setHours(18, 0, 0, 0);
  return d;
}

function nextNewYearsEve(): Date {
  const now = new Date();
  const nye = new Date(now.getFullYear(), 11, 31, 20, 0, 0, 0);
  // If NYE is already (nearly) here, roll to next year's.
  if (nye.getTime() - now.getTime() < 60 * 60 * 1000) {
    nye.setFullYear(nye.getFullYear() + 1);
  }
  return nye;
}

function nextSaturdayEvening(): Date {
  const d = new Date();
  const day = d.getDay(); // 0 Sun … 6 Sat
  const until = ((6 - day + 7) % 7) || 7; // always a *future* Saturday
  d.setDate(d.getDate() + until);
  d.setHours(18, 0, 0, 0);
  return d;
}

export const MOMENTS: Moment[] = [
  {
    occasion: 'wedding',
    icon: 'heart-outline',
    label: 'A wedding',
    titleSeed: 'The Wedding Capsule',
    flavor: "Every guest's photos, opened when the chaos settles.",
    nudge: "Who's in the wedding party?",
    dateChips: [
      { label: 'After the honeymoon', resolve: () => daysFromNow(21) },
      { label: 'First anniversary', resolve: () => yearsFromNow(1) },
    ],
  },
  {
    occasion: 'vacation',
    icon: 'airplane-outline',
    label: 'A trip',
    titleSeed: `Summer Trip ${new Date().getFullYear()}`,
    flavor: 'Shoot now, relive it on the couch.',
    nudge: "Who's coming on the trip?",
    dateChips: [
      { label: "When we're home", resolve: () => daysFromNow(14) },
      { label: 'One year later', resolve: () => yearsFromNow(1) },
    ],
  },
  {
    occasion: 'baby',
    icon: 'happy-outline',
    label: "A baby's first year",
    titleSeed: "Baby's First Year",
    flavor: 'Every milestone, sealed until the candles.',
    nudge: 'Grandparents love this part.',
    dateChips: [
      { label: 'Their 1st birthday', resolve: () => yearsFromNow(1) },
    ],
  },
  {
    occasion: 'milestone',
    icon: 'school-outline',
    label: 'A big milestone',
    titleSeed: 'The Milestone Capsule',
    flavor: "Lock it now. Open it when you've made it.",
    nudge: "Who's on this journey with you?",
    dateChips: [
      { label: 'Six months from now', resolve: () => daysFromNow(182) },
      { label: 'One year from today', resolve: () => yearsFromNow(1) },
    ],
  },
  {
    occasion: 'party',
    icon: 'wine-outline',
    label: 'A party or event',
    titleSeed: 'The Big Night',
    flavor: "Everyone's angle of the same night.",
    nudge: 'Who else was there?',
    dateChips: [
      { label: 'Tomorrow morning', resolve: () => daysFromNow(1, 9) },
      { label: 'Next weekend', resolve: () => nextSaturdayEvening() },
    ],
  },
  {
    occasion: 'general',
    icon: 'sparkles-outline',
    label: 'Just memories',
    titleSeed: 'Our Capsule',
    flavor: 'Photos are better with a little patience.',
    nudge: 'Who should be in this?',
    dateChips: [
      { label: "New Year's Eve", resolve: () => nextNewYearsEve() },
      { label: 'One year from today', resolve: () => yearsFromNow(1) },
    ],
  },
];

export const GENERAL_MOMENT: Moment = MOMENTS[MOMENTS.length - 1];
