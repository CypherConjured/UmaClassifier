/**
 * CLI usage:
 *   npm run cli -- <path-to-json> [--keep N] [--min-score N] [--heart N] [--ace N]
 *
 * Outputs a table of all umas sorted by assigned icon, with their top scores.
 */

import { readFileSync } from 'node:fs';
import { classifyRoster, whiteToCategory } from './classifier.ts';
import { DEFAULT_CONFIG } from './types.ts';
import { lookupCharName, buildSkillRelevanceMap, getRaceMap, lookupFactor } from './loader.ts';
import type { ClassifierConfig, Icon, ScoredUma } from './types.ts';

const ICON_DISPLAY: Record<Icon, string> = {
  speed: '🥤 Speed',
  stamina: '🍚 Stamina',
  power: '🍫 Power',
  guts: '🥕 Guts',
  wit: '🍰 Wit',
  turf: '♦  Turf',
  dirt: '👟 Dirt',
  sprint: '👟 Sprint',
  mile: '👟 Mile',
  mid: '👟 Mid',
  long: '👟 Long',
  heart: '♥  Heart (skill)',
  clubs: '♣  Debuffer',
  ace: '♠  Ace',
  trash: '🗑️  Trash',
};

const ICON_ORDER: Icon[] = [
  'speed', 'stamina', 'power', 'guts', 'wit',
  'turf', 'dirt', 'sprint', 'mile', 'mid', 'long',
  'heart', 'clubs', 'ace', 'trash',
];

function parseSingleArg(args: string[], i: number, type: 'int' | 'float', usage: string): number {
  const val = args[i + 1];
  const parsed = type === 'int' ? parseInt(val) : parseFloat(val);
  if (!val || isNaN(parsed) || (type === 'int' && parsed <= 0)) {
    console.error(`Usage: ${usage}`);
    process.exit(1);
  }
  return parsed;
}

function parseArgs() {
  const args = process.argv.slice(2);
  let jsonPath = '';
  let showWhites = false;
  let showBreakdown = false;
  let raceId: number | null = null;
  const config: ClassifierConfig = { ...DEFAULT_CONFIG };


  for (let i = 0; i < args.length; i++) {
    switch (args[i]) {
      case '--keep':       config.keepPerCategory     = parseSingleArg(args, i++, 'int',   '--keep {N}          Keep top N umas per category (default: 7)'); break;
      case '--min-score':  config.minCategoryScore    = parseSingleArg(args, i++, 'float', '--min-score {N}     Minimum score to qualify for a category (default: 2)'); break;
      case '--heart':      config.heartWhiteThreshold = parseSingleArg(args, i++, 'float', '--heart {N}         Minimum white total for heart consideration (default: 6)'); break;
      case '--ace':        config.aceScoreThreshold   = parseSingleArg(args, i++, 'int',   '--ace {N}           Minimum rank score for ace fallback (default: 11000)'); break;
      case '--keep-ace':   config.keepAce             = parseSingleArg(args, i++, 'int',   '--keep-ace {N}      Max umas to assign ace icon (default: 20)'); break;
      case '--keep-heart': config.keepHeart           = parseSingleArg(args, i++, 'int',   '--keep-heart {N}    Max umas to assign heart icon (default: 20)'); break;
      case '--race':       raceId                     = parseSingleArg(args, i++, 'int',   '--race {ID}         Target race ID for parent recommendations (example: --race 6019)'); break;
      case '--whites':     showWhites                 = true; break;
      case '--breakdown':  showBreakdown              = true; break;
      default:
        if (!args[i].startsWith('--')) jsonPath = args[i];
    }
  }

  if (!jsonPath) {
    console.error([
      'Usage: npm run cli -- <path-to-json> [options]',
      '',
      'Options:',
      '  --keep N          Keep top N umas per category        (default: 7)',
      '  --min-score N     Minimum score for category entry    (default: 2)',
      '  --heart N         Minimum white total for hearts      (default: 6)',
      '  --ace N           Minimum rank score for ace          (default: 11000)',
      '  --keep-ace N      Max umas assigned ace icon          (default: 20)',
      '  --keep-heart N    Max umas assigned heart icon        (default: 20)',
      '  --race ID         Target race ID for recommendations  (example: 6019)',
      '  --whites          Show white spark breakdown per uma',
    ].join('\n'));
    process.exit(1);
  }

  return { jsonPath, config, showWhites, showBreakdown, raceId };
}

function allScores(uma: ScoredUma): string {
  return Object.entries(uma.scores)
    .filter(([, v]) => v > 0)
    .sort((a, b) => b[1] - a[1])
    .map(([k, v]) => `${k}:${v.toFixed(1)}`)
    .join('  ');
}

function topScores(uma: ScoredUma, n = 3): string {
  return Object.entries(uma.scores)
    .sort((a, b) => b[1] - a[1])
    .slice(0, n)
    .map(([k, v]) => `${k}:${v.toFixed(1)}`)
    .join('  ');
}

function printTable(results: ScoredUma[], showWhites: boolean, showBreakdown: boolean) {
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

  // ── Race recommendations ───────────────────────────────────────────────────
  const raceResults = [...results]
    .filter(u => u.race_score > 0)
    .sort((a, b) => b.race_score - a.race_score)
    .slice(0, 7);

  if (raceResults.length > 0) {
    console.log('🤝 TOP RACE PARENTS');
    console.log('─'.repeat(60));
    for (const uma of raceResults) {
      const lock = uma.is_locked ? '🔒' : '  ';
      const name = lookupCharName(uma.card_id).padEnd(20).slice(0, 20);
      const icon = uma.assigned_icon?.padEnd(8) ?? '        ';
      console.log(`  ${lock} rs:${uma.rank_score}  ${name}  race:${uma.race_score.toFixed(1)}  whites:${uma.white_total.toFixed(1)}  [${icon}]`);

      if (showWhites && uma.whites.length > 0) {
        const sorted = [...uma.whites]
          .filter(w => (w as any).relevance > 0)
          .sort((a, b) => b.final_value - a.final_value);
        for (const w of sorted) {
          const src = w.source === 'own' ? 'own' : 'par';
          const stars = ('★'.repeat(w.stars) + '☆'.repeat(3 - w.stars)).padEnd(3);
          const wname = w.name.padEnd(28).slice(0, 28);
          const rel = `rel:${((w as any).relevance ?? 0).toFixed(1)}`;
          const val = `→ ${w.final_value.toFixed(2)}`;
          console.log(`       ${src}  ${stars}  ${wname}  ${rel}  ${val}`);
        }
        console.log();
      }
    }
    console.log();
  }

  for (const icon of ICON_ORDER) {
    const umas = groups.get(icon)!;
    if (umas.length === 0) continue;

    console.log(`${ICON_DISPLAY[icon]}  (${umas.length})`);
    console.log('─'.repeat(60));

    for (const uma of umas.sort((a, b) => b.rank_score - a.rank_score)) {
      const lock = uma.is_locked ? '🔒' : '  ';
      const name = lookupCharName(uma.card_id).padEnd(20).slice(0, 20);
      const whites = `whites:${uma.white_total.toFixed(1)}`;
      const scores = allScores(uma);
      const raceStr = uma.race_score > 0 ? `  race:${uma.race_score.toFixed(1)}` : '';
      console.log(`  ${lock} rs:${uma.rank_score}  ${name}  whites:${uma.white_total.toFixed(1)}${raceStr}  [${scores}]`);

      if (showWhites && uma.whites.length > 0) {
        const sorted = [...uma.whites].sort((a, b) => b.final_value - a.final_value);
        for (const w of sorted) {
          const src = w.source === 'own' ? 'own' : 'par';
          const stars = ('★'.repeat(w.stars) + '☆'.repeat(3 - w.stars)).padEnd(3);
          const name = (w.name + ' ').padEnd(28,'-').slice(0, 28);

          // Performance category this white routed to
          const f = lookupFactor(w.factor_id);

          // Skill category short tag
          const catTag = f?.skill_category ? ({
            'Speed Boost': f.is_last_spurt ? '[End]' : '[Spd]',
            'Acceleration': '[Acl]',
            'Recovery': '[HP] ',
            'Lane Effect': '[Nav]',
            'Vision': '[Nav]',
            'Debuff': '[Dbf]',
            'Unique': '[Unq]',
          }[f.skill_category] ?? '-----') : '-----';

          const tags = [
            ...w.dist_cats.map(c => `[${c}]`),
            ...w.style_cats.map(c => `[${c}]`),
            ...w.surf_cats.map(c => `[${c}]`),
          ].join('').padStart(15,'-');

          const pm = w.pink_multiplier > 1 ? `pink:${w.pink_multiplier.toFixed(2)}x` : '----------';
          const sb = w.special_bonus > 1 ? `bonus:${w.special_bonus.toFixed(1)}x` : '----------';
          const val = `→ ${w.final_value.toFixed(2)}`;
          console.log(`       ${src} ${catTag} ${stars} ${name} ${tags} ${pm} ${sb} ${val}`);
        }
        console.log();
      }
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

const { jsonPath, config, showWhites, showBreakdown, raceId } = parseArgs();

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

// After loading JSON, before classifyRoster:
let skillRelevance: Map<number, number> | undefined;
if (raceId !== null) {
  skillRelevance = buildSkillRelevanceMap(raceId) ?? undefined;
  if (!skillRelevance) {
    console.error(`Unknown race ID: ${raceId}`);
    process.exit(1);
  }
  const race = getRaceMap().get(raceId)!;
  console.log(`Target race: ${race.raceName} — ${race.distanceCategory} ${race.groundName} @ ${race.trackName}`);
}

const results = classifyRoster(raw as any, config, skillRelevance);

printTable(results, showWhites, showBreakdown);
