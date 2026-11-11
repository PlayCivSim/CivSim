// Main-thread side of the simulation: talks to the worker, maintains the
// mirror Game used by the renderer and UI, and interpolates agent motion
// between batches so animation stays smooth at any batch rate.
import { Game } from './game.js';
import { BUILDINGS } from '../data/buildings.js';
import { unpackAgents, applyTribe, decodeEvent } from './protocol.js';
import { EVENTS } from './events.js';

export class SimClient {
  constructor() {
    this.mirror = null;
    this.seq = 1; this.waiting = new Map();
    this.batchAt = 0; this.batchGap = 50;
    this.onInit = null;
    this.mode = 'worker';
    this.lastView = null; this.viewAt = 0;
    this.stats = { batches: 0, bytes: 0 };
    try {
      this.worker = new Worker(new URL('./worker.js', import.meta.url), { type: 'module' });
      this.worker.onmessage = e => this.receive(e.data);
      this.worker.onerror = e => { console.error('Simulation worker failed, falling back to in-thread simulation', e); this.fallback(); };
      this.send = (msg) => this.worker.postMessage(msg);
    } catch (e) {
      console.warn('Module workers unavailable; running simulation in-thread', e);
      this.fallback();
    }
  }

  // In-thread transport with identical message semantics (cloned, async).
  async fallback() {
    if (this.mode === 'local') return;
    this.mode = 'local';
    this.worker?.terminate(); this.worker = null;
    const { createHost } = await import('./host.js');
    const host = createHost(msg => { const m = structuredClone(msg); setTimeout(() => this.receive(m), 0); });
    this.send = msg => { const m = structuredClone(msg); setTimeout(() => host(m), 0); };
    // replay commands that were waiting on the dead worker
    for (const [id, w] of this.waiting) this.send({ type: 'cmd', id, name: w.name, args: w.args });
  }

  call(name, ...args) {
    const id = this.seq++;
    return new Promise((resolve, reject) => {
      this.waiting.set(id, { resolve, reject, name, args });
      this.send({ type: 'cmd', id, name, args });
    });
  }

  // ------------------------------------------------------------ receive
  receive(msg) {
    if (msg.type === 'result') {
      const w = this.waiting.get(msg.id); if (!w) return;
      this.waiting.delete(msg.id);
      if (msg.ok) w.resolve(msg.value); else { console.error('sim command failed', w.name, msg.error); w.reject(new Error(msg.error)); }
    } else if (msg.type === 'init') {
      const g = Game.deserialize(msg.data);
      g.isMirror = true; g.speed = msg.data.speed ?? 1; g.fx = []; g.dirtyTiles = [];
      g.logSeq = msg.data.logSeq || 0;
      this.mirror = g;
      this.onInit?.(g);
    } else if (msg.type === 'batch') {
      if (!this.mirror) return;
      this.apply(msg.fast, msg.slow);
    }
  }

  apply(fast, slow) {
    const g = this.mirror, w = g.world;
    const now = performance.now();
    if (this.batchAt) this.batchGap = this.batchGap * 0.8 + Math.min(200, now - this.batchAt) * 0.2;
    this.batchAt = now; this.stats.batches++;
    g.tick = fast.tick; g.speed = fast.speed; g.held = fast.hold;
    g.weather = fast.weather; g.comet = fast.comet; g.perf.tickMs = fast.perf;
    if (fast.shake) g.shake = Math.max(g.shake || 0, fast.shake);
    unpackAgents(g, fast.agents);
    if (fast.fx.length) g.fx.push(...fast.fx);
    if (fast.tiles) {
      const d = fast.tiles;
      for (let k = 0; k < d.idx.length; k++) { const i = d.idx[k]; w.trees[i] = d.trees[k]; w.treeMax[i] = d.treeMax[k]; w.deposit[i] = d.deposit[k]; w.depAmt[i] = d.depAmt[k]; w.road[i] = d.road[k]; }
      g.dirtyTiles.push(...d.rects);
    }
    if (fast.world) { w.trees.set(fast.world.trees); w.treeMax.set(fast.world.treeMax); w.fauna.set(fast.world.fauna); w.depAmt.set(fast.world.depAmt); }
    if (fast.owner) { w.owner.set(fast.owner); g.territoryVersion = fast.territoryVersion; }
    if (fast.watch) { const a = g.agents.get(fast.watch.id); if (a) { const { x, y, ...rest } = fast.watch; Object.assign(a, rest); } }
    if (slow) this.applySlow(slow);
    g.rebuildGrid();
    for (const s of fast.sfx) g.bus.emit('sfx', s);
    for (const e of fast.events) g.bus.emit(e.type, decodeEvent(g, e, EVENTS));
  }

  applySlow(s) {
    const g = this.mirror, w = g.world;
    s.tribes.forEach((snap, i) => applyTribe(g.tribes[i], snap));
    // buildings: replace and rebuild occupancy/field layers
    g.buildings = new Map(s.buildings.map(b => [b.id, b]));
    w.occ.fill(0); w.field.fill(0);
    for (const b of s.buildings) for (let dy = 0; dy < b.size; dy++) for (let dx = 0; dx < b.size; dx++) { const i = (b.y + dy) * w.w + b.x + dx; w.occ[i] = b.id + 1; if (BUILDINGS[b.type]?.field) w.field[i] = 1; }
    g.settlements = new Map(s.settlements.map(x => [x.id, x]));
    g.armies = s.armies;
    Object.assign(g.dip, s.dip);
    g.pendingEvents = s.pendingEvents; g.pendingProposals = s.pendingProposals;
    g.nextId = s.nextId;
    if (s.history.length) { g.history.push(...s.history); if (g.history.length > 1500) g.history.splice(0, g.history.length - 1500); }
  }

  // ------------------------------------------------------------ per frame
  frame(view) {
    const g = this.mirror; if (!g) return;
    const alpha = Math.min(1, (performance.now() - this.batchAt) / Math.max(16, this.batchGap));
    for (const a of g.agents.values()) { a.x = a._x0 + (a._x1 - a._x0) * alpha; a.y = a._y0 + (a._y1 - a._y0) * alpha; }
    if (view && performance.now() - this.viewAt > 250) {
      const v = { x0: Math.round(view.x0), y0: Math.round(view.y0), x1: Math.round(view.x1), y1: Math.round(view.y1) };
      const l = this.lastView;
      if (!l || l.x0 !== v.x0 || l.y0 !== v.y0 || l.x1 !== v.x1 || l.y1 !== v.y1) { this.lastView = v; this.call('setView', v); }
      this.viewAt = performance.now();
    }
  }

  setSpeed(i) { if (this.mirror) this.mirror.speed = i; return this.call('setSpeed', i); }
  setHold(v) { if (this.held === v) return; this.held = v; this.call('setHold', v); }
}
