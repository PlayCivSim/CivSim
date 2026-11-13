// The calendar: a real 365-day year with months, mapped onto the simulation's
// four turns of the year. Each simulation day (36 s at normal speed) is one
// season, roughly three months, so dates advance about four calendar days per
// in-game second. Spring opens on 1 March, as in the northern hemisphere.
import { DAY_TICKS, DAYS_PER_YEAR } from './constants.js';

export const CAL_DAYS = 365;
const MONTHS = [['January', 31], ['February', 28], ['March', 31], ['April', 30], ['May', 31], ['June', 30], ['July', 31], ['August', 31], ['September', 30], ['October', 31], ['November', 30], ['December', 31]];
export const DAYS_PER_SIMDAY = CAL_DAYS / DAYS_PER_YEAR; // ~91 calendar days per simulation day
const SPRING_START = 59; // 1 March, counted from 1 January

// calendar date for a tick: { day, month, monthName, yearDay }
export function dateAt(tick) {
  const yearTicks = DAY_TICKS * DAYS_PER_YEAR;
  const f = ((tick % yearTicks) + yearTicks) % yearTicks / yearTicks;
  let yd = (Math.floor(f * CAL_DAYS) + SPRING_START) % CAL_DAYS;
  const yearDay = yd;
  let m = 0; while (yd >= MONTHS[m][1]) { yd -= MONTHS[m][1]; m++; }
  return { day: yd + 1, month: m, monthName: MONTHS[m][0], yearDay };
}
export const fmtDate = tick => { const d = dateAt(tick); return `${d.day} ${d.monthName}`; };
export const fmtDateShort = tick => { const d = dateAt(tick); return `${d.day} ${d.monthName.slice(0, 3)}`; };

// a span measured in simulation days, in calendar words: "about 3 weeks", "6 months", "2 years"
export function dur(simDays, about = false) {
  const d = simDays * DAYS_PER_SIMDAY;
  const pre = about ? 'about ' : '';
  if (d < 1.5) return pre + '1 day';
  if (d < 13) return pre + Math.round(d) + ' days';
  if (d < 50) { const w = Math.round(d / 7); return pre + w + (w === 1 ? ' week' : ' weeks'); }
  if (d < 330) { const m = Math.round(d / 30.4); return pre + m + (m === 1 ? ' month' : ' months'); }
  const y = Math.round(d / 365 * 2) / 2;
  return pre + (y === 1 ? '1 year' : `${y % 1 ? Math.floor(y) + '½' : y} years`);
}
// how long ago, from simulation days
export function agoText(simDays) { return simDays <= 0 ? 'this season' : simDays === 1 ? 'last season' : dur(simDays) + ' ago'; }
