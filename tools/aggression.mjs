// Player-safety harness: a passive player (economy stewards on) vs the AI,
// with and without the Envoy steward. Also checks simulation determinism.
// Usage: node tools/aggression.mjs [days] [seed...]
import { Game } from '../src/sim/game.js';
import { createHash } from 'node:crypto';

const days = +process.argv[2] || 120;
const seeds = process.argv.slice(3).length ? process.argv.slice(3) : ['a1', 'a2', 'a3'];
const hash = g => createHash('sha1').update(JSON.stringify(g.serialize(), (k, v) => (['saved', 'runId', 'created'].includes(k) ? 0 : v))).digest('hex').slice(0, 12);

for (const seed of seeds) for (const envoy of [false, true]) {
  for (const player of [0, 1]) {
    const g = Game.create({ seed, size: 'medium', playerTribe: player });
    const t = g.player;
    Object.assign(t.steward, { work: true, housing: true, build: true, research: true, diplomacy: envoy });
    const stats = { ultimatums: 0, tension: 0, wars: 0, firstWar: null, sacked: 0, lost: 0 };
    g.bus.on('proposal', ({ to, p }) => { if (to === t.id && p.ultimatum) stats.ultimatums++; });
    g.bus.on('tension', () => stats.tension++);
    g.bus.on('war', ({ a, b }) => { if (b === t.id) { stats.wars++; stats.firstWar ??= g.day; } });
    g.bus.on('sacked', ({ s }) => { if (s.tribe === t.id) stats.sacked++; });
    g.bus.on('captured', ({ loser }) => { if (loser.id === t.id) stats.lost++; });
    for (let i = 0; i < 360 * days; i++) g.step();
    console.log(`${seed} player=${t.name.padEnd(7)} envoy=${envoy ? 'on ' : 'off'} pop ${String(t.pop).padStart(3)} st${t.stage} | warnings ${stats.tension} ultimatums ${stats.ultimatums} wars-on-player ${stats.wars} first@d${stats.firstWar ?? '-'} sacked ${stats.sacked} towns-lost ${stats.lost} battle-deaths ${t.deathCauses?.battle || 0}`);
  }
}
// determinism: same seed, same inputs -> identical state
const run = () => { const g = Game.create({ seed: 'det', size: 'small', playerTribe: 0, observer: true }); for (let i = 0; i < 360 * 15; i++) g.step(); return hash(g); };
const h1 = run(), h2 = run();
console.log('determinism', h1 === h2 ? 'OK' : 'MISMATCH', h1, h2);
