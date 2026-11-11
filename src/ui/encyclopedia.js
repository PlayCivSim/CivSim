// Encyclopedia: an in-game reference generated from the game data plus
// hand-written explanations of mechanics and the formulas behind them.
import { esc, fmt } from './dom.js';
import { ico, emblemURL } from './icons.js';
import { PANELS, ACTIONS } from './panels.js';
import { RESOURCES } from '../data/resources.js';
import { BUILDINGS, JOBS } from '../data/buildings.js';
import { TECHS, TECH, BRANCHES } from '../data/techs.js';
import { LAWS, GOVERNMENTS } from '../data/laws.js';
import { TRIBES } from '../data/tribes.js';
import { STAGES } from '../sim/progress.js';
import { LEVELS, LEVEL_DESC, MISSIONS, COUNTER_COST } from '../sim/intel.js';
import { SPECS, ERAS } from '../sim/logistics.js';
import { VIS_MODES } from '../sim/vision.js';
import { TREATY_NAMES } from '../sim/diplomacy.js';
import { t } from '../i18n.js';

const cost = c => Object.entries(c || {}).map(([k, v]) => `${ico(k, 'sm')}${v}`).join(' ') || 'free';
const P = (...s) => s.map(x => `<p>${x}</p>`).join('');
const kv = rows => `<div class="kv enc-kv">${rows.map(([a, b]) => `<span>${a}</span><span>${b}</span>`).join('')}</div>`;

const TOPICS = [
  { key: 'basics', name: 'Getting started', icon: 'overview', body: () => P(
    'You guide one of four peoples from a camp of huts to a civilisation. Every person is simulated: they work, eat, sleep, age, marry and die. You decide what to build, what to research, which laws to pass and how to treat your neighbours.',
    'Assign workers in <b>Population</b>, place buildings with <b>Build</b>, pick research in <b>Technology</b>. Stewards in <b>Overview</b> can automate routine choices. <b>Notices</b> (the bell) collects every dispatch, with how long ago it happened.',
    'Progress comes in six stages: ' + STAGES.slice(1).map(s => `<em>${esc(s.name)}</em>`).join(', ') + '. Each stage raises the number of settlements you may hold and unlocks new possibilities.') },
  { key: 'happiness', name: 'Happiness', icon: 'happy', body: () => P(
    'Happiness moves 15% of the way toward its target each update. The target starts at <b>50</b> and adds each factor:') + kv([
    ['Food', 'starving: −5 to −40 · 1–3 days of reserve: +2 · more: +6 · under a day: −4'], ['Food variety', '+2 per kind of food beyond the first'],
    ['Housing', '−28 × share of people without a home'], ['Employment', '−18 × share of idle adults'], ['Safety', 'war −4 · enemies in your land −10 · garrison up to +3'],
    ['Amenities', 'shrines, markets and the like, up to +12'], ['Culture towns', '+3 per Culture-focused settlement (max +9)'], ['Laws & government', 'policy effects'], ['Crowding', '−1 per 40 people above 60']]) +
    P('Below 35% unrest grows and families may leave. Tap happiness in the top bar for your live breakdown.') },
  { key: 'manpower', name: 'Manpower & military', icon: 'military', body: () => P(
    'Soldiers are adults taken from the workforce. Each costs 0.15 wood a day (and 0.12 coins once you have Currency). Barracks raise the soldier cap; a Military town holds 50% more.',
    'A soldier’s power = 1 + equipment tier × 0.28 (if armed) × happiness, stability, skill, experience and health factors. Towers add defence.',
    '<b>Supply</b>: an army is supplied on its own, allied or border-access land. Elsewhere supply falls once it is more than 16 tiles (+6 on roads, +6 with Roads tech, ×0.6 in winter, +10 from a Military town) from your nearest town, reaching zero 30 tiles further. Effectiveness = 60% + 40% × supply. Below 50% supply, soldiers lose health each day and some die or desert.',
    'Under Hard visibility, enemy armies and towns are hidden unless they are in sight, and their strength is only as good as your reports.',
    '<b>Campaigns</b>: before marching, the planner estimates distance, days on the road (terrain slows the march: mountains ×3.5, forests ×1.5–2), food to carry (0.6 per soldier per day, more in harsh land, mountains and winter), upkeep, supply, sickness and battle losses, and the chance of interception. The army carries its food from your stores; leftovers return home. Each day a soldier may die of natural causes: 0.15% plus up to 0.6% in mountains, 0.3% in harsh land, more after six days on the march, in winter and on poor supply.') },
  { key: 'vis', name: 'Map visibility', icon: 'eye', body: () => kv(Object.values(VIS_MODES).map(m => [m.name, esc(m.desc)])) + P('Sight: people see 6 tiles, soldiers 7, armies 8, towns 11, towers 10; a scout watches a foreign homeland for about a day. Rival rulers follow the same rules: they explore with their own people and scouts and cannot attack a town they have not found.') },
  { key: 'intel', name: 'Intelligence', icon: 'eye', body: () => P('On <b>Hard</b> visibility, knowledge of other peoples comes from sources:') +
    kv(LEVELS.map((l, i) => [l, LEVEL_DESC[i]])) +
    P('Reports age: Verified becomes Reported after 12 days, Reported becomes Rumoured after 25, Rumoured fades after 60.', 'Sources: contact gives rumours; a trade agreement reports their economy and lands; an alliance reports their army and intentions; war reveals their army; scouts verify lands and military; agents verify everything and expose planted reports.') +
    kv(Object.entries(MISSIONS).map(([, m]) => [`${ico(m.icon, 'sm')} ${esc(m.name)}`, `${esc(m.desc)} Cost ${cost(m.cost)}${m.tech ? ' · needs ' + esc(TECH[m.tech]?.name || m.tech) : ''}`])) +
    P(`Journey risk starts at 3% and adds: long road (+5%), war (+12% envoys, +30% others), hostility (+8%), each hostile people the road crosses (+15%), scouting (+4%), winter (+3%); Border Access halves it. Agents are also caught on arrival with 12% + 18% per counter-intelligence agent the target keeps (max 85%). Each counter-intelligence agent costs one adult and ${COUNTER_COST} food a day.`) },
  { key: 'diplomacy', name: 'Diplomacy & reputation', icon: 'diplomacy', body: () => P('Opinion is the sum of cultural affinity, half your reputation, recent modifiers (which fade) and long memories (which fade over months).') +
    kv(Object.entries(TREATY_NAMES).map(([k, n]) => [n, { trade: 'Caravans between you; needs Barter.', nap: 'Neither side may attack.', alliance: 'Allies are called to each other’s wars.', tribute: 'One side pays the other each day for a time.', access: 'Safer, faster missions; your armies are supplied on their land.', exclusive: 'Caravans earn 50% more; neither may sign other trade agreements.' }[k] || ''])) +
    kv([['Honourable (≥ 8)', 'Treaties come easier.'], ['Reliable', 'Ordinary standing.'], ['Doubted (< −4)', 'Pacts and alliances are harder.'], ['Oathbreaker (< −15)', 'Alliances, access and exclusivity refused.']]) +
    P('Breaking a pact costs 7 reputation (12 for an alliance). An unprovoked war costs 4 and angers every onlooker. A just cause comes from ignored ultimatums, insults and caught saboteurs. Proposing again within 5 days of a refusal irritates them.') },
  { key: 'trade', name: 'Trade', icon: 'coin', body: () => P(
    'A deal lists what you give, what you receive, delivery and risk. Peoples value goods by base value × how scarce the good is for them. If they refuse, they may suggest terms they would accept.',
    '<b>Supply contracts</b> deliver every few days for a set number of deliveries. Deliveries may be raided on dangerous roads. A side that cannot deliver breaks the contract and loses 3 reputation; cancelling early costs 2.',
    '<b>Caravans</b> from your traders earn coins (or goods before Currency). They can be raided: risk follows the envoy road risk, reduced by a strong garrison. <b>Tariffs</b> (0–30%) raise your caravan income but sour partners. An <b>embargo</b> forbids all trade with a people.') },
  { key: 'towns', name: 'Settlements & eras', icon: 'house', body: () => kv(Object.entries(SPECS).map(([, s]) => [`${ico(s.icon, 'sm')} ${s.name}`, esc(s.desc)])) + P('A town’s focus can change every 30 days.') + kv(ERAS.map((e, i) => [e, `reached with a tier ${i} technology`])) },
  { key: 'ai', name: 'Rival rulers', icon: 'crown', body: () => P('Each people has a temperament (aggressive, trader, expansionist, isolationist, cautious, loyal) that varies a little from world to world. They remember gifts, betrayals, wars, trade and spies for months. They act only on what they know: under Hard intelligence they cannot attack towns they have not found and judge your army by their reports — even false ones.', 'If one people becomes far more powerful than the rest, the others may form a coalition against it.', 'Difficulty changes how well rivals decide (exploiting weakness, demanding better odds, planning more often), not how much they produce.') },
  { key: 'peoples', name: 'The four peoples', icon: 'population', body: () => TRIBES.map(tr => `<div class="enc-tribe"><img src="${emblemURL(tr.key)}" width="32" class="pix"><div><b style="color:${tr.pal.light}">${esc(tr.name)}</b> <span class="faint">${esc(tr.title)}</span><div style="font-size:0.9em">${esc(tr.blurb)}</div><div class="good" style="font-size:0.85em">${tr.strengths.map(esc).join(' · ')}</div><div class="bad" style="font-size:0.85em">${tr.weaknesses.map(esc).join(' · ')}</div></div></div>`).join('') },
  { key: 'resources', name: 'Resources', icon: 'wood', body: () => kv(Object.entries(RESOURCES).map(([k, r]) => [`${ico(k, 'sm')} ${esc(r.name)}`, `${esc(r.cat)}${r.food ? ' · edible' : ''} · trade value ${r.value}`])) },
  { key: 'buildings', name: 'Buildings', icon: 'build', body: () => kv(Object.entries(BUILDINGS).filter(([, b]) => !b.noBuild).map(([k, b]) => [esc(b.name), `${esc(b.desc || '')} <span class="faint">Cost ${cost(b.cost)}${b.tech ? ' · needs ' + esc(TECH[b.tech]?.name || b.tech) : ''}${b.housing ? ' · ' + b.housing + ' homes' : ''}${b.job && b.slots ? ' · ' + b.slots + ' ' + esc(JOBS[b.job]?.plural?.toLowerCase() || b.job) : ''}</span>`])) },
  { key: 'tech', name: 'Technology', icon: 'technology', body: () => BRANCHES.map(br => `<div class="caps" style="color:${br.color};margin-top:8px">${esc(br.name)}</div>` + kv(TECHS.filter(x => x.branch === br.key).sort((a, b) => a.tier - b.tier).map(x => [`${esc(x.name)} <span class="faint">(${esc(ERAS[Math.min(ERAS.length - 1, x.tier)])})</span>`, `${esc(x.desc)}${x.req?.length ? ` <span class="faint">Needs ${x.req.map(r => esc(TECH[r]?.name || r)).join(', ')}</span>` : ''}`]))).join('') },
  { key: 'laws', name: 'Laws & government', icon: 'scales', body: () => LAWS.map(l => `<div class="caps" style="color:var(--gold);margin-top:8px">${esc(l.name)}</div>` + kv(l.options.map(o => [esc(o.name), esc(o.desc)]))).join('') + `<div class="caps" style="color:var(--gold);margin-top:8px">Governments</div>` + kv(Object.values(GOVERNMENTS).map(g => [esc(g.name), esc(g.desc || '')])) },
];

PANELS.help = {
  title: t('help.title'), icon: 'scroll', sub: t('help.sub'), wide: true,
  render(hud, st) {
    st.ht = st.ht || 'basics'; st.hq = st.hq || '';
    const q = st.hq.trim().toLowerCase();
    let body;
    if (q) {
      const hits = TOPICS.map(tp => ({ tp, html: tp.body() })).filter(x => x.html.toLowerCase().replace(/<[^>]+>/g, '').includes(q) || x.tp.name.toLowerCase().includes(q));
      body = hits.length ? hits.map(x => `<div class="section-title">${esc(x.tp.name)}</div>${x.html}`).join('') : '<div class="prose faint">Nothing found.</div>';
    } else { const tp = TOPICS.find(x => x.key === st.ht) || TOPICS[0]; body = `<div class="section-title">${esc(tp.name)}</div>${tp.body()}`; }
    return `<div class="notice-tools"><label class="search">${ico('eye', 'sm')}<input type="text" data-input="h-search" placeholder="${esc(t('help.search'))}" value="${esc(st.hq)}"></label></div>
      <div class="row" style="flex-wrap:wrap;gap:4px;margin:8px 0">${TOPICS.map(tp => `<button class="btn xs ${!q && st.ht === tp.key ? 'on' : ''}" data-act="h-topic" data-k="${tp.key}">${ico(tp.icon, 'sm')}${esc(tp.name)}</button>`).join('')}</div>
      <div class="enc prose">${body}</div>`;
  },
};
ACTIONS['h-topic'] = (hud, b) => { hud.panelState.ht = b.dataset.k; hud.panelState.hq = ''; };
ACTIONS['h-search'] = (hud, el) => { hud.panelState.hq = el.value; hud.renderPanel(true); const i = hud.panelEl?.querySelector('[data-input="h-search"]'); if (i) { i.focus(); i.setSelectionRange(i.value.length, i.value.length); } };
