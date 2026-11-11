// Population: census, housing, workforce assignment, needs, happiness,
// stability, births, deaths, migration and leadership.
import { BUILDINGS, JOBS, JOB_KEYS } from '../data/buildings.js';
import { WORK_AGE, ELDER_AGE, DAYS_PER_YEAR } from '../core/constants.js';
import { makeAgent, ageYears, isAdult } from './agents.js';
import { mod, foodTotal, foodVariety, dailyFoodNeed } from './economy.js';
import { LEADER_TRAITS } from './government.js';
import { tribeName } from '../data/tribes.js';
import { clamp } from '../core/rng.js';

// Fast census run several times per second of game time.
export function census(game) {
  for (const t of game.tribes) {
    t.pop = 0; t.children = 0; t.elders = 0; t.adults = 0; t.homeless = 0; t.jobCounts = {}; t.hungry = 0;
    t.housing = 0; t.storehouses = 0; t._stores = []; t._sites = []; t.slots = {};
    for (const k of JOB_KEYS) t.slots[k] = JOBS[k].base || 0;
  }
  for (const s of game.settlements.values()) { s.pop = 0; s.housing = 0; }
  for (const b of game.buildings.values()) {
    const t = game.tribes[b.tribe]; const def = BUILDINGS[b.type];
    if (!b.built) { t._sites.push(b.id); continue; }
    if (def.housing) { t.housing += def.housing; const s = game.settlements.get(b.sid); if (s) s.housing += def.housing; }
    if (def.storage) t._stores.push(b.id);
    if (b.type === 'storehouse') t.storehouses++;
    if (def.job && def.slots) t.slots[def.job] = (t.slots[def.job] || 0) + def.slots;
    if (b.type === 'centre') { t.slots.gatherer += 2; t.slots.woodcutter += 1; t.slots.researcher += 1; t.slots.hunter += 2; }
  }
  for (const a of game.agents.values()) {
    const t = game.tribes[a.tribe];
    t.pop++;
    const y = ageYears(a);
    if (y < WORK_AGE) t.children++; else { t.adults++; if (y >= ELDER_AGE) t.elders++; }
    if (!a.homeId) t.homeless++;
    t.jobCounts[a.job] = (t.jobCounts[a.job] || 0) + 1;
    const s = game.settlements.get(a.sid); if (s) s.pop++;
  }
  for (const t of game.tribes) {
    t.slots.soldier = Math.round(t.slots.soldier * (1 + mod(t, 'soldierCap')));
    t.toolUsers = (t.jobCounts.woodcutter || 0) + (t.jobCounts.miner || 0) + (t.jobCounts.farmer || 0) + (t.jobCounts.builder || 0) + (t.jobCounts.craftsman || 0);
    t.peakPop = Math.max(t.peakPop || 0, t.pop);
  }
}

export function jobCap(tribe, job) {
  if (JOBS[job].unlimited) return Infinity;
  return tribe.slots[job] || 0;
}

// Clamp allocation targets so they are always possible.
export function normaliseAlloc(tribe) {
  const avail = tribe.adults;
  let sum = 0;
  for (const k of JOB_KEYS) {
    const v = Math.max(0, Math.min(Math.round(tribe.alloc[k] || 0), jobCap(tribe, k)));
    tribe.alloc[k] = v; sum += v;
  }
  if (sum > avail) {
    // trim from the least essential jobs first
    const order = ['trader', 'researcher', 'craftsman', 'soldier', 'miner', 'builder', 'hunter', 'fisher', 'woodcutter', 'gatherer', 'farmer'];
    let over = sum - avail;
    for (const k of order) { if (over <= 0) break; const cut = Math.min(over, tribe.alloc[k]); tribe.alloc[k] -= cut; over -= cut; }
  }
}

export function assignJobs(game, tribe) {
  normaliseAlloc(tribe);
  const adults = [], working = {};
  for (const a of game.agents.values()) {
    if (a.tribe !== tribe.id) continue;
    if (!isAdult(a)) { if (a.job !== 'idle') { a.job = 'idle'; a.workId = null; } continue; }
    if (a.army) { working.soldier = (working.soldier || 0) + 1; continue; }
    adults.push(a);
  }
  const byJob = {};
  for (const a of adults) (byJob[a.job] = byJob[a.job] || []).push(a);
  // release excess workers (least skilled first)
  for (const k of JOB_KEYS) {
    const list = byJob[k] || []; const target = tribe.alloc[k] - (k === 'soldier' ? (working.soldier || 0) : 0);
    if (list.length > target) {
      list.sort((x, y) => (x.skill[k] || 0) - (y.skill[k] || 0));
      for (const a of list.slice(0, list.length - Math.max(0, target))) { releaseJob(game, a); a.job = 'idle'; }
    }
  }
  const idle = adults.filter(a => a.job === 'idle');
  for (const k of JOB_KEYS) {
    const have = adults.filter(a => a.job === k).length + (k === 'soldier' ? (working.soldier || 0) : 0);
    let need = tribe.alloc[k] - have;
    while (need > 0 && idle.length) {
      // prefer someone experienced in this trade
      let bi = 0, bs = -1;
      for (let i = 0; i < idle.length; i++) { const s = (idle[i].skill[k] || 0) + (ageYears(idle[i]) >= ELDER_AGE && k === 'researcher' ? 0.5 : 0); if (s > bs) { bs = s; bi = i; } }
      const a = idle.splice(bi, 1)[0];
      releaseJob(game, a); a.job = k; a.needsWork = true; a.state = a.state === 'sleep' ? 'sleep' : 'think';
      need--;
    }
  }
  // attach workplaces
  const occupancy = new Map();
  for (const a of adults) if (a.workId != null) occupancy.set(a.workId, (occupancy.get(a.workId) || 0) + 1);
  for (const a of adults) {
    if (a.job === 'idle' || a.job === 'builder') { a.workId = null; continue; }
    if (a.workId != null) {
      const b = game.buildings.get(a.workId);
      if (b && b.built && b.tribe === tribe.id && (BUILDINGS[b.type].job === a.job || b.type === 'centre')) continue;
      a.workId = null;
    }
    a.workId = findWorkplace(game, tribe, a, occupancy);
    if (a.workId != null) occupancy.set(a.workId, (occupancy.get(a.workId) || 0) + 1);
    a.needsWork = false;
  }
  for (const b of game.buildings.values()) if (b.tribe === tribe.id) b.workerCount = occupancy.get(b.id) || 0;
}

function releaseJob(game, a) {
  a.workId = null;
  if (a.task?.res != null) game.reserved.delete(a.task.res);
  if (a.state === 'work' || a.state === 'build') { a.state = 'think'; a.hidden = false; }
}

function findWorkplace(game, tribe, a, occ) {
  let best = null, bd = 1e9;
  for (const b of game.buildings.values()) {
    if (b.tribe !== tribe.id || !b.built) continue;
    const def = BUILDINGS[b.type];
    let cap = 0;
    if (def.job === a.job) cap = def.slots;
    else if (b.type === 'centre' && b.sid === a.sid) cap = (JOBS[a.job].base || 0) + (a.job === 'gatherer' ? 2 : a.job === 'woodcutter' || a.job === 'researcher' ? 1 : a.job === 'hunter' ? 2 : 0);
    if ((occ.get(b.id) || 0) >= cap) continue;
    const d = Math.hypot(b.x - a.x, b.y - a.y) + (b.sid === a.sid ? 0 : 25) + (b.type === 'centre' ? 6 : 0);
    if (d < bd) { bd = d; best = b; }
  }
  return best ? best.id : null;
}

export function assignHousing(game, tribe) {
  const homes = [];
  for (const b of game.buildings.values()) if (b.tribe === tribe.id && b.built && BUILDINGS[b.type].housing) homes.push(b);
  const used = new Map();
  for (const a of game.agents.values()) if (a.tribe === tribe.id && a.homeId != null) {
    const h = game.buildings.get(a.homeId);
    if (!h || h.tribe !== tribe.id || !h.built) { a.homeId = null; continue; }
    const u = used.get(h.id) || 0;
    if (u >= BUILDINGS[h.type].housing) { a.homeId = null; continue; }
    used.set(h.id, u + 1);
  }
  for (const a of game.agents.values()) {
    if (a.tribe !== tribe.id || a.homeId != null) continue;
    // families stay together
    if (a.partner) { const p = game.agents.get(a.partner); if (p && p.homeId != null && (used.get(p.homeId) || 0) < BUILDINGS[game.buildings.get(p.homeId).type].housing) { a.homeId = p.homeId; used.set(p.homeId, used.get(p.homeId) + 1); continue; } }
    let best = null, bd = 1e9;
    for (const h of homes) {
      if ((used.get(h.id) || 0) >= BUILDINGS[h.type].housing) continue;
      const d = Math.hypot(h.x - a.x, h.y - a.y) + (h.sid === a.sid ? 0 : 40);
      if (d < bd) { bd = d; best = h; }
    }
    if (best) { a.homeId = best.id; used.set(best.id, (used.get(best.id) || 0) + 1); if (best.sid !== a.sid) a.sid = best.sid; }
  }
  for (const h of homes) h.residentCount = used.get(h.id) || 0;
}

// Per-capita building amenities (wells, shrines, bathhouses...)
function amenities(game, tribe) {
  let happy = 0, health = 0, stab = 0, disease = 0, drought = 0;
  for (const b of game.buildings.values()) {
    if (b.tribe !== tribe.id || !b.built) continue;
    const e = BUILDINGS[b.type].effect; if (!e || BUILDINGS[b.type].unique) continue;
    happy += e.happiness || 0; health += e.health || 0; stab += e.stability || 0; disease += e.disease || 0; drought += e.drought || 0;
  }
  const per = Math.max(1, tribe.pop / 20);
  return { happy: Math.min(12, happy / per * 2), health: Math.min(0.1, health / per), stab: Math.min(6, stab), disease: Math.max(-0.6, disease / per), drought };
}

// Happiness, stability, productivity. Runs every ~5s game time.
export function updateNeeds(game, tribe) {
  if (!tribe.pop) return;
  const am = amenities(game, tribe);
  tribe.amen = am;
  const need = dailyFoodNeed(game, tribe);
  const foodDays = foodTotal(tribe) / Math.max(1, need);
  const parts = {};
  parts.base = 50;
  parts.food = tribe.foodSat < 0.98 ? -35 * (1 - tribe.foodSat) - 5 : foodDays > 3 ? 6 : foodDays > 1 ? 2 : -4;
  parts.variety = Math.max(0, foodVariety(tribe) - 1) * 2;
  parts.housing = -28 * (tribe.homeless / Math.max(1, tribe.pop));
  const idle = (tribe.jobCounts.idle || 0) - tribe.children;
  parts.employment = -18 * Math.max(0, idle) / Math.max(1, tribe.adults) * (1 + mod(tribe, 'idleUnrest'));
  parts.safety = (tribe.atWar ? -4 : 0) + (tribe.threat ? -10 : 0) + Math.min(3, (tribe.jobCounts.soldier || 0) / Math.max(1, tribe.pop) * 30);
  parts.amenities = am.happy;
  parts.policy = mod(tribe, 'happiness');
  parts.crowding = -Math.max(0, tribe.pop - 60) / 40; // larger societies are harder to please
  let target = 0; for (const v of Object.values(parts)) target += v;
  target = clamp(target, 0, 100);
  tribe.happyParts = parts;
  tribe.happiness += (target - tribe.happiness) * 0.15;

  const sp = {};
  sp.base = 45;
  sp.policy = mod(tribe, 'stability');
  sp.mood = (tribe.happiness - 50) * 0.4;
  sp.sprawl = -Math.max(0, tribe.settlements.length - 1) * 5 * Math.max(0.2, 1 + mod(tribe, 'sprawl'));
  sp.war = -(tribe.warWeariness || 0) * 0.25 + (tribe.atWar ? mod(tribe, 'warStability') : 0);
  sp.reforms = -(tribe.stabilityShock || 0);
  sp.amenities = am.stab;
  let st = 0; for (const v of Object.values(sp)) st += v;
  st = clamp(st, 0, 100);
  tribe.stabParts = sp;
  tribe.stability += (st - tribe.stability) * 0.12;
  tribe.stabilityShock = Math.max(0, (tribe.stabilityShock || 0) * 0.985 - 0.02);

  tribe.productivity = clamp((0.62 + tribe.happiness / 130) * (1 + mod(tribe, 'productivity')) * (tribe.stability < 20 ? 0.85 : 1), 0.3, 1.6);
  tribe.healthBase = clamp(0.92 + am.health + mod(tribe, 'health') + (tribe.foodSat < 0.9 ? -0.2 : 0), 0.3, 1);
  tribe.diseaseRisk = Math.max(0.1, 1 + am.disease + mod(tribe, 'disease') - mod(tribe, 'diseaseResist') + Math.max(0, tribe.pop - 80) / 200);
}

// Births, deaths, ageing, partnerships, migration. Runs once per day.
export function dailyDemographics(game, tribe) {
  const rng = game.rng;
  const members = [];
  for (const a of game.agents.values()) if (a.tribe === tribe.id) members.push(a);
  for (const a of members) {
    a.age++;
    a.health += ((tribe.healthBase ?? 1) - a.health) * 0.3;
    if (tribe.foodSat < 0.95) a.health -= (1 - tribe.foodSat) * 0.35;
    a.health = clamp(a.health, 0, 1);
  }
  // deaths
  for (const a of members) {
    const y = ageYears(a);
    let p = 0.0006 + Math.max(0, y - 52) ** 2 * 0.00007;
    if (y < 2) p += 0.002;
    if (a.health < 0.35) p += (0.35 - a.health) * 0.5;
    if (rng.next() < p) game.removeAgent(a, a.health < 0.35 ? (tribe.foodSat < 0.9 ? 'starvation' : 'illness') : 'old age');
  }
  // partnerships
  const singles = members.filter(a => !a.partner && ageYears(a) >= 17 && ageYears(a) < 50 && game.agents.has(a.id));
  const men = singles.filter(a => !a.female), women = singles.filter(a => a.female);
  rng.shuffle(men);
  for (const m of men) {
    const wI = women.findIndex(w => w.sid === m.sid);
    if (wI >= 0 && rng.chance(0.35)) { const w = women.splice(wI, 1)[0]; m.partner = w.id; w.partner = m.id; if (w.homeId) m.homeId = null; }
  }
  // births: limited by housing, food and mood
  const freeHousing = tribe.housing - tribe.pop;
  const foodF = tribe.foodSat >= 0.99 ? 1 : 0.2;
  const moodF = 0.5 + tribe.happiness / 100;
  let births = 0;
  for (const w of members) {
    if (!w.female || !w.partner || !game.agents.has(w.id)) continue;
    const y = ageYears(w); if (y < 18 || y > 44) continue;
    if (freeHousing - births <= 0) break;
    const p = 0.075 * (1 + mod(tribe, 'birth')) * foodF * moodF * (tribe.boom ? 1.6 : 1);
    if (rng.next() < p) {
      const s = game.settlements.get(w.sid); if (!s) continue;
      const c = makeAgent(game, tribe, s, { age: 0, x: w.x, y: w.y, parents: [w.id, w.partner] });
      c.homeId = w.homeId; births++;
      tribe.stats.born++;
    }
  }
  if (births && tribe.isPlayer && rng.chance(0.3)) game.bus.emit('births', { tribe, n: births });
  // immigration: prosperous tribes attract wanderers
  if (tribe.happiness > 62 && freeHousing > 4 && tribe.stage >= 2 && rng.chance(0.18 + (tribe.happiness - 62) / 100)) {
    const s = game.settlements.get(tribe.capital);
    if (s) {
      const n = rng.int(2, 4);
      const ang = rng.next() * Math.PI * 2;
      for (let i = 0; i < n; i++) {
        const a = makeAgent(game, tribe, s, { age: rng.int(16, 34) * DAYS_PER_YEAR, x: s.x + Math.cos(ang) * 12, y: s.y + Math.sin(ang) * 12 });
        if (game.world.walkCost(game.world.idx(Math.floor(a.x), Math.floor(a.y))) === 0) { a.x = s.x; a.y = s.y; }
      }
      game.log(tribe, 'population', `${n} wanderers settled among the ${tribe.name}.`, tribe.isPlayer ? 1 : 0);
    }
  }
  // emigration: misery drives people away
  if (tribe.happiness < 25 && tribe.pop > 8 && rng.chance(0.4)) {
    const n = Math.max(1, Math.round(tribe.pop * 0.03));
    const adults = members.filter(a => game.agents.has(a.id) && isAdult(a) && !a.army);
    for (let i = 0; i < n && adults.length; i++) {
      const a = adults.splice(rng.int(0, adults.length - 1), 1)[0];
      game.removeAgent(a, 'emigrated');
    }
    game.log(tribe, 'population', `${n} ${tribe.name} abandoned their homes in despair.`, tribe.isPlayer ? 2 : 0);
  }
  // leadership
  if (tribe.leader) {
    tribe.leader.age++;
    if (tribe.leader.age / DAYS_PER_YEAR > 50 && rng.chance(0.004 * (tribe.leader.age / DAYS_PER_YEAR - 48))) {
      const old = tribe.leader;
      tribe.leader = makeLeader(game, tribe);
      tribe.stabilityShock = (tribe.stabilityShock || 0) + 6;
      tribe.modsDirty = true;
      game.log(tribe, 'government', `${tribe.def.leaderTitle} ${old.name} of the ${tribe.name} died. ${tribe.leader.name} the ${traitName(tribe.leader.trait)} succeeds.`, tribe.isPlayer ? 2 : 1);
    }
  }
}

export function makeLeader(game, tribe) {
  const rng = game.rng;
  const t = rng.pick(LEADER_TRAITS).key;
  return { name: tribeName(rng, tribe.def), age: rng.int(30, 46) * DAYS_PER_YEAR, trait: t, female: rng.chance(0.5) };
}
export const traitName = k => LEADER_TRAITS.find(t => t.key === k)?.name || k;
