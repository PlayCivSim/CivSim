// Resource catalogue. `cat` drives UI grouping, `food` marks edible goods,
// `value` drives trade pricing and AI valuation.

export const RESOURCES = {
  wood:    { name: 'Wood',     cat: 'basic',    value: 1,   tier: 0 },
  stone:   { name: 'Stone',    cat: 'basic',    value: 1.4, tier: 0 },
  clay:    { name: 'Clay',     cat: 'basic',    value: 1.2, tier: 0 },
  fibre:   { name: 'Fibre',    cat: 'basic',    value: 1,   tier: 0 },
  grain:   { name: 'Grain',    cat: 'food',     value: 1,   food: true },
  meat:    { name: 'Meat',     cat: 'food',     value: 1.4, food: true },
  fish:    { name: 'Fish',     cat: 'food',     value: 1.2, food: true },
  fruit:   { name: 'Fruit',    cat: 'food',     value: 1.1, food: true },
  veg:     { name: 'Vegetables', cat: 'food',   value: 1.2, food: true },
  livestock:{ name: 'Livestock', cat: 'other',  value: 4 },
  iron:    { name: 'Iron Ore', cat: 'mineral',  value: 3, tier: 1 },
  copper:  { name: 'Copper',   cat: 'mineral',  value: 2.6, tier: 1 },
  coal:    { name: 'Coal',     cat: 'mineral',  value: 2.5, tier: 1 },
  silver:  { name: 'Silver',   cat: 'mineral',  value: 6, tier: 1 },
  gold:    { name: 'Gold',     cat: 'mineral',  value: 10, tier: 2 },
  gems:    { name: 'Gems',     cat: 'advanced', value: 14, tier: 2 },
  oil:     { name: 'Oil',      cat: 'advanced', value: 8, tier: 2 },
  salt:    { name: 'Salt',     cat: 'other',    value: 3 },
  herbs:   { name: 'Herbs',    cat: 'other',    value: 2.5 },
  tools:   { name: 'Tools',    cat: 'other',    value: 5 },
  weapons: { name: 'Weapons',  cat: 'other',    value: 7 },
  steel:   { name: 'Steel',    cat: 'advanced', value: 9 },
  goods:   { name: 'Trade Goods', cat: 'other', value: 6 },
  machinery:{ name: 'Machinery', cat: 'advanced', value: 18 },
  coins:   { name: 'Coins',    cat: 'other',    value: 1 },
};

export const RES_KEYS = Object.keys(RESOURCES);
export const FOOD_KEYS = RES_KEYS.filter(k => RESOURCES[k].food);

export const RES_CATEGORIES = [
  { key: 'basic', name: 'Basic Materials' },
  { key: 'food', name: 'Food' },
  { key: 'mineral', name: 'Minerals' },
  { key: 'advanced', name: 'Advanced Materials' },
  { key: 'other', name: 'Goods & Other' },
];

// Underground/surface deposits found on tiles.
export const DEPOSITS = [
  null,
  { key: 'stone',  res: 'stone',  tech: 'stoneworking', amount: [700, 1400], color: '#9a958a', name: 'Stone outcrop' },
  { key: 'clay',   res: 'clay',   tech: 'stoneworking', amount: [500, 1000], color: '#b8714a', name: 'Clay bed' },
  { key: 'iron',   res: 'iron',   tech: 'mining',       amount: [500, 1100], color: '#a4624a', name: 'Iron vein' },
  { key: 'copper', res: 'copper', tech: 'mining',       amount: [400, 900],  color: '#4fa58f', name: 'Copper vein' },
  { key: 'coal',   res: 'coal',   tech: 'deepmining',   amount: [500, 1200], color: '#2a2a2e', name: 'Coal seam' },
  { key: 'silver', res: 'silver', tech: 'prospecting',  amount: [250, 600],  color: '#d6dbe4', name: 'Silver lode' },
  { key: 'gold',   res: 'gold',   tech: 'prospecting',  amount: [200, 450],  color: '#f2c84b', name: 'Gold lode' },
  { key: 'gems',   res: 'gems',   tech: 'deepmining',   amount: [120, 300],  color: '#e05ad8', name: 'Gem pocket' },
  { key: 'oil',    res: 'oil',    tech: 'industrialextraction', amount: [800, 1600], color: '#141018', name: 'Oil seep' },
  { key: 'salt',   res: 'salt',   tech: 'stoneworking', amount: [400, 900],  color: '#efe9de', name: 'Salt flat' },
];
export const DEP = Object.fromEntries(DEPOSITS.map((d, i) => [d ? d.key : 'none', i]));
