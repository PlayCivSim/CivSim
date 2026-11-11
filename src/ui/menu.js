// Main menu, new-run setup (world + tribe selection), load-run browser,
// settings and credits.
import { h, $, $$, esc, toast, confirmDialog, promptDialog, toggleHTML } from './dom.js';
import { ico, emblemURL, spriteURL } from './icons.js';
import { TRIBES } from '../data/tribes.js';
import { MAP_SIZES, DIFFICULTIES, STARTS, SEASONS } from '../core/constants.js';
import { listRuns, deleteRun, renameRun, SLOT_NAMES } from '../save/saves.js';
import { generateWorld } from '../world/worldgen.js';
import { BIOMES, isWater } from '../world/biomes.js';
import { hashString } from '../core/rng.js';
import { sfx } from '../audio/audio.js';

const VERSION = 'v1.0 · Chronicle Edition';
const FLAVOR_SEEDS = ['Ashen Vale', 'Tidewhisper', 'Emberhold', 'Mistral Reach', 'Saltmarch', 'Thornwood', 'Glassmere', 'Kestrel Isles', 'Moonfall', 'Ironcrown', 'Willowmere', 'Duskhaven', 'Amberlight', 'Stormbreak'];

export class MainMenu {
  constructor(app) { this.app = app; this.root = document.getElementById('screens'); this.page = null; this.ticks = []; }

  async show() {
    const runs = await listRuns().catch(() => []);
    this.runs = runs;
    const last = runs.find(r => r.alive !== false) || runs[0];
    this.root.innerHTML = '';
    const el = h(`<div id="menu" class="screen enter">
      <div class="vignette"></div>
      <div class="menu-left">
        <div class="banner-wrap"><div class="rod"></div><div class="banner">
          <div class="logo"><div class="word">CivSim</div><div class="sub">A Living World Chronicle</div></div>
          <div class="menu-items">
            <button class="menu-item" data-act="continue" ${last ? '' : 'disabled'}>${ico('play')}<span>Continue${last ? `<small>${esc(last.runName)} · Year ${last.year}, ${esc(last.season)}</small>` : '<small>No chronicle yet</small>'}</span></button>
            <button class="menu-item" data-act="new">${ico('flag')}<span>New Run<small>Raise a people from nothing</small></span></button>
            <button class="menu-item" data-act="load" ${runs.length ? '' : 'disabled'}>${ico('chronicle')}<span>Load Run<small>${runs.length} chronicle${runs.length === 1 ? '' : 's'} recorded</small></span></button>
            <button class="menu-item" data-act="settings">${ico('menu')}<span>Settings</span></button>
            <button class="menu-item" data-act="credits">${ico('scroll')}<span>Credits</span></button>
          </div>
          <div class="menu-emblems">${TRIBES.map(t => `<img src="${emblemURL(t.key)}" data-tip="${esc(t.name + ' — ' + t.title)}">`).join('')}</div>
        </div></div>
      </div>
      <div class="ticker"></div>
      <div class="version">${VERSION}</div>
    </div>`);
    this.root.appendChild(el);
    this.el = el;
    el.querySelectorAll('.menu-item').forEach(b => { b.onmouseenter = () => sfx('hover'); });
    el.onclick = e => {
      const b = e.target.closest('[data-act]'); if (!b || b.disabled) return;
      sfx('click');
      const a = b.dataset.act;
      if (a === 'continue') this.app.loadRun(last.runId);
      else if (a === 'new') this.newRun();
      else if (a === 'load') this.loadRuns();
      else if (a === 'settings') openSettings(this.app, () => {});
      else if (a === 'credits') this.credits();
    };
    // the background world writes its own chronicle onto the menu
    this.ticks = [];
    this.unsub?.();
    this.unsub = this.app.game.bus.on('log', e => { if (e.imp >= 1 && e.type !== 'law') this.tick(e); });
    const recent = this.app.game.history.filter(e => e.imp >= 1).slice(-3);
    recent.forEach(e => this.tick(e));
  }

  tick(e) {
    const t = this.el?.querySelector('.ticker'); if (!t) return;
    const g = this.app.game;
    const node = h(`<div><div class="tk-date">Year ${Math.floor(e.day / 4) + 1} · ${SEASONS[e.day % 4]}</div><div class="tk">${esc(e.text)}</div></div>`);
    t.appendChild(node);
    while (t.children.length > 4) t.firstElementChild.remove();
  }

  update() {}
  hide() { this.unsub?.(); this.root.innerHTML = ''; }

  closePage() { this.page?.remove(); this.page = null; }
  openPage(html) {
    this.closePage();
    this.page = h(`<div class="screen enter">${html}</div>`);
    this.root.appendChild(this.page);
    return this.page;
  }

  // ---------------------------------------------------------------- new run
  newRun() {
    const st = { name: '', seedText: FLAVOR_SEEDS[(Math.random() * FLAVOR_SEEDS.length) | 0] + ' ' + ((Math.random() * 900 + 100) | 0), size: 'medium', difficulty: 'balanced', start: 'standard', tribe: 0 };
    const p = this.openPage(`<div class="page">
      <div class="page-head">${ico('flag', 'lg')}<div class="panel-title">A New Chronicle</div><div class="grow"></div><button class="btn" data-act="back">${ico('close', 'sm')} Back</button></div>
      <div class="page-body">
        <div class="world-col scroll">
          <div class="frame"><div class="preview-wrap" id="pv"><canvas></canvas></div></div>
          <div class="frame opt-card">
            <div class="field"><label>Chronicle name</label><input class="text-input" id="rname" maxlength="40" placeholder="The Chronicle of …"></div>
            <div class="field"><label>World seed</label><div class="seed-row"><input class="text-input" id="seed" maxlength="40"><button class="btn icon" data-act="dice" data-tip="Roll a new seed">${ico('dice')}</button></div></div>
            <div class="field"><label>Map size</label><div class="seg" id="size">${Object.entries(MAP_SIZES).map(([k, v]) => `<button class="btn sm" data-size="${k}" data-tip="${esc(v.desc + ` (${v.w}×${v.h})`)}">${v.label}</button>`).join('')}</div></div>
            <div class="field"><label>World difficulty</label><div class="seg" id="diff">${Object.entries(DIFFICULTIES).map(([k, v]) => `<button class="btn sm" data-diff="${k}" data-tip="${esc(v.desc)}">${v.label}</button>`).join('')}</div></div>
            <div class="field"><label>Starting conditions</label><div class="seg" id="start">${Object.entries(STARTS).map(([k, v]) => `<button class="btn sm" data-start="${k}" data-tip="${esc(v.desc)}">${v.label.split(' ')[0]}</button>`).join('')}</div></div>
          </div>
        </div>
        <div class="tribes-col">
          <div class="tribe-cards">${TRIBES.map((t, i) => this.tribeCard(t, i)).join('')}</div>
          <div class="newrun-foot"><span class="prose" id="summary"></span><button class="btn big primary" data-act="begin">${ico('play')} Begin Chronicle</button></div>
        </div>
      </div></div>`);
    const seedIn = $('#seed', p), nameIn = $('#rname', p);
    seedIn.value = st.seedText;
    const sync = () => {
      $$('[data-size]', p).forEach(b => b.classList.toggle('on', b.dataset.size === st.size));
      $$('[data-diff]', p).forEach(b => b.classList.toggle('on', b.dataset.diff === st.difficulty));
      $$('[data-start]', p).forEach(b => b.classList.toggle('on', b.dataset.start === st.start));
      $$('.tribe-card', p).forEach((c, i) => c.classList.toggle('sel', i === st.tribe));
      $$('.pin', p).forEach((pin, i) => pin.classList.toggle('me', i === st.tribe));
      const t = TRIBES[st.tribe];
      $('#summary', p).innerHTML = `Lead the <em>${t.name}</em> on a <em>${MAP_SIZES[st.size].label.toLowerCase()}</em> world · <em>${DIFFICULTIES[st.difficulty].label}</em> · ${STARTS[st.start].label}`;
      document.documentElement.style.setProperty('--tribe', t.color);
    };
    let pvTimer = 0;
    const preview = () => { clearTimeout(pvTimer); pvTimer = setTimeout(() => this.drawPreview(p, st), 120); };
    seedIn.oninput = () => { st.seedText = seedIn.value; preview(); };
    p.onclick = e => {
      const b = e.target.closest('[data-act],[data-size],[data-diff],[data-start],.tribe-card'); if (!b) return;
      sfx('click');
      if (b.dataset.act === 'back') { this.closePage(); return; }
      if (b.dataset.act === 'dice') { st.seedText = seedIn.value = FLAVOR_SEEDS[(Math.random() * FLAVOR_SEEDS.length) | 0] + ' ' + ((Math.random() * 900 + 100) | 0); preview(); return; }
      if (b.dataset.act === 'begin') { this.begin(st, nameIn.value.trim()); return; }
      if (b.dataset.size) { st.size = b.dataset.size; preview(); }
      if (b.dataset.diff) st.difficulty = b.dataset.diff;
      if (b.dataset.start) st.start = b.dataset.start;
      if (b.classList.contains('tribe-card')) { st.tribe = +b.dataset.i; sfx('diplomacy'); }
      sync();
    };
    sync(); this.drawPreview(p, st);
  }

  tribeCard(t, i) {
    const person = (job, female, frame = 0) => `<img src="${spriteURL('person', t.key, job, frame, female, false, 3, null, 1, false)}" width="27" height="36" style="width:36px;height:48px">`;
    const house = spriteURL('building', 'house', t.key, 1, 2);
    const hall = spriteURL('building', 'centre', t.key, 3, 3);
    return `<div class="tribe-card" data-i="${i}" style="--tc:${t.color};--tc-hi:${t.pal.light}">
      <div class="tc-top"><img class="emb" src="${emblemURL(t.key)}"></div>
      <div class="tc-name">${t.name}</div>
      <div class="tc-title">${t.title}</div>
      <div class="diorama"><img src="${hall}" style="width:96px;height:${(24 + 18) * 4}px;max-height:150px;object-fit:contain;margin-bottom:-2px">${person('farmer', true)}${person('soldier', false, 3)}${person('researcher', true)}<img src="${house}" style="width:64px;height:112px;object-fit:contain"></div>
      <div class="tc-body">
        <div class="motto">“${t.motto}”</div>
        <div class="swatches">${[t.pal.dark, t.pal.primary, t.pal.light, t.pal.accent, t.pal.trim].map(c => `<i style="background:${c}"></i>`).join('')}</div>
        <div class="prose" style="font-size:0.95em">${t.blurb}</div>
        <div class="section-title" style="margin:4px 0">Strengths</div>
        <div class="trait-list plus">${t.strengths.map(s => `<div>${s}</div>`).join('')}</div>
        <div class="section-title" style="margin:4px 0">Weaknesses</div>
        <div class="trait-list minus">${t.weaknesses.map(s => `<div>${s}</div>`).join('')}</div>
        <div class="section-title" style="margin:4px 0">Prefers</div>
        <div class="dim" style="font-size:0.86em">${t.start}</div>
      </div>
    </div>`;
  }

  drawPreview(p, st) {
    const seed = hashString(String(st.seedText || 'seed'));
    const w = generateWorld(seed, st.size, MAP_SIZES[st.size]);
    st.world = w; st.seed = seed;
    const cv = $('#pv canvas', p); cv.width = w.w; cv.height = w.h;
    const ctx = cv.getContext('2d'); const img = ctx.createImageData(w.w, w.h);
    const cols = BIOMES.map(b => { const n = parseInt(b.cols[0].slice(1), 16); return [(n >> 16) & 255, (n >> 8) & 255, n & 255]; });
    for (let i = 0; i < w.n; i++) { let [r, g, b] = cols[w.biome[i]]; if (w.trees[i]) { r *= 0.82; g *= 0.88; b *= 0.82; } img.data.set([r, g, b, 255], i * 4); }
    ctx.putImageData(img, 0, 0);
    const wrap = $('#pv', p); $$('.pin', wrap).forEach(x => x.remove());
    w.starts.forEach((s, i) => { const pin = h(`<img class="pin ${i === st.tribe ? 'me' : ''}" src="${emblemURL(TRIBES[i].key)}" style="left:${(s.x / w.w) * 100}%;top:${(s.y / w.h) * 100}%" data-tip="${TRIBES[i].name} start">`); wrap.appendChild(pin); });
  }

  async begin(st, name) {
    const t = TRIBES[st.tribe];
    const runName = name || `Chronicle of the ${t.name}`;
    this.closePage();
    const ld = h(`<div class="loading"><div class="lw">${esc(runName)}</div><div class="prose dim">Shaping continents, raising mountains, kindling four hearths…</div><div class="bar"><i style="width:30%"></i></div></div>`);
    document.body.appendChild(ld);
    await new Promise(r => setTimeout(r, 60));
    ld.querySelector('i').style.width = '75%';
    try {
      await this.app.newRun({ seed: st.seed ?? hashString(st.seedText), seedText: st.seedText, size: st.size, difficulty: st.difficulty, start: st.start, playerTribe: st.tribe, runName });
    } catch (e) { console.error(e); toast('World generation failed', e.message, { kind: 'bad' }); }
    ld.remove();
  }

  // ---------------------------------------------------------------- load
  async loadRuns() {
    const runs = await listRuns();
    const p = this.openPage(`<div class="page">
      <div class="page-head">${ico('chronicle', 'lg')}<div class="panel-title">Recorded Chronicles</div><div class="grow"></div><button class="btn" data-act="back">${ico('close', 'sm')} Back</button></div>
      <div class="page-body"><div class="scroll" style="flex:1"><div class="saves-grid">
      ${runs.length ? runs.map(r => this.saveCard(r)).join('') : `<div class="empty-state prose">No chronicles have been written yet.</div>`}
      </div></div></div></div>`);
    p.onclick = async e => {
      const b = e.target.closest('[data-act]'); if (!b) return;
      sfx('click');
      const id = b.dataset.id;
      if (b.dataset.act === 'back') this.closePage();
      else if (b.dataset.act === 'slot') { this.closePage(); this.app.loadRun(id, b.dataset.slot); }
      else if (b.dataset.act === 'del') {
        const run = runs.find(r => r.runId === id);
        if (await confirmDialog('Delete chronicle?', `<em>${esc(run.runName)}</em> and all of its saves will be permanently erased.`, 'Delete forever', true)) { await deleteRun(id); this.loadRuns(); this.show(); }
      } else if (b.dataset.act === 'rename') {
        const run = runs.find(r => r.runId === id);
        const n = await promptDialog('Rename chronicle', 'Name', run.runName);
        if (n) { await renameRun(id, n); this.loadRuns(); }
      }
    };
  }

  saveCard(r) {
    const t = TRIBES.find(x => x.key === r.tribe) || TRIBES[0];
    const when = new Date(r.lastPlayed);
    const slots = Object.values(r.slots || {}).sort((a, b) => b.savedAt - a.savedAt);
    return `<div class="frame save-card" style="--tribe:${t.color}">
      ${r.thumb ? `<img class="thumb" src="${r.thumb}">` : `<div class="thumb"></div>`}
      <div class="info">
        <div class="row"><img src="${emblemURL(t.key)}" width="24" height="24" class="pix"><div class="rname">${esc(r.runName)}</div></div>
        <div class="dim" style="font-size:0.86em">${t.name} · ${esc(r.stage)} · Year ${r.year}, ${esc(r.season)} ${r.alive === false ? '<span class="bad">· Fallen</span>' : ''}</div>
        <div class="faint" style="font-size:0.8em">${r.pop} people · ${r.techs} techs · ${r.settlements} settlement${r.settlements === 1 ? '' : 's'} · ${MAP_SIZES[r.size]?.label || ''} · seed “${esc(r.seedText)}”</div>
        <div class="faint" style="font-size:0.78em">Last played ${when.toLocaleDateString()} ${when.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</div>
        <div class="slot-btns">${slots.map(s => `<button class="btn xs" data-act="slot" data-id="${r.runId}" data-slot="${s.slot}" data-tip="${esc(`Year ${s.year}, ${s.season} · ${new Date(s.savedAt).toLocaleString()}`)}">${ico('play', 'sm')}${SLOT_NAMES[s.slot] || s.slot}</button>`).join('')}
          <button class="btn xs" data-act="rename" data-id="${r.runId}" data-tip="Rename">${ico('scroll', 'sm')}</button>
          <button class="btn xs danger" data-act="del" data-id="${r.runId}" data-tip="Delete run">${ico('close', 'sm')}</button></div>
      </div></div>`;
  }

  credits() {
    const p = this.openPage(`<div class="page"><div class="page-head">${ico('scroll', 'lg')}<div class="panel-title">Credits</div><div class="grow"></div><button class="btn" data-act="back">${ico('close', 'sm')} Back</button></div>
      <div class="scroll" style="flex:1"><div class="credits frame">
        <div class="logo"><div class="word" style="font-size:64px">CivSim</div><div class="sub">A Living World Chronicle</div></div>
        <div class="divider"></div>
        <h3>Design & Development</h3><p class="prose">Built as a single-page browser game: a procedural world, four civilisations and every pixel drawn in code.</p>
        <h3>Art</h3><p class="prose">All sprites, terrain, icons, emblems and interface ornaments are generated procedurally at runtime — no external image assets.</p>
        <h3>Sound</h3><p class="prose">Ambience, music and effects are synthesised live with the Web Audio API.</p>
        <h3>Typography</h3><p class="prose">Jacquarda Bastarda 9, Pixelify Sans, Silkscreen and Alegreya, via Google Fonts.</p>
        <h3>The Peoples</h3><p class="prose">${TRIBES.map(t => `<em>${t.name}</em> — ${t.title}`).join('<br>')}</p>
        <div class="divider"></div>
        <p class="prose">Every run is its own history. Thank you for playing.</p>
      </div></div></div>`);
    p.onclick = e => { if (e.target.closest('[data-act="back"]')) { sfx('click'); this.closePage(); } };
  }
}

// ---------------------------------------------------------------- settings
export function openSettings(app, onClose) {
  const root = document.getElementById('screens');
  const s = app.settings;
  let tab = 'audio';
  const page = h(`<div class="screen enter" style="z-index:700"><div class="page">
    <div class="page-head">${ico('menu', 'lg')}<div class="panel-title">Settings</div><div class="grow"></div><button class="btn" data-act="back">${ico('close', 'sm')} Done</button></div>
    <div class="settings-wrap"><div class="settings-tabs">${[['audio', 'Audio', 'sun'], ['gameplay', 'Gameplay', 'play'], ['graphics', 'Graphics', 'eye'], ['controls', 'Controls', 'target']].map(([k, n, i]) => `<button class="btn" data-tab="${k}">${ico(i)} ${n}</button>`).join('')}</div>
    <div class="settings-body frame scroll"></div></div></div></div>`);
  root.appendChild(page);
  const slider = (key, label, desc, min = 0, max = 1, step = 0.05, fmtv = v => Math.round(v * 100)) => `<div class="set-row"><div class="lbl">${label}<small>${desc}</small></div><div class="ctl"><input type="range" class="slider" data-key="${key}" min="${min}" max="${max}" step="${step}" value="${s[key]}"><span class="num" data-num="${key}">${fmtv(s[key])}</span></div></div>`;
  const toggle = (key, label, desc) => `<div class="set-row"><div class="lbl">${label}<small>${desc}</small></div><div class="ctl" data-toggle="${key}">${toggleHTML(!!s[key])}</div></div>`;
  const choice = (key, label, desc, opts) => `<div class="set-row"><div class="lbl">${label}<small>${desc}</small></div><div class="ctl seg">${opts.map(([v, n]) => `<button class="btn sm ${String(s[key]) === String(v) ? 'on' : ''}" data-choice="${key}" data-v="${v}">${n}</button>`).join('')}</div></div>`;
  const fmts = { uiScale: v => v.toFixed(2) + '×', camSpeed: v => v.toFixed(1) + '×' };
  const render = () => {
    $$('[data-tab]', page).forEach(b => b.classList.toggle('on', b.dataset.tab === tab));
    const body = $('.settings-body', page);
    if (tab === 'audio') body.innerHTML = slider('master', 'Master volume', 'Overall loudness') + slider('music', 'Music', 'Generative score') + slider('sfx', 'Sound effects', 'Interface, construction, battle') + slider('ambience', 'Ambience', 'Wind, water, birds and settlements') + slider('ui', 'Interface sounds', 'Clicks, hovers and panel sounds');
    if (tab === 'gameplay') body.innerHTML = choice('defaultSpeed', 'Starting speed', 'Simulation speed when a run begins', [[1, 'Normal'], [2, 'Fast'], [3, 'Very fast']]) + choice('autosaveMin', 'Autosave', 'How often the chronicle saves itself', [[0, 'Off'], [2, '2 min'], [3, '3 min'], [5, '5 min'], [10, '10 min']]) + toggle('pauseOnEvent', 'Pause on decisions', 'Pause the world while an event awaits your choice');
    if (tab === 'graphics') body.innerHTML = choice('quality', 'Graphics quality', 'Lower quality skips some decoration', [['low', 'Low'], ['high', 'High']]) + toggle('particles', 'Particle effects', 'Smoke, weather, fireflies, sparks') + toggle('animations', 'Animations', 'Swaying trees and shimmering water') + toggle('territory', 'Territory overlay', 'Tint and borders of claimed land') + slider('uiScale', 'Interface scale', 'Size of all interface elements', 0.8, 1.4, 0.05, fmts.uiScale);
    if (tab === 'controls') body.innerHTML = choice('inputMode', 'Device type', 'Touch adds larger buttons, tap-to-place building and press-and-hold tips', [['touch', 'Touch'], ['keyboard', 'Keyboard']]) + (s.inputMode === 'touch' ? `<div class="section-title">Touch controls</div><div class="kv" style="font-size:0.95em"><span>Drag</span><span>Pan the map</span><span>Pinch</span><span>Zoom (or use the + and - buttons by the minimap)</span><span>Tap</span><span>Inspect a person, building or tile</span><span>Double-tap</span><span>Zoom in</span><span>Press and hold</span><span>Show details for any button or icon</span><span>Building</span><span>Tap the map to position it, then press Place</span></div>` : '') + slider('camSpeed', 'Camera sensitivity', 'Pan and zoom speed', 0.4, 2.5, 0.1, fmts.camSpeed) + `<div class="section-title">Keys</div><div class="kv" style="font-size:0.95em">
      <span>W A S D / Arrows</span><span>Pan camera (Shift: faster)</span><span>Q / E, mouse wheel</span><span>Zoom</span><span>Drag (left/right)</span><span>Pan</span>
      <span>Space</span><span>Pause / resume</span><span>1 · 2 · 3</span><span>Speeds</span><span>B</span><span>Build</span><span>T</span><span>Technology</span><span>F1–F9 / tabs</span><span>Panels</span>
      <span>H</span><span>Return home</span><span>F5</span><span>Quicksave</span><span>Esc</span><span>Cancel / menu</span></div>`;
  };
  page.oninput = e => { const k = e.target.dataset.key; if (!k) return; s[k] = +e.target.value; const n = $(`[data-num="${k}"]`, page); if (n) n.textContent = (fmts[k] || (v => Math.round(v * 100)))(s[k]); app.applySettings(); };
  page.onclick = e => {
    const b = e.target.closest('[data-act],[data-tab],[data-toggle],[data-choice]'); if (!b) return;
    sfx('click');
    if (b.dataset.act === 'back') { page.remove(); onClose?.(); return; }
    if (b.dataset.tab) tab = b.dataset.tab;
    if (b.dataset.toggle) { s[b.dataset.toggle] = !s[b.dataset.toggle]; app.applySettings(); }
    if (b.dataset.choice) { const v = b.dataset.v; s[b.dataset.choice] = isNaN(+v) ? v : +v; app.applySettings(); }
    render();
  };
  render();
}
