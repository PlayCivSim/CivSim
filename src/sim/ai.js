// Utility-based AI. Every choice is a weighted score built from observable
// state (shortages, threats, opportunities) times personality, so behaviour is
// explainable. The same allocation/planning helpers power the player's steward.
import { BUILDINGS, JOB_KEYS } from '../data/buildings.js';
import { TECH } from '../data/techs.js';
import { LAWS } from '../data/laws.js';
import { DAYS_PER_YEAR } from '../core/constants.js';
import { mod, foodTotal, dailyFoodNeed, buildingCost, canAfford, pay, scarcity } from './economy.js';
import { availableBuildings, findSpot, placeBuilding, placementCheck, hasUnique, upgradeTarget, upgradeBuilding, depositsNear, accessibleDeposits, recomputeTerritory } from './buildings.js';
import { availableTechs, techCost, setResearch, MAX_SETTLEMENTS } from './progress.js';
import { enactLaw, canEnact, lawSlots, enactedCount, adoptGov, canAdoptGov } from './government.js';
import { jobCap, normaliseAlloc } from './population.js';
import { launchCampaign, militaryStrength } from './military.js';
import { siteStats } from '../world/worldgen.js';
import { BIOMES } from '../world/biomes.js';
import { makeAgent, isAdult } from './agents.js';

const countB = (g, t, type, includeSites = true) => { let n = 0; for (const b of g.buildings.values()) if (b.tribe === t.id && b.type === type && (includeSites || b.built)) n++; return n; };
const countCat = (g, t, pred) => { let n = 0; for (const b of g.buildings.values()) if (b.tribe === t.id && pred(BUILDINGS[b.type], b)) n++; return n; };

// ---------------------------------------------------------------- workforce
export function autoAllocate(game, t) {
  const ai = t.def.ai;
  let left = t.adults;
  const alloc = Object.fromEntries(JOB_KEYS.map(k => [k, 0]));
  const give = (k, n) => { const cap = jobCap(t, k); const v = Math.max(0, Math.min(Math.floor(n), cap - alloc[k], left)); alloc[k] += v; left -= v; };
  const need = dailyFoodNeed(game, t);
  const days = foodTotal(t) / Math.max(1, need);
  const safety = days < 1.5 ? 1.7 : days < 4 ? 1.35 : days > 12 ? 0.85 : 1.1;
  let foodNeed = need * safety;
  const winter = game.season === 3, autumnSoon = game.season === 2;
  const farmY = 3.6 * (1 + mod(t, 'farm')) * (winter ? 0.15 + mod(t, 'winterFarm') : autumnSoon ? 1.4 : 1);
  const per = { farmer: farmY, fisher: 3.2 * (1 + mod(t, 'fish')), hunter: 2.8 * (1 + mod(t, 'hunt')), gatherer: winter ? 1.0 : 2.0 };
  const order = ['farmer', 'fisher', 'hunter', 'gatherer'].sort((a, b) => per[b] - per[a]);
  // minimum soldiers first when threatened
  const threat = t.threat || t.atWar;
  const wantSoldiers = Math.max(1, t.adults * (0.03 + ai.military * 0.07 + (ai.aggression > 0.7 && t.stage >= 2 ? 0.05 : 0) + (threat ? 0.18 : 0) + (t.warPrep ? 0.12 : 0)));
  // a small standing guard, then feed everyone, then the rest of the army
  give('soldier', Math.min(wantSoldiers, Math.max(1, t.adults * 0.06)));
  for (const k of order) { if (foodNeed <= 0) break; const n = Math.ceil(foodNeed / per[k]); const before = alloc[k]; give(k, n); foodNeed -= (alloc[k] - before) * per[k]; }
  if (foodNeed > 0) give('gatherer', Math.ceil(foodNeed / 2));
  give('soldier', Math.min(wantSoldiers, t.adults * (days < 3 ? 0.12 : 0.35)) - alloc.soldier);
  const sites = (t._sites || []).length;
  give('builder', Math.min(t.adults * 0.3, Math.max(2, t.adults * 0.08) + sites * 1.5));
  give('woodcutter', Math.max(2, t.adults * 0.12 * scarcity(t, 'wood')));
  if ((t.stock.wood || 0) < 25) give('woodcutter', 3);
  give('researcher', jobCap(t, 'researcher') * (0.5 + ai.research * 0.5));
  give('miner', jobCap(t, 'miner') * 0.85);
  give('craftsman', jobCap(t, 'craftsman') * 0.8);
  give('trader', jobCap(t, 'trader'));
  // spare hands: more of what is scarce
  if (left > 0) give('woodcutter', left * 0.3);
  if (left > 0) give('builder', left * 0.3);
  for (const k of order) if (left > 0) give(k, left);
  if (left > 0) give('gatherer', left);
  if (left > 0) give('soldier', left);
  t.alloc = alloc;
  normaliseAlloc(t);
}

// ---------------------------------------------------------------- building
function buildUtilities(game, t) {
  const ai = t.def.ai; const avail = new Set(availableBuildings(t));
  const U = [];
  const add = (type, u, why) => { if (avail.has(type) && u > 0) U.push({ type, u, why }); };
  const freeHousing = t.housing - t.pop;
  const growth = t.pop / Math.max(1, t.housing);
  const days = foodTotal(t) / Math.max(1, dailyFoodNeed(game, t));
  const slotsFull = j => (t.jobCounts[j] || 0) >= (t.slots[j] || 0) - 1;
  const nFarm = countCat(game, t, d => d.field);
  const sites = (t._sites || []).length;

  // housing: prefer best affordable
  const housing = ['terrace', 'manor', 'house', 'hut'].filter(h => avail.has(h));
  if (freeHousing < 3 + t.pop * 0.05) {
    const best = housing.find(h => canAfford(t, buildingCost(t, h))) || 'hut';
    add(best, 9 + (growth > 0.95 ? 4 : 0), 'Housing is full');
  }
  if (days < 5 || nFarm < t.pop / 14) add('farm', (days < 2 ? 12 : 7) * (0.6 + ai.agriculture), 'Food reserves are low');
  if (!countB(game, t, 'farm') && avail.has('farm')) add('farm', 9, 'Begin agriculture');
  if (!avail.has('farm') && slotsFull('gatherer') && days < 6) add('gatherer', 7, 'Need more foragers');
  if (countB(game, t, 'gatherer') === 0) add('gatherer', 6, 'Forage the wilds');
  if (countB(game, t, 'hunter') === 0) add('hunter', 5, 'Hunt game');
  if (avail.has('fishery') && countB(game, t, 'fishery') < 1 + t.pop / 50) add('fishery', 4.5 + (t.key === 'oruvai' ? 2 : 0), 'Fish the waters');
  if (avail.has('pasture') && countB(game, t, 'pasture') < 1 + t.pop / 60) add('pasture', 3.5, 'Raise livestock');
  if (avail.has('orchard') && countB(game, t, 'orchard') < 1 + t.pop / 50) add('orchard', 3.5 + ai.agriculture, 'Food variety');
  if (countB(game, t, 'lumber') === 0 || ((t.stock.wood || 0) < 60 && slotsFull('woodcutter') && countB(game, t, 'lumber') < 1 + t.pop / 30)) add('lumber', 6.5, 'Need timber');
  const stores = countB(game, t, 'storehouse');
  if (stores < 1 + Math.floor(t.pop / 35)) add('storehouse', stores === 0 ? 8 : 4.5, 'More storage & shorter hauls');
  if (avail.has('quarry') && countB(game, t, 'quarry') < 1 + Math.floor(t.pop / 60)) add('quarry', (t.stock.stone || 0) < 80 ? 7 : 3, 'Stone is needed');
  if (avail.has('mine') && countB(game, t, 'mine') < 1 + Math.floor(t.pop / 70)) add('mine', 6 + (t.key === 'vaelith' || t.key === 'kharvak' ? 2 : 0), 'Ore deposits nearby');
  if (avail.has('school') && countB(game, t, 'school') < 1 + Math.floor(t.pop / 80)) add('school', 5 * (0.5 + ai.research), 'Research');
  if (avail.has('library') && countB(game, t, 'library') < 1 + Math.floor(t.pop / 120)) add('library', 5 * (0.5 + ai.research), 'Research');
  if (avail.has('academy') && !countB(game, t, 'academy')) add('academy', 6 * (0.5 + ai.research), 'Higher learning');
  if (avail.has('council') && !countB(game, t, 'council')) add('council', 9, 'Formal government');
  if (avail.has('admin') && !countB(game, t, 'admin')) add('admin', 7, 'Administration');
  if (avail.has('capitol') && !countB(game, t, 'capitol')) add('capitol', 5, 'A seat of state');
  if (avail.has('market') && countB(game, t, 'market') < 1 + Math.floor(t.pop / 120)) add('market', 5 * (0.5 + ai.trade), 'Trade');
  if (avail.has('harbor') && !countB(game, t, 'harbor')) add('harbor', 3 * (0.5 + ai.trade), 'Sea trade');
  if (avail.has('workshop') && countB(game, t, 'workshop') < 1 + Math.floor(t.pop / 70)) add('workshop', (t.stock.tools || 0) < t.pop * 0.3 ? 6 : 3, 'Tools');
  if (avail.has('smelter') && !countB(game, t, 'smelter') && ((t.stock.iron || 0) > 15)) add('smelter', 5 + (t.key === 'vaelith' ? 2 : 0), 'Refine iron');
  if (avail.has('armory') && countB(game, t, 'armory') < 1 && (ai.military > 0.6 || t.atWar)) add('armory', 5 * (0.5 + ai.military), 'Arm soldiers');
  if (avail.has('artisan') && !countB(game, t, 'artisan')) add('artisan', 3, 'Trade goods');
  if (avail.has('mint') && !countB(game, t, 'mint') && ((t.stock.gold || 0) + (t.stock.silver || 0) > 5)) add('mint', 4, 'Coinage');
  if (avail.has('factory') && !countB(game, t, 'factory')) add('factory', 6, 'Industry');
  if (avail.has('derrick') && countB(game, t, 'derrick') < 1) add('derrick', 4, 'Oil');
  if (avail.has('well') && countB(game, t, 'well') < 1 + t.pop / 40) add('well', 3 + (t.happiness < 50 ? 2 : 0), 'Clean water');
  if (avail.has('shrine') && countB(game, t, 'shrine') < 1 + t.pop / 70) add('shrine', 2.5 + (t.happiness < 50 ? 3 : 0), 'Morale');
  if (avail.has('bathhouse') && countB(game, t, 'bathhouse') < t.pop / 80) add('bathhouse', 3.5, 'Health');
  const soldierCap = t.slots.soldier || 0;
  if (avail.has('training') && countB(game, t, 'training') < 1) add('training', 3 + ai.military * 3, 'Drill soldiers');
  if (avail.has('barracks') && countB(game, t, 'barracks') < 1 + (t.atWar ? 1 : 0) + Math.floor(t.pop / 120)) add('barracks', (2 + ai.military * 5) * (t.atWar || t.threat ? 2 : 1), 'Military capacity');
  if (avail.has('tower') && countB(game, t, 'tower') < 1 + Math.floor(t.pop / 50) + (t.atWar ? 2 : 0)) add('tower', (2 + ai.military * 2) * (t.atWar ? 2 : 1), 'Border defence');
  if (avail.has('fort') && !countB(game, t, 'fort') && (t.atWar || ai.military > 0.8)) add('fort', 5, 'Fortify');
  const wonder = 'w_' + t.key;
  if (avail.has(wonder) && !countB(game, t, wonder)) add(wonder, 4.5, 'Cultural wonder');
  // stage requirement nudges
  if (t.stage === 3 && avail.has('market') && !countB(game, t, 'market')) add('market', 8, 'Needed to become a Town');
  // idle hands want workplaces
  const idleAdults = Math.max(0, (t.jobCounts.idle || 0) - t.children);
  if (idleAdults > 3) {
    for (const [type, j] of [['lumber', 'woodcutter'], ['hunter', 'hunter'], ['gatherer', 'gatherer'], ['school', 'researcher'], ['fishery', 'fisher'], ['farm', 'farmer'], ['quarry', 'miner'], ['workshop', 'craftsman']]) if (avail.has(type)) add(type, 3 + idleAdults * 0.4 * (j === 'researcher' ? 0.5 + ai.research : 1), 'Idle workers need jobs');
  }
  if (sites > 2 + (t.jobCounts.builder || 0) / 2) for (const u of U) u.u *= 0.3;
  return U.sort((a, b) => b.u - a.u);
}

export function aiBuild(game, t, opts = {}) {
  const U = buildUtilities(game, t).filter(u => !opts.only || opts.only.includes(BUILDINGS[u.type].cat));
  const maxSites = 2 + Math.floor((t.jobCounts.builder || 0) / 2);
  if ((t._sites || []).length >= maxSites) return null;
  for (let i = 0; i < Math.min(4, U.length); i++) {
    const { type, u, why } = U[i];
    const cost = buildingCost(t, type);
    if (!canAfford(t, cost)) {
      // save up for an urgent building only if the shortfall is actually being produced
      const reachable = Object.entries(cost).every(([r, v]) => (t.stock[r] || 0) >= v || (t.rates[r] || 0) > 0.5);
      if (i === 0 && u > 7 && reachable) return null;
      continue;
    }
    const sids = t.settlements.slice().sort((a, b) => {
      const sa = game.settlements.get(a), sb = game.settlements.get(b);
      return (sa.pop - sa.housing) - (sb.pop - sb.housing);
    }).reverse();
    for (const sid of sids) {
      const s = game.settlements.get(sid);
      const spot = findSpot(game, t, s, type);
      if (spot) { const b = placeBuilding(game, t, type, spot.x, spot.y, { sid }); t.lastDecision = `Building ${BUILDINGS[type].name}: ${why}`; return b; }
    }
  }
  // occasional upgrades of huts once stone is plentiful
  if ((t.stock.stone || 0) > 60) {
    for (const b of game.buildings.values()) if (b.tribe === t.id && b.built && b.type === 'hut') { if (upgradeTarget(t, b) && upgradeBuilding(game, t, b).ok) return b; break; }
  }
  return null;
}

// ---------------------------------------------------------------- research
export function aiResearch(game, t) {
  if (t.research.current) return;
  const opts = availableTechs(t);
  if (!opts.length) return;
  const ai = t.def.ai;
  let best = null, bv = -1;
  for (const tech of opts) {
    let v = (t.def.techBias[tech.branch] || 1) / Math.sqrt(techCost(t, tech.key));
    const k = tech.key;
    if (['cultivation', 'stoneworking', 'oraltradition', 'carpentry'].includes(k)) v *= 2.5;
    if (k === 'formalleadership' || k === 'barter' && t.stage >= 3) v *= 2;
    if (k === 'mining' && hasNearbyOre(game, t)) v *= 1.8;
    if ((k === 'militaryorganisation' || k === 'palisades' || k === 'bronzeweapons') && (t.atWar || t.threat)) v *= 2.5;
    if (k === 'fishing' && t.key === 'oruvai') v *= 1.5;
    if (TECH[k].unlocks?.includes('w_' + t.key)) v *= 1.4;
    v *= 0.85 + game.rng.next() * 0.3;
    if (v > bv) { bv = v; best = tech; }
  }
  if (best) setResearch(game, t, best.key);
}
function hasNearbyOre(game, t) { const s = game.settlements.get(t.capital); return s ? depositsNear(game, t, s.x, s.y, 14, ['iron', 'copper']).n > 0 : false; }

// ---------------------------------------------------------------- laws
const LAW_PREFS = {
  oruvai: [['trade', 'free'], ['welfare', 'relief'], ['education', 'public'], ['taxation', 'low'], ['housing', 'family'], ['education', 'apprentice']],
  kharvak: [['recruitment', 'levy'], ['defence', 'high'], ['labour', 'long'], ['taxation', 'moderate'], ['land', 'hunting']],
  thalori: [['forestry', 'managed'], ['rationing', 'generous'], ['land', 'protect'], ['housing', 'family'], ['forestry', 'sacred'], ['extraction', 'regulated']],
  vaelith: [['education', 'apprentice'], ['education', 'public'], ['taxation', 'moderate'], ['works', 'funded'], ['labour', 'long']],
};
export function aiLaws(game, t) {
  if (t.lawCooldown > game.tick) return;
  // relieve misery first
  if (t.happiness < 35) {
    for (const [lk, bad] of [['labour', 'long'], ['taxation', 'high'], ['rationing', 'strict'], ['recruitment', 'conscription']]) if (t.laws[lk] === bad) { enactLaw(game, t, lk, LAWS.find(l => l.key === lk).options[0].key); return; }
  }
  for (const g of ['technocracy', 'commonwealth', 'republic', 'monarchy', 'council']) {
    if (canAdoptGov(game, t, g).ok && (g === favGov(t) || (t.gov === 'chiefdom' && g === 'council'))) { adoptGov(game, t, g); return; }
  }
  if (enactedCount(t) >= lawSlots(t)) return;
  for (const [lk, opt] of LAW_PREFS[t.key]) {
    if (t.laws[lk] === opt) continue;
    if (t.laws[lk] && t.laws[lk] !== LAWS.find(l => l.key === lk).options[0].key) continue;
    if (lk === 'labour' && t.happiness < 55) continue;
    if (lk === 'rationing' && opt === 'generous' && foodTotal(t) < dailyFoodNeed(game, t) * 6) continue;
    if (canEnact(game, t, lk, opt).ok) { enactLaw(game, t, lk, opt); return; }
  }
}
const favGov = t => ({ oruvai: 'republic', kharvak: 'monarchy', thalori: 'commonwealth', vaelith: 'technocracy' })[t.key];

// ---------------------------------------------------------------- expansion
export const SETTLE_COST = { wood: 80, stone: 40, grain: 40 };

export function canFound(game, t) {
  if (t.settlements.length >= MAX_SETTLEMENTS[t.stage]) return { ok: false, why: `Your stage allows ${MAX_SETTLEMENTS[t.stage]} settlement(s)` };
  const cost = { ...SETTLE_COST };
  for (const [r, v] of Object.entries(cost)) if ((t.stock[r] || 0) < v) return { ok: false, why: 'Requires 80 wood, 40 stone and 40 grain' };
  const adults = [...game.agents.values()].filter(a => a.tribe === t.id && isAdult(a) && !a.army).length;
  if (adults < 16) return { ok: false, why: 'Need at least 16 adults' };
  return { ok: true };
}

export function siteCheck(game, t, x, y) {
  const w = game.world;
  for (let dy = -2; dy <= 2; dy++) for (let dx = -2; dx <= 2; dx++) {
    const xx = x + dx, yy = y + dy; if (!w.inb(xx, yy)) return { ok: false, why: 'Too close to the edge' };
    const i = w.idx(xx, yy);
    if (!BIOMES[w.biome[i]].build || w.occ[i]) return { ok: false, why: 'Needs open, buildable land' };
    if (w.owner[i] !== -1 && w.owner[i] !== t.id) return { ok: false, why: 'Claimed by another tribe' };
  }
  for (const s of game.settlements.values()) { const d = Math.hypot(s.x - x, s.y - y); if (d < 15) return { ok: false, why: 'Too close to another settlement' }; }
  let near = false;
  for (const sid of t.settlements) { const s = game.settlements.get(sid); if (Math.hypot(s.x - x, s.y - y) < 45) near = true; }
  if (!near) return { ok: false, why: 'Too far from your lands' };
  return { ok: true };
}

export function foundSettlement(game, t, x, y) {
  const c = canFound(game, t); if (!c.ok) return c;
  const sc = siteCheck(game, t, x, y); if (!sc.ok) return sc;
  pay(t, SETTLE_COST);
  const s = game.createSettlement(t, x, y, false);
  // settlers volunteer from the most crowded settlement
  const movers = [...game.agents.values()].filter(a => a.tribe === t.id && isAdult(a) && !a.army && a.job !== 'soldier').sort(() => game.rng.next() - 0.5).slice(0, 8);
  for (const a of movers) { a.sid = s.id; a.homeId = null; a.workId = null; a.job = a.job === 'builder' ? 'builder' : a.job; a.state = 'think'; a.path = null; }
  // a few huts to start
  for (let i = 0; i < 2; i++) { const spot = findSpot(game, t, s, 'hut'); if (spot) placeBuilding(game, t, 'hut', spot.x, spot.y, { sid: s.id, free: true }); }
  recomputeTerritory(game);
  game.log(t, 'settlement', `The ${t.name} founded ${s.name}.`, 2);
  game.bus.emit('founded', { t, s });
  return { ok: true, s };
}

function aiExpand(game, t) {
  if (!canFound(game, t).ok) return;
  if (t.pop < t.settlements.length * 40 || t.atWar) return;
  const ai = t.def.ai;
  if (game.rng.next() > 0.3 + ai.expansion * 0.5) return;
  let best = null, bv = -1e9;
  for (let k = 0; k < 160; k++) {
    const from = game.settlements.get(game.rng.pick(t.settlements));
    const ang = game.rng.next() * Math.PI * 2, d = game.rng.range(17, 32);
    const x = Math.round(from.x + Math.cos(ang) * d), y = Math.round(from.y + Math.sin(ang) * d);
    if (!siteCheck(game, t, x, y).ok) continue;
    const st = siteStats(game.world, x, y, 8);
    let v = st.fert * 1.2 + Math.min(st.trees, 40) * 0.4 + st.stone * 2 + st.minerals * (1 + (t.key === 'vaelith' ? 1.5 : 0)) + st.build * 0.1 + (st.water + st.coast) * 0.5;
    for (const [k2, w] of Object.entries(t.def.biome)) v += (st.aff[k2] || 0) * w * 0.1;
    if (v > bv) { bv = v; best = { x, y }; }
  }
  if (best && bv > 30) foundSettlement(game, t, best.x, best.y);
}

// ---------------------------------------------------------------- military
function aiWar(game, t) {
  t.warPrep = false;
  const enemies = game.dip.enemies(t.id);
  if (!enemies.length) return;
  t.warPrep = true;
  if (t.threat) return; // defend first
  const idle = [...game.agents.values()].filter(a => a.tribe === t.id && a.job === 'soldier' && !a.army);
  if (idle.length < 5) return;
  let myPow = 0; for (const a of idle) myPow += 1; // rough count weighted below
  myPow *= (t.strength / Math.max(1, t.jobCounts.soldier || 1));
  let target = null, tv = -1e9;
  for (const e of enemies) {
    const et = game.tribes[e];
    for (const sid of et.settlements) {
      const s = game.settlements.get(sid);
      const home = game.settlements.get(t.capital);
      const d = Math.hypot(s.x - home.x, s.y - home.y);
      const defense = et.strength / Math.max(1, et.settlements.length) * (s.capital ? 1.4 : 0.8);
      const v = myPow / Math.max(1, defense) - d / 80 + (s.capital ? -0.2 : 0.2);
      if (v > tv) { tv = v; target = s; }
    }
  }
  const already = game.armies.some(ar => ar.tribe === t.id && ar.state !== 'return');
  if (target && !already && tv > 1.1 - t.def.ai.aggression * 0.3) launchCampaign(game, t, target.id, 0.75);
}

// ---------------------------------------------------------------- main
export function aiThink(game, t, phase) {
  if (!t.alive) return;
  if (phase === 'fast') {
    autoAllocate(game, t);
    aiBuild(game, t);
    aiResearch(game, t);
  } else {
    aiLaws(game, t);
    aiExpand(game, t);
    aiWar(game, t);
    game.dip.aiThink(t);
  }
}

// Player steward: optional automation for the player's tribe.
export function stewardThink(game, t) {
  if (t.steward?.work) autoAllocate(game, t);
  if (t.steward?.housing) aiBuild(game, t, { only: ['housing'] });
  if (t.steward?.build) aiBuild(game, t);
  if (t.steward?.research) aiResearch(game, t);
  if (t.steward?.diplomacy && game.tick % 180 === (t.id * 40) % 180) {
    // the envoy answers foreign proposals as an AI ruler of this tribe would
    for (const pr of game.pendingProposals.filter(p => p.to === t.id)) {
      const ev = game.dip.evaluate(pr.from, t.id, pr.p);
      game.pendingProposals = game.pendingProposals.filter(x => x !== pr);
      if (ev.accept) acceptProposal(game, pr);
    }
    game.dip.aiThink(t, { noWar: true });
  }
}

export function acceptProposal(game, pr) {
  const D = game.dip;
  switch (pr.p.type) {
    case 'trade': case 'nap': case 'alliance': D.sign(pr.p.type, pr.from, pr.to); break;
    case 'peace': D.makePeace(pr.from, pr.to, pr.p.terms || 'white'); break;
    case 'tribute': D.sign('tribute', pr.from, pr.to, { payer: pr.to, until: game.tick + 360 * 10 }); D.addMod(pr.from, pr.to, 'submitted', 8, { label: 'Paid us tribute', decay: 0.2 }); break;
  }
}
