// Contextual tips: a short card the first time a player meets a system.
// Each tip shows once per browser (settings.hintsSeen) and never pauses the
// game. Triggers look at the shared event record and the mirror only.
import { esc } from './dom.js';
import { ico } from './icons.js';
import { t } from '../i18n.js';
import { sfx } from '../audio/audio.js';

const ICON = { fog: 'eye', envoy: 'scroll', delay: 'scroll', lost: 'warning', intel: 'eye', scout: 'eye', supply: 'military', trade: 'coin', coalition: 'diplomacy', war: 'military', spec: 'house' };

export class Hints {
  constructor(app) { this.app = app; this.queue = []; this.el = null; }
  get s() { return this.app.settings; }
  seen(k) { return (this.s.hintsSeen || []).includes(k); }
  show(k) {
    if (this.s.hints === false || this.seen(k) || this.queue.includes(k) || this.cur === k) return;
    if (this.app.game?.tutorial) return;
    this.queue.push(k); this.next();
  }
  next() {
    if (this.el || !this.queue.length) return;
    const k = this.cur = this.queue.shift();
    this.s.hintsSeen = [...(this.s.hintsSeen || []), k]; this.app.applySettings();
    const el = this.el = document.createElement('div');
    el.className = 'hint-card parch';
    el.innerHTML = `<div class="row" style="gap:8px;align-items:flex-start">${ico(ICON[k] || 'scroll', 'lg')}<div style="flex:1"><div class="caps" style="color:var(--parch-dim)">Tip</div><div class="hint-title">${esc(t(`hint.${k}.title`))}</div><div class="hint-text">${esc(t(`hint.${k}.text`))}</div></div></div>
      <div class="row" style="justify-content:flex-end;gap:6px;margin-top:6px"><button class="btn xs" data-h="off">${esc(t('hint.off'))}</button><button class="btn xs primary" data-h="ok">${esc(t('hint.got'))}</button></div>`;
    el.onclick = e => { const b = e.target.closest('[data-h]'); if (!b) return; sfx('click'); if (b.dataset.h === 'off') { this.s.hints = false; this.app.applySettings(); this.queue = []; } this.close(); };
    document.body.appendChild(el);
    sfx('open');
  }
  close() { this.el?.remove(); this.el = null; this.cur = null; setTimeout(() => this.next(), 800); }
  reset() { this.el?.remove(); this.el = null; this.queue = []; this.cur = null; }

  // Called with each new event record (game.log entries).
  onRecord(g, e) {
    const P = g.playerId;
    if (e.tribe === P && /sent an envoy/.test(e.text)) this.show('envoy');
    if (e.tribe === P && /sent a scout/.test(e.text)) this.show('scout');
    if (e.tribe === P && /never returned/.test(e.text)) this.show('lost');
    if (/supplies/.test(e.text) && e.tribe === P) this.show('supply');
    if (/coalition/.test(e.text) && !/dissolved/.test(e.text)) this.show('coalition');
    if (e.type === 'war' && /declared war/.test(e.text) && (e.tribe === P || e.with === P)) this.show('war');
    if (/settlement/.test(e.type) && e.tribe === P && /founded/.test(e.text) && g.player.settlements.length > 1) this.show('spec');
  }
  // Called a few times a second while playing.
  check(g, panel) {
    if (g.fog && g.day >= 0) this.show('fog');
    if (panel === 'diplomacy' && g.fog) this.show('intel');
    if (panel === 'economy' || (panel === 'diplomacy' && g.player.techs.includes('barter'))) { if (g.player.techs.includes('barter')) this.show('trade'); }
    if ((g.dip.missions || []).some(m => m.from === g.playerId && m.notes?.some(n => /Delayed/.test(n.text)))) this.show('delay');
  }
}
