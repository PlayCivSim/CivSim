# CivSim

A living-world civilisation builder in the browser. Four distinct tribes — the diplomatic **Oruvai**, the martial **Kharvak**, the agrarian **Thalori** and the inventive **Vaelith** — grow from a single hearth on a procedurally generated continent. You lead one; the other three are run by a personality-driven AI.

Every sprite, tile, icon, emblem and UI ornament is generated as pixel art in code, and all music, ambience and sound effects are synthesised live. There are no external assets and no dependencies.

## Running

```bash
node server.mjs
```

Then open <http://localhost:8080>. Any static file server works (the game is plain ES modules); it just needs to be served over HTTP rather than opened as a `file://` URL. Fonts load from Google Fonts and fall back gracefully offline.

## Controls

| Input | Action |
|---|---|
| Drag (left/right/middle), WASD / arrows | Pan (Shift = faster) |
| Mouse wheel, Q / E | Zoom |
| Click | Inspect a person, building or tile |
| Space · 1 · 2 · 3 | Pause · normal · fast · very fast |
| B · P · O · T · G · L · M · C (or F1–F9) | Build · Population · Economy · Technology · Diplomacy · Laws · Military · Chronicle |
| H | Return to your capital |
| F5 | Quicksave |
| Esc | Cancel / menu |

## How it works

| Area | Where |
|---|---|
| World generation (continents, ridged mountain ranges, rivers, lakes, biomes, deposits, balanced starts) | `src/world/` |
| Fixed-tick simulation scheduler and save format | `src/sim/game.js` |
| Individual inhabitants: needs, jobs, work cycles, hauling, pathing | `src/sim/agents.js`, `src/sim/pathfinding.js` |
| Demographics, housing, workforce allocation, happiness & stability | `src/sim/population.js` |
| Buildings, territory, roads, settlement planner | `src/sim/buildings.js` |
| Economy ledger, storage, spoilage, tools, taxes | `src/sim/economy.js` |
| Research tree and civilisation stages | `src/data/techs.js`, `src/sim/progress.js` |
| Laws, governments, policy interactions | `src/data/laws.js`, `src/sim/government.js` |
| Diplomacy, treaties, trade caravans | `src/sim/diplomacy.js` |
| Armies, sieges, towers, conquest | `src/sim/military.js` |
| Contextual events and decisions | `src/sim/events.js` |
| Utility AI (also powers the player's optional stewards) | `src/sim/ai.js` |
| Renderer: chunked terrain, y-sorted sprites, lighting, weather | `src/render/` |
| Interface | `src/ui/`, `styles/ui.css` |
| Audio | `src/audio/audio.js` |
| IndexedDB saves (verified, atomic, with backups) | `src/save/saves.js` |

The simulation runs at 10 ticks per second of game time, independent of frame rate. Systems update at different cadences (movement every tick, census every second, jobs/needs every five seconds, economy, demographics, diplomacy and events once per in-game day). Off-screen inhabitants update at half frequency, pathfinding is budgeted per tick and cached, and terrain is baked into chunk canvases that only re-render when the world changes.

Saves store the world seed plus all mutable state (forests, deposits, fauna, roads, buildings, every inhabitant, AI state, diplomacy, history). Each save is serialised and verified before being written, and the previous version of the slot is kept as a backup in the same transaction.
