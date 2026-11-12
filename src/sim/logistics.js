// Logistics and settlement identity: army supply lines and attrition,
// settlement specialisations, and technological eras.
import { DAY_TICKS } from '../core/constants.js';
import { maxHp } from './military.js';
import { aiOf } from './aimind.js';
import { BUILDINGS } from '../data/buildings.js';
import { DEPOSITS } from '../data/resources.js';
import { destroyBuilding, placementCheck, placeBuilding, isUnlocked, outpostLimit } from './buildings.js';
import { scarcity, canAfford, buildingCost } from './economy.js';
import { eatFood, foodTotal } from './economy.js';
import { BIOMES } from '../world/biomes.js';
import { RESOURCES } from '../data/resources.js';
const RES_FOOD = new Set(Object.keys(RESOURCES).filter(k => RESOURCES[k].food));

// ------------------------------------------------------------------ settlement specialisation
export const SPECS = {
  production: { name: 'Production', icon: 'hammer', desc: 'Gatherers, woodcutters, miners, farmers and craftsmen here work 20% faster. Traders and scholars here work 10% slower.' },
  trade: { name: 'Trade', icon: 'coin', desc: 'Traders here work 40% faster and their caravans earn 30% more. Other workers here are 10% slower.' },
  military: { name: 'Military', icon: 'military', desc: 'Barracks here hold 50% more soldiers, soldiers here train twice as fast, and the town supplies armies 10 tiles further. Other workers here are 10% slower.' },
  culture: { name: 'Culture', icon: 'star', desc: 'Scholars here work 25% faster and the town adds +3 happiness to your people. Producers here are 10% slower.' },
};
const PRODUCERS = new Set(['gatherer', 'woodcutter', 'miner', 'farmer', 'craftsman', 'hunter', 'fisher']);
export const SPEC_COOLDOWN_DAYS = 30;

export function specOf(game, sid) { return game.settlements.get(sid)?.spec || null; }
// Work-speed multiplier for a worker at building `wb`.
export function specMul(game, wb, job) {
  if (!wb) return 1;
  const sp = specOf(game, wb.sid); if (!sp) return 1;
  if (sp === 'production') return PRODUCERS.has(job) ? 1.2 : job === 'trader' || job === 'researcher' ? 0.9 : 1;
  if (sp === 'trade') return job === 'trader' ? 1.4 : 0.9;
  if (sp === 'culture') return job === 'researcher' ? 1.25 : PRODUCERS.has(job) ? 0.9 : 1;
  if (sp === 'military') return job === 'soldier' ? 1 : 0.9;
  return 1;
}
export function setSpec(game, tribe, sid, spec) {
  const s = game.settlements.get(sid);
  if (!s || s.tribe !== tribe.id) return { ok: false, why: 'Not your settlement' };
  if (spec && !SPECS[spec]) return { ok: false, why: 'Unknown specialisation' };
  if (s.specAt && game.tick - s.specAt < SPEC_COOLDOWN_DAYS * DAY_TICKS) return { ok: false, why: `Can change again in ${Math.ceil((SPEC_COOLDOWN_DAYS * DAY_TICKS - (game.tick - s.specAt)) / DAY_TICKS)} days` };
  s.spec = spec || null; s.specAt = game.tick;
  game.log(tribe, 'settlement', `${s.name} now focuses on ${spec ? SPECS[spec].name.toLowerCase() : 'nothing in particular'}.`, tribe.isPlayer ? 1 : 0, { at: { x: s.x, y: s.y } });
  return { ok: true };
}
export const cultureHappiness = (game, tribe) => Math.min(9, tribe.settlements.filter(sid => specOf(game, sid) === 'culture').length * 3);
// AI rulers choose a focus for each new town from their temperament.
export function aiSpecialise(game, t) {
  if (t.isPlayer) return;
  const ai = aiOf(t);
  for (const sid of t.settlements) {
    const s = game.settlements.get(sid); if (!s || s.spec !== undefined && s.spec !== null) continue;
    if (s.capital && t.settlements.length < 2) continue;
    const pick = ai.aggression > 0.65 ? 'military' : ai.trade > 0.7 ? 'trade' : ai.research > 0.8 ? 'culture' : 'production';
    s.spec = s.capital ? 'production' : pick; s.specAt = game.tick;
  }
}

// ------------------------------------------------------------------ supply & attrition
// An army draws supplies from friendly ground: its own or allied territory,
// lands it has border access to, and its own towns. Roads extend the reach,
// winter shortens it. Out of reach, supply runs down; below half, soldiers
// sicken and desert. Effectiveness falls gradually, so distant campaigns are
// costly rather than impossible.
export function supplyAt(game, tribe, x, y) {
  const w = game.world, d = game.dip, i = (y | 0) * w.w + (x | 0);
  const o = w.owner[i];
  if (o === tribe.id || (o >= 0 && (d.has('alliance', tribe.id, o) || d.has('access', tribe.id, o)))) return { target: 1, dist: 0, why: 'on friendly ground' };
  let dist = 1e9;
  for (const sid of tribe.settlements) { const s = game.settlements.get(sid); if (!s) continue; const dd = Math.hypot(s.x - x, s.y - y) - (s.spec === 'military' ? 10 : 0); if (dd < dist) dist = dd; }
  let range = 16 + (tribe.techs.includes('roads') ? 6 : 0);
  if (w.road[i]) range += 6;
  if (game.season === 3) range *= 0.6;
  const target = Math.max(0, Math.min(1, 1 - (dist - range) / 30));
  const why = target >= 1 ? 'within reach of your towns' : `${Math.round(dist)} tiles from the nearest friendly town${game.season === 3 ? ', in winter' : ''}`;
  return { target, dist: Math.round(dist), why };
}
// Daily: armies eat from the food they carried (topped up from home while on
// friendly ground), draw supply from friendly land, and lose a few soldiers to
// sickness, exposure and accidents. Losses scale gently with terrain, journey
// length, winter and poor supply; nothing makes a route impossible.
export function updateSupply(game) {
  for (const ar of game.armies) {
    const t = game.tribes[ar.tribe]; let sx = 0, sy = 0, n = 0;
    for (const a of game.agents.values()) if (a.army === ar.id) { sx += a.x; sy += a.y; n++; }
    if (!n) continue;
    const x = sx / n, y = sy / n, s = supplyAt(game, t, x, y);
    const biome = BIOMES[game.world.biome[(y | 0) * game.world.w + (x | 0)]];
    const mountain = biome.key === 'mountain' || biome.key === 'hills' || biome.key === 'peak' ? 1 : 0, harsh = HARSH.has(biome.key) ? 1 : 0;
    const winter = game.season === 3;
    // food
    ar.food = ar.food ?? 0;
    const need = n * FOOD_PER_SOLDIER * (1 + harsh * 0.6 + mountain * 0.3) * (winter ? 1.25 : 1);
    if (s.target >= 1) { const want = Math.max(0, need * 3 - ar.food); if (want > 0) ar.food += eatFood(t, Math.min(want, foodTotal(t) * 0.2)) || 0; }
    const ate = Math.min(ar.food, need); ar.food -= ate; ar.foodUsed = (ar.foodUsed || 0) + ate;
    const fed = need > 0 ? ate / need : 1;
    let target = s.target, why = s.why;
    if (fed < 1) { target = Math.min(target, 0.15 + fed * 0.5); why = fed < 0.3 ? 'out of food' : 'on short rations'; }
    ar.supply = ar.supply ?? 1;
    ar.supply += (target - ar.supply) * (target > ar.supply ? 0.5 : 0.3);
    ar.supplyWhy = why; ar.alive = n; ar.daysOut = (game.tick - ar.start) / DAY_TICKS;
    // natural attrition
    const p = naturalRisk({ mountain, harsh, daysOut: ar.daysOut, supply: ar.supply, winter });
    let died = 0;
    for (const a of game.agents.values()) {
      if (a.army !== ar.id) continue;
      if (game.rng.chance(p)) { died++; game.removeAgent(a, 'attrition'); continue; }
      if (ar.supply < 0.5) a.hp = Math.max(1, a.hp - (0.5 - ar.supply) * 0.15 * maxHp(t));
    }
    if (died) { ar.losses = (ar.losses || 0) + died; ar.attrition = (ar.attrition || 0) + died; }
    if (t.isPlayer && (ar.supply < 0.5 || died >= 2) && !ar.warnedSupply) { ar.warnedSupply = true; game.log(t, 'war', `Your army is suffering: ${why}${mountain ? ', in the mountains' : harsh ? ', in harsh country' : ''}. ${died ? died + ' soldiers were lost to sickness and exposure today.' : 'Soldiers are falling sick.'}`, 2, { alert: true, cat: 'war' }); }
    else if (ar.supply > 0.7) ar.warnedSupply = false;
  }
}
// Effectiveness of a soldier in an army: 60% at no supply, 100% at full.
export const supplyFactor = ar => 0.6 + 0.4 * (ar?.supply ?? 1);

// ------------------------------------------------------------------ eras
export const ERAS = ['Tribal Age', 'Age of Settlement', 'Bronze Age', 'Iron Age', 'Classical Age', 'Age of Enlightenment', 'Industrial Dawn'];
export function eraOf(tribe, TECH) { let tier = 0; for (const k of tribe.techs) tier = Math.max(tier, TECH[k]?.tier || 0); return Math.min(ERAS.length - 1, tier); }
export function checkEra(game, tribe, TECH) {
  const e = eraOf(tribe, TECH);
  if ((tribe.era ?? 0) < e) { tribe.era = e; game.log(tribe, 'stage', `The ${tribe.name} enter the ${ERAS[e]}.`, tribe.isPlayer ? 2 : 1); }
}

// ------------------------------------------------------------------ routes & campaigns
// Shared by armies, envoys, caravans and supply contracts: what lies along the
// straight road between two points.
const HARSH = new Set(['desert', 'snow', 'tundra', 'swamp']);
export function routeProfile(g, ax, ay, bx, by) {
  const w = g.world, dist = Math.hypot(bx - ax, by - ay), n = Math.max(4, Math.ceil(dist / 2));
  let cost = 0, mountain = 0, harsh = 0, road = 0, water = 0; const owners = new Map();
  for (let i = 1; i <= n; i++) {
    const x = Math.round(ax + (bx - ax) * i / n), y = Math.round(ay + (by - ay) * i / n), k = y * w.w + x;
    const b = BIOMES[w.biome[k]];
    if (w.road[k]) { road++; cost += 0.45; }
    else if (b.water) { water++; cost += 2.5; }           // a detour around water
    else { cost += b.walk || 3.5; if (b.key === 'mountain' || b.key === 'peak' || b.key === 'hills') mountain++; if (HARSH.has(b.key)) harsh++; }
    const o = w.owner[k]; if (o >= 0) owners.set(o, (owners.get(o) || 0) + 1);
  }
  return { dist, avgCost: cost / n, mountain: mountain / n, harsh: harsh / n, road: road / n, water: water / n, owners, samples: n };
}
export const TILES_PER_DAY = 1.7 * 36;           // soldier speed (tiles per second) × seconds per day, on open ground
export const FOOD_PER_SOLDIER = 0.6;             // food per soldier per day on campaign
// Daily chance a soldier dies of sickness, exposure or accident (not battle).
export function naturalRisk({ mountain = 0, harsh = 0, daysOut = 0, supply = 1, winter = false }) {
  return 0.0015 + mountain * 0.006 + harsh * 0.003 + Math.max(0, daysOut - 6) * 0.0006 + (winter ? 0.0015 : 0) + Math.max(0, 0.6 - supply) * 0.02;
}

// Estimate of a campaign as `tribe` understands it (uses its own intelligence).
// Ranges reflect uncertainty; nothing here is a guarantee.
export function estimateCampaign(g, tribe, targetSid, frac = 0.75, intelFn = null) {
  const target = g.settlements.get(targetSid); if (!target) return null;
  const idle = []; for (const a of g.agents.values()) if (a.tribe === tribe.id && a.job === 'soldier' && !a.army) idle.push(a);
  const n = Math.max(0, Math.floor(idle.length * frac));
  let home = null, hd = 1e9; for (const sid of tribe.settlements) { const s = g.settlements.get(sid); if (!s) continue; const d = Math.hypot(s.x - target.x, s.y - target.y); if (d < hd) { hd = d; home = s; } }
  if (!home) return null;
  const P = routeProfile(g, home.x, home.y, target.x, target.y);
  const winter = g.season === 3;
  const days = Math.max(0.5, P.dist * P.avgCost / TILES_PER_DAY);
  const siege = 2, total = days * 2 + siege;
  const foodRate = FOOD_PER_SOLDIER * (1 + P.harsh * 0.6 + P.mountain * 0.3) * (winter ? 1.25 : 1);
  const food = Math.ceil(n * foodRate * (days + siege + days * 0.5));
  const up = Math.max(0.2, 1 + (tribe.mods?.upkeep || 0));
  const upkeep = { wood: +(n * 0.15 * up * total).toFixed(1), coins: tribe.techs.includes('currency') ? +(n * 0.12 * up * total).toFixed(1) : 0 };
  const d = g.dip;
  let friendly = 0; for (const [o, c] of P.owners) if (o === tribe.id || d.has('alliance', tribe.id, o) || d.has('access', tribe.id, o)) friendly += c;
  const friendlyFrac = friendly / P.samples;
  const sup = supplyAt(g, tribe, target.x, target.y);
  const crossing = [...P.owners.keys()].filter(o => o !== tribe.id && o !== target.tribe && !d.has('access', tribe.id, o) && !d.has('alliance', tribe.id, o));
  const hostileCross = crossing.filter(o => d.atWar(tribe.id, o)).length;
  const pRisk = naturalRisk({ mountain: P.mountain, harsh: P.harsh, daysOut: total, supply: sup.target, winter });
  const natural = n * (1 - Math.pow(1 - pRisk, total));
  // enemy strength as known; unknown strength widens every estimate
  let known = 3, theirStr = g.tribes[target.tribe].strength;
  if (intelFn && g.hardIntel) { const r = intelFn(g, tribe.id, target.tribe, 'military'); known = r.lv; theirStr = r.val ?? tribe.strength; }
  const per = tribe.strength / Math.max(1, tribe.jobCounts?.soldier || 1);
  const ours = n * per * (0.6 + 0.4 * Math.max(0.3, sup.target));
  const defence = theirStr / Math.max(1, g.tribes[target.tribe].settlements.length) * (target.capital ? 1.4 : 0.8);
  const odds = ours / Math.max(1, defence);
  const spread = [1.6, 1.0, 0.6, 0.35][known] ?? 1;
  const battle = n * Math.min(0.9, 0.35 / Math.max(0.2, odds));
  const ambush = Math.min(0.7, 0.05 + hostileCross * 0.15 + (P.dist > 60 ? 0.05 : 0) + Math.min(0.25, defence / Math.max(1, ours) * 0.1) + (known < 2 ? 0.08 : 0));
  const lossLo = Math.round(natural * 0.6 + battle * (1 - spread * 0.5)), lossHi = Math.round(natural * 1.6 + battle * (1 + spread));
  const foodHave = Math.round(Object.entries(tribe.stock).reduce((a, [k, v]) => a + (RES_FOOD.has(k) ? v : 0), 0));
  const verdict = n === 0 ? 'No idle soldiers' : food > foodHave * 0.7 ? 'Unaffordable: not enough food' : odds < 0.8 || lossHi > n * 0.7 ? 'Reckless' : odds < 1.3 || lossHi > n * 0.45 ? 'Risky' : 'Favourable';
  return {
    n, home: home.name, target: target.name, dist: Math.round(P.dist), days: +days.toFixed(1), totalDays: +total.toFixed(1),
    terrain: { mountain: P.mountain, harsh: P.harsh, road: P.road, water: P.water, label: P.mountain > 0.3 ? 'Mountainous' : P.harsh > 0.3 ? 'Harsh' : P.avgCost > 1.6 ? 'Rough' : P.road > 0.4 ? 'Good roads' : 'Open ground' },
    food, foodRate: +foodRate.toFixed(2), foodHave, upkeep, friendlyFrac, supply: sup, crossing, hostileCross,
    natural: [Math.round(natural * 0.6), Math.round(natural * 1.6)], losses: [Math.max(0, lossLo), Math.min(n, lossHi)], ambush, odds, known, verdict,
  };
}

// ------------------------------------------------------------------ resource outposts
// Work camps beyond the borders: each day they eat (food is carted out from
// home), they may be raided by enemies at war nearby or by bandits when no
// soldier is close, and peoples whose land they press against resent them.
export function dailyOutposts(game) {
  const d = game.dip;
  for (const b of [...game.buildings.values()]) {
    if (!b.built || !BUILDINGS[b.type]?.outpost) continue;
    const t = game.tribes[b.tribe], cx = b.x + 1, cy = b.y + 1;
    let workers = 0; for (const a of game.agents.values()) if (a.workId === b.id) workers++;
    if (workers) eatFood(t, workers * 0.4);
    // raids
    let hostile = false, guard = false;
    for (const s of game.settlements.values()) if (s.tribe !== t.id && d.atWar(t.id, s.tribe) && Math.hypot(s.x - cx, s.y - cy) < 30) hostile = true;
    for (const a of game.agents.values()) { if (a.job !== 'soldier' || Math.abs(a.x - cx) + Math.abs(a.y - cy) > 14) continue; if (a.tribe === t.id) guard = true; else if (d.atWar(t.id, a.tribe)) hostile = true; }
    const p = hostile ? 0.12 : guard ? 0 : 0.006;
    if (game.rng.chance(p)) {
      const loss = Math.round(BUILDINGS[b.type].hp * 0.5);
      b.hp = (b.hp ?? BUILDINGS[b.type].hp) - loss;
      const r = ['stone', 'iron', 'wood'].find(k => (t.stock[k] || 0) > 10); if (r) t.stock[r] = Math.max(0, t.stock[r] - 10);
      game.log(t, 'war', `${hostile ? 'Enemy raiders' : 'Bandits'} struck your outpost${b.hp <= 0 ? ' and burned it down' : ''}.${guard ? '' : ' A few soldiers stationed nearby would deter them.'}`, 2, { alert: t.isPlayer || undefined, at: { x: cx, y: cy }, cat: 'war' });
      if (b.hp <= 0) destroyBuilding(game, b, 'raided');
    }
    // neighbours resent camps on their doorstep
    for (const o of game.tribes) {
      if (o === t || !o.alive) continue;
      let close = false;
      for (let dy = -6; dy <= 6 && !close; dy += 2) for (let dx = -6; dx <= 6; dx += 2) { const x = cx + dx, y = cy + dy; if (game.world.inb(x, y) && game.world.owner[game.world.idx(x, y)] === o.id) { close = true; break; } }
      if (close) d.addMod(o.id, t.id, 'outposts', -0.4, { label: 'Outposts pressing on our borders', decay: 0.05, min: -12 });
    }
  }
}
// AI rulers set up an outpost when a mineral they lack lies just beyond their land.
export function aiOutpost(game, t) {
  if (t.isPlayer || !isUnlocked(t, 'outpost')) return;
  const have = [...game.buildings.values()].filter(b => b.tribe === t.id && BUILDINGS[b.type].outpost).length;
  if (have >= outpostLimit(t)) return;
  const want = ['stone', 'iron', 'clay', 'copper', 'salt'].filter(r => scarcity(t, r) > 1.6);
  if (!want.length || !canAfford(t, buildingCost(t, 'outpost'))) return;
  const cap = game.settlements.get(t.capital); if (!cap) return;
  const w = game.world; let best = null, bd = 1e9;
  for (let k = 0; k < 400; k++) {
    const x = Math.round(cap.x + game.rng.range(-40, 40)), y = Math.round(cap.y + game.rng.range(-40, 40)); if (!w.inb(x, y)) continue;
    const i = w.idx(x, y), dep = w.deposit[i]; if (!dep || w.owner[i] !== -1 || !want.includes(DEPOSITS[dep]?.res)) continue;
    const dd = Math.hypot(x - cap.x, y - cap.y); if (dd < bd) { bd = dd; best = { x, y }; }
  }
  if (!best) return;
  for (const [dx, dy] of [[-1, -1], [0, -1], [-1, 0], [0, 0], [-2, -1], [1, 0], [-1, 1], [0, 1]]) {
    const x = best.x + dx, y = best.y + dy;
    if (placementCheck(game, t, 'outpost', x, y).ok) { placeBuilding(game, t, 'outpost', x, y); t.lastDecision = 'Setting up a resource outpost'; return; }
  }
}
