// Landing page: a live AI-run world behind the hero (the real engine in a
// worker), the four peoples drawn with the game's own sprites, and a gallery.
import { installTheme } from '../ui/theme.js';
import { initTooltips, esc } from '../ui/dom.js';
import { ico, iconURL, emblemURL, spriteURL } from '../ui/icons.js';
import { TRIBES } from '../data/tribes.js';
import { SEASONS, DAYS_PER_YEAR } from '../core/constants.js';
import { Renderer } from '../render/renderer.js';
import { SimClient } from '../sim/client.js';

installTheme();
initTooltips();
for (const el of document.querySelectorAll('[data-ico]')) el.style.backgroundImage = `url(${iconURL(el.dataset.ico)})`;

// On GitHub Pages, link back to the repository the site was built from.
(function githubLinks() {
  const h = location.hostname;
  if (!h.endsWith('github.io')) return;
  const user = h.split('.')[0];
  const repo = location.pathname.split('/').filter(Boolean)[0] || `${user}.github.io`;
  const url = `https://github.com/${user}/${repo}`;
  for (const id of ['gh-nav', 'gh-btn']) { const a = document.getElementById(id); a.href = url; a.classList.remove('hidden'); }
})();

// ------------------------------------------------------------- peoples
document.getElementById('peoples-grid').innerHTML = TRIBES.map(t => {
  const person = (job, female, frame = 0) => `<img src="${spriteURL('person', t.key, job, frame, female, false, 3, null, 1, false)}" alt="" style="width:36px;height:48px">`;
  return `<article class="people" style="--tc:${t.color};--tc-hi:${t.pal.light}">
    <div class="people-top"><img class="emb" src="${emblemURL(t.key)}" alt="${t.name} emblem"></div>
    <h3 class="people-name">${t.name}</h3>
    <div class="people-title">${t.title}</div>
    <div class="diorama"><img src="${spriteURL('building', 'centre', t.key, 3, 3)}" alt="" style="width:84px">${person('farmer', true)}${person('soldier', false, 3)}${person('researcher', true)}<img src="${spriteURL('building', 'house', t.key, 1, 2)}" alt="" style="width:56px"></div>
    <p class="motto">“${esc(t.motto)}”</p>
    <p class="blurb">${esc(t.blurb)}</p>
    <ul class="traits">${t.strengths.slice(0, 3).map(s => `<li class="plus">${esc(s)}</li>`).join('')}${t.weaknesses.slice(0, 2).map(s => `<li class="minus">${esc(s)}</li>`).join('')}</ul>
  </article>`;
}).join('');

// ------------------------------------------------------------- features
const FEATURES = [
  ['flag', 'A new continent every run', 'Mountain ranges, rivers, lakes, seventeen biomes and mineral deposits from a seed you choose. Starts are balanced, never identical.'],
  ['population', 'Every person simulated', 'Births, partnerships, ageing, skills, homes and jobs. Production happens because someone actually walked out and did the work.'],
  ['crown', 'Six stages of civilisation', 'From a wandering tribe to an industrial power. Each stage needs institutions and knowledge, not just a bigger headcount.'],
  ['diplomacy', 'Rivals with reasons', 'AI rulers explain why they accept or refuse. Hostility builds in the open: you are warned, then given an ultimatum, before war comes.'],
  ['scales', 'Laws with trade-offs', 'Taxes, rations, conscription, sacred groves. Policies interact, and every reform shakes the realm a little.'],
  ['sun', 'Seasons, weather and events', 'Droughts, floods, epidemics, comets and wandering merchants. Preparation matters more than luck.'],
];
document.getElementById('features').innerHTML = FEATURES.map(([i, h, p]) => `<div class="feature">${ico(i, 'lg')}<div><h3>${h}</h3><p>${p}</p></div></div>`).join('');

// ------------------------------------------------------------- gallery lightbox
const lb = document.getElementById('lightbox');
document.querySelectorAll('.gallery img').forEach(img => img.addEventListener('click', () => { lb.querySelector('img').src = img.src; lb.querySelector('img').alt = img.alt; lb.classList.remove('hidden'); }));
lb.addEventListener('click', () => lb.classList.add('hidden'));
addEventListener('keydown', e => { if (e.key === 'Escape') lb.classList.add('hidden'); });

// ------------------------------------------------------------- live hero world
const reduce = matchMedia('(prefers-reduced-motion: reduce)').matches;
const cv = document.getElementById('world');
const renderer = new Renderer(cv);
renderer.settings.particles = !reduce;
const ticker = document.getElementById('ticker');
const tick = e => {
  const node = document.createElement('div');
  node.className = 'tk';
  node.innerHTML = `<span class="tk-date">Year ${Math.floor(e.day / DAYS_PER_YEAR) + 1} · ${SEASONS[e.day % DAYS_PER_YEAR]}</span>${esc(e.text)}`;
  ticker.prepend(node);
  while (ticker.children.length > 4) ticker.lastElementChild.remove();
};

async function startWorld() {
  const sim = new SimClient();
  await sim.call('create', { seed: 'landing-' + ((Math.random() * 1e6) | 0), size: 'small', observer: true, playerTribe: 0, start: 'bountiful' }, 360 * 8);
  const game = sim.mirror;
  renderer.resize(); renderer.setGame(game);
  addEventListener('resize', () => renderer.resize());
  sim.setSpeed(reduce ? 1 : 2);
  game.history.filter(e => e.imp >= 1 && e.type !== 'law').slice(-3).forEach(tick);
  game.bus.on('log', e => { if (e.imp >= 1 && e.type !== 'law') tick(e); });
  let i = 0;
  const visit = () => { const t = game.tribes[i++ % 4]; const s = game.settlements.get(t.capital); if (s) renderer.flyTo(s.x + 6, s.y + 2, 3.4); };
  const s0 = game.settlements.get(game.tribes[0].capital); renderer.centerOn(s0.x + 6, s0.y + 2, 3.4);
  setInterval(visit, 22000);
  let last = performance.now(), t0 = 0, onScreen = true;
  new IntersectionObserver(([en]) => { onScreen = en.isIntersecting; sim.setHold(!onScreen); }).observe(cv);
  const loop = now => {
    const dt = Math.min(0.1, (now - last) / 1000); last = now; t0 += dt;
    if (onScreen && !document.hidden) {
      if (!reduce) { renderer.cam.x += Math.cos(t0 * 0.05) * 5 * dt; renderer.cam.y += Math.sin(t0 * 0.04) * 3 * dt; }
      sim.frame(game.view);
      renderer.frame(dt);
    }
    requestAnimationFrame(loop);
  };
  requestAnimationFrame(loop);
  document.body.classList.add('world-ready');
}
startWorld().catch(e => console.warn('Live world unavailable', e));
