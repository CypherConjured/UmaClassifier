/**
 * Simple web UI server.
 * Usage: npm run serve
 * Then open http://localhost:3000
 */

import { readFileSync } from 'node:fs';
import { createServer, IncomingMessage, ServerResponse } from 'node:http';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { classifyRoster } from './classifier.ts';
import { buildSkillRelevanceMap, getRaceMap, lookupCharName } from './loader.ts';
import { DEFAULT_CONFIG, RaceEnvironment } from './types.ts';

const PORT = 3000;

const __dirname = dirname(fileURLToPath(import.meta.url));
const HTML = readFileSync(join(__dirname, 'web-ui.html'), 'utf-8');

function readBody(req: IncomingMessage): Promise<string> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    req.on('data', c => chunks.push(c));
    req.on('end', () => resolve(Buffer.concat(chunks).toString()));
    req.on('error', reject);
  });
}

const server = createServer(async (req: IncomingMessage, res: ServerResponse) => {
  if (req.method === 'GET' && req.url === '/') {
    res.writeHead(200, { 'Content-Type': 'text/html' });
    res.end(HTML);
    return;
  }

  if (req.method === 'POST' && req.url === '/classify') {
    try {
      const body = JSON.parse(await readBody(req));
      const config = {
        ...DEFAULT_CONFIG,
        ...(body.config ?? {}),
        weights: {
          ...DEFAULT_CONFIG.weights,
          ...(body.config?.weights ?? {}),
          skillBonuses: {
            ...DEFAULT_CONFIG.weights.skillBonuses,
            ...(body.config?.weights?.skillBonuses ?? {}),
          },
          skillSparks: {
            own:    { ...DEFAULT_CONFIG.weights.skillSparks.own,    ...(body.config?.weights?.skillSparks?.own    ?? {}) },
            parent: { ...DEFAULT_CONFIG.weights.skillSparks.parent, ...(body.config?.weights?.skillSparks?.parent ?? {}) },
          },
          statSparks: {
            own:    { ...DEFAULT_CONFIG.weights.statSparks.own,    ...(body.config?.weights?.statSparks?.own    ?? {}) },
            parent: { ...DEFAULT_CONFIG.weights.statSparks.parent, ...(body.config?.weights?.statSparks?.parent ?? {}) },
          },
          mismatchMult: {
            ...DEFAULT_CONFIG.weights.mismatchMult,
            ...(body.config?.weights?.mismatchMult ?? {}),
          },
        },
      };
      const env: RaceEnvironment | undefined = body.targetRaceId
      ? {
          raceId:         body.targetRaceId,
          groundCondition: body.groundCondition ?? undefined,
          weather:         body.weather         ?? undefined,
          runningStyle:    body.runningStyle     ?? undefined,
        }
      : undefined;

      const skillRelevance = env
        ? buildSkillRelevanceMap(env) ?? undefined
        : undefined;
      const results = classifyRoster(body.data, config, skillRelevance);
      const named = results.map(r => ({ ...r, name: lookupCharName(r.card_id) }));
      const targetRace = env?.raceId ? (getRaceMap().get(env.raceId) ?? null) : null;
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ results: named, env, targetRace }));
    } catch (e) {
      res.writeHead(400, { 'Content-Type': 'text/plain' });
      res.end(String(e));
    }
    return;
  }

  if (req.method === 'GET' && req.url === '/races') {
    const races = Array.from(getRaceMap().values())
      .filter(r => r.grade === 100)
      .map(r => ({
        raceId: r.raceId,
        raceName: r.raceName,
        distanceCategory: r.distanceCategory,
        groundName: r.groundName,
        trackName: r.trackName,
        isCM: r.raceName.startsWith('Champions Meeting'),
      }));
    // Deduplicate by name, keeping first occurrence
    const seen = new Set<string>();
    const deduped = races.filter(r => {
      if (seen.has(r.raceName) || r.raceName.match("^.*(Meeting.*Finals|Room.Match|Team.Race).*$")) return false;
      seen.add(r.raceName);
      return true;
    });
    // CM races first, then alphabetical
    deduped.sort((a, b) => {
      if (a.isCM !== b.isCM) return a.isCM ? -1 : 1;
      return a.raceName.localeCompare(b.raceName);
    });
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify(deduped));
    return;
  }

  res.writeHead(404);
  res.end('Not found');
});

server.listen(PORT, () => {
  console.log(`Uma Classifier running at http://localhost:${PORT}`);
});