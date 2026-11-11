// Simulation host: owns the authoritative Game, runs the fixed-tick loop and
// streams batched state to the main thread. Runs inside a Web Worker
// (worker.js) or, as a fallback, in-thread behind the same message protocol.
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
import { addRes } from './economy.js';
import { LAWS } from '../data/laws.js';
import { DAY_TICKS } from '../core/constants.js';

const FAST_MS = 50, SLOW_MS = 250, WORLD_MS = 3000, VIEW_PAD = 6;

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
    if (!timer) { last = performance.now(); timer = setTimeout(loop, 16); }
  }

  function loop() {
    timer = setTimeout(loop, 16);
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
        buildings: buildingDelta(now), settlements: [...g.settlements.values()], armies: g.armies,
        dip: g.dip.toJSON(), pendingEvents: g.pendingEvents, pendingProposals: g.pendingProposals,
        history: g.history.filter(e => e.seq > histSent), nextId: g.nextId,
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
      if (yes) { if (pr.p.type === 'gift') game.dip.addMod(pr.to, pr.from, 'gift', 5, { label: 'Generous gifts', decay: 0.4 }); else acceptProposal(game, pr); }
      else {
        game.dip.addMod(pr.from, pr.to, 'rebuffed', -4, { label: 'Rebuffed our envoys', decay: 0.4 });
        if (pr.p.type === 'tribute') game.dip.onTributeRefused?.(pr.from, pr.to, pr.p);
        t.envoyBlock[pr.from + ':' + pr.p.type] = game.tick + 360 * 4;
      }
      return true;
    },
    propose(to, p) { const r = game.dip.propose(game.playerId, to, p); return { accept: r.accept, reasons: r.reasons }; },
    cancelTreaty(to, treaty) { game.dip.cancel(treaty, game.playerId, to, game.playerId, false); const t = P(); t.envoyBlock = t.envoyBlock || {}; t.envoyBlock[to + ':' + treaty] = game.tick + 360 * 12; return true; },
    declareWar(to) { game.dip.declareWar(game.playerId, to); return true; },
    enactLaw(law, opt) { return enactLaw(game, P(), law, opt); },
    adoptGov(k) { return adoptGov(game, P(), k); },
    campaign(sid, frac) { const r = launchCampaign(game, P(), sid, frac); return { ok: r.ok, why: r.why }; },
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
      if (!game && !['create', 'load'].includes(msg.name)) throw new Error('No game loaded');
      const value = fn(...(msg.args || []));
      post({ type: 'result', id: msg.id, ok: true, value });
      if (game && !['serialize', 'setView', 'watch', 'create', 'load', 'unload'].includes(msg.name)) flush(performance.now(), true);
    } catch (e) {
      post({ type: 'result', id: msg.id, ok: false, error: String(e?.stack || e) });
    }
  };
}
