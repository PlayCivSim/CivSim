// Diplomacy panel pieces for Hard Mode intelligence: reliability badges,
// what is known of each rival (and how old it is), missions abroad,
// counter-intelligence, reputation and the diplomatic inbox.
import { esc, sign, fmt, modal, closeModal } from './dom.js';
import { ico } from './icons.js';
import { intel, LEVELS, LEVEL_DESC, INTEL_CATS, MISSIONS, route, catchChance, repTier, COUNTER_COST } from '../sim/intel.js';
import { categoryOf, involves } from '../sim/records.js';
import { STAGES } from '../sim/progress.js';
import { TECH } from '../data/techs.js';
import { DAYS_PER_YEAR } from '../core/constants.js';
import { fmtDate, dur, agoText } from '../core/calendar.js';

const LV_CLS = ['lv0', 'lv1', 'lv2', 'lv3'];
const ago = (g, day) => agoText(g.day - day);
const srcText = r => r.src && r.src !== 'open' ? ` from ${r.src}` : '';
const when = (g, r) => r.day == null ? '' : r.age > 0 ? ` · ${dur(r.age)} old` : ' · this season';

export function levelChip(g, r, label) {
  const tip = `${label}: ${LEVELS[r.lv]}${srcText(r)}${r.day != null ? `, learned ${ago(g, r.day)}` : ''}.\n${LEVEL_DESC[r.lv]}${r.exposed ? '\nThis report was exposed as false.' : ''}`;
  return `<span class="intel-chip ${LV_CLS[r.lv]} ${r.exposed ? 'exposed' : ''}" data-tip="${esc(tip)}"><i></i>${esc(label)}</span>`;
}
export function intelBadges(g, P, o) {
  if (!g.hardIntel) return '';
  return `<div class="intel-row">${Object.entries(INTEL_CATS).map(([k, n]) => levelChip(g, intel(g, P, o.id, k), n)).join('')}</div>`;
}

// One line about their people, as reliable as your intelligence allows.
export function economyLine(g, P, o) {
  const r = intel(g, P, o.id, 'economy');
  if (!g.hardIntel || r.lv === 3) { const v = g.hardIntel ? r.val : { pop: o.pop, stage: o.stage, towns: o.settlements.length }; return `${STAGES[v.stage].name} · ${v.pop} people · ${v.towns} town${v.towns === 1 ? '' : 's'}`; }
  if (r.lv === 0 || !r.val) return '<span class="faint">Little is known of their numbers.</span>';
  const v = r.val;
  if (r.lv === 1) return `<span class="faint">Rumoured: perhaps ${Math.max(5, Math.round(v.pop / 10) * 10)} people${when(g, r)}</span>`;
  return `${STAGES[v.stage].name} · about ${v.pop} people · ${v.towns} town${v.towns === 1 ? '' : 's'} <span class="faint">(reported${when(g, r)})</span>`;
}
export function strengthChip(g, P, o) {
  const me = g.tribes[P].strength + 1;
  const r = intel(g, P, o.id, 'military');
  if (r.lv === 0 || r.val == null) return `<span class="chip" data-tip="You have no reliable report on their army. Send a scout or an agent.">${ico('military', 'sm')} Strength unknown</span>`;
  const rs = me / (r.val + 1);
  const rel = rs > 1.3 ? 'Weaker than you' : rs < 0.77 ? 'Stronger than you' : 'Evenly matched';
  const txt = r.lv === 3 ? `${rel} (${Math.round(r.val)} vs ${Math.round(me - 1)})` : r.lv === 2 ? `Reportedly ${rel.toLowerCase()}` : `Rumoured ${rel.toLowerCase()}`;
  return `<span class="chip ${r.exposed ? 'red' : ''}" data-tip="${esc(`Military: ${LEVELS[r.lv]}${srcText(r)}${r.day != null ? ', ' + ago(g, r.day) : ''}. ${LEVEL_DESC[r.lv]}${r.exposed ? ' This report was exposed as a lie.' : ''}`)}">${ico('military', 'sm')} ${esc(txt)}${g.fog && r.age > 10 ? ' <small class="faint">(old)</small>' : ''}</span>`;
}
export function intentLine(g, P, o, warRiskChip) {
  if (!g.hardIntel) return null;
  const r = intel(g, P, o.id, 'intent');
  if (r.lv < 2 || !r.val) return { line: `<span class="faint">${ico('eye', 'sm')} Their plans are unknown. An envoy or agent would learn more.</span>`, risk: (g.dip.warRisk?.[o.id]?.[P] || -99) > 4 && r.lv === 1 ? '<span class="chip red" data-tip="Unconfirmed talk of hostility.">Rumours of hostility</span>' : '' };
  const v = r.val;
  return { line: `${ico('eye', 'sm')} ${esc(v.decision || 'Consolidating their lands')}${v.research && TECH[v.research] ? ` · studying ${TECH[v.research].name}` : ''} <span class="faint">(${LEVELS[r.lv].toLowerCase()}${when(g, r)})</span>`, risk: warRiskChip(v.risk) };
}

// ---------------------------------------------------------------- missions
const STATUS = {
  out: (g, m) => g.tick < m.eta ? `On the road · arrives in ${dur(Math.max(0.1, (m.eta - g.tick) / 360), true)}` : 'Arriving',
  missing: (g, m) => g.tick < m.eta ? `On the road · arrives in ${dur(Math.max(0.1, (m.eta - g.tick) / 360), true)}` : `Overdue · no word for ${dur(Math.max(0.1, (g.tick - m.eta) / 360))}`,
  back: () => 'Returning home',
  done: () => 'Returned',
  lost: () => 'Lost',
  stationed: () => 'Watching for foreign agents',
};
export function missionsSection(g) {
  const P = g.playerId;
  const ms = (g.dip.missions || []).filter(m => m.from === P && m.kind !== 'counter' && (!['done', 'lost'].includes(m.status) || g.tick - (m.ended || 0) < 360 * 6)).slice(-8).reverse();
  if (!ms.length) return '';
  return `<div class="section-title">Missions abroad</div><div class="mission-list">${ms.map(m => {
    const spec = MISSIONS[m.kind] || MISSIONS.envoy; const o = g.tribes[m.to];
    const st = STATUS[m.status]?.(g, m) || m.status;
    const prog = m.status === 'out' || m.status === 'missing' ? Math.min(1, (g.tick - m.depart) / Math.max(1, m.eta - m.depart)) : 1;
    const last = m.notes[m.notes.length - 1];
    const late = m.status === 'missing' && g.tick > m.eta;
    return `<div class="mission ${m.status === 'lost' ? 'lost' : late ? 'late' : ''}">${ico(spec.icon, 'sm')}<div class="m-main">
      <div><b>${esc(spec.name.replace('Agent: ', 'Agent · '))}</b> → ${esc(o.name)}${m.p ? ` <span class="faint">(${esc(m.p.type === 'offerTribute' ? 'offer tribute' : m.p.type)})</span>` : ''}</div>
      <div class="m-st">${esc(st)} · risk ${esc((m.riskLabel || '').toLowerCase())}</div>
      ${m.status === 'out' || m.status === 'missing' ? `<div class="m-bar"><i style="width:${(prog * 100).toFixed(0)}%"></i></div>` : ''}
      ${last ? `<div class="m-note">${esc(last.text)}</div>` : late ? '<div class="m-note">They may be delayed, or worse. Word usually comes within six months.</div>' : ''}</div></div>`;
  }).join('')}</div>`;
}

export function counterSection(g) {
  const t = g.player, n = g.dip.counter?.[t.id] || 0;
  const can = t.techs.includes('writing');
  return `<div class="frame counter-box"><div class="row between"><div><div style="color:var(--gold-hi)">${ico('target', 'sm')} Counter-intelligence</div>
    <div class="faint" style="font-size:0.8em">${can ? `${n} agent${n === 1 ? '' : 's'} watching for spies · ${Math.round(catchChance(g, t.id) * 100)}% chance to catch each foreign operation · each costs one adult and ${COUNTER_COST} food a day` : 'Requires Writing'}</div></div>
    ${can ? `<div class="row" style="gap:4px"><button class="btn xs icon" data-act="counter" data-n="${n - 1}" ${n ? '' : 'disabled'}>${ico('minus', 'sm')}</button><span class="num" style="min-width:16px;text-align:center">${n}</span><button class="btn xs icon" data-act="counter" data-n="${n + 1}" ${n < 3 ? '' : 'disabled'}>${ico('plus', 'sm')}</button></div>` : ''}</div></div>`;
}

export function reputationLine(g) {
  const r = g.dip.reputation[g.playerId] || 0, tier = repTier(r);
  return `<div class="rep-line rep-${tier.key}" data-tip="${esc(tier.desc + ' Reputation falls when you break treaties, wage unjustified wars or are caught spying, and slowly recovers.')}">${ico('scales', 'sm')} Your reputation: <b>${tier.name}</b> <span class="faint">(${sign(r, 0)})</span></div>`;
}

// ---------------------------------------------------------------- inbox
export function inboxSection(g) {
  const P = g.playerId;
  const list = g.history.filter(e => involves(e, P) && (categoryOf(e) === 'diplomacy' || categoryOf(e) === 'war' || categoryOf(e) === 'trade')).slice(-8).reverse();
  if (!list.length) return '';
  return `<div class="section-title">Dispatches</div><div class="inbox">${list.map(e => {
    const old = g.day - e.day > 15;
    return `<div class="dispatch ${old ? 'old' : ''} ${e.alert ? 'alert' : ''}"><span class="d-when" data-tip="${fmtDate(e.day * 360)}, Year ${Math.floor(e.day / DAYS_PER_YEAR) + 1}">${esc(ago(g, e.day))}</span><span>${esc(e.text)}${old ? ' <small class="faint">· may be outdated</small>' : ''}</span></div>`;
  }).join('')}</div><div class="faint" style="font-size:0.78em">The full record is in Notices.</div>`;
}

// ---------------------------------------------------------------- intel actions
export function intelActions(g, P, o) {
  return `<div class="dip-actions intel-actions">${['scout', 'spy', 'sabotage', 'deceive'].map(k => {
    const s = MISSIONS[k]; const locked = s.tech && !g.player.techs.includes(s.tech);
    return `<button class="btn xs ${locked ? 'disabled' : ''}" data-act="intel-send" data-to="${o.id}" data-k="${k}" data-tip="${esc(s.desc + (locked ? ' Requires Writing.' : ''))}">${ico(s.icon, 'sm')} ${esc(s.name.replace('Agent: ', ''))}</button>`;
  }).join('')}</div>`;
}

// Shows the journey before anyone leaves.
export function confirmJourney(g, to, kind, extra = '') {
  const r = route(g, g.playerId, to, kind); const s = MISSIONS[kind];
  if (!r) return Promise.resolve(true);
  const cost = Object.entries(s.cost).map(([k, v]) => `${ico(k === 'food' ? 'food' : k, 'sm')}${v}`).join(' ');
  const catchP = kind === 'spy' || kind === 'sabotage' || kind === 'deceive' ? `<div class="tt-row"><span>Chance of capture on arrival</span><span class="warn">unknown — depends on their counter-intelligence</span></div>` : '';
  return modal(`<div class="modal-head">${ico(s.icon, 'xl')}<div><div class="caps" style="color:var(--gold)">${esc(g.tribes[to].name)}</div><div class="panel-title">Send ${esc(s.name.toLowerCase().replace('agent: ', 'an agent to '))}</div></div></div>
    <div class="prose" style="font-size:0.9em">${esc(s.desc)}</div>${extra}
    <div class="kvbox"><div class="tt-row"><span>Journey</span><span>${g.dip.contact[g.playerId][to] ? `${dur(r.days, true)} each way (${r.dist} leagues)` : 'unknown: their homeland must first be found'}</span></div>
    <div class="tt-row"><span>Risk on the road</span><span class="${r.risk >= 0.2 ? 'bad' : r.risk >= 0.08 ? 'warn' : 'good'}">${r.label} (${Math.round(r.risk * 100)}%)</span></div>
    ${r.why.length ? `<div class="faint" style="font-size:0.82em">Because: ${esc(r.why.join('; '))}.</div>` : ''}${catchP}
    <div class="tt-row"><span>Cost</span><span>${cost} and one adult while away</span></div></div>
    <div class="modal-actions"><button class="btn" data-v="0">Cancel</button><button class="btn primary" data-v="1">Send</button></div>`,
  { onMount: m => m.querySelectorAll('[data-v]').forEach(b => b.onclick = () => closeModal(b.dataset.v === '1')) });
}
