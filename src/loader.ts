import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { RaceEnvironment } from './types.ts';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ASSETS = join(__dirname, 'assets');

// ─── Raw data types ────────────────────────────────────────────────────────────

interface RawFactor {
  id: number;
  name: string;
  description: string;
  rarity: number;
  grade: number;
  type: number;
}

interface RawEffect {
  type: string;
  value: number;
  displayText: string;
}
interface RawSkill {
  skillId: number;
  skillName: string;
  skillCategory: string;
  effects: RawEffect[];
  tagId: string;
  activationCondition: string;
}

// ─── Public types ──────────────────────────────────────────────────────────────

export interface FactorEntry {
  type: 'blue' | 'pink' | 'white' | 'unique' | 'passive' | 'scenario';
  category?: string;
  stars: number;
  name: string;
  stat_boost?: string | null;
  style_cats?: string[];
  dist_cats?: string[];
  surf_cats?: string[];
  skill_category?: string;
  effects?: Array<{ type: string; value: number }>;
  is_last_spurt?: boolean;
  is_debuff?: boolean;
}

// ─── Lookup tables ─────────────────────────────────────────────────────────────

const BLUE_GROUP: Record<number, string> = {
  1: 'speed', 2: 'stamina', 3: 'power', 4: 'guts', 5: 'wit',
};

const PINK_PREFIX: Record<number, string> = {
  11: 'turf', 12: 'dirt',
  21: 'front', 22: 'pace', 23: 'late', 24: 'end',
  31: 'sprint', 32: 'mile', 33: 'mid', 34: 'long',
};

const STYLE_TAG: Record<string, string> = {
  '101': 'front', '102': 'pace', '103': 'late', '104': 'end',
};

const DIST_TAG: Record<string, string> = {
  '201': 'sprint', '202': 'mile', '203': 'mid', '204': 'long',
};

const SURF_TAG: Record<string, string> = {
  '501': 'turf', '502': 'dirt',
};

// ─── Hint extraction ───────────────────────────────────────────────────────────

function extractHintName(description: string): string | null {
  const m = description.match(/skill hint for "(.+?)"/);
  return m ? m[1] : null;
}

function extractStatBoost(description: string): string | null {
  for (const s of ['speed', 'stamina', 'power', 'guts', 'wit']) {
    if (description.toLowerCase().includes(s)) return s;
  }
  return null;
}

// ─── Map builders ──────────────────────────────────────────────────────────────

function buildFactorMap(factors: RawFactor[], skillByName: Map<string, RawSkill>): Map<number, FactorEntry> {
  const map = new Map<number, FactorEntry>();

  for (const f of factors) {
    const { id, name, description, rarity: stars, type } = f;

    if (type === 1) {
      const category = BLUE_GROUP[Math.floor(id / 100)];
      map.set(id, { type: 'blue', category, stars, name });

    } else if (type === 2) {
      const category = PINK_PREFIX[Math.floor(id / 100)];
      map.set(id, { type: 'pink', category, stars, name });

    } else if (type === 3) {
      const skill = skillByName.get(name);
      const tags = skill ? skill.tagId.split('/') : [];
      map.set(id, {
        type: 'unique',
        stars,
        name,
        style_cats: tags.filter(t => t in STYLE_TAG).map(t => STYLE_TAG[t]),
        dist_cats:  tags.filter(t => t in DIST_TAG).map(t => DIST_TAG[t]),
        surf_cats:  tags.filter(t => t in SURF_TAG).map(t => SURF_TAG[t]),
        skill_category: skill?.skillCategory ?? undefined,
        is_last_spurt: skill
          ? skill.activationCondition.includes('is_lastspurt==1')
          : false,
        is_debuff: skill?.skillCategory === 'Debuff',
      });
    } else if (type === 4 || type === 5) {
      const hintName = type === 5 ? extractHintName(description) : name;
      const skill = hintName ? skillByName.get(hintName) : undefined;
      const tags = skill ? skill.tagId.split('/') : [];
      const isType10:boolean = 'Type10' == skill?.effects[0]?.type
      let sc = '';
      //for some reason, Focus/Concentration are listed as Debuff, fix by checking for Type10
      if(isType10){sc = 'Focus'} else { sc = skill?.skillCategory ?? '' }

      map.set(id, {
        type: 'white',
        stars,
        name,
        stat_boost: type === 5 ? extractStatBoost(description) : null,
        style_cats: tags.filter(t => t in STYLE_TAG).map(t => STYLE_TAG[t]),
        dist_cats:  tags.filter(t => t in DIST_TAG).map(t => DIST_TAG[t]),
        surf_cats:  tags.filter(t => t in SURF_TAG).map(t => SURF_TAG[t]),
        is_debuff:  !isType10 && skill?.skillCategory === 'Debuff',
        skill_category: sc ?? undefined,
        is_last_spurt: skill
          ? skill.activationCondition.includes('is_lastspurt==1')
          : false,
      });

    } else if (type === 6) {
      map.set(id, { type: 'passive', stars, name });

    } else if (type === 7) {
      map.set(id, { type: 'scenario', stars, name });
    }
  }

  return map;
}

// ─── Singletons ────────────────────────────────────────────────────────────────

let _factorMap: Map<number, FactorEntry> | null = null;
let _charMap: Map<number, string> | null = null;

export function getFactorMap(): Map<number, FactorEntry> {
  if (_factorMap) return _factorMap;

  const factors: RawFactor[] = JSON.parse(
    readFileSync(join(ASSETS, 'TerumiFactorData.json'), 'utf-8')
  );
  const skills: RawSkill[] = JSON.parse(
    readFileSync(join(ASSETS, 'TerumiSimpleSkillData.json'), 'utf-8')
  );
  const skillByName = new Map(skills.map(s => [s.skillName, s]));

  _factorMap = buildFactorMap(factors, skillByName);

  return _factorMap;
}

export function getCharMap(): Map<number, string> {
  if (_charMap) return _charMap;

  const raw: Array<{ cardId: number; charaName: string }> = JSON.parse(
    readFileSync(join(ASSETS, 'TerumiCharacterData.json'), 'utf-8')
  );
  _charMap = new Map(raw.map(e => [e.cardId, e.charaName]));
  return _charMap;
}

export function lookupFactor(factor_id: number): FactorEntry | null {
  return getFactorMap().get(factor_id) ?? null;
}

export function lookupCharName(card_id: number): string {
  return getCharMap().get(card_id) ?? `card:${card_id}`;
}

export interface RaceEntry {
  raceId: number;
  raceName: string;
  grade: number;
  distanceCategory: string;
  groundName: string;
  trackName: string;
  trackId: number;
  ground: number;
}

interface RawRace {
  raceId: number;
  raceName: string;
  grade: number;
  distanceCategory: string;
  groundName: string;
  trackName: string;
  trackId: number;
  ground: number;
}

let _raceMap: Map<number, RaceEntry> | null = null;

export function getRaceMap(): Map<number, RaceEntry> {
  if (_raceMap) return _raceMap;
  const raw: RawRace[] = JSON.parse(
    readFileSync(join(ASSETS, 'TerumiRaceData.json'), 'utf-8')
  );
  _raceMap = new Map(raw.map(r => [r.raceId, r]));
  return _raceMap;
}

export function buildSkillRelevanceMap(
  env: RaceEnvironment
): Map<number, number> | null {
  // If a raceId is provided, derive environment fields from race data
  if (env.raceId) {
    const race = getRaceMap().get(env.raceId);
    if (!race) return null;

    const distMap: Record<string, number> = {
      'Short': 1, 'Mile': 2, 'Middle': 3, 'Long': 4,
    };
    env = {
      ...env,
      distanceType:  env.distanceType  ?? distMap[race.distanceCategory],
      groundType:    env.groundType    ?? race.ground,
      trackId:       env.trackId       ?? race.trackId,
    };
  }

  const factorMap = getFactorMap();

  // Load skills for activation condition parsing
  const skills: RawSkill[] = JSON.parse(
    readFileSync(join(ASSETS, 'TerumiSimpleSkillData.json'), 'utf-8')
  );
  const skillByName = new Map(skills.map(s => [s.skillName, s]));

  const skillMap = new Map<number, number>();

  const distCatMap: Record<string, number> = {
    'sprint': 1, 'mile': 2, 'mid': 3, 'long': 4,
  };
  const surfCatMap: Record<string, number> = {
    'turf': 1, 'dirt': 2,
  };

  for (const [fid, entry] of factorMap) {
    if (entry.type !== 'white') continue;

    const skill = skillByName.get(entry.name);
    if (!skill) {
      skillMap.set(fid, 0.5); // unknown skill — generic relevance
      continue;
    }

    const cond = skill.activationCondition;

    // ── Track-specific skills ─────────────────────────────────────────────────
    if (cond.includes('track_id')) {
      const match = cond.match(/track_id==(\d+)/);
      if (match) {
        const skillTrackId = parseInt(match[1]);
        skillMap.set(fid, skillTrackId === env.trackId ? 2.0 : 0);
      }
      continue;
    }

    // ── Passive skills (green skills) — score by effect value + condition match ─
    if (skill.skillCategory === 'Passive') {
      const condMatch = matchesEnvironment(cond, env);
      if (condMatch === 'mismatch') {
        skillMap.set(fid, 0);
        continue;
      }

      // Score by total positive stat effect value, normalized
      const effectScore = (skill.effects ?? [])
        .filter(e => e.value > 0)
        .reduce((sum, e) => sum + e.value, 0);

      // Normalize: +100 stat points → relevance 1.0, scale from there
      const normalized = effectScore / 100;
      skillMap.set(fid, condMatch === 'match' ? normalized * 1.5 : normalized * 0.5);
      continue;
    }

    // ── Regular white skills — score by dist/surf tag match ──────────────────
    const skillDistTypes = (entry.dist_cats ?? []).map(c => distCatMap[c]).filter(Boolean);
    const skillSurfTypes = (entry.surf_cats ?? []).map(c => surfCatMap[c]).filter(Boolean);
    const isGeneric = skillDistTypes.length === 0 && skillSurfTypes.length === 0;

    if (isGeneric) {
      // Check style match if running style specified
      if (env.runningStyle && entry.style_cats && entry.style_cats.length > 0) {
        const styleMap: Record<number, string> = {
          1: 'front', 2: 'pace', 3: 'late', 4: 'end',
        };
        const envStyle = styleMap[env.runningStyle];
        const styleMatch = entry.style_cats.includes(envStyle);
        skillMap.set(fid, styleMatch ? 1.0 : 0.5);
      } else {
        skillMap.set(fid, 0.5);
      }
      continue;
    }

    let score = 0;
    let mismatches = 0;

    if (skillDistTypes.length > 0 && env.distanceType != null) {
      if (skillDistTypes.includes(env.distanceType)) {
        score += 1.5;
      } else {
        mismatches++;
      }
    }

    if (skillSurfTypes.length > 0 && env.groundType != null) {
      if (skillSurfTypes.includes(env.groundType)) {
        score += 1.0;
      } else {
        mismatches++;
      }
    }

    // Style match bonus
    if (env.runningStyle && entry.style_cats && entry.style_cats.length > 0) {
      const styleMap: Record<number, string> = {
        1: 'front', 2: 'pace', 3: 'late', 4: 'end',
      };
      const envStyle = styleMap[env.runningStyle];
      if (entry.style_cats.includes(envStyle)) score += 0.5;
    }

    skillMap.set(fid, mismatches > 0 && score === 0 ? 0 : score);
  }

  return skillMap;
}

// ─── Activation condition matching ────────────────────────────────────────────

// There is something strange about this logic
// TODO: explain what mismatch/match actually mean and if it's even possible to get partial
function matchesEnvironment(
  cond: string,
  env: RaceEnvironment
): 'match' | 'partial' | 'mismatch' {
  // Parse all == conditions from the activation string
  const checks = [...cond.matchAll(/([a-z_]+)==(\d+)/g)].map(m => ({
    field: m[1],
    value: parseInt(m[2]),
  }));

  if (checks.length === 0) return 'partial';

  const FIELD_MAP: Record<string, keyof RaceEnvironment> = {
    'ground_condition': 'groundCondition',
    'weather':          'weather',
    'distance_type':    'distanceType',
    'ground_type':      'groundType',
    'running_style':    'runningStyle',
    'track_id':         'trackId',
  };

  let matched = 0;
  let mismatched = 0;
  let unknown = 0;

  for (const { field, value } of checks) {
    const envKey = FIELD_MAP[field];
    if (!envKey) { unknown++; continue; }
    const envVal = env[envKey];
    if (envVal == null) { unknown++; continue; }
    if (envVal === value) { matched++; } else { mismatched++; }
  }

  if (mismatched > 0) return 'mismatch';
  if (matched > 0)    return 'match';
  return 'partial';
}