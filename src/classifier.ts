import { lookupFactor } from './loader.ts';
import type { FactorEntry } from './loader.ts';
import type {
  RawUma,
  ScoredUma,
  FactorContribution,
  CategoryScores,
  Icon,
  ClassifierConfig,
} from './types.ts';

// ─── Constants ─────────────────────────────────────────────────────────────────

const GROUNDWORK_ID_BASE     = 2016001;
const TAIL_HELD_HIGH_ID_BASE = 2016101;

const APTITUDE_PINKS = new Set(['turf','dirt','sprint','mile','mid','long']);
const STYLE_PINKS    = new Set(['front','pace','late','end']);
const ALL_PINKS      = new Set([...APTITUDE_PINKS, ...STYLE_PINKS]);

const ICON_CATEGORIES: Icon[] = [
  'speed', 'stamina', 'power', 'guts', 'wit',
  'turf', 'dirt', 'sprint', 'mile', 'mid', 'long',
];

// ─── Helpers ───────────────────────────────────────────────────────────────────

function isDirectParent(position_id: number): boolean {
  return position_id === 10 || position_id === 20;
}

function specialBonus(
  factor_id: number,
  pinkStars: Map<string, number>
): number {
  const base = Math.floor(factor_id / 10) * 10 + 1;
  if (base === GROUNDWORK_ID_BASE) {
    return (pinkStars.get('front') ?? 0) > 0 ? 2.0 : 1.5;
  }
  if (base === TAIL_HELD_HIGH_ID_BASE) return 1.5;
  return 1.0;
}

function pinkMultiplier(
  f: FactorEntry,
  pinkStars: Map<string, number>
): number {
  const cats = [
    ...(f.style_cats ?? []),
    ...(f.dist_cats  ?? []),
    ...(f.surf_cats  ?? []),
  ];
  if (cats.length === 0) return 1.0;
  const matching = cats.reduce((sum, cat) => sum + (pinkStars.get(cat) ?? 0), 0);
  return 1 + matching / 6;
}

export function whiteToCategory(f: FactorEntry): string | null {
  if (f.is_debuff) return 'debuff';
  switch (f.skill_category) {
    case 'Speed Boost':  return f.is_last_spurt ? 'guts' : 'speed';
    case 'Acceleration': return 'power';
    case 'Recovery':     return 'stamina';
    case 'Lane Effect':
    case 'Vision':       return 'wit';
    case 'Debuff':       return 'debuff';
    default:             return null;
  }
}

// ─── Pink star collection ──────────────────────────────────────────────────────

function collectPinks(
  factor_ids: number[],
  out: Map<string, number>
): void {
  for (const fid of factor_ids) {
    const f = lookupFactor(fid);
    if (!f || f.type !== 'pink' || !f.category) continue;
    if (!ALL_PINKS.has(f.category)) continue;
    out.set(f.category, (out.get(f.category) ?? 0) + f.stars);
  }
}

// ─── Factor scoring ────────────────────────────────────────────────────────────

function scoreFactors(
  factor_ids: number[],
  weight: number,
  source: 'own' | 'parent',
  scores: CategoryScores,
  whiteTotal: { value: number },
  debuffScore: { value: number },
  pinkStars: Map<string, number>,
  factors: FactorContribution[],
  config: ClassifierConfig,
  skillRelevance?: Map<number, number>
): void {
  for (const fid of factor_ids) {
    const f = lookupFactor(fid);
    if (!f) continue;

    if (f.type === 'blue' && f.category) {
      const contribution = f.stars * weight;
      scores[f.category] = (scores[f.category] ?? 0) + contribution;
      factors.push({
        factor_id: fid,
        name: f.name,
        stars: f.stars,
        type: 'blue',
        source,
        category: f.category,
        contribution,
      });

    } else if (f.type === 'pink' && f.category) {
      if (APTITUDE_PINKS.has(f.category)) {
        const contribution = f.stars * weight;
        scores[f.category] = (scores[f.category] ?? 0) + contribution;

        // Secondary category
        let secondary_category: string | undefined;
        let secondary_contribution: number | undefined;

        if (['sprint','mile','mid','long'].includes(f.category)) {
          secondary_category = 'speed';
          secondary_contribution = f.stars * weight * 0.5;
          scores['speed'] = (scores['speed'] ?? 0) + secondary_contribution;
        } else if (['turf','dirt'].includes(f.category)) {
          secondary_category = 'power';
          secondary_contribution = f.stars * weight * 0.5;
          scores['power'] = (scores['power'] ?? 0) + secondary_contribution;
        }

        factors.push({
          factor_id: fid,
          name: f.name,
          stars: f.stars,
          type: 'pink',
          source,
          category: f.category,
          contribution,
          secondary_category,
          secondary_contribution,
        });

      } else if (STYLE_PINKS.has(f.category)) {
        const secondary_contribution = f.stars * weight * 0.5;
        scores['wit'] = (scores['wit'] ?? 0) + secondary_contribution;
        factors.push({
          factor_id: fid,
          name: f.name,
          stars: f.stars,
          type: 'pink',
          source,
          category: f.category,
          contribution: 0,
          secondary_category: 'wit',
          secondary_contribution,
        });
      }

    } else if (f.type === 'white') {
      const pm = pinkMultiplier(f, pinkStars);
      const sb = specialBonus(fid, pinkStars);
      const weighted = f.stars * weight * pm * sb;
      const display  = f.stars * pm * sb; // unweighted for display

      whiteTotal.value += weighted;

      const cat = whiteToCategory(f);
      let contribution = 0;

      if (cat === 'debuff') {
        debuffScore.value += f.stars * weight;
      } else if (cat) {
        contribution = weighted * config.whiteSkillMultiplier;
        scores[cat] = (scores[cat] ?? 0) + contribution;
      }

      if (f.stat_boost) {
        const statContrib = weighted * config.whiteStatBoostMultiplier;
        scores[f.stat_boost] = (scores[f.stat_boost] ?? 0) + statContrib;
      }

      factors.push({
        factor_id: fid,
        name: f.name,
        stars: f.stars,
        type: 'white',
        source,
        category: cat ?? 'none',
        contribution,
        pink_multiplier: pm,
        special_bonus: sb,
        final_value: display,
        dist_cats: f.dist_cats ?? [],
        style_cats: f.style_cats ?? [],
        surf_cats: f.surf_cats ?? [],
        is_debuff: f.is_debuff ?? false,
        skill_category: f.skill_category,
        is_last_spurt: f.is_last_spurt ?? false,
        relevance: skillRelevance?.get(fid),
      });
    }
  }
}

// ─── Per-uma scoring ───────────────────────────────────────────────────────────

function scoreUma(
  uma: RawUma,
  config: ClassifierConfig,
  skillRelevance?: Map<number, number>
): ScoredUma {
  const scores: CategoryScores = {};
  const whiteTotal  = { value: 0 };
  const debuffScore = { value: 0 };
  const pinkStars   = new Map<string, number>();
  const factors: FactorContribution[] = [];

  const directParents = uma.succession_chara_array.filter(
    p => isDirectParent(p.position_id)
  );

  // Pass 1: collect pink stars for multiplier calculation
  collectPinks(uma.factor_id_array, pinkStars);
  for (const p of directParents) collectPinks(p.factor_id_array, pinkStars);

  // Pass 2: score everything
  scoreFactors(uma.factor_id_array, config.weights.own, 'own',
    scores, whiteTotal, debuffScore, pinkStars, factors, config, skillRelevance);

  for (const p of directParents) {
    scoreFactors(p.factor_id_array, config.weights.parent, 'parent',
      scores, whiteTotal, debuffScore, pinkStars, factors, config, skillRelevance);
  }

  return {
    trained_chara_id: uma.trained_chara_id,
    card_id: uma.card_id,
    rank_score: uma.rank_score,
    is_locked: uma.is_locked === 1,
    scores,
    white_total: whiteTotal.value,
    debuff_score: debuffScore.value,
    race_score: 0,
    factors,
    assigned_icon: null,
  };
}

// ─── Heart assignment ──────────────────────────────────────────────────────────

function assignHearts(
  scored: ScoredUma[],
  assigned: Map<number, Icon>,
  config: ClassifierConfig
): void {
  const candidates = scored
    .filter(u => !assigned.has(u.trained_chara_id) && u.white_total >= config.heartWhiteThreshold)
    .sort((a, b) => b.white_total - a.white_total);

  const coveredSkills = new Map<string, number>();
  let heartCount = 0;
  const UPGRADE_THRESHOLD = 1.5;
  const MIN_SKILL_VALUE = 1.0;

  for (const uma of candidates) {
    if (heartCount >= config.keepHeart) break;

    const umaSkills = new Map<string, number>();
    for (const f of uma.factors) {
      if (f.type !== 'white') continue;
      const val = f.final_value ?? 0;
      const existing = umaSkills.get(f.name) ?? 0;
      if (val > existing) umaSkills.set(f.name, val);
    }

    let hasNew = false;
    for (const [name, value] of umaSkills) {
      if (value < MIN_SKILL_VALUE) continue;
      const bestSeen = coveredSkills.get(name) ?? 0;
      if (bestSeen === 0 || value > bestSeen * UPGRADE_THRESHOLD) {
        hasNew = true;
        break;
      }
    }

    if (hasNew) {
      for (const [name, value] of umaSkills) {
        const bestSeen = coveredSkills.get(name) ?? 0;
        if (value > bestSeen) coveredSkills.set(name, value);
      }
      assigned.set(uma.trained_chara_id, 'heart');
      heartCount++;
    }
  }
}

// ─── Main classifier ───────────────────────────────────────────────────────────

export function classifyRoster(
  umas: RawUma[],
  config: ClassifierConfig,
  skillRelevance?: Map<number, number>
): ScoredUma[] {
  const { keepPerCategory, minCategoryScore, aceScoreThreshold } = config;

  const scored = umas.map(uma => scoreUma(uma, config, skillRelevance));

  // Compute race scores
  if (skillRelevance) {
    for (const uma of scored) {
      uma.race_score = uma.factors
        .filter(f => f.type === 'white')
        .reduce((sum, f) => sum + (f.final_value ?? 0) * (f.relevance ?? 0), 0);
    }
  }

  const assigned = new Map<number, Icon>();

  // Top-N per icon category
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

  // Hearts
  assignHearts(scored, assigned, config);

  // Ace
  const aceCandidates = scored
    .filter(u => !assigned.has(u.trained_chara_id) && u.rank_score >= aceScoreThreshold)
    .sort((a, b) => b.rank_score - a.rank_score)
    .slice(0, config.keepAce);
  for (const uma of aceCandidates) assigned.set(uma.trained_chara_id, 'ace');

  // Debuff
  const debuffCandidates = scored
    .filter(u => !assigned.has(u.trained_chara_id) && u.debuff_score > 0)
    .sort((a, b) => b.debuff_score - a.debuff_score)
    .slice(0, config.keepPerCategory);
  for (const uma of debuffCandidates) assigned.set(uma.trained_chara_id, 'clubs');

  // Trash
  for (const uma of scored) {
    uma.assigned_icon = assigned.get(uma.trained_chara_id) ?? 'trash';
  }

  return scored;
}