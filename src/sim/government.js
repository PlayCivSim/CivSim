// Modifier aggregation, laws and governments. All gameplay multipliers are
// derived from one place so that tribe traits, techs, laws, buildings, events
// and leaders interact predictably.
import { TECH } from '../data/techs.js';
import { LAWS, LAW, GOVERNMENTS } from '../data/laws.js';
import { BUILDINGS } from '../data/buildings.js';

const STAGE_MODS = [null, {}, { build: 0.05 }, { stability: 2, lawSlots: 0 }, { research: 0.05, trade: 0.05 }, { stability: 3, research: 0.05 }, { research: 0.1, craft: 0.1 }];

export const LEADER_TRAITS = [
  { key: 'wise', name: 'Wise', desc: '+10% research', mods: { research: 0.1 } },
  { key: 'bold', name: 'Bold', desc: '+10% soldier strength', mods: { military: 0.1 } },
  { key: 'just', name: 'Just', desc: '+5 stability', mods: { stability: 5 } },
  { key: 'charming', name: 'Charming', desc: '+20% relation gain', mods: { relation: 0.2 } },
  { key: 'industrious', name: 'Industrious', desc: '+6% productivity', mods: { productivity: 0.06 } },
  { key: 'greedy', name: 'Greedy', desc: '+20% tax, -2 happiness', mods: { tax: 0.2, happiness: -2 } },
  { key: 'pious', name: 'Pious', desc: '+3 happiness', mods: { happiness: 3 } },
  { key: 'builder', name: 'Master Builder', desc: '+15% build speed', mods: { build: 0.15 } },
  { key: 'farmer', name: 'Harvest-Blessed', desc: '+8% farms', mods: { farm: 0.08 } },
];

export function addMods(target, src, scale = 1) {
  if (!src) return;
  for (const [k, v] of Object.entries(src)) target[k] = (target[k] || 0) + v * scale;
}

export function policyInteractions(tribe) {
  const L = tribe.laws, out = [];
  if (L.labour === 'long' && L.rationing === 'strict') out.push({ name: 'Overworked & Underfed', desc: 'Long hours on strict rations: -4 happiness, worse health.', mods: { happiness: -4, health: -0.02 } });
  if (L.rationing === 'generous' && L.housing === 'family') out.push({ name: 'Fertile Times', desc: 'Generous rations with family homes: +10% births.', mods: { birth: 0.1 } });
  if (L.recruitment === 'conscription' && L.defence === 'high') out.push({ name: 'Militarised Society', desc: 'Conscription on a war footing: -4% productivity.', mods: { productivity: -0.04 } });
  if (L.taxation === 'high' && tribe.gov === 'republic') out.push({ name: 'Tax Revolt Brewing', desc: 'Citizens of a republic resent heavy taxes: -3 stability.', mods: { stability: -3 } });
  if (L.works === 'funded' && L.labour === 'rest') out.push({ name: 'Civic Festivals', desc: 'Public works and rest days: +2 happiness.', mods: { happiness: 2 } });
  if (L.education === 'public' && tribe.gov === 'technocracy') out.push({ name: 'Learned State', desc: 'Public schooling under a technocracy: +10% research.', mods: { research: 0.1 } });
  for (const q of [...(tribe.def?.quirks?.lawLikes || []), ...(tribe.def?.quirks?.lawDislikes || [])]) if (L[q.law] === q.opt) out.push({ name: q.name, desc: q.desc, mods: q.mods });
  return out;
}

export function computeMods(game, tribe) {
  const m = {};
  addMods(m, tribe.def.mods);
  for (const t of tribe.techs) addMods(m, TECH[t]?.mods);
  const gov = GOVERNMENTS[tribe.gov];
  addMods(m, gov.mods);
  if (gov.favours === tribe.key) m.stability = (m.stability || 0) + 5;
  addMods(m, STAGE_MODS[tribe.stage]);
  const lawUpkeep = [];
  const lawStab = 1 + (m.lawStability || 0);
  for (const law of LAWS) {
    const opt = law.options.find(o => o.key === tribe.laws[law.key]);
    if (!opt) continue;
    const om = { ...opt.mods };
    if (om.stability > 0) om.stability *= lawStab;
    addMods(m, om);
    if (opt.upkeep) lawUpkeep.push(opt.upkeep);
  }
  // enacted laws provide a base stability, scaled for law-minded tribes
  m.stability = (m.stability || 0) + enactedCount(tribe) * 1.2 * lawStab;
  for (const pi of policyInteractions(tribe)) addMods(m, pi.mods);
  if (tribe.leader) addMods(m, LEADER_TRAITS.find(t => t.key === tribe.leader.trait)?.mods);
  // global building effects (non-per-capita)
  for (const bt of tribe.uniqueBuilt || []) {
    const e = BUILDINGS[bt]?.effect; if (!e) continue;
    for (const [k, v] of Object.entries(e)) if (!['happiness', 'health'].includes(k) || BUILDINGS[bt].unique) m[k] = (m[k] || 0) + v;
  }
  for (const em of tribe.eventMods) addMods(m, em.mods);
  // Difficulty no longer grants AI production or research bonuses; it changes how well they decide (see assessWar).
  tribe.mods = m;
  tribe._lawUpkeep = lawUpkeep;
  tribe.modsDirty = false;
}

export function enactedCount(tribe) {
  let n = 0;
  for (const law of LAWS) if (tribe.laws[law.key] && tribe.laws[law.key] !== law.options[0].key) n++;
  return n;
}

export function lawSlots(tribe) {
  return GOVERNMENTS[tribe.gov].lawSlots + Math.round(tribe.mods.lawSlots || 0) + (tribe.stage >= 4 ? 1 : 0);
}

export function lawAvailable(tribe, law, opt) {
  const tech = opt?.tech || law.tech;
  return !tech || tribe.techs.includes(tech);
}

export function canEnact(game, tribe, lawKey, optKey) {
  const law = LAW[lawKey]; const opt = law.options.find(o => o.key === optKey);
  if (!opt) return { ok: false, why: 'Unknown policy' };
  if (!lawAvailable(tribe, law, opt)) return { ok: false, why: 'Requires ' + (opt.tech || law.tech) };
  if (tribe.laws[lawKey] === optKey) return { ok: false, why: 'Already in force' };
  if (tribe.lawCooldown > game.tick) return { ok: false, why: 'The council needs time before another change' };
  const isDefault = optKey === law.options[0].key;
  const wasDefault = (tribe.laws[lawKey] || law.options[0].key) === law.options[0].key;
  if (!isDefault && wasDefault && enactedCount(tribe) >= lawSlots(tribe)) return { ok: false, why: 'No free law slots' };
  return { ok: true };
}

export function enactLaw(game, tribe, lawKey, optKey) {
  const c = canEnact(game, tribe, lawKey, optKey);
  if (!c.ok) return c;
  const law = LAW[lawKey];
  tribe.laws[lawKey] = optKey;
  tribe.lawCooldown = game.tick + 120; // 12 seconds
  tribe.stabilityShock = (tribe.stabilityShock || 0) + 3;
  tribe.modsDirty = true;
  const opt = law.options.find(o => o.key === optKey);
  game.log(tribe, 'law', `${tribe.name} enacted ${opt.name} (${law.name}).`, tribe.isPlayer ? 2 : 1);
  return { ok: true };
}

export function canAdoptGov(game, tribe, govKey) {
  const g = GOVERNMENTS[govKey];
  if (tribe.gov === govKey) return { ok: false, why: 'Current government' };
  if (g.tech && !tribe.techs.includes(g.tech)) return { ok: false, why: 'Requires ' + TECH[g.tech].name };
  if (g.building && !(tribe.uniqueBuilt || []).includes(g.building)) return { ok: false, why: 'Requires ' + BUILDINGS[g.building].name };
  if (tribe.govCooldown > game.tick) return { ok: false, why: 'Too soon after the last reform' };
  return { ok: true };
}

export function adoptGov(game, tribe, govKey) {
  const c = canAdoptGov(game, tribe, govKey);
  if (!c.ok) return c;
  tribe.gov = govKey;
  tribe.govCooldown = game.tick + 360 * 3;
  tribe.stabilityShock = (tribe.stabilityShock || 0) + 12;
  tribe.modsDirty = true;
  // trim laws that no longer fit
  while (enactedCount(tribe) > lawSlots(tribe)) {
    const l = LAWS.slice().reverse().find(l => tribe.laws[l.key] && tribe.laws[l.key] !== l.options[0].key);
    if (!l) break; tribe.laws[l.key] = l.options[0].key;
  }
  game.log(tribe, 'government', `${tribe.name} reformed into a ${GOVERNMENTS[govKey].name}.`, 3);
  game.bus.emit('government', { tribe });
  return { ok: true };
}
