// Game: owns the world state and runs the fixed-tick simulation scheduler.
// Systems update at different cadences:
//   every tick      – agent movement & behaviour, soldiers
//   every 3 ticks   – defences, spatial grid rebuild
//   every 10 ticks  – census, territory refresh, AI fast/steward (staggered)
//   every 50 ticks  – job + housing assignment, needs/happiness, stage checks
//   every day       – economy ledger, demographics, regrowth, diplomacy, events, AI strategy
import '../data/registry.js'; // content packs (see docs/MODDING.md)
import { updateSupply, checkEra, aiSpecialise, dailyOutposts, aiOutpost, autoBridges } from './logistics.js';
import { TECH } from '../data/techs.js';
import { rollPersonality } from './aimind.js';
import { updateMissions, dailyIntel } from './intel.js';
import { updateExpeditions } from './explore.js';
import { initVision, updateVision, exploreOwned, revealFor, serializeVision, restoreVision } from './vision.js';
import { DAY_TICKS, DAYS_PER_YEAR, TICK_DT, SPEEDS, MAP_SIZES, DIFFICULTIES, STARTS, SEASONS } from '../core/constants.js';
import { RNG, hashString } from '../core/rng.js';
import { Bus } from '../core/bus.js';
import { generateWorld } from '../world/worldgen.js';
import { TRIBES } from '../data/tribes.js';
import { LAWS } from '../data/laws.js';
import { JOB_KEYS } from '../data/buildings.js';
import { Pathfinder } from './pathfinding.js';
import { makeAgent, updateAgents, ageYears } from './agents.js';
import { placeBuilding, recomputeTerritory, findSpot } from './buildings.js';
import { census, assignJobs, assignHousing, updateNeeds, dailyDemographics, makeLeader } from './population.js';
import { dailyEconomy, storageCap } from './economy.js';
import { computeMods } from './government.js';
import { addResearch, checkStage } from './progress.js';
import { Diplomacy } from './diplomacy.js';
import { updateDefences, militaryStrength, maxHp } from './military.js';
import { rollEvents, resolveChoice, EVENTS } from './events.js';
import { aiThink, stewardThink, autoAllocate } from './ai.js';
import { isWater, BIOMES } from '../world/biomes.js';

export const SAVE_VERSION = 7; // 7: soldier units, armour choice, battle plans, burning (all optional)
// 4: event records carry cat/with/alert; seenSeq. 5: fog, intel, missions (all optional)

// The shared event record keeps up to HISTORY_CAP entries. When full, minor
// news about other peoples goes first; anything major or involving the player
// is kept as long as possible.
export const HISTORY_CAP = 3000;
export function trimHistory(h, P) {
  const drop = h.length - Math.floor(HISTORY_CAP * 0.9);
  if (drop <= 0) return;
  let n = 0;
  const keep = h.filter((e, i) => { if (n < drop && i < h.length - 200 && e.imp < 2 && e.tribe !== P && e.with !== P) { n++; return false; } return true; });
  if (keep.length > HISTORY_CAP) keep.splice(0, keep.length - Math.floor(HISTORY_CAP * 0.9));
  h.length = 0; h.push(...keep);
}

export class Game {
  constructor() {
    this.bus = new Bus();
    this.tick = 0;
    this.speed = 1;
    this.acc = 0;
    this.agents = new Map();
    this.buildings = new Map();
    this.settlements = new Map();
    this.armies = [];
    this.expeditions = [];
    this.history = [];
    this.fx = [];
    this.reserved = new Set();
    this.pendingEvents = [];
    this.pendingProposals = [];
    this.dirtyTiles = [];
    this.territoryVersion = 0;
    this.nextId = 1;
    this.view = null;
    this.grid = new Map();
    this.weather = null;
    this.perf = { tickMs: 0, ticks: 0 };
    this.fog = false; this.fogNew = [];
  }

  get day() { return Math.floor(this.tick / DAY_TICKS); }
  get year() { return Math.floor(this.day / DAYS_PER_YEAR) + 1; }
  get season() { return this.day % DAYS_PER_YEAR; }
  get seasonName() { return SEASONS[this.season]; }
  get dayFrac() { return (this.tick % DAY_TICKS) / DAY_TICKS; }
  get player() { return this.tribes[this.playerId]; }
  get hardIntel() { return this.vis === 'los'; }
  get difficultyDef() { return DIFFICULTIES[this.difficulty] || DIFFICULTIES.balanced; }

  // ---------------------------------------------------------------- creation
  static create(opts) {
    const g = new Game();
    g.runId = opts.runId || ('run_' + Date.now().toString(36) + Math.floor(Math.random() * 1e6).toString(36));
    g.runName = opts.runName || 'New Run';
    g.seed = typeof opts.seed === 'number' ? opts.seed : hashString(String(opts.seed || Date.now()));
    g.seedText = String(opts.seedText ?? opts.seed);
    g.sizeKey = opts.size || 'medium';
    g.difficulty = opts.difficulty || 'balanced';
    g.startKey = opts.start || 'standard';
    g.playerId = opts.playerTribe ?? 0;
    g.observer = !!opts.observer;
    g.tutorial = !!opts.tutorial; // scripted tutorial world: rivals never attack the player
    // map visibility by difficulty: open (Easy) / explore (Medium) / los (Hard)
    g.vis = opts.vis || (opts.intel === 'open' ? 'open' : opts.intel === 'hard' ? 'los' : (g.tutorial || opts.observer) ? 'open' : 'explore');
    g.fog = g.vis !== 'open';
    g._personalitySeed = typeof g.seed === 'number' ? g.seed : [...String(g.seed)].reduce((a, c) => (a * 31 + c.charCodeAt(0)) >>> 0, 7); // Hard Mode: fog of war, uncertain intelligence, travelling envoys
    g.rng = new RNG(g.seed ^ 0xbeef);
    g.world = generateWorld(g.seed, g.sizeKey, MAP_SIZES[g.sizeKey]);
    g.pf = new Pathfinder(g.world);
    g.created = Date.now();
    g.tribes = TRIBES.map((def, i) => g.makeTribe(def, i, i === g.playerId && !g.observer));
    g.dip = new Diplomacy(g);
    const st = STARTS[g.startKey];
    for (const t of g.tribes) {
      const p = g.world.starts[t.id];
      const s = g.createSettlement(t, p.x, p.y, true);
      const r = g.rng;
      const n = st.pop;
      for (let i = 0; i < n; i++) {
        const age = i < 2 ? r.int(52, 62) : i < n * 0.7 ? r.int(16, 38) : r.int(3, 11);
        const a = makeAgent(g, t, s, { age: age * DAYS_PER_YEAR + r.int(0, 3), female: i % 2 === 0 });
        a.hp = maxHp(t);
      }
      const m = st.stock;
      t.stock = { wood: 60 * m, stone: 10 * m, grain: 20 * m, fruit: 30 * m, meat: 15 * m, fibre: 5 * m, tools: 6 * m };
      // starting camp: a few huts, forager camp and lumber camp placed by the planner
      for (const type of ['hut', 'hut', 'gatherer', 'lumber']) {
        const spot = findSpot(g, t, s, type);
        if (spot) placeBuilding(g, t, type, spot.x, spot.y, { free: true, built: true, sid: s.id });
      }
      computeMods(g, t);
    }
    for (const t of g.tribes) if (!t.isPlayer) t.ai = rollPersonality(g._personalitySeed, t);
    census(g);
    for (const t of g.tribes) { assignHousing(g, t); autoAllocate(g, t); assignJobs(g, t); t._cap = storageCap(g, t); }
    recomputeTerritory(g);
    if (g.fog) { initVision(g); for (const t of g.tribes) { const c = g.settlements.get(t.capital); revealFor(g, t.id, c.x, c.y, 16); } exploreOwned(g); updateVision(g); g.fogNew.length = 0; }
    g.log(null, 'world', `A new world awakens (seed ${g.seedText}). Four peoples light their first fires.`, 3);
    for (const t of g.tribes) g.log(t, 'settlement', `The ${t.name} founded ${g.settlements.get(t.capital).name}.`, 1);
    if (g.vis === 'explore') g.log(g.player, 'world', 'Beyond your borders lies unexplored land. Your people uncover the map as they travel, and scouts reveal distant homelands. Once discovered, land stays on your map.', 2);
    if (g.vis === 'los') g.log(g.player, 'world', 'Hard visibility: you see only what your people, towns, armies and scouts see right now; land out of sight is greyed and shows nobody. Reports of other peoples are rumours until confirmed, and they grow outdated.', 2);
    return g;
  }

  makeTribe(def, i, isPlayer) {
    const laws = {};
    for (const l of LAWS) laws[l.key] = l.options[0].key;
    const t = {
      id: i, key: def.key, def, name: def.name, color: def.color, isPlayer, alive: true,
      stock: {}, rates: {}, ledger: { prod: {}, cons: {} }, lastLedger: null,
      techs: [], research: { current: null, progress: 0, queue: [], bank: 0 },
      stage: 1, gov: 'chiefdom', laws, lawCooldown: 0, govCooldown: 0,
      alloc: Object.fromEntries(JOB_KEYS.map(k => [k, 0])),
      steward: { work: false, housing: false, build: false, research: false, diplomacy: false },
      happiness: 60, stability: 55, productivity: 1, foodSat: 1, warWeariness: 0,
      settlements: [], capital: null, mods: {}, modsDirty: true, eventMods: [], uniqueBuilt: [],
      stats: { built: 0, born: 0, died: 0, research: 0, peak: 0, timeline: [] },
      leader: null, strength: 0, pop: 0,
    };
    t.leader = makeLeader(this, t);
    return t;
  }

  createSettlement(t, x, y, capital) {
    const used = new Set([...this.settlements.values()].map(s => s.name));
    const pool = capital ? t.def.capitalNames : t.def.townNames;
    let name = pool.find(n => !used.has(n)) || (t.def.townNames[0] + ' ' + (this.settlements.size + 1));
    if (capital) name = this.rng.pick(pool.filter(n => !used.has(n))) || name;
    const s = { id: this.nextId++, tribe: t.id, name, x, y, capital, founded: this.tick, buildings: [], pop: 0, housing: 0, danger: 0, centre: null };
    this.settlements.set(s.id, s);
    t.settlements.push(s.id);
    if (capital) t.capital = s.id;
    const c = placeBuilding(this, t, 'centre', x - 1, y - 1, { free: true, built: true, sid: s.id });
    s.centre = c.id;
    recomputeTerritory(this);
    return s;
  }

  // ---------------------------------------------------------------- helpers
  // Records a timestamped event (see records.js). extra: { with, cat, alert }
  log(tribe, type, text, importance = 1, extra) {
    this.logSeq = (this.logSeq || 0) + 1;
    const e = { tick: this.tick, day: this.day, tribe: tribe ? tribe.id : -1, type, text, imp: importance, seq: this.logSeq };
    if (extra) { if (extra.with != null) e.with = extra.with; if (extra.cat) e.cat = extra.cat; if (extra.alert) e.alert = 1; if (extra.at) e.at = [Math.round(extra.at.x), Math.round(extra.at.y)]; }
    this.history.push(e);
    if (this.history.length > HISTORY_CAP) trimHistory(this.history, this.playerId);
    this.bus.emit('log', e);
  }
  markTiles(x, y, w, h) { this.dirtyTiles.push([x, y, w, h]); }
  addResearch(t, pts) { addResearch(this, t, pts); }

  removeAgent(a, cause) {
    if (!this.agents.has(a.id)) return;
    this.agents.delete(a.id);
    if (a.partner) { const p = this.agents.get(a.partner); if (p) p.partner = null; }
    if (a.task?.res != null) this.reserved.delete(a.task.res);
    const t = this.tribes[a.tribe];
    t.stats.died++;
    t.deathCauses = t.deathCauses || {};
    t.deathCauses[cause] = (t.deathCauses[cause] || 0) + 1;
    if (cause === 'battle') this.fx.push({ kind: 'fallen', x: a.x, y: a.y, t: 0, life: 2.5, tribe: a.tribe });
    if (this.selected?.kind === 'agent' && this.selected.id === a.id) this.selected = null;
  }

  rebuildGrid() {
    const g = this.grid; g.clear();
    for (const a of this.agents.values()) {
      if (a.hidden) continue;
      const k = ((a.x >> 3) << 16) | (a.y >> 3);
      let c = g.get(k); if (!c) { c = []; g.set(k, c); }
      c.push(a);
    }
  }
  *nearbyAgents(x, y, r) {
    const x0 = Math.floor((x - r) / 8), x1 = Math.floor((x + r) / 8), y0 = Math.floor((y - r) / 8), y1 = Math.floor((y + r) / 8);
    for (let cx = x0; cx <= x1; cx++) for (let cy = y0; cy <= y1; cy++) { const c = this.grid.get((cx << 16) | cy); if (c) yield* c; }
  }
  agentAt(x, y, r = 0.7) {
    let best = null, bd = r * r;
    for (const a of this.nearbyAgents(x, y, 2)) { const d = (a.x - x) ** 2 + (a.y - 0.4 - y) ** 2; if (d < bd) { bd = d; best = a; } }
    return best;
  }

  // ---------------------------------------------------------------- loop
  update(realDt) {
    const sp = SPEEDS[this.speed] ?? 1;
    if (!sp) return 0;
    this.acc += realDt * sp / TICK_DT;
    let n = 0;
    const maxTicks = 12 * sp;
    const t0 = performance.now();
    while (this.acc >= 1 && n < maxTicks) {
      this.step();
      this.acc -= 1; n++;
      if (performance.now() - t0 > 22) { this.acc = Math.min(this.acc, 2); break; } // frame budget guard
    }
    if (this.acc > maxTicks) this.acc = maxTicks;
    const ms = performance.now() - t0;
    if (n) { this.perf.tickMs = this.perf.tickMs * 0.9 + (ms / n) * 0.1; }
    return n;
  }

  step() {
    this.tick++;
    const tk = this.tick;
    this.pf.resetBudget(30);
    if (this.pathDirty && tk % 40 === 0) { this.pf.invalidate(); this.pathDirty = false; }
    for (const t of this.tribes) if (t.modsDirty) computeMods(this, t);
    if (tk % 3 === 0) { this.rebuildGrid(); updateDefences(this); }
    updateAgents(this);
    if (tk % 10 === 5) updateMissions(this);
    updateExpeditions(this);
    if (tk % 20 === 7) updateVision(this);
    if (tk % 10 === 0) {
      census(this);
      if (this.territoryDirty) { recomputeTerritory(this); exploreOwned(this); }
      const ti = (tk / 10) % 4;
      const t = this.tribes[ti];
      if (t.alive) {
        if (!t.isPlayer) { if ((tk / 10) % 8 < 4 || (this.difficultyDef.skill || 1) > 1.2) aiThink(this, t, 'fast'); }
        else stewardThink(this, t);
      }
    }
    if (tk % 50 === 0) {
      for (const t of this.tribes) {
        if (!t.alive) continue;
        assignHousing(this, t); assignJobs(this, t); updateNeeds(this, t); checkStage(this, t);
        t.strength = militaryStrength(this, t);
        t._cap = storageCap(this, t);
        if (t.pop === 0 && t.alive && this.day > 1) { t.alive = false; this.dip.onEliminated(t.id); this.log(t, 'war', `The ${t.name} have vanished from the world.`, 3); this.bus.emit('eliminated', { tribe: t }); }
      }
      for (const b of this.buildings.values()) if (!b.built) b._builders = 0;
    }
    if (tk % DAY_TICKS === 0) this.newDay();
    if (tk % (DAY_TICKS / 2) === DAY_TICKS / 4) for (const t of this.tribes) if (!t.isPlayer && t.alive) aiThink(this, t, 'slow');
    // auto-resolve stale player choices after a day so the world never waits
    if (this.pendingEvents.length && tk % 100 === 0) {
      for (const pe of this.pendingEvents.slice()) if (tk - pe.tick > DAY_TICKS * 1.5) resolveChoice(this, pe, EVENTS.find(e => e.key === pe.key).choices.length - 1);
    }
    this.pendingProposals = this.pendingProposals.filter(p => p.p.ultimatum ? tk - p.tick < DAY_TICKS * 3 : tk - p.tick < DAY_TICKS * 2);
  }

  newDay() {
    const w = this.world;
    for (const t of this.tribes) {
      if (!t.alive) continue;
      t.foodSat = dailyEconomy(this, t);
      if (t.foodSat < 0.95 && t.isPlayer) { if (!t._famine) this.log(t, 'population', `Famine: the ${t.name} have too little food.`, 1, { cat: 'production', alert: true }); this.bus.emit('shortage', { res: 'food', sat: t.foodSat }); }
      t._famine = t.foodSat < 0.95;
      dailyDemographics(this, t);
      t.addResearchBase = 3 + (t.elders || 0) * 0.4 + t.stage;
      addResearch(this, t, t.addResearchBase * (1 + (t.mods.research || 0)));
      t.researchRate = t.researchToday || 0; t.researchToday = 0;
      t.stats.timeline.push({ d: this.day, pop: t.pop, food: Math.round(Object.entries(t.stock).filter(([k]) => ['grain', 'meat', 'fish', 'fruit', 'veg'].includes(k)).reduce((a, [, v]) => a + v, 0)), str: Math.round(t.strength), tech: t.techs.length, hap: Math.round(t.happiness), terr: t.territory || 0, wood: Math.round(t.stock.wood || 0), stone: Math.round(t.stock.stone || 0), coins: Math.round(t.stock.coins || 0), prod: Math.round(Object.values(t.lastLedger?.prod || {}).reduce((a, v) => a + v, 0)), war: this.dip.enemies(t.id).length });
      // keep the whole history: when long, thin the older half instead of dropping it
      if (t.stats.timeline.length > 480) { const tl = t.stats.timeline, half = tl.length >> 1; t.stats.timeline = tl.slice(0, half).filter((_, i) => i % 2 === 0).concat(tl.slice(half)); }
      const milestones = [25, 50, 100, 200, 400, 800];
      for (const m of milestones) if (t.pop >= m && (t.stats.popMilestone || 0) < m) { t.stats.popMilestone = m; this.log(t, 'population', `The ${t.name} now number ${m} souls.`, t.isPlayer ? 2 : 1); if (t.isPlayer) this.bus.emit('milestone', { text: `Population ${m}` }); }
    }
    // regrowth: forests, wildlife and fish recover depending on policy
    const regrow = this.tribes.map(t => 1 + (t.mods.forestRegrow || 0));
    const game = this.tribes.map(t => 1 + (t.mods.gameRegrow || 0) + (t.mods.forestRegrow || 0) * 0.3);
    const r = this.rng;
    const samples = Math.floor(w.n / 6);
    for (let k = 0; k < samples; k++) {
      const i = r.int(0, w.n - 1);
      const o = w.owner[i]; const f = o >= 0 ? regrow[o] : 1.2; const gf = o >= 0 ? game[o] : 1.2;
      if (w.treeMax[i] && w.trees[i] < w.treeMax[i] && !w.occ[i] && !w.road[i]) {
        const before = w.trees[i];
        w.trees[i] = Math.min(w.treeMax[i], w.trees[i] + Math.round(14 * f));
        if (before < 20 && w.trees[i] >= 20) this.markTiles(i % w.w, (i / w.w) | 0, 1, 1);
        else if (before === 0) { w.trees[i] = Math.max(w.trees[i], 0); }
      }
      const bd = BIOMES[w.biome[i]];
      const maxF = Math.round(((bd.game || bd.fish || 0)) * 220);
      if (maxF && w.fauna[i] < maxF) w.fauna[i] = Math.min(maxF, w.fauna[i] + Math.round(10 * gf));
    }
    // seedlings: stumps regrow into saplings slowly
    this.dip.daily();
    dailyIntel(this);
    updateSupply(this);
    dailyOutposts(this);
    autoBridges(this);
    for (const t of this.tribes) if (t.alive) { checkEra(this, t, TECH); if (!t.isPlayer && this.day % 5 === 0) { aiSpecialise(this, t); aiOutpost(this, t); } }
    if (!this.tutorial) rollEvents(this); // no random events interrupting the scripted tutorial
    if (this.weather && this.tick > this.weather.until) this.weather = null;
    if (!this.weather && this.rng.chance(0.18)) this.weather = { kind: this.season === 3 ? 'snow' : 'rain', until: this.tick + this.rng.int(80, 220) };
    if (this.day % DAYS_PER_YEAR === 0) this.bus.emit('newYear', { year: this.year });
    this.bus.emit('day', { day: this.day });
  }

  // ---------------------------------------------------------------- save/load
  serialize() {
    const w = this.world;
    const enc = arr => b64(new Uint8Array(arr.buffer, arr.byteOffset, arr.byteLength));
    const tribes = this.tribes.map(t => { const { def, mods, _stores, _sites, _cap, _lawUpkeep, slots, ...rest } = t; return rest; });
    const agents = [...this.agents.values()].map(a => { const { pending, travel, ...rest } = a; return rest; });
    return {
      v: SAVE_VERSION, runId: this.runId, runName: this.runName, seed: this.seed, seedText: this.seedText,
      sizeKey: this.sizeKey, difficulty: this.difficulty, startKey: this.startKey, playerId: this.playerId, observer: this.observer, tutorial: this.tutorial || false,
      created: this.created, saved: Date.now(), tick: this.tick, nextId: this.nextId, rng: this.rng.s, speed: this.speed,
      fog: this.fog || undefined, vis: this.vis, vision: serializeVision(this),
      world: { trees: enc(w.trees), treeMax: enc(w.treeMax), deposit: enc(w.deposit), depAmt: enc(w.depAmt), fauna: enc(w.fauna), road: enc(w.road), biome: enc(w.biome) },
      logSeq: this.logSeq || 0, seenSeq: this.seenSeq || 0, territoryVersion: this.territoryVersion,
      tribes, agents, buildings: [...this.buildings.values()], settlements: [...this.settlements.values()],
      armies: this.armies, expeditions: this.expeditions, history: this.history, dip: this.dip.toJSON(), pendingEvents: this.pendingEvents, weather: this.weather,
    };
  }

  static deserialize(d) {
    if (!d || d.v == null || !d.world) throw new Error('Save data is corrupted or incomplete');
    const g = new Game();
    Object.assign(g, { runId: d.runId, runName: d.runName, seed: d.seed, seedText: d.seedText, sizeKey: d.sizeKey, difficulty: d.difficulty, startKey: d.startKey, playerId: d.playerId, observer: d.observer, tutorial: !!d.tutorial, created: d.created, tick: d.tick, nextId: d.nextId });
    g.rng = new RNG(1); g.rng.s = d.rng;
    g.world = generateWorld(g.seed, g.sizeKey, MAP_SIZES[g.sizeKey]);
    const w = g.world;
    const dec = (s, Type) => { const u8 = unb64(s); return new Type(u8.buffer, u8.byteOffset, u8.byteLength / Type.BYTES_PER_ELEMENT); };
    w.trees.set(dec(d.world.trees, Uint8Array)); w.treeMax.set(dec(d.world.treeMax, Uint8Array));
    w.deposit.set(dec(d.world.deposit, Uint8Array)); w.depAmt.set(dec(d.world.depAmt, Uint16Array));
    w.fauna.set(dec(d.world.fauna, Uint8Array)); w.road.set(dec(d.world.road, Uint8Array));
    if (d.world.biome) w.biome.set(dec(d.world.biome, Uint8Array));
    // older saves: Hard-intelligence runs (fog) become Hard, everything else Easy
    g.vis = d.vis || (d.fog ? 'los' : 'open'); g.fog = g.vis !== 'open'; g.fogNew = [];
    g.pf = new Pathfinder(w);
    g.tribes = d.tribes.map((t, i) => ({ ...t, def: TRIBES[i], mods: {}, modsDirty: true }));
    if (g.fog) { restoreVision(g, d.vision); if (!d.vision && d.world.explored) w.explored.set(dec(d.world.explored, Uint8Array)); }
    for (const b of d.buildings) {
      g.buildings.set(b.id, b);
      for (let dy = 0; dy < b.size; dy++) for (let dx = 0; dx < b.size; dx++) { const i = w.idx(b.x + dx, b.y + dy); w.occ[i] = b.id + 1; if (BUILDING_FIELD(b.type)) w.field[i] = 1; }
    }
    for (const s of d.settlements) g.settlements.set(s.id, s);
    for (const a of d.agents) { if ((a.state === 'pathWait' || a.state === 'travel') && !a.expedition) { a.state = 'think'; a.hidden = false; } g.agents.set(a.id, a); }
    g.armies = d.armies || [];
    g.expeditions = d.expeditions || [];
    g.history = d.history || [];
    g.seenSeq = d.seenSeq || 0;
    g.logSeq = d.logSeq || g.history.reduce((m, e) => Math.max(m, e.seq || 0), 0);
    g.dip = new Diplomacy(g, d.dip);
    g.pendingEvents = d.pendingEvents || [];
    g.weather = d.weather || null;
    g.speed = 1;
    for (const t of g.tribes) computeMods(g, t);
    census(g);
    recomputeTerritory(g);
    return g;
  }
}

import { BUILDINGS } from '../data/buildings.js';
const BUILDING_FIELD = type => !!BUILDINGS[type]?.field;

function b64(u8) {
  let s = ''; const CH = 0x8000;
  for (let i = 0; i < u8.length; i += CH) s += String.fromCharCode.apply(null, u8.subarray(i, i + CH));
  return btoa(s);
}
function unb64(s) {
  const bin = atob(s); const u8 = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) u8[i] = bin.charCodeAt(i);
  return u8;
}
