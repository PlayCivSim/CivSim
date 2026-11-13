// Simulation host: owns the authoritative Game, runs the fixed-tick loop and
// streams batched state to the main thread. Runs inside a Web Worker
// (worker.js) or, as a fallback, in-thread behind the same message protocol.
import { revealFor } from './vision.js';
import { playerSightBits } from './vision.js';
import { setSpec } from './logistics.js';
import { remember } from './aimind.js';
import { setEmbargo, setTariff, endContract } from './trade.js';
import { sendMission, setCounter } from './intel.js';
import { checksum } from '../save/checksum.js';
import { Game } from './game.js';
import { BUILDINGS, JOB_KEYS } from '../data/buildings.js';
import { packAgents, tribeSnapshot, encodeEvent } from './protocol.js';
import { placementCheck, placeBuilding, upgradeBuilding, destroyBuilding } from './buildings.js';
import { foundSettlement, acceptProposal, autoAllocate } from './ai.js';
import { resolveChoice } from './events.js';
import { setResearch, prereqPath, completeTech } from './progress.js';
import { normaliseAlloc, assignJobs } from './population.js';
import { enactLaw, adoptGov } from './government.js';
import { launchCampaign, recallArmy } from './military.js';
import { armourOk } from '../data/warfare.js';
import { sendScouts, recallScouts } from './explore.js';
import { startBridge } from './logistics.js';
import { addRes } from './economy.js';
import { LAWS } from '../data/laws.js';
import { DAY_TICKS } from '../core/constants.js';
import { dur } from '../core/calendar.js';

const VIEW_PAD = 6;
// battery saver: the worker wakes half as often and sends fewer, larger batches
let saver = false, TICK_MS = 16, FAST_MS = 50, SLOW_MS = 250, WORLD_MS = 3000;

export function createHost(post) {
  let game = null, hold = false, last = 0, timer = null;
  let lastFast = 0, lastSlow = 0, lastWorld = 0, lastDay = -1, lastTerr = -1, histSent = 0;
  let pendingEvents = [], pendingSfx = [], slowDirty = true, watch = null;
  let unsub = null;
  let bSig = new Map(), lastFullB = 0;
  const sigOf = b => `${b.type}|${b.tribe}|${b.built ? 1 : 0}|${b.progress | 0}|${b.hp | 0}|${b.workerCount || 0}|${b.residentCount || 0}|${b.flags}|${b.recipe}|${b.focus}|${b._builders || 0}|${b.sid}`;
  // buildings travel as deltas (changed/new + removed ids) with a periodic full resync
  function buildingDelta(now) {
    const full = now - lastFullB > 5000;
    if (full) { lastFullB = now; bSig = new Map(); for (const b of game.buildings.values()) bSig.set(b.id, sigOf(b)); return { full: [...game.buildings.values()] }; }
    const changed = [], removed = [];
    for (const b of game.buildings.values()) { const s = sigOf(b); if (bSig.get(b.id) !== s) { bSig.set(b.id, s); changed.push(b); } }
    for (const id of bSig.keys()) if (!game.buildings.has(id)) { bSig.delete(id); removed.push(id); }
    return { changed, removed };
  }

  function attach(g) {
    game = g; unsub?.();
    histSent = g.logSeq || 0; lastDay = -1; lastFullB = 0; lastTerr = -1; slowDirty = true; pendingEvents = []; pendingSfx = [];
    unsub = g.bus.on('*', (type, p) => {
      if (type === 'sfx') { if (pendingSfx.length < 24) pendingSfx.push(p); return; }
      pendingEvents.push(encodeEvent(type, p));
      slowDirty = true;
    });
    post({ type: 'init', data: g.serialize() });
    g.fx.length = 0; g.dirtyTiles.length = 0;
    if (!timer) { last = performance.now(); timer = setTimeout(loop, TICK_MS); }
  }

  function loop() {
    timer = setTimeout(loop, TICK_MS);
    if (!game) return;
    const now = performance.now();
    const dt = Math.min(0.25, (now - last) / 1000); last = now;
    if (!hold) game.update(dt);
    if (now - lastFast >= FAST_MS) { lastFast = now; flush(now); }
  }

  // ------------------------------------------------------------ batching
  function tileDeltas() {
    const w = game.world; const seen = new Set();
    for (const [x, y, ww, hh] of game.dirtyTiles) for (let yy = Math.max(0, y); yy < Math.min(w.h, y + hh); yy++) for (let xx = Math.max(0, x); xx < Math.min(w.w, x + ww); xx++) seen.add(yy * w.w + xx);
    const idx = Int32Array.from(seen);
    const n = idx.length;
    const d = { rects: game.dirtyTiles.slice(), idx, trees: new Uint8Array(n), treeMax: new Uint8Array(n), deposit: new Uint8Array(n), depAmt: new Uint16Array(n), road: new Uint8Array(n) };
    for (let k = 0; k < n; k++) { const i = idx[k]; d.trees[k] = w.trees[i]; d.treeMax[k] = w.treeMax[i]; d.deposit[k] = w.deposit[i]; d.depAmt[k] = w.depAmt[i]; d.road[k] = w.road[i]; }
    game.dirtyTiles.length = 0;
    return d;
  }

  function flush(now, forceSlow = false) {
    const g = game; const transfer = [];
    const agents = packAgents(g); transfer.push(agents.buffer);
    const fast = { tick: g.tick, speed: g.speed, hold, agents, fx: g.fx.splice(0), sfx: pendingSfx, events: pendingEvents, weather: g.weather, comet: g.comet, shake: g.shake || 0, perf: g.perf.tickMs };
    g.shake = 0; pendingSfx = []; pendingEvents = [];
    if (g.dirtyTiles.length) { const d = tileDeltas(); fast.tiles = d; transfer.push(d.idx.buffer, d.trees.buffer, d.treeMax.buffer, d.deposit.buffer, d.depAmt.buffer, d.road.buffer); }
    if (g.territoryVersion !== lastTerr) { lastTerr = g.territoryVersion; fast.owner = g.world.owner.slice(); fast.territoryVersion = lastTerr; transfer.push(fast.owner.buffer); }
    if (watch != null) { const a = g.agents.get(watch); if (a) { const { pending, travel, ...rest } = a; fast.watch = rest; } }
    let slow = null;
    if (forceSlow || slowDirty || fast.events.length || now - lastSlow >= SLOW_MS) {
      lastSlow = now; slowDirty = false;
      const day = g.day; const full = day !== lastDay; lastDay = day;
      slow = {
        tribes: g.tribes.map(t => tribeSnapshot(t, full)),
        buildings: buildingDelta(now), settlements: [...g.settlements.values()], armies: g.armies, expeditions: (g.expeditions || []).map(e => ({ ...e, trail: e.tribe === g.playerId ? e.trail.filter((_, k) => k % 3 === 0) : [] })),
        dip: g.dip.toJSON(), pendingEvents: g.pendingEvents, pendingProposals: g.pendingProposals,
        history: g.history.filter(e => e.seq > histSent), nextId: g.nextId, fog: g.fogNew.length ? g.fogNew.splice(0) : null, sight: g.vis === 'los' && g.visDirty ? (g.visDirty = false, playerSightBits(g)) : null,
      };
      histSent = g.logSeq || histSent;
    }
    if (now - lastWorld >= WORLD_MS) {
      lastWorld = now; const w = g.world;
      fast.world = { trees: w.trees.slice(), treeMax: w.treeMax.slice(), fauna: w.fauna.slice(), depAmt: w.depAmt.slice() };
      transfer.push(fast.world.trees.buffer, fast.world.treeMax.buffer, fast.world.fauna.buffer, fast.world.depAmt.buffer);
    }
    post({ type: 'batch', fast, slow }, transfer);
  }

  // ------------------------------------------------------------ commands
  const P = () => game.player;
  const findPending = (key, tick) => game.pendingEvents.find(pe => pe.key === key && pe.tick === tick);
  const COMMANDS = {
    create(opts, preTicks = 0) { const g = Game.create(opts); for (let i = 0; i < preTicks; i++) g.step(); g.fx.length = 0; g.dirtyTiles.length = 0; attach(g); return true; },
    load(json) { attach(Game.deserialize(typeof json === 'string' ? JSON.parse(json) : json)); return true; },
    // Serialises and verifies off the main thread so autosaves never hitch the UI.
    serialize() {
      const d = game.serialize();
      if (!d.world?.trees || d.tribes?.length !== 4 || !Array.isArray(d.agents)) throw new Error('Save verification failed');
      const json = JSON.stringify(d);
      return { json, sum: checksum(json), v: d.v };
    },
    markSeen(seq) { game.seenSeq = Math.max(game.seenSeq || 0, seq | 0); return game.seenSeq; },
    unload() { game = null; unsub?.(); return true; },
    setSpeed(i) { game.speed = i; return i; },
    setSaver(v) { saver = !!v; TICK_MS = saver ? 33 : 16; FAST_MS = saver ? 100 : 50; SLOW_MS = saver ? 500 : 250; WORLD_MS = saver ? 6000 : 3000; return saver; },
    setHold(v) { hold = !!v; return hold; },
    setView(v) { game.view = v ? { x0: v.x0 - VIEW_PAD, y0: v.y0 - VIEW_PAD, x1: v.x1 + VIEW_PAD, y1: v.y1 + VIEW_PAD } : null; return true; },
    watch(id) { watch = id; return true; },
    place(type, x, y) {
      const c = placementCheck(game, P(), type, x, y);
      if (!c.ok) return c;
      placeBuilding(game, P(), type, x, y); return { ok: true };
    },
    found(x, y) { return foundSettlement(game, P(), x, y); },
    resolveChoice(key, tick, idx) { const pe = findPending(key, tick); return pe ? resolveChoice(game, pe, idx) : null; },
    allyCall(victim, aggressor, yes) {
      if (yes) game.dip.declareWar(game.playerId, aggressor, `honouring their alliance with the ${game.tribes[victim].name}`);
      else game.dip.cancel('alliance', game.playerId, victim, game.playerId, true);
      if (yes) remember(game, victim, game.playerId, 'aid', 8, 20);
      return true;
    },
    // tutorial-only helpers (scripted stock and instant discoveries)
    tut(kind, arg) {
      if (!game.tutorial) return false;
      if (kind === 'grant') { for (const [r, v] of Object.entries(arg)) addRes(game, P(), r, v); return true; }
      if (kind === 'tech') { for (const k of prereqPath(P(), arg)) completeTech(game, P(), k); return true; }
      const pid = game.playerId, rivals = game.tribes.filter(t => t.id !== pid && t.alive !== false);
      if (kind === 'goodwill') { for (const o of rivals) { game.dip.contact[pid][o.id] = game.dip.contact[o.id][pid] = true; // scripted first contact
         game.dip.addMod(o.id, pid, 'tut', 35, { label: 'Welcoming envoys', decay: 0.02, noMod: true }); game.dip.addMod(pid, o.id, 'tut', 35, { label: 'Welcoming envoys', decay: 0.02, noMod: true }); } return true; }
      // a rival's envoy arrives with a proposal (kind 'trade'), or an ultimatum that is safe to refuse here
      if (kind === 'envoy' || kind === 'ultimatum') {
        const r = kind === 'envoy' ? rivals[0] : rivals[rivals.length - 1]; if (!r) return false;
        const p = kind === 'envoy' ? { type: 'trade' } : { type: 'tribute', ultimatum: true, reason: 'they wish to show their strength' };
        game.pendingProposals.push({ from: r.id, to: pid, p, tick: game.tick, ...(kind === 'ultimatum' ? { expires: game.tick + DAY_TICKS * 8 } : {}) });
        game.bus.emit('proposal', { from: r.id, to: pid, p }); return true;
      }
      // visibility lessons: a fast scout to the nearest undiscovered people, then send it home
      if (kind === 'scout') {
        const r = rivals.map(o => ({ o, s: game.settlements.get(o.capital) })).filter(x => x.s).sort((a, b) => Math.hypot(a.s.x - game.settlements.get(P().capital).x, a.s.y - game.settlements.get(P().capital).y) - Math.hypot(b.s.x - game.settlements.get(P().capital).x, b.s.y - game.settlements.get(P().capital).y))[0];
        if (!r) return false; addRes(game, P(), 'grain', 40);
        const res = sendMission(game, pid, r.o.id, 'scout'); const m = game.dip.missions?.find(x => x.id === res.mission);
        if (m) { m.eta = game.tick + 60; m.days = 1; m.doom = null; m.risk = 0; }
        return { ok: res.ok, to: r.o.id, x: r.s.x, y: r.s.y };
      }
      // scripted scenes ---------------------------------------------------
      const T = P(), cap = game.settlements.get(T.capital);
      const rival = rivals[1] || rivals[0];
      if (kind === 'famine') {   // the granaries spoil and the food workers walk off
        for (const k of ['grain', 'meat', 'fish', 'fruit', 'veg']) if (T.stock[k]) T.stock[k] *= 0.12;
        T.steward.work = false; for (const k of ['gatherer', 'hunter', 'fisher', 'farmer']) T.alloc[k] = 0; normaliseAlloc(T); assignJobs(game, T);
        game.log(T, 'event', 'Blight: rot spread through the stores and the food gatherers fell ill. The people will starve unless food work resumes.', 3, { cat: 'production', alert: true });
        return true;
      }
      if (kind === 'trade') {    // both sides know Barter and already trade
        for (const t of [T, rivals[0]]) { for (const k of prereqPath(t, 'barter')) completeTech(game, t, k); }
        if (!game.dip.has('trade', pid, rivals[0].id)) game.dip.sign('trade', pid, rivals[0].id);
        addRes(game, T, 'wood', 200); addRes(game, rivals[0], 'stone', 300);
        return { to: rivals[0].id };
      }
      if (kind === 'writing') { for (const k of prereqPath(T, 'writing')) completeTech(game, T, k); addRes(game, T, 'grain', 120); addRes(game, T, 'tools', 20); return true; }
      if (kind === 'invasion') { // a rival attacks with a small, weary warband
        game.tutWar = true;
        game.dip.declareWar(rival.id, pid, 'to seize your granaries');
        const adults = [...game.agents.values()].filter(a => a.tribe === rival.id && !a.army && a.age > 16 * 48).slice(0, 3);
        for (const a of adults) { a.job = 'soldier'; a.x = cap.x + 14; a.y = cap.y + 4; a._x0 = a.x; a._y0 = a.y; a.state = 'think'; a.hidden = false; }
        const r = launchCampaign(game, rival, T.capital, 1, 30);
        for (const a of game.agents.values()) if (r.army && a.army === r.army.id) a.hp = 10;
        addRes(game, T, 'weapons', 20);
        return { ok: r.ok, from: rival.id };
      }
      if (kind === 'counter') {  // supplies and recruits for a counter-campaign
        addRes(game, T, 'grain', 250); addRes(game, T, 'wood', 80);
        T.steward.work = false; T.alloc.soldier = Math.max(T.alloc.soldier || 0, Math.min(T.slots.soldier || 3, 6)); normaliseAlloc(T); assignJobs(game, T);
        game.dip.contact[pid][rival.id] = game.dip.contact[rival.id][pid] = true;
        if (game.vis !== 'open') { const s = game.settlements.get(rival.capital); revealFor(game, pid, s.x, s.y, 8); }
        return { to: rival.id, sid: rival.capital };
      }
      if (kind === 'outpost') {   // stoneworking + toolmaking, materials, and a rich unclaimed deposit nearby
        for (const k of prereqPath(T, 'toolmaking')) completeTech(game, T, k);
        addRes(game, T, 'wood', 60); addRes(game, T, 'tools', 10);
        const w = game.world; let best = null, bd = 1e9;
        for (let y = 2; y < w.h - 3; y++) for (let x = 2; x < w.w - 3; x++) {
          const i = w.idx(x, y); if (!w.deposit[i] || w.owner[i] !== -1) continue;
          const d = Math.hypot(x - cap.x, y - cap.y); if (d > 40 || d >= bd) continue;
          for (const [dx, dy] of [[-1, -1], [0, -1], [-1, 0], [0, 0]]) if (placementCheck(game, T, 'outpost', x + dx, y + dy, { free: true }).ok) { bd = d; best = { x: x + dx, y: y + dy }; break; }
        }
        if (best) revealFor(game, pid, best.x + 1, best.y + 1, 8);
        return best;
      }
      if (kind === 'expand') { T.tutTown = 1; addRes(game, T, 'wood', 120); addRes(game, T, 'stone', 60); addRes(game, T, 'grain', 60); return true; }
      if (kind === 'leave') { game.observers = (game.observers || []).filter(o => o.t !== pid); return true; }
      if (kind === 'age') { const rec = game.dip.intel?.[pid]; if (rec) for (const row of rec) for (const c of Object.values(row || {})) if (c) c.day -= 30; return true; }
      // free the law slot and the council's cooldown so a law can always be enacted
      if (kind === 'law') { const t = P(); for (const l of LAWS) t.laws[l.key] = l.options[0].key; t.lawCooldown = 0; t.modsDirty = true; return true; }
      return false;
    },
    steward(k, v) { P().steward[k] = v; return v; },
    workPriority(k) { P().workPriority = k || null; if (P().steward.work) autoAllocate(game, P()); return P().workPriority; },
    envoy(cfg) { P().envoy = { ...(P().envoy || {}), ...cfg }; return P().envoy; },
    alloc(k, d) {
      const t = P(); t.steward.work = false;
      t.alloc[k] = Math.max(0, (t.alloc[k] || 0) + d);
      let sum = JOB_KEYS.reduce((a, j) => a + (t.alloc[j] || 0), 0);
      if (d > 0 && sum > t.adults) for (const j of ['gatherer', 'woodcutter', 'builder', 'hunter'].filter(j => j !== k)) while (sum > t.adults && t.alloc[j] > 0) { t.alloc[j]--; sum--; }
      normaliseAlloc(t); assignJobs(game, t); return t.alloc[k];
    },
    research(key) { return setResearch(game, P(), key); },
    answerProposal(from, tick, type, yes) {
      const i = game.pendingProposals.findIndex(p => p.from === from && p.tick === tick && p.p.type === type);
      if (i < 0) return false;
      const pr = game.pendingProposals.splice(i, 1)[0];
      const t = P(); t.envoyBlock = t.envoyBlock || {};
      game.log(t, 'diplomacy', `You ${yes ? 'accepted' : 'declined'} the ${game.tribes[from].name} ${pr.p.ultimatum ? 'ultimatum' : 'proposal'}${pr.sent != null ? ` (sent ${dur(Math.max(0, Math.round((game.tick - pr.sent) / 360)))} ago)` : ''}. Their envoy carries your answer home.`, 1, { with: from });
      const m = game.dip.missions?.find(x => x.id === pr.mission); if (m && m.status === 'back') m.eta = Math.min(m.eta, game.tick + m.days * 360);
      if (yes) { if (pr.p.type === 'gift') game.dip.addMod(pr.to, pr.from, 'gift', 5, { label: 'Generous gifts', decay: 0.4 }); else acceptProposal(game, pr); }
      else {
        game.dip.addMod(pr.from, pr.to, 'rebuffed', -4, { label: 'Rebuffed our envoys', decay: 0.4 });
        if (pr.p.type === 'tribute') game.dip.onTributeRefused?.(pr.from, pr.to, pr.p);
        t.envoyBlock[pr.from + ':' + pr.p.type] = game.tick + 360 * 4;
      }
      return true;
    },
    propose(to, p) {
      // Hard Mode: proposals travel with an envoy; the answer comes when they arrive
      if (!game.tutorial && !['war', 'cancel'].includes(p.type)) { const r = sendMission(game, game.playerId, to, 'envoy', p); return { sent: true, ...r }; }
      const r = game.dip.propose(game.playerId, to, p); return { accept: r.accept, reasons: r.reasons, counter: r.counter || null };
    },
    embargo(to, on) { return setEmbargo(game, game.playerId, to, !!on); },
    tariff(rate) { return setTariff(game, game.playerId, rate); },
    endContract(id) { const c = game.dip.treaties.find(x => x.type === 'contract' && x.id === id && (x.a === game.playerId || x.b === game.playerId)); if (!c) return false; endContract(game, c, game.playerId, 'cancelled'); return true; },
    specialise(sid, spec) { return setSpec(game, P(), sid, spec); },
    expandTo(x, y) {
      const t = P();
      if (x == null) { t.expandTarget = null; game.territoryDirty = true; return { ok: true }; }
      const w = game.world; x = Math.round(x); y = Math.round(y);
      if (!w.inb(x, y)) return { ok: false, why: 'Off the map' };
      t.expandTarget = { x, y, day: game.day };
      game.territoryDirty = true;
      game.log(t, 'settlement', 'You set a direction for your people to expand.', 1, { at: { x, y } });
      return { ok: true };
    },
    mission(to, kind) { return sendMission(game, game.playerId, to, kind); },
    counterIntel(n) { return setCounter(game, game.playerId, n); },
    cancelTreaty(to, treaty) { game.dip.cancel(treaty, game.playerId, to, game.playerId, false); const t = P(); t.envoyBlock = t.envoyBlock || {}; t.envoyBlock[to + ':' + treaty] = game.tick + 360 * 12; return true; },
    declareWar(to) { game.dip.declareWar(game.playerId, to); return true; },
    enactLaw(law, opt) { return enactLaw(game, P(), law, opt); },
    adoptGov(k) { return adoptGov(game, P(), k); },
    campaign(sid, frac, food, plan) { const r = launchCampaign(game, P(), sid, frac, food, plan); return { ok: r.ok, why: r.why }; },
    bridge(x0, y0, x1, y1) { return startBridge(game, P(), x0, y0, x1, y1); },
    scout(party, food, x, y) { return sendScouts(game, P(), party, food, x, y); },
    recallScouts(id) { return recallScouts(game, P(), id); },
    setArmour(k) { const t = P(); if (k != null && !armourOk(t, k)) return { ok: false, why: 'Not researched' }; t.armour = k || null; return { ok: true }; },
    recall(id) { const a = game.armies.find(x => x.id === id && x.tribe === game.playerId); if (a) recallArmy(game, a); return !!a; },
    bFocus(id, k) { const b = game.buildings.get(id); if (b && b.tribe === game.playerId) { b.focus = k || null; b._rock = null; } return true; },
    bRecipe(id, r) { const b = game.buildings.get(id); if (b && b.tribe === game.playerId) b.recipe = r; return true; },
    bUpgrade(id) { const b = game.buildings.get(id); return b && b.tribe === game.playerId ? upgradeBuilding(game, P(), b) : { ok: false, why: 'Not yours' }; },
    bDemolish(id) {
      const b = game.buildings.get(id); if (!b || b.tribe !== game.playerId || b.type === 'centre') return false;
      for (const [r, v] of Object.entries(BUILDINGS[b.type].cost || {})) addRes(game, P(), r, v * 0.4);
      destroyBuilding(game, b, 'demolished'); return true;
    },
  };

  return function onMessage(msg) {
    if (msg.type !== 'cmd') return;
    const fn = COMMANDS[msg.name];
    try {
      if (!fn) throw new Error('Unknown command ' + msg.name);
      if (!game && !['create', 'load', 'setSaver'].includes(msg.name)) throw new Error('No game loaded');
      const value = fn(...(msg.args || []));
      post({ type: 'result', id: msg.id, ok: true, value });
      if (game && !['serialize', 'setView', 'watch', 'create', 'load', 'unload', 'setSaver'].includes(msg.name)) flush(performance.now(), true);
    } catch (e) {
      post({ type: 'result', id: msg.id, ok: false, error: String(e?.stack || e) });
    }
  };
}
