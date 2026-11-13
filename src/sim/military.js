// Soldiers, armies, battles and sieges. Combat outcomes come from strength,
// equipment, morale, terrain and fortifications with modest randomness.
import { supplyFactor, estimateCampaign } from './logistics.js';
import { closedMask } from './pathfinding.js';
import { BUILDINGS } from '../data/buildings.js';
import { BIOMES } from '../world/biomes.js';
import { TECH } from '../data/techs.js';
import { mod, takeRes, addRes, eatFood, foodTotal } from './economy.js';
import { centreOf, doorTile, destroyBuilding, recomputeTerritory } from './buildings.js';
import { UNITS, ARMOURS, APPROACHES, LINE_UNITS, unitOf, unitOk, armourOf, autoPlan, hasTech } from '../data/warfare.js';
import { B } from '../world/biomes.js';

const uDef = (game, a) => UNITS[unitOf(game.tribes[a.tribe], a)];
// how much of a blow of this damage type gets through this soldier's armour
function armourTake(game, a, dmg) {
  const ar = ARMOURS[armourOf(game.tribes[a.tribe])];
  let k = ar.take[dmg] ?? 1;
  return k;
}
function armourSpeed(game, a) {
  const ar = ARMOURS[armourOf(game.tribes[a.tribe])];
  let s = ar.speed;
  if (ar.hot) { const w = game.world, bi = w.biome[w.idx(a.x | 0, a.y | 0)]; if (bi === B.DESERT || game.season === 1) s *= 0.92; }
  return s;
}
function hotPenalty(game, a) {
  const ar = ARMOURS[armourOf(game.tribes[a.tribe])]; if (!ar.hot) return 1;
  const w = game.world, bi = w.biome[w.idx(a.x | 0, a.y | 0)];
  return bi === B.DESERT ? ar.hot : 1;
}
export function unitSpeed(game, a) { return (uDef(game, a).speed || 1) * armourSpeed(game, a); }

export function equipTier(tribe) {
  let t = 0; for (const k of tribe.techs) t = Math.max(t, TECH[k]?.equip || 0); return t;
}

export function soldierPower(game, tribe, a) {
  const eq = equipTier(tribe);
  const armed = Math.min(1, (tribe.stock.weapons || 0) / Math.max(1, (tribe.jobCounts?.soldier || 1)) + 0.25);
  let p = 1 + eq * 0.28 * armed;
  p *= 1 + mod(tribe, 'military');
  p *= 0.7 + (tribe.happiness / 100) * 0.3 + (tribe.stability / 100) * 0.15;
  p *= 1 + (a.skill.soldier || 0) * 0.3 + Math.min(0.3, (a.xp || 0) * 0.01);
  p *= 0.6 + a.health * 0.4;
  if (tribe.foodSat < 0.8) p *= 0.8;
  if (a.army) p *= supplyFactor(game.armies.find(r => r.id === a.army));
  return p;
}

export function militaryStrength(game, tribe) {
  let s = 0;
  for (const a of game.agents.values()) if (a.tribe === tribe.id && a.job === 'soldier') s += soldierPower(game, tribe, a);
  for (const b of game.buildings.values()) if (b.tribe === tribe.id && b.built && BUILDINGS[b.type].tower) s += BUILDINGS[b.type].tower.dmg * 0.25 * (1 + mod(tribe, 'defense'));
  return s;
}

export function maxHp(tribe) { return 26 + equipTier(tribe) * 8; }

export function launchCampaign(game, tribe, targetSid, frac = 0.8, food = null, plan = null) {
  const target = game.settlements.get(targetSid);
  if (!target) return { ok: false, why: 'No such settlement' };
  const enemy = game.tribes[target.tribe];
  if (!game.dip.atWar(tribe.id, enemy.id)) return { ok: false, why: 'You are not at war with them' };
  const soldiers = [...game.agents.values()].filter(a => a.tribe === tribe.id && a.job === 'soldier' && !a.army);
  const n = Math.max(1, Math.floor(soldiers.length * frac));
  if (!soldiers.length) return { ok: false, why: 'You have no idle soldiers' };
  // the army carries its food; what it takes is no longer available at home
  if (food == null) food = estimateCampaign(game, tribe, targetSid, frac)?.food || n * 4;
  const carried = eatFood(tribe, Math.min(food, foodTotal(tribe) * 0.8)) || 0;
  plan = sanitizePlan(tribe, plan || autoPlan(tribe, target, game));
  // the line of approach: from home toward the target, turned by the chosen angle
  const home = game.settlements.get(tribe.capital) || target;
  const ang0 = Math.atan2(home.y - target.y, home.x - target.x);
  const ap = APPROACHES[plan.approach] || APPROACHES.direct;
  const army = { id: game.nextId++, tribe: tribe.id, target: targetSid, enemy: enemy.id, state: 'march', start: game.tick, size: n, losses: 0, kills: 0, food: carried, foodPlanned: food,
    plan, angle: ap.angle == null ? null : ang0 + ap.angle * Math.PI / 180, comp: {} };
  game.armies.push(army);
  soldiers.sort((a, b) => Math.hypot(a.x - target.x, a.y - target.y) - Math.hypot(b.x - target.x, b.y - target.y));
  const picked = soldiers.slice(0, n);
  // engines and sappers first (each needs its materials), then the line by the chosen mix
  const roles = [];
  for (const [u, cnt] of [['treb', plan.siege], ['sapper', plan.sappers]]) {
    for (let k = 0; k < cnt && roles.length < picked.length - 1; k++) {
      const cost = UNITS[u].cost || {};
      if (Object.entries(cost).some(([r, v]) => (tribe.stock[r] || 0) < v)) break;
      for (const [r, v] of Object.entries(cost)) takeRes(tribe, r, v);
      roles.push(u);
    }
  }
  const mixKeys = Object.keys(plan.mix).filter(u => plan.mix[u] > 0);
  const tot = mixKeys.reduce((x, u) => x + plan.mix[u], 0) || 1;
  const rest = picked.length - roles.length;
  let assigned = 0;
  mixKeys.forEach((u, i) => { const c = i === mixKeys.length - 1 ? rest - assigned : Math.round(rest * plan.mix[u] / tot); for (let k = 0; k < c; k++) roles.push(u); assigned += c; });
  while (roles.length < picked.length) roles.push(mixKeys[0] || 'warrior');
  picked.forEach((a, i) => { a.army = army.id; a.state = 'fight'; a.task = { kind: 'army' }; a.path = null; a.hp = maxHp(tribe); a.unit = roles[i]; army.comp[roles[i]] = (army.comp[roles[i]] || 0) + 1; });
  game.log(tribe, 'war', `${tribe.name} marched ${n} soldiers against ${target.name}.`, 2, { with: enemy.id, at: target });
  game.bus.emit('campaign', { army, tribe, target });
  return { ok: true, army };
}

export function sanitizePlan(tribe, p) {
  p = p || {};
  const mix = {};
  for (const u of LINE_UNITS) if (unitOk(tribe, u) && (p.mix?.[u] || 0) > 0) mix[u] = +p.mix[u];
  if (!Object.keys(mix).length) mix[LINE_UNITS.filter(u => unitOk(tribe, u)).pop() || 'warrior'] = 1;
  return {
    mix,
    siege: unitOk(tribe, 'treb') ? Math.max(0, Math.min(6, p.siege | 0)) : 0,
    sappers: unitOk(tribe, 'sapper') ? Math.max(0, Math.min(6, p.sappers | 0)) : 0,
    approach: APPROACHES[p.approach] ? p.approach : 'direct',
    focus: ['auto', 'army', 'towers', 'hearth', 'stores', 'homes'].includes(p.focus) ? p.focus : 'auto',
    lead: ['together', 'spear', 'sword', 'warrior', 'archer', 'siege'].includes(p.lead) ? p.lead : 'together',
  };
}

export function recallArmy(game, army) {
  army.state = 'return';
}

const near = (a, x, y, r) => (a.x - x) ** 2 + (a.y - y) ** 2 <= r * r;

function findEnemyNear(game, a, r) {
  let best = null, bd = r * r;
  for (const o of game.nearbyAgents(a.x, a.y, r)) {
    // soldiers fight soldiers; civilians are spared and shelter indoors
    if (o.tribe === a.tribe || o.hidden || o.job !== 'soldier' || !game.dip.atWar(a.tribe, o.tribe)) continue;
    const d = (o.x - a.x) ** 2 + (o.y - a.y) ** 2;
    if (d < bd) { bd = d; best = o; }
  }
  return best;
}

function moveToward(game, a, x, y, dt, speed = 1.7) {
  const w = game.world;
  const dx = x - a.x, dy = y - a.y, d = Math.hypot(dx, dy);
  if (d < 0.05) { a.moving = false; return true; }
  // follow a coarse path if far, else steer directly
  if (d > 3) {
    const gx0 = a.pathGoal != null ? a.pathGoal % w.w : -99, gy0 = a.pathGoal != null ? (a.pathGoal / w.w) | 0 : -99;
    const goalMoved = Math.abs(gx0 - x) + Math.abs(gy0 - y) > Math.max(3, d * 0.25);
    if (!a.path || a.pi >= a.path.length || goalMoved) {
      const goal = w.idx(Math.max(0, Math.min(w.w - 1, x | 0)), Math.max(0, Math.min(w.h - 1, y | 0)));
      const p = game.pf.find(w.idx(a.x | 0, a.y | 0), goal, { maxNodes: 9000, boats: game.tribes[a.tribe]?.boats || 0, closed: closedMask(game, a.tribe) });
      if (p === undefined) return false;
      a.path = p || []; a.pi = 0; a.pathGoal = goal;
      if (!p) { a.path = null; a.stuck = (a.stuck || 0) + 1; return false; }
    }
    if (a.path && a.pi < a.path.length) {
      const ti = a.path[a.pi]; const tx = ti % w.w + 0.5, ty = ((ti / w.w) | 0) + 0.5;
      const ddx = tx - a.x, ddy = ty - a.y, dd = Math.hypot(ddx, ddy);
      const cost = w.walkCost(w.idx(a.x | 0, a.y | 0)) || 1;
      const s = speed / Math.max(0.45, cost) * dt;
      a.moving = true; if (Math.abs(ddx) > 0.01) a.facing = ddx > 0 ? 1 : -1;
      if (dd <= s) { a.x = tx; a.y = ty; a.pi++; } else { a.x += ddx / dd * s; a.y += ddy / dd * s; }
      return false;
    }
  }
  const s = speed * dt;
  a.moving = true; if (Math.abs(dx) > 0.01) a.facing = dx > 0 ? 1 : -1;
  const nx = a.x + dx / d * Math.min(s, d), ny = a.y + dy / d * Math.min(s, d);
  const ni = w.idx(nx | 0, ny | 0), ow = w.owner[ni];
  if (ow >= 0 && ow !== a.tribe && ow !== w.owner[w.idx(a.x | 0, a.y | 0)] && (closedMask(game, a.tribe) >> ow) & 1) { a.moving = false; return false; } // closed border
  if (w.walkCost(ni) > 0 || (game.tribes[a.tribe]?.boats && w.biome[ni] <= 4 && (w.biome[ni] !== 0 || game.tribes[a.tribe].boats >= 2))) { a.x = nx; a.y = ny; }
  return d <= s;
}

function strike(game, a, foe, ranged = false) {
  const tribe = game.tribes[a.tribe], et = game.tribes[foe.tribe];
  const w = game.world;
  let atk = soldierPower(game, tribe, a) * (a.job === 'soldier' ? 1 : 0.25);
  let def = foe.job === 'soldier' ? soldierPower(game, et, foe) : 0.3;
  const ti = w.idx(foe.x | 0, foe.y | 0);
  // terrain and fortification bonuses for the defender on home soil
  if (w.owner[ti] === foe.tribe) {
    def *= 1 + (BIOMES[w.biome[ti]].defense || 0) + mod(et, 'defense') * 0.5;
    const s = game.settlements.get(foe.sid);
    if (s && s.fortified) def *= 1.25;
  }
  const ua = uDef(game, a), uf = uDef(game, foe), fk = unitOf(et, foe);
  def *= uf.def || 1;
  atk *= (ranged ? ua.ranged || 0.7 : ua.melee || 1) * (ua.vs?.[fk] || 1) * hotPenalty(game, a);
  const army = a.army && game.armies.find(r => r.id === a.army);
  if (army && !foe.army) atk *= APPROACHES[army.plan?.approach]?.bonus || 1;
  const dmg = 7 * atk / Math.max(0.4, def) * armourTake(game, foe, ua.dmg) * game.rng.range(0.75, 1.25);
  foe.hp -= dmg;
  if (ranged) game.fx.push({ kind: 'arrow', x: a.x, y: a.y - 0.6, tx: foe.x, ty: foe.y - 0.5, t: 0, life: 0.4, fire: hasTech(tribe, 'flamingarrows') ? 1 : 0 });
  game.fx.push({ kind: 'hit', x: foe.x, y: foe.y - 0.6, t: 0, life: 0.35, tribe: a.tribe });
  if (game.rng.chance(0.25)) game.bus.emit('sfx', { k: 'clash', x: foe.x, y: foe.y });
  const surrounded = a.army && game.armies.find(r => r.id === a.army)?.plan?.approach === 'surround';
  if (foe.hp <= 0 && !foe.army && !surrounded && game.world.owner[ti] === foe.tribe && game.rng.chance(0.55)) {
    // wounded defenders fall back to recover rather than fight to the death
    foe.hp = 8; foe.health = Math.max(0.3, foe.health - 0.3); foe.state = 'sleep'; foe.hidden = true; foe.wounded = game.tick + 200;
    game.dip.warScore(a.tribe, foe.tribe, 1);
    return;
  }
  if (foe.hp <= 0) {
    a.kills = (a.kills || 0) + 1; a.xp = (a.xp || 0) + 3;
    if (army) army.kills++;
    const farmy = foe.army && game.armies.find(r => r.id === foe.army); if (farmy) farmy.losses++;
    game.dip.warScore(a.tribe, foe.tribe, foe.job === 'soldier' ? 2 : 1);
    game.removeAgent(foe, 'battle');
  }
}

function strikeBuilding(game, a, b) {
  const tribe = game.tribes[a.tribe];
  const owner = game.tribes[b.tribe];
  const u = unitOf(tribe, a), ud = UNITS[u];
  let dmg = 5 * soldierPower(game, tribe, a) / (1 + mod(owner, 'defense') * 0.5) * game.rng.range(0.8, 1.2);
  const c = centreOf(b);
  if (u === 'archer') {
    const fire = hasTech(tribe, 'flamingarrows');
    dmg *= fire ? 0.9 : 0.25;
    if (fire && b.type !== 'centre' && game.rng.chance(0.12)) b.burning = Math.max(b.burning || 0, game.tick + 120);
    game.fx.push({ kind: 'arrow', x: a.x, y: a.y - 0.6, tx: c.x, ty: c.y - 0.8, t: 0, life: 0.45, fire: fire ? 1 : 0 });
  } else if (u === 'treb') {
    const blast = hasTech(tribe, 'explosiveshot');
    dmg *= ud.siege * (blast ? 1.6 : 1);
    game.fx.push({ kind: 'stone', x: a.x, y: a.y - 1, tx: c.x, ty: c.y - 0.5, t: 0, life: 1.1, blast: blast ? 1 : 0 });
    game.bus.emit('sfx', { k: 'clash', x: c.x, y: c.y });
    if (blast) {
      game.fx.push({ kind: 'blast', x: c.x, y: c.y, t: 0, life: 0.7 });
      if (b.type !== 'centre' && game.rng.chance(0.3)) b.burning = Math.max(b.burning || 0, game.tick + 90);
      for (const o of game.nearbyAgents(c.x, c.y, 2.5)) if (o.tribe !== a.tribe && o.job === 'soldier' && !o.hidden && game.dip.atWar(a.tribe, o.tribe)) {
        o.hp -= 14 * armourTake(game, o, 'blast');
        if (o.hp <= 0) { game.dip.warScore(a.tribe, o.tribe, 2); const ar = o.army && game.armies.find(r => r.id === o.army); if (ar) ar.losses++; game.removeAgent(o, 'battle'); }
      }
    }
  } else if (u === 'sapper') {
    // one charge, then they fight with what they have
    dmg = Math.min(dmg * 14, (b.maxHp || 100) * 0.3); a.unit = 'warrior';
    game.fx.push({ kind: 'blast', x: c.x, y: c.y, t: 0, life: 0.9, big: 1 });
    game.bus.emit('sfx', { k: 'clash', x: c.x, y: c.y });
    for (const o of game.nearbyAgents(c.x, c.y, 2)) if (o !== a && o.job === 'soldier' && !o.hidden) { o.hp -= 10 * armourTake(game, o, 'blast'); if (o.hp <= 0 && o.tribe !== a.tribe) { const ar = o.army && game.armies.find(r => r.id === o.army); if (ar) ar.losses++; game.removeAgent(o, 'battle'); } }
  } else if (u === 'spear') dmg *= 0.8;
  b.hp -= dmg;
  if (game.rng.chance(0.2)) game.fx.push({ kind: 'fire', x: b.x + game.rng.range(0, b.size), y: b.y + game.rng.range(0, b.size), t: 0, life: 1.5 });
  if (b.hp <= 0) {
    if (b.type === 'centre') { const s = game.settlements.get(b.sid); if (s.capital && (s.sackedUntil || 0) > game.tick) { b.hp = 1; for (const ar of game.armies) if (ar.tribe === a.tribe && ar.target === s.id) ar.state = 'return'; return; } captureSettlement(game, tribe, s); }
    else {
      game.dip.warScore(a.tribe, b.tribe, BUILDINGS[b.type].cat === 'military' ? 4 : 2);
      // plunder
      const loot = Object.entries(BUILDINGS[b.type].cost || {});
      for (const [r, v] of loot) addRes(game, tribe, r, v * 0.3);
      if (BUILDINGS[b.type].cat === 'housing') { const ar = a.army && game.armies.find(r => r.id === a.army); if (ar?.plan?.focus === 'homes') for (const o of game.tribes) if (o.alive && o.id !== tribe.id) game.dip.addMod(o.id, tribe.id, 'cruel', -3, { label: 'Burns homes', decay: 0.15, min: -15 }); }
      destroyBuilding(game, b, 'razed');
    }
  }
}

export function captureSettlement(game, tribe, s) {
  if (!s) return;
  const loser = game.tribes[s.tribe];
  const centre = game.buildings.get(s.centre);
  const others = loser.settlements.filter(id => id !== s.id);
  if (s.capital) {
    // capitals are sacked rather than taken while other towns stand
    for (const [r, v] of Object.entries(loser.stock)) { const take = v * 0.15; loser.stock[r] -= take; addRes(game, tribe, r, take); }
    centre.hp = centre.maxHp * 0.7;
    s.sackedUntil = game.tick + 360 * 10;
    game.dip.warScore(tribe.id, loser.id, 30);
    loser.stabilityShock = (loser.stabilityShock || 0) + 15;
    for (const o of game.tribes) if (o.alive && o.id !== tribe.id && o.id !== loser.id) game.dip.addMod(o.id, tribe.id, 'plunderer', -4, { label: 'Sacks foreign capitals', decay: 0.15, min: -16 });
    tribe.raidCooldown = tribe.raidCooldown || {}; tribe.raidCooldown[s.id] = game.tick + 360 * 8;
    game.log(tribe, 'war', `${tribe.name} sacked ${s.name}, the ${loser.name} capital!`, 3, { with: loser.id, at: s });
    game.bus.emit('sacked', { tribe, s });
    for (const ar of game.armies) if (ar.tribe === tribe.id && ar.target === s.id) ar.state = 'return';
    return;
  }
  // transfer the settlement
  s.tribe = tribe.id; s.capital = false;
  loser.settlements = others;
  tribe.settlements.push(s.id);
  for (const bid of s.buildings) { const b = game.buildings.get(bid); if (b) { b.tribe = tribe.id; if (b.type === 'centre') b.hp = b.maxHp * 0.5; game.markTiles(b.x, b.y, b.size, b.size); } }
  for (const a of game.agents.values()) if (a.sid === s.id && a.tribe === loser.id) {
    if (a.job === 'soldier') { game.removeAgent(a, 'battle'); continue; }
    a.tribe = tribe.id; a.job = 'idle'; a.workId = null; a.partner = null;
  }
  game.dip.warScore(tribe.id, loser.id, 45);
  game.dip.reputation[tribe.id] -= 3;
  for (const o of game.tribes) if (o.alive && o.id !== tribe.id && o.id !== loser.id) game.dip.addMod(o.id, tribe.id, 'conqueror', -8, { label: 'Conquers its neighbours', decay: 0.1, min: -24 });
  tribe.stabilityShock = (tribe.stabilityShock || 0) + 4;
  game.log(tribe, 'war', `${tribe.name} captured ${s.name} from the ${loser.name}!`, 3, { with: loser.id, at: s });
  for (const ar of game.armies) if (ar.target === s.id) ar.state = 'return';
  if (!loser.settlements.length) eliminate(game, loser, tribe);
  else if (loser.capital === s.id) loser.capital = loser.settlements[0];
  recomputeTerritory(game);
  tribe.modsDirty = loser.modsDirty = true;
  game.bus.emit('captured', { tribe, loser, s });
}

export function eliminate(game, loser, by) {
  loser.alive = false;
  for (const a of [...game.agents.values()]) if (a.tribe === loser.id) game.removeAgent(a, 'conquest');
  game.dip.onEliminated(loser.id);
  game.log(loser, 'war', `The ${loser.name} civilisation has fallen${by ? ' to the ' + by.name : ''}.`, 3);
  game.bus.emit('eliminated', { tribe: loser, by });
}

// Per-tick soldier behaviour. Called from agent update when state === 'fight'.
export function updateSoldier(game, a, dt) {
  const tribe = game.tribes[a.tribe];
  if (a.cd > 0) a.cd -= dt * 10;
  const army = a.army ? game.armies.find(r => r.id === a.army) : null;
  if (a.army && !army) a.army = null;

  const u = unitOf(tribe, a), ud = UNITS[u], spd = unitSpeed(game, a);
  const plan = army?.plan;
  const lead = plan?.lead || 'together';
  const isLead = !army || lead === 'together' || (lead === 'siege' ? u === 'treb' || u === 'sapper' : u === lead || (lead !== 'archer' && u === 'archer'));
  const opened = () => { if (army && isLead && !army.leadAt) army.leadAt = game.tick; };
  // engage nearby enemies first (engines never do; sappers only when cornered)
  const seek = u === 'treb' ? 0 : u === 'sapper' ? 1.2 : army ? (plan?.focus === 'army' ? 11 : 6) : 8;
  const foe = seek && (army || tribe.threat || a.target) ? findEnemyNear(game, a, seek) : null;
  if (foe) {
    const fd = Math.hypot(foe.x - a.x, foe.y - a.y);
    if (ud.range && fd <= ud.range && fd > 0.9) { a.moving = false; a.anim = 'attack'; if (Math.abs(foe.x - a.x) > 0.01) a.facing = foe.x > a.x ? 1 : -1; if (a.cd <= 0) { strike(game, a, foe, true); a.cd = 13; opened(); } }
    else if (fd <= 0.9 * (ud.reach || 1)) { a.moving = false; a.anim = 'attack'; if (a.cd <= 0) { strike(game, a, foe); a.cd = 9; opened(); } }
    else moveToward(game, a, foe.x, foe.y, dt, 1.9 * spd);
    return;
  }
  if (army) {
    const s = game.settlements.get(army.target);
    if (!s || s.tribe !== army.enemy || army.state === 'return' || !game.dip.atWar(a.tribe, army.enemy)) {
      // march home
      const home = game.settlements.get(a.sid) || game.settlements.get(tribe.capital);
      if (!home || moveToward(game, a, home.x + 0.5, home.y + 3, dt, 1.7 * spd)) { a.army = null; a.unit = null; a.staged = null; a.anim = null; a.state = 'think'; a.path = null; }
      return;
    }
    const d = Math.hypot(s.x - a.x, s.y - a.y);
    s.danger = game.tick + 60;
    game.tribes[s.tribe].threat = true;
    // the staging point: off to the chosen side of the town (surround: every side)
    const ang = army.angle == null ? (a.id * 2.399) : army.angle + ((a.id % 5) - 2) * 0.12;
    const stand = u === 'treb' ? 9 : 8;
    const gx = s.x + Math.cos(ang) * stand, gy = s.y + Math.sin(ang) * stand;
    if (a.staged !== army.id) {
      if (Math.hypot(gx - a.x, gy - a.y) > 2.2 && d > 4) { moveToward(game, a, gx, gy, dt, 1.7 * spd); return; }
      a.staged = army.id;
      army.staged = (army.staged || 0) + 1;
      if (!army.stagedAt) army.stagedAt = game.tick;
    }
    // waves: the lead troops go in first, the rest wait at the staging point
    // the rest hold until the lead troops have been fighting a while (or waited too long)
    if (!isLead && !(army.leadAt && game.tick - army.leadAt > (lead === 'siege' ? 120 : 50)) && game.tick - (army.stagedAt || game.tick) < 360) { a.moving = false; return; }
    // pick a building by the focus of the attack
    const focus = plan?.focus || 'auto';
    let tgt = null, bd = 1e9;
    for (const bid of s.buildings) {
      const b = game.buildings.get(bid); if (!b || !b.built) continue;
      const bdf = BUILDINGS[b.type];
      const c = centreOf(b); let dd = Math.hypot(c.x - a.x, c.y - a.y);
      const isDef = !!bdf.tower || bdf.cat === 'military', isHome = bdf.cat === 'housing', isStore = bdf.cat === 'production' || b.type === 'storehouse' || b.type === 'market';
      if (focus === 'auto' || focus === 'army') dd -= (bdf.tower ? 6 : 0) + (b.type === 'centre' ? 3 : 0);
      else if (focus === 'towers') dd -= isDef ? 30 : b.type === 'centre' ? 4 : 0;
      else if (focus === 'hearth') dd -= b.type === 'centre' ? 60 : 0;
      else if (focus === 'stores') dd -= isStore ? 30 : b.type === 'centre' ? 2 : 0;
      else if (focus === 'homes') dd -= isHome ? 30 : b.type === 'centre' ? 2 : 0;
      if (dd < bd) { bd = dd; tgt = b; }
    }
    if (!tgt) { army.state = 'return'; return; }
    const c = centreOf(tgt);
    const reach = tgt.size / 2 + (u === 'treb' ? ud.range : u === 'archer' ? ud.range - 0.5 : 0.9);
    if (Math.hypot(c.x - a.x, c.y - a.y) < reach) { a.moving = false; a.anim = 'attack'; if (Math.abs(c.x - a.x) > 0.01) a.facing = c.x > a.x ? 1 : -1; if (a.cd <= 0) { strikeBuilding(game, a, tgt); a.cd = u === 'treb' ? 40 : u === 'archer' ? 13 : 10; opened(); } }
    else if (u === 'treb' || u === 'archer') { const vx = a.x - c.x, vy = a.y - c.y, vd = Math.hypot(vx, vy) || 1, k = reach - 0.6; moveToward(game, a, c.x + vx / vd * k, c.y + vy / vd * k, dt, 1.7 * spd); }
    else moveToward(game, a, c.x + ((a.id % 3) - 1) * 0.5, c.y + tgt.size / 2 + 0.3, dt, 1.7 * spd);
    return;
  }
  // defenders: rally to the threatened settlement
  if (tribe.threat) {
    let ts = null;
    for (const sid of tribe.settlements) { const s = game.settlements.get(sid); if (s && s.danger > game.tick) { ts = s; break; } }
    if (ts) { if (!near(a, ts.x, ts.y, 3)) moveToward(game, a, ts.x + ((a.id % 5) - 2), ts.y + 2, dt, 1.9 * spd); else a.moving = false; return; }
  }
  a.state = 'think'; a.task = null; a.path = null;
}

// Towers fire at enemies in range; armies check morale. Every few ticks.
export function updateDefences(game) {
  for (const t of game.tribes) t.threat = false;
  for (const s of game.settlements.values()) if (s.danger > game.tick) game.tribes[s.tribe].threat = true;
  for (const b of game.buildings.values()) {
    const def = BUILDINGS[b.type];
    if (!b.built || !def.tower) continue;
    if (b.hp < b.maxHp) b.hp = Math.min(b.maxHp, b.hp + 0.05);
    const owner = game.tribes[b.tribe];
    if (!owner.atWar) continue;
    b.cd = (b.cd || 0) - 3;
    if (b.cd > 0) continue;
    const c = centreOf(b);
    let tgt = null, bd = def.tower.range ** 2;
    for (const o of game.nearbyAgents(c.x, c.y, def.tower.range)) {
      if (o.tribe === b.tribe || o.job !== 'soldier' || !game.dip.atWar(b.tribe, o.tribe) || o.hidden) continue;
      const d = (o.x - c.x) ** 2 + (o.y - c.y) ** 2; if (d < bd) { bd = d; tgt = o; }
    }
    if (tgt) {
      b.cd = def.tower.rate;
      game.fx.push({ kind: 'arrow', x: c.x, y: c.y - 1.2, tx: tgt.x, ty: tgt.y - 0.5, t: 0, life: 0.45, fire: hasTech(owner, 'flamingarrows') ? 1 : 0 });
      tgt.hp -= def.tower.dmg * (1 + mod(owner, 'defense')) * game.rng.range(0.7, 1.2) * armourTake(game, tgt, 'pierce') * (hasTech(owner, 'flamingarrows') ? 1.1 : 1);
      game.settlements.get(b.sid) && (game.settlements.get(b.sid).danger = game.tick + 40);
      if (tgt.hp <= 0) { game.dip.warScore(b.tribe, tgt.tribe, 2); const ar = game.armies.find(r => r.id === tgt.army); if (ar) ar.losses++; game.removeAgent(tgt, 'battle'); }
    }
  }
  // fires spread through thatch and timber until they burn out
  for (const b of [...game.buildings.values()]) {
    if (!b.burning) continue;
    if (b.burning < game.tick || !b.built) { b.burning = 0; continue; }
    b.hp -= 1.2 * (game.season === 3 ? 0.6 : 1);
    if (game.rng.chance(0.5)) game.fx.push({ kind: 'fire', x: b.x + game.rng.range(0, b.size), y: b.y + game.rng.range(0, b.size), t: 0, life: 1.5 });
    if (b.hp <= 0) { if (b.type === 'centre') { b.hp = 1; b.burning = 0; } else destroyBuilding(game, b, 'burned'); }
  }
  // army morale: retreat after heavy losses
  for (const ar of game.armies) {
    if (ar.state === 'return') continue;
    const alive = [...game.agents.values()].filter(a => a.army === ar.id).length;
    ar.alive = alive;
    if (alive === 0) { ar.state = 'done'; continue; }
    const t = game.tribes[ar.tribe];
    const breakAt = 0.55 + (t.def?.quirks?.morale || 0);
    if (ar.losses / ar.size > breakAt) { ar.state = 'return'; t.raidCooldown = t.raidCooldown || {}; t.raidCooldown[ar.target] = game.tick + 360 * 5; game.log(t, 'war', `The ${t.name} army fell back from ${game.settlements.get(ar.target)?.name || 'the field'}.`, 1); }
    if (game.tick - ar.start > 360 * 4) ar.state = 'return';
  }
  const keep = game.armies.filter(ar => ar.state !== 'done' && [...game.agents.values()].some(a => a.army === ar.id));
  for (const ar of game.armies) if (!keep.includes(ar) && ar.food > 1) addRes(game, game.tribes[ar.tribe], 'grain', ar.food); // unused food returns to the stores
  game.armies = keep;
}
