// Map visibility, by difficulty (game.vis):
//   'open'    Easy   – everything visible, exact information.
//   'explore' Medium – fog over unexplored land; explored land stays visible.
//   'los'     Hard   – live line of sight: explored land you cannot see now is
//                      obscured and shows no foreign units or buildings;
//                      information about rivals has reliability levels and ages.
// Every people (AI included) keeps its own explored map, and in Hard its own
// live sight, so rulers only act on what they have discovered.
//
// Storage: explored[t] is a Uint8Array per tribe (1 = explored). Live sight
// uses a stamp per tile (sightGen[t] === seen[t][i] means visible now), so a
// refresh never clears the whole map.
import { learn } from './intel.js';

export const VIS_MODES = {
  open: { key: 'open', name: 'Easy', desc: 'The whole map is visible, including every army and town, and information about rivals is exact.' },
  explore: { key: 'explore', name: 'Medium', desc: 'Fog hides land nobody has explored. Once discovered, land stays visible. Information about rivals is exact once you have met them.' },
  los: { key: 'los', name: 'Hard', desc: 'Live line of sight: you only see what your people, towns, armies and scouts see right now. Rival reports are rumoured, reported or verified, and grow outdated.' },
};
const SIGHT = { agent: 6, soldier: 7, army: 8, town: 11, tower: 10 };

export function initVision(g) {
  const n = g.world.n;
  g.explored = g.tribes.map(() => new Uint8Array(n));
  g.world.explored = g.explored[g.playerId];
  if (g.vis === 'los') { g.seen = g.tribes.map(() => new Uint16Array(n)); g.sightGen = g.tribes.map(() => 1); }
  g.observers = [];
}
const ensure = g => { if (!g.explored || (g.vis === 'los' && !g.seen)) { const old = g.world.explored; initVision(g); if (old) g.explored[g.playerId].set(old); } };

// Stamp a circle as explored (and, in Hard, as visible now) for tribe `t`.
function stamp(g, t, cx, cy, r) {
  const w = g.world, ex = g.explored[t], seen = g.seen?.[t], gen = g.sightGen?.[t] || 0, P = t === g.playerId;
  const x0 = Math.max(0, Math.floor(cx - r)), x1 = Math.min(w.w - 1, Math.ceil(cx + r));
  const y0 = Math.max(0, Math.floor(cy - r)), y1 = Math.min(w.h - 1, Math.ceil(cy + r));
  const r2 = r * r;
  for (let y = y0; y <= y1; y++) {
    const dy = y - cy, row = y * w.w;
    for (let x = x0; x <= x1; x++) {
      const dx = x - cx; if (dx * dx + dy * dy > r2) continue;
      const i = row + x;
      if (!ex[i]) { ex[i] = 1; if (P) g.fogNew.push(i); }
      if (seen) seen[i] = gen;
    }
  }
}
export function revealFor(g, t, cx, cy, r) { if (g.vis === 'open') return; ensure(g); stamp(g, t, cx, cy, r); }

// Recomputes what every people can see. Called every 20 ticks.
export function updateVision(g) {
  if (g.vis === 'open') return;
  ensure(g);
  const los = g.vis === 'los', T = g.tribes.length;
  if (los) for (let t = 0; t < T; t++) { g.sightGen[t] = (g.sightGen[t] % 65000) + 1; }
  // settlements and towers
  for (const s of g.settlements.values()) stamp(g, s.tribe, s.x, s.y, SIGHT.town);
  if (los) for (const b of g.buildings.values()) if (b.built && (b.type === 'tower' || b.type === 'fort')) stamp(g, b.tribe, b.x + 1, b.y + 1, SIGHT.tower);
  // people (one stamp per 4×4 block per tribe keeps this cheap in crowded towns)
  const done = new Set();
  for (const a of g.agents.values()) {
    if (a.hidden) continue;
    const k = (a.tribe << 24) | ((a.x >> 2) << 12) | (a.y >> 2); if (done.has(k)) continue; done.add(k);
    stamp(g, a.tribe, a.x, a.y, a.army ? SIGHT.army : a.job === 'soldier' ? SIGHT.soldier : SIGHT.agent);
  }
  // scouts observing a foreign land, for as long as they stay
  g.observers = (g.observers || []).filter(o => o.until > g.tick);
  for (const o of g.observers) stamp(g, o.t, o.x, o.y, o.r);
  if (los) {
    g.visDirty = true;
    // seeing a foreign town verifies its lands; seeing its soldiers reports its army
    for (const s of g.settlements.values()) for (let t = 0; t < T; t++) {
      if (t === s.tribe || !visibleTo(g, t, s.x, s.y) || !g.dip.contact[t]?.[s.tribe]) continue;
      learn(g, t, s.tribe, 'land', 3, 'your own eyes');
      if (s.capital) learn(g, t, s.tribe, 'military', 2, 'watching their capital');
    }
  }
}
// Territory you own is always explored.
export function exploreOwned(g) {
  if (g.vis === 'open') return;
  ensure(g);
  const w = g.world, P = g.playerId;
  for (let i = 0; i < w.n; i++) { const o = w.owner[i]; if (o >= 0 && !g.explored[o][i]) { g.explored[o][i] = 1; if (o === P) g.fogNew.push(i); } }
}

// ------------------------------------------------------------------ queries
export function exploredBy(g, t, x, y) { if (g.vis === 'open') return true; const ex = g.explored?.[t]; return !ex || !!ex[(y | 0) * g.world.w + (x | 0)]; }
export function visibleTo(g, t, x, y) {
  if (g.vis === 'open') return true;
  const i = (y | 0) * g.world.w + (x | 0);
  if (g.vis === 'explore') return !g.explored?.[t] || !!g.explored[t][i];
  return !!(g.seen?.[t] && g.seen[t][i] === g.sightGen[t]);
}
// Player-facing (main thread mirror keeps `visNow` for the player only).
export function playerSees(g, x, y) {
  if (g.vis === 'open') return true;
  const i = (y | 0) * g.world.w + (x | 0);
  if (g.vis === 'explore') return !!g.world.explored?.[i];
  return !!g.visNow?.[i];
}

// Packed copy of the player's live sight for the main thread (Hard only).
export function playerSightBits(g) {
  const P = g.playerId, s = g.seen[P], gen = g.sightGen[P], n = g.world.n;
  const out = new Uint8Array(n);
  for (let i = 0; i < n; i++) if (s[i] === gen) out[i] = 1;
  return out;
}

// ------------------------------------------------------------------ save (run-length encoded)
export function rle(arr) { const out = []; let v = arr[0] ? 1 : 0, n = 0; out.push(v); for (let i = 0; i < arr.length; i++) { const b = arr[i] ? 1 : 0; if (b === v) n++; else { out.push(n); v = b; n = 1; } } out.push(n); return out; }
export function unrle(runs, n) { const out = new Uint8Array(n); let v = runs[0], p = 0; for (let k = 1; k < runs.length; k++) { if (v) out.fill(1, p, p + runs[k]); p += runs[k]; v ^= 1; } return out; }
export function serializeVision(g) { if (g.vis === 'open' || !g.explored) return undefined; return { explored: g.explored.map(rle) }; }
export function restoreVision(g, d) {
  if (g.vis === 'open') return;
  initVision(g);
  if (d?.explored) d.explored.forEach((r, t) => g.explored[t].set(unrle(r, g.world.n)));
  g.world.explored = g.explored[g.playerId];
}
