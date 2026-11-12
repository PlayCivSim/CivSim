// Worker <-> main-thread protocol.
//
// The simulation worker owns the authoritative Game. The main thread keeps a
// non-stepping mirror Game that is refreshed by batched messages:
//
//   worker -> main
//     { type: 'init',   data }                 full serialized game (create/load)
//     { type: 'batch',  fast, slow? }          ~20 Hz; slow part ~4 Hz or on change
//     { type: 'result', id, ok, value|error }  reply to a command
//   main -> worker
//     { type: 'cmd', id, name, args }          whitelisted commands (see host.js)
//
// Fast batches carry packed agent state in a transferable Float32Array, tile
// deltas for changed map regions, new visual effects, sound cues and forwarded
// simulation events. Slow batches carry tribes, buildings, settlements,
// armies, diplomacy, new chronicle entries and pending decisions.
import { JOB_KEYS } from '../data/buildings.js';
import { RES_KEYS } from '../data/resources.js';

export const JOBS = ['idle', ...JOB_KEYS];
export const STATES = ['think', 'walk', 'pathWait', 'wait', 'work', 'build', 'sleep', 'fight', 'travel'];
export const STRIDE = 15;
// layout: 0 id, 1 x, 2 y, 3 tribe, 4 flags, 5 job, 6 state, 7 carry, 8 age, 9 look, 10 hp, 11 health, 12 sid, 13 army, 14 building id+1 the agent is inside (0 = none)
export const F = { HIDDEN: 1, MOVING: 2, FEMALE: 4, LEFT: 8, ATTACK: 16, HAMMER: 32, BUBBLE: 64 };

const jobIdx = Object.fromEntries(JOBS.map((k, i) => [k, i]));
const stateIdx = Object.fromEntries(STATES.map((k, i) => [k, i]));
const resIdx = Object.fromEntries(RES_KEYS.map((k, i) => [k, i]));

export function packAgents(game) {
  const arr = new Float32Array(game.agents.size * STRIDE);
  let o = 0;
  for (const a of game.agents.values()) {
    let f = 0;
    if (a.hidden) f |= F.HIDDEN;
    if (a.moving) f |= F.MOVING;
    if (a.female) f |= F.FEMALE;
    if (a.facing < 0) f |= F.LEFT;
    if (a.anim === 'attack') f |= F.ATTACK;
    if (a.anim === 'hammer') f |= F.HAMMER;
    if (a.bubble > 0) f |= F.BUBBLE;
    const carry = a.carry ? Object.keys(a.carry)[0] : null;
    arr[o] = a.id; arr[o + 1] = a.x; arr[o + 2] = a.y; arr[o + 3] = a.tribe; arr[o + 4] = f;
    arr[o + 5] = jobIdx[a.job] ?? 0; arr[o + 6] = stateIdx[a.state] ?? 0; arr[o + 7] = carry ? resIdx[carry] : -1;
    arr[o + 8] = a.age; arr[o + 9] = a.look; arr[o + 10] = a.hp; arr[o + 11] = a.health; arr[o + 12] = a.sid ?? -1; arr[o + 13] = a.army ?? 0;
    arr[o + 14] = a.hidden ? (a.inB || (a.homeId != null ? a.homeId + 1 : 0)) : 0;
    o += STRIDE;
  }
  return arr;
}

// Apply packed agents to the mirror, keeping previous/next positions for
// interpolation between batches.
export function unpackAgents(mirror, arr) {
  const seen = new Set();
  for (let o = 0; o < arr.length; o += STRIDE) {
    const id = arr[o]; seen.add(id);
    let a = mirror.agents.get(id);
    const x = arr[o + 1], y = arr[o + 2];
    if (!a) { a = { id, skill: {}, x, y, _x0: x, _y0: y, _x1: x, _y1: y }; mirror.agents.set(id, a); }
    // first update, a jump, or a bad previous position: snap instead of interpolating
    else if (!(Math.abs(a._x1 - x) + Math.abs(a._y1 - y) <= 3) || !Number.isFinite(a.x) || !Number.isFinite(a.y)) { a._x0 = a.x = x; a._y0 = a.y = y; }
    else { a._x0 = a.x; a._y0 = a.y; }
    a._x1 = x; a._y1 = y;
    const f = arr[o + 4];
    a.tribe = arr[o + 3]; a.hidden = !!(f & F.HIDDEN); a.moving = !!(f & F.MOVING); a.female = !!(f & F.FEMALE);
    a.facing = f & F.LEFT ? -1 : 1; a.anim = f & F.ATTACK ? 'attack' : f & F.HAMMER ? 'hammer' : null; a.bubble = f & F.BUBBLE ? 1 : 0;
    a.job = JOBS[arr[o + 5]]; a.state = STATES[arr[o + 6]];
    const c = arr[o + 7]; if (c >= 0) { const k = RES_KEYS[c]; if (!a.carry || !(k in a.carry)) a.carry = { [k]: 1 }; } else a.carry = null;
    a.age = arr[o + 8]; a.look = arr[o + 9]; a.hp = arr[o + 10]; a.health = arr[o + 11];
    a.sid = arr[o + 12] < 0 ? null : arr[o + 12]; a.army = arr[o + 13] || null; a.inB = arr[o + 14];
  }
  for (const id of mirror.agents.keys()) if (!seen.has(id)) mirror.agents.delete(id);
}

// ------------------------------------------------------------------ tribes
const TRIBE_SKIP = new Set(['def', 'ledger']);
export function tribeSnapshot(t, withTimeline) {
  const o = {};
  for (const k in t) {
    if (TRIBE_SKIP.has(k)) continue;
    if (k === 'stats' && !withTimeline) { const { timeline, ...rest } = t.stats; o.stats = rest; continue; }
    o[k] = t[k];
  }
  return o;
}
export function applyTribe(mirrorTribe, snap) {
  const timeline = mirrorTribe.stats?.timeline;
  Object.assign(mirrorTribe, snap);
  if (!snap.stats.timeline) mirrorTribe.stats.timeline = timeline || [];
  mirrorTribe.modsDirty = false;
}

// ------------------------------------------------------------------ events
// Payloads reference live sim objects; encode them as ids (+copies for
// objects that may not yet exist in the mirror).
export function encodeEvent(type, p) {
  if (!p || typeof p !== 'object') return { type, p };
  const out = {};
  for (const [k, v] of Object.entries(p)) {
    if (v && typeof v === 'object') {
      if (v.def && v.key && typeof v.id === 'number') out[k] = { __t: v.id };
      else if ('centre' in v && Array.isArray(v.buildings)) out[k] = { __s: v.id, v: { ...v } };
      else if (k === 'b' && v.type) out[k] = { __b: v.id, v: { ...v } };
      else if (k === 'ev' && v.key) out[k] = { __ev: v.key };
      else out[k] = JSON.parse(JSON.stringify(v));
    } else out[k] = v;
  }
  return { type, p: out };
}
export function decodeEvent(mirror, e, EVENTS) {
  const p = e.p; if (!p || typeof p !== 'object') return p;
  for (const [k, v] of Object.entries(p)) {
    if (!v || typeof v !== 'object') continue;
    if ('__t' in v) p[k] = mirror.tribes[v.__t];
    else if ('__s' in v) p[k] = mirror.settlements.get(v.__s) || v.v;
    else if ('__b' in v) p[k] = mirror.buildings.get(v.__b) || v.v;
    else if ('__ev' in v) p[k] = EVENTS.find(x => x.key === v.__ev);
  }
  return p;
}

export const SLOW_EVENTS = new Set(['day', 'newYear', 'births']);
