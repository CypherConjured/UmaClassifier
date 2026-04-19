/**
 * Simple web UI server.
 * Usage: npm run serve
 * Then open http://localhost:3000
 */

import { createServer, IncomingMessage, ServerResponse } from 'node:http';
import { classifyRoster } from './classifier.ts';
import { DEFAULT_CONFIG } from './types.ts';

const PORT = 3000;

const HTML = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Uma Classifier</title>
  <style>
    body { font-family: system-ui, sans-serif; max-width: 900px; margin: 2rem auto; padding: 0 1rem; background: #f9f6f0; color: #333; }
    h1 { font-size: 1.5rem; margin-bottom: 0.25rem; }
    .subtitle { color: #888; font-size: 0.9rem; margin-bottom: 2rem; }
    .controls { display: flex; flex-wrap: wrap; gap: 1rem; align-items: flex-end; margin-bottom: 1.5rem; background: white; padding: 1rem; border-radius: 8px; box-shadow: 0 1px 4px #0001; }
    .field { display: flex; flex-direction: column; gap: 0.25rem; }
    label { font-size: 0.8rem; color: #666; font-weight: 600; }
    input[type=number] { width: 70px; padding: 0.4rem; border: 1px solid #ddd; border-radius: 4px; }
    input[type=file] { font-size: 0.9rem; }
    button { padding: 0.5rem 1.2rem; background: #e8934a; color: white; border: none; border-radius: 5px; cursor: pointer; font-size: 0.95rem; }
    button:hover { background: #d4823b; }
    .results { display: none; }
    .group { background: white; border-radius: 8px; box-shadow: 0 1px 4px #0001; margin-bottom: 1rem; overflow: hidden; }
    .group-header { padding: 0.6rem 1rem; font-weight: 700; font-size: 1rem; display: flex; justify-content: space-between; }
    .group-body { padding: 0 0.5rem 0.5rem; }
    table { width: 100%; border-collapse: collapse; font-size: 0.85rem; }
    th { text-align: left; padding: 0.3rem 0.5rem; color: #888; font-size: 0.75rem; border-bottom: 1px solid #eee; }
    td { padding: 0.35rem 0.5rem; border-bottom: 1px solid #f5f5f5; }
    tr:last-child td { border-bottom: none; }
    .lock { color: #aaa; }
    .score-bar { display: inline-block; height: 8px; background: #e8934a; border-radius: 4px; margin-right: 4px; vertical-align: middle; }
    .icon-speed   { background: #6ab0e8; }
    .icon-stamina { background: #e86a91; }
    .icon-power   { background: #e8a83a; }
    .icon-guts    { background: #e86a6a; }
    .icon-wit     { background: #8de86a; }
    .icon-turf    { background: #6ae8c8; }
    .icon-dirt    { background: #c8a878; }
    .icon-sprint  .score-bar, .icon-mile .score-bar, .icon-mid .score-bar, .icon-long .score-bar { background: #7878e8; }
    .icon-heart   { background: #e86ab0; }
    .icon-ace     { background: #333; color: white; }
    .icon-trash   { background: #ccc; color: #666; }
    .summary { background: white; border-radius: 8px; padding: 1rem; margin-bottom: 2rem; box-shadow: 0 1px 4px #0001; display: flex; flex-wrap: wrap; gap: 0.5rem; }
    .summary-chip { padding: 0.2rem 0.6rem; border-radius: 12px; font-size: 0.8rem; background: #f0f0f0; }
    .error { color: #c00; background: #fff0f0; padding: 1rem; border-radius: 8px; }
  </style>
</head>
<body>
  <h1>🏇 Uma Classifier</h1>
  <p class="subtitle">Drop your roster JSON to score and assign favorite icons based on sparks.</p>

  <div class="controls">
    <div class="field">
      <label>Roster JSON</label>
      <input type="file" id="fileInput" accept=".json">
    </div>
    <div class="field">
      <label>Keep per category</label>
      <input type="number" id="keepN" value="7" min="1" max="50">
    </div>
    <div class="field">
      <label>Min score</label>
      <input type="number" id="minScore" value="2" min="0" step="0.5">
    </div>
    <div class="field">
      <label>Heart threshold</label>
      <input type="number" id="heartThresh" value="6" min="0" step="0.5">
    </div>
    <div class="field">
      <label>Ace rank score</label>
      <input type="number" id="aceThresh" value="11000" min="0" step="100">
    </div>
    <button onclick="run()">Classify</button>
  </div>

  <div id="results" class="results"></div>

  <script>
    const ICON_LABEL = {
      speed:   '🧋 Speed sparks',
      stamina: '🍚 Stamina sparks',
      power:   '🍫 Power sparks',
      guts:    '🥕 Guts sparks',
      wit:     '🍰 Wit sparks',
      turf:    '♦ Turf sparks',
      dirt:    '👟 Dirt sparks',
      sprint:  '👟 Sprint sparks',
      mile:    '👟 Mile sparks',
      mid:     '👟 Mid sparks',
      long:    '👟 Long sparks',
      heart:   '♥ Skill sparks',
      ace:     '♠ Ace',
      trash:   '🗑️ Trash',
    };
    const ICON_ORDER = ['speed','stamina','power','guts','wit','turf','dirt','sprint','mile','mid','long','heart','ace','trash'];

    async function run() {
      const file = document.getElementById('fileInput').files[0];
      if (!file) { alert('Please select a JSON file.'); return; }

      const config = {
        keepPerCategory:    parseInt(document.getElementById('keepN').value),
        minCategoryScore:   parseFloat(document.getElementById('minScore').value),
        heartWhiteThreshold: parseFloat(document.getElementById('heartThresh').value),
        aceScoreThreshold:  parseInt(document.getElementById('aceThresh').value),
      };

      const text = await file.text();
      const res = await fetch('/classify', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ data: JSON.parse(text), config }),
      });

      const out = document.getElementById('results');
      out.style.display = 'block';

      if (!res.ok) {
        out.innerHTML = '<div class="error">Error: ' + (await res.text()) + '</div>';
        return;
      }

      const results = await res.json();
      renderResults(results);
    }

    function renderResults(results) {
      // Group
      const groups = {};
      for (const icon of ICON_ORDER) groups[icon] = [];
      for (const uma of results) groups[uma.assigned_icon].push(uma);

      const out = document.getElementById('results');

      // Summary chips
      let html = '<div class="summary">';
      for (const icon of ICON_ORDER) {
        if (groups[icon].length > 0)
          html += \`<span class="summary-chip">\${ICON_LABEL[icon]}: <b>\${groups[icon].length}</b></span>\`;
      }
      html += '</div>';

      for (const icon of ICON_ORDER) {
        const umas = groups[icon];
        if (umas.length === 0) continue;
        umas.sort((a, b) => b.rank_score - a.rank_score);

        const maxScore = Math.max(...umas.map(u => u.scores[icon] ?? 0), 1);

        html += \`<div class="group icon-\${icon}">
          <div class="group-header">
            <span>\${ICON_LABEL[icon]}</span>
            <span style="font-weight:400;color:#888">\${umas.length} umas</span>
          </div>
          <div class="group-body">
            <table>
              <tr><th>card_id</th><th>id</th><th>rank score</th><th>white ★</th><th>category score</th><th>top scores</th><th></th></tr>\`;

        for (const u of umas) {
          const catScore = (u.scores[icon] ?? 0).toFixed(1);
          const barW = Math.round(((u.scores[icon] ?? 0) / maxScore) * 80);
          const top3 = Object.entries(u.scores).sort((a,b)=>b[1]-a[1]).slice(0,3)
            .map(([k,v]) => k+':'+(+v).toFixed(1)).join(' ');
          const lock = u.is_locked ? '🔒' : '';
          html += \`<tr>
            <td>\${u.card_id}</td>
            <td>\${u.trained_chara_id}</td>
            <td>\${u.rank_score}</td>
            <td>\${u.white_total.toFixed(1)}</td>
            <td><span class="score-bar" style="width:\${barW}px"></span>\${catScore}</td>
            <td style="color:#888;font-size:0.78rem">\${top3}</td>
            <td>\${lock}</td>
          </tr>\`;
        }

        html += '</table></div></div>';
      }

      out.innerHTML = html;
    }
  </script>
</body>
</html>`;

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
      const config = { ...DEFAULT_CONFIG, ...(body.config ?? {}) };
      const results = classifyRoster(body.data, config);
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify(results));
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
