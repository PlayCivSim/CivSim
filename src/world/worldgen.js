// Procedural world generation. Deterministic for a given seed + size: terrain
// can be regenerated on load, only mutable layers are saved.
import { RNG, Simplex, clamp, smoothstep } from '../core/rng.js';
import { B, BIOMES, isWater, biomeKeyForAffinity } from './biomes.js';
import { DEP, DEPOSITS } from '../data/resources.js';
import { TRIBES } from '../data/tribes.js';

const N4 = [[1, 0], [-1, 0], [0, 1], [0, -1]];
const N8 = [[1, 0], [-1, 0], [0, 1], [0, -1], [1, 1], [1, -1], [-1, 1], [-1, -1]];

export class World {
  constructor(w, h, seed) {
    this.w = w; this.h = h; this.seed = seed; this.n = w * h;
    this.height = new Float32Array(this.n);
    this.temp = new Float32Array(this.n);
    this.moist = new Float32Array(this.n);
    this.biome = new Uint8Array(this.n);
    this.trees = new Uint8Array(this.n);      // standing timber 0..255
    this.treeMax = new Uint8Array(this.n);    // regrowth target
    this.deposit = new Uint8Array(this.n);
    this.depAmt = new Uint16Array(this.n);
    this.fauna = new Uint8Array(this.n);      // wildlife/fish stock 0..255
    this.owner = new Int8Array(this.n).fill(-1);
    this.road = new Uint8Array(this.n);
    this.occ = new Int32Array(this.n);        // building id + 1
    this.field = new Uint8Array(this.n);      // farmland tiles
    this.riverDist = new Uint8Array(this.n);
    this.starts = [];
  }
  idx(x, y) { return y * this.w + x; }
  inb(x, y) { return x >= 0 && y >= 0 && x < this.w && y < this.h; }
  walkCost(i) {
    const b = this.biome[i];
    if (this.road[i]) return b === B.RIVER ? 0.8 : 0.45;
    const c = BIOMES[b].walk;
    return c || 0;
  }
  isBuildable(i) { return !!BIOMES[this.biome[i]].build && !this.occ[i] && !this.road[i]; }
}

export function generateWorld(seed, sizeKey, sizeDef) {
  const { w, h } = sizeDef;
  const world = new World(w, h, seed);
  world.sizeKey = sizeKey;
  const rng = new RNG(seed);
  const nH = new Simplex(seed ^ 0x1234), nW = new Simplex(seed ^ 0x9876), nM = new Simplex(seed ^ 0x5555);
  const nT = new Simplex(seed ^ 0x7777), nR = new Simplex(seed ^ 0x4242), nMt = new Simplex(seed ^ 0x3131);

  // --- 1. Height: warped fbm shaped by continent blobs and an edge falloff.
  const blobs = [];
  const nb = rng.int(2, 4);
  for (let i = 0; i < nb; i++) blobs.push({ x: rng.range(0.3, 0.7) * w, y: rng.range(0.3, 0.7) * h, r: rng.range(0.28, 0.42) * Math.min(w, h), s: i === 0 ? 1 : rng.range(0.55, 0.85) });
  for (let i = 0; i < rng.int(3, 7); i++) blobs.push({ x: rng.range(0.1, 0.9) * w, y: rng.range(0.1, 0.9) * h, r: rng.range(0.06, 0.12) * Math.min(w, h), s: rng.range(0.5, 0.8) });
  const sc = 1 / 48;
  const raw = new Float32Array(world.n);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const wx = x + nW.fbm(x * sc * 0.7, y * sc * 0.7, 3) * 22;
    const wy = y + nW.fbm(x * sc * 0.7 + 99, y * sc * 0.7 + 99, 3) * 22;
    let m = 0;
    for (const b of blobs) { const d = Math.hypot(wx - b.x, wy - b.y) / b.r; m = Math.max(m, b.s * (1 - smoothstep(0.35, 1.15, d))); }
    const ex = Math.min(x, w - 1 - x) / (w * 0.12), ey = Math.min(y, h - 1 - y) / (h * 0.12);
    const edge = smoothstep(0, 1, Math.min(ex, ey, 1));
    const n = nH.fbm(wx * sc, wy * sc, 6);
    raw[world.idx(x, y)] = (m * 0.75 + n * 0.55 - 0.05) * edge - (1 - edge) * 0.4;
  }
  // sea level by percentile so land fraction is controlled (~44%)
  const sorted = Float32Array.from(raw).sort();
  const sea = sorted[Math.floor(sorted.length * 0.56)];
  let maxH = -1e9, minH = 1e9;
  for (let i = 0; i < world.n; i++) { maxH = Math.max(maxH, raw[i]); minH = Math.min(minH, raw[i]); }
  for (let i = 0; i < world.n; i++) {
    const v = raw[i];
    world.height[i] = v >= sea ? (v - sea) / (maxH - sea) : -(sea - v) / (sea - minH);
  }
  // mountain ranges: ridged noise in a sparse mask, elongated like real ranges
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const i = world.idx(x, y);
    const hh = world.height[i];
    if (hh <= 0.02) continue;
    const mask = smoothstep(0.42, 0.72, nMt.fbm(x / 80, y / 80, 2) * 0.5 + 0.5 + hh * 0.25);
    const ridge = Math.pow(nR.ridged(x / 52, y / 52, 3), 2.2);
    world.height[i] = clamp(hh * 0.6 + ridge * mask * 0.75 * smoothstep(0.04, 0.3, hh), 0.01, 1);
  }

  // --- 2. Climate
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const i = world.idx(x, y);
    const lat = Math.abs(y / h - 0.5) * 2;
    world.temp[i] = clamp(1 - lat * 0.85 + nT.fbm(x / 60, y / 60, 3) * 0.28 - Math.max(0, world.height[i]) * 0.55, 0, 1);
    world.moist[i] = clamp(nM.fbm(x / 55, y / 55, 4) * 0.55 + 0.5, 0, 1);
  }

  // --- 3. Rivers flowing downhill to the sea, forming lakes in basins
  const river = new Uint8Array(world.n);
  const lake = new Uint8Array(world.n);
  const sources = Math.round((w * h) / 2200);
  let tries = 0, made = 0;
  while (made < sources && tries++ < sources * 30) {
    const x = rng.int(4, w - 5), y = rng.int(4, h - 5);
    const i0 = world.idx(x, y);
    if (world.height[i0] < 0.42 || world.height[i0] > 0.78) continue;
    let cx = x, cy = y; const pathT = []; const seen = new Set(); const lakeT = [];
    let ok = false;
    for (let step = 0; step < 400; step++) {
      const i = world.idx(cx, cy);
      if (world.height[i] <= 0) { ok = true; break; }
      if (river[i] && step > 0) { ok = true; break; }
      pathT.push(i); seen.add(i);
      let best = -1, bh = 1e9;
      for (const [dx, dy] of N4) {
        const nx = cx + dx, ny = cy + dy; if (!world.inb(nx, ny)) continue;
        const ni = world.idx(nx, ny); if (seen.has(ni)) continue;
        const hv = world.height[ni] + rng.next() * 0.012;
        if (hv < bh) { bh = hv; best = ni; }
      }
      if (best < 0) break;
      if (world.height[best] >= world.height[i]) {
        // basin: make a lake and let it overflow by lowering the spill tile
        if (pathT.length > 14 && !lakeT.length && rng.chance(0.35)) { const r = rng.int(1, 2); for (let dy = -r; dy <= r; dy++) for (let dx = -r - 1; dx <= r + 1; dx++) { const nx = cx + dx, ny = cy + dy; if (world.inb(nx, ny) && dx * dx / ((r + 1.5) ** 2) + dy * dy / ((r + 0.5) ** 2) <= 1) lakeT.push(world.idx(nx, ny)); } }
        world.height[best] = world.height[i] - 0.002;
      }
      cx = best % w; cy = (best / w) | 0;
    }
    if (ok && pathT.length > 12) { for (const i of pathT) river[i] = 1; for (const i of lakeT) lake[i] = 1; made++; }
  }

  // --- 4. Biomes
  const distWater = bfsDistance(world, i => world.height[i] <= 0 || river[i] || lake[i], 12);
  for (let i = 0; i < world.n; i++) {
    const hh = world.height[i], t = world.temp[i];
    let m = world.moist[i] + (12 - distWater[i]) * 0.02;
    world.riverDist[i] = Math.min(255, distWater[i]);
    let b;
    if (hh <= 0) b = hh < -0.32 ? B.DEEP : hh < -0.08 ? B.OCEAN : B.SHALLOW;
    else if (lake[i]) b = B.LAKE;
    else if (river[i]) b = B.RIVER;
    else if (hh > 0.8) b = B.PEAK;
    else if (hh > 0.62) b = t < 0.1 ? B.PEAK : B.MOUNTAIN;
    else if (t < 0.16) b = B.SNOW;
    else if (t < 0.28) b = B.TUNDRA;
    else if (hh > 0.5) b = B.HILLS;
    else if (m < 0.33 && t > 0.6) b = B.DESERT;
    else if (m > 0.78 && hh < 0.18) b = B.SWAMP;
    else if (m > 0.66) b = B.DENSE;
    else if (m > 0.5) b = B.FOREST;
    else b = B.GRASS;
    world.biome[i] = b;
  }
  // coastline: shallow ring and beaches
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const i = world.idx(x, y); const b = world.biome[i];
    if (b === B.OCEAN || b === B.DEEP) {
      for (const [dx, dy] of N8) { const nx = x + dx, ny = y + dy; if (world.inb(nx, ny) && !isWater(world.biome[world.idx(nx, ny)])) { world.biome[i] = B.SHALLOW; break; } }
    }
  }
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const i = world.idx(x, y); const b = world.biome[i];
    if (isWater(b) || b === B.MOUNTAIN || b === B.PEAK) continue;
    if (world.height[i] < 0.06) {
      for (const [dx, dy] of N4) { const nx = x + dx, ny = y + dy; if (world.inb(nx, ny) && world.biome[world.idx(nx, ny)] === B.SHALLOW) { world.biome[i] = world.temp[i] < 0.25 ? B.TUNDRA : B.BEACH; break; } }
    }
  }
  // fertile valleys hug rivers in the lowlands
  for (let i = 0; i < world.n; i++) {
    const b = world.biome[i];
    if ((b === B.GRASS || b === B.FOREST) && world.riverDist[i] <= 2 && world.height[i] < 0.34 && world.temp[i] > 0.35) {
      const x = i % w, y = (i / w) | 0; let nearRiver = false;
      for (let dy = -3; dy <= 3 && !nearRiver; dy++) for (let dx = -3; dx <= 3; dx++) { const nx = x + dx, ny = y + dy; if (world.inb(nx, ny)) { const nb2 = world.biome[world.idx(nx, ny)]; if (nb2 === B.RIVER || nb2 === B.LAKE) { nearRiver = true; break; } } }
      if (nearRiver) world.biome[i] = B.VALLEY;
    }
  }
  smoothBiomes(world);

  // --- 5. Vegetation and fauna
  const nTree = new Simplex(seed ^ 0xabcd);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const i = world.idx(x, y); const bd = BIOMES[world.biome[i]];
    if (bd.trees) {
      const dens = bd.trees * (0.55 + nTree.fbm(x / 9, y / 9, 3) * 0.9);
      if (rng.next() < dens) { const v = rng.int(110, 230); world.trees[i] = v; world.treeMax[i] = v; }
    }
    if (bd.game) world.fauna[i] = Math.round(bd.game * rng.range(120, 220));
    if (bd.fish) world.fauna[i] = Math.round(bd.fish * rng.range(140, 240));
  }

  // --- 6. Mineral deposits in clusters, placed by geology
  const area = w * h / 10000;
  const place = (key, count, pred, cluster) => {
    const d = DEP[key]; const def = DEPOSITS[d];
    let placed = 0, t = 0;
    while (placed < count && t++ < count * 200) {
      const x = rng.int(2, w - 3), y = rng.int(2, h - 3); const i = world.idx(x, y);
      if (!pred(world.biome[i], i) || world.deposit[i]) continue;
      const k = rng.int(cluster[0], cluster[1]);
      let cx = x, cy = y;
      for (let c = 0; c < k; c++) {
        const ci = world.idx(cx, cy);
        if (pred(world.biome[ci], ci) && !world.deposit[ci]) { world.deposit[ci] = d; world.depAmt[ci] = rng.int(def.amount[0], def.amount[1]); }
        const [dx, dy] = rng.pick(N8); cx = clamp(cx + dx, 1, w - 2); cy = clamp(cy + dy, 1, h - 2);
      }
      placed++;
    }
  };
  const rocky = b => b === B.HILLS || b === B.MOUNTAIN;
  const mountain = b => b === B.MOUNTAIN;
  place('stone', 14 * area, b => rocky(b) || b === B.TUNDRA || b === B.GRASS && rng.chance(0.08), [3, 7]);
  place('clay', 8 * area, (b, i) => (b === B.SWAMP || b === B.VALLEY || b === B.GRASS) && world.riverDist[i] <= 3, [2, 5]);
  place('iron', 7 * area, rocky, [2, 5]);
  place('copper', 6 * area, rocky, [2, 4]);
  place('coal', 6 * area, b => rocky(b) || b === B.SWAMP || b === B.TUNDRA, [2, 5]);
  place('silver', 3 * area, mountain, [1, 3]);
  place('gold', 2.4 * area, b => mountain(b) || b === B.DESERT, [1, 3]);
  place('gems', 1.6 * area, mountain, [1, 2]);
  place('oil', 2.5 * area, b => b === B.DESERT || b === B.SWAMP || b === B.TUNDRA, [2, 4]);
  place('salt', 3 * area, b => b === B.BEACH || b === B.DESERT, [2, 4]);

  // --- 7. Balanced starting positions
  world.starts = findStarts(world, rng);
  return world;
}

function bfsDistance(world, srcPred, cap) {
  const d = new Uint8Array(world.n).fill(cap);
  const q = new Int32Array(world.n); let qh = 0, qt = 0;
  for (let i = 0; i < world.n; i++) if (srcPred(i)) { d[i] = 0; q[qt++] = i; }
  while (qh < qt) {
    const i = q[qh++]; const x = i % world.w, y = (i / world.w) | 0; const nd = d[i] + 1;
    if (nd >= cap) continue;
    for (const [dx, dy] of N4) { const nx = x + dx, ny = y + dy; if (!world.inb(nx, ny)) continue; const ni = world.idx(nx, ny); if (d[ni] > nd) { d[ni] = nd; q[qt++] = ni; } }
  }
  return d;
}

function smoothBiomes(world) {
  const { w, h } = world; const out = world.biome.slice();
  const fixed = b => isWater(b) || b === B.BEACH || b === B.MOUNTAIN || b === B.PEAK;
  for (let y = 1; y < h - 1; y++) for (let x = 1; x < w - 1; x++) {
    const i = world.idx(x, y); const b = world.biome[i]; if (fixed(b)) continue;
    const counts = new Map();
    for (const [dx, dy] of N8) { const nb = world.biome[world.idx(x + dx, y + dy)]; if (!fixed(nb)) counts.set(nb, (counts.get(nb) || 0) + 1); }
    let best = b, bc = counts.get(b) || 0;
    for (const [k, c] of counts) if (c > bc + 2) { best = k; bc = c; }
    out[i] = best;
  }
  world.biome.set(out);
}

export function siteStats(world, cx, cy, r = 9) {
  const s = { fert: 0, trees: 0, stone: 0, minerals: 0, water: 0, build: 0, coast: 0, hills: 0, mountainEdge: 0, aff: {} };
  for (let dy = -r; dy <= r; dy++) for (let dx = -r; dx <= r; dx++) {
    if (dx * dx + dy * dy > r * r) continue;
    const x = cx + dx, y = cy + dy; if (!world.inb(x, y)) continue;
    const i = world.idx(x, y); const b = world.biome[i]; const bd = BIOMES[b];
    s.fert += bd.fert || 0;
    if (world.trees[i]) s.trees++;
    if (bd.build) s.build++;
    if (b === B.SHALLOW) s.coast++;
    if (b === B.RIVER || b === B.LAKE) s.water += 2;
    if (b === B.HILLS) s.hills++;
    if (b === B.MOUNTAIN) s.mountainEdge++;
    const dep = world.deposit[i];
    if (dep === DEP.stone || dep === DEP.clay) s.stone++;
    else if (dep) s.minerals++;
    const ak = biomeKeyForAffinity(b); if (ak) s.aff[ak] = (s.aff[ak] || 0) + 1;
  }
  s.aff.coast = (s.aff.coast || 0) + s.coast;
  s.aff.river = s.water;
  s.aff.hills = (s.aff.hills || 0) + s.hills;
  s.aff.mountainEdge = s.mountainEdge;
  s.aff.minerals = s.minerals * 3;
  return s;
}

function findStarts(world, rng) {
  const { w, h } = world;
  const cands = [];
  for (let y = 10; y < h - 10; y += 3) for (let x = 10; x < w - 10; x += 3) {
    let ok = true;
    for (let dy = -2; dy <= 2 && ok; dy++) for (let dx = -2; dx <= 2; dx++) { const b = world.biome[world.idx(x + dx, y + dy)]; if (!BIOMES[b].build || b === B.BEACH) { ok = false; break; } }
    if (!ok) continue;
    const s = siteStats(world, x, y, 9);
    if (s.build < 150 || s.trees < 12 || (s.water + s.coast) < 2) continue;
    const score = s.fert * 1.2 + Math.min(s.trees, 60) * 0.5 + s.stone * 3 + Math.min(s.water + s.coast, 20) * 1.5 + s.build * 0.15 + s.minerals * 1.5;
    cands.push({ x, y, s, score });
  }
  cands.sort((a, b) => b.score - a.score);
  const pool = cands.slice(0, 120);
  const diag = Math.hypot(w, h);
  let best = null, bestV = -1e9;
  if (pool.length >= 4) {
    for (let t = 0; t < 1500; t++) {
      const set = rng.shuffle(pool.slice()).slice(0, 4);
      let minD = 1e9;
      for (let a = 0; a < 4; a++) for (let b = a + 1; b < 4; b++) minD = Math.min(minD, Math.hypot(set[a].x - set[b].x, set[a].y - set[b].y));
      if (minD < diag * 0.18) continue;
      const scores = set.map(c => c.score); const mean = scores.reduce((a, b) => a + b, 0) / 4;
      const sd = Math.sqrt(scores.reduce((a, b) => a + (b - mean) ** 2, 0) / 4);
      const v = (minD / diag) * 4 + mean / pool[0].score - (sd / mean) * 3;
      if (v > bestV) { bestV = v; best = set; }
    }
  }
  if (!best) {
    // fallback: spread through the candidate list or the map quadrants
    best = [];
    const quad = [[0.28, 0.3], [0.72, 0.3], [0.28, 0.7], [0.72, 0.7]];
    for (const [qx, qy] of quad) {
      let pick = null, pd = 1e9;
      for (const c of cands.length ? cands : []) { const d = Math.hypot(c.x - qx * w, c.y - qy * h); if (d < pd && !best.includes(c)) { pd = d; pick = c; } }
      if (!pick) pick = forceLand(world, Math.round(qx * w), Math.round(qy * h));
      best.push(pick);
    }
  }
  // assign tribes to sites to maximise biome affinity
  const perms = permutations([0, 1, 2, 3]);
  let bestPerm = perms[0], bestAff = -1;
  for (const p of perms) {
    let a = 0;
    for (let t = 0; t < 4; t++) { const site = best[p[t]]; const bias = TRIBES[t].biome; for (const k in bias) a += (site.s.aff[k] || 0) * bias[k]; }
    if (a > bestAff) { bestAff = a; bestPerm = p; }
  }
  const starts = [];
  for (let t = 0; t < 4; t++) { const c = best[bestPerm[t]]; starts.push({ x: c.x, y: c.y }); guaranteeBasics(world, rng, c.x, c.y); }
  return starts;
}

function forceLand(world, x, y) {
  for (let r = 0; r < 60; r++) for (let dy = -r; dy <= r; dy++) for (let dx = -r; dx <= r; dx++) {
    const nx = x + dx, ny = y + dy; if (!world.inb(nx, ny)) continue;
    if (BIOMES[world.biome[world.idx(nx, ny)]].build) {
      for (let yy = -3; yy <= 3; yy++) for (let xx = -3; xx <= 3; xx++) if (world.inb(nx + xx, ny + yy)) { const i = world.idx(nx + xx, ny + yy); if (!BIOMES[world.biome[i]].build) world.biome[i] = B.GRASS; world.height[i] = Math.max(world.height[i], 0.1); }
      return { x: nx, y: ny, s: siteStats(world, nx, ny), score: 0 };
    }
  }
  return { x, y, s: siteStats(world, x, y), score: 0 };
}

function guaranteeBasics(world, rng, cx, cy) {
  const s = siteStats(world, cx, cy, 11);
  const ring = (rmin, rmax, pred) => {
    for (let t = 0; t < 400; t++) {
      const a = rng.next() * Math.PI * 2, r = rng.range(rmin, rmax);
      const x = Math.round(cx + Math.cos(a) * r), y = Math.round(cy + Math.sin(a) * r);
      if (!world.inb(x, y)) continue; const i = world.idx(x, y);
      if (pred(world.biome[i], i)) return [x, y];
    }
    return null;
  };
  const landOk = (b, i) => BIOMES[b].build && b !== B.BEACH && !world.deposit[i];
  if (s.stone < 3) {
    const p = ring(6, 10, landOk);
    if (p) for (let k = 0; k < 4; k++) { const x = p[0] + (k % 2), y = p[1] + (k >> 1); if (world.inb(x, y)) { const i = world.idx(x, y); world.deposit[i] = DEP.stone; world.depAmt[i] = 900; world.trees[i] = 0; } }
  }
  if (s.trees < 25) {
    for (let k = 0; k < 40; k++) { const p = ring(5, 11, (b) => BIOMES[b].build && b !== B.BEACH); if (p) { const i = world.idx(p[0], p[1]); world.trees[i] = 160; world.treeMax[i] = 160; } }
  }
  // a modest metal deposit within reach keeps early progression fair
  let metal = false;
  for (let dy = -22; dy <= 22 && !metal; dy++) for (let dx = -22; dx <= 22; dx++) { const x = cx + dx, y = cy + dy; if (world.inb(x, y)) { const d = world.deposit[world.idx(x, y)]; if (d === DEP.iron || d === DEP.copper) { metal = true; break; } } }
  if (!metal) {
    const p = ring(12, 20, landOk);
    if (p) for (let k = 0; k < 3; k++) { const x = p[0] + k, y = p[1]; if (world.inb(x, y)) { const i = world.idx(x, y); world.deposit[i] = rng.chance(0.6) ? DEP.iron : DEP.copper; world.depAmt[i] = 700; } }
  }
  // clear the immediate site for a town centre
  for (let dy = -2; dy <= 2; dy++) for (let dx = -2; dx <= 2; dx++) { const i = world.idx(cx + dx, cy + dy); world.trees[i] = 0; if (world.deposit[i] && world.deposit[i] !== DEP.stone) world.deposit[i] = 0; }
}

function permutations(a) {
  if (a.length <= 1) return [a];
  const out = [];
  a.forEach((v, i) => { for (const p of permutations([...a.slice(0, i), ...a.slice(i + 1)])) out.push([v, ...p]); });
  return out;
}
