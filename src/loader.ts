import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ASSETS = join(__dirname, 'assets');

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

let _factorMap: Map<number, FactorEntry> | null = null;
let _charMap: Map<number, string> | null = null;

export function getFactorMap(): Map<number, FactorEntry> {
  if (_factorMap) return _factorMap;
  const raw = JSON.parse(readFileSync(join(ASSETS, 'factorMap.json'), 'utf-8'));
  _factorMap = new Map(
    Object.entries(raw).map(([k, v]) => [parseInt(k), v as FactorEntry])
  );
  return _factorMap;
}

export function getCharMap(): Map<number, string> {
  if (_charMap) return _charMap;
  const raw: Array<{ cardId: number; charaName: string }> =
    JSON.parse(readFileSync(join(ASSETS, 'TerumiCharacterData.json'), 'utf-8'));
  _charMap = new Map(raw.map(e => [e.cardId, e.charaName]));
  return _charMap;
}

export function lookupFactor(factor_id: number): FactorEntry | null {
  return getFactorMap().get(factor_id) ?? null;
}

export function lookupCharName(card_id: number): string {
  return getCharMap().get(card_id) ?? `card:${card_id}`;
}