// Content of every in-game panel plus their actions. Panels render to HTML
// strings (diffed by the HUD) and use data-act attributes for interaction.
import { esc, fmt, sign, bar, toast, modal, closeModal, toggleHTML, h } from './dom.js';
import { ico, emblemURL, spriteURL } from './icons.js';
import { TRIBES } from '../data/tribes.js';
import { BUILDINGS, BUILDING_CATS, JOBS, JOB_KEYS } from '../data/buildings.js';
import { RESOURCES, RES_CATEGORIES, RES_KEYS, FOOD_KEYS, DEPOSITS, DEP } from '../data/resources.js';
import { TECHS, TECH, BRANCHES, TIER_STAGE } from '../data/techs.js';
import { LAWS, LAW, GOVERNMENTS } from '../data/laws.js';
import { STAGES, stageProgress, techState, techCost, setResearch, MAX_SETTLEMENTS } from '../sim/progress.js';
import { boostAt, isUnlocked, placementCheck, upgradeTarget, upgradeBuilding, destroyBuilding, accessibleDeposits, depositsNear, hasUnique } from '../sim/buildings.js';
import { canAfford, foodTotal, dailyFoodNeed, scarcity, buildingCost } from '../sim/economy.js';
import { jobCap, normaliseAlloc, assignJobs, traitName } from '../sim/population.js';
import { lawSlots, enactedCount, canEnact, enactLaw, canAdoptGov, adoptGov, policyInteractions, LEADER_TRAITS } from '../sim/government.js';
import { launchCampaign, equipTier, recallArmy } from '../sim/military.js';
import { SCOUT_MAX, RATION, FOOD_MIN, FOOD_MAX, scoutEstimate, canScout, maxParties } from '../sim/explore.js';
import { UNITS, ARMOURS, ARMOUR_KEYS, APPROACHES, FOCUS, LEADS, LINE_UNITS, unitOk, armourOk, armourOf, autoPlan } from '../data/warfare.js';
import { canFound, ENVOY_DEFAULTS, WORK_PRIORITIES } from '../sim/ai.js';
import { planProgress } from '../sim/planner.js';
import { TREATY_NAMES } from '../sim/diplomacy.js';
import { intelBadges, economyLine, strengthChip, intentLine, missionsSection, counterSection, reputationLine, inboxSection, intelActions, confirmJourney } from './intelui.js';
import { route, intel } from '../sim/intel.js';
import { traits } from '../sim/aimind.js';
import { SPECS, SPEC_COOLDOWN_DAYS, ERAS, eraOf, supplyAt, estimateCampaign, bridgeSpan, bridgeCostPer } from '../sim/logistics.js';
import { counterOffer, dealText, embargoed, TARIFFS } from '../sim/trade.js';
import { proposalText } from './hud.js';
import { sfx } from '../audio/audio.js';
import { SEASONS, DAYS_PER_YEAR } from '../core/constants.js';
import { fmtDate, dur, agoText } from '../core/calendar.js';

const pct = v => Math.round(v * 100) + '%';
const costHTML = (t, cost) => `<div class="cost">${Object.entries(cost).map(([r, v]) => `<span class="${(t.stock[r] || 0) < v ? 'lack' : ''}">${ico(r, 'sm')}${v}</span>`).join('') || '<span class="faint">Free</span>'}</div>`;
const attitude = v => v >= 50 ? ['Devoted', 'good'] : v >= 20 ? ['Friendly', 'good'] : v > -10 ? ['Cautious', 'dim'] : v > -40 ? ['Unfriendly', 'warn'] : ['Hostile', 'bad'];

// ================================================================= OVERVIEW
const overview = {
  title: 'Overview', icon: 'overview', sub: 'The state of your people',
  render(hud) {
    const g = hud.game, t = g.player;
    const sp = stageProgress(g, t);
    const W = hud.warnings();
    const L = t.leader;
    const trait = LEADER_TRAITS.find(x => x.key === L?.trait);
    return `
      <div class="row" style="gap:12px;align-items:stretch">
        <div class="parch" style="flex:1"><div class="caps" style="color:var(--parch-dim)">Stage ${t.stage} of 6 · ${ERAS[eraOf(t, TECH)]}</div><div class="display" style="font-size:2em;line-height:1;color:var(--parch-ink)">${STAGES[t.stage].name}</div><div style="font-family:var(--font-prose);font-size:0.9em;color:var(--parch-dim)">${STAGES[t.stage].desc}</div></div>
        <div class="parch" style="width:150px;text-align:center"><img src="${spriteURL('person', t.key, 'researcher', 0, L?.female, false, 1, null, t.stage, false)}" style="width:36px;height:48px" class="pix"><div style="font-size:0.95em">${t.def.leaderTitle} ${esc(L?.name || '')}</div><div style="font-size:0.75em;color:var(--parch-dim)" data-tip="${esc(trait?.desc || '')}">the ${esc(traitName(L?.trait))} · ${Math.floor((L?.age || 0) / DAYS_PER_YEAR)} yrs</div></div>
      </div>
      ${sp ? `<div class="section-title">Toward ${sp.next.name}</div>${sp.reqs.map(r => `<div class="req ${r.have >= r.need ? 'ok' : ''}">${r.have >= r.need ? ico('check', 'sm') : ico('lock', 'sm')}<span>${esc(r.label)}</span><span class="num">${fmt(r.have)} / ${r.need}</span>${bar(Math.min(1, r.have / r.need), r.have >= r.need ? 'green' : '')}</div>`).join('')}
        <div class="faint" style="font-size:0.8em;margin-top:4px">Unlocks: ${sp.next.unlocks.join(' · ')}</div>` : '<div class="section-title">The pinnacle of civilisation</div>'}
      ${advisorHTML(g, t)}
      <div class="section-title">Wellbeing</div>
      ${gauge('happy', 'Happiness', t.happiness / 100, Math.round(t.happiness), t.happiness > 55 ? 'green' : t.happiness < 35 ? 'red' : '')}
      ${gauge('stability', 'Stability', t.stability / 100, Math.round(t.stability), t.stability > 55 ? 'blue' : t.stability < 30 ? 'red' : '')}
      ${gauge('hammer', 'Productivity', t.productivity / 1.6, pct(t.productivity), '')}
      ${gauge('heart', 'Health', t.healthBase ?? 1, pct(t.healthBase ?? 1), 'green')}
      <div class="section-title">At a glance</div>
      <div class="stat-grid">
        ${stat('population', 'People', t.pop, `${t.housing} homes`)}${stat('flag', 'Territory', t.territory || 0, 'tiles')}${stat('house', 'Settlements', t.settlements.length, `of ${MAX_SETTLEMENTS[t.stage]}`)}
        ${stat('technology', 'Knowledge', t.techs.length, 'techs')}${stat('military', 'Strength', Math.round(t.strength), (t.jobCounts.soldier || 0) + ' soldiers')}${stat('crown', 'Government', GOVERNMENTS[t.gov].name.split(' ')[0], `${enactedCount(t)}/${lawSlots(t)} laws`)}
      </div>
      ${W.length ? `<div class="section-title">Concerns</div><div class="warn-list">${W.map(w => `<div class="warn-item ${w.bad ? 'bad' : ''}">${ico(w.icon, 'sm')}${esc(w.text)}</div>`).join('')}</div>` : ''}
      <div class="section-title">Stewards</div>
      <div class="prose" style="font-size:0.9em;margin-bottom:6px">Delegate routine decisions to your advisors. They follow the same reasoning as rival rulers.</div>
      <div class="col">
        ${[['work', 'Workforce steward', 'Automatically assign workers to jobs'], ['housing', 'Housing steward', 'Build homes when space runs short'], ['build', 'Master builder', 'Plan and place all buildings'], ['research', 'Royal scholar', 'Choose research when idle']].map(([k, n, d]) => `<div class="row between" data-act="steward" data-k="${k}" style="cursor:pointer"><span>${n}<br><small class="faint">${d}</small></span>${toggleHTML(t.steward[k])}</div>`).join('')}
      </div>
      ${settlementsHTML(g, t)}
      <div class="section-title">Expansion</div>
      <div class="row" style="gap:6px;flex-wrap:wrap;margin-bottom:6px"><button class="btn" data-act="expand-pick" data-tip="Pick a place on the map. Your land grows toward it, your gatherers, woodcutters and hunters work that way, and you can build up to 6 tiles past your border on that side.">${ico('flag')} ${t.expandTarget ? 'Change expansion direction' : 'Expand toward…'}</button>${t.expandTarget ? `<button class="btn sm" data-act="expand-clear">Clear</button>` : ''}</div>
      <div class="row" style="gap:6px;flex-wrap:wrap;margin-bottom:6px">${g.vis === 'open' ? '' : `<button class="btn" data-act="scout-plan" data-tip="Send up to ${SCOUT_MAX} people with food to chart unexplored land in one direction. More people chart a wider strip; more food takes them further.">${ico('eye')} Send scouting party</button>`}</div>
      ${(g.expeditions || []).filter(e => e.tribe === t.id).map(e => `<div class="row between" style="padding:2px 0"><span>${ico('eye', 'sm')} ${e.party} ${e.party === 1 ? 'scout' : 'scouts'} · ${e.state === 'out' ? 'heading out' : 'coming home'} · ${Math.round(e.food)} food left${e.lost ? ` · ${e.lost} lost` : ''}</span><span class="row"><button class="btn xs" data-act="scout-view" data-x="${e.x}" data-y="${e.y}">${ico('eye', 'sm')}</button>${e.state === 'out' ? `<button class="btn xs" data-act="scout-recall" data-id="${e.id}">Recall</button>` : ''}</span></div>`).join('')}
      ${(() => { const c = canFound(g, t); return `<button class="btn ${c.ok ? 'primary' : 'disabled'}" data-act="found" ${c.ok ? '' : `data-tip="${esc(c.why)}"`}>${ico('settle')} Found a new settlement</button> <span class="faint" style="font-size:0.8em">${c.ok ? '' : esc(c.why)}</span>`; })()}
    `;
  },
};
function settlementsHTML(g, t) {
  return `<div class="section-title">Settlements</div>${t.settlements.map(sid => { const s = g.settlements.get(sid); if (!s) return ''; const cd = s.specAt && g.tick - s.specAt < SPEC_COOLDOWN_DAYS * 360;
    return `<div class="spec-row"><div class="spec-name">${s.capital ? ico('crown', 'sm') : ico('house', 'sm')} ${esc(s.name)} <span class="faint">· ${s.pop} people</span></div>
      <div class="seg">${Object.entries(SPECS).map(([k, v]) => `<button class="btn xs ${s.spec === k ? 'on' : ''} ${cd && s.spec !== k ? 'disabled' : ''}" data-act="spec" data-sid="${sid}" data-k="${k}" data-tip="${esc(v.name + ': ' + v.desc + (cd ? ` Changing focus is possible ${dur(SPEC_COOLDOWN_DAYS)} after the last change.` : ''))}">${ico(v.icon, 'sm')}${v.name}</button>`).join('')}</div></div>`; }).join('')}
    <div class="faint" style="font-size:0.8em">A town's focus speeds some work and slows the rest. It can change once every ${dur(SPEC_COOLDOWN_DAYS)}.</div>`;
}
function advisorHTML(g, t) {
  const plan = planProgress(g, t);
  if (!plan.goal) return '';
  const items = [...plan.needs.slice(0, 4).map(n => esc(n)), ...Object.entries(plan.bottlenecks || {}).slice(0, 3).map(([r, how]) => `${ico(r, 'sm')} Short of ${RESOURCES[r]?.name || r} — ${esc(how)}`), ...plan.research.slice(0, 1).map(k => `${ico('technology', 'sm')} Research ${TECH[k].name}`)];
  if (!items.length) return '';
  return `<div class="parch" style="margin-top:10px"><div class="caps" style="color:var(--parch-dim)">Advisor · path to ${esc(plan.goal)}</div>${items.map(i => `<div style="font-size:0.88em">· ${i}</div>`).join('')}${t.strategy && t.strategy !== 'balanced' ? `<div style="font-size:0.8em;color:var(--parch-dim)">Current focus: ${esc(t.strategy)}</div>` : ''}</div>`;
}
function gauge(icon, label, frac, val, cls) { return `<div class="gauge" style="margin:4px 0">${ico(icon, 'sm')}<span style="width:92px">${label}</span>${bar(frac, cls)}<span class="num" style="width:44px;text-align:right">${val}</span></div>`; }
function stat(icon, k, v, sub) { return `<div class="stat"><span class="k">${ico(icon, 'sm')}${k}</span><span class="v num">${typeof v === 'number' ? fmt(v) : esc(v)} <small>${esc(sub || '')}</small></span></div>`; }

// ================================================================= BUILD
const build = {
  title: 'Build', icon: 'build', sub: 'Shape your settlements', wide: false,
  render(hud, st) {
    const g = hud.game, t = g.player;
    st.bcat = st.bcat || 'housing';
    const types = Object.keys(BUILDINGS).filter(k => BUILDINGS[k].cat === st.bcat && !BUILDINGS[k].noBuild && (!BUILDINGS[k].tribe || BUILDINGS[k].tribe === t.key));
    const cards = types.map(k => {
      const d = BUILDINGS[k]; const unlocked = isUnlocked(t, k); const cost = buildingCost(t, k);
      const afford = canAfford(t, cost); const uniq = d.unique && hasUnique(g, t, k);
      const img = spriteURL('building', k, t.key, t.stage, d.size);
      const lockText = !unlocked ? `Requires ${TECH[d.tech]?.name || '—'}` : uniq ? 'Already built' : '';
      return `<button class="bcard ${!unlocked || uniq ? 'locked' : !afford ? 'cant' : ''} ${hud.placing === k ? 'sel' : ''}" data-act="${unlocked && !uniq ? 'build' : ''}" data-type="${k}">
        <div class="bimg"><img src="${img}" style="width:${d.size * 8 * 2}px"></div>
        <div style="min-width:0"><div class="bname">${d.name}</div><div class="bdesc">${lockText ? `<span class="warn">${esc(lockText)}</span>` : esc(d.desc)}</div>${producesLines(k).map(l => `<div class="bmakes">${l}</div>`).join('')}${costHTML(t, cost)}
        <div class="faint" style="font-size:0.72em">${d.housing ? `${ico('house', 'sm')}${d.housing} homes ` : ''}${d.job && d.slots ? `${ico(d.job, 'sm')}${d.slots} ${JOBS[d.job].plural.toLowerCase()} ` : ''}${d.size}×${d.size}</div></div></button>`;
    }).join('');
    return `<div class="bcat">${BUILDING_CATS.map(c => `<button class="btn xs ${st.bcat === c.key ? 'on' : ''}" data-act="bcat" data-cat="${c.key}">${c.name}</button>`).join('')}</div>
      ${st.bcat === 'government' ? `<button class="bcard ${canFound(g, t).ok ? '' : 'cant'}" data-act="found" style="width:100%;margin-bottom:8px"><div class="bimg">${ico('settle', 'xl')}</div><div><div class="bname">New Settlement</div><div class="bdesc">Found a new town within 45 tiles of your lands. ${esc(canFound(g, t).why || '')}</div>${costHTML(t, { wood: 80, stone: 40, grain: 40 })}</div></button>` : ''}
      ${st.bcat === 'infrastructure' ? (() => { const sp = bridgeSpan(t); return `<button class="bcard ${sp ? '' : 'locked'}" data-act="${sp ? 'bridge-pick' : ''}" style="width:100%;margin-bottom:8px"><div class="bimg">${ico('wave', 'xl')}</div><div><div class="bname">Great Bridge</div><div class="bdesc">${sp ? `Lay a straight bridge from your land to a far bank, up to ${sp} tiles of water${t.techs.includes('engineering') ? ', even across open sea' : ' (rivers, lakes and shallows)'}. Built span by span.` : '<span class="warn">Requires Roads & Bridges</span>'}</div><div class="bmakes">Each span: ${Object.entries(bridgeCostPer(t)).map(([r, v]) => `${v} ${ico(r, 'sm')}${RESOURCES[r].name}`).join(' + ')}</div></div></button>`; })() : ''}
      <div class="bgrid">${cards}</div>
      <div class="prose" style="font-size:0.85em;margin-top:10px">Click a building, then click the map. Right-click or Esc to cancel. Buildings must be inside your territory; builders will raise them over time.</div>`;
  },
};

// ================================================================= POPULATION
const population = {
  title: 'Population', icon: 'population', sub: 'Your people and their work',
  render(hud) {
    const g = hud.game, t = g.player;
    const idleAdults = Math.max(0, (t.jobCounts.idle || 0) - t.children);
    const assigned = JOB_KEYS.reduce((a, k) => a + (t.alloc[k] || 0), 0);
    const rows = JOB_KEYS.map(k => {
      const cap = jobCap(t, k); const cur = t.jobCounts[k] || 0; const target = t.alloc[k] || 0;
      const capTxt = cap === Infinity ? 'Any' : cap;
      return `<div class="alloc" data-tip="${esc(JOBS[k].desc)}">${ico(k)}<div class="nm"><span>${JOBS[k].plural}</span><small>${cap === 0 ? 'No workplaces — build one' : `${capTxt} places`}</small></div>
        <div class="cnt num">${target}<small>${cur !== target ? `now ${cur}` : ''}</small></div>
        <div class="ctl"><button class="btn xs icon" data-act="alloc" data-job="${k}" data-d="-5">-5</button><button class="btn xs icon" data-act="alloc" data-job="${k}" data-d="-1">${ico('minus', 'sm')}</button><button class="btn xs icon" data-act="alloc" data-job="${k}" data-d="1">${ico('plus', 'sm')}</button><button class="btn xs icon" data-act="alloc" data-job="${k}" data-d="5">+5</button></div>
        <div class="meter">${bar(cap === Infinity ? target / Math.max(1, t.adults) : cap ? target / cap : 0, 'tribe')}</div></div>`;
    }).join('');
    const causes = Object.entries(t.deathCauses || {}).sort((a, b) => b[1] - a[1]);
    return `<div class="stat-grid">${stat('population', 'Total', t.pop)}${stat('hammer', 'Workforce', t.adults)}${stat('idle', 'Unassigned', Math.max(0, t.adults - assigned))}${stat('people', 'Children', t.children)}${stat('scroll', 'Elders', t.elders)}${stat('house', 'Homeless', t.homeless)}</div>
      <div class="section-title">Workforce allocation</div>
      <div class="row between" style="margin-bottom:6px"><span class="dim" style="font-size:0.85em">${assigned} of ${t.adults} adults assigned · ${idleAdults} idle</span>
        <span class="row" data-act="steward" data-k="work" style="cursor:pointer">${toggleHTML(t.steward.work, 'Steward')}</span></div>
      ${t.steward.work ? `<div class="row" style="flex-wrap:wrap;gap:4px;margin-bottom:8px"><span class="caps" style="color:var(--gold)">Priority</span><button class="btn xs ${!t.workPriority ? 'on' : ''}" data-act="work-prio" data-k="" data-tip="The steward balances every job by need">None</button>${Object.entries(WORK_PRIORITIES).map(([k, p]) => `<button class="btn xs ${t.workPriority === k ? 'on' : ''}" data-act="work-prio" data-k="${k}" data-tip="${esc(p.label)} gets workers first, once everyone is fed">${ico(p.icon, 'sm')}${esc(p.label)}</button>`).join('')}</div>` : ''}
      ${t.steward.work ? '<div class="warn-item" style="margin-bottom:6px">' + ico('warning', 'sm') + 'The workforce steward is assigning workers. Adjusting will turn it off.</div>' : ''}
      ${rows}
      <div class="section-title">Population over time</div><canvas class="chart" id="pop-chart" height="150"></canvas>
      <div class="section-title">Age structure</div><canvas class="chart" id="age-chart" height="130" style="height:130px"></canvas>
      <div class="section-title">Life & death</div>
      <div class="kv"><span>Born</span><span>${t.stats.born}</span><span>Died</span><span>${t.stats.died}</span>${causes.map(([c, n]) => `<span>· ${esc(c)}</span><span>${n}</span>`).join('')}</div>`;
  },
  mount(hud, body) {
    const g = hud.game, t = g.player;
    lineChart(body.querySelector('#pop-chart'), [{ data: t.stats.timeline.map(p => p.pop), color: t.color, label: 'People' }, { data: t.stats.timeline.map(p => p.food), color: '#e8c858', label: 'Food', scale: true }]);
    const ages = new Array(9).fill(0).map(() => [0, 0]);
    for (const a of g.agents.values()) if (a.tribe === t.id) { const y = Math.min(8, Math.floor(a.age / DAYS_PER_YEAR / 10)); ages[y][a.female ? 1 : 0]++; }
    const cv = body.querySelector('#age-chart'); const c = cv.getContext('2d'); cv.width = cv.clientWidth * 2; cv.height = 260;
    const max = Math.max(1, ...ages.flat()); const rh = cv.height / 9;
    c.font = '18px Pixelify Sans'; c.textAlign = 'center';
    for (let i = 0; i < 9; i++) {
      const y = cv.height - (i + 1) * rh; const [m, f] = ages[i]; const mid = cv.width / 2;
      c.fillStyle = TRIBES[t.id].pal.dark; c.fillRect(mid - 30 - (m / max) * (mid - 50), y + 3, (m / max) * (mid - 50), rh - 6);
      c.fillStyle = TRIBES[t.id].pal.light; c.fillRect(mid + 30, y + 3, (f / max) * (mid - 50), rh - 6);
      c.fillStyle = '#a89f8a'; c.fillText(i * 10 + (i === 8 ? '+' : ''), mid, y + rh / 2 + 6);
    }
  },
};

function lineChart(cv, series, war) {
  if (!cv) return;
  const c = cv.getContext('2d'); cv.width = cv.clientWidth * 2; cv.height = (cv.clientHeight || 150) * 2;
  const W = cv.width, H = cv.height;
  c.strokeStyle = 'rgba(216,178,90,0.12)'; c.lineWidth = 2;
  for (let i = 1; i < 4; i++) { c.beginPath(); c.moveTo(0, H * i / 4); c.lineTo(W, H * i / 4); c.stroke(); }
  if (war?.length > 1) { c.fillStyle = 'rgba(216,74,58,0.16)'; war.forEach((w, i) => { if (w) c.fillRect(i / (war.length - 1) * W - W / war.length / 2, 0, W / war.length + 1, H); }); }
  const all = series.filter(s => !s.scale).flatMap(s => s.data);
  const max = Math.max(1, ...all) * 1.1;
  c.font = '20px Pixelify Sans';
  series.forEach((s, si) => {
    if (s.data.length < 2) return;
    const m = s.scale ? Math.max(1, ...s.data) * 1.1 : max;
    c.strokeStyle = s.color; c.lineWidth = 4; c.globalAlpha = s.scale ? 0.6 : 1;
    c.beginPath();
    s.data.forEach((v, i) => { const x = (i / (s.data.length - 1)) * W, y = H - (v / m) * H; i ? c.lineTo(x, y) : c.moveTo(x, y); });
    c.stroke(); c.globalAlpha = 1;
    c.fillStyle = s.color; c.fillText(`${s.label} ${fmt(s.data[s.data.length - 1])}`, 12, 28 + si * 24);
  });
  if (series[0]?.data.length < 2) { c.fillStyle = '#6f6a60'; c.fillText('The chronicle is still young…', 12, H / 2); }
}

// ================================================================= ECONOMY
const economy = {
  title: 'Economy', icon: 'economy', sub: 'Stores, production and trade', wide: true,
  render(hud) {
    const g = hud.game, t = g.player; const L = t.lastLedger || { prod: {}, cons: {} };
    const need = dailyFoodNeed(g, t); const food = foodTotal(t);
    const foodProd = FOOD_KEYS.reduce((a, k) => a + (L.prod[k] || 0), 0);
    const cats = RES_CATEGORIES.map(cat => {
      const keys = RES_KEYS.filter(k => RESOURCES[k].cat === cat.key);
      return `<div class="section-title">${cat.name}</div><div class="res-table">${keys.map(k => {
        const v = t.stock[k] || 0; const r = t.rates[k] || 0;
        const known = v > 0 || (L.prod[k] || 0) > 0;
        return `<div class="res-cell ${known ? '' : 'locked'}" data-tip="${esc(`${RESOURCES[k].name}: produced ${fmt(L.prod[k] || 0, 1)}, used ${fmt(L.cons[k] || 0, 1)} last season`)}">${ico(k)}<span class="nm">${RESOURCES[k].name}</span><span class="amt num">${fmt(v)}<small class="${r > 0.05 ? 'good' : r < -0.05 ? 'bad' : 'faint'}">${sign(r)}/season</small></span>${k !== 'coins' ? `<div class="cap">${bar(v / (t._cap || 400), v / (t._cap || 400) > 0.95 ? 'red' : '')}</div>` : ''}</div>`;
      }).join('')}</div>`;
    }).join('');
    const top = Object.entries(L.prod || {}).filter(([, v]) => v > 0.5).sort((a, b) => b[1] - a[1]).slice(0, 8);
    const partners = g.dip.partners(t.id);
    return `<div class="stat-grid">${stat('food', 'Food stock', food, dur(food / Math.max(1, need)))}${stat('wheat', 'Food made', foodProd, 'last season')}${stat('people', 'Food eaten', need, 'per season')}
      ${stat('house', 'Storage', t._cap || 0, `per good · ${t.storehouses} stores`)}${stat('tools', 'Tools', t.stock.tools || 0, `for ${t.toolUsers} users`)}${stat('coin', 'Treasury', t.stock.coins || 0, t.techs.includes('currency') ? `tax ${fmt(L.tax || 0, 1)}/season` : 'no currency')}</div>
      ${(L.spoiled > 1 || L.wasted > 1) ? `<div class="warn-item" style="margin-top:8px">${ico('warning', 'sm')}Last season ${fmt(L.spoiled || 0)} food spoiled and ${fmt(L.wasted || 0)} goods were lost to full storage.</div>` : ''}
      <div class="section-title">Last season's top production</div>
      <div class="row" style="flex-wrap:wrap;gap:6px">${top.map(([k, v]) => `<span class="chip">${ico(k, 'sm')} ${RESOURCES[k].name} ${fmt(v, 1)}</span>`).join('') || '<span class="faint">Nothing yet.</span>'}</div>
      ${cats}
      ${tradeSection(g, t)}
      <div class="section-title">Trade partners</div>
      ${partners.length ? partners.map(p => `<div class="row" style="margin:3px 0"><img src="${emblemURL(g.tribes[p].key)}" width="22" class="pix"> Trade agreement with the ${g.tribes[p].name}</div>`).join('') + `<div class="faint" style="font-size:0.85em">${t.stats.tradeTrips || 0} caravans completed. Build markets and assign traders to profit.</div>` : '<div class="prose" style="font-size:0.9em">No trade partners. Research Barter, build a Marketplace and negotiate a Trade Agreement in Diplomacy.</div>'}`;
  },
};

// ================================================================= TECHNOLOGY
const NODE_W = 168, NODE_H = 58, COL_W = 212, ROW_H = 74, LEFT = 150, TOP = 40;
function techLayout() {
  if (techLayout.cache) return techLayout.cache;
  const pos = {}; let y = TOP; const lanes = [];
  for (const br of BRANCHES) {
    const byTier = {};
    for (const t of TECHS.filter(t => t.branch === br.key)) (byTier[t.tier] = byTier[t.tier] || []).push(t);
    const rows = Math.max(1, ...Object.values(byTier).map(a => a.length));
    for (const [tier, list] of Object.entries(byTier)) list.forEach((t, i) => { pos[t.key] = { x: LEFT + tier * COL_W, y: y + 14 + i * ROW_H }; });
    lanes.push({ br, y, h: rows * ROW_H + 18 });
    y += rows * ROW_H + 18;
  }
  techLayout.cache = { pos, lanes, w: LEFT + 7 * COL_W + 40, h: y + 20 };
  return techLayout.cache;
}

const technology = {
  title: 'Technology', icon: 'technology', full: true,
  render(hud) {
    const g = hud.game, t = g.player; const L = techLayout();
    const brColor = Object.fromEntries(BRANCHES.map(b => [b.key, b.color]));
    let edges = '';
    for (const tech of TECHS) for (const r of tech.req) {
      const a = L.pos[r], b = L.pos[tech.key];
      const x1 = a.x + NODE_W, y1 = a.y + NODE_H / 2, x2 = b.x, y2 = b.y + NODE_H / 2; const mx = (x1 + x2) / 2;
      edges += `<path data-from="${r}" data-to="${tech.key}" d="M${x1} ${y1} C${mx} ${y1}, ${mx} ${y2}, ${x2} ${y2}" fill="none" stroke-width="3"/>`;
    }
    const nodes = TECHS.map(tech => { const p = L.pos[tech.key]; return `<div class="tnode" data-act="research" data-key="${tech.key}" style="left:${p.x}px;top:${p.y}px;--bc:${brColor[tech.branch]}"><div class="tico">${ico(techIcon(tech), 'sm')}</div><div style="min-width:0"><div class="tname">${tech.name}</div><div class="tcost">${ico('research', 'sm')}<span class="tc">${techCost(t, tech.key)}</span> · ${['I', 'II', 'III', 'IV', 'V', 'VI', 'VII'][tech.tier]}</div></div><div class="prog"></div></div>`; }).join('');
    const lanes = L.lanes.map(l => `<div class="lane" style="top:${l.y}px;height:${l.h}px"><div class="lane-label" style="top:${l.h / 2 - 8}px;color:${l.br.color}">${ico(l.br.icon, 'sm')}${l.br.name}</div></div>`).join('');
    const tiers = [0, 1, 2, 3, 4, 5, 6].map(i => `<div class="tier-label" style="left:${LEFT + i * COL_W + NODE_W / 2}px">Tier ${['I', 'II', 'III', 'IV', 'V', 'VI', 'VII'][i]}</div>`).join('');
    return `<div class="tech-top"><div class="cur" id="tt-cur"></div><div class="row faint" style="font-size:0.8em;gap:12px"><span>${ico('check', 'sm')} Known</span><span style="color:var(--gold-hi)">* Researching</span><span>Click to research — prerequisites are queued automatically</span></div></div>
      <div class="tech-wrap scroll" id="tech-wrap"><div class="tech-canvas" style="width:${L.w}px;height:${L.h}px">${lanes}${tiers}<svg width="${L.w}" height="${L.h}">${edges}</svg>${nodes}</div></div>`;
  },
  mount(hud, body) {
    const wrap = body.querySelector('#tech-wrap');
    let drag = null;
    wrap.onpointerdown = e => { if (e.target.closest('.tnode')) return; drag = { x: e.clientX, y: e.clientY, sl: wrap.scrollLeft, st: wrap.scrollTop }; wrap.classList.add('drag'); };
    wrap.onpointermove = e => { if (!drag) return; wrap.scrollLeft = drag.sl - (e.clientX - drag.x); wrap.scrollTop = drag.st - (e.clientY - drag.y); };
    wrap.onpointerup = wrap.onpointerleave = () => { drag = null; wrap.classList.remove('drag'); };
    for (const n of body.querySelectorAll('.tnode')) {
      n._tip = () => techTip(hud, n.dataset.key); n.classList.add('has-tip');
    }
    // focus on current research frontier
    const t = hud.game.player; const L = techLayout();
    const frontier = TECHS.find(x => techState(t, x.key) === 'available');
    if (frontier) wrap.scrollLeft = Math.max(0, L.pos[frontier.key].x - 300);
    technology.live(hud, body);
  },
  live(hud, body) {
    const t = hud.game.player;
    const brColor = Object.fromEntries(BRANCHES.map(b => [b.key, b.color]));
    for (const n of body.querySelectorAll('.tnode')) {
      const k = n.dataset.key; const s = techState(t, k);
      const cls = 'tnode ' + s + (t.research.current === k ? ' current' : '') + (t.research.queue.includes(k) ? ' queued' : '') + ' has-tip';
      if (n.className !== cls) n.className = cls;
      const p = n.querySelector('.prog'); p.style.width = t.research.current === k ? (t.research.progress / techCost(t, k) * 100) + '%' : '0';
    }
    for (const e of body.querySelectorAll('svg path')) {
      const done = t.techs.includes(e.dataset.from); const to = techState(t, e.dataset.to);
      const col = done && to === 'done' ? brColor[TECH[e.dataset.to].branch] : done ? '#d8b25a' : '#3a3a46';
      e.setAttribute('stroke', col); e.setAttribute('stroke-opacity', to === 'done' ? 0.7 : done ? 0.9 : 0.6);
      e.setAttribute('stroke-dasharray', done ? '' : '6 6');
    }
    const cur = t.research.current;
    const el = body.querySelector('#tt-cur');
    const html = cur ? `<div class="row" style="gap:10px">${ico('research', 'lg')}<div style="flex:1"><div class="row between"><span style="color:var(--gold-hi)">Researching ${TECH[cur].name}</span><span class="num dim">${fmt(t.research.progress)} / ${techCost(t, cur)} · ${fmt(t.researchRate || 0, 1)}/season</span></div>${bar(t.research.progress / techCost(t, cur))}${t.research.queue.length ? `<div class="faint" style="font-size:0.8em">Then: ${t.research.queue.map(k => TECH[k].name).join(' › ')}</div>` : ''}</div></div>` : `<div class="warn-item">${ico('warning', 'sm')}Choose a technology to research. Researchers and elders generate knowledge every season.</div>`;
    if (el.innerHTML !== html) el.innerHTML = html;
  },
};
function techIcon(tech) {
  const u = tech.unlocks?.[0];
  if (tech.deposits?.length) return DEPOSITS[DEP[tech.deposits[0]]].res;
  const map = { farm: 'wheat', fishery: 'fish', pasture: 'livestock', orchard: 'fruit', quarry: 'stone', workshop: 'tools', mine: 'iron', smelter: 'steel', house: 'house', barracks: 'soldier', tower: 'flag', armory: 'weapons', fort: 'military', market: 'coin', artisan: 'goods', harbor: 'wave', mint: 'coins', school: 'scroll', council: 'crown', admin: 'crown', capitol: 'crown', library: 'research', academy: 'researcher', bathhouse: 'heart', factory: 'machinery', derrick: 'oil', manor: 'house', terrace: 'house' };
  if (u && map[u]) return map[u];
  return BRANCHES.find(b => b.key === tech.branch).icon;
}
function techTip(hud, key) {
  const t = hud.game.player; const tech = TECH[key]; const s = techState(t, key);
  const unlocks = [...(tech.unlocks || []).filter(u => !BUILDINGS[u].tribe || BUILDINGS[u].tribe === t.key).map(u => BUILDINGS[u].name), ...(tech.deposits || []).map(d => 'Work ' + DEPOSITS[DEP[d]].name.toLowerCase() + 's'), ...(tech.govs || []).map(g => GOVERNMENTS[g].name), ...(tech.laws || []).map(l => LAW[l].name + ' laws'), ...(tech.equip ? [`Equipment tier ${tech.equip}`] : [])];
  const mods = Object.entries(tech.mods || {}).map(([k, v]) => `${modName(k)} ${v > 0 && !['drought', 'spoilage', 'disease', 'food'].includes(k) ? '+' : ''}${Math.abs(v) < 2 ? Math.round(v * 100) + '%' : v}`);
  return `<div class="tt-title">${ico(techIcon(tech), 'sm')} ${tech.name}</div><div class="prose">${esc(tech.desc)}</div>
    ${unlocks.length ? `<div style="margin-top:4px"><span class="caps" style="color:var(--gold)">Unlocks</span><br>${unlocks.map(esc).join(', ')}</div>` : ''}
    ${mods.length ? `<div style="margin-top:4px"><span class="caps" style="color:var(--gold)">Effects</span><br>${mods.join(', ')}</div>` : ''}
    ${tech.req.length ? `<div style="margin-top:4px" class="${tech.req.every(r => t.techs.includes(r)) ? 'good' : 'warn'}">Requires ${tech.req.map(r => TECH[r].name).join(', ')}</div>` : ''}
    ${s === 'stage' ? `<div class="bad">Requires stage: ${STAGES[TIER_STAGE[tech.tier]].name}</div>` : ''}
    <div class="tt-row" style="margin-top:4px"><span>Cost</span><span>${techCost(t, key)} research</span></div>`;
}
const MOD_NAMES = { farm: 'Farm output', wood: 'Wood', mine: 'Mining', hunt: 'Hunting', fish: 'Fishing', craft: 'Crafting', research: 'Research', build: 'Build speed', trade: 'Trade', military: 'Soldier strength', defense: 'Defence', happiness: 'Happiness', stability: 'Stability', relation: 'Relation gain', birth: 'Births', food: 'Food eaten', upkeep: 'Military upkeep', tax: 'Tax income', drought: 'Drought severity', spoilage: 'Spoilage', disease: 'Disease', lawSlots: 'Law slots', roadSpeed: 'Road speed', winterFarm: 'Winter farming', productivity: 'Productivity', industry: 'Industry' };
const modName = k => MOD_NAMES[k] || k;

// ================================================================= DIPLOMACY
const diplomacy = {
  title: 'Diplomacy', icon: 'diplomacy', sub: 'Rivals, partners and treaties', wide: true,
  render(hud) {
    const g = hud.game, t = g.player, D = g.dip;
    const props = g.pendingProposals.filter(p => p.to === t.id);
    const others = g.tribes.filter(o => o !== t);
    return `${reputationLine(g)}${envoySection(t)}${missionsSection(g)}${props.length ? `<div class="section-title">Envoys awaiting your answer</div>${props.map((p, i) => `<div class="proposal" ${p.p.ultimatum ? 'style="border-left-color:var(--bad);background:rgba(255,90,80,0.08)"' : ''}><img src="${emblemURL(g.tribes[p.from].key)}" width="36" class="pix"><div style="flex:1"><div style="color:${p.p.ultimatum ? 'var(--bad)' : 'var(--gold-hi)'}">${p.p.ultimatum ? 'Ultimatum from the ' : 'The '}${g.tribes[p.from].name}</div><div class="prose" style="font-size:0.9em">${esc(proposalText(p.p))}${p.sent != null ? ` <span class="faint" style="font-size:0.85em">Sent ${agoText(Math.max(0, Math.round((g.tick - p.sent) / 360)))} · ${dur(p.travel)} on the road.</span>` : ''}${p.expires ? ` <span class="warn">Answer within ${dur(Math.max(0, (p.expires - g.tick) / 360))}.</span>` : ''}</div></div><button class="btn sm primary" data-act="prop-yes" data-i="${g.pendingProposals.indexOf(p)}">${p.p.ultimatum ? 'Pay tribute' : 'Accept'}</button><button class="btn sm ${p.p.ultimatum ? 'danger' : ''}" data-act="prop-no" data-i="${g.pendingProposals.indexOf(p)}">${p.p.ultimatum ? 'Refuse' : 'Decline'}</button></div>`).join('')}` : ''}
      ${others.map(o => {
        if (!o.alive) return `<div class="frame dip-card" style="opacity:0.5"><div class="dip-head"><img class="emb" src="${emblemURL(o.key)}" style="filter:grayscale(1)"><div><div class="dip-name">${o.name}</div><div class="dim">Fallen</div></div></div></div>`;
        const known = D.contact[t.id][o.id];
        if (!known) return `<div class="frame dip-card"><div class="dip-head"><img class="emb" src="${emblemURL(o.key)}" style="filter:brightness(0.3)"><div><div class="dip-name" style="color:var(--text-faint)">Unknown people</div><div class="prose">Your scouts have not yet met this tribe. Contact comes with proximity — or time.</div>${g.fog ? `<button class="btn sm" data-act="intel-send" data-to="${o.id}" data-k="scout" style="margin-top:4px">${ico('eye', 'sm')} Send a scout to find them</button>` : ''}</div></div></div>`;
        const op = D.opinion(o.id, t.id), mine = D.opinion(t.id, o.id);
        const [att, cls] = attitude(op);
        const war = D.atWar(t.id, o.id);
        const treaties = D.treaties.filter(x => (x.a === t.id && x.b === o.id) || (x.a === o.id && x.b === t.id));
        const ws = D.war(t.id, o.id);
        const rs = (t.strength + 1) / (o.strength + 1);
        const bd = D.breakdown(o.id, t.id);
        const IL = intentLine(g, t.id, o, warRiskChip);
        return `<div class="frame dip-card" style="--tribe:${o.color}"><div class="dip-head"><img class="emb" src="${emblemURL(o.key)}">
          <div style="flex:1"><div class="row between"><div class="dip-name" style="color:${o.def.pal.light}">${o.name}</div><span class="${cls}" style="font-size:1.05em">${att} ${sign(op, 0)}</span></div>
          <div class="dim" style="font-size:0.85em">${o.def.leaderTitle} ${esc(o.leader?.name || '')} · ${economyLine(g, t.id, o)} · ${GOVERNMENTS[o.gov].name}</div>
          <div class="row" style="gap:4px;flex-wrap:wrap;margin-top:2px">${traits(o).map(([n, d]) => `<span class="trait-chip" data-tip="${esc(d + ' Temperament shapes their choices but does not dictate them.')}">${esc(n)}</span>`).join('')}${D.coalition?.against === o.id ? '<span class="trait-chip bad" data-tip="Other peoples have banded together against them.">Coalition target</span>' : ''}${D.coalition?.members?.includes(o.id) ? `<span class="trait-chip" data-tip="Part of a coalition against the ${esc(g.tribes[D.coalition.against].name)}.">In coalition</span>` : ''}</div>
          ${intelBadges(g, t.id, o)}
          <div class="rel-bar has-tip" data-tip="${esc(bd.map(x => `${x.label}: ${sign(x.v, 0)}`).join('\n') || 'No strong feelings')}"><div class="mark" style="left:${(op + 100) / 2}%"></div></div>
          <div class="faint" style="font-size:0.78em">${bd.slice(0, 4).map(x => `${esc(x.label)} ${sign(x.v, 0)}`).join(' · ')}</div>
          <div class="dim" style="font-size:0.78em;margin-top:3px" data-tip="What your envoys observe of their intentions">${IL ? IL.line : `${ico('eye', 'sm')} ${esc(o.lastDecision || 'Consolidating their lands')}${o.research.current ? ` · studying ${TECH[o.research.current].name}` : ''}${o.warPrep ? ' · <span class="warn">mobilising for war</span>' : ''}`}</div></div></div>
          <div class="row" style="flex-wrap:wrap;gap:4px;margin-top:6px">${!war ? (IL ? IL.risk : warRiskChip(D.warRisk?.[o.id]?.[t.id])) : ''}${war ? `<span class="chip red">${ico('military', 'sm')} At war · score ${Math.round(ws.score[t.id] || 0)} : ${Math.round(ws.score[o.id] || 0)}</span>` : ''}${treaties.map(x => `<span class="chip ${x.type === 'alliance' ? 'green' : x.type === 'tribute' ? 'red' : 'blue'}">${TREATY_NAMES[x.type]}${x.type === 'tribute' ? (x.payer === t.id ? ' (you pay)' : ' (they pay)') : ''}${x.until ? ` · ${Math.max(0, Math.ceil((x.until - g.tick) / 360))}d` : ''}</span>`).join('')}
            ${strengthChip(g, t.id, o)}</div>
          <div class="dip-actions">${war ? `<button class="btn sm" data-act="dip" data-to="${o.id}" data-type="peace">${ico('peace', 'sm')} Propose peace</button>` : `
            <button class="btn sm" data-act="dip" data-to="${o.id}" data-type="gift">${ico('gift', 'sm')} Gift</button>
            <button class="btn sm" data-act="dip" data-to="${o.id}" data-type="exchange">${ico('exchange', 'sm')} Exchange</button>
            ${D.has('trade', t.id, o.id) ? `<button class="btn sm" data-act="dip-cancel" data-to="${o.id}" data-treaty="trade">End trade</button>` : `<button class="btn sm" data-act="dip" data-to="${o.id}" data-type="trade">${ico('coin', 'sm')} Trade pact</button>`}
            ${D.has('nap', t.id, o.id) ? '' : `<button class="btn sm" data-act="dip" data-to="${o.id}" data-type="nap">${ico('peace', 'sm')} Non-aggression</button>`}
            ${D.has('alliance', t.id, o.id) ? `<button class="btn sm" data-act="dip-cancel" data-to="${o.id}" data-treaty="alliance">Leave alliance</button>` : `<button class="btn sm" data-act="dip" data-to="${o.id}" data-type="alliance">${ico('diplomacy', 'sm')} Military alliance</button>`}
            ${D.has('access', t.id, o.id) ? `<button class="btn sm" data-act="dip-cancel" data-to="${o.id}" data-treaty="access">Close borders</button>` : `<button class="btn sm" data-act="dip" data-to="${o.id}" data-type="access" data-tip="Open roads between you: safer, faster envoys and scouts, and better knowledge of each other's lands.">${ico('flag', 'sm')} Border access</button>`}
            ${D.has('trade', t.id, o.id) ? (D.has('exclusive', t.id, o.id) ? `<button class="btn sm" data-act="dip-cancel" data-to="${o.id}" data-treaty="exclusive">End exclusivity</button>` : `<button class="btn sm" data-act="dip" data-to="${o.id}" data-type="exclusive" data-tip="Trade only with each other: caravans between you earn 50% more, but neither may sign other trade agreements.">${ico('coin', 'sm')} Exclusive trade</button>`) : ''}
            <button class="btn sm" data-act="dip" data-to="${o.id}" data-type="offerTribute" data-tip="Pay them tribute for two and a half years to win their favour.">${ico('coins', 'sm')} Offer tribute</button>
            <button class="btn sm" data-act="dip" data-to="${o.id}" data-type="tribute">${ico('coins', 'sm')} Demand tribute</button>
            <button class="btn sm ${D.embargo?.[t.id]?.includes(o.id) ? 'on' : ''}" data-act="embargo" data-to="${o.id}" data-tip="${D.embargo?.[t.id]?.includes(o.id) ? 'Lift the embargo and allow trade again.' : 'Forbid all trade with them. Ends trade agreements and contracts; they will resent it.'}">${ico('lock', 'sm')} ${D.embargo?.[t.id]?.includes(o.id) ? 'Lift embargo' : 'Embargo'}</button>
            <button class="btn sm danger" data-act="dip-war" data-to="${o.id}">${ico('military', 'sm')} Declare war</button>`}</div>${intelActions(g, t.id, o)}</div>`;
      }).join('')}
      ${counterSection(g)}${inboxSection(g)}
      <div class="prose" style="font-size:0.85em">Opinions shift with trade, gifts, borders, shared enemies and broken promises. Hover the relation bar for the full reasoning.${g.hardIntel ? ' In this world information travels slowly: badges show how reliable and how old your knowledge of each people is.' : ''}</div>`;
  },
};

function warRiskChip(v) {
  if (v == null) return '';
  const [label, cls] = v > 22 ? ['War risk: high', 'red'] : v > 4 ? ['War risk: elevated', 'red'] : v > -20 ? ['War risk: low', ''] : ['War risk: negligible', 'green'];
  return `<span class="chip ${cls}" data-tip="How seriously their council weighs war against you: gains, losses, treaties, allies and your defences.">${ico('target', 'sm')} ${label}</span>`;
}
const ENVOY_OPTS = [['answer', 'Answer envoys', 'Reply to foreign proposals on your behalf'], ['trade', 'Seek trade', 'Propose trade agreements'], ['alliances', 'Seek pacts & alliances', 'Non-aggression with neighbours, alliances with friends'], ['peace', 'Seek peace', 'Propose peace when at war'], ['appease', 'Appease the strong', 'Pay tribute to far stronger rivals rather than fight'], ['gifts', 'Diplomatic gifts', 'Send surplus goods to calm hostile or cooling partners']];
function envoySection(t) {
  const on = t.steward.diplomacy; const cfg = { ...ENVOY_DEFAULTS, ...(t.envoy || {}) };
  return `<div class="frame" style="padding:2px 4px;margin-bottom:10px"><div class="row between"><div><div style="color:var(--gold-hi)">${ico('scroll', 'sm')} Envoy steward</div><div class="faint" style="font-size:0.8em">Never declares war or cancels treaties, and leaves alone anything you have refused or ended. Your own decisions always take precedence.</div></div><span class="row" data-act="steward" data-k="diplomacy" style="cursor:pointer">${toggleHTML(on)}</span></div>
    ${on ? `<div class="row" style="flex-wrap:wrap;gap:4px;margin-top:6px">${ENVOY_OPTS.map(([k, n, d]) => `<button class="btn xs ${cfg[k] ? 'on' : ''}" data-act="envoy" data-k="${k}" data-tip="${esc(d)}">${n}</button>`).join('')}</div>
      ${(t.envoyLog || []).length ? `<div class="faint" style="font-size:0.8em;margin-top:6px">${t.envoyLog.slice(0, 4).map(l => '· ' + esc(l.text)).join('<br>')}</div>` : ''}` : ''}</div>`;
}

// ================================================================= GOVERNMENT
const government = {
  title: 'Government', icon: 'government', sub: 'Leadership, reforms and law', wide: true,
  render(hud) {
    const g = hud.game, t = g.player;
    const slots = lawSlots(t), used = enactedCount(t);
    const gov = GOVERNMENTS[t.gov];
    const cats = [...new Set(LAWS.map(l => l.cat))];
    const inter = policyInteractions(t);
    const cd = Math.max(0, Math.ceil((t.lawCooldown - g.tick) / 10));
    return `<div class="frame gov-card">${ico('crown', 'xl')}<div style="flex:1"><div class="caps" style="color:var(--gold)">Current government</div><div class="display" style="font-size:2em;color:var(--gold-hi);line-height:1">${gov.name}</div><div class="prose" style="font-size:0.9em">${gov.desc}</div>
        <div class="faint" style="font-size:0.8em">${Object.entries(gov.mods).map(([k, v]) => `${modName(k)} ${sign(Math.abs(v) < 2 ? v * 100 : v, 0)}${Math.abs(v) < 2 ? '%' : ''}`).join(' · ')}${gov.favours === t.key ? ' · <span class="good">Suits your people (+5 stability)</span>' : ''}</div></div>
        <div style="text-align:center"><div class="caps" style="color:var(--gold)">Law slots</div><div class="slots" style="justify-content:center;margin-top:6px">${Array.from({ length: slots }, (_, i) => `<i class="${i < used ? 'full' : ''}"></i>`).join('')}</div><div class="faint" style="font-size:0.8em;margin-top:4px">${used} / ${slots}</div></div></div>
      <div class="section-title">Reforms</div>
      <div class="row" style="flex-wrap:wrap;gap:6px">${Object.entries(GOVERNMENTS).filter(([k]) => k !== t.gov).map(([k, gv]) => { const c = canAdoptGov(g, t, k); return `<button class="btn sm ${c.ok ? '' : 'disabled'}" data-act="gov" data-k="${k}" data-tip="${esc(gv.desc + (c.ok ? ' Reform causes a temporary loss of stability.' : ' — ' + c.why))}">${gv.name}${gv.favours === t.key ? ' *' : ''}</button>`; }).join('')}</div>
      <div class="row between" style="margin-top:12px"><div class="section-title" style="flex:1;margin:0">Laws</div>${cd ? `<span class="chip">Council deliberating · ${cd}s</span>` : ''}</div>
      ${cats.map(cat => `<div class="caps" style="color:var(--text-dim);margin:10px 0 6px">${cat}</div>${LAWS.filter(l => l.cat === cat).map(l => {
        const locked = l.tech && !t.techs.includes(l.tech);
        return `<div class="law"><div class="law-name"><span>${l.name}</span>${locked ? `<span class="faint" style="font-size:0.8em">${ico('lock', 'sm')} ${TECH[l.tech].name}</span>` : ''}</div><div class="law-opts">${l.options.map(o => {
          const on = t.laws[l.key] === o.key; const lk = locked || (o.tech && !t.techs.includes(o.tech));
          return `<button class="law-opt ${on ? 'on' : ''} ${lk ? 'locked' : ''}" data-act="law" data-law="${l.key}" data-opt="${o.key}" data-tip="${esc(o.desc)}">${o.name}</button>`;
        }).join('')}</div></div>`;
      }).join('')}`).join('')}
      ${inter.length ? `<div class="section-title">Policy interactions</div>${inter.map(i => `<div class="warn-item">${ico('scales', 'sm')}<div><b>${esc(i.name)}</b><br><span class="dim" style="font-size:0.9em">${esc(i.desc)}</span></div></div>`).join('')}` : ''}
      <div class="section-title">Stability factors</div>
      <div class="kv">${Object.entries(t.stabParts || {}).map(([k, v]) => `<span>${k.charAt(0).toUpperCase() + k.slice(1)}</span><span class="${v >= 0 ? 'good' : 'bad'}">${sign(v)}</span>`).join('')}</div>`;
  },
};

// ================================================================= MILITARY
const military = {
  title: 'Military', icon: 'military', sub: 'Arms, defences and war', wide: true,
  render(hud, st) {
    const g = hud.game, t = g.player, D = g.dip;
    const eq = equipTier(t); const soldiers = t.jobCounts.soldier || 0;
    const enemies = D.enemies(t.id);
    const maxS = Math.max(1, ...g.tribes.map(o => o.strength));
    st.commit = st.commit || 0.75;
    const armies = g.armies.filter(a => a.tribe === t.id);
    const towers = [...g.buildings.values()].filter(b => b.tribe === t.id && b.built && BUILDINGS[b.type].tower).length;
    return `<div class="stat-grid">${stat('soldier', 'Soldiers', soldiers, `cap ${t.slots.soldier}`)}${stat('weapons', 'Weapons', t.stock.weapons || 0, `equip tier ${eq}`)}${stat('military', 'Strength', Math.round(t.strength))}
        ${stat('flag', 'Defences', towers, 'towers & forts')}${stat('sad', 'War weariness', Math.round(t.warWeariness || 0))}${stat('coin', 'Upkeep', soldiers ? fmt(soldiers * 0.15 * Math.max(0.2, 1 + (t.mods.upkeep || 0)), 1) : 0, 'wood/season')}</div>
      <div class="section-title">Balance of power</div>
      ${g.tribes.filter(o => o.alive).map(o => { const r = o === t ? { lv: 3, val: o.strength } : intel(g, t.id, o.id, 'military'); const v = r.val ?? 0; const known = r.lv > 0 && r.val != null; return `<div class="gauge" style="margin:4px 0" data-tip="${esc(o === t ? 'Your own forces' : known ? `${['Unknown', 'Rumoured', 'Reported', 'Verified'][r.lv]} estimate${r.age ? `, ${dur(r.age)} old` : ''}` : 'Unknown: send a scout or agent')}"><img src="${emblemURL(o.key)}" width="20" class="pix"><span style="width:80px;color:${o.def.pal.light}">${(o === t || g.dip.contact[t.id][o.id]) ? o.name : 'Unknown'}</span><div class="bar" style="flex:1;height:12px"><i style="width:${known ? Math.min(100, v / maxS * 100) : 0}%;background:${o.color};${r.lv < 3 ? 'opacity:0.55' : ''}"></i></div><span class="num" style="width:40px;text-align:right">${known ? (r.lv < 3 ? '~' : '') + Math.round(v) : '?'}</span></div>`; }).join('')}
      <div class="section-title">Armour</div>
      <div class="seg" style="flex-wrap:wrap;margin-bottom:4px">${ARMOUR_KEYS.map(k => { const A = ARMOURS[k], ok = armourOk(t, k); const fx = Object.entries(A.take).map(([d, v]) => `${d} ${v < 1 ? '−' + Math.round((1 - v) * 100) : '+' + Math.round((v - 1) * 100)}%`).join(', '); return `<button class="btn xs ${armourOf(t) === k ? 'on' : ''}" ${ok ? '' : 'disabled'} data-act="armour" data-k="${k}" data-tip="${esc(`${A.name}: ${A.desc}${fx ? ' Damage taken: ' + fx + '.' : ''}${A.speed < 1 ? ` Speed ${Math.round(A.speed * 100)}%.` : ''}${A.hot ? ' Weaker in deserts.' : ''}${ok ? '' : ' Not yet researched.'}`)}">${esc(A.name)}</button>`; }).join('')}</div>
      <div class="section-title">Arsenal</div>
      <div class="faint" style="font-size:0.85em;margin-bottom:6px">${Object.entries(UNITS).map(([k, U]) => `<span class="${unitOk(t, k) ? '' : 'faint'}" style="${unitOk(t, k) ? 'color:var(--gold)' : 'opacity:0.5'}" data-tip="${esc(U.desc + (U.tech && !unitOk(t, k) ? ' (research needed)' : ''))}">${esc(U.name)}</span>`).join(' · ')}${t.techs.includes('flamingarrows') ? ' · <span style="color:var(--gold)" data-tip="Archers and towers shoot burning arrows that set buildings alight.">Flaming arrows</span>' : ''}${t.techs.includes('explosiveshot') ? ' · <span style="color:var(--gold)" data-tip="Trebuchets hurl bursting powder kegs.">Explosive shot</span>' : ''}<br>Spears hold off swords, swords cut down archers, archers shoot down spear lines. Choose the mix, angle and focus when you plan an attack.</div>
      <div class="section-title">Recruitment</div>
      <div class="alloc">${ico('soldier')}<div class="nm"><span>Soldiers</span><small>${t.slots.soldier} places · build barracks to raise the cap</small></div><div class="cnt num">${t.alloc.soldier || 0}</div><div class="ctl"><button class="btn xs icon" data-act="alloc" data-job="soldier" data-d="-1">${ico('minus', 'sm')}</button><button class="btn xs icon" data-act="alloc" data-job="soldier" data-d="1">${ico('plus', 'sm')}</button><button class="btn xs icon" data-act="alloc" data-job="soldier" data-d="5">+5</button></div></div>
      <div class="prose" style="font-size:0.85em">Soldiers eat more, consume wood and coin, and produce nothing — but strength deters rivals. Equipment depends on your weapons technology and the weapons in your stores.</div>
      <div class="section-title">Wars</div>
      ${enemies.length ? enemies.map(e => { const o = g.tribes[e]; const w = D.war(t.id, e); return `<div class="frame" style="margin-bottom:10px;padding:2px 4px"><div class="row"><img src="${emblemURL(o.key)}" width="32" class="pix"><div style="flex:1"><div style="color:${o.def.pal.light};font-size:1.2em">War with the ${o.name}</div><div class="dim" style="font-size:0.8em">${dur(Math.floor((g.tick - w.start) / 360))} · war score ${Math.round(w.score[t.id] || 0)} : ${Math.round(w.score[e] || 0)}</div></div><button class="btn sm" data-act="dip" data-to="${e}" data-type="peace">${ico('peace', 'sm')} Sue for peace</button></div>
          <div class="caps" style="color:var(--gold);margin:8px 0 4px">Their settlements</div>
          ${o.settlements.map(sid => { const s = g.settlements.get(sid); const c = g.buildings.get(s.centre); return `<div class="row between" style="padding:3px 0"><span>${s.capital ? ico('crown', 'sm') : ico('house', 'sm')} ${esc(s.name)} <span class="faint">· ${!g.hardIntel || intel(g, t.id, o.id, 'military').lv >= 3 ? `${s.pop} people${c ? ' · walls ' + Math.round(c.hp / c.maxHp * 100) + '%' : ''}` : 'defences unknown'}${s.capital ? ' · capital (can be sacked)' : ''}</span></span><button class="btn xs" data-act="campaign" data-sid="${sid}" data-tip="Plan a campaign: route, food, supply and risks">${ico('target', 'sm')} Plan attack</button></div>`; }).join('')}</div>`; }).join('')
        + `<div class="row" style="gap:8px"><span class="dim" style="font-size:0.85em">Commit</span>${[0.5, 0.75, 1].map(f => `<button class="btn xs ${st.commit === f ? 'on' : ''}" data-act="commit" data-f="${f}">${f * 100}%</button>`).join('')}<span class="faint" style="font-size:0.8em">of idle soldiers to each attack</span></div>`
        : '<div class="prose" style="font-size:0.9em">You are at peace. Declare war from the Diplomacy panel.</div>'}
      ${armies.length ? `<div class="section-title">Armies in the field</div>${armies.map(a => `<div class="row between" style="padding:4px 0"><span>${ico('flag', 'sm')} ${a.alive ?? a.size} soldiers › ${esc(g.settlements.get(a.target)?.name || '?')} <span class="faint">· ${a.state}${a.comp ? ' · ' + Object.entries(a.comp).map(([u, n]) => n + ' ' + (UNITS[u]?.name || u).toLowerCase()).join(', ') : ''}${a.plan ? ' · ' + (APPROACHES[a.plan.approach]?.name || '') + ', ' + (FOCUS[a.plan.focus]?.name || '').toLowerCase() : ''} · ${a.kills} kills, ${a.losses} lost${a.attrition ? ` (${a.attrition} to attrition)` : ''}</span><span class="supply" data-tip="${esc(`Supply ${Math.round((a.supply ?? 1) * 100)}%: ${a.supplyWhy || 'within reach of your towns'}. Effectiveness ${Math.round((0.6 + 0.4 * (a.supply ?? 1)) * 100)}%. Below 50% soldiers fall sick and desert. Friendly or allied land, border access, roads and Military towns extend supply; winter shortens it.`)}">Supply ${bar(a.supply ?? 1, (a.supply ?? 1) < 0.5 ? 'red' : (a.supply ?? 1) < 0.8 ? '' : 'green')}</span></span><span class="row"><button class="btn xs" data-act="army-view" data-id="${a.id}">${ico('eye', 'sm')}</button>${a.state !== 'return' ? `<button class="btn xs" data-act="recall" data-id="${a.id}">Recall</button>` : ''}</span></div>`).join('')}` : ''}`;
  },
};

// ================================================================= CHRONICLE
const TYPE_COL = { war: '#d84a3a', diplomacy: '#5f8fe0', tech: '#a873e8', stage: '#f2c84b', settlement: '#7ad08a', build: '#c9b48a', wonder: '#f4dc8a', government: '#e8c058', law: '#b8a070', event: '#e8803a', population: '#8fbaf0', world: '#ffffff' };
const STATS = [
  ['pop', 'Population', 'population'], ['food', 'Food stored', 'food'], ['prod', 'Daily production', 'hammer'], ['wood', 'Wood', 'wood'], ['stone', 'Stone', 'stone'], ['coins', 'Coins', 'coins'],
  ['str', 'Military strength', 'military'], ['hap', 'Happiness', 'happy'], ['tech', 'Technologies', 'technology'], ['terr', 'Territory', 'flag'],
];
const chronicle = {
  title: 'Chronicle', icon: 'chronicle', sub: 'The history of this world', wide: true,
  render(hud, st) {
    const g = hud.game;
    st.cf = st.cf || 'all'; st.ct = st.ct ?? 'all'; st.cv = st.cv || 'stats'; st.cs = st.cs || 'pop';
    const tabs = `<div class="seg" style="margin-bottom:8px">${[['stats', 'Statistics'], ['timeline', 'Timeline'], ['log', 'Full record']].map(([k, n]) => `<button class="btn sm ${st.cv === k ? 'on' : ''}" data-act="chron-v" data-v="${k}">${n}</button>`).join('')}</div>`;
    if (st.cv === 'stats') {
      const others = g.hardIntel ? 'Under Hard intelligence only your own history is charted; rivals keep their records to themselves.' : 'Every people is charted.';
      return tabs + `<div class="row" style="flex-wrap:wrap;gap:4px">${STATS.map(([k, n, ic]) => `<button class="btn xs ${st.cs === k ? 'on' : ''}" data-act="chron-s" data-s="${k}">${ico(ic, 'sm')}${n}</button>`).join('')}</div>
        <canvas class="chart" id="world-chart" height="200"></canvas>
        <div class="faint" style="font-size:0.8em">${others} Red bands mark times you were at war.</div>
        <div class="section-title">Trends</div>${trendsHTML(g)}`;
    }
    if (st.cv === 'timeline') {
      const P = g.playerId;
      const major = g.history.filter(e => e.imp >= 2 && (e.imp >= 3 || e.tribe === P || e.with === P || (Array.isArray(e.with) && e.with.includes(P))));
      const years = new Map(); for (const e of major) { const y = Math.floor(e.day / DAYS_PER_YEAR) + 1; if (!years.has(y)) years.set(y, []); years.get(y).push(e); }
      return tabs + `<div class="faint" style="font-size:0.82em;margin-bottom:6px">Major moments of this world. Entries with ${ico('target', 'sm')} show the place on the map.</div><div class="timeline">${[...years.entries()].reverse().map(([y, es]) => `<div class="tl-year"><div class="tl-y">Year ${y}</div>${es.slice().reverse().map(e => `<div class="tl-e ${e.type === 'stage' || e.type === 'wonder' ? 'big' : ''}" ${e.at ? `data-act="chron-go" data-x="${e.at[0]}" data-y="${e.at[1]}" style="cursor:pointer"` : ''}><span class="dot" style="background:${TYPE_COL[e.type] || '#888'}"></span><span class="when">${SEASONS[e.day % DAYS_PER_YEAR]}</span><span class="txt">${esc(e.text)}${e.at ? ' ' + ico('target', 'sm') : ''}</span></div>`).join('')}</div>`).join('') || '<div class="prose">Nothing of note yet.</div>'}</div>`;
    }
    const types = ['all', 'war', 'diplomacy', 'tech', 'stage', 'settlement', 'government', 'event', 'population'];
    const list = g.history.filter(e => (st.cf === 'all' || e.type === st.cf || (st.cf === 'settlement' && (e.type === 'build' || e.type === 'wonder'))) && (st.ct === 'all' || e.tribe === +st.ct || e.tribe === -1) && (e.imp >= 1 || e.tribe === g.playerId)).slice(-220).reverse();
    return tabs + `<div class="row" style="flex-wrap:wrap;gap:4px;margin:10px 0 4px">${types.map(tp => `<button class="btn xs ${st.cf === tp ? 'on' : ''}" data-act="chron-f" data-f="${tp}">${tp === 'all' ? 'All' : tp.charAt(0).toUpperCase() + tp.slice(1)}</button>`).join('')}</div>
      <div class="row" style="flex-wrap:wrap;gap:4px;margin-bottom:8px"><button class="btn xs ${st.ct === 'all' ? 'on' : ''}" data-act="chron-t" data-t="all">Every people</button>${g.tribes.map(t => `<button class="btn xs ${String(st.ct) === String(t.id) ? 'on' : ''}" data-act="chron-t" data-t="${t.id}"><img src="${emblemURL(t.key)}" width="16" class="pix">${t.name}</button>`).join('')}</div>
      ${list.map(e => `<div class="chron-entry imp${e.imp}" ${e.at ? `data-act="chron-go" data-x="${e.at[0]}" data-y="${e.at[1]}" style="cursor:pointer"` : ''}><span class="when">Yr ${Math.floor(e.day / DAYS_PER_YEAR) + 1} · ${SEASONS[e.day % DAYS_PER_YEAR]}</span><span class="dot" style="background:${TYPE_COL[e.type] || '#888'}"></span><span class="txt">${esc(e.text)}</span></div>`).join('') || '<div class="prose">Nothing recorded yet.</div>'}`;
  },
  mount(hud, body) {
    const g = hud.game, st = hud.panelState;
    if (st.cv !== 'stats') return;
    const shown = g.hardIntel ? [g.player] : g.tribes;
    const tl = g.player.stats.timeline;
    lineChart(body.querySelector('#world-chart'), shown.map(t => ({ data: t.stats.timeline.map(p => p[st.cs] ?? 0), color: t.color, label: t.name })), tl.map(p => (p.war || 0) > 0));
  },
};
function trendsHTML(g) {
  const tl = g.player.stats.timeline; if (tl.length < 3) return '<div class="faint">Trends appear after a few seasons.</div>';
  const now = tl[tl.length - 1], ago = tl[Math.max(0, tl.length - 11)];
  const d = Math.max(1, now.d - ago.d);
  return `<div class="stat-grid">${STATS.map(([k, n, ic]) => { const a = ago[k] ?? 0, b = now[k] ?? 0, ch = b - a; return `<div class="stat"><span class="k">${ico(ic, 'sm')}${n}</span><span class="v num">${fmt(b)} <small class="${ch > 0 ? 'good' : ch < 0 ? 'bad' : 'faint'}">${ch > 0 ? '▲' : ch < 0 ? '▼' : '='} ${fmt(Math.abs(ch))} in ${dur(d)}</small></span></div>`; }).join('')}</div>`;
}

export const PANELS = { overview, build, population, economy, technology, diplomacy, government, military, chronicle };

// ================================================================= building inspector
// What a building makes (or boosts), spelled out with icons, for build cards and tooltips.
const RN = k => RESOURCES[k]?.name || k;
const JOB_PLACES = { farmer: 'farms', woodcutter: 'lumber camps', miner: 'quarries and mines', hunter: 'hunting lodges', fisher: 'fishing huts', craftsman: 'workshops', trader: 'markets', researcher: 'schools and libraries', gatherer: 'forager camps' };
export function producesLines(type) {
  const d = BUILDINGS[type], P = d.prod, out = [];
  if (P?.recipes) for (const r of P.recipes) out.push(Object.keys(r.in).length ? `${Object.entries(r.in).map(([k, v]) => `${v} ${ico(k, 'sm')}${RN(k)}`).join(' + ')} › <b>${r.amt} ${ico(r.out, 'sm')}${RN(r.out)}</b>` : `Makes <b>${r.amt} ${ico(r.out, 'sm')}${RN(r.out)}</b> from nothing but labour`);
  else if (P?.deps) out.push(`Mines ${P.deps.map(k => `${ico(DEPOSITS[DEP[k]].res, 'sm')}${RN(DEPOSITS[DEP[k]].res)}`).join(', ')} from deposits within ${P.radius} tiles`);
  else if (P?.out) out.push(`Makes <b>${ico(P.out, 'sm')}${RN(P.out)}</b>${P.alt ? ` and ${ico(P.alt, 'sm')}${RN(P.alt)}` : ''}${P.byproduct ? `, plus some ${ico(P.byproduct, 'sm')}${RN(P.byproduct)}` : ''}${P.livestock ? `, plus ${ico('fibre', 'sm')}fibre` : ''}`);
  else if (P?.research) out.push(`Makes <b>${ico('research', 'sm')}research</b>`);
  else if (P?.trade) out.push(`Sends caravans that earn <b>${ico('coins', 'sm')}coins</b> (or trade goods before Currency)`);
  if (d.boost) { const B = d.boost; const what = B.types ? B.types.map(k => BUILDINGS[k].name.toLowerCase() + 's').join(', ') : B.cats ? B.cats.map(c => c === 'production' ? 'all production buildings' : c === 'research' ? 'research buildings' : c).join(' and ') : B.jobs.map(j => JOB_PLACES[j] || j).join(' and '); out.push(`<b class="good">+${Math.round(B.pct * 100)}%</b> work speed for ${what} within ${B.radius} tiles`); }
  if (d.tribeMods) out.push(`Whole tribe: ${Object.entries(d.tribeMods).map(([k, v]) => `<b class="good">${sign(v * 100, 0)}%</b> ${modName(k).toLowerCase()}`).join(', ')}`);
  return out;
}
export function buildingTip(hud, b, inspector) {
  const g = hud.game, d = BUILDINGS[b.type], tribe = g.tribes[b.tribe], mine = b.tribe === g.playerId;
  const s = g.settlements.get(b.sid);
  const spr = spriteURL('building', b.type, tribe.key, tribe.stage, d.size);
  let info = '';
  let inside = '';
  if (b.built) {
    const m = new Map();
    for (const a of g.agents.values()) if (a.hidden && a.inB === b.id + 1) {
      const what = a.state === 'sleep' ? 'sleeping' : a.job === 'researcher' ? 'researching' : a.job === 'craftsman' ? 'crafting' : a.job === 'miner' ? 'mining' : 'working';
      const k = (a.state === 'sleep' ? 'Resident' : JOBS[a.job]?.name || 'Citizen') + ' · ' + what; m.set(k, (m.get(k) || 0) + 1);
    }
    if (m.size) inside = `<span>Inside</span><span>${[...m].map(([k, n]) => `${n} × ${k}`).join('<br>')}</span>`;
  }
  if (!b.built) info += `<span>Construction</span><span>${bar(b.progress / (d.work || 30))}</span><span>Builders</span><span>${b._builders || 0} working</span>`;
  else {
    if (d.housing) info += `<span>Residents</span><span>${b.residentCount || 0} / ${d.housing}</span>`;
    if (d.job && d.slots) info += `<span>Workers</span><span>${b.workerCount || 0} / ${d.slots} ${JOBS[d.job].plural.toLowerCase()}</span>`;
    if (b.type === 'centre') info += `<span>Settlement</span><span>${s?.pop || 0} people · ${s?.capital ? 'capital' : 'town'}</span>`;
    if (d.prod?.deps) {
      const acc = accessibleDeposits(tribe, d.prod.deps);
      const r = depositsNear(g, tribe, b.x + b.size / 2, b.y + b.size / 2, d.prod.radius, d.prod.deps);
      info += `<span>Deposits</span><span>${Object.entries(r.found).map(([k, n]) => `${ico(DEPOSITS[DEP[k]].res, 'sm')}${n}${acc.includes(k) ? '' : ico('lock', 'sm')}`).join(' ') || '<span class="bad">None in reach</span>'}</span>`;
    }
    if (b.flags & 1) info += `<span>Status</span><span class="warn">No resources within reach</span>`;
    if (b.flags & 2) info += `<span>Status</span><span class="warn">Missing input materials</span>`;
    if (b.hp < b.maxHp) info += `<span>Condition</span><span>${bar(b.hp / b.maxHp, 'red')}</span>`;
  }
  const lines = producesLines(b.type);
  if (lines.length) info += `<span>${d.boost || d.tribeMods ? 'Boosts' : 'Makes'}</span><span>${lines.join('<br>')}</span>`;
  if (b.built && d.job && boostAt(g, b) > 0) info += `<span>Boosted</span><span class="good">+${Math.round(b._boost * 100)}% by ${(b._boostBy || []).map(k => BUILDINGS[k].name).join(', ')}</span>`;
  const effect = d.effect ? Object.entries(d.effect).map(([k, v]) => `${modName(k)} ${sign(Math.abs(v) < 2 ? v * 100 : v, 0)}${Math.abs(v) < 2 ? '%' : ''}`).join(', ') : '';
  let ctl = '';
  if (mine && b.built && inspector !== null) {
    if (d.prod?.deps) { const acc = accessibleDeposits(tribe, d.prod.deps); ctl += `<div class="row" style="flex-wrap:wrap;gap:3px;margin-top:6px"><span class="caps" style="color:var(--gold)">Focus</span><button class="btn xs ${!b.focus ? 'on' : ''}" data-act="b-focus" data-id="${b.id}" data-k="">Auto</button>${acc.map(k => `<button class="btn xs ${b.focus === k ? 'on' : ''}" data-act="b-focus" data-id="${b.id}" data-k="${k}">${ico(DEPOSITS[DEP[k]].res, 'sm')}</button>`).join('')}</div>`; }
    if (d.prod?.recipes) ctl += `<div class="row" style="flex-wrap:wrap;gap:3px;margin-top:6px"><span class="caps" style="color:var(--gold)">Recipe</span><button class="btn xs ${b.recipe < 0 ? 'on' : ''}" data-act="b-recipe" data-id="${b.id}" data-r="-1">Auto</button>${d.prod.recipes.map((r, i) => `<button class="btn xs ${b.recipe === i ? 'on' : ''}" data-act="b-recipe" data-id="${b.id}" data-r="${i}" data-tip="${esc(Object.entries(r.in).map(([k, v]) => v + ' ' + RESOURCES[k].name).join(' + ') + ' › ' + r.amt + ' ' + RESOURCES[r.out].name)}">${Object.keys(r.in).map(k => ico(k, 'sm')).join('')}›${ico(r.out, 'sm')}</button>`).join('')}</div>`;
    const up = upgradeTarget(tribe, b);
    ctl += `<div class="row" style="margin-top:8px;gap:4px">${up ? `<button class="btn xs" data-act="b-upgrade" data-id="${b.id}" data-tip="${esc('Upgrade to ' + BUILDINGS[up].name + ': ' + Object.entries(buildingCost(tribe, up)).map(([k, v]) => v + ' ' + RESOURCES[k].name).join(', '))}">${ico('plus', 'sm')} Upgrade</button>` : ''}${b.type !== 'centre' ? `<button class="btn xs danger" data-act="b-demolish" data-id="${b.id}">${ico('close', 'sm')} Demolish</button>` : ''}</div>`;
  }
  return `<div class="insp-head"><div class="portrait" style="width:64px"><img src="${spr}" style="width:${Math.min(60, d.size * 16)}px"></div><div style="flex:1"><div class="insp-name">${d.name}</div><div class="dim" style="font-size:0.85em">${tribe.def.adjective} · ${esc(s?.name || '')}${b.built ? '' : ' · under construction'}</div><div class="faint" style="font-size:0.8em;font-family:var(--font-prose)">${esc(d.desc)}</div></div>${inspector ? `<span class="close-x" data-act="insp-close">${ico('close', 'sm')}</span>` : ''}</div>
    <div class="kv">${info}${inside}${effect ? `<span>Effects</span><span>${effect}</span>` : ''}</div>${ctl}`;
}

// ================================================================= ACTIONS
async function chooseResource(t, title, label) {
  const keys = RES_KEYS.filter(k => (t.stock[k] || 0) >= 5 && k !== 'livestock');
  return modal(`<div class="modal-head">${ico('gift', 'lg')}<div class="panel-title" style="font-size:1.8em">${title}</div></div><div class="prose">${label}</div>
    <div class="res-table" style="margin-top:10px">${keys.map(k => `<button class="res-cell btn sm" data-k="${k}" style="border-width:6px">${ico(k)}<span class="nm">${RESOURCES[k].name}</span><span class="amt">${fmt(t.stock[k])}</span></button>`).join('')}</div>
    <div class="field" style="margin-top:10px"><label>Amount</label><input type="range" class="slider" min="5" max="100" step="5" value="25" id="amt"><span id="amtv" class="num">25</span></div>
    <div class="modal-actions"><button class="btn" data-x="0">Cancel</button></div>`,
  { onMount: m => { const a = m.querySelector('#amt'); a.oninput = () => m.querySelector('#amtv').textContent = a.value; m.querySelectorAll('[data-k]').forEach(b => b.onclick = () => closeModal({ res: b.dataset.k, amt: Math.min(+a.value, Math.floor(t.stock[b.dataset.k])) })); m.querySelector('[data-x]').onclick = () => closeModal(null); } });
}

// Trade deal: what you give and receive, quantities, one-off or ongoing,
// delivery time and risk, with their likely answer and a fair counter.
async function exchangeDialog(g, t, o) {
  const pool = RES_KEYS.filter(k => k !== 'livestock');
  const opts = pool.map(k => `<option value="${k}">${RESOURCES[k].name}</option>`).join('');
  const r = route(g, t.id, o.id, 'envoy');
  return modal(`<div class="modal-head">${ico('exchange', 'lg')}<div><div class="caps" style="color:var(--gold)">${esc(o.name)}</div><div class="panel-title" style="font-size:1.8em">Propose a trade deal</div></div></div>
    <div class="deal-grid"><div class="deal-side"><div class="caps">You give</div><select class="text-input" id="gr">${opts}</select><input class="text-input" id="ga" type="number" min="1" value="20"><div class="faint" id="gh"></div></div>
    <div class="deal-arrow">${ico('exchange')}</div>
    <div class="deal-side"><div class="caps">You receive</div><select class="text-input" id="rr">${opts}</select><input class="text-input" id="ra" type="number" min="1" value="10"><div class="faint" id="rh"></div></div></div>
    <div class="seg" style="margin-top:8px" id="kind"><button class="btn sm on" data-kind="once">One-off exchange</button><button class="btn sm" data-kind="contract">Ongoing contract</button></div>
    <div class="row" id="terms" style="gap:6px;margin-top:6px;display:none"><span class="faint">Every 15 months, for</span>${[3, 6, 10].map(n => `<button class="btn xs ${n === 6 ? 'on' : ''}" data-times="${n}">${n} deliveries</button>`).join('')}</div>
    <div class="kvbox" id="sum"></div>
    <div class="prose" id="ev" style="margin-top:8px"></div>
    <div class="modal-actions"><button class="btn" data-x="0">Cancel</button><button class="btn" data-x="fair" style="display:none">Use their terms</button><button class="btn primary" data-x="1">Propose</button></div>`,
  { onMount: m => {
    const gr = m.querySelector('#gr'), ga = m.querySelector('#ga'), rr = m.querySelector('#rr'), ra = m.querySelector('#ra');
    let kind = 'once', times = 6, counter = null;
    const best = Object.entries(t.stock).filter(([k]) => RESOURCES[k] && k !== 'coins').sort((a, b) => b[1] - a[1])[0]; if (best) gr.value = best[0];
    const want = RES_KEYS.filter(k => (o.stock[k] || 0) > 30 && k !== gr.value).sort((a, b) => scarcity(t, b) - scarcity(t, a))[0]; if (want) rr.value = want;
    const deal = () => kind === 'once' ? { type: 'exchange', give: { [gr.value]: +ga.value }, get: { [rr.value]: +ra.value } } : { type: 'contract', give: { [gr.value]: +ga.value }, get: { [rr.value]: +ra.value }, every: 5, times };
    const upd = () => {
      m.querySelector('#gh').textContent = `You have ${fmt(t.stock[gr.value] || 0)}`;
      const know = !g.hardIntel || intel(g, t.id, o.id, 'economy').lv >= 2;
      m.querySelector('#rh').textContent = know ? `They have ${(o.stock[rr.value] || 0) > 200 ? 'plenty' : (o.stock[rr.value] || 0) > 40 ? 'some' : 'little'}` : 'Their stores are unknown';
      m.querySelector('#terms').style.display = kind === 'contract' ? 'flex' : 'none';
      const p = deal(); const ev = g.dip.evaluate(t.id, o.id, p);
      counter = ev.accept ? null : counterOffer(g.dip, t.id, o.id, p);
      const days = !g.tutorial && r ? r.days : 0;
      m.querySelector('#sum').innerHTML = `<div class="tt-row"><span>You give</span><span>${fmt(+ga.value)} ${RESOURCES[gr.value].name}${kind === 'contract' ? ` × ${times}` : ''}</span></div>
        <div class="tt-row"><span>You receive</span><span>${fmt(+ra.value)} ${RESOURCES[rr.value].name}${kind === 'contract' ? ` × ${times}` : ''}</span></div>
        <div class="tt-row"><span>Delivery</span><span>${kind === 'contract' ? `every 15 months for ${dur(5 * times)}` : days ? `${dur(days, true)} (the envoy carries the goods)` : 'immediate'}</span></div>
        <div class="tt-row"><span>Risk</span><span class="${(r?.risk || 0) >= 0.2 ? 'bad' : (r?.risk || 0) >= 0.08 ? 'warn' : 'good'}">${g.fog || kind === 'contract' ? (r?.label || 'Low') : 'None'}</span></div>
        <div class="faint" style="font-size:0.82em">${kind === 'contract' ? 'Ongoing. Deliveries can be raided on dangerous roads. If either side cannot deliver, the contract breaks and the defaulter loses reputation; cancelling early also costs reputation.' : g.fog ? 'Temporary. If the envoy is lost, so are the goods.' : 'Temporary: a single exchange.'}</div>`;
      m.querySelector('#ev').innerHTML = `<span class="${ev.accept ? 'good' : 'bad'}">${ev.accept ? 'They would likely accept.' : 'They would likely refuse.'}</span> <span class="faint">${ev.reasons.filter(x => x.label).map(x => esc(x.label) + ' ' + sign(x.v, 0)).join(' · ')}</span>${counter ? `<div class="warn" style="font-size:0.9em;margin-top:4px">They might accept: ${esc(dealText(counter))}</div>` : ''}`;
      m.querySelector('[data-x="fair"]').style.display = counter ? '' : 'none';
    };
    [gr, ga, rr, ra].forEach(x => x.oninput = upd);
    m.onclick = e => {
      const k = e.target.closest('[data-kind]'); if (k) { kind = k.dataset.kind; m.querySelectorAll('[data-kind]').forEach(b => b.classList.toggle('on', b === k)); upd(); }
      const tm = e.target.closest('[data-times]'); if (tm) { times = +tm.dataset.times; m.querySelectorAll('[data-times]').forEach(b => b.classList.toggle('on', b === tm)); upd(); }
      const x = e.target.closest('[data-x]'); if (!x) return;
      if (x.dataset.x === '0') closeModal(null);
      else if (x.dataset.x === 'fair' && counter) { const [gk, gv] = Object.entries(counter.give)[0], [rk, rv] = Object.entries(counter.get)[0]; gr.value = gk; ga.value = gv; rr.value = rk; ra.value = rv; upd(); }
      else if (x.dataset.x === '1') closeModal(deal());
    };
    upd();
  } });
}

async function peaceDialog(g, t, o) {
  return modal(`<div class="modal-head">${ico('peace', 'lg')}<div class="panel-title" style="font-size:1.8em">Terms of peace</div></div><div class="prose">What terms will you offer the ${o.name}?</div>
    <div class="col" style="margin-top:10px">${[['white', 'White peace', 'Both sides withdraw. No tribute.'], ['tribute_a', 'Offer tribute', 'You pay tribute for two and a half years.'], ['tribute_b', 'Demand tribute', 'They pay you tribute for two and a half years.']].map(([k, n, d]) => { const ev = g.dip.evaluate(t.id, o.id, { type: 'peace', terms: k }); return `<button class="btn choice" data-k="${k}"><span>${n} <span class="${ev.accept ? 'good' : 'bad'}" style="font-size:0.8em">${ev.accept ? '· likely accepted' : '· likely refused'}</span></span><small>${d}</small></button>`; }).join('')}</div>
    <div class="modal-actions"><button class="btn" data-x>Cancel</button></div>`,
  { onMount: m => { m.querySelectorAll('[data-k]').forEach(b => b.onclick = () => closeModal(b.dataset.k)); m.querySelector('[data-x]').onclick = () => closeModal(null); } });
}

const ourProp = p => ({ trade: 'a Trade Agreement', nap: 'a Non-Aggression Pact', alliance: 'a Military Alliance', access: 'Border Access', exclusive: 'Trade Exclusivity', peace: p.terms === 'tribute_a' ? 'peace, with you paying tribute' : p.terms === 'tribute_b' ? 'peace, with them paying tribute' : 'a white peace', gift: `a gift of ${p.amt} ${RESOURCES[p.res]?.name || ''}`, exchange: 'an exchange of goods', tribute: 'that they pay you tribute', offerTribute: 'to pay them tribute' })[p.type] || p.type;
function tradeSection(g, t) {
  const D = g.dip, P = t.id;
  const contracts = D.treaties.filter(x => x.type === 'contract' && (x.a === P || x.b === P));
  const emb = (D.embargo?.[P] || []).map(i => g.tribes[i].name);
  const log = (D.tradeLog || []).filter(e => e.a === P || e.b === P).slice(-10).reverse();
  const other = e => g.tribes[e.a === P ? e.b : e.a].name;
  const LBL = { trade: 'Trade Agreement signed', exclusive: 'Exclusivity signed', 'trade-end': 'Trade Agreement ended', 'exclusive-end': 'Exclusivity ended', contract: 'Contract agreed', 'contract-end': 'Contract ended', raid: 'Caravan raided', embargo: 'Embargo placed', 'embargo-lifted': 'Embargo lifted' };
  const trips = Object.entries(D.tradeStats || {}).filter(([k]) => k.startsWith(P + ':')).map(([k, v]) => `${g.tribes[+k.split(':')[1]].name}: ${v}`).join(' · ');
  return `<div class="section-title">Trade policy</div>
    <div class="row between" style="gap:8px;flex-wrap:wrap"><span data-tip="Your caravans earn more, but partners resent high tariffs and are less willing to sign new agreements.">${ico('coins', 'sm')} Tariff on your caravans</span><div class="seg">${TARIFFS.map(r => `<button class="btn xs ${(t.tariffRate || 0) === r ? 'on' : ''}" data-act="tariff" data-r="${r}">${Math.round(r * 100)}%</button>`).join('')}</div></div>
    ${emb.length ? `<div class="faint" style="font-size:0.85em;margin-top:4px">${ico('lock', 'sm')} Embargo on: ${esc(emb.join(', '))}</div>` : ''}
    ${contracts.length ? `<div class="section-title">Supply contracts</div>${contracts.map(c => { const mine = c.a === P; const p = mine ? c : { give: c.get, get: c.give }; return `<div class="contract"><div><b>${esc(other(c))}</b> · ${esc(dealText({ type: 'contract', give: p.give, get: p.get, every: c.every, times: c.left }))}<div class="faint" style="font-size:0.8em">Next delivery in ${dur(Math.max(0, (c.next - g.tick) / 360), true)} · ${c.left} left</div></div><button class="btn xs" data-act="end-contract" data-id="${c.id}">Cancel</button></div>`; }).join('')}` : ''}
    <div class="section-title">Trade history</div>
    ${trips ? `<div class="faint" style="font-size:0.82em">Caravans completed — ${esc(trips)}${t.stats.raided ? ` · raided: ${t.stats.raided}` : ''}</div>` : ''}
    ${log.length ? `<div class="inbox">${log.map(e => `<div class="dispatch"><span class="d-when">${agoText(g.day - e.day)}</span><span>${esc(LBL[e.kind] || e.kind)} · ${esc(other(e))}${e.by != null && e.kind.endsWith('end') ? ` · by ${e.by === P ? 'you' : 'them'}${e.why ? ` (${esc(e.why)})` : ''}` : ''}${e.give ? ` · ${esc(dealText({ type: e.every ? 'contract' : 'exchange', give: e.a === P ? e.give : e.get, get: e.a === P ? e.get : e.give, every: e.every, times: e.times }))}` : ''}</span></div>`).join('')}</div>` : '<div class="faint" style="font-size:0.85em">No deals recorded yet.</div>'}`;
}
// Campaign planning: the estimate the player sees before committing an army.
function campaignPlanner(hud, sid) {
  const g = hud.game, t = g.player;
  let frac = hud.panelState.commit || 0.75;
  const tgtS = g.settlements.get(sid);
  const plan = hud.panelState.plan ? JSON.parse(JSON.stringify(hud.panelState.plan)) : autoPlan(t, tgtS, g);
  for (const u of Object.keys(plan.mix)) if (!unitOk(t, u)) delete plan.mix[u];
  if (!unitOk(t, 'treb')) plan.siege = 0; if (!unitOk(t, 'sapper')) plan.sappers = 0;
  const seg = (key, defs, ok = () => true) => `<div class="seg wrap" style="margin:2px 0 6px;flex-wrap:wrap">${Object.entries(defs).filter(([k]) => ok(k)).map(([k, d]) => `<button class="btn xs ${plan[key] === k ? 'on' : ''}" data-pk="${key}" data-pv="${k}" data-tip="${esc(d.desc)}">${esc(d.name)}</button>`).join('')}</div>`;
  const planBox = () => {
    const units = LINE_UNITS.filter(u => unitOk(t, u));
    const tot = units.reduce((x, u) => x + (plan.mix[u] || 0), 0) || 1;
    const stepper = (label, tip, val, key, extra = '') => `<div class="row between" style="padding:2px 0" data-tip="${esc(tip)}"><span>${label}${extra}</span><span class="row" style="gap:4px"><button class="btn xs icon" data-pm="${key}" data-d="-1">${ico('minus', 'sm')}</button><span class="num" style="min-width:34px;text-align:center">${val}</span><button class="btn xs icon" data-pm="${key}" data-d="1">${ico('plus', 'sm')}</button></span></div>`;
    const arm = ARMOURS[armourOf(t)];
    return `<div class="section-title">Order of battle</div>
      <div class="kvbox">${units.map(u => stepper(UNITS[u].name, UNITS[u].desc, Math.round((plan.mix[u] || 0) / tot * 100) + '%', 'mix:' + u)).join('')}
      ${unitOk(t, 'treb') ? stepper(UNITS.treb.name, UNITS.treb.desc + ' Each costs 25 wood and takes one soldier as crew.', plan.siege, 'siege', ` <span class="faint">(${plan.siege * 25} wood)</span>`) : ''}
      ${unitOk(t, 'sapper') ? stepper(UNITS.sapper.name, UNITS.sapper.desc + ' Each costs 3 coal and 2 salt.', plan.sappers, 'sappers', ` <span class="faint">(${plan.sappers * 3} coal, ${plan.sappers * 2} salt)</span>`) : ''}
      <div class="faint" style="font-size:0.8em;margin-top:2px">Armour: ${esc(arm.name)} · ${esc(arm.desc)}</div></div>
      <div class="caps dim" style="margin-top:6px">Angle of attack</div>${seg('approach', APPROACHES)}
      <div class="caps dim">Point of focus</div>${seg('focus', FOCUS)}
      <div class="caps dim">Who goes first</div>${seg('lead', LEADS, k => k === 'together' || (k === 'siege' ? plan.siege + plan.sappers > 0 : unitOk(t, k) && (plan.mix[k] || 0) > 0))}`;
  };
  const range = (a, b) => a === b ? `${a}` : `${a}–${b}`;
  const pct = v => Math.round(v * 100) + '%';
  const body = () => {
    const e = estimateCampaign(g, t, sid, frac, intel); if (!e) return '<div class="prose">No route.</div>';
    const cls = e.verdict === 'Favourable' ? 'good' : e.verdict === 'Risky' ? 'warn' : 'bad';
    const unsure = e.known < 3 ? `<div class="faint" style="font-size:0.82em">${ico('eye', 'sm')} Your knowledge of their army is ${['none', 'rumour', 'a report', 'verified'][e.known]}; estimates are uncertain. Scouting narrows them.</div>` : '';
    return `<div class="seg" style="margin:4px 0 8px">${[0.5, 0.75, 1].map(f => `<button class="btn sm ${frac === f ? 'on' : ''}" data-f="${f}">${f * 100}% of idle soldiers</button>`).join('')}</div>
      <div class="kvbox plan">
        <div class="tt-row"><span>${ico('soldier', 'sm')} Army</span><span>${e.n} soldiers from ${esc(e.home)}</span></div>
        <div class="tt-row"><span>${ico('flag', 'sm')} Distance</span><span>${e.dist} tiles · ${dur(e.days, true)} each way</span></div>
        <div class="tt-row"><span>${ico('target', 'sm')} Terrain</span><span>${e.terrain.label}${e.terrain.mountain > 0.05 ? ` · ${pct(e.terrain.mountain)} hills/mountains` : ''}${e.terrain.harsh > 0.05 ? ` · ${pct(e.terrain.harsh)} harsh` : ''}${e.terrain.water > 0.1 ? ' · detours around water' : ''}${e.terrain.road > 0.1 ? ` · ${pct(e.terrain.road)} road` : ''}</span></div>
        <div class="tt-row"><span>${ico('food', 'sm')} Food to carry</span><span class="${e.food > e.foodHave * 0.5 ? 'bad' : ''}">${e.food} of your ${e.foodHave} (${e.foodRate}/soldier/season)</span></div>
        <div class="tt-row"><span>${ico('wood', 'sm')} Upkeep</span><span>${e.upkeep.wood} wood${e.upkeep.coins ? `, ${e.upkeep.coins} coins` : ''} over ${dur(e.totalDays, true)}</span></div>
        <div class="tt-row"><span>${ico('house', 'sm')} Supply</span><span>${pct(e.friendlyFrac)} of the road on friendly or allied land · at the target: ${pct(e.supply.target)} (${esc(e.supply.why)})</span></div>
        ${e.crossing.length ? `<div class="tt-row"><span>${ico('warning', 'sm')} Crosses</span><span>${e.crossing.map(o => esc(g.tribes[o].name)).join(', ')} lands${e.hostileCross ? ' (at war!)' : ' — Border Access would help'}</span></div>` : ''}
        <div class="tt-row"><span>${ico('skull', 'sm')} Sickness &amp; exposure</span><span>${range(...e.natural)} soldiers</span></div>
        <div class="tt-row"><span>${ico('military', 'sm')} Expected losses</span><span>${range(...e.losses)} of ${e.n}</span></div>
        <div class="tt-row"><span>${ico('eye', 'sm')} Interception / ambush</span><span class="${e.ambush > 0.3 ? 'bad' : e.ambush > 0.15 ? 'warn' : ''}">${pct(e.ambush)}</span></div>
      </div>${unsure}
      <div style="margin-top:8px">Assessment: <b class="${cls}">${esc(e.verdict)}</b></div>${planBox()}`;
  };
  return modal(`<div class="modal-head">${ico('military', 'xl')}<div><div class="caps" style="color:var(--gold)">Campaign plan</div><div class="panel-title">${esc(g.settlements.get(sid)?.name || '')}</div></div></div>
    <div class="plan-body">${body()}</div>
    <div class="prose faint" style="font-size:0.82em">The army carries its food from your stores; anything left comes back. Armies far from friendly land lose supply, and sickness and exposure take a few soldiers each season, more in mountains, harsh land, winter and on long marches.</div>
    <div class="modal-actions"><button class="btn" data-x="0">Cancel</button><button class="btn primary" data-x="1">${ico('target', 'sm')} March</button></div>`,
  { wide: true, onMount: m => {
    m.onclick = e => {
      const f = e.target.closest('[data-f]'); if (f) { frac = +f.dataset.f; hud.panelState.commit = frac; m.querySelector('.plan-body').innerHTML = body(); return; }
      const pk = e.target.closest('[data-pk]'); if (pk) { plan[pk.dataset.pk] = pk.dataset.pv; hud.panelState.plan = plan; m.querySelector('.plan-body').innerHTML = body(); return; }
      const pm = e.target.closest('[data-pm]'); if (pm) {
        const d = +pm.dataset.d, k = pm.dataset.pm;
        if (k.startsWith('mix:')) { const u = k.slice(4); plan.mix[u] = Math.max(0, Math.min(6, (plan.mix[u] || 0) + d)); if (!Object.values(plan.mix).some(v => v > 0)) plan.mix[u] = 1; }
        else plan[k] = Math.max(0, Math.min(6, (plan[k] || 0) + d));
        if (plan.lead === 'siege' && !(plan.siege + plan.sappers)) plan.lead = 'together';
        if (LINE_UNITS.includes(plan.lead) && !(plan.mix[plan.lead] > 0)) plan.lead = 'together';
        hud.panelState.plan = plan; m.querySelector('.plan-body').innerHTML = body(); return;
      }
      const x = e.target.closest('[data-x]'); if (!x) return;
      if (x.dataset.x === '1') { const est = estimateCampaign(g, t, sid, frac, intel); closeModal({ frac, food: est?.food, plan }); } else closeModal(null);
    };
  } });
}
function reportProposal(g, o, res, what) {
  if (res.accept) { sfx('diplomacy'); toast(`The ${o.name} accept`, what, { kind: 'good', icon: 'diplomacy' }); }
  else { sfx('error'); toast(`The ${o.name} refuse`, res.reasons.filter(r => r.label).sort((a, b) => a.v - b.v).slice(0, 3).map(r => `${r.label} (${sign(r.v, 0)})`).join(' · '), { kind: 'bad', icon: 'diplomacy', ms: 7000 }); }
}

// All mutations go to the simulation worker; the mirror refreshes on the
// next batch (sent immediately after every command).
const fail = (title, why, icon = 'warning') => { sfx('error'); toast(title, why || '', { kind: 'bad', icon, ms: 3000 }); };
const confirmAsync = async (...a) => (await import('./dom.js')).confirmDialog(...a);

export const ACTIONS = {
  steward: (hud, b) => { const t = hud.game.player; const v = !t.steward[b.dataset.k]; t.steward[b.dataset.k] = v; hud.sim.call('steward', b.dataset.k, v); },
  envoy: (hud, b) => { const t = hud.game.player; const cfg = { ...(t.envoy || ENVOY_DEFAULTS) }; const k = b.dataset.k; cfg[k] = b.dataset.v != null ? b.dataset.v : !cfg[k]; t.envoy = cfg; hud.sim.call('envoy', cfg); },
  'bridge-pick': hud => { hud.closePanel(); hud.startPlacing('__bridge'); },
  'scout-plan': async hud => {
    const g = hud.game, t = g.player;
    let party = hud.panelState.scoutParty || 2, food = hud.panelState.scoutFood || 24;
    const body = () => {
      const e = scoutEstimate(party, food), c = canScout(g, t, party, food);
      return `<div class="caps dim">Party size</div><div class="seg" style="margin:4px 0 8px">${[1, 2, 3, 4].map(n => `<button class="btn sm ${party === n ? 'on' : ''}" data-sp="${n}">${n}</button>`).join('')}</div>
        <div class="caps dim">Food rations</div><div class="row" style="gap:6px;margin:4px 0 8px"><button class="btn xs" data-sf="-10">−10</button><button class="btn xs" data-sf="-2">−2</button><span class="num" style="min-width:60px;text-align:center">${ico('food', 'sm')} ${food}</span><button class="btn xs" data-sf="2">+2</button><button class="btn xs" data-sf="10">+10</button><span class="faint" style="font-size:0.8em">of ${Math.round(foodTotal(t))} in store</span></div>
        <div class="kvbox plan">
          <div class="tt-row"><span>Strip charted</span><span>about ${e.width} tiles wide</span></div>
          <div class="tt-row"><span>How far</span><span>about ${e.reach} tiles out, then back the same way</span></div>
          <div class="tt-row"><span>Time away</span><span>${dur(e.days, true)} (${party * RATION} food a season)</span></div>
          <div class="tt-row"><span>Danger</span><span class="${e.risk > 0.3 ? 'bad' : e.risk > 0.15 ? 'warn' : ''}">about ${Math.round(e.risk * 100)}% that someone does not return; more in deserts, snow, mountains, winter and enemy lands</span></div>
        </div>
        <div class="faint" style="font-size:0.82em;margin-top:6px">Scouts stop working while they are away. ${maxParties(t) > 1 ? 'Two parties' : 'One party'} may be out at a time. Unused food comes back with them.</div>
        ${c.ok ? '' : `<div class="bad" style="margin-top:6px">${esc(c.why)}</div>`}`;
    };
    const plan = await modal(`<div class="modal-head">${ico('eye', 'xl')}<div><div class="caps" style="color:var(--gold)">Expedition</div><div class="panel-title">Scouting party</div></div></div><div class="scout-body">${body()}</div>
      <div class="modal-actions"><button class="btn" data-x="0">Cancel</button><button class="btn primary" data-x="1">${ico('flag', 'sm')} Choose direction</button></div>`,
    { onMount: m => { m.onclick = e => {
      const sp = e.target.closest('[data-sp]'); if (sp) { party = +sp.dataset.sp; }
      const sf = e.target.closest('[data-sf]'); if (sf) food = Math.max(FOOD_MIN, Math.min(FOOD_MAX, food + +sf.dataset.sf));
      if (sp || sf) { hud.panelState.scoutParty = party; hud.panelState.scoutFood = food; m.querySelector('.scout-body').innerHTML = body(); return; }
      const x = e.target.closest('[data-x]'); if (!x) return;
      if (x.dataset.x === '1') { const c = canScout(g, t, party, food); if (!c.ok) { sfx('error'); toast('Cannot send scouts', c.why, { kind: 'bad', icon: 'warning' }); return; } closeModal({ party, food }); } else closeModal(null);
    }; } });
    if (!plan) return;
    hud.scoutPlan = plan; hud.closePanel(); hud.startPlacing('__scout');
  },
  'scout-recall': (hud, b) => { hud.sim.call('recallScouts', +b.dataset.id); toast('Scouts recalled', 'They will turn for home.', { icon: 'eye', ms: 2500 }); },
  'scout-view': (hud, b) => hud.renderer.flyTo(+b.dataset.x, +b.dataset.y, 2.5),
  'expand-pick': hud => { hud.closePanel(); hud.startPlacing('__expand'); },
  'expand-clear': hud => { hud.sim.call('expandTo', null); toast('Expansion direction cleared', '', { icon: 'flag', ms: 2500 }); },
  found: hud => { const c = canFound(hud.game, hud.game.player); if (!c.ok) { toast('Cannot found a settlement', c.why, { kind: 'bad', icon: 'warning' }); return; } hud.closePanel(); hud.startPlacing('__settle'); },
  bcat: (hud, b) => { hud.panelState.bcat = b.dataset.cat; },
  build: (hud, b) => { hud.startPlacing(b.dataset.type); },
  'work-prio': (hud, b) => { hud.game.player.workPriority = b.dataset.k || null; hud.sim.call('workPriority', b.dataset.k || null); },
  alloc: (hud, b, e) => { let d = +b.dataset.d; if (e.shiftKey) d *= 5; hud.game.player.steward.work = false; hud.sim.call('alloc', b.dataset.job, d); },
  research: async (hud, b) => {
    const t = hud.game.player; const k = b.dataset.key;
    // touch has no hover: show the details first, with a button to commit
    if (hud.app.touch) {
      const st = techState(t, k);
      const go = await modal(`${techTip(hud, k)}<div class="modal-actions"><button class="btn" data-v="0">Close</button>${st !== 'done' ? `<button class="btn primary" data-v="1">${ico('research', 'sm')} Research</button>` : ''}</div>`, { onMount: m => m.querySelectorAll('[data-v]').forEach(x => x.onclick = () => closeModal(x.dataset.v === '1')) });
      if (!go) return;
    }
    if (t.techs.includes(k)) return;
    if (!(await hud.sim.call('research', k))) fail('Cannot research yet', techState(t, k) === 'stage' ? 'Your civilisation must advance to a later stage.' : 'Prerequisites are missing.', 'lock');
  },
  'prop-yes': async (hud, b) => { const g = hud.game; const p = g.pendingProposals[+b.dataset.i]; if (!p) return; if (await hud.sim.call('answerProposal', p.from, p.tick, p.p.type, true)) toast(`Agreement with the ${g.tribes[p.from].name}`, proposalText(p.p), { icon: 'diplomacy', kind: 'good' }); },
  'prop-no': (hud, b) => { const p = hud.game.pendingProposals[+b.dataset.i]; if (p) hud.sim.call('answerProposal', p.from, p.tick, p.p.type, false); },
  dip: async (hud, b) => {
    const g = hud.game, t = g.player, o = g.tribes[+b.dataset.to]; const type = b.dataset.type;
    let p = { type };
    if (type === 'gift') { const r = await chooseResource(t, `A gift for the ${o.name}`, 'Choose a resource to send.'); if (!r) return; p = { type, ...r }; }
    if (type === 'exchange') { const r = await exchangeDialog(g, t, o); if (!r) return; p = r; }
    if (type === 'peace') { const r = await peaceDialog(g, t, o); if (!r) return; p = { type, terms: r }; }
    if (!g.tutorial && !(await confirmJourney(g, o.id, 'envoy', `<div class="prose" style="font-size:0.9em;margin-top:4px">Proposal: <em>${esc(ourProp(p))}</em>. Their answer comes when the envoy arrives.${p.type === 'gift' || p.type === 'exchange' ? ' <span class="warn">Goods travel with the envoy and are lost if the envoy is.</span>' : ''}</div>`))) return;
    const res = await hud.sim.call('propose', o.id, p);
    if (res.sent) { if (res.ok) { sfx('diplomacy'); toast('Envoy dispatched', `To the ${o.name}: ${dur(res.days, true)} on the road, ${String(res.risk).toLowerCase()} risk. You will hear when they arrive.`, { icon: 'scroll' }); } else fail('Cannot send an envoy', res.why, 'scroll'); return; }
    if (!res.accept && res.counter) { const yes = await confirmAsync(`The ${o.name} make a counteroffer`, `They refused, but would agree to: <em>${esc(dealText(res.counter))}</em>.`, 'Accept their terms'); if (yes) { const r2 = await hud.sim.call('propose', o.id, res.counter); reportProposal(g, o, r2, 'The deal is agreed.'); } return; }
    reportProposal(g, o, res, { trade: 'A trade agreement is signed.', nap: 'A non-aggression pact is signed.', alliance: 'You are now allies.', access: 'Your borders are open to each other.', exclusive: 'You now trade only with each other.', offerTribute: 'They accept your tribute.', peace: 'The war is over.', gift: 'Your gift is received warmly.', exchange: 'The exchange is complete.', tribute: 'They will pay tribute.' }[type]);
  },
  'intel-send': async (hud, b) => {
    const g = hud.game, to = +b.dataset.to, k = b.dataset.k;
    if (!(await confirmJourney(g, to, k))) return;
    const r = await hud.sim.call('mission', to, k);
    if (r.ok) { sfx('click'); toast('Mission dispatched', `${dur(r.days, true)} to reach the ${g.tribes[to].name}; ${String(r.risk).toLowerCase()} risk.`, { icon: 'eye' }); } else fail('Cannot send', r.why, 'eye');
  },
  counter: async (hud, b) => { const r = await hud.sim.call('counterIntel', +b.dataset.n); if (!r.ok) fail('Counter-intelligence', r.why, 'target'); },
  embargo: (hud, b) => { const to = +b.dataset.to; hud.sim.call('embargo', to, !hud.game.dip.embargo?.[hud.game.playerId]?.includes(to)); },
  tariff: (hud, b) => { hud.sim.call('tariff', +b.dataset.r); },
  'end-contract': async (hud, b) => { if (await confirmAsync('Cancel the contract?', 'Ending a supply contract early costs reputation and angers your partner.', 'Cancel contract', true)) hud.sim.call('endContract', +b.dataset.id); },
  'dip-cancel': (hud, b) => { hud.sim.call('cancelTreaty', +b.dataset.to, b.dataset.treaty); },
  'dip-war': async (hud, b) => {
    const g = hud.game, o = g.tribes[+b.dataset.to];
    const breaking = ['nap', 'alliance'].filter(x => g.dip.has(x, g.playerId, o.id));
    const allies = g.dip.allies(o.id).filter(x => x !== g.playerId).map(x => g.tribes[x].name);
    const ok = await confirmAsync(`Declare war on the ${o.name}?`, `${breaking.length ? `<span class="bad">This breaks your ${breaking.map(x => TREATY_NAMES[x]).join(' and ')} and will damage your reputation with every people.</span><br><br>` : ''}${allies.length ? `Their allies (${allies.join(', ')}) may join the war. ` : ''}Unprovoked aggression lowers your standing with other peoples, and your people will grow weary of fighting.`, 'Declare war', true);
    if (ok) hud.sim.call('declareWar', o.id);
  },
  law: async (hud, b) => { const r = await hud.sim.call('enactLaw', b.dataset.law, b.dataset.opt); if (!r.ok) fail('Cannot enact', r.why, 'scales'); },
  gov: async (hud, b) => {
    const g = hud.game; const c = canAdoptGov(g, g.player, b.dataset.k); if (!c.ok) { toast('Reform impossible', c.why, { kind: 'bad', icon: 'crown' }); return; }
    if (await confirmAsync(`Reform into a ${GOVERNMENTS[b.dataset.k].name}?`, 'Reforms shake the realm: stability will fall for a while, and some laws may lapse.', 'Reform')) hud.sim.call('adoptGov', b.dataset.k);
  },
  campaign: async (hud, b) => {
    const g = hud.game, sid = +b.dataset.sid;
    const plan = await campaignPlanner(hud, sid); if (!plan) return;
    const r = await hud.sim.call('campaign', sid, plan.frac, plan.food, plan.plan);
    if (!r.ok) fail('Cannot attack', r.why, 'military'); else { const s = g.settlements.get(sid); if (s) hud.renderer.flyTo(s.x, s.y, 2.5); }
  },
  commit: (hud, b) => { hud.panelState.commit = +b.dataset.f; },
  armour: async (hud, b) => { await hud.sim.call('setArmour', b.dataset.k); hud.renderPanel(true); },
  recall: (hud, b) => { hud.sim.call('recall', +b.dataset.id); },
  'army-view': (hud, b) => { const g = hud.game; let sx = 0, sy = 0, n = 0; for (const a of g.agents.values()) if (a.army === +b.dataset.id) { sx += a.x; sy += a.y; n++; } if (n) hud.renderer.flyTo(sx / n, sy / n, 3.5); },
  spec: async (hud, b) => { const r = await hud.sim.call('specialise', +b.dataset.sid, b.dataset.k); if (!r.ok) fail('Cannot change focus', r.why, 'house'); },
  'chron-v': (hud, b) => { hud.panelState.cv = b.dataset.v; },
  'chron-s': (hud, b) => { hud.panelState.cs = b.dataset.s; },
  'chron-go': (hud, b) => { hud.renderer.flyTo(+b.dataset.x + 0.5, +b.dataset.y + 0.5, 3); if (hud.app.touch) hud.closePanel(); },
  'chron-f': (hud, b) => { hud.panelState.cf = b.dataset.f; },
  'chron-t': (hud, b) => { hud.panelState.ct = b.dataset.t; },
  'b-focus': (hud, b) => { const bd = hud.game.buildings.get(+b.dataset.id); if (bd) bd.focus = b.dataset.k || null; hud.sim.call('bFocus', +b.dataset.id, b.dataset.k || null); },
  'b-recipe': (hud, b) => { const bd = hud.game.buildings.get(+b.dataset.id); if (bd) bd.recipe = +b.dataset.r; hud.sim.call('bRecipe', +b.dataset.id, +b.dataset.r); },
  'b-upgrade': async (hud, b) => { const r = await hud.sim.call('bUpgrade', +b.dataset.id); if (!r.ok) fail('Cannot upgrade', r.why, 'house'); },
  'b-demolish': async (hud, b) => { const bd = hud.game.buildings.get(+b.dataset.id); if (!bd) return; if (await confirmAsync(`Demolish ${BUILDINGS[bd.type].name}?`, 'Some materials will be recovered.', 'Demolish', true)) { hud.sim.call('bDemolish', bd.id); hud.select(null); } },
};
