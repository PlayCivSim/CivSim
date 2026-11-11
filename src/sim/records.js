// Shared record of timestamped world events. Every entry in game.history is
// one record: { seq, tick, day, tribe, type, text, imp, cat?, with? }.
// The chronicle, the notification centre and (later) the diplomatic inbox and
// AI memory all read from this one log, so new systems should record through
// game.log() rather than keep their own lists. `cat` and `with` are optional,
// so older saves load unchanged.

export const CATEGORIES = [
  { key: 'diplomacy', name: 'Diplomacy', icon: 'diplomacy', col: '#7aa8e0' },
  { key: 'trade', name: 'Trade', icon: 'coin', col: '#e0c060' },
  { key: 'war', name: 'War', icon: 'military', col: '#e05a48' },
  { key: 'production', name: 'Production', icon: 'build', col: '#9ccf6a' },
  { key: 'people', name: 'People', icon: 'population', col: '#d89ad0' },
  { key: 'world', name: 'World', icon: 'scroll', col: '#b8b0a0' },
];
const TYPE_CAT = {
  war: 'war', diplomacy: 'diplomacy', trade: 'trade', tech: 'production', build: 'production', wonder: 'production',
  stage: 'production', economy: 'production', population: 'people', government: 'people', law: 'people',
  settlement: 'world', event: 'world', world: 'world',
};
export const categoryOf = e => e.cat || TYPE_CAT[e.type] || 'world';

// Does this record concern tribe `id` (as actor or counterpart)?
export function involves(e, id) {
  if (e.tribe === id) return true;
  const w = e.with;
  return w === id || (Array.isArray(w) && w.includes(id));
}
// Alerts are records that demand attention; everything else is an ordinary notice.
export const isAlert = (e, id) => e.alert || (e.imp >= 3 && involves(e, id)) || (categoryOf(e) === 'war' && involves(e, id));
