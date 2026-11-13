// Procedural pixel-art sprite generation: people, trees, buildings, animals.
// Everything is drawn pixel-by-pixel into small cached canvases so the game
// has a consistent hand-made pixel look with no external assets.
import { canvas, Pen, shade, mix } from './pixel.js';
import { TRIBES } from '../data/tribes.js';
import { hash2 } from '../core/rng.js';

const cache = new Map();
const memo = (key, fn) => { let c = cache.get(key); if (!c) { c = fn(); cache.set(key, c); } return c; };
export function clearSpriteCache() { cache.clear(); }

// ------------------------------------------------------------------ styles
// Dark 1px silhouette outline so buildings read clearly against terrain.
// The result is 1px larger on every side (BUILDING_MARGIN).
export const BUILDING_MARGIN = 1;
function outlined(c) {
  const o = canvas(c.width + 2, c.height + 2); const x = o.getContext('2d');
  const sil = canvas(c.width, c.height); const sx = sil.getContext('2d');
  // only solid pixels count: translucent ground (plazas, shadows) is not outlined
  const src = c.getContext('2d').getImageData(0, 0, c.width, c.height), dst = sx.createImageData(c.width, c.height);
  for (let i = 0; i < src.data.length; i += 4) if (src.data[i + 3] > 200) { dst.data[i] = 20; dst.data[i + 1] = 16; dst.data[i + 2] = 14; dst.data[i + 3] = 255; }
  sx.putImageData(dst, 0, 0);
  for (const [dx, dy] of [[0, 1], [2, 1], [1, 0], [1, 2], [0, 0], [2, 0], [0, 2], [2, 2]]) x.drawImage(sil, dx, dy);
  x.drawImage(c, 1, 1);
  return o;
}

export const STYLES = {
  oruvai: { wall: '#ece6d8', wallD: '#c9c1ad', trim: '#8fb0d8', roof: '#2f6fd6', roofD: '#1c4796', roofL: '#74a8f2', wood: '#8a6a4a', woodD: '#5e4630', accent: '#e8eef8', banner: '#2f6fd6', metal: '#c5ced9', stone: '#cfc8b8', stoneD: '#a59d8b', shape: 'dome' },
  kharvak: { wall: '#7d5434', wallD: '#5a3a22', trim: '#3a3536', roof: '#a3282c', roofD: '#651519', roofL: '#d0504c', wood: '#5a3c26', woodD: '#3a2616', accent: '#d4a050', banner: '#b3242c', metal: '#6e6a6c', stone: '#7c7470', stoneD: '#57504c', shape: 'pitched' },
  thalori: { wall: '#a07a4a', wallD: '#7a5a32', trim: '#6f8f34', roof: '#5e9c36', roofD: '#3b6c22', roofL: '#93cc5a', wood: '#6e4c2a', woodD: '#4a321c', accent: '#d8b450', banner: '#2f8a3e', metal: '#a89a6a', stone: '#9a9070', stoneD: '#746a50', shape: 'round' },
  vaelith: { wall: '#9a95ad', wallD: '#6c6782', trim: '#d6dbe6', roof: '#6c34b4', roofD: '#41207a', roofL: '#a978ea', wood: '#4c4a5e', woodD: '#33313f', accent: '#ecdcff', banner: '#7d3fc4', metal: '#d6dbe6', stone: '#8d88a0', stoneD: '#615c74', shape: 'spire', glow: '#e3c6ff' },
};
const S_OF = k => STYLES[k] || STYLES.oruvai;

// ------------------------------------------------------------------ people
// work clothes by job: a tunic colour and a hat, so trades read at a glance
const JOB_LOOK = { farmer: { c: '#c9a65a', hat: 'straw' }, gatherer: { c: '#8aa050', hat: 'scarf' }, woodcutter: { c: '#a8402e', hat: 'knit' }, hunter: { c: '#6a5236', hat: 'hood' }, fisher: { c: '#3a6a8a', hat: 'brim' }, miner: { c: '#5a5a62', hat: 'helmet' }, builder: { c: '#c07a2a', hat: 'cap' }, craftsman: { c: '#7a6a5a', apron: true }, trader: { c: '#7a3a8a', hat: 'feather', sash: true }, researcher: { c: '#3a4a7a', hat: 'cowl', robe: true } };
const RES_COL = { research: '#7a6ad8', wood: '#8a5a32', stone: '#9a958a', clay: '#b8714a', fibre: '#d8cf98', grain: '#e8c858', meat: '#c45a4a', fish: '#9fc4e0', fruit: '#d8484a', veg: '#7ab845', iron: '#a4624a', copper: '#4fa58f', coal: '#2a2a2e', silver: '#d6dbe4', gold: '#f2c84b', gems: '#e05ad8', oil: '#141018', salt: '#efe9de', herbs: '#5ab86a', tools: '#9aa0a8', weapons: '#b8bec8', steel: '#c4ccd6', goods: '#c89a5a', coins: '#f2c84b', machinery: '#8a8f99', livestock: '#e8e0d0' };
export const resColor = r => RES_COL[r] || '#ffffff';

export function personSprite(tribeKey, job, frame, female, child, look, carry, tier = 1, flip = false) {
  const key = `p|${tribeKey}|${job}|${frame}|${female ? 1 : 0}|${child ? 1 : 0}|${look % 9}|${carry || ''}|${tier >= 4 ? 1 : 0}|${flip ? 1 : 0}`;
  return memo(key, () => {
    const c = canvas(9, 12); const p = new Pen(c.getContext('2d'));
    let unit = null, armour = null; [job, unit, armour] = job.split('.');
    const def = TRIBES.find(t => t.key === tribeKey) || TRIBES[0];
    const pal = def.pal, styleKey = def.style || def.key;
    const skin = pal.skin[look % 3], hair = pal.hair[(look >> 2) % 3];
    const S = S_OF(styleKey);
    const rich = tier >= 4;
    let body = pal.primary, bodyD = pal.dark, trim = pal.accent;
    if (job === 'idle' || child) { body = mix(pal.primary, '#9a8a70', 0.45); bodyD = shade(body, -0.3); }
    const JL = !child && JOB_LOOK[job];
    if (JL) { body = mix(JL.c, pal.primary, 0.22); bodyD = shade(body, -0.32); }
    if (job === 'soldier' && armour && armour !== 'none') {
      const AC = { hide: ['#8a6a48', '#5e4630'], scale: ['#b88f4a', '#7a5e30'], mail: ['#8f949e', '#5e636c'], plate: ['#c8ced8', '#7d848f'] }[armour];
      if (AC) { body = mix(AC[0], pal.primary, 0.2); bodyD = AC[1]; trim = pal.primary; }
    }
    const legs = shade(pal.dark, -0.2), boots = '#2a1e18';
    const X = 3; // body left
    if (child) {
      // 3x6 child sprite
      const y0 = 5;
      p.rect(X, y0, 3, 1, hair); p.rect(X, y0 + 1, 3, 1, skin); p.px(X + 1, y0 + 1, skin);
      p.rect(X, y0 + 2, 3, 2, body); p.px(X + 2, y0 + 3, bodyD);
      if (frame === 1) { p.px(X, y0 + 4, skin); p.px(X + 2, y0 + 5, skin); } else if (frame === 2) { p.px(X + 2, y0 + 4, skin); p.px(X, y0 + 5, skin); } else { p.px(X, y0 + 4, skin); p.px(X + 2, y0 + 4, skin); }
    } else {
      const y0 = 2;
      // head
      p.rect(X, y0 + 1, 3, 2, skin);
      p.rect(X, y0, 3, 1, hair);
      if (female) { p.px(X - 1 + 0, y0 + 1, hair); p.px(X + 3, y0 + 1, hair); p.px(X + 3, y0 + 2, hair); }
      else p.px(X, y0 + 1, hair);
      p.px(X + 2, y0 + 1, '#2a2020');
      // work hats (tribe headwear for everyone else)
      if (JL?.hat) {
        const h = JL.hat;
        if (h === 'straw') { p.hline(X - 1, y0, 5, '#e8c860'); p.hline(X, y0 - 1, 3, '#d4b048'); }
        else if (h === 'scarf') { p.hline(X, y0, 3, '#7a9a40'); p.px(X - 1, y0 + 1, '#7a9a40'); }
        else if (h === 'knit') { p.hline(X, y0, 3, '#b03a2a'); p.px(X + 1, y0 - 1, '#e8dcc0'); }
        else if (h === 'hood') { p.hline(X - 1, y0, 5, '#5a4630'); p.px(X - 1, y0 + 1, '#5a4630'); p.px(X + 3, y0 + 1, '#7a6040'); }
        else if (h === 'brim') { p.hline(X - 1, y0, 5, '#d8b040'); p.hline(X, y0 - 1, 3, '#c8a030'); }
        else if (h === 'helmet') { p.hline(X, y0, 3, '#d8c040'); p.px(X + 1, y0 - 1, '#d8c040'); p.px(X + 2, y0, '#fff6a0'); }
        else if (h === 'cap') { p.hline(X, y0, 3, '#e0a030'); p.px(X + 3, y0, '#c08020'); }
        else if (h === 'feather') { p.hline(X, y0, 3, '#e8dcc0'); p.px(X + 2, y0 - 1, '#d8484a'); p.px(X + 3, y0 - 2, '#d8484a'); }
        else if (h === 'cowl') { p.hline(X - 1, y0, 5, '#2a3460'); p.px(X - 1, y0 + 1, '#2a3460'); p.px(X + 3, y0 + 1, '#2a3460'); }
      } else if (styleKey === 'oruvai' && (rich || job === 'trader' || job === 'researcher')) p.hline(X, y0, 3, S.metal);
      if (!JL?.hat && styleKey === 'kharvak' && job !== 'soldier') { p.hline(X, y0, 3, '#5a4030'); p.px(X - 1, y0, '#7a5a40'); }
      if (!JL?.hat && styleKey === 'thalori') { p.px(X - 1, y0 + 1, '#4f8a2a'); p.hline(X, y0, 3, '#4f8a2a'); p.px(X + 1, y0 - 1, '#7ab845'); }
      if (!JL?.hat && styleKey === 'vaelith' && (job === 'researcher' || rich)) { p.rect(X, y0 - 1, 3, 1, pal.dark); p.px(X + 1, y0 - 2, pal.primary); p.hline(X, y0, 3, pal.primary); }
      // torso
      const ty = y0 + 3;
      p.rect(X - 1, ty, 5, 1, body); // shoulders
      p.rect(X, ty + 1, 3, 2, body);
      p.px(X + 2, ty + 1, bodyD); p.px(X + 2, ty + 2, bodyD);
      p.px(X - 1, ty + 1, skin); p.px(X + 3, ty + 1, skin); // hands
      if (styleKey === 'kharvak') { p.px(X - 1, ty, S.metal); p.px(X + 3, ty, S.metal); }
      if (styleKey === 'oruvai') p.hline(X, ty + 2, 3, S.metal);
      if (styleKey === 'vaelith') { p.vline(X + 1, ty, 3, trim); }
      if (styleKey === 'thalori') p.hline(X, ty + 2, 3, '#7a5532');
      if (rich) p.px(X + 1, ty, def.pal.light);
      // tribe colours stay on the shoulders; aprons and sashes mark the trade
      if (JL) { p.px(X - 1, ty, pal.primary); p.px(X + 3, ty, pal.primary); }
      if (JL?.apron) { p.rect(X, ty + 1, 3, 2, '#8a6a42'); p.px(X + 1, ty + 1, '#a07a4a'); }
      if (JL?.sash) { p.px(X, ty + 1, '#f2c84b'); p.px(X + 1, ty + 2, '#f2c84b'); }
      // legs / robe
      const ly = ty + 3;
      if (styleKey === 'vaelith' || (female && styleKey === 'oruvai') || JL?.robe) {
        p.rect(X, ly, 3, 2, bodyD);
        p.px(X + (frame === 1 ? 0 : frame === 2 ? 2 : 1), ly + 2, boots);
        if (frame === 0 || frame === 3) { p.px(X, ly + 2, boots); p.px(X + 2, ly + 2, boots); }
      } else {
        if (frame === 1) { p.px(X, ly, legs); p.px(X - 1, ly + 1, legs); p.px(X + 2, ly, legs); p.px(X + 2, ly + 1, legs); p.px(X - 1, ly + 2, boots); p.px(X + 2, ly + 2, boots); }
        else if (frame === 2) { p.px(X, ly, legs); p.px(X, ly + 1, legs); p.px(X + 2, ly, legs); p.px(X + 3, ly + 1, legs); p.px(X, ly + 2, boots); p.px(X + 3, ly + 2, boots); }
        else { p.px(X, ly, legs); p.px(X, ly + 1, legs); p.px(X + 2, ly, legs); p.px(X + 2, ly + 1, legs); p.px(X, ly + 2, boots); p.px(X + 2, ly + 2, boots); }
      }
      // tools by job; frame 3 = working pose (tool raised)
      const up = frame === 3;
      const hx = X + 4, hy = ty + 1;
      const wood = '#7a5232', iron = '#b8bec8';
      switch (job) {
        case 'woodcutter': if (up) { p.vline(hx, hy - 3, 3, wood); p.rect(hx, hy - 4, 2, 1, iron); } else { p.vline(hx, hy - 1, 3, wood); p.px(hx + 1, hy - 1, iron); } break;
        case 'miner': if (up) { p.vline(hx, hy - 3, 3, wood); p.hline(hx - 1, hy - 4, 3, iron); } else { p.vline(hx, hy - 1, 3, wood); p.hline(hx - 1, hy - 1, 3, iron); } break;
        case 'farmer': p.vline(hx, up ? hy - 3 : hy - 2, 4, wood); p.px(hx + 1, up ? hy - 3 : hy + 1, iron); break;
        case 'builder': if (up) { p.vline(hx, hy - 2, 2, wood); p.rect(hx - 1, hy - 3, 3, 1, '#8a8f99'); } else { p.px(hx, hy, wood); p.px(hx, hy - 1, '#8a8f99'); } break;
        case 'hunter': p.vline(hx, hy - 3, 5, wood); p.px(hx, hy - 4, iron); break;
        case 'fisher': p.px(hx, hy, wood); p.px(hx + 1, hy - 1, wood); p.px(hx + 2, hy - 2, wood); if (up) { p.px(hx + 3, hy - 1, '#dfe6ee'); p.px(hx + 3, hy, '#dfe6ee'); } break;
        case 'gatherer': p.rect(hx - 1, hy + 1, 2, 2, '#b08850'); p.px(hx - 1, hy + 1, '#d8484a'); break;
        case 'craftsman': p.px(hx, up ? hy - 2 : hy, '#8a8f99'); p.px(hx, up ? hy - 1 : hy + 1, wood); break;
        case 'researcher': p.rect(hx - 1, hy, 2, 2, '#e8dcc0'); p.px(hx - 1, hy, pal.dark); break;
        case 'trader': p.rect(hx - 1, hy + 1, 2, 2, '#c89a5a'); p.px(hx, hy + 1, '#f2c84b'); break;
        case 'soldier': {
          // helmet, spear, shield
          const helm = styleKey === 'kharvak' ? '#5e5a5c' : S.metal;
          p.hline(X, y0, 3, helm); p.px(X + 1, y0 - 1, helm);
          if (styleKey === 'kharvak') { p.px(X - 1, y0 - 1, '#e8dcc0'); p.px(X + 3, y0 - 1, '#e8dcc0'); }
          if (styleKey === 'oruvai') p.px(X + 1, y0 - 2, pal.primary);
          if (styleKey === 'vaelith') p.px(X + 1, y0 - 2, pal.light);
          if (unit === 'archer') {
            // bow and quiver
            p.px(hx + 1, hy - 3, wood); p.vline(hx + 2, hy - 2, 4, wood); p.px(hx + 1, hy + 2, wood); p.vline(hx + 1, hy - 2, 4, '#e8dcc0');
            p.vline(X - 1, ty - 1, 3, '#7a5a3a'); p.px(X - 1, ty - 2, '#e8dcc0');
          } else if (unit === 'sword') {
            p.vline(hx, up ? hy - 4 : hy - 2, 3, '#dfe6ee'); p.px(hx - 1, up ? hy - 1 : hy + 1, iron); p.px(hx + 1, up ? hy - 1 : hy + 1, iron);
            p.rect(X - 2, ty - 1, 3, 4, pal.primary); p.px(X - 2, ty - 1, pal.light); p.px(X - 1, ty + 1, iron);
          } else if (unit === 'warrior') {
            p.vline(hx, up ? hy - 3 : hy - 1, 3, wood); p.rect(hx - 1, up ? hy - 4 : hy - 2, 2, 1, '#6a4a2a');
          } else if (unit === 'sapper') {
            p.rect(X - 2, ty - 1, 2, 3, '#6a4a2a'); p.px(X - 2, ty, '#3a2a1a'); p.px(X - 1, ty - 2, '#f2c84b');
            p.px(hx, hy, '#c04a2a');
          } else {
            p.vline(hx, (up ? hy - 5 : hy - 4), 7, wood); p.px(hx, up ? hy - 6 : hy - 5, iron);
            p.rect(X - 2, ty, 2, 3, pal.primary); p.px(X - 2, ty, pal.light); p.px(X - 1, ty + 1, pal.accent);
          }
          break;
        }
      }
      if (carry) { p.rect(X, y0 - 2, 3, 2, resColor(carry)); p.px(X, y0 - 2, shade(resColor(carry), 0.3)); p.px(X + 2, y0 - 1, shade(resColor(carry), -0.3)); }
    }
    if (!flip) return c;
    const f = canvas(9, 12); const fx = f.getContext('2d'); fx.translate(9, 0); fx.scale(-1, 1); fx.drawImage(c, 0, 0); return f;
  });
}

// ------------------------------------------------------------------ trees
export const TREE_TYPES = ['oak', 'pine', 'palm', 'swamp', 'snowpine', 'cactus', 'jungle', 'birch', 'bush'];

export function treeSprite(type, variant, frame, autumn = 0, snow = false) {
  const key = `t|${type}|${variant}|${frame}|${autumn}|${snow ? 1 : 0}`;
  return memo(key, () => {
    const c = canvas(10, 13); const p = new Pen(c.getContext('2d'));
    const sway = frame ? 1 : 0;
    const trunk = '#6b4a2e', trunkD = '#4a3220';
    const shadow = 'rgba(20,40,20,0.28)';
    p.rect(2, 11, 7, 1, shadow); p.rect(3, 12, 5, 1, shadow);
    const leafSets = {
      oak: ['#2f7a2a', '#3f9434', '#5cb048', '#7ccc5c'],
      jungle: ['#1f5e22', '#2a7a2c', '#3c943a', '#56ae4a'],
      birch: ['#5a9a34', '#74b440', '#94cc56', '#b4e070'],
      swamp: ['#3c5a32', '#4a6e3c', '#5e8448', '#789a5a'],
      pine: ['#1f5a32', '#2a6e3c', '#3a8448', '#4f9a58'],
      snowpine: ['#24503a', '#2e6046', '#3a7454', '#e8f0f6'],
      palm: ['#3a8a30', '#4ea03a', '#6ab84a', '#8ad060'],
    };
    let L = leafSets[type] || leafSets.oak;
    if (autumn && (type === 'oak' || type === 'birch')) L = autumn === 1 ? ['#8a5a1a', '#c07a24', '#e09a34', '#f2c050'] : ['#6a6a3a', '#8a7a40', '#a08a48', '#b8a058'];
    const v = variant;
    switch (type) {
      case 'pine': case 'snowpine': {
        p.rect(4, 9, 2, 3, trunkD); p.px(4, 9, trunk);
        const tiers = [[1, 4, 1], [2, 3, 1], [4, 2, 0], [6, 1, 0]];
        for (let r = 0; r < 10; r++) {
          const hw = Math.min(4, Math.floor(r * 0.45) + (r % 3 === 2 ? 1 : 0));
          const off = r < 5 ? sway : 0;
          p.rect(5 - hw + off - 0, 0 + r, hw * 2, 1, r % 3 === 0 ? L[2] : L[1]);
          p.px(5 - hw + off, r, L[0]);
          if (r > 1) p.px(5 + hw - 1 + off, r, L[0]);
          if (r % 3 === 1) p.px(4 - Math.floor(hw / 2) + off, r, L[3]);
        }
        if (type === 'snowpine' || snow) { p.px(4 + sway, 0, '#f4f8fb'); p.hline(3 + sway, 3, 2, '#f4f8fb'); p.hline(2 + sway, 6, 3, '#e8f0f6'); }
        break;
      }
      case 'palm': {
        p.px(5, 11, trunkD); p.px(5, 10, trunk); p.px(5, 9, trunkD); p.px(6, 8, trunk); p.px(6, 7, trunkD); p.px(6, 6, trunk); p.px(6, 5, trunkD);
        const fx = 6 + sway;
        for (const [dx, dy] of [[-4, 1], [-3, 0], [-2, -1], [-1, -1], [1, -1], [2, -1], [3, 0], [4, 1], [-3, 2], [3, 2], [0, -2]]) p.px(fx + dx, 4 + dy, L[1]);
        for (const [dx, dy] of [[-2, 0], [-1, 0], [0, 0], [1, 0], [2, 0], [0, -1]]) p.px(fx + dx, 4 + dy, L[2]);
        p.px(fx - 4, 6, L[0]); p.px(fx + 4, 6, L[0]); p.px(fx, 5, '#8a5a2a');
        break;
      }
      case 'cactus': {
        p.vline(5, 4, 8, '#4f8a3a'); p.vline(4, 4, 8, '#3a6e2c'); p.px(5, 3, '#6aa84a'); p.px(4, 3, '#4f8a3a');
        p.vline(2, 6, 3, '#4f8a3a'); p.px(3, 8, '#4f8a3a'); p.vline(7, 5, 3, '#4f8a3a'); p.px(6, 7, '#4f8a3a');
        if (v % 2) p.px(5, 3, '#e86aa0');
        break;
      }
      case 'bush': {
        p.ellipse(5, 9, 3, 2, L[1]); p.rect(3, 8, 3, 1, L[2]); p.px(4, 8, L[3]);
        if (v % 3 === 0) { p.px(3, 9, '#d8484a'); p.px(6, 10, '#d8484a'); }
        break;
      }
      default: {
        // broadleaf canopy: oak / jungle / birch / swamp
        const big = type === 'jungle' ? 1 : 0;
        if (type === 'birch') { p.vline(5, 7, 5, '#e8e4dc'); p.px(5, 9, '#2a2a2a'); p.px(5, 11, '#5a5a5a'); }
        else { p.rect(4, 7, 2, 5, trunkD); p.vline(4, 7, 5, trunk); if (type === 'swamp') { p.px(3, 11, trunkD); p.px(6, 11, trunkD); } }
        const cx = 5 + sway, cy = 4 + (v % 2);
        const rx = 3 + big + (v === 2 ? 1 : 0), ry = 3 + big;
        p.ellipse(cx - 0.5 | 0, cy, rx, ry, L[1]);
        // shading: dark bottom-right, highlight top-left
        for (let y = -ry; y <= ry; y++) { const hw = Math.round(rx * Math.sqrt(Math.max(0, 1 - (y * y) / (ry * ry + 0.01)))); p.px(cx + hw, cy + y, L[0]); if (y > ry - 2) p.hline(cx - hw + 1, cy + y, hw * 2 - 1, L[0]); }
        p.rect(cx - 2, cy - ry + 1, 2, 1, L[3]); p.px(cx - 2, cy - ry + 2, L[2]); p.px(cx - 1, cy - 1, L[2]); p.px(cx + 1, cy - 2, L[2]);
        if (type === 'swamp') { p.px(cx - rx, cy + 2, L[1]); p.px(cx - rx, cy + 3, L[0]); p.px(cx + rx, cy + 2, L[1]); p.px(cx + rx, cy + 3, L[0]); }
        if (snow) { p.hline(cx - 2, cy - ry, 4, '#f4f8fb'); p.px(cx - 3, cy - ry + 1, '#e8f0f6'); }
        if (v === 3 && type === 'oak' && !autumn) { p.px(cx + 1, cy, '#d8484a'); p.px(cx - 2, cy + 1, '#d8484a'); }
      }
    }
    return c;
  });
}

// mini tree glyph used when baking zoomed-out terrain
export function treeGlyph(type) {
  return { oak: ['#2f7a2a', '#4f9e3a'], jungle: ['#1f5e22', '#2f7a2a'], birch: ['#5a9a34', '#86c04c'], swamp: ['#3c5a32', '#5a7a46'], pine: ['#1f5a32', '#2e6e3c'], snowpine: ['#2e5a44', '#e8f0f6'], palm: ['#3a8a30', '#5aac44'], cactus: ['#3a6e2c', '#5a9a40'], bush: ['#3f9434', '#5cb048'] }[type] || ['#2f7a2a', '#4f9e3a'];
}

// ------------------------------------------------------------------ animals
export function animalSprite(kind, frame) {
  return memo(`a|${kind}|${frame}`, () => {
    const c = canvas(7, 6); const p = new Pen(c.getContext('2d'));
    if (kind === 'deer') {
      p.rect(1, 2, 4, 2, '#9a6a3a'); p.px(5, 1, '#9a6a3a'); p.px(5, 0, '#5a3a20'); p.px(6, 1, '#9a6a3a'); p.px(1, 2, '#e8dcc8');
      if (frame) { p.px(1, 4, '#5a3a20'); p.px(4, 4, '#5a3a20'); p.px(2, 5, '#5a3a20'); p.px(5, 5, '#5a3a20'); } else { p.px(1, 4, '#5a3a20'); p.px(1, 5, '#5a3a20'); p.px(4, 4, '#5a3a20'); p.px(4, 5, '#5a3a20'); }
    } else if (kind === 'sheep') {
      p.rect(1, 2, 4, 2, '#f0ece2'); p.rect(1, 1, 3, 1, '#ffffff'); p.px(5, 2, '#3a3030'); p.px(5, 1, '#3a3030');
      p.px(1, 4, '#3a3030'); p.px(4, 4, '#3a3030');
    } else if (kind === 'cow') {
      p.rect(1, 1, 5, 3, '#e8e0d4'); p.px(2, 2, '#3a3030'); p.px(4, 1, '#3a3030'); p.px(6, 1, '#d0a890'); p.px(1, 4, '#3a3030'); p.px(5, 4, '#3a3030');
    } else if (kind === 'fish') {
      p.px(1, 2, '#cfe4f4'); p.px(2, 2, '#cfe4f4'); p.px(3, 2, '#e8f4ff'); p.px(0, 1, '#cfe4f4'); p.px(0, 3, '#cfe4f4');
    } else if (kind === 'bird') {
      if (frame) { p.px(1, 2, '#2a2a30'); p.px(2, 3, '#2a2a30'); p.px(3, 2, '#2a2a30'); } else { p.px(1, 3, '#2a2a30'); p.px(2, 3, '#2a2a30'); p.px(3, 3, '#2a2a30'); p.px(0, 2, '#2a2a30'); p.px(4, 2, '#2a2a30'); }
    }
    return c;
  });
}

// ------------------------------------------------------------------ buildings
// 3/4 view structures composed from wall + roof primitives in the tribe style.
function wall(p, S, x, y, w, h, kind) {
  p.rect(x, y, w, h, S.wall);
  p.vline(x + w - 1, y, h, S.wallD);
  p.hline(x, y + h - 1, w, S.wallD);
  if (kind === 'kharvak') for (let i = x + 1; i < x + w - 1; i += 2) p.vline(i, y, h - 1, shade(S.wall, -0.12));
  if (kind === 'vaelith') for (let yy = y + 1; yy < y + h - 1; yy += 2) for (let i = x + ((yy - y) % 4 === 1 ? 0 : 2); i < x + w - 1; i += 4) p.px(i, yy, S.wallD);
  if (kind === 'oruvai') { p.hline(x, y, w, S.trim); }
  if (kind === 'thalori') { p.px(x, y + h - 2, '#5e8a34'); p.px(x + 1, y + h - 1, '#4f7a2a'); p.px(x + w - 2, y + h - 1, '#5e8a34'); }
}

function roof(p, S, cx, top, w, h, shape) {
  const x0 = Math.round(cx - w / 2);
  switch (shape) {
    case 'dome': {
      for (let r = 0; r < h; r++) {
        const t = (h - r) / h; const hw = Math.round((w / 2) * Math.sqrt(Math.max(0, 1 - t * t * 0.95)));
        p.rect(Math.round(cx) - hw, top + r, hw * 2, 1, S.roof);
        p.px(Math.round(cx) - hw, top + r, S.roofL); p.px(Math.round(cx) + hw - 1, top + r, S.roofD);
      }
      p.px(Math.round(cx) - Math.floor(w / 4), top + Math.floor(h / 2), S.roofL);
      p.px(Math.round(cx) - 1, top + 1, S.roofL);
      p.vline(Math.round(cx) - 1, top - 2, 2, S.metal);
      break;
    }
    case 'pitched': {
      for (let r = 0; r < h; r++) {
        const hw = Math.round(((r + 1) / h) * (w / 2 + 1));
        const col = r % 2 ? S.roof : shade(S.roof, -0.12);
        p.rect(Math.round(cx) - hw, top + r, hw * 2, 1, col);
        p.px(Math.round(cx) - hw, top + r, S.roofL);
        p.px(Math.round(cx) + hw - 1, top + r, S.roofD);
      }
      p.px(Math.round(cx) - 1, top - 1, '#e8dcc0'); p.px(Math.round(cx), top - 1, '#e8dcc0');
      p.px(Math.round(cx) - 2, top - 2, '#e8dcc0'); p.px(Math.round(cx) + 1, top - 2, '#e8dcc0');
      break;
    }
    case 'round': {
      for (let r = 0; r < h; r++) {
        const t = (h - r) / h; const hw = Math.round((w / 2 + 1) * Math.sqrt(Math.max(0, 1 - t * t * 0.9)));
        p.rect(Math.round(cx) - hw, top + r, hw * 2, 1, r % 2 ? S.roof : shade(S.roof, -0.08));
        p.px(Math.round(cx) - hw, top + r, S.roofL); p.px(Math.round(cx) + hw - 1, top + r, S.roofD);
        if (r > 1 && r % 2 === 0) p.px(Math.round(cx) - hw + 2 + (r % 3), top + r, S.roofL);
      }
      p.px(Math.round(cx), top - 1, '#93cc5a'); p.px(Math.round(cx) + 1, top - 2, '#5e9c36');
      break;
    }
    case 'spire': {
      p.rect(x0, top + h - 2, w, 2, S.roofD);
      p.hline(x0, top + h - 2, w, S.trim);
      const sh = h + 2;
      for (let r = 0; r < sh; r++) { const hw = Math.max(0, Math.round((r / sh) * 2.5)); p.rect(Math.round(cx) - hw, top - 2 + r, hw * 2 + 1, 1, S.roof); p.px(Math.round(cx) + hw, top - 2 + r, S.roofD); p.px(Math.round(cx) - hw, top - 2 + r, S.roofL); }
      p.px(Math.round(cx), top - 3, S.glow);
      if (w >= 12) { for (const ex of [x0 + 1, x0 + w - 2]) { p.vline(ex, top + h - 5, 3, S.roof); p.px(ex, top + h - 6, S.glow); } }
      break;
    }
  }
}

function door(p, S, x, y, h = 3) { p.rect(x, y - h, 2, h, '#2a1e18'); p.px(x, y - h, S.woodD); }
function windows(p, S, x, y, w, n) { const step = Math.floor(w / (n + 1)); for (let i = 1; i <= n; i++) p.px(x + step * i, y, '#f0d27a'); }
function banner(p, S, x, y, tall = 6) { p.vline(x, y - tall, tall, '#4a3a2a'); p.rect(x + 1, y - tall, 2, 3, S.banner); p.px(x + 2, y - tall + 3, S.banner); p.px(x + 1, y - tall, shade(S.banner, 0.3)); }
function shadowBase(p, x, y, w) { p.rect(x + 1, y, w, 1, 'rgba(0,0,0,0.22)'); }

function house(p, S, key, cx, baseY, w, wallH, roofH) {
  const x0 = Math.round(cx - w / 2);
  shadowBase(p, x0, baseY, w);
  wall(p, S, x0, baseY - wallH, w, wallH, key);
  roof(p, S, cx, baseY - wallH - roofH + 1, w, roofH, S.shape);
  door(p, S, Math.round(cx) - 1, baseY, Math.min(3, wallH - 1));
  if (w > 6) windows(p, S, x0, baseY - wallH + 2, w, w > 10 ? 3 : 2);
}

// A small hanging trade sign with a pictogram of what the building makes.
function tradeSign(p, x, y, res, S) {
  const c = RES_COL[res] || '#c8a070';
  p.vline(x + 1, y - 2, 2, '#3a2a1a'); p.hline(x, y - 2, 5, '#3a2a1a');
  p.rect(x, y, 5, 4, '#e8d8b0'); p.outline(x, y, 5, 4, S.woodD);
  p.rect(x + 1, y + 1, 3, 2, c); p.px(x + 1, y + 1, shade(c, 0.35)); p.px(x + 3, y + 2, shade(c, -0.3));
}
function chimney(p, x, y, h, col, smoke = true) { p.rect(x, y, 2, h, col); p.hline(x, y, 2, shade(col, -0.35)); if (smoke) { p.px(x, y - 2, 'rgba(200,200,200,0.55)'); p.px(x + 1, y - 4, 'rgba(200,200,200,0.4)'); } }
function cylinder(p, cx, base, rx, h, col) { p.rect(cx - rx, base - h, rx * 2 + 1, h, col); p.vline(cx + rx, base - h, h, shade(col, -0.3)); p.vline(cx - rx, base - h, h, shade(col, 0.25)); p.ellipse(cx, base - h, rx, 1, shade(col, 0.15)); p.ellipse(cx, base, rx, 1, shade(col, -0.25)); }
function bricks(p, x, y, w, h, col) { p.rect(x, y, w, h, col); for (let yy = y; yy < y + h; yy += 2) { p.hline(x, yy, w, shade(col, -0.25)); for (let xx = x + ((yy - y) % 4 ? 1 : 3); xx < x + w; xx += 4) p.px(xx, yy + 1, shade(col, -0.25)); } }

// Distinct art for the workshops, industries and boosters. Returns true if drawn.
function specialBuilding(type, p, S, k, W, base, cx) {
  const sz = W / 8;
  switch (type) {
    case 'workshop': {
      house(p, S, k, cx - 3, base - 2, 10, 5, 5);
      p.rect(W - 7, base - 7, 6, 1, S.roofD); p.vline(W - 7, base - 6, 5, S.wood); p.vline(W - 2, base - 6, 5, S.wood); // lean-to
      p.rect(W - 6, base - 3, 4, 1, S.wood); p.px(W - 5, base - 4, '#9aa0a8'); p.px(W - 3, base - 4, '#6a4a2a'); // workbench, tools
      tradeSign(p, 1, base - 9, 'tools', S); return true;
    }
    case 'smelter': {
      p.ellipse(cx - 2, base - 4, 6, 4, S.stone); p.ellipse(cx - 3, base - 6, 4, 2, shade(S.stone, 0.15));
      p.rect(cx - 4, base - 4, 4, 3, '#2a1a10'); p.rect(cx - 3, base - 3, 2, 2, '#f08a24'); p.px(cx - 3, base - 3, '#f8d860');
      chimney(p, W - 5, base - 15, 13, '#6a5a50');
      p.rect(1, base - 2, 3, 2, '#a4624a'); p.rect(W - 9, base - 2, 2, 2, '#c4ccd6'); return true;
    }
    case 'armory': {
      house(p, S, k, cx - 2, base - 2, 11, 5, 6);
      // weapon rack and anvil
      p.hline(W - 6, base - 7, 5, S.wood); for (const x of [W - 6, W - 4, W - 2]) { p.vline(x, base - 10, 8, '#b8bec8'); p.px(x, base - 11, '#e8eef4'); }
      p.rect(2, base - 3, 4, 1, '#4a4a52'); p.rect(3, base - 2, 2, 2, '#3a3a40');
      tradeSign(p, cx - 6, base - 11, 'weapons', S); return true;
    }
    case 'artisan': {
      house(p, S, k, cx - 1, base - 2, 12, 5, 6);
      for (let x = 1; x < 8; x++) p.px(x, base - 7, x % 2 ? S.banner : '#f4ecd8'); p.hline(1, base - 6, 7, shade(S.banner, -0.2)); // awning
      p.ellipse(3, base - 3, 1, 2, '#b8714a'); p.ellipse(6, base - 2, 1, 1, '#c89a5a'); p.px(6, base - 3, '#5ab86a'); // pots
      tradeSign(p, W - 6, base - 12, 'goods', S); return true;
    }
    case 'mint': {
      p.rect(2, base - 9, W - 4, 8, S.stone); p.vline(W - 3, base - 9, 8, S.stoneD);
      p.rect(1, base - 11, W - 2, 2, shade(S.stone, 0.15)); for (let x = 3; x < W - 3; x += 3) p.vline(x, base - 9, 7, shade(S.stone, 0.25)); // columns
      p.rect(cx - 1, base - 5, 2, 4, '#3a2a18'); p.px(cx - 1, base - 5, '#f2c84b');
      p.ellipse(cx, base - 13, 2, 1, '#f2c84b'); p.px(cx, base - 13, '#c89a20'); return true;
    }
    case 'kiln': {
      p.ellipse(cx - 1, base - 5, 6, 5, '#b8714a'); p.ellipse(cx - 2, base - 7, 3, 2, '#d08a5a'); p.rect(cx - 2, base - 3, 3, 2, '#2a1a10'); p.px(cx - 1, base - 2, '#f08a24');
      p.px(cx - 1, base - 11, '#3a3030'); p.px(cx - 1, base - 13, 'rgba(180,180,180,0.6)'); p.px(cx, base - 15, 'rgba(180,180,180,0.4)');
      for (let i = 0; i < 3; i++) p.hline(W - 5, base - 1 - i, 4 - i, '#8a5a32'); // wood
      p.rect(1, base - 2, 2, 2, '#2a2a2e'); p.px(2, base - 3, '#2a2a2e'); return true;
    }
    case 'brickworks': {
      house(p, S, k, cx + 2, base - 4, 10, 4, 5); chimney(p, W - 3, base - 14, 9, '#8a4a32');
      for (let i = 0; i < 3; i++) bricks(p, 1 + i * 2, base - 3 - i, 4, 2 + i, '#b85a3a');
      return true;
    }
    case 'jeweller': {
      house(p, S, k, cx, base - 2, 12, 6, 6);
      p.rect(cx + 1, base - 5, 3, 2, '#e8f0ff'); p.px(cx + 2, base - 5, '#e05ad8'); p.px(cx + 3, base - 4, '#5ad8e0'); // display window
      tradeSign(p, 1, base - 11, 'gems', S); return true;
    }
    case 'saltpans': {
      for (let i = 0; i < 4; i++) { const x = 1 + (i % 2) * 7, y = base - 6 - Math.floor(i / 2) * 6; p.rect(x, y, 6, 5, '#8a7a62'); p.rect(x + 1, y + 1, 4, 3, i % 3 ? '#f4f0e8' : '#bcd8ec'); p.px(x + 2, y + 2, '#ffffff'); }
      p.vline(W - 2, base - 8, 7, S.wood); p.hline(W - 4, base - 8, 3, S.wood); return true;
    }
    case 'herbalist': {
      p.rect(1, base - W + 4, W - 2, W - 5, '#6a5032');
      for (let y = base - W + 5; y < base - 1; y += 2) for (let x = 2; x < W - 2; x++) if ((x + y) % 3) p.px(x, y, (x * 5 + y) % 7 ? '#4fa04a' : '#b07ad8');
      house(p, S, k, W - 5, base - W + 9, 7, 3, 4); return true;
    }
    case 'refinery': {
      cylinder(p, 5, base - 2, 3, 9, '#b8bec8'); cylinder(p, 12, base - 2, 3, 12, '#9aa0a8');
      p.hline(5, base - 7, 8, '#5a5a62'); p.hline(8, base - 4, 10, '#5a5a62');
      // flare stack
      p.vline(W - 4, base - 22, 20, '#4a4a52'); p.px(W - 4, base - 23, '#f08a24'); p.px(W - 4, base - 24, '#f8d860'); p.px(W - 5, base - 23, '#e05a20');
      p.rect(W - 8, base - 3, 3, 2, '#141018'); return true;
    }
    case 'granary': {
      for (const x of [3, W - 4]) p.vline(x, base - 4, 4, S.woodD); // stilts
      p.rect(2, base - 11, W - 4, 7, S.wall); p.vline(W - 3, base - 11, 7, S.wallD); p.hline(2, base - 5, W - 4, S.woodD);
      for (let r = 0; r < 5; r++) { const hw = r + 2; p.hline(cx - hw, base - 16 + r, hw * 2, r % 2 ? S.roof : S.roofD); }
      p.rect(cx - 1, base - 9, 2, 3, '#2a1e18'); p.px(cx - 4, base - 8, '#e8c858'); p.px(cx + 3, base - 7, '#e8c858'); return true;
    }
    case 'smokehouse': {
      p.rect(2, base - 7, 8, 6, S.stone); p.vline(9, base - 7, 6, S.stoneD); roof(p, S, 6, base - 11, 9, 4, 'pitched'); p.rect(5, base - 4, 2, 3, '#2a1e18');
      chimney(p, 7, base - 14, 4, S.stoneD);
      p.hline(W - 6, base - 8, 5, S.wood); p.vline(W - 6, base - 8, 7, S.wood); p.vline(W - 2, base - 8, 7, S.wood); // rack
      p.vline(W - 5, base - 7, 3, '#9fc4e0'); p.vline(W - 3, base - 7, 3, '#c45a4a'); p.vline(W - 4, base - 7, 2, '#9fc4e0'); return true;
    }
    case 'sawmill': {
      p.rect(1, base - 8, W - 6, 1, S.roofD); p.vline(1, base - 7, 6, S.wood); p.vline(W - 6, base - 7, 6, S.wood);
      p.ellipse(6, base - 4, 3, 3, '#c4ccd6'); p.ellipse(6, base - 4, 1, 1, '#6a6a72'); for (const [dx, dy] of [[0, -3], [3, 0], [0, 3], [-3, 0]]) p.px(6 + dx, base - 4 + dy, '#e8eef4'); // blade
      for (let i = 0; i < 3; i++) { p.hline(W - 5, base - 1 - i * 2, 4, '#8a5a32'); p.px(W - 5, base - 1 - i * 2, '#c8a070'); }
      p.hline(2, base - 1, 8, '#d8b080'); return true;
    }
    case 'stampmill': {
      p.vline(2, base - 16, 15, S.wood); p.vline(W - 3, base - 16, 15, S.wood); p.hline(2, base - 16, W - 4, S.wood); p.hline(2, base - 10, W - 4, S.woodD);
      for (let i = 0; i < 3; i++) { const x = 5 + i * 3; p.vline(x, base - 15, 6 + (i % 2) * 2, '#8a8f99'); p.rect(x - 1, base - 9 + (i % 2) * 2, 3, 2, '#5a5a62'); }
      p.rect(3, base - 4, W - 6, 3, '#7a6a52'); p.px(5, base - 4, '#a4624a'); p.px(9, base - 3, '#4fa58f'); return true;
    }
    case 'guildhall': {
      house(p, S, k, cx, base - 2, 20, 10, 8);
      for (let x = cx - 9; x < cx + 9; x += 4) p.vline(x, base - 11, 9, S.woodD); p.hline(cx - 10, base - 7, 20, S.woodD); // half-timbering
      p.rect(cx - 1, base - 23, 2, 3, S.wood); p.px(cx - 1, base - 21, '#d8b040'); // bell turret
      banner(p, S, 1, base - 1, 13); banner(p, S, W - 3, base - 1, 13); tradeSign(p, cx + 4, base - 6, 'tools', S); return true;
    }
    case 'caravanserai': {
      p.rect(1, base - 10, W - 2, 9, S.wall); p.outline(1, base - 10, W - 2, 9, S.wallD);
      p.rect(3, base - 8, W - 6, 5, '#c8b088'); // courtyard
      p.rect(cx - 2, base - 6, 4, 5, '#3a2a18'); p.hline(cx - 3, base - 7, 6, S.trim); // arch gate
      for (const x of [4, W - 7]) { p.rect(x, base - 7, 3, 2, '#c89a5a'); p.px(x, base - 7, '#d8484a'); }
      p.rect(W - 9, base - 5, 3, 2, '#b08850'); p.px(W - 7, base - 6, '#b08850'); // camel
      banner(p, S, 2, base - 10, 6); banner(p, S, W - 4, base - 10, 6); return true;
    }
    case 'scriptorium': {
      house(p, S, k, cx, base - 2, 13, 7, 6);
      p.rect(cx - 4, base - 7, 3, 3, '#f0d27a'); p.rect(cx + 2, base - 7, 3, 3, '#f0d27a'); p.vline(cx - 3, base - 7, 3, S.woodD); p.vline(cx + 3, base - 7, 3, S.woodD);
      p.rect(W - 4, base - 4, 3, 3, '#e8dcc0'); p.px(W - 3, base - 5, '#3a3a6a'); // scroll + quill
      return true;
    }
    case 'healer': {
      house(p, S, k, cx - 2, base - 3, 10, 5, 5);
      for (let x = W - 6; x < W - 1; x++) { p.px(x, base - 2, '#4fa04a'); if (x % 2) p.px(x, base - 3, '#d8484a'); }
      p.rect(1, base - 3, 2, 2, '#9a958a'); p.px(1, base - 4, '#5ab86a'); // mortar
      p.rect(cx - 3, base - 11, 3, 1, '#ffffff'); p.rect(cx - 2, base - 12, 1, 3, '#ffffff'); p.px(cx - 2, base - 11, '#d84848'); return true;
    }
    case 'blastfurnace': {
      p.rect(cx - 4, base - 18, 8, 17, S.stone); p.vline(cx + 3, base - 18, 17, S.stoneD); for (let y = base - 16; y < base - 1; y += 3) p.hline(cx - 4, y, 8, shade(S.stone, -0.15));
      p.rect(cx - 5, base - 20, 10, 2, S.stoneD); p.px(cx - 1, base - 21, '#f8d860'); p.px(cx, base - 22, '#f08a24'); p.px(cx + 1, base - 21, '#f8d860');
      p.rect(cx - 2, base - 4, 4, 3, '#f08a24'); p.px(cx - 1, base - 3, '#ffe890');
      p.rect(1, base - 5, 3, 4, '#6a4a2a'); p.hline(1, base - 6, 3, '#8a6a42'); // bellows
      return true;
    }
    case 'steamhouse': {
      bricks(p, 1, base - 10, W - 8, 9, '#9a4a32'); p.rect(0, base - 12, W - 6, 2, S.roofD);
      cylinder(p, W - 4, base - 2, 2, 7, '#5a5a62'); chimney(p, W - 4, base - 24, 16, '#4a3a32');
      p.rect(4, base - 7, 3, 2, '#f0d27a'); p.rect(10, base - 7, 3, 2, '#f0d27a'); p.rect(cx - 2, base - 4, 3, 3, '#2a1e18');
      p.hline(W - 9, base - 5, 4, '#c4ccd6'); return true;
    }
    case 'powerstation': {
      p.rect(1, base - 9, 11, 8, '#c8c4bc'); p.vline(11, base - 9, 8, '#9a968e'); for (let x = 3; x < 11; x += 3) p.rect(x, base - 7, 2, 2, '#f0d27a');
      // cooling tower
      for (let r = 0; r < 16; r++) { const hw = Math.round(4 + Math.abs(r - 10) * 0.35); p.hline(W - 7 - hw, base - 1 - r, hw * 2, r % 4 ? '#d8d4cc' : '#b8b4ac'); }
      p.px(W - 8, base - 19, 'rgba(230,230,230,0.7)'); p.px(W - 6, base - 21, 'rgba(230,230,230,0.5)');
      // pylon with a spark
      p.vline(2, base - 18, 9, '#5a5a62'); p.hline(0, base - 16, 5, '#5a5a62'); p.px(0, base - 17, '#8ad8ff'); p.px(4, base - 17, '#8ad8ff'); return true;
    }
    case 'windmill': {
      p.rect(cx - 3, base - 12, 6, 11, S.wall); p.vline(cx + 2, base - 12, 11, S.wallD); p.rect(cx - 4, base - 13, 8, 2, S.roof);
      p.rect(cx - 1, base - 4, 2, 3, '#2a1e18');
      const hx = cx, hy = base - 13; for (const [dx, dy] of [[1, 1], [-1, -1], [1, -1], [-1, 1]]) for (let r = 1; r <= 6; r++) { p.px(hx + dx * r, hy + dy * r, S.wood); if (r > 2) p.px(hx + dx * r + (dx === dy ? 1 : 0), hy + dy * r + (dx === dy ? 0 : 1), '#ecdcc0'); }
      p.px(hx, hy, '#3a2a1a'); return true;
    }
    case 'waterwheel': {
      house(p, S, k, 5, base - 2, 9, 6, 5);
      p.ellipse(W - 5, base - 6, 4, 4, S.woodD); p.ellipse(W - 5, base - 6, 3, 3, 'rgba(0,0,0,0)');
      for (const [dx, dy] of [[0, -4], [4, 0], [0, 4], [-4, 0], [3, -3], [-3, 3], [3, 3], [-3, -3]]) p.px(W - 5 + dx, base - 6 + dy, S.wood);
      p.vline(W - 5, base - 9, 7, S.wood); p.hline(W - 8, base - 6, 7, S.wood); p.px(W - 5, base - 6, '#3a2a1a');
      p.hline(W - 10, base - 1, 9, '#4a8ad8'); p.px(W - 2, base - 2, '#cfe4f4'); return true;
    }
    case 'boatyard': {
      p.rect(1, base - 3, W - 2, 2, '#8a6a4a'); for (let x = 2; x < W - 1; x += 3) p.px(x, base - 2, '#6b4e34'); // slipway
      // hull on a cradle
      p.hline(3, base - 6, 10, '#7a5232'); p.hline(4, base - 5, 8, '#5a3a22'); p.px(2, base - 7, '#7a5232'); p.px(13, base - 7, '#7a5232');
      for (const x of [5, 8, 11]) p.vline(x, base - 4, 2, S.woodD);
      p.vline(8, base - 14, 8, S.wood); p.rect(9, base - 13, 4, 5, '#ecdcc0'); // mast and sail
      return true;
    }
    case 'outpost': {
      // a work camp: canvas tent, ore cart on rails and a pick
      for (let r = 0; r < 6; r++) p.hline(4 - r, base - 9 + r, r * 2 + 1, r % 2 ? '#e8dcc0' : '#d4c4a0'); p.vline(4, base - 10, 2, S.woodD); p.px(4, base - 4, '#3a2a18');
      p.hline(7, base - 1, 8, '#6a6a6a'); p.rect(9, base - 4, 5, 3, '#5a4030'); p.px(10, base - 5, '#a4624a'); p.px(12, base - 5, '#9a958a'); p.px(10, base - 1, '#2a2a2a'); p.px(13, base - 1, '#2a2a2a');
      p.vline(W - 2, base - 9, 7, S.wood); p.hline(W - 4, base - 9, 4, '#8a8f99'); banner(p, S, 1, base - 1, 9); return true;
    }
    case 'loggingcamp': {
      for (let r = 0; r < 6; r++) p.hline(5 - r, base - 10 + r, r * 2 + 1, r % 2 ? '#c8b088' : '#b09870'); p.px(5, base - 5, '#3a2a18');
      for (let i = 0; i < 3; i++) { p.hline(8, base - 1 - i * 2, 7 - i, '#8a5a32'); p.px(8, base - 1 - i * 2, '#c8a070'); p.px(14 - i, base - 1 - i * 2, '#c8a070'); }
      p.rect(W - 3, base - 4, 2, 3, '#6b4a2e'); p.px(W - 3, base - 5, '#b8bec8'); banner(p, S, 1, base - 1, 9); return true;
    }
    case 'storehouse': {
      // a long barn with wide doors, crates and sacks
      p.rect(1, base - 8, W - 2, 7, S.wood); p.vline(W - 2, base - 8, 7, S.woodD); for (let x = 3; x < W - 2; x += 3) p.vline(x, base - 8, 7, S.woodD);
      for (let r = 0; r < 4; r++) p.hline(1 - (r === 3 ? 1 : 0), base - 11 + r, W - 2 + (r === 3 ? 2 : 0), r % 2 ? S.roof : S.roofD);
      p.rect(cx - 3, base - 6, 6, 5, '#3a2a18'); p.vline(cx, base - 6, 5, S.woodD);
      p.rect(1, base - 3, 3, 2, '#a07a4a'); p.rect(W - 4, base - 2, 2, 2, '#e8c858'); return true;
    }
    case 'school': { house(p, S, k, cx - 1, base - 2, 12, 6, 6); p.rect(W - 5, base - 7, 4, 3, '#2a3a2a'); p.outline(W - 5, base - 7, 4, 3, S.wood); p.px(W - 4, base - 6, '#e8e8e8'); p.vline(W - 4, base - 4, 3, S.wood); return true; }
    case 'library': { house(p, S, k, cx, base - 2, 14, 8, 6); for (let x = cx - 6; x < cx + 6; x += 3) p.vline(x, base - 9, 7, S.trim); tradeSign(p, W - 5, base - 13, 'research', S); return true; }
    case 'bathhouse': { house(p, S, k, cx + 2, base - 2, 11, 5, 5); p.rect(1, base - 4, 5, 3, S.stone); p.rect(2, base - 3, 3, 1, '#4a8ad8'); p.px(2, base - 6, 'rgba(255,255,255,0.6)'); p.px(4, base - 7, 'rgba(255,255,255,0.45)'); return true; }
  }
  return false;
}

const PADS = { refinery: 16, steamhouse: 16, powerstation: 14, blastfurnace: 14, windmill: 12, granary: 10, stampmill: 12, guildhall: 14, smelter: 10, tower: 20, capitol: 22, w_vaelith: 24, w_thalori: 20, factory: 14, centre: 18, fort: 14, shrine: 10, w_oruvai: 18, w_kharvak: 16 };
export const buildingPad = type => PADS[type] || 12; // extra canvas height above the footprint

export function buildingSprite(type, tribeKey, opts = {}) {
  const tier = opts.tier || 1, season = opts.season ?? 0, size = opts.size;
  const key = `b|${type}|${tribeKey}|${tier >= 5 ? 3 : tier >= 3 ? 2 : 1}|${opts.field ? season : ''}|${opts.ruin ? 1 : 0}`;
  return memo(key, () => {
    const W = size * 8, H = W + buildingPad(type);
    const c = canvas(W, H); const p = new Pen(c.getContext('2d'));
    const k = TRIBES.find(t => t.key === tribeKey)?.style || tribeKey; const S = S_OF(k);
    const base = H - 1; const cx = W / 2;
    const T = tier >= 5 ? 3 : tier >= 3 ? 2 : 1;
    const gnd = (col) => { p.rect(1, base - W + 2, W - 2, W - 2, col); };
    // newer buildings borrow the look of a close relative, with a few touches of their own below
    const ALIAS = { kiln: 'smelter', brickworks: 'workshop', jeweller: 'mint', saltpans: 'well', herbalist: 'gatherer', refinery: 'factory', granary: 'storehouse', smokehouse: 'hunter', sawmill: 'lumber', stampmill: 'mine', guildhall: 'artisan', caravanserai: 'market', scriptorium: 'library', healer: 'shrine', blastfurnace: 'smelter', steamhouse: 'factory', powerstation: 'factory' };
    if (specialBuilding(type, p, S, k, W, base, cx)) {
      if (opts.ruin) { const ctx = c.getContext('2d'); ctx.globalCompositeOperation = 'source-atop'; ctx.fillStyle = 'rgba(30,20,10,0.55)'; ctx.fillRect(0, 0, W, H); }
      return outlined(c);
    }
    switch (ALIAS[type] || type) {
      case 'centre': {
        gnd('rgba(120,100,70,0.35)');
        // plaza stones
        for (let i = 0; i < 18; i++) p.px(2 + ((i * 7) % (W - 4)), base - 3 - ((i * 5) % (W - 6)), shade(S.stone, -0.1));
        if (T === 1) {
          house(p, S, k, cx - 2, base - 4, 16, 6, 8);
          // fire pit with stones
          p.ellipse(W - 5, base - 3, 3, 1, '#7a7268'); p.rect(W - 6, base - 4, 3, 2, '#3a2a1a'); p.px(W - 5, base - 5, '#f08a24'); p.px(W - 5, base - 6, '#f8c850'); p.px(W - 6, base - 5, '#e05a20'); p.px(W - 4, base - 5, '#f08a24');
          banner(p, S, 2, base - 1, 10);
          p.rect(3, base - 2, 3, 2, '#a07a4a'); p.rect(W - 9, base - 2, 2, 2, '#8a6a42');
        } else if (T === 2) {
          house(p, S, k, cx, base - 3, 18, 7, 8);
          banner(p, S, 2, base - 2, 10); banner(p, S, W - 4, base - 2, 10);
        } else {
          house(p, S, k, cx, base - 2, 20, 9, 10);
          p.rect(cx - 2, base - 22, 4, 6, S.wall); p.vline(cx + 1, base - 22, 6, S.wallD); roof(p, S, cx, base - 27, 6, 5, S.shape);
          banner(p, S, 1, base - 1, 12); banner(p, S, W - 4, base - 1, 12);
        }
        if (k === 'kharvak') { for (let x = 1; x < W - 1; x += 2) { p.vline(x, base - 2, 3, S.wood); p.px(x, base - 3, '#c8b090'); } }
        if (k === 'thalori') { p.ellipse(W - 4, base - 16, 3, 3, '#3f8a2e'); p.vline(W - 4, base - 13, 4, '#6b4a2e'); }
        if (k === 'oruvai') { p.rect(1, base - 1, W - 2, 1, S.stone); p.px(cx - 6, base - 2, S.trim); p.px(cx + 6, base - 2, S.trim); }
        if (k === 'vaelith') { p.px(2, base - 6, S.glow); p.vline(2, base - 5, 4, S.roof); p.px(W - 3, base - 6, S.glow); p.vline(W - 3, base - 5, 4, S.roof); }
        break;
      }
      case 'hut': {
        if (k === 'kharvak') { // A-frame log hut
          shadowBase(p, 2, base - 1, 12);
          for (let r = 0; r < 9; r++) { const hw = Math.round(r * 0.7) + 1; p.rect(cx - hw, base - 10 + r, hw * 2, 1, r % 2 ? S.roof : shade(S.roof, -0.15)); p.px(cx - hw, base - 10 + r, S.roofL); p.px(cx + hw - 1, base - 10 + r, S.roofD); }
          p.rect(cx - 1, base - 4, 2, 3, '#2a1e18'); p.px(cx - 1, base - 11, '#e8dcc0'); p.px(cx, base - 11, '#e8dcc0');
        } else if (k === 'thalori') {
          shadowBase(p, 2, base - 1, 12);
          p.ellipse(cx, base - 6, 6, 5, S.roof); p.ellipse(cx - 1, base - 8, 4, 2, S.roofL); p.rect(cx - 1, base - 4, 2, 3, '#3a2a18');
          p.px(cx - 4, base - 6, '#93cc5a'); p.px(cx + 3, base - 9, '#3b6c22'); p.px(cx + 4, base - 3, '#3b6c22');
        } else if (k === 'vaelith') {
          house(p, S, k, cx, base - 1, 9, 5, 5);
        } else {
          shadowBase(p, 2, base - 1, 12);
          wall(p, S, cx - 5, base - 5, 10, 4, k); roof(p, S, cx, base - 10, 10, 6, 'dome'); door(p, S, cx - 1, base - 1, 3);
        }
        break;
      }
      case 'house': house(p, S, k, cx, base - 1, 13, 6, 7); if (k === 'oruvai') banner(p, S, W - 2, base - 1, 7); break;
      case 'manor': house(p, S, k, cx, base - 2, 20, 9, 9); windows(p, S, cx - 10, base - 7, 20, 4); break;
      case 'terrace': {
        house(p, S, k, cx - 5, base - 2, 12, 12, 8); house(p, S, k, cx + 5, base - 2, 12, 12, 8);
        windows(p, S, cx - 11, base - 9, 22, 5); windows(p, S, cx - 11, base - 6, 22, 5);
        break;
      }
      case 'farm': case 'orchard': {
        const crop = [['#7cbc46', '#5f9e34'], ['#c8c050', '#9aa83a'], ['#e8c450', '#c89a30'], ['#9a8a6a', '#7a6a50']][season];
        const soil = '#7a5a3a', soilD = '#5e4430';
        p.rect(0, base - W + 1, W, W - 1, soil);
        for (let y = base - W + 2; y < base; y += 2) p.hline(1, y, W - 2, soilD);
        if (type === 'farm') {
          for (let y = base - W + 2; y < base - 1; y += 2) for (let x = 1; x < W - 1; x++) if ((x + y) % 3 !== 0) p.px(x, y, (x * 7 + y) % 5 ? crop[0] : crop[1]);
        } else {
          for (let y = base - W + 3; y < base - 1; y += 2) for (let x = 1; x < W / 2; x++) if (x % 2) p.px(x, y, season === 3 ? '#8a7a5a' : '#5aa040');
          for (let i = 0; i < 3; i++) { const tx = W / 2 + 3 + (i % 2) * 5, ty = base - 6 - i * 6; p.ellipse(tx, ty, 2, 2, season === 3 ? '#7a6a4a' : '#3f9434'); p.vline(tx, ty + 2, 2, '#6b4a2e'); if (season === 2 || season === 1) p.px(tx - 1, ty, '#d8484a'); }
        }
        // fence & shed
        p.hline(0, base - W + 1, W, S.wood); p.hline(0, base, W, S.wood); p.vline(0, base - W + 1, W, S.wood); p.vline(W - 1, base - W + 1, W, S.wood);
        house(p, S, k, 5, base - W + 8, 7, 3, 4);
        break;
      }
      case 'pasture': {
        p.rect(0, base - W + 1, W, W - 1, '#78b444');
        for (let i = 0; i < 20; i++) p.px((i * 11) % W, base - 2 - ((i * 7) % (W - 3)), '#5e9a36');
        for (let x = 0; x < W; x += 3) { p.vline(x, base - W + 1, 2, S.wood); p.vline(x, base - 1, 2, S.wood); }
        p.hline(0, base - W + 1, W, shade(S.wood, 0.2)); p.hline(0, base - 1, W, shade(S.wood, 0.2));
        house(p, S, k, W - 6, base - W + 9, 8, 3, 4);
        break;
      }
      case 'lumber': {
        house(p, S, k, cx + 2, base - 4, 9, 4, 5);
        for (let i = 0; i < 3; i++) { p.hline(1, base - 2 - i * 2, 6 - i, '#8a5a32'); p.px(1, base - 2 - i * 2, '#c8a070'); p.px(6 - i, base - 2 - i * 2, '#c8a070'); }
        p.rect(W - 4, base - 2, 2, 2, '#6b4a2e'); p.px(W - 3, base - 3, '#b8bec8');
        break;
      }
      case 'gatherer': {
        p.ellipse(cx - 2, base - 5, 5, 4, k === 'thalori' ? S.roof : '#b89a60'); p.ellipse(cx - 3, base - 7, 3, 2, shade(k === 'thalori' ? S.roof : '#b89a60', 0.2));
        p.rect(cx - 3, base - 3, 2, 2, '#3a2a18');
        p.rect(W - 6, base - 3, 3, 2, '#b08850'); p.px(W - 6, base - 3, '#d8484a'); p.px(W - 5, base - 4, '#7ab845');
        banner(p, S, W - 2, base - 1, 6);
        break;
      }
      case 'hunter': {
        house(p, S, k, cx - 1, base - 3, 10, 4, 5);
        p.vline(W - 3, base - 8, 7, '#6b4a2e'); p.hline(W - 5, base - 8, 5, '#6b4a2e'); p.rect(W - 4, base - 7, 2, 3, '#9a6a3a'); p.px(W - 4, base - 7, '#e8dcc8');
        break;
      }
      case 'fishery': case 'harbor': {
        const big = type === 'harbor';
        p.rect(0, base - 3, W, 3, '#8a6a4a'); for (let x = 1; x < W; x += 2) p.px(x, base - 2, '#6b4e34');
        if (big) { p.rect(W - 4, base - W + 4, 3, W - 6, '#8a6a4a'); p.vline(W - 9, base - 18, 14, '#5a3c26'); p.rect(W - 13, base - 17, 5, 6, '#ecdcc0'); p.px(W - 13, base - 17, S.banner); }
        house(p, S, k, big ? cx - 4 : cx, base - 3, big ? 14 : 10, 4, 5);
        p.vline(2, base - 7, 4, '#6b4a2e'); p.hline(2, base - 7, 3, '#cfd8e0'); p.px(4, base - 6, '#cfd8e0');
        break;
      }
      case 'quarry': {
        p.ellipse(cx, base - 6, 7, 5, '#8a857a'); p.ellipse(cx, base - 6, 5, 3, '#6a665e'); p.ellipse(cx + 1, base - 5, 3, 2, '#55524c');
        p.rect(1, base - 3, 3, 2, '#bab4a6'); p.rect(W - 5, base - 4, 3, 3, '#bab4a6'); p.px(W - 5, base - 4, '#d8d2c4');
        p.vline(W - 2, base - 10, 8, '#6b4a2e'); p.hline(W - 6, base - 10, 5, '#6b4a2e'); p.vline(W - 6, base - 9, 3, '#8a8a8a');
        break;
      }
      case 'mine': case 'derrick': {
        if (type === 'derrick') {
          for (let r = 0; r < 14; r++) { const hw = Math.round((14 - r) / 4); p.px(cx - hw, base - 2 - r, '#3a3a40'); p.px(cx + hw, base - 2 - r, '#3a3a40'); if (r % 3 === 0) p.hline(cx - hw, base - 2 - r, hw * 2 + 1, '#4a4a52'); }
          p.rect(cx - 3, base - 2, 7, 2, '#2a2a30'); p.rect(1, base - 4, 4, 3, '#141018'); p.px(2, base - 5, '#3a3a3a');
        } else {
          p.ellipse(cx, base - 6, 7, 6, '#7a6a52'); p.ellipse(cx - 2, base - 9, 4, 3, '#8f7f64');
          p.rect(cx - 2, base - 6, 4, 5, '#1a1410'); p.hline(cx - 3, base - 7, 6, S.wood); p.vline(cx - 3, base - 7, 6, S.wood); p.vline(cx + 2, base - 7, 6, S.wood);
          p.hline(cx + 2, base - 1, 6, '#6a6a6a'); p.rect(W - 5, base - 4, 3, 2, '#5a4030'); p.px(W - 4, base - 5, '#a4624a');
        }
        break;
      }
      case 'workshop': case 'smelter': case 'armory': case 'artisan': case 'mint': {
        house(p, S, k, cx - 1, base - 2, 12, 5, 6);
        if (type !== 'artisan') { p.rect(W - 5, base - 15, 3, 9, type === 'smelter' ? '#6a5a50' : S.stoneD); p.px(W - 5, base - 15, '#2a2a2a'); }
        if (type === 'armory' || type === 'workshop') { p.rect(1, base - 3, 3, 1, '#4a4a4a'); p.px(2, base - 2, '#4a4a4a'); }
        if (type === 'smelter') { p.px(W - 4, base - 4, '#f08a24'); p.px(W - 4, base - 5, '#f8c850'); }
        if (type === 'artisan') { p.rect(W - 5, base - 5, 3, 3, '#c89a5a'); p.px(W - 4, base - 6, '#d8484a'); }
        if (type === 'mint') { p.px(2, base - 3, '#f2c84b'); p.px(3, base - 3, '#f2c84b'); p.px(2, base - 4, '#f2c84b'); }
        break;
      }
      case 'factory': {
        house(p, S, k, cx - 2, base - 2, 18, 9, 5);
        for (const x of [W - 6, W - 3]) { p.rect(x, base - 22, 2, 14, '#5a5050'); p.hline(x, base - 22, 2, '#3a3030'); }
        windows(p, S, cx - 11, base - 6, 18, 4);
        break;
      }
      case 'storehouse': {
        house(p, S, k, cx, base - 2, 14, 6, 6);
        p.rect(1, base - 4, 3, 3, '#a07a4a'); p.outline(1, base - 4, 3, 3, '#6b4a2e');
        p.rect(W - 4, base - 3, 3, 3, '#8a6a42'); p.px(W - 3, base - 2, '#5a4030');
        break;
      }
      case 'well': {
        p.ellipse(4, base - 3, 3, 2, S.stone); p.ellipse(4, base - 4, 2, 1, '#2a4a7a'); p.rect(1, base - 3, 7, 2, S.stone); p.hline(1, base - 2, 7, S.stoneD);
        p.vline(1, base - 10, 7, S.wood); p.vline(6, base - 10, 7, S.wood); p.hline(0, base - 11, 8, S.roof); p.hline(1, base - 12, 6, S.roofL);
        break;
      }
      case 'market': {
        const cols = [S.banner, '#e8c050', '#e8e0d0', S.roofL];
        for (let i = 0; i < 4; i++) {
          const x = 2 + (i % 2) * 11, y = base - 4 - Math.floor(i / 2) * 9;
          p.rect(x, y - 2, 8, 3, '#8a6a4a'); p.vline(x, y - 5, 4, S.wood); p.vline(x + 7, y - 5, 4, S.wood);
          for (let j = 0; j < 8; j++) p.px(x + j, y - 6, j % 2 ? cols[i] : '#f4ecd8'); p.hline(x, y - 5, 8, shade(cols[i], -0.2));
          p.px(x + 2, y - 2, '#d8484a'); p.px(x + 4, y - 2, '#e8c858'); p.px(x + 5, y - 2, '#7ab845');
        }
        break;
      }
      case 'shrine': {
        if (k === 'thalori') { p.ellipse(cx, base - 9, 5, 5, '#3f9434'); p.ellipse(cx - 1, base - 11, 3, 2, '#5cb048'); p.rect(cx - 1, base - 5, 2, 4, '#6b4a2e'); p.ellipse(cx, base - 2, 6, 1, S.stone); }
        else if (k === 'kharvak') { p.rect(cx - 1, base - 14, 3, 13, '#6b4a2e'); p.px(cx - 2, base - 12, '#e8dcc0'); p.px(cx + 2, base - 12, '#e8dcc0'); p.px(cx - 3, base - 13, '#e8dcc0'); p.px(cx + 3, base - 13, '#e8dcc0'); p.rect(cx - 1, base - 9, 3, 2, S.banner); p.px(cx, base - 15, '#f08a24'); }
        else if (k === 'vaelith') { p.rect(cx - 2, base - 3, 5, 2, S.stone); for (let r = 0; r < 10; r++) { const hw = r < 3 ? r : Math.max(0, 3 - Math.floor((r - 3) / 3)); p.rect(cx - hw, base - 13 + r, hw * 2 + 1, 1, r % 2 ? S.roofL : S.roof); } p.px(cx, base - 14, S.glow); }
        else { p.rect(cx - 3, base - 3, 7, 2, S.stone); p.rect(cx - 1, base - 12, 3, 9, S.accent); p.vline(cx + 1, base - 12, 9, S.wallD); p.ellipse(cx, base - 13, 2, 1, S.roof); }
        break;
      }
      case 'bathhouse': house(p, S, k, cx, base - 2, 14, 5, 5); p.rect(1, base - 3, 4, 2, '#4a8ad8'); p.px(2, base - 6, 'rgba(255,255,255,0.6)'); break;
      case 'school': house(p, S, k, cx, base - 2, 13, 6, 6); p.rect(W - 4, base - 5, 3, 2, '#e8dcc0'); p.px(W - 4, base - 5, S.banner); break;
      case 'library': house(p, S, k, cx, base - 2, 14, 8, 6); for (let x = cx - 6; x < cx + 6; x += 3) p.vline(x, base - 9, 7, S.trim); break;
      case 'academy': house(p, S, k, cx, base - 2, 20, 9, 9); for (let x = cx - 9; x < cx + 9; x += 3) p.vline(x, base - 10, 8, S.trim); banner(p, S, 1, base - 1, 12); break;
      case 'council': house(p, S, k, cx, base - 2, 20, 8, 9); banner(p, S, 1, base - 1, 12); banner(p, S, W - 3, base - 1, 12); p.rect(cx - 2, base - 5, 4, 4, '#2a1e18'); break;
      case 'admin': house(p, S, k, cx, base - 2, 21, 10, 8); windows(p, S, cx - 10, base - 7, 20, 4); windows(p, S, cx - 10, base - 4, 20, 2); banner(p, S, cx, base - 18, 6); break;
      case 'capitol': {
        house(p, S, k, cx, base - 1, 22, 10, 7);
        p.rect(cx - 4, base - 21, 8, 6, S.wall); p.vline(cx + 3, base - 21, 6, S.wallD); roof(p, S, cx, base - 28, 9, 7, S.shape === 'pitched' ? 'pitched' : 'dome');
        for (let x = cx - 10; x < cx + 10; x += 3) p.vline(x, base - 10, 8, S.trim);
        banner(p, S, 1, base, 14); banner(p, S, W - 3, base, 14);
        break;
      }
      case 'training': {
        p.rect(1, base - W + 3, W - 2, W - 4, '#a08a5a'); p.outline(1, base - W + 3, W - 2, W - 4, S.wood);
        p.vline(4, base - 9, 6, '#6b4a2e'); p.hline(3, base - 8, 3, '#6b4a2e'); p.ellipse(4, base - 10, 1, 1, '#c8a070');
        p.ellipse(W - 5, base - 6, 2, 2, '#e8dcc0'); p.px(W - 5, base - 6, S.banner);
        banner(p, S, W - 2, base - 1, 9);
        break;
      }
      case 'barracks': {
        house(p, S, k, cx, base - 2, 22, 6, 7);
        p.vline(2, base - 10, 8, '#6b4a2e'); for (let i = 0; i < 3; i++) p.vline(4 + i * 2, base - 9, 7, '#6b4a2e'), p.px(4 + i * 2, base - 10, '#b8bec8');
        banner(p, S, W - 3, base - 1, 14);
        break;
      }
      case 'tower': {
        const tw = 6, tx = 1;
        p.rect(tx, base - 18, tw, 17, k === 'kharvak' || k === 'thalori' ? S.wood : S.stone);
        p.vline(tx + tw - 1, base - 18, 17, k === 'kharvak' || k === 'thalori' ? S.woodD : S.stoneD);
        for (let y = base - 16; y < base - 1; y += 3) p.hline(tx, y, tw, shade(k === 'kharvak' || k === 'thalori' ? S.wood : S.stone, -0.15));
        p.rect(tx - 1, base - 20, tw + 2, 2, S.roofD); for (let x = tx - 1; x < tx + tw + 1; x += 2) p.px(x, base - 21, S.roofD);
        if (k === 'oruvai' || k === 'vaelith') roof(p, S, tx + tw / 2, base - 26, 8, 6, k === 'vaelith' ? 'spire' : 'dome');
        p.px(tx + 2, base - 12, '#1a1410');
        banner(p, S, tx + tw - 1, base - 20, 5);
        break;
      }
      case 'fort': {
        const wc = S.stone, wd = S.stoneD;
        p.rect(1, base - 8, W - 2, 7, wc); p.hline(1, base - 2, W - 2, wd);
        for (let x = 1; x < W - 1; x += 3) p.rect(x, base - 10, 2, 2, wc);
        p.rect(cx - 5, base - 18, 10, 10, wc); p.vline(cx + 4, base - 18, 10, wd);
        for (let x = cx - 5; x < cx + 5; x += 3) p.rect(x, base - 20, 2, 2, wc);
        p.rect(cx - 1, base - 6, 3, 5, '#2a1e18');
        banner(p, S, cx, base - 20, 7);
        for (const x of [1, W - 5]) { p.rect(x, base - 14, 4, 13, wc); p.vline(x + 3, base - 14, 13, wd); p.rect(x, base - 16, 1, 2, wc); p.rect(x + 3, base - 16, 1, 2, wc); }
        break;
      }
      case 'w_oruvai': {
        p.rect(1, base - 3, W - 2, 2, S.stone);
        for (let x = 2; x < W - 1; x += 3) { p.vline(x, base - 13, 10, '#f4f0e6'); p.px(x + 1, base - 13, S.wallD); }
        p.rect(1, base - 15, W - 2, 2, S.wall); p.hline(1, base - 14, W - 2, S.trim);
        roof(p, S, cx, base - 25, 16, 10, 'dome');
        banner(p, S, 1, base - 15, 6); banner(p, S, W - 3, base - 15, 6);
        p.ellipse(cx, base - 4, 3, 1, '#4a8ad8');
        break;
      }
      case 'w_kharvak': {
        house(p, S, k, cx, base - 2, 22, 9, 11);
        for (let i = 0; i < 5; i++) banner(p, S, 2 + i * 5, base - 1, 6 + (i % 2) * 3);
        p.px(cx - 6, base - 23, '#e8dcc0'); p.px(cx + 5, base - 23, '#e8dcc0'); p.px(cx - 7, base - 24, '#e8dcc0'); p.px(cx + 6, base - 24, '#e8dcc0');
        break;
      }
      case 'w_thalori': {
        p.ellipse(cx, base - 4, 11, 3, '#6a8a44');
        p.rect(cx - 2, base - 16, 5, 14, '#6b4a2e'); p.vline(cx + 2, base - 16, 14, '#4a3220');
        p.ellipse(cx, base - 22, 10, 7, '#2f7a2a'); p.ellipse(cx - 2, base - 25, 6, 4, '#4f9e3a'); p.ellipse(cx - 4, base - 27, 3, 2, '#7ccc5c');
        for (let i = 0; i < 6; i++) p.px(cx - 8 + i * 3, base - 20 + (i % 2) * 3, '#e8d050');
        p.rect(cx - 7, base - 7, 3, 4, S.stone); p.rect(cx + 5, base - 7, 3, 4, S.stone);
        break;
      }
      case 'w_vaelith': {
        p.rect(cx - 6, base - 6, 12, 5, S.stone); p.hline(cx - 6, base - 6, 12, S.trim);
        p.rect(cx - 3, base - 22, 6, 16, S.wall); p.vline(cx + 2, base - 22, 16, S.wallD);
        for (let y = base - 20; y < base - 7; y += 4) p.px(cx, y, S.glow);
        for (let r = 0; r < 9; r++) { const hw = r < 4 ? r : 8 - r; p.rect(cx - hw, base - 32 + r, hw * 2 + 1, 1, r % 2 ? S.glow : S.roofL); }
        p.px(cx, base - 33, '#ffffff');
        break;
      }
      default: house(p, S, k, cx, base - 2, Math.min(W - 2, 14), 6, 6);
    }
    if (opts.ruin) { const ctx = c.getContext('2d'); ctx.globalCompositeOperation = 'source-atop'; ctx.fillStyle = 'rgba(30,20,10,0.55)'; ctx.fillRect(0, 0, W, H); }
    return outlined(c);
  });
}

// Construction overlay: foundation and scaffolding
export function scaffoldSprite(size, pad = 12) {
  return memo('scaf|' + size + '|' + pad, () => {
    const W = size * 8, H = W + pad;
    const c = canvas(W, H); const p = new Pen(c.getContext('2d'));
    const base = H - 1;
    p.rect(1, base - W + 2, W - 2, W - 2, 'rgba(150,120,80,0.45)');
    p.outline(1, base - W + 2, W - 2, W - 2, '#8a6a4a');
    for (let x = 2; x < W - 1; x += 4) p.vline(x, base - Math.min(W, 14), Math.min(W, 14), '#a07850');
    for (let y = base - 2; y > base - Math.min(W, 14); y -= 4) p.hline(1, y, W - 2, '#8a6a4a');
    return c;
  });
}

// ------------------------------------------------------------------ glow
export function glowSprite(color = '255,200,120', r = 16) {
  return memo(`g|${color}|${r}`, () => {
    const c = canvas(r * 2, r * 2); const ctx = c.getContext('2d');
    const g = ctx.createRadialGradient(r, r, 0, r, r, r);
    g.addColorStop(0, `rgba(${color},0.55)`); g.addColorStop(0.4, `rgba(${color},0.18)`); g.addColorStop(1, `rgba(${color},0)`);
    ctx.fillStyle = g; ctx.fillRect(0, 0, r * 2, r * 2);
    return c;
  });
}

// ------------------------------------------------------------------ clouds
export function cloudSprite(seed) {
  return memo('cloud|' + seed, () => {
    const w = 64, h = 28; const c = canvas(w, h); const p = new Pen(c.getContext('2d'));
    const blobs = [];
    for (let i = 0; i < 7; i++) blobs.push([10 + hash2(i, seed, 1) * 44, 12 + hash2(i, seed, 2) * 6, 5 + hash2(i, seed, 3) * 7]);
    for (const [x, y, r] of blobs) p.ellipse(x | 0, y | 0, r | 0, (r * 0.7) | 0, '#e6eef8');
    for (const [x, y, r] of blobs) p.ellipse((x - 1) | 0, (y - 2) | 0, (r * 0.7) | 0, (r * 0.45) | 0, '#ffffff');
    for (const [x, y, r] of blobs) p.hline((x - r * 0.6) | 0, (y + r * 0.6) | 0, (r * 1.2) | 0, '#c4d2e4');
    return c;
  });
}
