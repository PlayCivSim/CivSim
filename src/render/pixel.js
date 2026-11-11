// Low-level pixel drawing helpers shared by sprite, icon and terrain code.

export function canvas(w, h) {
  const c = typeof document !== 'undefined' ? document.createElement('canvas') : new OffscreenCanvas(w, h);
  c.width = w; c.height = h;
  return c;
}

export function hexToRgb(hex) {
  const h = hex.replace('#', '');
  const n = parseInt(h.length === 3 ? h.split('').map(c => c + c).join('') : h, 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}
export function rgbToHex(r, g, b) {
  return '#' + [r, g, b].map(v => Math.max(0, Math.min(255, Math.round(v))).toString(16).padStart(2, '0')).join('');
}
export function shade(hex, amt) {
  const [r, g, b] = hexToRgb(hex);
  if (amt >= 0) return rgbToHex(r + (255 - r) * amt, g + (255 - g) * amt, b + (255 - b) * amt);
  return rgbToHex(r * (1 + amt), g * (1 + amt), b * (1 + amt));
}
export function mix(a, b, t) {
  const A = hexToRgb(a), B = hexToRgb(b);
  return rgbToHex(A[0] + (B[0] - A[0]) * t, A[1] + (B[1] - A[1]) * t, A[2] + (B[2] - A[2]) * t);
}

export class Pen {
  constructor(ctx) { this.ctx = ctx; }
  px(x, y, c) { if (!c) return; this.ctx.fillStyle = c; this.ctx.fillRect(x | 0, y | 0, 1, 1); }
  rect(x, y, w, h, c) { if (!c || w <= 0 || h <= 0) return; this.ctx.fillStyle = c; this.ctx.fillRect(x | 0, y | 0, w | 0, h | 0); }
  hline(x, y, w, c) { this.rect(x, y, w, 1, c); }
  vline(x, y, h, c) { this.rect(x, y, 1, h, c); }
  outline(x, y, w, h, c) { this.hline(x, y, w, c); this.hline(x, y + h - 1, w, c); this.vline(x, y, h, c); this.vline(x + w - 1, y, h, c); }
  ellipse(cx, cy, rx, ry, c) {
    for (let y = -ry; y <= ry; y++) { const hw = Math.round(rx * Math.sqrt(Math.max(0, 1 - (y * y) / (ry * ry + 0.01)))); this.rect(cx - hw, cy + y, hw * 2 + 1, 1, c); }
  }
  // draw a string map: rows of chars mapped through a palette object
  map(x, y, rows, pal) {
    for (let r = 0; r < rows.length; r++) for (let c = 0; c < rows[r].length; c++) { const ch = rows[r][c]; if (ch !== '.' && ch !== ' ' && pal[ch]) this.px(x + c, y + r, pal[ch]); }
  }
}
