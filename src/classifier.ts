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

export function whiteToCategory(f: FactorEntry): string | null {
  if (f.is_debuff) return 'debuff';
  switch (f.skill_category) {
    case 'Speed Boost': return f.is_last_spurt ? 'guts' : 'speed';
    case 'Acceleration': return 'power';
    case 'Recovery': return 'stamina';
    case 'Lane Effect':
    case 'Vision': return 'wit';
    case 'Debuff': return 'debuff';
    default: return null;
  }
}

// ─── Pink Multiplier ──────────────────────────────────────────────────────

function pinkMultiplier(
  f: FactorEntry,
  pinkStars: Map<string, number>
): number {
  const cats = [
    ...(f.style_cats ?? []),
    ...(f.dist_cats ?? []),
    ...(f.surf_cats ?? []),
  ];
  if (cats.length === 0) return 1.0;
  const matching = cats.reduce((sum, cat) => sum + (pinkStars.get(cat) ?? 0), 0);
  return 1 + matching / 6;
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
  whiteOverlap: Map<string, number>,
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
        factors.push({
          factor_id: fid,
          name: f.name,
          stars: f.stars,
          type: 'pink',
          source,
          category: f.category,
          contribution,
        });
      } else if (STYLE_PINKS.has(f.category)) {
        // Style pinks — display only, no score contribution
        factors.push({
          factor_id: fid,
          name: f.name,
          stars: f.stars,
          type: 'pink',
          source,
          category: f.category,
          contribution: 0,
        });
      }

    } else if (f.type === 'white') {
      const pm = pinkMultiplier(f, pinkStars);
      const sb = specialBonus(fid, pinkStars);

      // Rarity bonus: 3★ whites signal a good run, 1★ are common
      const rarityBonus = f.stars === 3 ? 1.3 : f.stars === 2 ? 1.0 : 0.8;

      // Lineage overlap bonus: exponential per the guide (×1.1^N)
      const overlap = whiteOverlap.get(f.name) ?? 1;
      const overlapBonus = Math.pow(1.1, overlap - 1); // -1 so single instance = 1.0x

      const weighted = f.stars * weight * pm * sb * rarityBonus * overlapBonus;
      const display = f.stars * pm * sb * rarityBonus * overlapBonus;

      whiteTotal.value += weighted;

      const cat = whiteToCategory(f);
      let contribution = 0;

      // Display-only skill type scores (don't drive icon assignment)
      if (f.skill_category) {
        const typeKey = f.is_last_spurt ? 'spurt'
          : f.skill_category === 'Speed Boost' ? 'tSpd'
          : f.skill_category === 'Acceleration' ? 'accel'
          : f.skill_category === 'Recovery' ? 'hp'
          : f.skill_category === 'Lane Effect' ? 'nav'
          : f.skill_category === 'Vision' ? 'nav'
          : null;
        if (typeKey) {
          scores[typeKey] = (scores[typeKey] ?? 0) + weighted;
        }
      }

      if (cat === 'debuff') {
        debuffScore.value += f.stars * weight;
      }

      let statBoostContribution: number | undefined;
      if (f.stat_boost) {
        statBoostContribution = weighted * config.whiteStatBoostMultiplier;
        scores[f.stat_boost] = (scores[f.stat_boost] ?? 0) + statBoostContribution;
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
        stat_boost: f.stat_boost ?? undefined,
        stat_boost_contribution: statBoostContribution,
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

  // Pre-build white overlap counts for lineage bonus
  const whiteOverlap = new Map<string, number>();
  const allFactorIds = [
    ...uma.factor_id_array,
    ...directParents.flatMap(p => p.factor_id_array),
  ];
  for (const fid of allFactorIds) {
    const f = lookupFactor(fid);
    if (f?.type === 'white') {
      whiteOverlap.set(f.name, (whiteOverlap.get(f.name) ?? 0) + 1);
    }
  }

  // Pass 2: score everything
  scoreFactors(uma.factor_id_array, config.weights.own, 'own',
    scores, whiteTotal, debuffScore, pinkStars, factors, config, whiteOverlap, skillRelevance);

  for (const p of directParents) {
    scoreFactors(p.factor_id_array, config.weights.parent, 'parent',
      scores, whiteTotal, debuffScore, pinkStars, factors, config, whiteOverlap, skillRelevance);
  }

  // Dominant style: highest star-count style pink across own + parents
  const styleTotals = new Map<string, number>();
  for (const f of factors) {
    if (f.type === 'pink' && STYLE_PINKS.has(f.category)) {
      styleTotals.set(f.category, (styleTotals.get(f.category) ?? 0) + f.stars);
    }
  }
  if (styleTotals.size > 0) {
    const [dominantStyle, styleScore] = [...styleTotals.entries()]
      .sort((a, b) => b[1] - a[1])[0];
    scores[`style:${dominantStyle}`] = styleScore;
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
    assigned_icon: null
  };
}

// ─── Overall Score for Transfer Candidates ──────────────────────────────────────────────────────────

function overallScore(uma: ScoredUma): number {
  const blueScore = ['speed', 'stamina', 'power', 'guts', 'wit']
    .reduce((sum, cat) => sum + (uma.scores[cat] ?? 0), 0);
  const pinkScore = ['turf', 'dirt', 'sprint', 'mile', 'mid', 'long']
    .reduce((sum, cat) => sum + (uma.scores[cat] ?? 0), 0);
  const whiteScore = uma.white_total;
  return (blueScore * 0.6) + (pinkScore * 0.8) + (whiteScore * 1.5);
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
  const unassigned = scored
    .filter(u => !assigned.has(u.trained_chara_id))
    .sort((a, b) => overallScore(a) - overallScore(b));

  for (let i = 0; i < Math.min(config.numTrash, unassigned.length); i++) {
    assigned.set(unassigned[i].trained_chara_id, 'trash');
  }

    // Final assignment — null means unlisted (has some value, not trash)
  for (const uma of scored) {
    uma.assigned_icon = assigned.get(uma.trained_chara_id) ?? 'skip';
  }

  return scored;
}