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

const FG = {
  blue:    '\x1b[34m',
  cyan:    '\x1b[36m',
  magenta: '\x1b[35m',
  green:   '\x1b[32m',
  yellow:  '\x1b[33m',
  red:     '\x1b[31m',
  gray:    '\x1b[90m',
  white:   '\x1b[97m',
};

const BG = {
  blue:    '\x1b[44m',
  cyan:    '\x1b[46m',
  magenta: '\x1b[45m',
  green:   '\x1b[42m',
  yellow:  '\x1b[43m',
  red:     '\x1b[41m',
  gray:    '\x1b[100m',
  white:   '\x1b[107m',
  brown:   '\x1b[43m',
};

const FMT = {
  reset:   '\x1b[0m',
  bold:    '\x1b[1m',
  dim:     '\x1b[2m',
  italic:  '\x1b[3m',
  underline: '\x1b[4m',
};

// For backwards compatibility with existing C references
const C = FG;

const c = (color: string, text: string) => `${color}${text}${FMT.reset}`;

const STYLE_PINKS_DISPLAY = new Set(['front', 'pace', 'late', 'end']);
const ICON_DISPLAY: Record<Icon, string> = {
  skip: 'Unlisted (skip)',
  unlock: 'Unlisted (unlock)',
  sprint: c(BG.magenta,'👟 ')+ 'Sprint',
  mile: c(BG.green, '👟 ') + 'Mile',
  mid: c(BG.yellow, '👟 ') + 'Mid',
  long: c(BG.blue, '👟 ') + 'Long',
  dirt: c(BG.red, '👟 ') + 'Dirt',
  heart: c(FG.red, ' ♥ ') + 'Heart (skill)',
  clubs: ' ♣ Debuffer',
  ace: ' ' +c(BG.white, '♠') + ' Ace',
  trash: '🗑️  Transfer',
};

const ICON_ORDER: Icon[] = [
  'sprint', 'mile', 'mid', 'long', 'dirt', 
  'heart', 'clubs', 'ace', 'trash','skip'
];

const WEATHER_MAP: Record<string, number> = {
  sunny: 1, sun: 1,
  cloudy: 2, cloud: 2,
  rainy: 3, rain: 3,
  snowy: 4, snow: 4,
};

const GROUND_COND_MAP: Record<string, number> = {
  firm: 1, good: 2, soft: 3, heavy: 4,
};

const SEASON_MAP: Record<string, number> = {
  spring: 1, summer: 2, fall: 3, autumn: 3, winter: 4,
};

function parseSingleArg(args: string[], i: number, type: 'int' | 'float', usage: string): number {
  const val = args[i + 1];
  const parsed = type === 'int' ? parseInt(val) : parseFloat(val);
  if (!val || isNaN(parsed) || (type === 'int' && parsed < 0)) {
    console.error(`Usage: ${usage}`);
    process.exit(1);
  }
  return parsed;
}

function parseNamedArg(args: string[], i: number, map: Record<string, number>, flag: string, usage: string): number {
  const raw = args[i + 1]?.toLowerCase();
  const val = map[raw] ?? parseInt(raw);
  if (!raw || isNaN(val)) {
    console.error(`Usage: ${flag} <${usage}>`);
    process.exit(1);
  }
  return val;
}

function parseArgs() {
  const args = process.argv.slice(2);
  let jsonPath = '';
  let showBreakdown = false;
  let showGrid = false;
  let raceId: number | null = null;
  let minRank: number | null = null;
  let maxRank: number | null = null;
  let weatherVal: number | null = null;
  let groundCondVal: number | null = null;
  let seasonVal: number | null = null;
  const config: ClassifierConfig = { ...DEFAULT_CONFIG };


  for (let i = 0; i < args.length; i++) {
    switch (args[i]) {
      case '--help':            jsonPath = ''; break;
      case '--keep':            config.keepPerArchetype   = parseSingleArg(args, i++, 'int',   '--keep {N}           Keep top N umas per archetype label (default: ' + DEFAULT_CONFIG.keepPerArchetype + ')'); break;
      case '--max-icon':        config.maxPerIcon          = parseSingleArg(args, i++, 'int',   '--max-icon {N}       Max umas per icon across all archetypes (default: ' + DEFAULT_CONFIG.maxPerIcon + ')'); break;
      case '--min-score':       config.minCategoryScore    = parseSingleArg(args, i++, 'float', '--min-score {N}      Minimum score to qualify for a category (default: ' + DEFAULT_CONFIG.minCategoryScore + ')'); break;
      case '--heart':           config.heartWhiteThreshold = parseSingleArg(args, i++, 'float', '--heart {N}          Minimum white total for heart consideration (default: ' + DEFAULT_CONFIG.heartWhiteThreshold + ')'); break;
      case '--ace':             config.aceScoreThreshold   = parseSingleArg(args, i++, 'int',   '--ace {N}            Minimum rank score for ace fallback (default: ' + DEFAULT_CONFIG.aceScoreThreshold + ')'); break;
      case '--keep-ace':        config.keepAce             = parseSingleArg(args, i++, 'int',   '--keep-ace {N}       Max umas to assign ace icon (default: ' + DEFAULT_CONFIG.keepAce + ')'); break;
      case '--keep-heart':      config.keepHeart           = parseSingleArg(args, i++, 'int',   '--keep-heart {N}     Max umas to assign heart icon (default: ' + DEFAULT_CONFIG.keepHeart + ')'); break;
      case '--trash':           config.numTrash            = parseSingleArg(args, i++, 'int',   '--trash {N}          Number of umas to consider for transfer. (default: ' + DEFAULT_CONFIG.numTrash + ')'); break;
      case '--race':            raceId                     = parseSingleArg(args, i++, 'int',   '--race {ID}          Target race ID for parent recommendations (example: --race 6019)'); break;
      case '--min-rank':        minRank                    = parseSingleArg(args, i++, 'int',   '--min-rank #         Show only umas at or above this rank score'); break;
      case '--max-rank':        maxRank                    = parseSingleArg(args, i++, 'int',   '--max-rank #         Show only umas at or below this rank score'); break;
      case '--weather':         weatherVal                 = parseNamedArg(args, i++, WEATHER_MAP,    '--weather',    'sunny|cloudy|rainy|snowy'); break;
      case '--ground-cond':     groundCondVal              = parseNamedArg(args, i++, GROUND_COND_MAP,'--ground-cond','firm|good|soft|heavy'); break;
      case '--season':          seasonVal                  = parseNamedArg(args, i++, SEASON_MAP,     '--season',     'spring|summer|fall|winter'); break;
      case '--breakdown': {
        showBreakdown = true;
        const next = args[i + 1];
        if (next && !next.startsWith('--') && !isNaN(parseInt(next))) {
          minRank = parseInt(next);
          maxRank = parseInt(next);
          i++;
        }
        break;
      }
      case '--grid':            showGrid                   = true; break;
      default:
        if (!args[i].startsWith('--')) jsonPath = args[i];
      }
    }

    if (!jsonPath) {
      console.error([
        'Usage: npm run cli -- <path-to-json> [options]',
        '',
        'Options:',
        '  --keep N          Keep top N umas per archetype label (default: ' + DEFAULT_CONFIG.keepPerArchetype + ')',
        '  --max-icon N      Max umas per icon across archetypes (default: ' + DEFAULT_CONFIG.maxPerIcon + ')',
        '  --min-score N     Minimum score for category entry    (default: ' + DEFAULT_CONFIG.minCategoryScore + ')',
        '  --heart N         Minimum white total for hearts      (default: ' + DEFAULT_CONFIG.heartWhiteThreshold + ')',
        '  --ace N           Minimum rank score for ace          (default: ' + DEFAULT_CONFIG.aceScoreThreshold + ')',
        '  --keep-ace N      Max umas assigned ace icon          (default: ' + DEFAULT_CONFIG.keepAce + ')',
        '  --keep-heart N    Max umas assigned heart icon        (default: ' + DEFAULT_CONFIG.keepHeart + ')',
        '  --trash N         Number of umas to transfer          (default: ' + DEFAULT_CONFIG.numTrash + ')',
        '  --race ID         Target race ID for recommendations  (example: 6019)',
        '  --weather W       Race weather condition (sunny|cloudy|rainy|snowy)  — requires --race',
        '  --ground-cond G   Ground condition (firm|good|soft|heavy)           — requires --race',
        '  --season S        Race season (spring|summer|fall|winter)            — requires --race',
        '  --min-rank #      Show only umas at or above this rank score',
        '  --max-rank #      Show only umas at or below this rank score',
        '  --breakdown [N]   Show score breakdown; optional exact rank score N limits output to that uma',
        '  --grid            Print a 5-column veterans grid sorted by rank score',
    ].join('\n'));
    process.exit(1);
  }

  return { jsonPath, config, showBreakdown, showGrid, raceId, minRank, maxRank, weatherVal, groundCondVal, seasonVal };
}

// ─── Icon color/label config for grid display ─────────────────────────────────
// Labels are exactly 2 ASCII chars — no emoji — so terminal column math is exact.

const GRID_ICON: Record<Icon, { label: string; color: string }> = {
  dirt:   { label: 'DT', color: BG.red  },
  sprint: { label: 'SP', color: BG.magenta },
  mile:   { label: 'MI', color: BG.green   },
  mid:    { label: 'MD', color: BG.yellow  },
  long:   { label: 'LG', color: BG.blue    },
  heart:  { label: 'HT', color: FG.red     },
  clubs:  { label: 'CB', color: FG.white   },
  ace:    { label: 'AC', color: BG.white   },
  trash:  { label: 'TR', color: BG.gray    },
  unlock: { label: 'xx', color: FG.red     },
  skip:   { label: '--', color: FG.gray    },
};

const GRID_COLS     = 5;
const GRID_MAX_ROWS = 50;
const GRID_INFO_W   = 13; // name chars per cell
const GRID_ANSI_W  = 5; // ANSI color codes per cell (not fixed, but roughly estimated for padding purposes)
// Cell top layout (visual): [XX](4) + space(1) + name(12) + border(1) = 18 chars
// Cell bot layout (visual): score(4) + space(1) + rank(5) + space(1) + name(12) + border(1) = 18 chars
const GRID_CELL_W   = GRID_ANSI_W + GRID_INFO_W; // total chars per cell including ANSI codes and borders

function printGrid(results: ScoredUma[]): void {
  const sorted = [...results]
    .sort((a, b) => b.rank_score - a.rank_score)
    .slice(0, GRID_COLS * GRID_MAX_ROWS);

  const rows = Math.ceil(sorted.length / GRID_COLS);

  console.log('\n═══════════════════════════════════════════════════════════');
  console.log('  VETERANS GRID  (sorted by rank score, 5 columns)');
  console.log('═══════════════════════════════════════════════════════════\n');

  for (let row = 0; row < rows; row++) {
    const topParts: string[] = [];
    const botParts: string[] = [];
    const border: string[] = [];
    for (let col = 0; col < GRID_COLS; col++) {
      const uma = sorted[row * GRID_COLS + col];
      if (!uma) break;
      // if (!uma) { topParts.push(' '.repeat(GRID_CELL_W));
      //   botParts.push(' '.repeat(GRID_CELL_W));
      //   border.push(' '.repeat(GRID_CELL_W));
      //   continue;
      // }

      const gi   = GRID_ICON[uma.assigned_icon ?? 'skip']; // we don't actually have to check assigned_icon presence here because the classifier guarantees it will be set to at least 'skip'
      const rs   = String(uma.rank_score).padEnd(GRID_INFO_W-1);
      const name = lookupCharName(uma.card_id).slice(0, GRID_INFO_W).padEnd(GRID_INFO_W);

      topParts.push(`${c(gi.color, `[${gi.label}]`)} ${name}`);
      if(uma.assigned_icon === 'clubs')
        botParts.push(`${c(FMT.italic, uma.debuff_score.toPrecision(3).padStart(4))}d ${rs}`);
      else
        botParts.push(`${c(FMT.italic, uma.quality_score.toPrecision(3).padStart(4))}q ${rs}`);
      border.push('-'.repeat(GRID_CELL_W));
    }

    console.log('|' + topParts.join(' | ') + ' |' );
    console.log('|' + botParts.join(' | ') + ' |' );
    console.log('|' + border.join('-|-') + '-|' );
  }

  console.log(`\n  ${sorted.length} umas\n`);
}

// Shows the archetype vector top values and white skill type breakdown.
function allScores(uma: ScoredUma): string {
  const v = uma.archetype_vector;

  // Top surface value
  const surfParts = (['turf', 'dirt'] as const)
    .map(cat => ({ cat, val: v.surface[cat] ?? 0 }))
    .filter(x => x.val > 0)
    .sort((a, b) => b.val - a.val)
    .slice(0, 1)
    .map(x => `${x.cat}:${x.val.toFixed(1)}`);

  // Top distance value
  const distParts = (['sprint', 'mile', 'mid', 'long'] as const)
    .map(cat => ({ cat, val: v.distance[cat] ?? 0 }))
    .filter(x => x.val > 0)
    .sort((a, b) => b.val - a.val)
    .slice(0, 1)
    .map(x => `${x.cat}:${x.val.toFixed(1)}`);

  // Top style value
  const styleParts = (['front', 'pace', 'late', 'end'] as const)
    .map(cat => ({ cat, val: v.style[cat] ?? 0 }))
    .filter(x => x.val > 0)
    .sort((a, b) => b.val - a.val)
    .slice(0, 1)
    .map(x => `${x.cat}:${x.val.toFixed(1)}`);

  // White type breakdown from scores
  const whites: string[] = [];
  for (const [k, val] of Object.entries(uma.scores).sort((a, b) => b[1] - a[1])) {
    if (val <= 0) continue;
    if (['tSpd','spurt','accel','hp','nav'].includes(k)) whites.push(`${k}:${val.toFixed(1)}`);
  }

  const parts: string[] = [];
  if (styleParts.length) parts.push(c(FG.red,     styleParts.join(' ')));
  if (surfParts.length)  parts.push(c(FG.cyan,    surfParts.join(' ')));
  if (distParts.length)  parts.push(c(FG.magenta, distParts.join(' ')));
  if (whites.length)     parts.push(c(FG.yellow,  whites.join(' ')));
  return parts.join('  ');
}

function printTable(
  results: ScoredUma[],
  config: ClassifierConfig,
  showBreakdown: boolean,
  minRank: number | null,
  maxRank: number | null
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
    .slice(0, config.maxPerIcon);

  if (raceResults.length > 0) {
    console.log('🤝 TOP RACE PARENTS');
    console.log('─'.repeat(60));
    for (const uma of raceResults) {
      const lock = uma.is_locked ? '🔒' : '  ';
      const name = lookupCharName(uma.card_id).padEnd(20).slice(0, 20);
      const icon = uma.assigned_icon?.padEnd(8) ?? '        ';
      console.log(`  ${lock} rs:${uma.rank_score}  ${name}  race:${uma.race_score.toFixed(1)}  whites:${uma.white_total.toFixed(1)}  [${icon}]`);

      if (showBreakdown && uma.factors.length > 0) {
        console.log(`       ── Race ──  race:${uma.race_score.toFixed(1)}  (whites:${uma.white_total.toFixed(1)})`);
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

    const visibleUmas = umas.filter(u =>
      (minRank === null || u.rank_score >= minRank) &&
      (maxRank === null || u.rank_score <= maxRank)
    );
    if (visibleUmas.length === 0) continue;

    console.log(`${ICON_DISPLAY[icon]}  (${umas.length})`);
    console.log('─'.repeat(60));

    for (const uma of visibleUmas.sort((a, b) => b.quality_score - a.quality_score)) {
      const lock      = uma.is_locked ? '🔒' : '  ';
      const name      = lookupCharName(uma.card_id).padEnd(20).slice(0, 20);
      const archLabel = c(FG.cyan, uma.archetype_label.label.padEnd(22).slice(0, 22));
      const qStr      = icon === 'clubs'
        ? `d:${uma.debuff_score.toFixed(1)}`.padEnd(10)
        : `q:${uma.quality_score.toFixed(1)}`.padEnd(10);
      const raceStr   = uma.race_score > 0 ? `race:${uma.race_score.toFixed(1)}  ` : '';
      const scores    = allScores(uma);
      console.log(` ${lock} rs:${uma.rank_score}  ${name}  ${archLabel}  ${qStr}${raceStr}${scores}`);

      if (showBreakdown) {
        // Score composition header — debuff umas show d: as primary metric
        if (icon === 'clubs') {
          console.log(`       ── Debuff ──  d:${uma.debuff_score.toFixed(1)}  (q:${uma.quality_score.toFixed(1)}  whites:${uma.white_total.toFixed(1)})`);
        } else {
          const blueContrib = uma.quality_score - uma.white_total;
          console.log(`       ── Quality ──  q:${uma.quality_score.toFixed(1)}  (blues:${blueContrib.toFixed(1)}  whites:${uma.white_total.toFixed(1)})`);
        }

        // Archetype vector — all dimension values, winner marked with *
        const av = uma.archetype_vector;
        const winSurf = uma.archetype_label.surface;
        const winDist = uma.archetype_label.distance;
        const winStyle = uma.archetype_label.style;
        const fmtDim = (dim: Record<string, number>, keys: string[], winner: string) =>
          keys.map(k => {
            const v = dim[k] ?? 0;
            return v > 0 ? `${k}:${v.toFixed(1)}${k === winner ? '*' : ''}` : null;
          }).filter(Boolean).join('  ');
        console.log(`       ── Archetype ──  ${uma.archetype_label.label}`);
        console.log(`           surface:  ${fmtDim(av.surface,  ['turf','dirt'],                   winSurf)}`);
        console.log(`           distance: ${fmtDim(av.distance, ['sprint','mile','mid','long'],     winDist)}`);
        console.log(`           style:    ${fmtDim(av.style,    ['front','pace','late','end'],      winStyle)}`);

        const blues  = uma.factors.filter(f => f.type === 'blue');
        const pinks  = uma.factors.filter(f => f.type === 'pink');
        const greens  = uma.factors.filter(f => f.type === 'unique');
        const whites = uma.factors.filter(f => f.type === 'white')
          .sort((a, b) => {
            const ea = (a.contribution ?? 0) * (a.style_mult ?? 1);
            const eb = (b.contribution ?? 0) * (b.style_mult ?? 1);
            return eb - ea;
          });

        if (blues.length > 0) {
          console.log(`       ── Blues ──`);
          for (const f of blues) {
            const src   = f.source === 'own' ? 'own' : 'par';
            const stars = ('★'.repeat(f.stars) + '☆'.repeat(3 - f.stars)).padEnd(3);
            const name  = f.name.padEnd(12);
            const pen   = f.contribution < 0 ? c(FG.red, `PENALTY`) : '';
            console.log(`       ${src}  ${stars}  ${name}  → ${f.contribution.toFixed(2)} ${pen}`);
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
            const tag   = `→ ${f.category}`;
            const pen   = f.contribution < 0 ? c(FG.red, 'PENALTY') : '';
            console.log(`       ${src}  ${stars}  ${name}  ${tag}  ${f.contribution.toFixed(2)} ${pen}`);
          }
          console.log();
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
            const styleMult = w.style_mult ?? 1.0;
            const isStyleGated = styleMult === 0;
            const pm  = isStyleGated
              ? c(FG.gray, 'pink:0.0x ')
              : (w.pink_multiplier ?? 1) > 1
                ? `pink:${w.pink_multiplier!.toFixed(2)}x` : '----------';
            const sb  = (w.special_bonus ?? 1) > 1
              ? `bonus:${w.special_bonus!.toFixed(1)}x` : '----------';
            const rawContrib = w.stat_boost ? (w.stat_boost_contribution ?? w.contribution) : w.contribution;
            const effectiveContrib = rawContrib * styleMult;
            const statTag = (!isStyleGated && w.stat_boost) ? c(FG.yellow, `[stat:${w.stat_boost}]`) : '';
            const tags = [
              ...(w.dist_cats  ?? []).map(d => `[${d}]`),
              ...(w.style_cats ?? []).map(s => `[${s}]`),
              ...(w.surf_cats  ?? []).map(s => `[${s}]`),
            ].join('');
            const val = `→ ${effectiveContrib.toFixed(2)}${tags ? ' ' + tags : ''}${statTag ? ' ' + statTag : ''}`;
            console.log(`       ${src} ${catTag} ${stars} ${name} ${pm} ${sb} ${val}`);
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

const { jsonPath, config, showBreakdown, showGrid, raceId, minRank, maxRank, weatherVal, groundCondVal, seasonVal } = parseArgs();

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
console.log(`Config: keep-archetype=${config.keepPerArchetype}, max-icon=${config.maxPerIcon}, min-score=${config.minCategoryScore}, heart-threshold=${config.heartWhiteThreshold}, ace-threshold=${config.aceScoreThreshold}`);

const WEATHER_LABEL: Record<number, string>    = { 1: 'Sunny', 2: 'Cloudy', 3: 'Rainy', 4: 'Snowy' };
const GROUND_COND_LABEL: Record<number, string> = { 1: 'Firm', 2: 'Good', 3: 'Soft', 4: 'Heavy' };
const SEASON_LABEL: Record<number, string>      = { 1: 'Spring', 2: 'Summer', 3: 'Fall', 4: 'Winter' };

let skillRelevance: Map<number, number> | undefined;
if (raceId !== null) {
  const env: RaceEnvironment = {
    raceId,
    ...(weatherVal    != null && { weather:         weatherVal    }),
    ...(groundCondVal != null && { groundCondition: groundCondVal }),
    ...(seasonVal     != null && { season:          seasonVal     }),
  };
  skillRelevance = buildSkillRelevanceMap(env) ?? undefined;
  if (!skillRelevance) {
    console.error(`Unknown race ID: ${raceId}`);
    process.exit(1);
  }
  const race = getRaceMap().get(raceId)!;
  const condParts: string[] = [];
  if (weatherVal    != null) condParts.push(WEATHER_LABEL[weatherVal]);
  if (groundCondVal != null) condParts.push(GROUND_COND_LABEL[groundCondVal]);
  if (seasonVal     != null) condParts.push(SEASON_LABEL[seasonVal]);
  const condStr = condParts.length ? `  [${condParts.join(', ')}]` : '';
  console.log(`Target race: ${race.raceName} — ${race.distanceCategory} ${race.groundName} @ ${race.trackName}${condStr}`);
}

const results = classifyRoster(raw as any, config, skillRelevance);

if (showGrid) printGrid(results); 
else printTable(results, config, showBreakdown, minRank, maxRank);
