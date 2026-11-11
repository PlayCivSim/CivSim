// World renderer: camera, terrain chunks, y-sorted sprites, effects, weather,
// clouds and day/night lighting. Rendering is decoupled from simulation and
// only reads game state.
import { TILE, DAY_TICKS } from '../core/constants.js';
import { BUILDINGS } from '../data/buildings.js';
import { TRIBES } from '../data/tribes.js';
import { BIOMES, B, isWater } from '../world/biomes.js';
import { hash2 } from '../core/rng.js';
import { TerrainCache, CH, treeTypeFor } from './terrain.js';
import { personSprite, treeSprite, buildingSprite, scaffoldSprite, glowSprite, cloudSprite, animalSprite, resColor, buildingPad } from './sprites.js';
import { ageYears } from '../sim/agents.js';
import { Lighting } from './lighting.js';
import { WORK_AGE } from '../core/constants.js';

export class Camera {
  constructor() { this.x = 0; this.y = 0; this.zoom = 3; this.tz = 3; this.tx = null; this.ty = null; this.vx = 0; this.vy = 0; }
}

export class Renderer {
  constructor(cv) {
    this.cv = cv; this.ctx = cv.getContext('2d', { alpha: false });
    this.cam = new Camera();
    this.game = null; this.terrain = null;
    this.time = 0;
    this.settings = { particles: true, quality: 'high', animations: true, territory: true, uiScale: 1, lighting: true };
    this.lighting = new Lighting();
    this.critters = [];
    this.particles = [];
    this.clouds = [];
    this.hover = null;
    this.ghost = null;
    this.dpr = 1;
    this.minimap = null;
    this.miniDirty = true;
    this.lastMini = 0;
  }

  setGame(game) {
    this.game = game;
    this.terrain = new TerrainCache(game.world, game.seed);
    this.critters = []; this.particles = [];
    const w = game.world;
    this.clouds = [];
    for (let i = 0; i < Math.round(w.n / 3500); i++) this.clouds.push({ x: hash2(i, 1, game.seed) * w.w * TILE, y: hash2(i, 2, game.seed) * w.h * TILE, s: i % 6, v: 2 + hash2(i, 3, game.seed) * 3 });
    this.unsub?.();
    const offs = [game.bus.on('territory', () => { this.terrain.markAllTerritory(); this.miniDirty = true; })];
    this.unsub = () => offs.forEach(f => f());
    this.miniDirty = true;
  }

  resize() {
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    this.dpr = dpr;
    const r = this.cv.getBoundingClientRect();
    this.cv.width = Math.max(1, Math.round(r.width * dpr)); this.cv.height = Math.max(1, Math.round(r.height * dpr));
    this.ctx = this.cv.getContext('2d', { alpha: false });
  }

  get scale() { return this.cam.zoom * this.dpr; }
  screenToWorld(sx, sy) {
    const s = this.scale;
    const wx = (sx * this.dpr - this.cv.width / 2) / s + this.cam.x;
    const wy = (sy * this.dpr - this.cv.height / 2) / s + this.cam.y;
    return { x: wx / TILE, y: wy / TILE };
  }
  centerOn(tx, ty, zoom) { this.cam.x = tx * TILE; this.cam.y = ty * TILE; if (zoom) { this.cam.zoom = this.cam.tz = zoom; } }
  flyTo(tx, ty, zoom) { this.cam.tx = tx * TILE; this.cam.ty = ty * TILE; if (zoom) this.cam.tz = zoom; }
  minZoom() { const w = this.game.world; return Math.max(0.35, Math.min(this.cv.width / (w.w * TILE), this.cv.height / (w.h * TILE)) / this.dpr * 0.95); }
  zoomAt(sx, sy, factor) {
    const before = this.screenToWorld(sx, sy);
    this.cam.tz = Math.max(this.minZoom(), Math.min(9, this.cam.tz * factor));
    this.cam.zoom = this.cam.tz;
    const after = this.screenToWorld(sx, sy);
    this.cam.x += (before.x - after.x) * TILE; this.cam.y += (before.y - after.y) * TILE;
  }

  updateCamera(dt) {
    const c = this.cam;
    if (c.tx != null) {
      const k = 1 - Math.pow(0.002, dt);
      c.x += (c.tx - c.x) * k; c.y += (c.ty - c.y) * k;
      if (Math.hypot(c.tx - c.x, c.ty - c.y) < 0.5) { c.tx = c.ty = null; }
    }
    if (Math.abs(c.tz - c.zoom) > 0.001) c.zoom += (c.tz - c.zoom) * (1 - Math.pow(0.001, dt));
    c.x += c.vx * dt; c.y += c.vy * dt; c.vx *= Math.pow(0.02, dt); c.vy *= Math.pow(0.02, dt);
    const w = this.game.world;
    const vw = this.cv.width / this.scale, vh = this.cv.height / this.scale;
    const W = w.w * TILE, H = w.h * TILE;
    c.x = vw >= W ? W / 2 : Math.max(vw / 2 - 40, Math.min(W - vw / 2 + 40, c.x));
    c.y = vh >= H ? H / 2 : Math.max(vh / 2 - 40, Math.min(H - vh / 2 + 40, c.y));
  }

  // ---------------------------------------------------------------- frame
  frame(dt) {
    const g = this.game; if (!g) return;
    this.time += dt;
    this.updateCamera(dt);
    for (const d of g.dirtyTiles) this.terrain.markTiles(...d);
    if (g.dirtyTiles.length) this.miniDirty = true;
    g.dirtyTiles.length = 0;
    const ctx = this.ctx, cv = this.cv, s = this.scale;
    ctx.imageSmoothingEnabled = false;
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.fillStyle = '#1b4597'; ctx.fillRect(0, 0, cv.width, cv.height);
    let shx = 0, shy = 0;
    if (g.shake > 0) { g.shake -= dt; shx = (Math.random() - 0.5) * 6 * g.shake; shy = (Math.random() - 0.5) * 6 * g.shake; }
    const ox = Math.round(cv.width / 2 - this.cam.x * s + shx), oy = Math.round(cv.height / 2 - this.cam.y * s + shy);
    ctx.setTransform(s, 0, 0, s, ox, oy);
    this._s = s; this._ox = ox; this._oy = oy;
    const vx0 = -ox / s, vy0 = -oy / s, vx1 = vx0 + cv.width / s, vy1 = vy0 + cv.height / s;
    this.view = { x0: vx0, y0: vy0, x1: vx1, y1: vy1 };
    g.view = { x0: vx0 / TILE - 6, y0: vy0 / TILE - 6, x1: vx1 / TILE + 6, y1: vy1 / TILE + 6 };
    const z = this.cam.zoom;
    const detailed = z >= 2.0;

    // terrain chunks
    const cs = CH * TILE;
    const cx0 = Math.max(0, Math.floor(vx0 / cs)), cy0 = Math.max(0, Math.floor(vy0 / cs));
    const cx1 = Math.min(this.terrain.cw - 1, Math.floor(vx1 / cs)), cy1 = Math.min(this.terrain.chh - 1, Math.floor(vy1 / cs));
    for (let cy = cy0; cy <= cy1; cy++) for (let cx = cx0; cx <= cx1; cx++) {
      const img = detailed ? this.terrain.ground(cx, cy) : this.terrain.withTrees(cx, cy);
      ctx.drawImage(img, cx * cs, cy * cs);
    }
    this.drawWaterFx(ctx, vx0, vy0, vx1, vy1, z);
    if (this.settings.territory) {
      ctx.globalAlpha = z < 1.2 ? 1 : 0.85;
      for (let cy = cy0; cy <= cy1; cy++) for (let cx = cx0; cx <= cx1; cx++) ctx.drawImage(this.terrain.territory(cx, cy), cx * cs, cy * cs);
      ctx.globalAlpha = 1;
    }
    this.drawCloudShadows(ctx, dt);
    this.drawObjects(ctx, vx0, vy0, vx1, vy1, z, detailed, dt);
    this.drawFx(ctx, dt, z);
    this.drawOverlays(ctx, z);
    this.drawClouds(ctx, z);
    // screen-space passes
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    this.drawLighting(ctx, s, ox, oy, vx0, vy0, vx1, vy1);
    this.drawWeather(ctx, dt);
    if (this.miniDirty && this.time - this.lastMini > 1.5) this.renderMinimap();
  }

  drawWaterFx(ctx, vx0, vy0, vx1, vy1, z) {
    if (z < 1.6 || !this.settings.animations || this.settings.quality === 'low') return;
    const w = this.game.world, t = this.time;
    const tx0 = Math.max(0, Math.floor(vx0 / TILE)), ty0 = Math.max(0, Math.floor(vy0 / TILE));
    const tx1 = Math.min(w.w - 1, Math.ceil(vx1 / TILE)), ty1 = Math.min(w.h - 1, Math.ceil(vy1 / TILE));
    ctx.fillStyle = 'rgba(220,240,255,0.55)';
    for (let y = ty0; y <= ty1; y++) for (let x = tx0; x <= tx1; x++) {
      const i = y * w.w + x; const b = w.biome[i];
      if (!isWater(b)) continue;
      const h = hash2(x, y, 99);
      const phase = (t * (b === B.RIVER ? 1.6 : 0.6) + h * 10) % 4;
      if (phase < 1.1) {
        const px = x * TILE + ((h * 37) % 6 | 0) + (b === B.RIVER ? (phase * 3) | 0 : 0), py = y * TILE + ((h * 91) % 7 | 0);
        ctx.fillRect(px, py, phase < 0.5 ? 2 : 1, 1);
      }
    }
  }

  drawObjects(ctx, vx0, vy0, vx1, vy1, z, detailed, dt) {
    const g = this.game, w = g.world, t = this.time;
    const items = [];
    const season = g.season;
    // trees (animated, detailed view)
    if (detailed) {
      const tx0 = Math.max(0, Math.floor(vx0 / TILE) - 1), ty0 = Math.max(0, Math.floor(vy0 / TILE) - 1);
      const tx1 = Math.min(w.w - 1, Math.ceil(vx1 / TILE) + 1), ty1 = Math.min(w.h - 1, Math.ceil(vy1 / TILE) + 2);
      const wind = Math.sin(t * 0.7) * 0.5 + 0.5;
      const autumn = season === 2 ? 1 : 0, snowy = season === 3;
      for (let y = ty0; y <= ty1; y++) for (let x = tx0; x <= tx1; x++) {
        const i = y * w.w + x; if (w.trees[i] < 20 || w.occ[i]) continue;
        const type = treeTypeFor(w, i);
        const h = hash2(x, y, 5);
        const frame = this.settings.animations && Math.sin(t * 2.2 + h * 20 + x * 0.3) > 0.55 - wind * 0.4 ? 1 : 0;
        const small = w.trees[i] < w.treeMax[i] * 0.5;
        items.push({ y: y * TILE + 7, k: 0, spr: treeSprite(type, (h * 4) | 0, frame, autumn && h > 0.3 ? (h > 0.7 ? 2 : 1) : 0, snowy && (BIOMES[w.biome[i]].key !== 'desert')), x: x * TILE - 1 + ((h * 3) | 0), yy: y * TILE - 6 + ((hash2(x, y, 6) * 2) | 0), small });
      }
    }
    // buildings
    for (const b of g.buildings.values()) {
      const bx = b.x * TILE, by = b.y * TILE, sz = b.size * TILE;
      if (bx > vx1 || bx + sz < vx0 || by - 30 > vy1 || by + sz < vy0) continue;
      items.push({ y: by + sz - 1, k: 1, b });
    }
    // agents (below 0.9 zoom nobody is drawn at all; hidden ones are inside buildings and counted on the door)
    this.inside = new Map();
    if (z >= 0.9) {
      for (const a of g.agents.values()) {
        if (a.hidden) { if (a.inB && z >= 1.6) this.inside.set(a.inB, (this.inside.get(a.inB) || 0) + 1); continue; }
        const ax = a.x * TILE, ay = a.y * TILE;
        if (ax < vx0 - 8 || ax > vx1 + 8 || ay < vy0 - 8 || ay > vy1 + 12) continue;
        items.push({ y: ay, k: 2, a });
      }
    }
    // critters
    if (detailed && this.settings.quality !== 'low') { this.updateCritters(dt, vx0, vy0, vx1, vy1); for (const c of this.critters) items.push({ y: c.y * TILE, k: 3, c }); }
    items.sort((p, q) => p.y - q.y);
    const tier = id => g.tribes[id].stage;
    // dynamic sun shadows (smooth, drawn under the sprites)
    if (this.settings.lighting && this.settings.quality !== 'low' && z >= 1.2) {
      const sh = [];
      for (const it of items) {
        if (it.k === 0) { if (!it.small) sh.push({ spr: it.spr, x: it.x, y: it.yy - 1 }); }
        else if (it.k === 1) { const b = it.b, def = BUILDINGS[b.type]; if (!b.built || def.field || b.type === 'training') continue; const spr = buildingSprite(b.type, TRIBES[b.tribe].key, { tier: tier(b.tribe), season, size: b.size, field: false }); sh.push({ spr, x: b.x * TILE - 1, y: (b.y + b.size) * TILE - spr.height }); }
        else if (it.k === 2 && z >= 1.8) { const a = it.a; const child = ageYears(a) < WORK_AGE; sh.push({ spr: personSprite(TRIBES[a.tribe].key, child ? 'idle' : a.job, 0, a.female, child, a.look, null, tier(a.tribe), a.facing < 0), x: a.x * TILE - 4.5, y: a.y * TILE - 12 }); }
      }
      const dim = g.weather?.kind === 'rain' || g.weather?.kind === 'snow' ? 0.45 : 1;
      this.lighting.drawShadows(ctx, sh, this._s, this._ox, this._oy, g.dayFrac, dim);
      ctx.setTransform(this._s, 0, 0, this._s, this._ox, this._oy);
    }
    const sel = g.selected;
    for (const it of items) {
      if (it.k === 0) {
        if (it.small) ctx.drawImage(it.spr, 0, 0, 10, 13, it.x + 2, it.yy + 3, 7, 10);
        else ctx.drawImage(it.spr, it.x, it.yy);
      } else if (it.k === 1) this.drawBuilding(ctx, it.b, tier(it.b.tribe), season, sel);
      else if (it.k === 2) this.drawAgent(ctx, it.a, z, sel);
      else if (it.k === 3) { const c = it.c; ctx.drawImage(animalSprite(c.kind, ((t * 4 + c.seed) | 0) % 2), c.x * TILE - 3, c.y * TILE - 5); }
    }
  }

  drawBuilding(ctx, b, tier, season, sel) {
    const def = BUILDINGS[b.type]; const tribe = TRIBES[b.tribe];
    const spr = buildingSprite(b.type, tribe.key, { tier, season, size: b.size, field: !!def.field });
    const x = b.x * TILE - 1, y = (b.y + b.size) * TILE - spr.height + 1;
    if (!b.built) {
      const frac = Math.max(0, Math.min(1, b.progress / (def.work || 30)));
      const sc = scaffoldSprite(b.size, buildingPad(b.type));
      if (frac > 0.02) {
        const hpx = Math.max(1, Math.round(spr.height * (0.15 + frac * 0.85)));
        ctx.globalAlpha = 0.9; ctx.drawImage(spr, 0, spr.height - hpx, spr.width, hpx, x, y + spr.height - hpx, spr.width, hpx); ctx.globalAlpha = 1;
      }
      ctx.drawImage(sc, x, (b.y + b.size) * TILE - sc.height);
      // progress bar
      ctx.fillStyle = 'rgba(0,0,0,0.6)'; ctx.fillRect(x + 1, (b.y + b.size) * TILE + 1, b.size * TILE - 2, 2);
      ctx.fillStyle = '#f2c84b'; ctx.fillRect(x + 1, (b.y + b.size) * TILE + 1, (b.size * TILE - 2) * frac, 2);
    } else {
      ctx.drawImage(spr, x, y);
      if (b.hp < b.maxHp * 0.5 && Math.random() < 0.08 && this.settings.particles) this.particles.push({ k: 'smoke', x: x + Math.random() * b.size * TILE, y: y + spr.height * 0.4, vx: 0.5, vy: -4, t: 0, life: 2, dark: true });
      if ((def.smoke || b.type === 'centre' || def.housing) && this.settings.particles && !this.game.speed === false) {
        const rate = def.smoke ? 0.05 : b.type === 'centre' ? 0.04 : 0.006;
        if (Math.random() < rate) {
          const sxp = b.type === 'centre' ? x + b.size * TILE - 6 : def.smoke ? x + b.size * TILE - 4 : x + b.size * TILE / 2;
          this.particles.push({ k: 'smoke', x: sxp, y: y + (def.smoke ? 2 : buildingPad(b.type) - 2), vx: 1.5, vy: -5, t: 0, life: 3 });
        }
      }
    }
    const n = b.built && this.inside?.get(b.id + 1);
    if (n) { ctx.fillStyle = tribe.color; for (let k = 0; k < Math.min(n, 6); k++) ctx.fillRect(x + 2 + k * 3, y - 2, 2, 2); }
    if (sel && sel.kind === 'building' && sel.id === b.id) {
      ctx.strokeStyle = '#ffe9a8'; ctx.lineWidth = 1 / this.cam.zoom * 1.5;
      ctx.strokeRect(b.x * TILE - 0.5, b.y * TILE - 0.5, b.size * TILE + 1, b.size * TILE + 1);
      const d = def.prod?.radius;
      if (d) { ctx.strokeStyle = 'rgba(255,233,168,0.4)'; ctx.beginPath(); ctx.arc((b.x + b.size / 2) * TILE, (b.y + b.size / 2) * TILE, d * TILE, 0, Math.PI * 2); ctx.stroke(); }
    }
  }

  drawAgent(ctx, a, z, sel) {
    const tribe = TRIBES[a.tribe];
    const ax = a.x * TILE, ay = a.y * TILE;
    if (z < 1.6) { ctx.fillStyle = tribe.color; ctx.fillRect(ax - 1, ay - 3, 2, 3); return; }
    const t = this.time;
    const child = ageYears(a) < WORK_AGE;
    let frame = 0;
    if (a.moving) frame = 1 + (((t * 7 + a.id) | 0) % 2);
    else if (a.state === 'work' || a.state === 'build' || (a.state === 'fight' && a.anim === 'attack')) frame = ((t * 4 + a.id) | 0) % 2 ? 3 : 0;
    const carry = a.carry ? Object.keys(a.carry)[0] : null;
    const spr = personSprite(tribe.key, child ? 'idle' : a.job, frame, a.female, child, a.look, carry, this.game.tribes[a.tribe].stage, a.facing < 0);
    // shadow
    ctx.fillStyle = 'rgba(0,0,0,0.25)'; ctx.fillRect(ax - 2, ay - 0.5, 4, 1);
    ctx.drawImage(spr, Math.round(ax - 4.5), Math.round(ay - 11));
    if (a.bubble > 0 && z > 2.5) { ctx.fillStyle = '#fff'; ctx.fillRect(ax + 1, ay - 15, 4, 3); ctx.fillRect(ax + 2, ay - 12, 1, 1); ctx.fillStyle = '#7a7a8a'; ctx.fillRect(ax + 2, ay - 14, 1, 1); ctx.fillRect(ax + 4, ay - 14, 1, 1); }
    if (a.army && z > 2) { ctx.fillStyle = tribe.color; ctx.fillRect(ax - 0.5, ay - 14, 1, 2); }
    if (a.hp < 20 && a.job === 'soldier') { ctx.fillStyle = '#300'; ctx.fillRect(ax - 2, ay - 13, 4, 1); ctx.fillStyle = '#e44'; ctx.fillRect(ax - 2, ay - 13, 4 * Math.max(0, a.hp) / 30, 1); }
    if (sel && sel.kind === 'agent' && sel.id === a.id) {
      ctx.strokeStyle = '#ffe9a8'; ctx.lineWidth = 1 / this.cam.zoom * 1.5;
      ctx.beginPath(); ctx.ellipse(ax, ay, 4, 2, 0, 0, Math.PI * 2); ctx.stroke();
      if (a.path && a.pi < a.path.length) {
        ctx.strokeStyle = 'rgba(255,233,168,0.5)'; ctx.beginPath(); ctx.moveTo(ax, ay);
        const w = this.game.world.w;
        for (let k = a.pi; k < a.path.length; k++) { const i = a.path[k]; ctx.lineTo((i % w + 0.5) * TILE, (((i / w) | 0) + 0.5) * TILE); }
        ctx.stroke();
      }
    }
  }

  updateCritters(dt, vx0, vy0, vx1, vy1) {
    const g = this.game, w = g.world;
    const inView = c => c.x * TILE > vx0 - 40 && c.x * TILE < vx1 + 40 && c.y * TILE > vy0 - 40 && c.y * TILE < vy1 + 40;
    this.critters = this.critters.filter(inView);
    let tries = 0;
    while (this.critters.length < 24 && tries++ < 30) {
      const x = vx0 / TILE + Math.random() * (vx1 - vx0) / TILE, y = vy0 / TILE + Math.random() * (vy1 - vy0) / TILE;
      if (!w.inb(x | 0, y | 0)) continue;
      const i = w.idx(x | 0, y | 0); const b = w.biome[i];
      if (isWater(b)) { if (w.fauna[i] > 120 && Math.random() < 0.3) this.critters.push({ kind: 'fish', x, y, vx: 0, vy: 0, t: 0, seed: Math.random() * 10, life: 1.2, jump: true }); continue; }
      const o = w.occ[i];
      if (o) { const bb = g.buildings.get(o - 1); if (bb?.type === 'pasture' && bb.built) this.critters.push({ kind: Math.random() < 0.6 ? 'sheep' : 'cow', x, y, vx: 0, vy: 0, t: 0, seed: Math.random() * 10, home: bb }); continue; }
      if (w.fauna[i] > 90 && w.owner[i] < 0 && BIOMES[b].game) this.critters.push({ kind: 'deer', x, y, vx: 0, vy: 0, t: 0, seed: Math.random() * 10 });
      else if (Math.random() < 0.08) this.critters.push({ kind: 'bird', x, y, vx: (Math.random() - 0.5) * 6, vy: -1 - Math.random(), t: 0, seed: Math.random() * 10, fly: true, life: 6 });
    }
    for (const c of this.critters) {
      c.t += dt;
      if (c.fly) { c.x += c.vx * dt; c.y += c.vy * dt; continue; }
      if (c.jump) continue;
      if (Math.random() < dt * 0.5) { const a = Math.random() * Math.PI * 2; const sp = c.kind === 'deer' ? 1.2 : 0.4; c.vx = Math.cos(a) * sp; c.vy = Math.sin(a) * sp; if (Math.random() < 0.5) c.vx = c.vy = 0; }
      const nx = c.x + c.vx * dt, ny = c.y + c.vy * dt;
      if (w.inb(nx | 0, ny | 0) && !isWater(w.biome[w.idx(nx | 0, ny | 0)]) && (!c.home || (nx >= c.home.x + 0.3 && nx < c.home.x + c.home.size - 0.3 && ny >= c.home.y + 0.5 && ny < c.home.y + c.home.size - 0.3))) { c.x = nx; c.y = ny; } else { c.vx = -c.vx; c.vy = -c.vy; }
    }
    this.critters = this.critters.filter(c => !c.life || c.t < c.life);
  }

  drawFx(ctx, dt, z) {
    const g = this.game, t = this.time;
    const gdt = dt * Math.max(1, [0, 1, 3, 8][g.speed] || 1) * (g.speed === 0 ? 0 : 1);
    for (const f of g.fx) f.t += gdt || 0;
    g.fx = g.fx.filter(f => f.t < f.life);
    for (const f of g.fx) {
      if (f.t < 0) continue;
      const p = f.t / f.life, X = f.x * TILE, Y = f.y * TILE;
      switch (f.kind) {
        case 'pop': if (z > 2) { ctx.globalAlpha = 1 - p; ctx.fillStyle = resColor(f.res); ctx.fillRect(X - 1, Y * 1 - 8 - p * 6, 3, 3); ctx.fillStyle = 'rgba(255,255,255,0.7)'; ctx.fillRect(X - 1, Y - 8 - p * 6, 1, 1); ctx.globalAlpha = 1; } break;
        case 'chip': ctx.fillStyle = '#c8a070'; ctx.fillRect(X + p * 3, Y - 2 - Math.sin(p * 3) * 3, 1, 1); break;
        case 'spark': ctx.fillStyle = p < 0.5 ? '#fff4b0' : '#f0a040'; ctx.fillRect(X + (p - 0.5) * 4, Y - 4 - p * 3, 1, 1); break;
        case 'fall': ctx.globalAlpha = 1 - p; ctx.fillStyle = '#c8b090'; for (let k = 0; k < 5; k++) ctx.fillRect(X + Math.cos(k * 1.3) * p * 5, Y - 2 + Math.sin(k * 1.3) * p * 2, 1, 1); ctx.globalAlpha = 1; break;
        case 'dust': ctx.globalAlpha = (1 - p) * 0.7; ctx.fillStyle = '#9a8a74'; for (let k = 0; k < 10; k++) ctx.fillRect(X + Math.cos(k) * p * f.size * 8, Y + Math.sin(k) * p * f.size * 4 - p * 6, 2, 2); ctx.globalAlpha = 1; break;
        case 'glyph': ctx.globalAlpha = 1 - p; ctx.fillStyle = TRIBES[f.tribe]?.pal.light || '#fff'; ctx.fillRect(X, Y - 4 - p * 10, 1, 3); ctx.fillRect(X - 1, Y - 3 - p * 10, 3, 1); ctx.globalAlpha = 1; break;
        case 'hit': ctx.fillStyle = p < 0.5 ? '#fff' : '#e04040'; ctx.fillRect(X - 1, Y - 6, 2, 2); break;
        case 'fallen': ctx.globalAlpha = 1 - p * p; ctx.fillStyle = '#8a7a6a'; ctx.fillRect(X - 0.5, Y - 4, 1, 4); ctx.fillRect(X - 1.5, Y - 3, 3, 1); ctx.globalAlpha = 1; break;
        case 'arrow': { const ax = X + (f.tx * TILE - X) * p, ay = Y + (f.ty * TILE - Y) * p - Math.sin(p * Math.PI) * 6; ctx.fillStyle = '#3a2a1a'; ctx.fillRect(ax - 1, ay, 2, 1); break; }
        case 'fire': if (Math.random() < 0.6 && this.settings.particles) this.particles.push({ k: 'flame', x: X + (Math.random() - 0.5) * 6, y: Y - 1, vx: 0, vy: -8, t: 0, life: 0.6 }); break;
        case 'ping': { ctx.strokeStyle = `rgba(255,236,160,${1 - p})`; ctx.lineWidth = 1; ctx.beginPath(); ctx.arc(X, Y, 4 + p * 30, 0, Math.PI * 2); ctx.stroke(); break; }
        case 'caravan': { const cxp = X + (f.tx * TILE - X) * p, cyp = Y + (f.ty * TILE - Y) * p; if (z < 2.5) { ctx.fillStyle = TRIBES[f.tribe].color; ctx.fillRect(cxp - 1.5, cyp - 1.5, 3, 3); ctx.fillStyle = '#e8d0a0'; ctx.fillRect(cxp - 0.5, cyp - 2.5, 1, 1); } break; }
        case 'unlock': { ctx.strokeStyle = `rgba(255,220,120,${1 - p})`; ctx.lineWidth = 2; ctx.beginPath(); ctx.arc(X, Y, 6 + p * 40, 0, Math.PI * 2); ctx.stroke(); break; }
      }
    }
    // renderer particles (smoke, flames, ambience)
    if (this.settings.particles) {
      const night = this.darkness() > 0.4;
      if (night && z > 1.5 && Math.random() < 0.3 && this.view) this.particles.push({ k: 'firefly', x: this.view.x0 + Math.random() * (this.view.x1 - this.view.x0), y: this.view.y0 + Math.random() * (this.view.y1 - this.view.y0), vx: (Math.random() - 0.5) * 3, vy: (Math.random() - 0.5) * 3, t: 0, life: 4 });
      if (g.season === 2 && z > 2 && Math.random() < 0.25 && this.view) this.particles.push({ k: 'leaf', x: this.view.x0 + Math.random() * (this.view.x1 - this.view.x0), y: this.view.y0, vx: 3 + Math.random() * 4, vy: 6 + Math.random() * 4, t: 0, life: 8 });
    }
    for (const q of this.particles) {
      q.t += dt; q.x += q.vx * dt; q.y += q.vy * dt;
      const p = q.t / q.life;
      if (q.k === 'smoke') { ctx.globalAlpha = (1 - p) * 0.45; ctx.fillStyle = q.dark ? '#3a3330' : '#d8d4cc'; const r = 1 + p * 2.5; ctx.fillRect(q.x + Math.sin(q.t * 2 + q.y) * 1.5, q.y, r, r); }
      else if (q.k === 'flame') { ctx.globalAlpha = 1 - p; ctx.fillStyle = p < 0.3 ? '#fff0a0' : p < 0.6 ? '#f8a030' : '#c04020'; ctx.fillRect(q.x, q.y, 1.5, 1.5); }
      else if (q.k === 'firefly') { ctx.globalAlpha = 0.5 + 0.5 * Math.sin(q.t * 6); ctx.fillStyle = '#e8ff90'; ctx.fillRect(q.x, q.y, 1, 1); q.vx += (Math.random() - 0.5) * 2 * dt; q.vy += (Math.random() - 0.5) * 2 * dt; }
      else if (q.k === 'leaf') { ctx.globalAlpha = 1 - p; ctx.fillStyle = (q.x | 0) % 2 ? '#d88a2a' : '#c05a20'; ctx.fillRect(q.x + Math.sin(q.t * 3) * 3, q.y, 1, 1); }
    }
    ctx.globalAlpha = 1;
    this.particles = this.particles.filter(q => q.t < q.life);
    if (this.particles.length > 1500) this.particles.splice(0, this.particles.length - 1500);
  }

  drawOverlays(ctx, z) {
    const g = this.game;
    if (this.hover && !this.ghost && z > 1.5) {
      ctx.strokeStyle = 'rgba(255,255,255,0.35)'; ctx.lineWidth = 1 / this.cam.zoom;
      ctx.strokeRect((this.hover.x | 0) * TILE, (this.hover.y | 0) * TILE, TILE, TILE);
    }
    if (this.ghost) {
      const gh = this.ghost; const def = BUILDINGS[gh.type];
      const x = gh.x * TILE, y = gh.y * TILE, sz = (def?.size || 3) * TILE;
      if (gh.type === '__settle') {
        ctx.strokeStyle = gh.ok ? 'rgba(140,255,140,0.9)' : 'rgba(255,90,90,0.9)'; ctx.lineWidth = 1 / this.cam.zoom * 2;
        ctx.beginPath(); ctx.arc((gh.x + 0.5) * TILE, (gh.y + 0.5) * TILE, 9 * TILE, 0, Math.PI * 2); ctx.stroke();
        ctx.fillStyle = gh.ok ? 'rgba(140,255,140,0.2)' : 'rgba(255,90,90,0.25)'; ctx.fillRect((gh.x - 2) * TILE, (gh.y - 2) * TILE, 5 * TILE, 5 * TILE);
        return;
      }
      const spr = buildingSprite(gh.type, g.player.key, { tier: g.player.stage, season: g.season, size: def.size, field: !!def.field });
      ctx.globalAlpha = 0.7; ctx.drawImage(spr, x - 1, y + sz - spr.height + 1); ctx.globalAlpha = 1;
      ctx.fillStyle = gh.ok ? 'rgba(120,255,140,0.28)' : 'rgba(255,80,80,0.35)'; ctx.fillRect(x, y, sz, sz);
      ctx.strokeStyle = gh.ok ? 'rgba(160,255,170,0.9)' : 'rgba(255,120,120,0.9)'; ctx.lineWidth = 1 / this.cam.zoom; ctx.strokeRect(x, y, sz, sz);
      const r = def.prod?.radius; if (r) { ctx.strokeStyle = 'rgba(255,240,180,0.45)'; ctx.beginPath(); ctx.arc(x + sz / 2, y + sz / 2, r * TILE, 0, Math.PI * 2); ctx.stroke(); }
    }
    // army banners at low zoom
    if (z < 2.5) for (const ar of g.armies) {
      let sx = 0, sy = 0, n = 0; for (const a of g.agents.values()) if (a.army === ar.id) { sx += a.x; sy += a.y; n++; }
      if (!n) continue;
      const X = sx / n * TILE, Y = sy / n * TILE;
      ctx.fillStyle = '#2a1e18'; ctx.fillRect(X, Y - 14, 1, 14);
      ctx.fillStyle = TRIBES[ar.tribe].color; ctx.fillRect(X + 1, Y - 14, 7, 5);
      ctx.fillStyle = '#fff'; ctx.font = '5px monospace'; ctx.fillText(String(n), X + 2, Y - 10);
    }
  }

  drawCloudShadows(ctx, dt) {
    const g = this.game, w = g.world;
    for (const c of this.clouds) { c.x += c.v * dt * 3; if (c.x > w.w * TILE + 80) c.x = -80; }
    if (this.cam.zoom > 3.5 || this.settings.quality === 'low') return;
    ctx.globalAlpha = 0.18;
    for (const c of this.clouds) { const spr = cloudSprite(c.s); ctx.filter = 'none'; ctx.fillStyle = '#000'; ctx.drawImage(spr, c.x + 14, c.y + 22); }
    ctx.globalAlpha = 1;
  }
  drawClouds(ctx, z) {
    const a = Math.max(0, Math.min(0.9, (3.2 - z) / 2));
    if (a <= 0.02) return;
    ctx.globalAlpha = a;
    for (const c of this.clouds) ctx.drawImage(cloudSprite(c.s), c.x, c.y);
    ctx.globalAlpha = 1;
  }

  darkness() {
    const f = this.game.dayFrac;
    if (f < 0.06) return 0.75 - f / 0.06 * 0.25;
    if (f < 0.13) return 0.5 * (1 - (f - 0.06) / 0.07);
    if (f < 0.74) return 0;
    if (f < 0.84) return ((f - 0.74) / 0.1) * 0.75;
    return 0.75;
  }

  drawLighting(ctx, s, ox, oy, vx0, vy0, vx1, vy1) {
    const g = this.game, cv = this.cv;
    const d = this.darkness();
    const f = g.dayFrac;
    // dusk & dawn warmth
    const warm = f > 0.68 && f < 0.82 ? Math.sin((f - 0.68) / 0.14 * Math.PI) : f > 0.04 && f < 0.15 ? Math.sin((f - 0.04) / 0.11 * Math.PI) * 0.7 : 0;
    if (warm > 0.01) { ctx.globalCompositeOperation = 'soft-light'; ctx.fillStyle = `rgba(255,140,60,${warm * 0.45})`; ctx.fillRect(0, 0, cv.width, cv.height); }
    if (g.season === 3) { ctx.globalCompositeOperation = 'screen'; ctx.fillStyle = 'rgba(160,190,230,0.10)'; ctx.fillRect(0, 0, cv.width, cv.height); }
    if (g.weather?.kind === 'drought') { ctx.globalCompositeOperation = 'soft-light'; ctx.fillStyle = 'rgba(255,200,80,0.25)'; ctx.fillRect(0, 0, cv.width, cv.height); }
    if (g.weather?.kind === 'rain') { ctx.globalCompositeOperation = 'multiply'; ctx.fillStyle = 'rgb(205,212,228)'; ctx.fillRect(0, 0, cv.width, cv.height); }
    if (d > 0.01 && this.settings.lighting && this.settings.quality !== 'low') {
      // ray-cast lightmap: lights add into a dark buffer, buildings cast shadows
      ctx.globalCompositeOperation = 'source-over';
      const { lights, occ } = this.lighting.collect(g, { x0: vx0, y0: vy0, x1: vx1, y1: vy1 }, s, ox, oy, this.time, this.cam.zoom >= 1.6);
      this.lighting.drawLightmap(ctx, lights, occ, d);
    } else if (d > 0.01) {
      ctx.globalCompositeOperation = 'multiply';
      const r = Math.round(255 - d * 200), gg = Math.round(255 - d * 185), b = Math.round(255 - d * 120);
      ctx.fillStyle = `rgb(${r},${gg},${b})`; ctx.fillRect(0, 0, cv.width, cv.height);
      // warm window and hearth glows
      ctx.globalCompositeOperation = 'lighter';
      const glow = glowSprite('255,190,110', 16), hearth = glowSprite('255,150,60', 32), crystal = glowSprite('200,150,255', 16);
      for (const bd of g.buildings.values()) {
        if (!bd.built) continue;
        const bx = bd.x * TILE, by = bd.y * TILE, sz = bd.size * TILE;
        if (bx > vx1 || bx + sz < vx0 || by > vy1 || by + sz < vy0) continue;
        const def = BUILDINGS[bd.type];
        const sx = (bx + sz / 2) * s + ox, sy = (by + sz * 0.6) * s + oy;
        const k = s * d;
        if (bd.type === 'centre') { const w = 64 * k; ctx.globalAlpha = 0.9 + Math.sin(this.time * 9) * 0.1; ctx.drawImage(hearth, sx - w / 2 + 3 * s, sy - w / 2, w, w); }
        else if (def.housing || def.job || def.tower) { if (hash2(bd.id, (this.time / 6) | 0, 3) > 0.25) { const w = 26 * k; ctx.globalAlpha = 0.8; ctx.drawImage(TRIBES[bd.tribe].key === 'vaelith' ? crystal : glow, sx - w / 2, sy - w / 2, w, w); } }
      }
      ctx.globalAlpha = 1;
    }
    ctx.globalCompositeOperation = 'source-over';
  }

  drawWeather(ctx, dt) {
    const g = this.game, cv = this.cv;
    const wk = g.weather?.kind;
    if (!this.settings.particles) return;
    this.rain = this.rain || [];
    if (wk === 'rain' || wk === 'snow') {
      const want = wk === 'rain' ? 260 : 180;
      while (this.rain.length < want) this.rain.push({ x: Math.random() * cv.width, y: Math.random() * cv.height, v: 0.6 + Math.random() * 0.6 });
    } else if (this.rain.length) this.rain.length = Math.max(0, this.rain.length - 10);
    if (!this.rain.length) return;
    ctx.fillStyle = wk === 'snow' ? 'rgba(255,255,255,0.85)' : 'rgba(190,210,240,0.55)';
    const sp = wk === 'snow' ? 60 : 700;
    for (const r of this.rain) {
      r.y += sp * r.v * dt * this.dpr; r.x += (wk === 'snow' ? Math.sin(r.y * 0.02) * 20 : 120) * dt * this.dpr;
      if (r.y > cv.height) { r.y = -5; r.x = Math.random() * cv.width; }
      if (r.x > cv.width) r.x -= cv.width;
      if (wk === 'snow') ctx.fillRect(r.x, r.y, 2 * this.dpr, 2 * this.dpr);
      else ctx.fillRect(r.x, r.y, 1 * this.dpr, 7 * this.dpr);
    }
  }

  // ---------------------------------------------------------------- minimap
  renderMinimap() {
    const g = this.game; const w = g.world;
    if (!this.minimap) { this.minimap = document.createElement('canvas'); }
    const mm = this.minimap; mm.width = w.w; mm.height = w.h;
    const ctx = mm.getContext('2d'); const img = ctx.createImageData(w.w, w.h); const D = img.data;
    const cols = BIOMES.map(b => hex(b.cols[0]));
    const tcol = TRIBES.map(t => hex(t.color));
    for (let i = 0; i < w.n; i++) {
      let [r, gg, b] = cols[w.biome[i]];
      if (w.trees[i] > 20) { r *= 0.8; gg *= 0.88; b *= 0.8; }
      const o = w.owner[i];
      if (o >= 0) { const c = tcol[o]; const k = isWater(w.biome[i]) ? 0.25 : 0.45; r += (c[0] - r) * k; gg += (c[1] - gg) * k; b += (c[2] - b) * k; }
      if (w.occ[i]) { const bb = g.buildings.get(w.occ[i] - 1); if (bb) { const c = tcol[bb.tribe]; r = c[0] * 0.7 + 60; gg = c[1] * 0.7 + 60; b = c[2] * 0.7 + 60; } }
      if (w.road[i]) { r = 190; gg = 160; b = 120; }
      D[i * 4] = r; D[i * 4 + 1] = gg; D[i * 4 + 2] = b; D[i * 4 + 3] = 255;
    }
    ctx.putImageData(img, 0, 0);
    this.miniDirty = false; this.lastMini = this.time;
  }
}

const _hex = new Map();
function hex(h) { let v = _hex.get(h); if (!v) { const n = parseInt(h.slice(1), 16); v = [(n >> 16) & 255, (n >> 8) & 255, n & 255]; _hex.set(h, v); } return v; }
