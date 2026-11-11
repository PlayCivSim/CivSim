// Logistics and settlement identity: army supply lines and attrition,
// settlement specialisations, and technological eras.
import { DAY_TICKS } from '../core/constants.js';
import { maxHp } from './military.js';
import { aiOf } from './aimind.js';

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
export function updateSupply(game) {
  for (const ar of game.armies) {
    const t = game.tribes[ar.tribe]; let sx = 0, sy = 0, n = 0;
    for (const a of game.agents.values()) if (a.army === ar.id) { sx += a.x; sy += a.y; n++; }
    if (!n) continue;
    const s = supplyAt(game, t, sx / n, sy / n);
    ar.supply = ar.supply ?? 1;
    ar.supply += (s.target - ar.supply) * (s.target > ar.supply ? 0.5 : 0.25);
    ar.supplyWhy = s.why; ar.alive = n;
    if (ar.supply < 0.5) {
      const loss = (0.5 - ar.supply) * 0.3;
      for (const a of game.agents.values()) {
        if (a.army !== ar.id) continue;
        a.hp -= loss * maxHp(t);
        if (a.hp <= 0) { ar.losses = (ar.losses || 0) + 1; ar.attrition = (ar.attrition || 0) + 1; game.removeAgent(a, 'attrition'); }
      }
      if (t.isPlayer && !ar.warnedSupply) { ar.warnedSupply = true; game.log(t, 'war', `Your army is running short of supplies (${s.why}). Soldiers are falling sick and deserting.`, 2, { alert: true, cat: 'war' }); }
    } else if (ar.supply > 0.7) ar.warnedSupply = false;
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
