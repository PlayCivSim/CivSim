// Custom 12x12 pixel icons drawn in code and exposed as data URLs for the UI.
import { canvas, Pen, shade } from '../render/pixel.js';
import { TRIBES } from '../data/tribes.js';
import { personSprite, buildingSprite } from '../render/sprites.js';

const urls = new Map();
const O = '#1a1210'; // outline

function ingot(p, c) { p.rect(2, 5, 8, 4, c); p.rect(3, 4, 6, 1, shade(c, 0.35)); p.hline(2, 9, 8, shade(c, -0.35)); p.outline(1, 4, 10, 6, O); p.px(4, 6, shade(c, 0.6)); }
function ore(p, c) { p.ellipse(6, 7, 4, 3, '#6a645c'); p.px(4, 6, c); p.px(5, 7, c); p.px(7, 5, c); p.px(8, 8, c); p.px(6, 9, shade(c, 0.3)); p.px(3, 8, shade(c, -0.2)); p.hline(3, 10, 6, O); }
function coin(p, x, y, c = '#f2c84b') { p.rect(x, y, 5, 2, c); p.hline(x, y + 2, 5, shade(c, -0.35)); p.px(x + 1, y, shade(c, 0.5)); }
function person(p, x, y, c) { p.rect(x + 1, y, 2, 2, '#e8c09a'); p.rect(x, y + 2, 4, 3, c); p.px(x + 3, y + 3, shade(c, -0.3)); p.px(x + 1, y + 5, '#2a1e18'); p.px(x + 2, y + 5, '#2a1e18'); }

const DRAW = {
  wood: p => { p.rect(1, 5, 10, 4, '#8a5a32'); p.hline(1, 5, 10, '#a8743e'); p.ellipse(10, 7, 1, 2, '#d8b080'); p.px(10, 7, '#8a5a32'); p.hline(1, 9, 10, O); p.rect(3, 3, 7, 2, '#7a4e2a'); p.ellipse(9, 4, 1, 1, '#d8b080'); },
  stone: p => { p.ellipse(6, 7, 5, 3, '#8f8a80'); p.ellipse(5, 6, 3, 2, '#aaa49a'); p.px(4, 5, '#cfc8bc'); p.hline(2, 10, 8, O); p.px(8, 8, '#6a665e'); },
  clay: p => { p.rect(1, 6, 5, 3, '#b8714a'); p.rect(6, 6, 5, 3, '#a8603e'); p.rect(3, 3, 6, 3, '#c8805a'); p.hline(1, 9, 10, O); p.hline(3, 3, 6, '#d89a70'); },
  fibre: p => { for (let x = 3; x < 9; x++) p.vline(x, 2, 8, x % 2 ? '#d8cf98' : '#bfb47a'); p.hline(2, 6, 8, '#8a6a3a'); p.hline(3, 10, 6, O); },
  grain: p => { p.vline(6, 3, 8, '#b08a30'); for (let y = 2; y < 8; y += 2) { p.px(5, y, '#e8c858'); p.px(7, y + 1, '#e8c858'); p.px(4, y + 1, '#d8b040'); p.px(8, y, '#d8b040'); } p.px(6, 1, '#f4dc80'); p.vline(3, 6, 4, '#b08a30'); p.vline(9, 6, 4, '#b08a30'); },
  meat: p => { p.ellipse(5, 5, 4, 3, '#c45a4a'); p.ellipse(4, 4, 2, 1, '#e07a68'); p.rect(8, 7, 3, 2, '#f0e6d8'); p.px(10, 6, '#f0e6d8'); p.px(10, 9, '#f0e6d8'); p.hline(2, 9, 6, '#8a3a30'); },
  fish: p => { p.ellipse(5, 6, 4, 2, '#8fb8d8'); p.hline(2, 5, 6, '#c4dcef'); p.px(3, 6, O); p.px(10, 4, '#6a98c0'); p.px(10, 8, '#6a98c0'); p.px(9, 5, '#6a98c0'); p.px(9, 7, '#6a98c0'); p.px(9, 6, '#6a98c0'); },
  fruit: p => { p.ellipse(6, 7, 4, 3, '#d8484a'); p.px(4, 5, '#f08a80'); p.px(5, 5, '#f08a80'); p.vline(6, 2, 3, '#6b4a2e'); p.rect(7, 2, 2, 1, '#5aa040'); p.hline(3, 10, 6, '#8a2a2a'); },
  veg: p => { for (let y = 4; y < 11; y++) { const w = Math.max(1, 4 - Math.floor((y - 4) / 2)); p.rect(6 - Math.floor(w / 2), y, w, 1, '#e8803a'); } p.px(5, 5, '#f4a060'); p.vline(5, 1, 3, '#5aa040'); p.vline(7, 1, 3, '#7ab845'); p.px(6, 2, '#5aa040'); },
  food: p => { p.ellipse(6, 7, 5, 2, '#8a5a32'); p.ellipse(6, 6, 4, 1, '#e8c858'); p.px(4, 5, '#d8484a'); p.px(7, 5, '#7ab845'); p.px(6, 4, '#c45a4a'); p.hline(2, 9, 8, O); },
  livestock: p => { p.ellipse(6, 6, 4, 3, '#f0ece2'); p.ellipse(5, 5, 2, 1, '#ffffff'); p.rect(9, 4, 2, 2, '#3a3030'); p.px(3, 9, '#3a3030'); p.px(8, 9, '#3a3030'); },
  iron: p => ore(p, '#c87a5a'), copper: p => ore(p, '#4fc0a0'), coal: p => { p.ellipse(6, 7, 4, 3, '#2a2a2e'); p.px(4, 5, '#5a5a62'); p.px(7, 6, '#4a4a52'); p.hline(3, 10, 6, O); },
  silver: p => ingot(p, '#d6dbe4'), gold: p => ingot(p, '#f2c84b'), steel: p => ingot(p, '#9aaed0'),
  gems: p => { p.map(2, 2, ['..aaaa..', '.abbbba.', 'abbccbba', '.bbbbbb.', '..bbbb..', '...bb...', '........'], { a: '#f6a8f0', b: '#e05ad8', c: '#ffffff' }); p.hline(4, 9, 4, O); },
  oil: p => { for (let y = 2; y < 10; y++) { const w = Math.min(6, Math.floor((y - 1) * 1.2)); p.rect(6 - w / 2, y, w, 1, '#141018'); } p.px(5, 6, '#5a4a70'); p.hline(3, 10, 6, O); },
  salt: p => { p.ellipse(6, 8, 4, 2, '#efe9de'); p.ellipse(6, 6, 2, 2, '#ffffff'); p.px(5, 5, '#ffffff'); p.hline(2, 10, 8, '#b8b0a0'); },
  herbs: p => { p.vline(6, 4, 7, '#3a6e2c'); p.ellipse(4, 5, 2, 1, '#5ab86a'); p.ellipse(8, 4, 2, 1, '#5ab86a'); p.ellipse(4, 8, 2, 1, '#4aa058'); p.ellipse(8, 7, 2, 1, '#7ad08a'); },
  tools: p => { p.vline(4, 3, 8, '#8a5a32'); p.hline(2, 2, 5, '#9aa0a8'); p.px(1, 3, '#9aa0a8'); p.px(7, 3, '#9aa0a8'); p.vline(8, 5, 6, '#8a5a32'); p.rect(7, 3, 3, 2, '#b8bec8'); },
  weapons: p => { for (let i = 0; i < 7; i++) p.px(2 + i, 9 - i, '#d8dee8'); for (let i = 0; i < 6; i++) p.px(3 + i, 9 - i, '#9aa0a8'); p.hline(1, 8, 4, '#8a6a3a'); p.px(1, 10, '#8a5a32'); p.px(2, 9, '#8a5a32'); },
  goods: p => { p.rect(2, 4, 8, 6, '#c89a5a'); p.outline(2, 4, 8, 6, '#7a5a32'); p.hline(2, 6, 8, '#7a5a32'); p.rect(4, 2, 4, 2, '#d8484a'); },
  machinery: p => { p.ellipse(6, 6, 4, 4, '#8a8f99'); p.ellipse(6, 6, 2, 2, '#5a5f69'); for (const [x, y] of [[6, 1], [6, 11], [1, 6], [11, 6], [2, 2], [10, 10], [2, 10], [10, 2]]) p.px(x, y, '#8a8f99'); p.px(6, 6, '#2a2a30'); },
  coins: p => { coin(p, 1, 8); coin(p, 4, 6); coin(p, 2, 4); coin(p, 6, 3); coin(p, 5, 9); },
  research: p => { p.rect(2, 2, 8, 9, '#e8dcc0'); p.outline(2, 2, 8, 9, '#8a6a3a'); for (let y = 4; y < 10; y += 2) p.hline(4, y, 4, '#8a7a60'); p.px(9, 2, '#d8484a'); p.vline(9, 3, 2, '#d8484a'); },
  // jobs
  idle: p => { person(p, 4, 4, '#9a8a70'); p.px(9, 2, '#cfd8e8'); p.px(10, 1, '#cfd8e8'); p.px(8, 1, '#cfd8e8'); },
  gatherer: p => { p.ellipse(6, 8, 4, 2, '#b08850'); p.rect(2, 6, 9, 3, '#b08850'); p.hline(2, 7, 9, '#8a6a3a'); p.px(4, 5, '#d8484a'); p.px(6, 4, '#7ab845'); p.px(8, 5, '#d8484a'); p.vline(2, 3, 3, '#8a6a3a'); p.vline(10, 3, 3, '#8a6a3a'); p.hline(2, 3, 9, '#8a6a3a'); },
  farmer: p => DRAW.grain(p),
  woodcutter: p => { p.vline(6, 3, 8, '#8a5a32'); p.rect(3, 2, 4, 4, '#b8bec8'); p.vline(3, 2, 4, '#e8eef4'); p.px(7, 3, '#6a6f78'); },
  hunter: p => { for (let y = 1; y < 11; y++) p.px(3 + Math.round(Math.sin((y - 1) / 9 * Math.PI) * 4), y, '#8a5a32'); p.vline(3, 1, 10, '#e8dcc0'); p.hline(3, 6, 7, '#6a5040'); p.px(10, 6, '#b8bec8'); },
  fisher: p => { for (let i = 0; i < 7; i++) p.px(2 + i, 9 - i, '#8a5a32'); p.vline(9, 3, 6, '#cfd8e0'); p.px(8, 9, '#b8bec8'); p.px(10, 9, '#b8bec8'); p.px(9, 10, '#b8bec8'); },
  miner: p => { p.vline(6, 4, 7, '#8a5a32'); p.hline(2, 3, 9, '#9aa0a8'); p.px(1, 4, '#9aa0a8'); p.px(11, 4, '#9aa0a8'); p.px(6, 3, '#6a6f78'); },
  builder: p => { p.vline(5, 5, 6, '#8a5a32'); p.rect(2, 2, 7, 3, '#8a8f99'); p.hline(2, 2, 7, '#b8bec8'); },
  craftsman: p => { p.rect(2, 5, 8, 2, '#6a6a72'); p.rect(4, 7, 4, 2, '#5a5a62'); p.rect(3, 9, 6, 2, '#4a4a52'); p.px(1, 5, '#6a6a72'); p.px(10, 4, '#f08a24'); p.px(9, 3, '#f8c850'); },
  trader: p => { p.ellipse(6, 7, 4, 3, '#b08850'); p.rect(5, 2, 2, 3, '#8a6a3a'); p.px(6, 7, '#f2c84b'); p.px(5, 6, '#f2c84b'); },
  researcher: p => { p.rect(1, 3, 5, 7, '#e8dcc0'); p.rect(6, 3, 5, 7, '#f4ecd8'); p.vline(6, 3, 7, '#8a6a3a'); p.outline(1, 3, 10, 7, '#5a3a8a'); p.hline(2, 5, 3, '#8a7a60'); p.hline(7, 5, 3, '#8a7a60'); p.hline(2, 7, 3, '#8a7a60'); },
  soldier: p => { for (let i = 0; i < 8; i++) p.px(3 + i, 9 - i, '#d8dee8'); p.hline(2, 8, 4, '#8a6a3a'); p.rect(1, 4, 4, 5, '#b3242c'); p.px(2, 5, '#e2585c'); p.outline(1, 4, 4, 5, O); },
  // tabs & misc
  overview: p => { p.ellipse(6, 6, 5, 5, '#d8b25a'); p.ellipse(6, 6, 4, 4, '#2a2420'); p.vline(6, 2, 4, '#e8dcc0'); p.vline(6, 6, 4, '#d8484a'); p.px(6, 6, '#f2c84b'); },
  build: p => { p.rect(2, 6, 7, 5, '#c9b48a'); for (let r = 0; r < 4; r++) p.hline(5 - r, 2 + r, r * 2 + 1, '#b3242c'); p.rect(4, 8, 2, 3, '#4a3020'); p.vline(10, 3, 8, '#8a5a32'); p.rect(9, 2, 3, 2, '#9aa0a8'); },
  population: p => { person(p, 1, 4, '#5f8fe0'); person(p, 7, 4, '#2f8a3e'); person(p, 4, 2, '#d8b25a'); },
  economy: p => { p.vline(6, 2, 8, '#8a6a3a'); p.hline(2, 3, 9, '#d8b25a'); p.ellipse(3, 7, 2, 1, '#d8b25a'); p.ellipse(9, 7, 2, 1, '#d8b25a'); p.vline(2, 4, 3, '#8a6a3a'); p.vline(10, 4, 3, '#8a6a3a'); p.hline(4, 10, 5, '#8a6a3a'); },
  technology: p => { p.rect(5, 1, 2, 4, '#cfd8e8'); for (let y = 5; y < 11; y++) { const w = 2 + (y - 5); p.rect(6 - w / 2, y, w, 1, y > 7 ? '#a873e8' : '#cfd8e8'); } p.px(5, 8, '#e3c6ff'); p.hline(2, 11, 8, O); },
  diplomacy: p => { p.rect(1, 5, 4, 3, '#e8c09a'); p.rect(7, 5, 4, 3, '#d9a77f'); p.rect(4, 4, 4, 4, '#f1c9a5'); p.hline(4, 4, 4, '#b98f6a'); p.rect(0, 4, 2, 5, '#5f8fe0'); p.rect(10, 4, 2, 5, '#b3242c'); },
  government: p => { p.rect(2, 5, 8, 4, '#f2c84b'); p.px(2, 3, '#f2c84b'); p.px(2, 4, '#f2c84b'); p.px(6, 2, '#f2c84b'); p.vline(6, 3, 2, '#f2c84b'); p.px(10, 3, '#f2c84b'); p.px(10, 4, '#f2c84b'); p.px(4, 6, '#d8484a'); p.px(6, 6, '#5f8fe0'); p.px(8, 6, '#2f8a3e'); p.hline(2, 9, 8, '#b08a30'); },
  military: p => { for (let i = 0; i < 9; i++) { p.px(1 + i, 10 - i, '#d8dee8'); p.px(10 - i, 10 - i, '#d8dee8'); } p.px(2, 10, '#8a5a32'); p.px(9, 10, '#8a5a32'); p.hline(1, 8, 3, '#8a6a3a'); p.hline(8, 8, 3, '#8a6a3a'); },
  chronicle: p => { p.rect(2, 2, 8, 9, '#7a3a2a'); p.rect(3, 3, 6, 7, '#9a4a36'); p.vline(2, 2, 9, '#4a2018'); p.rect(5, 5, 2, 2, '#f2c84b'); p.hline(3, 10, 7, '#e8dcc0'); },
  menu: p => { p.ellipse(6, 6, 4, 4, '#9aa0a8'); p.ellipse(6, 6, 2, 2, '#2a2a30'); for (const [x, y] of [[6, 1], [6, 11], [1, 6], [11, 6], [2, 2], [10, 10], [2, 10], [10, 2]]) p.px(x, y, '#9aa0a8'); },
  pause: p => { p.rect(3, 2, 2, 8, '#efe6cf'); p.rect(7, 2, 2, 8, '#efe6cf'); },
  play: p => { for (let x = 0; x < 6; x++) p.vline(3 + x, 2 + x * 0.66, 8 - x * 1.33, '#efe6cf'); },
  fast: p => { for (let x = 0; x < 4; x++) { p.vline(1 + x, 2 + x, 8 - x * 2, '#efe6cf'); p.vline(6 + x, 2 + x, 8 - x * 2, '#efe6cf'); } },
  faster: p => { for (let x = 0; x < 3; x++) { p.vline(0 + x, 3 + x, 6 - x * 2, '#efe6cf'); p.vline(4 + x, 3 + x, 6 - x * 2, '#efe6cf'); p.vline(8 + x, 3 + x, 6 - x * 2, '#efe6cf'); } },
  happy: p => { p.ellipse(6, 6, 5, 5, '#f2c84b'); p.px(4, 4, O); p.px(8, 4, O); p.hline(4, 8, 5, O); p.px(3, 7, O); p.px(9, 7, O); },
  sad: p => { p.ellipse(6, 6, 5, 5, '#d89a4a'); p.px(4, 4, O); p.px(8, 4, O); p.hline(4, 8, 5, O); p.px(3, 9, O); p.px(9, 9, O); },
  stability: p => { p.hline(2, 2, 8, '#cfc8b8'); p.hline(1, 3, 10, '#a59d8b'); for (const x of [3, 6, 9]) p.vline(x, 4, 6, '#cfc8b8'); p.hline(1, 10, 10, '#a59d8b'); },
  heart: p => { p.map(1, 2, ['.aa..aa..', 'abbaabba.', 'abbbbbba.', '.abbbba..', '..abba...', '...aa....'], { a: '#8a1a24', b: '#e04a5a' }); },
  warning: p => { for (let y = 1; y < 11; y++) { const w = Math.round(y * 1.0); p.rect(6 - w / 2, y, w, 1, '#f2c84b'); } p.vline(6, 4, 4, O); p.px(6, 9, O); },
  house: p => { p.rect(2, 6, 8, 5, '#c9b48a'); for (let r = 0; r < 5; r++) p.hline(6 - r - 1, 1 + r, r * 2 + 2, '#8a5a32'); p.rect(5, 8, 2, 3, '#4a3020'); },
  crown: p => DRAW.government(p),
  sun: p => { p.ellipse(6, 6, 3, 3, '#f8d050'); for (const [x, y] of [[6, 0], [6, 12], [0, 6], [12, 6], [2, 2], [10, 10], [2, 10], [10, 2]]) p.px(x, y, '#f8d050'); },
  moon: p => { p.ellipse(6, 6, 4, 4, '#e8eef8'); p.ellipse(8, 5, 3, 3, 'rgba(0,0,0,0)'); const c = p.ctx; c.globalCompositeOperation = 'destination-out'; c.beginPath(); c.arc(8.5, 4.5, 3.5, 0, 7); c.fill(); c.globalCompositeOperation = 'source-over'; },
  star: p => { p.map(1, 1, ['....a....', '....a....', '...aba...', 'aaabbbaaa', '..abbba..', '..ab.ba..', '.ab...ba.'], { a: '#e8b830', b: '#fff0a0' }); },
  skull: p => { p.ellipse(6, 5, 4, 4, '#e8e0d0'); p.rect(4, 8, 5, 3, '#e8e0d0'); p.rect(4, 5, 2, 2, O); p.rect(7, 5, 2, 2, O); p.px(5, 10, O); p.px(7, 10, O); },
  fire: p => { p.ellipse(6, 8, 4, 3, '#e05a20'); p.ellipse(6, 6, 2, 4, '#f08a24'); p.ellipse(6, 8, 1, 2, '#f8d050'); p.px(6, 1, '#f08a24'); },
  wave: p => { for (let x = 0; x < 12; x++) { p.px(x, 5 + Math.round(Math.sin(x / 1.8) * 2), '#7fb2ff'); p.px(x, 8 + Math.round(Math.sin(x / 1.8 + 1) * 2), '#4a8ad8'); } },
  wheat: p => DRAW.grain(p), gem: p => DRAW.gems(p), coin: p => DRAW.coins(p), people: p => DRAW.population(p), scroll: p => DRAW.research(p), hammer: p => DRAW.builder(p),
  bug: p => { p.ellipse(6, 6, 3, 4, '#6a8a2a'); p.vline(6, 2, 9, '#3a4a1a'); for (const y of [4, 6, 8]) { p.px(2, y, '#3a4a1a'); p.px(10, y, '#3a4a1a'); } },
  crack: p => { p.rect(1, 2, 10, 8, '#8a7a6a'); const pts = [[6, 2], [5, 4], [7, 6], [5, 8], [6, 9]]; for (const [x, y] of pts) p.px(x, y, O), p.px(x, y + 1, O); },
  snow: p => { for (const [x, y] of [[6, 1], [6, 2], [6, 3], [6, 4], [6, 5], [6, 6], [6, 7], [6, 8], [6, 9], [6, 10], [2, 3], [3, 4], [4, 5], [10, 3], [9, 4], [8, 5], [2, 9], [3, 8], [4, 7], [10, 9], [9, 8], [8, 7]]) p.px(x, y, '#e8f4ff'); },
  scales: p => DRAW.economy(p),
  fist: p => { p.rect(3, 4, 6, 5, '#d9a77f'); for (const x of [3, 5, 7]) p.px(x, 4, '#b98f6a'); p.rect(4, 9, 4, 2, '#d9a77f'); p.vline(2, 5, 3, '#d9a77f'); },
  check: p => { for (let i = 0; i < 3; i++) p.rect(2 + i, 6 + i, 2, 2, '#7ad08a'); for (let i = 0; i < 5; i++) p.rect(5 + i, 7 - i, 2, 2, '#7ad08a'); },
  lock: p => { p.rect(3, 6, 6, 5, '#a89a6a'); p.outline(4, 2, 4, 5, '#8a8f99'); p.px(6, 8, O); },
  close: p => { for (let i = 0; i < 8; i++) { p.rect(2 + i, 2 + i, 2, 1, '#efe6cf'); p.rect(9 - i, 2 + i, 2, 1, '#efe6cf'); } },
  plus: p => { p.rect(5, 2, 2, 8, '#efe6cf'); p.rect(2, 5, 8, 2, '#efe6cf'); },
  minus: p => { p.rect(2, 5, 8, 2, '#efe6cf'); },
  dice: p => { p.rect(2, 2, 8, 8, '#efe6cf'); p.outline(2, 2, 8, 8, '#8a7a60'); for (const [x, y] of [[4, 4], [7, 4], [4, 7], [7, 7], [5, 5]]) p.px(x + 0.5, y + 0.5, O); },
  save: p => { p.rect(2, 2, 8, 8, '#5f8fe0'); p.rect(4, 2, 4, 3, '#e8eef8'); p.rect(4, 7, 4, 3, '#2a3a5a'); },
  eye: p => { p.ellipse(6, 6, 5, 3, '#efe6cf'); p.ellipse(6, 6, 2, 2, '#4a8ad8'); p.px(6, 6, O); },
  target: p => { p.ellipse(6, 6, 5, 5, '#b3242c'); p.ellipse(6, 6, 3, 3, '#efe6cf'); p.ellipse(6, 6, 1, 1, '#b3242c'); },
  flag: p => { p.vline(3, 1, 10, '#8a6a3a'); p.rect(4, 2, 6, 4, '#d8b25a'); p.px(9, 6, '#d8b25a'); },
  settle: p => { p.vline(3, 1, 10, '#8a6a3a'); p.rect(4, 2, 6, 4, '#7ad08a'); p.rect(5, 8, 6, 3, '#c9b48a'); p.hline(5, 7, 6, '#8a5a32'); },
  gift: p => { p.rect(2, 5, 8, 6, '#d8484a'); p.vline(6, 5, 6, '#f2c84b'); p.rect(1, 4, 10, 2, '#e85a5c'); p.hline(1, 4, 10, '#f2c84b'); p.px(4, 3, '#f2c84b'); p.px(8, 3, '#f2c84b'); },
  handshake: p => DRAW.diplomacy(p),
  peace: p => { p.ellipse(6, 6, 5, 5, '#e8eef8'); p.vline(6, 1, 11, '#5f8fe0'); p.px(4, 8, '#5f8fe0'); p.px(3, 9, '#5f8fe0'); p.px(8, 8, '#5f8fe0'); p.px(9, 9, '#5f8fe0'); },
  sword: p => DRAW.weapons(p),
  exchange: p => { p.hline(2, 4, 7, '#efe6cf'); p.px(8, 3, '#efe6cf'); p.px(8, 5, '#efe6cf'); p.hline(3, 8, 7, '#d8b25a'); p.px(3, 7, '#d8b25a'); p.px(3, 9, '#d8b25a'); },
};

export const ICON_NAMES = Object.keys(DRAW);

export function iconURL(name) {
  let u = urls.get(name);
  if (u) return u;
  const c = canvas(12, 12); const p = new Pen(c.getContext('2d'));
  (DRAW[name] || DRAW.warning)(p);
  u = c.toDataURL();
  urls.set(name, u);
  return u;
}

export function ico(name, cls = '') { return `<i class="ico ${cls}" style="background-image:url(${iconURL(name)})"></i>`; }

// ------------------------------------------------------------------ emblems
// 24x24 heraldic emblems for each tribe
export function emblemURL(key, size = 24) {
  const k = 'emb|' + key + '|' + size;
  let u = urls.get(k); if (u) return u;
  const c = canvas(24, 24); const p = new Pen(c.getContext('2d'));
  const t = TRIBES.find(t => t.key === key); const P = t.pal;
  // shield/banner base, shape differs per tribe
  if (key === 'oruvai') {
    p.ellipse(12, 12, 11, 11, P.dark); p.ellipse(12, 12, 10, 10, P.primary); p.ellipse(12, 12, 8, 8, P.dark);
    for (let x = 0; x < 13; x++) { p.px(6 + x, 12 + Math.round(Math.sin(x / 2) * 1.5), P.accent); p.px(6 + x, 15 + Math.round(Math.sin(x / 2 + 1) * 1.5), P.light); }
    p.ellipse(12, 8, 2, 2, '#f2e6b0'); p.px(12, 3, P.accent); p.px(12, 21, P.accent); p.px(3, 12, P.accent); p.px(21, 12, P.accent);
  } else if (key === 'kharvak') {
    for (let y = 1; y < 23; y++) { const w = y < 16 ? 20 : 20 - (y - 15) * 2.6; p.rect(12 - w / 2, y, w, 1, y === 1 ? P.light : P.primary); p.px(12 - w / 2, y, P.dark); p.px(12 + w / 2 - 1, y, P.dark); }
    p.hline(2, 1, 20, P.dark);
    // axe head & horns
    p.vline(11, 5, 13, '#5a3c26'); p.vline(12, 5, 13, '#6b4a2e');
    p.rect(13, 6, 5, 6, '#c8ccd2'); p.vline(18, 6, 6, '#e8eef4'); p.rect(6, 7, 5, 4, '#a0a4aa');
    p.px(5, 3, '#e8dcc0'); p.px(6, 4, '#e8dcc0'); p.px(4, 2, '#e8dcc0'); p.px(19, 3, '#e8dcc0'); p.px(18, 4, '#e8dcc0'); p.px(20, 2, '#e8dcc0');
  } else if (key === 'thalori') {
    p.ellipse(12, 12, 11, 11, P.dark); p.ellipse(12, 12, 10, 10, '#d8c48a'); p.ellipse(12, 12, 9, 9, P.primary);
    p.vline(12, 6, 13, '#6b4a2e'); p.px(11, 18, '#6b4a2e'); p.px(13, 18, '#6b4a2e'); p.px(10, 19, '#6b4a2e'); p.px(14, 19, '#6b4a2e');
    p.ellipse(12, 9, 6, 4, P.light); p.ellipse(12, 9, 4, 2, '#a8e070'); p.ellipse(8, 12, 2, 1, P.light); p.ellipse(16, 12, 2, 1, P.light);
    p.px(10, 7, '#e8d050'); p.px(14, 8, '#e8d050');
  } else {
    for (let y = 0; y < 24; y++) { const w = y < 12 ? y * 1.8 + 2 : (23 - y) * 1.8 + 2; p.rect(12 - w / 2, y, w, 1, P.dark); }
    for (let y = 2; y < 22; y++) { const w = y < 12 ? (y - 2) * 1.6 + 1 : (21 - y) * 1.6 + 1; p.rect(12 - w / 2, y, w, 1, P.primary); }
    for (let y = 6; y < 18; y++) { const w = y < 12 ? (y - 6) * 1.2 + 1 : (17 - y) * 1.2 + 1; p.rect(12 - w / 2, y, w, 1, P.light); }
    p.ellipse(12, 12, 2, 2, '#ffffff'); p.px(12, 12, P.dark); p.px(12, 1, '#e3c6ff'); p.px(12, 22, '#e3c6ff');
  }
  u = c.toDataURL(); urls.set(k, u);
  return u;
}

export function spriteURL(kind, ...args) {
  const k = 'spr|' + kind + '|' + args.join('|');
  let u = urls.get(k); if (u) return u;
  let c;
  if (kind === 'person') c = personSprite(...args);
  else if (kind === 'building') c = buildingSprite(args[0], args[1], { tier: args[2] || 1, size: args[3] || 2, season: 1, field: true });
  u = c.toDataURL(); urls.set(k, u);
  return u;
}
