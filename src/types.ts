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

export type Icon = 'skip'
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

export interface ScoredUma {
  trained_chara_id: number;
  card_id: number;
  rank_score: number;
  is_locked: boolean;
  scores: CategoryScores;   // score per icon category
  white_total: number;      // raw total white stars (own + weighted parents)
  debuff_score: number;
  race_score: number;
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
  trackId?: number;        // specific course ID
  runningStyle?: number;   // 1=Front, 2=Pace, 3=Late, 4=End
}

// ─── Classifier config ────────────────────────────────────────────────────────

export interface ClassifierConfig {
  // How many top umas to keep per icon category
  keepPerCategory: number;
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
  // Weights for own vs parent vs grandparent factors
  weights: {
    own: number;
    parent: number; // position_id 10 or 20 only; grandparents are ignored
  };
  skillBonuses: Record<number, number>; // skillId (base, 1★ variant) → multiplier
  // Extra multiplier applied to white stars when rolling into category score
  whiteStatBoostMultiplier: number;
}

export const DEFAULT_CONFIG: ClassifierConfig = {
  keepPerCategory: 6,
  keepAce: 10,
  keepHeart: 10,
  numTrash: 20,
  minCategoryScore: 1,
  heartWhiteThreshold: 10,
  aceScoreThreshold: 12000,
  weights: {
    own: 1.0,
    parent: 0.4,
  },
  skillBonuses: {
    2016001: 1.5,  // Groundwork (no front runner pinks)
    2016101: 1.5,  // Tail Held High
  },
  whiteStatBoostMultiplier: 2.0,
};
