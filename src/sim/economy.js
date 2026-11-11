// Stockpiles, costs, storage, consumption and the daily economic ledger.
import { RESOURCES, RES_KEYS, FOOD_KEYS } from '../data/resources.js';
import { BUILDINGS } from '../data/buildings.js';

export const mod = (tribe, k) => tribe.mods[k] || 0;

export function storageCap(game, tribe) {
  let stores = 0;
  for (const sid of tribe.settlements) {
    const s = game.settlements.get(sid); if (!s) continue;
    for (const bid of s.buildings) { const b = game.buildings.get(bid); if (b && b.built && b.type === 'storehouse') stores++; }
  }
  return 260 + tribe.settlements.length * 140 + stores * 220 + (tribe.stage - 1) * 80;
}

export function addRes(game, tribe, res, amt) {
  if (!amt) return 0;
  const cap = res === 'coins' ? 1e9 : (tribe._cap || 400);
  const before = tribe.stock[res] || 0;
  const after = Math.min(cap, before + amt);
  tribe.stock[res] = after;
  const gained = after - before;
  tribe.ledger.prod[res] = (tribe.ledger.prod[res] || 0) + gained;
  if (gained < amt - 1e-6) tribe.ledger.wasted = (tribe.ledger.wasted || 0) + (amt - gained);
  return gained;
}

export function takeRes(tribe, res, amt) {
  const have = tribe.stock[res] || 0;
  const t = Math.min(have, amt);
  tribe.stock[res] = have - t;
  tribe.ledger.cons[res] = (tribe.ledger.cons[res] || 0) + t;
  return t;
}

export function buildingCost(tribe, type) {
  const def = BUILDINGS[type];
  const out = {};
  for (const [r, v] of Object.entries(def.cost || {})) {
    let m = 1;
    if (r === 'stone') m += mod(tribe, 'costStone');
    if (def.cat === 'military') m += mod(tribe, 'costMilitaryBuild');
    out[r] = Math.ceil(v * m);
  }
  return out;
}

export function canAfford(tribe, cost) {
  for (const [r, v] of Object.entries(cost)) if ((tribe.stock[r] || 0) < v) return false;
  return true;
}
export function missing(tribe, cost) {
  const m = {};
  for (const [r, v] of Object.entries(cost)) { const d = v - (tribe.stock[r] || 0); if (d > 0) m[r] = Math.ceil(d); }
  return m;
}
export function pay(tribe, cost) {
  for (const [r, v] of Object.entries(cost)) takeRes(tribe, r, v);
}

export function foodTotal(tribe) {
  let t = 0; for (const k of FOOD_KEYS) t += tribe.stock[k] || 0; return t;
}

// Eats proportionally from every food type; returns amount actually eaten.
export function eatFood(tribe, amount) {
  const total = foodTotal(tribe);
  if (total <= 0) return 0;
  const f = Math.min(1, amount / total);
  let eaten = 0;
  for (const k of FOOD_KEYS) { const v = tribe.stock[k] || 0; if (v > 0) eaten += takeRes(tribe, k, v * f); }
  return eaten;
}

export function foodVariety(tribe) {
  let n = 0; for (const k of FOOD_KEYS) if ((tribe.stock[k] || 0) > 3) n++; return n;
}

export function dailyFoodNeed(game, tribe) {
  const pop = tribe.pop || 0;
  const soldiers = tribe.jobCounts?.soldier || 0;
  const children = tribe.children || 0;
  return ((pop - children - soldiers) * 1 + children * 0.5 + soldiers * 1.5) * Math.max(0.5, 1 + mod(tribe, 'food'));
}

// Daily ledger: consumption, spoilage, wear, upkeep and tax. Returns food
// satisfaction (0..1) used by the population system.
export function dailyEconomy(game, tribe) {
  tribe._cap = storageCap(game, tribe);
  const need = dailyFoodNeed(game, tribe);
  const eaten = eatFood(tribe, need);
  const satisfaction = need > 0 ? eaten / need : 1;

  // spoilage, reduced by storehouses and preservation
  const spoil = Math.max(0.002, 0.02 * (1 + mod(tribe, 'spoilage')) - tribe.storehouses * 0.002);
  for (const k of FOOD_KEYS) { const v = tribe.stock[k] || 0; if (v > 20) { const s = v * spoil; tribe.stock[k] = v - s; tribe.ledger.spoiled = (tribe.ledger.spoiled || 0) + s; } }

  // tools wear with use
  const toolUsers = (tribe.jobCounts?.woodcutter || 0) + (tribe.jobCounts?.miner || 0) + (tribe.jobCounts?.farmer || 0) + (tribe.jobCounts?.builder || 0) + (tribe.jobCounts?.craftsman || 0);
  if (tribe.stock.tools > 0) takeRes(tribe, 'tools', toolUsers * 0.025);

  // military upkeep: soldiers consume wood/coins/weapons wear
  const soldiers = tribe.jobCounts?.soldier || 0;
  if (soldiers) {
    const up = Math.max(0.2, 1 + mod(tribe, 'upkeep'));
    takeRes(tribe, 'wood', soldiers * 0.15 * up);
    if (tribe.techs.includes('currency')) takeRes(tribe, 'coins', soldiers * 0.12 * up);
    if (tribe.stock.weapons > 0) takeRes(tribe, 'weapons', soldiers * 0.01);
  }
  // law upkeep
  for (const u of tribe._lawUpkeep || []) for (const [r, v] of Object.entries(u)) takeRes(tribe, r, v * tribe.pop);

  // taxation
  const taxRate = mod(tribe, 'taxRate');
  if (taxRate > 0) {
    const tax = taxRate * tribe.pop * (1 + mod(tribe, 'tax')) * (0.6 + tribe.stability / 250);
    addRes(game, tribe, 'coins', tax);
    tribe.ledger.tax = tax;
  }
  // roll the ledger into per-day rates (smoothed so the UI is readable)
  const rates = {};
  for (const k of RES_KEYS) {
    const net = (tribe.ledger.prod[k] || 0) - (tribe.ledger.cons[k] || 0);
    const prev = tribe.rates[k] || 0;
    rates[k] = prev * 0.4 + net * 0.6;
    if (Math.abs(rates[k]) < 0.05) rates[k] = 0;
  }
  tribe.rates = rates;
  tribe.lastLedger = { prod: tribe.ledger.prod, cons: tribe.ledger.cons, spoiled: tribe.ledger.spoiled || 0, wasted: tribe.ledger.wasted || 0, tax: tribe.ledger.tax || 0, foodNeed: need, eaten };
  tribe.ledger = { prod: {}, cons: {} };
  return satisfaction;
}

export function stockValue(tribe) {
  let v = 0; for (const [k, a] of Object.entries(tribe.stock)) v += (RESOURCES[k]?.value || 1) * a; return v;
}

// How much a tribe wants a resource (scarcity), used for trade and AI.
export function scarcity(tribe, res) {
  const have = tribe.stock[res] || 0;
  const rate = tribe.rates[res] || 0;
  const target = RESOURCES[res].food ? Math.max(30, (tribe.pop || 10) * 3) : 60;
  let s = 1 + Math.max(0, (target - have) / target) * 1.5;
  if (rate < 0) s += Math.min(1, -rate / 10);
  return s;
}
