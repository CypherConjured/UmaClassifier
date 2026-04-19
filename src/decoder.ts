import type { DecodedFactor, FactorCategory } from './types.ts';

/**
 * Decodes a raw factor_id into its category and star count.
 *
 * Encoding rules (reverse-engineered from game data + screenshots):
 *
 * BLUE stats (2-3 digit IDs):
 *   1XX = Speed, 2XX = Stamina, 3XX = Power, 4XX = Guts, 5XX = Wit
 *   Last digit = stars (1-3)
 *
 * PINK aptitudes / styles (4 digit IDs):
 *   First digit = group: 1=track, 2=style, 3=distance
 *   Second digit = type within group:
 *     Track:    11XX=Turf, 12XX=Dirt
 *     Style:    21XX=Front, 22XX=Pace, 23XX=Late, 24XX=End
 *     Distance: 31XX=Sprint, 32XX=Mile, 33XX=Long, 34XX=Mid
 *   Last digit = stars (1-3)
 *
 * WHITE skill hints (7 digit IDs): 1XXXXXX, 2XXXXXX
 *   Last digit = stars
 *
 * GREEN race factors (7 digit IDs): 3XXXXXX
 *   Grouped with whites for scoring purposes
 *
 * UNIQUE character factors (8+ digit IDs): 10XXXXXXXX
 *   Ignored for category scoring
 */
export function decodeFactor(factor_id: number): DecodedFactor {
  const stars = factor_id % 10;

  // Unique character factors (8+ digits)
  if (factor_id >= 10_000_000) {
    return { factor_id, category: 'unique', stars };
  }

  // White/green skill hints (7 digits)
  if (factor_id >= 1_000_000) {
    return { factor_id, category: 'white', stars };
  }

  // Pink aptitudes/styles (4 digits)
  if (factor_id >= 1_000) {
    const prefix = Math.floor(factor_id / 100); // e.g. 3403 -> 34
    const category = PINK_PREFIX_MAP[prefix];
    if (!category) {
      return { factor_id, category: 'unique', stars }; // unknown, ignore
    }
    return { factor_id, category, stars };
  }

  // Blue stats (2-3 digits)
  const statGroup = Math.floor(factor_id / 100); // e.g. 302 -> 3
  const category = BLUE_GROUP_MAP[statGroup];
  if (!category) {
    return { factor_id, category: 'unique', stars };
  }
  return { factor_id, category, stars };
}

const BLUE_GROUP_MAP: Record<number, FactorCategory> = {
  1: 'speed',
  2: 'stamina',
  3: 'power',
  4: 'guts',
  5: 'wit',
};

const PINK_PREFIX_MAP: Record<number, FactorCategory> = {
  11: 'turf',
  12: 'dirt',
  21: 'front',
  22: 'pace',
  23: 'late',
  24: 'end',
  31: 'sprint',
  32: 'mile',
  33: 'long',
  34: 'mid',
};

export function decodeFactors(ids: number[]): DecodedFactor[] {
  return ids.map(decodeFactor);
}
