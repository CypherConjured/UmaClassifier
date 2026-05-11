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

const APTITUDE_PINKS = new Set(['turf', 'dirt', 'sprint', 'mile', 'mid', 'long']);
const STYLE_PINKS = new Set(['front', 'pace', 'late', 'end']);
const ALL_PINKS = new Set([...APTITUDE_PINKS, ...STYLE_PINKS]);

const ICON_CATEGORIES: Icon[] = [
  'dirt', 'sprint', 'mile', 'mid', 'long',
];

// ─── Helpers ───────────────────────────────────────────────────────────────────

function isDirectParent(position_id: number): boolean {
  return position_id === 10 || position_id === 20;
}

function specialBonus(
  factor_id: number,
  config: ClassifierConfig
): number {
  const base = Math.floor(factor_id / 10) * 10 + 1;
  return config.skillBonuses[base] ?? 1.0;
}

function determineDominantStyle(
  ownFactorIds: number[],
  parentFactorIds: number[][]
): string | null {
  const ownTotals = new Map<string, number>();
  const parentTotals = new Map<string, number>();

  for (const fid of ownFactorIds) {
    const f = lookupFactor(fid);
    if (!f || f.type !== 'pink' || !f.category) continue;
    if (!STYLE_PINKS.has(f.category)) continue;
    ownTotals.set(f.category, (ownTotals.get(f.category) ?? 0) + f.stars);
  }

  if (ownTotals.size > 0) {
    return [...ownTotals.entries()].sort((a, b) => b[1] - a[1])[0][0];
  }

  for (const ids of parentFactorIds) {
    for (const fid of ids) {
      const f = lookupFactor(fid);
      if (!f || f.type !== 'pink' || !f.category) continue;
      if (!STYLE_PINKS.has(f.category)) continue;
      parentTotals.set(f.category, (parentTotals.get(f.category) ?? 0) + f.stars);
    }
  }

  if (parentTotals.size > 0) {
    return [...parentTotals.entries()].sort((a, b) => b[1] - a[1])[0][0];
  }

  return null;
}

// ─── Pink Multiplier ──────────────────────────────────────────────────────

// White skills that are tagged for specific distances/surfaces/styles are amplified
// by how many matching pink stars the uma has. Each pink star in a matching category
// adds 1/6 to the multiplier, so 6 matching stars → 2× amplification.
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
  const matchingStars = cats.reduce((sum, cat) => sum + (pinkStars.get(cat) ?? 0), 0);
  return 1 + matchingStars / 6;
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

// Blues score equally across all distance categories (stat boosts help everywhere).
// Aptitude pinks score fully for their matching category and partially (PARTIAL_MULT)
// for all others — a turf uma is still somewhat useful on dirt, just not as much.
// Dirt is treated as a distance category here; turf maps to all non-dirt distances.
// Style pinks only score if the uma's dominant running style matches — non-dominant
// style pinks are tracked for display but contribute 0.
function scoreBluesAndPinks(
  factor_ids: number[],
  weight: number,
  source: 'own' | 'parent',
  scores: CategoryScores,
  factors: FactorContribution[],
  config: ClassifierConfig,
  dominantStyle: string | null
): void {
  const BLUE_RARITY_OWN: Record<number, number>   = { 3: 3.0, 2: 1.0, 1: -0.5 };
  const PINK_RARITY_OWN: Record<number, number>   = { 3: 3.0, 2: 1.0, 1: -0.5 };
  const PINK_RARITY_PARENT: Record<number, number> = { 3: 1.0, 2: 0.6, 1: 0.2 };
  const PARTIAL_MULT = 0.2; // partial credit for off-category aptitude pinks

  for (const fid of factor_ids) {
    const f = lookupFactor(fid);
    if (!f) continue;

    if (f.type === 'blue' && f.category) {
      const rarityMult = source === 'own'
        ? (BLUE_RARITY_OWN[f.stars] ?? 0)
        : Math.max(f.stars * 0.5, 0);
      const contribution = rarityMult * weight;

      for (const icon of ICON_CATEGORIES) {
        scores[icon] = (scores[icon] ?? 0) + contribution;
      }

      factors.push({
        factor_id: fid, name: f.name, stars: f.stars,
        type: 'blue', source, category: f.category, contribution,
      });

    } else if (f.type === 'pink' && f.category) {
      if (APTITUDE_PINKS.has(f.category)) {
        const rarityMult = source === 'own'
          ? (PINK_RARITY_OWN[f.stars] ?? 0)
          : (PINK_RARITY_PARENT[f.stars] ?? 0);

        for (const icon of ICON_CATEGORIES) {
          // Turf aptitude benefits all non-dirt categories; dirt only benefits dirt.
          // Distance aptitudes match their exact category.
          let catMult = PARTIAL_MULT;
          if (f.category === 'turf' && icon !== 'dirt') catMult = 1.0;
          else if (f.category === 'dirt' && icon === 'dirt') catMult = 1.0;
          else if (f.category === icon) catMult = 1.0;

          scores[icon] = (scores[icon] ?? 0) + rarityMult * weight * catMult;
        }

        factors.push({
          factor_id: fid, name: f.name, stars: f.stars,
          type: 'pink', source, category: f.category,
          contribution: rarityMult * weight,
        });

      } else if (STYLE_PINKS.has(f.category)) {
        const isDominant = f.category === dominantStyle;
        let contribution = 0;

        if (isDominant) {
          // Dominant style pinks use the same rarity table as aptitude pinks and
          // contribute equally to all distance categories.
          const rarityMult = source === 'own'
            ? (PINK_RARITY_OWN[f.stars] ?? 0)
            : (PINK_RARITY_PARENT[f.stars] ?? 0);

          contribution = rarityMult * weight;
          for (const icon of ICON_CATEGORIES) {
            scores[icon] = (scores[icon] ?? 0) + contribution;
          }
        }

        factors.push({
          factor_id: fid, name: f.name, stars: f.stars,
          type: 'pink', source, category: f.category,
          contribution,
          secondary_category: isDominant ? 'dominant' : undefined,
        });
      }
    }
  }
}

// White and unique skill factors are scored with a composite multiplier:
//   baseContrib = stars × weight × pinkMult × specialMult × rarityBonus × overlapBonus × uniqueMult
//
// pinkMult    — amplifies skills whose activation tags match the uma's pink aptitudes
// specialMult — extra weight for specific high-value skills (e.g. Groundwork, Tail Held High)
// rarityBonus — 3★=1.2, 2★=0.8, 1★=0.6 (on top of the star count already in the formula)
// overlapBonus— 10% bonus per extra copy of the same white skill across own+parents (stacks)
// uniqueMult  — 1.2× for character-unique skills (type 3) vs regular white hints (type 4/5)
//
// baseContrib is then multiplied per distance category by a catMult (0 or 1) that reflects
// whether the skill's dist/surf/style tags match that category.
// Debuff skills bypass all of this and accumulate into debuff_score directly.
function scoreGreensAndWhites(
  factor_ids: number[],
  weight: number,
  source: 'own' | 'parent',
  scores: CategoryScores,
  whiteTotal: { value: number },
  debuffScore: { value: number },
  pinkStars: Map<string, number>,
  whiteOverlap: Map<string, number>,
  factors: FactorContribution[],
  config: ClassifierConfig,
  dominantStyle: string | null,
  skillRelevance?: Map<number, number>
): void {
  const STYLE_MISMATCH = 0.0;
  const UNIQUE_MULTIPLIER = 1.2;

  for (const fid of factor_ids) {
    const f = lookupFactor(fid);
    if (!f || (f.type !== 'white' && f.type !== 'unique')) continue;

    const uniqueMult  = f.type === 'unique' ? UNIQUE_MULTIPLIER : 1.0;
    const pinkMult    = pinkMultiplier(f, pinkStars);
    const specialMult = specialBonus(fid, config);
    const rarityBonus = f.stars === 3 ? 1.2 : f.stars === 2 ? 0.8 : 0.6;
    const overlap     = whiteOverlap.get(f.name) ?? 1;
    const overlapBonus = Math.pow(1.1, overlap - 1);

    const baseContrib = f.stars * weight * pinkMult * specialMult * rarityBonus * overlapBonus * uniqueMult;

    if (f.is_debuff) {
      debuffScore.value += f.stars * weight;
    } else {
      whiteTotal.value += baseContrib;
    }

    // Skill-type subscores for display breakdown (not used in category assignment)
    if (f.skill_category) {
      const typeKey = f.is_last_spurt ? 'spurt'
        : f.skill_category === 'Speed Boost' ? 'tSpd'
          : f.skill_category === 'Acceleration' ? 'accel'
          : f.skill_category === 'Recovery'     ? 'hp'
          : f.skill_category === 'Lane Effect'  ? 'nav'
          : f.skill_category === 'Vision'       ? 'nav'
          : null;
      if (typeKey) scores[typeKey] = (scores[typeKey] ?? 0) + baseContrib;
    }

    // Type-5 hybrid factors give both a skill hint and a stat boost.
    let statBoostContribution: number | undefined;
    if (f.stat_boost) {
      statBoostContribution = baseContrib * config.whiteStatBoostMultiplier;
      scores[f.stat_boost] = (scores[f.stat_boost] ?? 0) + statBoostContribution;
    }

    // Determine how much baseContrib applies to each distance category.
    // Generic skills (no tags) apply to everything. Tagged skills get full credit
    // only for matching categories; dist takes priority over surf, and style gates
    // the result when present.
    const hasDist  = (f.dist_cats  ?? []).length > 0;
    const hasSurf  = (f.surf_cats  ?? []).length > 0;
    const hasStyle = (f.style_cats ?? []).length > 0;
    const isGeneric = !hasDist && !hasSurf && !hasStyle;

    // Pre-compute style gate so we don't repeat it inside the icon loop
    const styleGateOpen = !hasStyle
      || (dominantStyle != null && (f.style_cats ?? []).includes(dominantStyle));
    const catStyleMult = styleGateOpen ? 1.0 : STYLE_MISMATCH;

    for (const icon of ICON_CATEGORIES) {
      let catMult = 0;

      if (isGeneric) {
        catMult = 1.0; // no tags → universally useful
      } else {
        // Dirt uses mile distance skills as a proxy (no dirt-specific distance tag exists)
        if (hasDist) {
          const distMatch = icon !== 'dirt' && (f.dist_cats ?? []).includes(icon);
          const dirtMatch = icon === 'dirt'  && (f.dist_cats ?? []).includes('mile');
          catMult = (distMatch || dirtMatch) ? 1.0 : 0;
        }

        // Surface match fills in when no distance tag matched
        if (hasSurf && catMult === 0) {
          const surfMatch = icon === 'dirt'
            ? (f.surf_cats ?? []).includes('dirt')
            : (f.surf_cats ?? []).includes('turf');
          catMult = surfMatch ? 1.0 : 0;
        }

        // Style gate: zeroes out any catMult when style doesn't match dominant
        if (hasStyle && catMult > 0) {
          catMult *= catStyleMult;
        } else if (hasStyle && !hasDist && !hasSurf) {
          catMult = catStyleMult; // style-only tag
        }
      }

      if (catMult > 0) {
        scores[icon] = (scores[icon] ?? 0) + baseContrib * catMult;
      }
    }

    factors.push({
      factor_id: fid, name: f.name, stars: f.stars,
      type: f.type, source,
      category: f.type,
      contribution: baseContrib,
      pink_multiplier: pinkMult, special_bonus: specialMult,
      style_mult: catStyleMult,
      stat_boost: f.stat_boost ?? undefined,
      stat_boost_contribution: statBoostContribution,
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

// ─── Per-uma scoring ───────────────────────────────────────────────────────────

// Scores a single uma in three passes:
//   Pass 1 — collect pink star totals (needed as multipliers in pass 3)
//             and white skill overlap counts (duplicate white skills stack a 10% bonus each)
//   Pass 2 — score blues (flat bonus to all categories) and pinks (targeted by aptitude/style)
//   Pass 3 — score white/unique skills (uses pink totals from pass 1)
//
// Only direct parents (position_id 10 or 20) contribute; grandparents are ignored.
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

  // Dominant style gates style-pink scoring and style-tagged white skill scoring.
  // Own style pinks take precedence over parents' style pinks.
  const dominantStyle = determineDominantStyle(
    uma.factor_id_array,
    directParents.map(p => p.factor_id_array)
  );

  // Pass 1: collect pink stars for the white-skill pink multiplier
  collectPinks(uma.factor_id_array, pinkStars);
  for (const parent of directParents) collectPinks(parent.factor_id_array, pinkStars);

  // Pass 1b: count how many times each white skill name appears (own + parents)
  // so duplicate copies can receive a stacking overlap bonus in pass 3
  const whiteOverlap = new Map<string, number>();
  const allFactorIds = [
    ...uma.factor_id_array,
    ...directParents.flatMap(parent => parent.factor_id_array),
  ];
  for (const fid of allFactorIds) {
    const f = lookupFactor(fid);
    if (f?.type === 'white') {
      whiteOverlap.set(f.name, (whiteOverlap.get(f.name) ?? 0) + 1);
    }
  }

  // Pass 2: score blues and pinks
  scoreBluesAndPinks(uma.factor_id_array, config.weights.own, 'own',
    scores, factors, config, dominantStyle);
  for (const parent of directParents) {
    scoreBluesAndPinks(parent.factor_id_array, config.weights.parent, 'parent',
      scores, factors, config, dominantStyle);
  }

  // Pass 3: score white/unique skills (requires pinkStars and dominantStyle from above)
  scoreGreensAndWhites(uma.factor_id_array, config.weights.own, 'own',
    scores, whiteTotal, debuffScore, pinkStars, whiteOverlap,
    factors, config, dominantStyle, skillRelevance);
  for (const parent of directParents) {
    scoreGreensAndWhites(parent.factor_id_array, config.weights.parent, 'parent',
      scores, whiteTotal, debuffScore, pinkStars, whiteOverlap,
      factors, config, dominantStyle, skillRelevance);
  }

  // Build category_factors map
  const category_factors: Record<string, FactorContribution[]> = {};
  for (const f of factors) {
    if (f.contribution > 0) {
      if (!category_factors[f.category]) category_factors[f.category] = [];
      category_factors[f.category].push(f);
    }
    if (f.stat_boost_contribution && f.stat_boost) {
      if (!category_factors[f.stat_boost]) category_factors[f.stat_boost] = [];
      category_factors[f.stat_boost].push(f);
    }
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
    category_factors,
    assigned_icon: null,
  };
}
// ─── Overall Score for Transfer Candidates ──────────────────────────────────────────────────────────

function overallScore(uma: ScoredUma): number {
  const distScore = ICON_CATEGORIES
    .reduce((sum, cat) => sum + (uma.scores[cat] ?? 0), 0);
  return distScore + uma.white_total * 1.5;
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
      const val = f.contribution ?? 0;
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
        .reduce((sum, f) => sum + (f.contribution ?? 0) * (f.relevance ?? 0), 0);
    }
  }

  const assigned = new Map<number, Icon>();

  // Debuffers first
  const debuffCandidates = scored
    .filter(u => !assigned.has(u.trained_chara_id) && u.debuff_score > 0)
    .sort((a, b) => b.debuff_score - a.debuff_score)
    .slice(0, config.keepPerCategory);
  for (const uma of debuffCandidates) assigned.set(uma.trained_chara_id, 'clubs');

  // Build preference lists for each uma (categories sorted by score descending)
  const preferences = new Map<number, Icon[]>();
  for (const uma of scored) {
    const ranked = ICON_CATEGORIES
      .filter(icon => (uma.scores[icon] ?? 0) >= minCategoryScore)
      .sort((a, b) => (uma.scores[b] ?? 0) - (uma.scores[a] ?? 0));
    preferences.set(uma.trained_chara_id, ranked);
  }

  // Track how many umas have been assigned to each category (capped at keepPerCategory)
  const categoryCounts = new Map<Icon, number>();
  for (const icon of ICON_CATEGORIES) categoryCounts.set(icon, 0);

  // Preference matching: each round processes all still-unassigned umas in order of
  // their score in their current top preference. The highest-scoring uma claims a slot
  // first, then lower-scoring umas follow. If a category is full, an uma skips it and
  // tries its next preference in the following round. This repeats until no uma can be
  // placed. The result is roughly "best uma gets their first choice; others compete for
  // what's left."
  const prefCursor = new Map<number, number>(); // trained_chara_id → index into preference list
  for (const uma of scored) prefCursor.set(uma.trained_chara_id, 0);

  let anyAssigned = true;
  while (anyAssigned) {
    anyAssigned = false;

    // Process in descending order of each uma's score for their current top preference,
    // so stronger candidates win contested slots before weaker ones even try.
    const roundPool = scored
      .filter(u => !assigned.has(u.trained_chara_id))
      .sort((a, b) => {
        const aPrefs = preferences.get(a.trained_chara_id) ?? [];
        const bPrefs = preferences.get(b.trained_chara_id) ?? [];
        const aIcon  = aPrefs[prefCursor.get(a.trained_chara_id) ?? 0];
        const bIcon  = bPrefs[prefCursor.get(b.trained_chara_id) ?? 0];
        const aScore = aIcon ? (a.scores[aIcon] ?? 0) : 0;
        const bScore = bIcon ? (b.scores[bIcon] ?? 0) : 0;
        return bScore - aScore;
      });

    for (const uma of roundPool) {
      const prefs = preferences.get(uma.trained_chara_id) ?? [];
      let cursor = prefCursor.get(uma.trained_chara_id) ?? 0;

      // Advance past any categories that are already full
      while (cursor < prefs.length && (categoryCounts.get(prefs[cursor]) ?? 0) >= keepPerCategory) {
        cursor++;
      }
      prefCursor.set(uma.trained_chara_id, cursor);

      if (cursor >= prefs.length) continue; // all preferred categories are full

      const icon = prefs[cursor];
      assigned.set(uma.trained_chara_id, icon);
      categoryCounts.set(icon, (categoryCounts.get(icon) ?? 0) + 1);
      anyAssigned = true;
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

  // Trash — lowest overall-scoring umas that still haven't been placed
  const trashCandidates = scored
    .filter(u => !assigned.has(u.trained_chara_id))
    .sort((a, b) => overallScore(a) - overallScore(b));

  for (let i = 0; i < Math.min(config.numTrash, trashCandidates.length); i++) {
    assigned.set(trashCandidates[i].trained_chara_id, 'trash');
  }

  // Final assignment — null means unlisted (not great, but not bad enough to trash)
  for (const uma of scored) {
    uma.assigned_icon = assigned.get(uma.trained_chara_id) ?? 'skip';
  }

  return scored;
}