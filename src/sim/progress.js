// Research progression and civilisation stages.
import { TECH, TECHS, TIER_COST, TIER_STAGE, INDUSTRIAL_TECHS } from '../data/techs.js';
import { BUILDINGS } from '../data/buildings.js';
import { mod } from './economy.js';

export function techCost(tribe, key) {
  const t = TECH[key];
  const bm = mod(tribe, 'cost' + t.branch[0].toUpperCase() + t.branch.slice(1));
  return Math.round(TIER_COST[t.tier] * Math.max(0.5, 1 + bm));
}

export function techState(tribe, key) {
  if (tribe.techs.includes(key)) return 'done';
  const t = TECH[key];
  if (!t.req.every(r => tribe.techs.includes(r))) return 'locked';
  if (tribe.stage < TIER_STAGE[t.tier]) return 'stage';
  return 'available';
}

export function availableTechs(tribe) { return TECHS.filter(t => techState(tribe, t.key) === 'available'); }

export function setResearch(game, tribe, key) {
  if (techState(tribe, key) !== 'available') {
    // queue prerequisites automatically
    const path = prereqPath(tribe, key);
    if (!path.length) return false;
    tribe.research.queue = path.slice(1);
    key = path[0];
  } else tribe.research.queue = tribe.research.queue.filter(k => k !== key);
  if (tribe.research.current !== key) { tribe.research.current = key; tribe.research.progress = tribe.research.saved?.[key] || 0; }
  return true;
}

export function prereqPath(tribe, key, seen = new Set()) {
  if (tribe.techs.includes(key) || seen.has(key)) return [];
  seen.add(key);
  const out = [];
  for (const r of TECH[key].req) for (const k of prereqPath(tribe, r, seen)) if (!out.includes(k)) out.push(k);
  out.push(key);
  return out;
}

export function addResearch(game, tribe, pts) {
  tribe.stats.research = (tribe.stats.research || 0) + pts;
  tribe.researchToday = (tribe.researchToday || 0) + pts;
  const r = tribe.research;
  if (!r.current) { r.bank = Math.min(200, (r.bank || 0) + pts); return; }
  r.progress += pts + (r.bank || 0); r.bank = 0;
  const cost = techCost(tribe, r.current);
  if (r.progress >= cost) {
    const done = r.current;
    r.bank = r.progress - cost;
    completeTech(game, tribe, done);
    r.current = null; r.progress = 0;
    while (r.queue.length) { const n = r.queue.shift(); if (techState(tribe, n) === 'available') { r.current = n; break; } }
  }
}

export function completeTech(game, tribe, key) {
  if (tribe.techs.includes(key)) return;
  tribe.techs.push(key);
  tribe.modsDirty = true;
  const t = TECH[key];
  game.log(tribe, 'tech', `${tribe.name} discovered ${t.name}.`, tribe.isPlayer ? 2 : 0);
  game.bus.emit('tech', { tribe, key });
}

// ---------------------------------------------------------------- stages
const countB = (game, tribe, pred) => { let n = 0; for (const b of game.buildings.values()) if (b.tribe === tribe.id && b.built && pred(b)) n++; return n; };
const hasB = (game, tribe, type) => countB(game, tribe, b => b.type === type) > 0;
const roadCount = (game, tribe) => { const w = game.world; let n = 0; for (let i = 0; i < w.n; i++) if (w.road[i] && w.owner[i] === tribe.id) n++; return n; };

export const STAGES = [
  null,
  { name: 'Tribe', desc: 'A wandering band settling its first hearth.', unlocks: [] },
  { name: 'Settlement', desc: 'A permanent home with stores and specialised work.',
    unlocks: ['Tier II research', 'Larger storage'],
    reqs: (g, t) => [
      { label: 'Population', have: t.pop, need: 22 },
      { label: 'Technologies', have: t.techs.length, need: 3 },
      { label: 'Storehouse built', have: hasB(g, t, 'storehouse') ? 1 : 0, need: 1 },
      { label: 'Huts & houses', have: countB(g, t, b => BUILDINGS[b.type].cat === 'housing'), need: 5 },
    ] },
  { name: 'Village', desc: 'Organised leadership, workshops and lasting institutions.',
    unlocks: ['Tier III research', 'Found new settlements (2)', 'Immigration'],
    reqs: (g, t) => [
      { label: 'Population', have: t.pop, need: 45 },
      { label: 'Technologies', have: t.techs.length, need: 8 },
      { label: 'Council Hall built', have: hasB(g, t, 'council') ? 1 : 0, need: 1 },
      { label: 'Average happiness', have: Math.round(t.happiness), need: 45 },
      { label: 'Production buildings', have: countB(g, t, b => BUILDINGS[b.type].cat === 'production'), need: 7 },
    ] },
  { name: 'Town', desc: 'Markets, stone homes and paved streets.',
    unlocks: ['Tier IV research', '+1 law slot', 'Up to 3 settlements'],
    reqs: (g, t) => [
      { label: 'Population', have: t.pop, need: 90 },
      { label: 'Technologies', have: t.techs.length, need: 15 },
      { label: 'Marketplace built', have: hasB(g, t, 'market') || hasB(g, t, 'harbor') ? 1 : 0, need: 1 },
      { label: 'Houses or better', have: countB(g, t, b => ['house', 'manor', 'terrace'].includes(b.type)), need: 8 },
      { label: 'Road tiles', have: roadCount(g, t), need: 70 },
      { label: 'Laws enacted', have: Object.keys(t.laws).filter(k => t.laws[k] && t.laws[k] !== defaultLaw(k)).length, need: 2 },
    ] },
  { name: 'Established Civilisation', desc: 'A realm of several towns run by administrators and scholars.',
    unlocks: ['Tier V–VI research', 'Up to 5 settlements'],
    reqs: (g, t) => [
      { label: 'Population', have: t.pop, need: 170 },
      { label: 'Technologies', have: t.techs.length, need: 25 },
      { label: 'Settlements', have: t.settlements.length, need: 2 },
      { label: 'Administrative Hall', have: hasB(g, t, 'admin') ? 1 : 0, need: 1 },
      { label: 'Academy or Library', have: hasB(g, t, 'academy') || hasB(g, t, 'library') ? 1 : 0, need: 1 },
      { label: 'Stability', have: Math.round(t.stability), need: 50 },
    ] },
  { name: 'Advanced Civilisation', desc: 'An industrial power that shapes the age.',
    unlocks: ['Up to 7 settlements', 'Victory of development'],
    reqs: (g, t) => [
      { label: 'Population', have: t.pop, need: 300 },
      { label: 'Technologies', have: t.techs.length, need: 36 },
      { label: 'Industrial technology', have: INDUSTRIAL_TECHS.filter(k => t.techs.includes(k)).length, need: 1 },
      { label: 'Settlements', have: t.settlements.length, need: 3 },
      { label: 'Manufactory built', have: hasB(g, t, 'factory') ? 1 : 0, need: 1 },
      { label: 'Stability', have: Math.round(t.stability), need: 55 },
    ] },
];
import { LAW } from '../data/laws.js';
const defaultLaw = k => LAW[k]?.options[0].key;

export const MAX_SETTLEMENTS = [0, 1, 2, 2, 3, 5, 7];

export function stageProgress(game, tribe) {
  const next = STAGES[tribe.stage + 1];
  if (!next) return null;
  const reqs = next.reqs(game, tribe);
  return { next, reqs, ok: reqs.every(r => r.have >= r.need) };
}

export function checkStage(game, tribe) {
  const p = stageProgress(game, tribe);
  if (p && p.ok) {
    tribe.stage++;
    tribe.modsDirty = true;
    game.log(tribe, 'stage', `The ${tribe.name} have become ${article(STAGES[tribe.stage].name)} ${STAGES[tribe.stage].name}.`, tribe.isPlayer ? 3 : 1);
    game.bus.emit('stage', { tribe });
    for (const s of game.settlements.values()) if (s.tribe === tribe.id) { const c = game.buildings.get(s.centre); if (c) game.markTiles(c.x, c.y, c.size, c.size); }
  }
}
const article = n => (/^[AEIOU]/.test(n) ? 'an' : 'a');
