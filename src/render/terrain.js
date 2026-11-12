// Terrain baking: the world is cut into 32x32-tile chunks, each rendered once
// pixel-by-pixel into an offscreen canvas and re-baked only when dirty.
// Two variants exist per chunk: ground only (trees drawn live and animated
// when zoomed in) and ground + baked tree glyphs (for zoomed-out views).
import { TILE } from '../core/constants.js';
import { BIOMES, B, isWater } from '../world/biomes.js';
import { DEPOSITS } from '../data/resources.js';
import { TRIBES } from '../data/tribes.js';
import { hash2 } from '../core/rng.js';
import { canvas, hexToRgb } from './pixel.js';
import { treeGlyph } from './sprites.js';

export const CH = 32;
const PAL = BIOMES.map(b => b.cols.map(hexToRgb));
const FOAM = hexToRgb('#a9d2f6'), FOAM2 = hexToRgb('#cfe6fb');
const ROAD = [hexToRgb('#b48d5e'), hexToRgb('#9a744a'), hexToRgb('#c7a274')];
const PAVE = [hexToRgb('#aaa598'), hexToRgb('#8b867b'), hexToRgb('#c4bfb2')];
const ROCK = [hexToRgb('#3f3e43'), hexToRgb('#55545a'), hexToRgb('#6c6b71'), hexToRgb('#85848a'), hexToRgb('#9a999f')];
const SNOW = [hexToRgb('#c9d3dd'), hexToRgb('#e2e8ee'), hexToRgb('#f3f6f9'), hexToRgb('#ffffff')];
const DEP_RGB = DEPOSITS.map(d => (d ? hexToRgb(d.color) : null));

export function treeTypeFor(world, i) {
  const b = world.biome[i]; const r = hash2(i % world.w, (i / world.w) | 0, 77);
  switch (b) {
    case B.GRASS: return r < 0.7 ? 'oak' : r < 0.85 ? 'birch' : 'bush';
    case B.VALLEY: return r < 0.6 ? 'oak' : 'bush';
    case B.FOREST: return r < 0.55 ? 'oak' : r < 0.8 ? 'pine' : 'birch';
    case B.DENSE: return r < 0.7 ? 'jungle' : 'oak';
    case B.HILLS: return r < 0.7 ? 'pine' : 'oak';
    case B.TUNDRA: case B.SNOW: return 'snowpine';
    case B.DESERT: return r < 0.7 ? 'cactus' : 'bush';
    case B.SWAMP: return 'swamp';
    case B.BEACH: return 'palm';
    case B.MOUNTAIN: return 'pine';
    default: return 'oak';
  }
}

export class TerrainCache {
  constructor(world, seed) {
    this.world = world; this.seed = seed;
    this.cw = Math.ceil(world.w / CH); this.chh = Math.ceil(world.h / CH);
    this.chunks = new Map();
    this.terrVersion = -1;
  }
  key(cx, cy) { return cy * 1000 + cx; }
  get(cx, cy) {
    const k = this.key(cx, cy);
    let c = this.chunks.get(k);
    if (!c) { c = { cx, cy, ground: null, trees: null, terr: null, dirty: true, tdirty: true, terrDirty: true }; this.chunks.set(k, c); }
    return c;
  }
  markTiles(x, y, w, h) {
    const x0 = Math.max(0, Math.floor((x - 1) / CH)), x1 = Math.min(this.cw - 1, Math.floor((x + w + 1) / CH));
    const y0 = Math.max(0, Math.floor((y - 1) / CH)), y1 = Math.min(this.chh - 1, Math.floor((y + h + 1) / CH));
    for (let cy = y0; cy <= y1; cy++) for (let cx = x0; cx <= x1; cx++) { const c = this.get(cx, cy); c.dirty = true; c.tdirty = true; }
  }
  markAllTerritory() { for (const c of this.chunks.values()) c.terrDirty = true; }

  ground(cx, cy) { const c = this.get(cx, cy); if (c.dirty || !c.ground) { c.ground = this.bake(cx, cy, c.ground); c.dirty = false; c.tdirty = true; } return c.ground; }
  withTrees(cx, cy) {
    const c = this.get(cx, cy);
    const g = this.ground(cx, cy);
    if (c.tdirty || !c.trees) {
      if (!c.trees) c.trees = canvas(CH * TILE, CH * TILE);
      const ctx = c.trees.getContext('2d');
      ctx.clearRect(0, 0, c.trees.width, c.trees.height);
      ctx.drawImage(g, 0, 0);
      const w = this.world;
      for (let ty = 0; ty < CH; ty++) for (let tx = 0; tx < CH; tx++) {
        const x = cx * CH + tx, y = cy * CH + ty; if (x >= w.w || y >= w.h) continue;
        const i = w.idx(x, y); if (w.trees[i] < 20) continue;
        const [d, l] = treeGlyph(treeTypeFor(w, i));
        const ox = tx * TILE + 1 + ((hash2(x, y, 5) * 3) | 0), oy = ty * TILE + ((hash2(x, y, 6) * 2) | 0);
        ctx.fillStyle = 'rgba(0,0,0,0.25)'; ctx.fillRect(ox + 1, oy + 6, 5, 1);
        ctx.fillStyle = d; ctx.fillRect(ox + 1, oy + 1, 4, 5); ctx.fillRect(ox, oy + 2, 6, 3);
        ctx.fillStyle = l; ctx.fillRect(ox + 1, oy + 1, 2, 2); ctx.fillRect(ox + 2, oy, 2, 1);
        ctx.fillStyle = '#5a3c22'; ctx.fillRect(ox + 2, oy + 6, 2, 1);
      }
      c.tdirty = false;
    }
    return c.trees;
  }

  bake(cx, cy, reuse) {
    const w = this.world; const size = CH * TILE;
    const cv = reuse || canvas(size, size);
    const ctx = cv.getContext('2d');
    const img = ctx.createImageData(size, size);
    const D = img.data;
    const seed = this.seed & 0xffff;
    for (let ty = 0; ty < CH; ty++) for (let tx = 0; tx < CH; tx++) {
      const x = cx * CH + tx, y = cy * CH + ty;
      if (x >= w.w || y >= w.h) continue;
      const i = w.idx(x, y); const b = w.biome[i]; const pal = PAL[b];
      const water = isWater(b);
      const H = (xx, yy) => { xx = Math.max(0, Math.min(w.w - 1, xx)); yy = Math.max(0, Math.min(w.h - 1, yy)); return w.height[yy * w.w + xx]; };
      const h00 = H(x - 1, y - 1), h10 = H(x, y - 1), h20 = H(x + 1, y - 1), h01 = H(x - 1, y), h11 = w.height[i], h21 = H(x + 1, y), h02 = H(x - 1, y + 1), h12 = H(x, y + 1), h22 = H(x + 1, y + 1);
      const slopeAt = (px, py) => {
        // bilinear gradient across the tile so lighting is smooth, not tile-stepped
        const u = (px + 0.5) / TILE - 0.5, v = (py + 0.5) / TILE - 0.5;
        const gx = (u < 0 ? (h11 - h01) * (1 + u) + (h01 - H(x - 2, y)) * -u : (h21 - h11) * (1 - u) + (H(x + 2, y) - h21) * u);
        const gy = (v < 0 ? (h11 - h10) * (1 + v) + (h10 - H(x, y - 2)) * -v : (h12 - h11) * (1 - v) + (H(x, y + 2) - h12) * v);
        return (gx + gy) * 5;
      };
      let slope = slopeAt(4, 4);
      // neighbour info for edges
      const nb = (dx, dy) => { const xx = x + dx, yy = y + dy; return w.inb(xx, yy) ? w.biome[w.idx(xx, yy)] : b; };
      const nU = nb(0, -1), nD = nb(0, 1), nL = nb(-1, 0), nR = nb(1, 0);
      const patch = hash2(x >> 1, y >> 1, seed + 3);
      const mountainish = b === B.MOUNTAIN || b === B.PEAK;
      const road = w.road[i];
      const rU = road && y > 0 && (w.road[i - w.w] || w.occ[i - w.w]), rD = road && y < w.h - 1 && (w.road[i + w.w] || w.occ[i + w.w]);
      const rL = road && x > 0 && (w.road[i - 1] || w.occ[i - 1]), rR = road && x < w.w - 1 && (w.road[i + 1] || w.occ[i + 1]);
      for (let py = 0; py < TILE; py++) for (let px = 0; px < TILE; px++) {
        const gx = x * TILE + px, gy = y * TILE + py;
        const n = hash2(gx, gy, seed);
        let r, g, bl;
        if (water) {
          const depth = Math.max(0, -w.height[i]);
          let ci = n < 0.6 ? 0 : n < 0.85 ? 1 : n < 0.95 ? 2 : 3;
          [r, g, bl] = pal[ci];
          if (b === B.DEEP) { const k = Math.min(1, depth * 1.2); r -= 8 * k; g -= 10 * k; bl -= 6 * k; }
          if ((gy + (gx >> 3)) % 7 === 0 && n > 0.45 && b !== B.RIVER) { r += 10; g += 12; bl += 12; }
          if (b === B.RIVER && ((gx + gy) % 5 === 0) && n > 0.5) { r += 18; g += 18; bl += 16; }
          // foam where water meets land
          const edgeL = px === 0 && !isWater(nL), edgeR = px === TILE - 1 && !isWater(nR), edgeU = py === 0 && !isWater(nU), edgeD = py === TILE - 1 && !isWater(nD);
          if (edgeL || edgeR || edgeU || edgeD) { [r, g, bl] = n > 0.3 ? FOAM : FOAM2; }
          else if ((px === 1 && !isWater(nL)) || (px === TILE - 2 && !isWater(nR)) || (py === 1 && !isWater(nU)) || (py === TILE - 2 && !isWater(nD))) { if (n > 0.55) [r, g, bl] = FOAM; }
        } else if (mountainish) {
          const hh = w.height[i] + (hash2(gx >> 1, gy >> 1, seed + 9) - 0.5) * 0.06 - py * 0.004 + px * 0.002;
          if (b === B.PEAK) {
            const k = Math.max(0, Math.min(3, ((hh - 0.78) * 30 + n * 1.5) | 0));
            [r, g, bl] = SNOW[k];
          } else {
            let k = Math.max(0, Math.min(4, ((hh - 0.6) * 22 + n * 1.4 + slope * 2) | 0));
            [r, g, bl] = ROCK[k];
          }
          // dark outline where mountains meet lowland
          const edge = (px === 0 && !isMt(nL)) || (px === TILE - 1 && !isMt(nR)) || (py === 0 && !isMt(nU)) || (py === TILE - 1 && !isMt(nD));
          if (edge) [r, g, bl] = ROCK[0];
          if (b === B.PEAK && ((px === 0 && nL === B.MOUNTAIN) || (py === TILE - 1 && nD === B.MOUNTAIN))) [r, g, bl] = SNOW[0];
        } else {
          const patch2 = hash2((gx + (gy >> 2)) >> 2, (gy + (gx >> 3)) >> 2, seed + 3);
          let ci = n < 0.5 ? 0 : n < 0.78 ? 1 : n < 0.92 ? 2 : 3;
          if (patch2 > 0.8 && ci === 0) ci = 1; else if (patch2 < 0.15 && ci <= 1) ci = 2;
          slope = slopeAt(px, py);
          [r, g, bl] = pal[ci];
          const lit = Math.max(-0.18, Math.min(0.18, slope));
          r += lit * 70; g += lit * 70; bl += lit * 50;
          // grass tufts and flowers
          if ((b === B.GRASS || b === B.VALLEY) && n > 0.985) { r = 236; g = 220; bl = 120; }
          if (b === B.GRASS && n < 0.006) { r = 220; g = 120; bl = 160; }
          if (b === B.DESERT && n > 0.97) { r -= 30; g -= 30; bl -= 20; }
          if (b === B.SWAMP && hash2(gx >> 2, gy >> 2, seed + 4) > 0.82) { r = 62; g = 96; bl = 110; }
          // darker rim against water (like a soft cliff/shoreline)
          const nearW = (px === 0 && isWater(nL)) || (px === TILE - 1 && isWater(nR)) || (py === 0 && isWater(nU)) || (py === TILE - 1 && isWater(nD));
          if (nearW && b !== B.BEACH) { r *= 0.8; g *= 0.82; bl *= 0.8; }
          // beach blend into neighbours
          if (b !== B.BEACH && ((px === 0 && nL === B.BEACH) || (py === 0 && nU === B.BEACH)) && n > 0.5) [r, g, bl] = PAL[B.BEACH][1];
          // roads
          if (road) {
            const RP = road === 2 ? PAVE : ROAD;
            const inC = px >= 2 && px <= 5 && py >= 2 && py <= 5;
            const arm = (rU && py < 2 && px >= 2 && px <= 5) || (rD && py > 5 && px >= 2 && px <= 5) || (rL && px < 2 && py >= 2 && py <= 5) || (rR && px > 5 && py >= 2 && py <= 5);
            if (inC || arm) {
              const edgePix = (px === 2 || px === 5) && !(rL && px === 2 && py >= 2 && py <= 5) || (py === 2 || py === 5);
              [r, g, bl] = n > 0.82 ? RP[2] : (edgePix && n > 0.4 ? RP[1] : RP[0]);
              if (road === 2 && (gx + gy) % 3 === 0) [r, g, bl] = RP[1];
            }
          }
        }
        // mineral deposits as specks
        const dep = w.deposit[i];
        if (dep && w.depAmt[i] > 0) {
          const dh = hash2(gx, gy, seed + 31);
          const blob = hash2(gx >> 1, gy >> 1, seed + 33);
          if (blob > 0.8 && dh > 0.3) { const c = DEP_RGB[dep]; [r, g, bl] = c; if (dh > 0.9) { r += 45; g += 45; bl += 45; } else if (dh < 0.45) { r *= 0.7; g *= 0.7; bl *= 0.7; } }
          else if (blob > 0.74) { r *= 0.62; g *= 0.62; bl *= 0.62; }
        }
        const o = ((ty * TILE + py) * size + tx * TILE + px) * 4;
        D[o] = r; D[o + 1] = g; D[o + 2] = bl; D[o + 3] = 255;
      }
    }
    ctx.putImageData(img, 0, 0);
    return cv;
  }

  // Territory is cached per chunk as two layers: a solid fill (its strength is
  // set by zoom when drawn) and a bold border (always drawn at full strength).
  territory(cx, cy) {
    const c = this.get(cx, cy);
    if (!c.terrDirty && c.terr) return c.terr;
    const w = this.world; const size = CH * TILE;
    if (!c.terr) c.terr = { fill: canvas(size, size), line: canvas(size, size), thick: canvas(size, size) };
    const f = c.terr.fill.getContext('2d');
    f.clearRect(0, 0, size, size);
    const edges = [];
    for (let ty = 0; ty < CH; ty++) for (let tx = 0; tx < CH; tx++) {
      const x = cx * CH + tx, y = cy * CH + ty; if (x >= w.w || y >= w.h) continue;
      const i = w.idx(x, y); const o = w.owner[i]; if (o < 0) continue;
      const col = TRIBES[o].color;
      f.fillStyle = col; f.fillRect(tx * TILE, ty * TILE, TILE, TILE);
      const diff = (dx, dy) => { const xx = x + dx, yy = y + dy; return !w.inb(xx, yy) || w.owner[w.idx(xx, yy)] !== o; };
      const X = tx * TILE, Y = ty * TILE;
      if (diff(-1, 0)) edges.push([col, X, Y, 'l']);
      if (diff(1, 0)) edges.push([col, X, Y, 'r']);
      if (diff(0, -1)) edges.push([col, X, Y, 't']);
      if (diff(0, 1)) edges.push([col, X, Y, 'b']);
    }
    // two border layers (thin for close views, thick for zoomed-out ones):
    // a dark halo first so the colour reads on any terrain, then the colour
    for (const [cv, wd] of [[c.terr.line, 2], [c.terr.thick, 7]]) {
      const l = cv.getContext('2d'); l.clearRect(0, 0, size, size);
      const box = (x, y, side, p) => { const r = side === 'l' ? [x, y, wd, TILE] : side === 'r' ? [x + TILE - wd, y, wd, TILE] : side === 't' ? [x, y, TILE, wd] : [x, y + TILE - wd, TILE, wd]; return [r[0] - p, r[1] - p, r[2] + p * 2, r[3] + p * 2]; };
      l.fillStyle = 'rgba(10,8,6,0.55)';
      for (const [, x, y, sd] of edges) l.fillRect(...box(x, y, sd, 1));
      for (const [col, x, y, sd] of edges) { l.fillStyle = col; l.fillRect(...box(x, y, sd, 0)); }
    }
    c.terrDirty = false;
    return c.terr;
  }
}

function dashed(ctx, x, y, w, h, vert) {
  if (vert) { for (let k = 0; k < h; k += 4) ctx.fillRect(x, y + k, 1, 3); }
  else { for (let k = 0; k < w; k += 4) ctx.fillRect(x + k, y, 3, 1); }
}
const isMt = b => b === B.MOUNTAIN || b === B.PEAK;
