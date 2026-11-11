// Headless balance harness: runs AI-only worlds and reports progression,
// bottlenecks, food security, military and survival per tribe.
// Usage: node tools/balance.mjs [days] [seed...]
import { Game } from '../src/sim/game.js';
import { stageProgress } from '../src/sim/progress.js';
import { foodTotal, dailyFoodNeed } from '../src/sim/economy.js';

const days = +process.argv[2] || 160;
const seeds = process.argv.slice(3).length ? process.argv.slice(3) : ['b1', 'b2', 'b3', 'b4', 'b5', 'b6'];
const blockers = {}; const summary = [];
for (const seed of seeds) {
  const g = Game.create({ seed, size: 'medium', observer: true });
  const stuck = g.tribes.map(() => ({}));
  const minFood = g.tribes.map(() => 99);
  for (let d = 1; d <= days; d++) {
    for (let i = 0; i < 360; i++) g.step();
    for (const t of g.tribes) {
      if (!t.alive) continue;
      minFood[t.id] = Math.min(minFood[t.id], foodTotal(t) / Math.max(1, dailyFoodNeed(g, t)));
      const sp = stageProgress(g, t); if (!sp) continue;
      for (const r of sp.reqs) if (r.have < r.need) stuck[t.id][`st${t.stage + 1}:${r.label}`] = (stuck[t.id][`st${t.stage + 1}:${r.label}`] || 0) + 1;
    }
  }
  const wars = g.history.filter(h => h.type === 'war' && /declared/.test(h.text)).length;
  const sacks = g.history.filter(h => /sacked/.test(h.text)).length;
  console.log(`== ${seed}: wars ${wars}, sacks ${sacks}`);
  for (const t of g.tribes) {
    const top = Object.entries(stuck[t.id]).sort((a, b) => b[1] - a[1]).slice(0, 3);
    for (const [k, v] of top) blockers[t.key + ' ' + k] = (blockers[t.key + ' ' + k] || 0) + v;
    const line = `${t.name.padEnd(8)} ${t.alive ? '' : 'DEAD '}pop ${String(t.pop).padStart(3)} st${t.stage} tech ${String(t.techs.length).padStart(2)} sett ${t.settlements.length} sold ${t.jobCounts.soldier || 0} stone ${Math.round(t.stock.stone || 0)} iron ${Math.round(t.stock.iron || 0)} minFoodDays ${minFood[t.id].toFixed(1)} plan:${t.plan?.goal || '-'} | ${top.map(([k, v]) => `${k}(${v}d)`).join(', ')}`;
    console.log('  ' + line);
    summary.push({ seed, tribe: t.key, stage: t.stage, pop: t.pop, alive: t.alive });
  }
}
const st = summary.map(s => s.stage);
console.log('\nstage distribution', [1, 2, 3, 4, 5, 6].map(s => `${s}:${st.filter(x => x === s).length}`).join(' '), '| dead', summary.filter(s => !s.alive).length);
console.log('top blockers (tribe-days):'); Object.entries(blockers).sort((a, b) => b[1] - a[1]).slice(0, 12).forEach(([k, v]) => console.log('  ', v, k));
