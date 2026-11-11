// In-game HUD: top bar, navigation rail, side panels, minimap, inspector,
// build placement, notifications and the escape menu.
import { h, $, $$, esc, fmt, sign, toast, modal, closeModal, modalOpen, confirmDialog, refreshTip, tip, bar } from './dom.js';
import { ico, emblemURL, spriteURL } from './icons.js';
import { PANELS, ACTIONS, buildingTip } from './panels.js';
import { TRIBES } from '../data/tribes.js';
import { BUILDINGS, JOBS } from '../data/buildings.js';
import { RESOURCES, FOOD_KEYS, DEPOSITS } from '../data/resources.js';
import { BIOMES, isWater } from '../world/biomes.js';
import { TECH } from '../data/techs.js';
import { STAGES } from '../sim/progress.js';
import { SPEEDS, SPEED_NAMES, TILE, DAYS_PER_YEAR } from '../core/constants.js';
import { placementCheck, placeBuilding, destroyBuilding } from '../sim/buildings.js';
import { buildingCost, foodTotal, dailyFoodNeed } from '../sim/economy.js';
import { siteCheck, canFound } from '../sim/ai.js';
import { EVENTS } from '../sim/events.js';
import { ageYears } from '../sim/agents.js';
import { sfx, setMusicMood } from '../audio/audio.js';
import { openSettings } from './menu.js';
import { SLOT_NAMES } from '../save/saves.js';
import { techCost } from '../sim/progress.js';

const TOP_RES = ['food', 'wood', 'stone', 'clay', 'iron', 'tools', 'coins', 'research'];
const RAIL = [
  ['overview', 'Overview', 'overview', 'F1'], ['build', 'Build', 'build', 'B'], ['population', 'Population', 'population', 'P'],
  ['economy', 'Economy', 'economy', 'O'], ['technology', 'Technology', 'technology', 'T'], ['diplomacy', 'Diplomacy', 'diplomacy', 'G'],
  ['government', 'Government', 'government', 'L'], ['military', 'Military', 'military', 'M'], ['chronicle', 'Chronicle', 'chronicle', 'C'],
];

export class Hud {
  constructor(app) {
    this.app = app; this.root = document.getElementById('hud');
    this.panel = null; this.placing = null; this.uiTimer = 0; this.offs = []; this.state = {};
  }
  get game() { return this.app.game; }
  get sim() { return this.app.sim; }
  get renderer() { return this.app.renderer; }
  blocking() { return !!this.pausedForChoice; }

  hide() { this.root.classList.add('hidden'); }
  detach() { this.offs.forEach(f => f()); this.offs = []; this.root.innerHTML = ''; this.hide(); this.panel = null; this.placing = null; this.renderer.ghost = null; }

  attach(game) {
    this.detach();
    const t = game.player;
    document.documentElement.style.setProperty('--tribe', t.color);
    this.root.classList.remove('hidden');
    this.root.innerHTML = `
      <div class="topbar">
        <div class="tb-tribe" data-panel="overview"><img src="${emblemURL(t.key)}"><div><div class="nm">${t.name}</div><div class="st" id="tb-stage"></div></div></div>
        <div class="tb-res" id="tb-res">${TOP_RES.map(k => `<div class="res" data-res="${k}">${ico(k === 'food' ? 'food' : k)}<div class="v-wrap"><span class="v num">0</span><span class="d num"></span></div></div>`).join('<div class="res-sep"></div>'.slice(0, 0))}
          <div class="res-sep"></div>
          <div class="res" data-res="pop">${ico('population')}<div class="v-wrap"><span class="v num">0</span><span class="d num"></span></div></div>
          <div class="res" data-res="happy">${ico('happy')}<div class="v-wrap"><span class="v num">0</span><span class="d num"></span></div></div>
        </div>
        <div class="tb-right">
          <div class="clock"><div class="dial"><canvas width="18" height="18"></canvas></div><div><div class="when" id="tb-when"></div><div class="yr" id="tb-year"></div></div></div>
          <div class="speed">${['pause', 'play', 'fast', 'faster'].map((ic, i) => `<button class="btn icon sm" data-speed="${i}" data-tip="${SPEED_NAMES[i]} (${i === 0 ? 'Space' : i})">${ico(ic, 'sm')}</button>`).join('')}</div>
          <button class="btn icon sm" data-act="esc" data-tip="Menu (Esc)">${ico('menu', 'sm')}</button>
        </div>
      </div>
      <div class="rail frame thin">${RAIL.map(([k, n, ic, key], i) => `${i === 1 || i === 4 || i === 8 ? '<div class="sep"></div>' : ''}<button class="btn rb" data-panel="${k}" data-tip="${n} (${key})">${ico(ic)}<span class="badge hidden"></span></button>`).join('')}</div>
      <div id="panel-host"></div>
      <div class="minimap frame thin"><div class="mm-tools"><button class="btn icon xs" data-act="territory" data-tip="Toggle territory overlay">${ico('flag', 'sm')}</button><button class="btn icon xs" data-act="home" data-tip="Return to capital (H)">${ico('house', 'sm')}</button></div><canvas id="mm"></canvas></div>
      <div id="insp-host"></div>
      <div id="place-host"></div>`;
    this.bindResTips();
    this.root.onclick = e => this.onHudClick(e);
    this.root.addEventListener('mouseover', e => { if (e.target.closest('.btn')) sfx('hover'); });
    const mm = $('#mm', this.root);
    const mmNav = e => { const r = mm.getBoundingClientRect(); const w = game.world; this.renderer.flyTo((e.clientX - r.left) / r.width * w.w, (e.clientY - r.top) / r.height * w.h); };
    mm.onpointerdown = e => { mmNav(e); mm.setPointerCapture(e.pointerId); mm.onpointermove = mmNav; };
    mm.onpointerup = () => { mm.onpointermove = null; };
    this.listen(game);
    this.update(1);
    this.pausedForChoice = false;
    // resume pending decisions from a loaded save
    if (game.pendingEvents.length) setTimeout(() => this.showEventChoice(game.pendingEvents[0]), 600);
  }

  // ---------------------------------------------------------------- events
  listen(g) {
    const on = (k, f) => this.offs.push(g.bus.on(k, f));
    const P = g.playerId;
    on('tech', ({ tribe, key }) => { if (tribe.id !== P) return; sfx('tech'); toast('Discovery: ' + TECH[key].name, TECH[key].desc, { icon: 'technology', kind: 'good', onClick: () => this.openPanel('technology') }); const s = g.settlements.get(tribe.capital); if (s) g.fx.push({ kind: 'unlock', x: s.x + 0.5, y: s.y + 0.5, t: 0, life: 1.6 }); });
    on('stage', ({ tribe }) => { if (tribe.id !== P) { toast(`${tribe.name} advance`, `The ${tribe.name} have become ${STAGES[tribe.stage].name === 'Established Civilisation' ? 'an' : 'a'} ${STAGES[tribe.stage].name}.`, { icon: 'star' }); return; } sfx('stage'); this.celebrateStage(tribe); this.app.save('auto', true); });
    on('built', ({ b, tribe }) => { if (tribe.id === P) { sfx('built', { vol: 0.6 }); if (BUILDINGS[b.type].unique || BUILDINGS[b.type].cat === 'culture') toast(BUILDINGS[b.type].name + ' completed', '', { icon: 'build', kind: 'good' }); } });
    on('war', ({ a, b }) => { const ta = g.tribes[a], tb = g.tribes[b]; if (a === P || b === P) { sfx('war'); setMusicMood('war'); toast('War!', `${ta.name} declared war on the ${tb.name}.`, { icon: 'military', kind: 'bad', ms: 8000, onClick: () => this.openPanel('military') }); this.app.save('auto', true); } else toast('War between rivals', `${ta.name} declared war on the ${tb.name}.`, { icon: 'military' }); });
    on('peace', ({ a, b }) => { if (a === P || b === P) { sfx('diplomacy'); if (!g.player.atWar) setMusicMood(g.player.key); toast('Peace', `${g.tribes[a].name} and ${g.tribes[b].name} have made peace.`, { icon: 'peace', kind: 'good' }); } });
    on('treaty', ({ type, a, b }) => { if ((a === P || b === P) && type !== 'tribute') { sfx('diplomacy'); toast('Treaty signed', `${g.tribes[a === P ? b : a].name}: ${{ trade: 'Trade Agreement', nap: 'Non-Aggression Pact', alliance: 'Alliance' }[type]}`, { icon: 'diplomacy', kind: 'good' }); } });
    on('tension', ({ from, level, reason }) => { const o = g.tribes[from]; sfx(level === 'high' ? 'bad' : 'diplomacy'); toast(level === 'high' ? `The ${o.name} are preparing for war` : `Relations with the ${o.name} are deteriorating`, `Their envoys speak of grievances ${reason}. Gifts, treaties or a stronger army may deter them.`, { icon: 'warning', kind: 'bad', ms: 9000, onClick: () => this.openPanel('diplomacy') }); });
    on('envoy', ({ lines }) => { if (performance.now() - (this.state.lastEnvoy || 0) > 20000) { this.state.lastEnvoy = performance.now(); toast('Your envoy reports', lines.slice(0, 2).join('; ') + '.', { icon: 'scroll', ms: 6000, onClick: () => this.openPanel('diplomacy') }); } });
    on('proposal', ({ from, p }) => { if (p.ultimatum) { sfx('war'); toast(`Ultimatum from the ${g.tribes[from].name}`, proposalText(p), { icon: 'military', kind: 'bad', ms: 12000, onClick: () => this.openPanel('diplomacy') }); this.badge('diplomacy', g.pendingProposals.length); return; } sfx('diplomacy'); toast(`Envoy from the ${g.tribes[from].name}`, proposalText(p), { icon: 'scroll', ms: 9000, onClick: () => this.openPanel('diplomacy') }); this.badge('diplomacy', g.pendingProposals.length); });
    on('eventChoice', () => { const pe = g.pendingEvents[g.pendingEvents.length - 1]; if (pe) this.showEventChoice(pe); });
    on('event', ({ title, text, icon, kind, global }) => { sfx(kind === 'bad' ? 'bad' : 'event'); toast(title, text, { icon: icon || 'scroll', kind: kind === 'bad' ? 'bad' : kind === 'good' ? 'good' : '', ms: 7000 }); });
    on('shortage', () => { if (performance.now() - (this.state.lastShort || 0) > 30000) { this.state.lastShort = performance.now(); sfx('bad'); toast('Famine looms', 'Your people are going hungry. Assign more food workers or build farms.', { icon: 'warning', kind: 'bad', onClick: () => this.openPanel('population') }); } });
    on('milestone', ({ text }) => toast('Milestone', text, { icon: 'star', kind: 'good' }));
    on('founded', ({ t, s }) => { if (t.id === P) { toast('New settlement', `${s.name} has been founded.`, { icon: 'settle', kind: 'good' }); this.app.save('auto', true); } });
    on('captured', ({ tribe, loser, s }) => { if (tribe.id === P) toast('Victory', `You captured ${s.name}!`, { icon: 'flag', kind: 'good' }); else if (loser.id === P) { sfx('bad'); toast('Settlement lost', `${s.name} fell to the ${tribe.name}.`, { icon: 'skull', kind: 'bad', ms: 9000 }); } });
    on('sacked', ({ tribe, s }) => { if (s.tribe === P) { sfx('bad'); toast('Capital sacked!', `The ${tribe.name} plundered ${s.name}.`, { icon: 'fire', kind: 'bad', ms: 9000 }); } else if (tribe.id === P) toast('Plunder', `You sacked ${s.name}.`, { icon: 'coin', kind: 'good' }); });
    on('eliminated', ({ tribe }) => { if (tribe.id === P) this.defeat(); else toast('A civilisation falls', `The ${tribe.name} are no more.`, { icon: 'skull', ms: 9000 }); });
    on('allyCall', ({ victim, aggressor }) => this.allyCall(victim, aggressor));
    on('campaign', ({ tribe, target }) => { if (target.tribe === P) { sfx('war'); toast('Invasion!', `A ${tribe.name} army marches on ${target.name}!`, { icon: 'military', kind: 'bad', ms: 8000, onClick: () => this.renderer.flyTo(target.x, target.y, 3) }); } });
    on('sfx', ({ k, x, y }) => { const r = this.renderer; if (!r.view) return; const X = x * TILE, Y = y * TILE; if (X < r.view.x0 || X > r.view.x1 || Y < r.view.y0 || Y > r.view.y1 || r.cam.zoom < 2.5) return; sfx(k, { vol: Math.min(1, r.cam.zoom / 6) * 0.6, pan: Math.max(-1, Math.min(1, (X - r.cam.x) / ((r.view.x1 - r.view.x0) / 2))) }); });
    on('placed', ({ tribe }) => { if (tribe.id === P) sfx('place'); });
    on('depleted', ({ tribe, res }) => { if (tribe.id === P && performance.now() - (this.state['dep' + res] || 0) > 60000) { this.state['dep' + res] = performance.now(); toast('Deposit exhausted', `A ${RESOURCES[res].name} deposit has run dry.`, { icon: res }); } });
  }

  badge(panel, n) { const b = $(`.rail [data-panel="${panel}"] .badge`, this.root); if (!b) return; b.textContent = n; b.classList.toggle('hidden', !n); }

  // ---------------------------------------------------------------- update
  update(dt) {
    const g = this.game; if (!g) return;
    this.uiTimer -= dt;
    this.drawClock();
    if (this.uiTimer > 0) return;
    this.uiTimer = 0.25;
    const t = g.player;
    $('#tb-stage', this.root).textContent = `${STAGES[t.stage].name} · ${t.def.leaderTitle} ${t.leader?.name || ''}`;
    $('#tb-when', this.root).textContent = g.seasonName;
    $('#tb-year', this.root).textContent = `Year ${g.year} · Day ${g.day % DAYS_PER_YEAR + 1}`;
    $$('[data-speed]', this.root).forEach(b => b.classList.toggle('on', +b.dataset.speed === g.speed));
    const vals = this.resValues();
    for (const [k, v] of Object.entries(vals)) {
      const el = $(`[data-res="${k}"]`, this.root); if (!el) continue;
      const vv = $('.v', el), dd = $('.d', el);
      const txt = k === 'happy' ? Math.round(v.v) + '%' : fmt(v.v);
      if (vv.textContent !== txt) { vv.textContent = txt; }
      dd.textContent = v.d == null ? '' : sign(v.d);
      dd.className = 'd num ' + (v.d > 0.05 ? 'good' : v.d < -0.05 ? 'bad' : 'faint');
      el.classList.toggle('short', !!v.short);
      el.style.display = v.hide ? 'none' : '';
    }
    // minimap
    const mm = $('#mm', this.root); const src = this.renderer.minimap;
    if (src) {
      if (mm.width !== src.width) { mm.width = src.width; mm.height = src.height; }
      const c = mm.getContext('2d'); c.imageSmoothingEnabled = false; c.drawImage(src, 0, 0);
      const v = this.renderer.view;
      if (v) { c.strokeStyle = '#fff4c0'; c.lineWidth = 1; c.strokeRect(v.x0 / TILE, v.y0 / TILE, (v.x1 - v.x0) / TILE, (v.y1 - v.y0) / TILE); }
      for (const ar of g.armies) { let sx = 0, sy = 0, n = 0; for (const a of g.agents.values()) if (a.army === ar.id) { sx += a.x; sy += a.y; n++; } if (n) { c.fillStyle = (performance.now() / 300 | 0) % 2 ? '#fff' : TRIBES[ar.tribe].color; c.fillRect(sx / n - 1.5, sy / n - 1.5, 3, 3); } }
    }
    if (this.panel) this.renderPanel(false);
    if (this.selected) this.renderInspector();
    if (this.placing) this.updatePlaceHint();
    this.badge('diplomacy', g.pendingProposals.filter(p => p.to === g.playerId).length);
    const warn = this.warnings().filter(w => w.bad).length; this.badge('overview', warn);
    refreshTip();
  }

  resValues() {
    const t = this.game.player, r = t.rates, s = t.stock;
    const foodRate = FOOD_KEYS.reduce((a, k) => a + (r[k] || 0), 0);
    const food = foodTotal(t);
    return {
      food: { v: food, d: foodRate, short: food < dailyFoodNeed(this.game, t) * 1.5 },
      wood: { v: s.wood || 0, d: r.wood }, stone: { v: s.stone || 0, d: r.stone }, clay: { v: s.clay || 0, d: r.clay, hide: !(s.clay > 0) && !t.techs.includes('stoneworking') },
      iron: { v: s.iron || 0, d: r.iron, hide: !t.techs.includes('mining') }, tools: { v: s.tools || 0, d: r.tools },
      coins: { v: s.coins || 0, d: r.coins, hide: !t.techs.includes('currency') && !(s.coins > 0) },
      research: { v: t.research.progress, d: t.researchRate || null },
      pop: { v: t.pop, d: null }, happy: { v: t.happiness, d: null, short: t.happiness < 35 },
    };
  }

  bindResTips() {
    for (const el of $$('.res', this.root)) {
      const k = el.dataset.res;
      tip(el, () => {
        const g = this.game, t = g.player;
        if (k === 'food') {
          const L = t.lastLedger; const need = dailyFoodNeed(g, t);
          return `<div class="tt-title">${ico('food', 'sm')} Food</div>${FOOD_KEYS.map(f => `<div class="tt-row"><span>${ico(f, 'sm')} ${RESOURCES[f].name}</span><span class="num">${fmt(t.stock[f] || 0)} <span class="${(t.rates[f] || 0) >= 0 ? 'good' : 'bad'}">${sign(t.rates[f] || 0)}</span></span></div>`).join('')}
            <div class="divider"></div><div class="tt-row"><span>Eaten per day</span><span class="num">${fmt(need, 1)}</span></div><div class="tt-row"><span>Days of reserve</span><span class="num">${fmt(foodTotal(t) / Math.max(1, need), 1)}</span></div><div class="tt-row"><span>Spoiled yesterday</span><span class="num">${fmt(L?.spoiled || 0, 1)}</span></div>`;
        }
        if (k === 'pop') return `<div class="tt-title">${ico('population', 'sm')} Population</div><div class="tt-row"><span>Adults</span><span>${t.adults}</span></div><div class="tt-row"><span>Children</span><span>${t.children}</span></div><div class="tt-row"><span>Elders</span><span>${t.elders}</span></div><div class="tt-row"><span>Housing</span><span>${t.pop} / ${t.housing}</span></div><div class="tt-row"><span>Homeless</span><span class="${t.homeless ? 'bad' : ''}">${t.homeless}</span></div>`;
        if (k === 'happy') return `<div class="tt-title">${ico('happy', 'sm')} Happiness ${Math.round(t.happiness)}%</div>${Object.entries(t.happyParts || {}).filter(([n]) => n !== 'base').map(([n, v]) => `<div class="tt-row"><span>${cap(n)}</span><span class="${v >= 0 ? 'good' : 'bad'}">${sign(v)}</span></div>`).join('')}<div class="divider"></div><div class="tt-row"><span>Stability</span><span>${Math.round(t.stability)}</span></div><div class="tt-row"><span>Productivity</span><span>${Math.round(t.productivity * 100)}%</span></div>`;
        if (k === 'research') { const c = t.research.current; return `<div class="tt-title">${ico('research', 'sm')} Research</div>${c ? `<div>${TECH[c].name}: ${fmt(t.research.progress)} / ${techCost(t, c)}</div>` : '<div class="warn">No research selected</div>'}<div class="tt-row"><span>Research per day</span><span class="good">${fmt(t.researchRate || 0, 1)}</span></div>`; }
        const res = RESOURCES[k];
        return `<div class="tt-title">${ico(k, 'sm')} ${res.name}</div><div class="tt-row"><span>Stock</span><span class="num">${fmt(t.stock[k] || 0)} / ${k === 'coins' ? 'no limit' : fmt(t._cap || 0)}</span></div><div class="tt-row"><span>Change per day</span><span class="${(t.rates[k] || 0) >= 0 ? 'good' : 'bad'}">${sign(t.rates[k] || 0)}</span></div><div class="tt-row"><span>Produced yesterday</span><span>${fmt(t.lastLedger?.prod[k] || 0, 1)}</span></div><div class="tt-row"><span>Used yesterday</span><span>${fmt(t.lastLedger?.cons[k] || 0, 1)}</span></div>`;
      });
      el.onclick = () => this.openPanel(k === 'pop' || k === 'happy' ? 'population' : k === 'research' ? 'technology' : 'economy');
    }
  }

  drawClock() {
    const cv = $('.dial canvas', this.root); if (!cv) return;
    const c = cv.getContext('2d'); const f = this.game.dayFrac;
    c.clearRect(0, 0, 18, 18);
    c.fillStyle = '#07080c'; c.beginPath(); c.arc(9, 9, 9, 0, 7); c.fill();
    const sky = this.renderer.darkness() > 0.3 ? '#1a2a5a' : '#5a9ad8';
    c.fillStyle = sky; c.beginPath(); c.arc(9, 9, 7.5, 0, 7); c.fill();
    c.fillStyle = '#3a6a2a'; c.fillRect(1, 10, 16, 7);
    const a = f * Math.PI * 2 - Math.PI / 2 - Math.PI * 0.12;
    const sx = 9 + Math.cos(a) * 5.5, sy = 9 + Math.sin(a) * 5.5;
    c.fillStyle = '#f8d050'; c.fillRect(Math.round(sx) - 1, Math.round(sy) - 1, 3, 3);
    const mx = 9 - Math.cos(a) * 5.5, my = 9 - Math.sin(a) * 5.5;
    c.fillStyle = '#e8eef8'; c.fillRect(Math.round(mx) - 1, Math.round(my) - 1, 2, 2);
    c.strokeStyle = '#c4983e'; c.lineWidth = 1; c.beginPath(); c.arc(9, 9, 8.5, 0, 7); c.stroke();
  }

  warnings() {
    const g = this.game, t = g.player, W = [];
    const need = dailyFoodNeed(g, t), food = foodTotal(t);
    if (t.foodSat < 0.98) W.push({ bad: true, icon: 'food', text: 'Your people are starving.' });
    else if (food < need * 2) W.push({ bad: false, icon: 'food', text: `Only ${fmt(food / Math.max(1, need), 1)} days of food remain.` });
    if (t.homeless > 0) W.push({ bad: t.homeless > 3, icon: 'house', text: `${t.homeless} people have no home.` });
    const idle = (t.jobCounts.idle || 0) - t.children; if (idle > 2) W.push({ bad: false, icon: 'idle', text: `${idle} adults have no work.` });
    if (!t.research.current) W.push({ bad: false, icon: 'technology', text: 'No research selected.' });
    if (t.happiness < 35) W.push({ bad: true, icon: 'sad', text: 'Unrest grows: happiness is low.' });
    if (t.threat) W.push({ bad: true, icon: 'military', text: 'Enemies are inside your lands!' });
    if ((t.stock.wood || 0) < 15) W.push({ bad: false, icon: 'wood', text: 'Wood is nearly exhausted.' });
    if (t.lastLedger?.wasted > 5) W.push({ bad: false, icon: 'warning', text: 'Storage is full — goods are being lost. Build storehouses.' });
    return W;
  }

  // ---------------------------------------------------------------- panels
  openPanel(key) {
    if (this.panel === key) { this.closePanel(); return; }
    this.cancelPlacing();
    this.panel = key; this.panelState = this.panelState || {};
    sfx('open');
    $$('.rail .rb', this.root).forEach(b => b.classList.toggle('on', b.dataset.panel === key));
    const P = PANELS[key];
    const host = $('#panel-host', this.root);
    host.innerHTML = '';
    const el = h(P.full
      ? `<div class="fullscreen-panel frame"><div class="sp-head" style="display:flex;align-items:center;gap:10px;border-bottom:2px solid var(--gold-deep);padding-bottom:8px;margin-bottom:8px">${ico(P.icon, 'lg')}<div class="panel-title">${P.title}</div><div class="grow" style="flex:1"></div><button class="btn sm" data-act="close-panel">${ico('close', 'sm')}</button></div><div class="sp-body" style="flex:1;min-height:0;display:flex;flex-direction:column"></div></div>`
      : `<div class="side-panel frame ${P.wide ? 'wide' : ''}"><div class="sp-head">${ico(P.icon, 'lg')}<div><div class="panel-title">${P.title}</div><div class="sub">${P.sub || ''}</div></div><div class="grow"></div><button class="btn sm icon" data-act="close-panel">${ico('close', 'sm')}</button></div><div class="sp-body scroll"></div></div>`);
    host.appendChild(el);
    this.panelEl = el;
    el.addEventListener('click', e => this.onPanelClick(e));
    el.addEventListener('input', e => this.onPanelInput(e));
    this.renderPanel(true);
    this.root.classList.toggle('full-open', !!P.full);
    $('#insp-host .inspector', this.root)?.classList.add('shifted');
  }
  closePanel() {
    if (!this.panel) return;
    sfx('close');
    this.panel = null; $('#panel-host', this.root).innerHTML = ''; this.root.classList.remove('full-open');
    $$('.rail .rb', this.root).forEach(b => b.classList.remove('on'));
    $('#insp-host .inspector', this.root)?.classList.remove('shifted');
    this.cancelPlacing();
  }
  renderPanel(force) {
    const P = PANELS[this.panel]; if (!P || !this.panelEl) return;
    const body = $('.sp-body', this.panelEl);
    if (P.live && !force) { P.live(this, body); return; }
    if (!force && P.static) return;
    const html = P.render(this, this.panelState);
    if (!force && html === this.lastPanelHTML) return;
    // never replace content while the user is interacting with a control inside it
    if (!force && body.contains(document.activeElement) && document.activeElement.tagName === 'INPUT') return;
    this.lastPanelHTML = html;
    const st = body.scrollTop;
    body.innerHTML = html;
    body.scrollTop = st;
    P.mount?.(this, body);
  }
  onPanelClick(e) {
    const b = e.target.closest('[data-act]'); if (!b) return;
    if (b.dataset.act === 'close-panel') { this.closePanel(); return; }
    const fn = ACTIONS[b.dataset.act];
    if (fn) { sfx('click'); fn(this, b, e); this.renderPanel(true); }
  }
  onPanelInput(e) { const fn = ACTIONS[e.target.dataset.input]; if (fn) fn(this, e.target, e); }

  onHudClick(e) {
    const b = e.target.closest('[data-panel],[data-speed],[data-act]');
    if (!b || b.closest('.side-panel,.fullscreen-panel,.inspector,.place-hint')) { if (b && b.closest('.inspector,.place-hint')) this.onInspectorClick(e); return; }
    sfx('click');
    if (b.dataset.panel) this.openPanel(b.dataset.panel);
    else if (b.dataset.speed) this.setSpeed(+b.dataset.speed);
    else if (b.dataset.act === 'esc') this.escMenu();
    else if (b.dataset.act === 'territory') { this.app.settings.territory = !this.app.settings.territory; this.app.applySettings(); }
    else if (b.dataset.act === 'home') this.goHome();
  }
  setSpeed(i) { this.sim.setSpeed(i); this.update(1); }
  goHome() { const s = this.game.settlements.get(this.game.player.capital); if (s) this.renderer.flyTo(s.x + 0.5, s.y + 1, Math.max(3, this.renderer.cam.tz)); }

  // ---------------------------------------------------------------- placement
  startPlacing(type) {
    this.placing = type;
    this.renderer.ghost = { type, x: 0, y: 0, ok: false };
    this.app.cv.classList.add('place');
    this.updatePlaceHint();
  }
  cancelPlacing() {
    if (!this.placing) return;
    this.placing = null; this.renderer.ghost = null; this.app.cv.classList.remove('place');
    $('#place-host', this.root).innerHTML = '';
  }
  updatePlaceHint() {
    const host = $('#place-host', this.root); const g = this.game; const t = g.player;
    if (this.placing === '__settle') {
      const c = canFound(g, t);
      host.innerHTML = `<div class="place-hint frame thin">${ico('settle')}<div><div class="caps" style="color:var(--gold)">Found a settlement</div><div class="${c.ok ? '' : 'bad'}" style="font-size:0.88em">${c.ok ? 'Costs 80 wood, 40 stone, 40 grain · 8 settlers move' : esc(c.why)}${this.renderer.ghost?.why && c.ok ? ` · <span class="bad">${esc(this.renderer.ghost.why)}</span>` : ''}</div></div><button class="btn sm" data-act="cancel-place">Cancel (Esc)</button></div>`;
      return;
    }
    const def = BUILDINGS[this.placing]; const cost = buildingCost(t, this.placing);
    const why = this.renderer.ghost?.why;
    host.innerHTML = `<div class="place-hint frame thin">${ico('build')}<div><div style="color:var(--gold-hi)">${def.name}</div><div class="cost">${Object.entries(cost).map(([r, v]) => `<span class="${(t.stock[r] || 0) < v ? 'lack' : ''}">${ico(r, 'sm')}${v}</span>`).join('')}${why ? `<span class="bad">· ${esc(why)}</span>` : '<span class="faint">· Shift-click to place several</span>'}</div></div><button class="btn sm" data-act="cancel-place">Cancel (Esc)</button></div>`;
  }

  onHover(w, e) {
    const gh = this.renderer.ghost; if (!gh) return;
    const g = this.game, t = g.player;
    if (gh.type === '__settle') {
      gh.x = Math.floor(w.x); gh.y = Math.floor(w.y);
      const c = siteCheck(g, t, gh.x, gh.y); gh.ok = c.ok; gh.why = c.why;
    } else {
      const s = BUILDINGS[gh.type].size;
      gh.x = Math.floor(w.x - s / 2 + 0.5); gh.y = Math.floor(w.y - s / 2 + 0.5);
      const c = placementCheck(g, t, gh.type, gh.x, gh.y);
      gh.ok = c.ok; gh.why = c.why;
    }
    this.updatePlaceHint();
  }

  onClick(w, e) {
    const g = this.game, t = g.player;
    if (this.placing) {
      const gh = this.renderer.ghost;
      this.onHover(w, e);
      if (this.placing === '__settle') {
        if (!gh.ok) { sfx('error'); toast('Cannot found here', gh.why || '', { kind: 'bad', icon: 'warning', ms: 2500 }); return; }
        this.cancelPlacing();
        this.sim.call('found', gh.x, gh.y).then(r => { if (r.ok) sfx('place'); else { sfx('error'); toast('Cannot found here', r.why, { kind: 'bad', icon: 'warning', ms: 2500 }); } });
        return;
      }
      if (!gh.ok) { sfx('error'); toast('Cannot build here', gh.why || '', { kind: 'bad', icon: 'warning', ms: 2200 }); return; }
      // optimistically mark the footprint so shift-placement can't double-book it before the worker replies
      const sz = BUILDINGS[gh.type].size;
      for (let dy = 0; dy < sz; dy++) for (let dx = 0; dx < sz; dx++) g.world.occ[g.world.idx(gh.x + dx, gh.y + dy)] = -1;
      this.sim.call('place', gh.type, gh.x, gh.y).then(r => { this.sim.occDirty = true; if (!r.ok) { sfx('error'); toast('Cannot build here', r.why || '', { kind: 'bad', icon: 'warning', ms: 2200 }); } });
      if (!e.shiftKey) this.cancelPlacing(); else this.onHover(w, e);
      if (this.panel === 'build') this.renderPanel(true);
      return;
    }
    // selection: agents first, then buildings, then the tile
    const a = g.agentAt(w.x, w.y, 0.8);
    if (a) { this.select({ kind: 'agent', id: a.id }); return; }
    const i = g.world.inb(w.x | 0, w.y | 0) ? g.world.idx(w.x | 0, w.y | 0) : -1;
    if (i >= 0 && g.world.occ[i]) { this.select({ kind: 'building', id: g.world.occ[i] - 1 }); return; }
    // tall sprites: check one tile below
    const i2 = g.world.inb(w.x | 0, (w.y + 1) | 0) ? g.world.idx(w.x | 0, (w.y + 1) | 0) : -1;
    if (i2 >= 0 && g.world.occ[i2]) { this.select({ kind: 'building', id: g.world.occ[i2] - 1 }); return; }
    if (i >= 0) this.select({ kind: 'tile', i }); else this.select(null);
  }
  onRightClick() { if (this.placing) this.cancelPlacing(); else this.select(null); }

  select(s) {
    this.selected = s; this.game.selected = s;
    this.sim.call('watch', s?.kind === 'agent' ? s.id : null);
    if (!s) { $('#insp-host', this.root).innerHTML = ''; return; }
    sfx('click');
    this.renderInspector(true);
  }

  renderInspector(force) {
    const host = $('#insp-host', this.root); const g = this.game; const s = this.selected;
    if (!s) return;
    let html = '';
    if (s.kind === 'agent') {
      const a = g.agents.get(s.id); if (!a) { this.select(null); return; }
      if (this.following === a.id) this.renderer.cam.x += ((a.x * TILE) - this.renderer.cam.x) * 0.2, this.renderer.cam.y += ((a.y * TILE) - this.renderer.cam.y) * 0.2;
      const t = g.tribes[a.tribe]; const y = ageYears(a);
      const home = a.homeId && g.buildings.get(a.homeId), work = a.workId && g.buildings.get(a.workId);
      const partner = a.partner && g.agents.get(a.partner);
      const skills = Object.entries(a.skill).filter(([, v]) => v > 0.05).sort((p, q) => q[1] - p[1]).slice(0, 3);
      const child = y < 10;
      html = `<div class="inspector frame ${this.panel ? 'shifted' : ''}" style="--tribe:${t.color}"><div class="insp-head"><div class="portrait"><img src="${spriteURL('person', t.key, child ? 'idle' : a.job, 0, a.female, child, a.look, null, t.stage, false)}"></div>
        <div style="flex:1"><div class="insp-name">${esc(a.name)}</div><div class="dim" style="font-size:0.86em">${t.def.adjective} ${child ? (a.female ? 'girl' : 'boy') : (JOBS[a.job]?.name || 'Citizen')} · ${Math.floor(y)} years</div><div class="faint" style="font-size:0.8em">${activity(g, a)}</div></div>
        <span class="close-x" data-act="insp-close">${ico('close', 'sm')}</span></div>
        <div class="kv"><span>Health</span><span>${bar(a.health, a.health > 0.6 ? 'green' : 'red')}</span>
        <span>Home</span><span>${home ? BUILDINGS[home.type].name + ' · ' + esc(g.settlements.get(home.sid)?.name || '') : '<span class="bad">Homeless</span>'}</span>
        <span>Workplace</span><span>${work ? BUILDINGS[work.type].name : a.job === 'builder' ? 'Construction sites' : '—'}</span>
        ${partner ? `<span>Partner</span><span>${esc(partner.name)}</span>` : ''}
        ${a.carry ? `<span>Carrying</span><span>${Object.entries(a.carry).map(([r, v]) => ico(r, 'sm') + ' ' + v.toFixed(1)).join(' ')}</span>` : ''}
        ${skills.length ? `<span>Skills</span><span>${skills.map(([k, v]) => `${JOBS[k]?.name || k} ${Math.round(v * 100)}%`).join(', ')}</span>` : ''}
        ${a.job === 'soldier' ? `<span>Vigour</span><span>${Math.max(0, Math.round(a.hp))} · ${a.kills || 0} victories</span>` : ''}
        </div><div class="row" style="margin-top:8px"><button class="btn xs ${this.following === a.id ? 'on' : ''}" data-act="insp-follow">${ico('eye', 'sm')} Follow</button></div></div>`;
    } else if (s.kind === 'building') {
      const b = g.buildings.get(s.id); if (!b) { this.select(null); return; }
      html = `<div class="inspector frame ${this.panel ? 'shifted' : ''}" style="--tribe:${TRIBES[b.tribe].color}">${buildingTip(this, b, true)}</div>`;
    } else if (s.kind === 'tile') {
      const w = g.world; const i = s.i; const b = w.biome[i]; const bd = BIOMES[b];
      const dep = w.deposit[i] ? DEPOSITS[w.deposit[i]] : null; const o = w.owner[i];
      html = `<div class="inspector frame ${this.panel ? 'shifted' : ''}"><div class="insp-head"><div style="flex:1"><div class="insp-name">${bd.name}</div><div class="dim" style="font-size:0.86em">${o >= 0 ? 'Territory of the ' + g.tribes[o].name : 'Unclaimed land'} · (${i % w.w}, ${(i / w.w) | 0})</div></div><span class="close-x" data-act="insp-close">${ico('close', 'sm')}</span></div>
        <div class="kv">${bd.fert != null ? `<span>Fertility</span><span>${bar(Math.min(1, bd.fert / 1.25), 'green')}</span>` : ''}
        ${w.trees[i] ? `<span>Timber</span><span>${ico('wood', 'sm')} ${w.trees[i]} / ${w.treeMax[i]}</span>` : ''}
        ${dep ? `<span>Deposit</span><span>${ico(dep.res, 'sm')} ${dep.name} · ${w.depAmt[i]} left${dep.tech && !g.player.techs.includes(dep.tech) ? ` <span class="warn">(needs ${TECH[dep.tech].name})</span>` : ''}</span>` : ''}
        ${w.fauna[i] ? `<span>${isWater(b) ? 'Fish' : 'Wildlife'}</span><span>${bar(w.fauna[i] / 255, 'blue')}</span>` : ''}
        ${bd.defense ? `<span>Defence</span><span>+${Math.round(bd.defense * 100)}% for defenders</span>` : ''}
        <span>Travel</span><span>${bd.walk ? (bd.walk <= 1 ? 'Easy' : bd.walk < 2 ? 'Rough' : 'Difficult') : 'Impassable'}</span></div></div>`;
    }
    if (force || this.lastInspHTML !== html) {
      const first = !host.firstElementChild;
      host.innerHTML = html; this.lastInspHTML = html;
      if (!first && !force) host.firstElementChild.style.animation = 'none';
    }
  }

  onInspectorClick(e) {
    const b = e.target.closest('[data-act]'); if (!b) return;
    const g = this.game; sfx('click');
    const act = b.dataset.act;
    if (act === 'insp-close') this.select(null);
    else if (act === 'insp-follow') { this.following = this.following === this.selected.id ? null : this.selected.id; this.renderInspector(true); }
    else if (act === 'cancel-place') this.cancelPlacing();
    else if (ACTIONS[act]) { ACTIONS[act](this, b, e); this.renderInspector(true); }
  }

  // ---------------------------------------------------------------- keys
  onKey(e) {
    const k = e.key;
    if (modalOpen()) { if (k === 'Escape' && !this.pausedForChoice) closeModal(); return; }
    if (k === 'Escape') { if (this.placing) this.cancelPlacing(); else if (this.selected) this.select(null); else if (this.panel) this.closePanel(); else this.escMenu(); return; }
    if (k === ' ') { e.preventDefault(); this.setSpeed(this.game.speed === 0 ? (this.lastSpeed || 1) : (this.lastSpeed = this.game.speed, 0)); return; }
    if (k === '1' || k === '2' || k === '3') { this.setSpeed(+k); return; }
    if (k === 'F5') { e.preventDefault(); this.app.save('quick'); return; }
    if (/^F[1-9]$/.test(k)) { e.preventDefault(); this.openPanel(RAIL[+k.slice(1) - 1][0]); return; }
    const map = { b: 'build', p: 'population', o: 'economy', t: 'technology', g: 'diplomacy', l: 'government', m: 'military', c: 'chronicle' };
    if (map[k.toLowerCase()] && !e.ctrlKey) { this.openPanel(map[k.toLowerCase()]); return; }
    if (k.toLowerCase() === 'h') this.goHome();
  }

  // ---------------------------------------------------------------- dialogs
  async escMenu() {
    const prev = this.game.speed; this.sim.setSpeed(0);
    const r = await modal(`<div class="esc-menu"><div class="logo" style="margin-bottom:6px"><div class="word" style="font-size:52px">CivSim</div><div class="sub">${esc(this.game.runName)}</div></div>
      <button class="btn" data-v="resume">${ico('play')} Resume</button>
      <div class="caps" style="color:var(--gold);margin-top:6px">Save to slot</div>
      <div class="seg">${['quick', 's1', 's2', 's3'].map(s => `<button class="btn sm" data-v="save:${s}">${ico('save', 'sm')} ${SLOT_NAMES[s].replace('Slot ', '')}</button>`).join('')}</div>
      <button class="btn" data-v="settings">${ico('menu')} Settings</button>
      <button class="btn" data-v="exit">${ico('house')} Save & exit to menu</button></div>`,
    { onMount: m => m.querySelectorAll('[data-v]').forEach(b => b.onclick = () => { sfx('click'); closeModal(b.dataset.v); }) });
    this.sim.setSpeed(prev);
    if (r?.startsWith('save:')) this.app.save(r.slice(5));
    else if (r === 'settings') openSettings(this.app, () => {});
    else if (r === 'exit') this.app.exitToMenu();
  }

  async showEventChoice(pe) {
    const g = this.game; const ev = EVENTS.find(e => e.key === pe.key); if (!ev) return;
    if (modalOpen()) { setTimeout(() => this.showEventChoice(pe), 1500); return; }
    const t = g.tribes[pe.tribe];
    if (this.app.settings.pauseOnEvent) this.pausedForChoice = true;
    sfx(ev.kind === 'bad' ? 'bad' : 'event');
    const text = pe.text || '';
    const idx = await modal(`<div class="modal-head">${ico(ev.icon || 'scroll', 'xl')}<div><div class="caps" style="color:var(--gold)">Year ${g.year}, ${g.seasonName}</div><div class="panel-title">${esc(ev.title)}</div></div></div>
      <div class="prose" style="color:var(--text)"><span class="illum">${esc(text.charAt(0))}</span>${esc(text.slice(1))}</div><div style="clear:both"></div>
      <div class="col" style="margin-top:12px">${ev.choices.map((c, i) => { const ok = !c.can || c.can(g, t); return `<button class="btn choice ${ok ? '' : 'disabled'}" data-i="${i}" ${ok ? '' : 'disabled'}><span>${esc(c.label)}</span><small>${esc(c.desc)}</small></button>`; }).join('')}</div>`,
    { dismissable: false, onMount: m => m.querySelectorAll('[data-i]').forEach(b => b.onclick = () => { if (!b.disabled) { sfx('click'); closeModal(+b.dataset.i); } }) });
    this.pausedForChoice = false;
    const res = await this.sim.call('resolveChoice', pe.key, pe.tick, idx);
    if (res) toast(ev.title, res, { icon: ev.icon });
  }

  async allyCall(victim, aggressor) {
    const g = this.game;
    const yes = await confirmDialog('An ally calls for aid', `The <em>${g.tribes[aggressor].name}</em> have attacked your ally, the <em>${g.tribes[victim].name}</em>. Honour the alliance and declare war? Refusing will break the alliance and damage your reputation.`, 'Honour the alliance');
    this.sim.call('allyCall', victim, aggressor, !!yes);
  }

  celebrateStage(t) {
    const st = STAGES[t.stage];
    modal(`<div style="text-align:center"><img src="${emblemURL(t.key)}" width="96" height="96" class="pix" style="filter:drop-shadow(0 0 20px ${t.color})">
      <div class="caps" style="color:var(--gold);margin-top:8px">The ${t.name} have become</div><div class="panel-title" style="font-size:3em;margin:6px 0">${st.name}</div>
      <div class="prose">${st.desc}</div><div class="divider"></div>
      <div class="section-title">Now unlocked</div><div class="col" style="align-items:center">${st.unlocks.map(u => `<span class="chip green">${esc(u)}</span>`).join('')}</div>
      <div class="modal-actions" style="justify-content:center"><button class="btn primary" data-v="1">Onward</button></div></div>`,
    { onMount: m => m.querySelector('[data-v]').onclick = () => closeModal() });
  }

  defeat() {
    const g = this.game; this.sim.setSpeed(0);
    sfx('bad');
    modal(`<div style="text-align:center"><div class="panel-title" style="font-size:3em">The Chronicle Ends</div><div class="prose" style="margin:12px 0">The last of the ${g.player.name} are gone. Their story endured ${g.year} years. The world will remember them.</div>
      <div class="modal-actions" style="justify-content:center"><button class="btn" data-v="watch">Keep watching</button><button class="btn primary" data-v="menu">Return to menu</button></div></div>`,
    { dismissable: false, onMount: m => m.querySelectorAll('[data-v]').forEach(b => b.onclick = () => { closeModal(); if (b.dataset.v === 'menu') this.app.exitToMenu(); else this.sim.setSpeed(1); }) });
  }
}

const cap = s => s.charAt(0).toUpperCase() + s.slice(1);
export function proposalText(p) {
  switch (p.type) {
    case 'trade': return 'They propose a Trade Agreement.';
    case 'nap': return 'They propose a Non-Aggression Pact.';
    case 'alliance': return 'They seek an Alliance.';
    case 'peace': return p.terms === 'tribute_a' ? 'They sue for peace and offer tribute.' : p.terms === 'tribute_b' ? 'They offer peace — if you pay tribute.' : 'They offer a white peace.';
    case 'gift': return `They send a gift of ${p.amt} ${RESOURCES[p.res].name}.`;
    case 'tribute': return p.ultimatum ? `Ultimatum: pay tribute for ten days or face war (${p.reason || 'they covet your lands'}).` : 'They demand that you pay tribute.';
    case 'exchange': return `They offer ${Object.entries(p.give).map(([k, v]) => v + ' ' + RESOURCES[k].name).join(', ')} for ${Object.entries(p.get).map(([k, v]) => v + ' ' + RESOURCES[k].name).join(', ')}.`;
    default: return 'They wish to speak with you.';
  }
}
function activity(g, a) {
  if (a.army) return 'Marching to war';
  switch (a.state) {
    case 'sleep': return a.hidden ? 'Sleeping at home' : 'Sleeping by the hearth';
    case 'work': return a.task?.kind === 'trees' ? 'Felling a tree' : a.task?.kind === 'field' ? 'Tending the fields' : a.task?.kind === 'deposit' ? 'Mining' : a.task?.drill ? 'Drilling' : a.task?.kind === 'fish' ? 'Fishing' : a.task?.kind === 'game' ? 'Hunting' : a.task?.kind === 'wild' ? 'Foraging' : 'Working';
    case 'build': return 'Constructing';
    case 'walk': return a.carry ? 'Hauling goods to storage' : a.task?.act === 'social' ? 'Off to chat with neighbours' : a.task?.act === 'home' ? 'Heading home' : 'Walking';
    case 'wait': return a.bubble > 0 ? 'Chatting' : 'Resting';
    case 'travel': return 'Away with a trade caravan';
    case 'fight': return 'Defending the settlement';
    default: return 'Thinking';
  }
}
