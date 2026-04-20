import { lookupFactor } from './loader.ts';
import type { FactorEntry } from './loader.ts';
import type {
  RawUma,
  ScoredUma,
  CategoryScores,
  Icon,
  ClassifierConfig,
} from './types.ts';

// ─── Constants ─────────────────────────────────────────────────────────────────

const GROUNDWORK_ID_BASE     = 201601;
const TAIL_HELD_HIGH_ID_BASE = 201611;

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
  // Strip rarity suffix to get base ID (last digit = rarity 1-3)
  const base = factor_id - (factor_id % 10) + 1;
  if (base === GROUNDWORK_ID_BASE) {
    return (pinkStars.get('front') ?? 0) > 0 ? 2.0 : 1.5;
  }
  if (base === TAIL_HELD_HIGH_ID_BASE) {
    return 1.5;
  }
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
  if (cats.length === 0) return 1.0; // generic — no penalty or bonus
  const matching = cats.reduce((sum, cat) => sum + (pinkStars.get(cat) ?? 0), 0);
  return 1 + matching / 6; // range: 1.0 (no pinks) to 2.5 (9 matching stars)
}

function whiteValue(
  f: FactorEntry,
  factor_id: number,
  weight: number,
  pinkStars: Map<string, number>
): number {
  return f.stars * weight * pinkMultiplier(f, pinkStars) * specialBonus(factor_id, pinkStars);
}

// ─── First pass: collect pink stars ────────────────────────────────────────────

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

// ─── Second pass: score blues ──────────────────────────────────────────────────

function scoreBlues(
  factor_ids: number[],
  weight: number,
  scores: CategoryScores
): void {
  for (const fid of factor_ids) {
    const f = lookupFactor(fid);
    if (!f || f.type !== 'blue' || !f.category) continue;
    scores[f.category] = (scores[f.category] ?? 0) + f.stars * weight;
  }
}

// ─── Second pass: score aptitude pinks ────────────────────────────────────────

function scoreAptitudePinks(
  factor_ids: number[],
  weight: number,
  scores: CategoryScores
): void {
  for (const fid of factor_ids) {
    const f = lookupFactor(fid);
    if (!f || f.type !== 'pink' || !f.category) continue;
    if (!APTITUDE_PINKS.has(f.category)) continue; // skip style pinks
    scores[f.category] = (scores[f.category] ?? 0) + f.stars * weight;
  }
}

// ─── Second pass: score whites ────────────────────────────────────────────────

function scoreWhites(
  factor_ids: number[],
  weight: number,
  scores: CategoryScores,
  whiteTotal: { value: number },
  debuffScore: { value: number },
  pinkStars: Map<string, number>,
  config: ClassifierConfig
): void {
  for (const fid of factor_ids) {
    const f = lookupFactor(fid);
    if (!f || f.type !== 'white') continue;

    const value = whiteValue(f, fid, weight, pinkStars);
    whiteTotal.value += value;

    if (f.is_debuff) {
      debuffScore.value += f.stars * weight;
    }

    if (f.stat_boost) {
      scores[f.stat_boost] = (scores[f.stat_boost] ?? 0) +
        value * config.whiteStatBoostMultiplier;
    }

    for (const cat of (f.dist_cats ?? [])) {
      scores[cat] = (scores[cat] ?? 0) + value * config.whiteSkillMultiplier;
    }
    for (const cat of (f.surf_cats ?? [])) {
      scores[cat] = (scores[cat] ?? 0) + value * config.whiteSkillMultiplier;
    }
  }
}

// ─── Per-uma scoring ───────────────────────────────────────────────────────────

function scoreUma(uma: RawUma, config: ClassifierConfig): ScoredUma {
  const scores: CategoryScores = {};
  const whiteTotal  = { value: 0 };
  const debuffScore = { value: 0 };
  const pinkStars   = new Map<string, number>();

  const directParents = uma.succession_chara_array.filter(
    p => isDirectParent(p.position_id)
  );

  // Pass 1: collect all pink stars (own + parents) for multiplier calculation
  collectPinks(uma.factor_id_array, pinkStars);
  for (const p of directParents) collectPinks(p.factor_id_array, pinkStars);

  // Pass 2: score blues, aptitude pinks, and whites
  scoreBlues(uma.factor_id_array, config.weights.own, scores);
  scoreAptitudePinks(uma.factor_id_array, config.weights.own, scores);
  scoreWhites(uma.factor_id_array, config.weights.own, scores, whiteTotal, debuffScore, pinkStars, config);

  for (const p of directParents) {
    scoreBlues(p.factor_id_array, config.weights.parent, scores);
    scoreAptitudePinks(p.factor_id_array, config.weights.parent, scores);
    scoreWhites(p.factor_id_array, config.weights.parent, scores, whiteTotal, debuffScore, pinkStars, config);
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
}

// ─── Heart assignment ──────────────────────────────────────────────────────────

function assignHearts(
  scored: ScoredUma[],
  umas: RawUma[],
  assigned: Map<number, Icon>,
  config: ClassifierConfig
): void {
  const rawByTrainedId = new Map(umas.map(u => [u.trained_chara_id, u]));

  const candidates = scored
    .filter(u => !assigned.has(u.trained_chara_id) && u.white_total >= config.heartWhiteThreshold)
    .sort((a, b) => b.white_total - a.white_total);

  const coveredSkills = new Set<string>();
  let heartCount = 0;

  for (const uma of candidates) {
    if (heartCount >= config.keepHeart) break;

    const raw = rawByTrainedId.get(uma.trained_chara_id)!;
    const umaSkills = new Set<string>();

    for (const fid of raw.factor_id_array) {
      const f = lookupFactor(fid);
      if (f?.type === 'white') umaSkills.add(f.name);
    }
    for (const p of raw.succession_chara_array) {
      if (!isDirectParent(p.position_id)) continue;
      for (const fid of p.factor_id_array) {
        const f = lookupFactor(fid);
        if (f?.type === 'white') umaSkills.add(f.name);
      }
    }

    const hasNew = [...umaSkills].some(s => !coveredSkills.has(s));
    if (hasNew) {
      for (const s of umaSkills) coveredSkills.add(s);
      assigned.set(uma.trained_chara_id, 'heart');
      heartCount++;
    }
  }
}

// ─── Main classifier ───────────────────────────────────────────────────────────

export function classifyRoster(umas: RawUma[], config: ClassifierConfig): ScoredUma[] {
  const { keepPerCategory, minCategoryScore, aceScoreThreshold } = config;

  const scored = umas.map(uma => scoreUma(uma, config));
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
  assignHearts(scored, umas, assigned, config);

  // Ace
  const aceCandidates = scored
    .filter(u => !assigned.has(u.trained_chara_id) && u.rank_score >= aceScoreThreshold)
    .sort((a, b) => b.rank_score - a.rank_score)
    .slice(0, config.keepAce);

  for (const uma of aceCandidates) {
    assigned.set(uma.trained_chara_id, 'ace');
  }

  // Debuff
  const debuffCandidates = scored
    .filter(u => !assigned.has(u.trained_chara_id) && u.debuff_score > 0)
    .sort((a, b) => b.debuff_score - a.debuff_score)
    .slice(0, config.keepPerCategory);

  for (const uma of debuffCandidates) {
    assigned.set(uma.trained_chara_id, 'clubs');
  }

  // Trash
  for (const uma of scored) {
    uma.assigned_icon = assigned.get(uma.trained_chara_id) ?? 'trash';
  }

  return scored;
}