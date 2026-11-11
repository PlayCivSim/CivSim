// Small DOM toolkit: element creation, tooltips, toasts, modals and formatting.
import { ico } from './icons.js';
import { sfx } from '../audio/audio.js';

export const $ = (sel, root = document) => root.querySelector(sel);
export const $$ = (sel, root = document) => [...root.querySelectorAll(sel)];

export function h(html) {
  const t = document.createElement('template');
  t.innerHTML = html.trim();
  return t.content.firstElementChild;
}

export function esc(s) { return String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]); }

export function fmt(n, d = 0) {
  if (n == null || isNaN(n)) return '0';
  const a = Math.abs(n);
  if (a >= 1e6) return (n / 1e6).toFixed(1) + 'M';
  if (a >= 1e4) return (n / 1e3).toFixed(1) + 'k';
  return d ? n.toFixed(d) : Math.floor(n + (n < 0 ? 0.999 : 0)).toString();
}
export function sign(n, d = 1) { if (Math.abs(n) < 0.05) return '±0'; return (n > 0 ? '+' : '') + (Math.abs(n) >= 100 ? Math.round(n) : n.toFixed(d)); }

// ---------------------------------------------------------------- tooltips
// Elements opt in with data-tip="text" or el._tip = () => html.
let tipEl, tipTarget = null;
export function initTooltips() {
  tipEl = document.getElementById('tooltip');
  // touch: press and hold shows the tip and swallows the tap that would follow
  let holdTimer = 0, held = false, hideTimer = 0;
  document.addEventListener('pointerdown', e => {
    if (e.pointerType === 'mouse') return;
    const t = e.target.closest('[data-tip], .has-tip'); if (!t) return;
    held = false; clearTimeout(holdTimer);
    const x = e.clientX, y = e.clientY;
    holdTimer = setTimeout(() => { held = true; tipTarget = t; renderTip(); placeTip(x, y - 70); clearTimeout(hideTimer); hideTimer = setTimeout(() => { tipEl.classList.remove('show'); tipTarget = null; }, 4000); }, 420);
  }, true);
  const cancelHold = () => clearTimeout(holdTimer);
  document.addEventListener('pointerup', cancelHold, true); document.addEventListener('pointercancel', cancelHold, true); document.addEventListener('pointermove', e => { if (e.pointerType !== 'mouse' && Math.abs(e.movementX) + Math.abs(e.movementY) > 6) cancelHold(); }, true);
  document.addEventListener('click', e => { if (held) { held = false; e.stopPropagation(); e.preventDefault(); } }, true);
  document.addEventListener('contextmenu', e => { if (document.body.classList.contains('touch')) e.preventDefault(); });
  document.addEventListener('mouseover', e => {
    if (document.body.classList.contains('touch')) return;
    const t = e.target.closest('[data-tip], .has-tip');
    if (t === tipTarget) return;
    tipTarget = t;
    if (!t) { tipEl.classList.remove('show'); return; }
    renderTip();
  });
  document.addEventListener('mousemove', e => { if (tipTarget) placeTip(e.clientX, e.clientY); });
  document.addEventListener('mousedown', () => { if (document.body.classList.contains('touch')) return; tipEl.classList.remove('show'); tipTarget = null; });
}
function renderTip() {
  const t = tipTarget; if (!t) return;
  const html = t._tip ? t._tip() : esc(t.dataset.tip);
  if (!html) { tipEl.classList.remove('show'); return; }
  tipEl.innerHTML = html;
  tipEl.classList.add('show');
}
const mapTipEl = {}; let mapHTML = '';
// tooltip for things drawn on the map (no DOM element): fn() -> html, or null to hide
export function mapTip(fn, x, y) {
  if (!fn) { if (tipTarget === mapTipEl) { tipTarget = null; tipEl.classList.remove('show'); } return; }
  mapTipEl._tip = fn; tipTarget = mapTipEl;
  const h = fn(); if (h !== mapHTML) { mapHTML = h; renderTip(); }
  placeTip(x, y);
}
export function refreshTip() { if (tipTarget === mapTipEl) { mapHTML = ''; return; } if (tipTarget && document.body.contains(tipTarget)) renderTip(); else if (tipTarget) { tipTarget = null; tipEl.classList.remove('show'); } }
function placeTip(x, y) {
  const r = tipEl.getBoundingClientRect();
  let nx = x + 18, ny = y + 18;
  if (nx + r.width > innerWidth - 8) nx = x - r.width - 12;
  if (ny + r.height > innerHeight - 8) ny = y - r.height - 12;
  tipEl.style.left = Math.max(4, nx) + 'px'; tipEl.style.top = Math.max(4, ny) + 'px';
}
export function tip(el, fn) { el._tip = fn; el.classList.add('has-tip'); return el; }

// ---------------------------------------------------------------- toasts
export function toast(title, body = '', opts = {}) {
  const root = document.getElementById('toasts');
  const el = h(`<div class="toast ${opts.kind || ''}">${opts.icon ? ico(opts.icon, 'lg') : ''}<div><div class="t-title">${esc(title)}</div>${body ? `<div class="t-body">${esc(body)}</div>` : ''}</div></div>`);
  root.appendChild(el);
  while (root.children.length > 3) root.firstElementChild.remove();
  const kill = () => { el.classList.add('out'); setTimeout(() => el.remove(), 300); };
  el.onclick = () => { opts.onClick?.(); kill(); };
  setTimeout(kill, opts.ms || 5200);
  return el;
}

// ---------------------------------------------------------------- modal
let modalResolve = null;
export function modal(html, { onMount, dismissable = true, wide = false } = {}) {
  const root = document.getElementById('modal-root');
  root.innerHTML = '';
  const m = h(`<div class="modal frame" ${wide ? 'style="width:min(760px,94vw)"' : ''}>${html}</div>`);
  root.appendChild(m);
  root.classList.add('show');
  root.onclick = e => { if (e.target === root && dismissable) closeModal(); };
  onMount?.(m);
  sfx('open');
  return new Promise(res => { modalResolve = res; });
}
export function closeModal(v) {
  const root = document.getElementById('modal-root');
  root.classList.remove('show'); root.innerHTML = '';
  const r = modalResolve; modalResolve = null; r?.(v);
}
export const modalOpen = () => document.getElementById('modal-root').classList.contains('show');

export function confirmDialog(title, text, okLabel = 'Confirm', danger = false) {
  return modal(`
    <div class="modal-head">${ico('warning', 'lg')}<div class="panel-title" style="font-size:1.8em">${esc(title)}</div></div>
    <div class="prose">${text}</div>
    <div class="modal-actions"><button class="btn" data-v="0">Cancel</button><button class="btn ${danger ? 'danger' : 'primary'}" data-v="1">${esc(okLabel)}</button></div>`,
  { onMount: m => m.querySelectorAll('[data-v]').forEach(b => b.onclick = () => { sfx('click'); closeModal(b.dataset.v === '1'); }) });
}

export function promptDialog(title, label, value = '') {
  return modal(`
    <div class="modal-head"><div class="panel-title" style="font-size:1.8em">${esc(title)}</div></div>
    <div class="field"><label>${esc(label)}</label><input class="text-input" maxlength="40" value="${esc(value)}"></div>
    <div class="modal-actions"><button class="btn" data-v="0">Cancel</button><button class="btn primary" data-v="1">Confirm</button></div>`,
  { onMount: m => {
    const inp = m.querySelector('input'); inp.focus(); inp.select();
    inp.onkeydown = e => { if (e.key === 'Enter') closeModal(inp.value.trim() || null); };
    m.querySelectorAll('[data-v]').forEach(b => b.onclick = () => closeModal(b.dataset.v === '1' ? (inp.value.trim() || null) : null));
  } });
}

export function bar(frac, cls = '') { return `<div class="bar ${cls}"><i style="width:${Math.max(0, Math.min(100, frac * 100)).toFixed(1)}%"></i></div>`; }

export function toggleHTML(on, label) { return `<span class="toggle ${on ? 'on' : ''}"><span class="box"></span>${label ? `<span>${esc(label)}</span>` : ''}</span>`; }
