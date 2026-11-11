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
  resetBudget(n) { this.budget = n; }
  invalidate() { this.cache.clear(); }

  // Returns: array of tile indices (excluding start), [] if same tile,
  // null if unreachable, undefined if budget exhausted (try later).
  find(from, to, opts = {}) {
    if (from === to) return [];
    const key = from * 1e6 + to;
    const c = this.cache.get(key);
    if (c !== undefined) { this.stats.hits++; return c; }
    if (this.budget <= 0 && !opts.force) return undefined;
    this.budget--;
    this.stats.searches++;
    const p = this.search(from, to, opts.maxNodes || 3000, opts.bridges);
    if (!p) this.stats.fails++;
    if (this.cache.size > 4000) {
      let k = 0; for (const kk of this.cache.keys()) { this.cache.delete(kk); if (++k > 1000) break; }
    }
    this.cache.set(key, p);
    return p;
  }

  search(from, to, maxNodes, bridges = true) {
    const w = this.world.w, h = this.world.h, world = this.world;
    const cur = ++this.cur;
    const tx = to % w, ty = (to / w) | 0;
    if (world.walkCost(to) === 0) return null;
    let size = 0;
    const heap = this.heap, hf = this.hf, g = this.g, stamp = this.stamp, closed = this.closed, parent = this.parent;
    const push = (i, f) => {
      let k = size++; heap[k] = i; hf[k] = f;
      while (k > 0) { const pk = (k - 1) >> 1; if (hf[pk] <= hf[k]) break; [heap[pk], heap[k]] = [heap[k], heap[pk]]; [hf[pk], hf[k]] = [hf[k], hf[pk]]; k = pk; }
    };
    const pop = () => {
      const top = heap[0]; size--;
      if (size > 0) {
        heap[0] = heap[size]; hf[0] = hf[size];
        let k = 0;
        for (;;) { const l = 2 * k + 1, r = l + 1; let m = k; if (l < size && hf[l] < hf[m]) m = l; if (r < size && hf[r] < hf[m]) m = r; if (m === k) break; [heap[m], heap[k]] = [heap[k], heap[m]]; [hf[m], hf[k]] = [hf[k], hf[m]]; k = m; }
      }
      return top;
    };
    const hfn = (i) => { const dx = Math.abs(i % w - tx), dy = Math.abs(((i / w) | 0) - ty); return (dx + dy + (1.414 - 2) * Math.min(dx, dy)) * 0.45; };
    g[from] = 0; stamp[from] = cur; parent[from] = -1;
    push(from, hfn(from));
    let expanded = 0;
    while (size > 0) {
      const i = pop();
      if (closed[i] === cur) continue;
      closed[i] = cur;
      if (i === to) break;
      if (++expanded > maxNodes) return null;
      const x = i % w, y = (i / w) | 0;
      for (const [dx, dy, dc] of DIRS) {
        const nx = x + dx, ny = y + dy;
        if (nx < 0 || ny < 0 || nx >= w || ny >= h) continue;
        const ni = ny * w + nx;
        if (closed[ni] === cur) continue;
        let c = world.walkCost(ni);
        if (c === 0) continue;
        if (!bridges && world.biome[ni] === 4 && !world.road[ni]) continue;
        if (dx && dy) { if (world.walkCost(y * w + nx) === 0 || world.walkCost(ny * w + x) === 0) continue; }
        const occ = world.occ[ni];
        if (occ && ni !== to) c += 2.5; // walk around buildings when possible
        const ng = g[i] + c * dc;
        if (stamp[ni] !== cur || ng < g[ni]) {
          g[ni] = ng; stamp[ni] = cur; parent[ni] = i;
          push(ni, ng + hfn(ni));
        }
      }
    }
    if (stamp[to] !== cur || closed[to] !== cur) return null;
    const path = [];
    let i = to;
    while (i !== from && i !== -1) { path.push(i); i = parent[i]; }
    path.reverse();
    return path;
  }
}
