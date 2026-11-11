// Diplomacy: opinions built from decaying modifiers, treaties, wars,
// proposals with explainable acceptance, AI diplomatic reasoning and trade.
import { TRIBES } from '../data/tribes.js';
import { specOf, routeProfile, TILES_PER_DAY } from './logistics.js';
import { aiOf, remember, memoryOpinion, memoryBreakdown, perceivedStrength, coalitionTick, inCoalitionAgainst } from './aimind.js';
import { intel } from './intel.js';
import { RESOURCES } from '../data/resources.js';
import { mod, addRes, takeRes, scarcity } from './economy.js';
import { militaryStrength } from './military.js';
import { doorTile, centreOf } from './buildings.js';
import { DAY_TICKS } from '../core/constants.js';

export const WAR_THRESHOLD = 22;
const fortValue = (g, t) => { let v = 0; for (const b of g.buildings.values()) if (b.tribe === t.id && b.built && (b.type === 'tower' || b.type === 'fort')) v += b.type === 'fort' ? 6 : 1.5; return v * (1 + (t.mods?.defense || 0)); };
const stockWorth = t => { let v = 0; for (const [k, a] of Object.entries(t.stock)) v += (RESOURCES[k]?.value || 1) * a; return v; };

const COMPAT = {
  'oruvai-thalori': 10, 'oruvai-vaelith': 5, 'kharvak-oruvai': -6, 'kharvak-thalori': -4, 'kharvak-vaelith': -8, 'thalori-vaelith': 0,
};
// cultural affinity comes from tribe data (affinity), falling back to the old table
const compat = (a, b) => { const A = TRIBE_DEF(a), B = TRIBE_DEF(b); return A?.affinity?.[b] ?? B?.affinity?.[a] ?? COMPAT[[a, b].sort().join('-')] ?? 0; };
const TRIBE_DEF = k => TRIBES.find(t => t.key === k);

export const TREATY_NAMES = { trade: 'Trade Agreement', nap: 'Non-Aggression Pact', alliance: 'Military Alliance', tribute: 'Tribute', access: 'Border Access', exclusive: 'Trade Exclusivity' };
import { repTier, sendMission } from './intel.js';
import { tradeTerms, counterOffer, signContract, endContract, dailyTrade, ledger, caravanRisk, contractValue } from './trade.js';

export class Diplomacy {
  constructor(game, data) {
    this.game = game;
    const n = game.tribes.length;
    Object.assign(this, data || {
      mods: Array.from({ length: n }, () => Array.from({ length: n }, () => [])),
      treaties: [], wars: [], contact: Array.from({ length: n }, () => Array(n).fill(false)),
      reputation: Array(n).fill(0), lastProposal: Array.from({ length: n }, () => Array(n).fill(-99999)),
    });
    this.game = game;
  }
  toJSON() { const { game, ...rest } = this; return rest; }

  opinion(a, b) {
    const ta = this.game.tribes[a], tb = this.game.tribes[b];
    let v = compat(ta.key, tb.key) + this.reputation[b] * 0.5;
    for (const m of this.mods[a][b]) v += m.v;
    v += memoryOpinion(this.game, a, b);
    return Math.max(-100, Math.min(100, v));
  }
  breakdown(a, b) {
    const ta = this.game.tribes[a], tb = this.game.tribes[b];
    const out = [];
    const c = compat(ta.key, tb.key); if (c) out.push({ label: c > 0 ? 'Kindred cultures' : 'Clashing cultures', v: c });
    if (Math.abs(this.reputation[b]) >= 1) out.push({ label: this.reputation[b] > 0 ? 'Trustworthy reputation' : 'Untrustworthy reputation', v: this.reputation[b] * 0.5 });
    for (const m of this.mods[a][b]) if (Math.abs(m.v) >= 0.5) out.push({ label: m.label, v: m.v });
    out.push(...memoryBreakdown(this.game, a, b));
    return out;
  }
  addMod(a, b, k, v, opts = {}) {
    const list = this.mods[a][b];
    let m = list.find(x => x.k === k);
    if (!m) { m = { k, v: 0, decay: opts.decay ?? 0.5, label: opts.label || k }; list.push(m); }
    m.v += v * (v > 0 ? 1 + mod(this.game.tribes[b], 'relation') * (opts.noMod ? 0 : 1) : 1);
    if (opts.max != null) m.v = Math.min(opts.max, m.v);
    if (opts.min != null) m.v = Math.max(opts.min, m.v);
    if (opts.decay != null) m.decay = opts.decay;
  }
  has(type, a, b) { return this.treaties.some(t => t.type === type && ((t.a === a && t.b === b) || (t.a === b && t.b === a))); }
  treatiesOf(a) { return this.treaties.filter(t => t.a === a || t.b === a); }
  atWar(a, b) { if (a === b) return false; for (const w of this.wars) if ((w.a === a && w.b === b) || (w.a === b && w.b === a)) return true; return false; }
  war(a, b) { return this.wars.find(w => (w.a === a && w.b === b) || (w.a === b && w.b === a)); }
  enemies(a) { return this.wars.filter(w => w.a === a || w.b === a).map(w => (w.a === a ? w.b : w.a)); }
  allies(a) { return this.treaties.filter(t => t.type === 'alliance' && (t.a === a || t.b === a)).map(t => (t.a === a ? t.b : t.a)); }
  partners(a) { return this.treaties.filter(t => t.type === 'trade' && (t.a === a || t.b === a)).map(t => (t.a === a ? t.b : t.a)); }

  sign(type, a, b, extra = {}) {
    if (this.has(type, a, b) && type !== 'tribute') return;
    this.treaties.push({ type, a, b, since: this.game.tick, ...extra });
    const g = this.game, ta = g.tribes[a], tb = g.tribes[b];
    this.addMod(a, b, 'treaty_' + type, 6, { label: 'Signed ' + TREATY_NAMES[type], decay: 0.15, max: 12 });
    this.addMod(b, a, 'treaty_' + type, 6, { label: 'Signed ' + TREATY_NAMES[type], decay: 0.15, max: 12 });
    if (type !== 'tribute') g.log(ta, 'diplomacy', `${ta.name} and ${tb.name} signed a ${TREATY_NAMES[type]}.`, (ta.isPlayer || tb.isPlayer) ? 2 : 1, { with: b });
    g.bus.emit('treaty', { type, a, b });
  }
  cancel(type, a, b, by = a, broken = false, why = '') {
    const before = this.treaties.length;
    this.treaties = this.treaties.filter(t => !(t.type === type && ((t.a === a && t.b === b) || (t.a === b && t.b === a))));
    if (this.treaties.length === before) return;
    const g = this.game; const other = by === a ? b : a;
    if (broken) {
      this.reputation[by] -= type === 'alliance' ? 12 : 7;
      this.addMod(other, by, 'betrayal', -30, { label: 'Broke a treaty with us', decay: 0.2 });
      remember(g, other, by, 'betrayal', -15);
    } else this.addMod(other, by, 'cancelled', -8, { label: 'Ended a treaty', decay: 0.4 });
    if (type === 'trade' || type === 'exclusive') ledger(g, { a, b, kind: type + '-end', by, why: why || (broken ? 'broken' : 'ended') });
    g.log(g.tribes[by], 'diplomacy', `${g.tribes[by].name} ${broken ? 'broke' : 'ended'} the ${TREATY_NAMES[type]} with the ${g.tribes[other].name}${why ? ` (${why})` : ''}.`, 2, { with: other, alert: g.tribes[other].isPlayer && broken });
  }

  declareWar(a, b, reason = '') {
    if (this.atWar(a, b) || a === b) return;
    if (this.game.tutorial && a !== this.game.playerId && b === this.game.playerId) return;
    const g = this.game, ta = g.tribes[a], tb = g.tribes[b];
    for (const type of ['nap', 'alliance', 'trade', 'access', 'exclusive']) if (this.has(type, a, b)) this.cancel(type, a, b, a, type === 'nap' || type === 'alliance', 'war');
    for (const c of this.treaties.filter(x => x.type === 'contract' && ((x.a === a && x.b === b) || (x.a === b && x.b === a)))) endContract(g, c, a, 'war');
    this.treaties = this.treaties.filter(t => !(t.type === 'tribute' && ((t.a === a && t.b === b) || (t.a === b && t.b === a))));
    this.wars.push({ a, b, start: g.tick, score: { [a]: 0, [b]: 0 }, reason });
    // aggression has diplomatic consequences: unprovoked wars alarm everyone
    const provoked = (this.casusBelli?.[a * 8 + b] || 0) > g.tick || this.opinion(a, b) < -40 || /alliance/.test(reason);
    if (!provoked) {
      this.reputation[a] -= 4;
      for (const o of g.tribes) if (o.alive && o.id !== a && o.id !== b) this.addMod(o.id, a, 'warmonger', -6, { label: 'Wages unprovoked wars', decay: 0.15, min: -24 });
    }
    this.addMod(b, a, 'war', -40, { label: 'At war with us', decay: 0.3, min: -60 });
    remember(g, b, a, 'war', -12);
    this.addMod(a, b, 'war', -20, { label: 'At war with us', decay: 0.3, min: -60 });
    ta.atWar = tb.atWar = true;
    g.log(ta, 'war', `${ta.name} declared war on the ${tb.name}${reason ? ' — ' + reason : ''}.`, 3, { with: b });
    g.bus.emit('war', { a, b });
    // allies are called to arms
    for (const ally of this.allies(b)) {
      if (ally === a || this.atWar(ally, a)) continue;
      const t = g.tribes[ally];
      const loyal = t.isPlayer ? false : (aiOf(t).loyalty * 0.7 + this.opinion(ally, b) / 150 - this.opinion(ally, a) / 300 > 0.45);
      if (t.isPlayer) g.bus.emit('allyCall', { ally, victim: b, aggressor: a });
      else if (loyal) this.declareWar(ally, a, `honouring their alliance with the ${tb.name}`);
      else { this.cancel('alliance', ally, b, ally, true); }
    }
  }
  makePeace(a, b, terms = 'white') {
    const w = this.war(a, b); if (!w) return;
    const g = this.game, ta = g.tribes[a], tb = g.tribes[b];
    this.wars = this.wars.filter(x => x !== w);
    if (this.peaceOffers) { this.peaceOffers[a * 8 + b] = 0; this.peaceOffers[b * 8 + a] = 0; }
    for (const ar of g.armies) if ((ar.tribe === a && ar.enemy === b) || (ar.tribe === b && ar.enemy === a)) ar.state = 'return';
    this.addMod(a, b, 'peace', 8, { label: 'Made peace', decay: 0.3 });
    this.addMod(b, a, 'peace', 8, { label: 'Made peace', decay: 0.3 });
    this.mods[a][b].forEach(m => { if (m.k === 'war') m.decay = 1.2; });
    this.mods[b][a].forEach(m => { if (m.k === 'war') m.decay = 1.2; });
    if (terms === 'tribute_a') this.sign('tribute', a, b, { payer: a, until: g.tick + DAY_TICKS * 12 });
    if (terms === 'tribute_b') this.sign('tribute', a, b, { payer: b, until: g.tick + DAY_TICKS * 12 });
    this.sign('nap', a, b, { until: g.tick + DAY_TICKS * 16 });
    this.truce = this.truce || {};
    this.truce[a * 8 + b] = g.tick + DAY_TICKS * 20;
    ta.atWar = this.enemies(a).length > 0; tb.atWar = this.enemies(b).length > 0;
    const tt = terms === 'white' ? 'a white peace' : `peace, with the ${(terms === 'tribute_a' ? ta : tb).name} paying tribute`;
    g.log(ta, 'war', `${ta.name} and ${tb.name} agreed to ${tt}.`, 3, { with: b });
    g.bus.emit('peace', { a, b });
  }
  warScore(a, b, pts) { const w = this.war(a, b); if (w) w.score[a] = (w.score[a] || 0) + pts; }

  onEliminated(id) {
    this.treaties = this.treaties.filter(t => t.a !== id && t.b !== id);
    this.wars = this.wars.filter(w => w.a !== id && w.b !== id);
    for (const t of this.game.tribes) t.atWar = this.enemies(t.id).length > 0;
  }

  // ---------------------------------------------------------------- daily
  daily() {
    const g = this.game, T = g.tribes;
    for (const ta of T) for (const tb of T) {
      if (ta === tb || !ta.alive || !tb.alive) continue;
      const a = ta.id, b = tb.id;
      // decay
      for (const m of this.mods[a][b]) { if (m.v > 0) m.v = Math.max(0, m.v - m.decay); else m.v = Math.min(0, m.v + m.decay); }
      this.mods[a][b] = this.mods[a][b].filter(m => Math.abs(m.v) > 0.05 || m.persist);
      if (!this.contact[a][b]) {
        const d = settlementDistance(g, a, b);
        if (d < 55 || g.day > 10) { this.contact[a][b] = this.contact[b][a] = true; if (a < b) g.log(ta, 'diplomacy', `The ${ta.name} made first contact with the ${tb.name}.`, ta.isPlayer || tb.isPlayer ? 2 : 1, { with: b }); }
        continue;
      }
      // borders
      const border = sharedBorder(g, a, b);
      if (border > 0) this.addMod(a, b, 'border', -0.25 - border * 0.01, { label: 'Border tensions', decay: 0.05, min: -20 });
      if (border > 15) remember(g, a, b, 'border', -0.06, 12);
      if (this.has('trade', a, b)) this.addMod(a, b, 'trade', 0.6 * (1 + mod(ta, 'relationTrade')), { label: 'Profitable trade', decay: 0.1, max: 20 });
      // common enemies bring tribes together
      const ce = this.enemies(a).filter(e => this.atWar(b, e));
      if (ce.length) this.addMod(a, b, 'common_enemy', 0.8, { label: 'Common enemy', decay: 0.3, max: 18 });
      // fear of powerful, aggressive neighbours
      const ratio = (tb.strength + 1) / (ta.strength + 1);
      if (ratio > 1.8 && aiOf(tb).aggression > 0.5 && border > 0) this.addMod(a, b, 'fear', -0.3, { label: 'Fears our military', decay: 0.2, min: -12 });
      if (this.atWar(a, b)) this.addMod(a, b, 'war', -0.2, { label: 'At war with us', decay: 0.3, min: -60 });
    }
    // ignored ultimatums count as refusals
    for (const pr of g.pendingProposals.slice()) if (pr.p.ultimatum && pr.expires && g.tick > pr.expires) {
      g.pendingProposals = g.pendingProposals.filter(x => x !== pr);
      this.onTributeRefused(pr.from, pr.to, pr.p);
      g.log(g.tribes[pr.to], 'diplomacy', `The ${g.tribes[pr.to].name} ignored the ${g.tribes[pr.from].name} ultimatum.`, 2);
    }
    // tribute payments and treaty expiry
    for (const t of this.treaties.slice()) {
      if (t.until && g.tick > t.until) { this.treaties = this.treaties.filter(x => x !== t); continue; }
      if (t.type === 'tribute') {
        const payer = T[t.payer], payee = T[t.payer === t.a ? t.b : t.a];
        const res = payer.techs.includes('currency') && (payer.stock.coins || 0) > 10 ? 'coins' : (payer.stock.grain || 0) > (payer.stock.wood || 0) ? 'grain' : 'wood';
        const amt = takeRes(payer, res, Math.max(4, payer.pop * 0.12));
        addRes(g, payee, res, amt);
      }
    }
    // war weariness
    for (const t of T) {
      if (!t.alive) continue;
      t.atWar = this.enemies(t.id).length > 0;
      t.warWeariness = t.atWar ? Math.min(100, (t.warWeariness || 0) + 1.6 * (t.def?.quirks?.warWeariness ?? 1)) : Math.max(0, (t.warWeariness || 0) - 3);
    }
    for (let i = 0; i < T.length; i++) this.reputation[i] = this.reputation[i] * 0.99;
    dailyTrade(g);
    coalitionTick(g);
  }

  // ---------------------------------------------------------------- proposals
  evaluate(from, to, p) {
    const g = this.game, tf = g.tribes[from], tt = g.tribes[to];
    const op = this.opinion(to, from);
    const ai = aiOf(tt);
    const reasons = [];
    let score = 0;
    const add = (v, label) => { score += v; if (Math.abs(v) >= 1) reasons.push({ v: Math.round(v), label }); };
    if (!this.contact[from][to]) return { accept: false, score: -100, reasons: [{ v: -100, label: 'They have not met you' }] };
    const tier = repTier(this.reputation[from]);
    if (tier.key === 'honourable' && ['nap', 'alliance', 'access', 'exclusive', 'trade'].includes(p.type)) add(6, 'Your word is trusted');
    if (tier.key === 'doubted' && ['nap', 'alliance', 'access', 'exclusive'].includes(p.type)) add(-10, 'They doubt your word');
    if (tier.key === 'oathbreaker' && p.type === 'nap') add(-25, 'You are an oathbreaker');
    const trd = tradeTerms(this, from, to, p, add); if (trd) return trd;
    if (tier.key === 'oathbreaker' && p.type === 'alliance') return { accept: false, score: -100, reasons: [{ v: -100, label: 'You are an oathbreaker' }] };
    add(op * 0.5, 'Opinion of you');
    const rs = (tf.strength + 1) / (tt.strength + 1);
    switch (p.type) {
      case 'trade':
        if (!tt.techs.includes('barter') || !tf.techs.includes('barter')) return { accept: false, score: -100, reasons: [{ v: -100, label: 'Both must know Barter' }] };
        if (this.atWar(from, to)) return { accept: false, score: -100, reasons: [{ v: -100, label: 'You are at war' }] };
        if (this.treaties.some(x => x.type === 'exclusive' && (x.a === to || x.b === to) && x.a !== from && x.b !== from)) return { accept: false, score: -100, reasons: [{ v: -100, label: 'Bound by an exclusive trade deal' }] };
        if (this.treaties.some(x => x.type === 'exclusive' && (x.a === from || x.b === from) && x.a !== to && x.b !== to)) return { accept: false, score: -100, reasons: [{ v: -100, label: 'You are bound by an exclusive trade deal' }] };
        add(10 + ai.trade * 15, 'Values commerce'); break;
      case 'access': {
        if (this.atWar(from, to)) return { accept: false, score: -100, reasons: [{ v: -100, label: 'You are at war' }] };
        if (tier.key === 'oathbreaker') return { accept: false, score: -100, reasons: [{ v: -100, label: 'You are an oathbreaker' }] };
        add(-8, 'Wary of foreign travellers'); add(ai.diplomacy * 10 + ai.trade * 6, 'Open temperament'); add(-ai.caution * 10, 'Cautious');
        if (this.has('trade', from, to)) add(8, 'Trading partners');
        break;
      }
      case 'exclusive': {
        if (!this.has('trade', from, to)) return { accept: false, score: -100, reasons: [{ v: -100, label: 'Needs a Trade Agreement first' }] };
        if (tier.key === 'oathbreaker') return { accept: false, score: -100, reasons: [{ v: -100, label: 'You are an oathbreaker' }] };
        const others = this.partners(to).filter(x => x !== from).length, mine = this.partners(from).filter(x => x !== to).length;
        if (mine) return { accept: false, score: -100, reasons: [{ v: -100, label: 'End your other trade agreements first' }] };
        add(-6 - others * 14, others ? `Would give up ${others} other partner${others > 1 ? 's' : ''}` : 'A binding commitment');
        add(ai.trade * 14, 'Values commerce'); add(op * 0.15, '');
        break;
      }
      case 'offerTribute':
        add(30, 'Welcomes tribute'); break;
      case 'contract': {
        if (!tt.techs.includes('barter') || !tf.techs.includes('barter')) return { accept: false, score: -100, reasons: [{ v: -100, label: 'Contracts need Barter on both sides' }] };
        if (this.atWar(from, to)) return { accept: false, score: -100, reasons: [{ v: -100, label: 'At war' }] };
        for (const [r, v] of Object.entries(p.get || {})) if ((tt.stock[r] || 0) < v * 2) return { accept: false, score: -100, reasons: [{ v: -100, label: `They cannot spare ${RESOURCES[r].name} regularly` }] };
        const { get, give } = contractValue(this, from, to, p);
        add(Math.max(-80, Math.min(40, ((get - give) / Math.max(1, give)) * 60)), get >= give ? 'Favourable terms' : 'Unfavourable terms');
        add(4 + ai.trade * 6, 'Values a steady supply');
        if (this.reputation[from] < -5) add(this.reputation[from] * 0.6, 'Doubts you will deliver');
        break;
      }
      case 'nap':
        if (p.coalition && g.dip.coalition?.members?.includes(to)) add(25, 'United against a common threat');
        if (this.atWar(from, to)) return { accept: false, score: -100, reasons: [{ v: -100, label: 'You are at war — propose peace instead' }] };
        add(5 + (rs > 1.2 ? 12 : 0), rs > 1.2 ? 'Wary of your strength' : 'Values security');
        add(-ai.aggression * 12, 'Expansionist ambitions');
        break;
      case 'alliance': {
        if (this.atWar(from, to)) return { accept: false, score: -100, reasons: [{ v: -100, label: 'You are at war' }] };
        add(-25, 'Alliances are serious commitments');
        add(ai.diplomacy * 12, 'Diplomatic temperament');
        const ce = this.enemies(to).filter(e => !this.atWar(from, e)).length;
        if (this.enemies(to).length) add(this.enemies(to).some(e => this.atWar(from, e)) ? 20 : -5, this.enemies(to).some(e => this.atWar(from, e)) ? 'We share an enemy' : 'You would not aid our war');
        if (this.enemies(from).length && !this.enemies(from).every(e => this.atWar(to, e))) add(-12, 'Would drag them into your wars');
        if (rs > 1.3) add(8, 'You are strong');
        if (p.coalition && g.dip.coalition?.members?.includes(to)) add(30, 'United against a common threat');
        if (this.reputation[from] < -5) add(this.reputation[from], 'You break treaties');
        break;
      }
      case 'peace': {
        const w = this.war(from, to); if (!w) return { accept: false, score: -100, reasons: [{ v: -100, label: 'Not at war' }] };
        const mine = w.score[to] || 0, theirs = w.score[from] || 0;
        add((theirs - mine) * 0.8, theirs > mine ? 'Losing the war' : 'Winning the war');
        add((tt.warWeariness || 0) * 0.4, 'War weariness');
        add(-ai.aggression * 10, 'Warlike temperament');
        add(Math.min(15, (g.tick - w.start) / DAY_TICKS * 2) - 6, 'Duration of war');
        if (p.terms === 'tribute_a') add(25, 'You offer tribute');
        if (p.terms === 'tribute_b') add(-30, 'You demand tribute');
        add(-op * 0.3, '');
        break;
      }
      case 'gift': {
        const v = (RESOURCES[p.res]?.value || 1) * p.amt * scarcity(tt, p.res);
        add(100, 'Gifts are always welcome'); p._value = v; break;
      }
      case 'exchange': {
        let give = 0, get = 0;
        for (const [r, v] of Object.entries(p.give || {})) get += (RESOURCES[r]?.value || 1) * v * scarcity(tt, r);
        for (const [r, v] of Object.entries(p.get || {})) { if ((tt.stock[r] || 0) < v) return { accept: false, score: -100, reasons: [{ v: -100, label: `They lack ${RESOURCES[r].name}` }] }; give += (RESOURCES[r]?.value || 1) * v * scarcity(tt, r) * 1.1; }
        add(((get - give) / Math.max(1, give)) * 60, get >= give ? 'Favourable exchange' : 'Unfavourable exchange');
        if (this.atWar(from, to)) add(-80, 'At war');
        break;
      }
      case 'tribute': {
        add(-40, 'Pride');
        if (p.ultimatum) add(rs > 1.6 ? 25 : 0, 'Fears the threatened war');
        add((rs - 1) * 35, rs > 1 ? 'Fears your army' : 'Does not fear you');
        add(-ai.aggression * 15, 'Defiant temperament');
        if (this.atWar(from, to)) add(-30, 'At war');
        break;
      }
    }
    return { accept: score > 0, score: Math.round(score), reasons };
  }

  propose(from, to, p) {
    const g = this.game, tf = g.tribes[from], tt = g.tribes[to];
    if (p.type === 'war') { this.declareWar(from, to, p.reason || ''); return { accept: true, reasons: [] }; }
    if (p.type === 'cancel') { this.cancel(p.treaty, from, to, from, false); return { accept: true, reasons: [] }; }
    if (p.type === 'gift' && (tf.stock[p.res] || 0) < p.amt) return { accept: false, reasons: [{ v: 0, label: 'You lack the resources' }] };
    if (p.type === 'exchange') for (const [r, v] of Object.entries(p.give || {})) if ((tf.stock[r] || 0) < v) return { accept: false, reasons: [{ v: 0, label: `You lack ${RESOURCES[r].name}` }] };
    const ev = this.evaluate(from, to, p);
    this.lastProposal[from][to] = g.tick;
    if (!ev.accept) {
      // pestering a people that just refused wears thin
      this.refusedAt = this.refusedAt || {};
      const rk = from * 8 + to;
      if (g.tick - (this.refusedAt[rk] || -1e9) < DAY_TICKS * 5) this.addMod(to, from, 'pester', -3, { label: 'Pesters us with proposals', decay: 0.3, min: -12 });
      this.refusedAt[rk] = g.tick;
      if (p.type === 'exchange' || p.type === 'contract') ev.counter = counterOffer(this, from, to, p);
      if (p.type === 'tribute') this.addMod(to, from, 'demand', -10, { label: 'Made insulting demands', decay: 0.4 });
      return ev;
    }
    switch (p.type) {
      case 'trade': case 'nap': case 'alliance': case 'access': case 'exclusive': this.sign(p.type, from, to); if (p.type === 'trade' || p.type === 'exclusive') ledger(g, { a: from, b: to, kind: p.type }); break;
      case 'contract': signContract(g, from, to, p); break;
      case 'offerTribute': this.sign('tribute', from, to, { payer: from, until: g.tick + DAY_TICKS * 10 }); g.log(tf, 'diplomacy', `The ${tf.name} agreed to pay tribute to the ${tt.name}.`, 2, { with: to }); break;
      case 'peace': this.makePeace(from, to, p.terms || 'white'); break;
      case 'gift': {
        takeRes(tf, p.res, p.amt); addRes(g, tt, p.res, p.amt);
        const v = Math.min(25, 3 + Math.sqrt(p._value || 10) * 1.4);
        this.addMod(to, from, 'gift', v, { label: 'Generous gifts', decay: 0.4, max: 30 });
        remember(g, to, from, 'gift', Math.min(6, v * 0.25), 15);
        g.log(tf, 'diplomacy', `${tf.name} sent a gift of ${Math.round(p.amt)} ${RESOURCES[p.res].name} to the ${tt.name}.`, 1, { with: to });
        break;
      }
      case 'exchange':
        for (const [r, v] of Object.entries(p.give || {})) { takeRes(tf, r, v); addRes(g, tt, r, v); }
        for (const [r, v] of Object.entries(p.get || {})) { takeRes(tt, r, v); addRes(g, tf, r, v); }
        this.addMod(to, from, 'exchange', 2, { label: 'Fair dealings', decay: 0.2, max: 10 });
        g.log(tf, 'diplomacy', `${tf.name} and ${tt.name} exchanged goods.`, 1, { with: to, cat: 'trade' });
        break;
      case 'tribute':
        this.sign('tribute', from, to, { payer: to, until: g.tick + DAY_TICKS * 10 });
        this.addMod(to, from, 'extortion', -15, { label: 'Extorted tribute', decay: 0.25 });
        g.log(tf, 'diplomacy', `The ${tt.name} agreed to pay tribute to the ${tf.name}.`, 2, { with: to });
        break;
    }
    return ev;
  }

  // ---------------------------------------------------------------- war calculus
  setRisk(a, b, v) {
    this.warRisk = this.warRisk || Array.from({ length: this.game.tribes.length }, () => Array(this.game.tribes.length).fill(0));
    const prev = this.warRisk[a][b]; this.warRisk[a][b] = v;
    const g = this.game, other = g.tribes[b];
    // warn the player as hostility builds (never more than every few days)
    if (other.isPlayer && v > WAR_THRESHOLD - 18 && prev <= WAR_THRESHOLD - 18) {
      this.lastWarn = this.lastWarn || {};
      if (g.tick - (this.lastWarn[a] || -1e9) > DAY_TICKS * 3) {
        this.lastWarn[a] = g.tick;
        const reason = this.assessWar(g.tribes[a], other).reason, high = v > WAR_THRESHOLD;
        g.log(g.tribes[a], 'diplomacy', high ? `The ${g.tribes[a].name} are preparing for war against the ${other.name}.` : `Relations between the ${g.tribes[a].name} and the ${other.name} are deteriorating.`, 1, { with: b, alert: high });
        g.bus.emit('tension', { from: a, level: high ? 'high' : 'rising', reason });
      }
    }
  }

  // Weighs expected gains against expected losses, diplomatic fallout and
  // strategic distractions, filtered through personality.
  assessWar(tribe, other) {
    const g = this.game, ai = aiOf(tribe), a = tribe.id, b = other.id;
    const op = this.opinion(a, b);
    const allies = this.allies(b).filter(x => !this.atWar(x, a) && x !== a);
    const seen = perceivedStrength(g, a, b, intel);
    const theirPower = seen.v + 1 + allies.reduce((s, x) => s + g.tribes[x].strength * 0.6 * aiOf(g.tribes[x]).loyalty, 0) + fortValue(g, other);
    const myPower = tribe.strength + 1;
    const rs = myPower / theirPower;
    const border = sharedBorder(g, a, b);
    // gains: plunder, weakly held towns, and land holding resources we lack
    const loot = Math.min(25, Math.sqrt(stockWorth(other)) * 0.25);
    const towns = other.settlements.filter(sid => !g.settlements.get(sid)?.capital).length;
    const wanted = Object.keys(tribe.plan?.bottlenecks || {}).filter(r => (other.stock[r] || 0) > 100).length;
    const gain = loot + towns * 6 * Math.min(1.5, rs) + wanted * 8 + (border > 0 ? Math.min(10, border * 0.08) : 0);
    // costs: soldiers lost, trade lost, reputation with onlookers, weariness
    const losses = Math.min(40, 18 / Math.max(0.3, rs));
    const tradeLoss = this.has('trade', a, b) ? 10 * ai.trade : 0;
    const onlookers = g.tribes.filter(o => o.alive && o !== tribe && o !== other && this.opinion(o.id, b) > 25).length * 5;
    const treaty = (this.has('nap', a, b) ? 30 * ai.loyalty + 10 : 0) + (this.has('alliance', a, b) ? 60 : 0);
    const distraction = (this.enemies(a).length ? 25 : 0) + g.tribes.filter(o => o.alive && o !== tribe && o !== other && this.atWar(o.id, a) === false && this.opinion(o.id, a) < -30 && o.strength > tribe.strength).length * 10;
    const economy = (tribe.foodSat < 0.95 ? 20 : 0) + (tribe.strategy && tribe.strategy !== 'balanced' ? 8 : 0);
    let desire = ai.aggression * 28 + gain * (0.5 + ai.aggression) - losses * (0.6 + ai.caution) - tradeLoss - onlookers - treaty - distraction - economy - op * 0.5;
    if (op > -10 && ai.aggression < 0.6) desire -= 20;            // peaceful peoples need a grievance
    if (this.enemies(b).length) desire -= 18 * (1 - ai.aggression); // reluctant to dog-pile
    if ((tribe.jobCounts?.soldier || 0) < 5) desire -= 30;
    if (rs < 1.25) desire -= 25;                                     // recognise weakness
    // early-game protection: young peoples are left to grow
    const grace = other.isPlayer ? { gentle: 55, balanced: 40, harsh: 28 }[g.difficulty] ?? 40 : 30;
    if (g.day < grace || other.stage < 2 || tribe.stage < 2) desire -= 70;
    // Smarter, not stronger: higher difficulties exploit weakness and demand better odds; gentler rulers misjudge.
    const skill = g.difficultyDef.skill ?? 1;
    const opportunity = (this.enemies(b).length ? 10 : 0) + (other.foodSat < 0.95 ? 8 : 0) + (other.happiness < 35 ? 5 : 0);
    desire += opportunity * (skill - 0.5);
    if (rs < 1 + 0.3 * skill) desire -= 12 * skill;
    if (!seen.sure) desire -= 12 * ai.caution;                     // unsure of their strength
    // logistics: a distant people is costly to fight, unless the war is forced on us
    const capA = g.settlements.get(tribe.capital), capB = g.settlements.get(other.capital);
    if (capA && capB && border <= 0) {
      const prof = routeProfile(g, capA.x, capA.y, capB.x, capB.y);
      const days = prof.dist * prof.avgCost / TILES_PER_DAY;
      const soldiers = tribe.jobCounts?.soldier || 0;
      const food = Object.entries(tribe.stock).reduce((s, [k, v]) => s + (RESOURCES[k]?.food ? v : 0), 0);
      desire -= Math.max(0, days - 2) * 6 + prof.mountain * 15;
      if (soldiers * 0.6 * 0.75 * (days * 1.5 + 2) > food * 0.5) desire -= 20;   // could not feed the army
    }
    if (inCoalitionAgainst(g, a, b)) desire += 10 + (g.dip.coalition.members.some(m => m !== a && this.atWar(m, b)) ? 15 : 0);
    if (this.treaties.some(x => x.type === 'tribute' && x.payer === b && (x.a === a || x.b === a))) desire -= 40; // they already pay
    const reason = wanted ? 'to seize resources they cannot do without' : border > 15 ? 'over disputed borderlands' : towns && rs > 1.5 ? 'to take weakly held towns' : warReason(tribe, other, border);
    return { desire, gain, losses, rs, reason };
  }

  issueUltimatum(tribe, other, A) {
    const g = this.game, a = tribe.id, b = other.id;
    this.ultimatumAt = this.ultimatumAt || {}; this.casusBelli = this.casusBelli || {};
    this.ultimatumAt[a * 8 + b] = g.tick; this.lastProposal[a][b] = g.tick;
    const p = { type: 'tribute', ultimatum: true, reason: A.reason };
    g.log(tribe, 'diplomacy', `The ${tribe.name} sent an ultimatum to the ${other.name}: pay tribute or face war.`, other.isPlayer ? 2 : 1, { with: b });
    this.dispatch(a, b, p, { expires: g.tick + DAY_TICKS * 1.5 });
  }
  onTributeRefused(a, b, p) {
    this.casusBelli = this.casusBelli || {};
    this.addMod(a, b, 'defiance', -8, { label: 'Defied our demands', decay: 0.3 });
    if (p?.ultimatum) this.casusBelli[a * 8 + b] = this.game.tick + DAY_TICKS * 6;
  }

  // ---------------------------------------------------------------- envoy
  // The player's optional diplomatic steward. Configurable, never declares
  // war, never cancels treaties, and stays clear of anything the player has
  // personally refused or ended recently.
  envoyThink(t) {
    const g = this.game, cfg = { answer: true, trade: true, peace: true, alliances: true, appease: true, gifts: true, ...(t.envoy || {}) };
    const blocked = (o, type) => (t.envoyBlock?.[o + ':' + type] || 0) > g.tick;
    const outcome = [];
    // 1. answer envoys waiting on us
    if (cfg.answer) for (const pr of g.pendingProposals.filter(p => p.to === t.id)) {
      const from = g.tribes[pr.from];
      let yes;
      if (pr.p.type === 'tribute') {
        const rs = (t.strength + 1) / (from.strength + 1);
        yes = cfg.appease && pr.p.ultimatum && rs < 0.8 && !this.enemies(t.id).length;
      } else if (pr.p.type === 'peace') yes = cfg.peace && pr.p.terms !== 'tribute_b' || (cfg.appease && (t.warWeariness || 0) > 40);
      else if (pr.p.type === 'alliance') yes = cfg.alliances && this.opinion(t.id, pr.from) > 0;
      else yes = this.evaluate(pr.from, t.id, pr.p).score > -10;
      g.pendingProposals = g.pendingProposals.filter(x => x !== pr);
      if (yes) { acceptProposalLocal(g, pr); outcome.push(`accepted the ${from.name} ${pr.p.type}`); }
      else { this.addMod(pr.from, t.id, 'rebuffed', -2, { label: 'Rebuffed our envoys', decay: 0.4 }); if (pr.p.type === 'tribute') this.onTributeRefused(pr.from, t.id, pr.p); outcome.push(`declined the ${from.name} ${pr.p.type}`); }
    }
    // 2. seek peace, pacts, trade and goodwill
    for (const o of g.tribes) {
      if (o === t || !o.alive || !this.contact[t.id][o.id]) continue;
      if (g.tick - this.lastProposal[t.id][o.id] < DAY_TICKS * 2) continue;
      const tryP = (p, label) => { if (blocked(o.id, p.type)) return false; this.lastProposal[t.id][o.id] = g.tick; if (!g.tutorial) { if (!this.dispatch(t.id, o.id, p)) return false; outcome.push(`sent an envoy to the ${o.name} (${label.replace(/^(proposed|sent) /, '')})`); return true; } const r = this.propose(t.id, o.id, p); outcome.push(`${label} with the ${o.name}: ${r.accept ? 'agreed' : 'refused'}`); return true; };
      if (this.atWar(t.id, o.id)) {
        if (cfg.peace) { const w = this.war(t.id, o.id); const losing = (w.score[o.id] || 0) - (w.score[t.id] || 0) > 20; tryP({ type: 'peace', terms: losing && cfg.appease ? 'tribute_a' : 'white' }, 'proposed peace'); }
        continue;
      }
      const risk = this.warRisk?.[o.id]?.[t.id] || -99;
      if (cfg.gifts && risk > WAR_THRESHOLD - 15) {
        const res = Object.entries(t.stock).filter(([k, v]) => RESOURCES[k] && k !== 'coins' && v > 120).sort((x, y) => y[1] - x[1])[0];
        if (res && !blocked(o.id, 'gift')) { tryP({ type: 'gift', res: res[0], amt: 30 }, 'sent a gift to calm tensions'); continue; }
      }
      if (cfg.alliances && !this.has('nap', t.id, o.id) && !this.has('alliance', t.id, o.id) && sharedBorder(g, t.id, o.id) > 0 && tryP({ type: 'nap' }, 'proposed a non-aggression pact')) continue;
      if (cfg.trade && !this.has('trade', t.id, o.id) && t.techs.includes('barter') && o.techs.includes('barter') && tryP({ type: 'trade' }, 'proposed trade')) continue;
      if (cfg.alliances && !this.has('alliance', t.id, o.id) && this.opinion(o.id, t.id) > 30 && tryP({ type: 'alliance' }, 'proposed an alliance')) continue;
      // keep existing agreements healthy
      if (cfg.gifts && (this.has('trade', t.id, o.id) || this.has('alliance', t.id, o.id)) && this.opinion(o.id, t.id) < 5) {
        const res = Object.entries(t.stock).filter(([k, v]) => RESOURCES[k] && k !== 'coins' && v > 150).sort((x, y) => y[1] - x[1])[0];
        if (res) tryP({ type: 'gift', res: res[0], amt: 20 }, 'sent a gift to keep our agreement');
      }
    }
    if (outcome.length) { t.envoyLog = [...outcome.map(text => ({ tick: g.tick, text })), ...(t.envoyLog || [])].slice(0, 12); g.bus.emit('envoy', { lines: outcome }); }
  }

  // Every proposal travels with an envoy (except in the scripted tutorial).
  // Returns false if no envoy could be sent.
  dispatch(a, b, p, extra = {}) {
    const g = this.game, other = g.tribes[b];
    this.lastProposal[a][b] = g.tick;
    if (g.tutorial) {
      if (other.isPlayer && p.type !== 'gift') { g.pendingProposals.push({ from: a, to: b, p, tick: g.tick, ...extra }); g.bus.emit('proposal', { from: a, to: b, p }); return true; }
      const r = this.propose(a, b, p);
      if (other.isPlayer && p.type === 'gift' && r.accept) g.bus.emit('proposal', { from: a, to: b, p });
      if (p.ultimatum && !r.accept) this.onTributeRefused(a, b, p);
      return true;
    }
    return sendMission(g, a, b, 'envoy', p).ok;
  }

  // ---------------------------------------------------------------- AI
  aiThink(tribe, opts = {}) {
    const g = this.game, ai = aiOf(tribe), rng = g.rng;
    for (const other of g.tribes) {
      if (other === tribe || !other.alive || !this.contact[tribe.id][other.id]) continue;
      const a = tribe.id, b = other.id;
      const op = this.opinion(a, b);
      const since = g.tick - this.lastProposal[a][b];
      const canPropose = since > DAY_TICKS * 2;
      const rs = (tribe.strength + 1) / (other.strength + 1);
      const atWar = this.atWar(a, b);
      const send = (p) => this.dispatch(a, b, p);
      if (atWar) {
        const w = this.war(a, b);
        const myS = w.score[a] || 0, theirS = w.score[b] || 0;
        const days = (g.tick - w.start) / DAY_TICKS;
        const wantPeace = (tribe.warWeariness || 0) * 0.5 + (theirS - myS) * 0.6 - ai.aggression * 20 + (rs < 0.8 ? 15 : 0) + days;
        // a clear victor dictates terms once the point is made
        const victor = myS - theirS > 40 && days > 5;
        if ((wantPeace > 25 || victor) && canPropose) {
          this.peaceOffers = this.peaceOffers || {};
          const k = a * 8 + b; this.peaceOffers[k] = (this.peaceOffers[k] || 0) + 1;
          // war aims met and terms ignored twice: withdraw rather than raid on and on
          if (victor && this.peaceOffers[k] > 2 && days > 10) {
            this.peaceOffers[k] = 0;
            g.log(tribe, 'war', `The ${tribe.name}, their war aims achieved, withdrew from the war with the ${other.name}.`, 2);
            this.makePeace(a, b, 'white');
            continue;
          }
          send({ type: 'peace', terms: theirS - myS > 25 ? 'tribute_a' : myS - theirS > 25 ? 'tribute_b' : 'white' });
        }
        continue;
      }
      // war consideration: a reasoned assessment rather than a mood
      const border = sharedBorder(g, a, b);
      if ((this.truce?.[a * 8 + b] || 0) > g.tick || (this.truce?.[b * 8 + a] || 0) > g.tick) { this.setRisk(a, b, -50); continue; }
      const A = this.assessWar(tribe, other);
      this.setRisk(a, b, A.desire);
      if (!opts.noWar && A.desire > WAR_THRESHOLD) {
        const cb = this.casusBelli?.[a * 8 + b] || 0;
        const recentUltimatum = g.tick - (this.ultimatumAt?.[a * 8 + b] || -1e9) < DAY_TICKS * 8;
        if (cb > g.tick || op < -55) { if (rng.chance(0.35)) { this.declareWar(a, b, A.reason); this.casusBelli[a * 8 + b] = 0; } continue; }
        if (!recentUltimatum && canPropose) { this.issueUltimatum(tribe, other, A); continue; }
      }
      if (!canPropose) continue;
      // alliances: reassess
      if (this.has('alliance', a, b) && (op < -5 || (rs < 0.4 && ai.caution > 0.5 && op < 20))) { this.cancel('alliance', a, b, a, false); continue; }
      if (!this.has('trade', a, b) && op > 5 - ai.trade * 10 && tribe.techs.includes('barter') && other.techs.includes('barter') && rng.chance(0.4)) { send({ type: 'trade' }); continue; }
      if (!this.has('nap', a, b) && !this.has('alliance', a, b) && border > 0 && op > -5 && rng.chance(0.25 * (1 - ai.aggression * 0.6))) { send({ type: 'nap' }); continue; }
      if (!this.has('alliance', a, b) && op > 35 - ai.diplomacy * 10 && rng.chance(0.2)) { send({ type: 'alliance' }); continue; }
      if (ai.diplomacy > 0.7 && op < 25 && op > -30 && rng.chance(0.08)) {
        const res = ['wood', 'grain', 'fish', 'stone', 'goods'].sort((x, y) => (tribe.stock[y] || 0) - (tribe.stock[x] || 0))[0];
        if ((tribe.stock[res] || 0) > 80) send({ type: 'gift', res, amt: 25 });
        continue;
      }
      if (ai.aggression > 0.7 && rs > 1.8 && op < 10 && !this.has('tribute', a, b) && rng.chance(0.1)) { send({ type: 'tribute' }); continue; }
      // advanced agreements, from strategic interest
      if (!this.has('access', a, b) && op > 10) {
        const transit = this.enemies(a).some(e => routeCrosses(g, a, e, b));   // their land lies on the road to an enemy
        if ((transit || (ai.trade > 0.6 && this.has('trade', a, b))) && rng.chance(transit ? 0.3 : 0.08)) { send({ type: 'access' }); continue; }
      }
      if (this.has('trade', a, b) && !this.has('exclusive', a, b) && ai.trade > 0.7 && this.partners(a).length === 1 && op > 25 && rng.chance(0.05)) { send({ type: 'exclusive' }); continue; }
      if (this.has('trade', a, b) && rng.chance(0.08) && !this.treaties.some(x => x.type === 'contract' && ((x.a === a && x.b === b) || (x.a === b && x.b === a)))) {
        const c = contractIdea(tribe, other); if (c) { send(c); continue; }
      }
    }
  }
}

// Does the straight road from a's capital to e's capital cross b's land?
function routeCrosses(g, a, e, b) {
  const A = g.settlements.get(g.tribes[a].capital), E = g.settlements.get(g.tribes[e].capital); if (!A || !E) return false;
  for (let i = 1; i < 16; i++) { const x = Math.round(A.x + (E.x - A.x) * i / 16), y = Math.round(A.y + (E.y - A.y) * i / 16); if (g.world.owner[y * g.world.w + x] === b) return true; }
  return false;
}
// A supply contract that trades our surplus for something we are short of.
function contractIdea(t, o) {
  const surplus = ['wood', 'stone', 'grain', 'fish', 'clay', 'fibre', 'tools'].filter(r => (t.stock[r] || 0) > 150).sort((x, y) => (t.stock[y] || 0) - (t.stock[x] || 0))[0];
  const need = ['stone', 'wood', 'iron', 'tools', 'grain', 'clay', 'herbs', 'salt'].filter(r => r !== surplus && scarcity(t, r) > 1.8 && (o.stock[r] || 0) > 120)[0];
  if (!surplus || !need) return null;
  return { type: 'contract', give: { [surplus]: 14 }, get: { [need]: 8 }, every: 5, times: 6 };
}

function acceptProposalLocal(g, pr) {
  const D = g.dip;
  switch (pr.p.type) {
    case 'trade': case 'nap': case 'alliance': case 'access': case 'exclusive': D.sign(pr.p.type, pr.from, pr.to); break;
    case 'offerTribute': D.sign('tribute', pr.from, pr.to, { payer: pr.from, until: g.tick + DAY_TICKS * 10 }); break;
    case 'contract': D.propose(pr.to, pr.from, { type: 'contract', give: pr.p.get, get: pr.p.give, every: pr.p.every, times: pr.p.times }); break;
    case 'peace': D.makePeace(pr.from, pr.to, pr.p.terms || 'white'); break;
    case 'tribute': D.sign('tribute', pr.from, pr.to, { payer: pr.to, until: g.tick + DAY_TICKS * 10 }); D.addMod(pr.from, pr.to, 'submitted', 8, { label: 'Paid us tribute', decay: 0.2 }); break;
    case 'exchange': D.propose(pr.to, pr.from, { type: 'exchange', give: pr.p.get, get: pr.p.give }); break;
    case 'gift': D.addMod(pr.to, pr.from, 'gift', 5, { label: 'Generous gifts', decay: 0.4 }); break;
  }
}
export { acceptProposalLocal };

function warReason(t, o, border) {
  if (border > 10) return 'over disputed borderlands';
  if (t.def?.warCry) return t.def.warCry;
  return 'citing intolerable provocations';
}

export function settlementDistance(g, a, b) {
  let best = 1e9;
  for (const s of g.settlements.values()) if (s.tribe === a) for (const o of g.settlements.values()) if (o.tribe === b) best = Math.min(best, Math.hypot(s.x - o.x, s.y - o.y));
  return best;
}

export function sharedBorder(g, a, b) {
  const key = a < b ? a * 8 + b : b * 8 + a;
  const c = g._borderCache;
  if (c && c.v === g.territoryVersion) return c.m[key] || 0;
  // count adjacent tile pairs owned by different tribes
  const w = g.world, m = {};
  for (let y = 0; y < w.h; y++) for (let x = 0; x < w.w - 1; x++) {
    const i = y * w.w + x; const o1 = w.owner[i], o2 = w.owner[i + 1], o3 = y < w.h - 1 ? w.owner[i + w.w] : -1;
    if (o1 >= 0 && o2 >= 0 && o1 !== o2) { const k = o1 < o2 ? o1 * 8 + o2 : o2 * 8 + o1; m[k] = (m[k] || 0) + 1; }
    if (o1 >= 0 && o3 >= 0 && o1 !== o3) { const k = o1 < o3 ? o1 * 8 + o3 : o3 * 8 + o1; m[k] = (m[k] || 0) + 1; }
  }
  g._borderCache = { v: g.territoryVersion, m };
  return m[key] || 0;
}

// ---------------------------------------------------------------- trade trips
// Traders carry goods to partners' settlements and return with profit.
export function tradeTrip(game, a, t) {
  const tribe = game.tribes[a.tribe];
  const partners = game.dip.partners(tribe.id).filter(p => game.tribes[p].alive);
  if (t.stage === 'start') {
    const wb = game.buildings.get(t.b);
    const critical = ['stone', 'wood', 'clay'].some(r => scarcity(tribe, r) > 2.2);
    if (!partners.length || (critical && game.rng.chance(0.5))) {
      // local barter at the market: turn surplus into scarce goods
      a.state = 'work'; a.timer = 70; a.task = { kind: 'barter', b: t.b }; a.hidden = false;
      localBarter(game, tribe, wb);
      return;
    }
    const pid = partners[(a.id + Math.floor(game.tick / 900)) % partners.length];
    const ps = game.settlements.get(game.tribes[pid].capital);
    if (!ps) { a.state = 'wait'; a.timer = 30; return; }
    a.carry = { goods: 1 };
    const dist = Math.hypot(ps.x - a.x, ps.y - a.y);
    // travel abstractly out of sight for long journeys
    a.state = 'travel'; a.hidden = true; a.timer = Math.min(300, dist * 4); a.travel = { then: 'returnHome', partner: pid };
    game.fx.push({ kind: 'caravan', x: a.x, y: a.y, tx: ps.x, ty: ps.y, t: 0, life: Math.min(30, dist * 0.4), tribe: tribe.id });
    return;
  }
  if (t.stage === 'back') {
    a.carry = null;
    const partner = game.tribes[t.partner];
    if (!partner || !partner.alive || !game.dip.has('trade', tribe.id, partner.id)) { a.state = 'think'; return; }
    const wb = a.workId != null ? game.buildings.get(a.workId) : null;
    const bonus = wb?.type === 'harbor' ? 0.4 : 0;
    // raiders on the road (risk from geography, war and how well the roads are guarded)
    if (game.rng.chance(caravanRisk(game, tribe.id, partner.id))) {
      tribe.stats.raided = (tribe.stats.raided || 0) + 1; ledger(game, { a: tribe.id, b: partner.id, kind: 'raid' });
      if (tribe.isPlayer && game.tick - (tribe._raidLog || -1e9) > DAY_TICKS * 3) { tribe._raidLog = game.tick; game.log(tribe, 'trade', `A caravan returning from the ${partner.name} was raided. Its goods are lost.`, 1, { with: partner.id, cat: 'trade' }); }
      a.state = 'think'; return;
    }
    const tariff = tribe.tariffRate || 0;
    if (tariff) game.dip.addMod(partner.id, tribe.id, 'tariff', -tariff * 0.6, { label: 'High tariffs', decay: 0.15, min: -tariff * 30 });
    const base = (wb && specOf(game, wb.sid) === 'trade' ? 1.3 : 1) * 5 * (1 + mod(tribe, 'trade') + bonus + tariff) * (tribe.productivity || 1) * (game.dip.has('exclusive', tribe.id, partner.id) ? 1.5 : 1);
    const ts = game.dip.tradeStats = game.dip.tradeStats || {}; const tk = tribe.id + ':' + partner.id; ts[tk] = (ts[tk] || 0) + 1;
    if (tribe.techs.includes('currency')) addRes(game, tribe, 'coins', base * 1.6 * (1 + mod(tribe, 'tariff')));
    else addRes(game, tribe, 'goods', base * 0.25);
    // exchange surpluses: each side receives something the other has in excess
    // bring home what we lack most among the partner's surpluses
    const give = topSurplus(tribe);
    let get = null, gv = 1.2;
    for (const r of ['stone', 'wood', 'clay', 'grain', 'fish', 'tools', 'iron', 'herbs', 'salt', 'fibre']) { if (r === give || (partner.stock[r] || 0) < 60) continue; const s = scarcity(tribe, r); if (s > gv) { gv = s; get = r; } }
    if (!get) get = topSurplus(partner, give);
    if (give && get) {
      const amt = 8;
      const g1 = takeRes(tribe, give, amt); addRes(game, partner, give, g1);
      const g2 = takeRes(partner, get, amt); addRes(game, tribe, get, g2);
    }
    if (partner.techs.includes('currency')) addRes(game, partner, 'coins', base * 0.6);
    game.dip.addMod(partner.id, tribe.id, 'trade', 0.3, { label: 'Profitable trade', decay: 0.1, max: 20 });
    remember(game, partner.id, tribe.id, 'trade', 0.25, 15);
    tribe.stats.tradeTrips = (tribe.stats.tradeTrips || 0) + 1;
    a.state = 'think';
  }
}

function topSurplus(t, exclude) {
  let best = null, bv = 0;
  for (const r of ['wood', 'stone', 'clay', 'fibre', 'grain', 'fish', 'meat', 'fruit', 'veg', 'herbs', 'salt', 'goods', 'tools']) {
    if (r === exclude) continue;
    const v = (t.stock[r] || 0) - 80;
    if (v > bv) { bv = v; best = r; }
  }
  return best;
}

function localBarter(game, tribe, wb) {
  const give = topSurplus(tribe);
  if (!give) { if (tribe.techs.includes('currency')) addRes(game, tribe, 'coins', 1); return; }
  let need = null, nv = 0;
  for (const r of ['grain', 'wood', 'stone', 'clay', 'tools', 'herbs', 'salt', 'fibre']) { if (r === give) continue; const s = scarcity(tribe, r); if (s > nv) { nv = s; need = r; } }
  const t = takeRes(tribe, give, 10);
  if (need) addRes(game, tribe, need, t * 0.5 * (1 + mod(tribe, 'trade')) * (RESOURCES[give].value / RESOURCES[need].value));
  if (tribe.techs.includes('currency')) addRes(game, tribe, 'coins', 1.5 * (1 + mod(tribe, 'trade')));
}
