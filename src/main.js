// CivSim application controller: screens, main loop, input, autosave.
import './data/registry.js'; // content packs (see docs/MODDING.md)
import { installTheme } from './ui/theme.js';
import { ico } from './ui/icons.js';
import { initTooltips, toast, modalOpen, closeModal, confirmDialog } from './ui/dom.js';
import { Renderer } from './render/renderer.js';
import { SimClient } from './sim/client.js';
import { initAudio, resumeAudio, setVolumes, setAmbience, sfx, setMusicMood } from './audio/audio.js';
import { loadSettings, storeSettings, saveGame, listRuns, loadSlot, latestSlot, slotLabel, clearRecovery } from './save/saves.js';
import { SAVE_VERSION } from './sim/game.js';
import { Hints } from './ui/hints.js';
import { MainMenu } from './ui/menu.js';
import { Hud } from './ui/hud.js';
import { TILE } from './core/constants.js';
import { isWater } from './world/biomes.js';
import { Tutorial, TUTORIAL_WORLD } from './ui/tutorial.js';

class App {
  constructor() {
    this.settings = loadSettings();
    this.cv = document.getElementById('world');
    this.renderer = new Renderer(this.cv);
    this.game = null;
    this.sim = new SimClient();
    this.mode = 'boot';
    this.keys = new Set();
    this.last = performance.now();
    this.autosaveAt = 0;
    this.saving = false;
  }

  async init() {
    installTheme();
    initTooltips();
    this.applySettings();
    if (!this.settings.inputMode) await this.chooseDevice();
    this.renderer.resize();
    addEventListener('resize', () => this.renderer.resize());
    document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'hidden') this.recoverySave(); });
    addEventListener('pagehide', () => this.recoverySave());
    addEventListener('error', () => this.recoverySave());
    addEventListener('unhandledrejection', () => this.recoverySave());
    this.bindInput();
    const unlock = () => { initAudio(); resumeAudio(); setVolumes(this.settings); };
    addEventListener('pointerdown', unlock, { once: false });
    addEventListener('keydown', unlock, { once: false });
    this.menu = new MainMenu(this);
    this.hud = new Hud(this);
    this.hints = new Hints(this);
    await this.showMenu();
    requestAnimationFrame(t => this.loop(t));
    document.getElementById('boot')?.remove();
  }

  applySettings() {
    const s = this.settings;
    document.documentElement.style.setProperty('--ui', s.uiScale);
    document.body.classList.toggle('cb', !!s.colorblind);
    Object.assign(this.renderer.settings, { particles: s.particles, animations: s.animations, territory: s.territory, quality: s.quality, lighting: s.lighting !== false });
    setVolumes(s);
    this.touch = s.inputMode === 'touch';
    document.body.classList.toggle('touch', this.touch);
    storeSettings(s);
  }

  // First launch: ask how the player will control the game.
  chooseDevice() {
    const boot = document.getElementById('boot'); if (boot) boot.style.display = 'none';
    const coarse = matchMedia('(pointer: coarse)').matches;
    const root = document.getElementById('screens');
    const opt = (mode, icon, name, desc, suggested) => `<button class="device-opt ${suggested ? 'suggested' : ''}" data-mode="${mode}">${ico(icon, 'xl')}<span class="device-name">${name}</span><span class="device-desc">${desc}</span>${suggested ? '<span class="chip">Looks like your device</span>' : ''}</button>`;
    const el = document.createElement('div');
    el.className = 'screen device-screen enter';
    el.innerHTML = `<div class="device-box frame"><div class="logo"><div class="word">CivSim</div><div class="sub">A Living World Chronicle</div></div>
      <div class="divider"></div>
      <h1 class="panel-title">What type of device are you on?</h1>
      <div class="device-opts">${opt('touch', 'touch', 'Touch', 'Phone or tablet. Tap, drag and pinch; larger buttons.', coarse)}${opt('keyboard', 'keyboard', 'Keyboard', 'Computer with a mouse or trackpad. Hover tips and shortcuts.', !coarse)}</div>
      <div class="prose" style="text-align:center">You can change this at any time in Settings, under Controls.</div></div>`;
    root.appendChild(el);
    return new Promise(res => el.addEventListener('click', e => {
      const b = e.target.closest('[data-mode]'); if (!b) return;
      this.settings.inputMode = b.dataset.mode; this.applySettings();
      el.remove(); if (boot) boot.style.display = '';
      setTimeout(res, 30);
    }));
  }

  // ---------------------------------------------------------------- screens
  async showMenu() {
    this.mode = 'menu';
    this.hud.hide();
    // a living background world, run entirely by AI
    await this.sim.call('create', { seed: 'menu-' + (Math.random() * 1e6 | 0), size: 'small', observer: true, playerTribe: 0, start: 'bountiful' }, 360 * 6);
    const bg = this.sim.mirror;
    this.game = bg; this.sim.setSpeed(2); this.sim.setHold(false);
    this.renderer.setGame(bg);
    this.menuTour();
    setMusicMood('menu');
    await this.menu.show();
  }

  menuTour() {
    const g = this.game; const t = g.tribes[(Math.random() * 4) | 0]; const s = g.settlements.get(t.capital);
    this.renderer.centerOn(s.x + 4, s.y + 1, 3.6);
    this.tour = { t: 0, idx: 0 };
  }

  async startGame(game, fresh) {
    this.menu.hide();
    this.game = game;
    this.mode = 'game';
    this.sim.setSpeed(fresh ? (this.settings.defaultSpeed ?? 1) : 1);
    this.renderer.setGame(game);
    const s = game.settlements.get(game.player.capital) || [...game.settlements.values()][0];
    this.renderer.centerOn(s.x + 0.5, s.y + 1.5, 4);
    this.renderer.cam.zoom = 2.2; this.renderer.cam.tz = 4;
    this.hud.attach(game);
    setMusicMood(game.player.key);
    this.autosaveAt = performance.now() + this.settings.autosaveMin * 60000;
    if (fresh) await this.save('auto', true);
  }

  async newRun(opts, quiet) {
    this.tutorial?.stop();
    await this.sim.call('create', opts);
    const g = this.sim.mirror;
    await this.startGame(g, true);
    if (!quiet) toast(`The ${g.player.name} awaken`, `${g.settlements.get(g.player.capital).name} is founded. Guide your people.`, { icon: 'flag', ms: 7000 });
  }

  async startTutorial() {
    await this.newRun(TUTORIAL_WORLD, true);
    this.tutorial = new Tutorial(this); this.tutorial.start();
  }

  async loadRun(runId, slot) {
    this.tutorial?.stop();
    try {
      const s = slot || await latestSlot((await listRuns()).find(r => r.runId === runId) || {});
      const { json, meta, fallback } = await loadSlot(runId, s);
      const v = meta?.v ?? +(/^\{"v":(\d+)/.exec(json)?.[1] || 0);
      if (v > SAVE_VERSION && !await confirmDialog('Newer save', `This chronicle was saved by a newer version of CivSim (save format ${v}; this game reads up to ${SAVE_VERSION}). It may not load correctly. Try anyway?`, 'Load anyway')) return;
      await this.sim.call('load', json);
      const g = this.sim.mirror;
      await this.startGame(g, false);
      toast('Chronicle resumed', `${g.runName} — Year ${g.year}, ${g.seasonName}.`, { icon: 'chronicle' });
      if (fallback) toast('Damaged save skipped', `${slotLabel({ slot: s })} could not be read, so ${fallback} was loaded instead.`, { kind: 'bad', icon: 'warning', ms: 9000 });
      if (v && v < SAVE_VERSION) toast('Older save converted', `This chronicle was saved by an earlier version (format ${v}). It has been updated and will be saved in the new format.`, { icon: 'save', ms: 7000 });
    } catch (e) {
      console.error(e);
      toast('Could not load run', e.message, { kind: 'bad', icon: 'warning' });
      sfx('error');
    }
  }

  async exitToMenu() {
    this.tutorial?.stop();
    if (this.mode === 'game' && await this.save('auto', true)) await clearRecovery(this.game.runId).catch(() => {});
    closeModal();
    this.hud.detach();
    await this.showMenu();
  }

  // slot: 'auto' (rotates through five autosaves), 'quick', 's1'–'s3' or 'recover'.
  async save(slot = 'auto', silent = false, label) {
    if (!this.game || this.mode !== 'game' || this.saving) return false;
    this.saving = true;
    try {
      const thumb = slot === 'recover' ? null : this.thumbnail();
      const { json, sum, v } = await this.sim.call('serialize');
      const meta = await saveGame(this.game, slot, thumb, json, { sum, v, label });
      this.lastSaved = Date.now(); this.lastSlot = slotLabel(meta).toLowerCase(); this.saveError = null;
      if (!silent) { toast('Chronicle saved', `${this.game.runName} · ${slotLabel(meta)}`, { icon: 'save', ms: 2500 }); sfx('save'); }
      return true;
    } catch (e) {
      console.error(e);
      this.saveError = e.message || 'Unknown error';
      if (slot !== 'recover') toast('Save failed', 'Your previous saves are untouched. ' + this.saveError, { kind: 'bad', icon: 'warning' });
      return false;
    } finally { this.saving = false; if (slot !== 'recover') this.autosaveAt = performance.now() + this.settings.autosaveMin * 60000; }
  }

  // Crash recovery: a quick save whenever the page is hidden, closed or hits an
  // uncaught error, so an unexpected exit loses as little as possible.
  recoverySave() {
    if (this.mode !== 'game' || !this.game || this.saving || this.game.observer) return;
    if (performance.now() - (this.lastRecover || -1e9) < 15000) return;
    this.lastRecover = performance.now();
    this.save('recover', true);
  }

  thumbnail() {
    const r = this.renderer; if (!r.minimap) r.renderMinimap();
    const c = document.createElement('canvas'); c.width = 180; c.height = 140;
    const x = c.getContext('2d'); x.imageSmoothingEnabled = false; x.drawImage(r.minimap, 0, 0, 180, 140);
    return c.toDataURL('image/png');
  }

  // ---------------------------------------------------------------- loop
  loop(now) {
    const dt = Math.min(0.1, (now - this.last) / 1000); this.last = now;
    const g = this.game;
    if (g) {
      // the simulation runs in the worker; here we only interpolate and render
      this.sim.setHold(this.mode === 'game' && (modalOpen() || this.hud.blocking()));
      this.sim.frame(g.view);
      this.panKeys(dt);
      if (this.mode === 'menu') this.updateTour(dt);
      this.renderer.frame(dt);
      if (this.mode === 'game') {
        this.hud.update(dt);
        if (now > this.autosaveAt && this.settings.autosaveMin > 0) this.save('auto', true);
      } else this.menu.update(dt);
      this.updateAmbience();
    }
    requestAnimationFrame(t => this.loop(t));
  }

  updateTour(dt) {
    const r = this.renderer; const tour = this.tour; if (!tour) return;
    tour.t += dt;
    r.cam.x += Math.cos(tour.t * 0.05) * 6 * dt; r.cam.y += Math.sin(tour.t * 0.037) * 3 * dt;
    if (tour.t > 40) {
      tour.t = 0; tour.idx++;
      const t = this.game.tribes[tour.idx % 4]; const s = this.game.settlements.get(t.capital);
      if (s) r.flyTo(s.x + 4, s.y + 1, 3.6);
    }
  }

  updateAmbience() {
    const r = this.renderer, g = this.game;
    if (!g || !r.view) return;
    const c = r.screenToWorld(innerWidth / 2, innerHeight / 2);
    const w = g.world; let water = 0, owned = 0, n = 0;
    for (let k = 0; k < 24; k++) { const x = (c.x + (Math.random() - 0.5) * 30) | 0, y = (c.y + (Math.random() - 0.5) * 20) | 0; if (!w.inb(x, y)) continue; n++; const i = w.idx(x, y); if (isWater(w.biome[i])) water++; if (w.owner[i] >= 0) owned++; }
    const night = r.darkness();
    const zoomF = Math.min(1, r.cam.zoom / 4);
    setAmbience({ water: n ? water / n : 0, murmur: n ? (owned / n) * zoomF * (1 - night * 0.6) : 0, wind: 0.3 + (1 - zoomF) * 0.4 + (g.weather?.kind === 'snow' ? 0.4 : 0), birds: g.season === 3 ? 0.2 : 0.7, night: night > 0.3 ? 1 : 0 });
  }

  // ---------------------------------------------------------------- input
  bindInput() {
    const cv = this.cv; const r = this.renderer;
    // Pointer handling covers mouse, pen and touch: one pointer pans or taps,
    // two pointers pinch-zoom (and pan with their midpoint).
    const pts = new Map(); let drag = null, pinch = null, lastTap = null;
    const pinchState = () => { const [a, b] = [...pts.values()]; return { d: Math.max(10, Math.hypot(a.x - b.x, a.y - b.y)), mx: (a.x + b.x) / 2, my: (a.y + b.y) / 2 }; };
    cv.addEventListener('contextmenu', e => e.preventDefault());
    cv.addEventListener('pointerdown', e => {
      if (this.mode !== 'game') return;
      try { cv.setPointerCapture(e.pointerId); } catch { /* synthetic pointer */ }
      pts.set(e.pointerId, { x: e.clientX, y: e.clientY });
      if (pts.size === 1) drag = { x: e.clientX, y: e.clientY, cx: r.cam.x, cy: r.cam.y, moved: false, button: e.button, t: performance.now(), touch: e.pointerType !== 'mouse' };
      else if (pts.size === 2) { if (drag) drag.moved = true; pinch = pinchState(); r.cam.tx = null; }
    });
    cv.addEventListener('pointermove', e => {
      if (this.mode !== 'game') return;
      if (pts.has(e.pointerId)) pts.set(e.pointerId, { x: e.clientX, y: e.clientY });
      if (pinch && pts.size >= 2) {
        const n = pinchState();
        r.zoomAt(n.mx, n.my, n.d / pinch.d);
        r.cam.x -= (n.mx - pinch.mx) / r.cam.zoom; r.cam.y -= (n.my - pinch.my) / r.cam.zoom;
        pinch = n; return;
      }
      if (e.pointerType === 'mouse') { const wpos = r.screenToWorld(e.clientX, e.clientY); r.hover = wpos; if (!this.touch) { this.hud.onHover(wpos, e); this.hud.hoverBuilding(wpos, e); } }
      if (!drag) return;
      const dx = e.clientX - drag.x, dy = e.clientY - drag.y;
      if (!drag.moved && Math.hypot(dx, dy) > (drag.touch ? 10 : 5)) { drag.moved = true; cv.classList.add('grab'); }
      // touch always pans; a mouse pans unless it is positioning a building
      if (drag.moved && (drag.touch || this.touch || (drag.button === 0 && !this.hud.placing) || drag.button === 1 || drag.button === 2)) {
        r.cam.x = drag.cx - dx / r.cam.zoom; r.cam.y = drag.cy - dy / r.cam.zoom; r.cam.tx = null;
      }
    });
    const release = e => {
      if (!pts.has(e.pointerId)) return;
      pts.delete(e.pointerId);
      if (pts.size >= 2) { pinch = pinchState(); return; }
      if (pts.size === 1) { // one finger left after a pinch: keep panning from here, never treat it as a tap
        pinch = null; const [p] = [...pts.values()];
        drag = { x: p.x, y: p.y, cx: r.cam.x, cy: r.cam.y, moved: true, button: 0, touch: true };
        return;
      }
      pinch = null;
      if (this.mode !== 'game' || !drag) return;
      cv.classList.remove('grab');
      const d = drag; drag = null;
      if (e.type === 'pointercancel') return;
      const touchy = d.touch || this.touch;
      if (d.moved && (touchy || !(this.hud.placing && d.button === 0))) return;
      const wpos = r.screenToWorld(e.clientX, e.clientY);
      if (d.button === 2) { this.hud.onRightClick(wpos, e); return; }
      if (d.button !== 0) return;
      // double-tap zooms in on touch screens
      if (d.touch && !this.hud.placing) {
        const now = performance.now();
        if (lastTap && now - lastTap.t < 320 && Math.hypot(e.clientX - lastTap.x, e.clientY - lastTap.y) < 36) { r.zoomAt(e.clientX, e.clientY, 1.7); lastTap = null; return; }
        lastTap = { t: now, x: e.clientX, y: e.clientY };
      }
      this.hud.onClick(wpos, e);
    };
    cv.addEventListener('pointerup', release);
    cv.addEventListener('pointercancel', release);
    cv.addEventListener('wheel', e => {
      e.preventDefault();
      const f = Math.pow(1.0015, -e.deltaY * (this.settings.camSpeed || 1));
      r.zoomAt(e.clientX, e.clientY, f);
    }, { passive: false });
    addEventListener('keydown', e => {
      if (e.target.tagName === 'INPUT') return;
      this.keys.add(e.key.toLowerCase());
      if (this.mode === 'game') this.hud.onKey(e);
    });
    addEventListener('keyup', e => this.keys.delete(e.key.toLowerCase()));
    addEventListener('blur', () => this.keys.clear());
  }

  panKeys(dt) {
    if (this.mode !== 'game') return;
    const r = this.renderer; const k = this.keys;
    const sp = 520 * dt / r.cam.zoom * (this.settings.camSpeed || 1) * (k.has('shift') ? 2.2 : 1);
    let moved = false;
    if (k.has('w') || k.has('arrowup')) { r.cam.y -= sp; moved = true; }
    if (k.has('s') || k.has('arrowdown')) { r.cam.y += sp; moved = true; }
    if (k.has('a') || k.has('arrowleft')) { r.cam.x -= sp; moved = true; }
    if (k.has('d') || k.has('arrowright')) { r.cam.x += sp; moved = true; }
    if (k.has('q')) { r.zoomAt(innerWidth / 2, innerHeight / 2, Math.pow(0.4, dt)); }
    if (k.has('e')) { r.zoomAt(innerWidth / 2, innerHeight / 2, Math.pow(2.5, dt)); }
    if (moved) r.cam.tx = null;
  }
}

const app = new App();
window.civsim = app;
app.init().catch(e => { console.error(e); document.body.insertAdjacentHTML('beforeend', `<pre style="color:#f88;position:fixed;inset:20px;z-index:9999">${e.stack}</pre>`); });
