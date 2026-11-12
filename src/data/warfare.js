// Warfare: unit types, armour, damage types and battle plans.
// Units follow a simple triangle (spears hold swords, swords cut down archers,
// archers shoot down spear lines) plus siege engines and sappers for walls.

export const DMG = ['blunt', 'pierce', 'slash', 'fire', 'blast'];

export const UNITS = {
  warrior: { name: 'Warriors', icon: 'soldier', tech: null, dmg: 'blunt', melee: 1, speed: 1, desc: 'Clubs and hand axes. Anyone can fight this way.' },
  spear:   { name: 'Spearmen', icon: 'soldier', tech: 'spearcraft', dmg: 'pierce', melee: 1.05, reach: 1.25, speed: 1, vs: { sword: 1.35, treb: 1.3 }, def: 1.15, desc: 'Long spears in a bristling line. Hold the line against swordsmen.' },
  archer:  { name: 'Archers', icon: 'soldier', tech: 'archery', dmg: 'pierce', melee: 0.5, range: 4.5, ranged: 0.75, speed: 1.05, vs: { spear: 1.4 }, def: 0.85, desc: 'Shoot from behind the line. Deadly to spear lines, weak up close.' },
  sword:   { name: 'Swordsmen', icon: 'soldier', tech: 'bronzeweapons', dmg: 'slash', melee: 1.25, speed: 1, vs: { archer: 1.45, warrior: 1.2 }, desc: 'Blades and shields. Cut down archers and skirmishers.' },
  treb:    { name: 'Trebuchets', icon: 'military', tech: 'siegeengines', dmg: 'blunt', melee: 0.2, range: 9, siege: 9, speed: 0.6, def: 0.7, cost: { wood: 25 }, desc: 'Counterweight engines that batter walls from far away. Slow and helpless up close.' },
  sapper:  { name: 'Sappers', icon: 'military', tech: 'explosives', dmg: 'blast', melee: 0.6, speed: 1, def: 0.8, cost: { coal: 3, salt: 2 }, desc: 'Carry powder charges to the walls. One huge blast each.' },
};
export const UNIT_KEYS = Object.keys(UNITS);
export const LINE_UNITS = ['warrior', 'spear', 'archer', 'sword'];

// Damage taken per damage type (1 = full), speed and other effects.
export const ARMOURS = {
  none:  { name: 'No armour', tech: null, take: {}, speed: 1, desc: 'Fast and cheap, but every blow lands.' },
  hide:  { name: 'Hide & leather', tech: 'hidearmour', take: { pierce: 0.8, slash: 0.9, fire: 1.2 }, speed: 1, desc: 'Turns arrows a little. Burns easily.' },
  scale: { name: 'Bronze scale', tech: 'bronzeweapons', take: { pierce: 0.85, slash: 0.75, blunt: 0.95 }, speed: 0.95, desc: 'Good against blades. A little heavy.' },
  mail:  { name: 'Iron mail', tech: 'ironweapons', take: { pierce: 0.8, slash: 0.6, blunt: 1.05, blast: 1.05 }, speed: 0.9, desc: 'Excellent against blades, poor against clubs and stones.' },
  plate: { name: 'Steel plate', tech: 'steelarms', take: { pierce: 0.55, slash: 0.45, blunt: 0.8, fire: 0.9, blast: 0.9 }, speed: 0.8, hot: 0.8, desc: 'Near-proof against arrows and blades. Slow, and soldiers wilt in hot lands.' },
};
export const ARMOUR_KEYS = Object.keys(ARMOURS);

export const APPROACHES = {
  direct: { name: 'Head-on', angle: 0, bonus: 1, desc: 'The shortest road. No surprise.' },
  left:   { name: 'Left flank', angle: 75, bonus: 1.12, desc: 'Swing round and strike their side. Longer march, better blows.' },
  right:  { name: 'Right flank', angle: -75, bonus: 1.12, desc: 'Swing round and strike their side. Longer march, better blows.' },
  rear:   { name: 'From the rear', angle: 180, bonus: 1.25, desc: 'Circle right round. The longest march, the hardest strike.' },
  surround: { name: 'Surround', angle: null, bonus: 1.05, desc: 'Spread out on every side. Wounded defenders cannot slip away.' },
};
export const FOCUS = {
  auto:    { name: 'Commander decides', desc: 'Towers first, then the hearth.' },
  army:    { name: 'Their soldiers', desc: 'Hunt down defenders before touching buildings.' },
  towers:  { name: 'Defences', desc: 'Knock down towers and forts first.' },
  hearth:  { name: 'The hearth', desc: 'Go straight for the town centre to capture it fast.' },
  stores:  { name: 'Stores & industry', desc: 'Burn storehouses, workshops and farms to cripple them.' },
  homes:   { name: 'Homes', desc: 'Raze houses. Cruel, and their neighbours will remember.' },
};
export const LEADS = {
  together: { name: 'All at once', desc: 'Everyone charges together.' },
  spear: { name: 'Spearmen first', desc: 'A spear wall goes in first; the rest follow.' },
  sword: { name: 'Swordsmen first', desc: 'Shield wall leads the assault.' },
  warrior: { name: 'Warriors first', desc: 'Expendable warriors soak up the first blows.' },
  archer: { name: 'Archers first', desc: 'Volleys soften them up before the melee.' },
  siege: { name: 'Bombard first', desc: 'Engines and sappers break the walls before the charge.' },
};

export const hasTech = (tribe, k) => !k || (tribe.techs && (tribe.techs.has ? tribe.techs.has(k) : tribe.techs.includes(k)));
export const unitOk = (tribe, u) => !!UNITS[u] && hasTech(tribe, UNITS[u].tech);
export const armourOk = (tribe, k) => !!ARMOURS[k] && hasTech(tribe, ARMOURS[k].tech);
export function bestArmour(tribe) { let b = 'none'; for (const k of ARMOUR_KEYS) if (armourOk(tribe, k)) b = k; return b; }
export function armourOf(tribe) { return tribe.armour && armourOk(tribe, tribe.armour) ? tribe.armour : bestArmour(tribe); }

// What a soldier at home fights as: a mix of what the tribe knows.
export function defaultUnit(tribe, a) {
  const opts = LINE_UNITS.filter(u => u !== 'warrior' && unitOk(tribe, u));
  if (!opts.length) return 'warrior';
  return opts[(a.id * 7 + 3) % opts.length];
}
export function unitOf(tribe, a) { return a.unit && UNITS[a.unit] ? a.unit : defaultUnit(tribe, a); }

// A sensible plan for the AI, or as the planner's starting point.
export function autoPlan(tribe, target, game) {
  const mix = {};
  for (const u of LINE_UNITS) if (unitOk(tribe, u)) mix[u] = u === 'warrior' ? 1 : 2;
  if (Object.keys(mix).length > 1) delete mix.warrior;
  let siege = 0, sappers = 0;
  if (target && game) {
    let defences = 0; for (const bid of target.buildings || []) { const b = game.buildings.get(bid); if (b && (b.type === 'tower' || b.type === 'fort')) defences++; }
    if (unitOk(tribe, 'treb') && (tribe.stock.wood || 0) > 120) siege = Math.min(3, 1 + defences);
    if (unitOk(tribe, 'sapper') && (tribe.stock.coal || 0) > 10 && (tribe.stock.salt || 0) > 6) sappers = defences ? 2 : 1;
  }
  return { mix, siege, sappers, approach: 'direct', focus: 'auto', lead: siege || sappers ? 'siege' : 'together' };
}
