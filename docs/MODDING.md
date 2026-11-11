# Content packs (modding foundation)

CivSim keeps its content in plain data: `src/data/resources.js`, `buildings.js`, `techs.js`, `laws.js`, `tribes.js`, plus a few exported tables in systems (`EVENTS` in `src/sim/events.js`, `MISSIONS` in `src/sim/intel.js`, `SPECS` in `src/sim/logistics.js`, `TARIFFS` in `src/sim/trade.js`, `DIFFICULTIES` in `src/core/constants.js`).

`src/data/registry.js` lets a **content pack** add to or replace these without touching the systems:

```js
// src/data/packs/salt-roads.js
export const pack = {
  id: 'salt-roads',
  resources: { amber: { name: 'Amber', cat: 'luxury', value: 3 } },
  techs: [{ key: 'ambertrade', name: 'Amber Trade', branch: 'economics', tier: 3, req: ['barter'], desc: 'Prized resin from the north.' }],
  missions: { herald: { name: 'Herald', icon: 'scroll', speed: 40, cost: { food: 3 }, desc: 'A fast messenger.' } },
};
```

Then list it in `PACKS` in `registry.js`. Packs are applied once, in order, before any world is created, in both the simulation worker and the main thread. Every definition is validated at start-up; a missing field or an unknown prerequisite throws with the pack and key named.

Rules:
- Keep packs deterministic (no `Math.random`); worlds must replay identically from a seed.
- New fields on game state must be optional so older saves still load (`SAVE_VERSION` in `src/sim/game.js`).
- Sprites and icons are procedural (`src/render/sprites.js`, `src/ui/icons.js`); a new building or resource without art falls back to defaults.
- Tribes: change any of the four peoples by slot key. Example — turn the Kharvak into a seafaring trading people:

```js
tribes: { kharvak: { name: 'Sennari', adjective: 'Sennaran', title: 'The Salt Fleets', motto: 'The sea pays.',
  pal: { primary: '#1f8a8a', dark: '#0f4a4a', light: '#7fd8d0' }, style: 'oruvai',
  ai: { aggression: 0.35, trade: 0.9 }, mods: { trade: 0.3, military: 0 },
  strengths: ['Trade agreements yield 30% more'], weaknesses: ['Few soldiers'],
  quirks: { fishing: 2, warWeariness: 1 }, warCry: 'to open the sea lanes' } }
```

  Nested objects (`pal`, `ai`, `mods`, `quirks`, `names`, `affinity`, `techBias`, `biome`) merge with the original; other fields replace it. `style` picks the sprite and emblem look from the four existing styles. The slot key never changes, so saves stay valid. Quirks the simulation reads: `warWeariness`, `morale`, `fishing`, `mining`, `smelting`, `mineralSites`, `techLikes`, `cometOmen`, `lawLikes`, `lawDislikes`.

Profiling: `node tools/profile.mjs [small|medium|large] [days] [hard|open]` grows a world and reports the cost of each system per call and per game day.
