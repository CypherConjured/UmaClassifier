# Project Goal
uma-classifier is a personal decision-support tool for the mobile game Umamusume: Pretty Derby. It ingests a JSON roster export and automatically assigns each character ("uma") a "favorite icon" — matching the in-game favorites system — to guide keep/transfer decisions during career training runs.

## Requirements
### Functional:
* Parse roster JSON from Terumi/uma-rosterview
* Score each uma based on the value of their inherited sparks (factors): blue stat sparks, pink aptitude/style sparks, and white skill sparks
* Assign each uma exactly one icon representing its primary value category
* Surface "trash" candidates (safe to transfer) and "legacy" candidates (worth keeping as parents)

### Icon assignment priority order:
* clubs — debuffer white skills
* dirt/sprint/mile/mid/long — aptitude pink sparks (top-N per category)
* heart — exceptional white skill coverage
* ace — high rank_score fallback
* trash — bottom-N unassigned

### Scoring rules (grounded in crazyfellow's guide):
* Blue sparks → score their stat category directly
* Pink aptitude sparks → score their aptitude category; style pinks collected for multipliers only
* White sparks → scored via skill category routing, weighted by rarity, lineage overlap, pink multiplier, and special bonuses
* Own factors weighted higher than parent; grandparents excluded

## Interfaces:
* CLI with configurable flags
* Local HTTP server with web UI (sortable table, hover card for white spark details, race target recommendations)

## Environment constraints:
* TypeScript, no build step (node --strip-types)
* Game data loaded from bundled JSON asset files at runtime

---

## How to run

### Requirements

**Node.js v22 or later** — [download here](https://nodejs.org/). During install, make sure "Add to PATH" is checked.

Verify your version by opening a terminal and running:
```
node --version
```
It should print `v22.x.x` or higher.

### Setup

Open a terminal in the project folder and install dependencies (one-time):
```
npm install
```

### Getting your roster JSON

Export your roster from [Terumi](https://terumi.jp) (or uma-rosterview) as a JSON file and save it somewhere handy, e.g. `my-roster.json` in the project folder.

### Web UI

The easiest way to use the classifier. Start the server:
```
npm run serve
```
Then open your browser and go to **http://localhost:3000**

Upload or paste your roster JSON and results appear in the browser. Press `Ctrl+C` in the terminal when you're done to stop the server.

### Command-line interface

```
npm run cli -- <path-to-your-json>
```

Example:
```
npm run cli -- my-roster.json
```

This prints a table of all your umas sorted by assigned icon.

#### Options

| Flag | Description | Default |
|---|---|---|
| `--keep N` | Top N umas to keep per category | 6 |
| `--min-score N` | Minimum score to qualify for a category | 1 |
| `--heart N` | Minimum white skill total for heart consideration | 10 |
| `--ace N` | Minimum rank score for ace fallback | 12000 |
| `--keep-ace N` | Max umas assigned the ace icon | 10 |
| `--keep-heart N` | Max umas assigned the heart icon | 10 |
| `--trash N` | Number of transfer candidates to flag | 20 |
| `--race ID` | Score umas for a specific target race | — |
| `--rank N` | Filter output to umas with this rank score | — |
| `--breakdown` | Show per-factor score breakdown | — |

#### Examples

Keep up to 8 umas per category with a full breakdown:
```
npm run cli -- my-roster.json --keep 8 --breakdown
```

Score umas for a specific race and see which skills are relevant:
```
npm run cli -- my-roster.json --race 6019 --breakdown
```

### Icons

| Icon | Meaning |
|---|---|
| 👟 Dirt / Sprint / Mile / Mid / Long | Best fit for that distance/surface |
| ♥ Heart | Exceptional white skill coverage |
| ♣ Clubs | Debuffer |
| ♠ Ace | High rank score fallback |
| 🗑️ Transfer | Candidate for transfer |
| — Skip | Not flagged (not bad, not remarkable) |
