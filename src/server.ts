/**
 * Simple web UI server.
 * Usage: npm run serve
 * Then open http://localhost:3000
 */

import { readFileSync } from 'node:fs';
import { createServer, IncomingMessage, ServerResponse } from 'node:http';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { classifyRoster, } from './classifier.ts';
import { lookupCharName } from './loader.ts';
import { DEFAULT_CONFIG } from './types.ts';

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
      const config = { ...DEFAULT_CONFIG, ...(body.config ?? {}), weights: { ...DEFAULT_CONFIG.weights, ...(body.config?.weights ?? {}) } };
      const results = classifyRoster(body.data, config);
      // Attach character names server-side
      const named = results.map(r => ({ ...r, name: lookupCharName(r.card_id) }));
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify(named));
    } catch (e) {
      res.writeHead(400, { 'Content-Type': 'text/plain' });
      res.end(String(e));
    }
    return;
  }

  res.writeHead(404);
  res.end('Not found');
});

server.listen(PORT, () => {
  console.log(`Uma Classifier running at http://localhost:${PORT}`);
});