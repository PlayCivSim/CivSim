// Grid A* with a binary heap, a per-tick request budget and an LRU-ish path
// cache. Inhabitants commute between the same buildings, so cache hits are
// common and most ticks run zero searches.

const DIRS = [[1, 0, 1], [-1, 0, 1], [0, 1, 1], [0, -1, 1], [1, 1, 1.414], [1, -1, 1.414], [-1, 1, 1.414], [-1, -1, 1.414]];

export class Pathfinder {
  constructor(world) {
    this.world = world;
    const n = world.n;
    this.g = new Float32Array(n);
    this.parent = new Int32Array(n);
    this.stamp = new Uint32Array(n);
    this.closed = new Uint32Array(n);
    this.cur = 1;
    this.heap = new Int32Array(n);
    this.hf = new Float32Array(n);
    this.cache = new Map();
    this.budget = 0;
    this.stats = { searches: 0, hits: 0, fails: 0 };
    this.allowRiver = () => true;
  }
  resetBudget(n) { this.budget = n; this.nodeBudget = 6000; }
  invalidate() { this.cache.clear(); }

  // Returns: array of tile indices (excluding start), [] if same tile,
  // null if unreachable, undefined if budget exhausted (try later).
  find(from, to, opts = {}) {
    if (from === to) return [];
    const boats = opts.boats || 0, closedMask = opts.closed || 0;
    const key = from * 1e6 + to + (boats * 256 + closedMask) / 1024;
    const c = this.cache.get(key);
    if (c !== undefined) { this.stats.hits++; return c; }
    if ((this.budget <= 0 || this.nodeBudget <= 0) && !opts.force) return undefined;
    this.budget--;
    this.stats.searches++;
    const p = this.search(from, to, opts.maxNodes || 3000, opts.bridges, boats, closedMask);
    if (!p) this.stats.fails++;
    if (this.cache.size > 4000) {
      let k = 0; for (const kk of this.cache.keys()) { this.cache.delete(kk); if (++k > 1000) break; }
    }
    this.cache.set(key, p);
    return p;
  }

  search(from, to, maxNodes, bridges = true, boats = 0, closedMask = 0) {
    // closed borders: tiles owned by a people in `closedMask` are off limits, unless the
    // walker already stands in such land (then it may walk out)
    const own = this.world.owner;
    const startClosed = closedMask && own[from] >= 0 && (closedMask >> own[from]) & 1;
    const shut = i => closedMask && own[i] >= 0 && (closedMask >> own[i]) & 1;
    // rowing: water is passable (deep ocean only with ocean-going boats), a little slower than open ground
    const cost = i => { const c = this.world.walkCost(i); if (!boats) return c; const b = this.world.biome[i]; if (b <= 4 && !this.world.road[i] && (b !== 0 || boats >= 2)) return 1.5; return c; };
    const w = this.world.w, h = this.world.h, world = this.world;
    const cur = ++this.cur;
    const tx = to % w, ty = (to / w) | 0;
    if (cost(to) === 0) return null;
    let size = 0;
    const heap = this.heap, hf = this.hf, g = this.g, stamp = this.stamp, closed = this.closed, parent = this.parent;
    const push = (i, f) => {
      let k = size++;
      while (k > 0) { const pk = (k - 1) >> 1; if (hf[pk] <= f) break; heap[k] = heap[pk]; hf[k] = hf[pk]; k = pk; }
      heap[k] = i; hf[k] = f;
    };
    const pop = () => {
      const top = heap[0]; size--;
      if (size > 0) {
        const li = heap[size], lf = hf[size];
        let k = 0;
        for (;;) {
          const l = 2 * k + 1; if (l >= size) break;
          const r = l + 1; const m = r < size && hf[r] < hf[l] ? r : l;
          if (hf[m] >= lf) break;
          heap[k] = heap[m]; hf[k] = hf[m]; k = m;
        }
        heap[k] = li; hf[k] = lf;
      }
      return top;
    };
    // weighted heuristic: slightly greedy, far fewer expansions, near-optimal routes
    const hfn = (i) => { const dx = Math.abs(i % w - tx), dy = Math.abs(((i / w) | 0) - ty); return (dx + dy + (1.414 - 2) * Math.min(dx, dy)) * 1.05; };
    g[from] = 0; stamp[from] = cur; parent[from] = -1;
    push(from, hfn(from));
    let expanded = 0;
    while (size > 0) {
      const i = pop();
      if (closed[i] === cur) continue;
      closed[i] = cur;
      if (i === to) break;
      if (++expanded > maxNodes) { this.nodeBudget -= expanded; return null; }
      const x = i % w, y = (i / w) | 0;
      for (const [dx, dy, dc] of DIRS) {
        const nx = x + dx, ny = y + dy;
        if (nx < 0 || ny < 0 || nx >= w || ny >= h) continue;
        const ni = ny * w + nx;
        if (closed[ni] === cur) continue;
        let c = cost(ni);
        if (c === 0) continue;
        if (shut(ni)) { if (!startClosed) continue; c += 3; }
        if (!bridges && world.biome[ni] === 4 && !world.road[ni]) continue;
        if (dx && dy) { if (cost(y * w + nx) === 0 || cost(ny * w + x) === 0) continue; }
        const occ = world.occ[ni];
        if (occ && ni !== to) c += 2.5; // walk around buildings when possible
        const ng = g[i] + c * dc;
        if (stamp[ni] !== cur || ng < g[ni]) {
          g[ni] = ng; stamp[ni] = cur; parent[ni] = i;
          push(ni, ng + hfn(ni));
        }
      }
    }
    this.nodeBudget -= expanded;
    if (stamp[to] !== cur || closed[to] !== cur) return null;
    const path = [];
    let i = to;
    while (i !== from && i !== -1) { path.push(i); i = parent[i]; }
    path.reverse();
    return path;
  }
}

// Which peoples' lands a tribe may not walk through: everyone it has no
// Border Access agreement with, except enemies at war (armies must invade).
export function closedMask(game, tid) {
  if (tid == null || !game.dip) return 0;
  let m = 0;
  for (const o of game.tribes) if (o.id !== tid && o.alive && !game.dip.has('access', tid, o.id) && !game.dip.atWar(tid, o.id)) m |= 1 << o.id;
  return m;
}
