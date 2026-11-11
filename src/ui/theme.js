// Generates the UI's pixel-art textures (ornamental frames, plaques,
// parchment, patterns) at runtime and exposes them as CSS custom properties.
import { canvas, Pen, shade } from '../render/pixel.js';
import { hash2 } from '../core/rng.js';

const GOLD = ['#5a3d16', '#8a6526', '#c4983e', '#e8c66a', '#fff0b0'];
const INK = '#12141b', INK2 = '#191c26', INK3 = '#222634';

function url(c) { return `url(${c.toDataURL()})`; }

function panelFrame(accent = null) {
  const S = 24; const c = canvas(S, S); const p = new Pen(c.getContext('2d'));
  // fill with subtle dithered ink
  for (let y = 0; y < S; y++) for (let x = 0; x < S; x++) p.px(x, y, hash2(x, y, 3) > 0.85 ? INK3 : hash2(x, y, 9) > 0.5 ? INK2 : INK);
  // outer dark line, gold double border
  p.outline(0, 0, S, S, '#07080c');
  p.outline(1, 1, S - 2, S - 2, GOLD[1]);
  p.hline(2, 1, S - 4, GOLD[3]); p.vline(1, 2, S - 4, GOLD[2]);
  p.outline(2, 2, S - 4, S - 4, '#07080c');
  p.outline(4, 4, S - 8, S - 8, GOLD[0]);
  // corner ornaments: diamond studs
  for (const [cx, cy] of [[3, 3], [S - 4, 3], [3, S - 4], [S - 4, S - 4]]) {
    p.px(cx, cy - 1, GOLD[3]); p.px(cx - 1, cy, GOLD[2]); p.px(cx + 1, cy, GOLD[2]); p.px(cx, cy + 1, GOLD[1]);
    p.px(cx, cy, accent || GOLD[4]);
  }
  return c;
}

function plaque(state) {
  const S = 18; const c = canvas(S, S); const p = new Pen(c.getContext('2d'));
  const base = state === 'hover' ? '#3a2e1c' : state === 'active' ? '#4a3a1e' : state === 'disabled' ? '#1c1c22' : '#26222a';
  const edge = state === 'disabled' ? ['#2a2a30', '#34343c', '#3c3c44'] : state === 'hover' || state === 'active' ? [GOLD[1], GOLD[3], GOLD[4]] : [GOLD[0], GOLD[1], GOLD[2]];
  for (let y = 0; y < S; y++) for (let x = 0; x < S; x++) p.px(x, y, hash2(x, y, 4) > 0.8 ? shade(base, 0.06) : base);
  p.outline(0, 0, S, S, '#07080c');
  p.outline(1, 1, S - 2, S - 2, edge[0]);
  p.hline(2, 1, S - 4, edge[2]); p.hline(2, S - 2, S - 4, edge[0]);
  p.vline(1, 2, S - 4, edge[1]);
  p.hline(2, 2, S - 4, shade(base, 0.15));
  p.hline(2, S - 3, S - 4, shade(base, -0.3));
  for (const [x, y] of [[1, 1], [S - 2, 1], [1, S - 2], [S - 2, S - 2]]) p.px(x, y, '#07080c');
  return c;
}

function parchment() {
  const S = 18; const c = canvas(S, S); const p = new Pen(c.getContext('2d'));
  for (let y = 0; y < S; y++) for (let x = 0; x < S; x++) { const n = hash2(x, y, 11); p.px(x, y, n > 0.9 ? '#d9c79c' : n > 0.6 ? '#e6d6ae' : '#ecdeba'); }
  p.outline(0, 0, S, S, '#5a3d16'); p.outline(1, 1, S - 2, S - 2, '#b08a4a');
  p.hline(2, 2, S - 4, '#f6ecd0');
  return c;
}

function inset() {
  const S = 12; const c = canvas(S, S); const p = new Pen(c.getContext('2d'));
  for (let y = 0; y < S; y++) for (let x = 0; x < S; x++) p.px(x, y, hash2(x, y, 7) > 0.8 ? '#0d0f15' : '#0f1118');
  p.outline(0, 0, S, S, '#07080c'); p.hline(1, 1, S - 2, '#06070a'); p.hline(1, S - 1, S - 2, '#2e2a26'); p.vline(S - 1, 1, S - 2, '#2a2620');
  return c;
}

function pattern() {
  const S = 32; const c = canvas(S, S); const p = new Pen(c.getContext('2d'));
  for (let y = 0; y < S; y++) for (let x = 0; x < S; x++) {
    const d = (x + y) % 16 === 0 || (x - y + 64) % 16 === 0;
    p.px(x, y, d ? 'rgba(216,178,90,0.06)' : 'rgba(0,0,0,0)');
  }
  return c;
}

function divider() {
  const W = 64, H = 7; const c = canvas(W, H); const p = new Pen(c.getContext('2d'));
  p.hline(0, 3, W, GOLD[1]); p.hline(4, 2, W - 8, GOLD[0]);
  const m = W / 2; p.px(m, 0, GOLD[3]); p.rect(m - 1, 1, 3, 5, GOLD[2]); p.px(m, 6, GOLD[1]); p.px(m, 3, GOLD[4]);
  p.rect(m - 6, 3, 2, 1, GOLD[3]); p.rect(m + 5, 3, 2, 1, GOLD[3]);
  return c;
}

function sliderThumb() {
  const c = canvas(10, 14); const p = new Pen(c.getContext('2d'));
  p.rect(1, 0, 8, 12, GOLD[2]); p.outline(1, 0, 8, 12, '#07080c'); p.hline(2, 1, 6, GOLD[4]); p.hline(2, 10, 6, GOLD[0]); p.vline(5, 3, 6, GOLD[1]);
  for (let x = 2; x < 8; x++) p.px(x, 12, '#07080c');
  return c;
}

export function installTheme() {
  const r = document.documentElement.style;
  r.setProperty('--frame-panel', url(panelFrame()));
  r.setProperty('--frame-panel-red', url(panelFrame('#ff6a6a')));
  r.setProperty('--plaque', url(plaque('normal')));
  r.setProperty('--plaque-hover', url(plaque('hover')));
  r.setProperty('--plaque-active', url(plaque('active')));
  r.setProperty('--plaque-disabled', url(plaque('disabled')));
  r.setProperty('--parchment', url(parchment()));
  r.setProperty('--inset', url(inset()));
  r.setProperty('--pattern', url(pattern()));
  r.setProperty('--divider', url(divider()));
  r.setProperty('--thumb', url(sliderThumb()));
}
