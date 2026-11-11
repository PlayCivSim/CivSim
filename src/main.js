// CivSim application controller: screens, main loop, input, autosave.
import { installTheme } from './ui/theme.js';
import { initTooltips, toast, modalOpen, closeModal } from './ui/dom.js';
import { Renderer } from './render/renderer.js';
import { Game } from './sim/game.js';
import { initAudio, resumeAudio, setVolumes, setAmbience, sfx, setMusicMood } from './audio/audio.js';
import { loadSettings, storeSettings, saveGame, listRuns, loadSlot, latestSlot } from './save/saves.js';
import { MainMenu } from './ui/menu.js';
import { Hud } from './ui/hud.js';
import { TILE } from './core/constants.js';
import { isWater } from './world/biomes.js';

class App {
  constructor() {
    this.settings = loadSettings();
    this.cv = document.getElementById('world');
    this.renderer = new Renderer(this.cv);
    this.game = null;
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
    this.renderer.resize();
    addEventListener('resize', () => this.renderer.resize());
    this.bindInput();
    const unlock = () => { initAudio(); resumeAudio(); setVolumes(this.settings); };
    addEventListener('pointerdown', unlock, { once: false });
    addEventListener('keydown', unlock, { once: false });
    this.menu = new MainMenu(this);
    this.hud = new Hud(this);
    await this.showMenu();
    requestAnimationFrame(t => this.loop(t));
    document.getElementById('boot')?.remove();
  }

  applySettings() {
    const s = this.settings;
    document.documentElement.style.setProperty('--ui', s.uiScale);
    Object.assign(this.renderer.settings, { particles: s.particles, animations: s.animations, territory: s.territory, quality: s.quality });
    setVolumes(s);
    storeSettings(s);
  }

  // ---------------------------------------------------------------- screens
  async showMenu() {
    this.mode = 'menu';
    this.hud.hide();
    // a living background world, run entirely by AI
    const bg = Game.create({ seed: 'menu-' + (Math.random() * 1e6 | 0), size: 'small', observer: true, playerTribe: 0, start: 'bountiful' });
    for (let i = 0; i < 360 * 6; i++) bg.step();
    this.game = bg; this.game.speed = 2;
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
    game.speed = fresh ? (this.settings.defaultSpeed ?? 1) : 1;
    this.renderer.setGame(game);
    const s = game.settlements.get(game.player.capital) || [...game.settlements.values()][0];
    this.renderer.centerOn(s.x + 0.5, s.y + 1.5, 4);
    this.renderer.cam.zoom = 2.2; this.renderer.cam.tz = 4;
    this.hud.attach(game);
    setMusicMood(game.player.key);
    this.autosaveAt = performance.now() + this.settings.autosaveMin * 60000;
    if (fresh) await this.save('auto', true);
  }

  async newRun(opts) {
    const g = Game.create(opts);
    await this.startGame(g, true);
    toast(`The ${g.player.name} awaken`, `${g.settlements.get(g.player.capital).name} is founded. Guide your people.`, { icon: 'flag', ms: 7000 });
  }

  async loadRun(runId, slot) {
    try {
      const s = slot || await latestSlot((await listRuns()).find(r => r.runId === runId) || {});
      const g = await loadSlot(runId, s);
      await this.startGame(g, false);
      toast('Chronicle resumed', `${g.runName} — Year ${g.year}, ${g.seasonName}.`, { icon: 'chronicle' });
    } catch (e) {
      console.error(e);
      toast('Could not load run', e.message, { kind: 'bad', icon: 'warning' });
      sfx('error');
    }
  }

  async exitToMenu() {
    if (this.mode === 'game') await this.save('auto', true);
    closeModal();
    this.hud.detach();
    await this.showMenu();
  }

  async save(slot = 'auto', silent = false) {
    if (!this.game || this.mode !== 'game' || this.saving) return;
    this.saving = true;
    try {
      const thumb = this.thumbnail();
      await saveGame(this.game, slot, thumb);
      if (!silent) { toast('Chronicle saved', `${this.game.runName} · ${slot === 'auto' ? 'Autosave' : slot === 'quick' ? 'Quicksave' : 'Slot ' + slot.slice(1)}`, { icon: 'save', ms: 2500 }); sfx('save'); }
    } catch (e) {
      console.error(e);
      toast('Save failed', 'Your previous save is untouched. ' + e.message, { kind: 'bad', icon: 'warning' });
    } finally { this.saving = false; this.autosaveAt = performance.now() + this.settings.autosaveMin * 60000; }
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
      const blocked = this.mode === 'game' && (modalOpen() || this.hud.blocking());
      if (!blocked) g.update(dt);
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
    let drag = null;
    cv.addEventListener('contextmenu', e => e.preventDefault());
    cv.addEventListener('pointerdown', e => {
      if (this.mode !== 'game') return;
      cv.setPointerCapture(e.pointerId);
      drag = { x: e.clientX, y: e.clientY, cx: r.cam.x, cy: r.cam.y, moved: false, button: e.button, t: performance.now() };
    });
    cv.addEventListener('pointermove', e => {
      if (this.mode !== 'game') return;
      const wpos = r.screenToWorld(e.clientX, e.clientY);
      r.hover = wpos;
      this.hud.onHover(wpos, e);
      if (!drag) return;
      const dx = e.clientX - drag.x, dy = e.clientY - drag.y;
      if (!drag.moved && Math.hypot(dx, dy) > 5) { drag.moved = true; cv.classList.add('grab'); }
      if (drag.moved && (drag.button === 0 && !this.hud.placing || drag.button === 1 || drag.button === 2)) {
        r.cam.x = drag.cx - dx / r.cam.zoom; r.cam.y = drag.cy - dy / r.cam.zoom; r.cam.tx = null;
      }
    });
    cv.addEventListener('pointerup', e => {
      if (this.mode !== 'game' || !drag) return;
      cv.classList.remove('grab');
      const d = drag; drag = null;
      if (d.moved && !(this.hud.placing && d.button === 0)) return;
      const wpos = r.screenToWorld(e.clientX, e.clientY);
      if (d.button === 2) this.hud.onRightClick(wpos, e);
      else if (d.button === 0) this.hud.onClick(wpos, e);
    });
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
