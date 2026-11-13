// Contextual world events. Weights depend on season, terrain, preparation and
// state, so a prepared player can anticipate and soften them.
import { aiOf } from './aimind.js';
import { DAY_TICKS, DAYS_PER_YEAR } from '../core/constants.js';
import { BIOMES, B, isWater } from '../world/biomes.js';
import { DEPOSITS, DEP, RESOURCES } from '../data/resources.js';
import { BUILDINGS } from '../data/buildings.js';
import { mod, addRes, takeRes, foodTotal } from './economy.js';
import { makeAgent, isAdult } from './agents.js';
import { centreOf, destroyBuilding } from './buildings.js';
import { dur } from '../core/calendar.js';

const count = (g, t, pred) => { let n = 0; for (const b of g.buildings.values()) if (b.tribe === t.id && b.built && pred(b)) n++; return n; };
const farms = (g, t) => count(g, t, b => BUILDINGS[b.type].field);
const riverFarms = (g, t) => count(g, t, b => BUILDINGS[b.type].field && g.world.riverDist[g.world.idx(b.x + 1, b.y + 1)] <= 2);
const sev = g => g.difficultyDef.eventSeverity;
const tmpMod = (g, t, name, mods, days) => { t.eventMods.push({ name, mods, until: g.tick + DAY_TICKS * days }); t.modsDirty = true; };

export const EVENTS = [
  {
    key: 'drought', title: 'Drought', icon: 'sun', kind: 'bad',
    weight: (g, t) => (g.season === 1 ? 1.4 : g.season === 0 ? 0.4 : 0) * (farms(g, t) ? 1 : 0.2),
    text: (g, t) => 'The rains have failed. Fields crack and wells run low. Farms will produce far less until the weather turns.',
    choices: [
      { label: 'Ration the water', desc: '-3 happiness, crops suffer less.', apply: (g, t) => drought(g, t, 0.75, -3) },
      { label: 'Endure it', desc: 'Accept the full loss of yield.', apply: (g, t) => drought(g, t, 1, 0) },
    ],
  },
  {
    key: 'flood', title: 'River Flood', icon: 'wave', kind: 'bad',
    weight: (g, t) => (g.season === 0 ? 1.2 : 0.2) * Math.min(2, riverFarms(g, t) * 0.6),
    text: () => 'Spring melt has swollen the rivers. Floodwaters sweep through riverside fields and stores.',
    apply: (g, t) => {
      const lost = takeRes(t, 'grain', (t.stock.grain || 0) * 0.25 * sev(g));
      for (const b of g.buildings.values()) if (b.tribe === t.id && g.world.riverDist[g.world.idx(b.x, b.y)] <= 1) b.hp -= b.maxHp * 0.3;
      tmpMod(g, t, 'Flooded fields', { farm: -0.3 }, 1);
      return `${Math.round(lost)} grain was lost and riverside buildings were damaged. The silt will enrich the soil once the waters recede.`;
    },
  },
  {
    key: 'harvest', title: 'Bountiful Harvest', icon: 'wheat', kind: 'good',
    weight: (g, t) => (g.season === 2 ? 1.2 : 0) * (farms(g, t) ? 1 : 0),
    apply: (g, t) => { const n = 15 + farms(g, t) * 10; addRes(g, t, 'grain', n); return `Golden fields yield an extra ${n} grain.`; },
  },
  {
    key: 'discovery', title: 'Resource Discovery', icon: 'gem', kind: 'good',
    weight: (g, t) => 0.6,
    apply: (g, t) => {
      const w = g.world;
      const opts = ['iron', 'copper', 'stone', 'clay', 'coal', 'silver', 'gold', 'gems', 'salt'];
      const known = opts.filter(k => { const d = DEPOSITS[DEP[k]]; return !d.tech || t.techs.includes(d.tech); });
      const pick = g.rng.chance(0.65) && known.length ? g.rng.pick(known) : g.rng.pick(opts);
      for (let tries = 0; tries < 200; tries++) {
        const x = g.rng.int(1, w.w - 2), y = g.rng.int(1, w.h - 2), i = w.idx(x, y);
        if (w.owner[i] !== t.id || !BIOMES[w.biome[i]].build || w.occ[i] || w.deposit[i]) continue;
        const d = DEP[pick]; const def = DEPOSITS[d];
        for (let k = 0; k < 3; k++) { const xx = x + (k % 2), yy = y + (k >> 1); if (w.inb(xx, yy)) { const j = w.idx(xx, yy); if (!w.occ[j] && !isWater(w.biome[j])) { w.deposit[j] = d; w.depAmt[j] = def.amount[1]; } } }
        g.markTiles(x - 1, y - 1, 3, 3);
        g.fx.push({ kind: 'ping', x: x + 0.5, y: y + 0.5, t: 0, life: 3 });
        const usable = !def.tech || t.techs.includes(def.tech);
        return `Prospectors found a ${def.name.toLowerCase()} within your lands.${usable ? '' : ' You lack the knowledge to work it — yet.'}`;
      }
      addRes(g, t, 'stone', 30);
      return 'Scouts found a rich bed of loose stone (+30 stone).';
    },
  },
  {
    key: 'boom', title: 'Season of Plenty', icon: 'heart', kind: 'good',
    weight: (g, t) => (t.happiness > 55 && t.foodSat >= 1 ? 0.8 : 0.1),
    apply: (g, t) => { t.boomUntil = g.tick + DAY_TICKS * 3; return 'Contentment and full bellies bring a wave of new families. Births are greatly increased for three days.'; },
  },
  {
    key: 'epidemic', title: 'Epidemic', icon: 'skull', kind: 'bad',
    weight: (g, t) => Math.max(0, (t.pop - 25) / 60) * (t.diseaseRisk || 1) * 0.7,
    text: (g, t) => `A fever spreads through the crowded homes of the ${t.name}. ${t.stock.herbs >= 20 ? 'Your healers have herbs to hand.' : 'Your healers have few herbs.'}`,
    choices: [
      { label: 'Use herbal remedies', desc: 'Spend 20 herbs: halve the deaths.', can: (g, t) => (t.stock.herbs || 0) >= 20, apply: (g, t) => { takeRes(t, 'herbs', 20); return plague(g, t, 0.5); } },
      { label: 'Quarantine the sick', desc: '-15% productivity for six months: fewer deaths.', apply: (g, t) => { tmpMod(g, t, 'Quarantine', { productivity: -0.15 }, 2); return plague(g, t, 0.6); } },
      { label: 'Let it run its course', desc: 'Full severity.', apply: (g, t) => plague(g, t, 1) },
    ],
  },
  {
    key: 'unrest', title: 'Political Unrest', icon: 'fist', kind: 'bad',
    weight: (g, t) => (t.stability < 35 ? (35 - t.stability) / 10 : 0),
    text: () => 'Crowds gather at the hearth, denouncing the leadership. Something must be done.',
    choices: [
      { label: 'Offer concessions', desc: 'Give food and goods: +8 stability.', can: (g, t) => foodTotal(t) > 40, apply: (g, t) => { takeRes(t, 'grain', 25); takeRes(t, 'goods', 10); t.stabilityShock = Math.max(0, (t.stabilityShock || 0) - 8); return 'The crowds disperse, mollified.'; } },
      { label: 'Crack down', desc: 'Requires 4 soldiers: +5 stability, -6 happiness.', can: (g, t) => (t.jobCounts.soldier || 0) >= 4, apply: (g, t) => { t.stabilityShock = Math.max(0, (t.stabilityShock || 0) - 5); tmpMod(g, t, 'Crackdown', { happiness: -6 }, 3); return 'Soldiers clear the square. Order returns, but resentment smoulders.'; } },
      { label: 'Ignore them', desc: '-8 stability.', apply: (g, t) => { t.stabilityShock = (t.stabilityShock || 0) + 8; return 'The unrest festers.'; } },
    ],
  },
  {
    key: 'dispute', title: 'Clan Dispute', icon: 'scales', kind: 'neutral',
    weight: (g, t) => (t.pop > 30 ? 0.5 : 0.1),
    text: () => 'The elder clans and the young families quarrel over who should farm the best land.',
    choices: [
      { label: 'Side with the elders', desc: '+4 stability, -2 happiness for a time.', apply: (g, t) => { tmpMod(g, t, 'Elders favoured', { stability: 4, happiness: -2 }, 4); return 'Tradition is upheld.'; } },
      { label: 'Side with the young', desc: '+4 happiness, -3 stability for a time.', apply: (g, t) => { tmpMod(g, t, 'Youth favoured', { stability: -3, happiness: 4 }, 4); return 'The young families celebrate.'; } },
    ],
  },
  {
    key: 'caravan', title: 'Wandering Merchants', icon: 'coin', kind: 'neutral',
    weight: (g, t) => 0.6,
    text: (g, t) => { const o = caravanOffer(g, t); t._offer = o; return `A merchant caravan offers ${o.getAmt} ${RESOURCES[o.get].name} in exchange for ${o.giveAmt} ${RESOURCES[o.give].name}.`; },
    choices: [
      { label: 'Trade with them', desc: 'Make the exchange.', can: (g, t) => t._offer && (t.stock[t._offer.give] || 0) >= t._offer.giveAmt, apply: (g, t) => { const o = t._offer; takeRes(t, o.give, o.giveAmt); addRes(g, t, o.get, o.getAmt); return 'The deal is struck.'; } },
      { label: 'Send them away', desc: 'No trade.', apply: () => 'The caravan moves on.' },
    ],
  },
  {
    key: 'refugees', title: 'Wanderers at the Gate', icon: 'people', kind: 'neutral',
    weight: (g, t) => 0.45,
    text: () => 'A band of homeless wanderers asks to join your people. They are hungry but willing to work.',
    choices: [
      { label: 'Welcome them', desc: '+4 people, -20 food.', apply: (g, t) => { takeRes(t, 'grain', 10); takeRes(t, 'fruit', 10); const s = g.settlements.get(t.capital); for (let i = 0; i < 4; i++) makeAgent(g, t, s, { age: g.rng.int(15, 35) * DAYS_PER_YEAR }); return 'Four new souls join the tribe.'; } },
      { label: 'Turn them away', desc: 'Nothing happens.', apply: () => 'They wander on into the wilds.' },
    ],
  },
  {
    key: 'wildfire', title: 'Wildfire', icon: 'fire', kind: 'bad',
    weight: (g, t) => (g.season === 1 ? 0.7 : 0.1) * (t.droughtUntil > g.tick ? 3 : 1),
    apply: (g, t) => {
      const s = g.settlements.get(t.capital); const w = g.world;
      let cx = s.x, cy = s.y; for (let k = 0; k < 60; k++) { const ang = g.rng.next() * Math.PI * 2, d = g.rng.range(7, 13); const x = Math.round(s.x + Math.cos(ang) * d), y = Math.round(s.y + Math.sin(ang) * d); if (w.inb(x, y) && w.trees[w.idx(x, y)]) { cx = x; cy = y; break; } }
      let burned = 0, hit = 0;
      for (let dy = -5; dy <= 5; dy++) for (let dx = -5; dx <= 5; dx++) {
        if (dx * dx + dy * dy > 25) continue;
        const x = cx + dx, y = cy + dy; if (!w.inb(x, y)) continue; const i = w.idx(x, y);
        if (w.trees[i] && g.rng.chance(0.75)) { w.trees[i] = 0; burned++; g.fx.push({ kind: 'fire', x: x + 0.5, y: y + 0.5, t: -g.rng.next() * 2, life: 3 + g.rng.next() * 2 }); }
        const o = w.occ[i]; if (o) { const b = g.buildings.get(o - 1); if (b && g.rng.chance(0.08 * sev(g))) { b.hp -= b.maxHp * 0.5; hit++; } }
      }
      g.markTiles(cx - 6, cy - 6, 13, 13);
      for (const b of [...g.buildings.values()]) if (b.hp <= 0 && b.type !== 'centre') destroyBuilding(g, b, 'fire');
      return `Fire swept through the woods near ${s.name}, consuming ${burned} stands of timber${hit ? ' and scorching buildings' : ''}. The forest will regrow.`;
    },
  },
  {
    key: 'quake', title: 'Earthquake', icon: 'crack', kind: 'bad',
    weight: (g, t) => { const s = g.settlements.get(t.capital); let m = 0; const w = g.world; for (let dy = -12; dy <= 12; dy += 3) for (let dx = -12; dx <= 12; dx += 3) { const x = s.x + dx, y = s.y + dy; if (w.inb(x, y) && w.biome[w.idx(x, y)] === B.MOUNTAIN) m++; } return m * 0.05; },
    apply: (g, t) => {
      let n = 0;
      for (const b of g.buildings.values()) if (b.tribe === t.id && g.rng.chance(0.25 * sev(g))) { b.hp -= b.maxHp * g.rng.range(0.2, 0.6); n++; }
      for (const b of [...g.buildings.values()]) if (b.hp <= 0 && b.type !== 'centre') destroyBuilding(g, b, 'quake');
      g.shake = 1.2;
      return `The ground heaved beneath the mountains. ${n} buildings were damaged.`;
    },
  },
  {
    key: 'ruins', title: 'Ancient Ruins', icon: 'scroll', kind: 'good',
    weight: (g, t) => 0.35,
    apply: (g, t) => { const pts = 25 + t.techs.length * 4; g.addResearch(t, pts); return `Explorers uncovered carvings of a forgotten people (+${pts} research).`; },
  },
  {
    key: 'locusts', title: 'Locust Swarm', icon: 'bug', kind: 'bad',
    weight: (g, t) => (g.season === 1 ? 0.5 : 0) * (farms(g, t) > 1 ? 1 : 0),
    apply: (g, t) => { tmpMod(g, t, 'Locusts', { farm: -0.4 * sev(g) }, 1); return 'A cloud of locusts descends on the fields. Farm output falls sharply for a season.'; },
  },
  {
    key: 'envoy', title: 'Foreign Envoy', icon: 'scroll', kind: 'good',
    weight: (g, t) => g.tribes.filter(o => o !== t && o.alive && g.dip.contact[t.id][o.id] && !g.dip.atWar(t.id, o.id)).length * 0.2,
    apply: (g, t) => {
      const others = g.tribes.filter(o => o !== t && o.alive && g.dip.contact[t.id][o.id] && !g.dip.atWar(t.id, o.id));
      const o = g.rng.pick(others);
      g.dip.addMod(o.id, t.id, 'envoy', 10, { label: 'Exchanged envoys', decay: 0.3 });
      g.dip.addMod(t.id, o.id, 'envoy', 10, { label: 'Exchanged envoys', decay: 0.3 });
      return `An envoy of the ${o.name} arrived bearing greetings. Relations improve.`;
    },
  },
  {
    key: 'artisan', title: 'Gifted Artisan', icon: 'hammer', kind: 'good',
    weight: (g, t) => (t.jobCounts.craftsman ? 0.4 : 0),
    apply: (g, t) => { tmpMod(g, t, 'Gifted artisan', { craft: 0.25 }, 4); return 'A gifted artisan teaches new techniques. Crafting +25% for four days.'; },
  },
];

export const GLOBAL_EVENTS = [
  {
    key: 'harshwinter', title: 'Harsh Winter', icon: 'snow',
    weight: g => (g.season === 3 ? 1 : 0),
    apply: g => { for (const t of g.tribes) if (t.alive) tmpMod(g, t, 'Harsh winter', { food: 0.25 * sev(g), happiness: -2 }, 1); g.weather = { kind: 'snow', until: g.tick + DAY_TICKS }; return 'A bitter winter grips the world. Every people must eat more to stay warm.'; },
  },
  {
    key: 'comet', title: 'A Comet Appears', icon: 'star',
    weight: g => 0.15,
    apply: g => { g.comet = g.tick + DAY_TICKS * 2; for (const t of g.tribes) if (t.alive) tmpMod(g, t, 'Comet omen', t.def?.quirks?.cometOmen ? t.def.quirks.cometOmen : { happiness: g.rng.chance(0.5) ? 3 : -3 }, 2); return 'A blazing comet crosses the night sky. Seers argue over its meaning; Vaelith astronomers race to study it.'; },
  },
  {
    key: 'goodyear', title: 'Gentle Seasons', icon: 'sun',
    weight: g => (g.season === 0 ? 0.6 : 0),
    apply: g => { for (const t of g.tribes) if (t.alive) tmpMod(g, t, 'Gentle seasons', { farm: 0.15 }, 2); return 'Mild weather blesses the land. Farms everywhere flourish.'; },
  },
];

function drought(g, t, f, happy) {
  const resist = Math.max(0.2, 1 + mod(t, 'drought') + (t.amen?.drought || 0));
  const wells = Math.min(0.3, count(g, t, b => b.type === 'well') * 0.06);
  t.droughtMul = 1 - Math.max(0.1, 0.55 * f * resist * sev(g) - wells);
  t.droughtUntil = g.tick + DAY_TICKS * 2;
  if (happy) tmpMod(g, t, 'Water rationing', { happiness: happy }, 2);
  g.weather = { kind: 'drought', until: g.tick + DAY_TICKS * 2 };
  return `Farm output reduced to ${Math.round(t.droughtMul * 100)}% for two days${wells ? ' (wells helped)' : ''}.`;
}

function plague(g, t, f) {
  const members = [...g.agents.values()].filter(a => a.tribe === t.id);
  const rate = 0.035 * f * (t.diseaseRisk || 1) * sev(g);
  let n = 0;
  for (const a of members) { a.health -= 0.25 * f; if (g.rng.next() < rate * (a.age > 200 || a.age < 12 ? 1.8 : 0.6)) { g.removeAgent(a, 'illness'); n++; } }
  return `${n} died before the fever passed.`;
}

function caravanOffer(g, t) {
  const pool = ['wood', 'stone', 'grain', 'fish', 'tools', 'clay', 'herbs', 'iron', 'salt', 'goods'];
  const give = pool.slice().sort((a, b) => (t.stock[b] || 0) - (t.stock[a] || 0))[0];
  let get = g.rng.pick(pool.filter(r => r !== give));
  const giveAmt = Math.min(40, Math.max(10, Math.round((t.stock[give] || 0) * 0.3)));
  const getAmt = Math.max(3, Math.round(giveAmt * RESOURCES[give].value / RESOURCES[get].value * g.rng.range(0.8, 1.3)));
  return { give, giveAmt, get, getAmt };
}

export function rollEvents(game) {
  const rng = game.rng;
  for (const t of game.tribes) {
    if (!t.alive || t.pop < 3) continue;
    if (t.droughtUntil && game.tick > t.droughtUntil) { t.droughtMul = 1; t.droughtUntil = 0; }
    t.boom = t.boomUntil > game.tick;
    const before = t.eventMods.length;
    t.eventMods = t.eventMods.filter(e => e.until > game.tick);
    if (t.eventMods.length !== before) t.modsDirty = true;
    if (game.day < 3 || !rng.chance(0.2)) continue;
    const ev = rng.weighted(EVENTS, e => e.weight(game, t));
    if (!ev) continue;
    triggerEvent(game, t, ev);
  }
  if (game.day > 4 && rng.chance(0.12)) {
    const ev = rng.weighted(GLOBAL_EVENTS, e => e.weight(game));
    if (ev) { const msg = ev.apply(game); game.log(null, 'event', `${ev.title}: ${msg}`, 2); game.bus.emit('event', { title: ev.title, text: msg, icon: ev.icon, global: true }); }
  }
}

export function triggerEvent(game, t, ev) {
  const text = ev.text ? ev.text(game, t) : '';
  if (ev.choices) {
    if (t.isPlayer) {
      game.pendingEvents.push({ key: ev.key, tribe: t.id, text, tick: game.tick });
      game.bus.emit('eventChoice', { ev, text });
      return;
    }
    // AI picks the first sensible option for its temperament
    const ai = aiOf(t);
    const opts = ev.choices.filter(c => !c.can || c.can(game, t));
    const c = ev.key === 'refugees' ? (t.foodSat >= 1 ? opts[0] : opts[opts.length - 1]) : ev.key === 'unrest' && ai.military > 0.8 && opts.find(o => o.label === 'Crack down') ? opts.find(o => o.label === 'Crack down') : opts[0];
    const r = c.apply(game, t);
    game.log(t, 'event', `${ev.title} struck the ${t.name}. ${r || ''}`, 0);
    return;
  }
  const r = ev.apply(game, t);
  game.log(t, 'event', `${ev.title}: ${r}`, t.isPlayer ? 2 : 0);
  if (t.isPlayer) game.bus.emit('event', { title: ev.title, text: r, icon: ev.icon, kind: ev.kind });
}

export function resolveChoice(game, pe, idx) {
  const ev = EVENTS.find(e => e.key === pe.key); const t = game.tribes[pe.tribe];
  const c = ev.choices[idx];
  if (!c || (c.can && !c.can(game, t))) return null;
  game.pendingEvents = game.pendingEvents.filter(x => x !== pe);
  const r = c.apply(game, t) || '';
  game.log(t, 'event', `${ev.title} — ${c.label}. ${r}`, 2);
  return r;
}
