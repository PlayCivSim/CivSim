// Content registry: the one place where game definitions can be extended.
//
// All built-in content lives in plain data modules (resources, buildings,
// techs, laws, tribes) and in the exported tables of a few systems (events,
// missions, settlement focuses). A content pack is an object with any of:
//
//   { id, resources: { key: def }, buildings: { key: def }, techs: [def],
//     laws: [def], governments: { key: def }, events: [def],
//     missions: { key: def }, specs: { key: def } }
//
// Packs listed in PACKS are applied once, in order, by both the simulation
// worker and the main thread (they must see identical content). Definitions
// are validated so a mistake fails loudly at start-up instead of mid-game.
// Tribes are not extensible yet: the game assumes exactly four peoples.
import { RESOURCES, RES_KEYS, FOOD_KEYS } from './resources.js';
import { BUILDINGS } from './buildings.js';
import { TECHS, TECH, BRANCHES } from './techs.js';
import { LAWS, LAW, GOVERNMENTS } from './laws.js';
import { EVENTS } from '../sim/events.js';
import { MISSIONS } from '../sim/intel.js';
import { SPECS } from '../sim/logistics.js';

export const PACKS = [
  // Add content packs here, e.g. import { pack } from './packs/example.js'; then list `pack`.
];

const need = (id, kind, key, def, fields) => { for (const f of fields) if (def[f] === undefined) throw new Error(`Content pack "${id}": ${kind} "${key}" is missing "${f}"`); };

export function applyPack(pack) {
  const id = pack.id || 'unnamed';
  for (const [k, d] of Object.entries(pack.resources || {})) {
    need(id, 'resource', k, d, ['name', 'cat', 'value']);
    if (!RESOURCES[k]) { RES_KEYS.push(k); if (d.food) FOOD_KEYS.push(k); }
    RESOURCES[k] = d;
  }
  for (const [k, d] of Object.entries(pack.buildings || {})) { need(id, 'building', k, d, ['name', 'cat', 'size', 'cost']); BUILDINGS[k] = d; }
  for (const d of pack.techs || []) {
    need(id, 'tech', d.key, d, ['key', 'name', 'branch', 'tier', 'req', 'desc']);
    if (!BRANCHES.some(b => b.key === d.branch)) throw new Error(`Content pack "${id}": tech "${d.key}" has unknown branch "${d.branch}"`);
    for (const r of d.req) if (!TECH[r] && !(pack.techs || []).some(x => x.key === r)) throw new Error(`Content pack "${id}": tech "${d.key}" requires unknown "${r}"`);
    const i = TECHS.findIndex(x => x.key === d.key); if (i >= 0) TECHS[i] = d; else TECHS.push(d);
    TECH[d.key] = d;
  }
  for (const d of pack.laws || []) { need(id, 'law', d.key, d, ['key', 'name', 'cat', 'options']); const i = LAWS.findIndex(x => x.key === d.key); if (i >= 0) LAWS[i] = d; else LAWS.push(d); LAW[d.key] = d; }
  for (const [k, d] of Object.entries(pack.governments || {})) { need(id, 'government', k, d, ['name', 'lawSlots', 'mods']); GOVERNMENTS[k] = d; }
  for (const d of pack.events || []) { need(id, 'event', d.key, d, ['key', 'title']); const i = EVENTS.findIndex(x => x.key === d.key); if (i >= 0) EVENTS[i] = d; else EVENTS.push(d); }
  for (const [k, d] of Object.entries(pack.missions || {})) { need(id, 'mission', k, d, ['name', 'speed', 'cost', 'desc']); MISSIONS[k] = d; }
  for (const [k, d] of Object.entries(pack.specs || {})) { need(id, 'settlement focus', k, d, ['name', 'desc']); SPECS[k] = d; }
}

let applied = false;
export function loadContent() { if (applied) return; applied = true; for (const p of PACKS) applyPack(p); }
loadContent();
