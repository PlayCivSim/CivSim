// Individual inhabitants: creation, the per-tick behaviour state machine and
// movement. Production happens through these work cycles, so the economy is a
// direct result of what people are visibly doing on the map.
import { specMul, specOf } from './logistics.js';
import { DAY_TICKS, TICK_DT, WORK_AGE, ELDER_AGE, DAYS_PER_YEAR } from '../core/constants.js';
import { BUILDINGS } from '../data/buildings.js';
import { BIOMES, B, isWater } from '../world/biomes.js';
import { DEPOSITS, DEP } from '../data/resources.js';
import { addRes, takeRes, mod, scarcity } from './economy.js';
import { doorTile, addProgress, accessibleDeposits, centreOf, rockNear, boostAt } from './buildings.js';
import { updateSoldier } from './military.js';
import { tradeTrip } from './diplomacy.js';
import { tribeName } from '../data/tribes.js';

export function makeAgent(game, tribe, s, opts = {}) {
  const rng = game.rng;
  const female = opts.female ?? rng.chance(0.5);
  const a = {
    id: game.nextId++, tribe: tribe.id, sid: s.id, name: opts.name || tribeName(rng, tribe.def), female,
    age: opts.age ?? 0, job: 'idle', workId: null, homeId: null, siteId: null,
    x: opts.x ?? s.x + rng.range(-2, 2), y: opts.y ?? s.y + rng.range(-2, 2),
    path: null, pi: 0, dest: -1, state: 'think', timer: rng.int(0, 20), carry: null, task: null,
    hp: 30, health: 1, skill: {}, partner: null, parents: opts.parents || null, army: null, target: null, cd: 0,
    facing: 1, moving: false, hidden: false, look: rng.int(0, 255), born: game.tick, kills: 0, bubble: 0, fails: 0,
  };
  game.agents.set(a.id, a);
  return a;
}

export const ageYears = a => a.age / DAYS_PER_YEAR;
export const isAdult = a => ageYears(a) >= WORK_AGE;

const tileOf = (game, a) => game.world.idx(Math.max(0, Math.min(game.world.w - 1, Math.floor(a.x))), Math.max(0, Math.min(game.world.h - 1, Math.floor(a.y))));

export function isNight(game) { const f = (game.tick % DAY_TICKS) / DAY_TICKS; return f > 0.8 || f < 0.1; }

export function goTo(game, a, tile, kind, extra) {
  const from = tileOf(game, a);
  // long trips (outposts, distant sites) get a bigger search so they are not mistaken for unreachable
  const far = Math.abs((tile % game.world.w) - (from % game.world.w)) + Math.abs(((tile / game.world.w) | 0) - ((from / game.world.w) | 0)) > 30;
  const p = game.pf.find(from, tile, { maxNodes: extra?.maxNodes ?? (far ? 16000 : undefined), force: extra?.force });
  if (p === undefined) { a.state = 'pathWait'; a.pending = { tile, kind, extra }; return 'wait'; }
  if (p === null) { a.fails++; return 'fail'; }
  a.path = p; a.pi = 0; a.dest = tile; a.task = { ...(extra || {}), act: kind }; a.state = 'walk'; a.hidden = false; a.fails = 0;
  if (p.length === 0) arrive(game, a);
  return 'ok';
}

function walkTo(game, a, x, y, kind, extra) {
  const w = game.world;
  x = Math.max(0, Math.min(w.w - 1, Math.round(x))); y = Math.max(0, Math.min(w.h - 1, Math.round(y)));
  return goTo(game, a, w.idx(x, y), kind, extra);
}

function wait(a, ticks, hidden = false) { a.state = 'wait'; a.timer = ticks; a.hidden = hidden; a.moving = false; }

export function nearestStore(game, tribe, x, y) {
  let best = null, bd = 1e9;
  for (const id of tribe._stores || []) { const b = game.buildings.get(id); if (!b || !b.built) continue; const c = centreOf(b); const d = (c.x - x) ** 2 + (c.y - y) ** 2; if (d < bd) { bd = d; best = b; } }
  return best;
}

function productivity(game, tribe, a) {
  let p = tribe.productivity || 1;
  if (ageYears(a) >= ELDER_AGE) p *= 0.6;
  p *= 0.6 + a.health * 0.4;
  return p;
}

function toolFactor(tribe) {
  const users = Math.max(1, tribe.toolUsers || 1);
  return 1 + Math.min(1, (tribe.stock.tools || 0) / (users * 0.6)) * 0.3;
}

function skillUp(game, tribe, a, job) {
  a.skill[job] = Math.min(1, (a.skill[job] || 0) + 0.02 * (1 + mod(tribe, 'skill')));
}
const skillMul = (a, job) => 1 + (a.skill[job] || 0) * 0.25;

function seasonFarm(game, tribe) {
  const s = game.season;
  const base = [0.75, 1.05, 1.6, 0.12][s];
  return s === 3 ? base + mod(tribe, 'winterFarm') : base;
}

// ---------------------------------------------------------------- update
export function updateAgents(game) {
  const w = game.world;
  const view = game.view;
  for (const a of game.agents.values()) {
    // distance-based detail: off-screen agents update every other tick with double dt
    let dt = TICK_DT;
    if (view && (a.x < view.x0 || a.x > view.x1 || a.y < view.y0 || a.y > view.y1)) {
      if ((a.id + game.tick) & 1) continue;
      dt = TICK_DT * 2;
    }
    if (a.bubble > 0) a.bubble -= dt;
    if (a.cd > 0) a.cd -= dt * 10;
    switch (a.state) {
      case 'walk': step(game, a, dt); break;
      case 'pathWait': {
        const p = a.pending; a.pending = null;
        const r = goTo(game, a, p.tile, p.kind, p.extra);
        if (r === 'fail') failTask(game, a);
        break;
      }
      case 'wait': a.timer -= dt * 10; a.moving = false; if (a.timer <= 0) a.state = 'think'; break;
      case 'work': doWork(game, a, dt); break;
      case 'build': doBuild(game, a, dt); break;
      case 'sleep': a.moving = false; if ((a.wounded || 0) > game.tick) break; if (!isNight(game) || (a.job === 'soldier' && game.tribes[a.tribe].threat)) { a.hidden = false; a.state = 'think'; } break;
      case 'fight': updateSoldier(game, a, dt); break;
      case 'mission': a.moving = false; break; // away on an envoy, scout or agent mission (intel.js)
      case 'travel': a.timer -= dt * 10; if (a.timer <= 0) { a.hidden = false; a.state = 'think'; finishTravel(game, a); } break;
      default: think(game, a); break;
    }
  }
}

function step(game, a, dt) {
  const w = game.world;
  if (!a.path || a.pi >= a.path.length) { arrive(game, a); return; }
  const tribe = game.tribes[a.tribe];
  const ti = a.path[a.pi];
  const tx = (ti % w.w) + 0.5, ty = ((ti / w.w) | 0) + 0.5;
  const cur = tileOf(game, a);
  let cost = w.walkCost(cur) || 1;
  let speed = 1.6 / Math.max(0.4, cost);
  if (w.road[cur]) speed *= 1 + mod(tribe, 'roadSpeed');
  if (a.job === 'soldier' && a.army) speed *= 1.1;
  if (ageYears(a) < 6 || ageYears(a) > 65) speed *= 0.75;
  const dx = tx - a.x, dy = ty - a.y; const d = Math.hypot(dx, dy);
  const s = speed * dt;
  a.moving = true;
  if (Math.abs(dx) > 0.01) a.facing = dx > 0 ? 1 : -1;
  if (d <= s) { a.x = tx; a.y = ty; a.pi++; if (a.pi >= a.path.length) arrive(game, a); }
  else { a.x += dx / d * s; a.y += dy / d * s; }
}

function failTask(game, a) {
  if (a.task?.res) game.reserved.delete(a.task.res);
  a.task = null; a.path = null;
  wait(a, 15 + (a.fails * 10));
  if (a.fails > 4 && a.workId) { a.workId = null; a.needsWork = true; a.fails = 0; }
}

function arrive(game, a) {
  a.moving = false; a.path = null;
  const t = a.task; a.task = null;
  if (!t) { a.state = 'think'; return; }
  const tribe = game.tribes[a.tribe];
  switch (t.act) {
    case 'gather': a.state = 'work'; a.timer = t.time; a.task = t; a.hidden = !!t.hide; a.inB = t.b != null ? t.b + 1 : 0; break;
    case 'atWork': a.state = 'work'; a.timer = t.time; a.task = t; a.hidden = !!t.hide; a.inB = t.b != null ? t.b + 1 : 0; break;
    case 'deliver': {
      if (a.carry) { for (const [r, v] of Object.entries(a.carry)) addRes(game, tribe, r, v); game.fx.push({ kind: 'pop', x: a.x, y: a.y - 1, t: 0, life: 0.8, res: Object.keys(a.carry)[0], tribe: a.tribe }); }
      a.carry = null; wait(a, 4); break;
    }
    case 'site': a.state = 'build'; a.task = t; break;
    case 'home': a.state = 'sleep'; a.hidden = !!t.inside; break;
    case 'social': wait(a, 30 + game.rng.int(0, 40)); if (game.rng.chance(0.5)) a.bubble = 2.5; break;
    case 'wander': wait(a, 10 + game.rng.int(0, 30)); break;
    case 'trade': tradeTrip(game, a, t); break;
    case 'army': case 'patrol': case 'defend': a.state = 'fight'; a.task = t; break;
    case 'leave': game.removeAgent(a, 'emigrated'); break;
    default: a.state = 'think';
  }
}

function finishTravel(game, a) {
  const t = a.travel; a.travel = null;
  if (t && t.then === 'returnHome') tradeTrip(game, a, { stage: 'back', partner: t.partner });
}

// ---------------------------------------------------------------- decisions
function think(game, a) {
  const tribe = game.tribes[a.tribe];
  const s = game.settlements.get(a.sid);
  if (!s) { a.state = 'wait'; a.timer = 20; return; }
  if (a.job === 'soldier' && (a.army || tribe.threat)) { a.state = 'fight'; a.task = { kind: 'army' }; return; }

  // civilians shelter when enemies are inside the settlement
  if (s.danger > game.tick && a.job !== 'soldier') {
    const home = a.homeId && game.buildings.get(a.homeId);
    const tgt = home || game.buildings.get(s.centre);
    if (tgt && goTo(game, a, doorTile(game, tgt), 'home', { inside: true }) !== 'fail') return;
  }

  if (isNight(game)) {
    const home = a.homeId && game.buildings.get(a.homeId);
    if (home && home.built) { if (goTo(game, a, doorTile(game, home), 'home', { inside: true }) !== 'fail') return; }
    // homeless sleep around the hearth
    const c = game.buildings.get(s.centre);
    if (c && walkTo(game, a, c.x + 1 + game.rng.range(-3, 4), c.y + 4 + game.rng.range(-1, 2), 'home', { inside: false }) !== 'fail') return;
    a.state = 'sleep'; return;
  }

  const years = ageYears(a);
  if (years < WORK_AGE) { wander(game, a, s, 5); return; }

  const job = a.job;
  if (job === 'idle') { socialise(game, a, s); return; }
  if (job === 'builder') { if (!builderTask(game, tribe, a, s)) gatherTask(game, tribe, a, s, 'woodcutter', null); return; }
  if (job === 'soldier') { soldierDrill(game, tribe, a, s); return; }
  const wb = a.workId != null ? game.buildings.get(a.workId) : null;
  if (!wb || !wb.built) { socialise(game, a, s); return; }
  const def = BUILDINGS[wb.type];
  if (job === 'researcher' || job === 'craftsman') { goTo(game, a, doorTile(game, wb), 'atWork', { time: def.prod?.time || 60, b: wb.id, hide: true }) === 'fail' && failTask(game, a); return; }
  if (job === 'trader') { if (wb.type === 'centre') { socialise(game, a, s); return; } if (goTo(game, a, doorTile(game, wb), 'trade', { stage: 'start', b: wb.id }) === 'fail') failTask(game, a); return; }
  gatherTask(game, tribe, a, s, job, wb);
}

function wander(game, a, s, r) {
  const home = a.homeId && game.buildings.get(a.homeId);
  const bx = home ? home.x + 1 : s.x, by = home ? home.y + 1 : s.y;
  if (walkTo(game, a, bx + game.rng.range(-r, r), by + game.rng.range(-r, r), 'wander') === 'fail') wait(a, 20);
}

function socialise(game, a, s) {
  const r = game.rng;
  if (r.chance(0.3)) { wander(game, a, s, 6); return; }
  const c = game.buildings.get(s.centre);
  const x = (c ? c.x + 1.5 : s.x) + r.range(-4, 4), y = (c ? c.y + 1.5 : s.y) + r.range(-3, 5);
  if (walkTo(game, a, x, y, 'social') === 'fail') wait(a, 20);
}

function builderTask(game, tribe, a, s) {
  let best = null, bd = 1e9;
  for (const id of tribe._sites || []) {
    const b = game.buildings.get(id); if (!b || b.built) continue;
    const crowd = b._builders || 0;
    const d = Math.hypot(b.x - a.x, b.y - a.y) + crowd * 8 + (b.sid === a.sid ? 0 : 30);
    if (d < bd) { bd = d; best = b; }
  }
  if (!best) return false;
  best._builders = (best._builders || 0) + 1;
  // stand on a random edge tile of the footprint
  const w = game.world; const r = game.rng;
  const side = r.int(0, 3); let x = best.x, y = best.y;
  if (side === 0) { x += r.int(0, best.size - 1); y -= 1; } else if (side === 1) { x += r.int(0, best.size - 1); y += best.size; } else if (side === 2) { x -= 1; y += r.int(0, best.size - 1); } else { x += best.size; y += r.int(0, best.size - 1); }
  if (!w.inb(x, y) || !w.walkCost(w.idx(x, y))) { x = best.x + (best.size >> 1); y = best.y + best.size; }
  const res = goTo(game, a, w.idx(Math.min(w.w - 1, x), Math.min(w.h - 1, y)), 'site', { b: best.id });
  if (res === 'fail') { best._builders--; return false; }
  return true;
}

function doBuild(game, a, dt) {
  const tribe = game.tribes[a.tribe];
  const b = game.buildings.get(a.task?.b);
  if (!b || b.built || isNight(game)) { if (b) b._builders = Math.max(0, (b._builders || 1) - 1); a.state = 'think'; a.task = null; return; }
  const sp = dt * 1.0 * (1 + mod(tribe, 'build')) * productivity(game, tribe, a) * toolFactor(tribe) * skillMul(a, 'builder');
  addProgress(game, b, sp);
  a.moving = false; a.anim = 'hammer';
  if (game.rng.chance(0.02)) { game.fx.push({ kind: 'spark', x: b.x + b.size / 2 + game.rng.range(-1, 1), y: b.y + b.size / 2, t: 0, life: 0.5 }); game.bus.emit('sfx', { k: 'hammer', x: b.x, y: b.y }); }
  if (b.built) { b._builders = 0; skillUp(game, tribe, a, 'builder'); a.state = 'think'; a.task = null; }
}

function soldierDrill(game, tribe, a, s) {
  const wb = a.workId != null ? game.buildings.get(a.workId) : game.buildings.get(s.centre);
  if (!wb) { wander(game, a, s, 6); return; }
  const r = game.rng;
  if (r.chance(0.35)) {
    // patrol toward the territory edge
    const ang = r.next() * Math.PI * 2, d = 5 + r.next() * 6;
    if (walkTo(game, a, s.x + Math.cos(ang) * d, s.y + Math.sin(ang) * d, 'wander') !== 'fail') return;
  }
  const x = wb.x + r.range(-1, wb.size + 1), y = wb.y + wb.size + r.range(0, 2);
  if (walkTo(game, a, x, y, 'atWork', { time: 50, drill: true }) === 'fail') wait(a, 20);
}

// Gathering jobs: choose a resource tile, walk, work, carry back.
const JOB_TARGETS = {
  woodcutter: { kind: 'trees', radius: 9, time: 45, res: 'wood', amt: 3, mod: 'wood' },
  gatherer: { kind: 'wild', radius: 10, time: 45, res: 'fruit', amt: 1.8, mod: 'farm' },
};

function gatherTask(game, tribe, a, s, job, wb) {
  const def = wb ? BUILDINGS[wb.type] : null;
  const prod = def?.prod || JOB_TARGETS[job] || JOB_TARGETS.gatherer;
  const kind = prod.gather || (def?.field ? 'field' : JOB_TARGETS[job]?.kind);
  let origin = wb ? centreOf(wb) : { x: s.x, y: s.y };
  // the people lean their foraging, felling and hunting toward the chosen expansion direction
  if (tribe.expandTarget && (job === 'gatherer' || job === 'woodcutter' || job === 'hunter')) { const tx = tribe.expandTarget.x - origin.x, ty = tribe.expandTarget.y - origin.y, td = Math.hypot(tx, ty) || 1; const k = Math.min(5, td); origin = { x: origin.x + tx / td * k, y: origin.y + ty / td * k }; }
  const w = game.world, r = game.rng;
  let tile = -1;
  if (kind === 'field') {
    tile = w.idx(wb.x + r.int(0, wb.size - 1), wb.y + r.int(0, wb.size - 1));
    return goTo(game, a, tile, 'gather', { time: prod.time, b: wb.id, kind }) === 'fail' ? failTask(game, a) : null;
  }
  if (kind === 'deposit') {
    const acc = accessibleDeposits(tribe, prod.deps);
    const want = wb.focus && acc.includes(wb.focus) ? [wb.focus] : acc;
    const ids = new Set(want.map(k => DEP[k]));
    let best = -1, bv = -1;
    const rad = prod.radius;
    for (let dy = -rad; dy <= rad; dy++) for (let dx = -rad; dx <= rad; dx++) {
      const x = Math.round(origin.x + dx), y = Math.round(origin.y + dy); if (!w.inb(x, y)) continue;
      const i = w.idx(x, y); const d = w.deposit[i];
      if (!d || !ids.has(d) || w.depAmt[i] <= 0) continue;
      const v = scarcity(tribe, DEPOSITS[d].res) * (0.8 + r.next() * 0.4);
      if (v > bv) { bv = v; best = i; }
    }
    // quarries may instead cut bare rock when stone is what the people need
    if (wb.type === 'quarry' && (!wb.focus || wb.focus === 'stone')) {
      if (wb._rock == null) wb._rock = rockNear(game, origin.x, origin.y, prod.radius);
      const rv = wb._rock ? scarcity(tribe, 'stone') * 0.75 : 0;
      if (rv > bv) best = -1;
    }
    if (best < 0) {
      // quarries fall back to cutting bare rock: slower but inexhaustible
      if (wb.type === 'quarry' && (wb._rock ?? rockNear(game, origin.x, origin.y, prod.radius))) { wb.flags &= ~1; return goTo(game, a, doorTile(game, wb), 'gather', { time: prod.time * 1.4, b: wb.id, kind: 'rock', hide: true }) === 'fail' ? failTask(game, a) : null; }
      wb.flags |= 1; socialise(game, a, s); return;
    }
    wb.flags &= ~1;
    // miners work inside the building and draw from the deposit
    return goTo(game, a, doorTile(game, wb), 'gather', { time: prod.time, b: wb.id, kind, dep: best, hide: true }) === 'fail' ? failTask(game, a) : null;
  }
  // sample random tiles in radius and pick the nearest good one
  const rad = prod.radius || 9;
  let bestD = 1e9;
  for (let k = 0; k < 18; k++) {
    const x = Math.round(origin.x + r.range(-rad, rad)), y = Math.round(origin.y + r.range(-rad, rad));
    if (!w.inb(x, y)) continue;
    const i = w.idx(x, y);
    if (game.reserved.has(i)) continue;
    let ok = false;
    if (kind === 'trees') ok = w.trees[i] > 20 && !w.occ[i];
    else if (kind === 'game') ok = w.fauna[i] > 25 && !isWater(w.biome[i]) && !w.occ[i];
    else if (kind === 'fish') ok = isWater(w.biome[i]) && w.fauna[i] > 20;
    else if (kind === 'wild') ok = !isWater(w.biome[i]) && !w.occ[i] && !w.road[i] && ((BIOMES[w.biome[i]].fert || 0) > 0.2 || BIOMES[w.biome[i]].herbs);
    if (!ok) continue;
    const d = Math.hypot(x - a.x, y - a.y);
    if (d < bestD) { bestD = d; tile = i; }
  }
  if (tile < 0) { if (wb) wb.flags |= 1; wander(game, a, s, 4); return; }
  if (wb) wb.flags &= ~1;
  let stand = tile;
  if (kind === 'fish') { stand = shoreNear(game, tile); if (stand < 0) { wait(a, 20); return; } }
  game.reserved.add(tile);
  const res = goTo(game, a, stand, 'gather', { time: prod.time || 45, b: wb?.id, kind, res: tile, job });
  if (res === 'fail') failTask(game, a);
}

function shoreNear(game, i) {
  const w = game.world; const x = i % w.w, y = (i / w.w) | 0;
  for (let r = 1; r <= 3; r++) for (let dy = -r; dy <= r; dy++) for (let dx = -r; dx <= r; dx++) {
    const xx = x + dx, yy = y + dy; if (!w.inb(xx, yy)) continue; const j = w.idx(xx, yy);
    if (!isWater(w.biome[j]) && w.walkCost(j) > 0 && !w.occ[j]) return j;
  }
  return -1;
}

function doWork(game, a, dt) {
  a.moving = false;
  a.timer -= dt * 10;
  const tribe = game.tribes[a.tribe];
  if (a.timer > 0) {
    if (a.task?.kind === 'trees' && game.rng.chance(0.015)) game.bus.emit('sfx', { k: 'chop', x: a.x, y: a.y });
    if (a.task?.kind === 'trees' && game.rng.chance(0.04)) game.fx.push({ kind: 'chip', x: a.x + a.facing * 0.5, y: a.y - 0.4, t: 0, life: 0.4 });
    return;
  }
  const t = a.task; a.task = null; a.hidden = false;
  if (!t) { a.state = 'think'; return; }
  if (t.drill) { a.state = 'think'; skillUp(game, tribe, a, 'soldier'); a.xp = (a.xp || 0) + (specOf(game, a.sid) === 'military' ? 2 : 1); return; }
  const w = game.world;
  const wb = t.b != null ? game.buildings.get(t.b) : null;
  if (t.b != null && !wb) { if (t.res != null) game.reserved.delete(t.res); a.state = 'think'; return; }
  const def = wb ? BUILDINGS[wb.type] : null;
  const job = a.job;
  const p = productivity(game, tribe, a) * skillMul(a, job) * specMul(game, wb, job) * (wb ? 1 + boostAt(game, wb) : 1);
  let carry = null;
  const add = (r, v) => { if (v > 0) { carry = carry || {}; carry[r] = (carry[r] || 0) + v; } };

  if (job === 'researcher' && def?.prod?.research) {
    const pts = def.prod.research * p * (1 + mod(tribe, 'research')) * (1 + (def.cat === 'research' ? mod(tribe, 'specialised') : 0));
    game.addResearch(tribe, pts);
    skillUp(game, tribe, a, job); a.state = 'think';
    if (game.rng.chance(0.3)) game.fx.push({ kind: 'glyph', x: wb.x + wb.size / 2, y: wb.y, t: 0, life: 1.2, tribe: tribe.id });
    return;
  }
  if (job === 'craftsman' && def?.prod?.recipes) {
    const recipes = def.prod.recipes;
    const order = wb.recipe >= 0 ? [recipes[wb.recipe], ...recipes] : recipes;
    let made = false;
    for (const rc of order) {
      if (!rc) continue;
      let ok = true; for (const [r, v] of Object.entries(rc.in)) if ((tribe.stock[r] || 0) < v) { ok = false; break; }
      if (!ok) continue;
      for (const [r, v] of Object.entries(rc.in)) takeRes(tribe, r, v);
      const m = 1 + mod(tribe, def.prod.mod) + mod(tribe, 'specialised');
      add(rc.out, rc.amt * p * m * toolFactor(tribe));
      made = true; break;
    }
    if (!made) { wb.flags |= 2; a.state = 'think'; wait(a, 25); return; }
    wb.flags &= ~2;
    skillUp(game, tribe, a, job);
  } else if (t.kind === 'field') {
    const fert = BIOMES[w.biome[w.idx(wb.x + 1, wb.y + 1)]].fert || 0.5;
    const m = (1 + mod(tribe, 'farm')) * p * toolFactor(tribe) * (tribe.droughtMul ?? 1);
    if (def.prod.livestock) {
      add('meat', def.prod.amt * m * 0.9);
      if (game.rng.chance(0.2)) add('fibre', 1);
      tribe.stock.livestock = Math.min(60, (tribe.stock.livestock || 0) + 0.05);
    } else {
      const amt = def.prod.amt * m * Math.max(0.35, fert) * seasonFarm(game, tribe);
      if (def.prod.alt) { add(def.prod.out, amt * 0.6); add(def.prod.alt, amt * 0.4); } else add(def.prod.out, amt);
    }
    skillUp(game, tribe, a, job);
  } else if (t.kind === 'rock') {
    add('stone', 3 * p * (1 + mod(tribe, 'mine')) * toolFactor(tribe));
    skillUp(game, tribe, a, job);
  } else if (t.kind === 'deposit') {
    const i = t.dep; const d = w.deposit[i];
    if (d && w.depAmt[i] > 0) {
      const dd = DEPOSITS[d];
      const amt = (def.prod.amt + (dd.res === 'stone' ? 1.4 : dd.res === 'clay' ? 0.6 : 0)) * p * (1 + mod(tribe, def.prod.mod)) * toolFactor(tribe);
      const deplete = Math.ceil(amt * Math.max(0.2, 1 + mod(tribe, 'depletion')));
      w.depAmt[i] = Math.max(0, w.depAmt[i] - deplete);
      if (w.depAmt[i] === 0) { w.deposit[i] = 0; game.markTiles(i % w.w, (i / w.w) | 0, 1, 1); game.bus.emit('depleted', { tribe, res: dd.res }); }
      add(dd.res, amt);
      skillUp(game, tribe, a, job);
    }
  } else {
    const i = t.res;
    game.reserved.delete(i);
    if (t.kind === 'trees' && w.trees[i] > 0) {
      const amt = 3 * p * (1 + mod(tribe, 'wood')) * toolFactor(tribe);
      const cut = Math.min(w.trees[i], 30);
      w.trees[i] -= cut;
      if (w.trees[i] < 20) { w.trees[i] = 0; game.markTiles(i % w.w, (i / w.w) | 0, 1, 1); game.fx.push({ kind: 'fall', x: (i % w.w) + 0.5, y: ((i / w.w) | 0) + 0.5, t: 0, life: 0.8 }); }
      add('wood', amt * (job === 'builder' ? 0.7 : 1));
    } else if (t.kind === 'game' && w.fauna[i] > 0) {
      const amt = 2.6 * p * (1 + mod(tribe, 'hunt'));
      w.fauna[i] = Math.max(0, w.fauna[i] - 22);
      add('meat', amt);
      if (game.rng.chance(0.5)) add('fibre', 0.8);
      if (BIOMES[w.biome[i]].fur && game.rng.chance(0.4)) add('goods', 0.3);
    } else if (t.kind === 'fish' && w.fauna[i] > 0) {
      const amt = 3 * p * (1 + mod(tribe, 'fish'));
      w.fauna[i] = Math.max(0, w.fauna[i] - 18);
      add('fish', amt);
      if (BIOMES[w.biome[i]].key === 'shallow' && game.rng.chance(0.15)) add('salt', 0.5);
    } else if (t.kind === 'wild') {
      const bd = BIOMES[w.biome[i]];
      const m = p * (1 + mod(tribe, 'farm') * 0.5);
      add('fruit', 1.8 * m * Math.max(0.3, bd.fert || 0.3) * (game.season === 3 ? 0.4 : 1));
      if (bd.fibre && game.rng.chance(0.6)) add('fibre', 1 * (bd.fibre || 0.5));
      if (bd.herbs && game.rng.chance(0.5)) add('herbs', 0.8 * bd.herbs);
    }
    skillUp(game, tribe, a, job);
  }
  if (!carry) { a.state = 'think'; return; }
  a.carry = carry;
  const store = nearestStore(game, tribe, a.x, a.y);
  if (!store) { for (const [r, v] of Object.entries(carry)) addRes(game, tribe, r, v); a.carry = null; a.state = 'think'; return; }
  if (goTo(game, a, doorTile(game, store), 'deliver') === 'fail') { for (const [r, v] of Object.entries(carry)) addRes(game, tribe, r, v); a.carry = null; a.state = 'think'; }
}
