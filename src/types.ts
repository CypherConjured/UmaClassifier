// ─── Raw JSON types (as exported from the game) ───────────────────────────────

export interface RawFactorInfo {
  factor_id: number;
  level: number; // always 0 in current exports — stars encoded in factor_id
}

export interface RawParent {
  position_id: number; // 10=p1, 11=p1parent1, 12=p1parent2, 20=p2, 21=p2parent1, 22=p2parent2
  card_id: number;
  rank: number;
  rarity: number;
  talent_level: number;
  factor_id_array: number[];
  factor_info_array: RawFactorInfo[];
}

export interface RawUma {
  trained_chara_id: number;
  card_id: number;
  speed: number;
  stamina: number;
  power: number;
  guts: number;
  wiz: number;
  rank_score: number;
  rank: number;
  talent_level: number;
  is_locked: number;
  is_saved: number;
  factor_id_array: number[];
  factor_info_array: RawFactorInfo[];
  succession_chara_array: RawParent[];
  skill_array: { skill_id: number; level: number }[];
  proper_ground_turf: number;
  proper_ground_dirt: number;
  proper_distance_short: number;
  proper_distance_mile: number;
  proper_distance_middle: number;
  proper_distance_long: number;
  proper_running_style_nige: number;
  proper_running_style_senko: number;
  proper_running_style_sashi: number;
  proper_running_style_oikomi: number;
}

// ─── Icon / favorite mark ─────────────────────────────────────────────────────

export type Icon = 'skip' | 'unlock'
  | 'dirt'      // 👟 dirt shoe
  | 'sprint'    // 👟 sprint shoe
  | 'mile'      // 👟 mile shoe
  | 'mid'       // 👟 medium shoe
  | 'long'      // 👟 long shoe
  | 'heart'     // ♥ exceptional white sparks
  | 'ace'       // ♠ racing fallback
  | 'clubs'     // ♣ debuffer
  | 'trash';    // 🗑️ transfer candidate

// ─── Scored uma ───────────────────────────────────────────────────────────────
export interface FactorContribution {
  factor_id: number;
  name: string;
  stars: number;
  type: 'blue' | 'pink' | 'white' | 'unique';
  source: 'own' | 'parent';
  category: string;
  secondary_category?: string;
  contribution: number;

  // White-specific
  pink_multiplier?: number;
  style_mult?: number;
  special_bonus?: number;
  stat_boost?: string;
  stat_boost_contribution?: number;
  dist_cats?: string[];
  style_cats?: string[];
  surf_cats?: string[];
  is_debuff?: boolean;
  skill_category?: string;
  is_last_spurt?: boolean;
  relevance?: number;
}

export type CategoryScores = Record<string, number>;

// ─── Archetype ────────────────────────────────────────────────────────────────

// Per-dimension effective star values derived from the lineage-aggregated formula:
//   effective_stars(cat) = pink_stars(cat) + (white_stars_in_cat / white_stars_total) × 6
export interface ArchetypeVector {
  surface:  Record<string, number>; // 'turf' | 'dirt'
  distance: Record<string, number>; // 'sprint' | 'mile' | 'mid' | 'long'
  style:    Record<string, number>; // 'front' | 'pace' | 'late' | 'end'
}

// Dominant value per dimension; derived from the lineage vector.
// 'Any' means no signal exists in that dimension.
export interface ArchetypeLabel {
  surface:  string; // 'turf' | 'dirt'
  distance: string; // 'sprint' | 'mile' | 'mid' | 'long' | 'Any'
  style:    string; // 'front' | 'pace' | 'late' | 'end' | 'Any'
  label:    string; // e.g. "late × dirt/mile"
}

export interface ScoredUma {
  trained_chara_id: number;
  card_id: number;
  rank_score: number;
  is_locked: boolean;
  scores: CategoryScores;        // type/stat subscores for breakdown display
  white_total: number;
  debuff_score: number;
  race_score: number;
  quality_score: number;         // blues + whites; used for within-archetype ranking and trash
  archetype_vector: ArchetypeVector;
  archetype_label: ArchetypeLabel;
  factors: FactorContribution[];
  category_factors: Record<string, FactorContribution[]>;
  assigned_icon: Icon | null;
}

// ─── Race Environment ────────────────────────────────────────────────────────

export interface RaceEnvironment {
  raceId?: number;
  distanceType?: number;   // 1=Sprint, 2=Mile, 3=Middle, 4=Long
  groundType?: number;     // 1=Turf, 2=Dirt
  groundCondition?: number;// 1=Firm, 2=Good, 3=Soft, 4=Heavy
  weather?: number;        // 1=Sunny, 2=Cloudy, 3=Rainy, 4=Snowy
  season?: number;         // 1=Spring, 2=Summer, 3=Fall, 4=Winter
  trackId?: number;        // specific course ID
  runningStyle?: number;   // 1=Front, 2=Pace, 3=Late, 4=End
}

// ─── Classifier config ────────────────────────────────────────────────────────

export interface ClassifierConfig {
  // How many top umas to keep per archetype label (e.g. "front × turf/mile")
  keepPerArchetype: number;
  // Hard cap on total umas assigned to each icon across all archetype groups
  maxPerIcon: number;
  // How many top aces to keep
  keepAce: number;
  // How many umas to keep for white skills
  keepHeart: number;
  // How many umas to consider for transfer
  numTrash: number;
  // Minimum score to even be considered for a category (avoids noise)
  minCategoryScore: number;
  // White star total threshold to qualify for heart icon
  heartWhiteThreshold: number;
  // rank_score threshold to qualify as ace fallback
  aceScoreThreshold: number;
  // All scoring weights and multipliers
  weights: {
    parent: number; // archetype vector scale for direct parents (position_id 10 or 20 only; grandparents are ignored)
    blue: { own: Record<number, number>; parent: Record<number, number> };
    pink: { own: Record<number, number>; parent: Record<number, number> };
    // Per-rarity weights for white skills and stat-boost sparks (bakes in star value — no separate f.stars multiply)
    skillSparks: { own: Record<number, number>; parent: Record<number, number> };
    statSparks:  { own: Record<number, number>; parent: Record<number, number> };
    skillBonuses: Record<number, number>; // skillId (base, 1★ variant) → multiplier
    // Partial credit multipliers applied when a factor's category doesn't match the scoring target
    mismatchMult: {
      surface:      number; // off-category surface pinks (e.g. dirt pink on a turf icon)
      distance:     number; // off-category distance pinks (e.g. mile pink on sprint icon)
      style:        number; // white skills tagged for a non-dominant style
      dirtAffinity: number; // star multiplier for dirt pinks/whites in the archetype vector
    };
    uniqueMult: number;            // extra multiplier applied to unique-type skills
    heartUpgradeThreshold: number; // skill must be this × better than best seen to count as new heart coverage
    heartMinSkillValue: number;    // minimum contribution for a skill to be considered for heart coverage
  };
}

export const DEFAULT_CONFIG: ClassifierConfig = {
  keepPerArchetype: 3,
  maxPerIcon: 10,
  keepAce: 10,
  keepHeart: 10,
  numTrash: 50,
  minCategoryScore: 1,
  heartWhiteThreshold: 10,
  aceScoreThreshold: 12000,
  weights: {
    parent: 0.4,
    blue: {
      own:    { 3: 4.0, 2: 1.5, 1: -0.7 },
      parent: { 3: 1.5, 2: 0.6, 1: 0.1  },
    },
    pink: {
      own:    { 3: 4.0, 2: 1.5, 1: -0.7 },
      parent: { 3: 1.5, 2: 0.6, 1: 0.1  },
    },
    // own values bake in rarityBonus (3→1.2, 2→0.8, 1→0.6) × stars.
    // parent values additionally bake in the 0.4 parent discount.
    // statSparks additionally bakes in the former whiteStatBoostMultiplier (1.5×).
    skillSparks: {
      own:    { 3: 3.0, 2: 1.4, 1: 0.5 },
      parent: { 3: 2.0, 2: 0.8, 1: 0.2 },
    },
    statSparks: {
      own:    { 3: 4.0, 2: 3.0, 1: 1.0 },
      parent: { 3: 3.0, 2: 2.0, 1: 0.8 },
    },
    skillBonuses: {
      2016001: 1.5,  // Groundwork (no front runner pinks)
      2016101: 1.5,  // Tail Held High
    },
    mismatchMult: {
      surface:      0.0,
      distance:     0.0,
      style:        0.0,
      dirtAffinity: 2,
    },
    uniqueMult: 1.2,
    heartUpgradeThreshold: 1.5,
    heartMinSkillValue: 1.0,
  },
};
