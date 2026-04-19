/**
 * CLI usage:
 *   npm run cli -- <path-to-json> [--keep N] [--min-score N] [--heart N] [--ace N]
 *
 * Outputs a table of all umas sorted by assigned icon, with their top scores.
 */

import { readFileSync } from 'node:fs';
import { classifyRoster } from './classifier.ts';
import { DEFAULT_CONFIG } from './types.ts';
import type { ClassifierConfig, Icon, ScoredUma } from './types.ts';

const ICON_DISPLAY: Record<Icon, string> = {
  speed:   '🧋 Speed',
  stamina: '🍚 Stamina',
  power:   '🍫 Power',
  guts:    '🥕 Guts',
  wit:     '🍰 Wit',
  turf:    '♦  Turf',
  dirt:    '👟 Dirt',
  sprint:  '👟 Sprint',
  mile:    '👟 Mile',
  mid:     '👟 Mid',
  long:    '👟 Long',
  heart:   '♥  Heart (skill)',
  ace:     '♠  Ace',
  trash:   '🗑️  Trash',
};

const ICON_ORDER: Icon[] = [
  'speed', 'stamina', 'power', 'guts', 'wit',
  'turf', 'dirt', 'sprint', 'mile', 'mid', 'long',
  'heart', 'ace', 'trash',
];

function parseArgs() {
  const args = process.argv.slice(2);
  let jsonPath = '';
  const config: ClassifierConfig = { ...DEFAULT_CONFIG };

  for (let i = 0; i < args.length; i++) {
    switch (args[i]) {
      case '--keep':       config.keepPerCategory    = parseInt(args[++i]); break;
      case '--min-score':  config.minCategoryScore   = parseFloat(args[++i]); break;
      case '--heart':      config.heartWhiteThreshold = parseFloat(args[++i]); break;
      case '--ace':        config.aceScoreThreshold  = parseInt(args[++i]); break;
      default:
        if (!args[i].startsWith('--')) jsonPath = args[i];
    }
  }

  if (!jsonPath) {
    console.error('Usage: npm run cli -- <path-to-json> [--keep N] [--min-score N] [--heart N] [--ace N]');
    process.exit(1);
  }

  return { jsonPath, config };
}

function topScores(uma: ScoredUma, n = 3): string {
  return Object.entries(uma.scores)
    .sort((a, b) => b[1] - a[1])
    .slice(0, n)
    .map(([k, v]) => `${k}:${v.toFixed(1)}`)
    .join('  ');
}

function printTable(results: ScoredUma[]) {
  // Group by icon
  const groups = new Map<Icon, ScoredUma[]>();
  for (const icon of ICON_ORDER) groups.set(icon, []);

  for (const uma of results) {
    const icon = uma.assigned_icon!;
    groups.get(icon)!.push(uma);
  }

  const counts: Record<string, number> = {};
  for (const icon of ICON_ORDER) counts[icon] = groups.get(icon)!.length;

  console.log('\n═══════════════════════════════════════════════════════════');
  console.log('  UMA CLASSIFIER RESULTS');
  console.log('═══════════════════════════════════════════════════════════\n');

  for (const icon of ICON_ORDER) {
    const umas = groups.get(icon)!;
    if (umas.length === 0) continue;

    console.log(`${ICON_DISPLAY[icon]}  (${umas.length})`);
    console.log('─'.repeat(60));

    for (const uma of umas.sort((a, b) => b.rank_score - a.rank_score)) {
      const lock = uma.is_locked ? '🔒' : '  ';
      const whites = `whites:${uma.white_total.toFixed(1)}`;
      const scores = topScores(uma);
      console.log(`  ${lock} card:${uma.card_id}  id:${uma.trained_chara_id}  rs:${uma.rank_score}  ${whites}  [${scores}]`);
    }
    console.log();
  }

  // Summary
  console.log('═══════════════════════════════════════════════════════════');
  console.log('  SUMMARY');
  console.log('─'.repeat(60));
  for (const icon of ICON_ORDER) {
    if (counts[icon] > 0) {
      console.log(`  ${ICON_DISPLAY[icon].padEnd(20)} ${counts[icon]}`);
    }
  }
  console.log(`  ${'Total'.padEnd(20)} ${results.length}`);
  console.log('═══════════════════════════════════════════════════════════\n');
}

// ── Main ──────────────────────────────────────────────────────────────────────

const { jsonPath, config } = parseArgs();

let raw: unknown;
try {
  raw = JSON.parse(readFileSync(jsonPath, 'utf-8'));
} catch (e) {
  console.error(`Failed to read/parse JSON: ${e}`);
  process.exit(1);
}

if (!Array.isArray(raw)) {
  console.error('Expected a JSON array of uma objects.');
  process.exit(1);
}

console.log(`Loaded ${raw.length} umas from ${jsonPath}`);
console.log(`Config: keep=${config.keepPerCategory}, min-score=${config.minCategoryScore}, heart-threshold=${config.heartWhiteThreshold}, ace-threshold=${config.aceScoreThreshold}`);

const results = classifyRoster(raw as any, config);
printTable(results);
