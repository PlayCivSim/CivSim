// Notification centre, happiness breakdown, manpower summary and top-bar
// customisation. The notification centre reads the shared event record
// (game.history, see sim/records.js) — it keeps no list of its own.
import { esc, fmt, sign, bar, modal, closeModal, toggleHTML } from './dom.js';
import { ico, emblemURL } from './icons.js';
import { PANELS, ACTIONS } from './panels.js';
import { CATEGORIES, categoryOf, involves, isAlert } from '../sim/records.js';
import { DAYS_PER_YEAR } from '../core/constants.js';
import { mod } from '../sim/economy.js';
import { fmtDate, dur, agoText } from '../core/calendar.js';

const CAT = Object.fromEntries(CATEGORIES.map(c => [c.key, c]));
export const ago = (g, day) => agoText(g.day - day);

// ---------------------------------------------------------------- unread state
// Saved in the run (game.seenSeq, set through the 'markSeen' command). The UI
// keeps its own copy so the badge clears at once; older runs fall back to the
// value Stage 1 kept in localStorage.
const localSeen = new Map();
export function seenSeq(g) {
  let legacy = 0; try { legacy = +localStorage.getItem('civsim.seen.' + g.runId) || 0; } catch { /* no storage */ }
  return Math.max(g.seenSeq || 0, localSeen.get(g.runId) || 0, legacy);
}
function markSeen(hud, seq) { const g = hud.game; if (seq <= seenSeq(g)) return; localSeen.set(g.runId, seq); hud.sim.call('markSeen', seq); }

// Records shown in the centre: anything that concerns the player, plus major world news.
export function playerNotices(g) {
  const P = g.playerId;
  return g.history.filter(e => involves(e, P) || e.imp >= 3);
}
export function unread(g) {
  const s = seenSeq(g); let n = 0, alerts = 0; const P = g.playerId;
  for (let i = g.history.length - 1; i >= 0; i--) {
    const e = g.history[i]; if (e.seq <= s) break;
    if (involves(e, P) || e.imp >= 3) { n++; if (isAlert(e, P)) alerts++; }
  }
  return { n, alerts };
}

PANELS.notices = {
  title: 'Notices', icon: 'bell', sub: 'Dispatches from your realm and beyond', wide: true,
  render(hud, st) {
    const g = hud.game, P = g.playerId;
    st.nc = st.nc || 'all'; st.nscope = st.nscope || 'mine'; st.nq = st.nq || '';
    const q = st.nq.trim().toLowerCase();
    const seen = st.nSeenAtOpen ?? seenSeq(g);
    const base = st.nscope === 'mine' ? playerNotices(g) : g.history;
    const counts = {};
    for (const e of base) counts[categoryOf(e)] = (counts[categoryOf(e)] || 0) + 1;
    const list = base.filter(e => (st.nc === 'all' || (st.nc === 'alert' ? isAlert(e, P) : categoryOf(e) === st.nc)) && (!q || e.text.toLowerCase().includes(q))).slice(-200).reverse();
    const chip = (k, name, icon, n) => `<button class="btn xs ${st.nc === k ? 'on' : ''}" data-act="n-cat" data-c="${k}">${icon ? ico(icon, 'sm') : ''}${name}${n != null ? ` <small class="faint">${n}</small>` : ''}</button>`;
    return `<div class="notice-tools">
        <div class="seg">${[['mine', 'My realm'], ['all', 'Whole world']].map(([k, n]) => `<button class="btn xs ${st.nscope === k ? 'on' : ''}" data-act="n-scope" data-s="${k}">${n}</button>`).join('')}</div>
        <label class="search">${ico('eye', 'sm')}<input type="text" data-input="n-search" placeholder="Search notices…" value="${esc(st.nq)}"></label>
      </div>
      <div class="row" style="flex-wrap:wrap;gap:4px;margin:8px 0">${chip('all', 'All')}${chip('alert', 'Alerts', 'warning')}${CATEGORIES.map(c => chip(c.key, c.name, c.icon, counts[c.key] || 0)).join('')}</div>
      <div class="notice-list">${list.map(e => {
        const c = CAT[categoryOf(e)], al = isAlert(e, P), t = g.tribes[e.tribe];
        return `<div class="notice ${al ? 'alert' : ''} ${e.seq > seen ? 'new' : ''}" style="--nc:${c.col}">
          <span class="n-ico">${ico(al ? 'warning' : c.icon, 'sm')}</span>
          <div class="n-main"><div class="n-txt">${esc(e.text)}</div>
          <div class="n-meta">${t ? `<img src="${emblemURL(t.key)}" width="12" class="pix">` : ''}<span>${c.name}</span><span>·</span><span>${fmtDate(e.day * 360)}, Yr ${Math.floor(e.day / DAYS_PER_YEAR) + 1}</span><span>·</span><span class="${g.day - e.day > 10 ? 'faint' : ''}">${ago(g, e.day)}</span></div></div></div>`;
      }).join('') || '<div class="prose faint">No notices match.</div>'}</div>`;
  },
  mount(hud) {
    const g = hud.game, st = hud.panelState;
    if (st.nSeenAtOpen == null) st.nSeenAtOpen = seenSeq(g);
    const last = g.history[g.history.length - 1]; if (last) markSeen(hud, last.seq);
    hud.updateBell?.();
  },
};
ACTIONS['n-cat'] = (hud, b) => { hud.panelState.nc = b.dataset.c; };
ACTIONS['n-scope'] = (hud, b) => { hud.panelState.nscope = b.dataset.s; };
ACTIONS['n-search'] = (hud, el) => { hud.panelState.nq = el.value; hud.renderPanel(true); const i = hud.panelEl?.querySelector('[data-input="n-search"]'); if (i) { i.focus(); i.setSelectionRange(i.value.length, i.value.length); } };

// ---------------------------------------------------------------- happiness
const HAPPY_INFO = {
  food: ['food', 'Food', 'Starvation weighs heaviest. A few seasons of reserve bring comfort.'],
  variety: ['fruit', 'Food variety', 'Each extra kind of food in store adds a little cheer.'],
  housing: ['house', 'Housing', 'Share of people without a home.'],
  employment: ['idle', 'Employment', 'Idle adults grow restless.'],
  safety: ['military', 'Safety', 'War and enemies in your lands frighten people; a garrison reassures them.'],
  amenities: ['star', 'Amenities', 'Shrines, markets, wonders and other comforts.'],
  culture: ['star', 'Culture towns', 'Each settlement focused on Culture adds +3.'],
  policy: ['crown', 'Laws & government', 'Effects of enacted laws, government and traits.'],
  crowding: ['population', 'Crowding', 'Larger societies are harder to please.'],
};
export function happinessHTML(t) {
  const parts = Object.entries(t.happyParts || {}).filter(([k]) => k !== 'base');
  const target = Math.max(0, Math.min(100, Object.values(t.happyParts || {}).reduce((a, v) => a + v, 0)));
  const maxAbs = Math.max(10, ...parts.map(([, v]) => Math.abs(v)));
  const rows = parts.sort((a, b) => Math.abs(b[1]) - Math.abs(a[1])).map(([k, v]) => {
    const [icon, name, desc] = HAPPY_INFO[k] || ['happy', k, ''];
    const w = Math.abs(v) / maxAbs * 50;
    return `<div class="hb-row"><span class="hb-name">${ico(icon, 'sm')}<span>${esc(name)}<small>${esc(desc)}</small></span></span>
      <span class="hb-bar"><i class="${v >= 0 ? 'pos' : 'neg'}" style="${v >= 0 ? 'left:50%' : `right:50%`};width:${w.toFixed(1)}%"></i></span>
      <span class="num ${v > 0.05 ? 'good' : v < -0.05 ? 'bad' : 'faint'}">${sign(v)}</span></div>`;
  }).join('');
  const trend = target - t.happiness;
  return `<div class="hb-head"><div><div class="display" style="font-size:2.4em;line-height:1">${Math.round(t.happiness)}%</div><div class="caps faint">Happiness</div></div>
      <div class="prose" style="font-size:0.88em;flex:1">Settling toward <b>${Math.round(target)}%</b> ${Math.abs(trend) < 1 ? '(steady)' : trend > 0 ? '<span class="good">(rising)</span>' : '<span class="bad">(falling)</span>'}. Everyone starts from a base of 50; each factor below adds or subtracts.</div></div>
    <div class="hb-list">${rows}</div>
    <div class="divider"></div>
    <div class="kv" style="font-size:0.9em"><span>Stability</span><span>${Math.round(t.stability)}</span><span>Productivity</span><span>${Math.round(t.productivity * 100)}%</span></div>
    <div class="faint" style="font-size:0.8em;margin-top:4px">Below 35% unrest grows and families may leave. High happiness raises productivity.</div>`;
}
export function openHappiness(hud) {
  const draw = m => { m.querySelector('.hb-body').innerHTML = happinessHTML(hud.game.player); };
  let iv;
  modal(`<div class="modal-head">${ico('happy', 'xl')}<div><div class="caps" style="color:var(--gold)">${esc(hud.game.player.name)}</div><div class="panel-title">The people's mood</div></div><div class="grow"></div><button class="btn sm icon" data-x>${ico('close', 'sm')}</button></div><div class="hb-body"></div>`,
    { onMount: m => { draw(m); m.querySelector('[data-x]').onclick = () => closeModal(); iv = setInterval(() => { if (!document.body.contains(m)) clearInterval(iv); else draw(m); }, 1000); } })
    .then(() => clearInterval(iv));
}

// ---------------------------------------------------------------- manpower
export function manpower(t) {
  const soldiers = t.jobCounts?.soldier || 0;
  const adults = t.adults || 0;
  const cap = t.slots?.soldier || 0;
  const up = Math.max(0.2, 1 + mod(t, 'upkeep'));
  return {
    pop: t.pop, adults, soldiers, civilians: Math.max(0, adults - soldiers), cap,
    recruitable: Math.max(0, Math.min(cap - soldiers, adults - soldiers)),
    share: adults ? soldiers / adults : 0,
    upkeep: { wood: soldiers * 0.15 * up, coins: t.techs?.includes('currency') ? soldiers * 0.12 * up : 0 },
  };
}
export function manpowerTip(t) {
  const m = manpower(t);
  return `<div class="tt-title">${ico('soldier', 'sm')} Manpower</div>
    <div class="tt-row"><span>Total population</span><span>${m.pop}</span></div>
    <div class="tt-row"><span>Working-age adults</span><span>${m.adults}</span></div>
    <div class="tt-row"><span>Active soldiers</span><span>${m.soldiers}</span></div>
    <div class="tt-row"><span>Civilian workforce</span><span>${m.civilians}</span></div>
    <div class="tt-row"><span>Barracks room</span><span>${m.soldiers} / ${m.cap}</span></div>
    <div class="divider"></div>
    <div class="tt-row"><span>Upkeep per season</span><span class="bad">${ico('wood', 'sm')}${fmt(m.upkeep.wood, 1)}${m.upkeep.coins ? ` ${ico('coins', 'sm')}${fmt(m.upkeep.coins, 1)}` : ''}</span></div>
    <div class="faint" style="font-size:0.85em;max-width:220px">Every soldier is an adult taken from the fields and workshops. ${m.share > 0.25 ? '<span class="warn">Over a quarter of your adults are under arms.</span>' : ''}</div>`;
}

// ---------------------------------------------------------------- top-bar customisation
export const HUD_ITEMS = [
  ['food', 'Food'], ['wood', 'Wood'], ['stone', 'Stone'], ['clay', 'Clay'], ['iron', 'Iron'], ['tools', 'Tools'], ['coins', 'Coins'],
  ['research', 'Research'], ['pop', 'Population'], ['manpower', 'Manpower'], ['happy', 'Happiness'], ['alerts', 'Alert strip'],
];
export const hudHidden = s => new Set(s.hudHidden || []);
export function openHudCustomise(hud) {
  const s = hud.app.settings;
  const draw = m => {
    const hid = hudHidden(s);
    m.querySelector('.hc-list').innerHTML = HUD_ITEMS.map(([k, n]) => `<button class="hc-item ${hid.has(k) ? '' : 'on'}" data-k="${k}">${ico(k === 'pop' ? 'population' : k === 'manpower' ? 'soldier' : k === 'alerts' ? 'warning' : k, 'sm')}<span>${n}</span>${toggleHTML(!hid.has(k))}</button>`).join('');
  };
  modal(`<div class="modal-head">${ico('pin', 'xl')}<div><div class="caps" style="color:var(--gold)">Top bar</div><div class="panel-title">Pin to the top bar</div></div></div>
    <div class="prose" style="font-size:0.9em">Choose what stays in view. Hidden items are still in the Economy and Population panels.</div>
    <div class="hc-list"></div><div class="row" style="justify-content:flex-end;margin-top:10px"><button class="btn sm" data-reset>Restore all</button><button class="btn sm primary" data-x>Done</button></div>`,
  { onMount: m => {
    draw(m);
    m.onclick = e => {
      const it = e.target.closest('[data-k]');
      if (it) { const hid = hudHidden(s); hid.has(it.dataset.k) ? hid.delete(it.dataset.k) : hid.add(it.dataset.k); s.hudHidden = [...hid]; hud.app.applySettings(); hud.applyHudPins(); draw(m); }
      if (e.target.closest('[data-reset]')) { s.hudHidden = []; hud.app.applySettings(); hud.applyHudPins(); draw(m); }
      if (e.target.closest('[data-x]')) closeModal();
    };
  } });
}
