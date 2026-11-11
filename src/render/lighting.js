// Dynamic lighting. Two smooth (non-pixel) passes layered over the pixel art:
//  1. Sun shadows: every building, tree and person casts a soft shadow whose
//     direction and length follow the sun through the day.
//  2. Night lightmap: an ambient-dark buffer to which each light adds a
//     radial falloff, with shadow volumes cut out behind nearby buildings
//     (2D ray-cast occlusion). The buffer is multiplied over the scene, so
//     lit areas keep their true colours, then added back softly as bloom.
// Both passes render at reduced resolution and are upscaled with filtering,
// which gives soft penumbrae at low cost.
import { TILE } from '../core/constants.js';
import { BUILDINGS } from '../data/buildings.js';
import { TRIBES } from '../data/tribes.js';
import { hash2 } from '../core/rng.js';

const silhouettes = new WeakMap();
function silhouette(spr) {
  let s = silhouettes.get(spr);
  if (!s) {
    s = document.createElement('canvas'); s.width = spr.width; s.height = spr.height;
    const c = s.getContext('2d');
    const src = spr.getContext('2d').getImageData(0, 0, spr.width, spr.height), dst = c.createImageData(spr.width, spr.height);
    for (let i = 0; i < src.data.length; i += 4) if (src.data[i + 3] > 200) dst.data[i + 3] = 255;
    c.putImageData(dst, 0, 0);
    silhouettes.set(spr, s);
  }
  return s;
}
const layer = (holder, key, w, h) => { let c = holder[key]; if (!c) c = holder[key] = document.createElement('canvas'); if (c.width !== w || c.height !== h) { c.width = w; c.height = h; } return c; };

export class Lighting {
  constructor() { this.q = 0.5; }

  // Sun position: 0 at sunrise, 1 at sunset. Returns shadow vector per unit height and strength.
  sun(dayFrac) {
    const t = (dayFrac - 0.1) / 0.7;
    if (t <= 0 || t >= 1) return null;
    const el = Math.sin(Math.PI * t);
    const len = Math.min(1.7, 0.5 / Math.max(0.2, el));
    return { kx: -Math.cos(Math.PI * t) * len, ky: 0.28 + 0.12 * len, alpha: 0.34 * Math.min(1, el * 2.2) };
  }

  // items: [{ spr, x, y }] in art pixels (top-left of sprite; base = bottom edge)
  drawShadows(ctx, items, s, ox, oy, dayFrac, weatherDim) {
    const sun = this.sun(dayFrac); if (!sun || !items.length) return;
    const q = this.q, cv = ctx.canvas;
    const L = layer(this, 'shadow', Math.ceil(cv.width * q), Math.ceil(cv.height * q));
    const c = L.getContext('2d');
    c.setTransform(1, 0, 0, 1, 0, 0); c.clearRect(0, 0, L.width, L.height);
    c.imageSmoothingEnabled = true;
    const sq = s * q, oxq = ox * q, oyq = oy * q;
    for (const it of items) {
      const H = it.spr.height;
      // image point (px, py) -> ground: x + px + (H - py) * kx, y + H + (H - py) * ky
      c.setTransform(sq, 0, -sun.kx * sq, -sun.ky * sq, (it.x + H * sun.kx) * sq + oxq, (it.y + H + H * sun.ky) * sq + oyq);
      c.drawImage(silhouette(it.spr), 0, 0);
    }
    ctx.save();
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.imageSmoothingEnabled = true;
    ctx.globalAlpha = sun.alpha * weatherDim;
    ctx.drawImage(L, 0, 0, cv.width, cv.height);
    ctx.restore();
    ctx.imageSmoothingEnabled = false;
  }

  // lights: [{ x, y, r, col:[r,g,b], k }] in screen px; occluders: [{ x0, y0, x1, y1, id }] in screen px
  drawLightmap(ctx, lights, occluders, darkness) {
    const q = this.q, cv = ctx.canvas;
    const M = layer(this, 'lightmap', Math.ceil(cv.width * q), Math.ceil(cv.height * q));
    const m = M.getContext('2d');
    m.setTransform(1, 0, 0, 1, 0, 0);
    m.globalCompositeOperation = 'source-over';
    const d = darkness;
    m.fillStyle = `rgb(${Math.round(255 - d * 215)},${Math.round(255 - d * 200)},${Math.round(255 - d * 140)})`;
    m.fillRect(0, 0, M.width, M.height);
    m.globalCompositeOperation = 'lighter';
    for (const Lt of lights) {
      const R = Lt.r * q; if (R < 2) continue;
      const size = Math.min(1024, Math.ceil(R * 2));
      const S = layer(this, 'scratch', size, size);
      const c = S.getContext('2d');
      c.setTransform(1, 0, 0, 1, 0, 0); c.globalCompositeOperation = 'source-over'; c.clearRect(0, 0, size, size);
      const g = c.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2);
      const [cr, cg, cb] = Lt.col, k = Lt.k * d;
      g.addColorStop(0, `rgba(${cr},${cg},${cb},${k})`); g.addColorStop(0.35, `rgba(${cr},${cg},${cb},${k * 0.5})`); g.addColorStop(0.7, `rgba(${cr},${cg},${cb},${k * 0.14})`); g.addColorStop(1, `rgba(${cr},${cg},${cb},0)`);
      c.fillStyle = g; c.fillRect(0, 0, size, size);
      // cut shadow volumes behind each occluder (edges facing away from the light)
      if (Lt.cast) {
        c.globalCompositeOperation = 'destination-out'; c.fillStyle = '#000';
        const lx = Lt.x, ly = Lt.y, offx = size / 2 - lx * q, offy = size / 2 - ly * q, far = 40;
        for (const o of occluders) {
          if (o.id === Lt.id) continue;
          if (o.x1 < lx - Lt.r || o.x0 > lx + Lt.r || o.y1 < ly - Lt.r || o.y0 > ly + Lt.r) continue;
          if (lx > o.x0 && lx < o.x1 && ly > o.y0 && ly < o.y1) continue;
          const edges = [[o.x0, o.y0, o.x1, o.y0, 0, -1], [o.x1, o.y0, o.x1, o.y1, 1, 0], [o.x1, o.y1, o.x0, o.y1, 0, 1], [o.x0, o.y1, o.x0, o.y0, -1, 0]];
          for (const [ax, ay, bx, by, nx, ny] of edges) {
            if ((lx - ax) * nx + (ly - ay) * ny >= 0) continue; // faces the light: stays lit
            c.beginPath();
            c.moveTo(ax * q + offx, ay * q + offy); c.lineTo(bx * q + offx, by * q + offy);
            c.lineTo((bx + (bx - lx) * far) * q + offx, (by + (by - ly) * far) * q + offy);
            c.lineTo((ax + (ax - lx) * far) * q + offx, (ay + (ay - ly) * far) * q + offy);
            c.closePath(); c.fill();
          }
        }
      }
      m.drawImage(S, 0, 0, size, size, Lt.x * q - size / 2, Lt.y * q - size / 2, size, size);
    }
    ctx.save();
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.imageSmoothingEnabled = true;
    ctx.globalCompositeOperation = 'multiply';
    ctx.drawImage(M, 0, 0, cv.width, cv.height);
    // bloom: add a little of the light back so sources glow
    ctx.globalCompositeOperation = 'lighter'; ctx.globalAlpha = 0.16 * d;
    ctx.drawImage(M, 0, 0, cv.width, cv.height);
    ctx.restore();
    ctx.imageSmoothingEnabled = false;
  }

  // Collect lights and occluders for the visible region.
  collect(game, view, s, ox, oy, time, agentsVisible) {
    const lights = [], occ = [];
    const toS = (x, y) => [x * s + ox, y * s + oy];
    const ex = game.fog && game.world.explored, ww = game.world.w;
    for (const b of game.buildings.values()) {
      if (!b.built) continue;
      if (ex && !ex[b.y * ww + b.x]) continue; // hidden by fog of war
      const bx = b.x * TILE, by = b.y * TILE, sz = b.size * TILE;
      if (bx > view.x1 + 160 || bx + sz < view.x0 - 160 || by > view.y1 + 160 || by + sz < view.y0 - 160) continue;
      const def = BUILDINGS[b.type];
      if (!def.field && b.type !== 'training' && b.type !== 'well') { const [x0, y0] = toS(bx + 1, by + sz * 0.3); const [x1, y1] = toS(bx + sz - 1, by + sz - 1); occ.push({ x0, y0, x1, y1, id: b.id }); }
      const violet = TRIBES[b.tribe].key === 'vaelith';
      if (b.type === 'centre') { const [x, y] = toS(bx + sz - 5, by + sz - 3); const fl = 0.9 + Math.sin(time * 11 + b.id) * 0.06 + Math.sin(time * 23) * 0.04; lights.push({ x, y, r: 58 * s * fl, col: [255, 176, 96], k: 1, cast: true, id: -1 }); }
      else if ((def.housing || def.job || def.tower) && hash2(b.id, (time / 9) | 0, 3) > 0.22) { const [x, y] = toS(bx + sz / 2, by + sz + 1); lights.push({ x, y, r: (def.tower ? 30 : 22) * s, col: violet ? [196, 160, 255] : [255, 204, 138], k: 0.85, cast: true, id: b.id }); }
    }
    // people out after dark carry torches
    if (agentsVisible) {
      let n = 0;
      for (const a of game.agents.values()) {
        if (a.hidden || (ex && !ex[(a.y | 0) * ww + (a.x | 0)])) continue;
        const ax = a.x * TILE, ay = a.y * TILE;
        if (ax < view.x0 || ax > view.x1 || ay < view.y0 || ay > view.y1) continue;
        const [x, y] = toS(ax, ay - 4);
        lights.push({ x, y, r: 13 * s * (0.92 + Math.sin(time * 13 + a.id) * 0.08), col: [255, 190, 110], k: 0.8, cast: n < 16, id: -2 });
        if (++n > 40) break;
      }
    }
    // only the largest lights trace shadows when there are very many
    if (lights.length > 48) { lights.sort((p, q) => q.r - p.r); for (let i = 36; i < lights.length; i++) lights[i].cast = false; }
    return { lights, occ };
  }
}
