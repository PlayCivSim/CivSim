// Guided tutorial. Runs in a scripted world (fixed seed, gentle rivals that never
// attack, extra stock) and walks through the game feature by feature. Each step
// can point at a UI element, wait for the player to do something (`done`), and
// shows how the feature connects to the ones before it (`link`).
// The tutorial only reads the mirror and calls normal sim commands; nothing here edits game state directly.
import { esc } from './dom.js';
import { ico } from './icons.js';
import { storeSettings } from '../save/saves.js';
import { playerSees } from '../sim/vision.js';

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
  // ---- map visibility lessons (only for the visibility being learned)
  { when: g => g.vis === 'explore', title: 'Undiscovered land', text: 'The dark land is unexplored. Your people uncover the map as they work and travel, and once land is discovered it stays on your map. We have sent a scout toward the nearest people: watch the darkness lift around their homeland when the scout arrives.', to: ['.minimap'],
    enter: ({ sim, mem, g }) => { sim.setSpeed(1); mem.n = g.world.explored?.reduce((a, b) => a + b, 0) || 0; sim.call('tut', 'scout').then(r => { mem.dest = r; }); },
    done: ({ g, mem }) => (g.world.explored?.reduce((a, b) => a + b, 0) || 0) > mem.n + 250,
    link: 'Rivals explore the same way: they cannot attack a town until they have found it.' },
  { when: g => g.vis === 'explore', title: 'Discovered for good', text: 'Your scout has mapped their lands. On this difficulty, explored land stays visible, so you can watch their town even after the scout leaves. On Hard it would fade to grey.', next: true,
    enter: ({ app, mem, g }) => { const s = g.settlements.get(g.tribes.find(o => o.id !== g.playerId && g.world.explored?.[g.settlements.get(o.capital).y * g.world.w + g.settlements.get(o.capital).x])?.capital); if (s) app.renderer.flyTo(s.x, s.y, 2.6); } },
  { when: g => g.vis === 'los', title: 'Live line of sight', text: 'On Hard you see only what your people, towns, towers, armies and scouts can see right now. We have sent a scout toward the nearest people. When it arrives, their town appears; it is only visible while the scout is there.', to: ['.minimap'],
    enter: ({ sim, mem }) => { sim.setSpeed(1); sim.call('tut', 'scout').then(r => { mem.dest = r; }); },
    done: ({ g, app, mem }) => { if (!mem.dest?.ok) return false; const ok = playerSees(g, mem.dest.x, mem.dest.y); if (ok && !mem.flown) { mem.flown = 1; app.renderer.flyTo(mem.dest.x, mem.dest.y, 2.6); } return ok; },
    link: 'Seeing a town with your own eyes verifies what you know of their lands.' },
  { when: g => g.vis === 'los', title: 'Out of sight', text: 'Now the scout heads home. Watch: the land stays on your map but turns grey, and their people and buildings disappear. You only remember the ground, not what is happening on it.',
    enter: ({ sim, mem, app }) => { sim.call('tut', 'leave'); },
    done: ({ g }) => { const o = g.tribes.find(x => x.id !== g.playerId && g.world.explored?.[g.settlements.get(x.capital).y * g.world.w + g.settlements.get(x.capital).x]); if (!o) return true; const s = g.settlements.get(o.capital); return !playerSees(g, s.x, s.y); },
    link: 'Enemy armies are hidden the same way until your sight reaches them.' },
  { when: g => g.vis === 'los', title: 'Outdated intelligence', text: 'Reports age. We have moved the clock on your knowledge by a month: open Diplomacy and look at the four badges (lands, military, economy, intentions). Verified reports have slipped to Reported or Rumoured, and figures are marked as old. Send scouts or agents to refresh them.', to: [rail('diplomacy')],
    enter: ({ sim }) => { sim.call('tut', 'goodwill'); sim.call('tut', 'age'); }, done: panel('diplomacy'),
    link: 'Rival rulers face the same limits and can be fooled by false reports.' },
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
  // ======== scripted scenes: every key system under pressure ========
  { title: 'Scene: famine', text: 'Disaster! Blight has rotted your stores and your food workers have walked off the job. Watch the food number in the top bar fall. Open Population and put people back on gatherer, hunter, fisher or farmer work until the daily food change turns positive.', to: [rail('population'), '[data-res="food"]'],
    enter: ({ sim }) => { sim.call('tut', 'famine'); sim.setSpeed(1); },
    done: ({ g }) => ['grain', 'meat', 'fish', 'fruit', 'veg'].reduce((a, k) => a + (g.player.rates[k] || 0), 0) > 0.2,
    link: 'Hunger lowers happiness and stops births. Food comes only from workers in food jobs.' },
  { title: 'Why are people unhappy?', text: 'The famine hurt morale. Tap or click the happiness face in the top bar to open the full breakdown: every factor, how much it adds or takes away, and where happiness is heading.', to: ['[data-res="happy"]'],
    done: () => !!document.querySelector('.hb-body'),
    link: 'Food, housing, jobs, safety, amenities, town focus, laws and crowding all feed happiness; happiness drives productivity.' },
  { title: 'Scene: a hard bargain', text: 'You are short of stone, and your trading partner has plenty. Open Diplomacy and press Exchange on them. Ask for far too much stone for a little wood: they will refuse, and the deal screen shows the terms they would accept. Use their terms or make an Ongoing contract, then propose it.', to: ['[data-act="dip"][data-type="exchange"]', rail('diplomacy')],
    enter: ({ sim, hud, mem }) => { sim.call('tut', 'trade').then(r => { mem.to = r?.to; }); if (hud.panel !== 'diplomacy') hud.openPanel('diplomacy'); },
    done: ({ g }) => g.dip.treaties.some(x => x.type === 'contract' && (x.a === g.playerId || x.b === g.playerId)) || g.history.some(e => /exchanged goods/.test(e.text) && (e.tribe === g.playerId || e.with === g.playerId)),
    link: 'Deals show give, receive, delivery and risk. Refusals can come with counteroffers; ongoing contracts deliver every few days.' },
  { title: 'Scene: riches beyond the border', text: 'The richest stone lies outside your land. We have taught you Toolmaking: open Build, choose Resource Outpost (Production) and place it on the deposit we are showing you. Miners will walk out, dig, and haul the stone home along a new road. Outposts need food each day, can be raided, and neighbours dislike camps near their borders. Logging Outposts work the same way for woodcutters in a rich forest.', to: ['[data-act="build"][data-type="outpost"]', rail('build')],
    enter: ({ sim, app, mem, g }) => { mem.n = N(g, 'outpost'); sim.call('tut', 'outpost').then(r => { if (r) app.renderer.flyTo(r.x + 1, r.y + 1, 3); }); },
    done: ({ g, mem }) => N(g, 'outpost') > mem.n,
    link: 'Outposts extend your reach without founding a town. Keep a few soldiers near them in wartime.' },
  { title: 'Scene: eyes abroad', text: 'Rumours say a rival is arming. We have granted you Writing. In Diplomacy, under a rival, press Gather intelligence to send an agent. The confirmation shows the journey, the risk on the road and the cost in food and one adult.', to: ['[data-act="intel-send"][data-k="spy"]', rail('diplomacy')],
    enter: ({ sim, hud }) => { sim.call('tut', 'writing'); sim.call('tut', 'goodwill'); if (hud.panel !== 'diplomacy') hud.openPanel('diplomacy'); },
    done: ({ g }) => (g.dip.missions || []).some(m => m.from === g.playerId && m.kind === 'spy'),
    link: 'Agents verify military, economy and intentions, and expose false reports. If caught, relations suffer.' },
  { title: 'Counter-intelligence', text: 'Rivals spy too. At the bottom of Diplomacy, add at least one counter-intelligence agent. Each costs an adult and a little food a day, and raises the chance of catching foreign spies and saboteurs.', to: ['[data-act="counter"]', rail('diplomacy')],
    done: ({ g }) => (g.dip.counter?.[g.playerId] || 0) >= 1 },
  { title: 'Open the borders', text: 'Propose Border Access to a friendly neighbour. Open roads make envoys and scouts faster and safer, and your armies stay supplied on their land.', to: ['[data-act="dip"][data-type="access"]', rail('diplomacy')],
    done: ({ g }) => g.tribes.some(o => o.id !== g.playerId && g.dip.has('access', g.playerId, o.id)) },
  { title: 'Scene: invasion!', text: 'A rival has declared war and a warband is marching on your capital! Open Military and raise soldiers with the + button (switch the workforce steward off if needed), then watch your soldiers meet them. Check the top bar: manpower shows how many adults are under arms.', to: [rail('military'), '[data-res="manpower"]'],
    enter: ({ sim, mem }) => { sim.setSpeed(1); sim.call('tut', 'invasion').then(r => { mem.from = r?.from; mem.ok = r?.ok; }); },
    done: ({ g, mem }) => mem.ok !== undefined && (g.player.jobCounts?.soldier || 0) >= Math.min(3, g.player.slots?.soldier || 2) && !g.armies.some(a => a.tribe === mem.from && a.state !== 'return'),
    link: 'Soldiers come out of your workforce and cost upkeep. Their strength also deters rivals in diplomacy.' },
  { title: 'Scene: the counter-campaign', text: 'They are beaten back. Now take the war to them. In Military, under their settlements, press Plan attack. Read the estimate: distance, days on the road, terrain, food to carry, upkeep, supply, losses and ambush risk. Then March.', to: ['[data-act="campaign"]', rail('military')],
    enter: ({ sim, hud, mem }) => { sim.call('tut', 'counter').then(r => { mem.to = r?.to; }); if (hud.panel !== 'military') hud.openPanel('military'); },
    done: ({ g }) => g.armies.some(a => a.tribe === g.playerId),
    link: 'The army carries food from your stores, so a campaign competes with feeding your people.' },
  { title: 'Supply on the march', text: 'Follow your army in the Military panel. The Supply bar falls as it moves away from friendly land; below half, soldiers fall sick and desert, and a few may die of exposure on hard ground. Press the eye to follow them. When ready, continue.', to: ['.supply', rail('military')], next: true,
    enter: ({ hud }) => { if (hud.panel !== 'military') hud.openPanel('military'); } },
  { title: 'Make peace', text: 'Wars drain food, manpower and morale. Open Diplomacy and Propose peace to the people you are fighting. Pick white peace or terms.', to: ['[data-act="dip"][data-type="peace"]', rail('diplomacy')],
    enter: ({ hud }) => { if (hud.panel !== 'diplomacy') hud.openPanel('diplomacy'); },
    done: ({ g }) => !g.dip.enemies(g.playerId).length,
    link: 'Breaking pacts or starting unjustified wars costs reputation, which every people remembers.' },
  { title: 'Scene: a new town', text: 'Your people need room. We have granted you the materials. Open Overview and press Found a new settlement, then pick a spot within reach of your land (green outline) and confirm.', to: ['[data-act="found"]', rail('overview')],
    enter: ({ sim, hud, mem, g }) => { mem.n = g.player.settlements.length; sim.call('tut', 'expand'); if (hud.panel !== 'overview') hud.openPanel('overview'); },
    done: ({ g, mem }) => g.player.settlements.length > mem.n },
  { title: 'Give each town a role', text: 'In Overview under Settlements, set a focus for a town: Production, Trade, Military or Culture. Each speeds some work and slows the rest.', to: ['[data-act="spec"]', rail('overview')],
    enter: ({ hud }) => { if (hud.panel !== 'overview') hud.openPanel('overview'); },
    done: ({ g }) => g.player.settlements.some(sid => g.settlements.get(sid)?.spec) },
  { title: 'Stewards', text: 'Stewards in Overview automate the workforce, housing, building, research and diplomacy. Turn the Workforce steward back on now; you always override it.', to: ['[data-act="steward"][data-k="work"]', rail('overview')],
    enter: ({ hud }) => { if (hud.panel !== 'overview') hud.openPanel('overview'); }, done: ({ g }) => g.player.steward.work },
  { title: 'Read the dispatches', text: 'Everything that just happened was recorded. Open Notices (the bell) and filter by War or Diplomacy to see each event and how many days ago it happened.', to: ['.bell'],
    done: panel('notices') },
  { title: 'History and statistics', text: 'Open the Chronicle and switch to Timeline to see this world’s major moments; tap one with a target to fly there. Statistics charts your population, food and army over time.', to: [rail('chronicle')],
    done: ({ hud }) => hud.panel === 'chronicle' && hud.panelState?.cv === 'timeline' },
  { title: 'The encyclopedia', text: 'Open the Encyclopedia (book on the rail, or the / key). Every mechanic and formula is explained there; try searching for supply.', to: [rail('help')], done: panel('help') },
  { title: 'Shape your top bar', text: 'Press the pin button in the top bar and hide or show something. On phones, open the menu (top right) and choose Customise top bar.', to: ['[data-act="hud-pins"]', '[data-act="esc"]'],
    enter: ({ app, mem }) => { mem.h = JSON.stringify(app.settings.hudHidden || []); },
    done: ({ app, mem }) => !!document.querySelector('.hc-list') || JSON.stringify(app.settings.hudHidden || []) !== mem.h },
  { title: 'Save your chronicle', text: 'Press Esc (or the menu button) and save to a named slot, or press F5 to quicksave. Autosaves rotate through five slots, and a recovery save protects you if the page closes.', to: ['[data-act="esc"]'],
    enter: ({ mem, app }) => { mem.t = app.lastSaved || 0; }, done: ({ app, mem }) => (app.lastSaved || 0) > mem.t },
  { title: 'You are ready', text: 'That covers the main systems. This is now a normal sandbox run, so keep building, or exit to the menu and begin a new chronicle with a world of your own. You can replay this tutorial from the main menu any time.', next: true, last: true },
];

export class Tutorial {
  constructor(app) { this.app = app; this.i = -1; this.mem = {}; this.el = null; this.ring = null; this.timer = 0; }
  get ctx() { return { g: this.app.game, hud: this.app.hud, sim: this.app.sim, app: this.app, mem: this.mem }; }

  start() {
    this.stop();
    this.steps = STEPS.filter(st => !st.when || st.when(this.app.game));
    this.el = document.createElement('div'); this.el.id = 'tutorial'; document.body.appendChild(this.el);
    this.ring = document.createElement('div'); this.ring.id = 'tut-ring'; document.body.appendChild(this.ring);
    this.el.addEventListener('click', e => {
      const a = e.target.closest('[data-t]')?.dataset.t; if (!a) return;
      if (a === 'mini') { if (this.autoMini) { this.userOpen = true; this.autoMini = false; } else { this.mini = !this.mini; this.userOpen = !this.mini; } this.render(); this.dodge(null); return; }
      if (a === 'next') this.go(this.i + 1); else if (a === 'back') this.go(this.i - 1); else if (a === 'exit') this.finish(false);
    });
    this.timer = setInterval(() => this.poll(), 250);
    this.go(0);
  }
  // Keep the card off whatever the player needs to click: the highlighted
  // target, the placement bar and open panels. It moves to the top (or the
  // other bottom corner) when it would cover them, and can be minimised.
  dodge(target) {
    const el = this.el; if (!el) return;
    const card = el.querySelector('.tut-card'); if (!card) return;
    const blockers = [target, ...['.place-hint', '.modal', '#panel-host .side-panel .sp-body', '.inspector'].map(q => document.querySelector(q)?.getBoundingClientRect()).filter(b => b && b.width)];
    const hits = pos => { el.className = pos; const c = card.getBoundingClientRect(); return blockers.some(b => b && !(b.right < c.left || b.left > c.right || b.bottom < c.top || b.top > c.bottom)) ; };
    const free = this.pos !== undefined && !hits(this.pos) ? this.pos : ['', 'tut-right', 'tut-top', 'tut-top tut-right'].find(p => !hits(p));
    // nowhere free (e.g. a full-screen panel on a phone): shrink to the title bar, unless the player opened it
    const auto = free === undefined && !this.userOpen;
    const want = free ?? 'tut-top';
    if (auto !== this.autoMini) { this.autoMini = auto; this.render(); }
    const topTarget = target && target.top < 130;
    el.className = want + (this.mini || auto ? ' tut-mini' + (topTarget ? ' tut-mini-bottom' : '') : ''); this.pos = want;
  }
  stop() { clearInterval(this.timer); this.el?.remove(); this.ring?.remove(); this.el = this.ring = null; }

  finish(completed) {
    if (completed) { this.app.settings.tutorialDone = true; storeSettings(this.app.settings); }
    this.stop();
  }

  go(i) {
    if (i < 0) return;
    if (i >= this.steps.length) { this.finish(true); return; }
    this.i = i; this.mem = {}; this.doneAt = 0; this.mini = false; this.userOpen = false; this.autoMini = false;
    try { this.steps[i].enter?.(this.ctx); } catch (e) { console.error(e); }
    this.render();
  }

  render() {
    const s = this.steps[this.i]; if (!this.el) return;
    const manual = !!s.next;
    this.el.innerHTML = `<div class="tut-card frame thin">
      <div class="tut-head"><span class="caps">Tutorial ${this.i + 1} / ${this.steps.length}${this.mini || this.autoMini ? ' · ' + esc(s.title) : ''}</span><span><button class="btn xs" data-t="mini" data-tip="${this.mini || this.autoMini ? 'Show the tutorial' : 'Minimise the tutorial'}">${this.mini || this.autoMini ? '▲' : '▼'}</button> <button class="btn xs" data-t="exit">${ico('close', 'sm')} Exit</button></span></div>
      <div class="tut-title">${esc(s.title)}</div><div class="tut-text">${esc(s.text)}</div>
      ${s.link ? `<div class="tut-link">${ico('scroll', 'sm')} <b>How it connects:</b> ${esc(s.link)}</div>` : ''}
      <div class="tut-foot"><button class="btn xs" data-t="back" ${this.i ? '' : 'disabled'}>Back</button><span class="tut-state">${manual ? '' : 'Do it to continue…'}</span>
      <button class="btn sm ${manual ? 'primary' : ''}" data-t="next">${s.last ? 'Finish' : manual ? 'Next' : 'Skip'}</button></div></div>`;
  }

  poll() {
    const s = this.steps?.[this.i]; if (!s || !this.app.game || this.app.mode !== 'game') return;
    // spotlight the first visible target
    let r = null;
    for (const sel of s.to || []) {
      const el = document.querySelector(sel); if (!el) continue;
      // a target the player has unpinned from the top bar is shown again while it is needed
      if (el.classList.contains('unpinned')) el.classList.remove('unpinned');
      if (el.offsetParent === null) continue;
      // scroll it into view inside scrolling rows and panels (top bar, rail, panel bodies)
      if (this.scrolled !== el) { this.scrolled = el; el.scrollIntoView({ block: 'nearest', inline: 'center' }); }
      const b = el.getBoundingClientRect(); if (b.width && b.height) { r = b; break; }
    }
    const ring = this.ring;
    this.dodge(r);
    if (r && s.to?.[0] !== '#world') { ring.style.cssText = `display:block;left:${r.left - 5}px;top:${r.top - 5}px;width:${r.width + 10}px;height:${r.height + 10}px`; } else ring.style.display = 'none';
    if (s.done && !this.doneAt) {
      let ok = false; try { ok = s.done(this.ctx); } catch (e) { console.error(e); }
      if (ok) { this.doneAt = performance.now(); const st = this.el.querySelector('.tut-state'); if (st) st.textContent = 'Done!'; setTimeout(() => { if (this.steps[this.i] === s) this.go(this.i + 1); }, 900); }
    }
  }
}
