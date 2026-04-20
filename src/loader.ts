import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

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

interface RawSkill {
  skillId: number;
  skillName: string;
  skillCategory: string;
  tagId: string;
}

// ─── Public types ──────────────────────────────────────────────────────────────

export interface FactorEntry {
  type: 'blue' | 'pink' | 'white' | 'unique' | 'green' | 'scenario';
  category?: string;
  stars: number;
  name: string;
  stat_boost?: string | null;
  style_cats?: string[];
  dist_cats?: string[];
  surf_cats?: string[];
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
      map.set(id, { type: 'unique', stars, name });

    } else if (type === 4 || type === 5) {
      const hintName = type === 5 ? extractHintName(description) : name;
      const skill = hintName ? skillByName.get(hintName) : undefined;
      const tags = skill ? skill.tagId.split('/') : [];

      map.set(id, {
        type: 'white',
        stars,
        name,
        stat_boost: type === 5 ? extractStatBoost(description) : null,
        style_cats: tags.filter(t => t in STYLE_TAG).map(t => STYLE_TAG[t]),
        dist_cats: tags.filter(t => t in DIST_TAG).map(t => DIST_TAG[t]),
        surf_cats: tags.filter(t => t in SURF_TAG).map(t => SURF_TAG[t]),
        is_debuff: skill?.skillCategory === 'Debuff',
      });

    } else if (type === 6) {
      map.set(id, { type: 'green', stars, name });

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