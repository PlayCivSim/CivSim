// Profiles the simulation's systems on a grown world.
// Usage: node tools/profile.mjs [size=large] [days=80] [intel=hard]
// Grows a world, then times each system over repeated calls on the same state.
import { Game } from '../src/sim/game.js';
import { updateAgents } from '../src/sim/agents.js';
import { census, assignJobs, assignHousing, updateNeeds } from '../src/sim/population.js';
import { recomputeTerritory } from '../src/sim/buildings.js';
import { updateDefences, militaryStrength } from '../src/sim/military.js';
import { aiThink } from '../src/sim/ai.js';
import { updateMissions, updateExplore, dailyIntel } from '../src/sim/intel.js';
import { updateSupply } from '../src/sim/logistics.js';
import { coalitionTick } from '../src/sim/aimind.js';
import { dailyTrade } from '../src/sim/trade.js';

const [size = 'large', days = 80, intel = 'hard'] = process.argv.slice(2);
const g = Game.create({ seed: 'prof', size, playerTribe: 0, intel });
Object.assign(g.player.steward, { work: true, housing: true, build: true, research: true, diplomacy: true });
let t0 = performance.now();
for (let i = 0; i < 360 * +days; i++) g.step();
const grow = performance.now() - t0;
console.log(`${size} world, ${days} days: ${g.agents.size} agents, ${g.buildings.size} buildings, ${g.history.length} records · ${(grow / (360 * days)).toFixed(3)} ms/tick average`);

const time = (name, fn, n = 50) => { fn(); const s = performance.now(); for (let i = 0; i < n; i++) fn(); const ms = (performance.now() - s) / n; return { name, ms }; };
const rows = [
  time('step (one tick, all systems)', () => g.step(), 360),
  time('updateAgents', () => updateAgents(g), 100),
  time('census', () => census(g)),
  time('recomputeTerritory', () => recomputeTerritory(g), 10),
  time('updateDefences', () => updateDefences(g)),
  time('militaryStrength ×4', () => { for (const t of g.tribes) militaryStrength(g, t); }),
  time('assignJobs+housing ×4', () => { for (const t of g.tribes) { assignHousing(g, t); assignJobs(g, t); } }, 20),
  time('updateNeeds ×4', () => { for (const t of g.tribes) updateNeeds(g, t); }),
  time('aiThink fast ×3', () => { for (const t of g.tribes) if (!t.isPlayer) aiThink(g, t, 'fast'); }, 20),
  time('aiThink slow ×3', () => { for (const t of g.tribes) if (!t.isPlayer) aiThink(g, t, 'slow'); }, 10),
  time('diplomacy daily', () => g.dip.daily(), 10),
  time('updateExplore', () => updateExplore(g), 100),
  time('updateMissions', () => updateMissions(g), 100),
  time('dailyIntel', () => dailyIntel(g), 20),
  time('dailyTrade', () => dailyTrade(g), 20),
  time('updateSupply', () => updateSupply(g), 50),
  time('coalitionTick', () => coalitionTick(g), 50),
  time('serialize (save)', () => JSON.stringify(g.serialize()), 5),
];
// how often each runs per simulated day (360 ticks)
const PER_DAY = { 'updateAgents': 360, census: 36, 'recomputeTerritory': 1, 'updateDefences': 360, 'militaryStrength ×4': 7.2, 'assignJobs+housing ×4': 7.2, 'updateNeeds ×4': 7.2, 'aiThink fast ×3': 18, 'aiThink slow ×3': 2, 'diplomacy daily': 1, updateExplore: 18, updateMissions: 36, dailyIntel: 1, dailyTrade: 1, updateSupply: 1, coalitionTick: 1 };
console.log('\nsystem                         ms/call   ms per game day');
for (const r of rows) console.log(r.name.padEnd(30), r.ms.toFixed(3).padStart(8), PER_DAY[r.name] ? (r.ms * PER_DAY[r.name]).toFixed(1).padStart(12) : '');
