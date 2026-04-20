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

// ─── Decoded factor ────────────────────────────────────────────────────────────

export type BlueCategory = 'speed' | 'stamina' | 'power' | 'guts' | 'wit';
export type PinkCategory = 'turf' | 'dirt' | 'sprint' | 'mile' | 'mid' | 'long';
export type StyleCategory = 'front' | 'pace' | 'late' | 'end';
export type WhiteCategory = 'white';
export type UniqueCategory = 'unique';
export type FactorCategory = BlueCategory | PinkCategory | StyleCategory | WhiteCategory | UniqueCategory;

export interface DecodedFactor {
  factor_id: number;
  category: FactorCategory;
  stars: number;
}

// ─── Icon / favorite mark ─────────────────────────────────────────────────────

export type Icon =
  | 'speed'     // 🥤 boba
  | 'stamina'   // 🍚 rice bowl
  | 'power'     // 🍫 choco cake
  | 'guts'      // 🥕 carrot
  | 'wit'       // 🍰 strawberry cake
  | 'turf'      // ♦ diamond
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
export interface ScoredWhite {
  name: string;
  stars: number;
  raw_value: number;
  pink_multiplier: number;
  special_bonus: number;
  final_value: number;
  dist_cats: string[];
  style_cats: string[];
  surf_cats: string[];
  is_debuff: boolean;
  source: 'own' | 'parent';
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
  whites: ScoredWhite[];
  assigned_icon: Icon | null;
}

// ─── Classifier config ────────────────────────────────────────────────────────

export interface ClassifierConfig {
  // How many top umas to keep per icon category
  keepPerCategory: number;
  // How many top aces to keep
  keepAce: number;
  // How many umas to keep for white skills
  keepHeart: number;
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
  // Extra multiplier applied to white stars when rolling into category score
  whiteSkillMultiplier: number;
  whiteStatBoostMultiplier: number;
}

export const DEFAULT_CONFIG: ClassifierConfig = {
  keepPerCategory: 7,
  keepAce: 20,
  keepHeart: 20,
  minCategoryScore: 2,
  heartWhiteThreshold: 20,
  aceScoreThreshold: 12500,
  weights: {
    own: 1,
    parent: 0.6,
  },
  whiteSkillMultiplier: 1,
  whiteStatBoostMultiplier: 0.5,
};
