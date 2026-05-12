import { lookupFactor } from './loader.ts';
import type { FactorEntry } from './loader.ts';
import type {
  RawUma,
  ScoredUma,
  FactorContribution,
  CategoryScores,
  ArchetypeVector,
  ArchetypeLabel,
  Icon,
  ClassifierConfig,
} from './types.ts';

// ─── Constants ─────────────────────────────────────────────────────────────────

const SURFACE_CATS  = ['turf', 'dirt']                 as const;
const DISTANCE_CATS = ['sprint', 'mile', 'mid', 'long'] as const;
const STYLE_CATS    = ['front', 'pace', 'late', 'end']  as const;

const SURFACE_SET  = new Set<string>(SURFACE_CATS);
const DISTANCE_SET = new Set<string>(DISTANCE_CATS);
const STYLE_SET    = new Set<string>(STYLE_CATS);
const ALL_PINK_SET = new Set<string>([...SURFACE_CATS, ...DISTANCE_CATS, ...STYLE_CATS]);

const ICON_CATEGORIES: Icon[] = ['dirt', 'sprint', 'mile', 'mid', 'long'];

const DIRT_DOUBLE = 2;

// ─── Helpers ───────────────────────────────────────────────────────────────────

function isDirectParent(position_id: number): boolean {
  return position_id === 10 || position_id === 20;
}

function specialBonus(factor_id: number, config: ClassifierConfig): number {
  const base = Math.floor(factor_id / 10) * 10 + 1;
  return config.skillBonuses[base] ?? 1.0;
}

// ─── Archetype Vector ──────────────────────────────────────────────────────────

// Computes the effective star vector for a single set of factor_ids (one "unit" —
// the uma itself, or one of its direct parents). Dirt contributions are doubled
// before the formula runs. Generic white skills (no dist/surf/style tags) are
// excluded from both numerator and denominator so they don't dilute category fractions.
//
// effective_stars(cat) = pink_stars(cat) + (white_stars_in_cat / white_stars_total) × 6
function computeUnitVector(factor_ids: number[]): ArchetypeVector {
  const pinkSurface:  Record<string, number> = {};
  const pinkDist:     Record<string, number> = {};
  const pinkStyle:    Record<string, number> = {};

  const whiteSurface: Record<string, number> = {};
  const whiteDist:    Record<string, number> = {};
  const whiteStyle:   Record<string, number> = {};
  let whiteTotal = 0;

  for (const fid of factor_ids) {
    const f = lookupFactor(fid);
    if (!f) continue;

    if (f.type === 'pink' && f.category) {
      if (SURFACE_SET.has(f.category)) {
        const stars = f.category === 'dirt' ? f.stars * DIRT_DOUBLE : f.stars;
        pinkSurface[f.category] = (pinkSurface[f.category] ?? 0) + stars;
      } else if (DISTANCE_SET.has(f.category)) {
        pinkDist[f.category] = (pinkDist[f.category] ?? 0) + f.stars;
      } else if (STYLE_SET.has(f.category)) {
        pinkStyle[f.category] = (pinkStyle[f.category] ?? 0) + f.stars;
      }

    } else if (f.type === 'white' || f.type === 'unique') {
      for (const cat of (f.surf_cats ?? [])) {
        const s = cat === 'dirt' ? f.stars * DIRT_DOUBLE : f.stars;
        whiteSurface[cat] = (whiteSurface[cat] ?? 0) + s;
        whiteTotal += s;
      }
      for (const cat of (f.dist_cats ?? [])) {
        whiteDist[cat] = (whiteDist[cat] ?? 0) + f.stars;
        whiteTotal += f.stars;
      }
      for (const cat of (f.style_cats ?? [])) {
        whiteStyle[cat] = (whiteStyle[cat] ?? 0) + f.stars;
        whiteTotal += f.stars;
      }
    }
  }

  const eff = (pink: number, white: number): number =>
    pink + (whiteTotal > 0 ? (white / whiteTotal) * 6 : 0);

  const vector: ArchetypeVector = { surface: {}, distance: {}, style: {} };
  for (const cat of SURFACE_CATS)  vector.surface[cat]  = eff(pinkSurface[cat]  ?? 0, whiteSurface[cat] ?? 0);
  for (const cat of DISTANCE_CATS) vector.distance[cat] = eff(pinkDist[cat]     ?? 0, whiteDist[cat]    ?? 0);
  for (const cat of STYLE_CATS)    vector.style[cat]    = eff(pinkStyle[cat]    ?? 0, whiteStyle[cat]   ?? 0);

  return vector;
}

// Scales every value in a vector by weight and returns a new vector.
function scaleVector(v: ArchetypeVector, weight: number): ArchetypeVector {
  const sc = (r: Record<string, number>) =>
    Object.fromEntries(Object.entries(r).map(([k, val]) => [k, val * weight]));
  return { surface: sc(v.surface), distance: sc(v.distance), style: sc(v.style) };
}

// Adds vector b into vector a in-place (b should already be scaled).
function addVector(a: ArchetypeVector, b: ArchetypeVector): void {
  for (const cat of SURFACE_CATS)  a.surface[cat]  = (a.surface[cat]  ?? 0) + (b.surface[cat]  ?? 0);
  for (const cat of DISTANCE_CATS) a.distance[cat] = (a.distance[cat] ?? 0) + (b.distance[cat] ?? 0);
  for (const cat of STYLE_CATS)    a.style[cat]    = (a.style[cat]    ?? 0) + (b.style[cat]    ?? 0);
}

// Derives the archetype label from the lineage-aggregated vector.
// Dirt+Long is a blacklisted combo — falls back to next-best distance.
// 'Any' is used only when a dimension has zero signal.
function determineArchetypeLabel(v: ArchetypeVector): ArchetypeLabel {
  // Surface: higher of turf vs dirt; default to turf when both are 0
  const turf = v.surface['turf'] ?? 0;
  const dirt = v.surface['dirt'] ?? 0;
  const surface = dirt > turf ? 'dirt' : 'turf';

  // Distance: highest value wins
  let distance = 'Any';
  let distScore = 0;
  for (const cat of DISTANCE_CATS) {
    const s = v.distance[cat] ?? 0;
    if (s > distScore) { distScore = s; distance = cat; }
  }

  // Blacklist: dirt+long → fall back to next-best non-long distance
  if (surface === 'dirt' && distance === 'long') {
    distance = 'Any';
    distScore = 0;
    for (const cat of DISTANCE_CATS) {
      if (cat === 'long') continue;
      const s = v.distance[cat] ?? 0;
      if (s > distScore) { distScore = s; distance = cat; }
    }
  }

  // Style: highest value wins
  let style = 'Any';
  let styleScore = 0;
  for (const cat of STYLE_CATS) {
    const s = v.style[cat] ?? 0;
    if (s > styleScore) { styleScore = s; style = cat; }
  }

  const distPart = distance !== 'Any' ? `/${distance}` : '';
  const label    = style !== 'Any'
    ? `${style} × ${surface}${distPart}`
    : `${surface}${distPart}`;

  return { surface, distance, style, label };
}

// Derives the icon category from an archetype label.
// Returns null for 'Any' distance on turf — those fall through to ace/skip.
function archetypeToIcon(label: ArchetypeLabel): Icon | null {
  if (label.surface === 'dirt') return 'dirt';
  switch (label.distance) {
    case 'sprint': return 'sprint';
    case 'mile':   return 'mile';
    case 'mid':    return 'mid';
    case 'long':   return 'long';
    default:       return null;
  }
}

// ─── Pink multiplier (used in quality scoring pipeline) ───────────────────────

// White skills whose activation tags match the uma's pink aptitudes are amplified.
// Each matching pink star adds 1/6 to the multiplier — 6 matching stars → 2×.
function pinkMultiplier(f: FactorEntry, pinkStars: Map<string, number>): number {
  const cats = [...(f.style_cats ?? []), ...(f.dist_cats ?? []), ...(f.surf_cats ?? [])];
  if (cats.length === 0) return 1.0;
  const matchingStars = cats.reduce((sum, cat) => sum + (pinkStars.get(cat) ?? 0), 0);
  return 1 + matchingStars / 6;
}

function collectPinks(factor_ids: number[], out: Map<string, number>): void {
  for (const fid of factor_ids) {
    const f = lookupFactor(fid);
    if (!f || f.type !== 'pink' || !f.category || !ALL_PINK_SET.has(f.category)) continue;
    out.set(f.category, (out.get(f.category) ?? 0) + f.stars);
  }
}

// ─── Quality scoring pipeline ─────────────────────────────────────────────────
// These functions compute the quality_score (blues + whites) and populate the
// factors array for the --breakdown CLI display. They are kept from the previous
// design and run in parallel with the archetype vector computation.

// Blues score equally across all distance categories; kept here for the factors log.
// Aptitude pinks add to per-icon subscores (used in breakdown only under new design).
// Style pinks gate style-tagged white skill scoring.
function scoreBluesAndPinks(
  factor_ids: number[],
  weight: number,
  source: 'own' | 'parent',
  scores: CategoryScores,
  factors: FactorContribution[],
  config: ClassifierConfig,
  dominantStyle: string | null
): void {
  const BLUE_RARITY_OWN: Record<number, number>    = { 3: 4.0, 2: 1.0, 1: -0.5 };
  const BLUE_RARITY_PARENT: Record<number, number> = { 3: 1.5, 2: 0.6, 1: 0.1 };
  const PINK_RARITY_OWN: Record<number, number>    = { 3: 4.0, 2: 1.0, 1: -0.5 };
  const PINK_RARITY_PARENT: Record<number, number> = { 3: 1.5, 2: 0.6, 1: 0.1 };
  const PARTIAL_MULT = 0.0; // partial credit for off-category aptitude pinks

  for (const fid of factor_ids) {
    const f = lookupFactor(fid);
    if (!f) continue;

    if (f.type === 'blue' && f.category) {
      const rarityMult = source === 'own'
        ? (BLUE_RARITY_OWN[f.stars] ?? 0)
        : (BLUE_RARITY_PARENT[f.stars] ?? 0);
      const contribution = rarityMult * weight;
      for (const icon of ICON_CATEGORIES) scores[icon] = (scores[icon] ?? 0) + contribution;
      factors.push({ factor_id: fid, name: f.name, stars: f.stars, type: 'blue', source, category: f.category, contribution });

    } else if (f.type === 'pink' && f.category) {
      if (SURFACE_SET.has(f.category) || DISTANCE_SET.has(f.category)) {
        const rarityMult = source === 'own'
          ? (PINK_RARITY_OWN[f.stars] ?? 0)
          : (PINK_RARITY_PARENT[f.stars] ?? 0);
        for (const icon of ICON_CATEGORIES) {
          let catMult = PARTIAL_MULT;
          if (f.category === 'turf' && icon !== 'dirt') catMult = 1.0;
          else if (f.category === 'dirt' && icon === 'dirt') catMult = 1.0;
          else if (f.category === icon) catMult = 1.0;
          scores[icon] = (scores[icon] ?? 0) + rarityMult * weight * catMult;
        }
        factors.push({ factor_id: fid, name: f.name, stars: f.stars, type: 'pink', source, category: f.category, contribution: rarityMult * weight });

      } else if (STYLE_SET.has(f.category)) {
        const isDominant = f.category === dominantStyle;
        let contribution = 0;
        if (isDominant) {
          const rarityMult = source === 'own'
            ? (PINK_RARITY_OWN[f.stars] ?? 0)
            : (PINK_RARITY_PARENT[f.stars] ?? 0);
          contribution = rarityMult * weight;
          for (const icon of ICON_CATEGORIES) scores[icon] = (scores[icon] ?? 0) + contribution;
        }
        factors.push({ factor_id: fid, name: f.name, stars: f.stars, type: 'pink', source, category: f.category, contribution, secondary_category: isDominant ? 'dominant' : undefined });
      }
    }
  }
}

// White and unique skills: composite score formula for quality and breakdown display.
// baseContrib = stars × weight × pinkMult × specialMult × rarityBonus × overlapBonus × uniqueMult
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
  const STYLE_MISMATCH    = 0.0;
  const UNIQUE_MULTIPLIER = 1.2;

  for (const fid of factor_ids) {
    const f = lookupFactor(fid);
    if (!f || (f.type !== 'white' && f.type !== 'unique')) continue;

    const hasDist   = (f.dist_cats  ?? []).length > 0;
    const hasSurf   = (f.surf_cats  ?? []).length > 0;
    const hasStyle  = (f.style_cats ?? []).length > 0;
    const isGeneric = !hasDist && !hasSurf && !hasStyle;

    // Style gate: skills tagged for a non-dominant style contribute nothing.
    const styleGateOpen = !hasStyle || (dominantStyle != null && (f.style_cats ?? []).includes(dominantStyle));
    const catStyleMult  = styleGateOpen ? 1.0 : STYLE_MISMATCH;

    const uniqueMult   = f.type === 'unique' ? UNIQUE_MULTIPLIER : 1.0;
    const pinkMult     = pinkMultiplier(f, pinkStars);
    const specialMult  = specialBonus(fid, config);
    const rarityBonus  = f.stars === 3 ? 1.2 : f.stars === 2 ? 0.8 : 0.6;
    const overlap      = whiteOverlap.get(f.name) ?? 1;
    const overlapBonus = Math.pow(1.1, overlap - 1);
    const baseContrib  = f.stars * weight * pinkMult * specialMult * rarityBonus * overlapBonus * uniqueMult;

    if (f.is_debuff) {
      debuffScore.value += f.stars * weight;
    } else {
      const statBoostMult = f.stat_boost ? config.whiteStatBoostMultiplier : 1.0;
      whiteTotal.value += baseContrib * statBoostMult * catStyleMult;
    }

    // Skill-type subscores for breakdown display
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

    let statBoostContribution: number | undefined;
    if (f.stat_boost) {
      statBoostContribution = baseContrib * config.whiteStatBoostMultiplier;
      scores[f.stat_boost] = (scores[f.stat_boost] ?? 0) + statBoostContribution;
    }

    for (const icon of ICON_CATEGORIES) {
      let catMult = 0;
      if (isGeneric) {
        catMult = 1.0;
      } else {
        if (hasDist) {
          const distMatch = icon !== 'dirt' && (f.dist_cats ?? []).includes(icon);
          const dirtMatch = icon === 'dirt'  && (f.dist_cats ?? []).includes('mile');
          catMult = (distMatch || dirtMatch) ? 1.0 : 0;
        }
        if (hasSurf && catMult === 0) {
          catMult = (icon === 'dirt' ? (f.surf_cats ?? []).includes('dirt') : (f.surf_cats ?? []).includes('turf')) ? 1.0 : 0;
        }
        if (hasStyle && catMult > 0) catMult *= catStyleMult;
        else if (hasStyle && !hasDist && !hasSurf) catMult = catStyleMult;
      }
      if (catMult > 0) scores[icon] = (scores[icon] ?? 0) + baseContrib * catMult;
    }

    factors.push({
      factor_id: fid, name: f.name, stars: f.stars, type: f.type, source,
      category: f.type, contribution: baseContrib,
      pink_multiplier: pinkMult, special_bonus: specialMult, style_mult: catStyleMult,
      stat_boost: f.stat_boost ?? undefined, stat_boost_contribution: statBoostContribution,
      dist_cats: f.dist_cats ?? [], style_cats: f.style_cats ?? [], surf_cats: f.surf_cats ?? [],
      is_debuff: f.is_debuff ?? false, skill_category: f.skill_category,
      is_last_spurt: f.is_last_spurt ?? false, relevance: skillRelevance?.get(fid),
    });
  }
}

// Dominant style gates style-tagged white skills in the quality scoring pipeline.
function determineDominantStyle(ownFactorIds: number[], parentFactorIds: number[][]): string | null {
  const ownTotals    = new Map<string, number>();
  const parentTotals = new Map<string, number>();

  for (const fid of ownFactorIds) {
    const f = lookupFactor(fid);
    if (!f || f.type !== 'pink' || !f.category || !STYLE_SET.has(f.category)) continue;
    ownTotals.set(f.category, (ownTotals.get(f.category) ?? 0) + f.stars);
  }
  if (ownTotals.size > 0) return [...ownTotals.entries()].sort((a, b) => b[1] - a[1])[0][0];

  for (const ids of parentFactorIds) {
    for (const fid of ids) {
      const f = lookupFactor(fid);
      if (!f || f.type !== 'pink' || !f.category || !STYLE_SET.has(f.category)) continue;
      parentTotals.set(f.category, (parentTotals.get(f.category) ?? 0) + f.stars);
    }
  }
  if (parentTotals.size > 0) return [...parentTotals.entries()].sort((a, b) => b[1] - a[1])[0][0];

  return null;
}

// ─── Per-uma scoring ───────────────────────────────────────────────────────────

// Two parallel pipelines:
//   Archetype pipeline — computes the effective star vector and archetype label.
//     Each unit (own + each direct parent) contributes independently; parent vectors
//     are scaled by config.weights.parent before being summed into the lineage vector.
//   Quality pipeline   — computes quality_score (blues + whites) and the factor log
//     used by --breakdown. Uses the same source weights and pink multiplier logic as before.
function scoreUma(
  uma: RawUma,
  config: ClassifierConfig,
  skillRelevance?: Map<number, number>
): ScoredUma {
  const scores:     CategoryScores = {};
  const whiteTotal  = { value: 0 };
  const debuffScore = { value: 0 };
  const pinkStars   = new Map<string, number>();
  const factors: FactorContribution[] = [];

  const directParents = uma.succession_chara_array.filter(p => isDirectParent(p.position_id));

  // ── Archetype pipeline ────────────────────────────────────────────────────────
  // Compute a unit vector for own factors, then add scaled parent vectors.
  const ownVec = computeUnitVector(uma.factor_id_array);
  const lineageVector: ArchetypeVector = {
    surface:  { ...ownVec.surface  },
    distance: { ...ownVec.distance },
    style:    { ...ownVec.style    },
  };

  for (const parent of directParents) {
    addVector(lineageVector, scaleVector(computeUnitVector(parent.factor_id_array), config.weights.parent));
  }
  const archetype_label = determineArchetypeLabel(lineageVector);

  // Style gate uses the archetype's dominant style so it aligns with classification.
  const dominantStyle = archetype_label.style !== 'Any' ? archetype_label.style : null;

  // ── Quality pipeline ──────────────────────────────────────────────────────────
  // Pass 1: collect pink stars (white multiplier) and white overlap counts
  collectPinks(uma.factor_id_array, pinkStars);
  for (const parent of directParents) collectPinks(parent.factor_id_array, pinkStars);

  const whiteOverlap = new Map<string, number>();
  for (const fid of [...uma.factor_id_array, ...directParents.flatMap(p => p.factor_id_array)]) {
    const f = lookupFactor(fid);
    if (f?.type === 'white') whiteOverlap.set(f.name, (whiteOverlap.get(f.name) ?? 0) + 1);
  }

  // Pass 2: blues + pinks
  scoreBluesAndPinks(uma.factor_id_array, config.weights.own, 'own', scores, factors, config, dominantStyle);
  for (const parent of directParents) {
    scoreBluesAndPinks(parent.factor_id_array, config.weights.parent, 'parent', scores, factors, config, dominantStyle);
  }

  // Pass 3: whites + uniques
  scoreGreensAndWhites(uma.factor_id_array, config.weights.own, 'own', scores, whiteTotal, debuffScore, pinkStars, whiteOverlap, factors, config, dominantStyle, skillRelevance);
  for (const parent of directParents) {
    scoreGreensAndWhites(parent.factor_id_array, config.weights.parent, 'parent', scores, whiteTotal, debuffScore, pinkStars, whiteOverlap, factors, config, dominantStyle, skillRelevance);
  }

  // quality_score = blue quality + white total
  const blueQuality = factors
    .filter(f => f.type === 'blue')
    .reduce((sum, f) => sum + f.contribution, 0);
  const quality_score = blueQuality + whiteTotal.value;

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
    quality_score,
    archetype_vector: lineageVector,
    archetype_label,
    factors,
    category_factors,
    assigned_icon: null,
  };
}

// ─── Heart assignment ──────────────────────────────────────────────────────────

function assignHearts(scored: ScoredUma[], assigned: Map<number, Icon>, config: ClassifierConfig): void {
  const candidates = scored
    .filter(u => !assigned.has(u.trained_chara_id) && u.white_total >= config.heartWhiteThreshold)
    .sort((a, b) => b.white_total - a.white_total);

  const coveredSkills = new Map<string, number>();
  let heartCount = 0;
  const UPGRADE_THRESHOLD = 1.5;
  const MIN_SKILL_VALUE   = 1.0;

  for (const uma of candidates) {
    if (heartCount >= config.keepHeart) break;

    const umaSkills = new Map<string, number>();
    for (const f of uma.factors) {
      if (f.type !== 'white') continue;
      const val = f.contribution ?? 0;
      if (val > (umaSkills.get(f.name) ?? 0)) umaSkills.set(f.name, val);
    }

    let hasNew = false;
    for (const [name, value] of umaSkills) {
      if (value < MIN_SKILL_VALUE) continue;
      const bestSeen = coveredSkills.get(name) ?? 0;
      if (bestSeen === 0 || value > bestSeen * UPGRADE_THRESHOLD) { hasNew = true; break; }
    }

    if (hasNew) {
      for (const [name, value] of umaSkills) {
        if (value > (coveredSkills.get(name) ?? 0)) coveredSkills.set(name, value);
      }
      assigned.set(uma.trained_chara_id, 'heart');
      heartCount++;
    }
  }
}

// ─── Main classifier ───────────────────────────────────────────────────────────

// Umas are grouped by archetype label and ranked within each group by quality_score.
// The top keepPerCategory umas per group receive the icon derived from their archetype
// surface/distance. Special icons (clubs, heart, ace, trash) follow the same priority
// order as before.
export function classifyRoster(
  umas: RawUma[],
  config: ClassifierConfig,
  skillRelevance?: Map<number, number>
): ScoredUma[] {
  const { keepPerArchetype, maxPerIcon, aceScoreThreshold } = config;

  const scored = umas.map(uma => scoreUma(uma, config, skillRelevance));

  // Compute race scores when a skill relevance map is provided
  if (skillRelevance) {
    for (const uma of scored) {
      uma.race_score = uma.factors
        .filter(f => f.type === 'white')
        .reduce((sum, f) => sum + (f.contribution ?? 0) * (f.relevance ?? 0), 0);
    }
  }

  const assigned = new Map<number, Icon>();

  // Clubs first — capped at maxPerIcon
  const debuffCandidates = scored
    .filter(u => u.debuff_score > 0)
    .sort((a, b) => b.debuff_score - a.debuff_score)
    .slice(0, maxPerIcon);
  for (const uma of debuffCandidates) assigned.set(uma.trained_chara_id, 'clubs');

  // Group unassigned umas by archetype label, sort by quality_score.
  // Within each icon, process the best archetype groups first (by their group leader's score)
  // so the maxPerIcon cap keeps the highest-quality umas.
  const archetypeGroups = new Map<string, ScoredUma[]>();
  for (const uma of scored) {
    if (assigned.has(uma.trained_chara_id)) continue;
    const label = uma.archetype_label.label;
    if (!archetypeGroups.has(label)) archetypeGroups.set(label, []);
    archetypeGroups.get(label)!.push(uma);
  }

  for (const [, group] of archetypeGroups) {
    group.sort((a, b) => b.quality_score - a.quality_score);
  }

  // Sort archetype groups by their best uma's quality_score so the icon cap
  // favors the strongest archetypes when multiple compete for the same icon.
  const sortedGroups = [...archetypeGroups.values()]
    .sort((a, b) => b[0].quality_score - a[0].quality_score);

  const iconCounts = new Map<Icon, number>();
  for (const group of sortedGroups) {
    const icon = archetypeToIcon(group[0].archetype_label);
    if (!icon) continue; // turf with no distance signal — falls through to ace/skip
    const already = iconCounts.get(icon) ?? 0;
    const slots = Math.min(keepPerArchetype, group.length, maxPerIcon - already);
    for (let i = 0; i < slots; i++) {
      assigned.set(group[i].trained_chara_id, icon);
    }
    iconCounts.set(icon, already + slots);
  }

  // Hearts
  assignHearts(scored, assigned, config);

  // Ace
  const aceCandidates = scored
    .filter(u => !assigned.has(u.trained_chara_id) && u.rank_score >= aceScoreThreshold)
    .sort((a, b) => b.rank_score - a.rank_score)
    .slice(0, config.keepAce);
  for (const uma of aceCandidates) assigned.set(uma.trained_chara_id, 'ace');

  // Trash: lowest quality_score umas not yet assigned
  const trashCandidates = scored
    .filter(u => !assigned.has(u.trained_chara_id))
    .sort((a, b) => a.quality_score - b.quality_score);
  for (let i = 0; i < Math.min(config.numTrash, trashCandidates.length); i++) {
    assigned.set(trashCandidates[i].trained_chara_id, 'trash');
  }

  for (const uma of scored) {
    uma.assigned_icon = assigned.get(uma.trained_chara_id) ?? 'skip';
  }

  return scored;
}
