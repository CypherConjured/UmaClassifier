import { decodeFactors } from './decoder.ts';
import type {
  RawUma,
  RawParent,
  ScoredUma,
  CategoryScores,
  Icon,
  ClassifierConfig,
} from './types.ts';

// Icon categories that get slots in the top-N competition
const ICON_CATEGORIES: Icon[] = [
  'speed', 'stamina', 'power', 'guts', 'wit',
  'turf', 'dirt', 'sprint', 'mile', 'mid', 'long',
];

/**
 * Determines if a parent position_id is a direct parent or grandparent.
 *   10, 20 = direct parents
 *   11, 12, 21, 22 = grandparents
 */
function parentDepth(position_id: number): 'parent' | 'grandparent' {
  return position_id % 10 === 0 ? 'parent' : 'grandparent';
}

/**
 * Scores a single uma across all icon categories.
 * Returns a score map and total white stars.
 */
function scoreUma(uma: RawUma, config: ClassifierConfig): { scores: CategoryScores; white_total: number } {
  const { weights, whiteMultiplier } = config;

  // Accumulate per-category scores and white totals
  const scores: CategoryScores = {};
  let white_total = 0;

  // Helper: add stars to a category with a weight
  function add(category: string, stars: number, weight: number) {
    scores[category] = (scores[category] ?? 0) + stars * weight;
  }

  // ── Own factors (highest weight) ──────────────────────────────────────────
  for (const f of decodeFactors(uma.factor_id_array)) {
    if (f.category === 'unique') continue;
    if (f.category === 'white') {
      white_total += f.stars * weights.own;
      // Whites contribute to ALL icon categories at a reduced rate —
      // the skill-to-category mapping is a future concern; for now they
      // add a flat boost representing general inheritance value.
      for (const icon of ICON_CATEGORIES) {
        add(icon, f.stars * whiteMultiplier, weights.own);
      }
    } else if (!isStyleCategory(f.category)) {
      // Blue or meaningful pink — goes directly to its own category
      add(f.category, f.stars, weights.own);
    }
    // Style pinks (front/pace/late/end) are ignored for icon scoring
  }

  // ── Parent & grandparent factors ──────────────────────────────────────────
  for (const parent of uma.succession_chara_array) {
    const depth = parentDepth(parent.position_id);
    const weight = depth === 'parent' ? weights.parent : weights.grandparent;

    for (const f of decodeFactors(parent.factor_id_array)) {
      if (f.category === 'unique') continue;
      if (f.category === 'white') {
        white_total += f.stars * weight;
        for (const icon of ICON_CATEGORIES) {
          add(icon, f.stars * whiteMultiplier, weight);
        }
      } else if (!isStyleCategory(f.category)) {
        add(f.category, f.stars, weight);
      }
    }
  }

  return { scores, white_total };
}

function isStyleCategory(cat: string): boolean {
  return ['front', 'pace', 'late', 'end'].includes(cat);
}

/**
 * Scores all umas, then assigns icons via competitive top-N selection.
 *
 * Algorithm:
 * 1. Score every uma across all categories.
 * 2. For each icon category, rank umas by that category's score.
 * 3. Greedily assign: top scorers get the icon if they haven't been assigned one yet.
 *    We make multiple passes until keepPerCategory slots are filled per category.
 * 4. Anything unassigned with high white_total → heart.
 * 5. Anything unassigned with high rank_score → ace.
 * 6. Rest → trash.
 */
export function classifyRoster(umas: RawUma[], config: ClassifierConfig): ScoredUma[] {
  const { keepPerCategory, minCategoryScore, heartWhiteThreshold, aceScoreThreshold } = config;

  // Step 1: score everyone
  const scored: ScoredUma[] = umas.map(uma => {
    const { scores, white_total } = scoreUma(uma, config);
    return {
      trained_chara_id: uma.trained_chara_id,
      card_id: uma.card_id,
      rank_score: uma.rank_score,
      is_locked: uma.is_locked === 1,
      scores,
      white_total,
      assigned_icon: null,
    };
  });

  const assigned = new Map<number, Icon>(); // trained_chara_id → icon

  // Step 2 & 3: for each category, fill keepPerCategory slots
  for (const icon of ICON_CATEGORIES) {
    const candidates = scored
      .filter(u => (u.scores[icon] ?? 0) >= minCategoryScore)
      .sort((a, b) => (b.scores[icon] ?? 0) - (a.scores[icon] ?? 0));

    let filled = 0;
    for (const uma of candidates) {
      if (filled >= keepPerCategory) break;
      if (!assigned.has(uma.trained_chara_id)) {
        assigned.set(uma.trained_chara_id, icon);
        filled++;
      }
    }

    // Second pass: if we didn't fill all slots, allow already-assigned umas
    // to "share" the category conceptually — they already have an icon so
    // no change needed, but we count them toward the minimum guarantee.
    // (No action needed here; the UI can show secondary scores later.)
  }

  // Step 4: heart — unassigned with high white total
  for (const uma of scored) {
    if (!assigned.has(uma.trained_chara_id) && uma.white_total >= heartWhiteThreshold) {
      assigned.set(uma.trained_chara_id, 'heart');
    }
  }

  // Step 5: ace — unassigned with high rank_score
  for (const uma in scored) {
    const u = scored[uma as unknown as number];
    if (!assigned.has(u.trained_chara_id) && u.rank_score >= aceScoreThreshold) {
      assigned.set(u.trained_chara_id, 'ace');
    }
  }

  // Step 6: everything else → trash
  for (const uma of scored) {
    uma.assigned_icon = assigned.get(uma.trained_chara_id) ?? 'trash';
  }

  return scored;
}
