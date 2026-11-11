// Progression planner: each civilisation works out what stands between it and
// its next stage, turns every unmet requirement into concrete needs
// (buildings, research, workers, resources), and resolves missing resources
// through alternatives (production, research, expansion toward deposits,
// trade, barter). Stagnation detection makes a tribe change its strategy when
// it stops advancing. Plans only bias the utility AI; they never bypass costs.
import { BUILDINGS } from '../data/buildings.js';
import { TECH } from '../data/techs.js';
import { RESOURCES, DEPOSITS, DEP } from '../data/resources.js';
import { stageProgress, techState, prereqPath, setResearch, STAGES, MAX_SETTLEMENTS } from './progress.js';
import { isUnlocked, rockNear, depositsNear, accessibleDeposits, buildRoad, doorTile, upgradeTarget, findSpot, destroyBuilding } from './buildings.js';
import { buildingCost, scarcity, foodTotal, dailyFoodNeed } from './economy.js';
import { B, BIOMES } from '../world/biomes.js';
import { DAY_TICKS } from '../core/constants.js';

// Requirement label -> what it takes
const REQ_BUILDING = { 'Storehouse built': 'storehouse', 'Council Hall built': 'council', 'Marketplace built': 'market', 'Administrative Hall': 'admin', 'Academy or Library': 'library', 'Manufactory built': 'factory' };
const RES_SOURCE = { stone: 'quarry', clay: 'quarry', salt: 'quarry', wood: 'lumber', iron: 'mine', copper: 'mine', coal: 'mine', silver: 'mine', gold: 'mine', gems: 'mine', oil: 'derrick', tools: 'workshop', steel: 'smelter', weapons: 'armory', goods: 'artisan', coins: 'mint', machinery: 'factory', grain: 'farm', herbs: 'gatherer', fibre: 'gatherer' };
const RES_JOB = { quarry: 'miner', mine: 'miner', derrick: 'miner', lumber: 'woodcutter', workshop: 'craftsman', smelter: 'craftsman', armory: 'craftsman', artisan: 'craftsman', mint: 'craftsman', factory: 'craftsman', farm: 'farmer', gatherer: 'gatherer' };
const STRATEGIES = {
  balanced: { label: 'balanced growth' },
  resources: { label: 'securing scarce materials' },
  research: { label: 'the pursuit of knowledge' },
  growth: { label: 'growing the population' },
  expansion: { label: 'expanding its lands' },
};

const countB = (g, t, type) => { let n = 0; for (const b of g.buildings.values()) if (b.tribe === t.id && b.type === type) n++; return n; };

export function planProgress(game, t) {
  const sp = stageProgress(game, t);
  const plan = { goal: sp ? sp.next.name : null, needs: [], build: {}, jobs: {}, research: [], resources: {}, actions: [], strategy: t.strategy || 'balanced' };
  const boost = (type, v) => { plan.build[type] = Math.max(plan.build[type] || 0, v); };
  const job = (k, v) => { plan.jobs[k] = Math.max(plan.jobs[k] || 0, v); };
  const wantTech = key => { if (!t.techs.includes(key)) for (const k of prereqPath(t, key)) if (!plan.research.includes(k)) plan.research.push(k); };
  const needRes = (r, amt, why) => { if ((t.stock[r] || 0) < amt) plan.resources[r] = Math.max(plan.resources[r] || 0, amt - (t.stock[r] || 0)); };
  const wantBuilding = (type, why) => {
    const d = BUILDINGS[type];
    if (!isUnlocked(t, type)) { if (d.tech) wantTech(d.tech); plan.needs.push(`${why}: research ${TECH[d.tech]?.name}`); return; }
    boost(type, 14);
    for (const [r, v] of Object.entries(buildingCost(t, type))) needRes(r, v, why);
    plan.needs.push(why);
    // nowhere to put it? make room: expand, and retire a surplus hut
    const roomy = t.settlements.some(sid => { const s = game.settlements.get(sid); return s && findSpot(game, t, s, type, 120, false); });
    if (!roomy) { plan.actions.push('expand'); if (t.housing - t.pop > 8) plan.clearHut = true; plan.needs.push(`${why}: no room — expanding`); }
  };

  if (sp) for (const r of sp.reqs) {
    if (r.have >= r.need) continue;
    const L = r.label;
    if (REQ_BUILDING[L]) { wantBuilding(L === 'Academy or Library' && isUnlocked(t, 'academy') ? 'academy' : REQ_BUILDING[L], L); continue; }
    if (L === 'Population') {
      plan.needs.push('Population');
      plan.growth = true;
      // grow what actually limits growth: homes, food, or contentment
      const free = t.housing - t.pop;
      const days = foodTotal(t) / Math.max(1, dailyFoodNeed(game, t));
      if (free < 6 + t.pop * 0.12) boost(bestHousing(t), 10);
      if (days < 6) { boost('farm', 9); job('farmer', 1); }
      if (t.happiness < 55) { boost('shrine', 7); boost('well', 7); plan.actions.push('mood'); }
    } else if (L === 'Technologies' || L === 'Industrial technology') {
      plan.needs.push(L); job('researcher', 1); boost('school', 7); if (isUnlocked(t, 'library')) boost('library', 8);
      if (L === 'Industrial technology') wantTech('mechanisation');
    } else if (L === 'Huts & houses') { boost('hut', 9); plan.needs.push(L); }
    else if (L === 'Houses or better') {
      plan.needs.push(L);
      if (!isUnlocked(t, 'house')) wantTech('carpentry');
      else { boost('house', 11); plan.upgradeHuts = true; needRes('stone', 30, L); needRes('clay', 12, L); }
    } else if (L === 'Production buildings') { plan.needs.push(L); plan.production = true; }
    else if (L === 'Road tiles') { plan.needs.push(L); plan.actions.push('roads'); }
    else if (L === 'Laws enacted') { plan.needs.push(L); plan.actions.push('laws'); }
    else if (L === 'Settlements') { plan.needs.push(L); plan.actions.push('expand'); }
    else if (L === 'Average happiness' || L === 'Stability') { plan.needs.push(L); boost('shrine', 8); boost('well', 7); plan.actions.push('mood'); }
  }
  // resolve every short resource through production, research or alternatives
  plan.bottlenecks = {};
  for (const [r, amt] of Object.entries(plan.resources)) plan.bottlenecks[r] = resolveResource(game, t, r, amt, plan, { boost, job, wantTech });
  // strategy overlays from stagnation handling
  if (plan.strategy === 'research') { job('researcher', 1); boost('school', 8); boost('library', 9); }
  if (plan.strategy === 'growth') { if (t.housing - t.pop < 6 + t.pop * 0.12) boost(bestHousing(t), 11); plan.growth = true; plan.actions.push('mood'); }
  if (plan.strategy === 'expansion') plan.actions.push('expand');
  if (plan.strategy === 'resources') for (const r of ['stone', 'clay', 'iron']) if (scarcity(t, r) > 1.5) plan.bottlenecks[r] = plan.bottlenecks[r] || resolveResource(game, t, r, 60, plan, { boost, job, wantTech });
  return plan;
}

function bestHousing(t) { return ['terrace', 'manor', 'house', 'hut'].find(h => isUnlocked(t, h)) || 'hut'; }

// Returns a short explanation of how the shortage will be addressed.
function resolveResource(game, t, r, amt, plan, { boost, job, wantTech }) {
  const src = RES_SOURCE[r];
  if (!src) return 'trade';
  if (src === 'derrick' || src === 'mine' || src === 'quarry') {
    const dep = DEPOSITS[DEP[r]];
    if (dep?.tech && !t.techs.includes(dep.tech)) { wantTech(dep.tech); return `research ${TECH[dep.tech].name}`; }
  }
  const bDef = BUILDINGS[src];
  if (bDef?.tech && !t.techs.includes(bDef.tech)) { wantTech(bDef.tech); plan.wantsTrade = true; return `research ${TECH[bDef.tech].name}`; }
  if (src === 'quarry' || src === 'mine' || src === 'derrick') {
    const reach = sourceInReach(game, t, r);
    if (reach.inside) {
      if (countB(game, t, src) < 1 + Math.floor(t.pop / 60)) boost(src, 11);
      job(RES_JOB[src], 1);
      return reach.inside === 'rock' ? 'quarry the hills' : `work the ${r} deposits`;
    }
    // nothing inside our borders: reach out to the nearest source, and trade meanwhile
    plan.wantsTrade = true;
    if (reach.near) { plan.expandToward = plan.expandToward || { x: reach.near.x, y: reach.near.y, res: r }; return `expand toward ${r} and trade`; }
    return 'trade for it';
  }
  if (countB(game, t, src) < 1 + Math.floor(t.pop / 70)) boost(src, 10);
  if (RES_JOB[src]) job(RES_JOB[src], 1);
  // inputs of crafted goods
  if (r === 'steel') { plan.resources.iron = Math.max(plan.resources.iron || 0, 20); }
  if (r === 'tools') { plan.resources.wood = Math.max(plan.resources.wood || 0, 20); }
  return `build a ${bDef.name.toLowerCase()}`;
}

// Is there a usable source of r inside our territory, or one nearby we could claim?
function sourceInReach(game, t, r) {
  const w = game.world; const key = DEPOSITS.findIndex(d => d && d.res === r);
  let inside = null, near = null, nd = 1e9;
  const isRock = i => w.biome[i] === B.HILLS || w.biome[i] === B.MOUNTAIN;
  for (const sid of t.settlements) {
    const s = game.settlements.get(sid); if (!s) continue;
    for (let dy = -30; dy <= 30; dy += 1) for (let dx = -30; dx <= 30; dx += 1) {
      const x = s.x + dx, y = s.y + dy; if (!w.inb(x, y)) continue;
      const i = w.idx(x, y);
      const has = (key > 0 && w.deposit[i] === key && w.depAmt[i] > 0) || (r === 'stone' && isRock(i));
      if (!has) continue;
      const o = w.owner[i];
      if (o === t.id) { inside = r === 'stone' && isRock(i) && w.deposit[i] !== key ? (inside || 'rock') : 'deposit'; if (inside === 'deposit') return { inside, near }; }
      else if (o === -1) { const d = dx * dx + dy * dy; if (d < nd) { nd = d; near = { x, y, d: Math.sqrt(d) }; } }
    }
  }
  return { inside, near };
}

// ---------------------------------------------------------------- stagnation
export function progressScore(game, t) {
  const sp = stageProgress(game, t);
  const frac = sp ? sp.reqs.reduce((a, r) => a + Math.min(1, r.have / r.need), 0) / sp.reqs.length : 1;
  return t.stage * 100 + frac * 60 + t.techs.length * 2;
}

export function checkStagnation(game, t) {
  const day = game.day;
  t.progressLog = t.progressLog || [];
  t.progressLog.push({ d: day, s: progressScore(game, t) });
  if (t.progressLog.length > 12) t.progressLog.shift();
  const old = t.progressLog.find(p => p.d <= day - 16);
  if (!old) return;
  const gain = t.progressLog[t.progressLog.length - 1].s - old.s;
  const stagnant = gain < 6;
  if (stagnant && (!t.strategyUntil || day >= t.strategyUntil)) {
    // pick the strategy that attacks the longest-standing obstacle
    const plan = t.plan || planProgress(game, t);
    const needs = plan.needs.join(' ');
    let next = 'balanced';
    if (Object.keys(plan.bottlenecks || {}).length) next = 'resources';
    else if (/Population|Houses/.test(needs)) next = 'growth';
    else if (/Technolog|research/.test(needs)) next = 'research';
    else if (/Settlements/.test(needs)) next = 'expansion';
    if (next === t.strategy) next = ['resources', 'growth', 'research', 'expansion'][(['resources', 'growth', 'research', 'expansion'].indexOf(next) + 1) % 4];
    t.strategy = next; t.strategyUntil = day + 12; t.stagnations = (t.stagnations || 0) + 1;
    game.log(t, 'government', `The ${t.name} council, frustrated by slow progress, turns its efforts to ${STRATEGIES[next].label}.`, t.isPlayer ? 1 : 0);
  } else if (!stagnant && t.strategy !== 'balanced' && day >= (t.strategyUntil || 0)) t.strategy = 'balanced';
}

// ---------------------------------------------------------------- plan actions
export function executePlan(game, t, plan, helpers) {
  // research: plan prerequisites take precedence over idle curiosity
  if (plan.research.length && (!t.research.current || !plan.research.includes(t.research.current))) {
    const next = plan.research.find(k => techState(t, k) === 'available');
    if (next && (!t.research.current || t.research.progress < 5)) setResearch(game, t, next);
  }
  // huts -> houses
  if (plan.upgradeHuts) {
    for (const b of game.buildings.values()) {
      if (b.tribe !== t.id || !b.built || b.type !== 'hut') continue;
      if (upgradeTarget(t, b) && helpers.upgrade(game, t, b).ok) break;
      break;
    }
  }
  if (plan.actions.includes('roads')) connectRoads(game, t);
  if (plan.clearHut) {
    const hut = [...game.buildings.values()].find(b => b.tribe === t.id && b.type === 'hut' && b.built && !b.residentCount);
    if (hut) { destroyBuilding(game, hut, 'cleared'); t.lastDecision = 'Clearing an empty hut to make room'; }
  }
  // trade for bottleneck resources
  if (plan.wantsTrade || Object.keys(plan.bottlenecks).some(r => /trade/.test(plan.bottlenecks[r]))) seekTrade(game, t, plan);
  // claim territory toward an out-of-reach resource by building a watchtower or storehouse at the border
  if (plan.expandToward && !t.atWar) claimToward(game, t, plan.expandToward, helpers);
}

function connectRoads(game, t) {
  if (game.rng.chance(0.5)) return;
  const cap = game.settlements.get(t.capital); if (!cap) return;
  const c = game.buildings.get(cap.centre); if (!c) return;
  for (const sid of t.settlements) {
    const s = game.settlements.get(sid); if (sid === cap.id || !s) continue;
    const sc = game.buildings.get(s.centre); if (sc && (t.stock.stone || 0) > 20) { buildRoad(game, t, doorTile(game, sc), doorTile(game, c)); return; }
  }
  const list = [...game.buildings.values()].filter(b => b.tribe === t.id && b.built && b.type !== 'centre');
  for (let k = 0; k < 3 && list.length > 1; k++) { const a = game.rng.pick(list), b = game.rng.pick(list); if (a !== b) buildRoad(game, t, doorTile(game, a), doorTile(game, b)); }
}

function seekTrade(game, t, plan) {
  const D = game.dip;
  if (game.tick - (t.lastTradeSeek || -1e9) < DAY_TICKS) return;
  t.lastTradeSeek = game.tick;
  const wants = Object.keys(plan.resources).filter(r => RESOURCES[r] && !['coins'].includes(r));
  if (!wants.length) return;
  const giveable = Object.entries(t.stock).filter(([k, v]) => RESOURCES[k] && v > 120 && !wants.includes(k) && k !== 'coins').sort((a, b) => b[1] - a[1]);
  if (!giveable.length) return;
  for (const o of game.tribes) {
    if (o === t || !o.alive || !D.contact[t.id][o.id] || D.atWar(t.id, o.id)) continue;
    const r = wants.find(r => (o.stock[r] || 0) > 80); if (!r) continue;
    const getAmt = Math.min(40, Math.floor(o.stock[r] * 0.25));
    const [gr, gv] = giveable[0];
    const giveAmt = Math.ceil(Math.min(gv * 0.4, getAmt * (RESOURCES[r].value / RESOURCES[gr].value) * 1.4));
    const p = { type: 'exchange', give: { [gr]: giveAmt }, get: { [r]: getAmt } };
    if (o.isPlayer) { if (!game.pendingProposals.some(x => x.from === t.id && x.to === o.id)) { game.pendingProposals.push({ from: t.id, to: o.id, p, tick: game.tick }); game.bus.emit('proposal', { from: t.id, to: o.id, p }); } return; }
    const res = D.propose(t.id, o.id, p);
    if (res.accept) { t.lastDecision = `Traded ${gr} for ${r}: ${plan.bottlenecks[r] || 'bottleneck'}`; return; }
    if (!D.has('trade', t.id, o.id) && t.techs.includes('barter') && o.techs.includes('barter')) D.propose(t.id, o.id, { type: 'trade' });
  }
}

function claimToward(game, t, target, helpers) {
  if (game.tick - (t.lastClaim || -1e9) < DAY_TICKS * 2) return;
  const s = [...t.settlements].map(id => game.settlements.get(id)).filter(Boolean).sort((a, b) => Math.hypot(a.x - target.x, a.y - target.y) - Math.hypot(b.x - target.x, b.y - target.y))[0];
  if (!s) return;
  const type = isUnlocked(t, 'tower') ? 'tower' : 'storehouse';
  // walk from the settlement toward the target and try to place inside our border edge
  const dx = target.x - s.x, dy = target.y - s.y, d = Math.hypot(dx, dy);
  for (let k = d; k > 3; k -= 1.5) {
    const x = Math.round(s.x + dx / d * k), y = Math.round(s.y + dy / d * k);
    if (helpers.place(game, t, type, x, y)) { t.lastClaim = game.tick; t.lastDecision = `Building a ${BUILDINGS[type].name} to claim land toward ${target.res}`; return; }
  }
}
