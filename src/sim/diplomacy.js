// Diplomacy: opinions built from decaying modifiers, treaties, wars,
// proposals with explainable acceptance, AI diplomatic reasoning and trade.
import { RESOURCES } from '../data/resources.js';
import { mod, addRes, takeRes, scarcity } from './economy.js';
import { militaryStrength } from './military.js';
import { doorTile, centreOf } from './buildings.js';
import { DAY_TICKS } from '../core/constants.js';

const COMPAT = {
  'oruvai-thalori': 10, 'oruvai-vaelith': 5, 'kharvak-oruvai': -6, 'kharvak-thalori': -4, 'kharvak-vaelith': -8, 'thalori-vaelith': 0,
};
const compat = (a, b) => COMPAT[[a, b].sort().join('-')] || 0;

export const TREATY_NAMES = { trade: 'Trade Agreement', nap: 'Non-Aggression Pact', alliance: 'Alliance', tribute: 'Tribute' };

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
    return Math.max(-100, Math.min(100, v));
  }
  breakdown(a, b) {
    const ta = this.game.tribes[a], tb = this.game.tribes[b];
    const out = [];
    const c = compat(ta.key, tb.key); if (c) out.push({ label: c > 0 ? 'Kindred cultures' : 'Clashing cultures', v: c });
    if (Math.abs(this.reputation[b]) >= 1) out.push({ label: this.reputation[b] > 0 ? 'Trustworthy reputation' : 'Untrustworthy reputation', v: this.reputation[b] * 0.5 });
    for (const m of this.mods[a][b]) if (Math.abs(m.v) >= 0.5) out.push({ label: m.label, v: m.v });
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
    if (type !== 'tribute') g.log(ta, 'diplomacy', `${ta.name} and ${tb.name} signed a ${TREATY_NAMES[type]}.`, (ta.isPlayer || tb.isPlayer) ? 2 : 1);
    g.bus.emit('treaty', { type, a, b });
  }
  cancel(type, a, b, by = a, broken = false) {
    const before = this.treaties.length;
    this.treaties = this.treaties.filter(t => !(t.type === type && ((t.a === a && t.b === b) || (t.a === b && t.b === a))));
    if (this.treaties.length === before) return;
    const g = this.game; const other = by === a ? b : a;
    if (broken) {
      this.reputation[by] -= type === 'alliance' ? 12 : 7;
      this.addMod(other, by, 'betrayal', -30, { label: 'Broke a treaty with us', decay: 0.2 });
    } else this.addMod(other, by, 'cancelled', -8, { label: 'Ended a treaty', decay: 0.4 });
    g.log(g.tribes[by], 'diplomacy', `${g.tribes[by].name} ${broken ? 'broke' : 'ended'} the ${TREATY_NAMES[type]} with the ${g.tribes[other].name}.`, 2);
  }

  declareWar(a, b, reason = '') {
    if (this.atWar(a, b) || a === b) return;
    const g = this.game, ta = g.tribes[a], tb = g.tribes[b];
    for (const type of ['nap', 'alliance', 'trade']) if (this.has(type, a, b)) this.cancel(type, a, b, a, type !== 'trade');
    this.treaties = this.treaties.filter(t => !(t.type === 'tribute' && ((t.a === a && t.b === b) || (t.a === b && t.b === a))));
    this.wars.push({ a, b, start: g.tick, score: { [a]: 0, [b]: 0 }, reason });
    this.addMod(b, a, 'war', -40, { label: 'At war with us', decay: 0.3, min: -60 });
    this.addMod(a, b, 'war', -20, { label: 'At war with us', decay: 0.3, min: -60 });
    ta.atWar = tb.atWar = true;
    g.log(ta, 'war', `${ta.name} declared war on the ${tb.name}${reason ? ' — ' + reason : ''}.`, 3);
    g.bus.emit('war', { a, b });
    // allies are called to arms
    for (const ally of this.allies(b)) {
      if (ally === a || this.atWar(ally, a)) continue;
      const t = g.tribes[ally];
      const loyal = t.isPlayer ? false : (t.def.ai.loyalty * 0.7 + this.opinion(ally, b) / 150 - this.opinion(ally, a) / 300 > 0.45);
      if (t.isPlayer) g.bus.emit('allyCall', { ally, victim: b, aggressor: a });
      else if (loyal) this.declareWar(ally, a, `honouring their alliance with the ${tb.name}`);
      else { this.cancel('alliance', ally, b, ally, true); }
    }
  }
  makePeace(a, b, terms = 'white') {
    const w = this.war(a, b); if (!w) return;
    const g = this.game, ta = g.tribes[a], tb = g.tribes[b];
    this.wars = this.wars.filter(x => x !== w);
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
    g.log(ta, 'war', `${ta.name} and ${tb.name} agreed to ${tt}.`, 3);
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
        if (d < 55 || g.day > 10) { this.contact[a][b] = this.contact[b][a] = true; if (a < b) g.log(ta, 'diplomacy', `The ${ta.name} made first contact with the ${tb.name}.`, ta.isPlayer || tb.isPlayer ? 2 : 1); }
        continue;
      }
      // borders
      const border = sharedBorder(g, a, b);
      if (border > 0) this.addMod(a, b, 'border', -0.25 - border * 0.01, { label: 'Border tensions', decay: 0.05, min: -20 });
      if (this.has('trade', a, b)) this.addMod(a, b, 'trade', 0.6 * (1 + mod(ta, 'relationTrade')), { label: 'Profitable trade', decay: 0.1, max: 20 });
      // common enemies bring tribes together
      const ce = this.enemies(a).filter(e => this.atWar(b, e));
      if (ce.length) this.addMod(a, b, 'common_enemy', 0.8, { label: 'Common enemy', decay: 0.3, max: 18 });
      // fear of powerful, aggressive neighbours
      const ratio = (tb.strength + 1) / (ta.strength + 1);
      if (ratio > 1.8 && tb.def.ai.aggression > 0.5 && border > 0) this.addMod(a, b, 'fear', -0.3, { label: 'Fears our military', decay: 0.2, min: -12 });
      if (this.atWar(a, b)) this.addMod(a, b, 'war', -0.2, { label: 'At war with us', decay: 0.3, min: -60 });
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
      t.warWeariness = t.atWar ? Math.min(100, (t.warWeariness || 0) + 1.6 * (t.key === 'kharvak' ? 0.6 : 1)) : Math.max(0, (t.warWeariness || 0) - 3);
    }
    for (let i = 0; i < T.length; i++) this.reputation[i] = this.reputation[i] * 0.99;
  }

  // ---------------------------------------------------------------- proposals
  evaluate(from, to, p) {
    const g = this.game, tf = g.tribes[from], tt = g.tribes[to];
    const op = this.opinion(to, from);
    const ai = tt.def.ai;
    const reasons = [];
    let score = 0;
    const add = (v, label) => { score += v; if (Math.abs(v) >= 1) reasons.push({ v: Math.round(v), label }); };
    if (!this.contact[from][to]) return { accept: false, score: -100, reasons: [{ v: -100, label: 'They have not met you' }] };
    add(op * 0.5, 'Opinion of you');
    const rs = (tf.strength + 1) / (tt.strength + 1);
    switch (p.type) {
      case 'trade':
        if (!tt.techs.includes('barter') || !tf.techs.includes('barter')) return { accept: false, score: -100, reasons: [{ v: -100, label: 'Both must know Barter' }] };
        if (this.atWar(from, to)) return { accept: false, score: -100, reasons: [{ v: -100, label: 'You are at war' }] };
        add(10 + ai.trade * 15, 'Values commerce'); break;
      case 'nap':
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
      if (p.type === 'tribute') this.addMod(to, from, 'demand', -10, { label: 'Made insulting demands', decay: 0.4 });
      return ev;
    }
    switch (p.type) {
      case 'trade': case 'nap': case 'alliance': this.sign(p.type, from, to); break;
      case 'peace': this.makePeace(from, to, p.terms || 'white'); break;
      case 'gift': {
        takeRes(tf, p.res, p.amt); addRes(g, tt, p.res, p.amt);
        const v = Math.min(25, 3 + Math.sqrt(p._value || 10) * 1.4);
        this.addMod(to, from, 'gift', v, { label: 'Generous gifts', decay: 0.4, max: 30 });
        g.log(tf, 'diplomacy', `${tf.name} sent a gift of ${Math.round(p.amt)} ${RESOURCES[p.res].name} to the ${tt.name}.`, 1);
        break;
      }
      case 'exchange':
        for (const [r, v] of Object.entries(p.give || {})) { takeRes(tf, r, v); addRes(g, tt, r, v); }
        for (const [r, v] of Object.entries(p.get || {})) { takeRes(tt, r, v); addRes(g, tf, r, v); }
        this.addMod(to, from, 'exchange', 2, { label: 'Fair dealings', decay: 0.2, max: 10 });
        g.log(tf, 'diplomacy', `${tf.name} and ${tt.name} exchanged goods.`, 1);
        break;
      case 'tribute':
        this.sign('tribute', from, to, { payer: to, until: g.tick + DAY_TICKS * 10 });
        this.addMod(to, from, 'extortion', -15, { label: 'Extorted tribute', decay: 0.25 });
        g.log(tf, 'diplomacy', `The ${tt.name} agreed to pay tribute to the ${tf.name}.`, 2);
        break;
    }
    return ev;
  }

  // ---------------------------------------------------------------- AI
  aiThink(tribe) {
    const g = this.game, ai = tribe.def.ai, rng = g.rng;
    for (const other of g.tribes) {
      if (other === tribe || !other.alive || !this.contact[tribe.id][other.id]) continue;
      const a = tribe.id, b = other.id;
      const op = this.opinion(a, b);
      const since = g.tick - this.lastProposal[a][b];
      const canPropose = since > DAY_TICKS * 2;
      const rs = (tribe.strength + 1) / (other.strength + 1);
      const atWar = this.atWar(a, b);
      const send = (p) => {
        this.lastProposal[a][b] = g.tick;
        if (other.isPlayer && p.type !== 'gift') { g.bus.emit('proposal', { from: a, to: b, p }); g.pendingProposals.push({ from: a, to: b, p, tick: g.tick }); return; }
        const r = this.propose(a, b, p);
        if (other.isPlayer && p.type === 'gift' && r.accept) g.bus.emit('proposal', { from: a, to: b, p });
      };
      if (atWar) {
        const w = this.war(a, b);
        const myS = w.score[a] || 0, theirS = w.score[b] || 0;
        const days = (g.tick - w.start) / DAY_TICKS;
        const wantPeace = (tribe.warWeariness || 0) * 0.5 + (theirS - myS) * 0.6 - ai.aggression * 20 + (rs < 0.8 ? 15 : 0) + days;
        // a clear victor dictates terms once the point is made
        const victor = myS - theirS > 40 && days > 5;
        if ((wantPeace > 25 || victor) && canPropose) send({ type: 'peace', terms: theirS - myS > 25 ? 'tribute_a' : myS - theirS > 25 ? 'tribute_b' : 'white' });
        continue;
      }
      // war consideration
      const border = sharedBorder(g, a, b);
      let warDesire = ai.aggression * 30 + Math.min(25, (rs - 1) * 25 * ai.aggression * 1.6) - op * 0.6 - ai.caution * 15 + (border > 0 ? 8 + Math.min(10, border * 0.1) : -10);
      if (op > -10 && ai.aggression < 0.6) warDesire -= 25; // peaceful peoples need a grievance
      if (this.enemies(b).length) warDesire -= 20 * (1 - ai.aggression); // reluctant to dog-pile
      if (this.has('nap', a, b)) warDesire -= 30 * ai.loyalty + 10;
      if (this.has('alliance', a, b)) warDesire -= 60;
      if (this.has('trade', a, b)) warDesire -= 10 * ai.trade;
      if (this.enemies(a).length) warDesire -= 25;
      if (tribe.stage < 2 || g.day < 25) warDesire -= 60;
      if ((this.truce?.[a * 8 + b] || 0) > g.tick || (this.truce?.[b * 8 + a] || 0) > g.tick) continue;
      if ((tribe.jobCounts?.soldier || 0) < 8) warDesire -= 30;
      if (rs < 1.35) warDesire -= 30; // recognise weakness
      if (other.isPlayer) warDesire += g.difficultyDef.aiBonus * 30;
      if (warDesire > 22 && rng.chance(0.25)) { this.declareWar(a, b, warReason(tribe, other, border)); continue; }
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
    }
  }
}

function warReason(t, o, border) {
  if (border > 10) return 'over disputed borderlands';
  if (t.key === 'kharvak') return 'to prove Kharvaki might';
  if (t.key === 'vaelith') return 'to secure valuable resources';
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
    if (!partners.length) {
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
    const base = 5 * (1 + mod(tribe, 'trade') + bonus) * (tribe.productivity || 1);
    if (tribe.techs.includes('currency')) addRes(game, tribe, 'coins', base * 1.6 * (1 + mod(tribe, 'tariff')));
    else addRes(game, tribe, 'goods', base * 0.25);
    // exchange surpluses: each side receives something the other has in excess
    const give = topSurplus(tribe), get = topSurplus(partner, give);
    if (give && get) {
      const amt = 6;
      const g1 = takeRes(tribe, give, amt); addRes(game, partner, give, g1);
      const g2 = takeRes(partner, get, amt); addRes(game, tribe, get, g2);
    }
    if (partner.techs.includes('currency')) addRes(game, partner, 'coins', base * 0.6);
    game.dip.addMod(partner.id, tribe.id, 'trade', 0.3, { label: 'Profitable trade', decay: 0.1, max: 20 });
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
  const t = takeRes(tribe, give, 6);
  if (need) addRes(game, tribe, need, t * 0.5 * (1 + mod(tribe, 'trade')) * (RESOURCES[give].value / RESOURCES[need].value));
  if (tribe.techs.includes('currency')) addRes(game, tribe, 'coins', 1.5 * (1 + mod(tribe, 'trade')));
}
