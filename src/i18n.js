// Text lookup for translation. New interface text should be added here and
// read with t('key', { vars }) instead of being written inline, so another
// language can be added by supplying a table with the same keys.
// Untranslated keys fall back to English, then to the key itself.

const EN = {
  // contextual hints
  'hint.fog.title': 'The world beyond your borders',
  'hint.fog.text': 'Dark land is unexplored. Your people uncover it as they move; scouts reveal distant homelands. What you know of other peoples starts as rumour: the badges in Diplomacy show how reliable and how old each report is.',
  'hint.envoy.title': 'Envoys take time',
  'hint.envoy.text': 'Your envoy is on the road. Their answer arrives only when the envoy does. Follow the journey under Missions abroad in Diplomacy; roads through hostile lands are slower and riskier.',
  'hint.delay.title': 'An envoy is delayed',
  'hint.delay.text': 'Weather and bad roads delay travellers. The reason is shown under Missions abroad. If no word comes two days after the expected arrival, the envoy is presumed lost.',
  'hint.lost.title': 'A mission was lost',
  'hint.lost.text': 'Risk depends on distance, war, hostility and which lands the road crosses. Border Access treaties halve it. Anything the mission carried is lost with it.',
  'hint.intel.title': 'Reliable information',
  'hint.intel.text': 'Unknown → Rumoured → Reported → Verified. Rumours are vague, reports may be false (rival agents plant them), and only your own scouts and agents verify. Reports grow stale: a Verified count becomes Reported after about 12 days.',
  'hint.scout.title': 'Scouting',
  'hint.scout.text': 'Scouts map a people’s settlements and count their warriors, giving Verified military and land reports. Rival armies and town defences are hidden until you know them.',
  'hint.supply.title': 'Supply lines',
  'hint.supply.text': 'Armies far from friendly land run short of supplies and lose strength; below half supply soldiers fall sick and desert. Fight close to home, use roads, sign Border Access or make a nearby town a Military town.',
  'hint.trade.title': 'Trade deals',
  'hint.trade.text': 'Deals show what you give, what you receive, delivery time and risk. If a people refuses, they may counter with terms they would accept. Ongoing contracts deliver every few days; breaking one costs reputation.',
  'hint.coalition.title': 'A coalition forms',
  'hint.coalition.text': 'When one people grows far stronger than the rest, the others band together. Coalition members support each other in war against the leader. Diplomacy and gifts can split them.',
  'hint.war.title': 'War',
  'hint.war.text': 'Wars without a just cause (an insult, an ignored ultimatum, caught saboteurs) cost reputation with every people. Check the Military panel for supply, and Diplomacy for peace terms.',
  'hint.spec.title': 'Town focus',
  'hint.spec.text': 'Each settlement can focus on Production, Trade, Military or Culture in Overview. A focus speeds some work and slows the rest, so different towns can play different roles.',
  'hint.got': 'Got it',
  'hint.off': 'Turn off tips',
  // advisor
  'adv.staleIntel': 'Your knowledge of the {name} army is {age} — they may be stronger now.',
  'adv.noIntel': 'You know nothing reliable about the {name} army, and they are hostile.',
  'adv.supply': 'An army is short of supplies ({pct}%): it is losing strength and men.',
  'adv.contract': 'You may not have enough {res} for your next contract delivery to the {name}.',
  'adv.coins': 'Your treasury is shrinking: {rate} coins a day.',
  'adv.envoyLate': 'No word from your envoy to the {name}; they are overdue.',
  // encyclopedia
  'help.title': 'Encyclopedia',
  'help.sub': 'How the world works',
  'help.search': 'Search the encyclopedia…',
};
const TABLES = { en: EN };
let lang = 'en';
export function setLanguage(code) { if (TABLES[code]) lang = code; }
export function addLanguage(code, table) { TABLES[code] = table; }
export function t(key, vars) {
  let s = TABLES[lang]?.[key] ?? EN[key] ?? key;
  if (vars) s = s.replace(/\{(\w+)\}/g, (_, k) => vars[k] ?? '');
  return s;
}
