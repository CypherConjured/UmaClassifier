import { lookupFactor } from './loader.js';
import type {
  RawUma,
  RawParent,
  ScoredUma,
  CategoryScores,
  Icon,
  ClassifierConfig,
} from './types.js';

const ICON_CATEGORIES: Icon[] = [
  'speed', 'stamina', 'power', 'guts', 'wit',
  'turf', 'dirt', 'sprint', 'mile', 'mid', 'long',
];

function isDirectParent(position_id: number): boolean {
  return position_id === 10 || position_id === 20;
}

function scoreFactors(
  factor_ids: number[],
  weight: number,
  scores: CategoryScores,
  whiteTotal: { value: number },
  debuffScore: { value: number },
  config: ClassifierConfig
): void {
  for (const fid of factor_ids) {
    const f = lookupFactor(fid);
    if (!f) continue;

    if (f.type === 'blue' && f.category) {
      scores[f.category] = (scores[f.category] ?? 0) + f.stars * weight;
    }

    else if (f.type === 'pink' && f.category) {
      // Only score aptitude pinks (not style pinks — front/pace/late/end)
      if (['turf', 'dirt', 'sprint', 'mile', 'mid', 'long'].includes(f.category)) {
        scores[f.category] = (scores[f.category] ?? 0) + f.stars * weight;
      }
    }

    else if (f.type === 'white') {
      const stars = f.stars;
      whiteTotal.value += stars * weight;

      if (f.is_debuff) {
        debuffScore.value += stars * weight;
      }

      // Stat boost from hybrid (type 5) factors goes to the stat category
      if (f.stat_boost) {
        scores[f.stat_boost] = (scores[f.stat_boost] ?? 0) +
          stars * weight * config.whiteStatBoostMultiplier;
      }

      // Skill tags push score toward matching distance/surface categories
      for (const cat of (f.dist_cats ?? [])) {
        scores[cat] = (scores[cat] ?? 0) + stars * weight * config.whiteSkillMultiplier;
      }
      for (const cat of (f.surf_cats ?? [])) {
        scores[cat] = (scores[cat] ?? 0) + stars * weight * config.whiteSkillMultiplier;
      }
      // Style cats (front/pace/late/end) are not icon categories — skip
    }
    // green, unique, scenario — ignored for scoring
  }
}

export function classifyRoster(umas: RawUma[], config: ClassifierConfig): ScoredUma[] {
  const { keepPerCategory, minCategoryScore, heartWhiteThreshold, aceScoreThreshold } = config;

  const scored: ScoredUma[] = umas.map(uma => {
    const scores: CategoryScores = {};
    const whiteTotal = { value: 0 };
    const debuffScore = { value: 0 };

    // Own factors — full weight
    scoreFactors(uma.factor_id_array, config.weights.own, scores, whiteTotal, debuffScore, config);

    // Direct parents only (position 10 and 20)
    for (const parent of uma.succession_chara_array) {
      if (!isDirectParent(parent.position_id)) continue;
      scoreFactors(parent.factor_id_array, config.weights.parent, scores, whiteTotal, debuffScore, config);
    }

    return {
      trained_chara_id: uma.trained_chara_id,
      card_id: uma.card_id,
      rank_score: uma.rank_score,
      is_locked: uma.is_locked === 1,
      scores,
      white_total: whiteTotal.value,
      debuff_score: debuffScore.value,
      assigned_icon: null,
    };
  });

  const assigned = new Map<number, Icon>();

  // Top-N competitive assignment per category
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
  }

  // Heart — unassigned with high white total
  for (const uma of scored) {
    if (!assigned.has(uma.trained_chara_id) && uma.white_total >= heartWhiteThreshold) {
      assigned.set(uma.trained_chara_id, 'heart');
    }
  }

  // Ace — unassigned with high rank_score
  for (const uma of scored) {
    if (!assigned.has(uma.trained_chara_id) && uma.rank_score >= aceScoreThreshold) {
      assigned.set(uma.trained_chara_id, 'ace');
    }
  }

  // Debuff — top scorers among unassigned
  const debuffCandidates = scored
    .filter(u => !assigned.has(u.trained_chara_id) && u.debuff_score > 0)
    .sort((a, b) => b.debuff_score - a.debuff_score)
    .slice(0, keepPerCategory);

  for (const uma of debuffCandidates) {
    assigned.set(uma.trained_chara_id, 'clubs');
  }

  // Everything else → trash
  for (const uma of scored) {
    uma.assigned_icon = assigned.get(uma.trained_chara_id) ?? 'trash';
  }

  return scored;
}