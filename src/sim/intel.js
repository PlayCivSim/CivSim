// Intelligence: what each people actually knows about the others, how it was
// learned and how old it is, plus the missions that gather it (envoys,
// scouts, agents), counter-intelligence and the player's fog of war.
//
// Knowledge is stored per observer → subject → category as
//   { lv, day, val, src, fake }
// lv: 0 Unknown, 1 Rumoured, 2 Reported, 3 Verified. Reports age: after a
// while each level drops a step, so old intelligence fades instead of
// silently staying exact. `fake` marks planted reports; nobody is told until
// better intelligence exposes them.
//
// With game.fog off (older saves, the tutorial, "Open" runs) every query
// returns live, verified information and missions resolve instantly.
import { aiOf, remember } from './aimind.js';
import { routeProfile } from './logistics.js';
import { DAY_TICKS } from '../core/constants.js';
import { revealFor, playerSees, updateVision, exploreOwned, exploredBy } from './vision.js';
import { addRes, takeRes, foodTotal, eatFood } from './economy.js';
import { RESOURCES } from '../data/resources.js';
import { isAdult } from './agents.js';

export const LEVELS = ['Unknown', 'Rumoured', 'Reported', 'Verified'];
export const LEVEL_DESC = [
  'No reliable information.',
  'Unverified talk from travellers and traders.',
  'Received from a source, but not independently confirmed.',
  'Confirmed by your own people.',
];
export const INTEL_CATS = { land: 'Lands', military: 'Military', economy: 'Economy', intent: 'Intentions' };
const STALE_DAYS = { 3: 12, 2: 25, 1: 60 }; // days before a report loses one level

const hash = (a, b, c) => { let h = (a * 73856093) ^ (b * 19349663) ^ (c * 83492791); h = (h ^ (h >>> 13)) * 1274126177; return ((h ^ (h >>> 16)) >>> 0) / 4294967296; };

// ------------------------------------------------------------------ knowledge
function ensure(g) {
  const d = g.dip, n = g.tribes.length;
  if (!d.intel) d.intel = Array.from({ length: n }, () => Array.from({ length: n }, () => ({})));
  if (!d.missions) { d.missions = []; d.nextMission = 1; }
  if (!d.counter) d.counter = Array(n).fill(0);
  return d;
}
export function liveVal(g, b, cat) {
  const t = g.tribes[b];
  if (cat === 'military') return Math.round(t.strength || 0);
  if (cat === 'economy') return { pop: t.pop, stage: t.stage, towns: t.settlements.length };
  if (cat === 'intent') return { decision: t.lastDecision || '', research: t.research?.current || null, risk: g.dip.warRisk?.[b]?.[g.playerId] ?? null };
  return null;
}
const decayed = (rec, day) => { let lv = rec.lv, age = day - rec.day; while (lv > 0 && age >= STALE_DAYS[lv]) { age -= STALE_DAYS[lv]; lv--; } return lv; };

// What observer `a` currently knows about `b` in `cat`.
export function intel(g, a, b, cat) {
  if (!g.hardIntel || a === b) return { lv: 3, day: g.day, val: liveVal(g, b, cat), src: 'open' };
  const rec = g.dip.intel?.[a]?.[b]?.[cat];
  if (!rec) return { lv: 0, day: null, val: null, src: null };
  return { ...rec, lv: decayed(rec, g.day), age: g.day - rec.day };
}
export function learn(g, a, b, cat, lv, src, val, fake = false) {
  if (!g.hardIntel || a === b) return;
  const d = ensure(g); const cur = d.intel[a][b][cat];
  // never overwrite fresher, better knowledge with worse
  if (cur && !fake && decayed(cur, g.day) > lv && g.day - cur.day < 5) return;
  if (cur && fake && decayed(cur, g.day) >= 3) return; // verified knowledge resists planted rumours
  const v = val === undefined ? liveVal(g, b, cat) : val;
  d.intel[a][b][cat] = { lv, day: g.day, val: lv === 1 && cat === 'military' ? Math.round(v * (0.65 + hash(a, b, g.day >> 3) * 0.7)) : v, src, fake: fake || undefined };
}

// ------------------------------------------------------------------ fog of war (see vision.js)
export const revealCircle = (g, cx, cy, r) => revealFor(g, g.playerId, cx, cy, r);
export const fogged = (g, x, y) => !!(g.fog && !playerSees(g, x, y));
export const updateExplore = g => updateVision(g);
export const exploreTerritory = g => exploreOwned(g);

// ------------------------------------------------------------------ passive knowledge
export function dailyIntel(g) {
  if (!g.hardIntel) { aiIntelligenceOpen(g); return; }
  const d = ensure(g);
  for (const a of g.tribes) for (const b of g.tribes) {
    if (a === b || !a.alive || !b.alive || !d.contact[a.id][b.id]) continue;
    const A = a.id, B = b.id;
    // rumours reach every people in contact
    for (const c of ['land', 'military', 'economy']) { const cur = intel(g, A, B, c); if (cur.lv <= 1) learn(g, A, B, c, 1, 'rumours'); }
    if (d.has('trade', A, B)) { learn(g, A, B, 'economy', 2, 'merchants'); learn(g, A, B, 'land', 2, 'merchants'); }
    if (d.has('alliance', A, B)) { learn(g, A, B, 'military', 2, 'your allies'); learn(g, A, B, 'intent', 2, 'your allies'); }
    if (d.has('access', A, B)) learn(g, A, B, 'land', 2, 'travellers on open roads');
    if (d.atWar(A, B)) learn(g, A, B, 'military', Math.max(2, intel(g, A, B, 'military').lv), 'the battlefield');
  }
  for (const m of d.missions) if (m.status === 'stationed') { const t = g.tribes[m.from]; eatFood(t, COUNTER_COST); }
  aiIntelligence(g);
}

// ------------------------------------------------------------------ missions
export const MISSIONS = {
  envoy: { name: 'Envoy', icon: 'scroll', speed: 30, cost: { food: 5 }, desc: 'Carries proposals and gifts. Brings back word of their intentions.' },
  scout: { name: 'Scout', icon: 'eye', speed: 24, cost: { food: 15 }, desc: 'Maps their lands and counts their warriors. Verifies lands and military.' },
  spy: { name: 'Agent: gather intelligence', icon: 'target', speed: 26, cost: { food: 25, tools: 4 }, tech: 'writing', desc: 'Verifies their military, economy and intentions, and exposes false reports. Risks capture.' },
  sabotage: { name: 'Agent: sabotage', icon: 'fire', speed: 26, cost: { food: 30, tools: 8 }, tech: 'writing', desc: 'Burns part of their stores. If caught, they gain a just cause for war.' },
  deceive: { name: 'Agent: spread false reports', icon: 'warning', speed: 26, cost: { food: 25, tools: 4 }, tech: 'writing', desc: 'Plants a misleading report of your strength.' },
};
export const COUNTER_COST = 1.5; // food per stationed agent per day

const capitalOf = (g, id) => g.settlements.get(g.tribes[id].capital) || [...g.settlements.values()].find(s => s.tribe === id);

// The journey: distance, travel time and hazard, with the reasons behind them.
export function route(g, from, to, kind) {
  const a = capitalOf(g, from), b = capitalOf(g, to), d = g.dip;
  if (!a || !b) return null;
  const dist = Math.hypot(a.x - b.x, a.y - b.y);
  const access = d.has('access', from, to);
  const spec = MISSIONS[kind] || MISSIONS.envoy;
  const prof = routeProfile(g, a.x, a.y, b.x, b.y);
  const days = Math.max(1, Math.ceil(dist * Math.max(0.7, prof.avgCost) / (spec.speed * (access ? 1.3 : 1))));
  let p = 0.03; const why = [];
  if (dist > 80) { p += 0.05; why.push('a long road through wild country'); }
  if (d.atWar(from, to)) { p += kind === 'envoy' ? 0.12 : 0.3; why.push(kind === 'envoy' ? 'heralds are not always respected in war' : 'you are at war with them'); }
  if (d.opinion(to, from) < -40) { p += 0.08; why.push('they are hostile to you'); }
  // third peoples at war with the sender along the road
  const hostile = new Set();
  for (let i = 1; i < 12; i++) { const x = Math.round(a.x + (b.x - a.x) * i / 12), y = Math.round(a.y + (b.y - a.y) * i / 12); const o = g.world.owner[y * g.world.w + x]; if (o >= 0 && o !== from && o !== to && d.atWar(from, o)) hostile.add(o); }
  for (const o of hostile) { p += 0.15; why.push(`the road crosses ${g.tribes[o].name} lands, and you are at war`); }
  if (kind === 'scout') { p += 0.04; why.push('scouts go where they are not invited'); }
  if (kind === 'spy' || kind === 'sabotage' || kind === 'deceive') { p += 0.02; }
  if (access) { p *= 0.5; why.push('border access keeps the roads open'); }
  if (g.weather?.kind === 'snow') { p += 0.03; why.push('winter weather'); }
  if (prof.mountain > 0.3) { p += 0.03; why.push('mountain passes'); }
  p = Math.min(0.85, p);
  const label = p < 0.08 ? 'Low' : p < 0.2 ? 'Moderate' : p < 0.4 ? 'High' : 'Severe';
  return { dist: Math.round(dist), days, risk: p, label, why };
}
// Chance an agent operation is discovered (separate from the journey).
export const catchChance = (g, to) => Math.min(0.85, 0.12 + 0.18 * (ensure(g).counter[to] || 0));

function pickTraveller(g, tribe) {
  let best = null, bs = -1;
  for (const a of g.agents.values()) {
    if (a.tribe !== tribe.id || a.army || a.mission || !isAdult(a) || a.leader) continue;
    const s = a.job === 'idle' ? 3 : a.job === 'soldier' ? 0 : a.job === 'researcher' || a.job === 'trader' ? 1 : 2;
    if (s > bs) { bs = s; best = a; }
  }
  return best;
}
const have = (t, r) => r === 'food' ? foodTotal(t) : (t.stock[r] || 0);
const spend = (t, r, v) => r === 'food' ? eatFood(t, v) : takeRes(t, r, v);
const canPay = (t, cost) => Object.entries(cost).every(([r, v]) => have(t, r) >= v);
export const missionCost = kind => MISSIONS[kind]?.cost || {};

export function canSend(g, from, to, kind) {
  const t = g.tribes[from], spec = MISSIONS[kind];
  if (!spec) return { ok: false, why: 'Unknown mission' };
  if (spec.tech && !t.techs.includes(spec.tech)) return { ok: false, why: 'Requires Writing' };
  if (!g.dip.contact[from][to] && kind !== 'scout') return { ok: false, why: 'You have not met them' };
  if (!canPay(t, spec.cost)) return { ok: false, why: 'Not enough ' + Object.keys(spec.cost).filter(r => have(t, r) < spec.cost[r]).map(r => r === 'food' ? 'food' : RESOURCES[r].name).join(', ') };
  const busy = ensure(g).missions.filter(m => m.from === from && m.status !== 'done' && m.status !== 'lost').length;
  const envoys = ensure(g).missions.filter(m => m.from === from && m.kind === 'envoy' && m.status !== 'done' && m.status !== 'lost').length;
  if (kind === 'envoy' ? envoys >= 4 + Math.floor(t.stage / 2) : busy - envoys >= 3 + Math.floor(t.stage / 2)) return { ok: false, why: 'Too many missions abroad already' };
  if (!pickTraveller(g, t)) return { ok: false, why: 'No adult can be spared' };
  return { ok: true };
}

// Sends a mission. For envoys `p` is the proposal (goods leave with them).
export function sendMission(g, from, to, kind, p = null) {
  const c = canSend(g, from, to, kind); if (!c.ok) return c;
  const d = ensure(g), t = g.tribes[from];
  const r = route(g, from, to, kind); if (!r) return { ok: false, why: 'No route' };
  for (const [res, v] of Object.entries(MISSIONS[kind].cost)) spend(t, res, v);
  const who = pickTraveller(g, t);
  who.mission = d.nextMission; who.state = 'mission'; who.hidden = true; who.task = null; who.inB = 0; who.path = null;
  const cargo = {};
  if (p?.type === 'gift') { takeRes(t, p.res, p.amt); cargo[p.res] = p.amt; }
  if (p?.type === 'exchange') for (const [res, v] of Object.entries(p.give || {})) { takeRes(t, res, v); cargo[res] = (cargo[res] || 0) + v; }
  const m = { id: d.nextMission++, kind, from, to, p, cargo, agent: who.id, depart: g.tick, eta: g.tick + r.days * DAY_TICKS, days: r.days, risk: r.risk, riskLabel: r.label, why: r.why, status: 'out', notes: [], doom: null };
  // the journey's fate is decided up front so the record is consistent; the sender learns it only when word arrives (or fails to)
  if (g.rng.chance(r.risk)) m.doom = { at: g.tick + Math.floor(g.rng.range(0.2, 0.95) * r.days * DAY_TICKS), why: dangerReason(g, from, to, r) };
  d.missions.push(m);
  if (g.tribes[from].isPlayer) g.log(t, 'diplomacy', `${t.isPlayer ? 'You' : t.name} sent ${article(kind)} to the ${g.tribes[to].name} (about ${r.days} day${r.days === 1 ? '' : 's'}, ${r.label.toLowerCase()} risk).`, 1, { with: to });
  return { ok: true, mission: m.id, days: r.days, risk: r.label };
}
const article = k => ({ envoy: 'an envoy', scout: 'a scout', spy: 'an agent', sabotage: 'a saboteur', deceive: 'an agent' })[k] || 'a mission';
function dangerReason(g, from, to, r) {
  const opts = [...r.why.filter(w => /war|hostile|crosses/.test(w)).map(w => w.includes('crosses') ? 'intercepted on hostile roads' : w.includes('hostile') ? `seized by the ${g.tribes[to].name}` : `captured by ${g.tribes[to].name} patrols`), 'lost in the wilderness', 'drowned at a river crossing', 'taken by bandits'];
  return g.rng.pick(opts);
}

export function setCounter(g, tribeId, n) {
  const d = ensure(g), t = g.tribes[tribeId];
  n = Math.max(0, Math.min(3, n | 0));
  if (n > 0 && !t.techs.includes('writing')) return { ok: false, why: 'Requires Writing' };
  const mine = d.missions.filter(m => m.status === 'stationed' && m.from === tribeId);
  while (mine.length > n) { const m = mine.pop(); endMission(g, m, 'done'); }
  while (mine.length < n) {
    const who = pickTraveller(g, t); if (!who) break;
    const m = { id: d.nextMission++, kind: 'counter', from: tribeId, to: tribeId, agent: who.id, status: 'stationed', depart: g.tick, notes: [] };
    who.mission = m.id; who.state = 'mission'; who.hidden = true; who.task = null; who.inB = 0;
    d.missions.push(m); mine.push(m);
  }
  d.counter[tribeId] = mine.length;
  return { ok: true, n: mine.length };
}

function releaseAgent(g, m) {
  const a = g.agents.get(m.agent); if (!a) return;
  a.mission = null; a.state = 'think'; a.hidden = false;
  const home = capitalOf(g, m.from); if (home) { a.x = home.x + 1; a.y = home.y + 2; a._x0 = a.x; a._y0 = a.y; }
}
function endMission(g, m, status, note) {
  m.status = status; m.ended = g.tick; if (note) m.notes.push({ day: g.day, text: note });
  if (status === 'lost') { const a = g.agents.get(m.agent); if (a) g.removeAgent(a, 'lost'); }
  else releaseAgent(g, m);
}

// Advances every mission. Runs every few ticks from the game loop.
export function updateMissions(g) {
  const d = g.dip; if (!d.missions?.length) return;
  for (const m of d.missions) {
    if (m.status === 'done' || m.status === 'lost' || m.status === 'stationed') continue;
    const from = g.tribes[m.from], to = g.tribes[m.to];
    if (!from.alive) { m.status = 'lost'; continue; }
    // fate catches up with doomed missions; the sender only learns later
    if (m.doom && !m.doomed && g.tick >= m.doom.at) { m.doomed = true; m.status = 'missing'; const a = g.agents.get(m.agent); if (a) g.removeAgent(a, 'lost'); }
    if (m.status === 'missing') {
      if (g.tick > m.eta + DAY_TICKS * 2) {
        m.status = 'lost'; m.ended = g.tick;
        const fate = g.rng.chance(0.6) ? m.doom.why : 'their fate is unknown';
        m.notes.push({ day: g.day, text: `Presumed lost: ${fate}.` });
        if (from.isPlayer) g.log(from, 'diplomacy', `Your ${MISSIONS[m.kind]?.name.toLowerCase().replace('agent: ', 'agent (') + (m.kind === 'spy' || m.kind === 'sabotage' || m.kind === 'deceive' ? ')' : '')} to the ${to.name} never returned: ${fate}.${Object.keys(m.cargo || {}).length ? ' The goods they carried are gone.' : ''}`, 1, { with: m.to, alert: true });
        if (/captured|seized/.test(m.doom.why) && to.alive) g.dip.addMod(to.id, from.id, 'trespass', m.kind === 'envoy' ? 0 : -6, { label: 'Sent spies into our lands', decay: 0.3 });
      }
      continue;
    }
    // weather and the road cause delays
    if (m.status === 'out' && (g.tick - m.depart) % DAY_TICKS === DAY_TICKS / 2 && g.rng.chance(g.weather ? 0.25 : 0.07)) {
      m.eta += DAY_TICKS;
      const why = g.weather?.kind === 'snow' ? 'snow blocks the passes' : g.weather?.kind === 'drought' ? 'wells along the road are dry' : g.rng.pick(['heavy rain washed out the road', 'a river is in flood', 'the guide fell ill', 'they waited out a storm']);
      m.notes.push({ day: g.day, text: `Delayed: ${why}.` });
    }
    if (m.status === 'out' && g.tick >= m.eta) { if (to.alive) arrive(g, m); else { m.status = 'back'; m.eta = g.tick + m.days * DAY_TICKS; m.notes.push({ day: g.day, text: 'Found only ruins.' }); } }
    else if (m.status === 'back' && g.tick >= m.eta) endMission(g, m, 'done', 'Returned home.');
  }
  // keep a short history of finished missions
  if (d.missions.length > 40) d.missions = d.missions.filter(m => !(m.status === 'done' || m.status === 'lost') || g.tick - m.ended < DAY_TICKS * 30).slice(-40);
}

function arrive(g, m) {
  const d = g.dip, from = g.tribes[m.from], to = g.tribes[m.to], P = from.isPlayer;
  const tell = (text, extra = {}) => { m.notes.push({ day: g.day, text }); if (P || to.isPlayer) g.log(from, 'diplomacy', text, P ? 2 : 1, { with: m.to, ...extra }); };
  m.status = 'back'; m.eta = g.tick + m.days * DAY_TICKS;
  if (!d.contact[m.from][m.to]) { d.contact[m.from][m.to] = d.contact[m.to][m.from] = true; }
  if (m.kind === 'envoy') {
    learn(g, m.from, m.to, 'intent', 2, 'your envoy');
    if (m.p && to.isPlayer && !from.isPlayer && m.p.type !== 'gift') {
      // a rival's proposal reaches you: it waits for your answer
      for (const [r, v] of Object.entries(m.cargo || {})) addRes(g, from, r, v);
      const pr = { from: m.from, to: m.to, p: m.p, tick: g.tick, sent: m.depart, travel: Math.max(1, Math.round((g.tick - m.depart) / DAY_TICKS)), mission: m.id };
      if (m.p.ultimatum) pr.expires = g.tick + DAY_TICKS * 1.5;
      g.pendingProposals.push(pr);
      m.eta = g.tick + DAY_TICKS * 2 + m.days * DAY_TICKS;      // the envoy waits for your reply, then goes home
      g.log(from, 'diplomacy', `An envoy of the ${from.name} arrived after ${pr.travel} day${pr.travel === 1 ? '' : 's'} on the road${m.p.ultimatum ? ' with an ultimatum' : ' with a proposal'}.`, m.p.ultimatum ? 2 : 1, { with: m.to, alert: !!m.p.ultimatum });
      g.bus.emit('proposal', { from: m.from, to: m.to, p: m.p });
    } else if (m.p) {
      for (const [r, v] of Object.entries(m.cargo || {})) addRes(g, from, r, v); // goods are handed over by propose()
      let res = d.propose(m.from, m.to, m.p, true);
      if (m.p.ultimatum && !res.accept) d.onTributeRefused(m.from, m.to, m.p);
      if (to.isPlayer && m.p.type === 'gift' && res.accept) g.bus.emit('proposal', { from: m.from, to: m.to, p: m.p });
      // between rival rulers, a refusal with a counteroffer is negotiated on the spot by the envoy
      if (!res.accept && res.counter && !from.isPlayer && !to.isPlayer && d.evaluate(m.to, m.from, { ...res.counter, give: res.counter.get, get: res.counter.give }).score > -15) {
        const r2 = d.propose(m.from, m.to, res.counter, true);
        if (r2.accept) { res = r2; m.notes.push({ day: g.day, text: 'Agreed on revised terms.' }); }
      }
      if (!from.isPlayer && !to.isPlayer) g.log(from, 'diplomacy', `A ${from.name} envoy reached the ${to.name} after ${Math.max(1, Math.round((g.tick - m.depart) / DAY_TICKS))} days: ${proposalName(m.p)} ${res.accept ? 'accepted' : 'refused'}.`, 0, { with: m.to });
      const why = (res.reasons || []).filter(x => x.label).sort((a, b) => Math.abs(b.v) - Math.abs(a.v)).slice(0, 2).map(x => x.label.toLowerCase()).join('; ');
      m.result = { accept: res.accept, why };
      // a refused deal may come back with their counteroffer
      if (!res.accept && res.counter && from.isPlayer) {
        const q = res.counter;
        g.pendingProposals.push({ from: m.to, to: m.from, tick: g.tick, p: { ...q, type: q.type, give: q.get, get: q.give, counter: true } });
        g.bus.emit('proposal', { from: m.to, to: m.from, p: g.pendingProposals[g.pendingProposals.length - 1].p });
      }
      tell(`Your envoy reached the ${to.name}: ${proposalName(m.p)} ${res.accept ? 'accepted' : 'refused'}${why ? ` (${why})` : ''}.`, { cat: m.p.type === 'exchange' || m.p.type === 'trade' || m.p.type === 'exclusive' ? 'trade' : undefined });
    }
  } else if (m.kind === 'scout') {
    // the scout lingers about a day, watching their towns (live sight in Hard)
    for (const s of g.settlements.values()) if (s.tribe === m.to) { revealFor(g, m.from, s.x, s.y, 14); (g.observers = g.observers || []).push({ t: m.from, x: s.x, y: s.y, r: 14, until: g.tick + DAY_TICKS }); }
    learn(g, m.from, m.to, 'land', 3, 'your scout'); learn(g, m.from, m.to, 'military', 3, 'your scout'); learn(g, m.from, m.to, 'economy', 2, 'your scout');
    tell(`Your scout mapped the lands of the ${to.name} and counted their warriors.`);
  } else {
    const caught = g.rng.chance(catchChance(g, m.to));
    if (caught) {
      m.status = 'lost'; m.ended = g.tick; const a = g.agents.get(m.agent); if (a) g.removeAgent(a, 'captured');
      d.addMod(m.to, m.from, 'spy', m.kind === 'sabotage' ? -35 : -15, { label: m.kind === 'sabotage' ? 'Sabotaged us' : 'Caught spying on us', decay: 0.25, min: -50 });
      d.reputation[m.from] -= m.kind === 'sabotage' ? 4 : 2;
      remember(g, m.to, m.from, 'spy', m.kind === 'sabotage' ? -10 : -5, 20);
      if (m.kind === 'sabotage') { d.casusBelli = d.casusBelli || {}; d.casusBelli[m.to * 8 + m.from] = g.tick + DAY_TICKS * 20; }
      if (m.kind === 'deceive') exposeFakes(g, m.to, m.from);
      const what = { spy: 'spying', sabotage: 'attempting sabotage', deceive: 'spreading false reports' }[m.kind];
      m.notes.push({ day: g.day, text: 'Captured.' });
      if (P) g.log(from, 'diplomacy', `Your agent was caught ${what} by the ${to.name}. They are furious.`, 2, { with: m.to, alert: true });
      if (to.isPlayer) g.log(to, 'diplomacy', `Your watchmen caught a ${from.name} agent ${what}.`, 2, { with: m.from, alert: true });
      return;
    }
    if (m.kind === 'spy') {
      for (const c of ['military', 'economy', 'intent', 'land']) learn(g, m.from, m.to, c, 3, 'your agent');
      tell(`Your agent returned with verified reports on the ${to.name}.`);
    } else if (m.kind === 'sabotage') {
      const r = ['wood', 'stone', 'tools', 'grain'].sort((x, y) => (to.stock[y] || 0) - (to.stock[x] || 0))[0];
      const lost = Math.round((to.stock[r] || 0) * 0.3); takeRes(to, r, lost);
      tell(`Your saboteur burned ${lost} ${RESOURCES[r].name} in the ${to.name} stores.`);
      if (to.isPlayer) g.log(to, 'event', `Fire in the stores: ${lost} ${RESOURCES[r].name} lost. Some suspect foul play, but the culprits escaped.`, 2, { cat: 'production', alert: true });
    } else if (m.kind === 'deceive') {
      const fakeVal = Math.round((from.strength || 1) * (g.rng.chance(0.5) ? 0.4 : 2.2));
      learn(g, m.to, m.from, 'military', 2, 'a traveller’s report', fakeVal, true);
      tell(`Your agent spread false reports of your strength among the ${to.name}.`);
    }
  }
}
// Verified intelligence exposes planted reports.
export function exposeFakes(g, observer, subject) {
  const rec = g.dip.intel?.[observer]?.[subject]?.military;
  if (rec?.fake) { rec.exposed = true; rec.lv = 1; if (g.tribes[observer].isPlayer) g.log(g.tribes[observer], 'diplomacy', `The report of ${g.tribes[subject].name} strength was a lie planted by their agents.`, 2, { with: subject }); }
}
const proposalName = p => ({ trade: 'the Trade Agreement was', nap: 'the Non-Aggression Pact was', alliance: 'the Military Alliance was', access: 'Border Access was', exclusive: 'Trade Exclusivity was', peace: 'peace was', gift: 'the gift was', exchange: 'the exchange was', contract: 'the supply contract was', tribute: 'the demand for tribute was', offerTribute: 'the offer of tribute was' })[p.type] || 'the proposal was';

// ------------------------------------------------------------------ rival intelligence services
function aiIntelligence(g) {
  const d = g.dip;
  for (const t of g.tribes) {
    if (t.isPlayer || !t.alive) continue;
    // scouting: rivals must find a people's homeland before they can plan against it
    if (g.vis !== 'open') for (const o of g.tribes) {
      if (o === t || !o.alive) continue;
      const cap = g.settlements.get(o.capital); if (!cap || exploredBy(g, t.id, cap.x, cap.y)) continue;
      const busy = d.missions.some(m => m.from === t.id && m.to === o.id && m.kind === 'scout' && m.status !== 'done' && m.status !== 'lost');
      const urgent = d.atWar(t.id, o.id) || (d.warRisk?.[t.id]?.[o.id] || -99) > 0;
      if (!busy && g.rng.chance(urgent ? 0.25 : 0.04) && canSend(g, t.id, o.id, 'scout').ok) sendMission(g, t.id, o.id, 'scout');
    }
    if (!t.techs.includes('writing')) continue;
    const ai = aiOf(t);
    // counter-intelligence when neighbours are hostile
    const threatened = g.tribes.some(o => o !== t && o.alive && (d.atWar(t.id, o.id) || d.opinion(t.id, o.id) < -25));
    const want = threatened ? 1 + (ai.caution > 0.6 ? 1 : 0) : 0;
    if ((d.counter[t.id] || 0) !== want && g.rng.chance(0.2)) setCounter(g, t.id, want);
    for (const o of g.tribes) {
      if (o === t || !o.alive || !d.contact[t.id][o.id]) continue;
      const hostile = d.atWar(t.id, o.id) || d.opinion(t.id, o.id) < -15 || (d.warRisk?.[t.id]?.[o.id] || -99) > 0;
      const p = (hostile ? 0.03 : 0.006) * (0.5 + ai.aggression * 0.5 + (1 - ai.loyalty) * 0.3);
      if (!g.rng.chance(p)) continue;
      const kind = hostile ? g.rng.weighted(['spy', 'deceive', 'sabotage'], k => ({ spy: 0.45, deceive: 0.3, sabotage: d.atWar(t.id, o.id) ? 0.4 : 0.1 })[k]) : (g.rng.chance(0.75) ? 'spy' : 'deceive');
      if (kind && canSend(g, t.id, o.id, kind).ok) sendMission(g, t.id, o.id, kind);
    }
  }
}

// ------------------------------------------------------------------ reputation
export function repTier(r) {
  if (r >= 8) return { key: 'honourable', name: 'Honourable', desc: 'Your word is trusted. Peoples sign treaties with you more readily.' };
  if (r >= -4) return { key: 'reliable', name: 'Reliable', desc: 'An ordinary reputation.' };
  if (r >= -15) return { key: 'doubted', name: 'Doubted', desc: 'Broken promises have made others wary. Pacts and alliances are harder to win.' };
  return { key: 'oathbreaker', name: 'Oathbreaker', desc: 'No one trusts you. Alliances, border access and exclusivity are refused outright.' };
}

// Outside Hard there are no reliability levels, but rival intelligence
// services still spy, sabotage and keep counter-agents.
function aiIntelligenceOpen(g) {
  ensure(g);
  for (const m of g.dip.missions || []) if (m.status === 'stationed') eatFood(g.tribes[m.from], COUNTER_COST);
  aiIntelligence(g);
}
