/**
 * CLI usage:
 *   npm run cli -- <path-to-json> [--keep N] [--min-score N] [--heart N] [--ace N]
 *
 * Outputs a table of all umas sorted by assigned icon, with their top scores.
 */

import { readFileSync } from 'node:fs';
import { classifyRoster } from './classifier.ts';
import { buildSkillRelevanceMap, getRaceMap, lookupCharName } from './loader.ts';
import type { ClassifierConfig, Icon, RaceEnvironment, ScoredUma } from './types.ts';
import { DEFAULT_CONFIG } from './types.ts';

const C = {
  reset:   '\x1b[0m',
  bold:    '\x1b[1m',
  blue:    '\x1b[34m',
  cyan:    '\x1b[36m',
  magenta: '\x1b[35m',
  green:   '\x1b[32m',
  yellow:  '\x1b[33m',
  red:     '\x1b[31m',
  gray:    '\x1b[90m',
  white:   '\x1b[97m',
};
const c = (color: string, text: string) => `${color}${text}${C.reset}`;

const STYLE_PINKS_DISPLAY = new Set(['front', 'pace', 'late', 'end']);
const ICON_DISPLAY: Record<Icon, string> = {
  skip: 'Unlisted (skip)',
  dirt: '👟 Dirt',
  sprint: '👟 Sprint',
  mile: '👟 Mile',
  mid: '👟 Mid',
  long: '👟 Long',
  heart: '♥  Heart (skill)',
  clubs: '♣  Debuffer',
  ace: '♠  Ace',
  trash: '🗑️  Transfer',
};

const ICON_ORDER: Icon[] = [
  'dirt', 'sprint', 'mile', 'mid', 'long',
  'heart', 'clubs', 'ace', 'trash','skip'
];

function parseSingleArg(args: string[], i: number, type: 'int' | 'float', usage: string): number {
  const val = args[i + 1];
  const parsed = type === 'int' ? parseInt(val) : parseFloat(val);
  if (!val || isNaN(parsed) || (type === 'int' && parsed < 0)) {
    console.error(`Usage: ${usage}`);
    process.exit(1);
  }
  return parsed;
}

function parseArgs() {
  const args = process.argv.slice(2);
  let jsonPath = '';
  let showBreakdown = false;
  let raceId: number | null = null;
  let rankFilter: number | null = null;
  const config: ClassifierConfig = { ...DEFAULT_CONFIG };


  for (let i = 0; i < args.length; i++) {
    switch (args[i]) {
      case '--help':       jsonPath = ''; break;
      case '--keep':       config.keepPerCategory     = parseSingleArg(args, i++, 'int',   '--keep {N}          Keep top N umas per category (default: ' + DEFAULT_CONFIG.keepPerCategory + ')'); break;
      case '--min-score':  config.minCategoryScore    = parseSingleArg(args, i++, 'float', '--min-score {N}     Minimum score to qualify for a category (default: ' + DEFAULT_CONFIG.minCategoryScore + ')'); break;
      case '--heart':      config.heartWhiteThreshold = parseSingleArg(args, i++, 'float', '--heart {N}         Minimum white total for heart consideration (default: ' + DEFAULT_CONFIG.heartWhiteThreshold + ')'); break;
      case '--ace':        config.aceScoreThreshold   = parseSingleArg(args, i++, 'int',   '--ace {N}           Minimum rank score for ace fallback (default: ' + DEFAULT_CONFIG.aceScoreThreshold + ')'); break;
      case '--keep-ace':   config.keepAce             = parseSingleArg(args, i++, 'int',   '--keep-ace {N}      Max umas to assign ace icon (default: ' + DEFAULT_CONFIG.keepAce + ')'); break;
      case '--keep-heart': config.keepHeart           = parseSingleArg(args, i++, 'int',   '--keep-heart {N}    Max umas to assign heart icon (default: ' + DEFAULT_CONFIG.keepHeart + ')'); break;
      case '--trash':      config.numTrash            = parseSingleArg(args, i++, 'int',   '--trash {N}     Number of umas to consider for transfer. (default: ' + DEFAULT_CONFIG.numTrash + ')'); break;
      case '--race':       raceId                     = parseSingleArg(args, i++, 'int',   '--race {ID}         Target race ID for parent recommendations (example: --race 6019)'); break;
      case '--rank':       rankFilter                 = parseSingleArg(args, i++, 'int',   '--rank #            Filter output to umas with this rank score'); break;
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
        '  --keep N          Keep top N umas per category        (default: ' + DEFAULT_CONFIG.keepPerCategory + ')',
        '  --min-score N     Minimum score for category entry    (default: ' + DEFAULT_CONFIG.minCategoryScore + ')',
        '  --heart N         Minimum white total for hearts      (default: ' + DEFAULT_CONFIG.heartWhiteThreshold + ')',
        '  --ace N           Minimum rank score for ace          (default: ' + DEFAULT_CONFIG.aceScoreThreshold + ')',
        '  --keep-ace N      Max umas assigned ace icon          (default: ' + DEFAULT_CONFIG.keepAce + ')',
        '  --keep-heart N    Max umas assigned heart icon        (default: ' + DEFAULT_CONFIG.keepHeart + ')',
        '  --trash N         Number of umas to  transfer.        (default: ' + DEFAULT_CONFIG.numTrash + ')',
        '  --race ID         Target race ID for recommendations  (example: 6019)',
        '  --rank #          Filter output to umas with this rank score',
        '  --breakdown       Show a breakdown of scores (highly recommended to limit output with other options)'
    ].join('\n'));
    process.exit(1);
  }

  return { jsonPath, config, showBreakdown, raceId, rankFilter };
}

function allScores(uma: ScoredUma): string {
  const dist:   string[] = [];
  const whites: string[] = [];
  let style = '';

  for (const [k, v] of Object.entries(uma.scores).sort((a, b) => b[1] - a[1])) {
    if (v <= 0) continue;
    const val = v.toFixed(1);
    if (k.startsWith('style:')) {
      style = k.replace('style:', '') + ':' + val;
    } else if (['dirt','sprint','mile','mid','long'].includes(k)) {
      dist.push(`${k}:${val}`);
    } else if (['tSpd','spurt','accel','hp','nav'].includes(k)) {
      whites.push(`${k}:${val}`);
    }
  }

  style = style + (style ? ' ' : '');

  const parts: string[] = [];
  if (style)         parts.push(`${c(C.red, style.trim())}`);
  if (dist.length)   parts.push(`${c(C.magenta, dist.slice(0,2).join(' '))}`);
  if (whites.length) parts.push(`${c(C.yellow, whites.join(' '))}`);
  return parts.join('  ');
}

function printTable(
  results: ScoredUma[],
  config: ClassifierConfig,
  showBreakdown: boolean,
  rankFilter: number | null
) {
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
    .slice(0, config.keepPerCategory);

  if (raceResults.length > 0) {
    console.log('🤝 TOP RACE PARENTS');
    console.log('─'.repeat(60));
    for (const uma of raceResults) {
      const lock = uma.is_locked ? '🔒' : '  ';
      const name = lookupCharName(uma.card_id).padEnd(20).slice(0, 20);
      const icon = uma.assigned_icon?.padEnd(8) ?? '        ';
      console.log(`  ${lock} rs:${uma.rank_score}  ${name}  race:${uma.race_score.toFixed(1)}  whites:${uma.white_total.toFixed(1)}  [${icon}]`);

      if (showBreakdown && uma.factors.length > 0) {
        const sorted = [...uma.factors]
          .filter(w => (w as any).relevance > 0)
          .sort((a, b) => {if(b.contribution == undefined || a.contribution == undefined) return 0; else return (b.contribution - a.contribution)});
        for (const w of sorted) {
          const src = w.source === 'own' ? 'own' : 'par';
          const stars = ('★'.repeat(w.stars) + '☆'.repeat(3 - w.stars)).padEnd(3);
          const wname = w.name.padEnd(28).slice(0, 28);
          const rel = `rel:${((w as any).relevance ?? 0).toFixed(1)}`;
          const val = `→ ${w.contribution.toFixed(2)}`;
          console.log(`       ${src}  ${stars}  ${wname}  ${rel}  ${val}`);
        }
        console.log();
      }
    }
    console.log();
  }

  for (const icon of ICON_ORDER) {
    if (icon === 'skip') continue;
    const umas = groups.get(icon)!;
    if (umas.length === 0) continue;

    console.log(`${ICON_DISPLAY[icon]}  (${umas.length})`);
    console.log('─'.repeat(60));

    for (const uma of umas.sort((a, b) => b.rank_score - a.rank_score)) {
      if (rankFilter !== null && uma.rank_score !== rankFilter) continue;
      const lock = uma.is_locked ? '🔒' : '  ';
      const name = lookupCharName(uma.card_id).padEnd(20).slice(0, 20);
      const whites = `whites:${uma.white_total.toFixed(1)}`;
      const scores = allScores(uma);
      const raceStr = uma.race_score > 0 ? `race:${uma.race_score.toFixed(1)}`.padEnd(6) : '';
      console.log(` ${lock} rs:${uma.rank_score}  ${name}${whites.padEnd(12)}${raceStr} ${scores}`);

      if (showBreakdown) {
        const blues  = uma.factors.filter(f => f.type === 'blue');
        const pinks  = uma.factors.filter(f => f.type === 'pink');
        const greens  = uma.factors.filter(f => f.type === 'unique');
        const whites = uma.factors.filter(f => f.type === 'white')
          .sort((a, b) => (b.contribution ?? 0) - (a.contribution ?? 0));

        if (blues.length > 0) {
          console.log(`       ── Blues ──`);
          for (const f of blues) {
            const src   = f.source === 'own' ? 'own' : 'par';
            const stars = ('★'.repeat(f.stars) + '☆'.repeat(3 - f.stars)).padEnd(3);
            const name  = f.name.padEnd(12);
            const pen   = f.contribution < 0 ? c(C.red, `PENALTY`) : '';
            console.log(`       ${src}  ${stars}  ${name}  → all dist: ${f.contribution.toFixed(2)} ${pen}`);
          }
        }

        if (pinks.length > 0) {
          console.log(`       ── Pinks ──`);
          const dominantStyleForDisplay = Object.keys(uma.scores)
            .find(k => k.startsWith('style:'))
            ?.replace('style:', '') ?? null;
          for (const f of pinks) {
            const src   = f.source === 'own' ? 'own' : 'par';
            const stars = ('★'.repeat(f.stars) + '☆'.repeat(3 - f.stars)).padEnd(3);
            const name  = f.name.padEnd(14);
            const isStyle = STYLE_PINKS_DISPLAY.has(f.category);
            const isDom = f.category === dominantStyleForDisplay; // see note below
            const tag   = isStyle
              ? (isDom ? c(C.green, '[dominant]') : '[style]')
              : `→ ${f.category}`;
            const pen   = f.contribution < 0 ? c(C.red, 'PENALTY') : '';
            console.log(`       ${src}  ${stars}  ${name}  ${tag}  contrib:${f.contribution.toFixed(2)} ${pen}`);
          }
        }

        if (greens.length > 0) {
          console.log(`       ── Greens ──`);
          for (const w of greens) {
            const src    = w.source === 'own' ? 'own' : 'par';
            const stars  = ('★'.repeat(w.stars) + '☆'.repeat(3 - w.stars)).padEnd(3);
            const name   = (w.name + ' ').padEnd(28, '-').slice(0, 28);
            const catTag = w.skill_category ? ({
              'Speed Boost':  w.is_last_spurt ? '[End]' : '[Spd]',
              'Acceleration': '[Acl]',
              'Recovery':     '[HP] ',
              'Lane Effect':  '[Nav]',
              'Vision':       '[Nav]',
              'Debuff':       '[Dbf]',
            }[w.skill_category] ?? '-----') : '-----';
            const sb  = (w.special_bonus ?? 1) > 1
              ? `bon:${w.special_bonus!.toFixed(1)}x` : '---------';
            const val = `→ ${w.contribution.toFixed(2)}`;
            console.log(`       ${src} ${catTag} ${stars} ${name} ${sb} ${val}`);
          }
          console.log();
        }

        if (whites.length > 0) {
          console.log(`       ── Whites ──`);
          for (const w of whites) {
            const src    = w.source === 'own' ? 'own' : 'par';
            const stars  = ('★'.repeat(w.stars) + '☆'.repeat(3 - w.stars)).padEnd(3);
            const name   = (w.name + ' ').padEnd(28, '-').slice(0, 28);
            const catTag = w.skill_category ? ({
              'Speed Boost':  w.is_last_spurt ? '[End]' : '[Spd]',
              'Acceleration': '[Acl]',
              'Recovery':     '[HP] ',
              'Lane Effect':  '[Nav]',
              'Vision':       '[Nav]',
              'Debuff':       '[Dbf]',
            }[w.skill_category] ?? '-----') : '-----';
            const tags = [
              ...(w.dist_cats  ?? []).map(d => `[${d}]`),
              ...(w.style_cats ?? []).map(s => `[${s}]`),
              ...(w.surf_cats  ?? []).map(s => `[${s}]`),
            ].join('').padStart(12, '-');
            const pm  = (w.pink_multiplier ?? 1) > 1
              ? `pink:${w.pink_multiplier!.toFixed(2)}x` : '----------';
            const sb  = (w.special_bonus ?? 1) > 1
              ? `bon:${w.special_bonus!.toFixed(1)}x` : '---------';
            const val = `→ ${w.contribution.toFixed(2)}`;
            console.log(`       ${src} ${catTag} ${stars} ${name} ${tags} ${pm} ${sb} ${val}`);
          }
          console.log();
        }
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

const { jsonPath, config, showBreakdown, raceId, rankFilter } = parseArgs();

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

let skillRelevance: Map<number, number> | undefined;
if (raceId !== null) {
  const env: RaceEnvironment = { raceId };
  skillRelevance = buildSkillRelevanceMap(env) ?? undefined;
  if (!skillRelevance) {
    console.error(`Unknown race ID: ${raceId}`);
    process.exit(1);
  }
  const race = getRaceMap().get(raceId)!;
  console.log(`Target race: ${race.raceName} — ${race.distanceCategory} ${race.groundName} @ ${race.trackName}`);
}

const results = classifyRoster(raw as any, config, skillRelevance);

printTable(results, config, showBreakdown, rankFilter);
