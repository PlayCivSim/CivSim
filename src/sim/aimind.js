import { exploredBy } from './vision.js';
// AI minds: per-run personalities, long memories of specific interactions,
// coalitions against a dominant power, and what a ruler believes about
// others (respecting Hard Mode intelligence). Kept free of imports from
// diplomacy.js so every system can use it without cycles.

// ------------------------------------------------------------------ personality
// Each run nudges a people's temperament a little, so the same tribe can be
// warlike in one world and cautious in another. Traits describe tendencies;
// decisions still weigh circumstances.
const KEYS = ['aggression', 'diplomacy', 'research', 'expansion', 'military', 'agriculture', 'trade', 'caution', 'loyalty'];
const h = (a, b) => { let x = (a * 2654435761 ^ b * 40503) >>> 0; x ^= x >>> 15; x = Math.imul(x, 2246822519) >>> 0; x ^= x >>> 13; return (x >>> 0) / 4294967296; };
export function rollPersonality(seed, t) {
  const base = t.def.ai, out = {};
  KEYS.forEach((k, i) => { out[k] = Math.max(0.05, Math.min(1, (base[k] ?? 0.5) + (h((seed >>> 0) + t.id * 97, i + 1) - 0.5) * 0.3)); });
  return out;
}
export const aiOf = t => t.ai || t.def.ai;
export function traits(t) {
  const a = aiOf(t), out = [];
  if (a.aggression > 0.65) out.push(['Aggressive', 'Quick to take up arms when the odds look good.']);
  if (a.trade > 0.7) out.push(['Trader', 'Values commerce and steady deals.']);
  if (a.expansion > 0.7) out.push(['Expansionist', 'Hungry for new land and towns.']);
  if (a.diplomacy < 0.45 && a.trade < 0.55) out.push(['Isolationist', 'Keeps to themselves and distrusts foreign entanglements.']);
  if (a.caution > 0.7) out.push(['Cautious', 'Avoids risky wars and fortifies.']);
  if (a.loyalty > 0.8) out.push(['Loyal', 'Keeps their treaties.']);
  if (!out.length) out.push(['Pragmatic', 'Weighs each decision on its merits.']);
  return out;
}

// ------------------------------------------------------------------ memory
// d.memory[a][b]: what `a` remembers of `b`. Entries fade slowly (half-life
// about 120 days), much slower than ordinary opinion modifiers.
const MEM_LABEL = {
  gift: 'Remembers your gifts', betrayal: 'Remembers your betrayal', war: 'Remembers the war you waged on them',
  peace: 'Remembers making peace', trade: 'Remembers profitable trade', spy: 'Remembers your spies',
  border: 'Remembers border disputes', aid: 'Remembers you fought beside them', tribute: 'Remembers tribute paid',
};
const HALF = 120;
export function remember(g, a, b, kind, w, cap = 40) {
  if (a === b) return;
  const d = g.dip, n = g.tribes.length;
  if (!d.memory) d.memory = Array.from({ length: n }, () => Array.from({ length: n }, () => []));
  const list = d.memory[a][b];
  let m = list.find(x => x.k === kind);
  if (!m) { m = { k: kind, w: 0, day: g.day, first: g.day }; list.push(m); }
  m.w = faded(m, g.day) + w; m.day = g.day;
  m.w = Math.max(-cap, Math.min(cap, m.w));
}
const faded = (m, day) => m.w * Math.pow(0.5, (day - m.day) / HALF);
export function memoryOpinion(g, a, b) {
  const list = g.dip.memory?.[a]?.[b]; if (!list) return 0;
  let v = 0; for (const m of list) v += faded(m, g.day);
  return Math.max(-35, Math.min(35, v));
}
export function memoryBreakdown(g, a, b) {
  const list = g.dip.memory?.[a]?.[b] || [];
  return list.map(m => ({ label: MEM_LABEL[m.k] || m.k, v: faded(m, g.day), since: m.first })).filter(x => Math.abs(x.v) >= 0.5);
}

// ------------------------------------------------------------------ beliefs
// What tribe `a` believes `b`'s strength is. Under Hard Mode intelligence
// rulers act on their reports (including planted ones); with no report they
// assume an even match and add caution.
export function perceivedStrength(g, a, b, intelFn) {
  const t = g.tribes[b];
  if (!g.hardIntel || !intelFn) return { v: t.strength, sure: true };
  const r = intelFn(g, a, b, 'military');
  if (r.lv === 0 || r.val == null) return { v: g.tribes[a].strength, sure: false };
  return { v: r.val, sure: r.lv >= 2 };
}
// Whether `a` knows where settlement `s` is.
export function knowsSettlement(g, a, s, intelFn) {
  if (g.vis === 'open' || !g.vis) return true;
  if (!exploredBy(g, a, s.x, s.y)) return false;   // never found it
  if (g.vis === 'explore' || !intelFn) return true;
  const lv = intelFn(g, a, s.tribe, 'land').lv;
  return s.capital ? lv >= 1 : lv >= 2;
}

// ------------------------------------------------------------------ coalitions
// When one people grows far stronger than the rest, the others notice and may
// band together. Runs weekly from the daily diplomacy tick.
export function powerOf(t) { return (t.strength || 0) + t.pop * 0.4 + t.techs.length * 2 + t.settlements.length * 6; }
export function coalitionTick(g) {
  if (g.day % 7) return;
  const d = g.dip, alive = g.tribes.filter(t => t.alive);
  if (alive.length < 3) { d.coalition = null; return; }
  const ranked = alive.map(t => ({ t, p: powerOf(t) })).sort((x, y) => y.p - x.p);
  const top = ranked[0], rest = ranked.slice(1), avg = rest.reduce((s, x) => s + x.p, 0) / rest.length;
  const dominant = top.p > avg * 1.45 && top.p > rest[0].p * 1.25;
  if (!dominant) { if (d.coalition) { g.log(null, 'diplomacy', `The coalition against the ${g.tribes[d.coalition.against].name} has dissolved.`, 2, { with: d.coalition.against }); d.coalition = null; } return; }
  const D = top.t.id;
  for (const { t } of rest) if (!t.isPlayer) d.addMod(t.id, D, 'dominance', -1.2, { label: 'Fears your growing power', decay: 0.05, min: -20 });
  // members: non-dominant AI peoples who fear the leader and do not hate each other
  const members = rest.filter(({ t }) => !t.isPlayer && d.opinion(t.id, D) < 15 && d.contact[t.id][D]).map(x => x.t.id);
  if (members.length < 2) return;
  const was = d.coalition?.against === D ? d.coalition.members : [];
  for (let i = 0; i < members.length; i++) for (let j = i + 1; j < members.length; j++) {
    const a = members[i], b = members[j];
    if (d.atWar(a, b) || d.opinion(a, b) < -15 || d.opinion(b, a) < -15) continue;
    if (g.tick - d.lastProposal[a][b] < 360 * 3) continue;
    if (!d.has('nap', a, b)) d.dispatch(a, b, { type: 'nap', coalition: true });
    else if (!d.has('alliance', a, b) && d.opinion(a, b) > 5 && g.rng.chance(0.35)) d.dispatch(a, b, { type: 'alliance', coalition: true });
  }
  if (!was.length || members.some(m => !was.includes(m))) {
    g.log(null, 'diplomacy', `Fearing the might of the ${g.tribes[D].name}, the ${members.map(m => g.tribes[m].name).join(' and the ')} draw together in a coalition.`, 3, { with: [D, ...members], alert: g.tribes[D].isPlayer || undefined });
  }
  d.coalition = { against: D, members, since: d.coalition?.against === D ? d.coalition.since : g.day };
}
export const inCoalitionAgainst = (g, a, b) => !!(g.dip.coalition && g.dip.coalition.against === b && g.dip.coalition.members.includes(a));
