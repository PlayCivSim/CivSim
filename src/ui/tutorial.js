// Guided tutorial. Runs in a scripted world (fixed seed, gentle rivals that never
// attack, extra stock) and walks through the game feature by feature. Each step
// can point at a UI element, wait for the player to do something (`done`), and
// shows how the feature connects to the ones before it (`link`).
// The tutorial only reads the mirror and calls normal sim commands; nothing here edits game state directly.
import { esc } from './dom.js';
import { ico } from './icons.js';
import { storeSettings } from '../save/saves.js';

export const TUTORIAL_WORLD = { seed: 'tutorial-3', size: 'small', start: 'bountiful', difficulty: 'gentle', playerTribe: 0, runName: 'Tutorial', tutorial: true };

const N = (g, type) => [...g.buildings.values()].filter(b => b.tribe === g.playerId && b.type === type).length;
const panel = k => ({ hud }) => hud.panel === k;
const rail = k => `.rail [data-panel="${k}"]`;

// text: what it is · link: how it connects to what came before · to: selectors to highlight (first visible wins)
// enter/done receive { g, hud, sim, app, mem }; mem persists per step for before/after comparisons.
export const STEPS = [
  { title: 'Welcome to CivSim', text: 'You lead a tribe in a living world with three rival peoples. It is a lot to take in, so this guided tour introduces one system at a time. Everything here is real, but the rivals are told to leave you alone, and you can leave at any time.', next: true,
    enter: ({ app, g, sim }) => { sim.setSpeed(0); const s = g.settlements.get(g.player.capital); app.renderer.centerOn(s.x + 0.5, s.y + 1.5, 3.2); } },
  { title: 'Moving the camera', text: 'Drag the map to pan and scroll or pinch to zoom. Zoom out far enough and people are hidden to keep things smooth. Press H, or the house button by the minimap, to return home.', to: ['.minimap'],
    enter: ({ app, mem }) => { const c = app.renderer.cam; mem.c = [c.x, c.y, c.zoom]; },
    done: ({ app, mem }) => { const c = app.renderer.cam; return Math.hypot(c.x - mem.c[0], c.y - mem.c[1]) > 40 || Math.abs(c.zoom - mem.c[2]) > 0.2; } },
  { title: 'Your resources', text: 'The top bar shows what your tribe owns and how fast each stock is changing per day. Hover any item for production and use. Food is the sum of all edible goods. After population come soldiers (manpower) and happiness: tap or click happiness to see exactly what is raising or lowering it.', to: ['#tb-res'], next: true,
    link: 'Resources come from buildings, buildings need workers, and workers are your population.' },
  { title: 'Time', text: 'The world is paused. Press play (or Space) to start time. The other buttons run it faster. Pause whenever you want to think; you can still build and open panels while paused.', to: ['.speed'],
    enter: ({ sim }) => sim.setSpeed(0), done: ({ g }) => g.speed > 0 },
  { title: 'People', text: 'Every villager is an individual with a home, a job and a family. Zoom in and click one.', to: ['#world'],
    enter: ({ app, g }) => { const s = g.settlements.get(g.player.capital); app.renderer.centerOn(s.x + 0.5, s.y + 1.5, 4); },
    done: ({ g }) => g.selected?.kind === 'agent', link: 'A person’s job decides which resource they produce, and their home decides where they sleep.' },
  { title: 'Buildings', text: 'Now click a building, such as the Tribal Hearth in the middle. On a computer, hovering a building also shows its info and who is inside; on touch, tapping it does the same. Workplaces show their worker slots and what they produce.', to: ['#world'],
    done: ({ g }) => g.selected?.kind === 'building', link: 'Housing holds residents, workplaces hold workers. A building with empty slots is waiting for people.' },
  { title: 'The Build menu', text: 'Open the Build panel. Buildings are grouped by category, and anything greyed out needs a technology you have not discovered yet.', to: [rail('build')], done: panel('build') },
  { title: 'Place a Lumber Camp', text: 'Wood is used for almost everything early on. Pick Lumber Camp, then click open ground near the forest. A green outline means the spot is valid; on touch, move it and press Place. Builders will raise it for you.', to: ['[data-act="build"][data-type="lumber"]', rail('build')],
    enter: ({ sim, mem, g }) => { mem.n = N(g, 'lumber'); sim.call('tut', 'grant', { wood: 60 }); }, done: ({ g, mem }) => N(g, 'lumber') > mem.n,
    link: 'Placing a building spends resources and creates a construction site. Builders (a job) work on it, then it opens job slots.' },
  { title: 'Workers and jobs', text: 'Open the Population panel. It lists every job, how many people hold it and how many slots exist. A new Lumber Camp adds woodcutter slots that people can fill.', to: [rail('population')], done: panel('population'),
    link: 'Buildings create slots, the Population panel fills them, and the filled slots produce the resources you saw in the top bar.' },
  { title: 'Assign your workforce', text: 'Add a woodcutter with the + button, or switch the Workforce steward on or off. The steward balances jobs for you using your needs. Manual changes turn it off. Housing matters too: births stall when people have no room.', to: ['[data-act="alloc"]', '[data-act="steward"]'],
    enter: ({ g, mem }) => { mem.a = JSON.stringify(g.player.alloc) + g.player.steward.work; }, done: ({ g, mem }) => JSON.stringify(g.player.alloc) + g.player.steward.work !== mem.a },
  { title: 'Technology', text: 'Open Technology. Research is produced by researchers working in school-type buildings. Techs unlock buildings, laws and abilities, and finishing enough of them moves your tribe to the next civilisation stage.', to: [rail('technology')], done: panel('technology'),
    link: 'Researchers (jobs) in a Learning Hut (building) produce research points that fund techs. Techs unlock more buildings.' },
  { title: 'Choose a research', text: 'Click Fishing in the Agriculture branch to research it. Real research takes a while, so after you choose, the tutorial will finish it for you.', to: ['[data-act="research"][data-key="fishing"]'],
    done: ({ g }) => g.player.research.current === 'fishing' || g.player.techs.includes('fishing') },
  { title: 'Fishing', text: 'Fishing is discovered. Open Build, switch to the Production category, and place a Fishing Hut right next to water. Fish live in rivers, lakes and shallows and slowly regrow, so overfishing one spot can empty it.', to: ['[data-act="build"][data-type="fishery"]', '[data-act="bcat"][data-cat="production"]', rail('build')],
    enter: ({ sim, mem, g }) => { mem.n = N(g, 'fishery'); sim.call('tut', 'tech', 'fishing'); sim.call('tut', 'grant', { wood: 60 }); }, done: ({ g, mem }) => N(g, 'fishery') > mem.n,
    link: 'A tech unlocks a building, the building needs builders, then fishers from your workforce. Fish then count as food.' },
  { title: 'Food and hunger', text: 'Fishers carry their catch to storage, where it joins grain, meat and fruit in the Food total. If food runs out people go hungry and the tribe stops growing, so keep an eye on the daily change.', to: ['[data-res="food"]'], next: true,
    link: 'Jobs → resources → food → population growth → more workers. This loop drives the whole game.' },
  { title: 'Economy', text: 'The Economy panel shows every stock, what was produced and used yesterday, and storage limits. A full store wastes production, so build Storehouses when bars turn red.', to: [rail('economy')], done: panel('economy') },
  { title: 'Coins and trade', text: 'Coins are a late resource: the Currency technology unlocks the Mint and taxation. Coins come from taxes, minting and trade deals, and are spent on soldier upkeep and tribute. Until then you trade goods directly.', to: ['[data-res="coins"]', rail('economy')], next: true,
    link: 'Barter lets you build Marketplaces and sign trade treaties (see Diplomacy), and Currency adds taxes on your people.' },
  { title: 'Government', text: 'Open Government. Laws shape your tribe, for example how food is shared, how heavily people are taxed and how the army is raised. Each gives bonuses and costs, such as happiness.', to: [rail('government')], done: panel('government'),
    link: 'Laws change the numbers behind the top-bar happiness and your production.' },
  { title: 'Enact a law', text: 'Try Generous Rations: people eat 20% more but are happier and healthier. We cleared your council so it will work. Watch the happiness number in the top bar after you enact it. You have one law slot, so each new law means giving up another, a real trade-off.', to: ['[data-act="law"][data-law="rationing"][data-opt="generous"]', '[data-act="law"]'],
    enter: ({ sim, g, mem }) => { sim.call('tut', 'law'); mem.l = 'x'; }, done: ({ g }) => g.player.laws.rationing === 'generous',
    link: 'Law → modifiers on food eaten, happiness and health → stability, births and productivity.' },
  { title: 'Diplomacy', text: 'Open Diplomacy. Three rival tribes live on this map. You see their mood towards you and why, and can offer gifts, trade, pacts and alliances. Normally you meet them by expanding towards them; for the tutorial your scouts have already made contact and they have taken a liking to you.', to: [rail('diplomacy')], done: panel('diplomacy'),
    enter: ({ sim }) => sim.call('tut', 'goodwill'), link: 'Treaties need good relations, which gifts, fair dealing and shared enemies raise.' },
  { title: 'An envoy arrives', text: 'A rival tribe has sent an envoy with a proposal. Rivals do this on their own in a real game, and a toast announces it. Open the Envoys section of Diplomacy and Accept their trade agreement.', to: ['[data-act="prop-yes"]', rail('diplomacy')],
    enter: ({ sim, hud }) => { if (hud.panel !== 'diplomacy') hud.openPanel('diplomacy'); sim.call('tut', 'envoy'); },
    done: ({ g }) => g.tribes.some(o => o.id !== g.playerId && g.dip.has('trade', g.playerId, o.id)),
    link: 'A trade treaty lets caravans exchange goods between your tribes, earning resources (and later coins) for both.' },
  { title: 'Make your own offer', text: 'Now you ask. Propose a Non-Aggression Pact to a neighbour: they promise not to attack you. Whether they accept depends on how they feel about you, and the explanation is shown when they refuse.', to: ['[data-act="dip"][data-type="nap"]', rail('diplomacy')],
    done: ({ g }) => g.tribes.some(o => o.id !== g.playerId && (g.dip.has('nap', g.playerId, o.id) || g.dip.has('alliance', g.playerId, o.id))),
    link: 'Pacts and alliances also change what rivals’ allies will do in a war.' },
  { title: 'An ultimatum', text: 'Not every envoy is friendly. A rival now demands tribute. In a real game, refusing can lead to war if their army is stronger than yours, and paying makes you look weak. Here refusing is safe. Pick Pay or Refuse and notice how each one costs you.', to: ['[data-act="prop-no"]', '[data-act="prop-yes"]'],
    enter: ({ sim, hud, mem }) => { if (hud.panel !== 'diplomacy') hud.openPanel('diplomacy'); sim.call('tut', 'ultimatum').then(() => { mem.sent = true; }); },
    done: ({ g, mem }) => mem.sent && !g.pendingProposals.some(p => p.p.ultimatum),
    link: 'Military strength (next) decides whether refusing is safe, and tribute is paid from your economy.' },
  { title: 'Military', text: 'Open Military. Soldiers are trained in barracks and defend your lands, and armies can launch campaigns against a rival at war with you. In this tutorial the rivals never attack, but in a real game neglecting defence invites ultimatums and war.', to: [rail('military')], done: panel('military'),
    link: 'Weak armies lower how rivals see you (Diplomacy), and soldiers cost upkeep paid from stocks and coins (Economy).' },
  { title: 'Stewards', text: 'Open Overview. Stewards are optional helpers that automate the workforce, housing, building, research and diplomacy, handy when your realm gets big. You always override them.', to: [rail('overview')], done: panel('overview') },
  { title: 'Saving and the Chronicle', text: 'The game autosaves, and Esc opens the menu to save, change settings or quit. The Chronicle panel records everything that happens, so check it when something surprising occurs.', to: [rail('chronicle')], next: true },
  { title: 'Notices', text: 'The bell collects every dispatch that concerns you, with how many days ago it happened. Filter by diplomacy, trade, war, production or alerts, or search. Red entries need your attention. The pin button chooses what the top bar shows.', to: ['.bell'], next: true },
  { title: 'You are ready', text: 'That covers the main systems. This is now a normal sandbox run, so keep building, or exit to the menu and begin a new chronicle with a world of your own. You can replay this tutorial from the main menu any time.', next: true, last: true },
];

export class Tutorial {
  constructor(app) { this.app = app; this.i = -1; this.mem = {}; this.el = null; this.ring = null; this.timer = 0; }
  get ctx() { return { g: this.app.game, hud: this.app.hud, sim: this.app.sim, app: this.app, mem: this.mem }; }

  start() {
    this.stop();
    this.el = document.createElement('div'); this.el.id = 'tutorial'; document.body.appendChild(this.el);
    this.ring = document.createElement('div'); this.ring.id = 'tut-ring'; document.body.appendChild(this.ring);
    this.el.addEventListener('click', e => {
      const a = e.target.closest('[data-t]')?.dataset.t; if (!a) return;
      if (a === 'next') this.go(this.i + 1); else if (a === 'back') this.go(this.i - 1); else if (a === 'exit') this.finish(false);
    });
    this.timer = setInterval(() => this.poll(), 250);
    this.go(0);
  }
  stop() { clearInterval(this.timer); this.el?.remove(); this.ring?.remove(); this.el = this.ring = null; }

  finish(completed) {
    if (completed) { this.app.settings.tutorialDone = true; storeSettings(this.app.settings); }
    this.stop();
  }

  go(i) {
    if (i < 0) return;
    if (i >= STEPS.length) { this.finish(true); return; }
    this.i = i; this.mem = {}; this.doneAt = 0;
    try { STEPS[i].enter?.(this.ctx); } catch (e) { console.error(e); }
    this.render();
  }

  render() {
    const s = STEPS[this.i]; if (!this.el) return;
    const manual = !!s.next;
    this.el.innerHTML = `<div class="tut-card frame thin">
      <div class="tut-head"><span class="caps">Tutorial ${this.i + 1} / ${STEPS.length}</span><button class="btn xs" data-t="exit">${ico('close', 'sm')} Exit</button></div>
      <div class="tut-title">${esc(s.title)}</div><div class="tut-text">${esc(s.text)}</div>
      ${s.link ? `<div class="tut-link">${ico('scroll', 'sm')} <b>How it connects:</b> ${esc(s.link)}</div>` : ''}
      <div class="tut-foot"><button class="btn xs" data-t="back" ${this.i ? '' : 'disabled'}>Back</button><span class="tut-state">${manual ? '' : 'Do it to continue…'}</span>
      <button class="btn sm ${manual ? 'primary' : ''}" data-t="next">${s.last ? 'Finish' : manual ? 'Next' : 'Skip'}</button></div></div>`;
  }

  poll() {
    const s = STEPS[this.i]; if (!s || !this.app.game || this.app.mode !== 'game') return;
    // spotlight the first visible target
    let r = null;
    for (const sel of s.to || []) { const el = document.querySelector(sel); if (el && el.offsetParent !== null) { const b = el.getBoundingClientRect(); if (b.width && b.height) { r = b; break; } } }
    const ring = this.ring;
    if (r && s.to?.[0] !== '#world') { ring.style.cssText = `display:block;left:${r.left - 5}px;top:${r.top - 5}px;width:${r.width + 10}px;height:${r.height + 10}px`; } else ring.style.display = 'none';
    if (s.done && !this.doneAt) {
      let ok = false; try { ok = s.done(this.ctx); } catch (e) { console.error(e); }
      if (ok) { this.doneAt = performance.now(); const st = this.el.querySelector('.tut-state'); if (st) st.textContent = 'Done!'; setTimeout(() => { if (STEPS[this.i] === s) this.go(this.i + 1); }, 900); }
    }
  }
}
