// Economic diplomacy: counteroffers, ongoing supply contracts, caravan
// raids, embargoes, tariffs and a ledger of every deal. Builds on the
// treaties in diplomacy.js and the route/risk model in intel.js.
import { DAY_TICKS } from '../core/constants.js';
import { RESOURCES } from '../data/resources.js';
import { addRes, takeRes, scarcity } from './economy.js';
import { route } from './intel.js';

export const TARIFFS = [0, 0.1, 0.2, 0.3];
const resList = o => Object.entries(o || {}).map(([r, v]) => `${Math.round(v)} ${RESOURCES[r]?.name || r}`).join(', ');
export const dealText = p => p.type === 'contract'
  ? `every ${p.every} days for ${p.every * p.times} days: give ${resList(p.give)}, receive ${resList(p.get)}`
  : `give ${resList(p.give)}, receive ${resList(p.get)}`;

// ------------------------------------------------------------------ ledger
export function ledger(g, e) {
  const d = g.dip; d.tradeLog = d.tradeLog || [];
  d.tradeLog.push({ day: g.day, ...e });
  if (d.tradeLog.length > 200) d.tradeLog.splice(0, d.tradeLog.length - 200);
}

// ------------------------------------------------------------------ embargo & tariffs
export const embargoed = (d, a, b) => !!(d.embargo?.[a]?.includes(b) || d.embargo?.[b]?.includes(a));
export function setEmbargo(g, a, b, on) {
  const d = g.dip; d.embargo = d.embargo || g.tribes.map(() => []);
  const list = d.embargo[a];
  if (on && !list.includes(b)) {
    list.push(b);
    for (const type of ['exclusive', 'trade']) if (d.has(type, a, b)) d.cancel(type, a, b, a, false, 'embargo');
    for (const c of d.treaties.filter(x => x.type === 'contract' && ((x.a === a && x.b === b) || (x.a === b && x.b === a)))) endContract(g, c, a, 'embargo');
    d.addMod(b, a, 'embargo', -15, { label: 'Embargoed us', decay: 0.05, min: -20 });
    g.log(g.tribes[a], 'trade', `The ${g.tribes[a].name} placed an embargo on the ${g.tribes[b].name}.`, 2, { with: b, cat: 'trade' });
    ledger(g, { a, b, kind: 'embargo', by: a });
  } else if (!on && list.includes(b)) {
    d.embargo[a] = list.filter(x => x !== b);
    const m = d.mods[b][a].find(x => x.k === 'embargo'); if (m) m.decay = 0.6;
    g.log(g.tribes[a], 'trade', `The ${g.tribes[a].name} lifted their embargo on the ${g.tribes[b].name}.`, 1, { with: b, cat: 'trade' });
    ledger(g, { a, b, kind: 'embargo-lifted', by: a });
  }
  return { ok: true };
}
export function setTariff(g, a, rate) {
  const t = g.tribes[a]; t.tariffRate = TARIFFS.includes(rate) ? rate : 0;
  return { ok: true, rate: t.tariffRate };
}

// ------------------------------------------------------------------ evaluation additions (called from Diplomacy.evaluate)
export function tradeTerms(d, from, to, p, add) {
  if (!['trade', 'exchange', 'contract', 'exclusive'].includes(p.type)) return null;
  if (embargoed(d, from, to)) return { accept: false, score: -100, reasons: [{ v: -100, label: 'There is an embargo between you' }] };
  const rate = d.game.tribes[from].tariffRate || 0;
  if (rate && (p.type === 'trade' || p.type === 'exclusive')) add(-rate * 40, 'Your tariffs');
  return null;
}
export function contractValue(d, from, to, p) {
  const tt = d.game.tribes[to]; let get = 0, give = 0;
  for (const [r, v] of Object.entries(p.give || {})) get += (RESOURCES[r]?.value || 1) * v * scarcity(tt, r);
  for (const [r, v] of Object.entries(p.get || {})) give += (RESOURCES[r]?.value || 1) * v * scarcity(tt, r);
  return { get, give };
}

// When an exchange is refused on value alone, find terms they would accept:
// first ask for less, then (if you can afford it) offer more.
export function counterOffer(d, from, to, p) {
  if (p.type !== 'exchange' && p.type !== 'contract') return null;
  const ev0 = d.evaluate(from, to, p); if (ev0.accept || ev0.score <= -100) return null;
  const tf = d.game.tribes[from];
  const scaleGet = f => ({ ...p, get: Object.fromEntries(Object.entries(p.get).map(([r, v]) => [r, Math.max(1, Math.floor(v * f))])) });
  // largest share of what you asked for that they would still accept
  let lo = 0, hi = 1, best = null;
  for (let k = 0; k < 9; k++) { const f = (lo + hi) / 2, q = scaleGet(f); if (d.evaluate(from, to, q).accept) { lo = f; best = q; } else hi = f; }
  if (best && Object.values(best.get).every(v => v >= 1)) return best;
  const scaleGive = f => ({ ...p, give: Object.fromEntries(Object.entries(p.give).map(([r, v]) => [r, Math.ceil(v * f)])) });
  for (const f of [1.25, 1.5, 2, 3]) { const q = scaleGive(f); const per = p.type === 'contract' ? 1 : 1; if (Object.entries(q.give).every(([r, v]) => (tf.stock[r] || 0) >= v * per) && d.evaluate(from, to, q).accept) return q; }
  return null;
}

// ------------------------------------------------------------------ contracts (ongoing deals)
export function signContract(g, from, to, p) {
  const d = g.dip;
  const c = { type: 'contract', a: from, b: to, give: p.give, get: p.get, every: p.every || 5, left: p.times || 6, next: g.tick + (p.every || 5) * DAY_TICKS, since: g.tick, id: (d.nextContract = (d.nextContract || 0) + 1) };
  d.treaties.push(c);
  d.addMod(to, from, 'contract', 4, { label: 'Steady supply deal', decay: 0.1, max: 10 });
  g.log(g.tribes[from], 'trade', `The ${g.tribes[from].name} and the ${g.tribes[to].name} agreed a supply contract: ${dealText(p)}.`, 2, { with: to, cat: 'trade' });
  ledger(g, { a: from, b: to, kind: 'contract', give: p.give, get: p.get, every: c.every, times: c.left });
  return c;
}
export function endContract(g, c, by, why) {
  const d = g.dip; d.treaties = d.treaties.filter(x => x !== c);
  const other = by === c.a ? c.b : c.a;
  const early = c.left > 0 && why !== 'completed';
  if (early && (why === 'cancelled' || why === 'breach')) { d.reputation[by] -= why === 'breach' ? 3 : 2; d.addMod(other, by, 'contractBroken', -12, { label: 'Broke a supply contract', decay: 0.2 }); }
  const reason = { completed: 'completed', cancelled: 'cancelled early', breach: 'broken: a delivery could not be made', embargo: 'ended by embargo', war: 'ended by war' }[why] || why;
  g.log(g.tribes[by], 'trade', `Supply contract between the ${g.tribes[c.a].name} and the ${g.tribes[c.b].name} ${reason}.`, why === 'completed' ? 1 : 2, { with: other, cat: 'trade', alert: (g.tribes[other].isPlayer && early) || undefined });
  ledger(g, { a: c.a, b: c.b, kind: 'contract-end', by, why });
}
// Deliveries are made from the daily diplomacy tick.
export function dailyTrade(g) {
  const d = g.dip;
  for (const c of d.treaties.filter(x => x.type === 'contract')) {
    if (g.tick < c.next) continue;
    const A = g.tribes[c.a], B = g.tribes[c.b];
    if (!A.alive || !B.alive || d.atWar(c.a, c.b)) { endContract(g, c, c.a, 'war'); continue; }
    const lackA = Object.entries(c.give).find(([r, v]) => (A.stock[r] || 0) < v), lackB = Object.entries(c.get).find(([r, v]) => (B.stock[r] || 0) < v);
    if (lackA || lackB) { endContract(g, c, lackA ? c.a : c.b, 'breach'); continue; }
    // goods travel: a raided delivery is lost
    const r = route(g, c.a, c.b, 'envoy');
    const raided = r && g.rng.chance(r.risk * 0.4);
    for (const [res, v] of Object.entries(c.give)) { takeRes(A, res, v); if (!raided) addRes(g, B, res, v); }
    for (const [res, v] of Object.entries(c.get)) { takeRes(B, res, v); addRes(g, A, res, v); }
    if (raided) { g.log(A, 'trade', `A delivery from the ${A.name} to the ${B.name} was raided on the road.`, 1, { with: c.b, cat: 'trade' }); ledger(g, { a: c.a, b: c.b, kind: 'raid' }); }
    c.left--; c.next = g.tick + c.every * DAY_TICKS;
    if (c.left <= 0) endContract(g, c, c.a, 'completed');
  }
  // AI embargoes on bitter enemies, lifted as tempers cool
  for (const t of g.tribes) {
    if (t.isPlayer || !t.alive) continue;
    for (const o of g.tribes) {
      if (o === t || !o.alive) continue;
      const op = d.opinion(t.id, o.id), on = d.embargo?.[t.id]?.includes(o.id);
      if (!on && (d.atWar(t.id, o.id) || op < -55) && g.rng.chance(0.1)) setEmbargo(g, t.id, o.id, true);
      else if (on && !d.atWar(t.id, o.id) && op > -15 && g.rng.chance(0.1)) setEmbargo(g, t.id, o.id, false);
    }
  }
}

// ------------------------------------------------------------------ caravans
// Chance a returning caravan is raided, from the same route model envoys use;
// a strong army keeps roads safer.
export function caravanRisk(g, a, b) {
  const r = route(g, a, b, 'envoy'); if (!r) return 0;
  const t = g.tribes[a];
  const guard = Math.min(0.5, (t.jobCounts?.soldier || 0) / Math.max(1, t.adults) * 2);
  return r.risk * 0.35 * (1 - guard);
}
