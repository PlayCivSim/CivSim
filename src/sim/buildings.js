// Building placement, construction, territory and roads.
import { BUILDINGS } from '../data/buildings.js';
import { BIOMES, B, isWater } from '../world/biomes.js';
import { DEPOSITS, DEP } from '../data/resources.js';
import { buildingCost, canAfford, pay, mod, addRes, scarcity } from './economy.js';

export function centreOf(b) { return { x: b.x + b.size / 2, y: b.y + b.size / 2 }; }
export function doorTile(game, b) {
  const w = game.world;
  const x = Math.min(w.w - 1, b.x + (b.size >> 1)), y = Math.min(w.h - 1, b.y + b.size);
  return w.idx(x, y);
}

export function isUnlocked(tribe, type) {
  const def = BUILDINGS[type];
  if (def.noBuild) return false;
  if (def.tribe && def.tribe !== tribe.key) return false;
  if (def.tech && !tribe.techs.includes(def.tech)) return false;
  return true;
}

export function availableBuildings(tribe) {
  return Object.keys(BUILDINGS).filter(t => isUnlocked(tribe, t));
}

export function hasUnique(game, tribe, type) {
  for (const b of game.buildings.values()) if (b.tribe === tribe.id && b.type === type) return true;
  return false;
}

export function accessibleDeposits(tribe, list) {
  return list.filter(k => {
    const d = DEPOSITS[DEP[k]];
    return !d.tech || tribe.techs.includes(d.tech);
  });
}

export function depositsNear(game, tribe, cx, cy, r, keys) {
  const w = game.world; let n = 0; const found = {};
  const allowed = new Set(keys.map(k => DEP[k]));
  for (let dy = -r; dy <= r; dy++) for (let dx = -r; dx <= r; dx++) {
    const x = Math.round(cx + dx), y = Math.round(cy + dy); if (!w.inb(x, y)) continue;
    const i = w.idx(x, y); const d = w.deposit[i];
    if (d && allowed.has(d) && w.depAmt[i] > 0) { n++; const k = DEPOSITS[d].key; found[k] = (found[k] || 0) + 1; }
  }
  return { n, found };
}

export function rockNear(game, cx, cy, r) {
  const w = game.world; let n = 0;
  for (let dy = -r; dy <= r; dy++) for (let dx = -r; dx <= r; dx++) { const x = Math.round(cx + dx), y = Math.round(cy + dy); if (w.inb(x, y)) { const b = w.biome[w.idx(x, y)]; if (b === B.HILLS || b === B.MOUNTAIN) n++; } }
  return n;
}

export function placementCheck(game, tribe, type, x, y, opts = {}) {
  const def = BUILDINGS[type]; const w = game.world; const s = def.size;
  if (!opts.ignoreUnlock && !isUnlocked(tribe, type) && type !== 'centre') return { ok: false, why: 'Not yet discovered' };
  if (x < 1 || y < 1 || x + s >= w.w - 1 || y + s >= w.h - 1) return { ok: false, why: 'Out of bounds' };
  let fert = 0, waterAdj = false;
  for (let dy = 0; dy < s; dy++) for (let dx = 0; dx < s; dx++) {
    const i = w.idx(x + dx, y + dy);
    if (!BIOMES[w.biome[i]].build) return { ok: false, why: 'Unsuitable terrain' };
    if (w.occ[i]) return { ok: false, why: 'Space is occupied' };
    if (w.road[i] && !opts.allowRoad) return { ok: false, why: 'Blocked by a road' };
    if (type === 'centre') { if (w.owner[i] !== -1 && w.owner[i] !== tribe.id) return { ok: false, why: 'Claimed by another tribe' }; }
    else if (w.owner[i] !== tribe.id) return { ok: false, why: 'Outside your territory' };
    fert += BIOMES[w.biome[i]].fert || 0;
  }
  if (opts.margin) {
    for (let dy = -1; dy <= s; dy++) for (let dx = -1; dx <= s; dx++) {
      if (dx >= 0 && dy >= 0 && dx < s && dy < s) continue;
      const xx = x + dx, yy = y + dy; if (!w.inb(xx, yy)) continue;
      if (w.occ[w.idx(xx, yy)]) return { ok: false, why: 'Too cramped' };
    }
  }
  if (def.site === 'rock') {
    const r = def.prod?.radius || 6;
    const dep = depositsNear(game, tribe, x + s / 2, y + s / 2, r, accessibleDeposits(tribe, def.prod.deps)).n;
    if (!dep && !rockNear(game, x + s / 2, y + s / 2, r)) return { ok: false, why: 'No stone deposits, hills or mountains nearby' };
  }
  if (def.site === 'water' || def.site === 'fertile' || def.site === 'open' || (def.site && def.site.startsWith('deposit'))) {
    if (def.site === 'water') {
      for (let dy = -1; dy <= s && !waterAdj; dy++) for (let dx = -1; dx <= s; dx++) { const xx = x + dx, yy = y + dy; if (w.inb(xx, yy) && isWater(w.biome[w.idx(xx, yy)])) { waterAdj = true; break; } }
      if (!waterAdj) return { ok: false, why: 'Must be beside water' };
    }
    if (def.site === 'fertile' && fert / (s * s) < 0.3) return { ok: false, why: 'Soil is too poor here' };
    if (def.site.startsWith('deposit')) {
      const keys = def.site.split(':')[1].split(',');
      const acc = accessibleDeposits(tribe, keys);
      if (!acc.length) return { ok: false, why: 'No workable deposits known' };
      const r = def.prod?.radius || 5;
      if (depositsNear(game, tribe, x + s / 2, y + s / 2, r, acc).n === 0) return { ok: false, why: 'No workable deposit nearby' };
    }
  }
  if (def.unique && hasUnique(game, tribe, type)) return { ok: false, why: 'Only one may be built' };
  if (!opts.free) { const cost = buildingCost(tribe, type); if (!canAfford(tribe, cost)) return { ok: false, why: 'Not enough resources', cost }; }
  return { ok: true, fert: fert / (s * s) };
}

export function nearestSettlement(game, tribe, x, y) {
  let best = null, bd = 1e9;
  for (const sid of tribe.settlements) { const s = game.settlements.get(sid); if (!s) continue; const d = Math.hypot(s.x - x, s.y - y); if (d < bd) { bd = d; best = s; } }
  return best;
}

export function placeBuilding(game, tribe, type, x, y, opts = {}) {
  const def = BUILDINGS[type]; const w = game.world;
  if (!opts.free) pay(tribe, buildingCost(tribe, type));
  const b = {
    id: game.nextId++, type, tribe: tribe.id, x, y, size: def.size, built: !!opts.built,
    progress: 0, hp: def.hp, maxHp: def.hp, workers: [], residents: [], sid: opts.sid ?? null,
    placed: game.tick, recipe: -1, focus: null, flags: 0, level: 1,
  };
  if (b.sid == null) { const s = nearestSettlement(game, tribe, x, y); b.sid = s ? s.id : null; }
  game.buildings.set(b.id, b);
  const s = game.settlements.get(b.sid); if (s) s.buildings.push(b.id);
  let wood = 0;
  for (let dy = 0; dy < def.size; dy++) for (let dx = 0; dx < def.size; dx++) {
    const i = w.idx(x + dx, y + dy);
    w.occ[i] = b.id + 1;
    if (w.road[i]) { w.road[i] = 0; game.pathDirty = true; }
    if (w.trees[i]) { wood += w.trees[i] / 40; w.trees[i] = 0; w.treeMax[i] = 0; }
    if (def.field) w.field[i] = 1;
  }
  if (wood > 0) addRes(game, tribe, 'wood', wood);
  game.markTiles(x - 1, y - 1, def.size + 2, def.size + 2);
  if (b.built) onComplete(game, b, true);
  else game.bus.emit('placed', { b, tribe });
  return b;
}

export function workRequired(b) { return BUILDINGS[b.type].work || 30; }

export function addProgress(game, b, amount) {
  if (b.built) return;
  b.progress += amount;
  if (b.progress >= workRequired(b)) { b.built = true; b.progress = workRequired(b); onComplete(game, b, false); }
}

function onComplete(game, b, silent) {
  const tribe = game.tribes[b.tribe]; const def = BUILDINGS[b.type];
  b.hp = b.maxHp = def.hp;
  if (def.unique || def.effect) { tribe.uniqueBuilt = tribe.uniqueBuilt || []; if (!tribe.uniqueBuilt.includes(b.type) && def.unique) tribe.uniqueBuilt.push(b.type); }
  tribe.modsDirty = true;
  tribe.stats.built++;
  game.territoryDirty = true;
  if (b.type !== 'centre') {
    const s = game.settlements.get(b.sid);
    if (s) { const c = game.buildings.get(s.centre); if (c) buildRoad(game, tribe, doorTile(game, b), doorTile(game, c)); }
  }
  game.markTiles(b.x - 1, b.y - 1, b.size + 2, b.size + 2);
  if (!silent) {
    game.bus.emit('built', { b, tribe });
    if (def.cat === 'culture') game.log(tribe, 'wonder', `${tribe.name} completed the ${def.name}!`, 3);
    else if (def.unique) game.log(tribe, 'build', `${tribe.name} built a ${def.name}.`, tribe.isPlayer ? 2 : 1);
  }
}

export function destroyBuilding(game, b, reason = 'destroyed') {
  const w = game.world; const def = BUILDINGS[b.type];
  for (let dy = 0; dy < b.size; dy++) for (let dx = 0; dx < b.size; dx++) { const i = w.idx(b.x + dx, b.y + dy); if (w.occ[i] === b.id + 1) w.occ[i] = 0; w.field[i] = 0; }
  game.buildings.delete(b.id);
  const s = game.settlements.get(b.sid); if (s) s.buildings = s.buildings.filter(id => id !== b.id);
  for (const a of game.agents.values()) {
    if (a.workId === b.id) { a.workId = null; a.job = a.job; a.needsWork = true; }
    if (a.homeId === b.id) a.homeId = null;
    if (a.siteId === b.id) a.siteId = null;
  }
  const tribe = game.tribes[b.tribe];
  if (def.unique && tribe.uniqueBuilt) tribe.uniqueBuilt = tribe.uniqueBuilt.filter(t => t !== b.type);
  tribe.modsDirty = true;
  game.territoryDirty = true;
  game.markTiles(b.x - 1, b.y - 1, b.size + 2, b.size + 2);
  game.bus.emit('destroyed', { b, reason });
  game.fx.push({ kind: 'dust', x: b.x + b.size / 2, y: b.y + b.size / 2, t: 0, life: 1.4, size: b.size });
}

export function buildRoad(game, tribe, from, to) {
  const w = game.world;
  const path = game.pf.search(from, to, 2500, tribe.techs.includes('roads'));
  if (!path || path.length > 60) return;
  const bridges = tribe.techs.includes('roads');
  let any = false;
  for (const i of [from, ...path]) {
    if (w.occ[i]) continue;
    const b = w.biome[i];
    if (isWater(b) && !(b === B.RIVER && bridges)) continue;
    if (!w.road[i]) { w.road[i] = tribe.techs.includes('roads') ? 2 : 1; w.trees[i] = 0; w.treeMax[i] = 0; any = true; game.markTiles(i % w.w, (i / w.w) | 0, 1, 1); }
    else if (w.road[i] === 1 && bridges) { w.road[i] = 2; game.markTiles(i % w.w, (i / w.w) | 0, 1, 1); }
  }
  if (any) game.pathDirty = true;
}

export function territoryRadius(game, s) {
  const pop = s.pop || 0;
  return 8 + Math.min(9, Math.floor(pop / 8)) + (s.capital ? 1 : 0);
}

export function recomputeTerritory(game) {
  const w = game.world;
  const prev = w.owner.slice();
  w.owner.fill(-1);
  const claim = (tid, cx, cy, r) => {
    const r2 = r * r;
    for (let dy = -r; dy <= r; dy++) for (let dx = -r; dx <= r; dx++) {
      if (dx * dx + dy * dy > r2) continue;
      const x = Math.round(cx + dx), y = Math.round(cy + dy); if (!w.inb(x, y)) continue;
      const i = w.idx(x, y); if (w.owner[i] === -1) w.owner[i] = tid;
    }
  };
  // footprints first so no building ends up in foreign land
  for (const b of game.buildings.values()) for (let dy = 0; dy < b.size; dy++) for (let dx = 0; dx < b.size; dx++) w.owner[w.idx(b.x + dx, b.y + dy)] = b.tribe;
  const setts = [...game.settlements.values()].sort((a, b) => a.id - b.id);
  for (const s of setts) claim(s.tribe, s.x, s.y, territoryRadius(game, s));
  for (const b of game.buildings.values()) {
    if (!b.built || b.type === 'centre') continue;
    const r = BUILDINGS[b.type].influence || 2;
    const c = centreOf(b); claim(b.tribe, c.x - 0.5, c.y - 0.5, r + 1);
  }
  let changed = false;
  for (let i = 0; i < w.n; i++) if (prev[i] !== w.owner[i]) { changed = true; break; }
  if (changed) { game.territoryVersion++; game.bus.emit('territory'); }
  for (const t of game.tribes) t.territory = 0;
  for (let i = 0; i < w.n; i++) { const o = w.owner[i]; if (o >= 0 && !isWater(w.biome[i])) game.tribes[o].territory++; }
  game.territoryDirty = false;
}

// ---- Settlement planner shared by the AI and the player's steward.
const STYLE_GRID = { oruvai: 4, vaelith: 3 };

export function scoreSpot(game, tribe, s, type, x, y) {
  const def = BUILDINGS[type]; const w = game.world; const sz = def.size;
  const cx = x + sz / 2, cy = y + sz / 2;
  const d = Math.hypot(cx - s.x, cy - s.y);
  let score = 0;
  const cat = def.cat;
  const wDist = cat === 'housing' ? 1.0 : cat === 'government' || cat === 'research' || type === 'market' || type === 'shrine' || type === 'well' ? 1.3 : cat === 'military' ? 0.4 : 0.35;
  score -= d * wDist;
  const style = tribe.key;
  if (STYLE_GRID[style]) {
    const g = STYLE_GRID[style];
    const ox = Math.round(x - s.x), oy = Math.round(y - s.y);
    if (((ox % g) + g) % g === 0) score += 2;
    if (((oy % g) + g) % g === 0) score += 2;
  }
  if (style === 'kharvak') score -= d * 0.4;
  if (style === 'thalori') {
    let t = 0; for (let dy = -2; dy <= sz + 1; dy++) for (let dx = -2; dx <= sz + 1; dx++) { const xx = x + dx, yy = y + dy; if (w.inb(xx, yy) && w.trees[w.idx(xx, yy)]) t++; }
    score += Math.min(t, 8) * 0.4 + game.rng.next() * 1.5;
  }
  const around = (r, fn) => { let v = 0; for (let dy = -r; dy <= r; dy++) for (let dx = -r; dx <= r; dx++) { const xx = Math.round(cx + dx), yy = Math.round(cy + dy); if (w.inb(xx, yy)) v += fn(w.idx(xx, yy)); } return v; };
  switch (type) {
    case 'lumber': score += Math.min(60, around(7, i => (w.trees[i] ? 1 : 0))) * 0.5; break;
    case 'hunter': score += around(9, i => w.fauna[i] && !isWater(w.biome[i]) ? w.fauna[i] / 255 : 0) * 0.15; score += d * 0.25; break;
    case 'gatherer': score += around(8, i => (BIOMES[w.biome[i]].fert || 0) + (w.trees[i] ? 0.2 : 0)) * 0.06; break;
    case 'fishery': case 'harbor': score += around(6, i => isWater(w.biome[i]) ? w.fauna[i] / 255 : 0) * 0.4; break;
    case 'quarry': case 'mine': case 'derrick': {
      const keys = accessibleDeposits(tribe, def.prod.deps);
      if (type === 'quarry') score += Math.min(12, rockNear(game, cx, cy, def.prod.radius)) * 0.5 * scarcity(tribe, 'stone');
      const r = depositsNear(game, tribe, cx, cy, def.prod.radius, keys);
      for (const [k, n] of Object.entries(r.found)) score += Math.min(6, n) * 1.2 * scarcity(tribe, DEPOSITS[DEP[k]].res) + (k === 'iron' ? 3 : 0);
      break;
    }
    case 'farm': case 'orchard': case 'pasture': {
      let f = 0; for (let dy = 0; dy < sz; dy++) for (let dx = 0; dx < sz; dx++) f += BIOMES[w.biome[w.idx(x + dx, y + dy)]].fert || 0;
      score += f * 2.2 + around(4, i => w.field[i] ? 0.25 : 0);
      if (w.riverDist[w.idx(Math.round(cx), Math.round(cy))] <= 3) score += 3;
      break;
    }
    case 'tower': { const R = territoryRadius(game, s); score -= Math.abs(d - (R - 2)) * 2; score += d * 0.4; break; }
    case 'storehouse': score -= Math.abs(d - 8) * 1.2; score += around(6, i => { const o = w.occ[i]; if (!o) return 0; const bb = game.buildings.get(o - 1); return bb && BUILDINGS[bb.type].prod ? 0.1 : 0; }); break;
    default: break;
  }
  if (cat === 'housing') score += around(3, i => (w.road[i] ? 0.25 : 0));
  return score;
}

export function findSpot(game, tribe, s, type, maxEval = 260, tight = false, overRoads = false) {
  const def = BUILDINGS[type]; const w = game.world;
  const R = territoryRadius(game, s) + 4;
  let best = null, bestScore = -1e9, evals = 0;
  const cands = [];
  for (let dy = -R; dy <= R; dy++) for (let dx = -R; dx <= R; dx++) {
    const x = Math.round(s.x + dx - def.size / 2), y = Math.round(s.y + dy - def.size / 2);
    if (!w.inb(x, y) || w.owner[w.idx(x, y)] !== tribe.id) continue;
    cands.push([x, y, dx * dx + dy * dy]);
  }
  // examine a mix of near and random candidates for bounded cost
  cands.sort((a, b) => a[2] - b[2]);
  const pool = cands.length > maxEval * 2 ? cands.filter((_, i) => i < maxEval || game.rng.next() < maxEval / cands.length) : cands;
  for (const [x, y] of pool) {
    if (evals > maxEval) break;
    const c = placementCheck(game, tribe, type, x, y, { margin: !tight, free: true, allowRoad: overRoads });
    if (!c.ok) continue;
    evals++;
    const sc = scoreSpot(game, tribe, s, type, x, y);
    if (sc > bestScore) { bestScore = sc; best = { x, y, score: sc }; }
  }
  // crowded towns: allow buildings to touch rather than fail outright
  if (!best && !tight) return findSpot(game, tribe, s, type, maxEval, true);
  // last resort for important buildings: build over our own road tiles
  if (!best && tight && !overRoads && BUILDINGS[type].cat !== 'housing') return findSpot(game, tribe, s, type, maxEval, true, true);
  return best;
}

export function upgradeTarget(tribe, b) {
  for (const [k, d] of Object.entries(BUILDINGS)) if (d.upgradeOf === b.type && isUnlocked(tribe, k) && d.size === b.size) return k;
  return null;
}

export function upgradeBuilding(game, tribe, b) {
  const to = upgradeTarget(tribe, b); if (!to) return { ok: false, why: 'No upgrade available' };
  const cost = buildingCost(tribe, to); if (!canAfford(tribe, cost)) return { ok: false, why: 'Not enough resources' };
  pay(tribe, cost);
  b.type = to; b.built = false; b.progress = 0; b.maxHp = BUILDINGS[to].hp;
  game.markTiles(b.x, b.y, b.size, b.size);
  return { ok: true };
}

export function buildingYieldInfo(game, b) {
  const def = BUILDINGS[b.type]; const tribe = game.tribes[b.tribe];
  if (!def.prod) return null;
  if (def.prod.deps) {
    const acc = accessibleDeposits(tribe, def.prod.deps);
    const r = depositsNear(game, tribe, b.x + b.size / 2, b.y + b.size / 2, def.prod.radius, acc);
    return { deposits: r.found };
  }
  return {};
}
