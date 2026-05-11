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
